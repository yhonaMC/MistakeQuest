import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {shortArcadeFixture,grammarArcadeFixture} from './live-arcade-fixtures.js';

// Deliberately use real, newly generated engine output. This is an opt-in live
// integration test, not a deterministic fixture test. Never point it at learner data.
const grammarScenario=process.argv.includes('--grammar'),fixture=grammarScenario?grammarArcadeFixture:shortArcadeFixture;
const root=resolve('test-results/live-arcade-'+(grammarScenario?'grammar-':'')+Date.now());
mkdirSync(root,{recursive:true});
process.env.MQ_DATA_DIR=root;
const [{Store},{Engines},{buildApp}]=await Promise.all([
 import('../service/store.js'),import('../service/engines.js'),import('../service/app.js')
]);
const database=resolve(root,'practice.sqlite');
const {sourceText}=fixture;
const tables=['analyses','issues','banks','games','attempts','completions','rewards','practice_rounds'];
const report={passed:false,scenario:fixture.name,root,database,sourceText,engineCalls:[],browserErrors:[],externalBrowserRequests:[],apiFailures:[],attempts:[],preparedBanks:[],rounds:{}};
let phase='startup',store,app,browser,context,page,base;
function log(message){const line=new Date().toISOString()+' '+message;console.log(line);appendFileSync(resolve(root,'run.log'),line+'\n');}
function instrumentEngines(){
 const engines=new Engines();
 for(const name of ['check','chat']){
  const actual=engines[name].bind(engines);
  engines[name]=async(...args)=>{
   const entry={method:name,phase,startedAt:new Date().toISOString(),...(name==='check'?{text:args[0]}:{prompt:args[1].slice(0,100),input:args[2]})},started=performance.now();
   report.engineCalls.push(entry);
   try{const value=await actual(...args);entry.ok=true;entry.timing=value.timing;entry.resultCount=name==='check'?value.matches?.length:value.value?.items?.length??value.value?.issues?.length??value.value?.decisions?.length;if(name==='chat'&&phase==='prepare-banks')entry.result=value.value;return value;}
   catch(error){entry.ok=false;entry.error=error.message;throw error;}
   finally{entry.durationMs=Math.round(performance.now()-started);}
  };
 }
 return engines;
}
const planFor=id=>JSON.parse(store.db.prepare('SELECT plan FROM practice_rounds WHERE id=?').get(id).plan);
const count=name=>Number(store.db.prepare('SELECT COUNT(*) n FROM '+name).get().n);
async function responseJson(response,label){const text=await response.text();assert.equal(response.status(),200,label+': '+text);return JSON.parse(text);}
const get=async path=>responseJson(await context.request.get(base+'/api'+path,{timeout:180000}),path);
const postResponse=path=>page.waitForResponse(response=>response.url()===base+'/api'+path&&response.request().method()==='POST',{timeout:180000});
const waitGameChange=(selector,id)=>page.waitForFunction(({selector,id})=>{const next=document.querySelector(selector)?.dataset.gameId;return Boolean(next)&&next!==id;},{selector,id},{timeout:15000});
function compactCorrection(original,replacement){
 const before=original.trim().replace(/[.!?]+$/,'').split(/\s+/),after=replacement.trim().replace(/[.!?]+$/,'').split(/\s+/);
 while(before.length>1&&after.length>1&&before[0]===after[0]){before.shift();after.shift();}
 while(before.length>1&&after.length>1&&before.at(-1)===after.at(-1)){before.pop();after.pop();}
 return [before.join(' '),after.join(' ')];
}
const wordInventory=text=>(text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)||[]).sort();
function assertGrammarSource(issue,item){
 const expected=report.selectedCorrections.find(correction=>correction.issueId===issue.id);
 assert.ok(expected,'Every grammar exercise uses one of the three actual selected review corrections');
 assert.deepEqual(compactCorrection(issue.original,issue.replacement),[expected.original,expected.replacement],'The persisted source retains the real reviewed grammar correction');
 assert.deepEqual(compactCorrection(item.original,item.replacement),[expected.original,expected.replacement],'Practice retains the complete reviewed grammar change');
 assert.equal(item.category||issue.category,expected.category,'Practice retains the grammar category');
 if(Object.hasOwn(item,'sourceOffset')){
  const relative=item.sourceOffset-issue.offset;
  assert.ok(relative>=0&&relative+item.sourceLength<=issue.length,'The source exercise target stays inside its reviewed span');
  assert.equal(issue.original.slice(relative,relative+item.sourceLength),item.original,'The source exercise target matches the saved review offsets');
 }
 if(expected.category==='word_order'){
  assert.deepEqual(wordInventory(item.original),wordInventory(item.replacement),'Word-order practice moves the existing words without dropping or inventing a verb');
  assert.ok(wordInventory(item.original).length>1,'Word-order practice retains a complete movable phrase');
 }
}
function assertCompletedGrammarCoverage(games,mode){
 if(!grammarScenario)return;
 assert.deepEqual([...new Set(games.map(game=>game.issueId))].sort(),report.selectedCorrections.map(correction=>correction.issueId).sort(),mode+' actually plays all three selected grammar corrections');
 for(const game of games){assert.equal(store.game(game.id).completed,true);assertGrammarSource(store.issue(game.issueId),game.privateData.item);}
 assert.ok(games.some(game=>!Object.hasOwn(game.privateData.item,'sourceOffset')),mode+' actually plays fresh model-generated practice');
 report.rounds[mode+'Coverage']=games.map(game=>({gameId:game.id,issueId:game.issueId,category:game.privateData.item.category||store.issue(game.issueId).category,original:game.privateData.item.original,replacement:game.privateData.item.replacement,generated:!Object.hasOwn(game.privateData.item,'sourceOffset')}));
}
function align(game){
 assert.ok(game,'The UI refers to a persisted game');
 assert.ok(report.sourcePairs.some(pair=>pair.id===game.issueId),'Every exercise comes from this actual review');
 const issue=store.issue(game.issueId),item=game.privateData.item,bank=store.getBank(game.issueId);
 if(grammarScenario)assertGrammarSource(issue,item);
 else{assert.equal(item.original,issue.original,'The exercise retains its reviewed target');assert.equal(item.replacement,issue.replacement,'The exercise uses the persisted, revalidated correction');}
 assert.equal(item.bad.slice(item.targetOffset,item.targetOffset+item.targetLength),item.original);
 assert.equal(item.bad.slice(0,item.targetOffset)+item.replacement+item.bad.slice(item.targetOffset+item.targetLength),item.good,'Only the intended correction produces the good sentence');
 assert.ok(bank.items.some(candidate=>candidate.bad===item.bad&&candidate.good===item.good),'The exercise belongs to the real verified bank');
 return item;
}
function xpBefore(game,correct,{hint=false}={}){
 return !correct||store.db.prepare('SELECT 1 FROM rewards WHERE exercise_key=?').get(game.exerciseKey)?0:hint?10:20;
}
function recordAttempt(game,result,expectedXp){
 assert.equal(result.xpEarned,expectedXp,'XP follows the persisted reward key and help status');
 const saved=store.game(game.id);assert.equal(saved.completed,result.completed);
 report.attempts.push({gameId:game.id,issueId:game.issueId,mode:game.mode,category:game.privateData.item.category||store.issue(game.issueId).category,exerciseKey:game.exerciseKey,original:game.privateData.item.original,replacement:game.privateData.item.replacement,bad:game.privateData.item.bad,good:game.privateData.item.good,generated:!Object.hasOwn(game.privateData.item,'sourceOffset'),correct:result.correct,completed:result.completed,outcome:result.outcome,assisted:result.assisted,xpEarned:result.xpEarned,arcadePoints:result.arcadePoints});
}
function assertTotals(){
 const attempts=report.attempts,totals=store.progress().totals;
 assert.deepEqual(totals,{reviews:1,correctReviews:0,detections:report.sourcePairs.length,attempts:attempts.length,mistakes:attempts.filter(attempt=>!attempt.correct).length,completedGames:attempts.filter(attempt=>attempt.completed).length,xp:attempts.reduce((sum,attempt)=>sum+attempt.xpEarned,0),arcadePoints:attempts.reduce((sum,attempt)=>sum+(attempt.arcadePoints||0),0)});
 return totals;
}
async function openMode(title){const received=postResponse('/practice-rounds');await page.locator('.mode-card').filter({has:page.getByRole('heading',{name:title,exact:true})}).click();return responseJson(await received,title);}
async function startRadar(){if(await page.locator('.radar-start').isVisible())await page.locator('.radar-start').click();}
const wrongTokens=game=>game.privateData.tokens.filter(token=>token.offset+token.length<=game.privateData.item.targetOffset||token.offset>=game.privateData.item.targetOffset+game.privateData.item.targetLength);
const targetToken=game=>{
 const targets=game.privateData.tokens.filter(token=>token.offset<game.privateData.item.targetOffset+game.privateData.item.targetLength&&token.offset+token.length>game.privateData.item.targetOffset);
 return (game.privateData.item.category||store.issue(game.issueId).category)==='word_order'?targets.find(token=>/^is[.!?]?$/i.test(token.text))||targets[0]:targets[0];
};
async function shoot(game,token,correct){
 await page.waitForFunction(({id,tokenId})=>document.querySelector('.guided-radar-session')?.dataset.gameId===id&&document.querySelector(`.radar-target[data-token-id="${tokenId}"]`)?.disabled===false,{id:game.id,tokenId:token.id});
 const expected=xpBefore(store.game(game.id),correct,{hint:store.game(game.id).state.help==='hint'}),received=postResponse('/games/'+game.id+'/attempt');
 await page.locator(`.radar-target[data-token-id="${token.id}"]`).focus();await page.keyboard.press('Enter');
 const result=await responseJson(await received,'Radar shot');assert.equal(result.correct,correct);recordAttempt(game,result,expected);return result;
}
async function pauseRadar(){await page.locator('.radar-pause').click();assert.equal(await page.locator('.radar-pause').getAttribute('aria-pressed'),'true');}
async function gateColor(selector,color){
 // The visible side rails animate their border color over 150 ms. A terminal
 // class alone does not mean that transition has finished painting yet.
 await page.waitForFunction(({selector,color})=>{const elements=[...document.querySelectorAll(selector)];return elements.length>0&&elements.every(element=>getComputedStyle(element).borderLeftColor===color);},{selector,color},{timeout:900});
}
try{
 store=new Store(database);
 for(const table of tables)assert.equal(count(table),0,'The isolated '+table+' table starts empty');
 assert.equal(store.settings().model,'qwen3:8b');
 const engines=instrumentEngines(),health=await engines.health('qwen3:8b');
 assert.ok(health.ollama&&health.languageTool&&health.modelReady,'Real Ollama, LanguageTool, and Qwen3:8b must be ready');
 report.health=health;
 report.frontend=readFileSync(resolve('dist/index.html'),'utf8').match(/src="([^\"]+\.js)"/)?.[1];
 app=await buildApp({store,engines});base=await app.listen({host:'127.0.0.1',port:0});report.base=base;
 assert.notEqual(new URL(base).port,'3210','Never use the personal application port');
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
 context=await browser.newContext({viewport:{width:1360,height:1100},reducedMotion:'no-preference'});page=await context.newPage();
 page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(15000);
 const roundRequests=[],nextRequests=[];report.roundRequests=roundRequests;report.nextRequests=nextRequests;
 page.on('pageerror',error=>report.browserErrors.push(error.message));
 page.on('request',request=>{
  if(!request.url().startsWith(base))report.externalBrowserRequests.push(request.url());
  if(request.method()!=='POST')return;
  if(request.url()===base+'/api/practice-rounds')roundRequests.push(request.postDataJSON());
  if(/\/api\/practice-rounds\/[^/]+\/next$/.test(request.url()))nextRequests.push({url:request.url(),body:request.postDataJSON()});
 });
 page.on('response',response=>{if(response.url().startsWith(base+'/api/')&&response.status()>=400)report.apiFailures.push({url:response.url(),status:response.status()});});
 await page.goto(base);await page.getByText('IA local lista',{exact:true}).waitFor();
 phase='review';log('Real UI review started: '+fixture.name+', '+sourceText.split(/\s+/).length+' words');
 await page.getByLabel('Tu espacio para escribir').fill(sourceText);
 const reviewReceived=postResponse('/analyze');await page.getByRole('button',{name:'Revisar mi texto',exact:true}).click();
 const review=await responseJson(await reviewReceived,'Real review');
 assert.equal(review.status,'issues');assert.equal(review.originalText,sourceText);
 report.correctedText=review.correctedText;report.sourcePairs=review.issues.map(({id,offset,length,sentence,original,replacement,category,explanation})=>({id,offset,length,sentence,original,replacement,category,explanation}));
 for(const [original,replacement]of fixture.spellingPairs)assert.ok(review.issues.some(issue=>issue.original===original&&issue.replacement===replacement),'The real review corrects '+original+' → '+replacement);
 for(const sentence of fixture.preservedSentences||[])assert.ok(review.correctedText.includes(sentence),'The review preserves correct simple English: '+sentence);
 assert.equal(review.correctedText.replaceAll('does not',"doesn't"),fixture.correctedText,'The entire passage is corrected without changing its meaning or vocabulary');
 assert.equal(await page.getByLabel('Tu espacio para escribir').inputValue(),sourceText);
 await page.locator('.correction-row').first().waitFor();await page.screenshot({path:resolve(root,'review.png'),fullPage:true});
 assert.ok(report.engineCalls.some(call=>call.phase==='review'&&call.method==='chat'&&call.ok));
 log('Real review complete: '+JSON.stringify(report.sourcePairs.map(({original,replacement})=>[original,replacement])));
 phase='prepare-banks';
 const selected=fixture.selected.map(expected=>{
  const issue=review.issues.find(issue=>(!expected.category||issue.category===expected.category)&&(!expected.sentence||issue.sentence===expected.sentence)&&JSON.stringify(compactCorrection(issue.original,issue.replacement))===JSON.stringify([expected.original,expected.replacement]));
  assert.ok(issue,'The actual review includes '+(expected.category||'spelling')+': '+expected.original+' → '+expected.replacement);return issue;
 });
 report.selectedCorrections=selected.map((issue,index)=>({issueId:issue.id,...fixture.selected[index]}));
 for(const issue of selected){
  log('Generating and validating real bank for '+issue.original+' → '+issue.replacement);
  const before=report.engineCalls.length;
  const prepared=await responseJson(await context.request.post(base+'/api/games',{headers:{'x-mistakequest':'1'},data:{issueId:issue.id,mode:'repair'},timeout:180000}),'Real bank preparation');
  assert.equal(prepared.mode,'repair');assert.equal(prepared.issueId,issue.id);
  const game=store.game(prepared.id),bank=store.getBank(issue.id);report.preparedBanks.push({issueId:issue.id,gameId:game.id,source:bank?.source,items:bank?.items,engineCalls:report.engineCalls.length-before});align(game);
  assert.equal(bank.validatorVersion,10);assert.ok(bank.items.length>=3,'The real bank provides at least three verified sentences');
  if(grammarScenario){assert.ok(new Set(bank.items.map(item=>item.good)).size>=3,'The real grammar bank provides at least three different verified sentences');for(const item of bank.items)assertGrammarSource(store.issue(issue.id),item);}
  assert.ok(bank.items.some(item=>!Object.hasOwn(item,'sourceOffset')&&item.bad!==issue.sentence),'The run produces fresh model-generated practice sentences');
  assert.ok(report.engineCalls.slice(before).some(call=>call.method==='chat'&&call.ok),'Each prepared bank actually uses the local model');
  assert.equal(game.completed,false);assert.equal(count('attempts'),0);assert.equal(count('completions'),0);assert.equal(count('rewards'),0);
  log('Verified bank ready: '+issue.original+', '+bank.items.length+' sentences');
 }
 assert.equal(count('banks'),3);assert.deepEqual(assertTotals().xp,0);
 log('All three real correction banks are ready; starting Radar first');
 await page.locator('.correction-row').filter({has:page.getByText(selected[0].original,{exact:true})}).getByRole('button',{name:'Practicar este error',exact:true}).click();
 assert.equal(await page.locator('.practice-source del').innerText(),selected[0].original);
 phase='radar';const radarRound=await openMode('Radar de errores'),radar=page.locator('.guided-radar-session');await radar.waitFor();
 assert.equal(radarRound.total,3);assert.equal(new Set(planFor(radarRound.id).map(entry=>entry.issueId)).size,3);
 const radarGames=[];
 let game=store.game(await radar.getAttribute('data-game-id'));align(game);radarGames.push(game);assert.ok(wrongTokens(game).length>=3);
 await startRadar();assert.equal(await page.locator('.radar-attempts').getAttribute('data-attempts-remaining'),'3');
 let firstHint;
 for(let index=0;index<3;index++){
  const result=await shoot(game,wrongTokens(game)[index],false);
  assert.equal(result.completed,index===2);assert.equal(result.xpEarned,0);
  await page.waitForFunction(value=>document.querySelector('.radar-attempts')?.dataset.attemptsRemaining===String(value),2-index);
  if(index<2){assert.equal(await page.locator('.guided-radar-hint').getAttribute('data-hint-level'),String(index+1));const hint=await page.locator('.guided-radar-hint p').innerText();assert.ok(hint.trim());if(index===0)firstHint=hint;else assert.notEqual(hint,firstHint);}
  else{assert.equal(result.outcome,'exhausted');assert.equal(result.correctedSentence,game.privateData.item.good);await page.locator('.guided-radar-feedback[data-outcome="exhausted"]').waitFor();assert.equal(await page.locator('.guided-radar-correction').innerText(),game.privateData.item.good);assert.ok((await page.locator('.guided-radar-explanation').innerText()).trim());await page.screenshot({path:resolve(root,'radar-exhausted.png'),fullPage:true});}
 }
 await waitGameChange('.guided-radar-session',game.id);game=store.game(await radar.getAttribute('data-game-id'));align(game);radarGames.push(game);await startRadar();
 const miss=await shoot(game,wrongTokens(game)[0],false);assert.equal(miss.completed,false);
 const assisted=await shoot(game,targetToken(game),true);assert.equal(assisted.completed,true);assert.equal(assisted.assisted,true);assert.equal(assisted.xpEarned,10);
 await waitGameChange('.guided-radar-session',game.id);game=store.game(await radar.getAttribute('data-game-id'));align(game);radarGames.push(game);await startRadar();
 const direct=await shoot(game,targetToken(game),true);assert.equal(direct.completed,true);assert.equal(direct.assisted,false);assert.equal(direct.xpEarned,20);
 await page.locator('.guided-radar-summary').waitFor();
 assert.equal(await page.locator('.guided-radar-summary').getAttribute('data-correct'),'1');assert.equal(await page.locator('.guided-radar-summary').getAttribute('data-assisted'),'1');assert.equal(await page.locator('.guided-radar-summary').getAttribute('data-revealed'),'1');
 const radarComplete=await get('/practice-rounds/'+radarRound.id);assert.equal(radarComplete.complete,true);assert.equal(radarComplete.completedCount,3);assert.equal(radarComplete.xpEarned,30);
 assertCompletedGrammarCoverage(radarGames,'radar');
 assert.deepEqual(radarComplete.stats,{correct:2,wrong:0,missed:0,assisted:1,exhausted:1});assertTotals();
 const nextRadarReceived=postResponse('/practice-rounds');await page.locator('.guided-radar-again').click();const nextRadar=await responseJson(await nextRadarReceived,'Actual Radar Again action');
 assert.notEqual(nextRadar.id,radarRound.id);const radarReviews=planFor(nextRadar.id).filter(entry=>entry.kind==='review');
 assert.deepEqual(radarReviews.map(entry=>entry.issueId).sort(),radarGames.slice(0,2).map(previous=>previous.issueId).sort(),'Exhausted and assisted corrections both return');
 for(const previous of radarGames.slice(0,2)){const returning=radarReviews.find(entry=>entry.issueId===previous.issueId);assert.notEqual(returning.bank.items[0].good,previous.privateData.item.good,'The returning correction uses a different verified sentence');}
 await page.waitForFunction(id=>document.querySelector('.guided-radar-session')?.dataset.gameId===id,nextRadar.game.id);
 const pendingRadar=store.game(nextRadar.game.id);align(pendingRadar);await startRadar();await shoot(pendingRadar,wrongTokens(pendingRadar)[0],false);await pauseRadar();
 assert.equal(await page.locator('.radar-attempts').getAttribute('data-attempts-remaining'),'2');
 report.rounds.radar={id:radarRound.id,stats:radarComplete.stats,xpEarned:radarComplete.xpEarned,nextId:nextRadar.id,nextMix:nextRadar.mix,reviewIssueIds:radarReviews.map(entry=>entry.issueId),pendingGameId:pendingRadar.id,pendingState:store.game(pendingRadar.id).state};
 await page.getByRole('button',{name:'Salir de la partida',exact:true}).click();
 log('Radar complete: exhausted + assisted + direct, next-session review targets verified and one partial shot saved');
 phase='runner';const runnerRound=await openMode('Dos caminos'),runner=page.locator('.continuous-runner-session');await runner.waitFor();
 assert.equal(runnerRound.total,10);assert.equal(planFor(runnerRound.id).length,10);assert.equal(new Set(planFor(runnerRound.id).slice(0,3).map(entry=>entry.issueId)).size,3,'The three deliberate failures target three distinct real corrections');
 const runnerFailures=[],runnerGames=[];let runnerXp=0;
 for(let index=0;index<10;index++){
  assert.equal(await runner.getAttribute('data-round'),String(index+1));
  const id=await runner.getAttribute('data-game-id'),current=store.game(id),item=align(current),outcome=index===1?'missed':index<3?'wrong':'correct',correct=outcome==='correct';runnerGames.push(current);
  assert.equal(current.state.learningRoundId,runnerRound.id);if(!correct)runnerFailures.push({issueId:current.issueId,good:item.good});
  const publicGame=await get('/games/'+id);assert.equal(publicGame.issueId,current.issueId);assert.equal(publicGame.text,item.bad);assert.equal(publicGame.target.text,item.original);assert.deepEqual(publicGame.options.map(option=>option.text).sort(),[item.original,item.replacement].sort());
  assert.equal(await page.locator('.runner-sentence mark').innerText(),item.original);assert.deepEqual(await page.locator('.runner-gate-sign').allTextContents(),publicGame.options.map(option=>option.text));
  if(await page.locator('.runner-arcade').getAttribute('data-phase')==='ready')await page.locator('.runner-go').click();
  const expected=xpBefore(current,correct),received=postResponse('/games/'+id+'/attempt'),missStarted=performance.now();
  if(outcome!=='missed'){const option=publicGame.options.find(option=>correct?option.text!==publicGame.target.text:option.text===publicGame.target.text),gate=page.locator(`.runner-gate[data-option-id="${option.id}"]`),lane=Number(await gate.getAttribute('data-lane'));assert.equal(await gate.locator('.runner-gate-sign').innerText(),correct?item.replacement:item.original);await page.locator('.runner-steering button').nth(lane).click();await page.locator('.runner-playfield').press('Space');}
  const result=await responseJson(await received,'Runner gate '+(index+1));assert.equal(result.correct,correct);assert.equal(result.completed,true);assert.equal(result.outcome,outcome);assert.equal(result.arcadePoints,correct?100:outcome==='missed'?-10:0);recordAttempt(current,result,expected);runnerXp+=expected;
  if(outcome==='wrong')await gateColor('.runner-gate.is-wrong','rgb(255, 125, 141)');
  if(outcome==='correct')await gateColor('.runner-gate.is-correct','rgb(156, 232, 202)');
  if(outcome==='missed'){report.timeoutDurationMs=Math.round(performance.now()-missStarted);assert.ok(report.timeoutDurationMs>=4000,'The timeout is caused by the actual runner clock');await gateColor('.runner-gate.is-missed','rgb(255, 125, 141)');assert.equal(await page.locator('.runner-gate.is-missed').count(),2);}
  if(index<9)await waitGameChange('.continuous-runner-session',id);
 }
 const summary=page.locator('.practice-round-summary');await summary.waitFor();assert.equal(await summary.getAttribute('data-correct'),'7');assert.equal(await summary.getAttribute('data-wrong'),'2');assert.equal(await summary.getAttribute('data-missed'),'1');assert.equal(await runner.getAttribute('data-round-complete'),'true');
 const runnerComplete=await get('/practice-rounds/'+runnerRound.id);assert.equal(runnerComplete.complete,true);assert.equal(runnerComplete.completedCount,10);assert.equal(runnerComplete.game,null);assert.equal(runnerComplete.points,690);assert.equal(runnerComplete.xpEarned,runnerXp);assert.deepEqual(runnerComplete.stats,{correct:7,wrong:2,missed:1,assisted:0,exhausted:0});
 assertCompletedGrammarCoverage(runnerGames,'runner');
 const gamesAtSummary=count('games'),totalsAtSummary=assertTotals();await page.waitForTimeout(1600);assert.equal(count('games'),gamesAtSummary,'Ten settled doors never create an eleventh game');assert.deepEqual(store.progress().totals,totalsAtSummary);assert.equal(store.db.prepare("SELECT COUNT(*) n FROM games WHERE mode='choice'").get().n,10);assert.equal(nextRequests.filter(request=>request.url.includes(runnerRound.id)).length,9);
 await page.screenshot({path:resolve(root,'runner-summary.png'),fullPage:true});
 const nextRunnerReceived=postResponse('/practice-rounds');await page.locator('.runner-next-round').click();const nextRunner=await responseJson(await nextRunnerReceived,'Actual next-runner action');
 const runnerReviews=planFor(nextRunner.id).filter(entry=>entry.kind==='review');assert.deepEqual(runnerReviews.map(entry=>entry.issueId).sort(),runnerFailures.map(previous=>previous.issueId).sort());
 for(const previous of runnerFailures){const returning=runnerReviews.find(entry=>entry.issueId===previous.issueId);assert.notEqual(returning.bank.items[0].good,previous.good,'A failed correction returns in another verified sentence');}
 await page.waitForFunction(id=>document.querySelector('.continuous-runner-session')?.dataset.roundId===id,nextRunner.id);
 if(await page.locator('.runner-arcade').getAttribute('data-phase')==='ready')await page.locator('.runner-go').click();await page.locator('.runner-pause').click();await page.waitForFunction(()=>document.querySelector('.runner-arcade')?.dataset.phase==='paused');
 assert.deepEqual(store.progress().totals,totalsAtSummary,'Preparing and pausing the next round adds no reward or attempt');
 report.rounds.runner={id:runnerRound.id,stats:runnerComplete.stats,points:runnerComplete.points,xpEarned:runnerXp,nextId:nextRunner.id,nextMix:nextRunner.mix,reviewIssueIds:runnerReviews.map(entry=>entry.issueId),pendingGameId:nextRunner.game.id};
 await page.getByRole('button',{name:'Salir de la partida',exact:true}).click();await page.getByRole('button',{name:'Mi progreso',exact:true}).click();await page.getByRole('heading',{name:'Tus errores más frecuentes',exact:true}).waitFor();await page.screenshot({path:resolve(root,'progress.png'),fullPage:true});
 const beforeExport=await get('/export'),beforeProgress=await get('/progress');assert.deepEqual(beforeProgress.totals,assertTotals());assert.deepEqual(beforeExport.progress,beforeProgress);
 report.totals=beforeProgress.totals;report.persistedTableCounts=Object.fromEntries(tables.map(table=>[table,count(table)]));
 log('Runner complete: 10 doors, 7 correct / 2 wrong / 1 actual timeout, +690 points; restarting owned app and database');
 phase='restart';const port=Number(new URL(base).port);await app.close();app=null;store.close();store=null;
 store=new Store(database);const restartedEngines=instrumentEngines();app=await buildApp({store,engines:restartedEngines});assert.equal(await app.listen({host:'127.0.0.1',port}),base);
 await page.reload();await page.getByText('IA local lista',{exact:true}).waitFor();await page.getByRole('button',{name:'Mi progreso',exact:true}).click();await page.getByRole('heading',{name:'Tus errores más frecuentes',exact:true}).waitFor();
 const afterProgress=await get('/progress'),afterExport=await get('/export');assert.deepEqual(afterProgress,beforeProgress,'API progress survives the actual service/database restart');assert.deepEqual(afterExport.tables,beforeExport.tables,'Plans, game IDs, states, attempts and rewards survive reopening SQLite');assert.deepEqual(afterExport.settings,beforeExport.settings);assert.deepEqual(afterExport.progress,beforeExport.progress);
 for(const id of [radarRound.id,runnerRound.id])assert.equal((await get('/practice-rounds/'+id)).complete,true);
 assert.equal((await get('/practice-rounds/'+nextRadar.id)).complete,false);assert.equal((await get('/practice-rounds/'+nextRunner.id)).complete,false);
 const resumeReceived=page.waitForResponse(response=>response.url()===base+'/api/practice-rounds/'+nextRadar.id&&response.request().method()==='GET');
 await page.locator('.practice-round-history > article').filter({hasText:'Radar de errores'}).filter({has:page.getByRole('button',{name:'Continuar ronda',exact:true})}).getByRole('button',{name:'Continuar ronda',exact:true}).click();await responseJson(await resumeReceived,'Saved Radar resume');
 await page.waitForFunction(id=>document.querySelector('.guided-radar-session')?.dataset.gameId===id,pendingRadar.id);assert.equal(await page.locator('.radar-attempts').getAttribute('data-attempts-remaining'),'2');assert.equal(await page.locator('.guided-radar-hint').getAttribute('data-hint-level'),'1');
 const discarded=store.game(pendingRadar.id).state.discardedTokenIds;assert.equal(discarded.length,1);assert.equal(await page.locator(`.radar-target[data-token-id="${discarded[0]}"]`).isDisabled(),true);assert.deepEqual(assertTotals(),report.totals);
 await page.getByRole('button',{name:'Salir de la partida',exact:true}).click();await page.getByRole('button',{name:'Mi progreso',exact:true}).click();await page.getByRole('heading',{name:'Tus errores más frecuentes',exact:true}).waitFor();
 assert.ok((await page.locator('.stats-grid').innerText()).includes(String(report.totals.xp)));assert.match(await page.locator('.runner-history-points').innerText(),/690 PTS/);
 assert.deepEqual((await get('/export')).tables,beforeExport.tables,'Viewing and resuming pending progress does not mutate persisted learning data');
 assert.ok(report.attempts.some(attempt=>attempt.generated),'An accepted fresh model-generated example is actually played through the UI');
 assert.ok(report.engineCalls.filter(call=>call.method==='chat'&&call.ok).length>0);assert.ok(report.engineCalls.filter(call=>call.method==='check'&&call.ok).length>0);assert.deepEqual(report.browserErrors,[]);assert.deepEqual(report.externalBrowserRequests,[]);assert.deepEqual(report.apiFailures,[]);
 report.persistence={realServiceRestart:true,exactTablesPreserved:true,totalsPreserved:true,completedRoundsPreserved:true,pendingPlansPreserved:true,partialRadarShotResumed:true};report.passed=true;
 log('PASS: real AI review and generation, both full arcade rounds, adaptive review, and durable progress verified');
}catch(error){report.failure={phase,message:error.message,stack:error.stack};log('FAIL in '+phase+': '+error.stack);try{await page?.screenshot({path:resolve(root,'failure.png'),fullPage:true});}catch{}process.exitCode=1;}
finally{
 await browser?.close();await app?.close();store?.close();
 report.engineCallCounts=Object.fromEntries(['check','chat'].map(name=>[name,report.engineCalls.filter(call=>call.method===name).length]));
 writeFileSync(resolve(root,'result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,root,totals:report.totals,engineCallCounts:report.engineCallCounts,failure:report.failure}));
}
