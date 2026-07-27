import type { AppState } from "./types.js";

export function createInitialState(): AppState {
  return {
    connectionStatus: "welcome",
    errorMessage: null,
    selfClientId: null,
    selfUsername: null,
    lobbyCollapsed: false,
    clients: {},
    lobbyClientIds: [],
    games: {},
    globalChat: [],
    liveGame: null,
    selectedGameId: null,
    enteringGameId: null
  };
}
