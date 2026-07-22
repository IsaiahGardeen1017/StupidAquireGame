export const COMMANDS_TO_CLIENT = {
  FatalError: 0,
  SetClientId: 1,
  SetClientIdToData: 2,
  SetGameState: 3,
  SetGameBoardCell: 4,
  SetGameBoard: 5,
  SetScoreSheetCell: 6,
  SetScoreSheet: 7,
  SetGamePlayerJoin: 8,
  SetGamePlayerRejoin: 9,
  SetGamePlayerLeave: 10,
  SetGamePlayerJoinMissing: 11,
  SetGameWatcherClientId: 12,
  ReturnWatcherToLobby: 13,
  AddGameHistoryMessage: 14,
  AddGameHistoryMessages: 15,
  SetTurn: 16,
  SetGameAction: 17,
  SetTile: 18,
  SetTileGameBoardType: 19,
  RemoveTile: 20,
  AddGlobalChatMessage: 21,
  AddGameChatMessage: 22,
  DestroyGame: 23
} as const;

export const COMMANDS_TO_SERVER = {
  CreateGame: 0,
  JoinGame: 1,
  RejoinGame: 2,
  WatchGame: 3,
  LeaveGame: 4,
  DoGameAction: 5,
  SendGlobalChatMessage: 6,
  SendGameChatMessage: 7
} as const;

export const ERRORS = {
  NotUsingLatestVersion: 0,
  GenericError: 1,
  InvalidUsername: 2,
  InvalidPassword: 3,
  MissingPassword: 4,
  ProvidedPassword: 5,
  IncorrectPassword: 6,
  NonMatchingPasswords: 7,
  ExistingPassword: 8,
  UsernameAlreadyInUse: 9,
  LostConnection: 10
} as const;

export const GAME_ACTIONS = {
  StartGame: 0,
  PlayTile: 1,
  SelectNewChain: 2,
  SelectMergerSurvivor: 3,
  SelectChainToDisposeOfNext: 4,
  DisposeOfShares: 5,
  PurchaseShares: 6,
  GameOver: 7
} as const;

export const GAME_MODES = {
  Singles: 0,
  Teams: 1
} as const;

export const GAME_STATES = {
  Starting: 0,
  StartingFull: 1,
  InProgress: 2,
  Completed: 3
} as const;

export const HOTEL_CHAINS = ["Luxor", "Tower", "American", "Festival", "Worldwide", "Continental", "Imperial"] as const;

export const GAME_BOARD_TYPES = {
  Luxor: 0,
  Tower: 1,
  American: 2,
  Festival: 3,
  Worldwide: 4,
  Continental: 5,
  Imperial: 6,
  Nothing: 7,
  NothingYet: 8,
  CantPlayEver: 9,
  IHaveThis: 10,
  WillPutLonelyTileDown: 11,
  HaveNeighboringTileToo: 12,
  WillFormNewChain: 13,
  WillMergeChains: 14,
  CantPlayNow: 15
} as const;

export const SCORE_SHEET_ROWS = {
  Player0: 0,
  Player1: 1,
  Player2: 2,
  Player3: 3,
  Player4: 4,
  Player5: 5,
  Available: 6,
  ChainSize: 7,
  Price: 8
} as const;

export const SCORE_SHEET_INDEXES = {
  Luxor: 0,
  Tower: 1,
  American: 2,
  Festival: 3,
  Worldwide: 4,
  Continental: 5,
  Imperial: 6,
  Cash: 7,
  Net: 8
} as const;

export type CommandToClient = (typeof COMMANDS_TO_CLIENT)[keyof typeof COMMANDS_TO_CLIENT];
export type CommandToServer = (typeof COMMANDS_TO_SERVER)[keyof typeof COMMANDS_TO_SERVER];
export type GameActionId = (typeof GAME_ACTIONS)[keyof typeof GAME_ACTIONS];
export type HotelChain = (typeof HOTEL_CHAINS)[number];
export type GameModeId = (typeof GAME_MODES)[keyof typeof GAME_MODES];
export type GameStateId = (typeof GAME_STATES)[keyof typeof GAME_STATES];

export type ClientMessage = [CommandToClient, ...unknown[]];
export type ServerEnvelope = ClientMessage[];
