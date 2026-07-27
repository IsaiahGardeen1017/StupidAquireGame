import type { GameState, HotelChain, PlayerId, SharePurchase, Tile } from "./types.js";

export type GameSessionKind = "online" | "local" | "replay";

export type GameLifecycle = "setup" | "inProgress" | "completed";

export type BoardCellContent =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "independent" }>
  | Readonly<{ kind: "chain"; chain: HotelChain }>;

export type GameBoardCell = Readonly<{
  tile: Tile;
  content: BoardCellContent;
}>;

export type TilePlacementKind =
  | "unplayablePermanently"
  | "unplayableTemporarily"
  | "isolated"
  | "extendsIndependentGroup"
  | "foundsChain"
  | "mergesChains"
  | "extendsChain"
  | "inHand"
  | "independent"
  | "unknown";

export type TileRackEntry = Readonly<{
  slot: number;
  tile: Tile;
  placement: TilePlacementKind;
  chain: HotelChain | null;
}>;

export type SessionPlayerState = Readonly<{
  id: PlayerId;
  name: string;
  isConnected: boolean;
  cash: number;
  netWorth: number;
  shares: Readonly<Record<HotelChain, number>>;
  handSize: number | null;
}>;

export type SessionChainState = Readonly<{
  chain: HotelChain;
  size: number;
  availableShares: number;
  price: number;
  majorityBonus: number;
  minorityBonus: number;
  isActive: boolean;
  isSafe: boolean;
}>;

export type GameActionKind =
  | "startGame"
  | "playTile"
  | "foundChain"
  | "selectMergeSurvivor"
  | "selectDefunctChain"
  | "disposeShares"
  | "buyShares"
  | "gameOver";

export type CurrentGameAction = Readonly<{
  kind: GameActionKind;
  playerId: PlayerId | null;
}>;

type DecisionRequestBase = Readonly<{
  id: string;
  playerId: PlayerId;
  gameState: GameState;
}>;

export type PlayTileDecisionRequest = DecisionRequestBase & Readonly<{
  kind: "playTile";
  playableTiles: readonly Tile[];
  unplayableTiles: readonly Tile[];
}>;

export type SelectChainDecisionPurpose = "foundChain" | "mergeSurvivor" | "defunctChain";

export type SelectChainDecisionRequest = DecisionRequestBase & Readonly<{
  kind: "selectChain";
  purpose: SelectChainDecisionPurpose;
  chains: readonly HotelChain[];
  mergeTile: Tile | null;
}>;

export type DisposeSharesDecisionRequest = DecisionRequestBase & Readonly<{
  kind: "disposeShares";
  survivingChain: HotelChain;
  defunctChain: HotelChain;
  ownedShares: number;
  maxTrade: number;
  maxSell: number;
}>;

export type SharePurchaseOption = Readonly<{
  chain: HotelChain;
  price: number;
  available: number;
}>;

export type BuySharesDecisionRequest = DecisionRequestBase & Readonly<{
  kind: "buyShares";
  options: readonly SharePurchaseOption[];
  maxShares: number;
  canEndGame: boolean;
}>;

export type GameDecisionRequest =
  | PlayTileDecisionRequest
  | SelectChainDecisionRequest
  | DisposeSharesDecisionRequest
  | BuySharesDecisionRequest;

export type GameDecision =
  | Readonly<{ kind: "playTile"; tile: Tile }>
  | Readonly<{ kind: "selectChain"; chain: HotelChain }>
  | Readonly<{ kind: "disposeShares"; trade: number; sell: number }>
  | Readonly<{ kind: "buyShares"; purchase: SharePurchase; endGame: boolean }>;

export type FinalStanding = Readonly<{
  rank: number;
  playerId: PlayerId;
  score: number;
}>;

export type GameEvent =
  | Readonly<{ kind: "turnBegan"; playerId: PlayerId }>
  | Readonly<{ kind: "positionTileDrawn"; playerId: PlayerId; tile: Tile }>
  | Readonly<{ kind: "gameStarted"; playerId: PlayerId }>
  | Readonly<{ kind: "tileDrawn"; playerId: PlayerId; tile: Tile | null }>
  | Readonly<{ kind: "noPlayableTile"; playerId: PlayerId }>
  | Readonly<{ kind: "tilePlayed"; playerId: PlayerId; tile: Tile }>
  | Readonly<{ kind: "chainFounded"; playerId: PlayerId; chain: HotelChain }>
  | Readonly<{ kind: "chainsMerged"; playerId: PlayerId; chains: readonly HotelChain[] }>
  | Readonly<{ kind: "mergeSurvivorSelected"; playerId: PlayerId; chain: HotelChain }>
  | Readonly<{ kind: "defunctChainSelected"; playerId: PlayerId; chain: HotelChain }>
  | Readonly<{ kind: "bonusReceived"; playerId: PlayerId; chain: HotelChain; amount: number }>
  | Readonly<{
      kind: "sharesDisposed";
      playerId: PlayerId;
      chain: HotelChain;
      traded: number;
      sold: number;
    }>
  | Readonly<{ kind: "couldNotAffordShares"; playerId: PlayerId }>
  | Readonly<{ kind: "sharesPurchased"; playerId: PlayerId; purchase: SharePurchase }>
  | Readonly<{ kind: "lastTileDrawn"; playerId: PlayerId }>
  | Readonly<{ kind: "deadTileReplaced"; playerId: PlayerId; tile: Tile }>
  | Readonly<{ kind: "gameEnded"; playerId: PlayerId }>
  | Readonly<{ kind: "gameForcedToEnd"; reason: "noTilesPlayedForRound" | "allTilesPlayed" }>
  | Readonly<{ kind: "finalStandings"; standings: readonly FinalStanding[] }>
  | Readonly<{ kind: "unknown"; description: string }>;

export type GameHistoryEntry = Readonly<{
  id: string;
  event: GameEvent;
}>;

export type GameChatMessage = Readonly<{
  id: string;
  senderId: string;
  senderName: string;
  message: string;
}>;

export type ReplayPosition = Readonly<{
  index: number;
  length: number;
  isPlaying: boolean;
}>;

export type GameSessionCapabilities = Readonly<{
  canSubmitDecisions: boolean;
  canStartGame: boolean;
  canSendChat: boolean;
  canLeave: boolean;
  canNavigateReplay: boolean;
}>;

export type GameSessionSnapshot = Readonly<{
  revision: number;
  gameId: string;
  kind: GameSessionKind;
  lifecycle: GameLifecycle;
  viewerPlayerId: PlayerId | null;
  activePlayerId: PlayerId | null;
  currentAction: CurrentGameAction | null;
  pendingDecision: GameDecisionRequest | null;
  board: readonly GameBoardCell[];
  tileRack: readonly (TileRackEntry | null)[];
  players: readonly SessionPlayerState[];
  chains: Readonly<Record<HotelChain, SessionChainState>>;
  tilesRemaining: number | null;
  history: readonly GameHistoryEntry[];
  chat: readonly GameChatMessage[];
  replay: ReplayPosition | null;
  capabilities: GameSessionCapabilities;
}>;

export type GameSessionCommand =
  | Readonly<{ kind: "submitDecision"; requestId: string; decision: GameDecision }>
  | Readonly<{ kind: "startGame" }>
  | Readonly<{ kind: "sendChat"; message: string }>
  | Readonly<{ kind: "leave" }>
  | Readonly<{ kind: "replayFirst" }>
  | Readonly<{ kind: "replayPrevious" }>
  | Readonly<{ kind: "replayNext" }>
  | Readonly<{ kind: "replayLast" }>
  | Readonly<{ kind: "replayPlay" }>
  | Readonly<{ kind: "replayPause" }>
  | Readonly<{ kind: "replaySeek"; index: number }>;

export type GameSessionListener = (snapshot: GameSessionSnapshot) => void;

export interface GameSession {
  readonly kind: GameSessionKind;
  getSnapshot(): GameSessionSnapshot;
  subscribe(listener: GameSessionListener): () => void;
  execute(command: GameSessionCommand): Promise<void>;
  dispose(): void;
}

export class GameSessionCommandError extends Error {
  public constructor(
    message: string,
    public readonly code: "unsupported" | "staleDecision" | "invalidDecision" | "disposed"
  ) {
    super(message);
    this.name = "GameSessionCommandError";
  }
}

export function tilesEqual(left: Tile, right: Tile) {
  return left.row === right.row && left.column === right.column;
}
