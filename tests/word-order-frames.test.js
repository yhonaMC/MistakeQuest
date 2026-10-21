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

function derive(source=issue){
  assert.equal(typeof Games.deriveWordOrderFrames,'function','Verified indirect-question repairs need bounded local context candidates');
  return Games.deriveWordOrderFrames(source);
}

test('derived indirect-question frames use controlled complete contexts without altering the source',()=>{
  const before=JSON.stringify(issue);
  assert.deepEqual(derive(),[
    'Can you tell me where {{target}}?',
    'Do you know where {{target}}?',
    'I cannot remember where {{target}}.'
  ]);
  assert.equal(JSON.stringify(issue),before);
});

test('derived frames retain an unchanged predicate and negative suffix exactly once',()=>{
  const source={...issue,original:'I do not know why is he not ready.',replacement:'I do not know why he is not ready.',sentence:'I do not know why is he not ready.'};
  const result=derive(source);
  assert.deepEqual(result,[
    'Can you tell me why {{target}} not ready?',
    'Do you know why {{target}} not ready?',
    'I cannot remember why {{target}} not ready.'
  ]);
  const assembled=Games.assembleWordOrderFrames({...frames,frames:result},source);
  assert.deepEqual(assembled.items.map(item=>[item.bad,item.good]),[
    ['Can you tell me why is he not ready?','Can you tell me why he is not ready?'],
    ['Do you know why is he not ready?','Do you know why he is not ready?'],
    ['I cannot remember why is he not ready.','I cannot remember why he is not ready.']
  ]);
});

test('unrelated word-order corrections do not receive derived indirect-question frames',()=>{
  assert.deepEqual(derive({...issue,original:'Want I to learn English.',replacement:'I want to learn English.',sentence:'Want I to learn English.'}),[]);
});

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

test('an indirect-question frame retains the source introducer immediately before the target',()=>{
  const result={...frames,frames:['I wonder if {{target}}.','I think someone took {{target}}.','Can you tell me where {{target}}?']};
  const seed={...issue,original:'is my notebook',replacement:'my notebook is',sentence:original,targetOffset:20,targetLength:14};
  for(const source of [issue,seed]){
    const assembled=Games.assembleWordOrderFrames(result,source);
    assert.deepEqual(assembled.items.map(item=>[item.bad,item.good]),[
      ['Can you tell me where is my notebook?','Can you tell me where my notebook is?']
    ],'The original where context is required for both full issues and isolated source seeds');
  }
});

test('a repeated target phrase retains the introducer at its validated source position',()=>{
  const source={...issue,original:'is my notebook',replacement:'my notebook is',sentence:'I do not know where is my notebook, but is my notebook on the desk?',targetOffset:20,targetLength:14};
  const result=Games.assembleWordOrderFrames({...frames,frames:['I wonder if {{target}}.','I think someone took {{target}}.','Can you tell me where {{target}}?']},source);
  assert.deepEqual(result.items.map(item=>[item.bad,item.good]),[
    ['Can you tell me where is my notebook?','Can you tell me where my notebook is?']
  ],'Another copy of the target must not erase the context of the confirmed occurrence');
});

test('a different word-order repair does not acquire an unrelated question introducer',()=>{
  const source={...issue,original:'Want I to learn English.',replacement:'I want to learn English.',sentence:'Want I to learn English.',length:24};
  const result=Games.assembleWordOrderFrames({...frames,frames:['{{target}} to learn English.','{{target}} to read a book.','{{target}} to play outside.']},source);
  assert.deepEqual(result.items.map(item=>[item.bad,item.good]),[
    ['Want I to learn English.','I want to learn English.'],
    ['Want I to read a book.','I want to read a book.'],
    ['Want I to play outside.','I want to play outside.']
  ]);
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
      // Reject the derived candidates here so this scenario continues to exercise
      // model-generated She/We frames after the independent fallback was added.
      check:async text=>{checkedTexts.push(text);return {matches:/^(Can you tell me|Do you know|I cannot remember)\b/.test(text)?[{rule:{id:'REJECT_DERIVED_CONTEXT'}}]:[]};},
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

test('verified derived contexts provide varied practice when generative frames are unavailable',async()=>{
  const store=new Store(':memory:'),checked=[],audited=[];
  try{
    const saved=store.saveAnalysis({key:'derived-word-order-contexts',locale:'en-US',status:'issues',originalText:original,correctedText:replacement,issues:[issue]}).issues[0];
    const engines={
      check:async text=>{checked.push(text);return {matches:[]};},
      chat:async(schema,prompt,input)=>{
        if(schema.shape.frames)throw Error('Generative frames are unavailable');
        if(schema.shape.decisions){audited.push(...input.candidates.map(candidate=>candidate.context));return {value:{decisions:input.candidates.map(candidate=>({index:candidate.index,needsCorrection:true,replacement:'my notebook is'}))}};}
        if(schema.shape.correctedText)return {value:{correctedText:input.text.replace('is my notebook','my notebook is')}};
        throw Error('Unexpected generation schema');
      }
    };
    const result=await new Games.GameService(store,engines).bank(saved,'en-US');
    assert.ok(new Set(result.items.map(item=>item.good)).size>=3,'Verified source and derived contexts supply a varied bank without relying on model-written frames');
    const derived=result.items.filter(item=>item.origin==='derived_context');
    assert.equal(derived.length,3);
    for(const item of derived){
      assert.equal(item.original,'is my notebook');
      assert.equal(item.replacement,'my notebook is');
      assert.ok(checked.includes(item.good),'Each corrected derived candidate passes through the grammar engine');
      assert.ok(audited.includes(item.bad.replace('is my notebook','[[is my notebook]]')),'Each derived candidate is independently reviewed before persistence');
    }
    assert.deepEqual(store.getBank(saved.id).items,result.items);
  }finally{store.close();}
});

test('failed independent verification never promotes derived contexts over the verified source',async()=>{
  const store=new Store(':memory:');
  try{
    const saved=store.saveAnalysis({key:'unverified-derived-contexts',locale:'en-US',status:'issues',originalText:original,correctedText:replacement,issues:[issue]}).issues[0];
    const engines={
      check:async()=>({matches:[]}),
      chat:async(schema,prompt,input)=>{
        if(schema.shape.frames)throw Error('Generative frames are unavailable');
        if(schema.shape.decisions)return {value:{decisions:input.candidates.map(candidate=>({index:candidate.index,needsCorrection:candidate.context==='I do not know where [[is my notebook]].',replacement:candidate.context==='I do not know where [[is my notebook]].'?'my notebook is':candidate.original}))}};
        if(schema.shape.correctedText)return {value:{correctedText:input.text}};
        throw Error('Unexpected generation schema');
      }
    };
    const result=await new Games.GameService(store,engines).bank(saved,'en-US');
    assert.equal(result.items.length,1);
    assert.equal(result.items[0].bad,original);
    assert.equal(result.items[0].good,replacement);
    assert.ok(result.items.every(item=>item.origin!=='derived_context'));
    assert.deepEqual(store.getBank(saved.id).items,result.items);
  }finally{store.close();}
});
