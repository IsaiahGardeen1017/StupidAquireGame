export function pickRandomIndex(length: number, randInt: (a: number, b: number) => number): number {
    if (length <= 0) {
        throw new Error("Cannot pick from an empty list.");
    }
    return randInt(0, length - 1);
}