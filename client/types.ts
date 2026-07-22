import type { GameState, HotelChain, Tile } from "../src/index.js";
import type { GameActionId, GameModeId, GameStateId } from "./protocol.js";

export type ConnectionStatus = "loading" | "welcome" | "login" | "connecting" | "lobby" | "game";

export type ClientInfo = {
  clientId: number;
  username: string;
  ipAddress: string;
};

export type PlayerSeat = {
  username: string;
  clientId: number | null;
};

export type LobbyGame = {
  gameId: number;
  stateId: GameStateId;
  modeId: GameModeId;
  maxPlayers: number;
  score: number | null;
  players: PlayerSeat[];
  watcherClientIds: number[];
};

export type BoardCellView = {
  x: number;
  y: number;
  typeId: number;
};

export type ScoreSheet = number[][];

export type TileRackEntry = {
  tile: Tile;
  typeId: number;
};

export type PendingDecision =
  | { kind: "playTile"; validTiles: readonly Tile[]; invalidTilesInHand: readonly Tile[] }
  | { kind: "selectChain"; validChains: readonly HotelChain[]; actionId: GameActionId }
  | { kind: "disposeShares"; survivingChain: HotelChain; mergeChain: HotelChain; maxTrade: number; maxSell: number }
  | { kind: "buyShares"; availableChains: readonly HotelChain[]; canEndGame: boolean };

export type LiveGameView = {
  gameId: number | null;
  playerId: number | null;
  board: BoardCellView[];
  tileRack: Array<TileRackEntry | null>;
  scoreSheet: ScoreSheet;
  turnPlayerId: number | null;
  currentAction: { actionId: GameActionId; playerId: number | null; argument?: unknown } | null;
  pendingDecision: PendingDecision | null;
  history: string[];
  chat: string[];
};

export type AppState = {
  connectionStatus: ConnectionStatus;
  errorMessage: string | null;
  selfClientId: number | null;
  selfUsername: string | null;
  lobbyCollapsed: boolean;
  clients: Record<number, ClientInfo>;
  lobbyClientIds: number[];
  games: Record<number, LobbyGame>;
  globalChat: string[];
  liveGame: LiveGameView;
  selectedGameId: number | null;
  enteringGameId: number | null;
};

export type DecisionContext = {
  gameState: GameState;
  actionId: GameActionId;
};
