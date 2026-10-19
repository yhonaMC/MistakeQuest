import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LanguageProvider,useI18n} from '../web/i18n.js';
import RadarArcade from '../web/RadarArcade.jsx';
import '../web/styles.css';

const text='Every morning my sister walk to the library with her friends before they go to their daily English class together.';
const initial={id:'radar-fixture',text,tokens:text.split(' ').map((text,id)=>({id,text})),progress:{current:0,total:3}};
function Fixture(){
 const {setLanguage}=useI18n();
 const [game,setGame]=useState(initial),[motion,setMotion]=useState(true),[disabled,setDisabled]=useState(false),[feedback,setFeedback]=useState(null),[answers,setAnswers]=useState([]);
 useEffect(()=>{window.radarHarness={setGame,setMotion,setDisabled,setFeedback,setLanguage,initial};},[]);
 return <main style={{maxWidth:1050,margin:'24px auto',padding:12}}><RadarArcade game={game} motion={motion} disabled={disabled} feedback={feedback} onAnswer={payload=>setAnswers(previous=>[...previous,payload])}/><output id="answers">{JSON.stringify(answers)}</output></main>;
}
createRoot(document.getElementById('root')).render(<LanguageProvider><Fixture/></LanguageProvider>);
