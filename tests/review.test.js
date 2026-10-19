import test from 'node:test';import assert from 'node:assert/strict';
import {Store,digest} from '../service/store.js';import {Reviewer,REVIEW_VERSION} from '../service/review.js';

test('a cached review stops applying a historical correction revalidated as already correct',async()=>{
  const store=new Store(':memory:'),text='I work every day.';let calls=0;
  const engines={check:async()=>({matches:[]}),chat:async()=>{calls++;return {value:{isEnglish:true,uncertain:false,issues:[{original:'work',replacement:'working',sentence:text,category:'verb_form',explanation:'Una corrección antigua equivocada.',confidence:.99}]},timing:{seconds:1}};}};
  try{
    const reviewer=new Reviewer(store,engines),first=await reviewer.analyze(text,'en-US'),issue=first.issues[0];
    assert.equal(first.correctedText,'I working every day.');
    store.saveBank(issue.id,{status:'already_correct',items:[],explanation:'El presente simple ya es válido.'},'test');
    const before=store.export().tables,again=await reviewer.analyze(text,'en-US');
    assert.equal(again.cached,true);assert.equal(again.status,'correct');assert.equal(again.correctedText,text);assert.deepEqual(again.issues,[]);assert.equal(calls,1);
    assert.deepEqual(store.export().tables,before);assert.equal(store.issue(issue.id).replacement,'working');
  }finally{store.close();}
});
test('a fresh review filters already-correct history after saving while retaining other genuine corrections',async()=>{
  const store=new Store(':memory:'),text='I work every day. My brother work too.';
  const engines={check:async()=>({matches:[]}),chat:async()=>({value:{isEnglish:true,uncertain:false,issues:[{original:'work',replacement:'working',sentence:'I work every day.',category:'verb_form',explanation:'Una corrección histórica equivocada.',confidence:.99},{original:'work',replacement:'works',sentence:'My brother work too.',category:'agreement',explanation:'El sujeto es singular.',confidence:.99}]},timing:{seconds:1}})};
  try{
    const reviewer=new Reviewer(store,engines),first=await reviewer.analyze(text,'en-US'),historical=first.issues.find(issue=>issue.replacement==='working');
    store.saveBank(historical.id,{status:'already_correct',items:[]},'test');
    store.db.prepare('UPDATE analyses SET review_version=? WHERE id=?').run(REVIEW_VERSION-1,first.id);
    const fresh=await reviewer.analyze(text,'en-US');
    assert.equal(fresh.cached,false);assert.equal(fresh.status,'issues');assert.equal(fresh.correctedText,'I work every day. My brother works too.');assert.deepEqual(fresh.issues.map(issue=>issue.replacement),['works']);
    assert.equal(store.analysis(first.id).issues.length,2);assert.equal(store.issue(historical.id).id,historical.id);
  }finally{store.close();}
});

test('a valid short phrase does not require sentence capitalization',async()=>{
  const store=new Store(':memory:'),text='your day',engines={check:async()=>({matches:[]}),chat:async()=>({value:{isEnglish:true,uncertain:false,issues:[{original:'your',replacement:'Your',sentence:text,category:'capitalization',explanation:'Mayúscula al principio.',confidence:.99}]},timing:{seconds:1}})};
  try{assert.equal((await new Reviewer(store,engines).analyze(text,'en-US')).correctedText,text);}finally{store.close();}
});
test('word-order repair preserves vocabulary rather than adding a new content verb',async()=>{
  const store=new Store(':memory:'),text='Still is difficult to me this theme.';
  const engines={check:async()=>({matches:[]}),chat:async schema=>({value:schema.shape.tokens?{tokens:['This','theme','is','still','difficult','for','me']}:{isEnglish:true,uncertain:false,issues:[{original:text,replacement:'Still it is difficult for me to understand this theme.',sentence:text,category:'prepositions',explanation:'Orden y preposición.',confidence:.99}]},timing:{seconds:1}})};
  try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.correctedText,'This theme is still difficult for me.');assert.equal(result.issues[0].category,'word_order');}finally{store.close();}
});
test('word-order repair cannot drop negation or a pronoun while duplicating a preposition',async()=>{
  for(const tokens of [['This','theme','is','still','difficult','for','me','for','now'],['This','theme','is','still','not','difficult','for','for','now']]){
    const store=new Store(':memory:'),text='Still is not difficult to me this theme now.';
    const engines={check:async()=>({matches:[]}),chat:async schema=>({value:schema.shape.tokens?{tokens}:{isEnglish:true,uncertain:false,issues:[{original:text,replacement:'Still it is not difficult for me to understand this theme now.',sentence:text,category:'prepositions',explanation:'Orden y preposición.',confidence:.99}]},timing:{seconds:1}})};
    try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.correctedText,text);assert.equal(result.issues.length,0);}finally{store.close();}
  }
});
test('sentence punctuation combines with an independently confirmed verb correction',async()=>{
  const store=new Store(':memory:'),text='I study English every day and I practice with my teacher after work because I want to prepare for interviews. I hope my English improve bye';
  const engines={check:async()=>({matches:[]}),chat:async(schema,prompt,input)=>({value:schema.shape.correctedText?{correctedText:text.replace('improve bye','improve. Bye.')}:{isEnglish:true,uncertain:false,issues:input.text.includes('improve')?[{original:'improve',replacement:'improves',sentence:'I hope my English improve bye',category:'agreement',explanation:'English es singular.',confidence:.99}]:[]},timing:{seconds:1}})};
  try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.correctedText,text.replace('improve bye','improves. Bye.'));}finally{store.close();}
});

test('compound review corrections become separate source-anchored changes',async()=>{
  const store=new Store(':memory:'),text='I hope that my english improve bye';
  const engines={check:async()=>({matches:[]}),chat:async()=>({value:{isEnglish:true,uncertain:false,issues:[{original:text,replacement:'I hope that my English improves. Bye.',sentence:text,category:'verb_form',explanation:'Corrige la concordancia, las mayúsculas y el final de frase.',confidence:.99}]},timing:{seconds:1}})};
  try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.correctedText,'I hope that my English improves. Bye.');assert.deepEqual(result.issues.map(i=>i.original),['english','improve','bye']);}finally{store.close();}
});
test('review never truncates a long text to its first ten detected errors',async()=>{
  const store=new Store(':memory:'),text=Array.from({length:14},(_,i)=>`The code${i} work.`).join(' ');
  const engines={check:async()=>({matches:[]}),chat:async(schema,prompt,input)=>({value:schema.shape.correctedText?{correctedText:input.text}:{isEnglish:true,uncertain:false,issues:[...input.text.matchAll(/The code\d+ work\./g)].map(m=>({original:'work',replacement:'works',sentence:m[0],category:'agreement',explanation:'El sujeto es singular.',confidence:.99}))},timing:{seconds:1}})};
  try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.issues.length,14);assert.ok(!/\bwork\./.test(result.correctedText));}finally{store.close();}
});
test('a contextual spelling error can be confirmed even when it is a different valid dictionary word',async()=>{
  const store=new Store(':memory:'),text='I am learning the past continuos.';
  const engines={check:async()=>({matches:[]}),chat:async(schema)=>({value:schema.shape.needsCorrection?{needsCorrection:true,replacement:'continuous',explanation:'El nombre del tiempo verbal es past continuous.'}:{isEnglish:true,uncertain:false,issues:[{original:'continuos',replacement:'continuous',sentence:text,category:'spelling',explanation:'Nombre del tiempo verbal.',confidence:.99}]},timing:{seconds:1}})};
  try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.correctedText,'I am learning the past continuous.');assert.equal(result.issues[0].category,'spelling');}finally{store.close();}
});
test('clear past-tense correction survives a conservative model confidence score',async()=>{
  const store=new Store(':memory:');const engines={check:async()=>({matches:[]}),chat:async()=>({value:{isEnglish:true,uncertain:false,issues:[{original:'go',replacement:'went',sentence:'Yesterday I go home.',category:'verb_tense',explanation:'Usa pasado.',confidence:.9}]},timing:{}})};
  const result=await new Reviewer(store,engines).analyze('Yesterday I go home.','en-US');assert.equal(result.correctedText,'Yesterday I went home.');store.close();
});
test('present-tense agreement is classified as agreement rather than tense',async()=>{
  const store=new Store(':memory:');const engines={check:async()=>({matches:[]}),chat:async()=>({value:{isEnglish:true,uncertain:false,issues:[{original:'have',replacement:'has',sentence:'My brother have a dog.',category:'verb_tense',explanation:'Concordancia.',confidence:.95}]},timing:{}})};
  const result=await new Reviewer(store,engines).analyze('My brother have a dog.','en-US');assert.equal(result.issues[0].category,'agreement');store.close();
});
test('a correct present cannot be turned into past without time evidence',async()=>{
  const store=new Store(':memory:'),engines={check:async()=>({matches:[]}),chat:async()=>({value:{isEnglish:true,uncertain:false,issues:[{original:'go',replacement:'went',sentence:'I go to work.',category:'verb_tense',explanation:'Pasado.',confidence:.95}]},timing:{seconds:1}})};
  const result=await new Reviewer(store,engines).analyze('I go to work.','en-US');assert.equal(result.correctedText,'I go to work.');assert.equal(result.issues.length,0);store.close();
});
test('a proposal contradicted by grammar checking does not turn correct English into an error',async()=>{
  const store=new Store(':memory:'),engines={check:async text=>({matches:text.includes("doesn't")?[{offset:2,length:4,rule:{id:'HE_VERB_AGR'}}]:[]}),chat:async()=>({value:{isEnglish:true,uncertain:false,issues:[{original:"don't",replacement:"doesn't",sentence:"I don't have a car.",category:'agreement',explanation:'Concordancia.',confidence:.95}]},timing:{seconds:1}})};
  const result=await new Reviewer(store,engines).analyze("I don't have a car.",'en-US');assert.equal(result.status,'correct');assert.equal(result.correctedText,"I don't have a car.");store.close();
});
test('reviews each repeated spelling candidate at its verified source position',async()=>{
  const text='I think tha it works because she says tha it works.';
  const offsets=[...text.matchAll(/\btha\b/g)].map(match=>match.index),store=new Store(':memory:');
  const today=new Date(),key=digest({day:[today.getFullYear(),today.getMonth()+1,today.getDate()].join('-'),locale:'en-US',text});
  const prior=store.saveAnalysis({key,locale:'en-US',status:'uncertain',originalText:text,correctedText:text,issues:[],reviewVersion:0});
  const engines={check:async value=>({matches:[...value.matchAll(/\btha\b/g)].map(match=>({offset:match.index,length:3,replacements:[{value:'the'},{value:'that'}],rule:{id:'SPELLING',category:{id:'TYPOS'},issueType:'misspelling'},message:'Possible typo'}))}),chat:async(schema,system,input)=>({value:schema.shape.correctedText?{correctedText:'I think that it works because she says that it works.'}:input.candidates?{decisions:input.candidates.map(c=>({index:c.index,needsCorrection:true,replacement:'that',category:'spelling',explanation:'En este contexto se escribe “that”.'}))}:{isEnglish:true,uncertain:false,issues:offsets.map(()=>({original:'tha',replacement:'that',sentence:text,category:'spelling',explanation:'Ortografía.',confidence:.99}))},timing:{seconds:1}})};
  try{const reviewer=new Reviewer(store,engines),result=await reviewer.analyze(text,'en-US');assert.equal(result.correctedText,'I think that it works because she says that it works.');assert.deepEqual(result.issues.map(issue=>issue.offset),offsets);assert.equal(result.status,'issues');assert.equal(result.id,prior.id);assert.equal((await reviewer.analyze(text,'en-US')).cached,true);assert.equal(store.progress().totals.reviews,1);assert.equal(store.progress().totals.detections,2);}finally{store.close();}
});
test('a case-only dictionary suggestion corrects a clear name without renaming it',async()=>{
  const text='My friend richard likes coffee.',store=new Store(':memory:');
  const engines={check:async value=>({matches:value.includes('richard')?[{offset:10,length:7,replacements:[{value:'Richard'},{value:'Richards'}],rule:{id:'MORFOLOGIK_RULE_EN_US',issueType:'misspelling'},message:'Possible typo'}]:[]}),chat:async()=>({value:{isEnglish:true,issues:[],uncertain:false},timing:{seconds:1}})};
  try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.correctedText,'My friend Richard likes coffee.');assert.equal(result.issues[0].category,'capitalization');}finally{store.close();}
});
test('a Spanish word is checked in context instead of becoming an uppercase acronym',async()=>{
  const store=new Store(':memory:'),text='your dia';
  const engines={check:async value=>({matches:value.includes('dia')?[{offset:5,length:3,replacements:[{value:'DIA'},{value:'day'}],rule:{id:'SPELLING',issueType:'misspelling'},message:'Possible spelling mistake'}]:[]}),chat:async schema=>({value:schema.shape.correctedText?{correctedText:'your day',decisions:[{index:0,action:'correct',reason:'«día» es español; en esta frase, en inglés se usa «day».',foreignLanguage:'Spanish'}]}:{isEnglish:true,issues:[],uncertain:false},timing:{seconds:1}})};
  try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.correctedText,'your day');assert.equal(result.issues[0].original,'dia');assert.equal(result.issues[0].category,'spelling');assert.match(result.issues[0].explanation,/español/);}finally{store.close();}
});
test('an unresolved spelling candidate cannot produce a clean success result',async()=>{
  const store=new Store(':memory:'),text='your dia';
  const engines={check:async()=>({matches:[{offset:5,length:3,replacements:[{value:'DIA'},{value:'day'}],rule:{id:'SPELLING',issueType:'misspelling'},message:'Possible spelling mistake'}]}),chat:async schema=>({value:schema.shape.correctedText?{correctedText:text,decisions:[{index:0,action:'uncertain',reason:'No se puede confirmar esta palabra sin contexto.',foreignLanguage:''}]}:{isEnglish:true,issues:[],uncertain:false},timing:{seconds:1}})};
  try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.status,'uncertain');assert.equal(result.correctedText,text);assert.equal(result.issues.length,0);assert.equal(result.notices[0].original,'dia');}finally{store.close();}
});
test('proper names kept by the contextual spelling review are preserved',async()=>{
  const store=new Store(':memory:'),text='We met Dia yesterday.';
  const engines={check:async()=>({matches:[{offset:7,length:3,replacements:[{value:'DIA'},{value:'day'}],rule:{id:'SPELLING',issueType:'misspelling'},message:'Possible spelling mistake'}]}),chat:async schema=>({value:schema.shape.correctedText?{correctedText:text,decisions:[{index:0,action:'keep',reason:'Dia es un nombre propio en esta frase.',foreignLanguage:''}]}:{isEnglish:true,issues:[],uncertain:false},timing:{seconds:1}})};
  try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.correctedText,text);assert.equal(result.issues.length,0);assert.equal(result.status,'correct');}finally{store.close();}
});
test('cached mixed reviews preserve unresolved word notices and uncertainty',async()=>{
  const store=new Store(':memory:'),text='Yesterday I go home with your dia.';
  const engines={check:async value=>({matches:[{offset:value.indexOf('dia'),length:3,replacements:[{value:'day'}],rule:{id:'SPELLING',issueType:'misspelling'},message:'Possible spelling mistake'}]}),chat:async schema=>({value:schema.shape.correctedText?{correctedText:text,decisions:[{index:0,action:'uncertain',reason:'Añade contexto para esta palabra.',foreignLanguage:''}]}:{isEnglish:true,uncertain:false,issues:[{original:'go',replacement:'went',sentence:text,category:'verb_tense',explanation:'Pasado.',confidence:.95}]},timing:{seconds:1}})};
  try{const reviewer=new Reviewer(store,engines),first=await reviewer.analyze(text,'en-US'),again=await reviewer.analyze(text,'en-US');assert.equal(first.status,'issues');assert.equal(first.notices.length,1);assert.equal(again.cached,true);assert.equal(again.uncertain,true);assert.deepEqual(again.notices,first.notices);}finally{store.close();}
});
