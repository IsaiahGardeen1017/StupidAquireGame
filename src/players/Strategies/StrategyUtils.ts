import { AcquirePlayer } from "../AcquirePlayer.js";

export abstract class Strategy {

    parent: AcquirePlayer;
    constructor(parent: AcquirePlayer) {
        this.parent = parent;
    }

    randInt(min = 0, max = 0xffff_ffff): number {
        return this.parent.randInt(min, max)
    }

    pickRandomIndex(length: number): number {
        if (length <= 0) {
            throw new Error("Cannot pick from an empty list.");
        }
        return this.randInt(0, length - 1);
    }

}