import { GameState, SharePurchaseDecision } from "../../../game/types.js";
import { Strategy } from "../StrategyUtils.js";


export abstract class BuyStrategy extends Strategy{
    abstract decide(gameState: GameState): SharePurchaseDecision
}
