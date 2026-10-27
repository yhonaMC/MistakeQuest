import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../service/store.js';
import {Reviewer} from '../service/review.js';

function engineFor({primaryIssues=[],tokens,check=()=>({matches:[]})}={}){
  const structureInputs=[],checkedTexts=[];
  return {structureInputs,checkedTexts,engines:{
    check:async text=>{checkedTexts.push(text);return check(text);},
    chat:async(schema,prompt,input)=>{
      let value;
      if(schema.shape.tokens){structureInputs.push(input);value={tokens:typeof tokens==='function'?tokens(input):tokens};}
      else if(schema.shape.issues)value={isEnglish:true,uncertain:false,issues:primaryIssues};
      else throw new Error('Unexpected review pass');
      return {value:schema.parse(value),timing:{seconds:.1}};
    }
  }};
}

test('a missed indirect question still reaches restricted structural repair beside an unrelated agreement correction',async()=>{
  const store=new Store(':memory:'),text='She walk to school. I do not know where is my notebook.';
  const fixture=engineFor({primaryIssues:[{original:'walk',replacement:'walks',sentence:'She walk to school.',category:'agreement',explanation:'Con she usa walks.',confidence:.99}],tokens:['I','do','not','know','where','my','notebook','is']});
  try{
    const result=await new Reviewer(store,fixture.engines).analyze(text,'en-US');
    assert.equal(result.correctedText,'She walks to school. I do not know where my notebook is.');
    assert.equal(result.issues.length,2);
    const order=result.issues.find(issue=>issue.category==='word_order');
    assert.equal(order.original,'I do not know where is my notebook.');assert.equal(order.replacement,'I do not know where my notebook is.');assert.equal(order.offset,20);
    assert.equal(fixture.structureInputs.length,1);assert.equal(fixture.structureInputs[0].text,'I do not know where is my notebook.');
    assert.ok(fixture.checkedTexts.includes('I do not know where my notebook is.'),'The structural candidate must reach the independent grammar check');
    assert.equal(store.progress().totals.detections,2);
  }finally{store.close();}
});

for(const [text,tokens,expected] of [
  ['I remember where are the keys.',['I','remember','where','the','keys','are'],'I remember where the keys are.'],
  ['I wonder where was my notebook.',['I','wonder','where','my','notebook','was'],'I wonder where my notebook was.']
])test(`an unflagged bounded indirect question can be verified without any initial issue: ${text}`,async()=>{
  const store=new Store(':memory:'),fixture=engineFor({tokens});
  try{
    const result=await new Reviewer(store,fixture.engines).analyze(text,'en-US');
    assert.equal(result.correctedText,expected);assert.equal(result.issues.length,1);assert.equal(result.issues[0].category,'word_order');
    assert.equal(fixture.structureInputs.length,1);assert.ok(fixture.checkedTexts.includes(expected));
  }finally{store.close();}
});

for(const text of [
  'Where is my notebook?',
  'I wonder, "Where is my notebook?"',
  'I remember "Where Is My Notebook?"',
  'I do not know what is wrong.',
  'I do not know where my notebook is.',
  'I remember where the keys are.',
  'I do not know where is my old blue notebook that I bought last year.'
])test(`a bounded indirect-question trigger leaves valid or excluded text unchanged: ${text}`,async()=>{
  const store=new Store(':memory:'),fixture=engineFor();
  try{
    const result=await new Reviewer(store,fixture.engines).analyze(text,'en-US');
    assert.equal(result.correctedText,text);assert.equal(result.issues.length,0);assert.equal(result.status,'correct');
    assert.equal(fixture.structureInputs.length,0,'A direct/quoted question, valid what-clause, correct order or long sentence must not request a structural repair');
    assert.equal(store.progress().totals.detections,0);
  }finally{store.close();}
});

test('triggering a structural review never forces a change when the restricted engine preserves the sentence',async()=>{
  const store=new Store(':memory:'),text='I do not know where is my notebook.',fixture=engineFor({tokens:['I','do','not','know','where','is','my','notebook']});
  try{
    const result=await new Reviewer(store,fixture.engines).analyze(text,'en-US');
    assert.equal(fixture.structureInputs.length,1);assert.equal(result.correctedText,text);assert.equal(result.issues.length,0);
  }finally{store.close();}
});

test('independent grammar validation can reject an unflagged structural candidate',async()=>{
  const store=new Store(':memory:'),text='I do not know where is my notebook.',candidate='I do where not know my notebook is.';
  const fixture=engineFor({tokens:['I','do','where','not','know','my','notebook','is'],check:value=>({matches:value===candidate?[{offset:0,length:candidate.length,replacements:[],rule:{id:'INVALID_REORDER',issueType:'grammar'},message:'Invalid order'}]:[]})});
  try{
    const result=await new Reviewer(store,fixture.engines).analyze(text,'en-US');
    assert.equal(fixture.structureInputs.length,1);assert.ok(fixture.checkedTexts.includes(candidate));
    assert.equal(result.correctedText,text);assert.equal(result.issues.length,0);assert.equal(store.progress().totals.detections,0);
  }finally{store.close();}
});

test('a curly contraction does not suppress a genuine indirect-question structural review',async()=>{
  const store=new Store(':memory:'),text='I don’t know where is my notebook.',fixture=engineFor({tokens:['I','don’t','know','where','my','notebook','is']});
  try{
    const result=await new Reviewer(store,fixture.engines).analyze(text,'en-US');
    assert.equal(result.correctedText,'I don’t know where my notebook is.');assert.equal(result.issues.length,1);
    assert.equal(result.issues[0].category,'word_order');assert.equal(fixture.structureInputs.length,1);
  }finally{store.close();}
});

test('a whole sentence in straight single quotes does not trigger structural rewriting or lose quotation marks',async()=>{
  const store=new Store(':memory:'),text="'I do not know where is my notebook.'",fixture=engineFor({tokens:['I','do','not','know','where','is','my','notebook']});
  try{
    const result=await new Reviewer(store,fixture.engines).analyze(text,'en-US');
    assert.equal(fixture.structureInputs.length,0);assert.equal(result.correctedText,text);assert.equal(result.issues.length,0);
  }finally{store.close();}
});
