import type { GameState, HotelChain } from "../../../game/types.js";
import { Strategy } from "../StrategyUtils.js";

export abstract class SellSharesStrategy extends Strategy {
    public abstract decide(
        gameState: GameState,
        survivingChain: HotelChain,
        mergeChain: HotelChain,
        howManyIHave: number
    ): number;
}
