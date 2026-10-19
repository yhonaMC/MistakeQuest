import {randomUUID} from 'node:crypto';
import {AppError} from './config.js';
import {digest} from './store.js';
import {makeGame,publicGame} from './games.js';
import {normalizeAnswer,normalizeSentence} from './edits.js';
import {selectVariedChoiceCandidates} from './practice-pool.js';
const parse=JSON.parse,json=JSON.stringify,emptyStats=()=>({correct:0,wrong:0,missed:0,assisted:0,exhausted:0}),count=stats=>stats.correct+stats.wrong+stats.missed+stats.exhausted;
const sentence=entry=>normalizeSentence(entry.bank.items[0].good),pair=entry=>json([normalizeAnswer(entry.bank.items[0].original,true),normalizeAnswer(entry.bank.items[0].replacement,true)]);

export class PracticeRounds{
  constructor(store,games){this.store=store;this.games=games;}
  row(id){const row=this.store.db.prepare('SELECT * FROM practice_rounds WHERE id=?').get(id);if(!row)throw new AppError('ROUND_NOT_FOUND','Esta ronda ya no está disponible.',404);return row;}
  view(row){
    const plan=parse(row.plan),stats=parse(row.stats),completedCount=count(stats),complete=completedCount>=plan.length,ids=parse(row.game_ids),game=!complete&&ids[row.position]?this.store.game(ids[row.position]):null,source=this.store.issue(row.issue_id);
    return {id:row.id,issueId:row.issue_id,mode:row.mode,total:plan.length,completedCount,complete,stats,mix:parse(row.mix),points:row.points,xpEarned:row.xp_earned,timeLimitMs:row.time_limit_ms,createdAt:row.created_at,source:source?{id:source.id,label:source.label,original:source.original,replacement:source.replacement}:null,game:game?publicGame(game):null};
  }
  get(id){return this.view(this.row(id));}
  createCurrent(row){
    const plan=parse(row.plan),ids=parse(row.game_ids),entry=plan[row.position];if(!entry||ids[row.position])return row;
    const issue=this.store.issue(entry.issueId);if(!issue)throw new AppError('ISSUE_NOT_FOUND','El error de esta ronda ya no está guardado.',404);
    const prepared=makeGame(issue,entry.bank,row.mode);Object.assign(prepared.state,{learningRoundId:row.id,learningRoundIndex:row.position,learningRoundTotal:plan.length,learningKind:entry.kind,...row.mode==='choice'?{continuous:true}:{guided:true,discardedTokenIds:[],hintLevel:0,assisted:false}});
    const game=this.store.createGame(prepared);ids[row.position]=game.id;this.store.db.prepare('UPDATE practice_rounds SET game_ids=? WHERE id=?').run(json(ids),row.id);return this.row(row.id);
  }
  plan(pool,issueId,mode,previous,locale){
    const total=mode==='choice'?10:3,seen=new Map(),chosen=[],usedSentences=new Set(),usedIssues=new Set(),usedPairs=new Set();
    const history=this.store.db.prepare('SELECT g.rowid AS sequence,g.mode,g.private_data FROM games g JOIN issues i ON i.id=g.issue_id JOIN analyses a ON a.id=i.analysis_id WHERE a.locale=? ORDER BY g.rowid').all(locale);
    for(const row of history){let data;try{data=parse(row.private_data);}catch{continue;}const items=row.mode==='pairs'||row.mode==='judge'?data.bank?.items:[data.item];for(const item of items||[])if(typeof item?.good==='string')seen.set(normalizeSentence(item.good),row.sequence);}
    const unique=new Map();for(const candidate of pool){const entry={issueId:candidate.issue.id,bank:{...candidate.bank,items:[candidate.bank.items[0]]}},key=entry.issueId+':'+sentence(entry);if(!unique.has(key))unique.set(key,entry);}
    const available=[...unique.values()];
    const take=(options,kind)=>{
      const eligible=options.filter(entry=>!usedSentences.has(sentence(entry))).sort((a,b)=>Number(usedPairs.has(pair(a)))-Number(usedPairs.has(pair(b)))||Number(usedIssues.has(a.issueId))-Number(usedIssues.has(b.issueId))||(seen.get(sentence(a))||-1)-(seen.get(sentence(b))||-1));
      const entry=eligible[0];if(!entry)return false;chosen.push({...entry,kind});usedSentences.add(sentence(entry));usedIssues.add(entry.issueId);usedPairs.add(pair(entry));return true;
    };
    if(!previous){const anchor=available.find(entry=>entry.issueId===issueId)||available[0];if(anchor)take([anchor],seen.has(sentence(anchor))?'spaced':'new');while(chosen.length<total&&take(available.filter(entry=>!seen.has(sentence(entry))),'new')){};}
    else{
      const failed=new Map();for(const id of parse(previous.game_ids)){const game=this.store.game(id);if(game&&game.completed&&(game.state.outcome!=='correct'||game.state.assisted))failed.set(game.issueId,game.privateData.item.good);}
      const failures=[...failed.keys()].slice(0,total);for(const id of failures){const entries=available.filter(entry=>entry.issueId===id),different=entries.filter(entry=>entry.bank.items[0].good!==failed.get(id));take(different.length?different:entries,'review');}
      const reviewTarget=failures.length,spacedTarget=mode==='choice'?(reviewTarget===0?2:Math.max(0,5-reviewTarget)):reviewTarget===0?1:0,newTarget=Math.max(0,total-reviewTarget-spacedTarget);
      for(let i=0;i<spacedTarget&&chosen.length<total;i++)if(!take(available.filter(entry=>seen.has(sentence(entry))&&!failed.has(entry.issueId)),'spaced'))break;
      for(let i=0;i<newTarget&&chosen.length<total;i++)if(!take(available.filter(entry=>!seen.has(sentence(entry))),'new'))break;
    }
    while(chosen.length<total&&take(available.filter(entry=>!seen.has(sentence(entry))),'new')){};
    while(chosen.length<total&&take(available,'practice')){};
    for(let index=0;chosen.length<total;index++)chosen.push({...available[index%available.length],kind:'practice'});
    if(previous){
      const fresh=chosen.filter(entry=>entry.kind==='new'),old=chosen.filter(entry=>entry.kind!=='new'),mixed=[],freshCount=fresh.length;let freshUsed=0;
      while(mixed.length<chosen.length){const nextFresh=Math.floor((freshUsed+.5)*chosen.length/(freshCount||1));if(fresh.length&&(!old.length||mixed.length>=nextFresh)){mixed.push(fresh.shift());freshUsed++;}else mixed.push(old.shift());}
      return mixed;
    }
    return chosen;
  }
  async create(input,signal){
    const requestHash=digest(input),existing=this.store.db.prepare('SELECT * FROM practice_rounds WHERE request_key=?').get(input.idempotencyKey);
    if(existing){if(existing.request_hash!==requestHash)throw new AppError('REUSED_KEY','La clave ya pertenece a otra ronda.',409);return this.view(existing);}
    const issue=this.store.issue(input.issueId);if(!issue)throw new AppError('ISSUE_NOT_FOUND','Este error ya no está en tu historial.',404);const locale=this.store.analysis(issue.analysisId).locale;
    let pool=selectVariedChoiceCandidates(this.store,issue.id),anchorBank;try{anchorBank=this.store.getBank(issue.id);}catch{}
    const retired=bank=>bank?.validatorVersion===10&&bank.status==='already_correct'?{status:'already_correct',issueId:issue.id,message:bank.message||'Este fragmento ya estaba bien. No necesita un reto.',context:bank.context||issue.sentence}:null;
    if(retired(anchorBank))return retired(anchorBank);
    if(anchorBank?.validatorVersion!==10||!anchorBank.items?.length&&anchorBank.status!=='already_correct'){try{await this.games.bank(issue,locale,signal);}catch(error){if(signal?.aborted||!pool.length)throw error;}pool=selectVariedChoiceCandidates(this.store,issue.id);}signal?.throwIfAborted();
    if(retired(this.store.getBank(issue.id)))return retired(this.store.getBank(issue.id));
    if(!pool.length)throw new AppError('NO_VALID_GAME','No hay ejercicios verificados disponibles para esta ronda.',422);
    return this.store.transaction(()=>{
      const duplicate=this.store.db.prepare('SELECT * FROM practice_rounds WHERE request_key=?').get(input.idempotencyKey);if(duplicate){if(duplicate.request_hash!==requestHash)throw new AppError('REUSED_KEY','La clave ya pertenece a otra ronda.',409);return this.view(duplicate);}
      const previous=input.previousRoundId?this.row(input.previousRoundId):this.store.db.prepare('SELECT * FROM practice_rounds WHERE mode=? AND locale=? ORDER BY rowid DESC').all(input.mode,locale).find(row=>count(parse(row.stats))>=parse(row.plan).length);
      if(previous&&(previous.mode!==input.mode||previous.locale!==locale))throw new AppError('INVALID_ROUND','La ronda anterior no corresponde a este modo e idioma.');if(previous&&count(parse(previous.stats))<parse(previous.plan).length)throw new AppError('ROUND_NOT_COMPLETE','Termina la ronda anterior antes de empezar otra.',409);
      const plan=this.plan(pool,issue.id,input.mode,previous,locale),mix={review:0,new:0,spaced:0,practice:0};for(const entry of plan)mix[entry.kind]++;
      const previousStats=previous?parse(previous.stats):emptyStats(),timeLimitMs=previousStats.wrong+previousStats.missed+previousStats.exhausted>=6?8000:5000,id=randomUUID();
      this.store.db.prepare('INSERT INTO practice_rounds(id,request_key,request_hash,issue_id,mode,locale,previous_round_id,plan,position,game_ids,stats,mix,time_limit_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.idempotencyKey,requestHash,issue.id,input.mode,locale,previous?.id||null,json(plan),0,'[]',json(emptyStats()),json(mix),timeLimitMs,new Date().toISOString());
      return this.view(this.createCurrent(this.row(id)));
    });
  }
  next(id,afterGameId){return this.store.transaction(()=>{
    let row=this.row(id),ids=parse(row.game_ids),index=ids.indexOf(afterGameId);if(index<0)throw new AppError('INVALID_ROUND_GAME','La partida no pertenece a esta ronda.');
    if(index<row.position||count(parse(row.stats))>=parse(row.plan).length)return this.view(row);
    const game=this.store.game(afterGameId);if(!game?.completed)throw new AppError('ROUND_GAME_PENDING','Termina el ejercicio actual antes de continuar.',409);
    this.store.db.prepare('UPDATE practice_rounds SET position=position+1 WHERE id=?').run(id);row=this.row(id);return this.view(this.createCurrent(row));
  });}
}
