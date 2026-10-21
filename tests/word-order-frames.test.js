import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../service/store.js';
import * as Games from '../service/games.js';

const original='I do not know where is my notebook.';
const replacement='I do not know where my notebook is.';
const issue={id:'notebook-frames',offset:0,length:original.length,original,replacement,sentence:original,category:'word_order',label:'Orden de palabras',explanation:'Coloca el sujeto antes del verbo.'};
const frames={frames:['She does not know where {{target}}.','We cannot remember where {{target}}.','Can you tell me where {{target}}?'],explanation:'En una pregunta indirecta, el sujeto va antes del verbo.',hint:'Busca el sujeto de la pregunta indirecta.'};

function assemble(value=frames){
  assert.equal(typeof Games.assembleWordOrderFrames,'function','Word-order contexts must be assembled locally around the confirmed correction');
  return Games.assembleWordOrderFrames(value,issue);
}

test('word-order frames keep the confirmed notebook words in every new context',()=>{
  const result=assemble();
  assert.equal(result.explanation,frames.explanation);
  assert.equal(result.hint,frames.hint);
  assert.deepEqual(result.items.map(item=>[item.bad,item.good,item.original,item.replacement]),[
    ['She does not know where is my notebook.','She does not know where my notebook is.','is my notebook','my notebook is'],
    ['We cannot remember where is my notebook.','We cannot remember where my notebook is.','is my notebook','my notebook is'],
    ['Can you tell me where is my notebook?','Can you tell me where my notebook is?','is my notebook','my notebook is']
  ]);
});

test('frames without exactly one target placeholder cannot become exercises',()=>{
  const result=assemble({...frames,frames:['She does not know where {{target}}.','She cannot find her phone.','{{target}} and {{target}}.','Where is {{TARGET}}?']});
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].bad,'She does not know where is my notebook.');
  assert.equal(result.items[0].good,'She does not know where my notebook is.');
});

test('frame response fields cannot replace the confirmed correction with another object',()=>{
  const result=assemble({...frames,original:'is her phone',replacement:'her phone is',items:[{bad:'Where is her phone?',good:'Where her phone is?'}]});
  assert.equal(result.items.length,3);
  assert.ok(result.items.every(item=>item.original==='is my notebook'&&item.replacement==='my notebook is'));
  assert.ok(result.items.every(item=>!item.bad.includes('phone')&&!item.good.includes('phone')));
});

test('locally assembled word-order frames still reject grammar errors in their context',async()=>{
  const result=assemble({...frames,frames:['She do not know where {{target}}.']});
  assert.equal(result.items.length,1);
  const engines={check:async text=>({matches:text==='She do not know where my notebook is.'?[{offset:4,length:2,replacements:[{value:'does'}],rule:{id:'HE_VERB_AGR',issueType:'grammar'}}]:[]})};
  const checked=await Games.validateBank(result,issue,engines,'en-US');
  assert.deepEqual(checked.items,[],'The context must pass the existing grammar check after inserting the exact correction');
});

test('word-order bank generation persists varied exact corrections from verified frames',async()=>{
  const store=new Store(':memory:'),checkedTexts=[];
  try{
    const saved=store.saveAnalysis({key:'word-order-context-frames',locale:'en-US',status:'issues',originalText:original,correctedText:replacement,issues:[issue]}).issues[0];
    const engines={
      check:async text=>{checkedTexts.push(text);return {matches:[]};},
      chat:async(schema,prompt,input)=>{
        if(schema.shape.frames)return {value:frames};
        if(schema.shape.decisions)return {value:{decisions:input.candidates.map(candidate=>({index:candidate.index,needsCorrection:true,replacement:'my notebook is'}))}};
        if(schema.shape.correctedText)return {value:{correctedText:input.text.replace('is my notebook','my notebook is')}};
        throw Error('Word-order variety must request context frames rather than another correction pair');
      }
    };
    const result=await new Games.GameService(store,engines).bank(saved,'en-US');
    assert.ok(new Set(result.items.map(item=>item.good)).size>=3,'The bank must retain at least three different verified complete sentences');
    assert.ok(result.items.some(item=>item.bad==='She does not know where is my notebook.'));
    assert.ok(result.items.some(item=>item.bad==='We cannot remember where is my notebook.'));
    assert.ok(result.items.every(item=>item.original==='is my notebook'&&item.replacement==='my notebook is'));
    for(const item of result.items)assert.ok(checkedTexts.includes(item.good),'Every persisted corrected frame passes through the grammar engine');
    assert.deepEqual(store.getBank(saved.id).items,result.items);
  }finally{store.close();}
});
