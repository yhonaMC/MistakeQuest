import React,{useEffect,useRef,useState} from 'react';

export default function OrbitScene({state='ready',eventId=0,motion=true}){
  const container=useRef(null),runtime=useRef(null),options=useRef({state,eventId,motion}),[renderer,setRenderer]=useState('fallback');
  options.current={state,eventId,motion};
  useEffect(()=>{
    let disposed=false,cleanup;
    import('./orbit-scene.js').then(({mountOrbit})=>{
      if(disposed)return;
      try{const scene=mountOrbit(container.current,()=>options.current,()=>{if(!disposed)setRenderer('three');},()=>{if(!disposed)setRenderer('fallback');});runtime.current=scene;cleanup=()=>scene.dispose();}
      catch{setRenderer('fallback');}
    }).catch(()=>{if(!disposed)setRenderer('fallback');});
    return()=>{disposed=true;cleanup?.();runtime.current=null;};
  },[]);
  useEffect(()=>{runtime.current?.update();},[state,eventId,motion]);
  return <div className="orbit-scene" data-renderer={renderer} data-state={state} ref={container} aria-hidden="true"><img className="orbit-fallback" src="/assets/mistakequest-favicon.svg" alt="" hidden={renderer==='three'}/></div>;
}
