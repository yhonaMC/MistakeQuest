import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../service/store.js';
import {sourcePracticeItems} from '../service/source-practice.js';
import {assemblePracticeBank,evaluateGame,GameService,makeGame,practiceFragment,validateBank} from '../service/games.js';
import {selectVariedChoiceCandidates} from '../service/practice-pool.js';
import {PracticeRounds} from '../service/practice-rounds.js';

const original='I do not know where is my notebook.';
const replacement='I do not know where my notebook is.';
const issue={id:'notebook-order',offset:0,length:original.length,original,replacement,sentence:original,category:'word_order',label:'Orden de palabras',explanation:'Conserva las palabras y coloca el sujeto antes del verbo.'};
const bank=items=>({validatorVersion:10,source:'original',label:issue.label,explanation:issue.explanation,hint:'Revisa el orden de la pregunta indirecta.',items});
const deletion={bad:'I do not know where is my notebook is.',good:replacement,original:'where is',replacement:'where',category:'word_order',targetOffset:14,targetLength:8,answers:['where'],alternatives:[],alternateOrders:[]};
const insertion={bad:'I do not know where my notebook.',good:replacement,original:'notebook.',replacement:'notebook is.',category:'word_order',targetOffset:23,targetLength:9,answers:['notebook is.'],alternatives:[],alternateOrders:[]};
const atomic={bad:original,good:replacement,original:'is my notebook',replacement:'my notebook is',category:'word_order',targetOffset:20,targetLength:14,answers:['my notebook is'],alternatives:[],alternateOrders:[]};

test('source practice retains an indirect-question reorder as one atomic correction',()=>{
  const items=sourcePracticeItems(issue,[issue]);
  assert.equal(items.length,1,'Moving a verb cannot become separate deletion and insertion exercises');
  assert.equal(items[0].bad,original);
  assert.equal(items[0].good,replacement);
  assert.equal(items[0].original,'is my notebook');
  assert.equal(items[0].replacement,'my notebook is');
  assert.equal(items[0].targetOffset,20);
  assert.equal(items[0].targetLength,14);
});

test('the practice fragment preserves all words in the coupled reorder',()=>{
  assert.deepEqual(practiceFragment(issue),{original:'is my notebook',replacement:'my notebook is'});
});

test('a sentence-start reorder leaves its unchanged suffix outside the Radar target',()=>{
  const source={...issue,original:'Want I to learn English.',replacement:'I want to learn English.',sentence:'Want I to learn English.',length:24};
  const items=sourcePracticeItems(source,[source]);
  assert.equal(items.length,1);
  const item=items[0];
  assert.equal(item.bad,'Want I to learn English.');
  assert.equal(item.good,'I want to learn English.');
  assert.equal(item.original,'Want I');
  assert.equal(item.replacement,'I want');
  assert.equal(item.targetOffset,0);
  assert.equal(item.targetLength,6);
  const game=makeGame(source,bank(items),'radar');
  for(const tokenId of [2,3,4])assert.equal(evaluateGame(game,{tokenIndex:tokenId}).correct,false,'The unchanged words to, learn, and English are distractors');
  assert.equal(evaluateGame(game,{tokenIndex:0}).correct,true);
});

test('independent sentence capitalization stays separate from the atomic word-order target',()=>{
  const source={...issue,original:'i do not know where is my book.',replacement:'I do not know where my book is.',sentence:'i do not know where is my book.',length:31};
  const items=sourcePracticeItems(source,[source]);
  assert.equal(items.length,2,'Capitalization and word movement are independent practice targets');
  const capital=items.find(item=>item.category==='capitalization');
  assert.ok(capital);
  assert.equal(capital.original,'i');
  assert.equal(capital.replacement,'I');
  assert.equal(capital.bad,'i do not know where my book is.');
  assert.equal(capital.good,'I do not know where my book is.');
  const order=items.find(item=>item.category==='word_order');
  assert.ok(order);
  assert.equal(order.original,'is my book');
  assert.equal(order.replacement,'my book is');
  assert.equal(order.bad,'I do not know where is my book.');
  assert.equal(order.good,'I do not know where my book is.');
  const game=makeGame(source,bank([order]),'radar');
  for(const tokenId of [1,2,3,4])assert.equal(evaluateGame(game,{tokenIndex:tokenId}).correct,false,'The unchanged do, not, know, and where words are distractors');
  assert.equal(evaluateGame(game,{tokenIndex:5}).correct,true);
});

test('an atomic source reorder supports three guided misses and a real verb hit',()=>{
  const items=sourcePracticeItems(issue,[issue]);
  const item=items.find(value=>value.bad===original);
  assert.ok(item,'Radar must practice the original word-order error without introducing a duplicated verb');
  const make=()=>{
    const game=makeGame(issue,bank([item]),'radar');
    Object.assign(game.state,{guided:true,discardedTokenIds:[],hintLevel:0,assisted:false});
    return game;
  };
  const exhausted=make();
  for(const [index,tokenId] of [0,1,2].entries()){
    const result=evaluateGame(exhausted,{tokenIndex:tokenId});
    assert.equal(result.correct,false);
    assert.equal(result.response.attemptsRemaining,2-index);
    assert.equal(result.completed,index===2);
    exhausted.state=result.state;
    if(index===2){
      assert.equal(result.response.outcome,'exhausted');
      assert.equal(result.response.correctedSentence,replacement);
    }
  }
  const hit=make(),result=evaluateGame(hit,{tokenIndex:5});
  assert.equal(hit.privateData.tokens[5].text,'is');
  assert.equal(result.correct,true);
  assert.equal(result.completed,true);
  assert.equal(result.response.outcome,'correct');
  assert.equal(result.response.correctedSentence,replacement);
});

test('assembly cannot replace an intended reorder with a deletion-only exercise',()=>{
  assert.deepEqual(assemblePracticeBank(bank([deletion]),issue).items,[]);
});

test('assembly narrows a complete model sentence to the confirmed atomic reorder',()=>{
  const modelItem={bad:original,good:replacement,original,replacement,alternatives:[],alternateOrders:[]};
  const assembled=assemblePracticeBank(bank([modelItem]),issue);
  assert.equal(assembled.items.length,1,'Unchanged model context does not invalidate an otherwise exact reorder');
  assert.equal(assembled.items[0].original,'is my notebook');
  assert.equal(assembled.items[0].replacement,'my notebook is');
  assert.equal(assembled.items[0].good,replacement);
});

test('bank validation rejects a deletion-only substitute for an atomic reorder',async()=>{
  const checked=await validateBank(bank([deletion]),issue,{check:async()=>({matches:[]})},'en-US');
  assert.deepEqual(checked.items,[]);
});

function saveCached(store,key,source,items){
  const saved=store.saveAnalysis({key,locale:'en-US',status:'issues',originalText:source.sentence,correctedText:items[0].good,issues:[source]}).issues[0];
  store.saveBank(saved.id,bank(items),'test');
  return saved;
}

test('cached candidate selection rejects legacy split reorders while preserving verified grammar and spelling',()=>{
  const store=new Store(':memory:');
  try{
    const legacy=saveCached(store,'legacy-word-order',issue,[deletion,insertion]);
    const validOrder=saveCached(store,'valid-word-order',issue,[atomic]);
    const grammar=saveCached(store,'agreement',{offset:4,length:4,original:'work',replacement:'works',sentence:'She work here.',category:'agreement',explanation:'Con she, usa works.'},[{bad:'She work here.',good:'She works here.',original:'work',replacement:'works',category:'agreement',targetOffset:4,targetLength:4,answers:['works'],alternatives:[],alternateOrders:[]}]);
    const spelling=saveCached(store,'spelling',{offset:3,length:6,original:'freind',replacement:'friend',sentence:'My freind is here.',category:'spelling',explanation:'Se escribe friend.'},[{bad:'My freind is here.',good:'My friend is here.',original:'freind',replacement:'friend',category:'spelling',targetOffset:3,targetLength:6,answers:['friend'],alternatives:[],alternateOrders:[]}]);
    const candidates=selectVariedChoiceCandidates(store,legacy.id);
    assert.ok(candidates.some(candidate=>candidate.issue.id===validOrder.id),'A verified atomic reorder remains available to arcade rounds');
    assert.ok(candidates.some(candidate=>candidate.issue.id===grammar.id));
    assert.ok(candidates.some(candidate=>candidate.issue.id===spelling.id));
    assert.ok(candidates.every(candidate=>candidate.issue.id!==legacy.id),'Old version-10 deletion/insertion fragments must not enter either arcade round');
  }finally{store.close();}
});

test('an atomic cached reorder remains selectable when its only extra context is unchanged punctuation',()=>{
  const store=new Store(':memory:');
  try{
    const source={...issue,original:'I coffee like.',replacement:'I like coffee.',sentence:'I coffee like.',length:14};
    const item={bad:'I coffee like.',good:'I like coffee.',original:'coffee like.',replacement:'like coffee.',category:'word_order',targetOffset:2,targetLength:12,answers:['like coffee.'],alternatives:[],alternateOrders:[]};
    const saved=saveCached(store,'punctuated-atomic-order',source,[item]);
    const candidates=selectVariedChoiceCandidates(store,saved.id);
    assert.ok(candidates.some(candidate=>candidate.issue.id===saved.id),'The unchanged final period does not turn an atomic reorder into an invalid cache');
  }finally{store.close();}
});

test('bank generation replaces a malformed cached reorder even during its variety retry delay',async()=>{
  const store=new Store(':memory:');
  try{
    const saved=saveCached(store,'cached-order-regeneration',issue,[deletion,insertion]);
    store.saveBank(saved.id,{...bank([deletion,insertion]),varietyRetryAfter:Date.now()+300000},'test');
    const generated=[
      {bad:original,good:replacement},
      {bad:'She does not know where is my notebook.',good:'She does not know where my notebook is.'},
      {bad:'We do not know where is my notebook.',good:'We do not know where my notebook is.'}
    ].map(item=>({...item,original:'is my notebook',replacement:'my notebook is',alternatives:[],alternateOrders:[]}));
    const engines={
      check:async()=>({matches:[]}),
      chat:async(schema,prompt,input)=>({value:schema.shape.items?bank(generated):schema.shape.correctedText?{correctedText:input.text.replace('is my notebook','my notebook is')}:{decisions:input.candidates.map(candidate=>({index:candidate.index,needsCorrection:candidate.original==='is my notebook',replacement:candidate.original==='is my notebook'?'my notebook is':candidate.original}))}})
    };
    const result=await new GameService(store,engines).bank(saved,'en-US');
    assert.ok(result.items.some(item=>item.bad===original&&item.original==='is my notebook'&&item.replacement==='my notebook is'),'The cached split correction is rebuilt from the real source order');
    assert.ok(result.items.every(item=>item.original!=='where is'&&item.original!=='notebook.'));
    assert.deepEqual(store.getBank(saved.id).items,result.items,'Regeneration replaces the persisted malformed cache');
  }finally{store.close();}
});

test('a cached reorder containing unchanged word distractors is regenerated before Radar can reuse it',async()=>{
  const store=new Store(':memory:');
  try{
    const widened={...atomic,original,replacement,targetOffset:0,targetLength:original.length,answers:[replacement]};
    const saved=saveCached(store,'widened-order-regeneration',issue,[widened]);
    store.saveBank(saved.id,{...bank([widened]),varietyRetryAfter:Date.now()+300000},'test');
    const engines={
      check:async()=>({matches:[]}),
      chat:async(schema,prompt,input)=>{
        if(schema.shape.items)throw Error('Additional generation unavailable');
        if(schema.shape.correctedText)return {value:{correctedText:replacement}};
        return {value:{decisions:input.candidates.map(candidate=>({index:candidate.index,needsCorrection:true,replacement:'my notebook is'}))}};
      }
    };
    const result=await new GameService(store,engines).bank(saved,'en-US');
    assert.ok(result.items.length);
    assert.ok(result.items.every(item=>item.original==='is my notebook'&&item.replacement==='my notebook is'),'Unchanged words cannot remain in a reusable Radar target');
    const game=makeGame(saved,result,'radar');
    for(const tokenId of [0,1,2,3,4])assert.equal(evaluateGame(game,{tokenIndex:tokenId}).correct,false);
    assert.equal(evaluateGame(game,{tokenIndex:5}).correct,true);
  }finally{store.close();}
});

test('round creation regenerates an invalid word-order anchor before choosing another saved grammar issue',async()=>{
  for(const mode of ['choice','radar']){
    const store=new Store(':memory:');
    try{
      const saved=saveCached(store,'invalid-round-anchor-'+mode,issue,[deletion,insertion]);
      saveCached(store,'alternative-grammar-'+mode,{offset:4,length:4,original:'work',replacement:'works',sentence:'She work here.',category:'agreement',explanation:'Con she, usa works.'},[{bad:'She work here.',good:'She works here.',original:'work',replacement:'works',category:'agreement',targetOffset:4,targetLength:4,answers:['works'],alternatives:[],alternateOrders:[]}]);
      const games={bank:async source=>{const repaired=bank([atomic]);store.saveBank(source.id,repaired,'test');return repaired;}};
      const round=await new PracticeRounds(store,games).create({issueId:saved.id,mode,idempotencyKey:'regenerate-'+mode});
      assert.equal(round.game.issueId,saved.id,'The requested correction remains the first exercise after its cache is repaired');
      assert.equal(round.game.text,original);
      assert.equal(store.game(round.game.id).privateData.item.original,'is my notebook');
      assert.equal(store.game(round.game.id).privateData.item.replacement,'my notebook is');
      assert.equal(store.getBank(saved.id).items[0].original,'is my notebook','The round replaces the invalid anchor cache rather than bypassing it');
    }finally{store.close();}
  }
});
