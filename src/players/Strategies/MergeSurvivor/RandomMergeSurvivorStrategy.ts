import type { GameState, HotelChain, Tile } from "../../../game/types.js";
import { MergeSurvivorStrategy } from "./MergeSurvivorStrategy.js";

export class RandomMergeSurvivorStrategy extends MergeSurvivorStrategy {
    public decide(
        _gameState: GameState,
        _mergeTile: Tile,
        possibleSurvivors: readonly HotelChain[]
    ): number {
        return this.pickRandomIndex(possibleSurvivors.length);
    }
}
