import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {Store} from '../../service/store.js';
import {categoryLabels} from '../../service/config.js';
import {applyEdits} from '../../service/edits.js';

const tables=['settings','analyses','issues','banks','games','attempts','completions','rewards'];
const immutableTables=['settings','analyses','games','attempts','completions','rewards'];
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rowValues=rows=>rows.map(row=>Object.keys(row).sort().map(key=>[key,row[key]]));
const rowsHash=rows=>digest(rowValues(rows));
const snapshotHash=rows=>digest(tables.map(table=>[table,rowValues(rows[table])]));
const readTables=db=>Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const nonempty=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;

function validatePrepared(initialRows,prepared){
  if(!initialRows||!tables.every(table=>Array.isArray(initialRows[table])&&initialRows[table].every(row=>row&&typeof row==='object'&&!Array.isArray(row)))||!Array.isArray(prepared)||!prepared.length)fail('INVALID_VERIFIED_CACHE','Falta la instantánea completa o la caché verificada.');
  const known=new Map(initialRows.issues.map(issue=>[issue.id,issue])),seen=new Set();
  for(const entry of prepared){
    const issue=known.get(entry?.issueId),patch=entry?.correction,bank=entry?.bank;
    if(!issue||seen.has(entry.issueId)||!patch||patch.original!==issue.original||!nonempty(patch.replacement,180)||typeof patch.category!=='string'||!Object.hasOwn(categoryLabels,patch.category)||!nonempty(patch.explanation,320))fail('INVALID_VERIFIED_CACHE','Una corrección no coincide con el error verificado.');
    seen.add(entry.issueId);
    if(!bank||bank.validatorVersion!==10||!Array.isArray(bank.items)||!nonempty(bank.model,100))fail('INVALID_VERIFIED_CACHE','El banco no pertenece a la versión verificada.');
    if(bank.status==='already_correct'){
      if(bank.items.length)fail('INVALID_VERIFIED_CACHE','Un fragmento correcto no debe tener ejercicios.');
      continue;
    }
    if(!bank.items.length)fail('INVALID_VERIFIED_CACHE','Un banco de práctica debe contener ejercicios verificados.');
    for(const item of bank.items){
      if(!item||!nonempty(item.bad,7200)||!nonempty(item.good,7200)||!nonempty(item.original,180)||!nonempty(item.replacement,180)||item.bad===item.good||!Number.isInteger(item.targetOffset)||item.targetOffset<0||!Number.isInteger(item.targetLength)||item.targetLength!==item.original.length||!Array.isArray(item.answers)||!item.answers.includes(item.replacement)||item.answers.some(answer=>!nonempty(answer,180)))fail('INVALID_VERIFIED_CACHE','Un ejercicio no conserva su corrección verificada.');
      try{
        if(applyEdits(item.bad,[{offset:item.targetOffset,length:item.targetLength,original:item.original,replacement:item.replacement}])!==item.good)fail('INVALID_VERIFIED_CACHE','Un ejercicio no conserva su corrección verificada.');
      }catch{fail('INVALID_VERIFIED_CACHE','Un ejercicio no conserva su corrección verificada.');}
    }
  }
}

// Caller must complete its isolated game verification before explicitly invoking this.
// No learner text is logged or exported; all comparisons happen in memory.
export function installVerifiedPracticeCache(path,initialRows,prepared){
  validatePrepared(initialRows,prepared);
  const initialHash=snapshotHash(initialRows),readonly=new DatabaseSync(path,{readOnly:true});
  try{
    readonly.exec('BEGIN');
    const current=readTables(readonly);readonly.exec('COMMIT');
    if(snapshotHash(current)!==initialHash)fail('PERSONAL_DATA_CHANGED','El progreso cambió durante la verificación. No se instaló la caché.');
  }finally{readonly.close();}
  const store=new Store(path);
  try{return store.transaction(()=>{
    // Recheck after acquiring the writer lock, closing the read/check/write race.
    if(snapshotHash(readTables(store.db))!==initialHash)fail('PERSONAL_DATA_CHANGED','El progreso cambió durante la verificación. No se instaló la caché.');
    const expectedIssues=initialRows.issues.map(row=>({...row})),expectedById=new Map(expectedIssues.map(row=>[row.id,row]));
    let refreshedCorrections=0;
    for(const entry of prepared){
      const row=expectedById.get(entry.issueId),patch=entry.correction;
      if(row.replacement!==patch.replacement||row.category!==patch.category||row.label!==categoryLabels[patch.category]||row.explanation!==patch.explanation){
        store.applyPracticeCorrection(entry.issueId,patch);
        Object.assign(row,{replacement:patch.replacement,category:patch.category,label:categoryLabels[patch.category],explanation:patch.explanation});
        refreshedCorrections++;
      }
      store.saveBank(entry.issueId,entry.bank,entry.bank.model);
    }
    const after=readTables(store.db);
    const invariant=(condition)=>{if(!condition)fail('INSTALL_INVARIANT_FAILED','La instalación alteraría datos fuera de los bancos y sus correcciones. Se deshicieron los cambios.');};
    for(const table of immutableTables)invariant(rowsHash(after[table])===rowsHash(initialRows[table]));
    invariant(rowsHash(after.issues)===rowsHash(expectedIssues));
    const installed=new Map(prepared.map(entry=>[entry.issueId,entry])),beforeBanks=new Map(initialRows.banks.map(row=>[row.issue_id,row]));
    invariant(after.banks.length===new Set([...beforeBanks.keys(),...installed.keys()]).size);
    for(const row of after.banks){
      const entry=installed.get(row.issue_id);
      if(entry)invariant(row.model===entry.bank.model&&row.payload===JSON.stringify(entry.bank)&&nonempty(row.created_at,100));
      else{const prior=beforeBanks.get(row.issue_id);invariant(Boolean(prior));invariant(rowsHash([row])===rowsHash([prior]));}
    }
    return {installedBanks:prepared.length,refreshedCorrections,retiredIssues:prepared.filter(entry=>entry.bank.status==='already_correct').length};
  });}finally{store.close();}
}
