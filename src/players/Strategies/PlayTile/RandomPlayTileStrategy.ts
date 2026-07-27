import type { GameState, Tile } from "../../../game/types.js";
import { PlayTileStrategy } from "./PlayTileStrategy.js";

export class RandomPlayTileStrategy extends PlayTileStrategy {
    public decide(
        _gameState: GameState,
        validTiles: readonly Tile[],
        _invalidTilesInHand: readonly Tile[]
    ): number {
        return this.pickRandomIndex(validTiles.length);
    }
}
