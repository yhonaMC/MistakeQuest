import test from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../service/store.js';import {AppError} from '../service/config.js';
let buildApp;try{({buildApp}=await import('../service/app.js'));}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
test('local API is implemented',()=>assert.equal(typeof buildApp,'function','Functional local API is missing'));
if(buildApp){
  const headers={'host':'127.0.0.1:3210','origin':'http://127.0.0.1:3210','x-mistakequest':'1'};
  const engines={health:async()=>({ollama:true,languageTool:true,modelReady:true,models:[{name:'qwen3:8b'}]}),check:async()=>({matches:[]}),chat:async()=>({value:{isEnglish:true,issues:[],uncertain:false},timing:{seconds:.1}})};
  test('correct own text stays exact and never creates a game source',async()=>{
    const store=new Store(':memory:'),app=await buildApp({store,engines});
    const response=await app.inject({method:'POST',url:'/api/analyze',headers,payload:{text:'I like coffee.',locale:'en-US'}});assert.equal(response.statusCode,200);assert.equal(response.json().correctedText,'I like coffee.');assert.equal(response.json().issues.length,0);assert.equal(store.progress().totals.detections,0);
    const game=await app.inject({method:'POST',url:'/api/games',headers,payload:{issueId:response.json().id,mode:'choice'}});assert.equal(game.statusCode,404);await app.close();store.close();
  });
  test('engine failure never records a successful review',async()=>{
    const store=new Store(':memory:'),app=await buildApp({store,engines:{...engines,chat:async()=>{throw new AppError('OLLAMA_OFFLINE','Motor apagado.',503);}}});
    const result=await app.inject({method:'POST',url:'/api/analyze',headers,payload:{text:'I have a question.'}});assert.equal(result.statusCode,503);assert.equal(store.progress().totals.reviews,0);await app.close();store.close();
  });
  test('rejects cross-origin, foreign host, oversized text and unconfirmed delete',async()=>{
    const store=new Store(':memory:'),app=await buildApp({store,engines});
    const request={method:'POST',url:'/api/analyze',headers,payload:{text:'I like coffee.'}};
    assert.equal((await app.inject({...request,headers:{...headers,origin:'https://example.com'}})).statusCode,403);
    assert.equal((await app.inject({...request,headers:{...headers,host:'evil.example:3210'}})).statusCode,403);
    assert.equal((await app.inject({...request,payload:{text:'a'.repeat(6001)}})).statusCode,400);
    assert.equal((await app.inject({method:'DELETE',url:'/api/data',headers,payload:{confirmation:'no'}})).statusCode,400);
    await app.close();store.close();
  });
}
