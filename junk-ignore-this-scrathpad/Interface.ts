


export type HotelChain = 'Luxor' | 'Tower' | 'Wordlwide' //...

export type GameState = {
    //.. A copy of the Game's gamestate is passed in (So that AI function can't edit it)
    //.. Contains all data about the current state of the game, whose turn it is, the board, how much stock everyone has, and a list of validTiles and invalidTiles in the hand of ONLY THIS PLAYER
}

export type Tile = {
    //.. Probably a letter and number, idk best data structure
}


//** Not that some argument provided are not really needed as that info is in the gamestate, but its to make implementing a stupid or simple AI trivial */
export abstract class AcquirePlayer{

    constructor(){

    }

    // Takes in a gamestate, returns an index indicated which of the validTiles to play.  
    abstract playTile(gameState: GameState, validTiles: Tile[], invalidTilesInHand: Tile[]): number;

    // Return an index of validChains to choose which chain to start.
    abstract determineChainToStart(gameState: GameState, validChains: HotelChain[]): number;

    //Takes in a gamestate, returns a map indicated what stocks to buy
    abstract buy(gameState: GameState): Record<HotelChain, number>;

    //Returns an index of possibleSurvivors to chosse which chain survives
    abstract determineMergeSurvivor(gameState: GameState, mergeTile: Tile, possibleSurvivors: HotelChain[]): number;

    abstract determineHowManySharesToTradeInAfterMerge(gameState: GameState, survivingChain: HotelChain, mergeChain: HotelChain, numTradesAvailable: number): number;
    abstract determineHowManySharesToSell(gameState: GameState, survivingChain: HotelChain, mergeChain: HotelChain, howManyIhave: number): number;
}