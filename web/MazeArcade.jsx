import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {useI18n} from './i18n.js';
import {nextMazeCell,patrolRoute} from './maze-utils.js';
import './maze-arcade.css';

const copy={
 es:{title:'Laberinto de palabras',original:'Tu frase original',mission:'Explora los pasillos. Recoge las palabras en el orden que quieras probar y llévalas a la salida.',world:'Laberinto. Flechas o W A S D para moverte; espacio para recoger o comprobar en la salida.',words:'Palabras en el mapa',inventory:'Tu frase de viaje',empty:'Todavía no has recogido palabras.',collect:'Recoger palabra',check:'Comprobar frase',undo:'Deshacer última palabra',reset:'Reiniciar palabras',up:'Mover arriba',down:'Mover abajo',left:'Mover a la izquierda',right:'Mover a la derecha',keys:'Flechas / WASD · Espacio para recoger',safe:'Las casillas de palabras son seguras. El dron patrulla los pasillos.',exit:'Salida',exitReady:'Todas las palabras listas. Ve a la salida para comprobar tu frase.',here:'Aquí puedes recoger',explore:'Explora y elige tu próxima palabra.',atExit:'Estás en la salida. Recoge todas las palabras antes de comprobar.',paused:'Laberinto en pausa',pausedHint:'Las palabras y el dron te esperan.',busy:'Guardando movimiento…',bump:'Vuelta al inicio. Conservas tus palabras.',count:'recogidas',you:'Tu explorador',drone:'Dron patrullando',emptyBoard:'Este laberinto no tiene un mapa disponible.',waiting:'Esperando a la misión…'},
 en:{title:'Word maze',original:'Your original sentence',mission:'Explore the corridors. Collect the words in the order you want to try, then take them to the exit.',world:'Maze. Arrow keys or W A S D to move; space to collect or check at the exit.',words:'Words on the map',inventory:'Your travelling sentence',empty:'You have not collected any words yet.',collect:'Collect word',check:'Check sentence',undo:'Undo last word',reset:'Reset words',up:'Move up',down:'Move down',left:'Move left',right:'Move right',keys:'Arrows / WASD · Space to collect',safe:'Word tiles are safe. The drone patrols the corridors.',exit:'Exit',exitReady:'Every word is ready. Reach the exit to check your sentence.',here:'You can collect',explore:'Explore and choose your next word.',atExit:'You are at the exit. Collect every word before checking.',paused:'Maze paused',pausedHint:'The words and drone will wait.',busy:'Saving movement…',bump:'Back at the start. Your words are safe.',count:'collected',you:'Your explorer',drone:'Patrolling drone',emptyBoard:'There is no map available for this maze.',waiting:'Waiting for the mission…'}
};
const keyDirections={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',s:'down',a:'left',d:'right'};
const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
const tile=48;

function Arrow({direction}){
 const rotation={up:0,right:90,down:180,left:270}[direction];
 return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true" style={{transform:`rotate(${rotation}deg)`}}><path d="m6 11 6-6 6 6M12 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

/** The server owns position and inventory. Only explicit exit checks are English attempts. */
export default function MazeArcade({game,disabled=false,paused=false,motion=true,onAnswer,onAction}){
 const {language}=useI18n(),labels=copy[language]||copy.es,id=useId().replace(/:/g,''),worldRef=useRef(null);
 const [pending,setPending]=useState(false),[hidden,setHidden]=useState(()=>typeof document!=='undefined'&&document.hidden),[patrolIndex,setPatrolIndex]=useState(0),[bumped,setBumped]=useState(false);
 const busy=useRef(false),held=useRef(null),repeat=useRef(null),lastInput=useRef(-Infinity),collisionUntil=useRef(0),patrolElapsed=useRef(0),latest=useRef(null);
 const board=game?.board,adventure=game?.adventure||{},position=adventure.position||board?.spawn,collected=adventure.collected||[],sourceTokens=board?.tokens||[];
 const boardKey=board?JSON.stringify({width:board.width,height:board.height,walls:board.walls,spawn:board.spawn,exit:board.exit,tokens:sourceTokens.map(({id,x,y})=>({id,x,y}))}):'';
 // Map labels follow geography, so they never reveal a sentence's token order.
 const tokens=useMemo(()=>[...sourceTokens].sort((a,b)=>a.y-b.y||a.x-b.x||String(a.id).localeCompare(String(b.id))),[boardKey,sourceTokens]);
 const patrol=useMemo(()=>board?patrolRoute(board):[],[boardKey]);
 const routeIndex=patrol.length>1?(patrolIndex%(2*patrol.length-2)<patrol.length?patrolIndex%(2*patrol.length-2):2*patrol.length-2-patrolIndex%(2*patrol.length-2)):0,drone=patrol[routeIndex];
 const active=Boolean(board&&!disabled&&!paused&&!hidden),allCollected=tokens.length>0&&collected.length===tokens.length,atExit=same(position,board?.exit);
 const currentWord=tokens.find(token=>same(token,position)&&!collected.includes(token.id));
 latest.current={game,active,onAction,onAnswer,drone};

 function stopHold(){held.current=null;if(repeat.current!=null){clearInterval(repeat.current);repeat.current=null;}}
 async function action(type,direction){
  const current=latest.current;
  if(!current?.active||busy.current)return;
  const state=current.game.adventure;
  if(type==='move'&&!nextMazeCell(current.game.board,state.position,direction))return;
  busy.current=true;setPending(true);
  if(type==='move'){lastInput.current=performance.now();setBumped(false);}
  try{
   const result=await current.onAction?.({type,...(direction?{direction}:{}),checkpoint:state.step});
   if(result?.game&&latest.current.game.id===result.game.id)latest.current={...latest.current,game:result.game};
  }catch{
   // The session retains the request key and exposes its explicit retry control.
   stopHold();
  }finally{busy.current=false;setPending(false);}
 }
 function move(direction){void action('move',direction);}
 function startHold(direction){
  if(!latest.current.active)return;
  stopHold();held.current=direction;move(direction);
  repeat.current=setInterval(()=>{if(held.current)move(held.current);},140);
 }
 async function interact(){
  const current=latest.current;
  if(!current.active||busy.current)return;
  const {board,adventure}=current.game,inventory=adventure.collected||[];
  if(board.tokens.some(token=>same(token,adventure.position)&&!inventory.includes(token.id))){await action('collect');return;}
  if(!same(board.exit,adventure.position)||inventory.length!==board.tokens.length)return;
  stopHold();busy.current=true;setPending(true);
  try{await current.onAnswer?.({tokenIds:[...inventory],checkpoint:adventure.step});}catch{/* The session owns request recovery. */}finally{busy.current=false;setPending(false);}
 }
 function onKeyDown(event){
  if(event.altKey||event.ctrlKey||event.metaKey)return;
  const direction=keyDirections[event.key]||keyDirections[event.key.toLowerCase()];
  if(direction){event.preventDefault();if(!event.repeat)startHold(direction);}
  if(event.code==='Space'){event.preventDefault();if(!event.repeat)void interact();}
 }

 useEffect(()=>{
  const visibility=()=>{setHidden(document.hidden);if(document.hidden)stopHold();};
  const release=event=>{const direction=keyDirections[event.key]||keyDirections[event.key.toLowerCase()];if(direction===held.current)stopHold();};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('keyup',release);window.addEventListener('blur',stopHold);
  return()=>{stopHold();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('keyup',release);window.removeEventListener('blur',stopHold);};
 },[]);
 useEffect(()=>{if(!active)stopHold();},[active]);
 useEffect(()=>{stopHold();setPatrolIndex(0);setBumped(false);patrolElapsed.current=0;collisionUntil.current=performance.now()+1200;lastInput.current=-Infinity;},[game?.id,adventure.step,boardKey]);
 useEffect(()=>{
  if(!active||!patrol.length)return;
  const timer=setInterval(()=>{
   if(busy.current)return;
   patrolElapsed.current+=80;
   if(patrolElapsed.current>=640){patrolElapsed.current=0;setPatrolIndex(index=>index+1);}
  },80);
  return()=>clearInterval(timer);
 },[active,patrol]);
 useEffect(()=>{
  if(!active||pending||!drone||!same(position,drone)||performance.now()<collisionUntil.current||performance.now()-lastInput.current>400)return;
  collisionUntil.current=performance.now()+2200;lastInput.current=-Infinity;stopHold();setBumped(true);void action('collision');
 },[active,pending,position?.x,position?.y,drone?.x,drone?.y]);

 if(!board)return <p className="maze-empty">{labels.emptyBoard}</p>;
 const status=paused?labels.paused:disabled?labels.waiting:pending?labels.busy:bumped?labels.bump:currentWord?`${labels.here} “${currentWord.text}”`:atExit?(allCollected?labels.exitReady:labels.atExit):allCollected?labels.exitReady:labels.explore;
 const state=paused||hidden?'paused':disabled?'disabled':'playing';
 return <section className="maze-arcade" data-state={state} data-motion={motion?'on':'off'} aria-label={labels.title}>
  <div className="maze-context"><span>{labels.original}</span><p lang="en">{game.text}</p><small>{labels.mission}</small></div>
  <div className="maze-console"><strong>{labels.title}</strong><span>{collected.length} / {tokens.length} {labels.count}</span></div>
  <div className="maze-world-wrap">
   <div ref={worldRef} className="maze-world" data-arcade-focus tabIndex="0" role="group" aria-label={labels.world} aria-describedby={id+'-keys'} onKeyDown={onKeyDown} onBlur={stopHold} onPointerDown={()=>worldRef.current?.focus({preventScroll:true})}>
    <svg className="maze-map" viewBox={`0 0 ${board.width*tile} ${board.height*tile}`} aria-hidden="true">
     <defs><pattern id={id+'-floor'} width={tile} height={tile} patternUnits="userSpaceOnUse"><rect width={tile} height={tile} fill="#151a2c"/><path d={`M0 ${tile}V0h${tile}`} fill="none" stroke="#38405a" strokeOpacity=".34"/><circle cx={tile/2} cy={tile/2} r="1.2" fill="#767a9e" fillOpacity=".25"/></pattern></defs>
     <rect width={board.width*tile} height={board.height*tile} fill={`url(#${id}-floor)`}/>
     {board.walls.map(({x,y})=><g className="maze-wall" key={`${x},${y}`}><rect x={x*tile+2} y={y*tile+2} width={tile-4} height={tile-4} rx="7" fill="#33304c"/><path d={`M${x*tile+8} ${y*tile+8}h${tile-16}`} stroke="#6a5f91" strokeWidth="2" strokeLinecap="round"/></g>)}
     <g className={'maze-exit'+(allCollected?' is-ready':'')} transform={`translate(${(board.exit.x+.5)*tile} ${(board.exit.y+.5)*tile})`}><rect x="-19" y="-19" width="38" height="38" rx="10" fill="#183b3a" stroke="#9ce8ca" strokeWidth="2"/><path d="M-8 0H8M2-6l6 6-6 6" stroke="#bbffe4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></g>
     <g className="maze-spawn" transform={`translate(${(board.spawn.x+.5)*tile} ${(board.spawn.y+.5)*tile})`}><circle r="16" fill="none" stroke="#b5a0ff" strokeDasharray="3 4" strokeOpacity=".55"/></g>
     {tokens.map((token,index)=>{
      const taken=collected.includes(token.id),text=token.text.length>7?token.text.slice(0,6)+'…':token.text;
      return <g key={token.id} className={'maze-token'+(taken?' is-collected':'')} data-token-id={token.id} transform={`translate(${(token.x+.5)*tile} ${(token.y+.5)*tile})`}><title>{`${index+1}. ${token.text}`}</title><rect x="-20" y="-13" width="40" height="26" rx="8" fill={taken?'#183e37':'#403250'} stroke={taken?'#7bc9ac':'#c4a8ec'} strokeWidth="1.2"/><text y="3.5" textAnchor="middle" fontSize="9.3" fill={taken?'#8bcbb5':'#f8edff'} fontFamily="inherit">{taken?'✓':text}</text><circle cx="15" cy="-13" r="7.5" fill="#151724" stroke="#8b7ca5" strokeWidth=".7"/><text x="15" y="-10.5" textAnchor="middle" fontSize="7.5" fill="#e9dcff">{index+1}</text></g>;
     })}
     {drone&&<g className="maze-drone" data-x={drone.x} data-y={drone.y} style={{transform:`translate(${(drone.x+.5)*tile}px,${(drone.y+.5)*tile}px)`}}><title>{labels.drone}</title><path d="M-16-5H16M-11-8v6M11-8v6" stroke="#ffac97" strokeWidth="2.5" strokeLinecap="round"/><rect x="-9" y="-4" width="18" height="11" rx="5" fill="#663e48" stroke="#ffac97" strokeWidth="1.4"/><circle cy="1.5" r="2.3" fill="#ffd5ba"/><path d="M-5 10h10" stroke="#ffac97" strokeOpacity=".45"/></g>}
     <g className="maze-actor" data-x={position.x} data-y={position.y} style={{transform:`translate(${(position.x+.5)*tile}px,${(position.y+.5)*tile}px)`}}><title>{labels.you}</title><ellipse cy="15" rx="12" ry="4" fill="#090c18" opacity=".7"/><rect x="-11" y="-4" width="7" height="14" rx="3" fill="#8f80c8"/><path d="M-7 3h14v8q0 5-7 5t-7-5Z" fill="#ddd8f3"/><rect x="-6" y="10" width="4" height="9" rx="2" fill="#b8acd9"/><rect x="2" y="10" width="4" height="9" rx="2" fill="#b8acd9"/><circle cy="-4" r="11" fill="#ece8fa" stroke="#b5a0ff" strokeWidth="1.5"/><path d="M-7-7q7-6 14 0v5q-7 6-14 0Z" fill="#3f5265"/><path d="M-4-7h5" stroke="#a9eed6" strokeWidth="2" strokeLinecap="round"/><circle cx="4" cy="7" r="1.5" fill="#a591e7"/></g>
    </svg>
   </div>
   {(paused||hidden)&&<div className="maze-cover"><strong>{labels.paused}</strong><span>{labels.pausedHint}</span></div>}
  </div>
  <div className="maze-navigation">
   <div className="maze-dpad" role="group" aria-label={labels.keys}>{['up','left','down','right'].map(direction=><button key={direction} type="button" className={'maze-direction maze-'+direction} aria-label={labels[direction]} disabled={!active} onPointerDown={event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);startHold(direction);}} onPointerUp={stopHold} onPointerCancel={stopHold} onLostPointerCapture={stopHold} onClick={event=>{if(event.detail===0)move(direction);}}><Arrow direction={direction}/></button>)}</div>
   <div className="maze-interaction"><button type="button" className="maze-collect" disabled={!active||pending||(!currentWord&&!(atExit&&allCollected))} onClick={()=>void interact()}>{atExit&&allCollected?labels.check:labels.collect}</button><p role="status" aria-live="polite">{status}</p></div>
  </div>
  <div className="maze-inventory-panel"><div className="maze-inventory-heading"><h3>{labels.inventory}</h3><div className="maze-edit-controls"><button type="button" disabled={!active||pending||!collected.length} aria-label={labels.undo} title={labels.undo} onClick={()=>void action('undo')}>↶ <span>{language==='en'?'Undo':'Deshacer'}</span></button><button type="button" disabled={!active||pending||!collected.length} aria-label={labels.reset} onClick={()=>void action('reset')}>{language==='en'?'Reset':'Reiniciar'}</button></div></div>{collected.length?<ol className="maze-inventory">{collected.map((tokenId,index)=>{const token=tokens.find(token=>token.id===tokenId);return <li key={tokenId} data-token-id={tokenId}><span>{index+1}</span><b lang="en">{token?.text||game.wordBank?.find(token=>token.id===tokenId)?.text}</b></li>;})}</ol>:<p className="maze-inventory-empty">{labels.empty}</p>}</div>
  <details className="maze-legend" open><summary>{labels.words}</summary><ul>{tokens.map((token,index)=><li key={token.id} className={collected.includes(token.id)?'is-collected':''}><span>{index+1}</span><b lang="en">{token.text}</b>{collected.includes(token.id)&&<i aria-hidden="true">✓</i>}</li>)}</ul></details>
  <footer className="maze-footer"><span id={id+'-keys'}>{labels.keys}</span><span>{labels.safe}</span><span className="maze-exit-key"><i aria-hidden="true">→</i>{labels.exit}</span></footer>
 </section>;
}
