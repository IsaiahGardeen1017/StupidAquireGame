import type { GameState, HotelChain, Tile } from "../../../game/types.js";
import { DisposeChainStrategy } from "./DisposeChainStrategy.js";

export class RandomDisposeChainStrategy extends DisposeChainStrategy {
    public decide(
        _gameState: GameState,
        _mergeTile: Tile,
        _survivingChain: HotelChain,
        possibleDefunctChains: readonly HotelChain[]
    ): number {
        return this.pickRandomIndex(possibleDefunctChains.length);
    }
}
