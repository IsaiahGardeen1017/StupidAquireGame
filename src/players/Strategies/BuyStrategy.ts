import { calculateBonusPayouts } from "../../game/rules.js";
import { GameState, HOTEL_CHAINS, HotelChain, SharePurchase, SharePurchaseDecision } from "../../game/types.js";
import { pickRandomIndex, randInteger, RandomIntFunction } from "./StrategyUtils.js";

export type BuyStrategyFunction = (gameState: GameState, randFunc?: RandomIntFunction) => SharePurchaseDecision;
export type BuyStrategy = 'SimpleSingleChain' | 'FullRandom';


export const BuyStrategies: Record<BuyStrategy, BuyStrategyFunction> = {
    'SimpleSingleChain': simpleBuyOneChainWithBiggestBonusDiff,
    'FullRandom': fullRandom,
}


function fullRandom(gameState: GameState, randFunc?: RandomIntFunction) {
    const randInt = randFunc ?? randInteger;
    const purchase: SharePurchase = {};
    let cashRemaining = gameState.self.cash;
    const totalSharesToBuy = randInt(0, 3);
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

        const chain = legalChains[pickRandomIndex(legalChains.length, randInt)];
        if (chain === undefined) throw new Error("Failed to choose an affordable hotel chain.");
        purchase[chain] = (purchase[chain] ?? 0) + 1;
        cashRemaining -= gameState.chains[chain].price;
    }

    return { purchase, endGame: gameState.canEndGame && randInt(0, 1) === 0 };
}

function simpleBuyOneChainWithBiggestBonusDiff(gameState: GameState): SharePurchaseDecision {
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
