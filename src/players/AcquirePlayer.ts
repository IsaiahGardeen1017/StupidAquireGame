import type { GameState, HotelChain, SharePurchaseDecision, Tile } from "../game/types.js";

export type MaybePromise<T> = T | Promise<T>;

export abstract class AcquirePlayer {
  private randomState: number;

  public constructor(
    public readonly name: string,
    public readonly seed: number = Math.floor(Math.random() * 0x1_0000_0000)
  ) {
    if (!Number.isFinite(seed)) {
      throw new RangeError("The player random seed must be a finite number.");
    }
    this.randomState = Math.trunc(seed) >>> 0;
  }

  /** Returns a deterministic random integer in the inclusive range [min, max]. */
  public randInt(min = 0, max = 0xffff_ffff): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      throw new RangeError("The random integer range must contain safe integers with max >= min.");
    }

    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
    let value = this.randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const randomFraction = ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
    return min + Math.floor(randomFraction * (max - min + 1));
  }

  abstract playTile(gameState: GameState, validTiles: readonly Tile[], invalidTilesInHand: readonly Tile[]): MaybePromise<number>;

  abstract determineChainToStart(gameState: GameState, validChains: readonly HotelChain[]): MaybePromise<number>;

  abstract buy(gameState: GameState): MaybePromise<SharePurchaseDecision>;

  abstract determineMergeSurvivor(gameState: GameState, mergeTile: Tile, possibleSurvivors: readonly HotelChain[]): MaybePromise<number>;

  public determineChainToDisposeOfNext(
    gameState: GameState,
    mergeTile: Tile,
    _survivingChain: HotelChain,
    possibleDefunctChains: readonly HotelChain[]
  ): MaybePromise<number> {
    return this.determineMergeSurvivor(gameState, mergeTile, possibleDefunctChains);
  }

  abstract determineHowManySharesToTradeInAfterMerge(
    gameState: GameState,
    survivingChain: HotelChain,
    mergeChain: HotelChain,
    numTradesAvailable: number
  ): MaybePromise<number>;

  abstract determineHowManySharesToSell(
    gameState: GameState,
    survivingChain: HotelChain,
    mergeChain: HotelChain,
    howManyIHave: number
  ): MaybePromise<number>;
}
