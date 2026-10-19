import React,{useEffect,useId,useRef,useState} from 'react';
import {useI18n} from './i18n.js';
import './radar-arcade.css';

const copy={
 es:{gallery:'Galería de palabras',context:'Lee la frase',start:'Empezar a apuntar',pause:'Pausar',resume:'Reanudar',ready:'Tienes el error en la mira.',intro:'Lee la frase y dispara a la palabra que necesita un cambio.',paused:'Galería en pausa',pausedHint:'Tus blancos te esperan.',aim:'Apunta al error',checking:'Comprobando disparo…',hit:'¡Blanco encontrado!',retry:'Esa palabra está bien. Prueba otra.',exhausted:'Lee la corrección antes de seguir.',discarded:'Palabra descartada',keys:'Tab para apuntar · Enter para disparar · Esc para pausar',touch:'Toca una palabra para disparar',target:'Disparar a',static:'Blancos quietos',empty:'No hay palabras disponibles para esta ronda.'},
 en:{gallery:'Word shooting gallery',context:'Read the sentence',start:'Start aiming',pause:'Pause',resume:'Resume',ready:'The mistake is in your sights.',intro:'Read the sentence and shoot the word that needs a change.',paused:'Gallery paused',pausedHint:'Your targets will wait.',aim:'Aim at the mistake',checking:'Checking your shot…',hit:'Target found!',retry:'That word is correct. Try another.',exhausted:'Read the correction before moving on.',discarded:'Discarded word',keys:'Tab to aim · Enter to shoot · Esc to pause',touch:'Tap a word to shoot',target:'Shoot',static:'Still targets',empty:'There are no words available for this round.'}
};

function SightIcon({pause=false,play=false}){
 return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">{pause?<path d="M8 6v12M16 6v12" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>:play?<path d="m9 5 10 7-10 7V5Z" fill="currentColor"/>:<><circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M12 2v6m0 8v6M2 12h6m8 0h6" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></>}</svg>;
}

/** The session owns validation and attempts. This view only sends real public token IDs. */
export default function RadarArcade({game,onAnswer,disabled=false,feedback=null,motion=true,round=1,totalRounds=3,onPauseChange}){
 const {language}=useI18n(),labels=copy[language]||copy.es,contextId=useId();
 const [started,setStarted]=useState(false),[paused,setPaused]=useState(false),[pending,setPending]=useState(false),[shot,setShot]=useState(null),[pointer,setPointer]=useState(false);
 const galleryRef=useRef(null),targetRefs=useRef([]),submissionLock=useRef(false),serial=useRef(0),gameId=useRef(game?.id);
 const solved=feedback?.correct===true,finished=solved||Boolean(game?.guided&&feedback?.completed),active=started&&!paused&&!disabled&&!pending&&!finished;
 const tokens=game?.tokens||[],currentShot=shot?.gameId===game?.id?shot:null;
 const discarded=new Set((game?.discardedTokenIds||feedback?.discardedTokenIds||[]).map(String));
 const shotResult=feedback&&!feedback.requestFailed&&currentShot?.tokenId!=null?(feedback.correct?'hit':'retry'):'';
 const state=!started?'ready':paused?'paused':solved?'solved':finished?'exhausted':'playing';

 useEffect(()=>{
  // A different challenge clears the previous shot but preserves the player's start/pause choice.
  gameId.current=game?.id;submissionLock.current=false;setShot(null);setPending(false);setPointer(false);
 },[game?.id]);
 useEffect(()=>{onPauseChange?.(!started||paused);},[onPauseChange,started,paused]);
 useEffect(()=>{
  function onVisibility(){if(document.hidden){setPaused(true);setPointer(false);}}
  document.addEventListener('visibilitychange',onVisibility);
  return()=>document.removeEventListener('visibilitychange',onVisibility);
 },[]);

 function shotPosition(event){
  const gallery=galleryRef.current?.getBoundingClientRect();
  if(!gallery)return{x:0,y:0};
  const bounds=event.currentTarget.getBoundingClientRect(),keyboard=event.detail===0;
  return{x:(keyboard?bounds.left+bounds.width/2:event.clientX)-gallery.left,y:(keyboard?bounds.top+bounds.height/2:event.clientY)-gallery.top};
 }
 async function shoot(event,token){
  event.stopPropagation();
  if(!active||submissionLock.current||discarded.has(String(token.id)))return;
  submissionLock.current=true;setPending(true);
  const id=game.id;
  setShot({serial:++serial.current,gameId:id,tokenId:token.id,...shotPosition(event)});
  try{await onAnswer({tokenIndex:token.id});}
  catch{/* The session presents service errors; the trigger is released for a retry. */}
  finally{if(gameId.current===id){submissionLock.current=false;setPending(false);}}
 }
 function aim(event){
  if(!active||event.pointerType==='touch')return;
  const bounds=event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--aim-x',`${event.clientX-bounds.left}px`);
  event.currentTarget.style.setProperty('--aim-y',`${event.clientY-bounds.top}px`);
  setPointer(true);
 }
 function emptyShot(event){
  if(!active||event.target.closest('button'))return;
  setShot({serial:++serial.current,gameId:game.id,tokenId:null,...shotPosition(event)});
 }
 function start(){
  setStarted(true);setPaused(false);
  requestAnimationFrame(()=>targetRefs.current.find(element=>element&&!element.disabled)?.focus({preventScroll:true}));
 }
 function keyControls(event){
  if(event.key==='Escape'&&started&&(!finished||onPauseChange)){event.preventDefault();setPaused(value=>!value);setPointer(false);return;}
  const available=targetRefs.current.filter(element=>element&&!element.disabled),index=available.indexOf(event.target);
  if(index<0||!active)return;
  let next=index;
  if(event.key==='ArrowRight')next=(index+1)%available.length;
  else if(event.key==='ArrowLeft')next=(index-1+available.length)%available.length;
  else if(event.key==='Home')next=0;
  else if(event.key==='End')next=available.length-1;
  else return;
  event.preventDefault();available[next]?.focus();
 }

 return <section className="radar-arcade" data-state={state} data-motion={motion?'on':'off'} data-round={round} data-total-rounds={totalRounds} aria-label={labels.gallery} onKeyDown={keyControls}>
  <div className="radar-context"><span id={contextId}>{labels.context}</span><p lang="en" aria-labelledby={contextId}>{game?.text}</p></div>
  <div className="radar-console">
   <div className="radar-console-title"><SightIcon/><strong>{labels.gallery}</strong></div>
   {started&&<button className="radar-pause" type="button" disabled={finished&&!onPauseChange} aria-pressed={paused} onClick={()=>{setPaused(value=>!value);setPointer(false);}}><SightIcon pause={!paused} play={paused}/>{paused?labels.resume:labels.pause}</button>}
  </div>
  <div ref={galleryRef} className={'radar-gallery'+(pointer&&active?' has-pointer':'')} aria-label={labels.gallery} onPointerMove={aim} onPointerLeave={()=>setPointer(false)} onClick={emptyShot}>
   <div className="radar-target-grid" lang="en">
    {tokens.map((token,index)=>{
     const selected=currentShot?.tokenId===token.id,result=selected?shotResult:'',isDiscarded=discarded.has(String(token.id));
     return <div className="radar-target-slot" key={token.id} data-long-word={token.text.length>12?'true':undefined} style={{'--word-length':Math.max(1,token.text.length),'--target-delay':`${-(index*1.31)%7}s`,'--target-speed':`${4.8+(index%5)*.7}s`,'--target-drift':`${index%2?5:-5}px`}}>
      <button type="button" ref={element=>{targetRefs.current[index]=element;}} className={'radar-target'+(selected?' is-selected':'')+(result?' is-'+result:'')+(isDiscarded?' is-discarded':'')} data-token-id={token.id} disabled={!active||isDiscarded} lang={language} aria-label={`${isDiscarded?labels.discarded:labels.target} “${token.text}”`} onClick={event=>shoot(event,token)}>
       <span className="radar-target-orbit" aria-hidden="true"/><span className="radar-target-word" lang="en">{token.text}</span>
       {result&&<span className="radar-target-result" aria-hidden="true">{result==='hit'?'✓':'↺'}</span>}
      </button>
     </div>;
    })}
   </div>
   {!tokens.length&&<p className="radar-empty">{labels.empty}</p>}
   {currentShot&&<span key={currentShot.serial} className={'radar-shot '+(shotResult||'fired')} style={{left:currentShot.x,top:currentShot.y}} aria-hidden="true"><i/><i/><i/><i/></span>}
   <span className="radar-crosshair" aria-hidden="true"><i/><b/><i/></span>
   {(!started||paused)&&(!finished||onPauseChange)&&<div className="radar-cover"><div className="radar-cover-copy"><SightIcon/><h3>{started?labels.paused:labels.ready}</h3><p>{started?labels.pausedHint:labels.intro}</p>{!started&&<button type="button" className="radar-start" disabled={disabled||!tokens.length} onClick={start}><SightIcon play/>{labels.start}</button>}</div></div>}
  </div>
  <div className="radar-footer"><span className={'radar-signal '+(solved?'is-hit':shotResult==='retry'?'is-retry':'')} role="status"><i aria-hidden="true"/>{solved?labels.hit:finished?labels.exhausted:disabled||pending?labels.checking:shotResult==='retry'?labels.retry:motion?labels.aim:labels.static}</span><span className="radar-key-help">{labels.keys}</span><span className="radar-touch-help">{labels.touch}</span></div>
 </section>;
}
