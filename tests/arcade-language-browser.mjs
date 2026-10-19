import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {Store} from '../service/store.js';
import {buildApp} from '../service/app.js';

const root=resolve('test-results/arcade-language-'+Date.now());let base;
mkdirSync(root,{recursive:true});
const database=resolve(root,'data/mistakequest.sqlite'),store=new Store(database);
const sentences=[
 'I was working on past continuos tense with my teacher.',
 'We practice the past continuos tense every day.',
 'My class is learning the past continuos tense.'
];
const items=sentences.map(bad=>({bad,good:bad.replace('continuos','continuous'),original:'continuos',replacement:'continuous',category:'spelling',targetOffset:bad.indexOf('continuos'),targetLength:9,answers:['continuous'],alternatives:[],alternateOrders:[]}));
const issue=store.saveAnalysis({key:'screenshot-repair',locale:'en-US',status:'issues',originalText:items[0].bad,correctedText:items[0].good,issues:[{offset:items[0].targetOffset,length:9,original:'continuos',replacement:'continuous',category:'spelling',explanation:'El nombre del tiempo verbal es past continuous.',sentence:items[0].bad}]}).issues[0];
store.saveBank(issue.id,{validatorVersion:10,source:'verified',items,label:'Ortografía',explanation:'El nombre del tiempo verbal es past continuous.',hint:'Revisa el nombre del tiempo verbal.'},'qwen3:8b');
let aiCalls=0;
const engines={health:async()=>({ollama:true,languageTool:true,modelReady:true,models:[{name:'qwen3:8b',size:5200000000}]}),check:async()=>({matches:[{offset:0,length:1,rule:{id:'INVALID_TEST_ANSWER'}}]}),chat:async()=>{aiCalls++;throw Error('Las respuestas exactas de bancos guardados no necesitan IA.');}};
const app=await buildApp({store,engines});
let browser;
try{
 base=await app.listen({host:'127.0.0.1',port:0});
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'no-preference'}),page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(!request.url().startsWith(base))external.push(request.url());});
 await page.goto(base);await page.getByText('IA local lista',{exact:true}).waitFor();
 const setLanguage=value=>page.locator('header .interface-language-capsule').getByRole('button',{name:value==='en'?'English':'Español',exact:true}).click();
 assert.equal(await page.locator('html').getAttribute('lang'),'es');
 await page.getByRole('button',{name:'Mi progreso',exact:true}).click();
 await page.getByRole('button',{name:'Practicar',exact:true}).click();
 async function playArcade(mode){
   const seen=[];
   for(let round=1;round<=3;round++){
     const guided=mode==='radar',session=page.locator(guided?'.guided-radar-session':'.continuous-runner-session');
     await session.waitFor();
     assert.equal(await session.getAttribute('data-round'),String(round));
     const id=await session.getAttribute('data-game-id'),data=store.game(id).privateData;
     seen.push(data.item.good);
     assert.equal(await page.locator('.game-stage-3d,.game-effects').count(),0,'No hay esculturas ni celebraciones superpuestas');
     if(mode==='radar'){
       if(await page.locator('.radar-start').isVisible())await page.locator('.radar-start').click();
       if(round===1){
         const wrong=data.tokens.find(token=>token.offset+token.length<=data.item.targetOffset||token.offset>=data.item.targetOffset+data.item.targetLength);
         await page.locator(`.radar-target[data-token-id="${wrong.id}"]`).focus();await page.keyboard.press('Enter');
         await page.locator('.guided-radar-feedback.is-retry').waitFor();
         assert.equal(await page.locator('.guided-radar-hint').getAttribute('data-hint-level'),'1');
         assert.equal(await page.locator('.radar-attempts').getAttribute('data-attempts-remaining'),'2');
       }
       const target=data.tokens.find(token=>token.offset<data.item.targetOffset+data.item.targetLength&&token.offset+token.length>data.item.targetOffset);
       if(round===1){
         let dropped=false;const keys=[];
         await page.route(`**/api/games/${id}/attempt`,async route=>{
           keys.push(route.request().postDataJSON().idempotencyKey);
           if(!dropped){dropped=true;const saved=await route.fetch();assert.equal(saved.status(),200);await route.abort('failed');}
           else await route.continue();
         });
         await page.locator(`.radar-target[data-token-id="${target.id}"]`).focus();await page.keyboard.press('Enter');
         await page.locator('.guided-radar-error').waitFor();
         assert.equal(await page.locator('.radar-target.is-retry').count(),0,'Un fallo de conexión no marca una palabra como incorrecta');
         const earnedBeforeRetry=store.progress().totals.xp;
         await page.locator('.guided-radar-retry').click();
         await page.locator('.guided-radar-feedback.is-correct').waitFor();
         assert.equal(keys.length,2);assert.equal(keys[0],keys[1],'Reintentar conserva la clave del intento cuya respuesta se perdió');
         assert.equal(store.progress().totals.xp,earnedBeforeRetry,'Reintentar una respuesta ya guardada no vuelve a sumar XP');
       }else{
       await page.locator(`.radar-target[data-token-id="${target.id}"]`).focus();await page.keyboard.press('Enter');
       }
     }else{
       const start=async()=>{if(await page.locator('.runner-arcade').getAttribute('data-phase')==='ready')await page.locator('.runner-go').click();};
       await start();
       const attempts=store.progress().totals.attempts;
       const lane=await page.locator('.runner-gate[data-option-id="1"]').getAttribute('data-lane');
       await page.locator('.runner-steering button').nth(Number(lane)).click();
       assert.equal(store.progress().totals.attempts,attempts,'Cambiar de carril no responde por sí solo');
       assert.equal(await page.locator('.runner-player').getAttribute('data-lane'),lane);
       await page.locator('.runner-playfield').press('Space');
     }
     await page.locator(guided?'.guided-radar-feedback.is-correct':'.continuous-runner-session .game-feedback.right').waitFor();
     assert.equal(await page.locator(guided?'.guided-radar-correction':'.continuous-runner-session .game-feedback p[lang="en"]').innerText(),data.item.good);
     await page.screenshot({path:resolve(root,mode+'-round-'+round+'.png'),fullPage:true});
     if(round<3)await page.waitForFunction(({previous,guided})=>document.querySelector(guided?'.guided-radar-session':'.continuous-runner-session')?.dataset.gameId!==previous,{previous:id,guided});
   }
   assert.equal(new Set(seen).size,3,'Las tres rondas rotan frases verificadas distintas');
   if(mode==='radar'){
    await page.locator('.guided-radar-summary').waitFor();
    assert.equal(await page.locator('.guided-radar-session').getAttribute('data-completed'),'true');
    assert.equal(await page.locator('.guided-radar-summary').getAttribute('data-correct'),'2');
    assert.equal(await page.locator('.guided-radar-summary').getAttribute('data-assisted'),'1');
   }else assert.equal(await page.locator('.arcade-next-round').count(),0,'La carrera no necesita pulsar siguiente ronda');
   await page.getByRole('button',{name:'Elegir otro minijuego',exact:true}).click();
 }
 const modes=[['repair','Taller de palabras'],['radar','Radar de errores'],['choice','Dos caminos'],['order','Arma la frase'],['pairs','Conecta parejas'],['judge','¿Se queda o se corrige?']];
 for(const [mode,title]of modes){
   const roundMode=['radar','choice'].includes(mode),path=roundMode?'/api/practice-rounds':'/api/games';
   const received=page.waitForResponse(response=>response.url()===base+path&&response.request().method()==='POST');
   await page.locator('.mode-card').filter({has:page.getByRole('heading',{name:title,exact:true})}).click();
   const response=await received;assert.equal(response.status(),200);const payload=await response.json(),game=roundMode?payload.game:payload,data=store.game(game.id).privateData;
   if(roundMode)assert.equal(payload.total,mode==='choice'?10:3);
   assert.equal(await page.locator('.game-stage-3d').count(),0,'La partida no incluye una plataforma ni escultura 3D');
   if(['radar','choice'].includes(mode)){await playArcade(mode);continue;}
   if(mode==='repair'){
     assert.equal(data.item.bad,items[0].bad,'El primer taller reproduce la captura del usuario');
     await page.locator('#repair-answer').fill(data.item.good);
     await setLanguage('en');
     assert.equal(await page.locator('html').getAttribute('lang'),'en');
     assert.equal(await page.locator('#repair-answer').inputValue(),data.item.good,'Cambiar idioma conserva la respuesta escrita');
     assert.match(await page.locator('.arcade-hud').innerText(),/workshop/i);
     assert.ok(!/Tu misión|Taller de palabras/.test(await page.locator('.arcade-hud').innerText()));
     const sent=page.waitForResponse(r=>r.url().endsWith('/attempt'));
     await page.locator('.repair-input button').click();
     const result=await(await sent).json();assert.equal(result.correct,true);assert.equal(result.completed,true);assert.equal(result.xpEarned,20);assert.equal(result.correctedSentence,data.item.good);
     await page.locator('.victory-card').waitFor();
     assert.equal(await page.locator('.game-effects').count(),0,'Los efectos decorativos se han retirado de Taller');
     await page.getByRole('button',{name:'Pause animations',exact:true}).click();
     assert.equal(await page.locator('.app').getAttribute('data-motion'),'off');
     await page.getByRole('button',{name:'Enable animations',exact:true}).click();
     assert.match(await page.locator('.victory-card').innerText(),/solved|complete/i);
     await page.screenshot({path:resolve(root,'repair-success-english.png'),fullPage:true});
     const progressBefore=store.progress().totals;
     await setLanguage('es');assert.deepEqual(store.progress().totals,progressBefore);
     await page.getByRole('button',{name:'Elegir otro minijuego',exact:true}).click();
     continue;
   }
   if(mode==='choice')await page.getByRole('button',{name:data.item.replacement,exact:true}).click();
   if(mode==='radar'){const token=data.tokens.find(t=>t.offset<data.item.targetOffset+data.item.targetLength&&t.offset+t.length>data.item.targetOffset);await page.locator('.radar-sentence button').nth(token.id).click();}
   if(mode==='order'){for(const token of data.wordBank){const candidates=await page.locator('.tile-bank button').all();for(const candidate of candidates)if(await candidate.isEnabled()&&(await candidate.innerText())===token.text){await candidate.click();break;}}await page.getByRole('button',{name:'Comprobar frase',exact:true}).click();}
   if(mode==='pairs'){for(const item of game.left){await page.locator('.pairs-board>div').nth(0).getByRole('button',{name:item.text,exact:true}).click();const corrected=game.right.find(r=>r.id===item.id);await page.locator('.pairs-board>div').nth(1).getByRole('button',{name:corrected.text,exact:true}).click();await page.locator('.pairs-board>div').nth(0).locator('button.matched').filter({hasText:item.text}).waitFor();}}
   if(mode==='judge'){for(let i=0;i<data.judges.length;i++){await page.getByRole('button',{name:data.judges[i].needsChange?'Necesita un cambio':'Se queda: está bien',exact:true}).click();if(i<data.judges.length-1)await page.getByRole('button',{name:'Siguiente',exact:true}).click();}}
   await page.locator('.victory-card').waitFor();
   assert.equal(await page.locator('.game-stage-3d').count(),0);
   await page.screenshot({path:resolve(root,mode+'-success.png'),fullPage:true});
   await page.getByRole('button',{name:'Elegir otro minijuego',exact:true}).click();
 }
 const totals=store.progress().totals;assert.equal(totals.completedGames,10);assert.equal(totals.xp,190);assert.equal(totals.mistakes,1);assert.equal(totals.arcadePoints,300);assert.equal(aiCalls,0);
 await setLanguage('en');await page.reload();
 assert.equal(await page.locator('html').getAttribute('lang'),'en');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.locator('#locale').waitFor();assert.equal(await page.locator('#locale').inputValue(),'en-US','El idioma de interfaz no cambia la variante del inglés');
 assert.match(await page.locator('.settings-page').innerText(),/Local engines|local engines/);
 for(const width of [390,320]){
   await page.setViewportSize({width,height:1000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Sin desborde horizontal en EN a '+width);
   await page.screenshot({path:resolve(root,'settings-en-'+width+'.png'),fullPage:true});
 }
 await setLanguage('es');await page.setViewportSize({width:1440,height:1100});
 await page.getByRole('button',{name:'Mi progreso',exact:true}).click();await page.getByRole('button',{name:'Practicar',exact:true}).click();
 await page.locator('.mode-card').filter({has:page.getByRole('heading',{name:'Taller de palabras',exact:true})}).click();
 await page.locator('#repair-answer').waitFor();
 assert.equal(await page.locator('.game-stage-3d').count(),0);
 await page.getByRole('button',{name:'Pausar animaciones',exact:true}).click();
 assert.equal(await page.locator('.app').getAttribute('data-motion'),'off');
 for(const width of [390,320]){
   await page.setViewportSize({width,height:1000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Sin desborde horizontal en partida ES a '+width);
   assert.equal(await page.locator('.arcade-hud').evaluate(element=>{
     const rects=['.hud-mode','.hud-progress','.hud-streak'].map(selector=>element.querySelector(selector).getBoundingClientRect());
     return rects.some((a,i)=>rects.slice(i+1).some(b=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1));
   }),false,'El título, progreso y racha no se superponen a '+width);
   await page.screenshot({path:resolve(root,'repair-es-'+width+'.png'),fullPage:true});
 }
 await setLanguage('en');
 assert.equal(await page.locator('.arcade-hud').evaluate(element=>{
   const title=element.querySelector('.hud-mode').getBoundingClientRect(),progress=element.querySelector('.hud-progress').getBoundingClientRect();
   return Math.min(title.right,progress.right)>Math.max(title.left,progress.left)+1&&Math.min(title.bottom,progress.bottom)>Math.max(title.top,progress.top)+1;
 }),false,'El marcador inglés tampoco se superpone en móvil');
 await page.reload();assert.deepEqual(store.progress().totals,totals,'El progreso sobrevive a la recarga');
 await page.getByRole('button',{name:'Enable animations',exact:true}).waitFor();
 await page.getByRole('button',{name:'My progress',exact:true}).click();await page.getByRole('button',{name:'Practice',exact:true}).click();
 for(const [mode,title]of [['radar','Error radar'],['choice','Two paths']]){
   await page.locator('.mode-card').filter({has:page.getByRole('heading',{name:title,exact:true})}).click();
   if(mode==='radar'){await page.locator('.radar-start').click();await page.locator('.radar-pause').click();}else{await page.locator('.runner-go').click();await page.locator('.runner-pause').click();}
   for(const width of [390,320]){
     await page.setViewportSize({width,height:1000});
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Arcade EN sin desborde a '+width);
     assert.equal(await page.locator(mode==='radar'?'.guided-radar-hud':'.arcade-hud').evaluate((element,guided)=>{
       const rects=guided?[...element.children].map(child=>child.getBoundingClientRect()):['.hud-mode','.hud-progress','.session-score,.runner-session-score'].map(selector=>element.querySelector(selector).getBoundingClientRect());
       return rects.some((a,i)=>rects.slice(i+1).some(b=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1));
     },mode==='radar'),false,'El marcador arcade no se superpone a '+width);
     await page.screenshot({path:resolve(root,mode+'-en-'+width+'.png'),fullPage:true});
   }
   await page.getByRole('button',{name:'Leave game',exact:true}).click();
 }
 assert.deepEqual(store.progress().totals,totals,'Abrir los modos y dejarlos en pausa no inventa respuestas ni XP');
 const fallback=await context.newPage();
 await fallback.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /^webgl/.test(type)?null:original.call(this,type,...args);};});
 await fallback.goto(base);await fallback.getByRole('button',{name:'My progress',exact:true}).click();await fallback.getByRole('button',{name:'Practice',exact:true}).click();
 await fallback.locator('.mode-card').filter({has:fallback.getByRole('heading',{name:'Word workshop',exact:true})}).click();
 await fallback.locator('#repair-answer').waitFor();
 assert.equal(await fallback.locator('.game-stage-3d').count(),0);
 assert.equal(await fallback.locator('#repair-answer').isEnabled(),true,'Se puede jugar sin WebGL');
 await fallback.close();
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const report={passed:true,modes:modes.map(([id])=>id),arcadeRounds:6,guidedRadar:true,radarLostReplyIdempotent:true,repairFullSentence:true,noGameStage:true,noDecorativeEffects:true,interfaceLanguagePersistence:true,progressPreserved:true,totals,aiCalls,errors,external};
 writeFileSync(resolve(root,'result.json'),JSON.stringify(report,null,2));
 console.log('Radar guiado de tres frases, primeras tres puertas de la ronda runner, cuatro juegos clásicos, ES/EN, progreso y móvil: OK');console.log(root);
}finally{await browser?.close();await app.close();store.close();}
