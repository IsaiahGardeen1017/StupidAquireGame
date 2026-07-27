import type { GameState, HotelChain, SharePurchaseDecision, Tile } from "../game/types.js";
import { AcquirePlayer } from "./AcquirePlayer.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

export type HumanDecisionRequest =
  | { kind: "playTile"; gameState: GameState; validTiles: readonly Tile[]; invalidTilesInHand: readonly Tile[] }
  | { kind: "determineChainToStart"; gameState: GameState; validChains: readonly HotelChain[] }
  | { kind: "buy"; gameState: GameState }
  | { kind: "determineMergeSurvivor"; gameState: GameState; mergeTile: Tile; possibleSurvivors: readonly HotelChain[] }
  | {
      kind: "determineChainToDisposeOfNext";
      gameState: GameState;
      mergeTile: Tile;
      survivingChain: HotelChain;
      possibleDefunctChains: readonly HotelChain[];
    }
  | {
      kind: "determineHowManySharesToTradeInAfterMerge";
      gameState: GameState;
      survivingChain: HotelChain;
      mergeChain: HotelChain;
      numTradesAvailable: number;
    }
  | {
      kind: "determineHowManySharesToSell";
      gameState: GameState;
      survivingChain: HotelChain;
      mergeChain: HotelChain;
      howManyIHave: number;
    };

type DecisionHandlers = {
  onDecisionRequested?: (request: HumanDecisionRequest) => void;
  onDecisionSettled?: () => void;
};

export class HumanPlayer extends AcquirePlayer {
  private activeDecision: Deferred<unknown> | null = null;

  public constructor(name: string, private readonly handlers: DecisionHandlers = {}) {
    super(name);
  }

  public resolveDecision<T>(value: T) {
    if (this.activeDecision === null) {
      throw new Error("No active decision to resolve.");
    }

    this.activeDecision.resolve(value);
    this.activeDecision = null;
    this.handlers.onDecisionSettled?.();
  }

  public rejectDecision(reason?: unknown) {
    if (this.activeDecision === null) {
      throw new Error("No active decision to reject.");
    }

    this.activeDecision.reject(reason);
    this.activeDecision = null;
    this.handlers.onDecisionSettled?.();
  }

  public async playTile(gameState: GameState, validTiles: readonly Tile[], invalidTilesInHand: readonly Tile[]): Promise<number> {
    return this.requestDecision<number>({ kind: "playTile", gameState, validTiles, invalidTilesInHand });
  }

  public async determineChainToStart(gameState: GameState, validChains: readonly HotelChain[]): Promise<number> {
    return this.requestDecision<number>({ kind: "determineChainToStart", gameState, validChains });
  }

  public async buy(gameState: GameState): Promise<SharePurchaseDecision> {
    return this.requestDecision<SharePurchaseDecision>({ kind: "buy", gameState });
  }

  public async determineMergeSurvivor(gameState: GameState, mergeTile: Tile, possibleSurvivors: readonly HotelChain[]): Promise<number> {
    return this.requestDecision<number>({ kind: "determineMergeSurvivor", gameState, mergeTile, possibleSurvivors });
  }

  public override async determineChainToDisposeOfNext(
    gameState: GameState,
    mergeTile: Tile,
    survivingChain: HotelChain,
    possibleDefunctChains: readonly HotelChain[]
  ): Promise<number> {
    return this.requestDecision<number>({
      kind: "determineChainToDisposeOfNext",
      gameState,
      mergeTile,
      survivingChain,
      possibleDefunctChains
    });
  }

  public async determineHowManySharesToTradeInAfterMerge(
    gameState: GameState,
    survivingChain: HotelChain,
    mergeChain: HotelChain,
    numTradesAvailable: number
  ): Promise<number> {
    return this.requestDecision<number>({
      kind: "determineHowManySharesToTradeInAfterMerge",
      gameState,
      survivingChain,
      mergeChain,
      numTradesAvailable
    });
  }

  public async determineHowManySharesToSell(
    gameState: GameState,
    survivingChain: HotelChain,
    mergeChain: HotelChain,
    howManyIHave: number
  ): Promise<number> {
    return this.requestDecision<number>({
      kind: "determineHowManySharesToSell",
      gameState,
      survivingChain,
      mergeChain,
      howManyIHave
    });
  }

  private requestDecision<T>(request: HumanDecisionRequest): Promise<T> {
    if (this.activeDecision !== null) {
      throw new Error("Cannot request a new decision while another is pending.");
    }

    const deferred = createDeferred<T>();
    this.activeDecision = deferred as Deferred<unknown>;
    this.handlers.onDecisionRequested?.(request);
    return deferred.promise.finally(() => {
      this.activeDecision = null;
    });
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}
