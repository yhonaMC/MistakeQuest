import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createServer} from 'vite';

// Only browser requests are stubbed. This regression never opens a learner database.
const root=resolve('test-results/writing-layout-'+Date.now());
mkdirSync(root,{recursive:true});
const server=await createServer({configFile:false,server:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser,pendingReview,improvementSuggestions=[];
const progress={totals:{xp:0,completedGames:0,reviews:0},patterns:[],recent:[],categories:[]};
const issuesFor=text=>text.includes("She don't")?[{id:'fixture-issue',offset:text.indexOf("don't"),length:5,original:"don't",replacement:"doesn't",label:'Concordancia verbal',explanation:'Con she, usa does.',category:'verb_form'}]:[];
const reviewFor=text=>{const issues=issuesFor(text);return {status:issues.length?'issues':'correct',locale:'en-US',originalText:text,correctedText:text.replace("She don't","She doesn't"),issues};};
function assertBounds(actual,expected,message){for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-expected[key])<1,`${message}: ${key}: ${actual[key]} / ${expected[key]}`);}

try{
  await server.listen();
  const base=server.resolvedUrls.local[0];
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'no-preference'});
  const page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(!request.url().startsWith(base))external.push(request.url());});
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const respond=body=>route.fulfill({json:body});
    if(path==='/api/health')return respond({ollama:true,languageTool:true,modelReady:true});
    if(path==='/api/settings')return respond({locale:'en-US'});
    if(path==='/api/progress')return respond(progress);
    if(path==='/api/improvements')return respond({suggestions:improvementSuggestions});
    if(path==='/api/analyze'){
      const {text}=route.request().postDataJSON();
      await new Promise(resolve=>{pendingReview=async()=>{await respond(reviewFor(text));resolve();};});
      return;
    }
    throw Error('Unexpected API request: '+path);
  });
  await page.goto(base);
  await page.getByText('IA local lista',{exact:true}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  const measure=()=>page.evaluate(()=>{
    const bounds=selector=>{const rect=document.querySelector(selector).getBoundingClientRect();return {x:rect.x+scrollX,y:rect.y+scrollY,width:rect.width,height:rect.height};};
    const input=document.querySelector('#english-input'),style=getComputedStyle(input);
    return {input:bounds('#english-input'),panel:bounds('.editor-panel'),hero:bounds('.orbit-hero'),stage:bounds('.orbit-stage'),scrollY,title:document.querySelector('#page-title').textContent,inputStyle:{fontSize:style.fontSize,background:style.background,color:style.color,borderRadius:style.borderRadius},scene:document.querySelector('.orbit-scene').dataset.state};
  });
  const scenarios=[
    {width:1440,text:'I like coffee.',name:'desktop-correct'},
    {width:1440,text:"She don't like coffee.",name:'desktop-issues'},
    {width:390,text:('I write a little every day.\n').repeat(200).slice(0,5000),name:'mobile-long-correct'},
    {width:320,text:"She don't like coffee. "+'I write every day. '.repeat(280).slice(0,4978),name:'mobile-long-issues'},
    {width:1440,text:'I like coffee.',name:'desktop-correct-english',language:'en'},
    {width:390,text:"She don't like coffee.",name:'mobile-issues-english',language:'en'}
  ];
  const results=[];
  for(const scenario of scenarios){
    await page.locator('header .interface-language-capsule').getByRole('button',{name:scenario.language==='en'?'English':'Español',exact:true}).click();
    await page.setViewportSize({width:scenario.width,height:1100});
    const input=page.locator('#english-input');
    await input.fill(scenario.text);
    const node=await input.elementHandle(),canvas=await page.locator('.orbit-scene').elementHandle();
    const before=await measure();
    await page.getByRole('button',{name:scenario.language==='en'?'Review my text':'Revisar mi texto',exact:true}).click();
    await page.getByRole('button',{name:scenario.language==='en'?'Cancel review':'Cancelar revisión',exact:true}).waitFor();
    const during=await measure();
    for(const key of ['input','panel','hero','stage'])assertBounds(during[key],before[key],scenario.name+' during '+key);
    assert.deepEqual(during.inputStyle,before.inputStyle,'Checking preserves textarea appearance');
    assert.equal(during.scene,'ready','Checking keeps the original orbit motion');
    assert.ok(pendingReview,'The isolated review request is waiting');
    await pendingReview();pendingReview=null;
    await page.locator('.review-view').waitFor();
    assert.equal(await input.count(),1,'The original writing field stays visible after review');
    assert.equal(await page.evaluate(element=>document.querySelector('#english-input')===element,node),true,'Review keeps the same textarea DOM node');
    assert.equal(await page.evaluate(element=>document.querySelector('.orbit-scene')===element,canvas),true,'Review keeps the same orbit scene DOM node');
    assert.equal(await input.inputValue(),scenario.text,'Review preserves the complete original draft');
    const after=await measure();
    for(const key of ['input','panel','hero','stage'])assertBounds(after[key],before[key],scenario.name+' after '+key);
    assert.equal(after.title,before.title,'Review preserves heading geometry and copy');
    assert.equal(after.scene,'ready','Correct text does not shrink the Q or add a floating check');
    assert.deepEqual(after.inputStyle,before.inputStyle);
    assert.ok(Math.abs(after.scrollY-during.scrollY)<1,'Publishing the review keeps the viewport in place');
    assert.equal(await page.locator('.review-view .text-result').count(),scenario.name.includes('issues')?1:0,'Correct drafts are not repeated as a second large text panel');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at '+scenario.width);
    if(scenario.text.length>=5000)assert.ok(await input.evaluate(element=>element.scrollHeight>element.clientHeight),'Long drafts scroll inside the same size field');
    await page.screenshot({path:resolve(root,scenario.name+'.png'),fullPage:true});
    await input.focus();
    await input.evaluate(element=>element.setSelectionRange(5,5));
    await page.keyboard.type('x');
    await page.locator('.view-editor').waitFor();
    assert.equal(await page.locator('.review-view').count(),0,'Editing clears stale results');
    assert.equal(await page.evaluate(element=>document.querySelector('#english-input')===element,node),true,'Editing does not remount the field');
    assert.deepEqual(await input.evaluate(element=>({focused:document.activeElement===element,selection:element.selectionStart})),{focused:true,selection:6},'Editing retains focus and selection');
    results.push({name:scenario.name,before,after});
  }
  await page.locator('header .interface-language-capsule').getByRole('button',{name:'Español',exact:true}).click();
  await page.setViewportSize({width:1440,height:1100});
  const input=page.locator('#english-input'),node=await input.elementHandle();
  async function review(text){
    await input.fill(text);
    await page.getByRole('button',{name:'Revisar mi texto',exact:true}).click();
    await page.getByRole('button',{name:'Cancelar revisión',exact:true}).waitFor();
    await pendingReview();pendingReview=null;
    await page.locator('.review-view').waitFor();
  }
  await review('I like coffee.');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.testCopiedText=text;}}}));
  await page.getByRole('button',{name:'Copiar texto',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.testCopiedText),'I like coffee.','Copy uses the reviewed draft without touching the system clipboard in this test');
  await page.getByRole('button',{name:'Sugerir una mejora',exact:true}).click();
  await page.getByText('No hace falta mejorar este texto. Lo sencillo también está bien.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Escribir otro',exact:true}).click();
  assert.equal(await input.inputValue(),'','Write another starts an empty draft');
  assert.equal(await page.locator('.review-view').count(),0);
  assert.equal(await page.evaluate(element=>document.querySelector('#english-input')===element,node),true,'Write another retains the same input');
  await page.waitForFunction(()=>document.activeElement===document.querySelector('#english-input'));
  await input.fill('I like tea.');
  await page.getByRole('button',{name:'Revisar mi texto',exact:true}).click();
  await page.getByRole('button',{name:'Cancelar revisión',exact:true}).click();
  await pendingReview();pendingReview=null;
  assert.equal(await input.inputValue(),'I like tea.');
  assert.equal(await input.getAttribute('readonly'),null,'Cancel restores editing');
  assert.equal(await page.locator('.review-view').count(),0,'Cancelled review does not publish stale results');
  improvementSuggestions=[{after:'I enjoy coffee.',reason:'Una mejora opcional de prueba.'}];
  await review('I like coffee.');
  await page.getByRole('button',{name:'Sugerir una mejora',exact:true}).click();
  await page.getByRole('button',{name:'Usar esta versión en el editor',exact:true}).click();
  assert.equal(await input.inputValue(),'I enjoy coffee.');
  assert.equal(await page.locator('.review-view').count(),0,'Using an optional version clears its previous analysis');
  assert.equal(await page.evaluate(element=>document.querySelector('#english-input')===element,node),true);
  await review("She don't like coffee.");
  await page.getByRole('button',{name:'Practicar este error',exact:true}).click();
  await page.locator('.mode-grid').waitFor();
  await page.getByRole('button',{name:'Volver',exact:true}).click();
  await page.locator('.review-view').waitFor();
  assert.equal(await input.inputValue(),"She don't like coffee.",'Returning from practice restores the original draft');
  await page.getByLabel('Variante de inglés',{exact:true}).selectOption('en-GB');
  assert.equal(await input.inputValue(),"She don't like coffee.");
  assert.equal(await page.locator('.review-view').count(),0,'Changing the writing variety invalidates an old review');
  await page.getByRole('button',{name:'Pausar animaciones',exact:true}).click();
  assert.equal(await page.locator('.app').getAttribute('data-motion'),'off');
  const frames=await page.locator('.orbit-scene').getAttribute('data-frames');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.orbit-scene').getAttribute('data-frames'),frames,'The pause preference stops orbit frames');
  await page.reload();
  await page.getByText('IA local lista',{exact:true}).waitFor();
  assert.equal(await page.locator('.app').getAttribute('data-motion'),'off','The saved pause preference survives a reload');
  await page.evaluate(()=>localStorage.removeItem('mistakequest.orbit.motion'));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.reload();
  await page.getByText('IA local lista',{exact:true}).waitFor();
  assert.equal(await page.locator('.app').getAttribute('data-motion'),'off','The system reduced-motion preference is respected');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  writeFileSync(resolve(root,'result.json'),JSON.stringify({passed:true,results,errors,external},null,2));
  console.log('Stable writing field, ES/EN review geometry, long drafts, focus, actions, cancellation, and motion preferences: OK');
  console.log(root);
}finally{
  await pendingReview?.();
  await browser?.close();
  await server.close();
}
