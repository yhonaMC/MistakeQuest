import React,{useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {useI18n} from './i18n.js';
import RadarArcade from './RadarArcade.jsx';
import Icon from './Icon.jsx';
import './guided-radar-session.css';

const copy={
 es:{leave:'Salir de la partida',title:'Radar guiado',phrase:'Frase',of:'de',attempts:'intentos disponibles',shot:'Intento',hint:'Pedir pista',hintTitle:'Tu pista',checking:'Comprobando tu disparo…',loading:'Preparando la siguiente frase…',retry:'Reintentar',retryNote:'Reintenta para recuperar la respuesta de este disparo.',correct:'Encontraste el error.',exhausted:'Esta vez, aprende de la corrección.',correction:'La frase corregida',next:'La siguiente frase llegará sola.',read:'Puedes pausar para leer con calma.',paused:'La siguiente frase espera hasta que reanudes.',finished:'Tres frases. Un paso más.',summary:'Tu sesión de radar',unassisted:'Sin pistas',assisted:'Con pistas',revealed:'Correcciones vistas',xp:'XP ganados',again:'Otra sesión de este juego',modes:'Elegir otro minijuego',preparing:'Preparando…',note:'Tres intentos por frase. Las pistas y las correcciones forman parte de la práctica.',missing:'No se pudo recuperar esta sesión. Empieza otra para continuar.'},
 en:{leave:'Leave game',title:'Guided radar',phrase:'Sentence',of:'of',attempts:'attempts available',shot:'Attempt',hint:'Get a hint',hintTitle:'Your clue',checking:'Checking your shot…',loading:'Preparing the next sentence…',retry:'Retry',retryNote:'Retry to recover the result of this shot.',correct:'You found the mistake.',exhausted:'This time, learn from the correction.',correction:'The corrected sentence',next:'The next sentence will appear automatically.',read:'Pause whenever you need more time to read.',paused:'The next sentence will wait until you resume.',finished:'Three sentences. One step forward.',summary:'Your radar session',unassisted:'Without hints',assisted:'With hints',revealed:'Corrections viewed',xp:'XP earned',again:'Play another session',modes:'Choose another minigame',preparing:'Preparing…',note:'Three attempts per sentence. Hints and corrections are part of practice.',missing:'This session could not be recovered. Start another one to continue.'}
};
const publicStateKeys=['attemptsRemaining','misses','discardedTokenIds','hint','hintLevel'];
function publicUpdates(result){const update={...(result.game||{})};for(const key of publicStateKeys)if(Object.hasOwn(result,key))update[key]=result[key];return update;}
function hintFrom(result){const value=result.hint;return typeof value==='string'?value:value?.message||value?.text||(result.help==='hint'?result.message:'');}

export default function GuidedRadarSession({game:initial,onExit,onProgress,onAgain,onModes,generating=false,motion=true}){
 const {language,t,errorText}=useI18n(),c=copy[language]||copy.es;
 const [practiceRound,setPracticeRound]=useState(initial.practiceRound||null),[game,setGame]=useState(initial),[phrase,setPhrase]=useState(initial.learningRound?.index||Math.min((initial.practiceRound?.completedCount||0)+1,initial.practiceRound?.total||3));
 const [feedback,setFeedback]=useState(null),[hint,setHint]=useState(initial.hint?{message:initial.hint,level:initial.hintLevel||1}:null),[busy,setBusy]=useState(''),[error,setError]=useState(null),[paused,setPaused]=useState(true);
 const mounted=useRef(true),pending=useRef(false),controller=useRef(null),lastAttempt=useRef(null),gameId=useRef(initial.id),advanceClock=useRef(null),nextAction=useRef(null);
 const complete=Boolean(practiceRound?.complete),terminal=Boolean(feedback?.completed),total=practiceRound?.total||3;
 const misses=Array.isArray(game.misses)?game.misses.length:Number(game.misses)||0;
 const remaining=Math.max(0,Math.min(3,Number(game.attemptsRemaining??3-misses)));
 const attemptsLabel=remaining===1?(language==='en'?'attempt available':'intento disponible'):c.attempts;
 const stats=practiceRound?.stats||{},assisted=Number(stats.assisted)||0,revealed=Number(stats.exhausted)||0,unassisted=Math.max(0,(Number(stats.correct)||0)-assisted);

 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);

 async function execute(job){
  if(pending.current||complete)return;
  pending.current=true;const abort=new AbortController();controller.current=abort;setBusy(job.kind);setError(null);
  if(job.kind==='attempt')setFeedback(null);
  try{
   const result=await api(job.path,{method:'POST',body:job.body,signal:abort.signal});
   if(!mounted.current||job.gameId!==gameId.current)return;
   if(job.kind==='next'){
    if(!result.complete&&!result.game)throw new Error(c.missing);
    advanceClock.current=null;lastAttempt.current=null;setPracticeRound(result);setFeedback(null);setHint(null);
    if(result.game){gameId.current=result.game.id;setGame(result.game);setPhrase(result.game.learningRound?.index||Math.min((result.completedCount||0)+1,result.total||3));if(result.game.hint)setHint({message:result.game.hint,level:result.game.hintLevel||1});}
   }else{
    setGame(previous=>({...previous,...publicUpdates(result)}));
    const message=hintFrom(result);if(message)setHint({message,level:result.hintLevel||game.hintLevel||1});
    if(job.kind==='attempt'){
     lastAttempt.current=null;setFeedback(result);
     if(result.completed)advanceClock.current={gameId:job.gameId,remaining:result.correct?1000:3000};
    }
   }
   onProgress?.(result);
  }catch(failure){if(mounted.current&&failure.name!=='AbortError')setError({failure,job});}
  finally{pending.current=false;if(mounted.current)setBusy('');}
 }
 function submit(payload){
  if(pending.current||terminal||error||complete)return;
  // Until a response arrives, retry this exact shot before accepting a different one.
  const job=lastAttempt.current||{kind:'attempt',gameId:game.id,path:`/games/${game.id}/attempt`,body:{...payload,idempotencyKey:crypto.randomUUID()}};
  lastAttempt.current=job;return execute(job);
 }
 function nextPhrase(){
  if(pending.current||!terminal||complete||!practiceRound?.id)return;
  return execute({kind:'next',gameId:game.id,path:`/practice-rounds/${practiceRound.id}/next`,body:{afterGameId:game.id}});
 }
 nextAction.current=nextPhrase;
 useEffect(()=>{
  const clock=advanceClock.current;
  if(!terminal||complete||paused||busy||error||!clock||clock.gameId!==game.id)return;
  const started=performance.now();
  const timer=setTimeout(()=>{clock.remaining=0;nextAction.current?.();},Math.max(0,clock.remaining));
  return()=>{clearTimeout(timer);if(clock.remaining>0)clock.remaining=Math.max(0,clock.remaining-(performance.now()-started));};
 },[terminal,complete,paused,busy,error,game.id]);
 function requestHint(){if(!pending.current&&!terminal&&!error)return execute({kind:'hint',gameId:game.id,path:`/games/${game.id}/hint`,body:{}});}

 const retry=()=>error?.job&&execute(error.job);
 const outcome=feedback?.outcome||(feedback?.correct?'correct':terminal?'exhausted':'retry');
 const hintZone=hint?.message?.match(/«([^»]+)»/)?.[1];
 const hintText=hint?(language==='en'?(hint.level>=2&&hintZone?`Focus on this part: “${hintZone}”. One of these words needs a change.`:`Check ${t(game.label||'Ortografía').toLowerCase()} in this sentence.`):t(hint.message)):'';
 return <section className="guided-radar-session" data-game-id={game.id} data-phrase={phrase} data-round={phrase} data-completed={complete?'true':'false'}>
  <div className="guided-radar-toolbar">{onExit&&<button type="button" className="button ghost" onClick={onExit}><Icon name="back" size={17}/>{c.leave}</button>}<span>{c.title}</span></div>
  {!complete&&<>
   <div className="guided-radar-hud"><div><strong>{c.phrase} {phrase} {c.of} {total}</strong><span>{t(game.label||'Radar de errores')}</span></div><div className="radar-attempts" data-attempts-remaining={remaining} role="status" aria-label={`${remaining} ${attemptsLabel}`}><div aria-hidden="true">{[0,1,2].map(index=><i className={'radar-attempt'+(index>=remaining?' is-used':'')} key={index}>{index+1}</i>)}</div><span>{remaining} {attemptsLabel}</span></div></div>
   <RadarArcade game={game} onAnswer={submit} disabled={Boolean(busy)||terminal||Boolean(error)} feedback={feedback} motion={motion} round={phrase} totalRounds={total} onPauseChange={setPaused}/>
   <div className="guided-radar-response">
    {busy&&<p className="guided-radar-working" role="status"><span className="spinner"/>{busy==='next'?c.loading:c.checking}</p>}
    {error&&<div className="guided-radar-error" role="alert"><p>{errorText(error.failure)}</p>{error.job.kind==='attempt'&&<p>{c.retryNote}</p>}<button className="button guided-radar-retry" type="button" disabled={Boolean(busy)} onClick={retry}>{c.retry}</button></div>}
    {!practiceRound?.id&&<div className="guided-radar-error" role="alert"><p>{c.missing}</p>{onAgain&&<button className="button" type="button" onClick={onAgain}>{c.again}</button>}</div>}
    {hint&&!terminal&&<div className="guided-radar-hint" data-hint-level={hint.level} role="status"><Icon name="bulb" size={22}/><div><strong>{c.hintTitle}</strong><p>{hintText}</p></div></div>}
    {feedback&&<div className={'guided-radar-feedback '+(feedback.correct?'is-correct':terminal?'is-revealed':'is-retry')} data-outcome={outcome} role="status"><strong>{terminal?(feedback.correct?c.correct:c.exhausted):(language==='en'?'That word fits. Follow the clue and try another.':'Esa palabra está bien. Sigue la pista y prueba otra.')}</strong>{feedback.correctedSentence&&<><span className="guided-radar-correction-label">{c.correction}</span><p className="guided-radar-correction" lang="en">{feedback.correctedSentence}</p></>}{feedback.explanation&&<p className="guided-radar-explanation">{t(feedback.explanation)}</p>}</div>}
    {terminal&&!error&&<p className="guided-radar-auto" role="status">{paused?c.paused:<>{c.next}<span>{c.read}</span></>}</p>}
    {!terminal&&<button className="button ghost guided-radar-manual-hint" type="button" disabled={Boolean(busy)||Boolean(error)} onClick={requestHint}><Icon name="bulb" size={18}/>{c.hint}</button>}
   </div>
  </>}
  {complete&&<div className="guided-radar-summary" data-correct={unassisted} data-assisted={assisted} data-revealed={revealed}><span className="guided-radar-summary-icon"><Icon name="radar" size={37}/></span><p>{c.summary}</p><h2>{c.finished}</h2><dl><div><dt>{c.unassisted}</dt><dd>{unassisted}</dd></div><div><dt>{c.assisted}</dt><dd>{assisted}</dd></div><div><dt>{c.revealed}</dt><dd>{revealed}</dd></div></dl><p className="guided-radar-xp"><strong>+{Number(practiceRound.xpEarned)||0}</strong> {c.xp}</p><div className="guided-radar-end-actions">{onAgain&&<button className="button guided-radar-again" type="button" disabled={generating} onClick={onAgain}>{generating?c.preparing:c.again}</button>}{onModes&&<button className="button secondary" type="button" onClick={onModes}>{c.modes}</button>}</div></div>}
  <p className="guided-radar-note">{c.note}</p>
 </section>;
}
