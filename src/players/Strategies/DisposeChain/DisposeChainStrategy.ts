import type { GameState, HotelChain, Tile } from "../../../game/types.js";
import { Strategy } from "../StrategyUtils.js";

export abstract class DisposeChainStrategy extends Strategy {
    public abstract decide(
        gameState: GameState,
        mergeTile: Tile,
        survivingChain: HotelChain,
        possibleDefunctChains: readonly HotelChain[]
    ): number;
}
