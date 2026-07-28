import {
  HOTEL_CHAINS,
  type GameState,
  type HotelChain,
  type SharePurchase,
  type SharePurchaseDecision,
  type Tile
} from "../game/types.js";
import {
  adjacentTiles,
  calculateBonusPayouts,
  majorityBonus,
  minorityBonus,
  sharePrice,
  tileKey
} from "../game/rules.js";
import { AcquirePlayer } from "./AcquirePlayer.js";

/**
 * A deliberately small, deterministic heuristic player.
 *
 * It does not search future turns. It simply values founding hotels, growing
 * companies it owns, profitable mergers, majority bonuses, and never leaves
 * defunct stock stranded without a reason.
 */
export class CodexSimpleAttempt extends AcquirePlayer {
  public constructor(name = "Codex Simple", seed?: number) {
    super(name, seed);
  }

  public async playTile(
    gameState: GameState,
    validTiles: readonly Tile[],
    _invalidTilesInHand: readonly Tile[]
  ): Promise<number> {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const [index, tile] of validTiles.entries()) {
      const value = evaluateTile(gameState, tile);
      if (value > bestValue) {
        bestIndex = index;
        bestValue = value;
      }
    }
    return bestIndex;
  }

  public async determineChainToStart(gameState: GameState, validChains: readonly HotelChain[]): Promise<number> {
    return indexOfMaximum(validChains, (chain) => {
      const newChainPrice = sharePrice(chain, 2);
      const existingShares = gameState.self.shares[chain];
      const founderShareValue = gameState.chains[chain].availableShares > 0 ? newChainPrice : 0;
      return existingShares * newChainPrice * 4 + founderShareValue + newChainPrice;
    });
  }

  public async buy(gameState: GameState): Promise<SharePurchaseDecision> {
    const purchase: SharePurchase = {};
    const projectedShares = { ...gameState.self.shares };
    const projectedAvailable = Object.fromEntries(
      HOTEL_CHAINS.map((chain) => [chain, gameState.chains[chain].availableShares])
    ) as Record<HotelChain, number>;
    let projectedCash = gameState.self.cash;

    for (let count = 0; count < 3; count += 1) {
      const affordable = HOTEL_CHAINS.filter((chain) => {
        const company = gameState.chains[chain];
        return company.isActive && projectedAvailable[chain] > 0 && company.price <= projectedCash;
      });
      if (affordable.length === 0) break;

      const chainIndex = indexOfMaximum(affordable, (chain) =>
        evaluateSharePurchase(gameState, chain, projectedShares));
      const chain = affordable[chainIndex];
      if (chain === undefined) break;
      purchase[chain] = (purchase[chain] ?? 0) + 1;
      projectedShares[chain] += 1;
      projectedAvailable[chain] -= 1;
      projectedCash -= gameState.chains[chain].price;
    }

    return {
      purchase,
      endGame: gameState.canEndGame && isProjectedLeader(gameState, projectedCash, projectedShares)
    };
  }

  public async determineMergeSurvivor(
    gameState: GameState,
    _mergeTile: Tile,
    possibleSurvivors: readonly HotelChain[]
  ): Promise<number> {
    return indexOfMaximum(possibleSurvivors, (chain) => {
      const company = gameState.chains[chain];
      const ownShares = gameState.self.shares[chain];
      const opponentsBest = Math.max(0, ...gameState.players
        .filter((player) => player.id !== gameState.self.id)
        .map((player) => player.shares[chain]));
      const controlValue = ownShares >= opponentsBest ? 1_000 : 0;
      return ownShares * company.price * 4 + controlValue + company.price;
    });
  }

  public override async determineChainToDisposeOfNext(
    gameState: GameState,
    _mergeTile: Tile,
    _survivingChain: HotelChain,
    possibleDefunctChains: readonly HotelChain[]
  ): Promise<number> {
    return indexOfMaximum(possibleDefunctChains, (chain) =>
      gameState.self.shares[chain] * gameState.chains[chain].price);
  }

  public async determineHowManySharesToTradeInAfterMerge(
    gameState: GameState,
    survivingChain: HotelChain,
    mergeChain: HotelChain,
    numTradesAvailable: number
  ): Promise<number> {
    const survivorPrice = gameState.chains[survivingChain].price;
    const defunctPrice = gameState.chains[mergeChain].price;
    const ownSurvivorShares = gameState.self.shares[survivingChain];
    const leadingOpponentShares = Math.max(0, ...gameState.players
      .filter((player) => player.id !== gameState.self.id)
      .map((player) => player.shares[survivingChain]));
    const sharesNeededToTie = Math.max(0, leadingOpponentShares - ownSurvivorShares);
    const strategicTrade = Math.min(numTradesAvailable, sharesNeededToTie * 2);

    if (survivorPrice >= defunctPrice * 2) return numTradesAvailable;
    return strategicTrade - (strategicTrade % 2);
  }

  public async determineHowManySharesToSell(
    _gameState: GameState,
    _survivingChain: HotelChain,
    _mergeChain: HotelChain,
    howManyIHave: number
  ): Promise<number> {
    return howManyIHave;
  }
}

function evaluateTile(gameState: GameState, tile: Tile): number {
  const boardByTile = new Map(gameState.board.map((cell) => [tileKey(cell.tile), cell]));
  const neighboringCells = adjacentTiles(tile)
    .map((neighbor) => boardByTile.get(tileKey(neighbor)))
    .filter((cell) => cell !== undefined);
  const neighboringChains = HOTEL_CHAINS.filter((chain) =>
    neighboringCells.some((cell) => cell.kind === "chain" && cell.chain === chain));
  const hasIndependentNeighbor = neighboringCells.some((cell) => cell.kind === "independent");

  if (neighboringChains.length === 0) {
    if (!hasIndependentNeighbor) return 100;
    const inactiveChains = HOTEL_CHAINS.filter((chain) => !gameState.chains[chain].isActive);
    const bestChainIndex = indexOfMaximum(inactiveChains, (chain) => sharePrice(chain, 2));
    const bestChain = inactiveChains[bestChainIndex];
    if (bestChain === undefined) return 100;
    const price = sharePrice(bestChain, 2);
    return price + (majorityBonus(bestChain, 2) + minorityBonus(bestChain, 2)) * 0.35;
  }

  if (neighboringChains.length === 1) {
    const chain = neighboringChains[0];
    if (chain === undefined) return 0;
    const company = gameState.chains[chain];
    const newSize = company.size + 1;
    const priceGrowth = sharePrice(chain, newSize) - company.price;
    const ownShares = gameState.self.shares[chain];
    const currentBonus = bonusFor(gameState, chain, company.size, gameState.self.id);
    const largerBonus = bonusFor(gameState, chain, newSize, gameState.self.id);
    const safetyBonus = !company.isSafe && newSize >= 11 ? 1_000 : 0;
    return 500 + ownShares * priceGrowth + (largerBonus - currentBonus) + ownShares * 75 + safetyBonus;
  }

  return evaluateMerger(gameState, neighboringChains);
}

function evaluateMerger(gameState: GameState, involvedChains: readonly HotelChain[]): number {
  const largestSize = Math.max(...involvedChains.map((chain) => gameState.chains[chain].size));
  const possibleSurvivors = involvedChains.filter((chain) => gameState.chains[chain].size === largestSize);
  const survivorIndex = indexOfMaximum(possibleSurvivors, (chain) =>
    gameState.self.shares[chain] * gameState.chains[chain].price);
  const survivor = possibleSurvivors[survivorIndex];
  if (survivor === undefined) return 0;

  const defunctChains = involvedChains.filter((chain) => chain !== survivor);
  const combinedSize = involvedChains.reduce((total, chain) => total + gameState.chains[chain].size, 1);
  const survivorGrowth = gameState.self.shares[survivor]
    * (sharePrice(survivor, combinedSize) - gameState.chains[survivor].price);
  let relativeBonus = 0;
  for (const chain of defunctChains) {
    const payouts = bonusPayouts(gameState, chain, gameState.chains[chain].size);
    const ownBonus = payouts.get(gameState.self.id) ?? 0;
    const bestOpponentBonus = Math.max(0, ...gameState.players
      .filter((player) => player.id !== gameState.self.id)
      .map((player) => payouts.get(player.id) ?? 0));
    relativeBonus += ownBonus - bestOpponentBonus * 0.6;
  }
  return 750 + survivorGrowth + relativeBonus;
}

function evaluateSharePurchase(
  gameState: GameState,
  chain: HotelChain,
  projectedShares: Readonly<Record<HotelChain, number>>
): number {
  const before = bonusPayoutsWithSelfShares(gameState, chain, projectedShares[chain]).get(gameState.self.id) ?? 0;
  const after = bonusPayoutsWithSelfShares(gameState, chain, projectedShares[chain] + 1).get(gameState.self.id) ?? 0;
  const ownSharesAfterPurchase = projectedShares[chain] + 1;
  const company = gameState.chains[chain];
  return (after - before) * 5
    + ownSharesAfterPurchase * 125
    + (company.isSafe ? 400 : 0)
    + Math.min(company.size, 20) * 10;
}

function isProjectedLeader(
  gameState: GameState,
  projectedCash: number,
  projectedShares: Readonly<Record<HotelChain, number>>
): boolean {
  const selfScore = estimateScore(gameState, gameState.self.id, projectedCash, projectedShares);
  const bestOpponentScore = Math.max(...gameState.players
    .filter((player) => player.id !== gameState.self.id)
    .map((player) => estimateScore(gameState, player.id, player.cash, player.shares)));
  return selfScore >= bestOpponentScore;
}

function estimateScore(
  gameState: GameState,
  playerId: string,
  cash: number,
  shares: Readonly<Record<HotelChain, number>>
): number {
  return HOTEL_CHAINS.reduce((score, chain) => {
    const company = gameState.chains[chain];
    if (!company.isActive) return score;
    const shareValue = shares[chain] * company.price;
    const bonus = playerId === gameState.self.id
      ? bonusPayoutsWithSelfShares(gameState, chain, shares[chain]).get(playerId) ?? 0
      : bonusFor(gameState, chain, company.size, playerId);
    return score + shareValue + bonus;
  }, cash);
}

function bonusFor(gameState: GameState, chain: HotelChain, size: number, playerId: string): number {
  return bonusPayouts(gameState, chain, size).get(playerId) ?? 0;
}

function bonusPayouts(gameState: GameState, chain: HotelChain, size: number): Map<string, number> {
  return new Map(calculateBonusPayouts(
    gameState.players.map((player) => ({ playerId: player.id, shares: player.shares[chain] })),
    chain,
    size
  ).map((payout) => [payout.playerId, payout.amount]));
}

function bonusPayoutsWithSelfShares(
  gameState: GameState,
  chain: HotelChain,
  selfShares: number
): Map<string, number> {
  return new Map(calculateBonusPayouts(
    gameState.players.map((player) => ({
      playerId: player.id,
      shares: player.id === gameState.self.id ? selfShares : player.shares[chain]
    })),
    chain,
    gameState.chains[chain].size
  ).map((payout) => [payout.playerId, payout.amount]));
}

function indexOfMaximum<T>(values: readonly T[], score: (value: T) => number): number {
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const [index, value] of values.entries()) {
    const valueScore = score(value);
    if (valueScore > bestScore) {
      bestIndex = index;
      bestScore = valueScore;
    }
  }
  return bestIndex;
}
