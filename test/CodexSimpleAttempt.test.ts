import { describe, expect, it } from "vitest";

import {
  AcquireGameEngine,
  CodexSimpleAttempt,
  RandomPlayer
} from "../src/index.js";

describe("CodexSimpleAttempt", () => {
  it("beats RandomPlayer over a deterministic head-to-head sample", async () => {
    let wins = 0;
    const games = 50;
    for (let seed = 1; seed <= games; seed += 1) {
      const result = await new AcquireGameEngine([
        new CodexSimpleAttempt("Codex"),
        new RandomPlayer("Random", seed * 17 + 3)
      ], { seed }).run();
      const codex = result.finalScores.find((score) => score.playerName === "Codex");
      const random = result.finalScores.find((score) => score.playerName === "Random");
      if (codex === undefined || random === undefined) throw new Error("A benchmark player is missing.");
      if (codex.score > random.score) wins += 1;
    }

    expect(wins).toBeGreaterThan(35);
  });
});
