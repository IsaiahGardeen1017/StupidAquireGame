import { describe, expect, it } from "vitest";

import {
  calculateBonusPayouts,
  canEndGame,
  HOTEL_CHAINS,
  sharePrice,
  type HotelChain
} from "../src/index.js";

describe("Acquire rules", () => {
  it("calculates stock prices at every important size boundary", () => {
    expect(sharePrice("Luxor", 0)).toBe(0);
    expect(sharePrice("Luxor", 2)).toBe(200);
    expect(sharePrice("Luxor", 6)).toBe(600);
    expect(sharePrice("Luxor", 10)).toBe(600);
    expect(sharePrice("Luxor", 11)).toBe(700);
    expect(sharePrice("Luxor", 21)).toBe(800);
    expect(sharePrice("Luxor", 41)).toBe(1_000);
    expect(sharePrice("Luxor", 101)).toBe(1_000);
    expect(sharePrice("American", 2)).toBe(300);
    expect(sharePrice("Continental", 2)).toBe(400);
  });

  it("pays majority and minority bonuses, including rounded ties", () => {
    const holdings = [
      { playerId: "one", shares: 5 },
      { playerId: "two", shares: 3 },
      { playerId: "three", shares: 3 }
    ];
    expect(calculateBonusPayouts(holdings, "Luxor", 5)).toEqual([
      { playerId: "one", amount: 5_000 },
      { playerId: "two", amount: 1_300 },
      { playerId: "three", amount: 1_300 }
    ]);

    expect(calculateBonusPayouts([
      { playerId: "one", shares: 4 },
      { playerId: "two", shares: 4 },
      { playerId: "three", shares: 4 }
    ], "American", 2)).toEqual([
      { playerId: "one", amount: 1_500 },
      { playerId: "two", amount: 1_500 },
      { playerId: "three", amount: 1_500 }
    ]);
  });

  it("allows ending with one dominant chain or when every active chain is safe", () => {
    const sizes = (entries: Partial<Record<HotelChain, number>>) => Object.fromEntries(
      HOTEL_CHAINS.map((chain) => [chain, entries[chain] ?? 0])
    ) as Record<HotelChain, number>;

    expect(canEndGame(sizes({}))).toBe(false);
    expect(canEndGame(sizes({ Luxor: 40, Tower: 2 }))).toBe(false);
    expect(canEndGame(sizes({ Luxor: 41 }))).toBe(true);
    expect(canEndGame(sizes({ Luxor: 11, Tower: 12 }))).toBe(true);
    expect(canEndGame(sizes({ Luxor: 11, Tower: 10 }))).toBe(false);
  });
});
