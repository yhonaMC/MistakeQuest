import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {Store} from '../service/store.js';
import {buildApp} from '../service/app.js';

// Real API, saved exercises and attempts, isolated from the learner's database.
const root=resolve('test-results/runner-variety-'+Date.now());mkdirSync(root,{recursive:true});
const database=resolve(root,'practice.sqlite'),store=new Store(database);
const examples=[
 ['tha','that',['I know tha you can swim.','She says tha it is cold.','We hope tha you can come.']],
 ['importan','important',['This is importan for my class.','Your work is importan to me.','Sleep is importan for us.']],
 ['continuos','continuous',['We practice the past continuos tense.','I study the past continuos tense.','Our teacher explains the past continuos tense.']]
];
for(const [original,replacement,sentences] of examples){
 const items=sentences.map(bad=>({bad,good:bad.replace(original,replacement),original,replacement,category:'spelling',targetOffset:bad.indexOf(original),targetLength:original.length,answers:[replacement],alternatives:[],alternateOrders:[]}));
 const issue=store.saveAnalysis({key:'runner-variety-'+original,locale:'en-US',status:'issues',originalText:items[0].bad,correctedText:items[0].good,issues:[{offset:items[0].targetOffset,length:original.length,original,replacement,category:'spelling',explanation:'Revisa cómo se escribe esta palabra.',sentence:items[0].bad}]}).issues[0];
 store.saveBank(issue.id,{validatorVersion:10,source:'verified',items,label:'Ortografía',explanation:'Revisa cómo se escribe esta palabra.',hint:'Mira las letras de la palabra.'},'qwen3:8b');
}
let aiCalls=0;
const engines={health:async()=>({ollama:true,languageTool:true,modelReady:true,models:[{name:'qwen3:8b',size:5200000000}]}),chat:async()=>{aiCalls++;throw Error('Los ejemplos guardados no necesitan una nueva generación.');},check:async()=>({matches:[]})};
const app=await buildApp({store,engines});let browser;
try{
 const base=await app.listen({host:'127.0.0.1',port:0});
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1360,height:1050},reducedMotion:'no-preference'}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.method()==='POST'&&request.url()===base+'/api/practice-rounds')requests.push(request.postDataJSON());});
 await page.goto(base);await page.getByText('IA local lista',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Mi progreso',exact:true}).click();await page.getByRole('button',{name:'Practicar',exact:true}).click();
 await page.locator('.mode-card').filter({has:page.getByRole('heading',{name:'Dos caminos',exact:true})}).click();
 const seen=[],issueIds=[];
 for(let round=1;round<=3;round++){
  const session=page.locator('.arcade-session');await session.waitFor();
  const id=await session.getAttribute('data-game-id'),stored=store.game(id);
  seen.push(stored.privateData.item.replacement);issueIds.push(stored.issueId);
  assert.equal(await session.getAttribute('data-round'),String(round));
  assert.equal(stored.state.learningRoundId,await session.getAttribute('data-round-id'),'Cada puerta pertenece al plan guardado');
  assert.equal(stored.state.learningRoundIndex,round-1);
  if(await page.locator('.runner-arcade').getAttribute('data-phase')==='ready')await page.locator('.runner-go').click();
  const lane=await page.locator('.runner-gate[data-option-id="1"]').getAttribute('data-lane');
  await page.locator('.runner-steering button').nth(Number(lane)).click();await page.locator('.runner-playfield').press('Space');
  await page.locator('.game-feedback.right').waitFor();
  assert.equal(store.progress().totals.completedGames,round);
  assert.equal(store.progress().totals.xp,round*20);
  if(round<3)await page.waitForFunction(previous=>document.querySelector('.arcade-session')?.dataset.gameId!==previous,id);
 }
 assert.equal(new Set(seen).size,3,'Cada puerta practica una palabra diferente de errores reales');
 assert.equal(new Set(issueIds).size,3);
 assert.equal(requests.length,1,'Las primeras tres puertas usan una única ronda de diez');
 await page.locator('.runner-pause').click();
 assert.equal(await page.locator('.arcade-next-round').count(),0);
 await page.screenshot({path:resolve(root,'three-different-words.png'),fullPage:true});
 const totals=store.progress().totals;
 await page.reload();await page.getByRole('button',{name:'Mi progreso',exact:true}).click();
 assert.deepEqual(store.progress().totals,totals,'La recarga conserva XP e intentos');
 assert.equal(aiCalls,0);assert.deepEqual(errors,[]);
 const report={passed:true,words:seen,completedGames:totals.completedGames,xp:totals.xp,aiCalls,errors};
 writeFileSync(resolve(root,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));console.log(root);
}finally{await browser?.close();await app.close();store.close();}
