import { describe, expect, it } from "vitest";

import { HOTEL_CHAINS, type GameState, RandomPlayer, type Tile } from "../src/index.js";

function createGameState(): GameState {
  const tileA: Tile = { row: "A", column: 1 };
  const tileB: Tile = { row: "A", column: 2 };

  return {
    turnNumber: 1,
    activePlayerId: "player-1",
    phase: "playTile",
    board: [{ tile: tileA, chain: null }, { tile: tileB, chain: "Luxor" }],
    players: [
      {
        id: "player-1",
        name: "Tester",
        cash: 6000,
        shares: {
          Luxor: 0,
          Tower: 0,
          American: 0,
          Festival: 0,
          Worldwide: 0,
          Continental: 0,
          Imperial: 0
        },
        handSize: 6
      }
    ],
    self: {
      id: "player-1",
      name: "Tester",
      cash: 6000,
      shares: {
        Luxor: 0,
        Tower: 0,
        American: 0,
        Festival: 0,
        Worldwide: 0,
        Continental: 0,
        Imperial: 0
      },
      handSize: 6,
      tilesInHand: [tileA, tileB],
      validTiles: [tileA],
      invalidTiles: [tileB]
    },
    chains: Object.fromEntries(
      HOTEL_CHAINS.map((chain) => [
        chain,
        {
          chain,
          size: chain === "Luxor" ? 2 : 0,
          availableShares: 25,
          isActive: chain === "Luxor"
        }
      ])
    ) as GameState["chains"],
    tilesRemaining: 100
  };
}

describe("RandomPlayer", () => {
  it("selects the first valid option when the rng returns zero", async () => {
    const player = new RandomPlayer("Predictable", () => 0);
    const gameState = createGameState();

    await expect(player.playTile(gameState, gameState.self.validTiles, gameState.self.invalidTiles)).resolves.toBe(0);
    await expect(player.determineChainToStart(gameState, ["Luxor", "Tower"])).resolves.toBe(0);
    await expect(player.determineMergeSurvivor(gameState, { row: "B", column: 1 }, ["Luxor", "Tower"])).resolves.toBe(0);
    await expect(player.determineHowManySharesToTradeInAfterMerge(gameState, "Luxor", "Tower", 4)).resolves.toBe(0);
    await expect(player.determineHowManySharesToSell(gameState, "Luxor", "Tower", 3)).resolves.toBe(0);
  });

  it("returns an empty buy plan when no hotel chains are active", async () => {
    const player = new RandomPlayer("Passive", () => 0.75);
    const gameState = {
      ...createGameState(),
      chains: Object.fromEntries(
        HOTEL_CHAINS.map((chain) => [
          chain,
          {
            chain,
            size: 0,
            availableShares: 25,
            isActive: false
          }
        ])
      ) as GameState["chains"]
    };

    await expect(player.buy(gameState)).resolves.toEqual({});
  });

  it("buys up to three shares across active chains", async () => {
    const values = [0.99, 0.1, 0.6, 0.4];
    let index = 0;
    const player = new RandomPlayer("Buyer", () => {
      const value = values[index];
      index += 1;
      return value ?? 0;
    });

    const purchase = await player.buy(createGameState());

    expect(purchase).toEqual({ Luxor: 3 });
  });
});
