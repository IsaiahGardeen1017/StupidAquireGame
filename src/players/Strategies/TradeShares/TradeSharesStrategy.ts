import type { GameState, HotelChain } from "../../../game/types.js";
import { Strategy } from "../StrategyUtils.js";

export abstract class TradeSharesStrategy extends Strategy {
    public abstract decide(
        gameState: GameState,
        survivingChain: HotelChain,
        mergeChain: HotelChain,
        numTradesAvailable: number
    ): number;
}
