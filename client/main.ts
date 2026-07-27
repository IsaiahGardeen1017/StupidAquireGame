import "./styles/main.scss";

import {
  HOTEL_CHAINS,
  type BoardCellContent,
  type DisposeSharesDecisionRequest,
  type GameEvent,
  type GameSession,
  type GameSessionSnapshot,
  type HotelChain,
  type SharePurchase,
  type TilePlacementKind,
  type TileRackEntry
} from "../src/index.js";
import { createInitialState } from "./state.js";
import {
  TlstyerOnlineClient,
  type TlstyerErrorCode,
  type TlstyerLobbyGame
} from "./tlstyer/TlstyerOnlineClient.js";

type RuntimeConfig = {
  proxyOrigin: string;
  liveServerUrl: string;
  version: string;
};

type ScrollAnchor = {
  scrollTop: number;
  distanceFromBottom: number;
  wasAtBottom: boolean;
};

const SPLASH_IMAGE_URLS = [
  new URL("../Assets/hotelExteriorSplash.png", import.meta.url).href
] as const;

const appState = createInitialState();
const appElement = document.querySelector<HTMLDivElement>("#app");
if (appElement === null) throw new Error("App container was not found.");
const app = appElement;

const onlineClient = new TlstyerOnlineClient(window.location.origin);
const scrollAnchors = new Map<string, ScrollAnchor>();
const selectedSplashImageUrl = SPLASH_IMAGE_URLS[Math.floor(Math.random() * SPLASH_IMAGE_URLS.length)];
let runtimeConfigPromise: Promise<RuntimeConfig> | null = null;
let pendingCredentialSubmission: { username: string; password: string } | null = null;
let activeGameSession: GameSession | null = null;
let unsubscribeFromGame: (() => void) | null = null;
let activeDecisionId: string | null = null;
let purchaseShareCart: Array<HotelChain | null> = [null, null, null];
let purchaseShareEndGame = false;
let disposeTradeShares = 0;
let disposeSellShares = 0;

onlineClient.subscribe((snapshot) => {
  const previousUsername = appState.selfUsername;
  appState.selfClientId = snapshot.selfClientId;
  appState.selfUsername = snapshot.selfUsername;
  appState.clients = { ...snapshot.clients };
  appState.lobbyClientIds = [...snapshot.lobbyClientIds];
  appState.games = { ...snapshot.games };
  appState.globalChat = [...snapshot.globalChat];
  appState.connectionStatus = snapshot.status === "connecting"
    ? "connecting"
    : snapshot.status === "connected"
      ? snapshot.activeGame === null ? "lobby" : "game"
      : "welcome";

  if (snapshot.error !== null) {
    appState.errorMessage = errorMessageFor(snapshot.error);
    pendingCredentialSubmission = null;
  } else if (snapshot.status !== "disconnected") {
    appState.errorMessage = null;
  }

  if (snapshot.status === "disconnected") {
    appState.selectedGameId = null;
    appState.enteringGameId = null;
    appState.lobbyCollapsed = false;
  }

  if (previousUsername === null && snapshot.selfUsername !== null && pendingCredentialSubmission !== null) {
    void storeBrowserCredential(snapshot.selfUsername, pendingCredentialSubmission.password);
    pendingCredentialSubmission = null;
  }

  bindGameSession(snapshot.activeGame);
  if (snapshot.activeGame !== null) {
    appState.enteringGameId = null;
    appState.lobbyCollapsed = true;
  } else if (appState.connectionStatus === "lobby") {
    appState.enteringGameId = null;
  }
  render();
});

function bindGameSession(session: GameSession | null) {
  if (activeGameSession === session) return;
  const hadSession = activeGameSession !== null;
  unsubscribeFromGame?.();
  unsubscribeFromGame = null;
  activeGameSession = session;
  appState.liveGame = null;
  activeDecisionId = null;
  resetDecisionDrafts();

  if (session === null) {
    if (hadSession) appState.lobbyCollapsed = false;
    return;
  }
  unsubscribeFromGame = session.subscribe((snapshot) => {
    applyGameSnapshot(snapshot);
    render();
  });
}

function applyGameSnapshot(snapshot: GameSessionSnapshot) {
  const decisionId = snapshot.pendingDecision?.id ?? null;
  if (decisionId !== activeDecisionId) {
    activeDecisionId = decisionId;
    resetDecisionDrafts();
  }
  appState.liveGame = snapshot;
}

function render() {
  snapshotScrollAnchors();
  const showSessionLayout = appState.connectionStatus === "lobby" || appState.connectionStatus === "game";
  const showSidebarCollapse = showSessionLayout;
  const showLogout = appState.connectionStatus === "connecting" || showSessionLayout;
  const showSplashScreen = appState.connectionStatus === "welcome" || appState.connectionStatus === "connecting";
  app.innerHTML = `
    <div class="shell ${showSessionLayout ? "shell--session" : ""} ${showSidebarCollapse && appState.lobbyCollapsed ? "shell--sidebar-collapsed" : ""}">
      <aside class="sidebar ${showSidebarCollapse ? "sidebar--collapsible" : ""}">
        <div class="sidebar-header">
          <div class="sidebar-brand">
            ${showSplashScreen || (showSidebarCollapse && appState.lobbyCollapsed) ? "" : "<h1>Acquire</h1>"}
            ${showSidebarCollapse && !appState.lobbyCollapsed && appState.selfUsername !== null ? `<p class="sidebar-user">${escapeHtml(appState.selfUsername)}</p>` : ""}
          </div>
          <div class="sidebar-header-actions">
            ${showSidebarCollapse && !appState.lobbyCollapsed ? `<button id="toggle-lobby" class="sidebar-toggle" type="button" aria-expanded="true" aria-label="Collapse left panel">«</button>` : ""}
          </div>
        </div>
        ${showSidebarCollapse && appState.lobbyCollapsed ? "" : renderConnectionPanel()}
        ${renderLobbyPanel()}
        ${showLogout && !appState.lobbyCollapsed ? `<div class="sidebar-footer"><button id="logout" class="sidebar-action-button sidebar-action-button--footer" type="button">Log Out</button></div>` : ""}
      </aside>
      <main class="main-panel ${showSplashScreen ? "main-panel--splash" : ""} ${appState.connectionStatus === "lobby" && appState.liveGame === null ? "main-panel--lobby" : ""}">
        ${renderGamePanel()}
      </main>
    </div>`;
  wireEvents();
  restoreScrollAnchors();
}

function renderConnectionPanel() {
  if (appState.connectionStatus === "connecting") {
    return `<section class="panel"><h2>Connection</h2><p>Connecting through the local proxy...</p></section>`;
  }
  if (appState.connectionStatus === "lobby" || appState.connectionStatus === "game") return "";
  return `
    <div class="entry-panels">
      <section class="panel hero-panel">
        <h2>Log In</h2>
        <p class="muted">Use the same login as acquire.tlstyer.com</p>
        ${appState.errorMessage === null ? "" : `<p class="error">${escapeHtml(appState.errorMessage)}</p>`}
        <form id="login-form" class="stack" autocomplete="on">
          <label>Username<input id="username" name="username" type="text" maxlength="32" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" /></label>
          <label>Password<input id="password" name="password" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" /></label>
          <button type="submit">Connect</button>
        </form>
      </section>
      <section class="panel entry-side-panel">
        <h2>Local Play</h2>
        <p class="muted">Use this when local games are ready.</p>
        <button id="show-local-play" type="button">Play Locally</button>
      </section>
    </div>`;
}

function renderLobbyPanel() {
  if ((appState.connectionStatus !== "lobby" && appState.connectionStatus !== "game") || appState.lobbyCollapsed) return "";
  const clients = appState.lobbyClientIds
    .map((id) => appState.clients[id])
    .filter((client): client is NonNullable<typeof client> => client !== undefined)
    .map((client) => `<li class="player-list-item">${escapeHtml(client.username)}</li>`)
    .join("");
  return `
    <section class="panel lobby-panel">
      <div class="lobby-panel-body">
        <div class="lobby-meta"><h3>Players <span class="lobby-count">${appState.lobbyClientIds.length}</span></h3></div>
        <section class="lobby-box"><div class="lobby-scroll" data-scroll-key="lobby-players"><ul class="player-list">${clients || '<li class="muted">No visible lobby clients yet.</li>'}</ul></div></section>
        <section class="lobby-box lobby-chat-box"><h3>Lobby Chat</h3><div class="lobby-scroll" data-scroll-key="lobby-chat" data-stick-to-bottom="true"><div class="chat-feed">${renderGlobalChat()}</div></div></section>
      </div>
    </section>`;
}

function renderGamePanel() {
  if (appState.enteringGameId !== null && appState.liveGame === null) {
    return `<section class="panel wide empty-state"><h2>Opening Game #${appState.enteringGameId}</h2><p>Waiting for the server to finish opening the game view.</p></section>`;
  }
  if (appState.connectionStatus === "welcome" || appState.connectionStatus === "connecting") {
    return `<section class="splash-panel" style="background-image: linear-gradient(180deg, rgba(22, 20, 17, 0.08), rgba(22, 20, 17, 0.28)), url('${selectedSplashImageUrl}');"><div class="splash-panel-copy"><h2>ACQUIRE</h2></div></section>`;
  }
  const game = appState.liveGame;
  if (game === null) {
    return appState.connectionStatus === "lobby"
      ? renderLobbyMainPanel()
      : `<section class="panel wide empty-state"><h2>Welcome</h2><p>Choose whether to log in online or play locally. Local play is not implemented yet.</p></section>`;
  }
  const actionRequired = game.viewerPlayerId !== null && game.currentAction?.playerId === game.viewerPlayerId;
  return `
    <section class="game-screen">
      <div class="game-screen-grid">
        <section class="board-column">
          <div class="board-wrap">${renderBoard(game)}</div>
          <div class="game-status ${actionRequired ? "game-status--action-required" : ""}" role="status" aria-live="polite">${renderStatus(game)}</div>
          <div class="message-panels game-bottom-panels">
            <section class="message-panel"><h3>Game History</h3><div class="message-scroll" data-scroll-key="game-history" data-stick-to-bottom="true">${renderHistory(game)}</div></section>
            <section class="message-panel"><h3>Game Chat</h3><div class="message-scroll" data-scroll-key="game-chat">${renderChat(game)}</div></section>
          </div>
        </section>
        <section class="side-column">
          <div class="panel compact-panel score-panel"><h3>Score Sheet</h3><div class="score-scroll">${renderScoreSheet(game)}</div></div>
          <div class="panel compact-panel decision-panel ${game.pendingDecision?.kind === "buyShares" ? "decision-panel--buy" : ""}">${renderDecisionPanel(game)}</div>
          <div class="panel compact-panel tile-rack-panel"><h3>Tile Rack</h3><div class="tile-rack-frame"><div class="tile-rack">${renderTileRack(game)}</div></div></div>
          ${game.capabilities.canLeave ? `<button id="leave-game" class="leave-game-button" type="button">Leave Game</button>` : ""}
        </section>
      </div>
    </section>`;
}

function renderLobbyMainPanel() {
  const games = Object.values(appState.games).sort((a, b) => a.gameId - b.gameId).map(renderLobbyGameCard).join("");
  return `<section class="lobby-main-panel"><div class="lobby-main-games" data-scroll-key="lobby-games"><div class="game-list">${games || "<p>No games yet.</p>"}</div></div></section>`;
}

function renderLobbyGameCard(game: TlstyerLobbyGame) {
  const selfIsInGame = isSelfInLobbyGame(game.gameId);
  const players = game.players.map((player) => `<span class="game-player ${player.clientId === null ? "missing" : ""}">${escapeHtml(player.username)}</span>`).join('<span class="game-player-separator">•</span>');
  return `
    <article class="game-card ${selfIsInGame ? "game-card--rejoin" : "game-card--spectate"} ${appState.selectedGameId === game.gameId ? "selected" : ""}">
      <div class="game-card-row"><strong>Game #${game.gameId}</strong><span class="game-card-state">${describeLobbyGame(game)}</span></div>
      <div class="game-card-row game-card-row--detail">
        <div class="game-card-players">${players || '<span class="muted">No players</span>'}</div>
        <div class="actions">
          ${game.state === "starting" && !selfIsInGame ? `<button data-action="join" data-game-id="${game.gameId}">Join</button>` : ""}
          ${selfIsInGame ? `<button data-action="rejoin" data-game-id="${game.gameId}">Rejoin</button>` : `<button data-action="watch" data-game-id="${game.gameId}">Spectate</button>`}
        </div>
      </div>
    </article>`;
}

function renderStatus(game: GameSessionSnapshot) {
  const action = game.currentAction;
  if (action === null) return "Waiting for game data.";
  const actor = action.playerId === null
    ? "server"
    : action.playerId === game.viewerPlayerId
      ? "You"
      : game.players.find((player) => player.id === action.playerId)?.name ?? `Player ${Number(action.playerId) + 1}`;
  const description = describeGameAction(action.kind);
  return action.playerId === null ? `Game status: ${description}.` : `${escapeHtml(actor)} needs to ${description}.`;
}

function renderBoard(game: GameSessionSnapshot) {
  const cells = Array.from({ length: 9 }, (_, y) => Array.from({ length: 12 }, (_, x) => {
    const cell = game.board.find((entry) => entry.tile.column === x + 1 && entry.tile.row === String.fromCharCode(65 + y));
    if (cell === undefined) return `<div class="board-cell board-cell--missing"></div>`;
    const inHand = findTileRackIndexForCoordinate(game, x, y) !== null;
    return `<button class="board-cell ${boardContentClassName(cell.content)} ${inHand ? "board-cell--in-hand" : ""}" data-x="${x}" data-y="${y}" title="${tileName(x, y)}"><span>${boardCellLabel(cell.content, x, y)}</span></button>`;
  }).join("")).join("");
  return `<div class="board-grid">${cells}</div>`;
}

function renderTileRack(game: GameSessionSnapshot) {
  if (game.tileRack.every((entry) => entry === null)) return `<p class="muted">No tiles in rack.</p>`;
  return game.tileRack.map((entry, index) => entry === null ? "" : `<button class="tile ${tilePlacementClassName(entry)}" ${mergeTileStyle(game, entry)} data-tile-index="${index}">${entry.tile.column}${entry.tile.row}</button>`).join("");
}

function renderDecisionPanel(game: GameSessionSnapshot) {
  const pending = game.pendingDecision;
  if (pending === null || pending.kind === "playTile") return renderPurchasePanel(game, false);
  if (pending.kind === "selectChain") return renderChainSelectionPanel(pending.chains);
  if (pending.kind === "disposeShares") return renderDisposeSharesPanel(game, pending);
  return renderPurchasePanel(game, true);
}

function renderChainSelectionPanel(chains: readonly HotelChain[]) {
  return `<div class="purchase-panel chain-select-panel"><section class="purchase-section"><h4>Select Chain</h4><div class="purchase-available-grid">${HOTEL_CHAINS.map((chain) => {
    const available = chains.includes(chain);
    return `<div class="purchase-option"><div class="purchase-option-label">${chain}</div><button class="purchase-share-button purchase-share-button--${chain.toLowerCase()} ${available ? "" : "purchase-share-button--inactive"}" type="button" data-chain="${chain}" ${available ? "" : "disabled"}><span class="purchase-share-price ${available ? "" : "purchase-share-price--inactive"}">${chain[0]}</span><span class="purchase-share-meta">${available ? "Select" : "-"}</span></button></div>`;
  }).join("")}</div></section>${renderDecisionPlaceholder()}</div>`;
}

function renderDecisionPlaceholder() {
  return `<div class="purchase-row purchase-row--placeholder" aria-hidden="true"><section class="purchase-section purchase-cart"><h4>Cart</h4><div class="purchase-cart-slots">${Array.from({ length: 3 }, () => `<div class="purchase-cart-slot purchase-cart-slot--empty">Empty</div>`).join("")}</div></section><section class="purchase-section purchase-cost"><h4>Cost</h4><dl class="purchase-cost-list"><div><dt>Total</dt><dd>0</dd></div><div><dt>Left</dt><dd>0</dd></div></dl></section><div class="purchase-buy"><button type="button" disabled>Buy</button></div></div>`;
}

function renderDisposeSharesPanel(game: GameSessionSnapshot, pending: DisposeSharesDecisionRequest) {
  const summary = getDisposeShareSummary(pending);
  const surviving = game.players.find((player) => player.id === game.viewerPlayerId)?.shares[pending.survivingChain] ?? 0;
  const salePrice = game.chains[pending.defunctChain].price;
  const mergeIndex = HOTEL_CHAINS.indexOf(pending.defunctChain);
  const survivingIndex = HOTEL_CHAINS.indexOf(pending.survivingChain);
  return `
    <div class="merge-panel"><h4>Resolve Merger</h4><p class="merge-copy">${pending.defunctChain} into ${pending.survivingChain}</p>
      <div class="merge-adjust-grid">
        <section class="merge-adjust-card merge-adjust-card--chain ${survivingIndex === 2 || survivingIndex === 4 ? "merge-adjust-card--dark" : ""}" style="background: ${hotelChainColor(survivingIndex)}"><h5>Trade 2 for 1</h5><div class="merge-adjust-value merge-adjust-value--detail">Trade ${summary.trade} <span>(total ${surviving + summary.trade / 2})</span></div><div class="merge-adjust-actions"><button type="button" data-dispose-trade-adjust="-2" ${summary.trade === 0 ? "disabled" : ""}>-2</button><button type="button" data-dispose-trade-adjust="2" ${summary.trade >= pending.maxTrade ? "disabled" : ""}>+2</button></div><p class="merge-adjust-meta">Max ${pending.maxTrade}</p></section>
        <section class="merge-adjust-card"><h5>Sell</h5><div class="merge-adjust-value merge-adjust-value--detail">${summary.sell} <span>(+$${(summary.sell * salePrice).toLocaleString()})</span></div><div class="merge-adjust-actions"><button type="button" data-dispose-sell-adjust="-1" ${summary.sell === 0 ? "disabled" : ""}>-1</button><button type="button" data-dispose-sell-adjust="1" ${summary.sell >= summary.sellCap ? "disabled" : ""}>+1</button></div><p class="merge-adjust-meta">Max ${summary.sellCap}</p></section>
        <section class="merge-adjust-card merge-adjust-card--summary merge-adjust-card--chain ${mergeIndex === 2 || mergeIndex === 4 ? "merge-adjust-card--dark" : ""}" style="background: ${hotelChainColor(mergeIndex)}"><h5>Keep</h5><div class="merge-adjust-value">${summary.keep}</div><div class="merge-adjust-summary"><div><span>Trade</span><strong>${summary.trade}</strong></div><div><span>Sell</span><strong>${summary.sell}</strong></div></div></section>
      </div><div class="merge-submit-row"><button id="dispose-submit" type="button">Submit share disposal</button></div>
    </div>`;
}

type BuySummaryEntry = { chain: HotelChain; available: number; price: number; isPurchasable: boolean };

function getBuySummary(game: GameSessionSnapshot): BuySummaryEntry[] {
  return HOTEL_CHAINS.map((chain) => {
    const state = game.chains[chain];
    return { chain, available: state.availableShares, price: state.price, isPurchasable: state.isActive && state.availableShares > 0 && state.price > 0 };
  });
}

function renderPurchasePanel(game: GameSessionSnapshot, showCart: boolean) {
  const entries = getBuySummary(game);
  const totals = getPurchaseCartSummary(game, entries);
  const pending = game.pendingDecision?.kind === "buyShares" ? game.pendingDecision : null;
  return `<div class="purchase-panel"><section class="purchase-section"><h4>Available</h4><div class="purchase-available-grid">${entries.map((entry) => {
    const disabled = !showCart || isPurchaseOptionDisabled(game, entry, entries);
    return `<div class="purchase-option"><div class="purchase-option-label">${entry.chain}</div><button class="purchase-share-button purchase-share-button--${entry.chain.toLowerCase()} ${entry.isPurchasable ? "" : "purchase-share-button--inactive"}" type="button" data-buy-chain="${entry.chain}" ${disabled ? "disabled" : ""}><span class="purchase-share-price ${entry.isPurchasable ? "" : "purchase-share-price--inactive"}">${entry.isPurchasable ? `$${entry.price}` : "-"}</span><span class="purchase-share-meta">${entry.available} left</span></button></div>`;
  }).join("")}</div></section>${showCart ? `<div class="purchase-row"><section class="purchase-section purchase-cart"><h4>Cart</h4><div class="purchase-cart-slots">${purchaseShareCart.map((chain, index) => renderPurchaseCartSlot(chain, index, entries)).join("")}</div></section><section class="purchase-section purchase-cost"><h4>Cost</h4><dl class="purchase-cost-list"><div><dt>Total</dt><dd>${totals.totalSpent}</dd></div><div><dt>Left</dt><dd>${totals.cashLeft}</dd></div></dl></section><div class="purchase-buy"><button id="buy-submit" type="button">${purchaseShareCart.every((entry) => entry === null) ? "Pass" : "Buy"}</button></div></div>${pending?.canEndGame ? `<div class="purchase-actions"><label class="purchase-endgame"><input id="buy-end-game" type="checkbox" ${purchaseShareEndGame ? "checked" : ""} /> End game</label></div>` : ""}` : `<div class="purchase-panel-spacer"></div>`}</div>`;
}

function renderPurchaseCartSlot(chain: HotelChain | null, index: number, entries: BuySummaryEntry[]) {
  if (chain === null) return `<button class="purchase-cart-slot purchase-cart-slot--empty" type="button" disabled>Empty</button>`;
  const entry = entries.find((value) => value.chain === chain);
  return entry === undefined ? "" : `<button class="purchase-cart-slot purchase-cart-slot--${chain.toLowerCase()}" type="button" data-buy-cart-index="${index}"><span>${entry.price}</span></button>`;
}

function renderScoreSheet(game: GameSessionSnapshot) {
  const playerRows = game.players.map((player) => [...HOTEL_CHAINS.map((chain) => player.shares[chain]), player.cash, player.netWorth]);
  const headers = HOTEL_CHAINS.map((chain) => `<th class="score-chain score-chain--${chain.toLowerCase()}">${chain[0]}</th>`).join("");
  const rows = game.players.map((player, playerIndex) => `<tr class="${player.id === game.activePlayerId ? "active-player-row" : ""}"><th>${escapeHtml(player.name)}</th>${HOTEL_CHAINS.map((_, chainIndex) => `<td class="${sharePlacementClass(playerRows, playerIndex, chainIndex)}">${playerRows[playerIndex]?.[chainIndex] ?? ""}</td>`).join("")}<td>${formatMoney(player.cash)}</td><td class="${finalScorePlacementClass(playerRows, playerIndex)}">${formatMoney(player.netWorth)}</td></tr>`).join("");
  const summaries = [
    { label: "Price ($00)", values: HOTEL_CHAINS.map((chain) => game.chains[chain].price / 100) },
    { label: "Chain Size", values: HOTEL_CHAINS.map((chain) => game.chains[chain].size) },
    { label: "Available", values: HOTEL_CHAINS.map((chain) => game.chains[chain].availableShares) }
  ].map((row) => `<tr class="summary-row"><th>${row.label}</th>${row.values.map((value) => `<td>${value || row.label === "Available" ? value : "-"}</td>`).join("")}<td></td><td></td></tr>`).join("");
  return `<table class="score-sheet"><thead><tr><th>Player</th>${headers}<th>Cash</th><th>Net</th></tr></thead><tbody>${rows}${summaries}</tbody></table>`;
}

function renderHistory(game: GameSessionSnapshot) {
  const visibleHistory = game.history.filter((entry) => entry.event.kind !== "turnBegan");
  if (visibleHistory.length === 0) return `<p class="muted">No history yet.</p>`;
  return visibleHistory.map((entry) => `<div class="history-line">${formatGameEvent(game, entry.event)}</div>`).join("");
}

function renderChat(game: GameSessionSnapshot) {
  if (game.chat.length === 0) return `<p class="muted">No game chat yet.</p>`;
  return game.chat.map((entry) => `<div class="chat-line">${escapeHtml(entry.senderName)}: ${escapeHtml(entry.message)}</div>`).join("");
}

function renderGlobalChat() {
  return appState.globalChat.map((entry) => `<div class="chat-line">${escapeHtml(entry.senderName)}: ${escapeHtml(entry.message)}</div>`).join("");
}

function wireEvents() {
  document.querySelector<HTMLButtonElement>("#show-local-play")?.addEventListener("click", () => {
    appState.errorMessage = "Local play is not implemented yet.";
    render();
  });
  document.querySelector<HTMLButtonElement>("#logout")?.addEventListener("click", () => {
    pendingCredentialSubmission = null;
    onlineClient.disconnect();
  });
  document.querySelector<HTMLButtonElement>("#toggle-lobby")?.addEventListener("click", (event) => {
    event.stopPropagation();
    appState.lobbyCollapsed = !appState.lobbyCollapsed;
    render();
  });
  document.querySelector<HTMLElement>(".sidebar--collapsible")?.addEventListener("click", () => {
    if (appState.lobbyCollapsed) {
      appState.lobbyCollapsed = false;
      render();
    }
  });
  document.querySelector<HTMLButtonElement>("#leave-game")?.addEventListener("click", () => void executeSessionCommand({ kind: "leave" }));
  document.querySelector<HTMLFormElement>("#login-form")?.addEventListener("submit", handleLogin);
  wireLobbyGameActions();
  document.querySelectorAll<HTMLButtonElement>("[data-tile-index]").forEach((button) => button.addEventListener("click", () => submitTile(Number(button.dataset.tileIndex))));
  document.querySelectorAll<HTMLButtonElement>(".board-cell[data-x][data-y]").forEach((button) => button.addEventListener("click", () => submitTileAtCoordinate(Number(button.dataset.x), Number(button.dataset.y))));
  document.querySelectorAll<HTMLButtonElement>("[data-chain]").forEach((button) => button.addEventListener("click", () => submitChain(button.dataset.chain as HotelChain)));
  document.querySelectorAll<HTMLButtonElement>("[data-dispose-trade-adjust]").forEach((button) => button.addEventListener("click", () => { adjustDisposeTrade(Number(button.dataset.disposeTradeAdjust)); render(); }));
  document.querySelectorAll<HTMLButtonElement>("[data-dispose-sell-adjust]").forEach((button) => button.addEventListener("click", () => { adjustDisposeSell(Number(button.dataset.disposeSellAdjust)); render(); }));
  document.querySelector<HTMLButtonElement>("#dispose-submit")?.addEventListener("click", submitDisposeShares);
  document.querySelectorAll<HTMLButtonElement>("[data-buy-chain]").forEach((button) => button.addEventListener("click", () => { addShareToCart(button.dataset.buyChain as HotelChain); render(); }));
  document.querySelectorAll<HTMLButtonElement>("[data-buy-cart-index]").forEach((button) => button.addEventListener("click", () => { purchaseShareCart[Number(button.dataset.buyCartIndex)] = null; render(); }));
  document.querySelector<HTMLInputElement>("#buy-end-game")?.addEventListener("change", (event) => { if (event.currentTarget instanceof HTMLInputElement) purchaseShareEndGame = event.currentTarget.checked; });
  document.querySelector<HTMLButtonElement>("#buy-submit")?.addEventListener("click", submitPurchase);
}

function wireLobbyGameActions() {
  for (const action of ["join", "watch", "rejoin"] as const) {
    document.querySelectorAll<HTMLButtonElement>(`[data-action='${action}']`).forEach((button) => button.addEventListener("click", () => {
      const gameId = Number(button.dataset.gameId);
      appState.selectedGameId = gameId;
      appState.enteringGameId = gameId;
      appState.lobbyCollapsed = true;
      render();
      if (action === "join") onlineClient.joinGame(gameId);
      else if (action === "watch") onlineClient.watchGame(gameId);
      else onlineClient.rejoinGame(gameId);
    }));
  }
}

async function handleLogin(event: SubmitEvent) {
  event.preventDefault();
  const username = document.querySelector<HTMLInputElement>("#username")?.value.trim() ?? "";
  const password = document.querySelector<HTMLInputElement>("#password")?.value ?? "";
  if (username.length === 0 || username.length > 32) {
    appState.errorMessage = errorMessageFor("invalidUsername");
    render();
    return;
  }
  pendingCredentialSubmission = { username, password };
  appState.errorMessage = null;
  appState.connectionStatus = "connecting";
  render();
  try {
    const config = await loadRuntimeConfig();
    onlineClient.connect(username, await hashPassword(username, password), config.version);
  } catch (error) {
    pendingCredentialSubmission = null;
    appState.connectionStatus = "welcome";
    appState.errorMessage = error instanceof Error ? error.message : "Failed to prepare the local proxy connection.";
    render();
  }
}

function submitTile(slot: number) {
  const game = appState.liveGame;
  const pending = game?.pendingDecision;
  const entry = game?.tileRack[slot];
  if (pending?.kind !== "playTile" || entry === null || entry === undefined || !pending.playableTiles.some((tile) => tilesMatch(tile, entry.tile))) return;
  void executeSessionCommand({ kind: "submitDecision", requestId: pending.id, decision: { kind: "playTile", tile: entry.tile } });
}

function submitTileAtCoordinate(x: number, y: number) {
  const game = appState.liveGame;
  if (game === null) return;
  const slot = findTileRackIndexForCoordinate(game, x, y);
  if (slot !== null) submitTile(slot);
}

function submitChain(chain: HotelChain) {
  const pending = appState.liveGame?.pendingDecision;
  if (pending?.kind !== "selectChain" || !pending.chains.includes(chain)) return;
  void executeSessionCommand({ kind: "submitDecision", requestId: pending.id, decision: { kind: "selectChain", chain } });
}

function submitDisposeShares() {
  const pending = appState.liveGame?.pendingDecision;
  if (pending?.kind !== "disposeShares") return;
  const summary = getDisposeShareSummary(pending);
  void executeSessionCommand({ kind: "submitDecision", requestId: pending.id, decision: { kind: "disposeShares", trade: summary.trade, sell: summary.sell } });
}

function submitPurchase() {
  const pending = appState.liveGame?.pendingDecision;
  if (pending?.kind !== "buyShares") return;
  const purchase: SharePurchase = {};
  for (const chain of purchaseShareCart) if (chain !== null) purchase[chain] = (purchase[chain] ?? 0) + 1;
  void executeSessionCommand({ kind: "submitDecision", requestId: pending.id, decision: { kind: "buyShares", purchase, endGame: purchaseShareEndGame } });
}

async function executeSessionCommand(command: Parameters<GameSession["execute"]>[0]) {
  if (activeGameSession === null) return;
  try {
    await activeGameSession.execute(command);
  } catch (error) {
    appState.errorMessage = error instanceof Error ? error.message : "The game command could not be completed.";
    render();
  }
}

function adjustDisposeTrade(delta: number) {
  const pending = appState.liveGame?.pendingDecision;
  if (pending?.kind !== "disposeShares") return;
  const next = Math.max(0, Math.min(disposeTradeShares + delta, pending.maxTrade));
  disposeTradeShares = next - next % 2;
  disposeSellShares = Math.min(disposeSellShares, pending.ownedShares - disposeTradeShares);
}

function adjustDisposeSell(delta: number) {
  const pending = appState.liveGame?.pendingDecision;
  if (pending?.kind !== "disposeShares") return;
  const cap = pending.ownedShares - disposeTradeShares;
  disposeSellShares = Math.max(0, Math.min(disposeSellShares + delta, cap));
}

function getDisposeShareSummary(pending: DisposeSharesDecisionRequest) {
  const trade = Math.max(0, Math.min(disposeTradeShares, pending.maxTrade));
  const sellCap = Math.max(0, pending.ownedShares - trade);
  const sell = Math.max(0, Math.min(disposeSellShares, sellCap));
  return { trade, sell, sellCap, keep: pending.ownedShares - trade - sell };
}

function addShareToCart(chain: HotelChain) {
  const game = appState.liveGame;
  const pending = game?.pendingDecision;
  if (game === null || pending?.kind !== "buyShares") return;
  const entries = getBuySummary(game);
  const entry = entries.find((value) => value.chain === chain);
  if (entry === undefined || isPurchaseOptionDisabled(game, entry, entries)) return;
  const index = purchaseShareCart.indexOf(null);
  if (index >= 0) purchaseShareCart[index] = chain;
}

function getPurchaseCartSummary(game: GameSessionSnapshot, entries: BuySummaryEntry[]) {
  const cash = game.players.find((player) => player.id === game.viewerPlayerId)?.cash ?? 0;
  const counts = new Map<HotelChain, number>();
  let totalSpent = 0;
  let selectedCount = 0;
  for (const chain of purchaseShareCart) {
    if (chain === null) continue;
    counts.set(chain, (counts.get(chain) ?? 0) + 1);
    totalSpent += entries.find((entry) => entry.chain === chain)?.price ?? 0;
    selectedCount += 1;
  }
  return { cash, totalSpent, cashLeft: cash - totalSpent, selectedCount, counts };
}

function isPurchaseOptionDisabled(game: GameSessionSnapshot, entry: BuySummaryEntry, entries: BuySummaryEntry[]) {
  const summary = getPurchaseCartSummary(game, entries);
  const pending = game.pendingDecision?.kind === "buyShares" ? game.pendingDecision : null;
  const option = pending?.options.find((value) => value.chain === entry.chain);
  return pending === null || !entry.isPurchasable || option === undefined || summary.selectedCount >= pending.maxShares || summary.cashLeft < entry.price || (summary.counts.get(entry.chain) ?? 0) >= option.available;
}

function resetDecisionDrafts() {
  purchaseShareCart = [null, null, null];
  purchaseShareEndGame = false;
  disposeTradeShares = 0;
  disposeSellShares = 0;
}

function sharePlacementClass(rows: number[][], playerIndex: number, chainIndex: number) {
  const holdings = rows.map((row) => row[chainIndex] ?? 0);
  const amount = holdings[playerIndex] ?? 0;
  if (amount <= 0) return "";
  const highest = Math.max(...holdings);
  if (amount === highest) return holdings.filter((value) => value > 0).length === 1 ? "score-cell--first-and-second" : "score-cell--first";
  if (holdings.filter((value) => value === highest).length > 1) return "";
  const second = Math.max(...holdings.filter((value) => value < highest));
  return amount === second ? "score-cell--second" : "";
}

function finalScorePlacementClass(rows: number[][], playerIndex: number) {
  const score = rows[playerIndex]?.[8];
  if (score === undefined) return "";
  const scores = [...new Set(rows.map((row) => row[8]).filter((value): value is number => value !== undefined))].sort((a, b) => b - a);
  return score === scores[0] ? "score-cell--first" : score === scores[1] ? "score-cell--second" : "";
}

function formatGameEvent(game: GameSessionSnapshot, event: GameEvent): string {
  const player = "playerId" in event ? playerMarkup(game, event.playerId) : "";
  switch (event.kind) {
    case "turnBegan": return `${player} began their turn.`;
    case "positionTileDrawn": return `${player} drew position tile ${formatTile(event.tile)}.`;
    case "gameStarted": return `${player} started the game.`;
    case "tileDrawn": return event.tile === null ? `${player} drew a tile.` : `${player} drew tile ${formatTile(event.tile)}.`;
    case "noPlayableTile": return `${player} has no playable tile.`;
    case "tilePlayed": return `${player} played tile ${formatTile(event.tile)}.`;
    case "chainFounded": return `${player} formed ${event.chain}.`;
    case "chainsMerged": return `${player} merged ${event.chains.join(", ")}.`;
    case "mergeSurvivorSelected": return `${player} selected ${event.chain} as the surviving chain.`;
    case "defunctChainSelected": return `${player} selected ${event.chain} as the next chain to dispose of.`;
    case "bonusReceived": return `${player} received a $${event.amount.toLocaleString()} ${event.chain} bonus.`;
    case "sharesDisposed": return `${player} traded ${event.traded} and sold ${event.sold} ${event.chain} shares.`;
    case "couldNotAffordShares": return `${player} could not afford any shares.`;
    case "sharesPurchased": return `${player} purchased ${formatPurchase(event.purchase)}.`;
    case "lastTileDrawn": return `${player} drew the last tile from the bag.`;
    case "deadTileReplaced": return `${player} replaced dead tile ${formatTile(event.tile)}.`;
    case "gameEnded": return `${player} ended the game.`;
    case "gameForcedToEnd": return event.reason === "allTilesPlayed" ? "All tiles have been played. Game end forced." : "No tiles were played for an entire round. Game end forced.";
    case "finalStandings": return `<span class="history-final-ranking">Final standings — ${event.standings.map((standing) => `${ordinal(standing.rank)}: ${playerMarkup(game, standing.playerId)} ($${standing.score.toLocaleString()})`).join("; ")}</span>`;
    case "unknown": return escapeHtml(event.description);
  }
}

function playerMarkup(game: GameSessionSnapshot, playerId: string) {
  const name = game.players.find((player) => player.id === playerId)?.name ?? `Player ${Number(playerId) + 1}`;
  return `<strong class="history-player ${playerId === game.viewerPlayerId ? "history-player--current" : ""}">${escapeHtml(name)}</strong>`;
}

function formatPurchase(purchase: SharePurchase) {
  const values = HOTEL_CHAINS.filter((chain) => (purchase[chain] ?? 0) > 0).map((chain) => `${purchase[chain]} ${chain}`);
  return values.length === 0 ? "nothing" : values.join(", ");
}

function ordinal(value: number) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  return `${value}${value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th"}`;
}

function boardContentClassName(content: BoardCellContent) {
  if (content.kind === "chain") return `board-cell--${content.chain.toLowerCase()}`;
  return content.kind === "independent" ? "board-cell--nothing-yet" : "board-cell--nothing";
}

function tilePlacementClassName(entry: TileRackEntry) {
  if (entry.chain !== null) return `board-cell--${entry.chain.toLowerCase()}`;
  const classes: Record<TilePlacementKind, string> = {
    unplayablePermanently: "board-cell--cant-play-ever",
    unplayableTemporarily: "board-cell--cant-play-now",
    isolated: "board-cell--lonely",
    extendsIndependentGroup: "board-cell--neighbor",
    foundsChain: "board-cell--new-chain",
    mergesChains: "board-cell--merge",
    extendsChain: "board-cell--nothing",
    inHand: "board-cell--i-have-this",
    independent: "board-cell--nothing-yet",
    unknown: "board-cell--nothing"
  };
  return classes[entry.placement];
}

function boardCellLabel(content: BoardCellContent, x: number, y: number) {
  return content.kind === "chain" ? content.chain[0] : tileName(x, y);
}

function mergeTileStyle(game: GameSessionSnapshot, entry: TileRackEntry) {
  if (entry.placement !== "mergesChains") return "";
  const x = entry.tile.column;
  const rowCode = entry.tile.row.charCodeAt(0);
  const chains = game.board.filter((cell) => {
    const dx = Math.abs(cell.tile.column - x);
    const dy = Math.abs(cell.tile.row.charCodeAt(0) - rowCode);
    return dx + dy === 1 && cell.content.kind === "chain";
  }).map((cell) => cell.content.kind === "chain" ? cell.content.chain : null).filter((chain): chain is HotelChain => chain !== null);
  const unique = [...new Set(chains)];
  if (unique.length < 2) return "";
  return `style="--merge-color-a: ${hotelChainColor(HOTEL_CHAINS.indexOf(unique[0]!))}; --merge-color-b: ${hotelChainColor(HOTEL_CHAINS.indexOf(unique[1]!))};"`;
}

function hotelChainColor(index: number) {
  return ["#ff5151", "#ffec69", "#5982ff", "#71df77", "#9d6c2f", "#71e6ef", "#e46ee9"][index] ?? "#fff";
}

function findTileRackIndexForCoordinate(game: GameSessionSnapshot, x: number, y: number) {
  const row = String.fromCharCode(y + 65);
  const index = game.tileRack.findIndex((entry) => entry !== null && entry.tile.row === row && entry.tile.column === x + 1);
  return index < 0 ? null : index;
}

function describeLobbyGame(game: TlstyerLobbyGame) {
  const mode = game.mode === "teams" ? "Teams" : "Singles";
  if (game.state === "starting") return `${mode}, Starting (Max ${game.maxPlayers})`;
  if (game.state === "startingFull") return `${mode}, Starting (Full)`;
  if (game.state === "inProgress") return `${mode}, In Progress`;
  return `${mode}, Completed`;
}

function describeGameAction(kind: NonNullable<GameSessionSnapshot["currentAction"]>["kind"]) {
  switch (kind) {
    case "startGame": return "start the game";
    case "playTile": return "play a tile";
    case "foundChain": return "select a chain";
    case "selectMergeSurvivor": return "select the merger survivor";
    case "selectDefunctChain": return "select the next defunct chain";
    case "disposeShares": return "dispose of shares";
    case "buyShares": return "purchase shares";
    case "gameOver": return "finish the game";
  }
}

function isSelfInLobbyGame(gameId: number) {
  const game = appState.games[gameId];
  return appState.selfUsername !== null && game !== undefined && game.players.some((player) => player.username === appState.selfUsername);
}

function snapshotScrollAnchors() {
  document.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach((element) => {
    const key = element.dataset.scrollKey;
    if (key === undefined) return;
    const distanceFromBottom = element.scrollHeight - element.clientHeight - element.scrollTop;
    scrollAnchors.set(key, { scrollTop: element.scrollTop, distanceFromBottom, wasAtBottom: distanceFromBottom <= 2 });
  });
}

function restoreScrollAnchors() {
  document.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach((element) => {
    const key = element.dataset.scrollKey;
    if (key === undefined) return;
    const anchor = scrollAnchors.get(key);
    const stick = element.dataset.stickToBottom === "true";
    if (anchor === undefined) {
      if (stick) element.scrollTop = element.scrollHeight;
    } else if (stick && anchor.wasAtBottom) {
      element.scrollTop = element.scrollHeight;
    } else if (stick) {
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight - anchor.distanceFromBottom);
    } else {
      element.scrollTop = anchor.scrollTop;
    }
  });
}

function loadRuntimeConfig() {
  runtimeConfigPromise ??= fetch("/api/runtime-config").then(async (response) => {
    if (!response.ok) {
      const details = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(details?.error ?? `Failed to load runtime config: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<RuntimeConfig>;
  });
  return runtimeConfigPromise;
}

async function hashPassword(username: string, password: string) {
  if (password.length === 0) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`acquire ${username} ${password}`));
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function storeBrowserCredential(username: string, password: string) {
  const PasswordCredential = (window as Window & { PasswordCredential?: new (data: { id: string; password: string; name?: string }) => Credential }).PasswordCredential;
  if (PasswordCredential === undefined || navigator.credentials === undefined || typeof navigator.credentials.store !== "function") return;
  try {
    await navigator.credentials.store(new PasswordCredential({ id: username, password, name: username }));
  } catch {
    // Browsers may reject credential storage even when the API exists.
  }
}

function errorMessageFor(code: TlstyerErrorCode) {
  switch (code) {
    case "invalidUsername": return "Invalid username. Username must have between 1 and 32 ASCII characters.";
    case "invalidPassword": return "Invalid password.";
    case "missingPassword": return "Password is required.";
    case "unexpectedPassword": return "Password is not set for this user.";
    case "incorrectPassword": return "Password is incorrect.";
    case "versionMismatch": return "Client version mismatch. Reload after rebuilding.";
    case "lostConnection": return "Lost connection to the server.";
    default: return "An error occurred during the processing of your request.";
  }
}

function formatTile(tile: { row: string; column: number }) {
  return `${tile.column}${tile.row}`;
}

function tileName(x: number, y: number) {
  return `${x + 1}${String.fromCharCode(y + 65)}`;
}

function tilesMatch(left: { row: string; column: number }, right: { row: string; column: number }) {
  return left.row === right.row && left.column === right.column;
}

function formatMoney(value: number) {
  return String(value);
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
