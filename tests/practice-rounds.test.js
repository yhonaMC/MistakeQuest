import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Store} from '../service/store.js';import {buildApp} from '../service/app.js';
const headers={host:'127.0.0.1:3210',origin:'http://127.0.0.1:3210','x-mistakequest':'1'},engines={check:async()=>{throw Error('Verified rounds need no engine');},chat:async()=>{throw Error('Verified rounds need no AI');}};
const pairs=[['tha','that'],['freind','friend'],['importan','important'],['techer','teacher'],['intervew','interview'],['langage','language'],['becase','because'],['dificult','difficult'],['realy','really'],['grammer','grammar'],['beutiful','beautiful'],['opportnity','opportunity'],['technlogy','technology'],['recieve','receive'],['adress','address'],['tomorow','tomorrow'],['yestarday','yesterday'],['diffrent','different'],['comon','common'],['necesary','necessary']];
function seed(store,count=20){return pairs.slice(0,count).map(([original,replacement])=>{const bad=`I wrote the word ${original} today.`,offset=bad.indexOf(original),good=bad.replace(original,replacement),issue=store.saveAnalysis({key:randomUUID(),locale:'en-US',status:'issues',originalText:bad,correctedText:good,issues:[{original,replacement,offset,length:original.length,sentence:bad,category:'spelling',explanation:'Revisa la ortografía.'}]}).issues[0];const items=['I wrote the word ','We practiced the word ','She checked the word '].map(prefix=>({bad:prefix+original+' today.',good:prefix+replacement+' today.',original,replacement,targetOffset:prefix.length,targetLength:original.length,answers:[replacement],alternatives:[],alternateOrders:[]}));store.saveBank(issue.id,{validatorVersion:10,items,label:'Ortografía',hint:'Revisa una palabra.',explanation:'Revisa la ortografía.'},'test');return issue;});}
async function attach(store,issues){const app=await buildApp({store,engines});const request=async(method,url,payload)=>{const response=await app.inject({method,url,headers,...payload?{payload}:{}});return {status:response.statusCode,body:response.json()};};return {store,issues,app,request,close:async()=>{await app.close();store.close();}};}
async function setup(count=20){const store=new Store(':memory:');return attach(store,seed(store,count));}
async function open(f,mode='choice',extra={}){const result=await f.request('POST','/api/practice-rounds',{issueId:f.issues[0].id,mode,idempotencyKey:randomUUID(),...extra});assert.equal(result.status,200);return result.body;}
async function settle(f,round,answer){return f.request('POST','/api/games/'+round.game.id+'/attempt',{idempotencyKey:randomUUID(),...answer});}
async function next(f,round){const result=await f.request('POST','/api/practice-rounds/'+round.id+'/next',{afterGameId:round.game.id});assert.equal(result.status,200);return result.body;}
function attemptResult({totals,practiceRound,...result}){return result;}

test('choice rounds create lazily, resume, reject skips and stop at ten doors with idempotent advancement',async()=>{
  const f=await setup();try{let round=await open(f);const first=round;assert.equal(round.total,10);assert.equal(round.completedCount,0);assert.equal(round.game.continuous,true);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM games').get().n,1);
    const blocked=await f.request('POST','/api/practice-rounds/'+round.id+'/next',{afterGameId:round.game.id});assert.equal(blocked.status,409);
    for(let i=0;i<10;i++){const gameId=round.game.id;assert.equal((await settle(f,round,{answer:i<5?'0':'1'})).status,200);const following=await next(f,round);const repeated=await f.request('POST','/api/practice-rounds/'+round.id+'/next',{afterGameId:gameId});assert.equal(repeated.body.game?.id,following.game?.id);round=following;}
    assert.equal(round.complete,true);assert.equal(round.game,null);assert.equal(round.completedCount,10);assert.equal(round.stats.correct,5);assert.equal(round.stats.wrong,5);assert.equal(round.points,500);assert.equal(round.xpEarned,100);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM games').get().n,10);
    const resumed=await f.request('GET','/api/practice-rounds/'+first.id);assert.equal(resumed.body.complete,true);assert.equal(f.store.progress().practiceRounds[0].completedCount,10);
  }finally{await f.close();}
});
test('a five-failure round plans five unique reviews and five unseen sentences, including after server recreation',async()=>{
  const f=await setup();try{let round=await open(f);for(let i=0;i<10;i++){await settle(f,round,{answer:i<5?'0':'1'});round=await next(f,round);}
    const after=await open(f,'choice',{previousRoundId:round.id});assert.deepEqual(after.mix,{review:5,new:5,spaced:0,practice:0});assert.equal(after.timeLimitMs,5000);
    const plan=JSON.parse(f.store.db.prepare('SELECT plan FROM practice_rounds WHERE id=?').get(after.id).plan);assert.equal(new Set(plan.filter(entry=>entry.kind==='review').map(entry=>entry.issueId)).size,5);assert.deepEqual(plan.map(entry=>entry.kind),['review','new','review','new','review','new','review','new','review','new']);const reviews=new Set(plan.filter(entry=>entry.kind==='review').map(entry=>entry.issueId));assert.ok(plan.filter(entry=>entry.kind==='new').every(entry=>!reviews.has(entry.issueId)));
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM games').get().n,11);
    const auto=await open(f);assert.equal(auto.mix.review,5);assert.equal(auto.mix.new,5);
  }finally{await f.close();}
});
test('zero, three and eight failures produce the promised durable mixes and distribute new exercises',async()=>{
  for(const failures of [0,3,8]){const f=await setup();try{let round=await open(f);for(let i=0;i<10;i++){await settle(f,round,{answer:i<failures?'0':'1'});round=await next(f,round);}const following=await open(f,'choice',{previousRoundId:round.id});assert.deepEqual(following.mix,failures===0?{review:0,new:8,spaced:2,practice:0}:failures===3?{review:3,new:5,spaced:2,practice:0}:{review:8,new:2,spaced:0,practice:0});assert.equal(following.timeLimitMs,failures>=6?8000:5000);if(failures===8){const plan=JSON.parse(f.store.db.prepare('SELECT plan FROM practice_rounds WHERE id=?').get(following.id).plan);assert.ok(plan.slice(0,5).some(entry=>entry.kind==='new'));}}finally{await f.close();}}
});
test('round creation idempotency and a tiny verified pool preserve a playable honest plan',async()=>{
  const f=await setup(1);try{const key=randomUUID(),payload={issueId:f.issues[0].id,mode:'choice',idempotencyKey:key},a=await f.request('POST','/api/practice-rounds',payload),b=await f.request('POST','/api/practice-rounds',payload);assert.equal(a.status,200);assert.equal(a.body.id,b.body.id);assert.equal(a.body.game.id,b.body.game.id);assert.equal(a.body.total,10);assert.ok(a.body.mix.practice>=7);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM games').get().n,1);assert.equal((await f.request('POST','/api/practice-rounds',{...payload,mode:'radar'})).status,409);
  }finally{await f.close();}
});
test('an already-correct anchor is acknowledged without silently opening another saved error',async()=>{
  const f=await setup(3);try{f.store.saveBank(f.issues[0].id,{validatorVersion:10,status:'already_correct',items:[],message:'Este fragmento ya estaba bien.',context:'A valid sentence.'},'test');const result=await f.request('POST','/api/practice-rounds',{issueId:f.issues[0].id,mode:'choice',idempotencyKey:randomUUID()});assert.equal(result.status,200);assert.equal(result.body.status,'already_correct');assert.equal(result.body.issueId,f.issues[0].id);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM practice_rounds').get().n,0);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM games').get().n,0);}finally{await f.close();}
});
test('guided radar ignores repeated rejected tokens, escalates hints and ends falsely answered phrases as exhausted',async()=>{
  const f=await setup(3);try{let round=await open(f,'radar');assert.equal(round.total,3);assert.equal(round.game.guided,true);assert.equal(round.game.attemptsRemaining,3);const saved=f.store.game(round.game.id),badTokens=saved.privateData.tokens.filter(token=>token.offset+token.length<=saved.privateData.item.targetOffset||token.offset>=saved.privateData.item.targetOffset+saved.privateData.item.targetLength),hit=saved.privateData.tokens.find(token=>!badTokens.includes(token));
    const first=await settle(f,round,{tokenIndex:badTokens[0].id});assert.equal(first.body.attemptsRemaining,2);assert.equal(first.body.hintLevel,1);assert.ok(first.body.hint);const count=f.store.progress().totals.attempts;
    const repeated=await settle(f,round,{tokenIndex:badTokens[0].id});assert.equal(repeated.body.ignored,true);assert.equal(repeated.body.attemptsRemaining,2);assert.equal(f.store.progress().totals.attempts,count);
    const second=await settle(f,round,{tokenIndex:badTokens[1].id});assert.equal(second.body.hintLevel,2);assert.equal(second.body.attemptsRemaining,1);
    const exhausted=await settle(f,round,{tokenIndex:badTokens[2].id});assert.equal(exhausted.body.correct,false);assert.equal(exhausted.body.completed,true);assert.equal(exhausted.body.outcome,'exhausted');assert.equal(exhausted.body.xpEarned,0);assert.ok(exhausted.body.correctedSentence);assert.ok(exhausted.body.explanation);
    round=await next(f,round);const secondSaved=f.store.game(round.game.id),wrong=secondSaved.privateData.tokens.find(token=>token.offset<secondSaved.privateData.item.targetOffset),target=secondSaved.privateData.tokens.find(token=>token.offset<=secondSaved.privateData.item.targetOffset&&token.offset+token.length>secondSaved.privateData.item.targetOffset);await settle(f,round,{tokenIndex:wrong.id});const helped=await settle(f,round,{tokenIndex:target.id});assert.equal(helped.body.correct,true);assert.equal(helped.body.assisted,true);assert.equal(helped.body.xpEarned,10);
    round=await next(f,round);const third=f.store.game(round.game.id),token=third.privateData.tokens.find(token=>token.offset<=third.privateData.item.targetOffset&&token.offset+token.length>third.privateData.item.targetOffset);assert.equal((await settle(f,round,{tokenIndex:token.id})).body.xpEarned,20);round=await next(f,round);assert.equal(round.complete,true);assert.equal(round.stats.correct,2);assert.equal(round.stats.assisted,1);assert.equal(round.stats.exhausted,1);assert.equal(round.xpEarned,30);
  }finally{await f.close();}
});
test('round plans, mixed queues and guided discarded tokens survive a real database restart',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'mq-rounds-')),path=join(directory,'progress.sqlite'),store=new Store(path),issues=seed(store);let f=await attach(store,issues);
  try{let choice=await open(f);for(let i=0;i<10;i++){await settle(f,choice,{answer:i<5?'0':'1'});choice=await next(f,choice);}let radar=await open(f,'radar');const oldId=radar.game.id;await settle(f,radar,{tokenIndex:0});const attempts=f.store.progress().totals.attempts;await f.close();f=null;
    f=await attach(new Store(path),issues);const restored=await f.request('GET','/api/practice-rounds/'+radar.id);radar=restored.body;assert.equal(radar.game.id,oldId);assert.equal(radar.game.misses,1);assert.equal(radar.game.attemptsRemaining,2);assert.deepEqual(radar.game.discardedTokenIds,[0]);assert.equal((await settle(f,radar,{tokenIndex:0})).body.ignored,true);assert.equal(f.store.progress().totals.attempts,attempts);
    const queued=await open(f);assert.deepEqual(queued.mix,{review:5,new:5,spaced:0,practice:0});assert.equal(f.store.progress().practiceRounds.find(round=>round.id===choice.id).complete,true);
    const exportValue=f.store.export();assert.ok(exportValue.tables.practice_rounds.length>=3);assert.equal(exportValue.progress.totals.arcadePoints,500);
  }finally{if(f)await f.close();rmSync(directory,{recursive:true,force:true});}
});
test('manual guided hints cost no shots, reduce success XP and do not reveal an unfinished answer',async()=>{
  const f=await setup(3);try{const round=await open(f,'radar'),url='/api/games/'+round.game.id,blocked=await f.request('POST',url+'/reveal',{});assert.equal(blocked.status,400);const hint=await f.request('POST',url+'/hint',{});assert.equal(hint.status,200);assert.equal(hint.body.attemptsRemaining,3);assert.equal(hint.body.hintLevel,1);assert.equal(f.store.progress().totals.attempts,0);
    const empty=await f.request('POST',url+'/attempt',{idempotencyKey:randomUUID()});assert.equal(empty.status,400);assert.equal(f.store.game(round.game.id).state.discardedTokenIds.length,0);
    const saved=f.store.game(round.game.id),token=saved.privateData.tokens.find(token=>token.offset<=saved.privateData.item.targetOffset&&token.offset+token.length>saved.privateData.item.targetOffset),result=await settle(f,round,{tokenIndex:token.id});assert.equal(result.body.xpEarned,10);assert.equal(result.body.assisted,true);assert.equal(result.body.practiceRound.stats.assisted,1);
  }finally{await f.close();}
});
test('guided limits cannot be forged through stored terminal callbacks and classic radar keeps unlimited retries',async()=>{
  const f=await setup(3);try{const round=await open(f,'radar'),saved=f.store.game(round.game.id);assert.throws(()=>f.store.recordAttempt(saved.id,{idempotencyKey:randomUUID(),correct:false,completed:true,state:{...saved.state,outcome:'exhausted',discardedTokenIds:[0]},answer:{tokenIndex:0},response:{outcome:'exhausted'}}),error=>error.code==='INVALID_RESULT');assert.equal(f.store.progress().totals.attempts,0);
    const classic=(await f.request('POST','/api/games',{issueId:f.issues[0].id,mode:'radar'})).body;for(let i=0;i<4;i++){const result=await f.request('POST','/api/games/'+classic.id+'/attempt',{idempotencyKey:randomUUID(),tokenIndex:0});assert.equal(result.body.completed,false);assert.equal(result.body.outcome,undefined);}assert.notEqual(f.store.game(classic.id).state.guided,true);
  }finally{await f.close();}
});

test('a reopened runner round reviews both wrong answers and timeouts with new simple examples',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'mq-runner-reviews-')),path=join(directory,'progress.sqlite'),store=new Store(path),issues=seed(store);
  let f=await attach(store,issues);
  try{
    let round=await open(f);const failed=new Map(),seen=new Set();
    for(let index=0;index<10;index++){
      const saved=f.store.game(round.game.id);seen.add(saved.privateData.item.good);
      if(index<3)failed.set(saved.issueId,saved.privateData.item.good);
      const result=await settle(f,round,index===2?{timedOut:true}:{answer:index<2?'0':'1'});
      assert.equal(result.status,200);
      assert.equal(result.body.outcome,index===2?'missed':index<2?'wrong':'correct');
      round=await next(f,round);
    }
    assert.deepEqual(round.stats,{correct:7,wrong:2,missed:1,assisted:0,exhausted:0});
    assert.equal(round.points,690);assert.equal(round.xpEarned,140);
    const totals=f.store.progress().totals;
    await f.close();f=null;f=await attach(new Store(path),issues);
    const restored=await f.request('GET','/api/practice-rounds/'+round.id);
    assert.equal(restored.status,200);assert.equal(restored.body.complete,true);
    assert.deepEqual(restored.body.stats,round.stats);assert.equal(restored.body.points,690);
    assert.deepEqual(f.store.progress().totals,totals);
    const following=await open(f);
    assert.deepEqual(following.mix,{review:3,new:5,spaced:2,practice:0});
    const plan=JSON.parse(f.store.db.prepare('SELECT plan FROM practice_rounds WHERE id=?').get(following.id).plan),reviews=plan.filter(entry=>entry.kind==='review');
    assert.deepEqual(new Set(reviews.map(entry=>entry.issueId)),new Set(failed.keys()));
    for(const entry of reviews){
      const item=entry.bank.items[0];
      assert.notEqual(item.good,failed.get(entry.issueId));
      assert.equal(item.bad.slice(0,item.targetOffset)+item.replacement+item.bad.slice(item.targetOffset+item.targetLength),item.good);
      assert.ok(item.bad.split(/\s+/).length<=12);
    }
    assert.ok(plan.filter(entry=>entry.kind==='new').every(entry=>!seen.has(entry.bank.items[0].good)));
  }finally{if(f)await f.close();rmSync(directory,{recursive:true,force:true});}
});

test('exhausted and assisted radar phrases return as reviews after reopening the database',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'mq-radar-reviews-')),path=join(directory,'progress.sqlite'),store=new Store(path),issues=seed(store);
  let f=await attach(store,issues);
  try{
    let round=await open(f,'radar');const failed=new Map();
    for(let index=0;index<3;index++){
      const saved=f.store.game(round.game.id),item=saved.privateData.item;
      const hit=saved.privateData.tokens.find(token=>token.offset<item.targetOffset+item.targetLength&&item.targetOffset<token.offset+token.length);
      const misses=saved.privateData.tokens.filter(token=>token.id!==hit.id);
      if(index<2)failed.set(saved.issueId,item.good);
      if(index===0){
        for(const token of misses.slice(0,3))assert.equal((await settle(f,round,{tokenIndex:token.id})).status,200);
        assert.equal(f.store.game(saved.id).state.outcome,'exhausted');
      }else{
        if(index===1)assert.equal((await f.request('POST','/api/games/'+saved.id+'/hint',{})).status,200);
        const result=await settle(f,round,{tokenIndex:hit.id});
        assert.equal(result.body.assisted,index===1);assert.equal(result.body.xpEarned,index===1?10:20);
      }
      round=await next(f,round);
    }
    assert.equal(round.complete,true);
    assert.deepEqual(round.stats,{correct:2,wrong:0,missed:0,assisted:1,exhausted:1});
    assert.equal(round.xpEarned,30);
    await f.close();f=null;f=await attach(new Store(path),issues);
    const restored=await f.request('GET','/api/practice-rounds/'+round.id);
    assert.deepEqual(restored.body.stats,round.stats);assert.equal(restored.body.xpEarned,30);
    const following=await open(f,'radar');
    assert.deepEqual(following.mix,{review:2,new:1,spaced:0,practice:0});
    const plan=JSON.parse(f.store.db.prepare('SELECT plan FROM practice_rounds WHERE id=?').get(following.id).plan),reviews=plan.filter(entry=>entry.kind==='review');
    assert.deepEqual(new Set(reviews.map(entry=>entry.issueId)),new Set(failed.keys()));
    for(const entry of reviews){
      const item=entry.bank.items[0];
      assert.notEqual(item.good,failed.get(entry.issueId));
      assert.equal(item.bad.slice(0,item.targetOffset)+item.replacement+item.bad.slice(item.targetOffset+item.targetLength),item.good);
      assert.ok(item.bad.split(/\s+/).length<=12);
    }
    assert.equal(following.game.attemptsRemaining,3);assert.deepEqual(following.game.discardedTokenIds,[]);
  }finally{if(f)await f.close();rmSync(directory,{recursive:true,force:true});}
});

test('partial guided radar restores both discarded tokens and the final hint without spending another shot',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'mq-radar-partial-')),path=join(directory,'progress.sqlite'),store=new Store(path),issues=seed(store,3);
  let f=await attach(store,issues);
  try{
    const round=await open(f,'radar'),saved=f.store.game(round.game.id),item=saved.privateData.item;
    const hit=saved.privateData.tokens.find(token=>token.offset<item.targetOffset+item.targetLength&&item.targetOffset<token.offset+token.length),misses=saved.privateData.tokens.filter(token=>token.id!==hit.id);
    const firstPayload={idempotencyKey:randomUUID(),tokenIndex:misses[0].id},url='/api/games/'+saved.id+'/attempt';
    const first=await f.request('POST',url,firstPayload),second=await settle(f,round,{tokenIndex:misses[1].id});
    assert.equal(first.status,200);assert.equal(second.status,200);
    assert.equal(second.body.hintLevel,2);assert.equal(second.body.attemptsRemaining,1);
    assert.ok(second.body.hint);assert.equal(f.store.progress().totals.attempts,2);
    await f.close();f=null;f=await attach(new Store(path),issues);
    const restored=await f.request('GET','/api/practice-rounds/'+round.id),game=restored.body.game;
    assert.equal(game.id,saved.id);assert.equal(game.misses,2);assert.equal(game.attemptsRemaining,1);
    assert.deepEqual(game.discardedTokenIds,[misses[0].id,misses[1].id]);
    assert.equal(game.hintLevel,2);assert.equal(game.hint,second.body.hint);assert.equal(game.help,'hint');assert.equal(game.assisted,true);
    const replay=await f.request('POST',url,firstPayload);
    assert.equal(replay.status,200);assert.deepEqual(attemptResult(replay.body),attemptResult(first.body));
    assert.equal(replay.body.totals.attempts,2);assert.deepEqual(replay.body.practiceRound.game,game);
    const ignored=await settle(f,restored.body,{tokenIndex:misses[1].id});
    assert.equal(ignored.body.ignored,true);assert.equal(ignored.body.attemptsRemaining,1);
    assert.equal(f.store.progress().totals.attempts,2);
    const result=await settle(f,restored.body,{tokenIndex:hit.id});
    assert.equal(result.body.completed,true);assert.equal(result.body.correct,true);
    assert.equal(result.body.assisted,true);assert.equal(result.body.xpEarned,10);
    assert.equal(f.store.progress().totals.attempts,3);
  }finally{if(f)await f.close();rmSync(directory,{recursive:true,force:true});}
});

test('restarted round creation, completion retries and advancement never credit another reward',async()=>{
  for(const mode of ['choice','radar']){
    const directory=mkdtempSync(join(tmpdir(),'mq-round-retries-')),path=join(directory,'progress.sqlite'),store=new Store(path),issues=seed(store);
    let f=await attach(store,issues);
    try{
      const creation={issueId:issues[0].id,mode,idempotencyKey:randomUUID()},created=await f.request('POST','/api/practice-rounds',creation),round=created.body;
      assert.equal(created.status,200);
      const saved=f.store.game(round.game.id),item=saved.privateData.item,token=saved.privateData.tokens.find(token=>token.offset<item.targetOffset+item.targetLength&&item.targetOffset<token.offset+token.length);
      const attempt={idempotencyKey:randomUUID(),...mode==='choice'?{answer:'1'}:{tokenIndex:token.id}},attemptUrl='/api/games/'+saved.id+'/attempt';
      const completed=await f.request('POST',attemptUrl,attempt),advanced=await next(f,round);
      assert.equal(completed.status,200);assert.equal(completed.body.xpEarned,20);
      const totals=f.store.progress().totals;
      assert.equal(totals.attempts,1);assert.equal(totals.completedGames,1);assert.equal(totals.xp,20);
      assert.equal(totals.arcadePoints,mode==='choice'?100:0);
      await f.close();f=null;f=await attach(new Store(path),issues);
      const recreated=await f.request('POST','/api/practice-rounds',creation);
      assert.equal(recreated.status,200);assert.equal(recreated.body.id,round.id);assert.equal(recreated.body.game.id,advanced.game.id);
      const replay=await f.request('POST',attemptUrl,attempt);
      assert.equal(replay.status,200);assert.deepEqual(attemptResult(replay.body),attemptResult(completed.body));
      assert.equal(replay.body.practiceRound.game.id,advanced.game.id);
      const repeated=await f.request('POST',attemptUrl,{...attempt,idempotencyKey:randomUUID()});
      assert.equal(repeated.body.alreadyCompleted,true);assert.equal(repeated.body.xpEarned,0);
      if(mode==='choice')assert.equal(repeated.body.arcadePoints,0);
      const duplicateNext=await next(f,round);
      assert.equal(duplicateNext.game.id,advanced.game.id);assert.equal(duplicateNext.completedCount,1);
      assert.equal(duplicateNext.xpEarned,20);assert.equal(duplicateNext.points,mode==='choice'?100:0);
      assert.deepEqual(f.store.progress().totals,totals);
      assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM practice_rounds').get().n,1);
      assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM games').get().n,2);
      assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM rewards').get().n,1);
    }finally{if(f)await f.close();rmSync(directory,{recursive:true,force:true});}
  }
});
