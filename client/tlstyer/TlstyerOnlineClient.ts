import {
  GameSessionCommandError,
  HOTEL_CHAINS,
  tilesEqual,
  type BuySharesDecisionRequest,
  type CurrentGameAction,
  type DisposeSharesDecisionRequest,
  type GameBoardCell,
  type GameChatMessage,
  type GameDecisionRequest,
  type GameEvent,
  type GameHistoryEntry,
  type GameLifecycle,
  type GameSession,
  type GameSessionCommand,
  type GameSessionListener,
  type GameSessionSnapshot,
  type GameState,
  type HotelChain,
  type SessionChainState,
  type SessionPlayerState,
  type SharePurchase,
  type Tile,
  type TilePlacementKind,
  type TileRackEntry
} from "../../src/index.js";
import { AcquireNetworkClient } from "../network.js";
import {
  COMMANDS_TO_CLIENT,
  COMMANDS_TO_SERVER,
  GAME_ACTIONS,
  GAME_BOARD_TYPES,
  GAME_MODES,
  GAME_STATES,
  SCORE_SHEET_INDEXES,
  type GameActionId
} from "../protocol.js";

const BOARD_WIDTH = 12;
const BOARD_HEIGHT = 9;
const TILE_RACK_SIZE = 6;
const INITIAL_SHARES_PER_CHAIN = 25;
const MAX_SHARE_PURCHASE = 3;
const MONEY_SCALE = 100;

const GAME_HISTORY_MESSAGES = {
  TurnBegan: 0,
  DrewPositionTile: 1,
  StartedGame: 2,
  DrewTile: 3,
  HasNoPlayableTile: 4,
  PlayedTile: 5,
  FormedChain: 6,
  MergedChains: 7,
  SelectedMergerSurvivor: 8,
  SelectedChainToDisposeOfNext: 9,
  ReceivedBonus: 10,
  DisposedOfShares: 11,
  CouldNotAffordAnyShares: 12,
  PurchasedShares: 13,
  DrewLastTile: 14,
  ReplacedDeadTile: 15,
  EndedGame: 16,
  NoTilesPlayedForEntireRound: 17,
  AllTilesPlayed: 18
} as const;

export type TlstyerConnectionStatus = "disconnected" | "connecting" | "connected";

export type TlstyerErrorCode =
  | "versionMismatch"
  | "generic"
  | "invalidUsername"
  | "invalidPassword"
  | "missingPassword"
  | "unexpectedPassword"
  | "incorrectPassword"
  | "passwordMismatch"
  | "passwordAlreadyExists"
  | "usernameInUse"
  | "lostConnection";

export type TlstyerClientInfo = Readonly<{
  clientId: number;
  username: string;
  ipAddress: string;
}>;

export type TlstyerPlayerSeat = Readonly<{
  username: string;
  clientId: number | null;
}>;

export type TlstyerLobbyGameState = "starting" | "startingFull" | "inProgress" | "completed";
export type TlstyerLobbyGameMode = "singles" | "teams";

export type TlstyerLobbyGame = Readonly<{
  gameId: number;
  state: TlstyerLobbyGameState;
  mode: TlstyerLobbyGameMode;
  maxPlayers: number;
  score: number | null;
  players: readonly TlstyerPlayerSeat[];
  watcherClientIds: readonly number[];
}>;

export type TlstyerLobbyChatMessage = Readonly<{
  id: string;
  senderId: number;
  senderName: string;
  message: string;
}>;

export type TlstyerOnlineSnapshot = Readonly<{
  revision: number;
  status: TlstyerConnectionStatus;
  error: TlstyerErrorCode | null;
  selfClientId: number | null;
  selfUsername: string | null;
  clients: Readonly<Record<number, TlstyerClientInfo>>;
  lobbyClientIds: readonly number[];
  games: Readonly<Record<number, TlstyerLobbyGame>>;
  globalChat: readonly TlstyerLobbyChatMessage[];
  activeGame: GameSession | null;
}>;

type OnlineListener = (snapshot: TlstyerOnlineSnapshot) => void;

export type TlstyerTransportHandlers = {
  onOpen?: () => void;
  onClose?: () => void;
  onMessages?: (messages: unknown) => void;
};

export interface TlstyerTransport {
  connect(username: string, passwordHash: string, version: string): void;
  disconnect(): void;
  send(...message: unknown[]): void;
}

export type TlstyerTransportFactory = (serverUrl: string, handlers: TlstyerTransportHandlers) => TlstyerTransport;

type MutableLobbyGame = {
  gameId: number;
  state: TlstyerLobbyGameState;
  mode: TlstyerLobbyGameMode;
  maxPlayers: number;
  score: number | null;
  players: TlstyerPlayerSeat[];
  watcherClientIds: number[];
};

type RawBoardCell = { x: number; y: number; typeId: number };
type RawTileRackEntry = { tile: Tile; typeId: number };
type RawAction = { actionId: GameActionId; playerId: number | null; argument?: unknown };

export class TlstyerOnlineClient {
  private readonly network: TlstyerTransport;
  private readonly listeners = new Set<OnlineListener>();
  private revision = 0;
  private status: TlstyerConnectionStatus = "disconnected";
  private error: TlstyerErrorCode | null = null;
  private selfClientId: number | null = null;
  private selfUsername: string | null = null;
  private clients: Record<number, TlstyerClientInfo> = {};
  private lobbyClientIds: number[] = [];
  private games: Record<number, MutableLobbyGame> = {};
  private globalChat: TlstyerLobbyChatMessage[] = [];
  private activeGame: TlstyerGameSession | null = null;
  private intentionallyDisconnecting = false;
  private chatSequence = 0;
  private openingGameId: number | null = null;
  private pendingGameMessages: Array<[number, unknown[]]> = [];

  public constructor(
    serverUrl: string,
    createTransport: TlstyerTransportFactory = (url, handlers) => new AcquireNetworkClient(url, handlers)
  ) {
    this.network = createTransport(serverUrl, {
      onClose: () => this.handleClose(),
      onMessages: (messages) => this.handleMessages(messages)
    });
  }

  public getSnapshot(): TlstyerOnlineSnapshot {
    return {
      revision: this.revision,
      status: this.status,
      error: this.error,
      selfClientId: this.selfClientId,
      selfUsername: this.selfUsername,
      clients: { ...this.clients },
      lobbyClientIds: [...this.lobbyClientIds],
      games: Object.fromEntries(
        Object.entries(this.games).map(([id, game]) => [Number(id), copyLobbyGame(game)])
      ),
      globalChat: [...this.globalChat],
      activeGame: this.activeGame
    };
  }

  public subscribe(listener: OnlineListener) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  public connect(username: string, passwordHash: string, version: string) {
    this.intentionallyDisconnecting = false;
    this.error = null;
    this.status = "connecting";
    this.emit();
    this.network.connect(username, passwordHash, version);
  }

  public disconnect() {
    this.intentionallyDisconnecting = true;
    this.network.disconnect();
  }

  public joinGame(gameId: number) {
    this.beginOpeningGame(gameId);
    this.network.send(COMMANDS_TO_SERVER.JoinGame, gameId);
  }

  public watchGame(gameId: number) {
    this.beginOpeningGame(gameId);
    this.network.send(COMMANDS_TO_SERVER.WatchGame, gameId);
  }

  public rejoinGame(gameId: number) {
    this.closeActiveGame();
    this.beginOpeningGame(gameId);
    this.network.send(COMMANDS_TO_SERVER.RejoinGame, gameId);
  }

  public sendGlobalChat(message: string) {
    this.network.send(COMMANDS_TO_SERVER.SendGlobalChatMessage, message);
  }

  private handleClose() {
    const lostConnection = !this.intentionallyDisconnecting;
    this.intentionallyDisconnecting = false;
    this.closeActiveGame();
    this.status = "disconnected";
    this.error = lostConnection ? "lostConnection" : null;
    this.selfClientId = null;
    this.selfUsername = null;
    this.clients = {};
    this.lobbyClientIds = [];
    this.games = {};
    this.globalChat = [];
    this.openingGameId = null;
    this.pendingGameMessages = [];
    this.emit();
  }

  private handleMessages(messages: unknown) {
    if (!Array.isArray(messages)) {
      return;
    }

    for (const message of messages) {
      if (Array.isArray(message)) {
        this.applyServerMessage(message as [number, ...unknown[]]);
      }
    }

    if (this.selfClientId !== null && this.status === "connecting") {
      this.status = "connected";
    }
    this.activeGame?.publishChanges();
    this.emit();
  }

  private applyServerMessage([command, ...payload]: [number, ...unknown[]]) {
    switch (command) {
      case COMMANDS_TO_CLIENT.FatalError:
        this.status = "disconnected";
        this.error = errorCode(Number(payload[0] ?? 1));
        return;
      case COMMANDS_TO_CLIENT.SetClientId:
        this.selfClientId = Number(payload[0]);
        this.error = null;
        return;
      case COMMANDS_TO_CLIENT.SetClientIdToData:
        this.applyClientData(payload);
        return;
      case COMMANDS_TO_CLIENT.SetGameState:
        this.applyGameState(payload);
        return;
      case COMMANDS_TO_CLIENT.SetGamePlayerJoin:
        this.applyGamePlayerJoin(payload);
        return;
      case COMMANDS_TO_CLIENT.SetGamePlayerRejoin:
        this.applyGamePlayerRejoin(payload);
        return;
      case COMMANDS_TO_CLIENT.SetGamePlayerLeave:
        this.applyGamePlayerLeave(payload);
        return;
      case COMMANDS_TO_CLIENT.SetGamePlayerJoinMissing:
        this.applyGamePlayerJoinMissing(payload);
        return;
      case COMMANDS_TO_CLIENT.SetGameWatcherClientId:
        this.applyGameWatcherJoin(payload);
        return;
      case COMMANDS_TO_CLIENT.ReturnWatcherToLobby:
        this.applyGameWatcherLeave(payload);
        return;
      case COMMANDS_TO_CLIENT.DestroyGame:
        this.applyDestroyGame(Number(payload[0]));
        return;
      case COMMANDS_TO_CLIENT.AddGlobalChatMessage:
        this.applyGlobalChat(payload);
        return;
      default:
        if (this.activeGame !== null) {
          this.activeGame.applyProtocolMessage(command, payload);
        } else if (this.openingGameId !== null) {
          this.pendingGameMessages.push([command, payload]);
        }
    }
  }

  private applyClientData(payload: unknown[]) {
    const clientId = Number(payload[0]);
    const username = payload[1];
    if (username === null) {
      delete this.clients[clientId];
      this.lobbyClientIds = this.lobbyClientIds.filter((id) => id !== clientId);
      return;
    }

    this.clients[clientId] = {
      clientId,
      username: String(username),
      ipAddress: String(payload[2] ?? "")
    };
    if (!this.lobbyClientIds.includes(clientId)) {
      this.lobbyClientIds.push(clientId);
      this.lobbyClientIds.sort((left, right) => left - right);
    }
    if (clientId === this.selfClientId) {
      this.selfUsername = String(username);
    }
    this.activeGame?.refreshExternalState();
  }

  private applyGameState(payload: unknown[]) {
    const gameId = Number(payload[0]);
    const game = this.games[gameId] ?? createLobbyGame(gameId);
    game.state = lobbyGameState(Number(payload[1]));
    game.mode = Number(payload[2] ?? GAME_MODES.Singles) === GAME_MODES.Teams ? "teams" : "singles";
    game.maxPlayers = Number(payload[3] ?? 4);
    game.score = payload[4] === undefined || Array.isArray(payload[4]) ? null : Number(payload[4]);
    this.games[gameId] = game;

    if (this.activeGame?.gameId === gameId) {
      this.activeGame.setLifecycle(lifecycleFromLobbyState(game.state));
      if (game.state === "completed") {
        const scores = Array.isArray(payload[4]) ? payload[4].map(Number) : undefined;
        this.activeGame.setFinalStandings(scores);
      }
    }
  }

  private applyGamePlayerJoin(payload: unknown[]) {
    const gameId = Number(payload[0]);
    const playerId = Number(payload[1]);
    const clientId = Number(payload[2]);
    const game = this.games[gameId];
    const client = this.clients[clientId];
    if (game === undefined || client === undefined) {
      return;
    }
    game.players.splice(playerId, 0, { username: client.username, clientId });
    this.activeGame?.refreshExternalState();
    this.removeLobbyClient(clientId);
    if (clientId === this.selfClientId) {
      this.openActiveGame(gameId, playerId);
    }
  }

  private applyGamePlayerRejoin(payload: unknown[]) {
    const gameId = Number(payload[0]);
    const playerId = Number(payload[1]);
    const clientId = Number(payload[2]);
    const game = this.games[gameId];
    const player = game?.players[playerId];
    if (game === undefined || player === undefined) {
      return;
    }
    game.players[playerId] = { username: player.username, clientId };
    this.activeGame?.refreshExternalState();
    this.removeLobbyClient(clientId);
    if (clientId === this.selfClientId) {
      this.openActiveGame(gameId, playerId);
    }
  }

  private applyGamePlayerLeave(payload: unknown[]) {
    const gameId = Number(payload[0]);
    const playerId = Number(payload[1]);
    const clientId = Number(payload[2]);
    const game = this.games[gameId];
    const player = game?.players[playerId];
    if (game === undefined || player === undefined) {
      return;
    }
    game.players[playerId] = { username: player.username, clientId: null };
    this.activeGame?.refreshExternalState();
    this.addLobbyClient(clientId);
    if (clientId === this.selfClientId) {
      this.closeActiveGame();
    }
  }

  private applyGamePlayerJoinMissing(payload: unknown[]) {
    const gameId = Number(payload[0]);
    const playerId = Number(payload[1]);
    const game = this.games[gameId];
    if (game === undefined) {
      return;
    }
    const value = payload[2];
    const username = typeof value === "number" ? this.clients[value]?.username ?? String(value) : String(value);
    game.players.splice(playerId, 0, { username, clientId: null });
    this.activeGame?.refreshExternalState();
  }

  private applyGameWatcherJoin(payload: unknown[]) {
    const gameId = Number(payload[0]);
    const clientId = Number(payload[1]);
    const game = this.games[gameId];
    if (game === undefined) {
      return;
    }
    if (!game.watcherClientIds.includes(clientId)) {
      game.watcherClientIds.push(clientId);
    }
    this.removeLobbyClient(clientId);
    if (clientId === this.selfClientId) {
      this.openActiveGame(gameId, null);
    }
  }

  private applyGameWatcherLeave(payload: unknown[]) {
    const gameId = Number(payload[0]);
    const clientId = Number(payload[1]);
    const game = this.games[gameId];
    if (game === undefined) {
      return;
    }
    game.watcherClientIds = game.watcherClientIds.filter((id) => id !== clientId);
    this.addLobbyClient(clientId);
    if (clientId === this.selfClientId) {
      this.closeActiveGame();
    }
  }

  private applyDestroyGame(gameId: number) {
    delete this.games[gameId];
    if (this.activeGame?.gameId === gameId) {
      this.closeActiveGame();
    }
  }

  private applyGlobalChat(payload: unknown[]) {
    const senderId = Number(payload[0]);
    this.chatSequence += 1;
    this.globalChat.push({
      id: `lobby-chat-${this.chatSequence}`,
      senderId,
      senderName: this.clients[senderId]?.username ?? `Client ${senderId}`,
      message: String(payload[1] ?? "")
    });
  }

  private openActiveGame(gameId: number, viewerPlayerId: number | null) {
    if (this.activeGame?.gameId !== gameId || this.activeGame.viewerPlayerIndex !== viewerPlayerId) {
      this.closeActiveGame();
      this.activeGame = new TlstyerGameSession(
        gameId,
        viewerPlayerId,
        () => this.games[gameId]?.players ?? [],
        (message) => this.network.send(...message),
        () => this.closeGameFromSession()
      );
      if (this.openingGameId === gameId) {
        for (const [command, payload] of this.pendingGameMessages) {
          this.activeGame.applyProtocolMessage(command, payload);
        }
      }
    }
    this.openingGameId = null;
    this.pendingGameMessages = [];
    const state = this.games[gameId]?.state ?? "starting";
    this.activeGame.setLifecycle(lifecycleFromLobbyState(state));
  }

  private closeGameFromSession() {
    this.network.send(COMMANDS_TO_SERVER.LeaveGame);
  }

  private closeActiveGame() {
    this.activeGame?.dispose();
    this.activeGame = null;
  }

  private removeLobbyClient(clientId: number) {
    this.lobbyClientIds = this.lobbyClientIds.filter((id) => id !== clientId);
  }

  private addLobbyClient(clientId: number) {
    if (this.clients[clientId] !== undefined && !this.lobbyClientIds.includes(clientId)) {
      this.lobbyClientIds.push(clientId);
      this.lobbyClientIds.sort((left, right) => left - right);
    }
  }

  private beginOpeningGame(gameId: number) {
    this.openingGameId = gameId;
    this.pendingGameMessages = [];
  }

  private emit() {
    this.revision += 1;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

class TlstyerGameSession implements GameSession {
  public readonly kind = "online" as const;
  private readonly listeners = new Set<GameSessionListener>();
  private readonly board: RawBoardCell[] = Array.from({ length: BOARD_WIDTH * BOARD_HEIGHT }, (_, index) => ({
    x: index % BOARD_WIDTH,
    y: Math.floor(index / BOARD_WIDTH),
    typeId: GAME_BOARD_TYPES.Nothing
  }));
  private readonly tileRack: Array<RawTileRackEntry | null> = Array.from({ length: TILE_RACK_SIZE }, () => null);
  private playerRows: number[][] = [];
  private chainSizes: number[] = Array.from({ length: HOTEL_CHAINS.length }, () => 0);
  private turnPlayerId: number | null = null;
  private currentAction: RawAction | null = null;
  private lifecycle: GameLifecycle = "setup";
  private history: GameHistoryEntry[] = [];
  private chat: GameChatMessage[] = [];
  private revision = 0;
  private actionSequence = 0;
  private historySequence = 0;
  private chatSequence = 0;
  private awaitingActionAdvance = false;
  private isDisposed = false;
  private lastPublishedRevision = -1;

  public constructor(
    public readonly gameId: number,
    public readonly viewerPlayerIndex: number | null,
    private readonly getSeats: () => readonly TlstyerPlayerSeat[],
    private readonly send: (message: unknown[]) => void,
    private readonly requestLeave: () => void
  ) {}

  public getSnapshot(): GameSessionSnapshot {
    const players = this.createPlayers();
    const chains = this.createChains();
    const pendingDecision = this.createPendingDecision(players, chains);
    return {
      revision: this.revision,
      gameId: String(this.gameId),
      kind: this.kind,
      lifecycle: this.lifecycle,
      viewerPlayerId: this.viewerPlayerIndex === null ? null : String(this.viewerPlayerIndex),
      activePlayerId: this.turnPlayerId === null ? null : String(this.turnPlayerId),
      currentAction: this.createCurrentAction(),
      pendingDecision,
      board: this.board.map(rawBoardCellToDomain),
      tileRack: this.tileRack.map((entry, slot) => entry === null ? null : rawRackEntryToDomain(entry, slot)),
      players,
      chains,
      tilesRemaining: null,
      history: [...this.history],
      chat: [...this.chat],
      replay: null,
      capabilities: {
        canSubmitDecisions: this.viewerPlayerIndex !== null,
        canStartGame: this.viewerPlayerIndex !== null && this.currentAction?.actionId === GAME_ACTIONS.StartGame,
        canSendChat: true,
        canLeave: true,
        canNavigateReplay: false
      }
    };
  }

  public subscribe(listener: GameSessionListener) {
    this.assertNotDisposed();
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  public async execute(command: GameSessionCommand) {
    this.assertNotDisposed();
    switch (command.kind) {
      case "submitDecision":
        this.submitDecision(command.requestId, command.decision);
        return;
      case "startGame":
        if (this.currentAction?.actionId !== GAME_ACTIONS.StartGame || this.currentAction.playerId !== this.viewerPlayerIndex) {
          throw new GameSessionCommandError("The current viewer cannot start this game.", "unsupported");
        }
        this.send([COMMANDS_TO_SERVER.DoGameAction, GAME_ACTIONS.StartGame]);
        this.awaitingActionAdvance = true;
        this.markChanged();
        this.publishChanges();
        return;
      case "sendChat":
        this.send([COMMANDS_TO_SERVER.SendGameChatMessage, command.message]);
        return;
      case "leave":
        this.requestLeave();
        return;
      default:
        throw new GameSessionCommandError(`Command ${command.kind} is not supported by an online game.`, "unsupported");
    }
  }

  public dispose() {
    this.isDisposed = true;
    this.listeners.clear();
  }

  public setLifecycle(lifecycle: GameLifecycle) {
    if (this.lifecycle !== lifecycle) {
      this.lifecycle = lifecycle;
      this.markChanged();
    }
  }

  public setFinalStandings(serverScores?: number[]) {
    if (this.history.some((entry) => entry.event.kind === "finalStandings")) {
      return;
    }
    const players = this.createPlayers();
    if (players.length === 0) {
      return;
    }
    const ranked = players
      .map((player, index) => ({ playerId: player.id, score: serverScores?.[index] === undefined ? player.netWorth : serverScores[index]! * MONEY_SCALE }))
      .sort((left, right) => right.score - left.score || Number(left.playerId) - Number(right.playerId));
    let previousScore: number | undefined;
    let previousRank = 0;
    const standings = ranked.map((entry, index) => {
      const rank = entry.score === previousScore ? previousRank : index + 1;
      previousScore = entry.score;
      previousRank = rank;
      return { ...entry, rank };
    });
    this.pushHistory({ kind: "finalStandings", standings });
  }

  public applyProtocolMessage(command: number, payload: unknown[]) {
    switch (command) {
      case COMMANDS_TO_CLIENT.SetGameBoardCell:
        this.updateBoardCell(Number(payload[0]), Number(payload[1]), Number(payload[2]));
        break;
      case COMMANDS_TO_CLIENT.SetGameBoard:
        this.applyWholeBoard(payload[0] as number[][]);
        break;
      case COMMANDS_TO_CLIENT.SetTile:
        this.applyTile(payload);
        break;
      case COMMANDS_TO_CLIENT.SetTileGameBoardType:
        this.applyTileType(payload);
        break;
      case COMMANDS_TO_CLIENT.RemoveTile:
        this.tileRack[Number(payload[0])] = null;
        this.markChanged();
        break;
      case COMMANDS_TO_CLIENT.SetScoreSheetCell:
        this.applyScoreCell(payload);
        break;
      case COMMANDS_TO_CLIENT.SetScoreSheet:
        this.applyScoreSheet(payload[0] as [number[][], number[]]);
        break;
      case COMMANDS_TO_CLIENT.SetTurn:
        this.turnPlayerId = payload[0] === null ? null : Number(payload[0]);
        this.markChanged();
        break;
      case COMMANDS_TO_CLIENT.SetGameAction:
        this.applyGameAction(payload);
        break;
      case COMMANDS_TO_CLIENT.AddGameHistoryMessage:
        this.applyHistoryEntry(payload);
        break;
      case COMMANDS_TO_CLIENT.AddGameHistoryMessages:
        if (Array.isArray(payload[0])) {
          for (const entry of payload[0]) {
            if (Array.isArray(entry)) {
              this.applyHistoryEntry(entry);
            }
          }
        }
        break;
      case COMMANDS_TO_CLIENT.AddGameChatMessage:
        this.applyChat(payload);
        break;
    }
  }

  public publishChanges() {
    if (this.isDisposed || this.lastPublishedRevision === this.revision) {
      return;
    }
    this.lastPublishedRevision = this.revision;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  public refreshExternalState() {
    this.markChanged();
  }

  private updateBoardCell(x: number, y: number, typeId: number) {
    const cell = this.board.find((entry) => entry.x === x && entry.y === y);
    if (cell !== undefined) {
      cell.typeId = typeId;
      this.markChanged();
    }
  }

  private applyWholeBoard(board: number[][]) {
    board.forEach((column, x) => column.forEach((typeId, y) => this.updateBoardCell(x, y, typeId)));
  }

  private applyTile(payload: unknown[]) {
    const slot = Number(payload[0]);
    this.tileRack[slot] = {
      tile: protocolTile(Number(payload[1]), Number(payload[2])),
      typeId: Number(payload[3])
    };
    this.markChanged();
  }

  private applyTileType(payload: unknown[]) {
    const existing = this.tileRack[Number(payload[0])];
    if (existing !== null && existing !== undefined) {
      existing.typeId = Number(payload[1]);
      this.markChanged();
    }
  }

  private applyScoreCell(payload: unknown[]) {
    const row = Number(payload[0]);
    const column = Number(payload[1]);
    const value = Number(payload[2]);
    if (row < 6) {
      this.playerRows[row] ??= [];
      this.playerRows[row]![column] = value;
    } else if (row === 7) {
      this.chainSizes[column] = value;
    }
    this.markChanged();
  }

  private applyScoreSheet([playerRows, chainRows]: [number[][], number[]]) {
    this.playerRows = playerRows.map((row) => [...row]);
    this.chainSizes = [...chainRows];
    this.markChanged();
  }

  private applyGameAction(payload: unknown[]) {
    const actionArguments = payload.slice(2);
    const argument = actionArguments.length <= 1 ? actionArguments[0] : actionArguments;
    this.currentAction = {
      actionId: Number(payload[0]) as GameActionId,
      playerId: payload[1] === null ? null : Number(payload[1]),
      ...(argument === undefined ? {} : { argument })
    };
    this.actionSequence += 1;
    this.awaitingActionAdvance = false;
    this.markChanged();
  }

  private applyHistoryEntry(payload: unknown[]) {
    this.pushHistory(parseHistoryEvent(payload, this.viewerPlayerIndex));
  }

  private applyChat(payload: unknown[]) {
    const senderClientId = Number(payload[0]);
    const seat = this.getSeats().find((entry) => entry.clientId === senderClientId);
    this.chatSequence += 1;
    this.chat.push({
      id: `game-chat-${this.chatSequence}`,
      senderId: String(senderClientId),
      senderName: seat?.username ?? `Client ${senderClientId}`,
      message: String(payload[1] ?? "")
    });
    this.markChanged();
  }

  private submitDecision(requestId: string, decision: import("../../src/index.js").GameDecision) {
    const pending = this.createPendingDecision(this.createPlayers(), this.createChains());
    if (pending === null || pending.id !== requestId || this.awaitingActionAdvance) {
      throw new GameSessionCommandError("This decision request is no longer active.", "staleDecision");
    }

    if (pending.kind === "playTile" && decision.kind === "playTile") {
      if (!pending.playableTiles.some((tile) => tilesEqual(tile, decision.tile))) {
        throw new GameSessionCommandError("That tile is not a legal choice.", "invalidDecision");
      }
      const slot = this.tileRack.findIndex((entry) => entry !== null && tilesEqual(entry.tile, decision.tile));
      if (slot < 0) {
        throw new GameSessionCommandError("That tile is no longer in the rack.", "staleDecision");
      }
      this.send([COMMANDS_TO_SERVER.DoGameAction, GAME_ACTIONS.PlayTile, slot]);
    } else if (pending.kind === "selectChain" && decision.kind === "selectChain") {
      if (!pending.chains.includes(decision.chain)) {
        throw new GameSessionCommandError("That hotel chain is not a legal choice.", "invalidDecision");
      }
      this.send([COMMANDS_TO_SERVER.DoGameAction, this.currentAction!.actionId, HOTEL_CHAINS.indexOf(decision.chain)]);
    } else if (pending.kind === "disposeShares" && decision.kind === "disposeShares") {
      validateShareDisposal(pending, decision.trade, decision.sell);
      this.send([COMMANDS_TO_SERVER.DoGameAction, GAME_ACTIONS.DisposeOfShares, decision.trade, decision.sell]);
    } else if (pending.kind === "buyShares" && decision.kind === "buyShares") {
      const cart = validateSharePurchase(pending, decision.purchase, decision.endGame);
      this.send([COMMANDS_TO_SERVER.DoGameAction, GAME_ACTIONS.PurchaseShares, cart, decision.endGame ? 1 : 0]);
    } else {
      throw new GameSessionCommandError("The submitted decision does not match the active request.", "invalidDecision");
    }

    this.awaitingActionAdvance = true;
    this.markChanged();
    this.publishChanges();
  }

  private createPlayers(): SessionPlayerState[] {
    const seats = this.getSeats();
    const prices = HOTEL_CHAINS.map((_, index) => sharePriceHundreds(index, this.chainSizes[index] ?? 0));
    const bonuses = HOTEL_CHAINS.map((_, chainIndex) =>
      computeBonuses(this.playerRows.map((row) => row[chainIndex] ?? 0), prices[chainIndex] ?? 0)
    );
    return seats.map((seat, playerIndex) => {
      const row = this.playerRows[playerIndex] ?? [];
      const cash = (row[SCORE_SHEET_INDEXES.Cash] ?? 0) * MONEY_SCALE;
      const holdings = prices.reduce((total, price, chainIndex) => total + (row[chainIndex] ?? 0) * price * MONEY_SCALE, 0);
      const bonusValue = bonuses.reduce((total, chainBonuses) => total + (chainBonuses[playerIndex] ?? 0) * MONEY_SCALE, 0);
      return {
        id: String(playerIndex),
        name: seat.username,
        isConnected: seat.clientId !== null,
        cash,
        netWorth: cash + holdings + bonusValue,
        shares: sharesFromRow(row),
        handSize: playerIndex === this.viewerPlayerIndex
          ? this.tileRack.filter((entry) => entry !== null).length
          : null
      };
    });
  }

  private createChains(): Record<HotelChain, SessionChainState> {
    const players = this.playerRows;
    return Object.fromEntries(HOTEL_CHAINS.map((chain, index) => {
      const size = this.chainSizes[index] ?? 0;
      const price = sharePriceHundreds(index, size) * MONEY_SCALE;
      const ownedShares = players.reduce((total, row) => total + (row[index] ?? 0), 0);
      return [chain, {
        chain,
        size,
        availableShares: INITIAL_SHARES_PER_CHAIN - ownedShares,
        price,
        majorityBonus: price * 10,
        minorityBonus: price * 5,
        isActive: size > 0,
        isSafe: size >= 11
      }];
    })) as Record<HotelChain, SessionChainState>;
  }

  private createPendingDecision(
    players: readonly SessionPlayerState[],
    chains: Readonly<Record<HotelChain, SessionChainState>>
  ): GameDecisionRequest | null {
    const action = this.currentAction;
    if (
      action === null ||
      this.awaitingActionAdvance ||
      this.viewerPlayerIndex === null ||
      action.playerId !== this.viewerPlayerIndex
    ) {
      return null;
    }
    const playerId = String(this.viewerPlayerIndex);
    const gameState = this.createStrategyGameState(players, chains);
    const id = `${this.gameId}:${this.actionSequence}`;
    if (action.actionId === GAME_ACTIONS.PlayTile) {
      const playableTiles: Tile[] = [];
      const unplayableTiles: Tile[] = [];
      for (const entry of this.tileRack) {
        if (entry === null) continue;
        if (isRawTilePlayable(entry.typeId)) playableTiles.push(entry.tile);
        else unplayableTiles.push(entry.tile);
      }
      return { kind: "playTile", id, playerId, gameState, playableTiles, unplayableTiles };
    }
    if (
      action.actionId === GAME_ACTIONS.SelectNewChain ||
      action.actionId === GAME_ACTIONS.SelectMergerSurvivor ||
      action.actionId === GAME_ACTIONS.SelectChainToDisposeOfNext
    ) {
      return {
        kind: "selectChain",
        id,
        playerId,
        gameState,
        purpose: action.actionId === GAME_ACTIONS.SelectNewChain
          ? "foundChain"
          : action.actionId === GAME_ACTIONS.SelectMergerSurvivor
          ? "mergeSurvivor"
          : "defunctChain",
        chains: chainIndexesFromArgument(action.argument),
        mergeTile: action.actionId === GAME_ACTIONS.SelectMergerSurvivor ? findLikelyMergeTile(this.tileRack) : null
      };
    }
    if (action.actionId === GAME_ACTIONS.DisposeOfShares) {
      const values = Array.isArray(action.argument) ? action.argument : [];
      const defunctIndex = Number(values[0]);
      const survivingIndex = Number(values[1]);
      const defunctChain = HOTEL_CHAINS[defunctIndex];
      const survivingChain = HOTEL_CHAINS[survivingIndex];
      if (defunctChain === undefined || survivingChain === undefined) return null;
      const ownedShares = this.playerRows[this.viewerPlayerIndex]?.[defunctIndex] ?? 0;
      const maxTrade = Math.floor(Math.min(ownedShares, chains[survivingChain].availableShares * 2) / 2) * 2;
      return {
        kind: "disposeShares",
        id,
        playerId,
        gameState,
        survivingChain,
        defunctChain,
        ownedShares,
        maxTrade,
        maxSell: ownedShares
      };
    }
    if (action.actionId === GAME_ACTIONS.PurchaseShares) {
      return {
        kind: "buyShares",
        id,
        playerId,
        gameState,
        options: HOTEL_CHAINS.map((chain) => chains[chain]).filter((chain) => chain.isActive && chain.availableShares > 0 && chain.price > 0).map((chain) => ({
          chain: chain.chain,
          price: chain.price,
          available: chain.availableShares
        })),
        maxShares: MAX_SHARE_PURCHASE,
        canEndGame: canGameEnd(chains)
      };
    }
    return null;
  }

  private createStrategyGameState(
    players: readonly SessionPlayerState[],
    chains: Readonly<Record<HotelChain, SessionChainState>>
  ): GameState {
    const viewerId = String(this.viewerPlayerIndex ?? 0);
    const viewer = players.find((player) => player.id === viewerId) ?? {
      id: viewerId,
      name: "Spectator",
      cash: 0,
      shares: emptyShares(),
      netWorth: 0,
      isConnected: true,
      handSize: null
    };
    const rack = this.tileRack.filter((entry): entry is RawTileRackEntry => entry !== null);
    const validTiles = rack.filter((entry) => isRawTilePlayable(entry.typeId)).map((entry) => entry.tile);
    const invalidTiles = rack.filter((entry) => !isRawTilePlayable(entry.typeId)).map((entry) => entry.tile);
    return {
      turnNumber: Math.max(this.history.filter((entry) => entry.event.kind === "turnBegan").length, 1),
      activePlayerId: this.turnPlayerId === null ? null : String(this.turnPlayerId),
      phase: phaseFromAction(this.currentAction?.actionId),
      board: this.board.filter((cell) => cell.typeId !== GAME_BOARD_TYPES.Nothing).map((cell) => ({
        tile: protocolTile(cell.x, cell.y),
        chain: chainFromTypeId(cell.typeId)
      })),
      players: players.map((player) => ({
        id: player.id,
        name: player.name,
        cash: player.cash,
        shares: player.shares,
        handSize: player.handSize
      })),
      self: {
        id: viewer.id,
        name: viewer.name,
        cash: viewer.cash,
        shares: viewer.shares,
        handSize: rack.length,
        tilesInHand: rack.map((entry) => entry.tile),
        validTiles,
        invalidTiles
      },
      chains: Object.fromEntries(HOTEL_CHAINS.map((chain) => [chain, {
        chain,
        size: chains[chain].size,
        availableShares: chains[chain].availableShares,
        price: chains[chain].price,
        majorityBonus: chains[chain].majorityBonus,
        minorityBonus: chains[chain].minorityBonus,
        isActive: chains[chain].isActive,
        isSafe: chains[chain].isSafe
      }])) as GameState["chains"],
      tilesRemaining: null,
      canEndGame: canGameEnd(chains)
    };
  }

  private createCurrentAction(): CurrentGameAction | null {
    if (this.currentAction === null) return null;
    return {
      kind: actionKind(this.currentAction.actionId),
      playerId: this.currentAction.playerId === null ? null : String(this.currentAction.playerId)
    };
  }

  private pushHistory(event: GameEvent) {
    this.historySequence += 1;
    this.history.push({ id: `history-${this.historySequence}`, event });
    this.markChanged();
  }

  private markChanged() {
    this.revision += 1;
  }

  private assertNotDisposed() {
    if (this.isDisposed) {
      throw new GameSessionCommandError("This game session has been disposed.", "disposed");
    }
  }
}

function copyLobbyGame(game: MutableLobbyGame): TlstyerLobbyGame {
  return { ...game, players: [...game.players], watcherClientIds: [...game.watcherClientIds] };
}

function createLobbyGame(gameId: number): MutableLobbyGame {
  return { gameId, state: "starting", mode: "singles", maxPlayers: 4, score: null, players: [], watcherClientIds: [] };
}

function lobbyGameState(stateId: number): TlstyerLobbyGameState {
  if (stateId === GAME_STATES.StartingFull) return "startingFull";
  if (stateId === GAME_STATES.InProgress) return "inProgress";
  if (stateId === GAME_STATES.Completed) return "completed";
  return "starting";
}

function lifecycleFromLobbyState(state: TlstyerLobbyGameState): GameLifecycle {
  if (state === "completed") return "completed";
  return state === "inProgress" ? "inProgress" : "setup";
}

function errorCode(errorId: number): TlstyerErrorCode {
  switch (errorId) {
    case 0: return "versionMismatch";
    case 2: return "invalidUsername";
    case 3: return "invalidPassword";
    case 4: return "missingPassword";
    case 5: return "unexpectedPassword";
    case 6: return "incorrectPassword";
    case 7: return "passwordMismatch";
    case 8: return "passwordAlreadyExists";
    case 9: return "usernameInUse";
    case 10: return "lostConnection";
    default: return "generic";
  }
}

function protocolTile(x: number, y: number): Tile {
  return { row: String.fromCharCode(65 + y), column: x + 1 };
}

function rawBoardCellToDomain(cell: RawBoardCell): GameBoardCell {
  const chain = chainFromTypeId(cell.typeId);
  return {
    tile: protocolTile(cell.x, cell.y),
    content: chain === null
      ? cell.typeId === GAME_BOARD_TYPES.NothingYet ? { kind: "independent" } : { kind: "empty" }
      : { kind: "chain", chain }
  };
}

function rawRackEntryToDomain(entry: RawTileRackEntry, slot: number): TileRackEntry {
  return {
    slot,
    tile: entry.tile,
    placement: placementFromTypeId(entry.typeId),
    chain: chainFromTypeId(entry.typeId)
  };
}

function chainFromTypeId(typeId: number): HotelChain | null {
  return HOTEL_CHAINS[typeId] ?? null;
}

function placementFromTypeId(typeId: number): TilePlacementKind {
  if (typeId >= 0 && typeId < HOTEL_CHAINS.length) return "extendsChain";
  switch (typeId) {
    case GAME_BOARD_TYPES.NothingYet: return "independent";
    case GAME_BOARD_TYPES.CantPlayEver: return "unplayablePermanently";
    case GAME_BOARD_TYPES.IHaveThis: return "inHand";
    case GAME_BOARD_TYPES.CantPlayNow: return "unplayableTemporarily";
    case GAME_BOARD_TYPES.WillPutLonelyTileDown: return "isolated";
    case GAME_BOARD_TYPES.HaveNeighboringTileToo: return "extendsIndependentGroup";
    case GAME_BOARD_TYPES.WillFormNewChain: return "foundsChain";
    case GAME_BOARD_TYPES.WillMergeChains: return "mergesChains";
    default: return "unknown";
  }
}

function isRawTilePlayable(typeId: number) {
  return typeId !== GAME_BOARD_TYPES.CantPlayEver && typeId !== GAME_BOARD_TYPES.CantPlayNow;
}

function sharesFromRow(row: readonly number[]): Record<HotelChain, number> {
  return Object.fromEntries(HOTEL_CHAINS.map((chain, index) => [chain, row[index] ?? 0])) as Record<HotelChain, number>;
}

function emptyShares(): Record<HotelChain, number> {
  return Object.fromEntries(HOTEL_CHAINS.map((chain) => [chain, 0])) as Record<HotelChain, number>;
}

function sharePriceHundreds(chainIndex: number, size: number) {
  if (size <= 0) return 0;
  let price = size < 11 ? Math.min(size, 6) : Math.min(Math.floor((size - 1) / 10) + 6, 10);
  if (chainIndex >= 2) price += 1;
  if (chainIndex >= 5) price += 1;
  return price;
}

function computeBonuses(holdings: number[], price: number) {
  const bonuses = holdings.map(() => 0);
  if (holdings.length === 0 || price <= 0) return bonuses;
  const ranked = holdings.map((amount, playerId) => ({ amount, playerId })).sort((left, right) => right.amount - left.amount);
  const first = ranked[0];
  const second = ranked[1];
  if (first === undefined || first.amount === 0) return bonuses;
  const majority = price * 10;
  const minority = majority / 2;
  if (second === undefined || second.amount === 0) {
    bonuses[first.playerId] = majority + minority;
    return bonuses;
  }
  if (first.amount === second.amount) {
    const tied = ranked.filter((entry) => entry.amount === first.amount);
    const split = Math.ceil((majority + minority) / tied.length);
    tied.forEach((entry) => bonuses[entry.playerId] = split);
    return bonuses;
  }
  bonuses[first.playerId] = majority;
  const seconds = ranked.filter((entry, index) => index > 0 && entry.amount === second.amount);
  const split = Math.ceil(minority / seconds.length);
  seconds.forEach((entry) => bonuses[entry.playerId] = split);
  return bonuses;
}

function actionKind(actionId: GameActionId): CurrentGameAction["kind"] {
  switch (actionId) {
    case GAME_ACTIONS.StartGame: return "startGame";
    case GAME_ACTIONS.PlayTile: return "playTile";
    case GAME_ACTIONS.SelectNewChain: return "foundChain";
    case GAME_ACTIONS.SelectMergerSurvivor: return "selectMergeSurvivor";
    case GAME_ACTIONS.SelectChainToDisposeOfNext: return "selectDefunctChain";
    case GAME_ACTIONS.DisposeOfShares: return "disposeShares";
    case GAME_ACTIONS.PurchaseShares: return "buyShares";
    default: return "gameOver";
  }
}

function phaseFromAction(actionId: GameActionId | undefined): GameState["phase"] {
  switch (actionId) {
    case GAME_ACTIONS.SelectNewChain: return "startChain";
    case GAME_ACTIONS.SelectMergerSurvivor:
    case GAME_ACTIONS.SelectChainToDisposeOfNext: return "resolveMerge";
    case GAME_ACTIONS.DisposeOfShares: return "disposeShares";
    case GAME_ACTIONS.PurchaseShares: return "buyShares";
    case GAME_ACTIONS.GameOver: return "gameOver";
    default: return "playTile";
  }
}

function chainIndexesFromArgument(argument: unknown): HotelChain[] {
  if (!Array.isArray(argument)) return [];
  return argument.map((value) => HOTEL_CHAINS[Number(value)]).filter((chain): chain is HotelChain => chain !== undefined);
}

function findLikelyMergeTile(rack: readonly (RawTileRackEntry | null)[]): Tile | null {
  return rack.find((entry) => entry?.typeId === GAME_BOARD_TYPES.WillMergeChains)?.tile ?? null;
}

function canGameEnd(chains: Readonly<Record<HotelChain, SessionChainState>>) {
  const activeSizes = HOTEL_CHAINS.map((chain) => chains[chain].size).filter((size) => size > 0);
  return activeSizes.length > 0 && (Math.min(...activeSizes) >= 11 || Math.max(...activeSizes) >= 41);
}

function validateShareDisposal(request: DisposeSharesDecisionRequest, trade: number, sell: number) {
  if (!Number.isInteger(trade) || trade < 0 || trade % 2 !== 0 || trade > request.maxTrade) {
    throw new GameSessionCommandError("The number of shares to trade is invalid.", "invalidDecision");
  }
  if (!Number.isInteger(sell) || sell < 0 || sell > request.maxSell || trade + sell > request.ownedShares) {
    throw new GameSessionCommandError("The number of shares to sell is invalid.", "invalidDecision");
  }
}

function validateSharePurchase(request: BuySharesDecisionRequest, purchase: SharePurchase, endGame: boolean) {
  if (endGame && !request.canEndGame) {
    throw new GameSessionCommandError("The game cannot be ended yet.", "invalidDecision");
  }
  const cart: number[] = [];
  let cost = 0;
  for (const chain of HOTEL_CHAINS) {
    const amount = purchase[chain] ?? 0;
    const option = request.options.find((entry) => entry.chain === chain);
    if (!Number.isInteger(amount) || amount < 0 || (amount > 0 && option === undefined) || amount > (option?.available ?? 0)) {
      throw new GameSessionCommandError(`The requested ${chain} share quantity is invalid.`, "invalidDecision");
    }
    if (option !== undefined) cost += option.price * amount;
    for (let index = 0; index < amount; index += 1) cart.push(HOTEL_CHAINS.indexOf(chain));
  }
  if (cart.length > request.maxShares || cost > request.gameState.self.cash) {
    throw new GameSessionCommandError("The requested share purchase is not affordable or exceeds the turn limit.", "invalidDecision");
  }
  return cart;
}

function parseHistoryEvent(payload: unknown[], viewerPlayerIndex: number | null): GameEvent {
  const messageId = Number(payload[0]);
  const playerId = String(Number(payload[1]));
  const argument2 = payload[2];
  const argument3 = payload[3];
  const argument4 = payload[4];
  switch (messageId) {
    case GAME_HISTORY_MESSAGES.TurnBegan: return { kind: "turnBegan", playerId };
    case GAME_HISTORY_MESSAGES.DrewPositionTile: return { kind: "positionTileDrawn", playerId, tile: protocolTile(Number(argument2), Number(argument3)) };
    case GAME_HISTORY_MESSAGES.StartedGame: return { kind: "gameStarted", playerId };
    case GAME_HISTORY_MESSAGES.DrewTile:
      return { kind: "tileDrawn", playerId, tile: Number(playerId) === viewerPlayerIndex ? protocolTile(Number(argument2), Number(argument3)) : null };
    case GAME_HISTORY_MESSAGES.HasNoPlayableTile: return { kind: "noPlayableTile", playerId };
    case GAME_HISTORY_MESSAGES.PlayedTile: return { kind: "tilePlayed", playerId, tile: protocolTile(Number(argument2), Number(argument3)) };
    case GAME_HISTORY_MESSAGES.FormedChain: {
      const chain = HOTEL_CHAINS[Number(argument2)];
      return chain === undefined ? unknownHistoryEvent(payload) : { kind: "chainFounded", playerId, chain };
    }
    case GAME_HISTORY_MESSAGES.MergedChains: return { kind: "chainsMerged", playerId, chains: chainIndexesFromArgument(argument2) };
    case GAME_HISTORY_MESSAGES.SelectedMergerSurvivor: {
      const chain = HOTEL_CHAINS[Number(argument2)];
      return chain === undefined ? unknownHistoryEvent(payload) : { kind: "mergeSurvivorSelected", playerId, chain };
    }
    case GAME_HISTORY_MESSAGES.SelectedChainToDisposeOfNext: {
      const chain = HOTEL_CHAINS[Number(argument2)];
      return chain === undefined ? unknownHistoryEvent(payload) : { kind: "defunctChainSelected", playerId, chain };
    }
    case GAME_HISTORY_MESSAGES.ReceivedBonus: {
      const chain = HOTEL_CHAINS[Number(argument2)];
      return chain === undefined ? unknownHistoryEvent(payload) : { kind: "bonusReceived", playerId, chain, amount: Number(argument3) * MONEY_SCALE };
    }
    case GAME_HISTORY_MESSAGES.DisposedOfShares: {
      const chain = HOTEL_CHAINS[Number(argument2)];
      return chain === undefined ? unknownHistoryEvent(payload) : { kind: "sharesDisposed", playerId, chain, traded: Number(argument3), sold: Number(argument4) };
    }
    case GAME_HISTORY_MESSAGES.CouldNotAffordAnyShares: return { kind: "couldNotAffordShares", playerId };
    case GAME_HISTORY_MESSAGES.PurchasedShares: return { kind: "sharesPurchased", playerId, purchase: parsePurchase(argument2) };
    case GAME_HISTORY_MESSAGES.DrewLastTile: return { kind: "lastTileDrawn", playerId };
    case GAME_HISTORY_MESSAGES.ReplacedDeadTile: return { kind: "deadTileReplaced", playerId, tile: protocolTile(Number(argument2), Number(argument3)) };
    case GAME_HISTORY_MESSAGES.EndedGame: return { kind: "gameEnded", playerId };
    case GAME_HISTORY_MESSAGES.NoTilesPlayedForEntireRound: return { kind: "gameForcedToEnd", reason: "noTilesPlayedForRound" };
    case GAME_HISTORY_MESSAGES.AllTilesPlayed: return { kind: "gameForcedToEnd", reason: "allTilesPlayed" };
    default: return unknownHistoryEvent(payload);
  }
}

function unknownHistoryEvent(payload: unknown[]): GameEvent {
  return { kind: "unknown", description: JSON.stringify(payload) };
}

function parsePurchase(value: unknown): SharePurchase {
  const purchase: SharePurchase = {};
  if (!Array.isArray(value)) return purchase;
  for (const entry of value) {
    if (!Array.isArray(entry)) continue;
    const chain = HOTEL_CHAINS[Number(entry[0])];
    if (chain !== undefined) purchase[chain] = Number(entry[1]);
  }
  return purchase;
}
