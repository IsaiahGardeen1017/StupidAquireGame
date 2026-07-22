import type { GameState, HotelChain } from "../src/index.js";
import { SCORE_SHEET_ROWS } from "./protocol.js";
import type { LobbyGame } from "./types.js";
import type { AppState, LiveGameView, PlayerSeat } from "./types.js";

const PLAYER_ROW_COUNT = 6;
const SCORE_SHEET_WIDTH = 9;
const BOARD_WIDTH = 12;
const BOARD_HEIGHT = 9;
const TILE_RACK_SIZE = 6;

function createEmptyScoreSheet(): number[][] {
  return Array.from({ length: SCORE_SHEET_ROWS.Price + 1 }, (_, rowIndex) => {
    if (rowIndex < PLAYER_ROW_COUNT) {
      return [0, 0, 0, 0, 0, 0, 0, 60, 60];
    }

    if (rowIndex === SCORE_SHEET_ROWS.Available) {
      return [25, 25, 25, 25, 25, 25, 25, 0, 0];
    }

    return Array.from({ length: SCORE_SHEET_WIDTH }, () => 0);
  });
}

function createEmptyPlayers(): PlayerSeat[] {
  return [];
}

function createEmptyLiveGame(): LiveGameView {
  return {
    gameId: null,
    playerId: null,
    board: Array.from({ length: BOARD_WIDTH * BOARD_HEIGHT }, (_, index) => ({
      x: index % BOARD_WIDTH,
      y: Math.floor(index / BOARD_WIDTH),
      typeId: 7
    })),
    tileRack: Array.from({ length: TILE_RACK_SIZE }, () => null),
    scoreSheet: createEmptyScoreSheet(),
    turnPlayerId: null,
    currentAction: null,
    pendingDecision: null,
    history: [],
    chat: []
  };
}

export function createInitialState(): AppState {
  return {
    connectionStatus: "welcome",
    errorMessage: null,
    selfClientId: null,
    selfUsername: null,
    lobbyCollapsed: false,
    clients: {},
    lobbyClientIds: [],
    games: {},
    globalChat: [],
    liveGame: createEmptyLiveGame(),
    selectedGameId: null,
    enteringGameId: null
  };
}

export function createLobbyGame(gameId: number, stateId: number, modeId: number, maxPlayers: number, score: number | null): LobbyGame {
  return {
    gameId,
    stateId: stateId as 0 | 1 | 2 | 3,
    modeId: modeId as 0 | 1,
    maxPlayers,
    score,
    players: createEmptyPlayers(),
    watcherClientIds: []
  };
}

export function resetLiveGame(state: AppState) {
  state.liveGame = createEmptyLiveGame();
}

const CHAIN_NAMES: readonly HotelChain[] = ["Luxor", "Tower", "American", "Festival", "Worldwide", "Continental", "Imperial"];

export function createViewGameState(state: AppState): GameState {
  const playerId = state.liveGame.playerId ?? 0;
  const selfSeat = state.liveGame.gameId === null ? null : state.games[state.liveGame.gameId]?.players[playerId] ?? null;
  const selfSharesRow = state.liveGame.scoreSheet[playerId] ?? [];
  const selfCash = (selfSharesRow[7] ?? 0) * 100;

  const selfTiles = state.liveGame.tileRack.filter((entry): entry is NonNullable<typeof entry> => entry !== null).map((entry) => entry.tile);
  const validTiles = state.liveGame.tileRack
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry.typeId !== 9 && entry.typeId !== 15)
    .map((entry) => entry.tile);
  const invalidTiles = state.liveGame.tileRack
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null && (entry.typeId === 9 || entry.typeId === 15))
    .map((entry) => entry.tile);

  return {
    turnNumber: Math.max(state.liveGame.history.length, 1),
    activePlayerId: String(state.liveGame.turnPlayerId ?? 0),
    phase: "playTile" as const,
    board: state.liveGame.board.map((cell) => ({
      tile: { row: String.fromCharCode(65 + cell.y), column: cell.x + 1 },
      chain: CHAIN_NAMES[cell.typeId] ?? null
    })),
    players: Object.entries(state.games[state.liveGame.gameId ?? -1]?.players ?? {}).map(([id, seat], index) => ({
      id,
      name: seat.username,
      cash: ((state.liveGame.scoreSheet[index]?.[7] ?? 0) * 100),
      shares: {
        Luxor: state.liveGame.scoreSheet[index]?.[0] ?? 0,
        Tower: state.liveGame.scoreSheet[index]?.[1] ?? 0,
        American: state.liveGame.scoreSheet[index]?.[2] ?? 0,
        Festival: state.liveGame.scoreSheet[index]?.[3] ?? 0,
        Worldwide: state.liveGame.scoreSheet[index]?.[4] ?? 0,
        Continental: state.liveGame.scoreSheet[index]?.[5] ?? 0,
        Imperial: state.liveGame.scoreSheet[index]?.[6] ?? 0
      },
      handSize: selfTiles.length
    })),
    self: {
      id: String(playerId),
      name: selfSeat?.username ?? "You",
      cash: selfCash,
      shares: {
        Luxor: selfSharesRow[0] ?? 0,
        Tower: selfSharesRow[1] ?? 0,
        American: selfSharesRow[2] ?? 0,
        Festival: selfSharesRow[3] ?? 0,
        Worldwide: selfSharesRow[4] ?? 0,
        Continental: selfSharesRow[5] ?? 0,
        Imperial: selfSharesRow[6] ?? 0
      },
      handSize: selfTiles.length,
      tilesInHand: selfTiles,
      validTiles,
      invalidTiles
    },
    chains: {
      Luxor: { chain: "Luxor", size: state.liveGame.scoreSheet[7]?.[0] ?? 0, availableShares: state.liveGame.scoreSheet[6]?.[0] ?? 0, isActive: (state.liveGame.scoreSheet[7]?.[0] ?? 0) > 0 },
      Tower: { chain: "Tower", size: state.liveGame.scoreSheet[7]?.[1] ?? 0, availableShares: state.liveGame.scoreSheet[6]?.[1] ?? 0, isActive: (state.liveGame.scoreSheet[7]?.[1] ?? 0) > 0 },
      American: { chain: "American", size: state.liveGame.scoreSheet[7]?.[2] ?? 0, availableShares: state.liveGame.scoreSheet[6]?.[2] ?? 0, isActive: (state.liveGame.scoreSheet[7]?.[2] ?? 0) > 0 },
      Festival: { chain: "Festival", size: state.liveGame.scoreSheet[7]?.[3] ?? 0, availableShares: state.liveGame.scoreSheet[6]?.[3] ?? 0, isActive: (state.liveGame.scoreSheet[7]?.[3] ?? 0) > 0 },
      Worldwide: { chain: "Worldwide", size: state.liveGame.scoreSheet[7]?.[4] ?? 0, availableShares: state.liveGame.scoreSheet[6]?.[4] ?? 0, isActive: (state.liveGame.scoreSheet[7]?.[4] ?? 0) > 0 },
      Continental: { chain: "Continental", size: state.liveGame.scoreSheet[7]?.[5] ?? 0, availableShares: state.liveGame.scoreSheet[6]?.[5] ?? 0, isActive: (state.liveGame.scoreSheet[7]?.[5] ?? 0) > 0 },
      Imperial: { chain: "Imperial", size: state.liveGame.scoreSheet[7]?.[6] ?? 0, availableShares: state.liveGame.scoreSheet[6]?.[6] ?? 0, isActive: (state.liveGame.scoreSheet[7]?.[6] ?? 0) > 0 }
    },
    tilesRemaining: 0
  };
}
