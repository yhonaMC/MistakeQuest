import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LanguageProvider,useI18n} from '../web/i18n.js';
import MazeArcade from '../web/MazeArcade.jsx';
import {nextMazeCell} from '../web/maze-utils.js';
import '../web/styles.css';

// Isolated synthetic public game. This fixture never calls the service or local AI.
const board={width:7,height:5,walls:[...Array.from({length:7},(_,x)=>[{x,y:0},{x,y:4}]).flat(),...[1,2,3].flatMap(y=>[{x:0,y},{x:6,y}]),{x:3,y:1},{x:3,y:2}],spawn:{x:1,y:1},exit:{x:5,y:1},tokens:[{id:'a',text:'I',x:2,y:1},{id:'b',text:'think',x:1,y:3},{id:'c',text:'I',x:4,y:3},{id:'d',text:'can.',x:5,y:2}]};
const initial={id:'synthetic-maze',text:'I thinks I can.',wordBank:board.tokens.map(({id,text})=>({id,text})),board,adventure:{step:0,total:3,movementMistakes:0,position:board.spawn,collected:[]},progress:{current:0,total:3}};
function Fixture(){
 const {setLanguage}=useI18n();
 const [game,setGame]=useState(initial),[disabled,setDisabled]=useState(false),[paused,setPaused]=useState(false),[motion,setMotion]=useState(true),[actions,setActions]=useState([]),[answers,setAnswers]=useState([]),[wrong,setWrong]=useState(false);
 const current=useRef(initial),delay=useRef(35),inflight=useRef(0),maximum=useRef(0);
 const publish=next=>{current.current=next;setGame(next);};
 useEffect(()=>{window.mazeHarness={initial,setDisabled,setPaused,setMotion,setLanguage,setDelay:value=>delay.current=value,setGame:publish,snapshot:()=>({game:current.current,maximum:maximum.current}),reset:()=>{publish(structuredClone(initial));setWrong(false);setActions([]);setAnswers([]);maximum.current=0;}};},[]);
 async function onAction(action){
  inflight.current++;maximum.current=Math.max(maximum.current,inflight.current);
  setActions(previous=>[...previous,action]);
  await new Promise(resolve=>setTimeout(resolve,delay.current));
  const next=structuredClone(current.current),state=next.adventure;
  if(action.type==='move')state.position=nextMazeCell(next.board,state.position,action.direction)||state.position;
  if(action.type==='collect'){
   const token=next.board.tokens.find(token=>token.x===state.position.x&&token.y===state.position.y&&!state.collected.includes(token.id));
   if(token)state.collected.push(token.id);
  }
  if(action.type==='undo')state.collected.pop();
  if(action.type==='reset')state.collected=[];
  if(action.type==='collision'){state.position=next.board.spawn;state.movementMistakes++;}
  publish(next);inflight.current--;return {game:next};
 }
 async function onAnswer(payload){setAnswers(previous=>[...previous,payload]);setWrong(true);return {correct:false,game:current.current};}
 return <main style={{maxWidth:1050,margin:'24px auto',padding:12}}><MazeArcade game={game} disabled={disabled} paused={paused} motion={motion} onAction={onAction} onAnswer={onAnswer}/>{wrong&&<p role="status">Fixture: incorrect sentence. Undo or reset remains available.</p>}<output id="maze-fixture-log" style={{display:'none'}}>{JSON.stringify({actions,answers})}</output></main>;
}
createRoot(document.getElementById('root')).render(<LanguageProvider><Fixture/></LanguageProvider>);
