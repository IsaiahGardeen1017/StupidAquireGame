import "./styles/main.scss";

import type { HotelChain, SharePurchase } from "../src/index.js";
import { HumanPlayer } from "../src/index.js";
import { AcquireNetworkClient } from "./network.js";
import {
    COMMANDS_TO_CLIENT,
    COMMANDS_TO_SERVER,
    ERRORS,
    GAME_ACTIONS,
    GAME_BOARD_TYPES,
    GAME_MODES,
    GAME_STATES,
    HOTEL_CHAINS,
} from "./protocol.js";
import {
    createInitialState,
    createLobbyGame,
    createViewGameState,
    resetLiveGame,
} from "./state.js";
import type { AppState } from "./types.js";

type RuntimeConfig = {
    proxyOrigin: string;
    liveServerUrl: string;
    version: string;
};

const SPLASH_IMAGE_URLS = [
    //new URL("../Assets/atruimSplash.png", import.meta.url).href,
    //new URL("../Assets/boardroomSplash.png", import.meta.url).href,
    //new URL("../Assets/boardroomSplash2.png", import.meta.url).href,
    new URL("../Assets/hotelExteriorSplash.png", import.meta.url).href,
    //new URL("../Assets/hotelSplash.png", import.meta.url).href,
    //new URL("../Assets/lobbySplash.png", import.meta.url).href,
    //new URL("../Assets/officeSplash.png", import.meta.url).href,
] as const;

const GAME_HISTORY_MESSAGES = {
    TurnBegan: 0,
    DrewPositionTile: 1,
    StartedGame: 2,
    DrewTile: 3,
    HasNoPlayableTile: 4,
    PlayedTile: 5,
    FormedChain: 6,
    MergedChains: 7,
    SelectedMergerSurvivor: 8,
    SelectedChainToDisposeOfNext: 9,
    ReceivedBonus: 10,
    DisposedOfShares: 11,
    CouldNotAffordAnyShares: 12,
    PurchasedShares: 13,
    DrewLastTile: 14,
    ReplacedDeadTile: 15,
    EndedGame: 16,
    NoTilesPlayedForEntireRound: 17,
    AllTilesPlayed: 18,
} as const;

const appState = createInitialState();
const appElement = document.querySelector<HTMLDivElement>("#app");
let runtimeConfigPromise: Promise<RuntimeConfig> | null = null;
let pendingCredentialSubmission: { username: string; password: string } | null =
    null;
let isIntentionalDisconnect = false;
let purchaseShareCart: Array<number | null> = [null, null, null];
let purchaseShareEndGame = false;
let disposeTradeShares = 0;
let disposeSellShares = 0;
let awaitingServerActionAdvance = false;
type ScrollAnchor = {
    scrollTop: number;
    distanceFromBottom: number;
    wasAtBottom: boolean;
};
const scrollAnchors = new Map<string, ScrollAnchor>();
const selectedSplashImageUrl =
    SPLASH_IMAGE_URLS[Math.floor(Math.random() * SPLASH_IMAGE_URLS.length)];

if (appElement === null) {
    throw new Error("App container was not found.");
}

const app = appElement;

async function storeBrowserCredential(username: string, password: string) {
    const passwordCredentialConstructor = (
        window as Window & {
            PasswordCredential?: new (
                data: { id: string; password: string; name?: string },
            ) => Credential;
        }
    ).PasswordCredential;

    if (
        passwordCredentialConstructor === undefined ||
        navigator.credentials === undefined ||
        typeof navigator.credentials.store !== "function"
    ) {
        return;
    }

    try {
        const credential = new passwordCredentialConstructor({
            id: username,
            password,
            name: username,
        });
        await navigator.credentials.store(credential);
    } catch {
        // Ignore unsupported or rejected credential-store attempts.
    }
}

const humanPlayer = new HumanPlayer("Human", {
    onDecisionRequested(request) {
        switch (request.kind) {
            case "playTile":
                appState.liveGame.pendingDecision = {
                    kind: "playTile",
                    validTiles: request.validTiles,
                    invalidTilesInHand: request.invalidTilesInHand,
                };
                break;
            case "determineChainToStart":
                appState.liveGame.pendingDecision = {
                    kind: "selectChain",
                    validChains: request.validChains,
                    actionId: GAME_ACTIONS.SelectNewChain,
                };
                break;
            case "determineMergeSurvivor":
                appState.liveGame.pendingDecision = {
                    kind: "selectChain",
                    validChains: request.possibleSurvivors,
                    actionId: GAME_ACTIONS.SelectMergerSurvivor,
                };
                break;
            case "determineHowManySharesToTradeInAfterMerge":
            case "determineHowManySharesToSell":
                resetDisposeShareDraft();
                appState.liveGame.pendingDecision = {
                    kind: "disposeShares",
                    survivingChain: request.survivingChain,
                    mergeChain: request.mergeChain,
                    maxTrade: request.kind ===
                            "determineHowManySharesToTradeInAfterMerge"
                        ? request.numTradesAvailable
                        : 0,
                    maxSell: request.kind === "determineHowManySharesToSell"
                        ? request.howManyIHave
                        : 0,
                };
                break;
            case "buy":
                appState.liveGame.pendingDecision = {
                    kind: "buyShares",
                    availableChains: HOTEL_CHAINS.filter((chain) =>
                        request.gameState.chains[chain]?.isActive ?? false
                    ),
                    canEndGame: false,
                };
                break;
        }

        render();
    },
    onDecisionSettled() {
        appState.liveGame.pendingDecision = null;
        resetPurchaseShareDraft();
        resetDisposeShareDraft();
        render();
    },
});

const network = new AcquireNetworkClient(window.location.origin, {
    onClose() {
        const wasIntentionalDisconnect = isIntentionalDisconnect;
        isIntentionalDisconnect = false;

        if (appState.connectionStatus === "game") {
            resetLiveGame(appState);
        }

        pendingCredentialSubmission = null;
        appState.connectionStatus = "welcome";
        appState.selfClientId = null;
        appState.selfUsername = null;
        appState.selectedGameId = null;
        appState.enteringGameId = null;
        appState.lobbyClientIds = [];
        appState.games = {};
        if (!wasIntentionalDisconnect && appState.errorMessage === null) {
            appState.errorMessage = errorMessageFor(ERRORS.LostConnection);
        } else if (wasIntentionalDisconnect) {
            appState.errorMessage = null;
        }
        render();
    },
    onMessages(messages) {
        if (!Array.isArray(messages)) {
            return;
        }

        for (const message of messages) {
            if (Array.isArray(message)) {
                applyServerMessage(message as [number, ...unknown[]]);
            }
        }

        render();
    },
});

render();

function loadRuntimeConfig() {
    runtimeConfigPromise ??= fetch("/api/runtime-config").then(
        async (response) => {
            if (!response.ok) {
                const details = (await response.json().catch(() => null)) as {
                    error?: string;
                } | null;
                throw new Error(
                    details?.error ??
                        `Failed to load runtime config: ${response.status} ${response.statusText}`,
                );
            }

            return (await response.json()) as RuntimeConfig;
        },
    );

    return runtimeConfigPromise;
}

async function hashPassword(username: string, password: string) {
    if (password.length === 0) {
        return "";
    }

    const data = new TextEncoder().encode(`acquire ${username} ${password}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
}

function errorMessageFor(errorId: number) {
    switch (errorId) {
        case ERRORS.InvalidUsername:
            return "Invalid username. Username must have between 1 and 32 ASCII characters.";
        case ERRORS.InvalidPassword:
            return "Invalid password.";
        case ERRORS.MissingPassword:
            return "Password is required.";
        case ERRORS.ProvidedPassword:
            return "Password is not set for this user.";
        case ERRORS.IncorrectPassword:
            return "Password is incorrect.";
        case ERRORS.NotUsingLatestVersion:
            return "Client version mismatch. Reload after rebuilding.";
        case ERRORS.LostConnection:
            return "Lost connection to the server.";
        default:
            return "An error occurred during the processing of your request.";
    }
}

function render() {
    snapshotScrollAnchors();

    const showSidebarCollapse = appState.connectionStatus === "lobby" ||
        appState.connectionStatus === "game";
    const showSessionLayout = appState.connectionStatus === "lobby" ||
        appState.connectionStatus === "game";
    const showLogout = appState.connectionStatus === "connecting" ||
        appState.connectionStatus === "lobby" ||
        appState.connectionStatus === "game";
    const showSplashScreen = appState.connectionStatus === "welcome" ||
        appState.connectionStatus === "connecting";
    app.innerHTML = `
    <div class="shell ${showSessionLayout ? "shell--session" : ""} ${
        showSidebarCollapse && appState.lobbyCollapsed
            ? "shell--sidebar-collapsed"
            : ""
    }">
      <aside class="sidebar ${
        showSidebarCollapse ? "sidebar--collapsible" : ""
    }">
        <div class="sidebar-header">
          <div class="sidebar-brand">
            ${
        showSplashScreen
            ? ""
            : `${
                showSidebarCollapse && appState.lobbyCollapsed
                    ? ""
                    : "<h1>Acquire</h1>"
            }`
    }
            ${
        showSidebarCollapse && !appState.lobbyCollapsed &&
            appState.selfUsername !== null
            ? `<p class="sidebar-user">${escapeHtml(appState.selfUsername)}</p>`
            : ""
    }
          </div>
          <div class="sidebar-header-actions">
          ${
        showSidebarCollapse && !appState.lobbyCollapsed
            ? `
            <button
              id="toggle-lobby"
              class="sidebar-toggle"
              type="button"
              aria-expanded="${appState.lobbyCollapsed ? "false" : "true"}"
              aria-label="${
                appState.lobbyCollapsed
                    ? "Expand left panel"
                    : "Collapse left panel"
            }"
            >
              ${appState.lobbyCollapsed ? "»" : "«"}
            </button>
          `
            : ""
    }
          </div>
        </div>
        ${
        showSidebarCollapse && appState.lobbyCollapsed
            ? ""
            : renderConnectionPanel()
    }
        ${renderLobbyPanel()}
        ${
        showLogout && !appState.lobbyCollapsed
            ? `<div class="sidebar-footer"><button id="logout" class="sidebar-action-button sidebar-action-button--footer" type="button">Log Out</button></div>`
            : ""
    }
      </aside>
      <main class="main-panel ${
        showSplashScreen ? "main-panel--splash" : ""
    } ${
        appState.connectionStatus === "lobby" &&
            appState.liveGame.gameId === null ? "main-panel--lobby" : ""
    }">
        ${renderGamePanel()}
      </main>
    </div>
  `;

    wireEvents();
    restoreScrollAnchors();
}

function snapshotScrollAnchors() {
    document.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach((
        element,
    ) => {
        const key = element.dataset.scrollKey;
        if (key === undefined) {
            return;
        }

        const distanceFromBottom = element.scrollHeight - element.clientHeight -
            element.scrollTop;
        scrollAnchors.set(key, {
            scrollTop: element.scrollTop,
            distanceFromBottom,
            wasAtBottom: distanceFromBottom <= 2,
        });
    });
}

function restoreScrollAnchors() {
    document.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach((
        element,
    ) => {
        const key = element.dataset.scrollKey;
        if (key === undefined) {
            return;
        }

        const anchor = scrollAnchors.get(key);
        const stickToBottom = element.dataset.stickToBottom === "true";

        if (anchor === undefined) {
            if (stickToBottom) {
                element.scrollTop = element.scrollHeight;
            }
            return;
        }

        if (stickToBottom && anchor.wasAtBottom) {
            element.scrollTop = element.scrollHeight;
            return;
        }

        if (stickToBottom) {
            element.scrollTop = Math.max(
                0,
                element.scrollHeight - element.clientHeight -
                    anchor.distanceFromBottom,
            );
            return;
        }

        element.scrollTop = anchor.scrollTop;
    });
}

function renderConnectionPanel() {
    if (appState.connectionStatus === "connecting") {
        return `<section class="panel"><h2>Connection</h2><p>Connecting through the local proxy...</p></section>`;
    }

    if (
        appState.connectionStatus === "lobby" ||
        appState.connectionStatus === "game"
    ) {
        return "";
    }

    return `
    <div class="entry-panels">
      <section class="panel hero-panel">
        <h2>Log In</h2>
        <p class="muted">Use the same login as acquire.tlstyer.com</p>
        ${
        appState.errorMessage === null
            ? ""
            : `<p class="error">${escapeHtml(appState.errorMessage)}</p>`
    }
        <form id="login-form" class="stack" autocomplete="on">
          <label>
            Username
            <input
              id="username"
              name="username"
              type="text"
              maxlength="32"
              autocomplete="username"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
            />
          </label>
          <label>
            Password
            <input
              id="password"
              name="password"
              type="password"
              autocomplete="current-password"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
            />
          </label>
          <button type="submit">Connect</button>
        </form>
      </section>
      <section class="panel entry-side-panel">
        <h2>Local Play</h2>
        <p class="muted">Use this when local games are ready.</p>
        <button id="show-local-play" type="button">Play Locally</button>
      </section>
    </div>
  `;
}

function renderLobbyPanel() {
    if (
        appState.connectionStatus !== "lobby" &&
        appState.connectionStatus !== "game"
    ) {
        return "";
    }

    if (appState.lobbyCollapsed) {
        return "";
    }

    const clients = appState.lobbyClientIds
        .map((clientId) => appState.clients[clientId])
        .filter((client): client is NonNullable<typeof client> =>
            client !== undefined
        )
        .map((client) =>
            `<li class="player-list-item">${escapeHtml(client.username)}</li>`
        )
        .join("");

    const games = Object.values(appState.games)
        .sort((a, b) => a.gameId - b.gameId)
        .map((game) => {
            const selfIsInGame = isSelfInLobbyGame(game.gameId);
            const cardToneClass = selfIsInGame
                ? "game-card--rejoin"
                : "game-card--spectate";
            const players = game.players
                .map((player) =>
                    `<span class="game-player ${
                        player.clientId === null ? "missing" : ""
                    }">${escapeHtml(player.username)}</span>`
                )
                .join('<span class="game-player-separator">•</span>');

            return `
        <article class="game-card ${cardToneClass} ${
                appState.selectedGameId === game.gameId ? "selected" : ""
            }">
          <div class="game-card-row">
            <strong>Game #${game.gameId}</strong>
            <span class="game-card-state">${
                describeGameState(game.stateId, game.modeId, game.maxPlayers)
            }</span>
          </div>
          <div class="game-card-row game-card-row--detail">
            <div class="game-card-players">${
                players || '<span class="muted">No players</span>'
            }</div>
            <div class="actions">
              ${
                game.stateId === GAME_STATES.Starting && !selfIsInGame
                    ? `<button data-action="join" data-game-id="${game.gameId}">Join</button>`
                    : ""
            }
              ${
                selfIsInGame
                    ? `<button data-action="rejoin" data-game-id="${game.gameId}">Rejoin</button>`
                    : `<button data-action="watch" data-game-id="${game.gameId}">Spectate</button>`
            }
            </div>
          </div>
        </article>
      `;
        })
        .join("");

    return `
    <section class="panel lobby-panel">
      <div class="lobby-panel-body">
        <div class="lobby-meta">
          <h3>Players <span class="lobby-count">${appState.lobbyClientIds.length}</span></h3>
        </div>
        <section class="lobby-box">
          <div class="lobby-scroll" data-scroll-key="lobby-players">
            <ul class="player-list">${
        clients || '<li class="muted">No visible lobby clients yet.</li>'
    }</ul>
          </div>
        </section>
        <section class="lobby-box lobby-chat-box">
          <h3>Lobby Chat</h3>
          <div class="lobby-scroll" data-scroll-key="lobby-chat" data-stick-to-bottom="true">
            <div class="chat-feed">${renderGlobalChat()}</div>
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderGamePanel() {
    if (appState.enteringGameId !== null && appState.liveGame.gameId === null) {
        return `
      <section class="panel wide empty-state">
        <h2>Opening Game #${appState.enteringGameId}</h2>
        <p>Waiting for the server to finish opening the game view.</p>
      </section>
    `;
    }

    if (
        appState.connectionStatus === "welcome" ||
        appState.connectionStatus === "connecting"
    ) {
        return `
      <section class="splash-panel" style="background-image: linear-gradient(180deg, rgba(22, 20, 17, 0.08), rgba(22, 20, 17, 0.28)), url('${selectedSplashImageUrl}');">
        <div class="splash-panel-copy">
          <h2>ACQUIRE</h2>
        </div>
      </section>
    `;
    }

    if (
        appState.connectionStatus !== "game" ||
        appState.liveGame.gameId === null
    ) {
        return `
      ${
            appState.connectionStatus === "lobby"
                ? renderLobbyMainPanel()
                : `<section class="panel wide empty-state">
        <h2>Welcome</h2>
        <p>Choose whether to log in online or play locally. Local play is not implemented yet.</p>
      </section>`
        }
    `;
    }

    return `
    <section class="game-screen">
      <div class="game-screen-grid">
        <section class="board-column">
          <div class="board-wrap">
            ${renderBoard()}
          </div>
          <div class="game-status ${
        appState.liveGame.playerId !== null &&
            appState.liveGame.currentAction?.playerId === appState.liveGame.playerId
            ? "game-status--action-required"
            : ""
    }" role="status" aria-live="polite">${renderStatus()}</div>
          <div class="message-panels game-bottom-panels">
            <section class="message-panel">
              <h3>Game History</h3>
              <div class="message-scroll" data-scroll-key="game-history" data-stick-to-bottom="true">${renderHistory()}</div>
            </section>
            <section class="message-panel">
              <h3>Game Chat</h3>
              <div class="message-scroll" data-scroll-key="game-chat">${renderChat()}</div>
            </section>
          </div>
        </section>
        <section class="side-column">
          <div class="panel compact-panel score-panel">
            <h3>Score Sheet</h3>
            <div class="score-scroll">${renderScoreSheet()}</div>
          </div>
          <div class="panel compact-panel decision-panel ${
        appState.liveGame.pendingDecision?.kind === "buyShares"
            ? "decision-panel--buy"
            : ""
    }">
            ${renderDecisionPanel()}
          </div>
          <div class="panel compact-panel tile-rack-panel">
            <h3>Tile Rack</h3>
            <div class="tile-rack-frame">
              <div class="tile-rack">${renderTileRack()}</div>
            </div>
          </div>
          <button id="leave-game" class="leave-game-button" type="button">Leave Game</button>
        </section>
      </div>
    </section>
  `;
}

function renderStatus() {
    if (appState.liveGame.currentAction === null) {
        return "Waiting for game data.";
    }

    const actorName = appState.liveGame.currentAction.playerId === null
        ? "server"
        : appState.liveGame.currentAction.playerId === appState.liveGame.playerId
        ? "You"
        : appState.games[appState.liveGame.gameId ?? -1]
            ?.players[appState.liveGame.currentAction.playerId]?.username ??
            `Player ${appState.liveGame.currentAction.playerId + 1}`;
    return appState.liveGame.currentAction.playerId === null
        ? `Game status: ${describeGameAction(appState.liveGame.currentAction.actionId)}.`
        : `${escapeHtml(actorName)} needs to ${
            describeGameAction(appState.liveGame.currentAction.actionId)
        }.`;
}

function renderBoard() {
    const cells = Array.from({ length: 9 }, (_, y) =>
        Array.from({ length: 12 }, (_, x) => {
            const cell = appState.liveGame.board.find((entry) =>
                entry.x === x && entry.y === y
            );
            if (cell === undefined) {
                return `<div class="board-cell board-cell--missing"></div>`;
            }

            const tileInHand = findTileRackIndexForCoordinate(x, y) !== null;

            return `
        <button class="board-cell ${boardClassName(cell.typeId)} ${
                tileInHand ? "board-cell--in-hand" : ""
            }" data-x="${x}" data-y="${y}" title="${tileName(x, y)}">
          <span>${boardCellLabel(cell.typeId, x, y)}</span>
        </button>
      `;
        }).join("")
    ).join("");

    return `<div class="board-grid">${cells}</div>`;
}

function renderTileRack() {
    const visibleTiles = appState.liveGame.tileRack.filter((
        entry,
    ): entry is NonNullable<typeof entry> => entry !== null);
    if (visibleTiles.length === 0) {
        return `<p class="muted">No tiles in rack.</p>`;
    }

    return appState.liveGame.tileRack
        .map((entry, index) => {
            if (entry === null) {
                return "";
            }

            return `<button class="tile ${
                boardClassName(entry.typeId)
            }" ${mergeTileStyle(entry)} data-tile-index="${index}">${entry.tile.column}${entry.tile.row}</button>`;
        })
        .join("");
}

function renderDecisionPanel() {
    const pending = appState.liveGame.pendingDecision;
    if (pending === null) {
        return renderPurchasePanel(false);
    }

    switch (pending.kind) {
        case "playTile":
            return renderPurchasePanel(false);
        case "selectChain":
            return renderChainSelectionPanel(pending.validChains);
        case "disposeShares":
            return renderDisposeSharesPanel(pending);
        case "buyShares":
            return renderPurchasePanel(true);
    }

    return renderPurchasePanel(false);
}

function renderChainSelectionPanel(validChains: readonly HotelChain[]) {
    return `
    <div class="purchase-panel chain-select-panel">
      <section class="purchase-section">
        <h4>Select Chain</h4>
        <div class="purchase-available-grid">
          ${
        HOTEL_CHAINS.map((chain, chainIndex) => {
            const isAvailable = validChains.includes(chain);
            return `<div class="purchase-option">
              <div class="purchase-option-label">${escapeHtml(chain)}</div>
              <button class="purchase-share-button purchase-share-button--${chain.toLowerCase()} ${
                isAvailable ? "" : "purchase-share-button--inactive"
            }" type="button" data-chain-index="${chainIndex}" ${
                isAvailable ? "" : "disabled"
            }>
                <span class="purchase-share-price ${
                isAvailable ? "" : "purchase-share-price--inactive"
            }">${chain[0]}</span>
                <span class="purchase-share-meta">${
                isAvailable ? "Select" : "-"
            }</span>
              </button>
            </div>`;
        }).join("")
    }
        </div>
      </section>
      <div class="purchase-row purchase-row--placeholder" aria-hidden="true">
        <section class="purchase-section purchase-cart">
          <h4>Cart</h4>
          <div class="purchase-cart-slots">
            ${Array.from({ length: 3 }, () =>
        `<div class="purchase-cart-slot purchase-cart-slot--empty">Empty</div>`
    ).join("")}
          </div>
        </section>
        <section class="purchase-section purchase-cost">
          <h4>Cost</h4>
          <dl class="purchase-cost-list">
            <div><dt>Total</dt><dd>0</dd></div>
            <div><dt>Left</dt><dd>0</dd></div>
          </dl>
        </section>
        <div class="purchase-buy">
          <button type="button" disabled>Buy</button>
        </div>
      </div>
    </div>
  `;
}

function renderDisposeSharesPanel(pending: {
    survivingChain: HotelChain;
    mergeChain: HotelChain;
    maxTrade: number;
    maxSell: number;
}) {
    const summary = getDisposeShareSummary(pending);
    const mergeChainIndex = HOTEL_CHAINS.indexOf(pending.mergeChain);
    const survivingChainIndex = HOTEL_CHAINS.indexOf(pending.survivingChain);
    const playerRow = appState.liveGame.scoreSheet[
        appState.liveGame.playerId ?? 0
    ] ?? [];
    const survivingSharesAfter = (playerRow[survivingChainIndex] ?? 0) +
        summary.trade;
    const salePrice = sharePriceForChain(
        mergeChainIndex,
        appState.liveGame.scoreSheet[7]?.[mergeChainIndex] ?? 0,
    );
    const additionalCash = summary.sell * salePrice * 100;

    return `
    <div class="merge-panel">
      <h4>Resolve Merger</h4>
      <p class="merge-copy">${escapeHtml(pending.mergeChain)} into ${
        escapeHtml(pending.survivingChain)
    }</p>
      <div class="merge-adjust-grid">
        <section class="merge-adjust-card merge-adjust-card--chain ${
        survivingChainIndex === 2 || survivingChainIndex === 4
            ? "merge-adjust-card--dark"
            : ""
    }" style="background: ${hotelChainColor(survivingChainIndex)}">
          <h5>Trade 2 for 1</h5>
          <div class="merge-adjust-value merge-adjust-value--detail">Trade ${
        summary.trade
    } <span>(total ${survivingSharesAfter})</span></div>
          <div class="merge-adjust-actions">
            <button type="button" data-dispose-trade-adjust="-2" ${
        summary.trade === 0 ? "disabled" : ""
    }>-2</button>
            <button type="button" data-dispose-trade-adjust="2" ${
        summary.trade >= pending.maxTrade ? "disabled" : ""
    }>+2</button>
          </div>
          <p class="merge-adjust-meta">Max ${pending.maxTrade}</p>
        </section>
        <section class="merge-adjust-card">
          <h5>Sell</h5>
          <div class="merge-adjust-value merge-adjust-value--detail">${summary.sell} <span>(+$${
        additionalCash.toLocaleString()
    })</span></div>
          <div class="merge-adjust-actions">
            <button type="button" data-dispose-sell-adjust="-1" ${
        summary.sell === 0 ? "disabled" : ""
    }>-1</button>
            <button type="button" data-dispose-sell-adjust="1" ${
        summary.sell >= summary.sellCap ? "disabled" : ""
    }>+1</button>
          </div>
          <p class="merge-adjust-meta">Max ${summary.sellCap}</p>
        </section>
        <section class="merge-adjust-card merge-adjust-card--summary merge-adjust-card--chain ${
        mergeChainIndex === 2 || mergeChainIndex === 4
            ? "merge-adjust-card--dark"
            : ""
    }" style="background: ${hotelChainColor(mergeChainIndex)}">
          <h5>Keep</h5>
          <div class="merge-adjust-value">${summary.keep}</div>
          <div class="merge-adjust-summary">
            <div><span>Trade</span><strong>${summary.trade}</strong></div>
            <div><span>Sell</span><strong>${summary.sell}</strong></div>
          </div>
        </section>
      </div>
      <div class="merge-submit-row">
        <button id="dispose-submit" type="button">Submit share disposal</button>
      </div>
    </div>
  `;
}

function renderPurchasePanel(showCart: boolean) {
    const pending = appState.liveGame.pendingDecision;
    const buySummary = getBuySummary();
    const buyTotals = getPurchaseCartSummary(buySummary);
    const buyButtonLabel = purchaseShareCart.every((entry) => entry === null)
        ? "Pass"
        : "Buy";

    return `
    <div class="purchase-panel">
      <section class="purchase-section">
        <h4>Available</h4>
        <div class="purchase-available-grid">
          ${
        buySummary
            .map((entry) => {
                const disabled = !showCart || isPurchaseOptionDisabled(
                    entry.chainIndex,
                    buySummary,
                );
                return `<div class="purchase-option">
                  <div class="purchase-option-label">${escapeHtml(entry.chain)}</div>
                  <button class="purchase-share-button purchase-share-button--${entry.chain.toLowerCase()} ${
                    entry.isPurchasable ? "" : "purchase-share-button--inactive"
                }" type="button" data-buy-available="${entry.chainIndex}" ${
                    disabled ? "disabled" : ""
                }>
                    <span class="purchase-share-price ${
                    entry.isPurchasable ? "" : "purchase-share-price--inactive"
                }">${
                    entry.isPurchasable ? `$${entry.price * 100}` : "-"
                }</span>
                    <span class="purchase-share-meta">${
                    entry.available
                } left</span>
                  </button>
                </div>`;
            })
            .join("")
    }
        </div>
      </section>
      ${
        showCart
            ? `
      <div class="purchase-row">
        <section class="purchase-section purchase-cart">
          <h4>Cart</h4>
          <div class="purchase-cart-slots">
            ${
                Array.from({ length: 3 }, (_, index) =>
                    renderPurchaseCartSlot(index, buySummary)).join("")
            }
          </div>
        </section>
        <section class="purchase-section purchase-cost">
          <h4>Cost</h4>
          <dl class="purchase-cost-list">
            <div><dt>Total</dt><dd>${buyTotals.totalSpent * 100}</dd></div>
            <div><dt>Left</dt><dd>${buyTotals.cashLeft * 100}</dd></div>
          </dl>
        </section>
        <div class="purchase-buy">
          <button id="buy-submit" type="button">${buyButtonLabel}</button>
        </div>
      </div>
      ${
                pending?.kind === "buyShares" && pending.canEndGame
                    ? `<div class="purchase-actions"><label class="purchase-endgame"><input id="buy-end-game" type="checkbox" ${
                        purchaseShareEndGame ? "checked" : ""
                    } /> End game</label></div>`
                    : ""
            }
      `
            : `<div class="purchase-panel-spacer"></div>`
    }
    </div>
  `;
}

function renderScoreSheet() {
    const game = appState.games[appState.liveGame.gameId ?? -1];
    const playerCount = game?.players.length ?? 0;
    const derived = deriveScoreSheetValues(playerCount);
    const headerCells = HOTEL_CHAINS.map((chain) =>
        `<th class="score-chain score-chain--${chain.toLowerCase()}">${
            chain[0]
        }</th>`
    ).join("");

    const playerRows = Array.from({ length: playerCount }, (_, index) => {
        const row = derived.playerRows[index] ?? [];
        const player = game?.players[index];
        const shareCells = Array.from(
            { length: 7 },
            (_, shareIndex) => {
                const placement = sharePlacementClass(
                    derived.playerRows,
                    index,
                    shareIndex,
                );
                return `<td class="${placement}">${row[shareIndex] ?? ""}</td>`;
            },
        ).join("");
        return `
      <tr class="${
            index === appState.liveGame.turnPlayerId ? "active-player-row" : ""
        }">
        <th>${escapeHtml(player?.username ?? `Player ${index + 1}`)}</th>
        ${shareCells}
        <td>${formatMoneyCell(row[7])}</td>
        <td class="${finalScorePlacementClass(derived.playerRows, index)}">${
            formatMoneyCell(row[8])
        }</td>
      </tr>
    `;
    }).join("");

    const summaryRows = [
        { label: "Price ($00)", values: derived.prices },
        { label: "Chain Size", values: derived.chainSizes },
        { label: "Available", values: derived.available },
    ]
        .map(
            (row) => `
        <tr class="summary-row">
          <th>${row.label}</th>
          ${
                Array.from({ length: 7 }, (_, index) =>
                    `<td>${row.values[index] ?? "-"}</td>`).join("")
            }
          <td></td>
          <td></td>
        </tr>
      `,
        )
        .join("");

    return `
    <table class="score-sheet">
      <thead>
        <tr>
          <th>Player</th>
          ${headerCells}
          <th>Cash</th>
          <th>Net</th>
        </tr>
      </thead>
      <tbody>
        ${playerRows}
        ${summaryRows}
      </tbody>
    </table>
  `;
}

function sharePlacementClass(
    playerRows: number[][],
    playerIndex: number,
    chainIndex: number,
) {
    const holdings = playerRows.map((row) => row[chainIndex] ?? 0);
    const amount = holdings[playerIndex] ?? 0;
    if (amount <= 0) {
        return "";
    }

    const highest = Math.max(...holdings);
    if (amount === highest) {
        if (holdings.filter((value) => value > 0).length === 1) {
            return "score-cell--first-and-second";
        }
        return "score-cell--first";
    }

    // A tie for first combines the first- and second-place bonuses, so there
    // is no separately shaded second place in that chain.
    if (holdings.filter((value) => value === highest).length > 1) {
        return "";
    }

    const secondHighest = Math.max(
        ...holdings.filter((value) => value < highest),
    );
    return amount === secondHighest ? "score-cell--second" : "";
}

function finalScorePlacementClass(playerRows: number[][], playerIndex: number) {
    const score = playerRows[playerIndex]?.[8];
    if (score === undefined) {
        return "";
    }

    const distinctScores = [...new Set(
        playerRows.map((row) => row[8]).filter((value): value is number =>
            value !== undefined
        ),
    )].sort((left, right) => right - left);
    if (score === distinctScores[0]) {
        return "score-cell--first";
    }
    return score === distinctScores[1] ? "score-cell--second" : "";
}

function renderHistory() {
    if (appState.liveGame.history.length === 0) {
        return `<p class="muted">No history yet.</p>`;
    }

    return appState.liveGame.history.map((entry) =>
        `<div class="history-line">${entry}</div>`
    ).join("");
}

function renderChat() {
    if (appState.liveGame.chat.length === 0) {
        return `<p class="muted">No game chat yet.</p>`;
    }

    return appState.liveGame.chat.map((entry) =>
        `<div class="chat-line">${entry}</div>`
    ).join("");
}

function renderGlobalChat() {
    if (appState.globalChat.length === 0) {
        return "";
    }

    return appState.globalChat.map((entry) =>
        `<div class="chat-line">${entry}</div>`
    ).join("");
}

function renderLobbyMainPanel() {
    const games = Object.values(appState.games)
        .sort((a, b) => a.gameId - b.gameId)
        .map((game) => {
            const selfIsInGame = isSelfInLobbyGame(game.gameId);
            const players = game.players
                .map((player) =>
                    `<span class="game-player ${
                        player.clientId === null ? "missing" : ""
                    }">${escapeHtml(player.username)}</span>`
                )
                .join('<span class="game-player-separator">â€¢</span>');

            return `
        <article class="game-card ${
                appState.selectedGameId === game.gameId ? "selected" : ""
            }">
          <div class="game-card-row">
            <strong>Game #${game.gameId}</strong>
            <span class="game-card-state">${
                describeGameState(game.stateId, game.modeId, game.maxPlayers)
            }</span>
          </div>
          <div class="game-card-row game-card-row--detail">
            <div class="game-card-players">${
                players || '<span class="muted">No players</span>'
            }</div>
            <div class="actions">
              ${
                game.stateId === GAME_STATES.Starting && !selfIsInGame
                    ? `<button data-action="join" data-game-id="${game.gameId}">Join</button>`
                    : ""
            }
              ${
                selfIsInGame
                    ? `<button data-action="rejoin" data-game-id="${game.gameId}">Rejoin</button>`
                    : `<button data-action="watch" data-game-id="${game.gameId}">Spectate</button>`
            }
            </div>
          </div>
        </article>
      `;
        })
        .join("");

    return `
      <section class="lobby-main-panel">
        <div class="lobby-main-games" data-scroll-key="lobby-games">
          <div class="game-list">${games || "<p>No games yet.</p>"}</div>
        </div>
      </section>
    `;
}

function wireEvents() {
    document.querySelector<HTMLButtonElement>("#show-local-play")
        ?.addEventListener("click", () => {
            appState.errorMessage = "Local play is not implemented yet.";
            render();
        });

    document.querySelector<HTMLButtonElement>("#logout")?.addEventListener(
        "click",
        () => {
            isIntentionalDisconnect = true;
            pendingCredentialSubmission = null;
            network.disconnect();
        },
    );

    document.querySelector<HTMLButtonElement>("#toggle-lobby")
        ?.addEventListener("click", () => {
            appState.lobbyCollapsed = !appState.lobbyCollapsed;
            render();
        });

    document.querySelector<HTMLButtonElement>("#toggle-lobby")
        ?.addEventListener("click", (event) => {
            event.stopPropagation();
        });

    document.querySelector<HTMLElement>(".sidebar--collapsible")
        ?.addEventListener("click", () => {
            if (appState.lobbyCollapsed) {
                appState.lobbyCollapsed = false;
                render();
            }
        });

    document.querySelector<HTMLButtonElement>("#leave-game")?.addEventListener(
        "click",
        () => {
            network.send(COMMANDS_TO_SERVER.LeaveGame);
            appState.enteringGameId = null;
        },
    );

    document.querySelector<HTMLFormElement>("#login-form")?.addEventListener(
        "submit",
        async (event) => {
            event.preventDefault();
            const username =
                document.querySelector<HTMLInputElement>("#username")?.value
                    .trim() ?? "";
            const password =
                document.querySelector<HTMLInputElement>("#password")?.value ??
                    "";

            if (username.length === 0 || username.length > 32) {
                pendingCredentialSubmission = null;
                appState.errorMessage = errorMessageFor(ERRORS.InvalidUsername);
                render();
                return;
            }

            pendingCredentialSubmission = { username, password };
            appState.errorMessage = null;
            appState.connectionStatus = "connecting";
            render();

            try {
                const runtimeConfig = await loadRuntimeConfig();
                network.connect(
                    username,
                    await hashPassword(username, password),
                    runtimeConfig.version,
                );
            } catch (error) {
                pendingCredentialSubmission = null;
                appState.connectionStatus = "welcome";
                appState.errorMessage = error instanceof Error
                    ? error.message
                    : "Failed to prepare the local proxy connection.";
                render();
            }
        },
    );

    document.querySelectorAll<HTMLButtonElement>("[data-action='join']")
        .forEach((button) =>
            button.addEventListener("click", () => {
                const gameId = Number(button.dataset.gameId);
                appState.selectedGameId = gameId;
                appState.enteringGameId = gameId;
                appState.lobbyCollapsed = true;
                render();
                network.send(COMMANDS_TO_SERVER.JoinGame, gameId);
            })
        );

    document.querySelectorAll<HTMLButtonElement>("[data-action='watch']")
        .forEach((button) =>
            button.addEventListener("click", () => {
                const gameId = Number(button.dataset.gameId);
                appState.selectedGameId = gameId;
                appState.enteringGameId = gameId;
                appState.lobbyCollapsed = true;
                render();
                network.send(COMMANDS_TO_SERVER.WatchGame, gameId);
            })
        );

    document.querySelectorAll<HTMLButtonElement>("[data-action='rejoin']")
        .forEach((button) =>
            button.addEventListener("click", () => {
                const gameId = Number(button.dataset.gameId);
                appState.selectedGameId = gameId;
                appState.enteringGameId = gameId;
                resetLiveGame(appState);
                appState.lobbyCollapsed = true;
                render();
                network.send(COMMANDS_TO_SERVER.RejoinGame, gameId);
            })
        );

    document.querySelectorAll<HTMLButtonElement>("[data-tile-index]").forEach((
        button,
    ) => button.addEventListener(
        "click",
        () => resolvePlayTile(Number(button.dataset.tileIndex)),
    ));

    document.querySelectorAll<HTMLButtonElement>(".board-cell[data-x][data-y]")
        .forEach((button) =>
            button.addEventListener("click", () => {
                const x = Number(button.dataset.x);
                const y = Number(button.dataset.y);
                resolvePlayTileFromBoardCoordinate(x, y);
            })
        );

    document.querySelectorAll<HTMLButtonElement>("[data-chain-index]").forEach((
        button,
    ) => button.addEventListener(
        "click",
        () => humanPlayer.resolveDecision(Number(button.dataset.chainIndex)),
    ));

    document.querySelectorAll<HTMLButtonElement>("[data-dispose-trade-adjust]")
        .forEach((button) =>
            button.addEventListener("click", () => {
                adjustDisposeTrade(
                    Number(button.dataset.disposeTradeAdjust ?? 0),
                );
                render();
            })
        );

    document.querySelectorAll<HTMLButtonElement>("[data-dispose-sell-adjust]")
        .forEach((button) =>
            button.addEventListener("click", () => {
                adjustDisposeSell(Number(button.dataset.disposeSellAdjust ?? 0));
                render();
            })
        );

    document.querySelector<HTMLButtonElement>("#dispose-submit")
        ?.addEventListener("click", () => {
            submitDisposeShareDraft();
        });

    document.querySelector<HTMLFormElement>("#buy-form")?.addEventListener(
        "submit",
        (event) => event.preventDefault(),
    );

    document.querySelectorAll<HTMLButtonElement>("[data-buy-available]")
        .forEach((button) =>
            button.addEventListener("click", () => {
                addShareToPurchaseCart(Number(button.dataset.buyAvailable));
                render();
            })
        );

    document.querySelectorAll<HTMLButtonElement>("[data-buy-cart-index]")
        .forEach((button) =>
            button.addEventListener("click", () => {
                removeShareFromPurchaseCart(
                    Number(button.dataset.buyCartIndex),
                );
                render();
            })
        );

    document.querySelector<HTMLInputElement>("#buy-end-game")
        ?.addEventListener("change", (event) => {
            if (event.currentTarget instanceof HTMLInputElement) {
                purchaseShareEndGame = event.currentTarget.checked;
            }
        });

    document.querySelector<HTMLButtonElement>("#buy-submit")
        ?.addEventListener("click", () => {
            submitPurchaseCart();
        });
}

function resolvePlayTile(tileIndex: number) {
    const entry = appState.liveGame.tileRack[tileIndex];
    if (
        entry === null || entry === undefined ||
        appState.liveGame.pendingDecision?.kind !== "playTile"
    ) {
        return;
    }

    if (
        entry.typeId !== GAME_BOARD_TYPES.CantPlayEver &&
        entry.typeId !== GAME_BOARD_TYPES.CantPlayNow
    ) {
        humanPlayer.resolveDecision(tileIndex);
    }
}

function resolvePlayTileFromBoardCoordinate(x: number, y: number) {
    const tileIndex = findTileRackIndexForCoordinate(x, y);
    if (tileIndex !== null) {
        resolvePlayTile(tileIndex);
    }
}

function findTileRackIndexForCoordinate(x: number, y: number) {
    const row = String.fromCharCode(y + 65);
    const column = x + 1;
    const tileIndex = appState.liveGame.tileRack.findIndex((entry) =>
        entry !== null && entry.tile.row === row && entry.tile.column === column
    );
    return tileIndex >= 0 ? tileIndex : null;
}

function submitBuyDecision(purchase: SharePurchase, endGame = false) {
    const cart: number[] = [];
    const cash =
        appState.liveGame.scoreSheet[appState.liveGame.playerId ?? 0]?.[7] ??
            0;
    let totalCost = 0;

    for (const chain of HOTEL_CHAINS) {
        const amount = purchase[chain] ?? 0;
        const chainIndex = HOTEL_CHAINS.indexOf(chain);
        const available = appState.liveGame.scoreSheet[6]?.[chainIndex] ?? 0;
        const price = appState.liveGame.scoreSheet[8]?.[chainIndex] ?? 0;

        if (!Number.isInteger(amount) || amount < 0 || amount > available) {
            return;
        }

        totalCost += amount * price;
        for (let index = 0; index < amount; index += 1) {
            cart.push(chainIndex);
        }
    }

    if (cart.length > 3 || totalCost > cash) {
        return;
    }

    awaitingServerActionAdvance = true;
    network.send(
        COMMANDS_TO_SERVER.DoGameAction,
        GAME_ACTIONS.PurchaseShares,
        cart,
        endGame ? 1 : 0,
    );
    appState.liveGame.pendingDecision = null;
    resetPurchaseShareDraft();
    render();
}

function getDisposeShareSummary(pending: {
    maxTrade: number;
    maxSell: number;
}) {
    const trade = Math.max(0, Math.min(disposeTradeShares, pending.maxTrade));
    const sellCap = Math.max(0, pending.maxSell - trade);
    const sell = Math.max(0, Math.min(disposeSellShares, sellCap));
    const keep = Math.max(0, pending.maxSell - trade - sell);

    return { trade, sell, sellCap, keep };
}

function adjustDisposeTrade(delta: number) {
    const pending = appState.liveGame.pendingDecision;
    if (pending?.kind !== "disposeShares") {
        return;
    }

    const nextTrade = Math.max(
        0,
        Math.min(disposeTradeShares + delta, pending.maxTrade),
    );
    disposeTradeShares = nextTrade - (nextTrade % 2);
    const sellCap = Math.max(0, pending.maxSell - disposeTradeShares);
    disposeSellShares = Math.min(disposeSellShares, sellCap);
}

function adjustDisposeSell(delta: number) {
    const pending = appState.liveGame.pendingDecision;
    if (pending?.kind !== "disposeShares") {
        return;
    }

    const sellCap = Math.max(0, pending.maxSell - disposeTradeShares);
    disposeSellShares = Math.max(
        0,
        Math.min(disposeSellShares + delta, sellCap),
    );
}

function submitDisposeShareDraft() {
    const pending = appState.liveGame.pendingDecision;
    if (pending?.kind !== "disposeShares") {
        return;
    }

    const summary = getDisposeShareSummary(pending);
    awaitingServerActionAdvance = true;
    network.send(
        COMMANDS_TO_SERVER.DoGameAction,
        GAME_ACTIONS.DisposeOfShares,
        summary.trade,
        summary.sell,
    );
    appState.liveGame.pendingDecision = null;
    resetDisposeShareDraft();
    render();
}

function applyServerMessage([command, ...payload]: [number, ...unknown[]]) {
    switch (command) {
        case COMMANDS_TO_CLIENT.FatalError:
            pendingCredentialSubmission = null;
            appState.connectionStatus = "welcome";
            appState.errorMessage = errorMessageFor(
                Number(payload[0] ?? ERRORS.GenericError),
            );
            break;
        case COMMANDS_TO_CLIENT.SetClientId:
            appState.selfClientId = Number(payload[0]);
            appState.errorMessage = null;
            break;
        case COMMANDS_TO_CLIENT.SetClientIdToData:
            applyClientData(payload);
            break;
        case COMMANDS_TO_CLIENT.SetGameState:
            applyGameState(payload);
            break;
        case COMMANDS_TO_CLIENT.SetGamePlayerJoin:
            applyGamePlayerJoin(payload);
            break;
        case COMMANDS_TO_CLIENT.SetGamePlayerRejoin:
            applyGamePlayerRejoin(payload);
            break;
        case COMMANDS_TO_CLIENT.SetGamePlayerLeave:
            applyGamePlayerLeave(payload);
            break;
        case COMMANDS_TO_CLIENT.SetGamePlayerJoinMissing:
            applyGamePlayerJoinMissing(payload);
            break;
        case COMMANDS_TO_CLIENT.SetGameWatcherClientId:
            applyGameWatcherJoin(payload);
            break;
        case COMMANDS_TO_CLIENT.ReturnWatcherToLobby:
            applyGameWatcherLeave(payload);
            break;
        case COMMANDS_TO_CLIENT.DestroyGame:
            delete appState.games[Number(payload[0])];
            break;
        case COMMANDS_TO_CLIENT.SetGameBoardCell:
            updateBoardCell(
                Number(payload[0]),
                Number(payload[1]),
                Number(payload[2]),
            );
            break;
        case COMMANDS_TO_CLIENT.SetGameBoard:
            applyWholeBoard(payload[0] as number[][]);
            break;
        case COMMANDS_TO_CLIENT.SetTile:
            applyTile(payload);
            break;
        case COMMANDS_TO_CLIENT.SetTileGameBoardType:
            applyTileType(payload);
            break;
        case COMMANDS_TO_CLIENT.RemoveTile:
            appState.liveGame.tileRack[Number(payload[0])] = null;
            break;
        case COMMANDS_TO_CLIENT.SetScoreSheetCell:
            applyScoreCell(payload);
            break;
        case COMMANDS_TO_CLIENT.SetScoreSheet:
            applyScoreSheet(payload[0] as [number[][], number[]]);
            break;
        case COMMANDS_TO_CLIENT.SetTurn:
            appState.liveGame.turnPlayerId = payload[0] === null
                ? null
                : Number(payload[0]);
            break;
        case COMMANDS_TO_CLIENT.SetGameAction:
            void applyGameAction(payload);
            break;
        case COMMANDS_TO_CLIENT.AddGameHistoryMessage:
            if (Number(payload[0]) !== GAME_HISTORY_MESSAGES.TurnBegan) {
                appState.liveGame.history.push(formatHistoryEntry(payload));
            }
            break;
        case COMMANDS_TO_CLIENT.AddGameHistoryMessages:
            for (const entry of (payload[0] as unknown[])) {
                if (
                    Array.isArray(entry) &&
                    Number(entry[0]) !== GAME_HISTORY_MESSAGES.TurnBegan
                ) {
                    appState.liveGame.history.push(formatHistoryEntry(entry));
                }
            }
            break;
        case COMMANDS_TO_CLIENT.AddGameChatMessage:
            appState.liveGame.chat.push(formatChatMessage(payload));
            break;
        case COMMANDS_TO_CLIENT.AddGlobalChatMessage:
            appState.globalChat.push(formatChatMessage(payload));
            break;
    }

    if (
        appState.selfClientId !== null &&
        appState.connectionStatus === "connecting"
    ) {
        appState.connectionStatus = appState.liveGame.gameId === null
            ? "lobby"
            : "game";
    }

    syncPendingDecisionFromCurrentAction();
}

function applyClientData(payload: unknown[]) {
    const clientId = Number(payload[0]);
    const username = payload[1];
    const ipAddress = payload[2];

    if (username === null) {
        delete appState.clients[clientId];
        appState.lobbyClientIds = appState.lobbyClientIds.filter((id) =>
            id !== clientId
        );
        return;
    }

    appState.clients[clientId] = {
        clientId,
        username: String(username),
        ipAddress: String(ipAddress ?? ""),
    };

    if (!appState.lobbyClientIds.includes(clientId)) {
        appState.lobbyClientIds.push(clientId);
        appState.lobbyClientIds.sort((a, b) => a - b);
    }

    if (clientId === appState.selfClientId) {
        appState.selfUsername = String(username);
        if (pendingCredentialSubmission !== null) {
            void storeBrowserCredential(
                String(username),
                pendingCredentialSubmission.password,
            );
            pendingCredentialSubmission = null;
        }
    }
}

function applyGameState(payload: unknown[]) {
    const gameId = Number(payload[0]);
    const stateId = Number(payload[1]);
    const modeId = Number(payload[2] ?? GAME_MODES.Singles);
    const maxPlayers = Number(payload[3] ?? 4);
    const score = payload[4] === undefined ? null : Number(payload[4]);

    const existingGame = appState.games[gameId] ??
        createLobbyGame(gameId, stateId, modeId, maxPlayers, score);
    existingGame.stateId = stateId as 0 | 1 | 2 | 3;
    existingGame.modeId = modeId as 0 | 1;
    existingGame.maxPlayers = maxPlayers;
    existingGame.score = score;
    appState.games[gameId] = existingGame;

    if (
        stateId === GAME_STATES.Completed &&
        appState.liveGame.gameId === gameId
    ) {
        const finalScores = Array.isArray(payload[4])
            ? payload[4].map(Number)
            : undefined;
        appendFinalRanking(finalScores);
    }
}

function appendFinalRanking(serverScores?: number[]) {
    if (
        appState.liveGame.history.some((entry) =>
            entry.includes('class="history-final-ranking"')
        )
    ) {
        return;
    }

    const game = appState.games[appState.liveGame.gameId ?? -1];
    const playerCount = game?.players.length ?? 0;
    if (playerCount === 0) {
        return;
    }

    const derivedScores = deriveScoreSheetValues(playerCount).playerRows.map(
        (row) => row[8] ?? 0,
    );
    const ranked = Array.from({ length: playerCount }, (_, playerId) => ({
        playerId,
        score: serverScores?.[playerId] ?? derivedScores[playerId] ?? 0,
    })).sort((left, right) =>
        right.score - left.score || left.playerId - right.playerId
    );

    let previousScore: number | undefined;
    let previousRank = 0;
    const standings = ranked.map((entry, index) => {
        const rank = entry.score === previousScore ? previousRank : index + 1;
        previousScore = entry.score;
        previousRank = rank;
        const name = `<strong class="history-player ${
            entry.playerId === appState.liveGame.playerId
                ? "history-player--current"
                : ""
        }">${escapeHtml(playerDisplayName(entry.playerId))}</strong>`;
        return `${ordinal(rank)}: ${name} ($${
            (entry.score * 100).toLocaleString()
        })`;
    });

    appState.liveGame.history.push(
        `<span class="history-final-ranking">Final standings — ${
            standings.join("; ")
        }</span>`,
    );
}

function ordinal(value: number) {
    const lastTwoDigits = value % 100;
    if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
        return `${value}th`;
    }
    switch (value % 10) {
        case 1:
            return `${value}st`;
        case 2:
            return `${value}nd`;
        case 3:
            return `${value}rd`;
        default:
            return `${value}th`;
    }
}

function isSelfInLobbyGame(gameId: number) {
    const username = appState.selfUsername;
    const game = appState.games[gameId];
    if (username === null || game === undefined) {
        return false;
    }

    return game.players.some((player) => player.username === username);
}

function applyGamePlayerJoin(payload: unknown[]) {
    const gameId = Number(payload[0]);
    const playerId = Number(payload[1]);
    const clientId = Number(payload[2]);
    const game = appState.games[gameId];
    const client = appState.clients[clientId];
    if (game === undefined || client === undefined) {
        return;
    }

    game.players.splice(playerId, 0, { username: client.username, clientId });
    appState.lobbyClientIds = appState.lobbyClientIds.filter((id) =>
        id !== clientId
    );
    if (clientId === appState.selfClientId) {
        appState.liveGame.gameId = gameId;
        appState.liveGame.playerId = playerId;
        appState.connectionStatus = "game";
        appState.enteringGameId = null;
        appState.lobbyCollapsed = true;
    }
}

function applyGamePlayerRejoin(payload: unknown[]) {
    const gameId = Number(payload[0]);
    const playerId = Number(payload[1]);
    const clientId = Number(payload[2]);
    const game = appState.games[gameId];
    const client = appState.clients[clientId];
    if (
        game === undefined || client === undefined ||
        game.players[playerId] === undefined
    ) {
        return;
    }

    game.players[playerId] = {
        username: game.players[playerId].username,
        clientId,
    };
    appState.lobbyClientIds = appState.lobbyClientIds.filter((id) =>
        id !== clientId
    );
    if (clientId === appState.selfClientId) {
        appState.liveGame.gameId = gameId;
        appState.liveGame.playerId = playerId;
        appState.connectionStatus = "game";
        appState.enteringGameId = null;
        appState.lobbyCollapsed = true;
    }
}

function applyGamePlayerLeave(payload: unknown[]) {
    const gameId = Number(payload[0]);
    const playerId = Number(payload[1]);
    const clientId = Number(payload[2]);
    const game = appState.games[gameId];
    const client = appState.clients[clientId];
    if (
        game === undefined || game.players[playerId] === undefined ||
        client === undefined
    ) {
        return;
    }

    game.players[playerId] = {
        username: game.players[playerId].username,
        clientId: null,
    };
    if (!appState.lobbyClientIds.includes(clientId)) {
        appState.lobbyClientIds.push(clientId);
    }

    if (clientId === appState.selfClientId) {
        resetLiveGame(appState);
        appState.connectionStatus = "lobby";
        appState.enteringGameId = null;
        appState.lobbyCollapsed = false;
    }
}

function applyGamePlayerJoinMissing(payload: unknown[]) {
    const gameId = Number(payload[0]);
    const playerId = Number(payload[1]);
    const username = resolveMissingPlayerUsername(payload[2]);
    const game = appState.games[gameId];
    if (game === undefined) {
        return;
    }

    game.players.splice(playerId, 0, { username, clientId: null });
}

function resolveMissingPlayerUsername(value: unknown) {
    if (typeof value === "number") {
        return appState.clients[value]?.username ?? String(value);
    }

    return String(value);
}

function applyGameWatcherJoin(payload: unknown[]) {
    const gameId = Number(payload[0]);
    const clientId = Number(payload[1]);
    const game = appState.games[gameId];
    if (game === undefined) {
        return;
    }

    if (!game.watcherClientIds.includes(clientId)) {
        game.watcherClientIds.push(clientId);
    }
    appState.lobbyClientIds = appState.lobbyClientIds.filter((id) =>
        id !== clientId
    );
    if (clientId === appState.selfClientId) {
        appState.liveGame.gameId = gameId;
        appState.liveGame.playerId = null;
        appState.connectionStatus = "game";
        appState.enteringGameId = null;
        appState.lobbyCollapsed = true;
    }
}

function applyGameWatcherLeave(payload: unknown[]) {
    const gameId = Number(payload[0]);
    const clientId = Number(payload[1]);
    const game = appState.games[gameId];
    if (game === undefined) {
        return;
    }

    game.watcherClientIds = game.watcherClientIds.filter((id) =>
        id !== clientId
    );
    if (!appState.lobbyClientIds.includes(clientId)) {
        appState.lobbyClientIds.push(clientId);
    }
    if (clientId === appState.selfClientId) {
        resetLiveGame(appState);
        appState.connectionStatus = "lobby";
        appState.enteringGameId = null;
        appState.lobbyCollapsed = false;
    }
}

function updateBoardCell(x: number, y: number, typeId: number) {
    const cell = appState.liveGame.board.find((entry) =>
        entry.x === x && entry.y === y
    );
    if (cell !== undefined) {
        cell.typeId = typeId;
    }
}

function applyWholeBoard(board: number[][]) {
    board.forEach((column, x) =>
        column.forEach((typeId, y) => updateBoardCell(x, y, typeId))
    );
}

function applyTile(payload: unknown[]) {
    const tileIndex = Number(payload[0]);
    const x = Number(payload[1]);
    const y = Number(payload[2]);
    const typeId = Number(payload[3]);
    appState.liveGame.tileRack[tileIndex] = {
        tile: { row: String.fromCharCode(65 + y), column: x + 1 },
        typeId,
    };
}

function applyTileType(payload: unknown[]) {
    const tileIndex = Number(payload[0]);
    const typeId = Number(payload[1]);
    const existing = appState.liveGame.tileRack[tileIndex];
    if (existing !== null && existing !== undefined) {
        existing.typeId = typeId;
    }
}

function applyScoreCell(payload: unknown[]) {
    const row = Number(payload[0]);
    const column = Number(payload[1]);
    const value = Number(payload[2]);
    const rowData = appState.liveGame.scoreSheet[row];
    if (rowData !== undefined) {
        rowData[column] = value;
    }
}

function applyScoreSheet([playerRows, chainRows]: [number[][], number[]]) {
    playerRows.forEach((row, index) => {
        appState.liveGame.scoreSheet[index] = [...row];
    });
    appState.liveGame.scoreSheet[7] = [...chainRows];
}

function deriveScoreSheetValues(playerCount: number) {
    const playerRows = Array.from(
        { length: playerCount },
        (_, index) => [...(appState.liveGame.scoreSheet[index] ?? [])],
    );
    const chainSizes = Array.from(
        { length: 7 },
        (_, index) => appState.liveGame.scoreSheet[7]?.[index] ?? 0,
    );
    const available = Array.from(
        { length: 7 },
        (_, index) =>
            25 -
            playerRows.reduce((total, row) => total + (row[index] ?? 0), 0),
    );
    const prices = chainSizes.map((size, chainIndex) =>
        sharePriceForChain(chainIndex, size)
    );
    const bonusesByChain = chainSizes.map((size, chainIndex) => {
        if (size <= 0) {
            return Array.from({ length: playerCount }, () => 0);
        }

        const holdings = playerRows.map((row) => row[chainIndex] ?? 0);
        return computeBonuses(holdings, prices[chainIndex] ?? 0);
    });

    const derivedPlayerRows = playerRows.map((row, playerIndex) => {
        const holdingsValue = prices.reduce(
            (sum, price, chainIndex) => sum + (row[chainIndex] ?? 0) * price,
            0,
        );
        const bonuses = bonusesByChain.reduce(
            (sum, chainBonuses) => sum + (chainBonuses[playerIndex] ?? 0),
            0,
        );
        const cash = row[7] ?? 0;
        const net = cash + holdingsValue + bonuses;
        return [...row.slice(0, 8), net];
    });

    return {
        playerRows: derivedPlayerRows,
        available,
        chainSizes,
        prices,
    };
}

function sharePriceForChain(chainIndex: number, size: number) {
    if (size <= 0) {
        return 0;
    }

    let basePrice = 0;
    if (size < 11) {
        basePrice = Math.min(size, 6);
    } else {
        basePrice = Math.min(Math.floor((size - 1) / 10) + 6, 10);
    }

    if (chainIndex >= 2) {
        basePrice += 1;
    }
    if (chainIndex >= 5) {
        basePrice += 1;
    }

    return basePrice;
}

function computeBonuses(holdings: number[], price: number) {
    const bonuses = Array.from({ length: holdings.length }, () => 0);
    if (holdings.length === 0 || price <= 0) {
        return bonuses;
    }

    const ranked = holdings
        .map((amount, playerId) => ({ playerId, amount }))
        .sort((left, right) => right.amount - left.amount);

    const first = ranked[0];
    const second = ranked[1];
    if (first === undefined || first.amount === 0) {
        return bonuses;
    }

    const firstBonus = price * 10;
    const secondBonus = firstBonus / 2;

    if (second === undefined || second.amount === 0) {
        bonuses[first.playerId] = firstBonus + secondBonus;
        return bonuses;
    }

    if (first.amount === second.amount) {
        const tiedForFirst = ranked.filter((entry) =>
            entry.amount === first.amount
        );
        const splitAmount = Math.ceil(
            (firstBonus + secondBonus) / tiedForFirst.length,
        );
        tiedForFirst.forEach((entry) => {
            bonuses[entry.playerId] = splitAmount;
        });
        return bonuses;
    }

    bonuses[first.playerId] = firstBonus;

    const tiedForSecond = ranked.filter((entry, index) =>
        index > 0 && entry.amount === second.amount
    );
    if (tiedForSecond.length === 1) {
        bonuses[second.playerId] = secondBonus;
        return bonuses;
    }

    const splitSecond = Math.ceil(secondBonus / tiedForSecond.length);
    tiedForSecond.forEach((entry) => {
        bonuses[entry.playerId] = splitSecond;
    });

    return bonuses;
}

async function applyGameAction(payload: unknown[]) {
    const actionId = Number(payload[0]);
    const playerId = payload[1] === null ? null : Number(payload[1]);
    const actionArguments = payload.slice(2);
    const argument = actionArguments.length <= 1 ? actionArguments[0] : actionArguments;
    awaitingServerActionAdvance = false;
    appState.liveGame.currentAction = {
        actionId: actionId as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
        playerId,
        argument,
    };

    if (playerId !== appState.liveGame.playerId) {
        return;
    }

    const gameState = createViewGameState(appState);
    if (actionId === GAME_ACTIONS.PlayTile) {
        const selectedIndex = await humanPlayer.playTile(
            gameState,
            gameState.self.validTiles,
            gameState.self.invalidTiles,
        );
        awaitingServerActionAdvance = true;
        network.send(
            COMMANDS_TO_SERVER.DoGameAction,
            GAME_ACTIONS.PlayTile,
            selectedIndex,
        );
    } else if (actionId === GAME_ACTIONS.SelectNewChain) {
        const selectedIndex = await humanPlayer.determineChainToStart(
            gameState,
            mapChainIndexes(argument),
        );
        awaitingServerActionAdvance = true;
        network.send(COMMANDS_TO_SERVER.DoGameAction, actionId, selectedIndex);
    } else if (
        actionId === GAME_ACTIONS.SelectMergerSurvivor ||
        actionId === GAME_ACTIONS.SelectChainToDisposeOfNext
    ) {
        const mergeTile = gameState.self.validTiles[0] ??
            { row: "A", column: 1 };
        const selectedIndex = await humanPlayer.determineMergeSurvivor(
            gameState,
            mergeTile,
            mapChainIndexes(argument),
        );
        awaitingServerActionAdvance = true;
        network.send(COMMANDS_TO_SERVER.DoGameAction, actionId, selectedIndex);
    } else if (actionId === GAME_ACTIONS.DisposeOfShares) {
        resetPurchaseShareDraft();
        resetDisposeShareDraft();
        const defunctTypeId = Number(
            Array.isArray(argument) ? argument[0] : undefined,
        );
        const controllingTypeId = Number(
            Array.isArray(argument) ? argument[1] : undefined,
        );
        const defunctChain = HOTEL_CHAINS[defunctTypeId];
        const controllingChain = HOTEL_CHAINS[controllingTypeId];
        if (defunctChain === undefined || controllingChain === undefined) {
            return;
        }

        appState.liveGame.pendingDecision = {
            kind: "disposeShares",
            survivingChain: controllingChain,
            mergeChain: defunctChain,
            maxTrade: Math.floor(
                Math.min(
                    appState.liveGame
                        .scoreSheet[appState.liveGame.playerId ?? 0]?.[
                            defunctTypeId
                        ] ?? 0,
                    (appState.liveGame.scoreSheet[6]?.[controllingTypeId] ??
                        0) * 2,
                ) / 2,
            ) * 2,
            maxSell: appState.liveGame.scoreSheet[
                appState.liveGame.playerId ?? 0
            ]?.[defunctTypeId] ?? 0,
        };
        render();
    } else if (actionId === GAME_ACTIONS.PurchaseShares) {
        const cash =
            appState.liveGame.scoreSheet[appState.liveGame.playerId ?? 0]
                ?.[7] ??
                0;
        resetPurchaseShareDraft();
        appState.liveGame.pendingDecision = {
            kind: "buyShares",
            availableChains: HOTEL_CHAINS.filter((chain, index) =>
                (appState.liveGame.scoreSheet[6]?.[index] ?? 0) > 0 &&
                sharePriceForChain(
                        index,
                        appState.liveGame.scoreSheet[7]?.[index] ?? 0,
                    ) > 0 &&
                sharePriceForChain(
                        index,
                        appState.liveGame.scoreSheet[7]?.[index] ?? 0,
                    ) <= cash
            ),
            canEndGame: canCurrentGameEnd(),
        };
        render();
    }
}

function syncPendingDecisionFromCurrentAction() {
    if (awaitingServerActionAdvance) {
        return;
    }

    const currentAction = appState.liveGame.currentAction;
    if (
        currentAction === null ||
        currentAction.playerId !== appState.liveGame.playerId ||
        appState.liveGame.playerId === null
    ) {
        return;
    }

    if (appState.liveGame.pendingDecision !== null) {
        return;
    }

    const gameState = createViewGameState(appState);

    if (currentAction.actionId === GAME_ACTIONS.PlayTile) {
        appState.liveGame.pendingDecision = {
            kind: "playTile",
            validTiles: gameState.self.validTiles,
            invalidTilesInHand: gameState.self.invalidTiles,
        };
        return;
    }

    if (
        currentAction.actionId === GAME_ACTIONS.SelectNewChain ||
        currentAction.actionId === GAME_ACTIONS.SelectMergerSurvivor ||
        currentAction.actionId === GAME_ACTIONS.SelectChainToDisposeOfNext
    ) {
        appState.liveGame.pendingDecision = {
            kind: "selectChain",
            validChains: mapChainIndexes(currentAction.argument),
            actionId: currentAction.actionId,
        };
        return;
    }

    if (currentAction.actionId === GAME_ACTIONS.DisposeOfShares) {
        resetDisposeShareDraft();
        const argument = currentAction.argument;
        const defunctTypeId = Number(
            Array.isArray(argument) ? argument[0] : undefined,
        );
        const controllingTypeId = Number(
            Array.isArray(argument) ? argument[1] : undefined,
        );
        const defunctChain = HOTEL_CHAINS[defunctTypeId];
        const controllingChain = HOTEL_CHAINS[controllingTypeId];
        if (defunctChain === undefined || controllingChain === undefined) {
            return;
        }

        appState.liveGame.pendingDecision = {
            kind: "disposeShares",
            survivingChain: controllingChain,
            mergeChain: defunctChain,
            maxTrade: Math.floor(
                Math.min(
                    appState.liveGame
                        .scoreSheet[appState.liveGame.playerId]?.[
                            defunctTypeId
                        ] ?? 0,
                    (appState.liveGame.scoreSheet[6]?.[controllingTypeId] ??
                        0) * 2,
                ) / 2,
            ) * 2,
            maxSell: appState.liveGame.scoreSheet[
                appState.liveGame.playerId
            ]?.[defunctTypeId] ?? 0,
        };
        return;
    }

    if (currentAction.actionId === GAME_ACTIONS.PurchaseShares) {
        const cash =
            appState.liveGame.scoreSheet[appState.liveGame.playerId]?.[7] ?? 0;
        resetPurchaseShareDraft();
        appState.liveGame.pendingDecision = {
            kind: "buyShares",
            availableChains: HOTEL_CHAINS.filter((chain, index) =>
                (appState.liveGame.scoreSheet[6]?.[index] ?? 0) > 0 &&
                sharePriceForChain(
                        index,
                        appState.liveGame.scoreSheet[7]?.[index] ?? 0,
                    ) > 0 &&
                sharePriceForChain(
                        index,
                        appState.liveGame.scoreSheet[7]?.[index] ?? 0,
                    ) <= cash
            ),
            canEndGame: canCurrentGameEnd(),
        };
    }
}

function getBuySummary() {
    return HOTEL_CHAINS.map((chain) => {
        const chainIndex = HOTEL_CHAINS.indexOf(chain);
        const available = appState.liveGame.scoreSheet[6]?.[chainIndex] ?? 0;
        const price = sharePriceForChain(
            chainIndex,
            appState.liveGame.scoreSheet[7]?.[chainIndex] ?? 0,
        );
        return {
            chain,
            chainIndex,
            available,
            price,
            isPurchasable: available > 0 && price > 0,
        };
    });
}

function getPurchaseCartSummary(
    buySummary: Array<{
        chain: HotelChain;
        chainIndex: number;
        available: number;
        price: number;
        isPurchasable: boolean;
    }>,
) {
    const cash =
        appState.liveGame.scoreSheet[appState.liveGame.playerId ?? 0]?.[7] ??
            0;
    const counts = new Map<number, number>();
    let totalSpent = 0;
    let selectedCount = 0;

    for (const chainIndex of purchaseShareCart) {
        if (chainIndex === null) {
            continue;
        }
        counts.set(chainIndex, (counts.get(chainIndex) ?? 0) + 1);
        totalSpent += buySummary.find((entry) =>
            entry.chainIndex === chainIndex
        )
            ?.price ?? 0;
        selectedCount += 1;
    }

    return {
        cash,
        totalSpent,
        cashLeft: cash - totalSpent,
        selectedCount,
        counts,
    };
}

function isPurchaseOptionDisabled(
    chainIndex: number,
    buySummary: Array<{
        chain: HotelChain;
        chainIndex: number;
        available: number;
        price: number;
        isPurchasable: boolean;
    }>,
) {
    const summary = getPurchaseCartSummary(buySummary);
    const entry = buySummary.find((option) => option.chainIndex === chainIndex);
    if (entry === undefined) {
        return true;
    }

    return !entry.isPurchasable ||
        summary.selectedCount >= 3 ||
        summary.cashLeft < entry.price ||
        (summary.counts.get(chainIndex) ?? 0) >= entry.available;
}

function renderPurchaseCartSlot(
    index: number,
    buySummary: Array<{
        chain: HotelChain;
        chainIndex: number;
        available: number;
        price: number;
        isPurchasable: boolean;
    }>,
) {
    const chainIndex = purchaseShareCart[index];
    if (chainIndex === null) {
        return `<button class="purchase-cart-slot purchase-cart-slot--empty" type="button" disabled>Empty</button>`;
    }

    const entry = buySummary.find((option) => option.chainIndex === chainIndex);
    if (entry === undefined) {
        return `<button class="purchase-cart-slot purchase-cart-slot--empty" type="button" disabled>Empty</button>`;
    }

    return `<button class="purchase-cart-slot purchase-cart-slot--${entry.chain.toLowerCase()}" type="button" data-buy-cart-index="${index}">
      <span>${entry.price * 100}</span>
    </button>`;
}

function addShareToPurchaseCart(chainIndex: number) {
    const pending = appState.liveGame.pendingDecision;
    if (pending?.kind !== "buyShares") {
        return;
    }

    const buySummary = getBuySummary();
    if (isPurchaseOptionDisabled(chainIndex, buySummary)) {
        return;
    }

    const emptyIndex = purchaseShareCart.findIndex((entry) => entry === null);
    if (emptyIndex >= 0) {
        purchaseShareCart[emptyIndex] = chainIndex;
    }
}

function removeShareFromPurchaseCart(index: number) {
    if (index >= 0 && index < purchaseShareCart.length) {
        purchaseShareCart[index] = null;
    }
}

function submitPurchaseCart() {
    const pending = appState.liveGame.pendingDecision;
    if (pending?.kind !== "buyShares") {
        return;
    }

    const purchase: SharePurchase = {};
    for (const chainIndex of purchaseShareCart) {
        if (chainIndex === null) {
            continue;
        }
        const chain = HOTEL_CHAINS[chainIndex];
        if (chain === undefined) {
            continue;
        }
        purchase[chain] = (purchase[chain] ?? 0) + 1;
    }

    submitBuyDecision(purchase, purchaseShareEndGame);
}

function resetPurchaseShareDraft() {
    purchaseShareCart = [null, null, null];
    purchaseShareEndGame = false;
}

function resetDisposeShareDraft() {
    disposeTradeShares = 0;
    disposeSellShares = 0;
}

function canCurrentGameEnd() {
    const existingChainSizes =
        appState.liveGame.scoreSheet[7]?.filter((size) => size > 0) ?? [];
    return existingChainSizes.length > 0 &&
        (
            Math.min(...existingChainSizes) >= 11 ||
            Math.max(...existingChainSizes) >= 41
        );
}

function mapChainIndexes(argument: unknown): HotelChain[] {
    if (!Array.isArray(argument)) {
        return [];
    }

    return argument
        .map((index) => HOTEL_CHAINS[Number(index)])
        .filter((chain): chain is HotelChain => chain !== undefined);
}

function boardClassName(typeId: number) {
    switch (typeId) {
        case GAME_BOARD_TYPES.Luxor:
            return "board-cell--luxor";
        case GAME_BOARD_TYPES.Tower:
            return "board-cell--tower";
        case GAME_BOARD_TYPES.American:
            return "board-cell--american";
        case GAME_BOARD_TYPES.Festival:
            return "board-cell--festival";
        case GAME_BOARD_TYPES.Worldwide:
            return "board-cell--worldwide";
        case GAME_BOARD_TYPES.Continental:
            return "board-cell--continental";
        case GAME_BOARD_TYPES.Imperial:
            return "board-cell--imperial";
        case GAME_BOARD_TYPES.NothingYet:
            return "board-cell--nothing-yet";
        case GAME_BOARD_TYPES.CantPlayEver:
            return "board-cell--cant-play-ever";
        case GAME_BOARD_TYPES.IHaveThis:
            return "board-cell--i-have-this";
        case GAME_BOARD_TYPES.WillPutLonelyTileDown:
            return "board-cell--lonely";
        case GAME_BOARD_TYPES.HaveNeighboringTileToo:
            return "board-cell--neighbor";
        case GAME_BOARD_TYPES.WillFormNewChain:
            return "board-cell--new-chain";
        case GAME_BOARD_TYPES.WillMergeChains:
            return "board-cell--merge";
        case GAME_BOARD_TYPES.CantPlayNow:
            return "board-cell--cant-play-now";
        default:
            return "board-cell--nothing";
    }
}

function boardCellLabel(typeId: number, x: number, y: number) {
    if (typeId <= GAME_BOARD_TYPES.Imperial) {
        const chain = HOTEL_CHAINS[typeId];
        return chain === undefined ? tileName(x, y) : chain[0];
    }

    return tileName(x, y);
}

function tileName(x: number, y: number) {
    return `${x + 1}${String.fromCharCode(y + 65)}`;
}

function mergeTileStyle(entry: NonNullable<typeof appState.liveGame.tileRack[number]>) {
    if (entry.typeId !== GAME_BOARD_TYPES.WillMergeChains) {
        return "";
    }

    const x = entry.tile.column - 1;
    const y = entry.tile.row.charCodeAt(0) - 65;
    const neighboringChainIds = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
    ].map(([neighborX, neighborY]) =>
        appState.liveGame.board.find((cell) =>
            cell.x === neighborX && cell.y === neighborY
        )?.typeId
    ).filter((typeId): typeId is number =>
        typeId !== undefined && typeId >= 0 && typeId <= GAME_BOARD_TYPES.Imperial
    );
    const uniqueChainIds = [...new Set(neighboringChainIds)];
    if (uniqueChainIds.length < 2) {
        return "";
    }

    return `style="--merge-color-a: ${hotelChainColor(uniqueChainIds[0]!)}; --merge-color-b: ${
        hotelChainColor(uniqueChainIds[1]!)
    };"`;
}

function hotelChainColor(chainIndex: number) {
    return ["#ff5151", "#ffec69", "#5982ff", "#71df77", "#9d6c2f", "#71e6ef", "#e46ee9"][chainIndex] ?? "#fff";
}

function formatHistoryEntry(payload: unknown[]) {
    const messageId = Number(payload[0]);
    const playerId = payload[1] === null ? null : Number(payload[1]);
    const playerName = playerId === null
        ? ""
        : `<strong class="history-player ${
            playerId === appState.liveGame.playerId ? "history-player--current" : ""
        }">${escapeHtml(playerDisplayName(playerId))}</strong>`;
    const argument2 = payload[2];
    const argument3 = payload[3];
    const argument4 = payload[4];

    switch (messageId) {
        case GAME_HISTORY_MESSAGES.TurnBegan:
            return `${playerName} began their turn.`;
        case GAME_HISTORY_MESSAGES.DrewPositionTile:
            return `${playerName} drew position tile ${
                tileName(Number(argument2), Number(argument3))
            }.`;
        case GAME_HISTORY_MESSAGES.StartedGame:
            return `${playerName} started the game.`;
        case GAME_HISTORY_MESSAGES.DrewTile:
            return playerId === appState.liveGame.playerId
                ? `${playerName} drew tile ${
                    tileName(Number(argument2), Number(argument3))
                }.`
                : `${playerName} drew a tile.`;
        case GAME_HISTORY_MESSAGES.HasNoPlayableTile:
            return `${playerName} has no playable tile.`;
        case GAME_HISTORY_MESSAGES.PlayedTile:
            return `${playerName} played tile ${
                tileName(Number(argument2), Number(argument3))
            }.`;
        case GAME_HISTORY_MESSAGES.FormedChain:
            return `${playerName} formed ${chainName(Number(argument2))}.`;
        case GAME_HISTORY_MESSAGES.MergedChains:
            return `${playerName} merged ${formatChainList(argument2)}.`;
        case GAME_HISTORY_MESSAGES.SelectedMergerSurvivor:
            return `${playerName} selected ${
                chainName(Number(argument2))
            } as the surviving chain.`;
        case GAME_HISTORY_MESSAGES.SelectedChainToDisposeOfNext:
            return `${playerName} selected ${
                chainName(Number(argument2))
            } as the next chain to dispose of.`;
        case GAME_HISTORY_MESSAGES.ReceivedBonus:
            return `${playerName} received a $${Number(argument3) * 100} ${
                chainName(Number(argument2))
            } bonus.`;
        case GAME_HISTORY_MESSAGES.DisposedOfShares:
            return `${playerName} traded ${Number(argument3)} and sold ${
                Number(argument4)
            } ${chainName(Number(argument2))} shares.`;
        case GAME_HISTORY_MESSAGES.CouldNotAffordAnyShares:
            return `${playerName} could not afford any shares.`;
        case GAME_HISTORY_MESSAGES.PurchasedShares:
            return `${playerName} purchased ${
                formatPurchasedShares(argument2)
            }.`;
        case GAME_HISTORY_MESSAGES.DrewLastTile:
            return `${playerName} drew the last tile from the bag.`;
        case GAME_HISTORY_MESSAGES.ReplacedDeadTile:
            return `${playerName} replaced dead tile ${
                tileName(Number(argument2), Number(argument3))
            }.`;
        case GAME_HISTORY_MESSAGES.EndedGame:
            return `${playerName} ended the game.`;
        case GAME_HISTORY_MESSAGES.NoTilesPlayedForEntireRound:
            return "No tiles were played for an entire round. Game end forced.";
        case GAME_HISTORY_MESSAGES.AllTilesPlayed:
            return "All tiles have been played. Game end forced.";
        default:
            return escapeHtml(JSON.stringify(payload));
    }
}

function formatChatMessage(payload: unknown[]) {
    const clientId = Number(payload[0]);
    const message = String(payload[1] ?? "");
    const username = appState.clients[clientId]?.username ??
        `Client ${clientId}`;
    return `${username}: ${message}`;
}

function formatChainList(argument: unknown) {
    if (!Array.isArray(argument)) {
        return "multiple chains";
    }

    return argument.map((value) => chainName(Number(value))).join(", ");
}

function formatPurchasedShares(argument: unknown) {
    if (!Array.isArray(argument) || argument.length === 0) {
        return "nothing";
    }

    return argument
        .filter((entry): entry is [number, number] =>
            Array.isArray(entry) && entry.length >= 2
        )
        .map(([typeId, amount]) => `${amount} ${chainName(typeId)}`)
        .join(", ");
}

function chainName(typeId: number) {
    return HOTEL_CHAINS[typeId] ?? `Chain ${typeId}`;
}

function playerDisplayName(playerId: number) {
    return appState.games[appState.liveGame.gameId ?? -1]?.players[playerId]
        ?.username ?? `Player ${playerId + 1}`;
}

function describeGameState(
    stateId: number,
    modeId: number,
    maxPlayers: number,
) {
    const mode = modeId === GAME_MODES.Teams ? "Teams" : "Singles";
    if (stateId === GAME_STATES.Starting) {
        return `${mode}, Starting (Max ${maxPlayers})`;
    }
    if (stateId === GAME_STATES.StartingFull) {
        return `${mode}, Starting (Full)`;
    }
    if (stateId === GAME_STATES.InProgress) {
        return `${mode}, In Progress`;
    }
    return `${mode}, Completed`;
}

function describeGameAction(actionId: number) {
    switch (actionId) {
        case GAME_ACTIONS.StartGame:
            return "start the game";
        case GAME_ACTIONS.PlayTile:
            return "play a tile";
        case GAME_ACTIONS.SelectNewChain:
            return "select a chain";
        case GAME_ACTIONS.SelectMergerSurvivor:
            return "select the merger survivor";
        case GAME_ACTIONS.SelectChainToDisposeOfNext:
            return "select the next defunct chain";
        case GAME_ACTIONS.DisposeOfShares:
            return "dispose of shares";
        case GAME_ACTIONS.PurchaseShares:
            return "purchase shares";
        default:
            return "finish the game";
    }
}

function formatMoneyCell(value: number | undefined) {
    if (value === undefined) {
        return "";
    }

    return String(value * 100);
}

function escapeHtml(value: string) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
        ">",
        "&gt;",
    );
}
