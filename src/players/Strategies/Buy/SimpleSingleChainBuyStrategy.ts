import { calculateBonusPayouts } from "../../../game/rules.js";
import { GameState, SharePurchaseDecision, HotelChain, SharePurchase } from "../../../game/types.js";
import { BuyStrategy } from "./BuyStrategy.js";

export class SimpleSingleChainBuyStrategy extends BuyStrategy {
    decide(gameState: GameState): SharePurchaseDecision {
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
}
