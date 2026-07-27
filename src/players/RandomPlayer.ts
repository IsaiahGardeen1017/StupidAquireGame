import type { GameState, HotelChain, SharePurchase, SharePurchaseDecision, Tile } from "../game/types.js";
import { HOTEL_CHAINS } from "../game/types.js";
import { AcquirePlayer } from "./AcquirePlayer.js";

export class RandomPlayer extends AcquirePlayer {
    public constructor(name = "Random Player", seed?: number) {
        super(name, seed);
    }

    public async playTile(_gameState: GameState, validTiles: readonly Tile[], _invalidTilesInHand: readonly Tile[]): Promise<number> {
        return this.pickRandomIndex(validTiles.length);
    }

    public async determineChainToStart(_gameState: GameState, validChains: readonly HotelChain[]): Promise<number> {
        return this.pickRandomIndex(validChains.length);
    }

    public async buy(gameState: GameState): Promise<SharePurchaseDecision> {
        const purchase: SharePurchase = {};
        let cashRemaining = gameState.self.cash;
        const totalSharesToBuy = this.randInt(0, 3);
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

            const chain = legalChains[this.pickRandomIndex(legalChains.length)];
            if (chain === undefined) throw new Error("Failed to choose an affordable hotel chain.");
            purchase[chain] = (purchase[chain] ?? 0) + 1;
            cashRemaining -= gameState.chains[chain].price;
        }

        return { purchase, endGame: gameState.canEndGame && this.randInt(0, 1) === 0 };
    }

    public async determineMergeSurvivor(_gameState: GameState, _mergeTile: Tile, possibleSurvivors: readonly HotelChain[]): Promise<number> {
        return this.pickRandomIndex(possibleSurvivors.length);
    }

    public async determineHowManySharesToTradeInAfterMerge(
        _gameState: GameState,
        _survivingChain: HotelChain,
        _mergeChain: HotelChain,
        numTradesAvailable: number
    ): Promise<number> {
        return this.randInt(0, Math.floor(numTradesAvailable / 2)) * 2;
    }

    public async determineHowManySharesToSell(
        _gameState: GameState,
        _survivingChain: HotelChain,
        _mergeChain: HotelChain,
        howManyIHave: number
    ): Promise<number> {
        return this.randInt(0, howManyIHave);
    }

    private pickRandomIndex(length: number): number {
        if (length <= 0) {
            throw new Error("Cannot pick from an empty list.");
        }
        return this.randInt(0, length - 1);
    }
}
