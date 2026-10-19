import test from 'node:test';import assert from 'node:assert/strict';
import {wordEdits,verifiedSpellingEdits} from '../service/spelling.js';
import {applyEdits} from '../service/edits.js';
test('aligns repeated words independently and preserves original punctuation',()=>{
  const text='I think tha this is better tha that.';
  const edits=wordEdits(text,'I think that this is better than that!');
  assert.equal(applyEdits(text,edits),'I think that this is better than that.');
  assert.deepEqual(edits.map(e=>[e.original,e.replacement]),[['tha','that'],['tha','than']]);
});
test('keeps adjacent spelling fixes separate and maps UTF16 positions',()=>{
  const text='🙂 A smal hous.';const edits=wordEdits(text,'🙂 A small house.');
  assert.equal(applyEdits(text,edits),'🙂 A small house.');assert.equal(edits.length,2);assert.equal(edits[0].offset,text.indexOf('smal'));
});
test('supports splitting and joining misspelled words',()=>{
  assert.equal(applyEdits('It is alot of fun.',wordEdits('It is alot of fun.','It is a lot of fun.')),'It is a lot of fun.');
  assert.equal(applyEdits('Some one is here.',wordEdits('Some one is here.','Someone is here.')),'Someone is here.');
});
test('accepts only source-anchored dictionary corrections and keeps correct vocabulary',()=>{
  const text='I think tha this book is nice.',matches=[{offset:8,length:8,replacements:[{value:'that this'},{value:'than this'}]}];
  const result=verifiedSpellingEdits(text,'I think that this book is wonderful!',matches);
  assert.equal(applyEdits(text,result.edits),'I think that this book is nice.');
  const unsupported=verifiedSpellingEdits(text,'I think how this book is nice.',matches);assert.equal(unsupported.edits.length,0);assert.equal(unsupported.unverifiable,true);
});
test('a dictionary acronym alone never establishes an intended word',()=>{
  const result=verifiedSpellingEdits('your dia','your DIA',[{offset:5,length:3,replacements:[{value:'DIA'},{value:'day'}]}]);assert.equal(result.edits.length,0);assert.equal(result.unverifiable,true);assert.equal(result.notices[0].original,'dia');
});
test('a changed text cannot overrule an uncertain spelling decision',()=>{
  const result=verifiedSpellingEdits('your dia','your day',[{offset:5,length:3,replacements:[{value:'day'}]}],[{index:0,action:'uncertain',reason:'Hace falta contexto.',foreignLanguage:''}]);assert.equal(result.edits.length,0);assert.equal(result.unverifiable,true);assert.equal(result.notices.length,1);
});
