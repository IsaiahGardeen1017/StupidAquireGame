import type { GameState, HotelChain } from "../../../game/types.js";
import { StartChainStrategy } from "./StartChainStrategy.js";

export class RandomStartChainStrategy extends StartChainStrategy {
    public decide(_gameState: GameState, validChains: readonly HotelChain[]): number {
        return this.pickRandomIndex(validChains.length);
    }
}
