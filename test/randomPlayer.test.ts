import { describe, expect, it } from "vitest";

import { HOTEL_CHAINS, type GameState, RandomPlayer, type Tile } from "../src/index.js";

function createGameState(): GameState {
  const tileA: Tile = { row: "A", column: 1 };
  const tileB: Tile = { row: "A", column: 2 };

  return {
    turnNumber: 1,
    activePlayerId: "player-1",
    phase: "playTile",
    board: [
      { tile: tileA, kind: "independent" },
      { tile: tileB, kind: "chain", chain: "Luxor" },
      { tile: { row: "A", column: 3 }, kind: "dead" }
    ],
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
          price: chain === "Luxor" ? 200 : 0,
          majorityBonus: chain === "Luxor" ? 2000 : 0,
          minorityBonus: chain === "Luxor" ? 1000 : 0,
          isActive: chain === "Luxor",
          isSafe: false
        }
      ])
    ) as GameState["chains"],
    tilesRemaining: 100,
    canEndGame: false
  };
}

describe("RandomPlayer", () => {
  it("repeats the same choices when given the same seed", async () => {
    const player = new RandomPlayer("Predictable", 1234);
    const matchingPlayer = new RandomPlayer("Also predictable", 1234);
    const gameState = createGameState();

    expect(player.seed).toBe(1234);
    expect(new RandomPlayer("Seeded", 42).randInt()).toBe(new RandomPlayer("Also seeded", 42).randInt());

    const choices = [
      await player.playTile(gameState, [{ row: "A", column: 1 }, { row: "A", column: 2 }], []),
      await player.determineChainToStart(gameState, ["Luxor", "Tower"]),
      await player.determineMergeSurvivor(gameState, { row: "B", column: 1 }, ["Luxor", "Tower"]),
      await player.determineChainToDisposeOfNext(
        gameState,
        { row: "B", column: 1 },
        "Luxor",
        ["Tower", "American"]
      ),
      await player.determineHowManySharesToTradeInAfterMerge(gameState, "Luxor", "Tower", 4),
      await player.determineHowManySharesToSell(gameState, "Luxor", "Tower", 3)
    ];
    const matchingChoices = [
      await matchingPlayer.playTile(gameState, [{ row: "A", column: 1 }, { row: "A", column: 2 }], []),
      await matchingPlayer.determineChainToStart(gameState, ["Luxor", "Tower"]),
      await matchingPlayer.determineMergeSurvivor(gameState, { row: "B", column: 1 }, ["Luxor", "Tower"]),
      await matchingPlayer.determineChainToDisposeOfNext(
        gameState,
        { row: "B", column: 1 },
        "Luxor",
        ["Tower", "American"]
      ),
      await matchingPlayer.determineHowManySharesToTradeInAfterMerge(gameState, "Luxor", "Tower", 4),
      await matchingPlayer.determineHowManySharesToSell(gameState, "Luxor", "Tower", 3)
    ];

    expect(matchingChoices).toEqual(choices);
  });

  it("returns an empty buy plan when no hotel chains are active", async () => {
    const player = new RandomPlayer("Passive", 99);
    const gameState = {
      ...createGameState(),
      chains: Object.fromEntries(
        HOTEL_CHAINS.map((chain) => [
          chain,
          {
            chain,
            size: 0,
            availableShares: 25,
            price: 0,
            majorityBonus: 0,
            minorityBonus: 0,
            isActive: false,
            isSafe: false
          }
        ])
      ) as GameState["chains"]
    };

    await expect(player.buy(gameState)).resolves.toEqual({ purchase: {}, endGame: false });
  });

  it("buys up to three shares across active chains", async () => {
    const player = new RandomPlayer("Buyer", 4);

    const purchase = await player.buy(createGameState());

    expect(purchase).toEqual({ purchase: { Luxor: 3 }, endGame: false });
  });
});
