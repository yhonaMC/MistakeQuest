import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../service/store.js';
import {GameService} from '../service/games.js';

test('a retired neighboring false correction cannot contaminate a real source exercise',async()=>{
  const store=new Store(':memory:');
  try{
    const text='I often work in english.',[work,english]=store.saveAnalysis({key:text,locale:'en-US',status:'issues',originalText:text,correctedText:'I often working in English.',issues:[
      {offset:8,length:4,original:'work',replacement:'working',category:'verb_form',sentence:text,explanation:'Corrección histórica falsa.'},
      {offset:16,length:7,original:'english',replacement:'English',category:'capitalization',sentence:text,explanation:'El idioma lleva mayúscula.'}
    ]}).issues;
    store.saveBank(work.id,{validatorVersion:9,status:'already_correct',items:[],context:text},'test');
    const engines={check:async value=>({matches:[
      ...value.includes('working')?[{offset:value.indexOf('working'),length:7,replacements:[{value:'work'}],rule:{id:'BAD_GERUND'}}]:[],
      ...value.includes('english')?[{offset:value.indexOf('english'),length:7,replacements:[{value:'English'}],rule:{id:'ENGLISH_UPPERCASE'}}]:[]
    ]}),chat:async()=>{throw Error('Additional generation unavailable');}};
    const game=await new GameService(store,engines).create(english.id,'repair'),saved=store.game(game.id);
    assert.equal(game.mode,'repair');
    assert.equal(saved.privateData.item.bad,text);
    assert.equal(saved.privateData.item.good,'I often work in English.');
    assert.equal(store.progress().patterns.length,1);
  }finally{store.close();}
});

test('reclassifying a historical source before opening a game cannot award duplicate XP',async()=>{
  const store=new Store(':memory:');
  try{
    const text='She study English.',issue=store.saveAnalysis({key:text,locale:'en-US',status:'issues',originalText:text,correctedText:'She studies English.',issues:[{offset:4,length:5,original:'study',replacement:'studies',category:'verb_tense',sentence:text,explanation:'Etiqueta histórica de tiempo.'}]}).issues[0];
    const engines={check:async value=>({matches:value===text?[{offset:4,length:5,replacements:[{value:'studies'}],rule:{id:'HE_VERB_AGR'}}]:[]}),chat:async()=>{throw Error('Additional generation unavailable');}},service=new GameService(store,engines),rewards=[],keys=[];
    for(let index=0;index<3;index++){
      const game=await service.create(issue.id,'choice');
      assert.equal(game.category,'agreement');
      keys.push(store.game(game.id).exerciseKey);
      rewards.push((await service.attempt(game.id,{answer:'1',idempotencyKey:'reclassified-repeat-'+index})).xpEarned);
    }
    assert.deepEqual(rewards,[20,0,0]);
    assert.equal(new Set(keys).size,1);
    assert.equal(store.progress().totals.xp,20);
    assert.equal(store.progress().totals.completedGames,3);
  }finally{store.close();}
});
