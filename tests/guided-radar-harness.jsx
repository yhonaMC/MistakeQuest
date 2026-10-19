import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LanguageProvider,useI18n} from '../web/i18n.js';
import GuidedRadarSession from '../web/GuidedRadarSession.jsx';
import '../web/styles.css';

const text='My sister walk to the library daily.';
const game={id:'guided-1',mode:'radar',guided:true,label:'Concordancia',name:'Radar de errores',text,tokens:text.split(' ').map((text,id)=>({id,text})),attemptsRemaining:3,misses:0,discardedTokenIds:[]};
const practiceRound={id:'round-fixture',mode:'radar',total:3,completedCount:0,complete:false,stats:{correct:0,wrong:0,missed:0,assisted:0,exhausted:0},xpEarned:0,mix:{},game};
function Fixture(){
 const {setLanguage}=useI18n();
 const [progress,setProgress]=useState(0),[again,setAgain]=useState(0);
 useEffect(()=>{window.guidedRadarHarness={setLanguage};},[]);
 return <main style={{maxWidth:1100,margin:'24px auto',padding:20}}><GuidedRadarSession game={{...game,practiceRound}} issueId="issue-fixture" motion={false} onProgress={()=>setProgress(value=>value+1)} onAgain={()=>setAgain(value=>value+1)}/><output id="guided-events">{JSON.stringify({progress,again})}</output></main>;
}
createRoot(document.getElementById('root')).render(<LanguageProvider><Fixture/></LanguageProvider>);
