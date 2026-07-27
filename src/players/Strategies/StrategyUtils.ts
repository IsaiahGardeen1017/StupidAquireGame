export type RandomIntFunction = (a: number | undefined, b: number | undefined) => number;

export function pickRandomIndex(length: number, randFunc: RandomIntFunction): number {
    if (length <= 0) {
        throw new Error("Cannot pick from an empty list.");
    }
    return randFunc(0, length - 1);
}

export function randInteger(min = 0, max = 0xffff_ffff): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
        throw new RangeError("The random integer range must contain safe integers with max >= min.");
    }

    let value = Math.random();
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const randomFraction = ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
    return min + Math.floor(randomFraction * (max - min + 1));
}