import {useI18n} from './i18n.js';
import React from 'react';
import OrbitScene from './OrbitScene.jsx';

export default function OrbitHero({view,title,description,greeting,state,motion,eventId,issue}){
  const {t}=useI18n();
  const celebrate=state==='success',scan=state==='scanning';
  return <section className={'orbit-hero '+(view==='editor'?'hero-editor':'hero-compact')} aria-labelledby="page-title">
    <div className="hero-copy"><p className="hero-greeting">{greeting}</p><h1 id="page-title">{title}</h1><p className="hero-description">{description}</p></div>
    <div className="orbit-stage"><OrbitScene {...{state,motion,eventId}}/>{view==='editor'&&<><span className="orbit-float">{scan?t('Revisando tu texto…'):t('Una idea empieza aquí.')}</span><span className="orbit-float second">{scan?t('En tu PC.'):t('Pequeños cambios. Buen avance.')}</span></>}<span className="scene-caption"><i/>{scan?t('Tu IA local está revisando.'):celebrate?t('Lo que está bien, se queda.'):issue?t('Un error es una pista.'):motion?t('Mueve el cursor. Dale un giro.'):t('A tu ritmo, también sin movimiento.')}</span></div>
  </section>;
}
