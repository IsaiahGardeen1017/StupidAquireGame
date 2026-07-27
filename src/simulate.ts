import {
    AcquireGameEngine,
    AcquirePlayer,
    CodexSimpleAttempt,
    RandomPlayer,
} from "./index.js";
import { Nimrod } from "./players/Nimrod.js";

const GAME_SEED = 20_260_726;
const NUM_SIMS = 100;

function randomNumber() {
    return Math.floor(Math.random() * 0x1_0000_0000);
}

function playerGenerator(
    name: string,
    type: "rand" | "codex" | "nimrod",
    seed?: number,
): AcquirePlayer {
    const playerSeed = seed ?? randomNumber();
    if (type === "nimrod") {
        return new Nimrod(name, playerSeed);
    } else if (type === "codex") {
        return new CodexSimpleAttempt(name, playerSeed);
    }
    return new RandomPlayer(name, playerSeed);
}

const scoreCard: Record<string, number> = {
    total_games: 0,
};
for (let i = 0; i < NUM_SIMS; i++) {
    const players = [
        playerGenerator("nimrod", "nimrod"),
        playerGenerator("rando 2", "rand"),
        playerGenerator("rando 3", "rand"),
        playerGenerator("rando 4", "rand"),
    ];

    const engine = new AcquireGameEngine(players, { seed: randomNumber() });
    const finalResults = await engine.run();

    finalResults.finalScores.forEach((res, idx) => {
        if (res.rank === 1) {
            const currScore = scoreCard[res.playerName];
            if (currScore) {
                scoreCard[res.playerName] = currScore + 1;
            } else {
                scoreCard[res.playerName] = 1;
            }
        }
    });
    scoreCard["total_games"] = (scoreCard["total_games"] || 0) + 1;
}
console.log(scoreCard);
