import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../service/store.js';
import {GameService} from '../service/games.js';

function seed(store,text,original,replacement,category){
  return store.saveAnalysis({key:text,locale:'en-US',status:'issues',originalText:text,correctedText:text,issues:[{offset:text.indexOf(original),length:original.length,original,replacement,category,sentence:text,explanation:'Corrección histórica.'}]}).issues[0];
}

test('discarding a false historical subcorrection preserves the real capitalization error',async()=>{
  const store=new Store(':memory:');
  try{
    const text='I often work in english.',issue=seed(store,text,text,'I often working in English.','verb_form');
    const engines={
      check:async value=>({matches:[
        ...value.includes('working')?[{offset:value.indexOf('working'),length:7,replacements:[{value:'work'}],rule:{id:'BAD_GERUND'}}]:[],
        ...value.includes('english')?[{offset:value.indexOf('english'),length:7,replacements:[{value:'English'}],rule:{id:'ENGLISH_UPPERCASE'}}]:[]
      ]}),
      chat:async(schema,prompt,input)=>{
        if(schema.shape.items)throw Error('Additional generation unavailable');
        if(schema.shape.needsCorrection)return {value:{needsCorrection:false,replacement:'work',explanation:'El presente con I ya es correcto.'}};
        if(schema.shape.correctedText)return {value:{correctedText:input.text.replace(/\bworking\b/g,'work').replace(/\benglish\b/g,'English')}};
        return {value:{decisions:input.candidates.map(candidate=>({index:candidate.index,needsCorrection:candidate.original.toLowerCase().startsWith('english'),replacement:candidate.original.replace('english','English')}))}};
      }
    };
    const result=await new GameService(store,engines).create(issue.id,'repair');
    assert.equal(result.mode,'repair');
    const saved=store.game(result.id),item=saved.privateData.item;
    assert.equal(item.bad,'I often work in english.');
    assert.equal(item.good,'I often work in English.');
    assert.equal(result.category,'capitalization');
    assert.equal(store.progress().patterns.length,1);
    assert.equal(store.progress().totals.detections,1);
  }finally{store.close();}
});

test('fresh LanguageTool agreement evidence rescues an old study-to-studies tense label',async()=>{
  const store=new Store(':memory:');
  try{
    const text='She study English.',issue=seed(store,text,'study','studies','verb_tense');
    const engines={check:async value=>({matches:value===text?[{offset:4,length:5,replacements:[{value:'studies'}],rule:{id:'HE_VERB_AGR'}}]:[]}),chat:async()=>{throw Error('Additional generation unavailable');}};
    const result=await new GameService(store,engines).create(issue.id,'repair');
    assert.equal(result.mode,'repair');
    assert.equal(result.category,'agreement');
    assert.equal(store.game(result.id).privateData.item.good,'She studies English.');
    assert.equal(store.progress().patterns.length,1);
  }finally{store.close();}
});
