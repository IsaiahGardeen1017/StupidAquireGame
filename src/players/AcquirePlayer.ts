import type { GameState, HotelChain, SharePurchaseDecision, Tile } from "../game/types.js";

export type MaybePromise<T> = T | Promise<T>;

export abstract class AcquirePlayer {
  public constructor(public readonly name: string) {}

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
