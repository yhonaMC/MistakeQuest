import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../service/store.js';
import {GameService,makeGame,publicGame,evaluateGame} from '../service/games.js';
import {buildApp} from '../service/app.js';
import {selectPracticeItems} from '../service/practice-pool.js';

const items=[
  {bad:'Yesterday I go home.',good:'Yesterday I went home.',original:'go',replacement:'went',alternatives:[],alternateOrders:[]},
  {bad:'Last night we go to school.',good:'Last night we went to school.',original:'go',replacement:'went',alternatives:[],alternateOrders:[]},
  {bad:'Yesterday they go to the park.',good:'Yesterday they went to the park.',original:'go',replacement:'went',alternatives:[],alternateOrders:[]}
];
const bank={label:'Pasado',explanation:'Usa went con yesterday.',hint:'Busca el pasado de go.',source:'original',validatorVersion:10,varietyRetryAfter:Date.now()+300000,items};
const offline={check:async()=>{throw Error('Unexpected grammar engine');},chat:async()=>{throw Error('Unexpected AI engine');},health:async()=>({})};
const headers={host:'127.0.0.1:3210',origin:'http://127.0.0.1:3210','x-mistakequest':'1'};
function fixture(store,sourceBank=bank,category='verb_tense'){
  const item=sourceBank.items[0],issue=store.saveAnalysis({key:item.bad,locale:'en-US',status:'issues',originalText:item.bad,correctedText:item.good,issues:[{offset:item.bad.indexOf(item.original),length:item.original.length,original:item.original,replacement:item.replacement,category,sentence:item.bad,explanation:sourceBank.explanation}]}).issues[0];
  store.saveBank(issue.id,sourceBank,'test');return issue;
}
function newGame(store,mode='jump',sourceBank=bank,category='verb_tense'){
  return store.createGame(makeGame(fixture(store,sourceBank,category),sourceBank,mode));
}
const answer=(checkpoint,idempotencyKey,choice='1')=>({checkpoint,idempotencyKey,answer:choice});
const action=(checkpoint,idempotencyKey,type='fall',extra={})=>({checkpoint,idempotencyKey,type,...extra});

test('jump rotates verified short distinct sentences and exposes only the current checkpoint',()=>{
  const store=new Store(':memory:');try{
    const issue=fixture(store),duplicate={...bank,items:[...items,items[0],{...items[0],bad:'One '.repeat(19),good:'One '.repeat(19)}]};
    const game={...makeGame(issue,duplicate,'jump',1),id:'jump'},shown=publicGame(game);
    assert.equal(shown.text,'Last night we go to school.');
    assert.deepEqual(shown.adventure,{step:0,total:3,movementMistakes:0,position:{x:1,y:1},collected:[]});
    assert.deepEqual(shown.progress,{current:0,total:3});
    assert.deepEqual(shown.source,{id:issue.id,label:issue.label,original:'go',replacement:'went'});
    assert.equal(shown.target.text,'go');assert.equal(shown.options.find(option=>option.id===1).text,'went');
    for(const key of ['good','correct','items','privateData','correctedSentence'])assert.equal(shown[key],undefined);
    assert.equal(newGame(store,'jump',{...bank,items:[items[0],items[0]]}).privateData.items.length,1);
  }finally{store.close();}
});

test('jump checkpoints advance once and reward only the final English answer',async()=>{
  const store=new Store(':memory:');try{
    const game=newGame(store),service=new GameService(store,offline);
    const wrong=await service.attempt(game.id,answer(0,'jump-wrong','0'));
    assert.equal(wrong.correct,false);assert.equal(store.game(game.id).state.step,0);
    const first=await service.attempt(game.id,answer(0,'jump-first'));
    assert.equal(first.xpEarned,0);assert.equal(first.completed,false);assert.equal(first.nextQuestion.text,'Last night we go to school.');
    assert.deepEqual(await service.attempt(game.id,answer(0,'jump-first')),first);
    await assert.rejects(service.attempt(game.id,answer(0,'jump-stale')),error=>error.code==='STALE_CHECKPOINT'&&error.statusCode===409);
    await assert.rejects(service.attempt(game.id,answer(1,'jump-first','0')),error=>error.code==='REUSED_KEY');
    assert.equal(store.progress().totals.attempts,2);
    await service.attempt(game.id,answer(1,'jump-second'));
    const last=await service.attempt(game.id,answer(2,'jump-third'));
    assert.equal(last.completed,true);assert.equal(last.xpEarned,20);assert.equal(last.nextQuestion,undefined);
    assert.equal(store.progress().totals.xp,20);assert.equal(store.progress().totals.completedGames,1);
    assert.deepEqual(publicGame(store.game(game.id)).progress,{current:3,total:3});
  }finally{store.close();}
});

test('rotating the same jump checkpoints cannot earn the same exercise reward twice',async()=>{
  const store=new Store(':memory:');try{
    const issue=fixture(store),service=new GameService(store,offline);
    for(let rotation=0;rotation<2;rotation++){
      const game=store.createGame(makeGame(issue,bank,'jump',rotation));let result;
      for(let checkpoint=0;checkpoint<3;checkpoint++)result=await service.attempt(game.id,answer(checkpoint,`rotation-${rotation}-${checkpoint}`));
      assert.equal(result.xpEarned,rotation===0?20:0);
    }
    assert.equal(store.progress().totals.xp,20);assert.equal(store.progress().totals.completedGames,2);
  }finally{store.close();}
});

test('sentence rotation counts visible adventure checkpoints and leaves future sentences unseen',async()=>{
  const store=new Store(':memory:');try{
    const source={...bank,items:[...items,{...items[0],bad:'Last night they go home.',good:'Last night they went home.'}]},issue=fixture(store,source),game=store.createGame(makeGame(issue,source,'jump')),service=new GameService(store,offline);
    assert.deepEqual(selectPracticeItems(store,issue.id,source).map(item=>item.good),[items[1].good,items[2].good,'Last night they went home.',items[0].good]);
    await service.attempt(game.id,answer(0,'exposure-checkpoint-zero'));
    assert.deepEqual(selectPracticeItems(store,issue.id,source).map(item=>item.good),[items[2].good,'Last night they went home.',items[0].good,items[1].good]);
    await service.attempt(game.id,answer(1,'exposure-checkpoint-one'));await service.attempt(game.id,answer(2,'exposure-checkpoint-two'));
    assert.deepEqual(selectPracticeItems(store,issue.id,source).map(item=>item.good),['Last night they went home.',items[0].good,items[1].good,items[2].good]);
  }finally{store.close();}
});

test('jump motor failures are durable idempotent actions without English attempts',async()=>{
  const store=new Store(':memory:');try{
    const game=newGame(store),service=new GameService(store,offline),before=store.progress().totals;
    const first=service.action(game.id,action(0,'jump-fall'));
    assert.equal(first.game.adventure.movementMistakes,1);assert.equal(first.game.adventure.step,0);
    assert.deepEqual(service.action(game.id,action(0,'jump-fall')),first);
    assert.throws(()=>service.action(game.id,action(0,'jump-fall','collision')),error=>error.code==='REUSED_KEY');
    assert.equal(service.action(game.id,action(0,'jump-collision','collision')).game.adventure.movementMistakes,2);
    assert.deepEqual(store.progress().totals,before);
    assert.equal(store.export().tables.game_actions.length,2);
    await service.attempt(game.id,answer(0,'jump-advance'));
    const snapshot=store.export().tables.game_actions.length;
    assert.throws(()=>service.action(game.id,action(0,'jump-old-fall')),error=>error.code==='STALE_CHECKPOINT');
    assert.equal(store.export().tables.game_actions.length,snapshot);
    assert.deepEqual(service.action(game.id,action(0,'jump-fall')),first);
  }finally{store.close();}
});

test('jump rejects missing checkpoints and unrelated English or movement fields without writes',async()=>{
  const store=new Store(':memory:');try{
    const game=newGame(store),service=new GameService(store,offline);
    for(const payload of [{idempotencyKey:'missing-checkpoint',answer:'1'},answer(-1,'negative-checkpoint'),{...answer(0,'forged-tiles'),tokenIds:[0]},answer(0,'unknown-choice','2')])await assert.rejects(service.attempt(game.id,payload));
    for(const payload of [action(0,'jump-move','move',{direction:'right'}),{...action(0,'jump-extra'),answer:'1'},action(0.5,'fraction-step')])assert.throws(()=>service.action(game.id,payload));
    assert.equal(store.progress().totals.attempts,0);assert.equal(store.export().tables.game_actions.length,0);
  }finally{store.close();}
});

test('jump current checkpoint supplies assistance and its session keeps the highest help level',async()=>{
  const store=new Store(':memory:');try{
    const game=newGame(store),service=new GameService(store,offline);
    service.assist(game.id,true);await service.attempt(game.id,answer(0,'assisted-first'));
    assert.equal(service.assist(game.id,true).message,'Last night we went to school.');
    await service.attempt(game.id,answer(1,'assisted-second'));
    assert.equal((await service.attempt(game.id,answer(2,'assisted-third'))).xpEarned,5);
    const completed=store.game(game.id),count=store.export().tables.game_actions.length;
    assert.equal(service.action(game.id,action(3,'completed-fall')).game.completed,true);
    assert.deepEqual(store.game(game.id),completed);assert.equal(store.export().tables.game_actions.length,count);
  }finally{store.close();}
});

test('saved jump checkpoints and action replays survive reopening SQLite',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'mq-adventure-')),file=join(directory,'saved.sqlite');let store=new Store(file);
  try{
    const game=newGame(store),sourceBefore=Object.fromEntries(['analyses','issues','banks'].map(name=>[name,store.export().tables[name]]));
    let service=new GameService(store,offline);await service.attempt(game.id,answer(0,'restart-first'));
    const cached=service.action(game.id,action(1,'restart-fall'));store.close();store=new Store(file);service=new GameService(store,offline);
    assert.deepEqual(service.action(game.id,action(1,'restart-fall')),cached);
    assert.equal(store.progress().adventures[0].id,game.id);assert.equal(store.progress().adventures[0].checkpointsComplete,1);
    assert.equal(store.progress().adventures[0].movementMistakes,1);
    await service.attempt(game.id,answer(1,'restart-second'));const completed=await service.attempt(game.id,answer(2,'restart-third'));
    store.close();store=new Store(file);service=new GameService(store,offline);
    assert.deepEqual(await service.attempt(game.id,answer(2,'restart-third')),completed);
    assert.equal(store.progress().totals.xp,20);assert.equal(store.progress().adventures[0].completed,true);
    for(const name of ['analyses','issues','banks'])assert.deepEqual(store.export().tables[name],sourceBefore[name]);
    store.clearData();assert.equal(store.export().tables.game_actions.length,0);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('jump API creates from the requested verified bank and validates action payloads',async()=>{
  const store=new Store(':memory:'),issue=fixture(store),app=await buildApp({store,engines:offline});
  try{
    const created=await app.inject({method:'POST',url:'/api/games',headers,payload:{issueId:issue.id,mode:'jump'}});
    assert.equal(created.statusCode,200,created.body);const game=created.json();
    const result=await app.inject({method:'POST',url:`/api/games/${game.id}/action`,headers,payload:action(0,'api-jump-fall')});
    assert.equal(result.statusCode,200,result.body);assert.equal(result.json().game.adventure.movementMistakes,1);
    assert.equal((await app.inject({method:'POST',url:`/api/games/${game.id}/action`,headers,payload:{...action(0,'api-forged-fall'),movementMistakes:0}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:`/api/games/${game.id}/attempt`,headers,payload:answer(0,'api-jump-correct')})).statusCode,200);
    assert.equal((await app.inject({method:'POST',url:`/api/games/${game.id}/action`,headers,payload:action(0,'api-stale-fall')})).statusCode,409);
    assert.equal(store.progress().totals.attempts,1);
  }finally{await app.close();store.close();}
});

function pathTo(board,start,end){
  const blocked=new Set(board.walls.map(cell=>`${cell.x},${cell.y}`)),queue=[{position:start,path:[]}],seen=new Set([`${start.x},${start.y}`]);
  for(const {position,path} of queue){
    if(position.x===end.x&&position.y===end.y)return path;
    for(const [direction,dx,dy] of [['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]]){
      const next={x:position.x+dx,y:position.y+dy},key=`${next.x},${next.y}`;
      if(next.x<0||next.y<0||next.x>=board.width||next.y>=board.height||blocked.has(key)||seen.has(key))continue;
      seen.add(key);queue.push({position:next,path:[...path,direction]});
    }
  }
  return null;
}
let actionSequence=0;
function mazeAction(service,id,type,extra={}){const game=publicGame(service.store.game(id));return service.action(id,action(game.adventure.step,`maze-action-${++actionSequence}`,type,extra)).game;}
function walkTo(service,id,destination){
  const game=publicGame(service.store.game(id)),path=pathTo(game.board,game.adventure.position,destination);assert.ok(path,'Destination must be reachable');
  for(const direction of path)mazeAction(service,id,'move',{direction});
  return publicGame(service.store.game(id));
}
function collectInOrder(service,id,ids){
  for(const tokenId of ids){const game=publicGame(service.store.game(id)),token=game.board.tokens.find(value=>value.id===tokenId);walkTo(service,id,token);mazeAction(service,id,'collect');}
  const game=publicGame(service.store.game(id));return walkTo(service,id,game.board.exit);
}
const orderBank={...bank,items:[{bad:'I by bus go to school every day.',good:'I go to school by bus every day.',original:'by bus go to school',replacement:'go to school by bus',alternatives:[],alternateOrders:[]}]};

test('maze layouts reach every distinct token and exit even with eighteen words',()=>{
  const store=new Store(':memory:');try{
    const source={...bank,items:[{bad:'Yesterday I go to the park with the friend and we saw the dog near our small home.',good:'Yesterday I went to the park with the friend and we saw the dog near our small home.',original:'go',replacement:'went',alternatives:[],alternateOrders:[]}]};
    const game=publicGame(newGame(store,'maze',source)),board=game.board;
    assert.equal(board.tokens.length,18);assert.equal(new Set(board.tokens.map(token=>token.id)).size,18);
    assert.equal(new Set(board.tokens.map(token=>`${token.x},${token.y}`)).size,18);
    for(const token of [...board.tokens,board.exit])assert.ok(pathTo(board,board.spawn,token));
    assert.equal(game.options,undefined);assert.equal(game.wordBank.length,18);
    assert.notDeepEqual(game.wordBank.map(token=>token.id),Array.from({length:18},(_,id)=>id),'Display order must not reveal the correct sentence');
    const repeats=board.tokens.filter(token=>token.text==='the');assert.equal(repeats.length,3);assert.notEqual(repeats[0].id,repeats[1].id);
    for(const value of board.tokens)assert.equal(value.correct,undefined);
  }finally{store.close();}
});

test('maze cannot submit forged, uncollected or out-of-exit inventories',async()=>{
  const store=new Store(':memory:');try{
    const game=newGame(store,'maze'),service=new GameService(store,offline),ids=[0,1,2,3];
    await assert.rejects(service.attempt(game.id,{checkpoint:0,idempotencyKey:'maze-forged-inventory',tokenIds:ids}),error=>error.code==='INCOMPLETE_MAZE');
    let shown=publicGame(store.game(game.id));walkTo(service,game.id,shown.board.exit);
    await assert.rejects(service.attempt(game.id,{checkpoint:0,idempotencyKey:'maze-empty-at-exit',tokenIds:ids}),error=>error.code==='INCOMPLETE_MAZE');
    for(const tokenId of ids){shown=publicGame(store.game(game.id));walkTo(service,game.id,shown.board.tokens.find(token=>token.id===tokenId));mazeAction(service,game.id,'collect');}
    await assert.rejects(service.attempt(game.id,{checkpoint:0,idempotencyKey:'maze-away-from-exit',tokenIds:ids}),error=>error.code==='INCOMPLETE_MAZE');
    shown=publicGame(store.game(game.id));walkTo(service,game.id,shown.board.exit);
    await assert.rejects(service.attempt(game.id,{checkpoint:0,idempotencyKey:'maze-forged-order',tokenIds:[3,2,1,0]}),error=>error.code==='INCOMPLETE_MAZE');
    await assert.rejects(service.attempt(game.id,{checkpoint:0,idempotencyKey:'maze-duplicate-token',tokenIds:[0,1,2,2]}),error=>error.code==='INCOMPLETE_MAZE');
    assert.equal(store.progress().totals.attempts,0);assert.equal(store.progress().totals.xp,0);
  }finally{store.close();}
});

test('maze movement follows walls and collect undo collision and reset preserve authoritative inventory',()=>{
  const store=new Store(':memory:');try{
    const game=newGame(store,'maze'),service=new GameService(store,offline),shown=publicGame(game),before=store.progress().totals;
    const blocked=mazeAction(service,game.id,'move',{direction:'up'});assert.deepEqual(blocked.adventure.position,shown.board.spawn);
    mazeAction(service,game.id,'collect');assert.deepEqual(store.game(game.id).state.collected,[]);
    walkTo(service,game.id,shown.board.tokens[1]);mazeAction(service,game.id,'collect');mazeAction(service,game.id,'collect');
    assert.deepEqual(store.game(game.id).state.collected,[1]);
    const collision=mazeAction(service,game.id,'collision');assert.equal(collision.adventure.movementMistakes,1);assert.deepEqual(collision.adventure.position,shown.board.spawn);assert.deepEqual(collision.adventure.collected,[1]);
    mazeAction(service,game.id,'undo');assert.deepEqual(store.game(game.id).state.collected,[]);
    walkTo(service,game.id,shown.board.tokens[0]);mazeAction(service,game.id,'collect');
    const reset=mazeAction(service,game.id,'reset');assert.deepEqual(reset.adventure.position,shown.board.spawn);assert.deepEqual(reset.adventure.collected,[]);assert.equal(reset.adventure.movementMistakes,1);
    assert.deepEqual(store.progress().totals,before);
    assert.equal(JSON.parse(store.export().tables.game_actions.at(-1).action).type,'reset');
    assert.throws(()=>service.action(game.id,action(0,'maze-fall-invalid')));
  }finally{store.close();}
});

test('maze English completion clears inventory only on a correct checkpoint and pays once at the end',async()=>{
  const store=new Store(':memory:');try{
    const game=newGame(store,'maze'),service=new GameService(store,offline);
    for(let checkpoint=0;checkpoint<3;checkpoint++){
      const shown=publicGame(store.game(game.id)),ids=shown.board.tokens.map(token=>token.id);collectInOrder(service,game.id,ids);
      const input={checkpoint,idempotencyKey:`maze-correct-${checkpoint}`,tokenIds:ids},result=await service.attempt(game.id,input);
      assert.equal(result.correct,true);assert.equal(result.completed,checkpoint===2);assert.equal(result.xpEarned,checkpoint===2?20:0);
      assert.deepEqual(await service.attempt(game.id,input),result);
      assert.deepEqual(store.game(game.id).state.collected,[]);assert.deepEqual(store.game(game.id).state.position,{x:1,y:1});
      if(checkpoint<2){assert.equal(result.nextQuestion.adventure.step,checkpoint+1);assert.equal(result.nextQuestion.text,items[checkpoint+1].bad);}
    }
    assert.equal(store.progress().totals.xp,20);assert.equal(store.progress().totals.attempts,3);
  }finally{store.close();}
});

test('maze unchanged erroneous order stays at its checkpoint and cannot reach approving engines',async()=>{
  const store=new Store(':memory:');let checks=0;
  const engines={check:async()=>{checks++;return {matches:[]};},chat:async()=>{checks++;return {value:{valid:true}};}};
  try{
    const game=newGame(store,'maze',orderBank,'word_order'),service=new GameService(store,engines),ids=[0,4,5,1,2,3,6,7];collectInOrder(service,game.id,ids);
    const result=await service.attempt(game.id,{checkpoint:0,idempotencyKey:'maze-known-original',tokenIds:ids});
    assert.equal(result.correct,false);assert.equal(result.completed,false);assert.equal(checks,0);
    assert.equal(store.game(game.id).state.step,0);assert.deepEqual(store.game(game.id).state.collected,ids);assert.equal(store.progress().totals.xp,0);
    mazeAction(service,game.id,'reset');collectInOrder(service,game.id,[0,1,2,3,4,5,6,7]);
    assert.equal((await service.attempt(game.id,{checkpoint:0,idempotencyKey:'maze-repaired-order',tokenIds:[0,1,2,3,4,5,6,7]})).xpEarned,20);
  }finally{store.close();}
});

test('maze a different valid order uses the existing grammar and meaning verification',async()=>{
  const store=new Store(':memory:'),checked=[],judged=[];
  const engines={check:async text=>{checked.push(text);return {matches:[]};},chat:async(schema,prompt,input)=>{judged.push(input);return {value:{valid:input.alternative==='I go by bus to school every day'}};}};
  try{
    const game=newGame(store,'maze',orderBank,'word_order'),service=new GameService(store,engines),ids=[0,1,4,5,2,3,6,7];collectInOrder(service,game.id,ids);
    const result=await service.attempt(game.id,{checkpoint:0,idempotencyKey:'maze-neutral-order',tokenIds:ids});
    assert.equal(result.correct,true);assert.equal(result.completed,true);assert.equal(result.correctedSentence,'I go by bus to school every day.');
    assert.deepEqual(checked,['I go by bus to school every day']);assert.equal(judged[0].expected,'I go to school by bus every day.');
  }finally{store.close();}
});

test('maze movement and collected repeated words resume after reopening SQLite',()=>{
  const directory=mkdtempSync(join(tmpdir(),'mq-maze-')),file=join(directory,'saved.sqlite');let store=new Store(file);
  try{
    const game=newGame(store,'maze'),service=new GameService(store,offline),token=publicGame(game).board.tokens[2];walkTo(service,game.id,token);
    const input=action(0,'maze-restart-collect','collect'),cached=service.action(game.id,input);store.close();store=new Store(file);
    assert.deepEqual(new GameService(store,offline).action(game.id,input),cached);
    assert.deepEqual(publicGame(store.game(game.id)).adventure.collected,[2]);assert.deepEqual(publicGame(store.game(game.id)).adventure.position,{x:token.x,y:token.y});
    assert.equal(store.progress().totals.attempts,0);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
