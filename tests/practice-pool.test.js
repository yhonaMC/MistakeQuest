import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../service/store.js';
let selectPracticeItems;
try{({selectPracticeItems}=await import('../service/practice-pool.js'));}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}

const items=['I study English.','We speak English.','She reads English.','They learn English.'].map(good=>({good,bad:good.replace('English','english'),original:'english',replacement:'English'}));
function seed(store,key='pool-review'){
  return store.saveAnalysis({key,locale:'en-US',status:'issues',originalText:'I study english.',correctedText:'I study English.',issues:[{offset:8,length:7,original:'english',replacement:'English',sentence:'I study english.',category:'capitalization',explanation:'Un idioma lleva mayúscula inicial.'}]}).issues[0];
}
function remember(store,issue,mode,shown){
  const privateData=mode==='pairs'?{bank:{items:shown}}:mode==='judge'?{judges:shown.map(item=>({text:item.bad,good:item.good}))}:{item:shown[0]};
  return store.createGame({issueId:issue.id,mode,exerciseKey:'pool-'+mode+'-'+Math.random(),privateData,publicData:{label:'Mayúsculas'},state:{help:'none'}});
}

test('the shared persisted practice selection is implemented',()=>assert.equal(typeof selectPracticeItems,'function'));
if(selectPracticeItems){
  test('unseen items keep stable order and equivalent sentences are deduplicated without changing references',()=>{
    const store=new Store(':memory:');
    try{
      const issue=seed(store),duplicate={...items[0],good:'  I   study English!  '},bank={items:[items[0],duplicate,items[1]]};
      const result=selectPracticeItems(store,issue.id,bank);
      assert.deepEqual(result,[items[0],items[1]]);assert.equal(result[0],items[0]);assert.equal(bank.items.length,3);
    }finally{store.close();}
  });
  test('all formats count shown phrases globally and ties prefer the oldest exposure',()=>{
    const store=new Store(':memory:');
    try{
      const issue=seed(store);
      remember(store,issue,'choice',[items[0]]);remember(store,issue,'repair',[items[0]]);
      remember(store,issue,'radar',[items[1]]);remember(store,issue,'pairs',[items[2],items[1]]);
      remember(store,issue,'judge',[items[3],items[2]]);
      assert.deepEqual(selectPracticeItems(store,issue.id,{items}),[items[3],items[0],items[1],items[2]]);
    }finally{store.close();}
  });
  test('a repeated judge sentence counts once per game and unrelated saved errors do not skew selection',()=>{
    const store=new Store(':memory:');
    try{
      const issue=seed(store),other=seed(store,'other-error');
      remember(store,issue,'judge',[items[0],items[0],items[0]]);remember(store,issue,'choice',[items[1]]);
      for(let i=0;i<4;i++)remember(store,other,'choice',[items[0]]);
      assert.deepEqual(selectPracticeItems(store,issue.id,{items:items.slice(0,2)}),items.slice(0,2));
    }finally{store.close();}
  });
  test('rotation survives restarting SQLite and only reads stored snapshots and earned progress',()=>{
    const directory=mkdtempSync(join(tmpdir(),'mq-pool-')),path=join(directory,'progress.sqlite');let store=new Store(path);
    try{
      const issue=seed(store),completed=remember(store,issue,'choice',[items[0]]);
      store.recordAttempt(completed.id,{idempotencyKey:'pool-earned-progress',correct:true,completed:true,answer:'English',response:{message:'Correcto'}});
      remember(store,issue,'repair',[items[0]]);remember(store,issue,'radar',[items[1]]);
      store.close();store=new Store(path);
      const before=store.export(),result=selectPracticeItems(store,issue.id,{items:items.slice(0,3)}),after=store.export();
      assert.deepEqual(result,[items[2],items[1],items[0]]);assert.deepEqual(after.tables,before.tables);assert.deepEqual(after.progress,before.progress);assert.equal(after.progress.totals.xp,20);
    }finally{store.close();rmSync(directory,{recursive:true,force:true});}
  });
  test('a malformed historical snapshot cannot prevent selection from a valid current bank',()=>{
    const store=new Store(':memory:');
    try{
      const issue=seed(store),game=remember(store,issue,'choice',[items[0]]);
      store.db.prepare('UPDATE games SET private_data=? WHERE id=?').run('{invalid-json',game.id);
      assert.deepEqual(selectPracticeItems(store,issue.id,{items}),items);
    }finally{store.close();}
  });
}
