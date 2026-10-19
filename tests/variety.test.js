import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../service/store.js';
import {GameService} from '../service/games.js';

const examples=['I study english every day.','We speak english at work.','My brother learns english at home.','She reads books in english.','They write emails in english.','I practice english with my friend.'].map(bad=>({bad,good:bad.replace('english','English'),original:'english',replacement:'English',category:'capitalization',alternatives:[],alternateOrders:[],answers:['English'],targetOffset:bad.indexOf('english'),targetLength:7}));
const engines={
  check:async text=>({matches:text.includes('english')?[{offset:text.indexOf('english'),length:7,replacements:[{value:'English'}],rule:{id:'ENGLISH_UPPERCASE',issueType:'misspelling'}}]:[]}),
  chat:async(schema,prompt,input)=>({value:schema.shape.items?{label:'Mayúsculas',explanation:'Los idiomas llevan mayúscula inicial.',hint:'Piensa en la inicial del idioma.',items:examples.slice(0,3)}:schema.shape.correctedText?{correctedText:input.text.replace('english','English')}:{decisions:input.candidates.map(c=>({index:c.index,needsCorrection:true,replacement:'English'}))}})
};
function seed(store){
  const text=examples[0].bad;
  return store.saveAnalysis({key:'sentence-variety',locale:'en-US',status:'issues',originalText:text,correctedText:examples[0].good,issues:[{offset:text.indexOf('english'),length:7,original:'english',replacement:'English',sentence:text,category:'capitalization',explanation:'Los idiomas llevan mayúscula inicial.'}]}).issues[0];
}
async function seedVariedCache(store,items=examples.slice(0,3)){
  const issue=seed(store),service=new GameService(store,engines),bank=await service.bank(issue,'en-US');
  store.saveBank(issue.id,{...bank,items},'test');
  return {issue,service};
}

test('a verified original does not permanently prevent creating a varied bank of simple examples',async()=>{
  const store=new Store(':memory:');
  try{
    const issue=seed(store),bank=await new GameService(store,engines).bank(issue,'en-US');
    assert.ok(new Set(bank.items.map(item=>item.good)).size>=3,'A confirmed original alone currently returns early and is reused forever');
    assert.ok(bank.items.every(item=>item.original==='english'&&item.replacement==='English'));
    assert.ok(bank.items.every(item=>item.good.split(/\s+/).length<=12));
  }finally{store.close();}
});

test('changing game format uses unseen phrases before repeating the first one',async()=>{
  const store=new Store(':memory:');
  try{
    const {issue,service}=await seedVariedCache(store),seen=[];
    for(const mode of ['choice','repair','radar']){
      const publicGame=await service.create(issue.id,mode);
      seen.push(store.game(publicGame.id).privateData.item.good);
    }
    assert.equal(new Set(seen).size,3,'Each new format currently starts at item zero');
  }finally{store.close();}
});

test('opening a game enriches a cached single source when verified alternatives are available',async()=>{
  const store=new Store(':memory:');
  try{
    const {issue,service}=await seedVariedCache(store,examples.slice(0,1));
    await service.create(issue.id,'choice');
    assert.ok(new Set(store.getBank(issue.id).items.map(item=>item.good)).size>=3,'A one-item cache must not suppress verified new phrases forever');
  }finally{store.close();}
});

test('cached verified games remain playable when creating additional variety fails',async()=>{
  const store=new Store(':memory:');
  try{
    const {issue}=await seedVariedCache(store,examples.slice(0,1));
    const unavailable={check:async()=>{throw Error('Local engine is busy');},chat:async()=>{throw Error('Local AI is busy');}},service=new GameService(store,unavailable);
    for(const mode of ['choice','radar','repair','order','pairs','judge']){
      const opened=await service.create(issue.id,mode),saved=store.game(opened.id),data=saved.privateData;
      const answer=mode==='choice'?{answer:'1'}:mode==='radar'?{tokenIndex:data.tokens.find(token=>token.offset<data.item.targetOffset+data.item.targetLength&&data.item.targetOffset<token.offset+token.length).id}:mode==='repair'?{answer:data.item.replacement}:mode==='order'?{tokenIds:data.wordBank.map(token=>token.id)}:mode==='pairs'?{leftId:0,rightId:0}:{needsChange:false};
      let result=await service.attempt(opened.id,{...answer,idempotencyKey:'cached-variety-'+mode});
      if(mode==='judge')result=await service.attempt(opened.id,{needsChange:true,idempotencyKey:'cached-variety-judge-next'});
      assert.equal(result.completed,true,mode+' should still be completable from its verified cache');
    }
    assert.equal(store.progress().totals.completedGames,6);
  }finally{store.close();}
});

test('a larger sentence pool uses at most three pairs with IDs supported by the answer API',async()=>{
  const store=new Store(':memory:');
  try{
    const {issue,service}=await seedVariedCache(store,examples),game=await service.create(issue.id,'pairs');
    assert.equal(game.left.length,3);assert.equal(game.right.length,3);
    assert.ok([...game.left,...game.right].every(item=>Number.isInteger(item.id)&&item.id>=0&&item.id<=2));
    for(const item of game.left){const result=await service.attempt(game.id,{idempotencyKey:'pair-variety-'+item.id,leftId:item.id,rightId:item.id});assert.equal(result.correct,true);}
    assert.equal(store.game(game.id).completed,true);
  }finally{store.close();}
});

test('pairs and judge rotate across their displayed sentences before revisiting them',async()=>{
  const store=new Store(':memory:');
  try{
    const {issue,service}=await seedVariedCache(store,examples),pairs=await service.create(issue.id,'pairs');
    const alreadySeen=new Set(store.game(pairs.id).privateData.bank.items.map(item=>item.good));
    const judge=await service.create(issue.id,'judge'),questions=store.game(judge.id).privateData.judges;
    assert.equal(questions.length,3);
    assert.equal(new Set(questions.map(item=>item.good)).size,3);
    assert.ok(questions.every(item=>!alreadySeen.has(item.good)),'Selection must include all displayed pair/judge phrases in its exposure count');
  }finally{store.close();}
});

test('sentence rotation resumes after reopening the local database without altering earned progress',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'mq-variety-')),path=join(directory,'progress.sqlite');let store=new Store(path);
  try{
    const {issue,service}=await seedVariedCache(store),first=await service.create(issue.id,'choice');
    const originalSentence=store.game(first.id).privateData.item.good;
    const attempt=await service.attempt(first.id,{idempotencyKey:'variety-first-completion',answer:'1'});
    assert.equal(attempt.completed,true);assert.equal(attempt.xpEarned,20);
    const before=store.progress().totals;store.close();store=new Store(path);
    const next=await new GameService(store,{check:async()=>{throw Error('A cached bank must not require an engine');},chat:async()=>{throw Error('A cached bank must not require AI');}}).create(issue.id,'repair');
    assert.notEqual(store.game(next.id).privateData.item.good,originalSentence,'Changing formats after restart currently repeats the same example');
    assert.deepEqual(store.progress().totals,before);
    assert.equal(store.game(first.id).completed,true);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
