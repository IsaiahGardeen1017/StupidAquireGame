import type { GameState, HotelChain } from "../../../game/types.js";
import { Strategy } from "../StrategyUtils.js";

export abstract class StartChainStrategy extends Strategy {
    public abstract decide(gameState: GameState, validChains: readonly HotelChain[]): number;
}
