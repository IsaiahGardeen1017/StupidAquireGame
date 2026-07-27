import {
    AcquireGameEngine,
    createSeededRandom,
    RandomPlayer,
} from "./index.js";

const GAME_SEED = 20_260_726;
const players = [
    new RandomPlayer("Ada", createSeededRandom(GAME_SEED)),
    new RandomPlayer("Babbage", createSeededRandom(GAME_SEED)),
    new RandomPlayer("Curie", createSeededRandom(GAME_SEED)),
    new RandomPlayer("Dijkstra", createSeededRandom(GAME_SEED)),
];

const engine = new AcquireGameEngine(players, { seed: GAME_SEED });
const finalResults = await engine.run();

console.log(
    finalResults.finalScores.map((res, idx) => {
        return `${idx} ${res.playerName} - $${res.score}`;
    }).join("\n"),
);
