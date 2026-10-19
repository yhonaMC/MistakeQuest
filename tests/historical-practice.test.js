import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../service/store.js';
import {GameService} from '../service/games.js';
const seed=(store,text,original,replacement,category)=>store.saveAnalysis({key:text,locale:'en-US',status:'issues',originalText:text,correctedText:text,issues:[{offset:text.indexOf(original),length:original.length,original,replacement,category,sentence:text,explanation:'Corrección antigua.'}]}).issues[0];
test('a fictional proper name outside the target cannot block another confirmed grammar exercise',async()=>{
  const store=new Store(':memory:'),text='My teacher zelan sees a jobs opportunities online.';try{
    seed(store,'My teacher zelan is kind.','zelan','Zelan','capitalization');
    const issue=seed(store,text,'a jobs','job','articles'),engines={check:async value=>({matches:[{offset:value.toLowerCase().indexOf('zelan'),length:5,replacements:[{value:'zeal'}],rule:{id:'MORFOLOGIK_RULE_EN_US',issueType:'misspelling'}}]}),chat:async(schema,prompt,input)=>{if(schema.shape.items)throw Error('Additional examples unavailable');return {value:{decisions:input.candidates.map(c=>({index:c.index,needsCorrection:true,replacement:'job'}))}};}};
    const game=await new GameService(store,engines).create(issue.id,'choice');assert.equal(store.game(game.id).privateData.item.good,'My teacher Zelan sees job opportunities online.');
  }finally{store.close();}
});
test('an unknown misspelled verb after friend is never invented as a personal name',async()=>{
  const store=new Store(':memory:'),text='My friend reeads english.';try{
    const issue=seed(store,text,'english','English','capitalization'),engines={check:async value=>({matches:[{offset:value.toLowerCase().indexOf('reeads'),length:6,replacements:[{value:'reads'}],rule:{id:'SPELLING',issueType:'misspelling'}},...value.includes('english')?[{offset:value.indexOf('english'),length:7,replacements:[{value:'English'}],rule:{id:'SPELLING',issueType:'misspelling'}}]:[]]}),chat:async()=>{throw Error('No verified alternative');}};
    await assert.rejects(new GameService(store,engines).create(issue.id,'choice'),/No verified alternative/);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM games').get().n,0);
  }finally{store.close();}
});
test('historical optional commas are acknowledged without creating a game or earning XP',async()=>{
  const store=new Store(':memory:');try{
    const issue=seed(store,'I work and I study.',' and',', and','punctuation'),before=store.progress().totals;
    const result=await new GameService(store,{check:async()=>{throw Error('An optional comma does not require a grammar engine');},chat:async()=>{throw Error('An optional comma does not require AI');}}).create(issue.id,'choice');
    assert.equal(result.status,'already_correct');assert.deepEqual(store.progress().totals,before);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM games').get().n,0);
    assert.equal(store.progress().patterns.length,0,'Dismissed false corrections must not remain recurrent-error suggestions');
  }finally{store.close();}
});
test('a historical agreement correction does not need evidence of a past tense',async()=>{
  const store=new Store(':memory:'),text='He like coffee.';try{
    const issue=seed(store,text,'like','likes','verb_tense'),engines={check:async value=>({matches:value===text?[{offset:3,length:4,replacements:[{value:'likes'}],rule:{id:'HE_VERB_AGR'}}]:[]}),chat:async()=>{throw Error('Supplemental generation unavailable');}};
    const game=await new GameService(store,engines).create(issue.id,'choice');assert.equal(game.category,'agreement');assert.equal(store.game(game.id).privateData.item.good,'He likes coffee.');
  }finally{store.close();}
});
test('a verified false historical verb correction is acknowledged instead of generating unrelated exercises',async()=>{
  const store=new Store(':memory:'),text='I often work with React.';try{
    const issue=seed(store,text,'work','working','verb_form'),engines={check:async value=>({matches:value.includes('working')?[{offset:value.indexOf('working'),length:7,replacements:[{value:'work'}],rule:{id:'BAD_GERUND'}}]:[]}),chat:async(schema,prompt,input)=>({value:schema.shape.correctedText?{correctedText:input.text}:schema.shape.needsCorrection?{needsCorrection:false,replacement:'work',explanation:'El presente con I ya es correcto.'}:{decisions:[{index:0,needsCorrection:false,replacement:'work'}]}})};
    const before=store.progress().totals,result=await new GameService(store,engines).create(issue.id,'repair');assert.equal(result.status,'already_correct');assert.deepEqual(store.progress().totals,before);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM games').get().n,0);
  }finally{store.close();}
});
test('an old invented acronym is rechecked as a foreign word before preparing practice',async()=>{
  const store=new Store(':memory:'),text='your dia';try{
    const issue=seed(store,text,'dia','DIA','capitalization'),engines={check:async value=>({matches:value.includes('dia')?[{offset:5,length:3,replacements:[{value:'DIA'},{value:'day'}],rule:{id:'SPELLING',issueType:'misspelling'}}]:[]}),chat:async(schema,prompt,input)=>{
      if(schema.shape.correctedText&&schema.shape.decisions)return {value:{correctedText:'your day',decisions:[{index:0,action:'correct',foreignLanguage:'Spanish',reason:'En inglés se usa day.'}]}};
      if(schema.shape.items)throw Error('Additional examples unavailable');
      return {value:{decisions:input.candidates.map(c=>({index:c.index,needsCorrection:true,replacement:'day'}))}};
    }};
    const game=await new GameService(store,engines).create(issue.id,'choice'),saved=store.game(game.id);assert.equal(game.category,'spelling');assert.equal(saved.privateData.item.replacement,'day');assert.equal(saved.privateData.item.good,'your day');
  }finally{store.close();}
});
