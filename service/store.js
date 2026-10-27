import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';import {dirname} from 'node:path';
import {AppError,categoryLabels,config} from './config.js';
import {applyEdits} from './edits.js';
import {correctionParts} from './corrections.js';
const stamp=()=>new Date().toISOString(),json=value=>JSON.stringify(value),parse=value=>JSON.parse(value);
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:json(value)).digest('hex');
const arcadeAwards={correct:100,wrong:0,missed:-10};
function arcadeOutcome(answer){
  if(!answer||typeof answer!=='object'||Object.keys(answer).some(key=>!['idempotencyKey','answer','timedOut'].includes(key)))return null;
  if(answer.timedOut===true)return answer.answer===undefined?'missed':null;
  if(answer.timedOut!==undefined)return null;
  return answer.answer==='1'?'correct':answer.answer==='0'?'wrong':null;
}
function arcadeTotal(db){
  let total=0;const counted=new Set();
  for(const row of db.prepare("SELECT a.game_id,a.answer,a.correct,a.response,g.state FROM attempts a JOIN games g ON g.id=a.game_id WHERE g.mode='choice' AND g.completed=1 ORDER BY a.rowid").all()){
    if(counted.has(row.game_id))continue;
    let state,response,answer;try{state=parse(row.state);response=parse(row.response);answer=parse(row.answer);}catch{continue;}
    const outcome=arcadeOutcome(answer);
    if(state?.continuous!==true||!outcome||state.outcome!==outcome||state.arcadePoints!==arcadeAwards[outcome]||response?.outcome!==outcome||response.completed!==true||response.correct!==(outcome==='correct')||row.correct!==Number(outcome==='correct')||response.arcadePoints!==arcadeAwards[outcome])continue;
    counted.add(row.game_id);total+=arcadeAwards[outcome];
  }
  return total;
}
export class Store{
  constructor(file){if(file!==':memory:')mkdirSync(dirname(file),{recursive:true});this.db=new DatabaseSync(file);this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analyses(id TEXT PRIMARY KEY,review_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,locale TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('correct','issues','uncertain')),original_text TEXT,corrected_text TEXT,model TEXT NOT NULL,review_version INTEGER NOT NULL DEFAULT 0,review_meta TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS issues(id TEXT PRIMARY KEY,analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,category TEXT NOT NULL,label TEXT NOT NULL,offset INTEGER NOT NULL,length INTEGER NOT NULL,original TEXT NOT NULL,replacement TEXT NOT NULL,explanation TEXT NOT NULL,sentence TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS issues_category_date ON issues(category,created_at);
    CREATE TABLE IF NOT EXISTS banks(issue_id TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,payload TEXT NOT NULL,model TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY,issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,mode TEXT NOT NULL,exercise_key TEXT NOT NULL,private_data TEXT NOT NULL,public_data TEXT NOT NULL,state TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,correct INTEGER NOT NULL,help TEXT NOT NULL,answer TEXT NOT NULL,response TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(game_id,idempotency_key));
    CREATE TABLE IF NOT EXISTS game_actions(id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,action TEXT NOT NULL,response TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(game_id,idempotency_key));
    CREATE TABLE IF NOT EXISTS completions(game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,xp INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rewards(exercise_key TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,xp INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS practice_rounds(id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,mode TEXT NOT NULL CHECK(mode IN ('choice','radar')),locale TEXT NOT NULL,previous_round_id TEXT REFERENCES practice_rounds(id) ON DELETE SET NULL,plan TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,game_ids TEXT NOT NULL,stats TEXT NOT NULL,mix TEXT NOT NULL,points INTEGER NOT NULL DEFAULT 0,xp_earned INTEGER NOT NULL DEFAULT 0,time_limit_ms INTEGER NOT NULL DEFAULT 5000,created_at TEXT NOT NULL);
    `);if(!this.db.prepare('PRAGMA table_info(analyses)').all().some(column=>column.name==='review_version'))this.db.exec('ALTER TABLE analyses ADD COLUMN review_version INTEGER NOT NULL DEFAULT 0');if(!this.db.prepare('PRAGMA table_info(analyses)').all().some(column=>column.name==='review_meta'))this.db.exec("ALTER TABLE analyses ADD COLUMN review_meta TEXT NOT NULL DEFAULT '{}'");this.db.exec('PRAGMA user_version=3');}
  close(){this.db.close();}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  settings(){const result={locale:'en-US',model:config.defaultModel,saveTexts:false};for(const row of this.db.prepare('SELECT key,value FROM settings').all())result[row.key]=parse(row.value);return result;}
  updateSettings(values){const query=this.db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');this.transaction(()=>{for(const [key,value] of Object.entries(values))query.run(key,json(value));});return this.settings();}
  analysis(id){const row=this.db.prepare('SELECT * FROM analyses WHERE id=?').get(id);if(!row)return null;return {id:row.id,key:row.review_key,createdAt:row.created_at,status:row.status,locale:row.locale,originalText:row.original_text,correctedText:row.corrected_text,model:row.model,reviewVersion:row.review_version,uncertain:Boolean(parse(row.review_meta||'{}').uncertain),notices:parse(row.review_meta||'{}').notices||[],issues:this.db.prepare('SELECT * FROM issues WHERE analysis_id=? ORDER BY offset').all(id).map(row=>this.issueView(row))};}
  analysisByKey(key){const row=this.db.prepare('SELECT id FROM analyses WHERE review_key=?').get(key);return row?this.analysis(row.id):null;}
  saveAnalysis(value){
    if(value.status==='correct'&&value.issues.length||value.status==='issues'&&!value.issues.length)throw new AppError('INVALID_ANALYSIS','Resultado de revisión inconsistente.');
    return this.transaction(()=>{const found=this.db.prepare('SELECT id FROM analyses WHERE review_key=?').get(value.key),existing=found?this.analysis(found.id):null,version=value.reviewVersion||0;
      if(existing&&existing.reviewVersion>=version&&existing.status!=='uncertain')return existing;
      const id=existing?.id||randomUUID(),date=existing?.createdAt||stamp(),saveTexts=this.settings().saveTexts,retained=existing?.issues||[],additions=[];
      const incoming=[...value.issues];let unresolvedReorder=false;
      // A verified reorder can replace a narrower old decision. Reuse its ID so
      // historical games keep their immutable snapshots and foreign keys.
      if(existing&&version>existing.reviewVersion)for(const issue of [...incoming]){
        if(issue.category!=='word_order')continue;
        const overlaps=retained.filter(prior=>issue.offset<prior.offset+prior.length&&prior.offset<issue.offset+issue.length);
        if(overlaps.length!==1){if(overlaps.length)unresolvedReorder=true;continue;}const prior=overlaps[0];
        if(prior.offset<issue.offset||prior.offset+prior.length>issue.offset+issue.length){unresolvedReorder=true;continue;}
        if(prior.offset===issue.offset&&prior.length===issue.length)continue;
        this.db.prepare('UPDATE issues SET offset=?,length=?,original=?,replacement=?,category=?,label=?,explanation=?,sentence=? WHERE id=?').run(issue.offset,issue.length,issue.original,issue.replacement,issue.category,issue.label||categoryLabels[issue.category],issue.explanation,issue.sentence.slice(0,700),prior.id);
        this.db.prepare('DELETE FROM banks WHERE issue_id=?').run(prior.id);
        Object.assign(prior,issue,{id:prior.id,label:issue.label||categoryLabels[issue.category]});
        incoming.splice(incoming.indexOf(issue),1);
      }
      if(existing&&version>existing.reviewVersion)for(const prior of retained){
        const contained=incoming.filter(issue=>issue.offset>=prior.offset&&issue.offset+issue.length<=prior.offset+prior.length);
        if(!contained.length||contained.every(issue=>issue.offset===prior.offset&&issue.length===prior.length))continue;
        const local=contained.map(issue=>({...issue,offset:issue.offset-prior.offset})),previous=correctionParts(prior.original,prior.replacement).filter(old=>!local.some(next=>old.offset<next.offset+next.length&&next.offset<old.offset+old.length));
        const replacement=applyEdits(prior.original,[...previous,...local]);
        const rule=contained.find(issue=>!['capitalization','punctuation'].includes(issue.category))||contained[0];
        this.db.prepare('UPDATE issues SET replacement=?,category=?,label=?,explanation=? WHERE id=?').run(replacement,rule.category,rule.label||categoryLabels[rule.category],rule.explanation,prior.id);
        this.db.prepare('DELETE FROM banks WHERE issue_id=?').run(prior.id);
        Object.assign(prior,{replacement,category:rule.category,label:rule.label||categoryLabels[rule.category],explanation:rule.explanation});
        for(const issue of contained)incoming.splice(incoming.indexOf(issue),1);
      }
      for(const issue of incoming){
        const index=retained.findIndex(old=>old.offset===issue.offset&&old.length===issue.length&&old.original===issue.original);
        if(index>=0&&version>existing.reviewVersion&&retained[index].replacement!==issue.replacement){
          const prior=retained[index];
          this.db.prepare('UPDATE issues SET replacement=?,category=?,label=?,explanation=?,sentence=? WHERE id=?').run(issue.replacement,issue.category,issue.label||categoryLabels[issue.category],issue.explanation,issue.sentence.slice(0,700),prior.id);
          this.db.prepare('DELETE FROM banks WHERE issue_id=?').run(prior.id);
          retained[index]={...prior,...issue,id:prior.id};continue;
        }
        if([...retained,...additions].some(old=>issue.offset<old.offset+old.length&&old.offset<issue.offset+issue.length))continue;additions.push(issue);
      }
      const all=[...retained,...additions],status=all.length?'issues':value.status;
      if(existing){
        const original=saveTexts?value.originalText:existing.originalText,corrected=original!==null?applyEdits(value.originalText,all):null;
        this.db.prepare('UPDATE analyses SET status=?,original_text=?,corrected_text=?,model=?,review_version=?,review_meta=? WHERE id=?').run(status,original,corrected,value.model||this.settings().model,unresolvedReorder?existing.reviewVersion:version,json({uncertain:Boolean(value.uncertain),notices:value.notices||[]}),id);
      }else this.db.prepare('INSERT INTO analyses(id,review_key,created_at,locale,status,original_text,corrected_text,model,review_version,review_meta) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,value.key,date,value.locale,status,saveTexts?value.originalText:null,saveTexts?value.correctedText:null,value.model||this.settings().model,version,json({uncertain:Boolean(value.uncertain),notices:value.notices||[]}));
      const insert=this.db.prepare('INSERT INTO issues(id,analysis_id,category,label,offset,length,original,replacement,explanation,sentence,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');for(const issue of additions)insert.run(randomUUID(),id,issue.category,issue.label||categoryLabels[issue.category],issue.offset,issue.length,issue.original,issue.replacement,issue.explanation,issue.sentence.slice(0,700),date);
      return this.analysis(id);
    });
  }
  issueView(row){return {id:row.id,analysisId:row.analysis_id,category:row.category,label:row.label,offset:row.offset,length:row.length,original:row.original,replacement:row.replacement,explanation:row.explanation,sentence:row.sentence,createdAt:row.created_at};}
  issue(id){const row=this.db.prepare('SELECT * FROM issues WHERE id=?').get(id);return row?this.issueView(row):null;}
  applyPracticeCorrection(id,patch){
    const issue=typeof id==='string'?this.issue(id):null;
    if(!issue)throw new AppError('ISSUE_NOT_FOUND','Este error ya no está en tu historial.',404);
    const valid=patch&&typeof patch==='object'&&!Array.isArray(patch)&&patch.original===issue.original&&typeof patch.replacement==='string'&&patch.replacement.trim().length>0&&patch.replacement.length<=180&&typeof patch.category==='string'&&Object.hasOwn(categoryLabels,patch.category)&&typeof patch.explanation==='string'&&patch.explanation.trim().length>0&&patch.explanation.length<=320;
    if(!valid)throw new AppError('INVALID_PRACTICE_CORRECTION','La corrección de práctica no coincide con el error guardado.');
    this.db.prepare('UPDATE issues SET replacement=?,category=?,label=?,explanation=? WHERE id=?').run(patch.replacement,patch.category,categoryLabels[patch.category],patch.explanation,id);
    return this.issue(id);
  }
  getBank(id){const row=this.db.prepare('SELECT * FROM banks WHERE issue_id=?').get(id);return row?{...parse(row.payload),model:row.model}:null;}
  saveBank(id,payload,model){this.db.prepare('INSERT INTO banks VALUES (?,?,?,?) ON CONFLICT(issue_id) DO UPDATE SET payload=excluded.payload,model=excluded.model,created_at=excluded.created_at').run(id,json(payload),model,stamp());}
  createGame(value){if(!this.issue(value.issueId))throw new AppError('ISSUE_NOT_FOUND','Este error ya no está en tu historial.',404);const id=randomUUID();this.db.prepare('INSERT INTO games VALUES (?,?,?,?,?,?,?,?,?)').run(id,value.issueId,value.mode,value.exerciseKey,json(value.privateData),json(value.publicData),json(value.state||{help:'none'}),0,stamp());return this.game(id);}
  game(id){const row=this.db.prepare('SELECT * FROM games WHERE id=?').get(id);return row?{id:row.id,issueId:row.issue_id,mode:row.mode,exerciseKey:row.exercise_key,privateData:parse(row.private_data),publicData:parse(row.public_data),state:parse(row.state),completed:Boolean(row.completed),createdAt:row.created_at}:null;}
  updateGameState(id,state){this.db.prepare('UPDATE games SET state=? WHERE id=?').run(json(state),id);}
  attemptResponse(gameId,key,requestHash){const row=this.db.prepare('SELECT request_hash,response FROM attempts WHERE game_id=? AND idempotency_key=?').get(gameId,key);if(!row)return null;if(requestHash&&row.request_hash!==requestHash)throw new AppError('REUSED_KEY','La clave de este intento ya se usó con otra respuesta.',409);return parse(row.response);}
  performGameAction(gameId,key,requestHash,evaluate){return this.transaction(()=>{
    const duplicate=this.db.prepare('SELECT request_hash,response FROM game_actions WHERE game_id=? AND idempotency_key=?').get(gameId,key);
    if(duplicate){if(duplicate.request_hash!==requestHash)throw new AppError('REUSED_KEY','La clave de esta acción ya se usó con otros datos.',409);return parse(duplicate.response);}
    const game=this.game(gameId);if(!game)throw new AppError('GAME_NOT_FOUND','Esta partida ya no está disponible.',404);
    const event=evaluate(game);if(event.unchanged)return event.response;
    this.updateGameState(gameId,event.state);
    const response=json(event.response);this.db.prepare('INSERT INTO game_actions VALUES (?,?,?,?,?,?,?)').run(randomUUID(),gameId,key,requestHash,json(event.action??null),response,stamp());return parse(response);
  });}
  submit(gameId,key,requestHash,evaluate,validate){return this.transaction(()=>{
    const duplicate=this.db.prepare('SELECT request_hash,response FROM attempts WHERE game_id=? AND idempotency_key=?').get(gameId,key);if(duplicate){if(requestHash&&duplicate.request_hash!==requestHash)throw new AppError('REUSED_KEY','La clave de este intento ya se usó con otra respuesta.',409);return parse(duplicate.response);}
    const game=this.game(gameId);if(!game)throw new AppError('GAME_NOT_FOUND','Esta partida ya no está disponible.',404);
    validate?.(game);
    const continuous=game.mode==='choice'&&game.state.continuous===true;
    const guided=game.mode==='radar'&&game.state.guided===true;
    if(game.completed)return {correct:continuous||guided?game.state.outcome==='correct':true,completed:true,alreadyCompleted:true,xpEarned:0,...continuous?{outcome:game.state.outcome,arcadePoints:0}:guided?{outcome:game.state.outcome,assisted:game.state.assisted===true}:{},message:'Esta partida ya terminó.'};
    const event=evaluate(game);if(event.ignored)return {...event.response,correct:guided?false:true,completed:false,ignored:true,xpEarned:0,message:guided?'Ese fragmento ya está descartado. Elige otro.':'Esta pareja ya estaba conectada.'};
    const outcome=arcadeOutcome(event.answer),validContinuous=continuous&&outcome&&event.completed===true&&event.correct===(outcome==='correct')&&event.response?.outcome===outcome&&event.response.arcadePoints===arcadeAwards[outcome]&&event.state?.continuous===true&&event.state.outcome===outcome&&event.state.arcadePoints===arcadeAwards[outcome];
    const rejected=event.state?.discardedTokenIds,previousRejected=game.state.discardedTokenIds||[],radarToken=guided?game.privateData.tokens.find(token=>token.id===event.answer?.tokenIndex):null,radarHit=radarToken&&radarToken.offset<game.privateData.item.targetOffset+game.privateData.item.targetLength&&game.privateData.item.targetOffset<radarToken.offset+radarToken.length;
    const validGuided=guided&&radarToken&&event.state?.guided===true&&Array.isArray(rejected)&&new Set(rejected).size===rejected.length&&rejected.length<=3&&previousRejected.every(id=>rejected.includes(id))&&event.correct===Boolean(radarHit)&&event.completed===(Boolean(radarHit)||rejected.length===3)&&event.response?.outcome===(event.completed?radarHit?'correct':'exhausted':undefined)&&event.state.outcome===event.response.outcome&&rejected.length===previousRejected.length+(radarHit?0:1)&&(!radarHit?rejected.includes(radarToken.id):true)&&event.response.arcadePoints===undefined;
    const invalidClassic=event.completed&&!event.correct||event.response?.outcome!==undefined||event.response?.arcadePoints!==undefined||event.state?.continuous===true;
    if(continuous?!validContinuous:guided?!validGuided:invalidClassic)throw new AppError('INVALID_RESULT','Resultado de juego inconsistente.');
    let xp=0;const help=game.state.help==='reveal'||event.help==='reveal'?'reveal':game.state.help==='hint'||event.help==='hint'?'hint':'none';
    if(event.completed){if(event.correct){const credited=this.db.prepare('SELECT 1 FROM rewards WHERE exercise_key=?').get(game.exerciseKey);xp=credited?0:help==='reveal'?5:help==='hint'?10:20;if(!credited)this.db.prepare('INSERT INTO rewards VALUES (?,?,?)').run(game.exerciseKey,gameId,xp);}this.db.prepare('INSERT INTO completions VALUES (?,?,?)').run(gameId,xp,stamp());this.db.prepare('UPDATE games SET completed=1 WHERE id=?').run(gameId);}
    if(event.state)this.updateGameState(gameId,event.state);
    const response=json({...event.response,correct:event.correct,completed:Boolean(event.completed),xpEarned:xp});
    this.db.prepare('INSERT INTO attempts(id,game_id,idempotency_key,request_hash,correct,help,answer,response,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),gameId,key,requestHash||'',event.correct?1:0,help,json(event.answer??null),response,stamp());
    if(event.completed&&game.state.learningRoundId){
      const round=this.db.prepare('SELECT * FROM practice_rounds WHERE id=?').get(game.state.learningRoundId),ids=round&&parse(round.game_ids);
      if(!round||ids[game.state.learningRoundIndex]!==gameId)throw new AppError('INVALID_RESULT','La partida no pertenece a esta ronda.');
      const stats=parse(round.stats),result=event.response.outcome||(event.correct?'correct':'wrong');if(!Object.hasOwn(stats,result))throw new AppError('INVALID_RESULT','Resultado de ronda inconsistente.');stats[result]++;if(event.correct&&(event.response.assisted===true||help!=='none'))stats.assisted++;
      this.db.prepare('UPDATE practice_rounds SET stats=?,points=points+?,xp_earned=xp_earned+? WHERE id=?').run(json(stats),event.response.arcadePoints||0,xp,round.id);
    }
    return parse(response);
  });}
  recordAttempt(gameId,event){return this.submit(gameId,event.idempotencyKey,event.requestHash||'',()=>event);}
  progress(){
    const one=sql=>Number(this.db.prepare(sql).get().n||0);
    const totals={reviews:one('SELECT COUNT(*) n FROM analyses'),correctReviews:one("SELECT COUNT(*) n FROM analyses WHERE status='correct'"),detections:one('SELECT COUNT(*) n FROM issues'),attempts:one('SELECT COUNT(*) n FROM attempts'),mistakes:one('SELECT COUNT(*) n FROM attempts WHERE correct=0'),completedGames:one('SELECT COUNT(*) n FROM completions'),xp:one('SELECT COALESCE(SUM(xp),0) n FROM completions'),arcadePoints:arcadeTotal(this.db)};
    const practice=new Map(this.db.prepare(`SELECT i.category,COUNT(a.id) attempts,SUM(CASE WHEN a.correct=0 THEN 1 ELSE 0 END) mistakes,SUM(CASE WHEN a.correct=1 AND a.help='none' THEN 1 ELSE 0 END) unassisted FROM attempts a JOIN games g ON g.id=a.game_id JOIN issues i ON i.id=g.issue_id GROUP BY i.category`).all().map(row=>[row.category,row]));
    const active="NOT EXISTS (SELECT 1 FROM banks WHERE banks.issue_id=issues.id AND json_extract(banks.payload,'$.status')='already_correct')";
    const patterns=this.db.prepare(`SELECT category,COUNT(*) occurrences,COUNT(DISTINCT analysis_id) reviews,MIN(created_at) firstSeen,MAX(created_at) lastSeen FROM issues WHERE ${active} GROUP BY category ORDER BY occurrences DESC,category`).all().map(row=>{const latest=this.db.prepare(`SELECT * FROM issues WHERE category=? AND ${active} ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(row.category),stats=practice.get(row.category)||{};return {...row,label:categoryLabels[row.category],latestIssueId:latest.id,original:latest.original,replacement:latest.replacement,attempts:Number(stats.attempts||0),mistakes:Number(stats.mistakes||0),unassisted:Number(stats.unassisted||0)};});
    const recent=this.db.prepare('SELECT a.id,a.created_at date,a.status,a.locale,COUNT(i.id) errors FROM analyses a LEFT JOIN issues i ON i.analysis_id=a.id GROUP BY a.id ORDER BY a.created_at DESC,a.rowid DESC LIMIT 30').all();
    const modeCounts=Object.fromEntries(this.db.prepare('SELECT g.mode,COUNT(*) count FROM completions c JOIN games g ON g.id=c.game_id GROUP BY g.mode').all().map(row=>[row.mode,row.count]));
    const practiceRounds=this.db.prepare('SELECT * FROM practice_rounds ORDER BY rowid DESC LIMIT 10').all().map(row=>{const stats=parse(row.stats),total=parse(row.plan).length,completedCount=stats.correct+stats.wrong+stats.missed+stats.exhausted;return {id:row.id,issueId:row.issue_id,mode:row.mode,total,completedCount,complete:completedCount>=total,stats,mix:parse(row.mix),createdAt:row.created_at,points:row.points,xpEarned:row.xp_earned};});
    const adventures=this.db.prepare("SELECT * FROM games WHERE mode IN ('jump','maze') ORDER BY rowid DESC LIMIT 20").all().map(row=>{const state=parse(row.state),data=parse(row.private_data);return {id:row.id,issueId:row.issue_id,mode:row.mode,completed:Boolean(row.completed),checkpointsComplete:state.step,total:data.items.length,movementMistakes:state.movementMistakes,createdAt:row.created_at};});return {totals,patterns,recent,modeCounts,practiceRounds,adventures};
  }
  export(){const tables={};for(const name of ['analyses','issues','banks','game_actions','games','attempts','completions','rewards','practice_rounds'])tables[name]=this.db.prepare('SELECT * FROM '+name).all();return {app:'MistakeQuest',version:1,exportedAt:stamp(),settings:this.settings(),progress:this.progress(),tables};}
  clearData(){this.db.exec('PRAGMA secure_delete=ON');this.transaction(()=>{for(const name of ['practice_rounds','game_actions','attempts','completions','rewards','games','banks','issues','analyses'])this.db.exec('DELETE FROM '+name);});this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');}
}
