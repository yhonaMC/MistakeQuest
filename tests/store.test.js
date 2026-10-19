import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
let Store;try{({Store}=await import('../service/store.js'));}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
test('durable SQLite progress is implemented',()=>assert.equal(typeof Store,'function','SQLite persistence is not implemented'));
if(Store){
  test('a practice revalidation updates only correction metadata while retaining the issue, bank, games and XP',()=>{
    const store=new Store(':memory:'),text='your dia';
    try{
      const saved=store.saveAnalysis({key:'practice-refresh',locale:'en-US',status:'issues',originalText:text,correctedText:'your DIA',issues:[{offset:5,length:3,original:'dia',replacement:'DIA',sentence:text,category:'capitalization',explanation:'Mayúsculas.'}]}),before=saved.issues[0];
      const game=store.createGame({issueId:before.id,mode:'repair',exerciseKey:'practice-refresh-game',privateData:{original:'dia',replacement:'DIA'},publicData:{},state:{help:'none'}});
      store.recordAttempt(game.id,{idempotencyKey:'practice-refresh-earned',correct:true,completed:true,response:{correct:true}});
      store.saveBank(before.id,{items:[{bad:text,good:'your DIA'}],validatorVersion:1},'test');
      const bank=store.getBank(before.id),snapshot=store.game(game.id),totals=store.progress().totals;
      const refreshed=store.applyPracticeCorrection(before.id,{original:'dia',replacement:'day',category:'spelling',explanation:'Día se escribe day en inglés.'});
      assert.equal(refreshed.replacement,'day');assert.equal(refreshed.category,'spelling');assert.equal(refreshed.label,'Ortografía');assert.equal(refreshed.explanation,'Día se escribe day en inglés.');
      for(const key of ['id','analysisId','offset','length','original','sentence','createdAt'])assert.equal(refreshed[key],before[key],key);
      assert.deepEqual(store.getBank(before.id),bank);assert.deepEqual(store.game(game.id),snapshot);assert.deepEqual(store.progress().totals,totals);
    }finally{store.close();}
  });
  test('a practice correction refuses an unrelated source fragment or invalid metadata without writes',()=>{
    const store=new Store(':memory:');
    try{
      const issue=store.saveAnalysis({key:'practice-guard',locale:'en-US',status:'issues',originalText:'your dia',correctedText:'your DIA',issues:[{offset:5,length:3,original:'dia',replacement:'DIA',sentence:'your dia',category:'capitalization',explanation:'Mayúsculas.'}]}).issues[0];
      const valid={original:'dia',replacement:'day',category:'spelling',explanation:'Usa day.'};
      for(const patch of [{...valid,original:'your dia'},{...valid,category:'arbitrary'},{...valid,replacement:''},{...valid,explanation:' '},null])assert.throws(()=>store.applyPracticeCorrection(issue.id,patch),error=>error.code==='INVALID_PRACTICE_CORRECTION');
      assert.throws(()=>store.applyPracticeCorrection('missing',valid),error=>error.code==='ISSUE_NOT_FOUND');
      assert.deepEqual(store.issue(issue.id),issue);
    }finally{store.close();}
  });
  test('a partial newer correction preserves older independent fixes within a compound span',()=>{
    const store=new Store(':memory:'),text='I hope my english improve.';
    store.saveAnalysis({key:'partial-contained',locale:'en-US',status:'issues',originalText:text,correctedText:'I hope my English improves.',reviewVersion:3,issues:[{offset:10,length:15,original:'english improve',replacement:'English improves',category:'verb_form',explanation:'Mayúsculas y concordancia.',sentence:text}]});
    try{const next=store.saveAnalysis({key:'partial-contained',locale:'en-US',status:'issues',originalText:text,correctedText:'I hope my English improve.',reviewVersion:4,issues:[{offset:10,length:7,original:'english',replacement:'English',category:'capitalization',explanation:'Mayúscula.',sentence:text}]});assert.equal(next.issues[0].replacement,'English improves');}finally{store.close();}
  });
  test('new atomic corrections update a saved compound span without losing games or XP',()=>{
    const store=new Store(':memory:'),text='I am needing prepare.',first=store.saveAnalysis({key:'nested',locale:'en-US',status:'issues',originalText:text,correctedText:'I am needing to prepare.',reviewVersion:3,issues:[{offset:0,length:text.length,original:text,replacement:'I am needing to prepare.',category:'verb_form',explanation:'Infinitivo.',sentence:text}]}),id=first.issues[0].id;
    const game=store.createGame({issueId:id,mode:'repair',exerciseKey:'retained-compound',privateData:{},publicData:{},state:{help:'none'}});store.recordAttempt(game.id,{idempotencyKey:'retained-attempt',correct:true,completed:true,response:{correct:true}});
    const revised=store.saveAnalysis({key:'nested',locale:'en-US',status:'issues',originalText:text,correctedText:'I need to prepare.',reviewVersion:4,issues:[{offset:2,length:10,original:'am needing',replacement:'need to',category:'verb_form',explanation:'Usa need to.',sentence:text}]});
    assert.equal(revised.issues[0].replacement,'I need to prepare.');assert.equal(revised.issues[0].id,id);assert.equal(store.progress().totals.xp,20);assert.equal(store.game(game.id).completed,true);assert.equal(store.progress().totals.reviews,1);store.close();
  });
  const analysis={key:'review-1',locale:'en-US',status:'issues',originalText:'Yesterday I go home.',correctedText:'Yesterday I went home.',issues:[{offset:12,length:2,original:'go',replacement:'went',category:'verb_tense',label:'Pasado simple',explanation:'El pasado de go es went.',sentence:'Yesterday I go home.'}]};
  test('analysis deduplication and persistence survive reopening the database',()=>{
    const file=join(mkdtempSync(join(tmpdir(),'mq-store-')),'progress.sqlite');let store=new Store(file);
    const first=store.saveAnalysis(analysis);const again=store.saveAnalysis(analysis);assert.equal(first.id,again.id);assert.equal(store.progress().totals.detections,1);store.close();
    store=new Store(file);assert.equal(store.progress().totals.reviews,1);assert.equal(store.progress().patterns[0].category,'verb_tense');store.close();
  });
  test('game mistakes and idempotent rewards do not inflate writing errors',()=>{
    const store=new Store(':memory:');const saved=store.saveAnalysis(analysis),issue=saved.issues[0];
    const game=store.createGame({issueId:issue.id,mode:'repair',exerciseKey:'go-1',privateData:{},publicData:{},state:{help:'none'}});
    const event={idempotencyKey:'attempt-1',correct:true,completed:true,help:'none',response:{correct:true,completed:true}};
    const first=store.recordAttempt(game.id,event);const again=store.recordAttempt(game.id,event);assert.equal(first.xpEarned,20);assert.equal(again.xpEarned,20);assert.equal(store.progress().totals.xp,20);assert.equal(store.progress().totals.attempts,1);assert.equal(store.progress().totals.detections,1);
    const repeat=store.createGame({issueId:issue.id,mode:'repair',exerciseKey:'go-1',privateData:{},publicData:{},state:{help:'hint'}});
    const wrong=store.recordAttempt(repeat.id,{idempotencyKey:'attempt-2',correct:false,completed:false,help:'hint',response:{correct:false}});assert.equal(wrong.xpEarned,0);
    const done=store.recordAttempt(repeat.id,{...event,idempotencyKey:'attempt-3',help:'hint'});assert.equal(done.xpEarned,0);assert.equal(store.progress().totals.mistakes,1);assert.equal(store.progress().totals.detections,1);store.close();
  });
  test('correct text has no issues and no practice source',()=>{
    const store=new Store(':memory:');const result=store.saveAnalysis({...analysis,key:'correct',status:'correct',originalText:'I like coffee.',correctedText:'I like coffee.',issues:[]});
    assert.equal(result.issues.length,0);assert.equal(store.progress().totals.detections,0);assert.throws(()=>store.createGame({issueId:'missing',mode:'repair',exerciseKey:'x',privateData:{},publicData:{},state:{}}));store.close();
  });
  test('a newer review fills omissions without duplicating history or losing games',()=>{
    const store=new Store(':memory:');store.updateSettings({saveTexts:true});
    const text='Yesterday I go to tha park.',first=store.saveAnalysis({...analysis,originalText:text,correctedText:'Yesterday I went to tha park.',issues:[{...analysis.issues[0],sentence:text}],reviewVersion:0});
    const game=store.createGame({issueId:first.issues[0].id,mode:'repair',exerciseKey:'saved-game',privateData:{},publicData:{},state:{help:'none'}});
    store.recordAttempt(game.id,{idempotencyKey:'saved-attempt',correct:true,completed:true,response:{correct:true}});
    const update={...analysis,originalText:text,correctedText:'Yesterday I go to that park.',reviewVersion:1,issues:[{offset:18,length:3,original:'tha',replacement:'that',category:'spelling',explanation:'Ortografía.',sentence:text}]};
    const revised=store.saveAnalysis(update);assert.equal(revised.id,first.id);assert.equal(revised.reviewVersion,1);assert.equal(revised.issues.length,2);assert.equal(revised.issues[0].id,first.issues[0].id);assert.equal(revised.correctedText,'Yesterday I went to that park.');
    store.saveAnalysis(update);assert.equal(store.progress().totals.reviews,1);assert.equal(store.progress().totals.detections,2);assert.equal(store.progress().totals.xp,20);assert.equal(store.progress().totals.completedGames,1);store.close();
  });
  test('opens the previous database schema without losing saved reviews',()=>{
    const file=join(mkdtempSync(join(tmpdir(),'mq-migration-')),'progress.sqlite'),old=new DatabaseSync(file);
    old.exec('CREATE TABLE analyses(id TEXT PRIMARY KEY,review_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,locale TEXT NOT NULL,status TEXT NOT NULL,original_text TEXT,corrected_text TEXT,model TEXT NOT NULL); PRAGMA user_version=1');
    old.prepare('INSERT INTO analyses VALUES (?,?,?,?,?,?,?,?)').run('old-review','old-key','2026-10-14T12:00:00Z','en-US','correct',null,null,'qwen3:8b');old.close();
    const store=new Store(file);assert.equal(store.analysis('old-review').reviewVersion,0);assert.equal(store.progress().totals.reviews,1);assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,3);store.close();
  });
  test('a verified newer correction replaces a bad acronym without losing issue identity, games or XP',()=>{
    const store=new Store(':memory:'),text='your dia',first=store.saveAnalysis({key:'dia',locale:'en-US',status:'issues',originalText:text,correctedText:'your DIA',reviewVersion:2,issues:[{offset:5,length:3,original:'dia',replacement:'DIA',category:'capitalization',explanation:'Mayúsculas.',sentence:text}]}),id=first.issues[0].id;
    const game=store.createGame({issueId:id,mode:'repair',exerciseKey:'old-dia',privateData:{original:'dia',replacement:'DIA'},publicData:{},state:{help:'none'}});store.saveBank(id,{old:true},'qwen3:8b');store.recordAttempt(game.id,{idempotencyKey:'completed-dia',correct:true,completed:true,response:{correct:true}});
    const revised=store.saveAnalysis({key:'dia',locale:'en-US',status:'issues',originalText:text,correctedText:'your day',reviewVersion:3,issues:[{offset:5,length:3,original:'dia',replacement:'day',category:'spelling',explanation:'Usa day en inglés.',sentence:text}]});
    assert.equal(revised.issues[0].id,id);assert.equal(revised.issues[0].replacement,'day');assert.equal(store.getBank(id),null);assert.equal(store.game(game.id).privateData.replacement,'DIA');assert.equal(store.progress().totals.xp,20);assert.equal(store.progress().totals.reviews,1);assert.equal(store.progress().totals.detections,1);store.close();
  });
}
