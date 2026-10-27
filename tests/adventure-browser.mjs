import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const mode=process.argv.includes('maze')?'maze':'jump',root=resolve('test-results/adventure-'+mode+'-'+Date.now());
mkdirSync(root,{recursive:true});process.env.MQ_DATA_DIR=root;
const [{Store},{buildApp}]=await Promise.all([import('../service/store.js'),import('../service/app.js')]);
const path=resolve(root,'practice.sqlite'),names={jump:'Salto orbital',maze:'Laberinto de palabras'},report={passed:false,mode,root,errors:[],external:[]};
let store=new Store(path),app,browser,page,context,base,backendBase,vite;
const items=['I can explains the lesson.','We can explains this idea.','They can explains the rule.','You can explains the answer.'].map(bad=>({bad,good:bad.replace('explains','explain'),original:'explains',replacement:'explain',category:'verb_form',targetOffset:bad.indexOf('explains'),targetLength:8,answers:['explain'],alternatives:[],alternateOrders:[]}));
const issue=store.saveAnalysis({key:'adventure-browser',locale:'en-US',status:'issues',originalText:items[0].bad,correctedText:items[0].good,issues:[{offset:6,length:8,original:'explains',replacement:'explain',sentence:items[0].bad,category:'verb_form',explanation:'Después de can, usa el verbo base.'}]}).issues[0];
store.saveBank(issue.id,{validatorVersion:10,label:'Forma del verbo',hint:'Revisa el verbo después de can.',explanation:'Después de can, usa el verbo base.',items},'test');
const engines={health:async()=>({ollama:true,languageTool:true,modelReady:true,models:[{name:'qwen3:8b'}]}),check:async()=>({matches:[{rule:{id:'WRONG_TEST_ORDER'}}]}),chat:async()=>{throw Error('Verified bank should not need generation');}};
const received=part=>page.waitForResponse(r=>new URL(r.url()).pathname===part&&r.request().method()==='POST',{timeout:20000});
const json=async response=>{assert.equal(response.status(),200,await response.text());return response.json();};
async function start(){app=await buildApp({store,engines});backendBase=await app.listen({host:'127.0.0.1',port:0});base=backendBase;if(process.argv.includes('--source')){vite=await createServer({configFile:false,server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:backendBase,changeOrigin:false}}}});await vite.listen();base=vite.resolvedUrls.local[0].replace(/\/$/,'');}}
async function restart(){const oldPort=Number(new URL(backendBase).port),before=store.export();const closing=app.close();app.server.closeAllConnections();await closing;app=null;store.close();store=new Store(path);app=await buildApp({store,engines});assert.equal(await app.listen({host:'127.0.0.1',port:oldPort}),backendBase);assert.deepEqual(store.export().tables,before.tables);assert.deepEqual(store.progress(),before.progress);await page.reload();await page.getByRole('button',{name:'Mi progreso',exact:true}).click();await page.locator('.saved-adventure').filter({hasText:names[mode]}).getByRole('button',{name:'Continuar partida',exact:true}).click();await page.locator('.adventure-start').click();}
async function next(){await page.locator('.adventure-next').click();}
async function assisted(option){
 const button=page.locator(`.jump-option[data-option-id="${option}"]`);const response=received('/api/games/'+gameId+'/attempt');await button.click();return json(await response);
}
let gameId;
function route(board,from,to){const blocked=new Set(board.walls.map(p=>p.x+','+p.y)),queue=[{...from,path:[]}],seen=new Set([from.x+','+from.y]);for(let i=0;i<queue.length;i++){const current=queue[i];if(current.x===to.x&&current.y===to.y)return current.path;for(const [direction,dx,dy]of [['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]]){const x=current.x+dx,y=current.y+dy,key=x+','+y;if(x<0||y<0||x>=board.width||y>=board.height||blocked.has(key)||seen.has(key))continue;seen.add(key);queue.push({x,y,path:[...current.path,direction]});}}throw Error('Unreachable tile');}
async function moveTo(to){for(let retries=0;retries<8;retries++){const g=store.game(gameId),publicState=await(await context.request.get(base+'/api/games/'+gameId)).json();if(publicState.adventure.position.x===to.x&&publicState.adventure.position.y===to.y)return;const path=route(publicState.board,publicState.adventure.position,to);for(const direction of path){const response=received('/api/games/'+gameId+'/action');await page.locator('[data-arcade-focus]').press({up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight'}[direction]);await json(await response);}}throw Error('Cannot reach tile after collisions');}
async function collectAll(reverse=false){const g=await(await context.request.get(base+'/api/games/'+gameId)).json(),tokens=[...g.board.tokens].sort((a,b)=>reverse?b.id-a.id:a.id-b.id);for(const token of tokens){await moveTo(token);const r=received('/api/games/'+gameId+'/action');await page.getByRole('button',{name:'Recoger palabra',exact:true}).click();await json(await r);}await moveTo(g.board.exit);}
try{
 await start();browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'});page=await context.newPage();page.setDefaultTimeout(12000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base))report.external.push(r.url());});
 await page.goto(base);await page.getByRole('button',{name:'Mi progreso',exact:true}).click();await page.getByRole('button',{name:'Practicar',exact:true}).click();
 const card=page.locator('.mode-card').filter({has:page.getByRole('heading',{name:names[mode],exact:true})});assert.equal(await card.count(),1,'The new arcade game is available for the saved writing error');
 const opening=received('/api/games');await card.click();const opened=await json(await opening);gameId=opened.id;
 assert.equal(opened.mode,mode);assert.equal(opened.adventure.total,3);await page.locator('.adventure-start').click();
 if(mode==='jump'){
  const fall=received('/api/games/'+gameId+'/action');await page.locator('[data-arcade-focus]').focus();await page.keyboard.down('ArrowRight');await json(await fall);await page.keyboard.up('ArrowRight');assert.equal(store.game(gameId).state.movementMistakes,1);assert.equal(store.progress().totals.attempts,0,'A real fall never becomes an English attempt');assert.equal(store.game(gameId).state.step,0);
  if(await page.getByRole('button',{name:'Activar ayuda de movimiento',exact:true}).count())await page.getByRole('button',{name:'Activar ayuda de movimiento',exact:true}).click();
  const wrong=await assisted(0);assert.equal(wrong.correct,false);assert.equal(store.game(gameId).state.step,0);assert.equal(store.progress().totals.xp,0);
  let lost=true;await page.route('**/api/games/'+gameId+'/attempt',async r=>{if(lost){lost=false;await r.fetch();return r.abort('failed');}return r.continue();});
  await page.locator('.jump-option[data-option-id="1"]').click();await page.locator('.adventure-retry').waitFor();const attempts=store.progress().totals.attempts;await page.locator('.adventure-retry').click();await page.locator('.adventure-next').waitFor();assert.equal(store.progress().totals.attempts,attempts);assert.equal(store.game(gameId).state.step,1);await page.unroute('**/api/games/'+gameId+'/attempt');
  await restart();assert.equal(store.game(gameId).state.step,1);if(await page.getByRole('button',{name:'Activar ayuda de movimiento',exact:true}).count())await page.getByRole('button',{name:'Activar ayuda de movimiento',exact:true}).click();
  assert.equal((await assisted(1)).correct,true);await next();assert.equal((await assisted(1)).completed,true);
 }else{
  await collectAll(true);let r=received('/api/games/'+gameId+'/attempt');await page.getByRole('button',{name:'Comprobar frase',exact:true}).click();assert.equal((await json(await r)).correct,false);assert.equal(store.progress().totals.xp,0);
  r=received('/api/games/'+gameId+'/action');await page.getByRole('button',{name:'Reiniciar palabras',exact:true}).click();await json(await r);
  await collectAll();r=received('/api/games/'+gameId+'/attempt');await page.getByRole('button',{name:'Comprobar frase',exact:true}).click();assert.equal((await json(await r)).correct,true);await next();
  const state=await(await context.request.get(base+'/api/games/'+gameId)).json(),token=state.board.tokens.find(t=>t.id===0);await moveTo(token);r=received('/api/games/'+gameId+'/action');await page.getByRole('button',{name:'Recoger palabra',exact:true}).click();await json(await r);const saved=structuredClone(store.game(gameId).state);await restart();assert.deepEqual(store.game(gameId).state,saved);
  // Continue collecting from the retained inventory rather than collecting it twice.
  const all=await(await context.request.get(base+'/api/games/'+gameId)).json();for(const token of all.board.tokens.sort((a,b)=>a.id-b.id).filter(t=>!all.adventure.collected.includes(t.id))){await moveTo(token);r=received('/api/games/'+gameId+'/action');await page.getByRole('button',{name:'Recoger palabra',exact:true}).click();await json(await r);}await moveTo(all.board.exit);r=received('/api/games/'+gameId+'/attempt');await page.getByRole('button',{name:'Comprobar frase',exact:true}).click();assert.equal((await json(await r)).correct,true);await next();await collectAll();r=received('/api/games/'+gameId+'/attempt');await page.getByRole('button',{name:'Comprobar frase',exact:true}).click();assert.equal((await json(await r)).completed,true);
 }
 await page.locator('.victory-card').waitFor();assert.equal(store.progress().totals.completedGames,1);assert.equal(store.progress().totals.xp,20);assert.equal(store.progress().totals.detections,1);
 await page.screenshot({path:resolve(root,'complete.png'),fullPage:true});const totals=store.progress().totals;await page.reload();await page.getByRole('button',{name:'Mi progreso',exact:true}).click();assert.deepEqual(store.progress().totals,totals);assert.equal(await page.locator('.saved-adventure').filter({hasText:names[mode]}).count(),1);
 await page.setViewportSize({width:320,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);report.passed=true;report.totals=totals;console.log(JSON.stringify(report));
}catch(error){report.failure=error.stack;try{await page?.screenshot({path:resolve(root,'failure.png'),fullPage:true});}catch{}console.error(error);process.exitCode=1;}
finally{await browser?.close();await vite?.close();await app?.close();store.close();writeFileSync(resolve(root,'result.json'),JSON.stringify(report,null,2));}
