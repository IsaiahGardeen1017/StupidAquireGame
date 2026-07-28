export const HOTEL_CHAINS = [
  "Luxor",
  "Tower",
  "American",
  "Festival",
  "Worldwide",
  "Continental",
  "Imperial"
] as const;

export type HotelChain = (typeof HOTEL_CHAINS)[number];

export type Tile = Readonly<{
  row: string;
  column: number;
}>;

export type PlayerId = string;

export type BoardCell =
  | Readonly<{ tile: Tile; kind: "independent" }>
  | Readonly<{ tile: Tile; kind: "dead" }>
  | Readonly<{ tile: Tile; kind: "chain"; chain: HotelChain }>;

export type PlayerPublicState = Readonly<{
  id: PlayerId;
  name: string;
  cash: number;
  shares: Readonly<Record<HotelChain, number>>;
  handSize: number | null;
}>;

export type PlayerPrivateState = Readonly<PlayerPublicState & {
  tilesInHand: readonly Tile[];
  validTiles: readonly Tile[];
  invalidTiles: readonly Tile[];
}>;

export type ChainState = Readonly<{
  chain: HotelChain;
  size: number;
  availableShares: number;
  price: number;
  majorityBonus: number;
  minorityBonus: number;
  isActive: boolean;
  isSafe: boolean;
}>;

export type TurnPhase =
  | "playTile"
  | "startChain"
  | "resolveMerge"
  | "disposeShares"
  | "buyShares"
  | "gameOver";

export type GameState = Readonly<{
  turnNumber: number;
  activePlayerId: PlayerId | null;
  phase: TurnPhase;
  board: readonly BoardCell[];
  players: readonly PlayerPublicState[];
  self: PlayerPrivateState;
  chains: Readonly<Record<HotelChain, ChainState>>;
  tilesRemaining: number | null;
  canEndGame: boolean;
}>;

export type SharePurchase = Partial<Record<HotelChain, number>>;

export type SharePurchaseDecision = Readonly<{
  purchase: SharePurchase;
  endGame: boolean;
}>;
