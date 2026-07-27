import { GameState, SharePurchaseDecision } from "../../../game/types.js";
import { AcquirePlayer } from "../../AcquirePlayer.js";


export abstract class BuyStrategy {
    parent: AcquirePlayer;
    constructor(parent: AcquirePlayer) {
        this.parent = parent;
    }

    randInt(min = 0, max = 0xffff_ffff): number {
        return this.parent.randInt(min, max)
    }

    abstract decide(gameState: GameState): SharePurchaseDecision
}
