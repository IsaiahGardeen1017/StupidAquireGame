import type { GameState, HotelChain, SharePurchase, SharePurchaseDecision, Tile } from "../game/types.js";
import { HOTEL_CHAINS } from "../game/types.js";
import { AcquirePlayer } from "./AcquirePlayer.js";
import { BuyStrategies } from "./Strategies/BuyStrategy.js";

export class Nimrod extends AcquirePlayer {
    public constructor(name = "Nimrod", seed?: number) {
        super(name, seed);
    }

    public async playTile(_gameState: GameState, validTiles: readonly Tile[], _invalidTilesInHand: readonly Tile[]): Promise<number> {
        return this.pickRandomIndex(validTiles.length);
    }

    public async determineChainToStart(_gameState: GameState, validChains: readonly HotelChain[]): Promise<number> {
        return this.pickRandomIndex(validChains.length);
    }

    public async buy(gameState: GameState): Promise<SharePurchaseDecision> {
        return BuyStrategies.SimpleSingleChain(gameState);
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
