import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const server=await createServer({configFile:false,server:{host:'127.0.0.1',port:0}});
await server.listen();
const base=server.resolvedUrls.local[0],root=resolve('test-results/guided-radar-component');
mkdirSync(root,{recursive:true});
let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1200,height:1100}}),errors=[],attempts=[],nextCalls=[],cached=new Map();let nextResponseLost=false;
 page.on('pageerror',error=>errors.push(error.message));
 const makeGame=index=>{const text=['My sister walk to the library daily.','We practice the past continuos tense daily.','Our teacher explain the lesson every morning.'][index-1];return{id:'guided-'+index,mode:'radar',guided:true,text,tokens:text.split(' ').map((text,id)=>({id,text})),attemptsRemaining:3,misses:0,discardedTokenIds:[]};};
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname,body=request.postDataJSON();
  const respond=result=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  if(path.endsWith('/next')){
   nextCalls.push(body);
   const completedCount=Number(body.afterGameId.split('-').at(-1));
   if(completedCount===1&&!nextResponseLost){nextResponseLost=true;return route.abort('failed');}
   return respond({id:'round-fixture',mode:'radar',total:3,completedCount,complete:completedCount===3,stats:completedCount===3?{correct:2,wrong:3,missed:1,assisted:1,exhausted:1}:{correct:0,wrong:3,missed:1,assisted:0,exhausted:1},xpEarned:completedCount===3?30:0,mix:{},game:completedCount===3?null:makeGame(completedCount+1)});
  }
  if(path.endsWith('/hint'))return respond({help:'hint',hint:'Revisa cómo termina el verbo.',hintLevel:1,message:'Revisa cómo termina el verbo.',attemptsRemaining:3});
  if(path.endsWith('/attempt')){
   attempts.push({path,...body});
   if(cached.has(body.idempotencyKey))return respond(cached.get(body.idempotencyKey));
   let result;
   if(path.includes('/guided-1/')){
    const misses=body.tokenIndex+1;
    result={correct:false,completed:misses===3,outcome:misses===3?'exhausted':'retry',misses,attemptsRemaining:3-misses,discardedTokenIds:Array.from({length:misses},(_,i)=>i),hint:misses<3?['Busca el verbo que acompaña a sister.','Con she, el verbo lleva otra terminación.'][misses-1]:undefined,hintLevel:Math.min(misses,2),help:misses===3?'reveal':misses===2?'hint':undefined,message:misses===3?'La frase corregida está lista.':'Esa palabra está bien.',...(misses===3?{correctedSentence:'My sister walks to the library daily.',explanation:'Con she, el verbo en presente lleva -s.'}:{})};
   }else result={correct:true,completed:true,outcome:'correct',misses:0,attemptsRemaining:3,discardedTokenIds:[],help:path.includes('/guided-3/')?'hint':undefined,message:'¡Bien! Has encontrado la palabra.',correctedSentence:path.includes('/guided-2/')?'We practice the past continuous tense daily.':'Our teacher explains the lesson every morning.',explanation:'Bien visto.',xpEarned:path.includes('/guided-3/')?10:20};
   cached.set(body.idempotencyKey,result);
   if(attempts.length===1)return route.abort('failed');
   return respond(result);
  }
  throw Error('Unexpected fixture request: '+path);
 });
 await page.goto(base+'tests/guided-radar-harness.html');
 await page.locator('.radar-start').waitFor({timeout:5000});
 assert.equal(await page.locator('.radar-attempt').count(),3,'Three attempts are shown before playing');
 await page.locator('.radar-start').click();
 const shoot=async token=>{await page.locator(`.radar-target[data-token-id="${token}"]`).focus();await page.keyboard.press('Enter');};
 await shoot(0);
 await page.locator('.guided-radar-retry').waitFor();
 assert.equal(await page.locator('.radar-attempts').getAttribute('data-attempts-remaining'),'3','An unknown network result does not invent a lost attempt');
 assert.equal(await page.locator('.radar-target:enabled').count(),0,'A lost response is resolved before another shot');
 await page.locator('.guided-radar-retry').click();
 await page.locator('.guided-radar-hint[data-hint-level="1"]').waitFor();
 assert.equal(attempts[0].idempotencyKey,attempts[1].idempotencyKey,'Retry uses the same attempt key');
 assert.equal(await page.locator('.radar-attempts').getAttribute('data-attempts-remaining'),'2');
 assert.equal(await page.locator('.radar-target[data-token-id="0"]').isDisabled(),true,'A discarded word cannot cost another attempt');
 const settledAttempts=attempts.length,firstMiss=cached.get(attempts.at(-1).idempotencyKey);
 await page.locator('.radar-target[data-token-id="0"]').dispatchEvent('click');
 assert.equal(attempts.length,settledAttempts,'Shooting a discarded word does not submit another attempt');
 await page.evaluate(()=>window.guidedRadarHarness.leave());
 await page.locator('.guided-radar-session').waitFor({state:'detached'});
 const restoredGame={...makeGame(1),...firstMiss,practiceRound:{id:'round-fixture',mode:'radar',total:3,completedCount:0,complete:false,stats:{correct:0,wrong:0,missed:0,assisted:0,exhausted:0},xpEarned:0,mix:{}}};
 await page.evaluate(game=>window.guidedRadarHarness.resume(game),restoredGame);
 await page.locator('.radar-start').waitFor();
 assert.equal(await page.locator('.radar-attempts').getAttribute('data-attempts-remaining'),'2','Resuming a public snapshot preserves spent attempts');
 assert.equal(await page.locator('.guided-radar-hint').getAttribute('data-hint-level'),'1','Resuming preserves progressive hint level');
 assert.match(await page.locator('.guided-radar-hint').innerText(),/Busca el verbo que acompaña a sister/,'Resuming preserves the saved hint');
 assert.equal(await page.locator('.radar-target[data-token-id="0"]').isDisabled(),true);
 assert.equal(attempts.length,settledAttempts,'Remounting a saved session does not submit a shot');
 await page.locator('.radar-start').click();
 assert.equal(await page.locator('.radar-target[data-token-id="0"]').isDisabled(),true,'A discarded word stays disabled after resuming');
 assert.equal(await page.locator('.radar-target[data-token-id="1"]').isEnabled(),true,'Resuming still permits undiscarded words');
 await shoot(1);
 await page.locator('.guided-radar-hint[data-hint-level="2"]').waitFor();
 assert.equal(await page.locator('.radar-attempts').getAttribute('data-attempts-remaining'),'1');
 await page.setViewportSize({width:320,height:1100});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No overflow with progressive hints at 320px');
 await page.screenshot({path:resolve(root,'guided-hint-320.png'),fullPage:true});
 await page.setViewportSize({width:1200,height:1100});
 await shoot(2);
 await page.locator('.guided-radar-feedback[data-outcome="exhausted"]').waitFor();
 assert.equal(await page.locator('.radar-attempts').getAttribute('data-attempts-remaining'),'0');
 assert.match(await page.locator('.guided-radar-correction').innerText(),/sister walks/);
 assert.match(await page.locator('.guided-radar-explanation').innerText(),/presente lleva -s/);
 await page.locator('.radar-pause').click();
 await page.screenshot({path:resolve(root,'guided-revealed-paused-1200.png'),fullPage:true});
 await page.waitForTimeout(3250);
 assert.equal(nextCalls.length,0,'Pause freezes the correction reading interval');
 await page.locator('.radar-pause').click();
 await page.waitForTimeout(2400);
 assert.equal(nextCalls.length,0,'The exhausted phrase remains readable before three seconds');
 await page.locator('.guided-radar-retry').waitFor();
 await page.locator('.guided-radar-retry').click();
 await page.locator('.guided-radar-session[data-game-id="guided-2"]').waitFor();
 assert.deepEqual(nextCalls[0],nextCalls[1],'A lost next response retries the same completed phrase');
 assert.equal(await page.locator('.radar-start').count(),0,'The next phrase preserves the playing state');
 assert.equal(await page.locator('.radar-attempts').getAttribute('data-attempts-remaining'),'3');
 await shoot(4);
 await page.locator('.guided-radar-feedback[data-outcome="correct"]').waitFor();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(1150);
 assert.equal(nextCalls.length,2,'Visibility pauses automatic progression');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.locator('.radar-arcade').getAttribute('data-state'),'paused');
 await page.locator('.radar-pause').click();
 await page.locator('.guided-radar-session[data-game-id="guided-3"]').waitFor();
 await page.locator('.guided-radar-manual-hint').click();
 await page.locator('.guided-radar-hint').waitFor();
 assert.equal(await page.locator('.radar-attempts').getAttribute('data-attempts-remaining'),'3','Requesting a hint does not consume an attempt');
 await shoot(2);
 await page.locator('.guided-radar-summary').waitFor();
 assert.equal(new Set(nextCalls.map(value=>value.afterGameId)).size,3,'Every finished phrase advances through the durable round');
 assert.deepEqual(nextCalls.map(value=>value.afterGameId),['guided-1','guided-1','guided-2','guided-3']);
 assert.equal(await page.locator('.guided-radar-summary').getAttribute('data-correct'),'1');
 assert.equal(await page.locator('.guided-radar-summary').getAttribute('data-assisted'),'1');
 assert.equal(await page.locator('.guided-radar-summary').getAttribute('data-revealed'),'1');
 await page.evaluate(()=>window.guidedRadarHarness.setLanguage('en'));
 await page.getByRole('button',{name:'Play another session',exact:true}).waitFor();
 await page.getByRole('button',{name:'Play another session',exact:true}).click();
 assert.equal(JSON.parse(await page.locator('#guided-events').innerText()).again,1);
 for(const width of [1200,390,320]){
  await page.setViewportSize({width,height:1100});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No overflow in guided summary at '+width);
  await page.screenshot({path:resolve(root,'guided-summary-'+width+'.png'),fullPage:true});
 }
 assert.deepEqual(errors,[]);
 console.log('Guided radar checks passed: durable retry, three server attempts, progressive hints, discarded words, partial-session remount, paused automatic progression, readable reveal, three-phrase summary and bilingual mobile UI.');
}finally{await browser?.close();await server.close();}
