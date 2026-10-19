import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../service/store.js';
import {GameService} from '../service/games.js';
import {buildApp} from '../service/app.js';

const offline={check:async()=>{throw Error('A varied round must use an existing verified bank');},chat:async()=>{throw Error('A varied round must not request new AI examples');}};
const headers={host:'127.0.0.1:3210',origin:'http://127.0.0.1:3210','x-mistakequest':'1'};
function saveIssue(store,original,replacement,bad,{locale='en-US',cached=true,retired=false}={}){
  const good=bad.replace(original,replacement),offset=bad.indexOf(original);
  const issue=store.saveAnalysis({key:randomUUID(),locale,status:'issues',originalText:bad,correctedText:good,issues:[{offset,length:original.length,original,replacement,sentence:bad,category:'spelling',explanation:'Corrige esta palabra.'}]}).issues[0];
  if(cached)store.saveBank(issue.id,{validatorVersion:10,varietyRetryAfter:Date.now()+300000,label:'Ortografía',explanation:'Corrige esta palabra.',hint:'Recuerda tu revisión.',source:'ai',...retired?{status:'already_correct',items:[]}:{items:[{bad,good,original,replacement,category:'spelling',targetOffset:offset,targetLength:original.length,answers:[replacement],alternatives:[],alternateOrders:[]}]}},'test');
  return issue;
}
const pair=game=>game.options.map(option=>option.text).sort().join('|');

test('varied choice rounds use different real saved word pairs rather than new sentences with the same pair',async()=>{
  const store=new Store(':memory:');
  try{
    const a=saveIssue(store,'tha','that','I think tha it is fine.');
    saveIssue(store,'tha','that','She says tha it is fine.');
    saveIssue(store,'dia','day','Have a good dia.');saveIssue(store,'importan','important','This is importan to me.');
    const service=new GameService(store,offline),first=await service.create(a.id,'choice'),games=[first],excluded=[a.id];
    for(let i=0;i<2;i++){const next=await service.create(games.at(-1).issueId||a.id,'choice',undefined,{varied:true,excludeIssueIds:excluded});games.push(next);excluded.push(next.issueId);}
    assert.equal(new Set(games.map(pair)).size,3);
    assert.equal(first.issueId,a.id);assert.ok(games.every(game=>store.issue(game.issueId)));
    for(const game of games){const result=await service.attempt(game.id,{answer:'1',idempotencyKey:randomUUID()});assert.equal(result.completed,true);}
    assert.equal(store.progress().totals.completedGames,3);assert.equal(store.progress().totals.xp,60);
  }finally{store.close();}
});

test('pair selection is persisted and chooses an unplayed pair after reopening SQLite',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'mq-varied-choice-')),path=join(directory,'progress.sqlite');let store=new Store(path);
  try{
    const a=saveIssue(store,'tha','that','I think tha it is fine.'),b=saveIssue(store,'dia','day','Have a good dia.'),c=saveIssue(store,'importan','important','This is importan to me.');
    const service=new GameService(store,offline),first=await service.create(a.id,'choice'),second=await service.create(a.id,'choice',undefined,{varied:true});
    assert.notEqual(pair(second),pair(first));
    const totals=store.progress().totals;store.close();store=new Store(path);
    const third=await new GameService(store,offline).create(second.issueId||b.id,'choice',undefined,{varied:true});
    assert.equal(new Set([first,second,third].map(pair)).size,3);assert.equal(third.issueId,c.id);assert.deepEqual(store.progress().totals,totals);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('varied selection uses a verified alternative before trying an uncached requested error',async()=>{
  const store=new Store(':memory:');
  try{
    const uncached=saveIssue(store,'tha','that','I think tha it is fine.',{cached:false}),ready=saveIssue(store,'dia','day','Have a good dia.');
    const game=await new GameService(store,offline).create(uncached.id,'choice',undefined,{varied:true,excludeIssueIds:[uncached.id]});
    assert.equal(game.issueId,ready.id);assert.equal(store.getBank(uncached.id),null);
  }finally{store.close();}
});

test('retired, other-locale and malformed cached candidates cannot block a valid varied round',async()=>{
  const store=new Store(':memory:');
  try{
    const a=saveIssue(store,'tha','that','I think tha it is fine.'),broken=saveIssue(store,'dia','day','Have a good dia.');
    store.saveBank(broken.id,{validatorVersion:10,items:[{bad:'invalid'}]},'test');
    saveIssue(store,'work','working','I work every day.',{retired:true});
    saveIssue(store,'favrite','favourite','Tea is my favrite drink.',{locale:'en-GB'});
    const valid=saveIssue(store,'importan','important','This is importan to me.'),service=new GameService(store,offline);
    await service.create(a.id,'choice');
    const game=await service.create(a.id,'choice',undefined,{varied:true,excludeIssueIds:[a.id]});
    assert.equal(game.issueId,valid.id);assert.equal(store.progress().totals.reviews,5);
  }finally{store.close();}
});

test('a single available pair stays playable without AI, invented words or progress reset',async()=>{
  const store=new Store(':memory:');
  try{
    const a=saveIssue(store,'tha','that','I think tha it is fine.'),service=new GameService(store,offline),before=store.progress().totals;
    const game=await service.create(a.id,'choice',undefined,{varied:true,excludeIssueIds:[a.id]});
    assert.equal(game.issueId,a.id);assert.equal(pair(game),'tha|that');assert.deepEqual(store.progress().totals,before);
    assert.equal((await service.attempt(game.id,{answer:'1',idempotencyKey:randomUUID()})).completed,true);
  }finally{store.close();}
});

test('varied choice POST and persisted game GET expose their actual saved issueId',async()=>{
  const store=new Store(':memory:'),a=saveIssue(store,'tha','that','I think tha it is fine.'),b=saveIssue(store,'dia','day','Have a good dia.'),app=await buildApp({store,engines:offline});
  try{
    const first=await app.inject({method:'POST',url:'/api/games',headers,payload:{issueId:a.id,mode:'choice'}});assert.equal(first.statusCode,200);
    const next=await app.inject({method:'POST',url:'/api/games',headers,payload:{issueId:a.id,mode:'choice',varied:true,excludeIssueIds:[a.id]}});assert.equal(next.statusCode,200);assert.equal(next.json().issueId,b.id);
    const saved=await app.inject({method:'GET',url:'/api/games/'+next.json().id,headers});assert.equal(saved.json().issueId,b.id);assert.equal(saved.json().privateData,undefined);
  }finally{await app.close();store.close();}
});

test('request validation restricts varied rounds to choice and bounded valid issue IDs',async()=>{
  const store=new Store(':memory:'),a=saveIssue(store,'tha','that','I think tha it is fine.'),app=await buildApp({store,engines:offline});
  try{
    for(const patch of [{mode:'radar',varied:true},{varied:true,excludeIssueIds:['invalid']},{varied:true,excludeIssueIds:Array(101).fill(a.id)},{varied:'true'},{varied:false,excludeIssueIds:[a.id]}]){
      const result=await app.inject({method:'POST',url:'/api/games',headers,payload:{issueId:a.id,mode:'choice',...patch}});assert.equal(result.statusCode,400,JSON.stringify(patch));
    }
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM games').get().n,0);
  }finally{await app.close();store.close();}
});

test('ordinary choice and other formats remain anchored to the requested error',async()=>{
  const store=new Store(':memory:');
  try{
    const a=saveIssue(store,'tha','that','I think tha it is fine.');saveIssue(store,'dia','day','Have a good dia.');
    const service=new GameService(store,offline);
    for(const mode of ['choice','radar','repair','order','pairs','judge'])assert.equal((await service.create(a.id,mode)).issueId,a.id);
  }finally{store.close();}
});
