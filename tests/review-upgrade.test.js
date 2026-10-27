import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,digest} from '../service/store.js';
import {Reviewer,REVIEW_VERSION} from '../service/review.js';

test('a newer verified sentence reorder replaces its contained cached correction without losing games or history',async()=>{
  const store=new Store(':memory:'),text='She walk to school. I do not know where is my notebook.';
  const date=new Date(),key=digest({day:[date.getFullYear(),date.getMonth()+1,date.getDate()].join('-'),locale:'en-US',text});
  store.updateSettings({saveTexts:true});
  const agreement={offset:4,length:4,original:'walk',replacement:'walks',sentence:'She walk to school.',category:'agreement',explanation:'Con she usa walks.'};
  const original='is my notebook',prior={offset:text.indexOf(original),length:original.length,original,replacement:'it is my notebook',sentence:'I do not know where is my notebook.',category:'pronouns',explanation:'Previous missing-subject decision.'};
  try{
    const first=store.saveAnalysis({key,locale:'en-US',status:'issues',originalText:text,correctedText:'She walks to school. I do not know where it is my notebook.',reviewVersion:6,issues:[agreement,prior]});
    const issue=first.issues.find(value=>value.category==='pronouns');
    const game=store.createGame({issueId:issue.id,mode:'repair',exerciseKey:'cached-subject-game',privateData:{original:prior.original,replacement:prior.replacement},publicData:{},state:{help:'none'}});
    store.recordAttempt(game.id,{idempotencyKey:'cached-subject-answer',correct:true,completed:true,response:{correct:true}});
    store.saveBank(issue.id,{items:[{bad:prior.sentence,good:'I do not know where it is my notebook.'}]},'test');
    const savedGame=store.game(game.id),attempts=store.export().tables.attempts;
    const engines={check:async()=>({matches:[]}),chat:async schema=>({value:schema.shape.tokens?{tokens:['I','do','not','know','where','my','notebook','is']}:{isEnglish:true,uncertain:false,issues:[]},timing:{seconds:.1}})};
    const result=await new Reviewer(store,engines).analyze(text,'en-US');
    assert.equal(result.correctedText,'She walks to school. I do not know where my notebook is.');
    assert.equal(result.id,first.id);assert.equal(result.reviewVersion,REVIEW_VERSION);
    assert.equal(result.issues.length,2);
    const reordered=result.issues.find(value=>value.category==='word_order');
    assert.equal(reordered.id,issue.id);assert.equal(reordered.original,'I do not know where is my notebook.');
    assert.equal(reordered.offset,20);assert.equal(store.getBank(issue.id),null);
    assert.deepEqual(store.game(game.id),savedGame);assert.deepEqual(store.export().tables.attempts,attempts);
    assert.equal(store.progress().totals.reviews,1);assert.equal(store.progress().totals.detections,2);
    assert.equal(store.progress().totals.completedGames,1);assert.equal(store.progress().totals.xp,20);
    assert.equal((await new Reviewer(store,engines).analyze(text,'en-US')).cached,true);
    assert.equal(store.progress().totals.detections,2);
  }finally{store.close();}
});

test('an unresolved reorder over multiple historical issues does not become a current-version cached review',()=>{
  const store=new Store(':memory:'),text='i do not know where is my notebook.';
  const original='is my notebook',issues=[{offset:0,length:1,original:'i',replacement:'I',category:'capitalization',explanation:'Usa I.',sentence:text},{offset:text.indexOf(original),length:original.length,original,replacement:'it is my notebook',category:'pronouns',explanation:'Previous missing-subject decision.',sentence:text}];
  try{
    store.updateSettings({saveTexts:true});
    const first=store.saveAnalysis({key:'multi-cached-reorder',locale:'en-US',status:'issues',originalText:text,correctedText:'I do not know where it is my notebook.',reviewVersion:6,issues});
    const corrected='I do not know where my notebook is.';
    const revised=store.saveAnalysis({key:first.key,locale:'en-US',status:'issues',originalText:text,correctedText:corrected,reviewVersion:REVIEW_VERSION,issues:[{offset:0,length:text.length,original:text,replacement:corrected,category:'word_order',explanation:'Sujeto antes del verbo.',sentence:text}]});
    assert.equal(revised.reviewVersion,6,'Keep this upgrade eligible for revalidation instead of caching an unresolved repair');
    assert.deepEqual(revised.issues,first.issues);assert.equal(store.progress().totals.reviews,1);assert.equal(store.progress().totals.detections,2);
  }finally{store.close();}
});
