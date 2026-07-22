export const ROWS = 9;
export const COLS = 12;
export const CHAINS = [
  { id:'sackson', name:'Sackson', color:'#c94d3c', tier:0 },
  { id:'zeta', name:'Zeta', color:'#ef9f33', tier:0 },
  { id:'america', name:'America', color:'#2b78c5', tier:1 },
  { id:'fusion', name:'Fusion', color:'#42a66b', tier:1 },
  { id:'hydra', name:'Hydra', color:'#8d5eb7', tier:1 },
  { id:'quantum', name:'Quantum', color:'#3ca8aa', tier:2 },
  { id:'phoenix', name:'Phoenix', color:'#d65478', tier:2 }
];

export const tileId = (r,c) => `${String.fromCharCode(65+r)}${c+1}`;
export const parseTile = id => [id.charCodeAt(0)-65, Number(id.slice(1))-1];
export const neighbors = id => { const [r,c]=parseTile(id); return [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].filter(([a,b])=>a>=0&&a<ROWS&&b>=0&&b<COLS).map(([a,b])=>tileId(a,b)); };
export const allTiles = () => Array.from({length:ROWS*COLS},(_,i)=>tileId(Math.floor(i/COLS),i%COLS));

export function stockPrice(size,tier=0){
  const band = size<=2?0:size<=3?1:size<=5?2:size<=10?3:size<=20?4:size<=30?5:size<=40?6:7;
  return 200 + (tier+band)*100;
}
export function bonuses(size,tier=0){ const p=stockPrice(size,tier); return {majority:p*10, minority:p*5}; }
export function createGame(config={}, rng=Math.random){
  const count=Math.max(2,Math.min(6,config.players?.length||3));
  const bag=allTiles(); shuffle(bag,rng);
  const players=Array.from({length:count},(_,i)=>({id:`p${i}`,name:config.players?.[i]?.name?.trim()||`Player ${i+1}`,ai:!!config.players?.[i]?.ai,cash:6000,hand:[],stocks:Object.fromEntries(CHAINS.map(c=>[c.id,0]))}));
  players.forEach(p=>{ while(p.hand.length<6)p.hand.push(bag.pop()); p.hand.sort(); });
  const board={};
  players.forEach(()=>{ const t=bag.pop(); board[t]='loose'; });
  return {version:1,players,board,bag,chains:Object.fromEntries(CHAINS.map(c=>[c.id,{size:0,stock:25}])),current:0,phase:'place',buys:0,log:['The market opens.'],turn:1,winner:null,seed:Date.now()};
}
function shuffle(a,rng){ for(let i=a.length-1;i;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];} }
export const activeChains = g => CHAINS.filter(c=>g.chains[c.id].size>0);
export function connectedLoose(game,start){ const seen=new Set(), stack=neighbors(start).filter(t=>game.board[t]==='loose'); while(stack.length){const t=stack.pop(); if(seen.has(t))continue; seen.add(t); neighbors(t).forEach(n=>{if(game.board[n]==='loose'&&!seen.has(n))stack.push(n);});} return [...seen]; }
export function analyzePlacement(game,tile){
  if(game.board[tile]) return {legal:false,reason:'That tile is already on the board.'};
  const touching=[...new Set(neighbors(tile).map(n=>game.board[n]).filter(v=>v&&v!=='loose'))];
  const loose=neighbors(tile).some(n=>game.board[n]==='loose');
  if(touching.length>1){
    const safe=touching.filter(id=>game.chains[id].size>=11);
    if(safe.length>1)return {legal:false,reason:'A tile may not merge two safe hotels.'};
    const max=Math.max(...touching.map(id=>game.chains[id].size));
    const tied=touching.filter(id=>game.chains[id].size===max);
    return {legal:true,type:'merger',chains:touching,survivor:tied.sort((a,b)=>CHAINS.find(c=>b===c.id).tier-CHAINS.find(c=>a===c.id).tier)[0]};
  }
  if(touching.length===1)return {legal:true,type:'grow',chain:touching[0]};
  if(loose){const available=CHAINS.find(c=>game.chains[c.id].size===0); return available?{legal:true,type:'found',chain:available.id}:{legal:false,reason:'No inactive hotel is available to found.'};}
  return {legal:true,type:'loose'};
}
function payBonuses(game,chainId){
  const chain=CHAINS.find(c=>c.id===chainId), size=game.chains[chainId].size, b=bonuses(size,chain.tier);
  const holders=game.players.filter(p=>p.stocks[chainId]>0).sort((a,z)=>z.stocks[chainId]-a.stocks[chainId]);
  if(!holders.length)return;
  const top=holders[0].stocks[chainId], major=holders.filter(p=>p.stocks[chainId]===top);
  if(major.length>1){const award=Math.ceil((b.majority+b.minority)/major.length/100)*100; major.forEach(p=>p.cash+=award); game.log.unshift(`${major.map(p=>p.name).join(' & ')} split ${chain.name} bonuses ($${award.toLocaleString()} each).`); return;}
  major[0].cash+=b.majority;
  const next=holders.find(p=>p.stocks[chainId]<top);
  if(next){const n=next.stocks[chainId], minors=holders.filter(p=>p.stocks[chainId]===n), award=Math.ceil(b.minority/minors.length/100)*100; minors.forEach(p=>p.cash+=award);}
  else major[0].cash+=b.minority;
  game.log.unshift(`${major[0].name} takes the ${chain.name} majority bonus.`);
}
function absorb(game,survivor,defunct){
  payBonuses(game,defunct);
  const def=game.chains[defunct], price=stockPrice(def.size,CHAINS.find(c=>c.id===defunct).tier);
  game.players.forEach(p=>{const n=p.stocks[defunct]; if(n){p.cash+=n*price; def.stock+=n;p.stocks[defunct]=0;}});
  Object.keys(game.board).forEach(t=>{if(game.board[t]===defunct)game.board[t]=survivor;});
  game.chains[survivor].size+=def.size; def.size=0;
}
export function placeTile(game,tile,foundChain){
  if(game.phase!=='place')return {ok:false,message:'Finish buying stock first.'};
  const p=game.players[game.current]; if(!p.hand.includes(tile))return {ok:false,message:'That tile is not in your hand.'};
  const a=analyzePlacement(game,tile); if(!a.legal)return {ok:false,message:a.reason};
  p.hand.splice(p.hand.indexOf(tile),1);
  if(a.type==='loose')game.board[tile]='loose';
  if(a.type==='grow'){game.board[tile]=a.chain;game.chains[a.chain].size++; connectedLoose(game,tile).forEach(t=>{game.board[t]=a.chain;game.chains[a.chain].size++;});}
  if(a.type==='found'){
    const id=foundChain&&game.chains[foundChain]?.size===0?foundChain:a.chain, cluster=[tile,...connectedLoose(game,tile)];
    cluster.forEach(t=>game.board[t]=id);game.chains[id].size=cluster.length;
    if(game.chains[id].stock>0){p.stocks[id]++;game.chains[id].stock--;}
    game.log.unshift(`${p.name} founded ${CHAINS.find(c=>c.id===id).name}.`);
  }
  if(a.type==='merger'){
    const survivor=a.survivor; a.chains.filter(id=>id!==survivor).sort((x,y)=>game.chains[x].size-game.chains[y].size).forEach(id=>absorb(game,survivor,id));
    game.board[tile]=survivor;game.chains[survivor].size++;
    connectedLoose(game,tile).forEach(t=>{game.board[t]=survivor;game.chains[survivor].size++;});
    game.log.unshift(`${CHAINS.find(c=>c.id===survivor).name} survives a merger.`);
  }
  game.phase='buy';game.buys=0;game.log.unshift(`${p.name} placed ${tile}.`);return {ok:true,type:a.type};
}
export function buyStock(game,chainId){
  if(game.phase!=='buy')return {ok:false,message:'Place a tile first.'};
  const c=CHAINS.find(c=>c.id===chainId), state=game.chains[chainId], p=game.players[game.current];
  if(!c||state.size===0)return {ok:false,message:'That hotel is not active.'};
  if(game.buys>=3)return {ok:false,message:'You may buy only three shares.'};
  const price=stockPrice(state.size,c.tier);if(!state.stock)return {ok:false,message:'No shares remain.'};if(p.cash<price)return {ok:false,message:'Not enough cash.'};
  p.cash-=price;p.stocks[chainId]++;state.stock--;game.buys++;return {ok:true};
}
export function canEnd(game){const active=activeChains(game);return active.some(c=>game.chains[c.id].size>=41)||(active.length>0&&active.every(c=>game.chains[c.id].size>=11));}
export function endTurn(game){
  const p=game.players[game.current];if(game.bag.length)p.hand.push(game.bag.pop());p.hand.sort();
  game.current=(game.current+1)%game.players.length;if(game.current===0)game.turn++;game.phase='place';game.buys=0;game.log.unshift(`${game.players[game.current].name}'s turn.`);
}
export function endGame(game){
  activeChains(game).forEach(c=>{payBonuses(game,c.id);const price=stockPrice(game.chains[c.id].size,c.tier);game.players.forEach(p=>{p.cash+=p.stocks[c.id]*price;p.stocks[c.id]=0;});});
  game.winner=[...game.players].sort((a,b)=>b.cash-a.cash)[0].id;game.phase='over';game.log.unshift(`${game.players.find(p=>p.id===game.winner).name} wins!`);
}
export function netWorth(game,p){return p.cash+CHAINS.reduce((n,c)=>n+p.stocks[c.id]*stockPrice(game.chains[c.id].size,c.tier),0);}
