import {
    AcquireGameEngine,
    AcquirePlayer,
    createSeededRandom,
    RandomPlayer,
} from "./index.js";

const GAME_SEED = 20_260_726;
const NUM_SIMS = 1000;

function randomNumber() {
    return Math.floor(Math.random() * 0x1_0000_0000);
}

function playerGenerator(
    name: string,
    type: "rand",
    seed?: number,
): AcquirePlayer {
    const s = seed
        ? createSeededRandom(seed)
        : createSeededRandom(randomNumber());
    return new RandomPlayer(name, s);
}

const scoreCard: Record<string, number> = {
    total_games: 0,
};
for (let i = 0; i < NUM_SIMS; i++) {
    const players = [
        playerGenerator("rando 1", "rand"),
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
