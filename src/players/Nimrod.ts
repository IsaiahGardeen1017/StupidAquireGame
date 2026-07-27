import { calculateBonusPayouts } from "../game/rules.js";
import { GameState, Tile, HotelChain, SharePurchaseDecision, SharePurchase } from "../game/types.js";
import { AcquirePlayer } from "./AcquirePlayer.js";
import { RandomPlayer } from "./RandomPlayer.js";


export class Nimrod extends AcquirePlayer {

    randomRef: RandomPlayer;

    public constructor(name = "Nimrod", seed?: number) {
        super(name, seed);
        this.randomRef = new RandomPlayer('idiot', this.seed);
    }


    playTile(gameState: GameState, validTiles: readonly Tile[], invalidTilesInHand: readonly Tile[]): Promise<number> {
        return this.randomRef.playTile(gameState, validTiles, invalidTilesInHand);
    }
    determineChainToStart(gameState: GameState, validChains: readonly HotelChain[]): Promise<number> {
        return this.randomRef.determineChainToStart(gameState, validChains);
    }




    buy(gameState: GameState): SharePurchaseDecision {
        const me = gameState.self.id;
        const cashOnHand = gameState.self.cash;
        const data: {
            chain: HotelChain,
            hueristic: number,
            amount: number
        }[] = [];
        for (const c in gameState.chains) {
            const chainName = c as HotelChain;
            const chaindata = gameState.chains[chainName];

            if (chaindata.isActive) {
                const holdings = gameState.players.map((player) => {
                    return {
                        playerId: player.id,
                        shares: player.shares[chainName]
                    };
                });

                const origBonuses = calculateBonusPayouts(holdings, chainName, chaindata.size);
                const myOrigBonus = origBonuses.filter((bonus) => {
                    return bonus.playerId === me;
                })[0]?.amount ?? 0;

                const numWouldBuy = Math.min(Math.floor(cashOnHand / chaindata.price), chaindata.availableShares, 3);

                holdings.forEach(holding => {
                    if (holding.playerId === me) {
                        holding.shares += numWouldBuy;
                    }
                });

                const newBonuses = calculateBonusPayouts(holdings, chainName, chaindata.size);
                const myNewBonus = newBonuses.filter((bonus) => {
                    return bonus.playerId === me;
                })[0]?.amount ?? 0;

                data.push({
                    chain: chainName,
                    hueristic: myNewBonus - myOrigBonus,
                    amount: numWouldBuy
                });
            }
        }

        const sorted = data.sort((a, b) => {
            return b.hueristic - a.hueristic;
        });
        const selected = sorted[0];

        const purchase: SharePurchase = {};
        if (selected) {
            purchase[selected?.chain] = selected.amount;
        }

        return {
            purchase,
            endGame: false
        }

    }
    determineMergeSurvivor(gameState: GameState, mergeTile: Tile, possibleSurvivors: readonly HotelChain[]): Promise<number> {
        return this.randomRef.determineMergeSurvivor(gameState, mergeTile, possibleSurvivors);
    }
    determineHowManySharesToTradeInAfterMerge(gameState: GameState, survivingChain: HotelChain, mergeChain: HotelChain, numTradesAvailable: number): Promise<number> {
        return this.randomRef.determineHowManySharesToTradeInAfterMerge(gameState, survivingChain, mergeChain, numTradesAvailable);
    }
    determineHowManySharesToSell(gameState: GameState, survivingChain: HotelChain, mergeChain: HotelChain, howManyIHave: number): Promise<number> {
        return this.randomRef.determineHowManySharesToSell(gameState, survivingChain, mergeChain, howManyIHave);
    }
}
