import test from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../service/store.js';
import {sourcePracticeItems} from '../service/source-practice.js';
let Games;try{Games=await import('../service/games.js');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
test('AI minigame validation and evaluation are implemented',()=>assert.equal(typeof Games?.validateBank,'function','Generated minigames are not implemented'));
if(Games){
  test('a final compound correction uses its own clause after a comma followed by I',()=>{
    const text='There are uncorrected words in the earlier passage, I hope that my english improve bye',original='I hope that my english improve bye',issue={id:'last-clause',offset:text.indexOf(original),length:original.length,original,replacement:'I hope that my English improves. Bye.',sentence:text,category:'verb_form'};
    const items=sourcePracticeItems(issue,[issue]);assert.ok(items.length);assert.ok(items.every(item=>item.good.startsWith('I hope that my English')));
  });
  test('punctuation practice keeps the sentence start before an introductory comma',()=>{
    const text='Today, my teacher says it is important for my English and my speaking, I hope my English improves.',issue={id:'boundary',offset:text.indexOf('speaking,'),length:9,original:'speaking,',replacement:'speaking.',sentence:text,category:'punctuation'};
    const [item]=sourcePracticeItems(issue,[issue]);
    assert.equal(item.bad,text);assert.equal(item.good,'Today, my teacher says it is important for my English and my speaking. I hope my English improves.');
  });
  test('a one-word farewell retains the preceding sentence for capitalization practice',()=>{
    const text='I hope my English improve bye',issue={id:'bye',offset:text.indexOf('bye'),length:3,original:'bye',replacement:'Bye.',sentence:text,category:'punctuation'},related=[{id:'verb',offset:text.indexOf('improve'),length:7,original:'improve',replacement:'improves.',sentence:text,category:'agreement'},issue];
    const [item]=sourcePracticeItems(issue,related);
    assert.equal(item.bad,'I hope my English improves. bye');assert.equal(item.good,'I hope my English improves. Bye.');assert.equal(item.targetOffset,item.bad.indexOf('bye'));
  });
  test('all six games can start from a confirmed compound correction when fresh generation fails',async()=>{
    const store=new Store(':memory:'),original='I hope that my english improve bye',replacement='I hope that my English improves. Bye.',text='I wrote a short note about my day. '.repeat(4)+original;
    const engines={check:async()=>({matches:[]}),chat:async(schema,prompt,input)=>{if(schema.shape.items)throw Error('Fresh generation is unavailable');return {value:{decisions:input.candidates.map(c=>({index:c.index,needsCorrection:true,replacement:{english:'English',improve:'improves.',bye:'Bye.'}[c.original]}))}};}};
    try{
      const analysis=store.saveAnalysis({key:'compound-game',locale:'en-US',status:'issues',originalText:text,correctedText:text,issues:[{offset:text.indexOf(original),length:original.length,original,replacement,sentence:text,category:'verb_form',explanation:'Corrige concordancia y mayúsculas.'}]}),games=new Games.GameService(store,engines);
      for(const mode of ['choice','radar','repair','order','pairs','judge']){const game=await games.create(analysis.issues[0].id,mode);assert.equal(game.mode,mode);assert.ok(store.game(game.id).privateData.bank.items.some(item=>item.original==='improve'&&item.replacement==='improves.'));}
    }finally{store.close();}
  });
  const bank={label:'Pasado simple',explanation:'El pasado de go es went.',hint:'Piensa en una acción de ayer.',items:[{bad:'Yesterday I go home.',good:'Yesterday I went home.',original:'go',replacement:'went',alternatives:[],alternateOrders:['I went home yesterday.']},{bad:'Last night we go out.',good:'Last night we went out.',original:'go',replacement:'went',alternatives:[],alternateOrders:[]},{bad:'Yesterday she go home.',good:'Yesterday she went home.',original:'go',replacement:'went',alternatives:[],alternateOrders:[]}]};
  const issue={id:'issue',category:'verb_tense',label:'Tiempos verbales',original:'go',replacement:'went',sentence:'Yesterday I go home.',explanation:'Usa went.'};
  const engines={check:async()=>({matches:[]})};
  test('bank rejects mismatched corrections and complex examples',async()=>{
    const good=await Games.validateBank(bank,issue,engines,'en-US');assert.equal(good.items.length,3);
    const invalid=await Games.validateBank({...bank,items:[{...bank.items[0],good:'Yesterday I purchased an extraordinary residence.'}]},issue,engines,'en-US');assert.equal(invalid.items.length,0);
  });
  test('a grammatical alternative with a different meaning is not silently accepted',async()=>{
    const checked=await Games.validateBank({...bank,items:[{...bank.items[0],alternatives:['ran']}]},issue,engines,'en-US');
    assert.deepEqual(checked.items[0].answers,['went']);
  });
  test('generated examples must practice the actual source correction',async()=>{
    const unrelated={...bank,items:[{bad:'I like coffee.',good:'I enjoy coffee.',original:'like',replacement:'enjoy',alternatives:[],alternateOrders:[]}]};
    assert.equal((await Games.validateBank(unrelated,issue,engines,'en-US')).items.length,0);
    const swaps={...bank,items:[{...bank.items[0],alternateOrders:['Home went I yesterday.']}]};assert.equal((await Games.validateBank(swaps,issue,engines,'en-US')).items[0].alternateOrders.length,0);
  });
  test('all formats have public projections without server answer keys',()=>{
    for(const mode of ['radar','repair','choice','order','pairs','judge']){
      const game=Games.makeGame(issue,bank,mode,0);const publicData=Games.publicGame({...game,id:'game'});
      assert.equal(publicData.mode,mode);assert.equal(publicData.privateData,undefined);assert.equal(publicData.solution,undefined);assert.equal(publicData.replacement,undefined);
    }
  });
  test('pairs never show indistinguishable right-hand answers with conflicting IDs',()=>{
    const duplicate={...bank,items:[{bad:'I hope my english improves.',good:'I hope my English improves.',original:'english',replacement:'English',alternatives:[],alternateOrders:[]},{bad:'I hope my English improve.',good:'I hope my English improves.',original:'improve',replacement:'improves',alternatives:[],alternateOrders:[]}]};
    const game=Games.publicGame({...Games.makeGame({...issue,category:'verb_form'},duplicate,'pairs'),id:'pairs'});
    assert.equal(new Set(game.right.map(item=>item.text)).size,game.right.length);
  });
  test('repair evaluates fragments and pairs need all connections',()=>{
    const repair=Games.makeGame(issue,bank,'repair',0);assert.equal(Games.evaluateGame(repair,{answer:'went'}).correct,true);assert.equal(Games.evaluateGame(repair,{answer:'go'}).correct,false);
    const pairs=Games.makeGame(issue,bank,'pairs',0);let result=Games.evaluateGame(pairs,{leftId:0,rightId:0});assert.equal(result.completed,false);pairs.state=result.state;result=Games.evaluateGame(pairs,{leftId:1,rightId:1});pairs.state=result.state;result=Games.evaluateGame(pairs,{leftId:2,rightId:2});assert.equal(result.completed,true);
  });
  test('judge preserves correct sentences and ordering accepts valid alternate order',()=>{
    const judge=Games.makeGame(issue,bank,'judge',0);const result=Games.evaluateGame(judge,{needsChange:false});assert.equal(result.correct,true);assert.equal(result.response.correctedSentence,'Yesterday I went home.');
    const order=Games.makeGame(issue,bank,'order',0);assert.equal(Games.evaluateGame(order,{tokenIds:[1,2,3,0]}).correct,true);
  });
  test('ordering keeps proper capitalization and internal punctuation in the final sentence',()=>{
    const capitalIssue={...issue,category:'capitalization',original:'english',replacement:'English',sentence:'I speak english.'};
    const capitalBank={...bank,items:[{bad:'I speak english.',good:'I speak English.',original:'english',replacement:'English',alternatives:[],alternateOrders:[]}]};
    const game=Games.makeGame(capitalIssue,capitalBank,'order');assert.equal(game.privateData.wordBank[2].text,'English');assert.equal(Games.evaluateGame(game,{tokenIds:[0,1,2]}).response.correctedSentence,'I speak English.');
    const commaBank={...bank,items:[{bad:'Yesterday, I go home.',good:'Yesterday, I went home.',original:'go',replacement:'went',alternatives:[],alternateOrders:[]}]};
    const commaGame=Games.makeGame(issue,commaBank,'order');assert.equal(Games.evaluateGame(commaGame,{tokenIds:[0,1,2,3]}).response.correctedSentence,'Yesterday, I went home.');
    const questionBank={...bank,items:[{bad:'Does she likes coffee?',good:'Does she like coffee?',original:'likes',replacement:'like',alternatives:[],alternateOrders:[]}]};
    const questionGame=Games.makeGame({...issue,original:'likes',replacement:'like'},questionBank,'order');assert.equal(Games.evaluateGame(questionGame,{tokenIds:[0,1,2,3]}).response.correctedSentence,'Does she like coffee?');
  });
  test('bank audit excludes correct or unrelated sentences',async()=>{
    const engine={chat:async(schema,prompt,input)=>({value:schema.shape.correctedText?{correctedText:input.text}:{decisions:[{index:1,needsCorrection:true,replacement:'went'}]}})};
    const audited=await Games.verifyBank(bank,issue,engine,{locale:'en-US',model:'test'});assert.deepEqual(audited.items,[bank.items[1]]);
  });
  test('focused audit verifies the marked source fragment without requiring a quoted full sentence',async()=>{
    const source={...issue,category:'capitalization',original:'english',replacement:'English'};
    const sourceBank={...bank,items:[{bad:'I hope my english improves. Bye.',good:'I hope my English improves. Bye.',original:'english',replacement:'English',category:'capitalization',alternatives:[],alternateOrders:[]}]};
    const engine={chat:async()=>({value:{decisions:[{index:0,needsCorrection:true,replacement:'English'}]}})};
    assert.equal((await Games.verifyBank(sourceBank,source,engine,{})).items.length,1);
  });
  test('repair does not accept wrong capitalization as a spelling correction',()=>{
    const spellingIssue={...issue,category:'spelling',original:'Englsh',replacement:'English',sentence:'I speak Englsh.'};
    const spellingBank={...bank,items:[{bad:'I speak Englsh.',good:'I speak English.',original:'Englsh',replacement:'English',alternatives:[],alternateOrders:[]}]};
    const game=Games.makeGame(spellingIssue,spellingBank,'repair');assert.equal(Games.evaluateGame(game,{answer:'english'}).correct,false);assert.equal(Games.evaluateGame(game,{answer:'English'}).correct,true);
  });
  test('independent review rejects a bank when no errors are found',async()=>{
    const engine={chat:async(schema,prompt,input)=>({value:schema.shape.correctedText?{correctedText:input.text}:{decisions:[]}})};
    const audited=await Games.verifyBank(bank,issue,engine,{});assert.deepEqual(audited.items,[]);
  });
  test('a second blind proofread can confirm an error missed by the marked-fragment audit',async()=>{
    const source={...issue,category:'agreement',original:'bite',replacement:'bites'};
    const simple={...bank,items:[{bad:'The dog bite the man.',good:'The dog bites the man.',original:'bite',replacement:'bites',alternatives:[],alternateOrders:[]}]};
    const engine={chat:async schema=>({value:schema.shape.correctedText?{correctedText:'The dog bites the man.'}:{decisions:[{index:0,needsCorrection:false,replacement:'bite'}]}})};
    assert.equal((await Games.verifyBank(simple,source,engine,{})).items.length,1);
  });
  test('valid habitual would cannot become a supposedly incorrect practice sentence',async()=>{
    const store=new Store(':memory:'),text='When I was young I would tell stories.';
    const saved=store.saveAnalysis({key:'valid-would',locale:'en-US',status:'issues',originalText:text,correctedText:'When I was young I told stories.',issues:[{offset:text.indexOf('would tell'),length:10,original:'would tell',replacement:'told',category:'verb_tense',sentence:text,explanation:'Pasado.'}]});
    const engine={check:async()=>({matches:[]}),chat:async schema=>({value:schema.shape.items?bank:{decisions:[]}})};
    try{await assert.rejects(new Games.GameService(store,engine).create(saved.issues[0].id,'choice'),error=>error.code==='NO_VALID_GAME');assert.equal(store.getBank(saved.issues[0].id),null);}finally{store.close();}
  });
  test('tense practice rejects ambiguous present-to-past examples before independent review',async()=>{
    const source={...issue,original:'still is difficult',replacement:'still was difficult',sentence:'The lesson still is difficult.'};
    const ambiguous={...bank,items:[{bad:'She said that the lesson still is difficult.',good:'She said that the lesson still was difficult.',original:'is',replacement:'was',alternatives:[],alternateOrders:[]}]};
    const checked=await Games.validateBank(ambiguous,source,engines,'en-US');
    assert.equal(checked.items.length,0,'A past reporting verb does not make a present subordinate verb incorrect');
    assert.ok(checked.rejections.length,'Generation needs the cause of rejection to repair its next examples');
  });
  test('tense practice accepts the same source change with an explicit past context',async()=>{
    const source={...issue,original:'still is difficult',replacement:'still was difficult'};
    const explicit={...bank,items:[{bad:'Yesterday the lesson still is difficult.',good:'Yesterday the lesson still was difficult.',original:'is',replacement:'was',alternatives:[],alternateOrders:[]}]};
    const checked=await Games.validateBank(explicit,source,engines,'en-US');
    assert.equal(checked.items.length,1);
    for(const mode of ['radar','repair','choice','order','pairs','judge'])assert.equal(Games.publicGame({...Games.makeGame(source,checked,mode),id:'game'}).mode,mode);
  });
  test('practice explains the verified exercise rather than repeating a stale source explanation',async()=>{
    const explicit={...bank,explanation:'Con yesterday, usa el pasado went.'};
    const checked=await Games.validateBank(explicit,{...issue,explanation:'Keep all verbs in the same tense.'},engines,'en-US');
    assert.equal(checked.explanation,'Con yesterday, usa el pasado went.');
  });
  const futureIssue={...issue,original:'went',replacement:'will go',sentence:'Tomorrow I went home.'};
  const futureBank={...bank,items:[{bad:'Tomorrow I went home.',good:'Tomorrow I will go home.',original:'went',replacement:'will go',alternatives:[],alternateOrders:[]}]};
  test('future practice accepts clear future context rather than demanding past markers',async()=>{
    assert.equal((await Games.validateBank(futureBank,futureIssue,engines,'en-US')).items.length,1);
  });
  test('independent audit also recognizes the future target tense',async()=>{
    const engine={chat:async()=>({value:{decisions:[{index:0,needsCorrection:true,replacement:'will go'}]}})};
    assert.equal((await Games.verifyBank(futureBank,futureIssue,engine,{})).items.length,1);
  });
  test('a past marker cannot justify replacing a past verb with a future verb',async()=>{
    const contradictory={...futureBank,items:[{...futureBank.items[0],bad:'Yesterday I went home.',good:'Yesterday I will go home.'}]};
    assert.equal((await Games.validateBank(contradictory,futureIssue,engines,'en-US')).items.length,0);
  });
}
