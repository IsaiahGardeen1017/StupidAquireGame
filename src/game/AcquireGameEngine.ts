import type { AcquirePlayer } from "../players/AcquirePlayer.js";
import type { GameEvent, GameHistoryEntry } from "./session.js";
import {
  HOTEL_CHAINS,
  type BoardCell,
  type ChainState,
  type GameState,
  type HotelChain,
  type PlayerId,
  type PlayerPrivateState,
  type PlayerPublicState,
  type SharePurchase,
  type SharePurchaseDecision,
  type Tile,
  type TurnPhase
} from "./types.js";
import {
  MAX_SHARES_PER_TURN,
  RACK_SIZE,
  SAFE_CHAIN_SIZE,
  SHARES_PER_CHAIN,
  STARTING_CASH,
  TILE_COUNT,
  adjacentTiles,
  calculateBonusPayouts,
  canEndGame,
  compareTiles,
  createAllTiles,
  majorityBonus,
  minorityBonus,
  sharePrice,
  tileKey
} from "./rules.js";

export type RandomSource = () => number;

export type AcquireGameEngineOptions = Readonly<{
  seed?: number;
  random?: RandomSource;
  maxTurns?: number;
}>;

export type FinalScore = Readonly<{
  rank: number;
  playerId: PlayerId;
  playerName: string;
  cash: number;
  shareValue: number;
  bonusValue: number;
  score: number;
}>;

export type ReplayPlayer = Readonly<{
  playerId: PlayerId;
  playerName: string;
  positionTile: Tile;
}>;

export type AcquireReplay = Readonly<{
  formatVersion: 1;
  seed: number | null;
  players: readonly ReplayPlayer[];
  events: readonly GameHistoryEntry[];
  finalScores: readonly FinalScore[];
}>;

export type AcquireGameResult = Readonly<{
  turnsPlayed: number;
  finalScores: readonly FinalScore[];
  replay: AcquireReplay;
}>;

export type EngineEventListener = (entry: GameHistoryEntry) => void;

type BoardOccupant = HotelChain | "independent" | "dead";

type BoardEntry = {
  tile: Tile;
  occupant: BoardOccupant;
};

type MutablePlayer = {
  id: PlayerId;
  controller: AcquirePlayer;
  name: string;
  positionTile: Tile;
  cash: number;
  shares: Record<HotelChain, number>;
  rack: Tile[];
};

type Placement =
  | Readonly<{ kind: "isolated" }>
  | Readonly<{ kind: "foundsChain" }>
  | Readonly<{ kind: "temporarilyUnplayable" }>
  | Readonly<{ kind: "permanentlyUnplayable" }>
  | Readonly<{ kind: "extendsChain"; chain: HotelChain }>
  | Readonly<{ kind: "mergesChains"; chains: readonly HotelChain[] }>;

type ForcedEndReason = "noTilesPlayedForRound" | "allTilesPlayed";

export class InvalidPlayerDecisionError extends Error {
  public constructor(
    public readonly playerId: PlayerId,
    public readonly decision: string,
    message: string
  ) {
    super(message);
    this.name = "InvalidPlayerDecisionError";
  }
}

export class AcquireGameEngine {
  private readonly entrants: readonly AcquirePlayer[];
  private readonly random: RandomSource;
  private readonly seed: number | null;
  private readonly maxTurns: number;
  private readonly board = new Map<string, BoardEntry>();
  private readonly chainSizes = emptyChainNumbers();
  private readonly history: GameHistoryEntry[] = [];
  private readonly listeners = new Set<EngineEventListener>();
  private bag: Tile[] = [];
  private players: MutablePlayer[] = [];
  private turnNumber = 0;
  private activePlayerIndex = 0;
  private turnsWithoutPlayedTiles = 0;
  private hasRun = false;

  public constructor(players: readonly AcquirePlayer[], options: AcquireGameEngineOptions = {}) {
    if (players.length < 2 || players.length > 6) {
      throw new RangeError("Acquire requires between two and six players.");
    }
    if (new Set(players).size !== players.length) {
      throw new Error("Each seat must use a distinct player object.");
    }
    if (options.random !== undefined && options.seed !== undefined) {
      throw new Error("Pass either a seed or a random source, not both.");
    }
    if (options.maxTurns !== undefined && (!Number.isInteger(options.maxTurns) || options.maxTurns <= 0)) {
      throw new RangeError("maxTurns must be a positive integer.");
    }

    this.entrants = [...players];
    this.maxTurns = options.maxTurns ?? 10_000;
    if (options.random !== undefined) {
      this.seed = null;
      this.random = checkedRandom(options.random);
    } else {
      this.seed = normalizeSeed(options.seed ?? Date.now());
      this.random = checkedRandom(createSeededRandom(this.seed));
    }
  }

  public subscribe(listener: EngineEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async run(): Promise<AcquireGameResult> {
    if (this.hasRun) throw new Error("An AcquireGameEngine instance can only run one game.");
    this.hasRun = true;
    this.initializeGame();

    let forcedEndReason: ForcedEndReason | null = null;
    let endedVoluntarily = false;
    while (forcedEndReason === null && !endedVoluntarily) {
      if (this.turnNumber >= this.maxTurns) {
        throw new Error(`Game exceeded the configured limit of ${this.maxTurns} turns.`);
      }
      const outcome = await this.playTurn();
      forcedEndReason = outcome.forcedEndReason;
      endedVoluntarily = outcome.endedVoluntarily;
      if (forcedEndReason === null && !endedVoluntarily) {
        this.activePlayerIndex = (this.activePlayerIndex + 1) % this.players.length;
      }
    }

    if (forcedEndReason !== null) {
      this.emit({ kind: "gameForcedToEnd", reason: forcedEndReason });
    }
    const finalScores = this.calculateFinalScores();
    this.emit({
      kind: "finalStandings",
      standings: finalScores.map(({ rank, playerId, score }) => ({ rank, playerId, score }))
    });

    const replay: AcquireReplay = {
      formatVersion: 1,
      seed: this.seed,
      players: this.players.map((player) => ({
        playerId: player.id,
        playerName: player.name,
        positionTile: copyTile(player.positionTile)
      })),
      events: this.history.map(copyHistoryEntry),
      finalScores: finalScores.map(copyFinalScore)
    };
    return {
      turnsPlayed: this.turnNumber,
      finalScores: finalScores.map(copyFinalScore),
      replay
    };
  }

  private initializeGame(): void {
    this.bag = shuffle(createAllTiles(), this.random);
    const seatedPlayers = this.entrants.map((controller) => {
      const positionTile = this.drawFromBag();
      if (positionTile === null) throw new Error("The tile bag was unexpectedly empty during setup.");
      return { controller, positionTile };
    }).sort((left, right) => compareTiles(left.positionTile, right.positionTile));

    this.players = seatedPlayers.map(({ controller, positionTile }, index) => ({
      id: `player-${index + 1}`,
      controller,
      name: controller.name,
      positionTile,
      cash: STARTING_CASH,
      shares: emptyChainNumbers(),
      rack: []
    }));
    for (const player of this.players) {
      this.setBoard(player.positionTile, "independent");
      this.emit({ kind: "positionTileDrawn", playerId: player.id, tile: copyTile(player.positionTile) });
    }

    const startingPlayer = this.players[0];
    if (startingPlayer === undefined) throw new Error("No starting player was seated.");
    this.emit({ kind: "gameStarted", playerId: startingPlayer.id });
    for (const player of this.players) this.fillRack(player);
    this.assertInvariants();
  }

  private async playTurn(): Promise<Readonly<{
    forcedEndReason: ForcedEndReason | null;
    endedVoluntarily: boolean;
  }>> {
    const activePlayer = this.players[this.activePlayerIndex];
    if (activePlayer === undefined) throw new Error("The active player does not exist.");
    this.turnNumber += 1;
    this.emit({ kind: "turnBegan", playerId: activePlayer.id });

    const placements = activePlayer.rack.map((tile) => ({ tile, placement: this.classifyTile(tile) }));
    const validTiles = placements.filter(({ placement }) => isPlayable(placement)).map(({ tile }) => tile);
    const invalidTiles = placements.filter(({ placement }) => !isPlayable(placement)).map(({ tile }) => tile);
    if (validTiles.length === 0) {
      this.turnsWithoutPlayedTiles += 1;
      this.emit({ kind: "noPlayableTile", playerId: activePlayer.id });
    } else {
      this.turnsWithoutPlayedTiles = 0;
      const choice = await activePlayer.controller.playTile(
        this.createGameState(activePlayer, "playTile", validTiles, invalidTiles),
        validTiles.map(copyTile),
        invalidTiles.map(copyTile)
      );
      const selectedTile = this.selectByIndex(activePlayer, "playTile", choice, validTiles);
      const rackIndex = activePlayer.rack.findIndex((tile) => tileKey(tile) === tileKey(selectedTile));
      if (rackIndex < 0) throw new Error("The selected tile disappeared from its owner's rack.");
      activePlayer.rack.splice(rackIndex, 1);
      await this.placeTile(activePlayer, selectedTile, this.classifyTile(selectedTile));
    }

    const purchaseResult = await this.purchaseShares(activePlayer);
    if (purchaseResult.endedVoluntarily) {
      this.assertInvariants();
      return { forcedEndReason: null, endedVoluntarily: true };
    }
    if (this.allRacksEmpty()) {
      this.assertInvariants();
      return { forcedEndReason: "allTilesPlayed", endedVoluntarily: false };
    }
    if (this.turnsWithoutPlayedTiles === this.players.length) {
      this.assertInvariants();
      return { forcedEndReason: "noTilesPlayedForRound", endedVoluntarily: false };
    }

    this.fillRack(activePlayer);
    this.replacePermanentlyUnplayableTiles(activePlayer);
    this.assertInvariants();
    return {
      forcedEndReason: this.allRacksEmpty() ? "allTilesPlayed" : null,
      endedVoluntarily: false
    };
  }

  private async placeTile(player: MutablePlayer, tile: Tile, placement: Placement): Promise<void> {
    if (!isPlayable(placement)) {
      throw new Error("Engine attempted to place an unplayable tile.");
    }
    this.setBoard(tile, "independent");
    this.emit({ kind: "tilePlayed", playerId: player.id, tile: copyTile(tile) });

    switch (placement.kind) {
      case "isolated":
        return;
      case "extendsChain":
        this.fillConnected(tile, placement.chain);
        this.chainSizes[placement.chain] = this.countBoardChain(placement.chain);
        return;
      case "foundsChain":
        await this.foundChain(player, tile);
        return;
      case "mergesChains":
        await this.mergeChains(player, tile, placement.chains);
        return;
      case "temporarilyUnplayable":
      case "permanentlyUnplayable":
        throw new Error("Engine attempted to place an unplayable tile.");
    }
  }

  private async foundChain(player: MutablePlayer, tile: Tile): Promise<void> {
    const inactiveChains = HOTEL_CHAINS.filter((chain) => this.chainSizes[chain] === 0);
    if (inactiveChains.length === 0) throw new Error("A chain-founding tile had no inactive chain available.");
    let chain = inactiveChains[0];
    if (inactiveChains.length > 1) {
      const choice = await player.controller.determineChainToStart(
        this.createGameState(player, "startChain"),
        [...inactiveChains]
      );
      chain = this.selectByIndex(player, "determineChainToStart", choice, inactiveChains);
    }
    if (chain === undefined) throw new Error("No hotel chain was selected.");

    this.fillConnected(tile, chain);
    this.chainSizes[chain] = this.countBoardChain(chain);
    if (this.availableShares(chain) > 0) player.shares[chain] += 1;
    this.emit({ kind: "chainFounded", playerId: player.id, chain });
  }

  private async mergeChains(
    mergerPlayer: MutablePlayer,
    mergeTile: Tile,
    involvedChains: readonly HotelChain[]
  ): Promise<void> {
    const oldSizes = Object.fromEntries(involvedChains.map((chain) => [chain, this.chainSizes[chain]])) as Record<HotelChain, number>;
    const largestSize = Math.max(...involvedChains.map((chain) => oldSizes[chain]));
    const possibleSurvivors = involvedChains.filter((chain) => oldSizes[chain] === largestSize);
    this.emit({ kind: "chainsMerged", playerId: mergerPlayer.id, chains: [...involvedChains] });

    let survivor = possibleSurvivors[0];
    if (possibleSurvivors.length > 1) {
      const choice = await mergerPlayer.controller.determineMergeSurvivor(
        this.createGameState(mergerPlayer, "resolveMerge"),
        copyTile(mergeTile),
        [...possibleSurvivors]
      );
      survivor = this.selectByIndex(mergerPlayer, "determineMergeSurvivor", choice, possibleSurvivors);
      this.emit({ kind: "mergeSurvivorSelected", playerId: mergerPlayer.id, chain: survivor });
    }
    if (survivor === undefined) throw new Error("A merger survivor could not be selected.");

    const defunctChains = involvedChains.filter((chain) => chain !== survivor);
    this.fillConnected(mergeTile, survivor);
    this.chainSizes[survivor] = this.countBoardChain(survivor);

    for (const defunct of defunctChains) this.payBonuses(defunct, oldSizes[defunct]);

    const remaining = new Set(defunctChains);
    const sizesDescending = [...new Set(defunctChains.map((chain) => oldSizes[chain]))].sort((left, right) => right - left);
    for (const size of sizesDescending) {
      while (true) {
        const sameSized = HOTEL_CHAINS.filter((chain) => remaining.has(chain) && oldSizes[chain] === size);
        if (sameSized.length === 0) break;
        let defunct = sameSized[0];
        if (sameSized.length > 1) {
          const choice = await mergerPlayer.controller.determineChainToDisposeOfNext(
            this.createGameState(mergerPlayer, "resolveMerge"),
            copyTile(mergeTile),
            survivor,
            sameSized
          );
          defunct = this.selectByIndex(mergerPlayer, "determineChainToDisposeOfNext", choice, sameSized);
          this.emit({ kind: "defunctChainSelected", playerId: mergerPlayer.id, chain: defunct });
        }
        if (defunct === undefined) throw new Error("A defunct chain could not be selected.");
        await this.disposeDefunctShares(mergerPlayer, survivor, defunct, oldSizes[defunct]);
        remaining.delete(defunct);
      }
    }

    for (const defunct of defunctChains) this.chainSizes[defunct] = 0;
  }

  private payBonuses(chain: HotelChain, size: number): void {
    const payouts = calculateBonusPayouts(
      this.players.map((player) => ({ playerId: player.id, shares: player.shares[chain] })),
      chain,
      size
    );
    for (const payout of payouts) {
      const player = this.requirePlayer(payout.playerId);
      player.cash += payout.amount;
      this.emit({ kind: "bonusReceived", playerId: player.id, chain, amount: payout.amount });
    }
  }

  private async disposeDefunctShares(
    mergerPlayer: MutablePlayer,
    survivor: HotelChain,
    defunct: HotelChain,
    oldSize: number
  ): Promise<void> {
    for (let offset = 0; offset < this.players.length; offset += 1) {
      const playerIndex = (this.activePlayerIndex + offset) % this.players.length;
      const player = this.players[playerIndex];
      if (player === undefined || player.shares[defunct] === 0) continue;

      const initiallyOwned = player.shares[defunct];
      const maxTrade = Math.min(initiallyOwned - (initiallyOwned % 2), this.availableShares(survivor) * 2);
      const trade = await player.controller.determineHowManySharesToTradeInAfterMerge(
        this.createGameState(player, "disposeShares"),
        survivor,
        defunct,
        maxTrade
      );
      this.validateShareCount(player, "trade shares", trade, maxTrade, true);
      player.shares[defunct] -= trade;
      player.shares[survivor] += trade / 2;

      const remainingOwned = player.shares[defunct];
      const sell = await player.controller.determineHowManySharesToSell(
        this.createGameState(player, "disposeShares"),
        survivor,
        defunct,
        remainingOwned
      );
      this.validateShareCount(player, "sell shares", sell, remainingOwned, false);
      player.shares[defunct] -= sell;
      player.cash += sell * sharePrice(defunct, oldSize);
      this.emit({ kind: "sharesDisposed", playerId: player.id, chain: defunct, traded: trade, sold: sell });
    }

    // This makes an accidental change to turn ownership during asynchronous decisions obvious.
    if (this.players[this.activePlayerIndex]?.id !== mergerPlayer.id) {
      throw new Error("The active player changed while resolving a merger.");
    }
  }

  private async purchaseShares(player: MutablePlayer): Promise<Readonly<{ endedVoluntarily: boolean }>> {
    const canEnd = canEndGame(this.chainSizes);
    const activeWithShares = HOTEL_CHAINS.filter((chain) => this.chainSizes[chain] > 0 && this.availableShares(chain) > 0);
    const affordable = activeWithShares.filter((chain) => sharePrice(chain, this.chainSizes[chain]) <= player.cash);
    const couldNotAfford = activeWithShares.length > 0 && affordable.length === 0;
    if (affordable.length === 0 && !canEnd) {
      if (couldNotAfford) this.emit({ kind: "couldNotAffordShares", playerId: player.id });
      return { endedVoluntarily: false };
    }

    const decision = await player.controller.buy(this.createGameState(player, "buyShares"));
    this.validatePurchaseDecision(player, decision, canEnd);
    const purchase = decision.purchase;
    let cost = 0;
    for (const chain of HOTEL_CHAINS) {
      const amount = purchase[chain] ?? 0;
      player.shares[chain] += amount;
      cost += amount * sharePrice(chain, this.chainSizes[chain]);
    }
    player.cash -= cost;

    if (couldNotAfford) {
      this.emit({ kind: "couldNotAffordShares", playerId: player.id });
    } else {
      this.emit({ kind: "sharesPurchased", playerId: player.id, purchase: { ...purchase } });
    }
    if (decision.endGame) {
      this.emit({ kind: "gameEnded", playerId: player.id });
      return { endedVoluntarily: true };
    }
    return { endedVoluntarily: false };
  }

  private validatePurchaseDecision(player: MutablePlayer, decision: SharePurchaseDecision, canEnd: boolean): void {
    if (typeof decision !== "object" || decision === null || typeof decision.endGame !== "boolean") {
      throw this.invalidDecision(player, "buy", "A buy decision must contain a purchase and an endGame boolean.");
    }
    if (decision.endGame && !canEnd) {
      throw this.invalidDecision(player, "buy", "The game cannot be ended in the current board state.");
    }
    const purchase: unknown = decision.purchase;
    if (typeof purchase !== "object" || purchase === null || Array.isArray(purchase)) {
      throw this.invalidDecision(player, "buy", "The purchase must be an object keyed by hotel chain.");
    }
    const unknownChains = Object.keys(purchase).filter((chain) => !(HOTEL_CHAINS as readonly string[]).includes(chain));
    if (unknownChains.length > 0) {
      throw this.invalidDecision(player, "buy", `Unknown hotel chain in purchase: ${unknownChains[0]}.`);
    }

    let totalShares = 0;
    let totalCost = 0;
    for (const chain of HOTEL_CHAINS) {
      const amount = decision.purchase[chain] ?? 0;
      if (!Number.isInteger(amount) || amount < 0) {
        throw this.invalidDecision(player, "buy", `${chain} share count must be a non-negative integer.`);
      }
      if (amount > 0 && this.chainSizes[chain] === 0) {
        throw this.invalidDecision(player, "buy", `${chain} is not active.`);
      }
      if (amount > this.availableShares(chain)) {
        throw this.invalidDecision(player, "buy", `Only ${this.availableShares(chain)} ${chain} shares are available.`);
      }
      totalShares += amount;
      totalCost += amount * sharePrice(chain, this.chainSizes[chain]);
    }
    if (totalShares > MAX_SHARES_PER_TURN) {
      throw this.invalidDecision(player, "buy", `At most ${MAX_SHARES_PER_TURN} shares may be bought per turn.`);
    }
    if (totalCost > player.cash) {
      throw this.invalidDecision(player, "buy", `The purchase costs $${totalCost}, but the player has $${player.cash}.`);
    }
  }

  private classifyTile(tile: Tile): Placement {
    const neighboringOccupants = adjacentTiles(tile)
      .map((neighbor) => this.board.get(tileKey(neighbor))?.occupant)
      .filter((occupant): occupant is BoardOccupant => occupant !== undefined && occupant !== "dead");
    const chains = HOTEL_CHAINS.filter((chain) => neighboringOccupants.includes(chain));
    if (chains.length === 0) {
      if (neighboringOccupants.includes("independent")) {
        return HOTEL_CHAINS.some((chain) => this.countBoardChain(chain) === 0)
          ? { kind: "foundsChain" }
          : { kind: "temporarilyUnplayable" };
      }
      return { kind: "isolated" };
    }
    if (chains.length === 1) {
      const chain = chains[0];
      if (chain === undefined) throw new Error("A neighboring chain disappeared.");
      return { kind: "extendsChain", chain };
    }
    const safeChains = chains.filter((chain) => this.countBoardChain(chain) >= SAFE_CHAIN_SIZE);
    return safeChains.length >= 2
      ? { kind: "permanentlyUnplayable" }
      : { kind: "mergesChains", chains };
  }

  private replacePermanentlyUnplayableTiles(player: MutablePlayer): void {
    while (true) {
      const deadIndex = player.rack.findIndex((tile) => this.classifyTile(tile).kind === "permanentlyUnplayable");
      if (deadIndex < 0) return;
      const deadTile = player.rack[deadIndex];
      if (deadTile === undefined) throw new Error("A dead rack tile disappeared.");
      player.rack.splice(deadIndex, 1);
      this.setBoard(deadTile, "dead");
      this.emit({ kind: "deadTileReplaced", playerId: player.id, tile: copyTile(deadTile) });
      this.fillRack(player);
    }
  }

  private fillRack(player: MutablePlayer): void {
    while (player.rack.length < RACK_SIZE) {
      const tile = this.drawFromBag();
      if (tile === null) return;
      player.rack.push(tile);
      this.emit({ kind: "tileDrawn", playerId: player.id, tile: copyTile(tile) });
      if (this.bag.length === 0) this.emit({ kind: "lastTileDrawn", playerId: player.id });
    }
  }

  private drawFromBag(): Tile | null {
    return this.bag.pop() ?? null;
  }

  private fillConnected(start: Tile, chain: HotelChain): void {
    const pending = [start];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const tile = pending.pop();
      if (tile === undefined) continue;
      const key = tileKey(tile);
      if (visited.has(key)) continue;
      visited.add(key);
      const entry = this.board.get(key);
      if (entry === undefined || entry.occupant === "dead" || entry.occupant === chain) continue;
      entry.occupant = chain;
      for (const adjacent of adjacentTiles(tile)) pending.push(adjacent);
    }
  }

  private setBoard(tile: Tile, occupant: BoardOccupant): void {
    this.board.set(tileKey(tile), { tile: copyTile(tile), occupant });
  }

  private countBoardChain(chain: HotelChain): number {
    let count = 0;
    for (const entry of this.board.values()) if (entry.occupant === chain) count += 1;
    return count;
  }

  private availableShares(chain: HotelChain): number {
    return SHARES_PER_CHAIN - this.players.reduce((total, player) => total + player.shares[chain], 0);
  }

  private createGameState(
    viewer: MutablePlayer,
    phase: TurnPhase,
    suppliedValidTiles?: readonly Tile[],
    suppliedInvalidTiles?: readonly Tile[]
  ): GameState {
    const classifiedRack = viewer.rack.map((tile) => ({ tile, playable: isPlayable(this.classifyTile(tile)) }));
    const validTiles = suppliedValidTiles ?? classifiedRack.filter(({ playable }) => playable).map(({ tile }) => tile);
    const invalidTiles = suppliedInvalidTiles ?? classifiedRack.filter(({ playable }) => !playable).map(({ tile }) => tile);
    const publicPlayers: PlayerPublicState[] = this.players.map((player) => ({
      id: player.id,
      name: player.name,
      cash: player.cash,
      shares: { ...player.shares },
      handSize: player.rack.length
    }));
    const self: PlayerPrivateState = {
      id: viewer.id,
      name: viewer.name,
      cash: viewer.cash,
      shares: { ...viewer.shares },
      handSize: viewer.rack.length,
      tilesInHand: viewer.rack.map(copyTile),
      validTiles: validTiles.map(copyTile),
      invalidTiles: invalidTiles.map(copyTile)
    };
    const board: BoardCell[] = [...this.board.values()]
      .sort((left, right) => compareTiles(left.tile, right.tile))
      .map(({ tile, occupant }) => ({
        tile: copyTile(tile),
        chain: isHotelChain(occupant) ? occupant : null
      }));
    return {
      turnNumber: this.turnNumber,
      activePlayerId: this.players[this.activePlayerIndex]?.id ?? null,
      phase,
      board,
      players: publicPlayers,
      self,
      chains: this.createChainStates(),
      tilesRemaining: this.bag.length,
      canEndGame: canEndGame(this.chainSizes)
    };
  }

  private createChainStates(): Record<HotelChain, ChainState> {
    return Object.fromEntries(HOTEL_CHAINS.map((chain) => {
      const size = this.chainSizes[chain];
      const price = sharePrice(chain, size);
      return [chain, {
        chain,
        size,
        availableShares: this.availableShares(chain),
        price,
        majorityBonus: majorityBonus(chain, size),
        minorityBonus: minorityBonus(chain, size),
        isActive: size > 0,
        isSafe: size >= SAFE_CHAIN_SIZE
      }];
    })) as Record<HotelChain, ChainState>;
  }

  private calculateFinalScores(): FinalScore[] {
    const unsorted = this.players.map((player) => {
      let shareValue = 0;
      let bonusValue = 0;
      for (const chain of HOTEL_CHAINS) {
        const size = this.chainSizes[chain];
        if (size === 0) continue;
        shareValue += player.shares[chain] * sharePrice(chain, size);
        const payouts = calculateBonusPayouts(
          this.players.map((candidate) => ({ playerId: candidate.id, shares: candidate.shares[chain] })),
          chain,
          size
        );
        bonusValue += payouts.find((payout) => payout.playerId === player.id)?.amount ?? 0;
      }
      return {
        rank: 0,
        playerId: player.id,
        playerName: player.name,
        cash: player.cash,
        shareValue,
        bonusValue,
        score: player.cash + shareValue + bonusValue
      };
    }).sort((left, right) => right.score - left.score);

    let previousScore: number | null = null;
    let previousRank = 0;
    return unsorted.map((score, index) => {
      const rank = score.score === previousScore ? previousRank : index + 1;
      previousScore = score.score;
      previousRank = rank;
      return { ...score, rank };
    });
  }

  private selectByIndex<T>(
    player: MutablePlayer,
    decision: string,
    index: number,
    options: readonly T[]
  ): T {
    if (!Number.isInteger(index) || index < 0 || index >= options.length) {
      throw this.invalidDecision(
        player,
        decision,
        `Expected an integer option index from 0 through ${options.length - 1}; received ${String(index)}.`
      );
    }
    const selected = options[index];
    if (selected === undefined) throw new Error("A validated option index did not resolve to an option.");
    return selected;
  }

  private validateShareCount(
    player: MutablePlayer,
    decision: string,
    amount: number,
    maximum: number,
    mustBeEven: boolean
  ): void {
    if (!Number.isInteger(amount) || amount < 0 || amount > maximum || (mustBeEven && amount % 2 !== 0)) {
      const evenRequirement = mustBeEven ? " even" : "";
      throw this.invalidDecision(
        player,
        decision,
        `Expected an${evenRequirement} integer from 0 through ${maximum}; received ${String(amount)}.`
      );
    }
  }

  private invalidDecision(player: MutablePlayer, decision: string, message: string): InvalidPlayerDecisionError {
    return new InvalidPlayerDecisionError(player.id, decision, `${player.name}: ${message}`);
  }

  private requirePlayer(playerId: PlayerId): MutablePlayer {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (player === undefined) throw new Error(`Unknown player id ${playerId}.`);
    return player;
  }

  private allRacksEmpty(): boolean {
    return this.players.every((player) => player.rack.length === 0);
  }

  private emit(event: GameEvent): void {
    const entry: GameHistoryEntry = { id: `engine-event-${this.history.length + 1}`, event };
    this.history.push(entry);
    for (const listener of this.listeners) listener(copyHistoryEntry(entry));
  }

  private assertInvariants(): void {
    const tileLocations = [
      ...this.bag.map((tile) => ({ tile, location: "bag" })),
      ...this.players.flatMap((player) => player.rack.map((tile) => ({ tile, location: `${player.id} rack` }))),
      ...[...this.board.values()].map((entry) => ({ tile: entry.tile, location: "board" }))
    ];
    if (tileLocations.length !== TILE_COUNT) {
      throw new Error(`Tile conservation failed: found ${tileLocations.length} of ${TILE_COUNT} tiles.`);
    }
    const seenTiles = new Map<string, string>();
    for (const { tile, location } of tileLocations) {
      const key = tileKey(tile);
      const previous = seenTiles.get(key);
      if (previous !== undefined) throw new Error(`Tile ${key} exists in both ${previous} and ${location}.`);
      seenTiles.set(key, location);
    }
    for (const chain of HOTEL_CHAINS) {
      const available = this.availableShares(chain);
      if (!Number.isInteger(available) || available < 0 || available > SHARES_PER_CHAIN) {
        throw new Error(`${chain} share conservation failed; bank has ${available}.`);
      }
      const boardSize = this.countBoardChain(chain);
      if (this.chainSizes[chain] !== boardSize) {
        throw new Error(`${chain} size is ${this.chainSizes[chain]}, but the board contains ${boardSize} tiles.`);
      }
    }
    for (const player of this.players) {
      if (!Number.isInteger(player.cash) || player.cash < 0) {
        throw new Error(`${player.name} has invalid cash: ${player.cash}.`);
      }
      if (player.rack.length > RACK_SIZE) throw new Error(`${player.name} has too many tiles.`);
    }
  }
}

export function createSeededRandom(seed: number): RandomSource {
  let state = normalizeSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) throw new RangeError("The random seed must be a finite number.");
  return Math.trunc(seed) >>> 0;
}

function checkedRandom(random: RandomSource): RandomSource {
  return () => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError(`Random sources must return a value in [0, 1); received ${String(value)}.`);
    }
    return value;
  };
}

function shuffle<T>(values: readonly T[], random: RandomSource): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    const other = shuffled[otherIndex];
    if (current === undefined || other === undefined) throw new Error("Shuffle index was out of range.");
    shuffled[index] = other;
    shuffled[otherIndex] = current;
  }
  return shuffled;
}

function emptyChainNumbers(): Record<HotelChain, number> {
  return Object.fromEntries(HOTEL_CHAINS.map((chain) => [chain, 0])) as Record<HotelChain, number>;
}

function isPlayable(placement: Placement): boolean {
  return placement.kind !== "temporarilyUnplayable" && placement.kind !== "permanentlyUnplayable";
}

function isHotelChain(occupant: BoardOccupant): occupant is HotelChain {
  return (HOTEL_CHAINS as readonly string[]).includes(occupant);
}

function copyTile(tile: Tile): Tile {
  return { row: tile.row, column: tile.column };
}

function copyHistoryEntry(entry: GameHistoryEntry): GameHistoryEntry {
  return typeof structuredClone === "function" ? structuredClone(entry) : JSON.parse(JSON.stringify(entry)) as GameHistoryEntry;
}

function copyFinalScore(score: FinalScore): FinalScore {
  return { ...score };
}
