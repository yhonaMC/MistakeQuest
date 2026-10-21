import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LanguageProvider} from '../web/i18n.js';
import GameArena from '../web/GameArena.jsx';
import '../web/styles.css';

function Fixture(){
 const [progress,setProgress]=useState(0);
 return <main style={{maxWidth:1100,margin:'24px auto',padding:20}}><GameArena game={window.classicGameFixture} motion={false} onProgress={()=>setProgress(value=>value+1)}/><output id="classic-events">{JSON.stringify({progress})}</output></main>;
}
createRoot(document.getElementById('root')).render(<LanguageProvider><Fixture/></LanguageProvider>);
