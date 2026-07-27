import { describe, expect, it } from "vitest";

import {
  AcquireGameEngine,
  AcquirePlayer,
  InvalidPlayerDecisionError,
  RandomPlayer,
  type GameState,
  type HotelChain,
  type SharePurchaseDecision,
  type Tile
} from "../src/index.js";

function createDeterministicGame(seed: number) {
  return new AcquireGameEngine([
    new RandomPlayer("Ada", seed + 1),
    new RandomPlayer("Babbage", seed + 2),
    new RandomPlayer("Curie", seed + 3),
    new RandomPlayer("Dijkstra", seed + 4)
  ], { seed });
}

describe("AcquireGameEngine", () => {
  it("runs a complete deterministic game and records an exact replay", async () => {
    const first = await createDeterministicGame(20_260_726).run();
    const second = await createDeterministicGame(20_260_726).run();

    expect(second).toEqual(first);
    expect(first.turnsPlayed).toBeGreaterThan(0);
    expect(first.finalScores).toHaveLength(4);
    expect(first.finalScores.map((score) => score.rank)).toEqual([1, 2, 3, 4]);
    expect(first.replay.formatVersion).toBe(1);
    expect(first.replay.seed).toBe(20_260_726);
    expect(first.replay.events.at(-1)?.event.kind).toBe("finalStandings");
    expect(first.replay.events.some((entry) => entry.event.kind === "chainFounded")).toBe(true);
    expect(first.replay.events.some((entry) => entry.event.kind === "chainsMerged")).toBe(true);
    expect(first.replay.events.some((entry) => entry.event.kind === "sharesDisposed")).toBe(true);
  });

  it("rejects an invalid player choice instead of corrupting game state", async () => {
    const engine = new AcquireGameEngine([
      new InvalidTilePlayer("Invalid"),
      new InvalidTilePlayer("Also invalid")
    ], { seed: 123 });

    await expect(engine.run()).rejects.toMatchObject({
      name: "InvalidPlayerDecisionError",
      decision: "playTile"
    } satisfies Partial<InvalidPlayerDecisionError>);
  });

  it("can only run once", async () => {
    const engine = createDeterministicGame(7);
    await engine.run();
    await expect(engine.run()).rejects.toThrow("only run one game");
  });
});

class InvalidTilePlayer extends AcquirePlayer {
  public async playTile(_gameState: GameState, _validTiles: readonly Tile[], _invalidTilesInHand: readonly Tile[]): Promise<number> {
    return 999;
  }

  public async determineChainToStart(_gameState: GameState, _validChains: readonly HotelChain[]): Promise<number> {
    return 0;
  }

  public async buy(_gameState: GameState): Promise<SharePurchaseDecision> {
    return { purchase: {}, endGame: false };
  }

  public async determineMergeSurvivor(
    _gameState: GameState,
    _mergeTile: Tile,
    _possibleSurvivors: readonly HotelChain[]
  ): Promise<number> {
    return 0;
  }

  public async determineHowManySharesToTradeInAfterMerge(
    _gameState: GameState,
    _survivingChain: HotelChain,
    _mergeChain: HotelChain,
    _numTradesAvailable: number
  ): Promise<number> {
    return 0;
  }

  public async determineHowManySharesToSell(
    _gameState: GameState,
    _survivingChain: HotelChain,
    _mergeChain: HotelChain,
    _howManyIHave: number
  ): Promise<number> {
    return 0;
  }
}
