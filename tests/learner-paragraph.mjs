import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {Store} from '../service/store.js';
import {Engines} from '../service/engines.js';
import {Reviewer} from '../service/review.js';
import {GameService} from '../service/games.js';
import {applyEdits} from '../service/edits.js';
import {learnerText} from './learner-fixture.js';
const store=new Store(':memory:'),engines=new Engines(),reviewer=new Reviewer(store,engines),games=new GameService(store,engines);
if(process.argv.includes('--trace')){const chat=engines.chat.bind(engines);engines.chat=async(...args)=>{const result=await chat(...args);console.log('RAW',JSON.stringify(result.value));return result;};}
let failures=0,completedGames=0;
try{
  const result=process.argv.includes('--reuse')?store.saveAnalysis({...JSON.parse(readFileSync('test-results/learner-latest.json','utf8')),key:'reused',originalText:learnerText}):await reviewer.analyze(learnerText,'en-US');
  if(process.argv.includes('--reuse')){result.originalText=learnerText;result.correctedText=applyEdits(learnerText,result.issues);}
  writeFileSync('test-results/learner-latest.json',JSON.stringify(result));
  console.log('REVIEW',JSON.stringify({corrected:result.correctedText,issues:result.issues.map(i=>({original:i.original,replacement:i.replacement,category:i.category})),notices:result.notices}));
  for(const [label,pattern] of [['job opportunities',/\bjob opportunities\b/],['myself',/\brecording myself\b/],['need to prepare',/\bI need to prepare\b/],['improves',/\bEnglish improves\b/],['important',/\bimportant\b/],['continuous',/\bpast continuous\b/],['sentence boundaries',/\bEnglish improves\.\s+Bye\./]]){
    try{assert.ok(pattern.test(result.correctedText),label);console.log('CORE',label,'OK');}catch(error){failures++;console.log('CORE',label,'FAIL');}
  }
  const original='I hope that my english improve bye',replacement='I hope that my English improves. Bye.';
  const legacy=store.saveAnalysis({key:'compound-legacy',locale:'en-US',status:'issues',originalText:learnerText,correctedText:learnerText,issues:[{offset:learnerText.indexOf(original),length:original.length,original,replacement,sentence:learnerText,category:'verb_form',explanation:'Con my English, el verbo usa improves; English lleva mayúscula y Bye inicia otra frase.'}]});
  const targets=process.argv.includes('--review-only')?[]:process.argv.includes('--all')?[legacy.issues[0],...result.issues]:[legacy.issues[0]];
  for(const issue of targets){
    try{
      for(const mode of ['choice','radar','repair','order','pairs','judge']){
        const game=await games.create(issue.id,mode),{privateData:data}=store.game(game.id);let outcome;
        const submit=answer=>games.attempt(game.id,{...answer,idempotencyKey:crypto.randomUUID()});
        if(mode==='choice')outcome=await submit({answer:'1'});
        if(mode==='radar')outcome=await submit({tokenIndex:data.tokens.find(t=>t.offset<data.item.targetOffset+data.item.targetLength&&t.offset+t.length>data.item.targetOffset).id});
        if(mode==='repair')outcome=await submit({answer:data.item.replacement});
        if(mode==='order')outcome=await submit({tokenIds:data.wordBank.map(t=>t.id)});
        if(mode==='pairs')for(let i=0;i<data.bank.items.length;i++){outcome=await submit({leftId:i,rightId:i});assert.ok(outcome.correct);}
        if(mode==='judge')for(const question of data.judges){outcome=await submit({needsChange:question.needsChange});assert.ok(outcome.correct);}
        assert.ok(outcome.correct&&outcome.completed);completedGames++;console.log('GAME',issue.original,'→',issue.replacement,mode,'OK');
      }
    }catch(error){failures++;console.log('GAME FAIL',issue.original,error.code||error.message);}
  }
  assert.equal(failures,0,`${failures} comprobaciones fallaron`);
  console.log('RESULT',JSON.stringify({issues:result.issues.length,completedGames,failures}));
}finally{store.close();}
