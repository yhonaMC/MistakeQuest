import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const root=resolve('test-results/orbit-'+Date.now()),base='http://127.0.0.1:3212';
mkdirSync(root,{recursive:true});
let occupied=false;try{await fetch(base,{signal:AbortSignal.timeout(500)});occupied=true;}catch{}if(occupied)throw Error('The isolated orbit test port 3212 is already in use.');
const server=spawn(process.execPath,['service/index.js'],{env:{...process.env,MQ_PORT:'3212',MQ_DATA_DIR:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,log='';server.stdout.on('data',chunk=>log+=chunk);server.stderr.on('data',chunk=>log+=chunk);
try{
  for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,150));}
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1100,height:1100}}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(base))external.push(request.url());});
  await page.route('**/api/health',route=>route.fulfill({json:{app:'MistakeQuest',ollama:true,languageTool:true,modelReady:true,models:[{name:'qwen3:8b',size:5200000000}]}}));
  await page.goto(base);await page.getByText('IA local lista',{exact:true}).waitFor();
  await page.getByLabel('Tu espacio para escribir').focus();assert.equal(await page.getByLabel('Tu espacio para escribir').evaluate(el=>getComputedStyle(el).outlineStyle),'none','El editor enfocado no muestra un marco');
  const pause=page.getByRole('button',{name:'Pausar animaciones',exact:true});
  assert.equal(await pause.count(),1,'Órbita ofrece un control para pausar el movimiento');
  await page.locator('.orbit-scene[data-renderer="three"] canvas').waitFor({timeout:30000});
  await page.locator('select[aria-label="Variante de inglés"]').focus();
  const selector=await page.locator('select[aria-label="Variante de inglés"]').evaluate(el=>({appearance:getComputedStyle(el).appearance,radius:getComputedStyle(el).borderRadius,outline:getComputedStyle(el).outlineColor,pickerRadius:getComputedStyle(el,'::picker(select)').borderRadius}));
  assert.equal(selector.appearance,'base-select');assert.equal(selector.radius,'999px');assert.equal(selector.pickerRadius,'17px');assert.equal(selector.outline,'rgb(181, 160, 255)');
  await page.locator('select[aria-label="Variante de inglés"]').press('Space');
  await page.screenshot({path:resolve(root,'language-picker.png'),fullPage:true});
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  assert.equal(await page.locator('select[aria-label="Variante de inglés"]').inputValue(),'en-GB');
  await pause.click();await page.waitForTimeout(250);
  const frames=await page.locator('.orbit-scene').getAttribute('data-frames');await page.waitForTimeout(300);assert.equal(await page.locator('.orbit-scene').getAttribute('data-frames'),frames);
  await page.reload();await page.getByRole('button',{name:'Activar animaciones',exact:true}).waitFor();
  await page.getByRole('button',{name:'Arcade',exact:true}).click();assert.equal(await page.locator('.mode-card:not(:disabled)').count(),0);assert.match(await page.locator('main').innerText(),/revis/i);
  await page.getByRole('button',{name:'Revisar',exact:true}).click();
  const original='https://'+'a'.repeat(350)+'\n\n    I think tha this works.',offset=original.indexOf('tha');
  await page.route('**/api/analyze',async route=>{assert.equal(route.request().postDataJSON().locale,'en-US');await route.fulfill({json:{id:'ui-context',status:'issues',originalText:original,correctedText:original.replace('tha','that'),locale:'en-US',issues:[{id:'ui-error',category:'spelling',label:'Ortografía',original:'tha',replacement:'that',offset,length:3,explanation:'Falta la letra final en «that».',sentence:'I think tha this works.'}]}});});
  await page.getByLabel('Tu espacio para escribir').fill(original);await page.getByRole('button',{name:'Revisar mi texto',exact:true}).click();await page.getByText('Ver en mi texto',{exact:true}).click();
  assert.equal(await page.locator('.source-context').evaluate(el=>getComputedStyle(el).whiteSpace),'pre-wrap','El contexto conserva los espacios y saltos originales');
  assert.ok(await page.locator('.source-context').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.clientHeight<=160));
  let roundNumber=0;const attempts=[],rounds=new Map(),games=new Map(),attemptResults=new Map();
  function createGame(round,index){const game={id:`${round.id}-game-${index}`,issueId:'ui-error',mode:'choice',continuous:true,name:'Dos caminos',label:'Ortografía',instruction:'Elige la palabra correcta.',text:'I know tha it works.',target:{offset:7,length:3,text:'tha'},options:[{id:0,text:'tha'},{id:1,text:'that'}],progress:{current:0,total:1},learningRound:{id:round.id,index,total:10,kind:'practice'}};games.set(game.id,{game,round,index});return game;}
  function snapshot(round){return{id:round.id,mode:'choice',total:10,completedCount:round.stats.correct,complete:round.stats.correct===10,stats:{...round.stats},mix:{practice:10,review:0,new:0},points:round.points,xpEarned:round.xpEarned,timeLimitMs:5000,source:{id:'ui-error',label:'Ortografía',original:'tha',replacement:'that'},game:round.current};}
  await page.route('**/api/practice-rounds**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path==='/api/practice-rounds'){
      const body=request.postDataJSON();assert.equal(body.mode,'choice');assert.ok(body.idempotencyKey);
      const round={id:'ui-round-'+(++roundNumber),stats:{correct:0,wrong:0,missed:0,assisted:0,exhausted:0},points:0,xpEarned:0};round.current=createGame(round,1);rounds.set(round.id,round);return route.fulfill({json:snapshot(round)});
    }
    const round=rounds.get(path.split('/')[3]);assert.ok(round,'The UI uses the round returned by its create request');
    if(path.endsWith('/next')){assert.equal(request.postDataJSON().afterGameId,round.current.id);assert.equal(round.current.completed,true);round.current=createGame(round,round.stats.correct+1);}
    return route.fulfill({json:snapshot(round)});
  });
  await page.route('**/api/games/*/attempt',route=>{
    const body=route.request().postDataJSON(),id=new URL(route.request().url()).pathname.split('/')[3];assert.equal(body.answer,'1');assert.ok(body.idempotencyKey);
    if(attemptResults.has(body.idempotencyKey))return route.fulfill({json:attemptResults.get(body.idempotencyKey)});
    const entry=games.get(id);assert.ok(entry);attempts.push(id);const earned=attempts.length===1?20:0;
    entry.game.completed=true;entry.game.correct=true;entry.game.outcome='correct';entry.round.stats.correct++;entry.round.points+=100;entry.round.xpEarned+=earned;
    const result={correct:true,completed:true,outcome:'correct',arcadePoints:100,xpEarned:earned,message:'¡Bien! Has encontrado la palabra.',correctedSentence:'I know that it works.',progress:{current:1,total:1},practiceRound:snapshot(entry.round)};attemptResults.set(body.idempotencyKey,result);return route.fulfill({json:result});
  });
  async function completeRunnerPreview(){
    for(let round=1;round<=3;round++){
      const session=page.locator(`.continuous-runner-session[data-round="${round}"]`);await session.waitFor();
      const gameId=await session.getAttribute('data-game-id');
      if(await page.locator('.runner-arcade').getAttribute('data-phase')==='ready')await page.locator('.runner-go').click();
      const lane=await page.locator('.runner-gate[data-option-id="1"]').getAttribute('data-lane');
      await page.locator('.runner-steering button').nth(Number(lane)).click();await page.locator('.runner-playfield').press('Space');
      await page.locator('.continuous-runner-session .game-feedback.right').waitFor();
      if(round<3)await page.waitForFunction(previous=>document.querySelector('.continuous-runner-session')?.dataset.gameId!==previous,gameId);
      else await page.locator('.runner-pause').click();
    }
    assert.equal(await page.locator('.continuous-runner-session').getAttribute('data-round-complete'),'false','Tres puertas no completan una ronda de diez');
    assert.equal(await page.locator('.continuous-runner-session').getAttribute('data-saved'),'3');
    assert.equal(await page.locator('.practice-round-summary,.victory-card,.arcade-next-round').count(),0,'La carrera avanza automáticamente y todavía no presenta un cierre de ronda');
    assert.equal(await page.locator('.game-effects,.success-medallion').count(),0,'La carrera no superpone celebraciones');
    assert.match(await page.locator('.runner-score-points').innerText(),/300/);
  }
  await page.getByRole('button',{name:'Activar animaciones',exact:true}).click();await page.getByRole('button',{name:'Practicar este error',exact:true}).click();await page.locator('.mode-card').filter({has:page.getByRole('heading',{name:'Dos caminos',exact:true})}).click();await completeRunnerPreview();
  assert.match(await page.locator('.runner-score-xp').innerText(),/20/);await page.screenshot({path:resolve(root,'arcade-three-of-ten.png'),fullPage:true});
  await page.getByRole('button',{name:'Elegir otro minijuego',exact:true}).click();await page.getByRole('button',{name:'Pausar animaciones',exact:true}).click();await page.locator('.mode-card').filter({has:page.getByRole('heading',{name:'Dos caminos',exact:true})}).click();await completeRunnerPreview();assert.equal(await page.locator('.game-effects').count(),0);assert.match(await page.locator('.runner-score-xp').innerText(),/\+0 XP/);
  assert.deepEqual(attempts,[1,2].flatMap(round=>[1,2,3].map(index=>`ui-round-${round}-game-${index}`)),'Dos rondas comprueban tres puertas diferentes sin cerrar ninguna');
  for(const width of [390,320]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.locator('.runner-session-score').evaluate(el=>el.clientWidth>=60),'La puntuación conserva un ancho legible');await page.screenshot({path:resolve(root,`arcade-preview-${width}.png`),fullPage:true});}await page.setViewportSize({width:1100,height:1100});
  await page.getByRole('button',{name:'Revisar',exact:true}).click();await page.getByLabel('Tu espacio para escribir').fill('');
  await page.screenshot({path:resolve(root,'editor-desktop.png'),fullPage:true});
  for(const width of [736,390,320]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Sin desborde a ${width}px`);await page.screenshot({path:resolve(root,`editor-${width}.png`),fullPage:true});}
  const fallback=await context.newPage();await fallback.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /^webgl/.test(type)?null:original.call(this,type,...args);};});await fallback.goto(base);await fallback.locator('.orbit-scene[data-renderer="fallback"] img').waitFor();assert.ok(await fallback.getByLabel('Tu espacio para escribir').isEnabled());await fallback.close();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('Órbita: render 3D, pausa persistente, selector por teclado, Arcade opcional, escritorio/móvil, respaldo sin WebGL y cero red externa: OK');console.log('Evidencia:',root);
}finally{await browser?.close();server.kill();writeFileSync(resolve(root,'server.log'),log);}
