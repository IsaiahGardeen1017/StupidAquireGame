import type { GameState, HotelChain, SharePurchase, Tile } from "../game/types.js";
import { HOTEL_CHAINS } from "../game/types.js";
import { AcquirePlayer } from "./AcquirePlayer.js";

type RandomSource = () => number;

export class RandomPlayer extends AcquirePlayer {
  public constructor(name = "Random Player", private readonly random: RandomSource = Math.random) {
    super(name);
  }

  public async playTile(_gameState: GameState, validTiles: readonly Tile[], _invalidTilesInHand: readonly Tile[]): Promise<number> {
    return pickRandomIndex(validTiles.length, this.random);
  }

  public async determineChainToStart(_gameState: GameState, validChains: readonly HotelChain[]): Promise<number> {
    return pickRandomIndex(validChains.length, this.random);
  }

  public async buy(gameState: GameState): Promise<SharePurchase> {
    const activeChains = HOTEL_CHAINS.filter((chain) => gameState.chains[chain].isActive);
    const purchase: SharePurchase = {};

    if (activeChains.length === 0) {
      return purchase;
    }

    const totalSharesToBuy = Math.floor(this.random() * 4);
    for (let remaining = totalSharesToBuy; remaining > 0; remaining -= 1) {
      const chain = activeChains[pickRandomIndex(activeChains.length, this.random)];
      if (chain === undefined) {
        throw new Error("Failed to choose an active hotel chain.");
      }

      purchase[chain] = (purchase[chain] ?? 0) + 1;
    }

    return purchase;
  }

  public async determineMergeSurvivor(_gameState: GameState, _mergeTile: Tile, possibleSurvivors: readonly HotelChain[]): Promise<number> {
    return pickRandomIndex(possibleSurvivors.length, this.random);
  }

  public async determineHowManySharesToTradeInAfterMerge(
    _gameState: GameState,
    _survivingChain: HotelChain,
    _mergeChain: HotelChain,
    numTradesAvailable: number
  ): Promise<number> {
    return randomIntInclusive(0, numTradesAvailable, this.random);
  }

  public async determineHowManySharesToSell(
    _gameState: GameState,
    _survivingChain: HotelChain,
    _mergeChain: HotelChain,
    howManyIHave: number
  ): Promise<number> {
    return randomIntInclusive(0, howManyIHave, this.random);
  }
}

function pickRandomIndex(length: number, random: RandomSource): number {
  if (length <= 0) {
    throw new Error("Cannot pick from an empty list.");
  }

  return Math.floor(random() * length);
}

function randomIntInclusive(min: number, max: number, random: RandomSource): number {
  if (max < min) {
    throw new Error("Invalid random range.");
  }

  return min + Math.floor(random() * (max - min + 1));
}
