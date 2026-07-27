import type { GameState, HotelChain } from "../../../game/types.js";
import { SellSharesStrategy } from "./SellSharesStrategy.js";

export class RandomSellSharesStrategy extends SellSharesStrategy {
    public decide(
        _gameState: GameState,
        _survivingChain: HotelChain,
        _mergeChain: HotelChain,
        howManyIHave: number
    ): number {
        return this.randInt(0, howManyIHave);
    }
}
