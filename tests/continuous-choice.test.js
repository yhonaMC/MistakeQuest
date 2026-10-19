import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../service/store.js';
import {GameService,publicGame} from '../service/games.js';
import {buildApp} from '../service/app.js';

const engines={check:async()=>{throw Error('A verified runner door needs no engine');},chat:async()=>{throw Error('A verified runner door needs no AI');}};
const headers={host:'127.0.0.1:3210',origin:'http://127.0.0.1:3210','x-mistakequest':'1'};
function seed(store){
  const bad='I think tha it is fine.',good='I think that it is fine.',issue=store.saveAnalysis({key:randomUUID(),locale:'en-US',status:'issues',originalText:bad,correctedText:good,issues:[{offset:8,length:3,original:'tha',replacement:'that',sentence:bad,category:'spelling',explanation:'Se escribe that.'}]}).issues[0];
  store.saveBank(issue.id,{validatorVersion:10,varietyRetryAfter:Date.now()+300000,label:'Ortografía',hint:'Recuerda tu revisión.',explanation:'Se escribe that.',items:[{bad,good,original:'tha',replacement:'that',targetOffset:8,targetLength:3,answers:['that'],alternatives:[],alternateOrders:[]}]},'test');
  return issue;
}
const open=(service,issue,extra={})=>service.create(issue.id,'choice',undefined,{continuous:true,...extra});
const answer=(service,id,values,key=randomUUID())=>service.attempt(id,{idempotencyKey:key,...values});

test('continuous choice is persisted and publicly identified on anchored and varied doors',async()=>{
  const store=new Store(':memory:');try{
    const issue=seed(store),service=new GameService(store,engines);
    for(const options of [{},{varied:true,excludeIssueIds:[issue.id]}]){
      const game=await open(service,issue,options);assert.equal(game.continuous,true);assert.equal(store.game(game.id).state.continuous,true);assert.equal(publicGame(store.game(game.id)).continuous,true);
    }
    const classic=await service.create(issue.id,'choice');assert.notEqual(classic.continuous,true);
  }finally{store.close();}
});

test('a correct continuous door awards persistent points and existing XP only once per idempotent attempt',async()=>{
  const store=new Store(':memory:');try{
    const issue=seed(store),service=new GameService(store,engines),game=await open(service,issue),key=randomUUID();
    const result=await answer(service,game.id,{answer:'1'},key);
    assert.equal(result.correct,true);assert.equal(result.completed,true);assert.equal(result.outcome,'correct');assert.equal(result.arcadePoints,100);assert.equal(result.xpEarned,20);
    assert.deepEqual(await answer(service,game.id,{answer:'1'},key),result);
    const again=await answer(service,game.id,{answer:'1'});assert.equal(again.alreadyCompleted,true);assert.equal(again.arcadePoints,0);assert.equal(again.xpEarned,0);
    assert.equal(store.progress().totals.arcadePoints,100);assert.equal(store.progress().totals.xp,20);assert.equal(store.progress().totals.attempts,1);
    const saved=publicGame(store.game(game.id));assert.equal(saved.outcome,'correct');assert.equal(saved.arcadePoints,100);
  }finally{store.close();}
});

test('an incorrect continuous choice is terminal without marking it correct or consuming the XP reward',async()=>{
  const store=new Store(':memory:');try{
    const issue=seed(store),service=new GameService(store,engines),game=await open(service,issue),key=randomUUID();
    const wrong=await answer(service,game.id,{answer:'0'},key);
    assert.equal(wrong.correct,false);assert.equal(wrong.completed,true);assert.equal(wrong.outcome,'wrong');assert.equal(wrong.arcadePoints,0);assert.equal(wrong.xpEarned,0);
    assert.equal(store.game(game.id).completed,true);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM rewards').get().n,0);assert.equal(store.progress().totals.completedGames,1);
    assert.deepEqual(await answer(service,game.id,{answer:'0'},key),wrong);
    const repeated=await answer(service,game.id,{answer:'1'});assert.equal(repeated.correct,false);assert.equal(repeated.outcome,'wrong');assert.equal(repeated.arcadePoints,0);
    const next=await open(service,issue),fixed=await answer(service,next.id,{answer:'1'});assert.equal(fixed.xpEarned,20);assert.equal(store.progress().totals.arcadePoints,100);
  }finally{store.close();}
});

test('missing a door deducts ten arcade points exactly once and never removes earned XP',async()=>{
  const store=new Store(':memory:');try{
    const issue=seed(store),service=new GameService(store,engines),previous=await service.create(issue.id,'choice');
    await answer(service,previous.id,{answer:'1'});
    const game=await open(service,issue),key=randomUUID(),missed=await answer(service,game.id,{timedOut:true},key);
    assert.equal(missed.correct,false);assert.equal(missed.completed,true);assert.equal(missed.outcome,'missed');assert.equal(missed.arcadePoints,-10);assert.equal(missed.xpEarned,0);
    assert.deepEqual(await answer(service,game.id,{timedOut:true},key),missed);
    const retry=await answer(service,game.id,{timedOut:true});assert.equal(retry.correct,false);assert.equal(retry.outcome,'missed');assert.equal(retry.arcadePoints,0);
    assert.equal(store.progress().totals.arcadePoints,-10);assert.equal(store.progress().totals.xp,20);assert.equal(store.progress().totals.attempts,2);
    assert.equal(store.db.prepare('SELECT correct FROM attempts WHERE game_id=?').get(game.id).correct,0);
  }finally{store.close();}
});

test('timeout deductions and retry protection survive reopening SQLite',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'mq-continuous-')),path=join(directory,'progress.sqlite');let store=new Store(path);
  try{
    const issue=seed(store),service=new GameService(store,engines),game=await open(service,issue),key=randomUUID(),result=await answer(service,game.id,{timedOut:true},key);
    store.close();store=new Store(path);
    assert.equal(store.progress().totals.arcadePoints,-10);assert.equal(publicGame(store.game(game.id)).outcome,'missed');
    assert.deepEqual(await answer(new GameService(store,engines),game.id,{timedOut:true},key),result);assert.equal(store.progress().totals.arcadePoints,-10);assert.equal(store.progress().totals.attempts,1);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('answer and timeout races settle one outcome without duplicate points or rewards',async()=>{
  const store=new Store(':memory:');try{
    const issue=seed(store),service=new GameService(store,engines),game=await open(service,issue);
    const [correct,late]=await Promise.all([answer(service,game.id,{answer:'1'}),answer(service,game.id,{timedOut:true})]);
    assert.equal(correct.arcadePoints,100);assert.equal(late.alreadyCompleted,true);assert.equal(late.arcadePoints,0);assert.equal(store.progress().totals.arcadePoints,100);assert.equal(store.progress().totals.attempts,1);assert.equal(store.progress().totals.completedGames,1);
  }finally{store.close();}
});

test('classic choices retain retry behavior and cannot report a timeout or arcade outcome',async()=>{
  const store=new Store(':memory:');try{
    const issue=seed(store),service=new GameService(store,engines),game=await service.create(issue.id,'choice');
    const wrong=await answer(service,game.id,{answer:'0'});assert.equal(wrong.completed,false);assert.equal(wrong.outcome,undefined);assert.equal(store.progress().totals.arcadePoints,0);
    await assert.rejects(answer(service,game.id,{timedOut:true}),error=>error.code==='INVALID_GAME_ACTION');
    assert.equal(store.progress().totals.attempts,1);assert.equal((await answer(service,game.id,{answer:'1'})).xpEarned,20);
  }finally{store.close();}
});

test('storage rejects forged terminal failures outside validated continuous-choice outcomes',async()=>{
  const store=new Store(':memory:');try{
    const issue=seed(store),service=new GameService(store,engines),classic=await service.create(issue.id,'choice'),continuous=await open(service,issue);
    const forged={idempotencyKey:randomUUID(),correct:false,completed:true,answer:{timedOut:true},state:{continuous:true,outcome:'missed',arcadePoints:-20},response:{outcome:'missed',arcadePoints:-20}};
    assert.throws(()=>store.recordAttempt(classic.id,forged),error=>error.code==='INVALID_RESULT');
    assert.throws(()=>store.recordAttempt(continuous.id,forged),error=>error.code==='INVALID_RESULT');
    assert.equal(store.progress().totals.attempts,0);assert.equal(store.progress().totals.completedGames,0);assert.equal(store.progress().totals.arcadePoints,0);
  }finally{store.close();}
});

test('arcade aggregation ignores malformed, duplicated and unrelated historical attempt responses',async()=>{
  const store=new Store(':memory:');try{
    const issue=seed(store),service=new GameService(store,engines),game=await open(service,issue);
    await answer(service,game.id,{answer:'1'});
    const original=store.db.prepare('SELECT * FROM attempts WHERE game_id=?').get(game.id);
    store.db.prepare('INSERT INTO attempts SELECT ?,game_id,?,request_hash,correct,help,answer,response,created_at FROM attempts WHERE id=?').run(randomUUID(),randomUUID(),original.id);
    store.db.prepare('UPDATE attempts SET response=? WHERE id=?').run('{invalid-json',original.id);
    const classic=await service.create(issue.id,'choice');await answer(service,classic.id,{answer:'1'});
    const old=store.db.prepare('SELECT response FROM attempts WHERE game_id=?').get(classic.id);
    store.db.prepare('UPDATE attempts SET response=? WHERE game_id=?').run(JSON.stringify({...JSON.parse(old.response),outcome:'correct',arcadePoints:99999}),classic.id);
    assert.equal(store.progress().totals.arcadePoints,100);assert.equal(store.progress().totals.xp,20);
  }finally{store.close();}
});

test('continuous HTTP requests validate mode and unambiguous bounded timeout submissions',async()=>{
  const store=new Store(':memory:'),issue=seed(store),app=await buildApp({store,engines});
  try{
    const invalidMode=await app.inject({method:'POST',url:'/api/games',headers,payload:{issueId:issue.id,mode:'radar',continuous:true}});assert.equal(invalidMode.statusCode,400);
    const created=await app.inject({method:'POST',url:'/api/games',headers,payload:{issueId:issue.id,mode:'choice',continuous:true}});assert.equal(created.statusCode,200);assert.equal(created.json().continuous,true);
    const url='/api/games/'+created.json().id+'/attempt';
    for(const patch of [{timedOut:true,answer:'0'},{timedOut:true,tokenIndex:0},{timedOut:false},{timedOut:'true'},{timedOut:true,arcadePoints:1000}]){const result=await app.inject({method:'POST',url,headers,payload:{idempotencyKey:randomUUID(),...patch}});assert.equal(result.statusCode,400);}
    assert.equal(store.progress().totals.attempts,0);
    const timedOut=await app.inject({method:'POST',url,headers,payload:{idempotencyKey:randomUUID(),timedOut:true}});assert.equal(timedOut.statusCode,200);assert.equal(timedOut.json().outcome,'missed');assert.equal(timedOut.json().totals.arcadePoints,-10);
    const saved=await app.inject({method:'GET',url:'/api/games/'+created.json().id,headers});assert.equal(saved.json().outcome,'missed');assert.equal(saved.json().continuous,true);
  }finally{await app.close();store.close();}
});
