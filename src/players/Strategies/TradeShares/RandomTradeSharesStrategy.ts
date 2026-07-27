import type { GameState, HotelChain } from "../../../game/types.js";
import { TradeSharesStrategy } from "./TradeSharesStrategy.js";

export class RandomTradeSharesStrategy extends TradeSharesStrategy {
    public decide(
        _gameState: GameState,
        _survivingChain: HotelChain,
        _mergeChain: HotelChain,
        numTradesAvailable: number
    ): number {
        return this.randInt(0, Math.floor(numTradesAvailable / 2)) * 2;
    }
}
