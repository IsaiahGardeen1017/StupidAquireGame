import type { GameState, HotelChain, Tile } from "../../../game/types.js";
import { Strategy } from "../StrategyUtils.js";

export abstract class MergeSurvivorStrategy extends Strategy {
    public abstract decide(
        gameState: GameState,
        mergeTile: Tile,
        possibleSurvivors: readonly HotelChain[]
    ): number;
}
