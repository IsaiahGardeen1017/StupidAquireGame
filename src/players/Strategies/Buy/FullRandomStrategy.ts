import { GameState, HOTEL_CHAINS, SharePurchase, SharePurchaseDecision } from "../../../game/types.js";
import { pickRandomIndex } from "../StrategyUtils.js";
import { BuyStrategy } from "./BuyStrategy.js";


export class FullRandomBuyStrategy extends BuyStrategy {
    decide(gameState: GameState): SharePurchaseDecision {
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

            const chain = legalChains[pickRandomIndex(legalChains.length, this.randInt)];
            if (chain === undefined) throw new Error("Failed to choose an affordable hotel chain.");
            purchase[chain] = (purchase[chain] ?? 0) + 1;
            cashRemaining -= gameState.chains[chain].price;
        }

        return { purchase, endGame: gameState.canEndGame && this.randInt(0, 1) === 0 };
    }
}