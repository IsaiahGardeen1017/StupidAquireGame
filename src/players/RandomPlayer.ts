import type { GameState, HotelChain, SharePurchaseDecision, Tile } from "../game/types.js";
import { AcquirePlayer } from "./AcquirePlayer.js";
import { FullRandomBuyStrategy } from "./Strategies/Buy/FullRandomStrategy.js";
import type { BuyStrategy } from "./Strategies/Buy/BuyStrategy.js";
import type { DisposeChainStrategy } from "./Strategies/DisposeChain/DisposeChainStrategy.js";
import { RandomDisposeChainStrategy } from "./Strategies/DisposeChain/RandomDisposeChainStrategy.js";
import type { MergeSurvivorStrategy } from "./Strategies/MergeSurvivor/MergeSurvivorStrategy.js";
import { RandomMergeSurvivorStrategy } from "./Strategies/MergeSurvivor/RandomMergeSurvivorStrategy.js";
import type { PlayTileStrategy } from "./Strategies/PlayTile/PlayTileStrategy.js";
import { RandomPlayTileStrategy } from "./Strategies/PlayTile/RandomPlayTileStrategy.js";
import type { SellSharesStrategy } from "./Strategies/SellShares/SellSharesStrategy.js";
import { RandomSellSharesStrategy } from "./Strategies/SellShares/RandomSellSharesStrategy.js";
import type { StartChainStrategy } from "./Strategies/StartChain/StartChainStrategy.js";
import { RandomStartChainStrategy } from "./Strategies/StartChain/RandomStartChainStrategy.js";
import type { TradeSharesStrategy } from "./Strategies/TradeShares/TradeSharesStrategy.js";
import { RandomTradeSharesStrategy } from "./Strategies/TradeShares/RandomTradeSharesStrategy.js";

export class RandomPlayer extends AcquirePlayer {
    public readonly playTileStrategy: PlayTileStrategy;
    public readonly startChainStrategy: StartChainStrategy;
    public readonly buyStrategy: BuyStrategy;
    public readonly mergeSurvivorStrategy: MergeSurvivorStrategy;
    public readonly disposeChainStrategy: DisposeChainStrategy;
    public readonly tradeSharesStrategy: TradeSharesStrategy;
    public readonly sellSharesStrategy: SellSharesStrategy;

    public constructor(name = "Random Player", seed?: number) {
        super(name, seed);
        this.playTileStrategy = new RandomPlayTileStrategy(this);
        this.startChainStrategy = new RandomStartChainStrategy(this);
        this.buyStrategy = new FullRandomBuyStrategy(this);
        this.mergeSurvivorStrategy = new RandomMergeSurvivorStrategy(this);
        this.disposeChainStrategy = new RandomDisposeChainStrategy(this);
        this.tradeSharesStrategy = new RandomTradeSharesStrategy(this);
        this.sellSharesStrategy = new RandomSellSharesStrategy(this);
    }

    public async playTile(_gameState: GameState, validTiles: readonly Tile[], _invalidTilesInHand: readonly Tile[]): Promise<number> {
        return this.playTileStrategy.decide(_gameState, validTiles, _invalidTilesInHand);
    }

    public async determineChainToStart(_gameState: GameState, validChains: readonly HotelChain[]): Promise<number> {
        return this.startChainStrategy.decide(_gameState, validChains);
    }

    public async buy(gameState: GameState): Promise<SharePurchaseDecision> {
        return this.buyStrategy.decide(gameState);
    }

    public async determineMergeSurvivor(_gameState: GameState, _mergeTile: Tile, possibleSurvivors: readonly HotelChain[]): Promise<number> {
        return this.mergeSurvivorStrategy.decide(_gameState, _mergeTile, possibleSurvivors);
    }

    public override async determineChainToDisposeOfNext(
        gameState: GameState,
        mergeTile: Tile,
        survivingChain: HotelChain,
        possibleDefunctChains: readonly HotelChain[]
    ): Promise<number> {
        return this.disposeChainStrategy.decide(gameState, mergeTile, survivingChain, possibleDefunctChains);
    }

    public async determineHowManySharesToTradeInAfterMerge(
        _gameState: GameState,
        _survivingChain: HotelChain,
        _mergeChain: HotelChain,
        numTradesAvailable: number
    ): Promise<number> {
        return this.tradeSharesStrategy.decide(_gameState, _survivingChain, _mergeChain, numTradesAvailable);
    }

    public async determineHowManySharesToSell(
        _gameState: GameState,
        _survivingChain: HotelChain,
        _mergeChain: HotelChain,
        howManyIHave: number
    ): Promise<number> {
        return this.sellSharesStrategy.decide(_gameState, _survivingChain, _mergeChain, howManyIHave);
    }
}
