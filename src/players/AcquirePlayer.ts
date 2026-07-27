import type { GameState, HotelChain, SharePurchaseDecision, Tile } from "../game/types.js";

export abstract class AcquirePlayer {
  public constructor(public readonly name: string) {}

  abstract playTile(gameState: GameState, validTiles: readonly Tile[], invalidTilesInHand: readonly Tile[]): Promise<number>;

  abstract determineChainToStart(gameState: GameState, validChains: readonly HotelChain[]): Promise<number>;

  abstract buy(gameState: GameState): Promise<SharePurchaseDecision>;

  abstract determineMergeSurvivor(gameState: GameState, mergeTile: Tile, possibleSurvivors: readonly HotelChain[]): Promise<number>;

  public determineChainToDisposeOfNext(
    gameState: GameState,
    mergeTile: Tile,
    _survivingChain: HotelChain,
    possibleDefunctChains: readonly HotelChain[]
  ): Promise<number> {
    return this.determineMergeSurvivor(gameState, mergeTile, possibleDefunctChains);
  }

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
