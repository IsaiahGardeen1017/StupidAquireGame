import test from 'node:test';
import assert from 'node:assert/strict';
import {allTiles,tileId,neighbors,stockPrice,bonuses,createGame,analyzePlacement,placeTile,buyStock,endTurn,canEnd,endGame} from '../engine.mjs';

test('board contains 108 unique tiles with correct edges',()=>{
  assert.equal(new Set(allTiles()).size,108);
  assert.equal(tileId(8,11),'I12');
  assert.deepEqual(neighbors('A1').sort(),['A2','B1']);
});

test('stock prices and bonuses follow hotel tiers',()=>{
  assert.equal(stockPrice(2,0),200);
  assert.equal(stockPrice(11,1),700);
  assert.deepEqual(bonuses(11,1),{majority:7000,minority:3500});
});

test('game initializes complete, non-overlapping inventory',()=>{
  const game=createGame({players:[{name:'A'},{name:'B'}]},()=>.42);
  assert.equal(game.players.length,2);
  assert.equal(game.players[0].hand.length,6);
  assert.equal(Object.keys(game.board).length,2);
  assert.equal(game.bag.length,94);
  const used=[...game.bag,...Object.keys(game.board),...game.players.flatMap(p=>p.hand)];
  assert.equal(new Set(used).size,108);
});

test('founding consumes loose cluster and grants founder share',()=>{
  const game=createGame({players:[{name:'A'},{name:'B'}]});
  game.board={'A1':'loose'};game.players[0].hand=['A2'];
  assert.equal(analyzePlacement(game,'A2').type,'found');
  assert.equal(placeTile(game,'A2','phoenix').ok,true);
  assert.equal(game.chains.phoenix.size,2);
  assert.equal(game.players[0].stocks.phoenix,1);
  assert.equal(game.chains.phoenix.stock,24);
});

test('buying is limited to three affordable active shares',()=>{
  const game=createGame({players:[{name:'A'},{name:'B'}]});game.phase='buy';game.chains.sackson.size=2;
  assert.equal(buyStock(game,'sackson').ok,true);assert.equal(buyStock(game,'sackson').ok,true);assert.equal(buyStock(game,'sackson').ok,true);
  assert.equal(buyStock(game,'sackson').ok,false);assert.equal(game.players[0].cash,5400);
});

test('safe chains cannot merge and end conditions are recognized',()=>{
  const game=createGame({players:[{name:'A'},{name:'B'}]});
  game.board={'A1':'sackson','A3':'zeta'};game.chains.sackson.size=11;game.chains.zeta.size=11;
  assert.equal(analyzePlacement(game,'A2').legal,false);
  assert.equal(canEnd(game),true);
});

test('end game liquidates active stock and names richest winner',()=>{
  const game=createGame({players:[{name:'A'},{name:'B'}]});game.chains.sackson.size=11;game.players[0].stocks.sackson=3;game.players[1].stocks.sackson=1;
  endGame(game);assert.equal(game.phase,'over');assert.equal(game.winner,'p0');assert.equal(game.players[0].stocks.sackson,0);
});

test('turn advances, draws a tile, and resets phase',()=>{
  const game=createGame({players:[{name:'A'},{name:'B'}]});game.players[0].hand.pop();game.phase='buy';game.buys=2;endTurn(game);
  assert.equal(game.players[0].hand.length,6);assert.equal(game.current,1);assert.equal(game.phase,'place');assert.equal(game.buys,0);
});
