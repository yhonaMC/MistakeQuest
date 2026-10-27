import React,{useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {useI18n} from './i18n.js';
import {Button} from './App.jsx';
import Icon from './Icon.jsx';
import './adventure-session.css';

const copy={
 es:{checkpoint:'Checkpoint',of:'de',start:'Empezar partida',resume:'Reanudar',pause:'Pausar',paused:'Partida en pausa',read:'Tómate tu tiempo. El mundo espera.',ready:'Tu próxima aventura empieza con un error que ya conoces.',next:'Continuar',saved:'Checkpoint guardado',finish:'Aventura completada',retry:'Comprobar de nuevo',checking:'Guardando tu progreso…',hint:'Pedir pista',reveal:'Ver solución',leave:'Salir de la partida',modes:'Elegir otro minijuego',again:'Otra partida',motor:'Tropiezos de movimiento',motorNote:'Los tropiezos no cuentan como errores de inglés.',optional:'Siempre opcional',earned:'XP ganados',review:'Repaso guardado',note:'Tus checkpoints y tus palabras se guardan en este PC.',help:'Puedes pedir una pista o ver la solución. Con ayuda, la recompensa final es menor.',connection:'No se pudo confirmar el resultado. Comprueba de nuevo para recuperar este mismo intento.'},
 en:{checkpoint:'Checkpoint',of:'of',start:'Start game',resume:'Resume',pause:'Pause',paused:'Game paused',read:'Take your time. The world can wait.',ready:'Your next adventure starts with a mistake you already know.',next:'Continue',saved:'Checkpoint saved',finish:'Adventure complete',retry:'Check again',checking:'Saving your progress…',hint:'Get a hint',reveal:'Reveal answer',leave:'Leave game',modes:'Choose another minigame',again:'Play again',motor:'Movement slips',motorNote:'Movement slips do not count as English mistakes.',optional:'Always optional',earned:'XP earned',review:'Practice saved',note:'Your checkpoints and words are saved on this PC.',help:'You can get a hint or reveal the answer. Help reduces the final reward.',connection:'The result could not be confirmed. Check again to recover this same attempt.'}
};

export default function AdventureSession({game:initial,Board,onExit,onProgress,onAgain,onModes,generating,motion=true}){
 const {language,t,errorText}=useI18n(),c=copy[language]||copy.es;
 const [game,setGame]=useState(initial),[started,setStarted]=useState(false),[paused,setPaused]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(null),[feedback,setFeedback]=useState(null),[help,setHelp]=useState(null),[boardRevision,setBoardRevision]=useState(0);
 const pending=useRef(null),inFlight=useRef(false),mounted=useRef(true),controller=useRef(null),world=useRef(null);
 const focusWorld=()=>requestAnimationFrame(()=>world.current?.querySelector('[data-arcade-focus]')?.focus());
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 useEffect(()=>{const hide=()=>{if(document.hidden)setPaused(true);};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);},[]);
 const completed=Boolean(game.completed||feedback?.completed),stageSolved=Boolean(feedback?.correct&&!completed),unresolved=Boolean(error&&pending.current);
 async function perform(kind,payload,retry=false){
  if(inFlight.current||completed||stageSolved)return;
  if(pending.current&&!retry)return;
  const job=retry?pending.current:{kind,path:`/games/${game.id}/${kind==='answer'?'attempt':kind==='action'?'action':kind}`,body:kind==='answer'||kind==='action'?{...structuredClone(payload),checkpoint:game.adventure.step,idempotencyKey:crypto.randomUUID()}: {}};
  if(!job)return;
  pending.current=job;inFlight.current=true;const abort=new AbortController();controller.current=abort;setBusy(job.kind);setError(null);
  try{
   const result=await api(job.path,{method:'POST',body:job.body,signal:abort.signal});
   if(!mounted.current)return;
   pending.current=null;
   if(job.kind==='action'){setGame(result.game);if(retry)setBoardRevision(value=>value+1);}
   else if(job.kind==='answer'){setFeedback(result);if(retry)setBoardRevision(value=>value+1);onProgress?.();}
   else{setHelp(result);setGame(previous=>({...previous,help:result.help}));}
   return result;
  }catch(failure){
   if(!mounted.current||failure.name==='AbortError')return;
   if(failure.status>=400&&failure.status<500){
    pending.current=null;setBoardRevision(value=>value+1);
    if(failure.status===409){try{const current=await api(`/games/${game.id}`);if(mounted.current){setGame(current);setFeedback(null);setStarted(false);}}catch{}}
   }
   setError(failure);
  }finally{inFlight.current=false;if(mounted.current)setBusy('');}
 }
 function next(){if(!feedback?.nextQuestion)return;setGame(feedback.nextQuestion);setFeedback(null);setHelp(null);setError(null);setPaused(false);setBoardRevision(value=>value+1);focusWorld();}
 function assist(reveal){setPaused(true);return perform(reveal?'reveal':'hint');}
 const current=game.adventure?.step||0,total=game.adventure?.total||1,motor=game.adventure?.movementMistakes||0,stopped=!started||paused;
 return <section className={'arena adventure-session adventure-'+game.mode} data-game-id={game.id} data-checkpoint={current} data-completed={String(completed)} data-paused={String(stopped)} onKeyDown={event=>{if(event.key.toLowerCase()==='p'&&(!busy||busy==='action')&&!completed){event.preventDefault();setPaused(value=>!value);}}}>
  <div className="arena-toolbar"><Button variant="ghost" icon="back" onClick={onExit}>{c.leave}</Button><span className="pill">{t(game.label)}</span><span className="subtle">{c.optional}</span></div>
  <div className="adventure-hud"><div className="adventure-title"><Icon name={game.mode} size={24}/><div><span>{c.checkpoint} {Math.min(current+1,total)} {c.of} {total}</span><strong>{t(game.name)}</strong></div></div><div className="adventure-checkpoints" aria-label={`${c.saved}: ${current} / ${total}`}>{Array.from({length:total},(_,index)=><i key={index} className={index<current||completed?'done':index===current?'current':''}/>)}</div><div className="adventure-motor"><span>{c.motor}</span><strong>{motor}</strong></div></div>
  <div className="adventure-world" ref={world}><Board key={`${game.id}:${current}:${boardRevision}`} game={game} disabled={Boolean(busy&&busy!=='action')||unresolved||completed||stageSolved} paused={stopped} motion={motion} onAnswer={payload=>perform('answer',payload)} onAction={payload=>perform('action',payload)}/>
   {!completed&&!stageSolved&&stopped&&<div className="adventure-pause-cover"><Icon name={started?'pause':'play'} size={29}/><strong>{started?c.paused:t(game.name)}</strong><p>{started?c.read:c.ready}</p><Button className="adventure-start" icon="play" onClick={()=>{setStarted(true);setPaused(false);focusWorld();}} disabled={Boolean(busy)||unresolved}>{started?c.resume:c.start}</Button></div>}
  </div>
  <div className="adventure-controls"><p><Icon name="shield" size={17}/>{c.motorNote}</p><Button className="adventure-pause" variant="secondary" icon={paused?'play':'pause'} onClick={()=>{setPaused(value=>!value);if(paused)focusWorld();}} disabled={!started||Boolean(busy&&busy!=='action')||completed||stageSolved||unresolved}>{paused?c.resume:c.pause}</Button></div>
  {busy&&busy!=='action'&&<p className="small-working" role="status"><span className="spinner"/>{c.checking}</p>}
  {error&&<div className="alert" role="alert"><span>{unresolved?c.connection:errorText(error)}</span>{unresolved&&<Button className="adventure-retry" variant="ghost" onClick={()=>perform(null,null,true)} disabled={busy}>{c.retry}</Button>}</div>}
  {help&&<div className="help-box" role="status"><Icon name={help.help==='reveal'?'eye':'bulb'}/><p>{t(help.message)}</p></div>}
  {feedback&&<div className={'game-feedback '+(feedback.correct?'right':'retry')} role="status"><span className="feedback-icon"><Icon name={feedback.correct?'check':'bulb'} size={24}/></span><div><strong>{stageSolved?c.saved:t(feedback.message)}</strong>{feedback.correctedSentence&&<p lang="en">{feedback.correctedSentence}</p>}{feedback.explanation&&<p className="feedback-explanation">{t(feedback.explanation)}</p>}</div>{stageSolved&&<Button className="adventure-next" icon="arrow" onClick={next}>{c.next}</Button>}</div>}
  {!completed&&<div className="game-assists"><Button variant="ghost" icon="bulb" disabled={busy||stageSolved||unresolved} onClick={()=>assist(false)}>{c.hint}</Button><Button variant="ghost" icon="eye" disabled={busy||stageSolved||unresolved} onClick={()=>assist(true)}>{c.reveal}</Button><span>{c.help}</span></div>}
  {completed&&<><div className="victory-card"><span className="victory-symbol"><Icon name="medal" size={32}/></span><div><span>{c.saved}</span><h2>{c.finish}</h2><p>{c.motorNote}</p></div><span className="victory-xp">{feedback?.xpEarned>0?<><b>+{feedback.xpEarned}</b> XP</>:c.review}</span></div><div className="end-actions"><Button variant="secondary" onClick={onAgain} disabled={generating}>{c.again}</Button><Button icon="gamepad" onClick={onModes}>{c.modes}</Button></div></>}
  <p className="arena-note"><Icon name="shield" size={16}/>{c.note}</p>
 </section>;
}
