import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const server=await createServer({configFile:false,server:{host:'127.0.0.1',port:0}});
await server.listen();
const base=server.resolvedUrls.local[0],root=resolve('test-results/radar-component');
mkdirSync(root,{recursive:true});
let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1200,height:1100}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'tests/radar-arcade-harness.html');
 await page.locator('.radar-start').waitFor({timeout:5000});
 const answers=async()=>JSON.parse(await page.locator('#answers').textContent());
 assert.equal(await page.locator('.radar-target').count(),20,'Each real token has exactly one target');
 assert.equal(await page.locator('.radar-target:enabled').count(),0,'An explicit start is required');
 await page.locator('.radar-start').click();
 await page.locator('.radar-target[data-token-id="4"]').hover({force:true});
 await page.locator('.radar-target[data-token-id="4"]').click();
 assert.deepEqual(await answers(),[{tokenIndex:4}],'Only token IDs are sent for server evaluation');
 await page.evaluate(()=>window.radarHarness.setFeedback({correct:false}));
 await page.locator('.radar-target.is-retry').waitFor();
 assert.equal(await page.locator('.radar-target.is-retry').getAttribute('data-token-id'),'4');
 await page.locator('.radar-pause').click();
 assert.equal(await page.locator('.radar-target:enabled').count(),0,'Pause stops input');
 assert.equal((await answers()).length,1,'Pausing never submits a failed attempt');
 await page.locator('.radar-pause').click();
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('.radar-arcade').getAttribute('data-state'),'paused','Escape pauses the gallery');
 await page.locator('.radar-pause').click();
 await page.locator('.radar-target[data-token-id="5"]').focus();
 await page.keyboard.press('Enter');
 assert.deepEqual((await answers()).at(-1),{tokenIndex:5},'Native keyboard activation shoots a target');
 await page.evaluate(()=>window.radarHarness.setFeedback({correct:true}));
 await page.locator('.radar-target.is-hit').waitFor();
 assert.equal(await page.locator('.radar-target:enabled').count(),0,'A server-confirmed success locks the round');
 await page.evaluate(()=>{window.radarHarness.setFeedback(null);window.radarHarness.setGame({...window.radarHarness.initial,id:'round-2'});window.radarHarness.setMotion(false);});
 await page.waitForFunction(()=>document.querySelector('.radar-arcade').dataset.motion==='off');
 assert.equal(await page.locator('.radar-arcade').getAttribute('data-state'),'playing','A new round preserves the running state');
 const target=page.locator('.radar-target').first(),first=await target.boundingBox();
 await page.waitForTimeout(250);
 assert.deepEqual(await target.boundingBox(),first,'Motion off leaves static playable targets');
 await target.click();
 assert.deepEqual((await answers()).at(-1),{tokenIndex:0});
 await page.evaluate(()=>window.radarHarness.setDisabled(true));
 await page.locator('.radar-target:enabled').first().waitFor({state:'detached'});
 assert.equal(await page.locator('.radar-target:enabled').count(),0,'The session can lock input while the service is busy');
 await page.evaluate(()=>{window.radarHarness.setDisabled(false);window.radarHarness.setLanguage('en');});
 await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
 assert.match(await page.locator('.radar-pause').innerText(),/Pause/);
 const beforeHidden=(await answers()).length;
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForFunction(()=>document.querySelector('.radar-arcade').dataset.state==='paused');
 assert.equal(await page.locator('.radar-arcade').getAttribute('data-state'),'paused','An inactive document pauses');
 assert.equal((await answers()).length,beforeHidden,'An inactive document does not consume an attempt');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.locator('.radar-arcade').getAttribute('data-state'),'paused','Returning to the document requires explicit resume');
 await page.locator('.radar-pause').click();
 for(const width of [1200,390,320]){
  await page.setViewportSize({width,height:1100});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at '+width);
  const boxes=await page.locator('.radar-target').evaluateAll(elements=>elements.map(element=>{const {x,y,width,height}=element.getBoundingClientRect();return{x,y,width,height};}));
  for(const [index,a]of boxes.entries()){
   assert.ok(a.width>=44&&a.height>=44,'Touch targets stay at least 44px');
   for(const b of boxes.slice(index+1))assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'Targets do not overlap');
  }
  await page.screenshot({path:resolve(root,'radar-'+width+'.png'),fullPage:true});
 }
 await page.locator('main').evaluate(element=>{element.style.maxWidth='1320px';element.style.padding='20px';});
 for(const word of ['continuos','continuous']){
  await page.evaluate(word=>{
   const text=`We practice the past ${word} tense every day.`;
   window.radarHarness.setFeedback(null);
   window.radarHarness.setGame({id:'spelling-'+word,text,tokens:text.split(' ').map((text,id)=>({id,text}))});
  },word);
  await page.locator('.radar-target-word').filter({hasText:word}).waitFor();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:1100});
   const spellingTarget=page.locator('.radar-target[data-token-id="4"]');
   const lines=()=>spellingTarget.locator('.radar-target-word').evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);return new Set([...range.getClientRects()].map(rect=>Math.round(rect.top))).size;});
   assert.equal(await lines(),1,`${word} stays whole at ${width}px`);
   assert.ok(await spellingTarget.evaluate(element=>{const target=element.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(element.querySelector('.radar-target-word'));const text=range.getBoundingClientRect();return text.left>=target.left+3&&text.right<=target.right-3;}),`${word} fits inside its target at ${width}px`);
   await spellingTarget.click();
   await page.evaluate(()=>window.radarHarness.setFeedback({correct:true}));
   await page.locator('.radar-target.is-hit').waitFor();
   assert.equal(await lines(),1,`The hit badge does not split ${word} at ${width}px`);
   await page.screenshot({path:resolve(root,`radar-spelling-${word}-${width}.png`),fullPage:true});
   await page.evaluate(()=>window.radarHarness.setFeedback(null));
   await page.locator('.radar-target:enabled').first().waitFor();
  }
 }
 assert.deepEqual(errors,[]);
 console.log('Radar interaction checks passed: start, payload, retry/success, pause, keyboard, static motion, service lock, bilingual UI and 320px layout.');
}finally{await browser?.close();await server.close();}
