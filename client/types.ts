import type { GameSessionSnapshot } from "../src/index.js";
import type {
  TlstyerClientInfo,
  TlstyerLobbyChatMessage,
  TlstyerLobbyGame
} from "./tlstyer/TlstyerOnlineClient.js";

export type ConnectionStatus = "welcome" | "connecting" | "lobby" | "game";

export type AppState = {
  connectionStatus: ConnectionStatus;
  errorMessage: string | null;
  selfClientId: number | null;
  selfUsername: string | null;
  lobbyCollapsed: boolean;
  clients: Record<number, TlstyerClientInfo>;
  lobbyClientIds: number[];
  games: Record<number, TlstyerLobbyGame>;
  globalChat: TlstyerLobbyChatMessage[];
  liveGame: GameSessionSnapshot | null;
  selectedGameId: number | null;
  enteringGameId: number | null;
};
