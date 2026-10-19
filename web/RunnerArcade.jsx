import React,{useCallback,useEffect,useId,useRef,useState} from 'react';
import {useI18n} from './i18n.js';
import './runner-arcade.css';

const RUN_DURATION_MS=5000;

const COPY={
 es:{title:'Dos caminos',round:'Ronda {round} de {total}',instruction:'Cambia de carril y cruza la puerta con la opción que encaja.',start:'Iniciar recorrido',pause:'Pausar',resume:'Continuar recorrido',cross:'Cruzar puerta',left:'Izquierda',right:'Derecha',leftControl:'Cambiar al carril izquierdo',rightControl:'Cambiar al carril derecho',ready:'Tu recorrido empieza cuando tú quieras.',running:'Elige tu carril. También puedes cruzar con Espacio.',paused:'Recorrido en pausa.',choose:'Las puertas te esperan. Elige un carril y cruza.',static:'Elige un carril y cruza cuando estés listo.',waiting:'Comprobando tu elección…',success:'Puerta cruzada.',selected:'Carril elegido: {option}',none:'Todavía no has elegido un carril.',keyboard:'← → o A / D para cambiar · Espacio para cruzar',field:'Pista de dos carriles',distance:'Avance hasta las puertas',target:'El fragmento marcado necesita un cambio.',noOptions:'Preparando las dos puertas…'},
 en:{title:'Two paths',round:'Round {round} of {total}',instruction:'Change lanes and cross the gate with the option that fits.',start:'Start run',pause:'Pause',resume:'Resume run',cross:'Cross gate',left:'Left',right:'Right',leftControl:'Move to the left lane',rightControl:'Move to the right lane',ready:'Your run starts when you are ready.',running:'Choose your lane. You can also cross with Space.',paused:'Run paused.',choose:'The gates will wait. Choose a lane and cross.',static:'Choose a lane and cross when you are ready.',waiting:'Checking your choice…',success:'Gate crossed.',selected:'Selected lane: {option}',none:'You have not selected a lane yet.',keyboard:'← → or A / D to move · Space to cross',field:'Two-lane track',distance:'Progress to the gates',target:'The highlighted part needs a change.',noOptions:'Preparing both gates…'}
};

function Vehicle(){
 return <svg viewBox="0 0 76 106" aria-hidden="true"><path className="runner-vehicle-shadow" d="M14 84 38 101 62 84 54 44 22 44Z"/><g className="runner-vehicle-exhaust"><path className="runner-vehicle-thrust" d="M31 87Q22 112 38 145Q54 112 45 87Z"/><path className="runner-vehicle-core" d="M34 88Q31 108 38 128Q45 108 42 88Z"/><path className="runner-vehicle-wake" d="m20 89-5 49m41-49 5 49"/><path className="runner-vehicle-wake" d="m29 101-4 43m22-43 4 43"/></g><path className="runner-vehicle-wing" d="m32 32-21 38 3 14 20-12h8l20 12 3-14-21-38Z"/><path className="runner-vehicle-body" d="M38 5c-7 9-15 25-15 42v31l15 11 15-11V47c0-17-8-33-15-42Z"/><path className="runner-vehicle-glass" d="M38 20c-4 6-8 14-8 23l8 7 8-7c0-9-4-17-8-23Z"/><path className="runner-vehicle-line" d="M38 57v22M24 75l-8 5m36-5 8 5"/></svg>;
}

function Track({progress,running}){
 const stripes=Array.from({length:10},(_,index)=>{
  const depth=(index/10+progress*3.2)%1;
  return {y:89+depth*depth*411,width:1+depth*3,height:3+depth*25};
 });
 return <svg className="runner-track" viewBox="0 0 800 500" preserveAspectRatio="none" aria-hidden="true" data-running={running}>
  <path className="runner-track-floor" d="M327 87H473L798 500H2Z"/>
  <path className="runner-track-lane" d="M400 87H473L798 500H400Z"/>
  <path className="runner-track-rail" d="M327 87 2 500M473 87l325 413"/>
  <path className="runner-track-inner" d="M344 87 68 500M456 87l276 413"/>
  {stripes.map((stripe,index)=><rect key={index} className="runner-track-stripe" x={400-stripe.width/2} y={stripe.y} width={stripe.width} height={stripe.height} rx="1"/>)}
  {progress>0&&Array.from({length:12},(_,index)=>{
   const depth=(index/12+progress*2.8)%1,side=index%2?-1:1,x=400+side*(70+depth*260),y=89+depth*depth*411;
   return <path key={'wind-'+index} className="runner-track-wind" d={`M${x} ${y}l${side*(3+depth*9)} ${5+depth*30}`} opacity={.12+depth*.22}/>;
  })}
  {[.12,.35,.58,.81].map((offset,index)=>{
   const depth=(offset+progress*1.1)%1,y=89+depth*depth*411,x=327-(y-87)*325/413;
   return <g key={index} className="runner-track-beacon" opacity={.35+depth*.65}><path d={`M${x-7},${y}v${-7-depth*17}M${800-x+7},${y}v${-7-depth*17}`} strokeWidth={2+depth*3}/></g>;
  })}
 </svg>;
}

export default function RunnerArcade(props){
 const session=useRef({started:false,paused:false});
 if(props.continuous)return <ContinuousRunner {...props}/>;
 // Fresh round input; the explicit start and pause choices last for the session.
 return <RunnerRound key={`${props.game.id}:${props.round||1}`} {...props} session={session}/>;
}

const CONTINUOUS_COPY={
 es:{gate:'Puerta {round}',instruction:'Elige un carril antes de que lleguen las puertas.',preparing:'Llegan nuevas puertas…',missed:'Las dos puertas quedaron atrás.',wrong:'Sigue volando. Llegan otras puertas.',static:'Elige un carril antes de que termine el tiempo.',seconds:'{seconds} s'},
 en:{gate:'Gate {round}',instruction:'Choose a lane before the gates arrive.',preparing:'New gates are on their way…',missed:'Both gates went past.',wrong:'Keep flying. More gates are coming.',static:'Choose a lane before time runs out.',seconds:'{seconds} s'}
};

function ContinuousRunner({game,onAnswer,onTimeout,onPauseChange,preparing=false,disabled=false,feedback=null,motion=true,round=1,finished=false,autoStart=false,durationMs=5000}){
 const {language}=useI18n(),code=language==='en'?'en':'es',copy={...COPY[code],...CONTINUOUS_COPY[code]};
 const text=(key,values={})=>copy[key].replace(/\{(\w+)\}/g,(_,name)=>String(values[name]??''));
 const instructionId=useId(),selectionId=useId(),promptId=useId(),fieldRef=useRef(null);
 const clockRef=useRef(0),progressRef=useRef(0),selectedRef=useRef(null),submittedRef=useRef(false),pausedRef=useRef(document.hidden),notifiedPause=useRef(null),inputRef=useRef({});
 const [clock,setClock]=useState(0),[progress,setProgress]=useState(0),[lane,setLane]=useState(null),[started,setStarted]=useState(autoStart),[paused,setPaused]=useState(document.hidden),[submitted,setSubmitted]=useState(false);
 const deadline=Math.max(3000,Math.min(15000,Number(durationMs)||5000));
 const options=(game.options||[]).slice(0,2);
 inputRef.current={options,onAnswer,onTimeout,onPauseChange,disabled,preparing};

 const changePause=useCallback(value=>{
  pausedRef.current=value;setPaused(value);
  if(notifiedPause.current!==value){notifiedPause.current=value;inputRef.current.onPauseChange?.(value);}
 },[]);

 useEffect(()=>{
  if(notifiedPause.current===null){notifiedPause.current=pausedRef.current;inputRef.current.onPauseChange?.(pausedRef.current);}
  const visibility=()=>{if(document.hidden)changePause(true);};
  document.addEventListener('visibilitychange',visibility);
  return()=>document.removeEventListener('visibilitychange',visibility);
 },[changePause]);

 useEffect(()=>{
  // Only the doors reset. The rocket, its flight clock, and pause state persist.
  submittedRef.current=false;selectedRef.current=null;progressRef.current=0;
  setSubmitted(false);setLane(null);setProgress(0);
 },[game.id]);

 const finish=useCallback(timedOut=>{
  const current=inputRef.current,selected=selectedRef.current;
  if(current.disabled||current.preparing||pausedRef.current||submittedRef.current)return;
  if(selected===null&&!timedOut)return;
  submittedRef.current=true;progressRef.current=1;setSubmitted(true);setProgress(1);
  if(selected===null)current.onTimeout?.({timedOut:true});
  else current.onAnswer({answer:String(current.options[selected].id)});
 },[]);

 useEffect(()=>{
  if(!started||paused||finished)return;
  let frame,lastTime=null,lastPaint=0;
  const tick=now=>{
   if(document.hidden){changePause(true);return;}
   const elapsed=lastTime===null?0:Math.min(now-lastTime,80);lastTime=now;
   clockRef.current+=elapsed;
   const current=inputRef.current;
   if(!submittedRef.current&&!current.disabled&&!current.preparing){
    progressRef.current=Math.min(1,progressRef.current+elapsed/deadline);
    if(progressRef.current===1)finish(true);
   }
   if(now-lastPaint>=32){setClock(clockRef.current);setProgress(progressRef.current);lastPaint=now;}
   frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
  return()=>cancelAnimationFrame(frame);
 },[started,paused,finished,deadline,changePause,finish]);

 const locked=disabled||preparing||submitted||paused||finished;
 const chooseLane=next=>{
  if(locked||!options[next])return;
  selectedRef.current=next;setLane(next);fieldRef.current?.focus({preventScroll:true});
 };
 const start=()=>{
  if(disabled||preparing||options.length<2)return;
  changePause(false);setStarted(true);fieldRef.current?.focus({preventScroll:true});
 };
 const togglePause=()=>{changePause(!pausedRef.current);fieldRef.current?.focus({preventScroll:true});};
 const handleKey=event=>{
  if(event.altKey||event.ctrlKey||event.metaKey||event.repeat)return;
  const key=event.key.toLowerCase();
  if(key==='escape'&&started){event.preventDefault();changePause(true);return;}
  if(event.target.closest('.runner-pause'))return;
  if(paused&&(key===' '||key==='enter')){event.preventDefault();changePause(false);return;}
  if(locked)return;
  if(['arrowleft','arrowright','a','d'].includes(key)){
   event.preventDefault();chooseLane(key==='arrowleft'||key==='a'?0:1);return;
  }
  if(event.target.closest('button'))return;
  if(key===' '||key==='enter'){
   event.preventDefault();if(!started)start();else finish(false);
  }
 };

 const phase=!started?'ready':paused?'paused':submitted||preparing?'waiting':'running';
 const missed=feedback?.outcome==='missed'||feedback?.timedOut===true,wrong=Boolean(feedback)&&feedback.correct===false&&!missed;
 const status=phase==='ready'?'ready':paused?'paused':missed?'missed':feedback?.correct?'success':wrong?'wrong':preparing?'preparing':submitted?'waiting':motion?'running':'static';
 const visualClock=motion?clock:0,cruise=1-Math.exp(-visualClock/900),float=Math.sin(visualClock/310)*2.5+Math.sin(visualClock/960)*3.5;
 const gateProgress=motion?progress:.48,trackProgress=visualClock/RUN_DURATION_MS;
 const target=game.target,offset=Math.max(0,Math.min(game.text.length,Number(target?.offset)||0)),length=Math.max(0,Number(target?.length)||0);

 return <section className="runner-arcade" data-continuous="true" data-phase={phase} data-game-id={game.id} data-clock={Math.floor(clock)} data-motion={motion?'on':'off'} data-preparing={preparing} onKeyDown={handleKey} aria-label={text('title')}>
  <div className="runner-prompt">
   <p className="runner-round">{text('gate',{round})}</p>
   <p className="runner-sentence" id={promptId} lang="en">{game.text.slice(0,offset)}<mark title={text('target')}>{game.text.slice(offset,offset+length)}</mark>{game.text.slice(offset+length)}</p>
   <p className="runner-instruction" id={instructionId}>{text('instruction')}</p>
  </div>
  <div className="runner-playfield" ref={fieldRef} tabIndex="0" role="group" aria-label={text('field')} aria-describedby={`${promptId} ${instructionId} ${selectionId}`}>
   <div className="runner-horizon" aria-hidden="true"><i/><span/><i/></div>
   <div className="runner-course-status" aria-live="polite"><span className="runner-status-light"/>{text(status)}</div>
   {started&&!submitted&&!preparing&&!finished&&<span className="runner-countdown">{text('seconds',{seconds:Math.max(0,Math.ceil((1-progress)*deadline/1000))})}</span>}
   <Track progress={trackProgress} running={started&&!paused&&!finished&&motion}/>
   <div className="runner-gates runner-continuous-gates" key={game.id} style={{'--gate-y':`${11+gateProgress*26}%`,'--gate-width':`${78+gateProgress*16}%`}}>
    {options.map((option,index)=>{
     const result=missed?' is-missed':lane===index&&wrong?' is-wrong':lane===index&&feedback?.correct?' is-correct':'';
     return <button type="button" key={option.id} className={'runner-gate'+(lane===index?' is-selected':'')+result} data-option-id={option.id} data-lane={index} disabled={locked} aria-pressed={lane===index} aria-label={option.text} onClick={()=>chooseLane(index)}>
      <span className="runner-gate-sign" lang="en">{option.text}</span><span className="runner-gate-entry" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 13 6-6 6 6M12 7v13"/></svg></span><span className="runner-gate-foot" aria-hidden="true"/>
     </button>;
    })}
   </div>
   <div className="runner-player" data-lane={lane===null?'none':lane} data-powered={started&&motion} style={{'--player-x':lane===null?'50%':lane===0?'28%':'72%','--player-rise':`${cruise*65+float}px`,'--player-scale':1-cruise*.12+Math.sin(visualClock/820)*.008,'--wake-shift':`${-visualClock*.09}px`,'--engine-flare':.85+Math.sin(visualClock/65)*.15}} aria-hidden="true"><Vehicle/></div>
   <div className="runner-track-finish" aria-hidden="true"/>
   {paused&&started&&<div className="runner-pause-shade" aria-hidden="true"><svg viewBox="0 0 40 40"><path d="M12 8v24M28 8v24"/></svg></div>}
   <div className="runner-distance" role="progressbar" aria-label={text('distance')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress*100)}><span style={{width:`${motion?progress*100:0}%`}}/></div>
  </div>
  <div className="runner-dock">
   <div className="runner-steering" role="group" aria-label={text('field')}>
    <button type="button" className={lane===0?'is-selected':''} aria-label={text('leftControl')} aria-pressed={lane===0} disabled={locked||options.length<2} onClick={()=>chooseLane(0)}><span aria-hidden="true">←</span><span>{text('left')}</span><kbd>A</kbd></button>
    <button type="button" className={lane===1?'is-selected':''} aria-label={text('rightControl')} aria-pressed={lane===1} disabled={locked||options.length<2} onClick={()=>chooseLane(1)}><span>{text('right')}</span><kbd>D</kbd><span aria-hidden="true">→</span></button>
   </div>
   <div className="runner-drive-actions">
    {!started?<button type="button" className="runner-go" disabled={disabled||preparing||options.length<2} onClick={start}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 3 10 7-10 7Z"/></svg>{text('start')}</button>:<><button type="button" className="runner-go" disabled={locked||lane===null} onClick={()=>finish(false)}>{text('cross')}<span aria-hidden="true">↵</span></button><button type="button" className="runner-pause" onClick={togglePause}>{paused?text('resume'):text('pause')}</button></>}
   </div>
   <p className="runner-selection" id={selectionId} role="status">{lane===null?text('none'):text('selected',{option:options[lane]?.text||''})}</p>
   <p className="runner-keyboard" aria-hidden="true">{text('keyboard')}</p>
  </div>
 </section>;
}

function RunnerRound({game,onAnswer,disabled=false,feedback=null,motion=true,round=1,totalRounds=3,session}){
 const {language}=useI18n(),copy=COPY[language==='en'?'en':'es'];
 const text=(key,values={})=>copy[key].replace(/\{(\w+)\}/g,(_,name)=>String(values[name]??''));
 const instructionId=useId(),selectionId=useId(),promptId=useId();
 const fieldRef=useRef(null),selectedRef=useRef(null),progressRef=useRef(0),exitRef=useRef(0),submittedRef=useRef(false),disabledRef=useRef(disabled),previousDisabled=useRef(disabled),callbackRef=useRef(onAnswer);
 const [lane,setLane]=useState(null),[progress,setProgress]=useState(0),[exitProgress,setExitProgress]=useState(0),[visible,setVisible]=useState(()=>!document.hidden),[phase,setPhase]=useState(()=>!session.current.started?'ready':session.current.paused?'paused':motion?'running':'choosing');
 const options=(game.options||[]).slice(0,2),locked=disabled||phase==='waiting'||feedback?.correct===true;
 disabledRef.current=disabled;callbackRef.current=onAnswer;

 const chooseLane=useCallback(next=>{
  if(disabledRef.current||submittedRef.current||!options[next])return;
  selectedRef.current=next;setLane(next);
 },[options[0]?.id,options[1]?.id]);

 const cross=useCallback(()=>{
  const selected=selectedRef.current;
  if(disabledRef.current||submittedRef.current||selected===null||!options[selected])return;
  submittedRef.current=true;
  progressRef.current=1;setProgress(1);setPhase('waiting');
  callbackRef.current({answer:String(options[selected].id)});
 },[options[0]?.id,options[1]?.id]);

 useEffect(()=>{
  if(feedback?.correct!==false||!submittedRef.current)return;
  submittedRef.current=false;selectedRef.current=null;progressRef.current=0;exitRef.current=0;
  setLane(null);setProgress(0);setExitProgress(0);setPhase('ready');
 },[feedback]);

 useEffect(()=>{
  // A failed request can unlock the round without an answer-result object.
  if(previousDisabled.current&&!disabled&&submittedRef.current&&!feedback?.correct){
   submittedRef.current=false;selectedRef.current=null;progressRef.current=0;exitRef.current=0;
   setLane(null);setProgress(0);setExitProgress(0);setPhase('ready');
  }
  previousDisabled.current=disabled;
 },[disabled,feedback]);

 useEffect(()=>{
  const pauseWhenHidden=()=>{setVisible(!document.hidden);if(document.hidden)setPhase(current=>{if(current==='running'||current==='choosing'){session.current.paused=true;return 'paused';}return current;});};
  document.addEventListener('visibilitychange',pauseWhenHidden);
  pauseWhenHidden();
  return()=>document.removeEventListener('visibilitychange',pauseWhenHidden);
 },[]);

 useEffect(()=>{
  if(phase!=='running'||!motion||disabled)return;
  let frame,lastTime=null,lastPaint=0;
  const tick=now=>{
   if(document.hidden){session.current.paused=true;setPhase('paused');return;}
   const elapsed=lastTime===null?0:Math.min(now-lastTime,80);lastTime=now;
   progressRef.current=Math.min(1,progressRef.current+elapsed/RUN_DURATION_MS);
   if(now-lastPaint>=32||progressRef.current===1){setProgress(progressRef.current);lastPaint=now;}
   if(progressRef.current===1){
    if(selectedRef.current===null)setPhase('choosing');
    else cross();
    return;
   }
   frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
  return()=>cancelAnimationFrame(frame);
 },[phase,motion,disabled,cross]);

 useEffect(()=>{
  // Crossing is a visual response to input; only the server judges the answer.
  if(phase!=='waiting'||!motion||!visible||exitRef.current===1)return;
  let frame,lastTime=null;
  const depart=now=>{
   if(document.hidden)return;
   const elapsed=lastTime===null?0:Math.min(now-lastTime,80);lastTime=now;
   exitRef.current=Math.min(1,exitRef.current+elapsed/620);setExitProgress(exitRef.current);
   if(exitRef.current<1)frame=requestAnimationFrame(depart);
  };
  frame=requestAnimationFrame(depart);
  return()=>cancelAnimationFrame(frame);
 },[phase,motion,visible]);

 const start=()=>{
  if(locked)return;
  session.current.started=true;session.current.paused=false;
  setPhase(motion?'running':'choosing');
  fieldRef.current?.focus({preventScroll:true});
 };
 const pause=()=>{
  setPhase(current=>{session.current.paused=current!=='paused';return current==='paused'?(motion?'running':'choosing'):'paused';});
  fieldRef.current?.focus({preventScroll:true});
 };
 const handleKey=event=>{
  if(event.altKey||event.ctrlKey||event.metaKey||event.repeat||locked)return;
  const key=event.key.toLowerCase();
  if(['arrowleft','arrowright','a','d'].includes(key)){
   event.preventDefault();chooseLane(key==='arrowleft'||key==='a'?0:1);fieldRef.current?.focus({preventScroll:true});return;
  }
  // Let the native buttons keep their Enter / Space action when focused.
  if(event.target.closest('button'))return;
  if(key===' '||key==='enter'){
   event.preventDefault();
   if(phase==='ready'||phase==='paused')start();
   else if(phase==='running'||phase==='choosing')cross();
  }else if(key==='escape'&&(phase==='running'||phase==='choosing')){
   event.preventDefault();session.current.paused=true;setPhase('paused');
  }
 };
 const focusLane=next=>{chooseLane(next);fieldRef.current?.focus({preventScroll:true});};
 const status=feedback?.correct?'success':phase==='running'&&!motion?'static':phase==='choosing'&&!motion?'static':phase==='choosing'?'choose':phase;
 const active=phase==='running'||phase==='choosing',gateProgress=motion?progress:.48;
 const flightProgress=motion?progress*.7+progress*progress*.3:0;
 const departure=motion?exitProgress:0,powered=motion&&(phase==='running'&&!disabled||phase==='paused'&&progress>0||phase==='waiting'&&exitProgress<1);
 const target=game.target,offset=Math.max(0,Math.min(game.text.length,Number(target?.offset)||0)),length=Math.max(0,Number(target?.length)||0);

 return <section className="runner-arcade" data-phase={phase} data-motion={motion?'on':'off'} onKeyDown={handleKey} aria-label={text('title')}>
  <div className="runner-prompt">
   <p className="runner-round">{text('round',{round,total:totalRounds})}</p>
   <p className="runner-sentence" id={promptId} lang="en">{game.text.slice(0,offset)}<mark title={text('target')}>{game.text.slice(offset,offset+length)}</mark>{game.text.slice(offset+length)}</p>
   <p className="runner-instruction" id={instructionId}>{text('instruction')}</p>
  </div>
  <div className="runner-playfield" ref={fieldRef} tabIndex="0" role="group" aria-label={text('field')} aria-describedby={`${promptId} ${instructionId} ${selectionId}`}>
   <div className="runner-horizon" aria-hidden="true"><i/><span/><i/></div>
   <div className="runner-course-status" aria-live="polite"><span className="runner-status-light"/>{text(status)}</div>
   <Track progress={gateProgress} running={phase==='running'&&motion&&!disabled}/>
   <div className="runner-gates" style={{'--gate-y':`${11+gateProgress*26}%`,'--gate-width':`${78+gateProgress*16}%`}}>
    {options.map((option,index)=><button type="button" key={option.id} className={'runner-gate'+(lane===index?' is-selected':'')} data-option-id={option.id} data-lane={index} disabled={locked} aria-pressed={lane===index} aria-label={option.text} onClick={()=>focusLane(index)}>
     <span className="runner-gate-sign" lang="en">{option.text}</span><span className="runner-gate-entry" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 13 6-6 6 6M12 7v13"/></svg></span>
     <span className="runner-gate-foot" aria-hidden="true"/>
    </button>)}
    {options.length<2&&<p className="runner-empty" role="status">{text('noOptions')}</p>}
   </div>
   <div className="runner-player" data-lane={lane===null?'none':lane} data-powered={powered} style={{'--player-x':lane===null?'50%':lane===0?'28%':'72%','--player-rise':`${flightProgress*100+departure*250}px`,'--player-scale':(1-flightProgress*.23)*(1-departure*.25),'--player-opacity':1-Math.max(0,(departure-.4)/.6),'--wake-shift':`${-(flightProgress+departure)*420}px`,'--engine-flare':.85+Math.sin((flightProgress+departure)*185)*.15}} aria-hidden="true"><Vehicle/></div>
   <div className="runner-track-finish" aria-hidden="true"/>
   {phase==='paused'&&<div className="runner-pause-shade" aria-hidden="true"><svg viewBox="0 0 40 40"><path d="M12 8v24M28 8v24"/></svg></div>}
   <div className="runner-distance" role="progressbar" aria-label={text('distance')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress*100)}><span style={{width:`${progress*100}%`}}/></div>
  </div>
  <div className="runner-dock">
   <div className="runner-steering" role="group" aria-label={text('field')}>
    <button type="button" className={lane===0?'is-selected':''} aria-label={text('leftControl')} aria-pressed={lane===0} disabled={locked||options.length<2} onClick={()=>focusLane(0)}><span aria-hidden="true">←</span><span>{text('left')}</span><kbd>A</kbd></button>
    <button type="button" className={lane===1?'is-selected':''} aria-label={text('rightControl')} aria-pressed={lane===1} disabled={locked||options.length<2} onClick={()=>focusLane(1)}><span>{text('right')}</span><kbd>D</kbd><span aria-hidden="true">→</span></button>
   </div>
   <div className="runner-drive-actions">
    {phase==='ready'?<button type="button" className="runner-go" disabled={locked||options.length<2} onClick={start}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 3 10 7-10 7Z"/></svg>{text('start')}</button>:<><button type="button" className="runner-go" disabled={locked||lane===null||!active} onClick={cross}>{text('cross')}<span aria-hidden="true">↵</span></button><button type="button" className="runner-pause" disabled={locked} onClick={pause}>{phase==='paused'?text('resume'):text('pause')}</button></>}
   </div>
   <p className="runner-selection" id={selectionId} role="status">{lane===null?text('none'):text('selected',{option:options[lane]?.text||''})}</p>
   <p className="runner-keyboard" aria-hidden="true">{text('keyboard')}</p>
  </div>
 </section>;
}
