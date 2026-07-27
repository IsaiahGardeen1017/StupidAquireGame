import { describe, expect, it } from "vitest";

import {
  TlstyerOnlineClient,
  type TlstyerTransport,
  type TlstyerTransportHandlers
} from "../client/tlstyer/TlstyerOnlineClient.js";
import {
  COMMANDS_TO_CLIENT,
  COMMANDS_TO_SERVER,
  GAME_ACTIONS,
  GAME_BOARD_TYPES,
  GAME_MODES,
  GAME_STATES
} from "../client/protocol.js";

class FakeTransport implements TlstyerTransport {
  public readonly sent: unknown[][] = [];
  public readonly connections: Array<[string, string, string]> = [];

  public constructor(public readonly handlers: TlstyerTransportHandlers) {}

  public connect(username: string, passwordHash: string, version: string) {
    this.connections.push([username, passwordHash, version]);
  }

  public disconnect() {
    this.handlers.onClose?.();
  }

  public send(...message: unknown[]) {
    this.sent.push(message);
  }

  public receive(...messages: unknown[][]) {
    this.handlers.onMessages?.(messages);
  }
}

function createFixture() {
  let transport: FakeTransport | undefined;
  const client = new TlstyerOnlineClient("http://test.invalid", (_url, handlers) => {
    transport = new FakeTransport(handlers);
    return transport;
  });
  if (transport === undefined) throw new Error("Transport factory was not invoked.");
  return { client, transport };
}

function openTwoPlayerGame(client: TlstyerOnlineClient, transport: FakeTransport) {
  transport.receive(
    [COMMANDS_TO_CLIENT.SetClientId, 42],
    [COMMANDS_TO_CLIENT.SetClientIdToData, 42, "You", ""],
    [COMMANDS_TO_CLIENT.SetClientIdToData, 7, "Opponent", ""],
    [COMMANDS_TO_CLIENT.SetGameState, 12, GAME_STATES.InProgress, GAME_MODES.Singles, 4],
    [COMMANDS_TO_CLIENT.SetGamePlayerJoin, 12, 0, 42],
    [COMMANDS_TO_CLIENT.SetGamePlayerJoin, 12, 1, 7]
  );
  return client.getSnapshot().activeGame;
}

describe("tlstyer game-session adapter", () => {
  it("exposes protocol state as a domain snapshot and submits value-based tile decisions", async () => {
    const { client, transport } = createFixture();
    client.connect("You", "hash", "version");
    expect(transport.connections).toEqual([["You", "hash", "version"]]);

    const session = openTwoPlayerGame(client, transport);
    expect(session).not.toBeNull();
    if (session === null) return;

    transport.receive(
      [COMMANDS_TO_CLIENT.SetGameBoardCell, 0, 0, GAME_BOARD_TYPES.Luxor],
      [COMMANDS_TO_CLIENT.SetScoreSheet, [[
        [2, 0, 0, 0, 0, 0, 0, 60],
        [1, 0, 0, 0, 0, 0, 0, 60]
      ], [2, 0, 0, 0, 0, 0, 0]]],
      [COMMANDS_TO_CLIENT.SetTile, 0, 2, 1, GAME_BOARD_TYPES.WillPutLonelyTileDown],
      [COMMANDS_TO_CLIENT.SetTile, 1, 3, 1, GAME_BOARD_TYPES.CantPlayEver],
      [COMMANDS_TO_CLIENT.SetTurn, 0],
      [COMMANDS_TO_CLIENT.SetGameAction, GAME_ACTIONS.PlayTile, 0]
    );

    const snapshot = session.getSnapshot();
    expect(snapshot.kind).toBe("online");
    expect(snapshot.viewerPlayerId).toBe("0");
    expect(snapshot.players.map((player) => player.name)).toEqual(["You", "Opponent"]);
    expect(snapshot.players[0]?.cash).toBe(6000);
    expect(snapshot.chains.Luxor).toMatchObject({ size: 2, price: 200, availableShares: 22 });
    expect(snapshot.board[0]?.content).toEqual({ kind: "chain", chain: "Luxor" });
    expect(snapshot.tileRack[0]).toMatchObject({ placement: "isolated", tile: { row: "B", column: 3 } });
    expect(snapshot.tileRack[1]).toMatchObject({ placement: "unplayablePermanently" });
    expect(snapshot.pendingDecision).toMatchObject({
      kind: "playTile",
      playableTiles: [{ row: "B", column: 3 }],
      unplayableTiles: [{ row: "B", column: 4 }]
    });

    const pending = snapshot.pendingDecision;
    if (pending?.kind !== "playTile") throw new Error("Expected a tile decision.");
    await session.execute({
      kind: "submitDecision",
      requestId: pending.id,
      decision: { kind: "playTile", tile: { row: "B", column: 3 } }
    });
    expect(transport.sent.at(-1)).toEqual([COMMANDS_TO_SERVER.DoGameAction, GAME_ACTIONS.PlayTile, 0]);
    expect(session.getSnapshot().pendingDecision).toBeNull();

    await expect(session.execute({
      kind: "submitDecision",
      requestId: pending.id,
      decision: { kind: "playTile", tile: { row: "B", column: 3 } }
    })).rejects.toMatchObject({ code: "staleDecision" });
  });

  it("maps named chain and purchase decisions back to server ids and validates them", async () => {
    const { client, transport } = createFixture();
    const session = openTwoPlayerGame(client, transport);
    if (session === null) throw new Error("Expected an active session.");

    transport.receive(
      [COMMANDS_TO_CLIENT.SetScoreSheet, [[[0, 0, 0, 0, 0, 0, 0, 60], [0, 0, 0, 0, 0, 0, 0, 60]], [0, 0, 2, 0, 2, 0, 0]]],
      [COMMANDS_TO_CLIENT.SetGameAction, GAME_ACTIONS.SelectNewChain, 0, [2, 4]]
    );
    const select = session.getSnapshot().pendingDecision;
    if (select?.kind !== "selectChain") throw new Error("Expected a chain decision.");
    expect(select.chains).toEqual(["American", "Worldwide"]);
    await session.execute({ kind: "submitDecision", requestId: select.id, decision: { kind: "selectChain", chain: "Worldwide" } });
    expect(transport.sent.at(-1)).toEqual([COMMANDS_TO_SERVER.DoGameAction, GAME_ACTIONS.SelectNewChain, 4]);

    transport.receive([COMMANDS_TO_CLIENT.SetGameAction, GAME_ACTIONS.PurchaseShares, 0]);
    const buy = session.getSnapshot().pendingDecision;
    if (buy?.kind !== "buyShares") throw new Error("Expected a purchase decision.");
    await session.execute({
      kind: "submitDecision",
      requestId: buy.id,
      decision: { kind: "buyShares", purchase: { American: 1, Worldwide: 1 }, endGame: false }
    });
    expect(transport.sent.at(-1)).toEqual([COMMANDS_TO_SERVER.DoGameAction, GAME_ACTIONS.PurchaseShares, [2, 4], 0]);

    transport.receive([COMMANDS_TO_CLIENT.SetGameAction, GAME_ACTIONS.PurchaseShares, 0]);
    const nextBuy = session.getSnapshot().pendingDecision;
    if (nextBuy?.kind !== "buyShares") throw new Error("Expected another purchase decision.");
    await expect(session.execute({
      kind: "submitDecision",
      requestId: nextBuy.id,
      decision: { kind: "buyShares", purchase: { American: 4 }, endGame: false }
    })).rejects.toMatchObject({ code: "invalidDecision" });
  });

  it("buffers game messages that arrive before the server confirms a watched game", () => {
    const { client, transport } = createFixture();
    transport.receive(
      [COMMANDS_TO_CLIENT.SetClientId, 42],
      [COMMANDS_TO_CLIENT.SetClientIdToData, 42, "Watcher", ""],
      [COMMANDS_TO_CLIENT.SetGameState, 99, GAME_STATES.InProgress, GAME_MODES.Singles, 4]
    );
    client.watchGame(99);
    transport.receive(
      [COMMANDS_TO_CLIENT.SetGameBoardCell, 5, 4, GAME_BOARD_TYPES.Imperial],
      [COMMANDS_TO_CLIENT.SetGameWatcherClientId, 99, 42]
    );

    const session = client.getSnapshot().activeGame;
    expect(session).not.toBeNull();
    expect(session?.getSnapshot().viewerPlayerId).toBeNull();
    const cell = session?.getSnapshot().board.find((entry) => entry.tile.column === 6 && entry.tile.row === "E");
    expect(cell?.content).toEqual({ kind: "chain", chain: "Imperial" });
  });

  it("keeps private tile draws hidden while retaining structured turn events for replays", () => {
    const { client, transport } = createFixture();
    const session = openTwoPlayerGame(client, transport);
    if (session === null) throw new Error("Expected an active session.");
    transport.receive(
      [COMMANDS_TO_CLIENT.AddGameHistoryMessage, 0, 1],
      [COMMANDS_TO_CLIENT.AddGameHistoryMessage, 3, 1, 8, 7],
      [COMMANDS_TO_CLIENT.AddGameHistoryMessage, 3, 0, 2, 1]
    );
    expect(session.getSnapshot().history.map((entry) => entry.event)).toEqual([
      { kind: "turnBegan", playerId: "1" },
      { kind: "tileDrawn", playerId: "1", tile: null },
      { kind: "tileDrawn", playerId: "0", tile: { row: "B", column: 3 } }
    ]);
  });
});
