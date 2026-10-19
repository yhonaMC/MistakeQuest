import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../service/store.js';
import {Reviewer} from '../service/review.js';

test('a proposed extra subject cannot crowd out the required order inside an indirect question',async()=>{
  const store=new Store(':memory:'),text='I do not know where is my book.';
  const engines={check:async()=>({matches:[]}),chat:async schema=>({value:schema.shape.tokens?{tokens:['I','do','not','know','where','my','book','is']}:{isEnglish:true,uncertain:false,issues:[{original:'where',replacement:'where it',sentence:text,category:'pronouns',explanation:'Falta sujeto.',confidence:.99}]},timing:{seconds:1}})};
  try{
    const result=await new Reviewer(store,engines).analyze(text,'en-US');
    assert.equal(result.correctedText,'I do not know where my book is.');
    assert.equal(result.issues.length,1);assert.equal(result.issues[0].category,'word_order');
  }finally{store.close();}
});

test('indirect-question order cannot delete a negative while adding a duplicate word',async()=>{
  const store=new Store(':memory:'),text='I do not know where is my book.';
  const engines={check:async()=>({matches:[]}),chat:async schema=>({value:schema.shape.tokens?{tokens:['I','do','know','where','my','book','book','is']}:{isEnglish:true,uncertain:false,issues:[{original:text,replacement:'I do not know where my book is.',sentence:text,category:'word_order',explanation:'Orden de pregunta indirecta.',confidence:.99}]},timing:{seconds:1}})};
  try{
    const result=await new Reviewer(store,engines).analyze(text,'en-US');
    assert.equal(result.correctedText,'I do not know where my book is.');
    assert.ok(result.correctedText.includes('not'));
  }finally{store.close();}
});

test('direct questions and grammatical indirect questions keep their original structure',async()=>{
  for(const text of ['Where is my book?','I do not know where my book is.','Do you know where my book is?','I do not understand this lesson.']){
    const store=new Store(':memory:'),engines={check:async()=>({matches:[]}),chat:async()=>({value:{isEnglish:true,uncertain:false,issues:[]},timing:{seconds:1}})};
    try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.correctedText,text);assert.equal(result.issues.length,0);}finally{store.close();}
  }
});

test('a structural correction keeps an overlapping sentence capitalization repair',async()=>{
  const store=new Store(':memory:'),text='i do not know where is my book.';
  const engines={check:async()=>({matches:[]}),chat:async schema=>({value:schema.shape.tokens?{tokens:['I','do','not','know','where','my','book','is']}:{isEnglish:true,uncertain:false,issues:[{original:'i',replacement:'I',sentence:text,category:'capitalization',explanation:'El pronombre I va en mayúscula.',confidence:.99},{original:'where',replacement:'where it',sentence:text,category:'pronouns',explanation:'Falta sujeto.',confidence:.99}]},timing:{seconds:1}})};
  try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.correctedText,'I do not know where my book is.');assert.equal(result.issues.length,1);assert.equal(result.issues[0].category,'word_order');}finally{store.close();}
});

test('verified structural order supersedes an initial full-span proposal that invents a pronoun',async()=>{
  const store=new Store(':memory:'),text='I do not know where is my book.';
  const engines={check:async()=>({matches:[]}),chat:async schema=>({value:schema.shape.tokens?{tokens:['I','do','not','know','where','my','book','is']}:{isEnglish:true,uncertain:false,issues:[{original:text,replacement:'I do not know where it is my book.',sentence:text,category:'word_order',explanation:'Orden.',confidence:.99}]},timing:{seconds:1}})};
  try{assert.equal((await new Reviewer(store,engines).analyze(text,'en-US')).correctedText,'I do not know where my book is.');}finally{store.close();}
});

test('word-order suggestions cannot replace the original subject and object pronouns',async()=>{
  const store=new Store(':memory:'),text='He sees her.';
  const engines={check:async()=>({matches:[]}),chat:async()=>({value:{isEnglish:true,uncertain:false,issues:[{original:text,replacement:'She sees him.',sentence:text,category:'word_order',explanation:'Orden.',confidence:.99}]},timing:{seconds:1}})};
  try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.correctedText,text);assert.equal(result.issues.length,0);}finally{store.close();}
});

test('structural order incorporates independently verified spelling and keeps corrections outside its span',async()=>{
  const store=new Store(':memory:'),text='i do not know where is my bok. She work here.';
  const engines={
    check:async value=>({matches:[...value.matchAll(/\bbok\b/g)].map(match=>({offset:match.index,length:3,replacements:[{value:'book'}],rule:{id:'SPELLING',issueType:'misspelling'},message:'Possible typo'}))}),
    chat:async schema=>({value:schema.shape.tokens?{tokens:['I','do','not','know','where','my','bok','is']}:schema.shape.correctedText?{correctedText:text.replace('bok','book'),decisions:[{index:0,action:'correct',reason:'Se escribe book.',foreignLanguage:''}]}:{isEnglish:true,uncertain:false,issues:[{original:'i',replacement:'I',sentence:'i do not know where is my bok.',category:'capitalization',explanation:'El pronombre I va en mayúscula.',confidence:.99},{original:'where',replacement:'where it',sentence:'i do not know where is my bok.',category:'pronouns',explanation:'Falta sujeto.',confidence:.99},{original:'bok',replacement:'book',sentence:'i do not know where is my bok.',category:'spelling',explanation:'Se escribe book.',confidence:.99},{original:'work',replacement:'works',sentence:'She work here.',category:'agreement',explanation:'Con she se usa works.',confidence:.99}]},timing:{seconds:1}})
  };
  try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.correctedText,'I do not know where my book is. She works here.');assert.ok(result.issues.some(issue=>issue.original==='work'&&issue.replacement==='works'));}finally{store.close();}
});

test('structural order retains an independent agreement repair inside the moved clause',async()=>{
  const store=new Store(':memory:'),text='She do not know where is her book.';
  const engines={check:async()=>({matches:[]}),chat:async schema=>({value:schema.shape.tokens?{tokens:['She','do','not','know','where','her','book','is']}:{isEnglish:true,uncertain:false,issues:[{original:'do',replacement:'does',sentence:text,category:'agreement',explanation:'Con she se usa does.',confidence:.99},{original:'where',replacement:'where it',sentence:text,category:'pronouns',explanation:'Falta sujeto.',confidence:.99}]},timing:{seconds:1}})};
  try{const result=await new Reviewer(store,engines).analyze(text,'en-US');assert.equal(result.correctedText,'She does not know where her book is.');assert.equal(result.issues.length,1);assert.equal(result.issues[0].category,'word_order');}finally{store.close();}
});

test('a reordered embedded fragment is checked within its complete sentence context',async()=>{
  const store=new Store(':memory:'),text='i do not know where is my book.';
  const engines={check:async()=>({matches:[]}),chat:async(schema,prompt,input)=>({value:schema.shape.tokens?{tokens:input.text===text?['I','do','not','know','where','my','book','is']:['my','book','is','where']}:{isEnglish:true,uncertain:false,issues:[{original:'i',replacement:'I',sentence:text,category:'capitalization',explanation:'I va en mayúscula.',confidence:.99},{original:'where is my book',replacement:'where my book is',sentence:text,category:'word_order',explanation:'Orden de una pregunta indirecta.',confidence:.99}]},timing:{seconds:1}})};
  try{assert.equal((await new Reviewer(store,engines).analyze(text,'en-US')).correctedText,'I do not know where my book is.');}finally{store.close();}
});

test('a fragment inside a longer sentence keeps its context and its lowercase boundary',async()=>{
  const store=new Store(':memory:'),text='I really do not know at this moment exactly where is my old English book.';
  const engines={check:async()=>({matches:[]}),chat:async(schema,prompt,input)=>({value:schema.shape.tokens?{tokens:input.context===text?['where','my','old','English','book','is']:['my','old','English','book','is','where']}:{isEnglish:true,uncertain:false,issues:[{original:'where is my old English book',replacement:'where my old English book is',sentence:text,category:'word_order',explanation:'Orden de una pregunta indirecta.',confidence:.99}]},timing:{seconds:1}})};
  try{assert.equal((await new Reviewer(store,engines).analyze(text,'en-US')).correctedText,'I really do not know at this moment exactly where my old English book is.');}finally{store.close();}
});
