import { HOTEL_CHAINS, type HotelChain, type PlayerId, type Tile } from "./types.js";

export const BOARD_ROWS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"] as const;
export const BOARD_COLUMNS = 12;
export const TILE_COUNT = BOARD_ROWS.length * BOARD_COLUMNS;
export const RACK_SIZE = 6;
export const STARTING_CASH = 6_000;
export const SHARES_PER_CHAIN = 25;
export const MAX_SHARES_PER_TURN = 3;
export const SAFE_CHAIN_SIZE = 11;
export const DOMINANT_CHAIN_SIZE = 41;

export type BonusPayout = Readonly<{
  playerId: PlayerId;
  amount: number;
}>;

export function createAllTiles(): Tile[] {
  return Array.from({ length: BOARD_COLUMNS }, (_, columnIndex) =>
    BOARD_ROWS.map((row) => ({ row, column: columnIndex + 1 })))
    .flat();
}

export function sharePrice(chain: HotelChain, size: number): number {
  if (!Number.isInteger(size) || size <= 0) return 0;

  let priceHundreds = size < 11
    ? Math.min(size, 6)
    : Math.min(Math.floor((size - 1) / 10) + 6, 10);
  const chainIndex = HOTEL_CHAINS.indexOf(chain);
  if (chainIndex >= HOTEL_CHAINS.indexOf("American")) priceHundreds += 1;
  if (chainIndex >= HOTEL_CHAINS.indexOf("Continental")) priceHundreds += 1;
  return priceHundreds * 100;
}

export function majorityBonus(chain: HotelChain, size: number): number {
  return sharePrice(chain, size) * 10;
}

export function minorityBonus(chain: HotelChain, size: number): number {
  return sharePrice(chain, size) * 5;
}

export function calculateBonusPayouts(
  holdings: readonly Readonly<{ playerId: PlayerId; shares: number }>[],
  chain: HotelChain,
  size: number
): BonusPayout[] {
  const eligible = holdings
    .filter((holding) => holding.shares > 0)
    .sort((left, right) => right.shares - left.shares);
  if (eligible.length === 0) return [];

  const majority = majorityBonus(chain, size);
  const minority = minorityBonus(chain, size);
  const leaders = eligible.filter((holding) => holding.shares === eligible[0]?.shares);
  if (leaders.length > 1) {
    const amount = roundBonusUp((majority + minority) / leaders.length);
    return leaders.map(({ playerId }) => ({ playerId, amount }));
  }

  const leader = leaders[0];
  if (leader === undefined) return [];
  if (eligible.length === 1) {
    return [{ playerId: leader.playerId, amount: majority + minority }];
  }

  const runnerUpShares = eligible[1]?.shares;
  const runnersUp = eligible.filter((holding) => holding.shares === runnerUpShares);
  const minorityAmount = roundBonusUp(minority / runnersUp.length);
  return [
    { playerId: leader.playerId, amount: majority },
    ...runnersUp.map(({ playerId }) => ({ playerId, amount: minorityAmount }))
  ];
}

export function canEndGame(chainSizes: Readonly<Record<HotelChain, number>>): boolean {
  const activeSizes = HOTEL_CHAINS.map((chain) => chainSizes[chain]).filter((size) => size > 0);
  return activeSizes.length > 0
    && (Math.min(...activeSizes) >= SAFE_CHAIN_SIZE || Math.max(...activeSizes) >= DOMINANT_CHAIN_SIZE);
}

export function isTile(value: unknown): value is Tile {
  if (typeof value !== "object" || value === null) return false;
  const tile = value as Partial<Tile>;
  return typeof tile.row === "string"
    && (BOARD_ROWS as readonly string[]).includes(tile.row)
    && Number.isInteger(tile.column)
    && (tile.column ?? 0) >= 1
    && (tile.column ?? 0) <= BOARD_COLUMNS;
}

export function tileKey(tile: Tile): string {
  return `${tile.column}:${tile.row}`;
}

export function compareTiles(left: Tile, right: Tile): number {
  const columnDifference = left.column - right.column;
  if (columnDifference !== 0) return columnDifference;
  return BOARD_ROWS.indexOf(left.row as (typeof BOARD_ROWS)[number])
    - BOARD_ROWS.indexOf(right.row as (typeof BOARD_ROWS)[number]);
}

export function adjacentTiles(tile: Tile): Tile[] {
  const rowIndex = BOARD_ROWS.indexOf(tile.row as (typeof BOARD_ROWS)[number]);
  const candidates: Tile[] = [
    { row: tile.row, column: tile.column - 1 },
    { row: tile.row, column: tile.column + 1 }
  ];
  const rowAbove = BOARD_ROWS[rowIndex - 1];
  const rowBelow = BOARD_ROWS[rowIndex + 1];
  if (rowAbove !== undefined) candidates.push({ row: rowAbove, column: tile.column });
  if (rowBelow !== undefined) candidates.push({ row: rowBelow, column: tile.column });
  return candidates.filter(isTile);
}

function roundBonusUp(amount: number): number {
  return Math.ceil(amount / 100) * 100;
}
