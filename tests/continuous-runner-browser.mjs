import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {Store} from '../service/store.js';
import {buildApp} from '../service/app.js';

// All requests reach the real Fastify service. Only engines and learner data are isolated.
const root=resolve('test-results/continuous-runner-'+Date.now());
mkdirSync(root,{recursive:true});
const store=new Store(resolve(root,'practice.sqlite'));
const examples=[
 ['tha','that',['I know tha you can swim.','She says tha it is cold.','We hope tha you can come.']],
 ['importan','important',['This is importan for my class.','Your work is importan to me.','Sleep is importan for us.']],
 ['continuos','continuous',['We practice the past continuos tense.','I study the past continuos tense.','Our teacher explains the past continuos tense.']]
];
for(const [original,replacement,sentences]of examples){
 const items=sentences.map(bad=>({bad,good:bad.replace(original,replacement),original,replacement,category:'spelling',targetOffset:bad.indexOf(original),targetLength:original.length,answers:[replacement],alternatives:[],alternateOrders:[]}));
 const issue=store.saveAnalysis({key:'continuous-runner-'+original,locale:'en-US',status:'issues',originalText:items[0].bad,correctedText:items[0].good,issues:[{offset:items[0].targetOffset,length:original.length,original,replacement,category:'spelling',sentence:items[0].bad,explanation:'Revisa cómo se escribe esta palabra.'}]}).issues[0];
 store.saveBank(issue.id,{validatorVersion:10,source:'verified',items,label:'Ortografía',explanation:'Revisa cómo se escribe esta palabra.',hint:'Mira las letras de la palabra.'},'qwen3:8b');
}
let aiCalls=0;
const engines={
 health:async()=>({ollama:true,languageTool:true,modelReady:true,models:[{name:'qwen3:8b',size:5200000000}]}),
 check:async()=>{aiCalls++;throw Error('Saved choice games must not invoke grammar engines.');},
 chat:async()=>{aiCalls++;throw Error('Saved choice games must not invoke AI.');}
};
const app=await buildApp({store,engines});
let browser;
try{
 const base=await app.listen({host:'127.0.0.1',port:0});
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1360,height:1100},reducedMotion:'no-preference'});
 const page=await context.newPage(),errors=[],external=[],createRequests=[],nextRequests=[],attemptRequests=[],rounds=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{
  if(!request.url().startsWith(base))external.push(request.url());
  if(request.method()!=='POST')return;
  if(request.url()===base+'/api/practice-rounds')createRequests.push(request.postDataJSON());
  if(/\/api\/practice-rounds\/[^/]+\/next$/.test(request.url()))nextRequests.push(request.postDataJSON());
  if(/\/api\/games\/[^/]+\/attempt$/.test(request.url()))attemptRequests.push({url:request.url(),body:request.postDataJSON()});
 });
 await page.goto(base);
 await page.getByText('IA local lista',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Mi progreso',exact:true}).click();
 await page.getByRole('button',{name:'Practicar',exact:true}).first().click();
 await page.locator('.mode-card').filter({has:page.getByRole('heading',{name:'Dos caminos',exact:true})}).click();
 const session=page.locator('.continuous-runner-session');
 await session.waitFor();
 assert.equal(createRequests[0].mode,'choice','Starting Dos caminos requests a saved ten-door round');
 const gameId=()=>session.getAttribute('data-game-id');
 const currentGame=async()=>{
  const id=await gameId(),game=store.game(id);
  assert.ok(game,'The board belongs to an actual saved game');
  assert.equal(game.mode,'choice');
  const publicResponse=await context.request.get(base+'/api/games/'+id);
  assert.equal(publicResponse.status(),200);
  const publicGame=await publicResponse.json();
  assert.equal(publicGame.continuous,true);
  assert.equal(publicGame.issueId,game.issueId,'The client receives the issue actually used for this gate');
  return game;
 };
 const remember=async number=>{
  assert.equal(await session.getAttribute('data-round'),String(number));
  const game=await currentGame();
  rounds.push({round:number,id:game.id,issueId:game.issueId,word:game.privateData.item.replacement});
  assert.equal(await page.locator('.arcade-next-round').count(),0,'Continuous play has no Next round button');
  return game;
 };
 const startIfNeeded=async()=>{
  if(await page.locator('.runner-arcade').getAttribute('data-phase')==='ready')await page.locator('.runner-go').click();
 };
 const nextAfter=async(game,number)=>{
  await page.waitForFunction(previous=>document.querySelector('.continuous-runner-session')?.dataset.gameId!==previous,game.id,{timeout:12000});
  assert.equal(await session.getAttribute('data-round'),String(number));
  assert.equal(await page.locator('.victory-card').count(),0,'There is no forced finish after three gates');
 };
 const answer=async(game,correct)=>{
  const wait=page.waitForResponse(response=>response.url()===base+'/api/games/'+game.id+'/attempt'&&response.request().method()==='POST');
  // Gates move every frame; use the player's fixed steering controls rather than
  // Playwright's stable-element wait, which can outlast the five-second deadline.
  const lane=game.state.choiceOrder.indexOf(correct?1:0);
  assert.ok(lane>=0);
  await page.locator('.runner-steering button').nth(lane).click();
  await page.locator('.runner-playfield').press('Space');
  const response=await wait;
  assert.equal(response.status(),200);
  const result=await response.json();
  assert.equal(result.correct,correct);
  assert.equal(result.completed,true,'Both a correct and an incorrect answer settle one continuous gate');
  assert.equal(result.arcadePoints,correct?100:0);
  assert.equal(result.xpEarned,correct?20:0);
  return result;
 };

 // Gate 1: an intentional answer earns server points and automatically presents another word.
 const first=await remember(1);
 await startIfNeeded();
 const player=page.locator('.runner-player'),before=await player.boundingBox();
 await page.waitForTimeout(400);
 const moving=await player.boundingBox();
 assert.ok(moving.y<before.y-2&&moving.height<before.height,'The rocket advances and changes perspective during the run');
 const firstResult=await answer(first,true);
 assert.equal(firstResult.totals.arcadePoints,100);
 await nextAfter(first,2);

 // Gate 2: no selected lane expires after five seconds, paints both gates red and persists -10.
 const missed=await remember(2),missStarted=performance.now();
 assert.equal(await player.getAttribute('data-lane'),'none','A new gate never inherits the previous answer');
 await startIfNeeded();
 const missResponsePromise=page.waitForResponse(response=>response.url()===base+'/api/games/'+missed.id+'/attempt'&&response.request().method()==='POST',{timeout:8000});
 await page.locator('.runner-gate.is-missed').first().waitFor({timeout:8000});
 assert.equal(await page.locator('.runner-gate.is-missed').count(),2,'Both gates become red for a missed decision');
 const missResponse=await missResponsePromise,missResult=await missResponse.json(),missDuration=performance.now()-missStarted;
 assert.equal(missResponse.status(),200);
 assert.ok(missDuration>=4300&&missDuration<=7500,'The unanswered gate expires in about five seconds: '+Math.round(missDuration));
 assert.deepEqual({correct:missResult.correct,completed:missResult.completed,outcome:missResult.outcome,arcadePoints:missResult.arcadePoints,xpEarned:missResult.xpEarned},{correct:false,completed:true,outcome:'missed',arcadePoints:-10,xpEarned:0});
 const missedRequest=attemptRequests.find(request=>request.url.endsWith('/'+missed.id+'/attempt'));
 assert.equal(missedRequest.body.timedOut,true);
 assert.equal(missedRequest.body.answer,undefined,'A missed lane sends a timeout, never a fabricated choice');
 assert.equal(store.progress().totals.arcadePoints,90);
 await page.screenshot({path:resolve(root,'missed-both-gates-red.png'),fullPage:true});
 await nextAfter(missed,3);

 // Gate 3: a wrong answer is terminal without XP or a timeout penalty.
 const wrong=await remember(3);
 await startIfNeeded();
 await answer(wrong,false);
 assert.equal(store.progress().totals.arcadePoints,90);
 assert.equal(store.progress().totals.xp,20);
 await nextAfter(wrong,4);
 assert.equal(new Set(rounds.slice(0,3).map(round=>round.word)).size,3,'The first three gates use different real saved corrections');

 // Gate 4 proves play continues beyond the previous three-round limit.
 const fourth=await remember(4);
 await startIfNeeded();
 await answer(fourth,true);
 assert.equal(store.progress().totals.arcadePoints,190);
 await nextAfter(fourth,5);

 // Gate 5: pause for longer than the timeout, resume, then settle only one answer.
 const fifth=await remember(5);
 await startIfNeeded();
 await page.locator('.runner-pause').click();
 await page.waitForFunction(()=>document.querySelector('.runner-arcade')?.dataset.phase==='paused');
 const pausedTotals=store.progress().totals,pausedGameId=await gameId(),pausedPlayer=await player.boundingBox();
 await page.waitForTimeout(5400);
 assert.equal(await gameId(),pausedGameId,'Pausing does not advance to another gate');
 assert.deepEqual(store.progress().totals,pausedTotals,'Pausing does not write an attempt or penalty');
 assert.deepEqual(await player.boundingBox(),pausedPlayer,'Pausing freezes the rocket');
 await page.locator('.runner-pause').click();
 await answer(fifth,true);
 await nextAfter(fifth,6);
 const sixth=await remember(6);
 // The server commits this timeout, but the first response is lost in transit.
 let dropResponse=true,lostResult;
 await page.route(base+'/api/games/'+sixth.id+'/attempt',async route=>{
  if(!dropResponse)return route.continue();
  dropResponse=false;
  const upstream=await route.fetch();
  assert.equal(upstream.status(),200);
  lostResult=await upstream.json();
  await route.abort('failed');
 });
 await startIfNeeded();
 await page.locator('.continuous-runner-session .alert').waitFor({timeout:8000});
 assert.equal(lostResult.outcome,'missed');
 assert.equal(lostResult.arcadePoints,-10);
 assert.equal(store.progress().totals.arcadePoints,280,'The server stored the missed gate before the response was dropped');
 assert.equal(store.progress().totals.attempts,6);
 await page.waitForTimeout(1200);
 assert.equal(await gameId(),sixth.id,'A lost response does not auto-advance past an unacknowledged result');
 assert.equal(store.progress().totals.attempts,6,'Waiting to retry never fabricates a second attempt');
 const retryResponsePromise=page.waitForResponse(response=>response.url()===base+'/api/games/'+sixth.id+'/attempt'&&response.request().method()==='POST');
 await page.getByRole('button',{name:'Reintentar conexión',exact:true}).click();
 const retryResponse=await retryResponsePromise,retried=await retryResponse.json();
 assert.equal(retryResponse.status(),200);
 assert.equal(retried.outcome,'missed');
 assert.equal(retried.arcadePoints,-10,'Idempotent replay returns the original deduction to the session');
 assert.equal(store.progress().totals.arcadePoints,280,'Replaying the saved timeout deducts no additional points');
 assert.equal(store.progress().totals.attempts,6);
 const sixthRequests=attemptRequests.filter(request=>request.url.endsWith('/'+sixth.id+'/attempt'));
 assert.equal(sixthRequests.length,2);
 assert.deepEqual(sixthRequests[1].body,sixthRequests[0].body,'Retry preserves the timeout and its original idempotency key');
 await nextAfter(sixth,7);
 await remember(7);
 // Freeze the unattempted seventh gate while checking durable totals and the HUD.
 await startIfNeeded();
 await page.locator('.runner-pause').click();
 await page.waitForFunction(()=>document.querySelector('.runner-arcade')?.dataset.phase==='paused');
 const totals=store.progress().totals;
 assert.equal(totals.attempts,6,'Every settled gate stores exactly one attempt, even after a lost response');
 assert.equal(totals.xp,60,'Only the three correct, previously uncredited sentences earn XP');
 assert.equal(totals.arcadePoints,280,'Three correct gates and two misses persist 100+100+100-10-10 points');
 assert.match(await page.locator('.runner-score-points').innerText(),/280/);
 assert.match(await page.locator('.runner-score-xp').innerText(),/60/);
 assert.equal(await session.getAttribute('data-saved'),'6');
 assert.equal(attemptRequests.length,7,'Only the six settlements and one explicit retry reach the service');
 assert.equal(new Set(attemptRequests.map(request=>request.body.idempotencyKey)).size,6);
 assert.equal(createRequests.length,1,'Seven gates stay within the same ten-door round');
 assert.equal(nextRequests.length,6);
 for(const [index,request]of nextRequests.entries())assert.equal(request.afterGameId,rounds[index].id,'Transitions identify the settled gate and remain idempotent');
 await page.setViewportSize({width:320,height:1100});
 await page.locator('header .interface-language-capsule').getByRole('button',{name:'English',exact:true}).click();
 assert.equal(await page.locator('html').getAttribute('lang'),'en');
 assert.equal(await page.locator('.runner-arcade').getAttribute('data-phase'),'paused');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'The paused continuous runner has no horizontal overflow in English at 320px');
 assert.match(await page.locator('.continuous-runner-session').innerText(),/Round-based run/);
 assert.deepEqual(store.progress().totals,totals,'Language and viewport changes never write an attempt');
 await page.screenshot({path:resolve(root,'continuous-seventh-gate-paused-en-320.png'),fullPage:true});
 await page.reload();
 await page.getByText('Local AI ready',{exact:true}).waitFor();
 await page.getByRole('button',{name:'My progress',exact:true}).click();
 assert.deepEqual(store.progress().totals,totals,'Reload keeps points, XP, mistakes and attempt counts unchanged');
 assert.match(await page.locator('.runner-history-points').innerText(),/280/,'Saved arcade points remain visible after reload');
 const durable=await context.request.get(base+'/api/progress');
 assert.equal(durable.status(),200);
 assert.deepEqual((await durable.json()).totals,totals);
 assert.equal(aiCalls,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const report={passed:true,rounds,settledGates:6,lostResponseIdempotent:true,englishMobile320:true,missDurationMs:Math.round(missDuration),totals,aiCalls,errors};
 writeFileSync(resolve(root,'result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));console.log(root);
}finally{await browser?.close();await app.close();store.close();}
