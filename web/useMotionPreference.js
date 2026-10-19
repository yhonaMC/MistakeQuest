import {useEffect,useState} from 'react';

const key='mistakequest.orbit.motion';
function saved(){try{return localStorage.getItem(key);}catch{return null;}}
export default function useMotionPreference(){
  const [enabled,setEnabled]=useState(()=>saved()==='on'||saved()!=='off'&&!matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>{if(saved()===null)setEnabled(!media.matches);};media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  function update(value){setEnabled(value);try{localStorage.setItem(key,value?'on':'off');}catch{/* Appearance remains usable when storage is unavailable. */}}
  return [enabled,update];
}
