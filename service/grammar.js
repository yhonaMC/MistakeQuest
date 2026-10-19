export function classifyEdit(edit,matches=[]){
  const before=edit.original.toLowerCase().replace(/[’‘]/g,"'"),after=edit.replacement.toLowerCase().replace(/[’‘]/g,"'");
  const related=matches.filter(match=>match.offset<edit.offset+edit.length&&edit.offset<match.offset+match.length);
  const ids=related.map(match=>match.rule.id).join(' ');
  let category=edit.category,explanation=edit.explanation;
  if(edit.original!==edit.replacement&&edit.original.toLowerCase()===edit.replacement.toLowerCase()){category='capitalization';explanation='Corrige el uso de mayúsculas, sin cambiar la palabra.';}
  else if(/\bam needing\b/.test(before)&&/\bneed\b/.test(after)){category='verb_form';explanation='Para expresar una necesidad habitual, usa “need”; antes de otro verbo se necesita “to”.';}
  else if(['verb_tense','verb_form','agreement'].includes(edit.category)&&after.replace(/[.!?,]+$/,'')===before.replace(/[.!?,]+$/,'')+'s'){category='agreement';explanation='Con un sujeto singular en tercera persona, el verbo en presente lleva “s”.';}
  else if(/MD_BASEFORM/.test(ids)||/\b(can|could|must|should|may|might)\s+\w+/.test(edit.sentence)&&before.replace(/s$/,'')===after){category='verb_form';explanation='Después de un verbo modal como “can”, el verbo va en su forma base.';}
  else if(/HE_VERB_AGR|CD_NN|HAD_TWO|PLURAL/.test(ids)||[['have','has'],['has','have'],["don't","doesn't"],["don't",'does not'],['was','were'],['were','was'],['is','are'],['are','is'],['do','does']].some(pair=>pair[0]===before&&pair[1]===after)){
    category='agreement';
    if(before==='have'&&after==='has')explanation='Con un sujeto en tercera persona singular, “have” cambia a “has”.';
    else if(before==="don't"&&["doesn't",'does not'].includes(after))explanation='Con “he”, “she” e “it”, la negación en presente usa “doesn’t” o “does not”.';
    else if(/CD_NN|HAD_TWO/.test(ids)&&after===before+'s')explanation='Después de un número mayor que uno, el sustantivo va en plural.';
    else if(before==='was'&&after==='were')explanation='Con “we” y “they”, el pasado de “be” es “were”.';
  }
  else if(/EN_A_VS_AN/.test(ids)||['a','an'].includes(before)&&['a','an'].includes(after)){category='articles';explanation='El artículo depende del sonido inicial: “an” antes de un sonido vocálico y “a” antes de uno consonántico.';}
  else if(before==='go'&&after==='went'){category='verb_tense';explanation='Para una acción terminada en el pasado, “go” cambia a “went”.';}
  else if(/MORFOLOGIK|SPELLING/.test(ids)&&edit.category==='spelling'&&!edit.foreignLanguage){explanation=`En este contexto, «${edit.original}» se escribe «${edit.replacement}».`;}
  return {...edit,category,explanation};
}
export function groundedTense(edit,matches=[]){
  if(edit.category!=='verb_tense')return true;
  if(matches.some(match=>match.offset<edit.offset+edit.length&&edit.offset<match.offset+match.length))return true;
  return /\b(yesterday|ago|last\s+(night|week|month|year|summer|winter|time|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+(19|20)\d{2}|when\s+.{0,35}\b(was|were)|the\s+(previous|following)\s+(day|week))\b/i.test(edit.sentence);
}
