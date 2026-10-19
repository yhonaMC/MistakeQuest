import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../service/store.js';
import {GameService} from '../service/games.js';

for(const example of [
  {name:'a necessary vocative comma',bad:'Thank you John.',good:'Thank you, John.',original:'you',replacement:'you,'},
  {name:'an invalid comma between subject and verb',bad:'My dog, likes to run.',good:'My dog likes to run.',original:'dog,',replacement:'dog'}
]){
  test(example.name+' remains a real correction with a playable source fallback',async()=>{
    const store=new Store(':memory:');
    try{
      const offset=example.bad.indexOf(example.original),issue=store.saveAnalysis({key:example.bad,locale:'en-US',status:'issues',originalText:example.bad,correctedText:example.good,issues:[{offset,length:example.original.length,original:example.original,replacement:example.replacement,category:'punctuation',sentence:example.bad,explanation:'Corrige una coma necesaria.'}]}).issues[0];
      const engines={check:async text=>({matches:text===example.bad?[{offset,length:example.original.length,replacements:[{value:example.replacement}],rule:{id:'REQUIRED_COMMA'}}]:[]}),chat:async()=>{throw Error('Extra generation unavailable');}};
      const result=await new GameService(store,engines).create(issue.id,'repair');
      assert.equal(result.mode,'repair');
      assert.equal(store.game(result.id).privateData.item.good,example.good);
      assert.equal(store.progress().patterns.length,1);
    }finally{store.close();}
  });
}
