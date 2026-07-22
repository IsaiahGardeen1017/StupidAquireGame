I love the board game acquire, I like to play online and I want to research the
perfect strategy

I want a custom client that will connect to the server at
https://acquire.tlstyer.com/, this should allow me to join games as usual, but
also allow me to play. I will want to update the UI to make it more to my
liking, but its essential that I will be able to play on those servers. I
asssume we will need to copt the protocol and run it through a proxy, but we
have access to the code (refs/acquire) so it should be doable.

I also want a game engine that I can run locally, as well as a typescript
abstract class I can inherit and program AI strategies, then I want to be able
to run 1000 games or so using those strategies to evaluate how strategies
perform. The game engine should use the playerInterface below but should also
check all choices to ensure they are valid.

I then want those sim games to produce a replay artifact, so that I can load
that replay into my custom client and step through every turn seeing how things
progress. The replays should include every til eplaced, every tile drawn, ever
buy and every merge decision.

I also want to be able in the client to start a local game, that lets you select
which AIs to populate the game with and lets the player play against the AIs.

It is essential that there exists a nice interface to program AI strategies
against. THe interface should have functions that can function when async as
sometimes a real human player or alternativly a LLM call (differnt project)
might be behind these. The interface should look something like below:

```
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
```

Tech stack: I love typescript, I require typescript everywhere, all front end
code should be typescript. Any frontend framework can be used, but I know react
the best. I want to be able to easily clone this repor on a raspberry pi and run
a npm script to start it.

General Steps to accomplish success:

1. Create a player interface that has everything needed for a Human player or an
   AI strategy to play the game. Additionally create an AIs stategy that uses
   this interface which always picks an option at random.

2. Have a client that is fully able to connect and play games on the
   acquire.tlstyer.com server. It should look very similar to what is there
   currently. There is a reference repo contianing the code at /refs/acquire.
   This client should funnel Humna decisions throught the player interface (As
   human decisions will need to in a later step, the future engine should not
   even know what players are human).

3. Create a game engine that can simulate an entire game using player interface
   inheritors, this should generate an artifact documenting every decision and
   every turn that can later be used to rewatch the game and debug the engine.

4. Add the ability to load a replay into the client that will play let the user
   step through the game

5. Add an ability for a user fo the client to play against AI strategies using
   the engine and AIs agents using the player interface.
