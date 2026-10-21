import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {Store} from '../service/store.js';
import {GameService,makeGame,publicGame} from '../service/games.js';

// Real UI, game evaluator, transactions, attempt cache and rewards. The network
// fault occurs after SQLite commits, so a new key would act on a later question.
const root=resolve('test-results/classic-retry-'+Date.now());
mkdirSync(root,{recursive:true});
const store=new Store(resolve(root,'practice.sqlite'));
const bank={label:'Concordancia',hint:'Revisa el verbo.',explanation:'Con she, añade -s.',items:[
 ['My sister walk to school.','My sister walks to school.'],
 ['She walk to the library.','She walks to the library.'],
 ['Our teacher walk to class.','Our teacher walks to class.']
].map(([bad,good])=>({bad,good,original:'walk',replacement:'walks',category:'agreement',alternatives:[],alternateOrders:[]}))};
const analysis=store.saveAnalysis({key:'classic-retry',locale:'en-US',status:'issues',originalText:bank.items[0].bad,correctedText:bank.items[0].good,issues:[{category:'agreement',offset:10,length:4,original:'walk',replacement:'walks',sentence:bank.items[0].bad,explanation:bank.explanation}]});
let checks=0;
const games=new GameService(store,{check:async()=>{checks++;return {matches:[{message:'Not the confirmed correction.'}]};},chat:async()=>{throw Error('No AI is needed for these exact fixture answers.');}});
const server=await createServer({configFile:false,server:{host:'127.0.0.1',port:0}});
await server.listen();
const base=server.resolvedUrls.local[0],reports=[];
let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});
 async function scenario(mode,play,{wrongFirst=false,fault='transport',practice=bank}={}){
  const saved=store.createGame(makeGame(analysis.issues[0],practice,mode)),page=await browser.newPage({viewport:{width:1200,height:1000}}),requests=[],errors=[];
  let lost=false;
  page.setDefaultTimeout(6000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(game=>{window.classicGameFixture=game;},publicGame(saved));
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
   if(!path.endsWith('/attempt'))throw Error('Unexpected request '+path);
   requests.push(body);
   if(!lost&&fault==='validation'){
    lost=true;
    return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:{code:'ANSWER_REQUIRED',message:'Escribe una corrección antes de comprobarla.'}})});
   }
   const result=await games.attempt(saved.id,body);
   if(!lost){
    lost=true;
    if(fault==='server')return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{code:'INTERNAL_ERROR',message:'No se pudo completar la operación. Tus datos guardados siguen disponibles.'}})});
    return route.abort('failed');
   }
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(base+'tests/classic-retry-harness.html');
  await page.locator('.classic-game-arena').waitFor();
  const attemptCount=()=>Number(store.db.prepare('SELECT COUNT(*) n FROM attempts WHERE game_id=?').get(saved.id).n);
  async function recover(firstAction){
   await firstAction();await page.getByRole('alert').waitFor();
   assert.equal(attemptCount(),1,'The lost response followed a committed attempt');
   const retry=page.getByRole('button',{name:'Comprobar de nuevo',exact:true});
   // The baseline has no recovery action and permits submitting the stale question.
   if(await retry.count()){
    assert.equal(await page.locator('.repair-input input:enabled, .repair-input button:enabled, .tile-answer button:enabled, .tile-bank button:enabled, .center-actions button:enabled, .pairs-board button:enabled, .judge-options button:enabled, .game-assists button:enabled').count(),0,'Uncertain results block changed answers and help until recovery');
    await retry.click();
   }else await firstAction();
   await page.locator('.game-feedback').waitFor();
   assert.deepEqual(requests[1],requests[0],mode+': recovery resends the exact committed answer and key');
   assert.equal(attemptCount(),1,mode+': recovery records no extra attempt');
   assert.equal(await page.getByRole('alert').count(),0);
  }
  await play({page,saved,recover,attemptCount,requests});
  assert.equal(store.game(saved.id).completed,true,mode+': the recovered game remains playable');
  assert.equal(await page.locator('.victory-card').count(),1);
  assert.equal(JSON.parse(await page.locator('#classic-events').innerText()).progress,1,'Completion refreshes progress exactly once');
  assert.equal(Number(store.db.prepare('SELECT xp FROM completions WHERE game_id=?').get(saved.id).xp),20,'The recovery preserves the earned reward');
  assert.deepEqual(errors,[]);
  reports.push({mode,wrongFirst,fault,requests:requests.length,attempts:attemptCount(),xp:20,state:store.game(saved.id).state});
  await page.screenshot({path:resolve(root,mode+'-'+fault+(wrongFirst?'-wrong':'')+'.png'),fullPage:true});
  await page.close();
 }
 const playJudge=async({page,saved,recover,attemptCount})=>{
  const keep=()=>page.getByRole('button',{name:'Se queda: está bien',exact:true}).click();
  await recover(keep);
  assert.equal(store.game(saved.id).state.step,1,'A retry does not answer or skip the next question');
  assert.match(await page.locator('.game-feedback').innerText(),/ya estaba bien/);
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();
  assert.equal(await page.locator('.game-sentence').innerText(),saved.privateData.bank.items[1].bad);
  await page.getByRole('button',{name:'Necesita un cambio',exact:true}).click();
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();
  await keep();await page.locator('.victory-card').waitFor();
  assert.equal(attemptCount(),3);
 };
 await scenario('judge',playJudge);
 const serverPractice={...bank,items:bank.items.map(item=>({...item,bad:item.bad.replace('school.','work.'),good:item.good.replace('school.','work.')}))};
 await scenario('judge',playJudge,{fault:'server',practice:serverPractice});
 await scenario('pairs',async({page,saved,recover,attemptCount})=>{
  const left=page.locator('.pairs-board > div').nth(0),right=page.locator('.pairs-board > div').nth(1);
  const pair=async index=>{await left.getByRole('button',{name:bank.items[index].bad,exact:true}).click();await right.getByRole('button',{name:bank.items[index].good,exact:true}).click();};
  await recover(()=>pair(0));
  assert.deepEqual(store.game(saved.id).state.matched,[0]);
  assert.equal(await page.locator('.pairs-board .matched').count(),2,'Both recovered pair cards are visibly matched');
  assert.equal(await left.getByRole('button',{name:bank.items[0].bad,exact:true}).isDisabled(),true);
  await pair(1);await page.locator('.pairs-board .matched').nth(3).waitFor();
  await pair(2);await page.locator('.victory-card').waitFor();
  assert.equal(attemptCount(),3);
 });
 await scenario('repair',async({page,recover,attemptCount})=>{
  await page.locator('#repair-answer').fill(bank.items[0].good);
  await recover(()=>page.getByRole('button',{name:'Comprobar',exact:true}).click());
  assert.equal(attemptCount(),1);
 });
 await scenario('order',async({page,recover,attemptCount})=>{
  for(const text of ['My','sister','walks','to','school'])await page.locator('.tile-bank').getByRole('button',{name:text,exact:true}).click();
  await recover(()=>page.getByRole('button',{name:'Comprobar frase',exact:true}).click());
  assert.equal(attemptCount(),1);
 });
 // An acknowledged wrong answer unlocks editing and starts a fresh attempt.
 // Different exercise content avoids the one-reward-per-exercise protection.
 const wrongBank={...bank,items:[{...bank.items[0],bad:'Her sister walk to school.',good:'Her sister walks to school.'}]};
 bank.items=wrongBank.items;
 await scenario('repair',async({page,recover,attemptCount,requests})=>{
  await page.locator('#repair-answer').fill('walk');
  await recover(()=>page.getByRole('button',{name:'Comprobar',exact:true}).click());
  assert.equal(await page.locator('#repair-answer').isEnabled(),true,'The failed attempt is settled and can be corrected');
  await page.locator('#repair-answer').fill('walks');
  await page.getByRole('button',{name:'Comprobar',exact:true}).click();
  await page.locator('.victory-card').waitFor();
  assert.notEqual(requests[2].idempotencyKey,requests[0].idempotencyKey);
  assert.equal(attemptCount(),2);
 },{wrongFirst:true});
 const validationPractice={...bank,items:[{...bank.items[0],bad:'Her sister walk to work.',good:'Her sister walks to work.'}]};
 await scenario('repair',async({page,attemptCount,requests})=>{
  await page.locator('#repair-answer').fill('walk');
  await page.getByRole('button',{name:'Comprobar',exact:true}).click();
  await page.getByRole('alert').waitFor();
  assert.equal(attemptCount(),0,'An acknowledged validation failure commits no attempt');
  assert.equal(await page.getByRole('button',{name:'Comprobar de nuevo',exact:true}).count(),0,'A definite 400 rejection does not require ambiguous-result recovery');
  assert.equal(await page.locator('#repair-answer').isEnabled(),true,'A definite validation failure allows editing');
  await page.locator('#repair-answer').fill('walks');
  await page.getByRole('button',{name:'Comprobar',exact:true}).click();
  await page.locator('.victory-card').waitFor();
  assert.notEqual(requests[1].idempotencyKey,requests[0].idempotencyKey,'Editing after a definitive rejection creates a new attempt');
  assert.equal(attemptCount(),1);
 },{fault:'validation',practice:validationPractice});
 writeFileSync(resolve(root,'result.json'),JSON.stringify({reports,checks},null,2));
 console.log(JSON.stringify({ok:true,root,reports,checks},null,2));
}finally{await browser?.close();await server.close();store.close();}
