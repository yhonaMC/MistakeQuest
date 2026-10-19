import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../service/store.js';
let installVerifiedPracticeCache;
try{({installVerifiedPracticeCache}=await import('./diagnostics/install-practice-cache.js'));}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}

const tables=['settings','analyses','issues','banks','games','attempts','completions','rewards'];
const immutable=['settings','analyses','games','attempts','completions','rewards'];
function snapshot(path){
  const db=new DatabaseSync(path,{readOnly:true});
  try{return Object.fromEntries(tables.map(name=>[name,db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));}finally{db.close();}
}
function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'mq-install-cache-')),path=join(directory,'personal-simulated.sqlite'),store=new Store(path);
  store.updateSettings({saveTexts:true,locale:'en-GB',model:'test-model'});
  const day=store.saveAnalysis({key:'day-error',locale:'en-GB',status:'issues',originalText:'your dia',correctedText:'your DIA',issues:[{offset:5,length:3,original:'dia',replacement:'DIA',category:'capitalization',explanation:'Una corrección anterior.',sentence:'your dia'}]}).issues[0];
  const work=store.saveAnalysis({key:'valid-work',locale:'en-GB',status:'issues',originalText:'I work every day.',correctedText:'I working every day.',issues:[{offset:2,length:4,original:'work',replacement:'working',category:'verb_form',explanation:'Una corrección anterior.',sentence:'I work every day.'}]}).issues[0];
  const game=store.createGame({issueId:day.id,mode:'repair',exerciseKey:'old-game-reward',privateData:{item:{bad:'your dia',good:'your DIA'}},publicData:{label:'Mayúsculas'},state:{help:'none'}});
  store.recordAttempt(game.id,{idempotencyKey:'old-game-completion',correct:true,completed:true,response:{message:'Bien.'}});
  store.saveBank(day.id,{validatorVersion:9,items:[{bad:'your dia',good:'your DIA'}]},'old-model');
  const bad='How is your dia?',good='How is your day?';
  const prepared=[{issueId:day.id,correction:{original:'dia',replacement:'day',category:'spelling',explanation:'Día se escribe day en inglés.'},bank:{validatorVersion:10,model:'test-model',source:'ai',label:'Ortografía',explanation:'Usa day.',hint:'Piensa en día.',items:[{bad,good,original:'dia',replacement:'day',targetOffset:bad.indexOf('dia'),targetLength:3,answers:['day'],alternatives:[],alternateOrders:[]}]}},{issueId:work.id,correction:{original:work.original,replacement:work.replacement,category:work.category,explanation:work.explanation},bank:{validatorVersion:10,model:'test-model',status:'already_correct',items:[],message:'El presente simple ya es válido.'}}];
  store.close();
  return {path,directory,day,work,game,prepared,initial:snapshot(path),clean:()=>rmSync(directory,{recursive:true,force:true})};
}

test('the verified practice cache installer is implemented',()=>assert.equal(typeof installVerifiedPracticeCache,'function'));
if(installVerifiedPracticeCache){
  test('installing verified banks retires a false positive and refreshes metadata while preserving every earned record',()=>{
    const f=fixture();try{
      const report=installVerifiedPracticeCache(f.path,f.initial,f.prepared),after=snapshot(f.path);
      assert.equal(report.installedBanks,2);assert.equal(report.refreshedCorrections,1);assert.equal(report.retiredIssues,1);
      for(const name of immutable)assert.deepEqual(after[name],f.initial[name],name);
      assert.equal(after.issues.length,f.initial.issues.length);
      for(const row of after.issues){const prior=f.initial.issues.find(old=>old.id===row.id);for(const key of ['id','analysis_id','offset','length','original','sentence','created_at'])assert.equal(row[key],prior[key],key);}
      const day=after.issues.find(row=>row.id===f.day.id);assert.equal(day.replacement,'day');assert.equal(day.category,'spelling');assert.equal(day.label,'Ortografía');
      assert.equal(after.completions[0].xp,20);assert.equal(JSON.parse(after.banks.find(row=>row.issue_id===f.work.id).payload).status,'already_correct');
      assert.equal(after.banks.find(row=>row.issue_id===f.day.id).model,'test-model');
    }finally{f.clean();}
  });
  test('concurrent changes after the read-only snapshot reject installation without writing any table',()=>{
    const f=fixture();try{
      const changed=new Store(f.path);changed.updateSettings({locale:'en-US'});changed.close();
      const beforeAttempt=snapshot(f.path);
      assert.throws(()=>installVerifiedPracticeCache(f.path,f.initial,f.prepared),error=>error.code==='PERSONAL_DATA_CHANGED');
      assert.deepEqual(snapshot(f.path),beforeAttempt);
    }finally{f.clean();}
  });
  test('invalid banks, unrelated issue IDs and source fingerprints are rejected without writes',()=>{
    const f=fixture();try{
      const copies=()=>structuredClone(f.prepared);
      const variants=[];
      let value=copies();value[0].bank.validatorVersion=9;variants.push(value);
      value=copies();value[0].bank.items=[];variants.push(value);
      value=copies();value[1].bank.items=value[0].bank.items;variants.push(value);
      value=copies();value[0].issueId='unrelated';variants.push(value);
      value=copies();value[0].correction.original='unrelated';variants.push(value);
      value=copies();value[0].bank.items[0].targetOffset=0;variants.push(value);
      value=copies();value.push(value[0]);variants.push(value);
      for(const prepared of variants){assert.throws(()=>installVerifiedPracticeCache(f.path,f.initial,prepared),error=>error.code==='INVALID_VERIFIED_CACHE');assert.deepEqual(snapshot(f.path),f.initial);}
    }finally{f.clean();}
  });
  test('an invariant violation rolls back corrections and bank writes inside the transaction',()=>{
    const f=fixture();try{
      const db=new DatabaseSync(f.path);
      db.exec("CREATE TRIGGER corrupt_snapshot AFTER UPDATE ON issues BEGIN UPDATE games SET state='{}' WHERE issue_id=NEW.id; END;");db.close();
      assert.throws(()=>installVerifiedPracticeCache(f.path,f.initial,f.prepared),error=>error.code==='INSTALL_INVARIANT_FAILED');
      assert.deepEqual(snapshot(f.path),f.initial);
    }finally{f.clean();}
  });
}
