import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {buildApp} from '../service/app.js';
import {Store} from '../service/store.js';

// The real HTTP API and SQLite store handle this regression. Only engine health
// is supplied locally: an optional conjunction comma needs no model or LT call.
const base='http://127.0.0.1:3213',evidence=resolve('test-results','practice-status-browser-'+Date.now());
assert.ok(existsSync(resolve('dist/index.html')),'Ejecuta npm run build antes de esta prueba.');
mkdirSync(evidence,{recursive:true});
const store=new Store(':memory:'),engineCalls={chat:0,check:0},errors=[],external=[];
const text='I study English and I write every day.',original=' and',replacement=', and';
const issue=store.saveAnalysis({key:'optional-comma-browser',locale:'en-US',status:'issues',originalText:text,correctedText:text.replace(original,replacement),reviewVersion:3,issues:[{offset:text.indexOf(original),length:original.length,original,replacement,category:'punctuation',sentence:text,explanation:'Corrección histórica de coma.'}]}).issues[0];
const engines={
  health:async model=>({ollama:true,languageTool:true,modelReady:true,model,models:[{name:model,size:1,remote:false}],pending:0}),
  chat:async()=>{engineCalls.chat++;throw Error('Esta prueba no debe consultar la IA.');},
  check:async()=>{engineCalls.check++;throw Error('Esta prueba no debe consultar LanguageTool.');}
};
let app,browser;
const assertNoEarnedProgress=progress=>{
  assert.equal(progress.totals.completedGames,0);assert.equal(progress.totals.attempts,0);assert.equal(progress.totals.xp,0);
  for(const table of ['games','attempts','completions','rewards'])assert.equal(Number(store.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n),0,table+' debe seguir vacío');
};
try{
  app=await buildApp({store,engines});await app.listen({host:'127.0.0.1',port:3213});
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1080},reducedMotion:'reduce'});
  page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(!request.url().startsWith(base+'/'))external.push(request.url());});
  await page.goto(base);await page.getByText('IA local lista',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Mi progreso',exact:true}).click();
  await page.getByRole('button',{name:'Practicar',exact:true}).click();
  assert.equal(await page.locator('.mode-card').count(),6);
  const received=page.waitForResponse(response=>response.url()===base+'/api/practice-rounds'&&response.request().method()==='POST');
  await page.locator('.mode-card').filter({has:page.getByRole('heading',{name:'Dos caminos',exact:true})}).click();
  const response=await received;assert.equal(response.status(),200);assert.equal((await response.json()).status,'already_correct');
  await page.getByRole('heading',{name:'Esta frase ya estaba bien',exact:true}).waitFor();
  assert.equal(await page.locator('.practice-correct-check svg').count(),1);
  assert.equal(await page.locator('.arena,.mode-card,.alert').count(),0,'Una frase válida muestra el check y no juegos ni un error rojo');
  assert.equal(store.getBank(issue.id).status,'already_correct');
  assertNoEarnedProgress(store.progress());
  await page.screenshot({path:resolve(evidence,'already-correct-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'El check cabe en móvil');
  await page.screenshot({path:resolve(evidence,'already-correct-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Ver otros errores',exact:true}).click();
  await page.getByRole('heading',{name:'Tu mapa empieza con un texto.',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Practicar',exact:true}).count(),0);
  assert.equal(store.progress().patterns.length,0);
  await page.reload();await page.getByRole('button',{name:'Mi progreso',exact:true}).click();
  await page.getByRole('heading',{name:'Tu mapa empieza con un texto.',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Practicar',exact:true}).count(),0,'Recargar no vuelve a ofrecer el falso error');
  assert.equal(store.getBank(issue.id).status,'already_correct');
  // All six real API routes reuse the saved decision without engine work.
  for(const mode of ['choice','repair','radar','order','pairs','judge']){
    const repeated=await page.request.post(base+'/api/games',{headers:{'x-mistakequest':'1'},data:{issueId:issue.id,mode}});
    assert.equal(repeated.status(),200);assert.equal((await repeated.json()).status,'already_correct');
  }
  assertNoEarnedProgress(store.progress());assert.deepEqual(engineCalls,{chat:0,check:0});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const result={passed:true,backend:'buildApp real + SQLite en memoria',ui:'Arcade → check → otros errores → recarga',savedStatus:store.getBank(issue.id).status,totals:store.progress().totals,engineCalls,errors,external};
  writeFileSync(resolve(evidence,'result.json'),JSON.stringify(result,null,2));
  console.log('Estado de frase correcta: HTTP real, check visible, otros errores, recarga, seis modos y progreso intacto OK.');
  console.log('Evidencia:',evidence);
}finally{if(browser)await browser.close();if(app)await app.close();store.close();}
