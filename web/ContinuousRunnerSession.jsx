import React,{useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {useI18n} from './i18n.js';
import {Button} from './App.jsx';
import Icon from './Icon.jsx';
import RunnerArcade from './RunnerArcade.jsx';
import './arcade-session.css';
import './continuous-runner-session.css';

const COPY={
 es:{title:'Carrera por rondas',door:'Puerta',of:'de',optional:'Siempre opcional',exit:'Salir de la partida',modes:'Elegir otro minijuego',points:'Puntos de esta ronda',saved:'puertas guardadas',streak:'Racha',checking:'Guardando tu respuesta…',loading:'Preparando las siguientes puertas…',retry:'Reintentar conexión',correct:'¡Bien! +100 puntos',wrong:'Esta puerta no encajaba. La siguiente te espera.',missed:'No elegiste ninguna puerta. −10 puntos.',note:'10 puertas por ronda · +100 por acertar · −10 por no elegir. Puedes pausar o salir; cada resultado se guarda.',unavailable:'No se pudo preparar la siguiente puerta. Tu progreso está guardado.',allTime:'Total guardado',complete:'Ronda completada',next:'Siguiente ronda',review:'Repaso de tus fallos',fresh:'Retos nuevos',spaced:'Repaso anterior',practice:'Práctica verificada',hits:'Aciertos',errors:'Elecciones incorrectas',timeouts:'Sin elegir',plan:'En la siguiente ronda retomaremos tus fallos y los mezclaremos con retos nuevos disponibles.',pool:'Cuando se agotan los retos nuevos, seguimos con práctica verificada.',resume:'Ronda guardada'},
 en:{title:'Round-based run',door:'Gate',of:'of',optional:'Always optional',exit:'Leave game',modes:'Choose another minigame',points:'Points in this round',saved:'saved gates',streak:'Streak',checking:'Saving your answer…',loading:'Preparing the next gates…',retry:'Retry connection',correct:'Well done! +100 points',wrong:'That gate did not fit. The next one is on its way.',missed:'You did not choose a gate. −10 points.',note:'10 gates per round · +100 for a correct answer · −10 for not choosing. Pause or leave whenever you want; every result is saved.',unavailable:'The next gate could not be prepared. Your progress is saved.',allTime:'Saved total',complete:'Round completed',next:'Next round',review:'Review of your mistakes',fresh:'New challenges',spaced:'Earlier review',practice:'Verified practice',hits:'Correct',errors:'Wrong choices',timeouts:'No choice',plan:'The next round will revisit your mistakes and mix them with available new challenges.',pool:'When new challenges run out, we continue with verified practice.',resume:'Saved round'}
};
const MIX={es:{review:'repasos de fallos',new:'retos nuevos',spaced:'repasos anteriores',practice:'prácticas verificadas'},en:{review:'mistake reviews',new:'new challenges',spaced:'earlier reviews',practice:'verified practice'}};

export default function ContinuousRunnerSession({game:initial,issueId,onExit,onModes,onProgress,motion=true,arcadePoints=0}){
 const {language,t,errorText}=useI18n(),c=COPY[language]||COPY.es;
 const [practiceRound,setPracticeRound]=useState(initial.practiceRound),[game,setGame]=useState(initial),[door,setDoor]=useState((initial.practiceRound?.completedCount||0)+1),[feedback,setFeedback]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState(null),[points,setPoints]=useState(initial.practiceRound?.points||0),[xp,setXp]=useState(initial.practiceRound?.xpEarned||0),[saved,setSaved]=useState(initial.practiceRound?.completedCount||0),[streak,setStreak]=useState(0),[paused,setPaused]=useState(false),[visible,setVisible]=useState(()=>!document.hidden),[autoStart,setAutoStart]=useState(false);
 const mounted=useRef(true),pending=useRef(false),controller=useRef(null),lastSubmission=useRef(null),settled=useRef(new Set()),transitioned=useRef(new Set()),newRoundKey=useRef(null),summaryRef=useRef(null),boardRef=useRef(null),advanceClock=useRef({id:initial.id,remaining:1000});
 const complete=Boolean(practiceRound?.complete),total=practiceRound?.total||10;
 useEffect(()=>{
  mounted.current=true;const visibility=()=>setVisible(!document.hidden);
  document.addEventListener('visibilitychange',visibility);
  return()=>{mounted.current=false;controller.current?.abort();document.removeEventListener('visibilitychange',visibility);};
 },[]);
 useEffect(()=>{if(complete){const timer=setTimeout(()=>summaryRef.current?.scrollIntoView({behavior:motion?'smooth':'instant',block:'start'}),500);return()=>clearTimeout(timer);}},[complete,motion]);
 useEffect(()=>{if(autoStart)boardRef.current?.scrollIntoView({behavior:'instant',block:'start'});},[practiceRound?.id,autoStart]);

 async function submit(payload,retry=false){
  if(pending.current||settled.current.has(game.id))return;
  const signature=JSON.stringify({gameId:game.id,...payload});
  if(!lastSubmission.current||lastSubmission.current.signature!==signature)lastSubmission.current={signature,key:crypto.randomUUID(),payload};
  const attempt=lastSubmission.current;
  pending.current=true;const abort=new AbortController();controller.current=abort;setBusy('answer');setError(null);
  try{
   const result=await api(`/games/${game.id}/attempt`,{method:'POST',body:{idempotencyKey:attempt.key,...attempt.payload},signal:abort.signal});
   if(!mounted.current)return;
   if(!result.completed)throw new Error(c.unavailable);
   const snapshot=result.practiceRound||await api(`/practice-rounds/${practiceRound.id}`,{signal:abort.signal});
   if(!mounted.current)return;
   lastSubmission.current=null;settled.current.add(game.id);setFeedback(result);setPracticeRound(snapshot);
   setPoints(snapshot.points);setXp(snapshot.xpEarned);setSaved(snapshot.completedCount);setStreak(value=>result.correct?value+1:0);
   advanceClock.current={id:game.id,remaining:1000};onProgress?.();
  }catch(failure){if(mounted.current&&failure.name!=='AbortError')setError({failure,kind:'answer'});}
  finally{pending.current=false;if(mounted.current)setBusy('');}
 }

 async function nextGate(){
  if(pending.current||complete||!settled.current.has(game.id)||transitioned.current.has(game.id))return;
  if(!practiceRound?.id){setError({failure:new Error(c.unavailable),kind:'round'});return;}
  pending.current=true;const abort=new AbortController();controller.current=abort;setBusy('round');setError(null);
  try{
   const next=await api(`/practice-rounds/${practiceRound.id}/next`,{method:'POST',body:{afterGameId:game.id},signal:abort.signal});
   if(!mounted.current)return;
   setPracticeRound(next);if(next.complete)return;
   if(!next.game)throw new Error(c.unavailable);
   transitioned.current.add(game.id);setGame(next.game);setDoor(next.completedCount+1);setFeedback(null);lastSubmission.current=null;
  }catch(failure){if(mounted.current&&failure.name!=='AbortError')setError({failure,kind:'round'});}
  finally{pending.current=false;if(mounted.current)setBusy('');}
 }

 useEffect(()=>{
  if(!feedback?.completed||complete||busy||error||paused||!visible)return;
  const clock=advanceClock.current,start=performance.now();
  const timer=setTimeout(()=>{clock.remaining=0;nextGate();},Math.max(0,clock.remaining));
  return()=>{clearTimeout(timer);clock.remaining=Math.max(0,clock.remaining-(performance.now()-start));};
 },[feedback,game.id,complete,busy,error,paused,visible]);

 async function startNextRound(){
  if(pending.current||!complete)return;
  pending.current=true;const abort=new AbortController();controller.current=abort;setBusy('new-round');setError(null);
  newRoundKey.current||=crypto.randomUUID();
  try{
   const next=await api('/practice-rounds',{method:'POST',body:{issueId:practiceRound.source?.id||issueId||game.issueId,mode:'choice',previousRoundId:practiceRound.id,idempotencyKey:newRoundKey.current},signal:abort.signal});
   if(!mounted.current)return;if(!next.game)throw new Error(c.unavailable);
   setPracticeRound(next);setGame(next.game);setDoor(next.completedCount+1);setSaved(next.completedCount);setPoints(next.points);setXp(next.xpEarned);setFeedback(null);setPaused(false);setStreak(0);setAutoStart(true);lastSubmission.current=null;newRoundKey.current=null;
  }catch(failure){if(mounted.current&&failure.name!=='AbortError')setError({failure,kind:'new-round'});}
  finally{pending.current=false;if(mounted.current)setBusy('');}
 }

 function retry(){if(error?.kind==='answer'&&lastSubmission.current)submit(lastSubmission.current.payload,true);else if(error?.kind==='new-round')startNextRound();else nextGate();}
 const outcome=feedback?.outcome||(feedback?.correct?'correct':'wrong');
 return <section className="arena arcade-session continuous-runner-session mode-choice" data-game-id={game.id} data-round={door} data-round-id={practiceRound?.id} data-round-complete={complete?'true':'false'} data-saved={saved} data-paused={paused?'true':'false'}>
  <div className="arena-toolbar"><Button variant="ghost" icon="back" onClick={onExit}>{c.exit}</Button><span className="pill">{t(game.label)}</span><span className="subtle">{c.optional}</span></div>
  <div className="arcade-hud"><span className="hud-mode"><span><Icon name="choice" size={22}/></span><span>{c.title}<strong>{t(game.name)}</strong></span></span><div className="hud-progress"><span>{c.door} {door} {c.of} {total}</span><small>{saved} {c.saved}</small></div><div className="runner-session-score"><strong className="runner-score-points" aria-label={c.points}>{points} <small>PTS</small></strong><span className="runner-score-xp">+{xp} XP</span>{streak>1&&<small>{c.streak} ×{streak}</small>}</div></div>
  <p className="runner-round-mix">{['review','new','spaced','practice'].filter(kind=>['review','new'].includes(kind)||practiceRound?.mix?.[kind]).map(kind=><span key={kind}>{practiceRound?.mix?.[kind]||0} {(MIX[language]||MIX.es)[kind]}</span>)}</p>
  <div className="arcade-playfield" ref={boardRef}><RunnerArcade key={practiceRound?.id||'initial'} game={game} onAnswer={submit} onTimeout={submit} onPauseChange={setPaused} continuous autoStart={autoStart} finished={complete} durationMs={practiceRound?.timeLimitMs||5000} preparing={busy==='round'} disabled={Boolean(busy)||Boolean(error)||Boolean(feedback?.completed)} feedback={feedback} motion={motion} round={door}/></div>
  <div className="runner-live-feedback" aria-live="polite">
   {error?<div className="alert" role="alert"><Icon name="info"/><p>{errorText(error.failure)}</p><Button variant="ghost" onClick={retry} disabled={Boolean(busy)}>{c.retry}</Button></div>:feedback?<div className={'game-feedback '+(feedback.correct?'right':'retry')} data-outcome={outcome}><Icon name={feedback.correct?'check':'info'} size={23}/><div><strong>{c[outcome]||t(feedback.message)}</strong>{feedback.correctedSentence&&<p lang="en">{feedback.correctedSentence}</p>}</div></div>:<p className="runner-rules">{c.note}</p>}
   {busy&&<p className="small-working" role="status"><span className="spinner"/>{busy==='round'?c.loading:c.checking}</p>}
  </div>
  {complete&&<section ref={summaryRef} className="practice-round-summary" data-correct={practiceRound.stats.correct} data-wrong={practiceRound.stats.wrong} data-missed={practiceRound.stats.missed}><span className="pill"><Icon name="check" size={16}/>{c.resume}</span><h2>{c.complete}</h2><div className="practice-round-stats"><div><strong>{practiceRound.stats.correct}</strong><span>{c.hits}</span></div><div><strong>{practiceRound.stats.wrong}</strong><span>{c.errors}</span></div><div><strong>{practiceRound.stats.missed}</strong><span>{c.timeouts}</span></div></div><p>{c.plan}</p>{Boolean(practiceRound.mix?.practice)&&<p className="subtle">{c.pool}</p>}<Button className="runner-next-round" icon="arrow" onClick={startNextRound} disabled={Boolean(busy)}>{busy==='new-round'?c.loading:c.next}</Button></section>}
  <div className="runner-session-footer"><span>{c.allTime}: <strong>{arcadePoints} PTS</strong></span><Button variant="ghost" icon="gamepad" onClick={onModes}>{c.modes}</Button></div>
 </section>;
}
