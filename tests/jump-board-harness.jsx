import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LanguageProvider,useI18n} from '../web/i18n.js';
import JumpArcade from '../web/JumpArcade.jsx';
import '../web/styles.css';

const initial={id:'jump-synthetic',text:'Every morning my sister walk to the library.',target:{offset:24,length:4,text:'walk'},options:[{id:0,text:'walk'},{id:1,text:'walks'}],adventure:{step:0,total:3,movementMistakes:0},progress:{current:0,total:3}};
function Fixture(){
 const {setLanguage}=useI18n(),outcome=useRef(false);
 const [game,setGame]=useState(initial),[revision,setRevision]=useState(0),[motion,setMotion]=useState(true),[paused,setPaused]=useState(false),[disabled,setDisabled]=useState(false),[answers,setAnswers]=useState([]),[actions,setActions]=useState([]);
 useEffect(()=>{window.jumpHarness={initial,setGame,setMotion,setPaused,setDisabled,setLanguage,setOutcome:value=>{outcome.current=value;},remount:()=>setRevision(value=>value+1)};},[]);
 return <main data-revision={revision} style={{maxWidth:1000,margin:'24px auto',padding:12}}><div style={{display:'flex',gap:8,marginBottom:12}}><button onClick={()=>setPaused(value=>!value)}>Toggle fixture pause</button></div><JumpArcade key={revision} game={game} motion={motion} paused={paused} disabled={disabled} onAnswer={async payload=>{setAnswers(previous=>[...previous,payload]);await new Promise(resolve=>setTimeout(resolve,120));return outcome.current===undefined?undefined:{correct:outcome.current};}} onAction={async payload=>{setActions(previous=>[...previous,payload]);return{game};}}/><output id="answers">{JSON.stringify(answers)}</output><output id="actions">{JSON.stringify(actions)}</output></main>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><LanguageProvider><Fixture/></LanguageProvider></React.StrictMode>);
