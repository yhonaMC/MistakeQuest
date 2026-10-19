import React,{useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {useI18n} from './i18n.js';
import {Button} from './App.jsx';
import Icon from './Icon.jsx';
import RadarArcade from './RadarArcade.jsx';
import RunnerArcade from './RunnerArcade.jsx';
import './arcade-session.css';

const copy={
 es:{gallery:'Galería de palabras',runner:'Carrera de dos caminos',round:'Ronda',of:'de',optional:'Siempre opcional',leave:'Salir de la partida',next:'Siguiente ronda',preparing:'Preparando otra frase de tu error…',checking:'Comprobando tu respuesta…',finish:'Sesión completada.',finished:'Tres rondas con tus propios errores.',earned:'XP ganados en esta sesión',review:'Buen repaso. Estas frases ya tenían su recompensa.',again:'Otra sesión de este juego',modes:'Elegir otro minijuego',hint:'Pedir pista',reveal:'Ver solución',note:'Cada respuesta se comprueba en este PC y tu progreso se guarda al terminar cada ronda.',unavailable:'Esta corrección ya no necesita un reto. Puedes elegir otro error.',retry:'Reintentar carga',saved:'Rondas guardadas',streak:'Racha',loading:'Preparando…'},
 en:{gallery:'Word shooting gallery',runner:'Two-path runner',round:'Round',of:'of',optional:'Always optional',leave:'Leave game',next:'Next round',preparing:'Preparing another sentence from your mistake…',checking:'Checking your answer…',finish:'Session completed.',finished:'Three rounds with your own mistakes.',earned:'XP earned in this session',review:'Good practice. These sentences had already earned their reward.',again:'Play another session',modes:'Choose another minigame',hint:'Get a hint',reveal:'Reveal answer',note:'Each answer is checked on this PC. Your progress is saved after every round.',unavailable:'This correction no longer needs a challenge. Choose another mistake.',retry:'Retry loading',saved:'Saved rounds',streak:'Streak',loading:'Preparing…'}
};

export default function ArcadeSession({game:initial,issueId,onExit,onProgress,onAgain,onModes,generating,motion=true}){
 const {language,t,errorText}=useI18n(),c=copy[language]||copy.es;
 const [game,setGame]=useState(initial),[round,setRound]=useState(1),[feedback,setFeedback]=useState(null),[help,setHelp]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState(null),[earned,setEarned]=useState(0),[streak,setStreak]=useState(0),[loadFailed,setLoadFailed]=useState(false);
 const totalRounds=3,completed=Boolean(feedback?.correct&&round===totalRounds),solved=Boolean(feedback?.correct),mounted=useRef(true),pending=useRef(false),controller=useRef(null),lastSubmission=useRef(null),settled=useRef(new Set()),transitioned=useRef(new Set());
 const visitedIssues=useRef(new Set([initial.issueId||issueId].filter(Boolean)));
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 async function submit(payload){
   if(pending.current||solved||settled.current.has(game.id))return;
   pending.current=true;const abort=new AbortController();controller.current=abort;
   const signature=JSON.stringify({gameId:game.id,...payload});
   if(lastSubmission.current?.signature!==signature)lastSubmission.current={signature,key:crypto.randomUUID()};
   const key=lastSubmission.current.key;
   setBusy('answer');setError(null);setFeedback(null);
   try{
     const result=await api(`/games/${game.id}/attempt`,{method:'POST',body:{idempotencyKey:key,...payload},signal:abort.signal});
     if(!mounted.current)return;
     lastSubmission.current=null;setFeedback(result);
     if(result.correct){settled.current.add(game.id);setEarned(value=>value+(result.xpEarned||0));setStreak(value=>value+1);onProgress?.();}else setStreak(0);
   }catch(failure){if(mounted.current&&failure.name!=='AbortError')setError(failure);}
   finally{pending.current=false;if(mounted.current)setBusy('');}
 }
 async function nextRound(){
   if(pending.current||!solved||completed||transitioned.current.has(game.id))return;
   const currentIssueId=game.issueId||issueId;
   if(!currentIssueId){setError(new Error(c.unavailable));return;}
   pending.current=true;const abort=new AbortController();controller.current=abort;setBusy('round');setLoadFailed(false);setError(null);
   try{
     const next=await api('/games',{method:'POST',body:{issueId:currentIssueId,mode:game.mode,...game.mode==='choice'?{varied:true,excludeIssueIds:[...visitedIssues.current]}:{}},signal:abort.signal});
     if(!mounted.current)return;
     if(next.status==='already_correct'){setError(new Error(c.unavailable));setLoadFailed(true);return;}
     if(next.issueId)visitedIssues.current.add(next.issueId);
     transitioned.current.add(game.id);setGame(next);setRound(value=>value+1);setFeedback(null);setHelp(null);lastSubmission.current=null;
   }catch(failure){if(mounted.current&&failure.name!=='AbortError'){setError(failure);setLoadFailed(true);}}
   finally{pending.current=false;if(mounted.current)setBusy('');}
 }
 async function assist(reveal=false){
   if(pending.current||solved)return;
   pending.current=true;const abort=new AbortController();controller.current=abort;setBusy('help');setError(null);
   try{const value=await api(`/games/${game.id}/${reveal?'reveal':'hint'}`,{method:'POST',body:{},signal:abort.signal});if(mounted.current)setHelp(value);}
   catch(failure){if(mounted.current&&failure.name!=='AbortError')setError(failure);}
   finally{pending.current=false;if(mounted.current)setBusy('');}
 }
 const Board=game.mode==='radar'?RadarArcade:RunnerArcade;
 const preparing=game.mode==='choice'?(language==='en'?'Preparing the next word from your mistakes…':'Preparando otra palabra de tus errores…'):c.preparing;
 const saved=round-1+(solved?1:0);
 return <section className={'arena arcade-session mode-'+game.mode} data-round={round} data-completed={completed?'true':'false'} data-game-id={game.id}>
  <div className="arena-toolbar"><Button variant="ghost" icon="back" onClick={onExit}>{c.leave}</Button><span className="pill">{t(game.label)}</span><span className="subtle">{c.optional}</span></div>
  <div className="arcade-hud"><span className="hud-mode"><span><Icon name={game.mode} size={22}/></span><span>{game.mode==='radar'?c.gallery:c.runner}<strong>{t(game.name)}</strong></span></span><div className="hud-progress"><span>{c.round} {round} {c.of} {totalRounds}</span><div aria-label={`${c.saved}: ${saved}`} >{Array.from({length:totalRounds},(_,i)=><i key={i} className={i<saved?'done':i===round-1?'current':''}/>)}</div></div><span className="session-score"><Icon name="spark" size={17}/><strong>{earned} XP</strong>{streak>1&&<small>{c.streak} ×{streak}</small>}</span></div>
  <div className="arcade-playfield">
   <Board game={game} onAnswer={submit} disabled={Boolean(busy)||solved} feedback={feedback} motion={motion} round={round} totalRounds={totalRounds}/>
  </div>
  <div className="arcade-response-area">
   {busy&&<p className="small-working" role="status"><span className="spinner"/>{busy==='round'?preparing:c.checking}</p>}
   {error&&<div className="alert" role="alert"><Icon name="info"/><p>{errorText(error)}</p>{loadFailed&&<Button variant="ghost" onClick={nextRound} disabled={Boolean(busy)}>{c.retry}</Button>}</div>}
   {help&&<div className="help-box" role="status"><Icon name={help.help==='reveal'?'eye':'bulb'}/><p>{t(help.message)}</p></div>}
   {feedback&&<div className={'game-feedback '+(feedback.correct?'right':'retry')} role="status"><span className="feedback-icon"><Icon name={feedback.correct?'check':'bulb'} size={24}/></span><div><strong>{t(feedback.message)}</strong>{feedback.correctedSentence&&<p lang="en">{feedback.correctedSentence}</p>}{feedback.explanation&&<p className="feedback-explanation">{t(feedback.explanation)}</p>}</div></div>}
   {solved&&!completed&&<div className="arcade-next"><span>{c.saved}: {saved} / {totalRounds}</span><Button className="arcade-next-round" icon="arrow" onClick={nextRound} disabled={Boolean(busy)}>{busy==='round'?c.loading:c.next}</Button></div>}
   {!solved&&<div className="game-assists"><Button variant="ghost" icon="bulb" disabled={Boolean(busy)} onClick={()=>assist()}>{c.hint}</Button><Button variant="ghost" icon="eye" disabled={Boolean(busy)} onClick={()=>assist(true)}>{c.reveal}</Button></div>}
  </div>
  {completed&&<><div className="victory-card"><span className="victory-symbol"><Icon name="medal" size={32}/></span><div><span>{c.finished}</span><h2>{c.finish}</h2><p>{earned?c.earned:c.review}</p></div><span className="victory-xp"><b>+{earned}</b> XP</span></div><div className="end-actions"><Button variant="secondary" onClick={onAgain} disabled={generating}>{generating?c.loading:c.again}</Button><Button icon="gamepad" onClick={onModes}>{c.modes}</Button></div></>}
  <p className="arena-note"><Icon name="shield" size={16}/>{c.note}</p>
 </section>;
}
