import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const server=await createServer({configFile:false,server:{host:'127.0.0.1',port:0}});
await server.listen();
const output=resolve('test-results/maze-component');mkdirSync(output,{recursive:true});
let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1200,height:1100}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(server.resolvedUrls.local[0]+'tests/maze-board-harness.html');
 const world=page.locator('.maze-world'),actor=page.locator('.maze-actor');
 const log=async()=>JSON.parse(await page.locator('#maze-fixture-log').textContent());
 const position=async()=>({x:Number(await actor.getAttribute('data-x')),y:Number(await actor.getAttribute('data-y'))});
 const step=async key=>{await world.focus();await page.keyboard.press(key);await page.waitForTimeout(70);};
 await world.waitFor();
 await step('ArrowRight');
 assert.deepEqual(await position(),{x:2,y:1},'Keyboard movement follows the authoritative server cell');
 assert.equal(await page.locator('.maze-inventory li').count(),0,'Walking over a word does not collect it');
 assert.equal((await log()).answers.length,0,'Walking never submits an English attempt');
 await step('Space');
 assert.deepEqual((await log()).actions.at(-1),{type:'collect',checkpoint:0},'Space explicitly requests collection');
 assert.equal(await page.locator('.maze-inventory li').count(),1);
 await page.getByRole('button',{name:'Deshacer última palabra'}).click();await page.waitForTimeout(70);
 assert.equal(await page.locator('.maze-inventory li').count(),0);
 await step('Space');assert.equal(await page.locator('.maze-inventory li').count(),1,'Undo lets the same current word be collected again');
 await page.evaluate(()=>window.mazeHarness.setDelay(250));
 await world.focus();await page.keyboard.press('ArrowDown');
 assert.deepEqual(await position(),{x:2,y:1},'Position never moves optimistically before an authoritative response');
 await page.waitForTimeout(300);assert.deepEqual(await position(),{x:2,y:2});
 await page.evaluate(()=>window.mazeHarness.setDelay(35));await step('ArrowUp');

 await page.evaluate(()=>window.mazeHarness.setPaused(true));
 const paused=await position(),pausedCount=(await log()).actions.length;
 await step('ArrowDown');await page.waitForTimeout(800);
 assert.deepEqual(await position(),paused);assert.equal((await log()).actions.length,pausedCount,'Pause stops input and patrol collisions');
 await page.evaluate(()=>{window.mazeHarness.setPaused(false);window.mazeHarness.setDelay(250);});
 await world.focus();await page.keyboard.down('ArrowDown');await page.waitForTimeout(530);await page.keyboard.up('ArrowDown');await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>window.mazeHarness.snapshot().maximum),1,'Held movement waits for each authoritative response');
 await page.evaluate(()=>{window.mazeHarness.setDelay(35);window.mazeHarness.reset();});await page.waitForTimeout(70);
 // Real touch pointer events drive the same serial movement controls.
 const touch=await browser.newContext({viewport:{width:320,height:1000},hasTouch:true,isMobile:true});
 const mobile=await touch.newPage();await mobile.goto(server.resolvedUrls.local[0]+'tests/maze-board-harness.html');
 await mobile.getByRole('button',{name:'Mover a la derecha'}).tap();await mobile.waitForTimeout(90);
 assert.equal(await mobile.locator('.maze-actor').getAttribute('data-x'),'2','Touch D-pad moves one grid cell');
 await mobile.getByRole('button',{name:'Recoger palabra'}).tap();await mobile.waitForTimeout(90);
 assert.equal(await mobile.locator('.maze-inventory li').count(),1,'Touch collects explicitly');
 await mobile.evaluate(()=>{const game=structuredClone(window.mazeHarness.snapshot().game);game.adventure.position=game.board.spawn;window.mazeHarness.setGame(game);});
 const down=await mobile.getByRole('button',{name:'Mover abajo'}).boundingBox(),cdp=await touch.newCDPSession(mobile);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:down.x+down.width/2,y:down.y+down.height/2}]});
 await mobile.waitForTimeout(390);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await mobile.waitForTimeout(80);
 assert.equal(await mobile.locator('.maze-actor').getAttribute('data-y'),'3','Held touch repeats movement through adjacent cells');
 assert.equal(await mobile.evaluate(()=>window.mazeHarness.snapshot().maximum),1,'Held touch serializes authoritative actions');
 await cdp.detach();
 await mobile.evaluate(()=>{window.mazeHarness.setLanguage('en');window.mazeHarness.setMotion(false);});
 await mobile.getByRole('button',{name:'Undo last word'}).waitFor();
 assert.equal(await mobile.locator('.maze-arcade').getAttribute('data-motion'),'off');
 assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'320px English board has no overflow');
 await mobile.screenshot({path:resolve(output,'maze-320-en.png'),fullPage:true});
 await mobile.evaluate(()=>window.mazeHarness.setLanguage('es'));await mobile.getByRole('button',{name:'Deshacer última palabra'}).waitFor();
 assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'320px Spanish board has no overflow');
 await mobile.screenshot({path:resolve(output,'maze-320-es.png'),fullPage:true});await touch.close();

 // Isolate drone contact with fixture-authoritative positioning; the component still sends a real move and motor action.
 const drone=page.locator('.maze-drone');await drone.waitFor();
 const dx=Number(await drone.getAttribute('data-x')),dy=Number(await drone.getAttribute('data-y'));
 const adjacent=await page.evaluate(({dx,dy})=>{
  const board=window.mazeHarness.initial.board;
  for(const [x,y,key]of [[dx-1,dy,'ArrowRight'],[dx+1,dy,'ArrowLeft'],[dx,dy-1,'ArrowDown'],[dx,dy+1,'ArrowUp']])if(x>0&&x<board.width-1&&y>0&&y<board.height-1&&!board.walls.some(wall=>wall.x===x&&wall.y===y))return {x,y,key};
 },{dx,dy});
 await page.evaluate(position=>{const game=structuredClone(window.mazeHarness.initial);game.adventure.position={x:position.x,y:position.y};game.adventure.collected=['a'];window.mazeHarness.setGame(game);},adjacent);
 await step(adjacent.key);await page.waitForFunction(()=>window.mazeHarness.snapshot().game.adventure.movementMistakes===1);
 assert.deepEqual(await position(),{x:1,y:1},'A collision respawns only from the returned server state');
 assert.equal(await page.locator('.maze-inventory li').count(),1,'Motor collision preserves collected words');
 await page.waitForTimeout(800);
 assert.equal((await log()).actions.filter(action=>action.type==='collision').length,1,'A contact emits one motor event with a respawn cooldown');
 assert.equal((await log()).answers.length,0,'Drone contact never submits an English attempt');

 // Check an intentionally wrong order at the exit, then reset through the public action protocol.
 await page.evaluate(()=>{const game=structuredClone(window.mazeHarness.initial);game.adventure.collected=['c','b','a','d'];game.adventure.position=game.board.exit;window.mazeHarness.setGame(game);});await page.waitForTimeout(70);
 assert.equal(await page.locator('.maze-inventory li').count(),4,'Repeated word text retains separate token IDs');
 await step('Space');
 assert.deepEqual((await log()).answers.at(-1),{tokenIds:['c','b','a','d'],checkpoint:0},'Only the actual collected order is submitted at the exit');
 await page.getByRole('button',{name:'Reiniciar palabras'}).click();await page.waitForTimeout(70);
 assert.equal(await page.locator('.maze-inventory li').count(),0,'An incorrect English attempt leaves reset available');
 assert.equal((await log()).actions.at(-1).type,'reset');
 await page.evaluate(()=>{window.mazeHarness.reset();window.mazeHarness.setMotion(false);});
 await step('ArrowRight');assert.deepEqual(await position(),{x:2,y:1},'Reduced motion keeps navigation playable');
 await page.evaluate(()=>window.mazeHarness.setDisabled(true));await step('ArrowDown');assert.deepEqual(await position(),{x:2,y:1},'Disabled session locks movement');
 await page.evaluate(()=>window.mazeHarness.setDisabled(false));
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 const hiddenCount=(await log()).actions.length;await step('ArrowDown');assert.equal((await log()).actions.length,hiddenCount,'Hidden document stops input');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.screenshot({path:resolve(output,'maze-desktop-es.png'),fullPage:true});
 const longWord='extraordinarily-complicated-fragment';
 await page.evaluate(longWord=>{const game=structuredClone(window.mazeHarness.initial);game.board.tokens[0].text=longWord;game.adventure.collected=['a'];window.mazeHarness.setGame(game);},longWord);
 await page.setViewportSize({width:320,height:1100});
 assert.equal(await page.locator('.maze-inventory li b').textContent(),longWord,'Inventory keeps the complete long fragment');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Long fragments wrap at 320px');
 await page.screenshot({path:resolve(output,'maze-320-long-fragment.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Synthetic maze component checks passed: authoritative keyboard/touch movement, explicit collection, undo, serial holds, pause, motor-only contact, ordered exit submission, wrong/reset, hidden/disabled, reduced motion and ES/EN 320px layout.');
}finally{await browser?.close();await server.close();}
