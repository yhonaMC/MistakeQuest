import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {appendFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {grammarArcadeFixture as fixture} from './live-arcade-fixtures.js';

// Opt-in real-engine integration. Only synthetic text is used, with a fresh
// database and an ephemeral service port; no learner data or seeded banks.
const root=resolve('test-results/live-classic-grammar-'+Date.now());
mkdirSync(root,{recursive:true});process.env.MQ_DATA_DIR=root;
const [{Store},{Engines},{buildApp}]=await Promise.all([
 import('../service/store.js'),import('../service/engines.js'),import('../service/app.js')
]);
const database=resolve(root,'practice.sqlite'),tables=['analyses','issues','banks','games','attempts','completions','rewards','practice_rounds'];
const modeNames={repair:'Taller de palabras',order:'Arma la frase',pairs:'Conecta parejas',judge:'¿Se queda o se corrige?'};
const report={passed:false,scenario:'long-grammar-four-classic-modes',root,database,sourceText:fixture.sourceText,engineCalls:[],browserErrors:[],externalBrowserRequests:[],apiFailures:[],attempts:[],preparedBanks:[],playedGames:[],replays:[],restarts:[]};
let phase='startup',store,app,browser,context,page,base,pendingRestartDone=false;
function log(message){const line=new Date().toISOString()+' '+message;console.log(line);appendFileSync(resolve(root,'run.log'),line+'\n');}
function instrumentEngines(){
 const engines=new Engines();
 for(const name of ['check','chat']){
  const actual=engines[name].bind(engines);
  engines[name]=async(...args)=>{
   const entry={method:name,phase,startedAt:new Date().toISOString(),...(name==='check'?{text:args[0]}:{prompt:args[1].slice(0,140),input:args[2]})},started=performance.now();report.engineCalls.push(entry);
   try{const value=await actual(...args);entry.ok=true;entry.timing=value.timing;entry.resultCount=name==='check'?value.matches?.length:value.value?.items?.length??value.value?.frames?.length??value.value?.issues?.length??value.value?.decisions?.length;if(name==='chat'&&phase==='prepare-banks')entry.result=value.value;return value;}
   catch(error){entry.ok=false;entry.error=error.message;throw error;}
   finally{entry.durationMs=Math.round(performance.now()-started);}
  };
 }
 return engines;
}
const count=name=>Number(store.db.prepare('SELECT COUNT(*) n FROM '+name).get().n);
async function responseJson(response,label){const raw=await response.text();assert.equal(response.status(),200,label+': '+raw);return JSON.parse(raw);}
const get=async path=>responseJson(await context.request.get(base+'/api'+path,{timeout:180000}),path);
const post=async(path,data)=>responseJson(await context.request.post(base+'/api'+path,{headers:{'x-mistakequest':'1'},data,timeout:180000}),path);
const postResponse=path=>page.waitForResponse(response=>response.url()===base+'/api'+path&&response.request().method()==='POST',{timeout:180000});
const wordList=text=>text.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)||[];
const provenance=item=>({newPractice:!Object.hasOwn(item,'sourceOffset'),derived:item.origin==='derived_context',generated:!Object.hasOwn(item,'sourceOffset')&&!item.origin,...item.origin?{origin:item.origin}:{}});
function compactCorrection(original,replacement){
 const before=original.trim().replace(/[.!?]+$/,'').split(/\s+/),after=replacement.trim().replace(/[.!?]+$/,'').split(/\s+/);
 while(before.length>1&&after.length>1&&before[0]===after[0]){before.shift();after.shift();}
 while(before.length>1&&after.length>1&&before.at(-1)===after.at(-1)){before.pop();after.pop();}
 return [before.join(' '),after.join(' ')];
}
function assertItem(issue,item){
 const expected=report.selectedCorrections.find(correction=>correction.issueId===issue.id);
 assert.ok(expected,'Every classic exercise uses an actual selected review correction');
 assert.deepEqual(compactCorrection(issue.original,issue.replacement),[expected.original,expected.replacement],'The saved review retains its actual grammar correction');
 assert.deepEqual(compactCorrection(item.original,item.replacement),[expected.original,expected.replacement],'The exercise retains the complete source correction');
 assert.equal(item.category||issue.category,expected.category);
 assert.equal(item.bad.slice(item.targetOffset,item.targetOffset+item.targetLength),item.original);
 assert.equal(item.bad.slice(0,item.targetOffset)+item.replacement+item.bad.slice(item.targetOffset+item.targetLength),item.good,'Only the reviewed correction creates the good sentence');
 assert.ok(store.getBank(issue.id).items.some(candidate=>candidate.bad===item.bad&&candidate.good===item.good),'Every sentence belongs to the real verified bank');
 if(Object.hasOwn(item,'sourceOffset')){const relative=item.sourceOffset-issue.offset;assert.ok(relative>=0&&relative+item.sourceLength<=issue.length);assert.equal(issue.original.slice(relative,relative+item.sourceLength),item.original,'Source offsets stay aligned with the real review');}
 if(expected.category==='word_order'){assert.deepEqual(wordList(item.original).sort(),wordList(item.replacement).sort(),'Word-order practice moves the existing words without inventing or deleting a verb');assert.ok(wordList(item.original).length>1);}
}
function align(game){
 assert.ok(game,'The visible game is saved');const issue=store.issue(game.issueId);assertItem(issue,game.privateData.item);
 for(const item of game.privateData.bank.items)assertItem(issue,item);
 return game.privateData.item;
}
function assertTotals(){
 const totals={reviews:1,correctReviews:0,detections:report.sourcePairs.length,attempts:report.attempts.length,mistakes:report.attempts.filter(attempt=>!attempt.correct).length,completedGames:report.attempts.filter(attempt=>attempt.completed).length,xp:report.attempts.reduce((sum,attempt)=>sum+attempt.xpEarned,0),arcadePoints:0};
 assert.deepEqual(store.progress().totals,totals,'All visible attempts and rewards match durable progress');return totals;
}
function expectedXp(game,correct,completed){return !correct||!completed||store.db.prepare('SELECT 1 FROM rewards WHERE exercise_key=?').get(game.exerciseKey)?0:game.state.help==='reveal'?5:game.state.help==='hint'?10:20;}
async function attempt(game,action,{correct,completed,label}){
 const current=store.game(game.id),xp=expectedXp(current,correct,completed),received=postResponse('/games/'+game.id+'/attempt');await action();const response=await received,result=await responseJson(response,label),body=response.request().postDataJSON();
 assert.equal(result.correct,correct,label+' correctness');assert.equal(result.completed,completed,label+' completion');assert.equal(result.xpEarned,xp,label+' XP');assert.equal(store.game(game.id).completed,completed);
 report.attempts.push({gameId:game.id,issueId:game.issueId,mode:game.mode,category:store.issue(game.issueId).category,label,answer:body,correct:result.correct,completed:result.completed,xpEarned:result.xpEarned,help:result.help,correctedSentence:result.correctedSentence});assert.deepEqual(result.totals,assertTotals());
 await page.locator('.game-feedback.'+(correct?'right':'retry')).waitFor();
 if(correct&&result.correctedSentence){await page.waitForFunction(text=>document.querySelector('.game-feedback p[lang="en"]')?.textContent===text,result.correctedSentence);assert.equal(await page.locator('.game-feedback p[lang="en"]').innerText(),result.correctedSentence,'The learner sees the accepted corrected sentence');}
 return {result,body};
}
async function replay(game,record,{completed=false}={}){
 const before=store.export(),result=await post('/games/'+game.id+'/attempt',record.body);
 for(const key of ['correct','completed','xpEarned','correctedSentence'])assert.deepEqual(result[key],record.result[key],'Replaying an identical request returns the saved '+key);
 assert.deepEqual(store.export().tables,before.tables,'Idempotent replay creates no second attempt, completion, or reward');
 if(completed){const settled=await post('/games/'+game.id+'/attempt',{...record.body,idempotencyKey:randomUUID()});assert.equal(settled.alreadyCompleted,true);assert.equal(settled.xpEarned,0);assert.deepEqual(store.export().tables,before.tables,'A completed game cannot mint another reward or attempt');}
 report.replays.push({gameId:game.id,mode:game.mode,sameKeyPreserved:true,...completed?{newKeyAfterCompletionEarnedZero:true}:{}});
}
async function assist(kind){const received=postResponse('/games/'+activeGame.id+'/'+kind);await page.getByRole('button',{name:kind==='hint'?'Pedir pista':'Ver solución',exact:true}).click();const result=await responseJson(await received,'Classic '+kind);assert.equal(result.help,kind);assert.ok(result.message.trim());await page.locator('.help-box').waitFor();return result;}
let activeGame;
async function selectIssue(issue){
 if(await page.locator('.classic-game-arena').count())await page.getByRole('button',{name:'Salir de la partida',exact:true}).click();
 if(await page.locator('.back-button').count())await page.locator('.back-button').click();
 await page.locator('.correction-row').filter({has:page.getByText(issue.original,{exact:true})}).getByRole('button',{name:'Practicar este error',exact:true}).click();
 assert.equal(await page.locator('.practice-source del').innerText(),issue.original);assert.equal(await page.locator('.practice-source ins').innerText(),issue.replacement);
}
const previousSentences=new Map();
async function openMode(issue,mode){
 const received=postResponse('/games');await page.locator('.mode-card').filter({has:page.getByRole('heading',{name:modeNames[mode],exact:true})}).click();const publicData=await responseJson(await received,'Open '+mode),game=store.game(publicData.id),item=align(game);
 assert.equal(game.issueId,issue.id);assert.equal(game.mode,mode);assert.equal(publicData.issueId,issue.id);assert.equal(publicData.privateData,undefined);await page.locator('.classic-game-arena.mode-'+mode).waitFor();
 const previous=previousSentences.get(issue.id);if(previous&&['repair','order'].includes(mode))assert.notEqual(item.good,previous,'A new single-sentence classic game rotates to another verified sentence');previousSentences.set(issue.id,item.good);
 const visibleItems=mode==='pairs'?game.privateData.bank.items:mode==='judge'?game.privateData.judges.map(question=>game.privateData.bank.items.find(item=>item.good===question.good)):[item];
 report.playedGames.push({gameId:game.id,issueId:issue.id,mode,category:issue.category,original:item.original,replacement:item.replacement,bad:item.bad,good:item.good,visibleItems:visibleItems.map(item=>({bad:item.bad,good:item.good,...provenance(item)}))});activeGame=game;return {game,publicData,item};
}
async function repair(game,publicData,item,index){
 assert.equal(publicData.text,item.bad);assert.equal(publicData.target.text,item.original);assert.equal(await page.locator('.game-sentence').innerText(),item.bad);assert.equal(await page.locator('.game-sentence mark').innerText(),item.original);
 const input=page.locator('#repair-answer');await input.fill(item.original);const wrong=await attempt(game,()=>page.getByRole('button',{name:'Comprobar',exact:true}).click(),{correct:false,completed:false,label:'Original repair stays wrong'});await replay(game,wrong);
 if(index===0)await assist('hint');
 const submitted=index===1?item.replacement:item.good;await input.fill(submitted);const solved=await attempt(game,()=>page.getByRole('button',{name:'Comprobar',exact:true}).click(),{correct:true,completed:true,label:index===1?'Exact corrected fragment':'Full corrected sentence'});
 assert.equal(solved.result.correctedSentence,item.good,'Full-sentence repair never duplicates surrounding context');await replay(game,solved,{completed:true});
}
function idsForWords(game,desired){const remaining=[...game.privateData.wordBank],ids=[];for(const text of desired){const index=remaining.findIndex(token=>token.text===text);assert.notEqual(index,-1,'The desired phrase uses exactly the public tiles');ids.push(remaining.splice(index,1)[0].id);}assert.equal(remaining.length,0);return ids;}
async function fillTiles(publicData,ids){
 for(const id of ids){const index=publicData.wordBank.findIndex(token=>token.id===id);assert.notEqual(index,-1);const button=page.locator('.tile-bank button').nth(index);assert.equal(await button.innerText(),publicData.wordBank[index].text);assert.equal(await button.isEnabled(),true);await button.click();}
}
async function order(game,publicData,item,index){
 assert.deepEqual(publicData.wordBank.map(token=>[token.id,token.text]).sort((a,b)=>a[0]-b[0]),game.privateData.wordBank.map(token=>[token.id,token.text]));assert.deepEqual(game.privateData.wordBank.map(token=>token.text),wordList(item.good));
 const correctIds=game.privateData.wordBank.map(token=>token.id),wrongIds=index===0?idsForWords(game,wordList(item.bad)):[...correctIds].reverse();assert.notDeepEqual(wrongIds,correctIds);
 await fillTiles(publicData,wrongIds);const wrong=await attempt(game,()=>page.getByRole('button',{name:'Comprobar frase',exact:true}).click(),{correct:false,completed:false,label:index===0?'Unchanged original word order stays wrong':'Clearly invalid reversed tiles'});await replay(game,wrong);
 await page.getByRole('button',{name:'Reiniciar fichas',exact:true}).click();assert.equal(await page.locator('.tile-answer button').count(),0);if(index===1)await assist('reveal');
 await fillTiles(publicData,correctIds);assert.deepEqual(await page.locator('.tile-answer button').allTextContents(),game.privateData.wordBank.map(token=>token.text));const solved=await attempt(game,()=>page.getByRole('button',{name:'Comprobar frase',exact:true}).click(),{correct:true,completed:true,label:'Correct tile order'});assert.equal(solved.result.correctedSentence,item.good);await replay(game,solved,{completed:true});
}
async function judge(game,publicData,index){
 assert.equal(game.privateData.judges.length,3);assert.ok(game.privateData.judges.some(question=>question.needsChange));assert.ok(game.privateData.judges.some(question=>!question.needsChange));
 for(let step=0;step<game.privateData.judges.length;step++){
  const question=game.privateData.judges[step];assert.equal(await page.locator('.game-sentence').innerText(),question.text);assert.equal(store.game(game.id).state.step,step);
  if(step===0){const wrong=await attempt(game,()=>page.getByRole('button',{name:question.needsChange?'Se queda: está bien':'Necesita un cambio',exact:true}).click(),{correct:false,completed:false,label:'Incorrect judge decision'});assert.equal(store.game(game.id).state.step,0);assert.equal(await page.getByRole('button',{name:'Siguiente',exact:true}).count(),0);await replay(game,wrong);if(index===2)await assist('hint');}
  const completed=step===game.privateData.judges.length-1,solved=await attempt(game,()=>page.getByRole('button',{name:question.needsChange?'Necesita un cambio':'Se queda: está bien',exact:true}).click(),{correct:true,completed,label:question.needsChange?'Judge repairs actual error':'Judge preserves correct English'});assert.equal(solved.result.correctedSentence,question.good);assert.equal(store.game(game.id).state.step,step+1);
  if(!completed){assert.equal(solved.result.nextQuestion.text,game.privateData.judges[step+1].text);await page.getByRole('button',{name:'Siguiente',exact:true}).click();}else await replay(game,solved,{completed:true});
 }
}
async function restart(label,{reload=false}={}){
 const beforeExport=await get('/export'),beforeProgress=await get('/progress');assert.deepEqual(beforeExport.progress,beforeProgress);assert.deepEqual(beforeProgress.totals,assertTotals());const port=Number(new URL(base).port);log(label+': closing and reopening owned service and SQLite');
 await app.close();app=null;store.close();store=null;store=new Store(database);app=await buildApp({store,engines:instrumentEngines()});assert.equal(await app.listen({host:'127.0.0.1',port}),base);
 const afterExport=await get('/export'),afterProgress=await get('/progress');assert.deepEqual(afterProgress,beforeProgress,'Progress survives actual service/SQLite restart');assert.deepEqual(afterExport.tables,beforeExport.tables,'Exact saved games, answers, states and rewards survive restart');assert.deepEqual(afterExport.settings,beforeExport.settings);
 if(reload){await page.reload();await page.getByText('IA local lista',{exact:true}).waitFor();await page.getByRole('button',{name:'Mi progreso',exact:true}).click();await page.getByRole('heading',{name:'Tus errores más frecuentes',exact:true}).waitFor();assert.deepEqual((await get('/progress')).totals,beforeProgress.totals);}
 report.restarts.push({label,exactTablesPreserved:true,exactProgressPreserved:true,browserReload:reload});return beforeExport;
}
async function pairs(game,publicData,item,index){
 assert.equal(publicData.left.length,3);assert.equal(publicData.right.length,3);assert.equal(new Set(publicData.right.map(value=>value.text)).size,3);assert.deepEqual(publicData.left.map(value=>value.text),game.privateData.bank.items.map(value=>value.bad));assert.deepEqual(await page.locator('.pairs-board>div').nth(0).locator('button').allTextContents(),publicData.left.map(value=>value.text));assert.deepEqual(await page.locator('.pairs-board>div').nth(1).locator('button').allTextContents(),publicData.right.map(value=>value.text));
 const left=page.locator('.pairs-board>div').nth(0),right=page.locator('.pairs-board>div').nth(1),first=publicData.left[0],wrongRight=publicData.right.find(value=>value.id!==first.id);
 await left.getByRole('button',{name:first.text,exact:true}).click();const wrong=await attempt(game,()=>right.getByRole('button',{name:wrongRight.text,exact:true}).click(),{correct:false,completed:false,label:'Mismatched pair'});assert.deepEqual(store.game(game.id).state.matched,[]);await replay(game,wrong);
 for(let step=0;step<publicData.left.length;step++){
  const value=publicData.left[step],answer=publicData.right.find(candidate=>candidate.id===value.id);await left.getByRole('button',{name:value.text,exact:true}).click();const completed=step===publicData.left.length-1,solved=await attempt(game,()=>right.getByRole('button',{name:answer.text,exact:true}).click(),{correct:true,completed,label:'Correct pair '+(step+1)});assert.equal(solved.result.correctedSentence,game.privateData.bank.items[value.id].good);assert.deepEqual(store.game(game.id).state.matched,publicData.left.slice(0,step+1).map(value=>value.id));await left.locator('button.matched').nth(step).waitFor();assert.equal(await left.getByRole('button',{name:value.text,exact:true}).isDisabled(),true);
  if(step===0){await replay(game,solved);if(index===2){phase='pending-pairs-restart';await page.screenshot({path:resolve(root,'pending-pairs.png'),fullPage:true});const pending=store.game(game.id),before=await restart('Partial pairs persisted');const restored=await get('/games/'+game.id);assert.equal(restored.id,game.id);assert.deepEqual(restored.matched,pending.state.matched);assert.equal(restored.completed,false);assert.deepEqual(restored.progress,{current:1,total:3});assert.deepEqual(store.game(game.id),pending);assert.deepEqual((await get('/export')).tables,before.tables);assert.equal(await left.locator('button.matched').count(),1);pendingRestartDone=true;report.pendingPair={gameId:game.id,matchedAfterRestart:restored.matched,publicStateRestored:true,openBrowserContinued:true,browserReload:false};phase='play-pairs-verb_form';log('Partial pair survived restart; continuing remaining matches through the open UI');}}
  if(completed)await replay(game,solved,{completed:true});
 }
}
try{
 store=new Store(database);for(const table of tables)assert.equal(count(table),0,'Isolated '+table+' starts empty');assert.equal(store.settings().model,'qwen3:8b');
 const engines=instrumentEngines(),health=await engines.health('qwen3:8b');assert.ok(health.ollama&&health.languageTool&&health.modelReady,'Real local engines must be ready');report.health=health;
 report.frontend=readFileSync(resolve('dist/index.html'),'utf8').match(/src="([^\"]+\.js)"/)?.[1];app=await buildApp({store,engines});base=await app.listen({host:'127.0.0.1',port:0});report.base=base;assert.notEqual(new URL(base).port,'3210');
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'});page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(15000);
 page.on('pageerror',error=>report.browserErrors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(base))report.externalBrowserRequests.push(request.url());});page.on('response',response=>{if(response.url().startsWith(base+'/api/')&&response.status()>=400)report.apiFailures.push({url:response.url(),status:response.status()});});
 await page.goto(base);await page.getByText('IA local lista',{exact:true}).waitFor();phase='review';log('Real UI review started: '+fixture.sourceText.split(/\s+/).length+' synthetic words');await page.getByLabel('Tu espacio para escribir').fill(fixture.sourceText);const received=postResponse('/analyze');await page.getByRole('button',{name:'Revisar mi texto',exact:true}).click();const review=await responseJson(await received,'Real long grammar review');
 assert.equal(review.status,'issues');assert.equal(review.originalText,fixture.sourceText);report.correctedText=review.correctedText;report.sourcePairs=review.issues.map(({id,offset,length,sentence,original,replacement,category})=>({id,offset,length,sentence,original,replacement,category}));assert.equal(review.issues.length,14);assert.equal(review.correctedText.replaceAll('does not',"doesn't"),fixture.correctedText);for(const sentence of fixture.preservedSentences)assert.ok(review.correctedText.includes(sentence),'Correct simple English stays unchanged');assert.equal(await page.getByLabel('Tu espacio para escribir').inputValue(),fixture.sourceText);
 const selected=fixture.selected.map(expected=>{const issue=review.issues.find(issue=>issue.category===expected.category&&issue.sentence===expected.sentence&&JSON.stringify(compactCorrection(issue.original,issue.replacement))===JSON.stringify([expected.original,expected.replacement]));assert.ok(issue,'The actual review includes '+expected.category);return issue;});report.selectedCorrections=selected.map((issue,index)=>({issueId:issue.id,...fixture.selected[index]}));await page.screenshot({path:resolve(root,'review.png'),fullPage:true});log('Real review complete: '+JSON.stringify(report.sourcePairs.map(({original,replacement})=>[original,replacement])));
 phase='prepare-banks';for(const issue of selected){log('Preparing real verified bank: '+issue.original+' → '+issue.replacement);const before=report.engineCalls.length,prepared=await post('/games',{issueId:issue.id,mode:'repair'}),game=store.game(prepared.id),bank=store.getBank(issue.id);report.preparedBanks.push({issueId:issue.id,gameId:game?.id,source:bank?.source,items:bank?.items,engineCalls:report.engineCalls.length-before});assert.equal(prepared.mode,'repair');align(game);assert.equal(bank.validatorVersion,10);assert.ok(new Set(bank.items.map(item=>item.good)).size>=3,'Every real bank has three distinct verified sentences');assert.ok(bank.items.some(item=>provenance(item).newPractice));const calls=report.engineCalls.slice(before);assert.ok(calls.some(call=>call.method==='chat'&&call.ok),'Every bank uses the actual local model');if(issue.category==='word_order'){const derived=bank.items.filter(item=>provenance(item).derived);assert.ok(derived.length>=2,'Word-order practice has fresh derived contexts');for(const item of derived){const marked=item.bad.slice(0,item.targetOffset)+'[['+item.original+']]'+item.bad.slice(item.targetOffset+item.targetLength);assert.ok(calls.some(call=>call.method==='chat'&&call.ok&&call.input?.candidates?.some(candidate=>candidate.context===marked)),'Each derived context receives real independent AI review');}}else assert.ok(bank.items.some(item=>provenance(item).generated),'Other grammar banks contain actual AI-generated practice');previousSentences.set(issue.id,game.privateData.item.good);assert.equal(count('attempts'),0);assert.equal(count('completions'),0);log('Verified bank ready: '+issue.category+', '+bank.items.length+' sentences; '+JSON.stringify(bank.items.map(item=>provenance(item))));}
 assert.equal(count('banks'),3);assert.equal(assertTotals().xp,0);
 for(const [index,issue]of selected.entries()){
  await selectIssue(issue);
  for(const mode of ['repair','order','judge','pairs']){
   phase='play-'+mode+'-'+issue.category;const {game,publicData,item}=await openMode(issue,mode);log('Playing '+mode+' for '+issue.category+': '+item.bad);
   if(mode==='repair')await repair(game,publicData,item,index);else if(mode==='order')await order(game,publicData,item,index);else if(mode==='judge')await judge(game,publicData,index);else await pairs(game,publicData,item,index);
   assert.equal(store.game(game.id).completed,true);await page.locator('.victory-card').waitFor();assert.equal(await page.locator('.classic-game-arena.is-complete').count(),1);await page.screenshot({path:resolve(root,mode+'-'+issue.category+'.png'),fullPage:true});await page.getByRole('button',{name:'Elegir otro minijuego',exact:true}).click();log('Completed '+mode+' for '+issue.category+'; progress '+JSON.stringify(assertTotals()));
  }
 }
 assert.equal(report.playedGames.length,12);assert.equal(pendingRestartDone,true);const totals=assertTotals();assert.equal(totals.completedGames,12);assert.equal(totals.attempts,36);assert.equal(totals.mistakes,12);assert.equal(totals.xp,205);assert.equal(count('completions'),12);assert.equal(count('rewards'),12);assert.equal(count('practice_rounds'),0);
 for(const mode of Object.keys(modeNames)){const played=report.playedGames.filter(game=>game.mode===mode);assert.deepEqual(played.map(game=>game.category).sort(),fixture.selected.map(correction=>correction.category).sort());assert.ok(played.filter(game=>game.category!=='word_order').some(game=>game.visibleItems.some(item=>item.generated)),mode+' plays actual model-generated grammar practice');assert.ok(played.find(game=>game.category==='word_order').visibleItems.some(item=>item.derived),mode+' plays fresh AI-verified derived word-order contexts');assert.equal(store.progress().modeCounts[mode],3);}
 phase='final-restart';const completedExport=await restart('All twelve completed games persisted',{reload:true});assert.deepEqual((await get('/export')).tables,completedExport.tables);assert.ok((await page.locator('.stats-grid').innerText()).includes(String(totals.xp)));await page.screenshot({path:resolve(root,'progress-after-restart.png'),fullPage:true});
 report.totals=totals;report.persistedTableCounts=Object.fromEntries(tables.map(table=>[table,count(table)]));assert.deepEqual(report.browserErrors,[]);assert.deepEqual(report.externalBrowserRequests,[]);assert.deepEqual(report.apiFailures,[]);assert.ok(report.engineCalls.some(call=>call.method==='chat'&&call.ok));assert.ok(report.engineCalls.some(call=>call.method==='check'&&call.ok));report.passed=true;log('PASS: four classic modes × three real grammar corrections; wrong/right, help, idempotence, variation and durable progress verified');
}catch(error){report.failure={phase,message:error.message,stack:error.stack};log('FAIL in '+phase+': '+error.stack);try{await page?.screenshot({path:resolve(root,'failure.png'),fullPage:true});}catch{}process.exitCode=1;}
finally{await browser?.close();await app?.close();store?.close();report.engineCallCounts=Object.fromEntries(['check','chat'].map(name=>[name,report.engineCalls.filter(call=>call.method===name).length]));writeFileSync(resolve(root,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,root,totals:report.totals,engineCallCounts:report.engineCallCounts,failure:report.failure}));}
