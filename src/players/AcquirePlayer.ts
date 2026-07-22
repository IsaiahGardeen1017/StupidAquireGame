import type { GameState, HotelChain, SharePurchase, Tile } from "../game/types.js";

export abstract class AcquirePlayer {
  public constructor(public readonly name: string) {}

  abstract playTile(gameState: GameState, validTiles: readonly Tile[], invalidTilesInHand: readonly Tile[]): Promise<number>;

  abstract determineChainToStart(gameState: GameState, validChains: readonly HotelChain[]): Promise<number>;

  abstract buy(gameState: GameState): Promise<SharePurchase>;

  abstract determineMergeSurvivor(gameState: GameState, mergeTile: Tile, possibleSurvivors: readonly HotelChain[]): Promise<number>;

  abstract determineHowManySharesToTradeInAfterMerge(
    gameState: GameState,
    survivingChain: HotelChain,
    mergeChain: HotelChain,
    numTradesAvailable: number
  ): Promise<number>;

  abstract determineHowManySharesToSell(
    gameState: GameState,
    survivingChain: HotelChain,
    mergeChain: HotelChain,
    howManyIHave: number
  ): Promise<number>;
}
