import type { GameState, Tile } from "../../../game/types.js";
import { Strategy } from "../StrategyUtils.js";

export abstract class PlayTileStrategy extends Strategy {
    public abstract decide(
        gameState: GameState,
        validTiles: readonly Tile[],
        invalidTilesInHand: readonly Tile[]
    ): number;
}
