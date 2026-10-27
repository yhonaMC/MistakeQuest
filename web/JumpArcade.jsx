import React,{useEffect,useId,useRef,useState} from 'react';
import {useI18n} from './i18n.js';
import {createJumpWorld,createJumpPlayer,stepJump,launchAssistedJump} from './jump-physics.js';
import './jump-arcade.css';

const WORLD=createJumpWorld(),FRAME=1/120;
const ASSIST_KEY='mistakequest.jumpMovementHelp';
function savedMovementHelp(){try{return localStorage.getItem(ASSIST_KEY)==='on';}catch{return false;}}
const COPY={
 es:{title:'Salto orbital',checkpoint:'Etapa {step} de {total}',instruction:'Sube por las plataformas y aterriza en la opción que encaja en la frase.',field:'Plataformas de Salto orbital',ready:'Muévete y salta. La respuesta cuenta al aterrizar.',wrong:'Vuelve a saltar. Tu etapa sigue aquí.',reset:'De vuelta en tu plataforma. Sigue cuando quieras.',waiting:'Aterrizaje logrado. Comprobando tu elección…',recovering:'Volviendo a tu plataforma…',solved:'Etapa superada. Continúa cuando quieras.',paused:'Salto en pausa.',retry:'Tu vuelo está guardado. Revisa el aviso para continuar.',keys:'← → o A / D para moverte · Espacio para saltar',left:'Mover a la izquierda',right:'Mover a la derecha',jump:'Saltar',assistOn:'Activar ayuda de movimiento',assistOff:'Desactivar ayuda de movimiento',assistHint:'Con ayuda: elige una opción para volar hasta su plataforma.',manualHint:'Sin ayuda: usa las plataformas intermedias. Caer no cuenta como un error de inglés.',fly:'Volar a la opción {option}',target:'Fragmento que necesita un cambio',empty:'Preparando las plataformas…'},
 en:{title:'Orbital jump',checkpoint:'Stage {step} of {total}',instruction:'Climb the platforms and land on the option that fits the sentence.',field:'Orbital jump platforms',ready:'Move and jump. Your answer counts when you land.',wrong:'Try another jump. Your stage is still here.',reset:'Back on your platform. Continue when you are ready.',waiting:'You landed. Checking your choice…',recovering:'Returning to your platform…',solved:'Stage cleared. Continue when you are ready.',paused:'Jump paused.',retry:'Your flight is saved. Check the notice to continue.',keys:'← → or A / D to move · Space to jump',left:'Move left',right:'Move right',jump:'Jump',assistOn:'Turn on movement help',assistOff:'Turn off movement help',assistHint:'With help: choose an option to fly to its platform.',manualHint:'Without help: use the stepping stones. Falling is not an English mistake.',fly:'Fly to option {option}',target:'Fragment that needs a change',empty:'Preparing the platforms…'}
};

function Astronaut({player}){
 return <g className="jump-astronaut" transform={`translate(${player.x} ${player.y})`}><g transform={`rotate(${player.grounded?0:player.vx/45} 0 -25)`}>
  <rect x="-25" y="-36" width="13" height="26" rx="6" fill="#70658c"/>
  <path d="M-11-12-15-2M11-12 15-2" stroke="#b5a0ff" strokeWidth="8" strokeLinecap="round"/>
  <ellipse cy="-25" rx="21" ry="24" fill="#ddd5ff"/>
  <path d="M-16-32Q0-45 17-32V-22Q0-12-16-23Z" fill="#172a35" stroke="#9ce8ca" strokeWidth="2"/>
  <path d="M-10-31Q-4-35 3-34" stroke="#e1fff3" strokeWidth="3" strokeLinecap="round" fill="none"/>
  <circle cx="10" cy="-7" r="3" fill="#9ce8ca"/>
 </g></g>;
}

/** Only a descending answer-pad landing sends a public option ID. The session owns grading. */
export default function JumpArcade({game,disabled=false,paused=false,motion=true,onAnswer,onAction}){
 const {language}=useI18n(),labels=COPY[language]||COPY.es,promptId=useId(),helpId=useId();
 const checkpoint=game?.adventure?.step??0,key=`${game?.id}:${checkpoint}`;
 const [player,setPlayer]=useState(()=>createJumpPlayer(WORLD)),[phase,setPhase]=useState('playing'),[notice,setNotice]=useState('ready'),[assisted,setAssisted]=useState(savedMovementHelp),[visible,setVisible]=useState(()=>!document.hidden),[reduced,setReduced]=useState(()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false),[trail,setTrail]=useState([]),[burst,setBurst]=useState(null);
 const playerRef=useRef(player),input=useRef({left:false,right:false,jump:false}),flight=useRef(false),lock=useRef(false),epoch=useRef(0),mounted=useRef(true),field=useRef(null),callbacks=useRef({onAnswer,onAction}),blocked=useRef(false);
 callbacks.current={onAnswer,onAction};
 const active=!disabled&&!paused&&visible&&phase==='playing',visualMotion=motion&&!reduced;
 blocked.current=!active||lock.current;
 const text=(name,values={})=>(labels[name]||name).replace(/\{(\w+)\}/g,(_,name)=>values[name]??'');
 const options=(game?.options||[]).slice(0,2),sentence=game?.text||'',offset=Math.max(0,Math.min(sentence.length,Number(game?.target?.offset)||0)),length=Math.max(0,Number(game?.target?.length)||0);
 const clearInput=()=>{input.current={left:false,right:false,jump:false};};
 function paint(next){playerRef.current=next;setPlayer(next);}
 function respawn(message){flight.current=false;clearInput();setTrail([]);paint(createJumpPlayer(WORLD));lock.current=false;setNotice(message);setPhase('playing');}

 useEffect(()=>{
  epoch.current++;lock.current=false;flight.current=false;clearInput();paint(createJumpPlayer(WORLD));setTrail([]);setBurst(null);setNotice('ready');setPhase('playing');
 },[key]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;clearInput();};},[]);
 useEffect(()=>{
  const visibility=()=>{setVisible(!document.hidden);clearInput();},blur=()=>clearInput(),media=window.matchMedia?.('(prefers-reduced-motion: reduce)'),change=()=>setReduced(Boolean(media?.matches));
  document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',blur);media?.addEventListener('change',change);
  return()=>{document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',blur);media?.removeEventListener('change',change);};
 },[]);
 useEffect(()=>{if(!active)clearInput();},[active]);
 useEffect(()=>{try{localStorage.setItem(ASSIST_KEY,assisted?'on':'off');}catch{/* Movement help remains usable without browser storage. */}},[assisted]);

 async function settle(kind,optionIndex){
  if(lock.current)return;
  const option=options[optionIndex];if(kind==='answer'&&!option)return;
  lock.current=true;clearInput();flight.current=false;setPhase(kind==='answer'?'waiting':'recovering');
  const version=epoch.current;
  try{
   const result=kind==='answer'?await callbacks.current.onAnswer?.({answer:String(option.id),checkpoint}):await callbacks.current.onAction?.({type:'fall',checkpoint});
   if(!mounted.current||epoch.current!==version)return;
   if(kind==='answer'&&result?.correct===true){setPhase('solved');return;}
   if(kind==='answer'&&result?.correct===false){respawn('wrong');return;}
   if(kind==='motor'&&result?.game){respawn('reset');return;}
   setPhase('retry');
  }catch{if(mounted.current&&epoch.current===version)setPhase('retry');}
 }

 useEffect(()=>{
  if(!active)return;
  let frame,last=null,accumulator=0,lastTrail=0;
  const tick=now=>{
   if(blocked.current||document.hidden)return;
   accumulator+=last===null?0:Math.min((now-last)/1000,.05);last=now;
   let next=playerRef.current,changed=false;
   while(accumulator>=FRAME&&!lock.current){
    const controls=input.current,result=stepJump(next,{horizontal:Number(controls.right)-Number(controls.left),jump:controls.jump,coast:flight.current},FRAME,WORLD);
    controls.jump=false;accumulator-=FRAME;next=result.player;playerRef.current=next;changed=true;
    if(result.event?.type==='land'){
     flight.current=false;
     if(visualMotion)setBurst({x:next.x,y:next.y,id:now});
     if(result.event.optionIndex!=null){void settle('answer',result.event.optionIndex);break;}
    }else if(result.event?.type==='fall'){void settle('motor');break;}
   }
   if(changed){setPlayer(next);if(visualMotion&&now-lastTrail>55){lastTrail=now;setTrail(previous=>next.grounded?[]:[...previous.slice(-7),{x:next.x,y:next.y-23}]);}}
   if(!lock.current)frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[active,key,visualMotion]);

 function move(direction,pressed){if(pressed&&blocked.current)return;input.current[direction]=pressed;if(pressed)flight.current=false;}
 function jump(){if(!blocked.current){input.current.jump=true;flight.current=false;}}
 function keyDown(event){
  if(event.altKey||event.metaKey||event.ctrlKey)return;
  const key=event.key.toLowerCase();
  if(['arrowleft','a','arrowright','d'].includes(key)){event.preventDefault();move(key==='a'||key==='arrowleft'?'left':'right',true);}
  else if(key===' '&&!event.target.closest('button')){event.preventDefault();if(!event.repeat)jump();}
 }
 function keyUp(event){const key=event.key.toLowerCase();if(['arrowleft','a','arrowright','d'].includes(key)){event.preventDefault();move(key==='a'||key==='arrowleft'?'left':'right',false);}}
 function hold(event,direction){event.preventDefault();try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Synthetic pointer events have no capture. */}direction==='jump'?jump():move(direction,true);}
 function release(event,direction){if(direction!=='jump')move(direction,false);}
 function travel(index){
  if(!assisted||blocked.current||!playerRef.current.grounded)return;
  clearInput();flight.current=true;paint(launchAssistedJump(playerRef.current,WORLD.platforms.find(platform=>platform.optionIndex===index)));field.current?.focus({preventScroll:true});
 }
 const displayedPhase=paused||!visible?'paused':phase,status=displayedPhase==='playing'?notice:displayedPhase;

 return <section className="jump-arcade" aria-label={text('title')} data-phase={displayedPhase} data-player-x={player.x.toFixed(2)} data-player-y={player.y.toFixed(2)} data-platform={player.platformId||'air'} data-assisted={assisted} data-motion={visualMotion?'on':'off'} onKeyDown={keyDown} onKeyUp={keyUp}>
  <div className="jump-prompt"><p className="jump-checkpoint">{text('checkpoint',{step:checkpoint+1,total:game?.adventure?.total||game?.progress?.total||1})}</p><p className="jump-sentence" id={promptId} lang="en">{sentence.slice(0,offset)}<mark title={text('target')}>{sentence.slice(offset,offset+length)}</mark>{sentence.slice(offset+length)}</p><p className="jump-instruction" id={helpId}>{text('instruction')}</p></div>
  <div className="jump-answer-labels" lang="en">{options.map((option,index)=><button type="button" key={option.id} className="jump-option" data-option-id={option.id} disabled={!assisted||!active||!player.grounded} onClick={()=>travel(index)} aria-label={assisted?text('fly',{option:option.text}):undefined}><span className="jump-option-letter" aria-hidden="true">{index?'B':'A'}</span><span className="jump-option-text">{option.text}</span>{assisted&&<span className="jump-option-arrow" aria-hidden="true">↗</span>}</button>)}{options.length<2&&<p>{text('empty')}</p>}</div>
  <div className="jump-playfield" ref={field} tabIndex="0" data-arcade-focus role="group" aria-label={text('field')} aria-describedby={`${promptId} ${helpId}`}>
   <svg className="jump-world" viewBox="0 0 1000 480" aria-hidden="true">
    <defs><pattern id={`${promptId}-stars`} width="145" height="107" patternUnits="userSpaceOnUse"><circle cx="25" cy="20" r="1.5" fill="#b5a0ff" opacity=".4"/><circle cx="110" cy="76" r="1" fill="#f2ecff" opacity=".35"/></pattern><linearGradient id={`${promptId}-pad`} x2="0" y2="1"><stop stopColor="#5b4c7c"/><stop offset="1" stopColor="#24202f"/></linearGradient></defs>
    <rect width="1000" height="480" fill={`url(#${promptId}-stars)`}/>
    <path className="jump-route" d="M500 423Q414 280 300 333M300 333Q235 186 180 238M500 423Q586 280 700 333M700 333Q765 186 820 238"/>
    {WORLD.platforms.map(platform=><g key={platform.id} className={'jump-platform '+(platform.optionIndex==null?'is-neutral':'is-answer')+(player.platformId===platform.id?' is-occupied':'')} transform={`translate(${platform.x} ${platform.y})`}><path d={`M0 0H${platform.width}L${platform.width-16} 25H16Z`} fill={`url(#${promptId}-pad)`}/><path className="jump-platform-edge" d={`M2 0H${platform.width-2}`}/>{platform.optionIndex!=null?<><path className="jump-pad-beam" d={`M20-55V-10M${platform.width-20}-55V-10`}/><text x={platform.width/2} y="-24" textAnchor="middle" className="jump-pad-letter">{platform.optionIndex?'B':'A'}</text></>:<path d={`M${platform.width/2-15} 12H${platform.width/2+15}`} stroke="#b5a0ff" strokeWidth="3" opacity=".45"/>}</g>)}
    {visualMotion&&trail.map((point,index)=><circle key={index} cx={point.x} cy={point.y} r={2+index*.6} fill="#9ce8ca" opacity={index/trail.length*.22}/>)}
    {visualMotion&&burst&&<g key={burst.id} className="jump-landing-burst" transform={`translate(${burst.x} ${burst.y})`}>{[-1,1].map(direction=><g key={direction} style={{'--particle-direction':direction}}><path d={`M${direction*25}-3l${direction*20}-12M${direction*31} 5l${direction*20} 3`} stroke="#9ce8ca" strokeWidth="3" strokeLinecap="round"/></g>)}</g>}
    <Astronaut player={player}/>
    <path d="M0 475H1000" stroke="#b5a0ff" strokeDasharray="3 18" opacity=".2"/>
   </svg>
   {displayedPhase==='paused'&&<div className="jump-paused" aria-hidden="true"><span>Ⅱ</span>{text('paused')}</div>}
  </div>
  <div className="jump-dock"><p className="jump-status" role="status"><i aria-hidden="true"/>{text(status)}</p><div className="jump-controls" role="group" aria-label={text('field')}>{[['left','←'],['jump','↑'],['right','→']].map(([direction,icon])=><button type="button" className={direction==='jump'?'jump-control jump-control-lift':'jump-control'} data-control={direction} key={direction} disabled={!active} aria-label={text(direction)} onPointerDown={event=>hold(event,direction)} onPointerUp={event=>release(event,direction)} onPointerCancel={event=>release(event,direction)} onLostPointerCapture={event=>release(event,direction)} onClick={event=>{if(event.detail!==0)return;if(direction==='jump')jump();else{move(direction,true);setTimeout(()=>move(direction,false),180);}}}><span aria-hidden="true">{icon}</span><span>{direction==='jump'?text('jump'):direction==='left'?'A':'D'}</span></button>)}</div><p className="jump-key-help">{text('keys')}</p><div className="jump-assist"><button type="button" className="jump-assist-toggle" disabled={disabled||lock.current||phase==='solved'} aria-pressed={assisted} onClick={()=>setAssisted(value=>!value)}>{text(assisted?'assistOff':'assistOn')}<span aria-hidden="true">{assisted?'✓':'+'}</span></button><p>{text(assisted?'assistHint':'manualHint')}</p></div></div>
 </section>;
}
