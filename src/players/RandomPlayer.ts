import type { GameState, HotelChain, SharePurchase, SharePurchaseDecision, Tile } from "../game/types.js";
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

  public async buy(gameState: GameState): Promise<SharePurchaseDecision> {
    const purchase: SharePurchase = {};
    let cashRemaining = gameState.self.cash;
    const totalSharesToBuy = Math.floor(this.random() * 4);
    for (let remaining = totalSharesToBuy; remaining > 0; remaining -= 1) {
      const legalChains = HOTEL_CHAINS.filter((chain) => {
        const chainState = gameState.chains[chain];
        return chainState.isActive
          && (purchase[chain] ?? 0) < chainState.availableShares
          && chainState.price <= cashRemaining;
      });
      if (legalChains.length === 0) {
        break;
      }

      const chain = legalChains[pickRandomIndex(legalChains.length, this.random)];
      if (chain === undefined) throw new Error("Failed to choose an affordable hotel chain.");
      purchase[chain] = (purchase[chain] ?? 0) + 1;
      cashRemaining -= gameState.chains[chain].price;
    }

    return { purchase, endGame: gameState.canEndGame && this.random() < 0.5 };
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
    return randomIntInclusive(0, Math.floor(numTradesAvailable / 2), this.random) * 2;
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
