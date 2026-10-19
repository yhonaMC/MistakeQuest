import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../service/store.js';
import {GameService,makeGame,evaluateGame} from '../service/games.js';

const bad='I was working on past continuos tense with my teacher.';
const good='I was working on past continuous tense with my teacher.';
const issue={id:'spelling',category:'spelling',original:'continuos',replacement:'continuous',sentence:bad,explanation:'El tiempo verbal se escribe continuous.'};
const bank={explanation:issue.explanation,hint:'Revisa la ortografía.',items:[{bad,good,original:'continuos',replacement:'continuous',alternatives:[],alternateOrders:[]}]};
function savedGame(store,source=issue,practice=bank){
  const analysis=store.saveAnalysis({key:'repair-sentence',locale:'en-US',status:'issues',originalText:practice.items[0].bad,correctedText:practice.items[0].good,issues:[{...source,offset:practice.items[0].bad.indexOf(source.original),length:source.original.length}]});
  return store.createGame(makeGame(analysis.issues[0],practice,'repair'));
}

test('repair accepts the screenshot full corrected sentence without inserting it into the target',()=>{
  const game=makeGame(issue,bank,'repair');
  for(const answer of ['continuous',good,'  I was working on past  continuous tense with my teacher.  ']){
    const result=evaluateGame(game,{answer});
    assert.equal(result.correct,true,answer);
    assert.equal(result.response.correctedSentence,good);
  }
});

test('a full corrected sentence completes once and preserves idempotent rewards',async()=>{
  const store=new Store(':memory:');
  const engines={check:async()=>{throw Error('An exact correction does not need another engine call');}};
  try{
    const game=savedGame(store),games=new GameService(store,engines),answer={answer:good,idempotencyKey:'same-submission'};
    const result=await games.attempt(game.id,answer);
    assert.equal(result.correct,true);assert.equal(result.completed,true);assert.equal(result.correctedSentence,good);assert.equal(result.xpEarned,20);
    assert.deepEqual(await games.attempt(game.id,answer),JSON.parse(JSON.stringify(result)));
    assert.equal((await games.attempt(game.id,{answer:'continuous',idempotencyKey:'after-completion'})).xpEarned,0);
    const totals=store.progress().totals;
    assert.equal(totals.completedGames,1);assert.equal(totals.attempts,1);assert.equal(totals.xp,20);
  }finally{store.close();}
});

test('repair rejects the original, duplicated context, and unrelated vocabulary before semantic verification',async()=>{
  const store=new Store(':memory:'),engines={check:async()=>{throw Error('An unrelated proposal must not reach verification');}};
  try{
    const game=savedGame(store),games=new GameService(store,engines);
    for(const answer of [bad,'continuos',bad.replace('continuos',good),good.replace('teacher','friend'),good.replace('was','is')]){
      const result=await games.attempt(game.id,{answer,idempotencyKey:answer});
      assert.equal(result.correct,false,answer);assert.equal(result.xpEarned,0);
    }
    assert.equal(store.progress().totals.completedGames,0);
  }finally{store.close();}
});

test('repair verifies a full alternative as submitted and returns that complete sentence',async()=>{
  const store=new Store(':memory:'),source={...issue,category:'agreement',original:"don't",replacement:"doesn't",sentence:"She don't like tea."};
  const practice={...bank,items:[{bad:source.sentence,good:"She doesn't like tea.",original:"don't",replacement:"doesn't",alternatives:[],alternateOrders:[]}]};
  const alternative='She does not like tea.';
  const engines={check:async sentence=>({matches:sentence===alternative?[]:[{rule:{id:'WRONG'}}]}),chat:async(schema,prompt,input)=>({value:{valid:input.alternative===alternative&&input.expected==="She doesn't like tea."}})};
  try{
    const game=savedGame(store,source,practice),result=await new GameService(store,engines).attempt(game.id,{answer:alternative,idempotencyKey:'expanded'});
    assert.equal(result.correct,true);assert.equal(result.correctedSentence,alternative);assert.equal(result.xpEarned,20);
  }finally{store.close();}
});

test('a same-word sentence with a different meaning is rejected by semantic verification',async()=>{
  const store=new Store(':memory:'),source={...issue,category:'agreement',original:'bite',replacement:'bites',sentence:'The dog bite the man.'};
  const practice={...bank,items:[{bad:source.sentence,good:'The dog bites the man.',original:'bite',replacement:'bites',alternatives:[],alternateOrders:[]}]};
  const engines={check:async()=>({matches:[]}),chat:async()=>({value:{valid:false}})};
  try{
    const game=savedGame(store,source,practice),result=await new GameService(store,engines).attempt(game.id,{answer:'The man bites the dog.',idempotencyKey:'roles'});
    assert.equal(result.correct,false);assert.equal(store.progress().totals.xp,0);
  }finally{store.close();}
});

test('full repair answers must retain the target capitalization even when a model would agree',async()=>{
  const store=new Store(':memory:'),source={...issue,category:'capitalization',original:'english',replacement:'English',sentence:'I speak english.'};
  const practice={...bank,items:[{bad:source.sentence,good:'I speak English.',original:'english',replacement:'English',alternatives:[],alternateOrders:[]}]};
  const engines={check:async()=>({matches:[]}),chat:async()=>({value:{valid:true}})};
  try{
    const game=savedGame(store,source,practice),result=await new GameService(store,engines).attempt(game.id,{answer:'I speak english.',idempotencyKey:'case'});
    assert.equal(result.correct,false);assert.equal(store.progress().totals.xp,0);
  }finally{store.close();}
});

test('the unchanged original word order cannot be approved as an alternative',async()=>{
  const store=new Store(':memory:'),source={...issue,category:'word_order',original:'I coffee like',replacement:'I like coffee',sentence:'I coffee like.'};
  const practice={...bank,items:[{bad:source.sentence,good:'I like coffee.',original:source.original,replacement:source.replacement,alternatives:[],alternateOrders:[]}]};
  const engines={check:async()=>({matches:[]}),chat:async()=>({value:{valid:true}})};
  try{
    const game=savedGame(store,source,practice),games=new GameService(store,engines);
    for(const answer of [source.sentence,source.original]){
      const result=await games.attempt(game.id,{answer,idempotencyKey:answer});
      assert.equal(result.correct,false);assert.equal(store.progress().totals.xp,0);
    }
  }finally{store.close();}
});
