import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../service/store.js';
import {GameService,makeGame} from '../service/games.js';

function saveOrderGame(store,{bad,good,original,replacement}){
  const source=store.saveAnalysis({key:bad,locale:'en-US',status:'issues',originalText:bad,correctedText:good,issues:[{offset:bad.indexOf(original),length:original.length,original,replacement,sentence:bad,category:'word_order',explanation:'Conserva las palabras y corrige su orden.'}]}).issues[0];
  const bank={explanation:source.explanation,hint:'Revisa el orden.',items:[{bad,good,original,replacement,alternatives:[],alternateOrders:[]}]};
  return store.createGame(makeGame(source,bank,'order'));
}

test('the unchanged erroneous tile order cannot earn XP even when both engines would approve it',async()=>{
  const store=new Store(':memory:');
  let grammarChecks=0,semanticChecks=0;
  const engines={check:async()=>{grammarChecks++;return {matches:[]};},chat:async()=>{semanticChecks++;return {value:{valid:true}};}};
  try{
    const game=saveOrderGame(store,{bad:'I do not know where is my notebook.',good:'I do not know where my notebook is.',original:'is my notebook',replacement:'my notebook is'});
    const service=new GameService(store,engines);
    const original=await service.attempt(game.id,{idempotencyKey:'original-order',tokenIds:[0,1,2,3,4,7,5,6]});
    assert.equal(original.correct,false,'Punctuation removed from tiles must not disguise the original erroneous word order');
    assert.equal(original.completed,false);
    assert.equal(original.xpEarned,0);
    assert.equal(store.game(game.id).completed,false);
    assert.equal(store.progress().totals.xp,0);
    assert.equal(grammarChecks,0,'A known unchanged original does not require another grammar decision');
    assert.equal(semanticChecks,0,'A model cannot override the unchanged original');
    const canonical={idempotencyKey:'correct-order',tokenIds:[0,1,2,3,4,5,6,7]};
    const result=await service.attempt(game.id,canonical);
    assert.equal(result.correct,true);
    assert.equal(result.completed,true);
    assert.equal(result.correctedSentence,'I do not know where my notebook is.');
    assert.equal(result.xpEarned,20);
    assert.deepEqual(await service.attempt(game.id,canonical),JSON.parse(JSON.stringify(result)));
    assert.equal(store.progress().totals.xp,20);
    assert.equal(store.progress().totals.completedGames,1);
    assert.equal(store.progress().totals.attempts,2);
    assert.equal(grammarChecks,0);
    assert.equal(semanticChecks,0);
  }finally{store.close();}
});

test('a different valid tile order still reaches grammar and meaning verification',async()=>{
  const store=new Store(':memory:'),checked=[],judged=[];
  const alternative='I go by bus to school every day';
  const engines={
    check:async text=>{checked.push(text);return {matches:text===alternative?[]:[{rule:{id:'UNEXPECTED_SENTENCE'}}]};},
    chat:async(schema,prompt,input)=>{judged.push(input);return {value:{valid:input.alternative===alternative&&input.expected==='I go to school by bus every day.'}};}
  };
  try{
    const game=saveOrderGame(store,{bad:'I by bus go to school every day.',good:'I go to school by bus every day.',original:'I by bus go to school every day.',replacement:'I go to school by bus every day.'});
    const result=await new GameService(store,engines).attempt(game.id,{idempotencyKey:'neutral-alternative',tokenIds:[0,1,4,5,2,3,6,7]});
    assert.equal(result.correct,true);
    assert.equal(result.completed,true);
    assert.equal(result.correctedSentence,'I go by bus to school every day.');
    assert.equal(result.xpEarned,20);
    assert.deepEqual(checked,[alternative]);
    assert.equal(judged.length,1);
    assert.equal(judged[0].bad,'I by bus go to school every day.');
    assert.equal(judged[0].alternative,alternative);
  }finally{store.close();}
});
