import {applyEdits,isAllowedEdit,words} from './edits.js';
import {practiceCorrectionParts,partCategory} from './corrections.js';
const clauseBoundary=/[.!?\n]|,(?=\s+(?:I(?:['’]m)?|we|he|she|they|it|this|today)\b)/gi;

// Reuse confirmed changes, correcting neighboring errors before isolating one target.
// Positions remain UTF-16 offsets; personal text never leaves the local engines.
export function sourcePracticeItems(issue,related=[]){
  const source=issue.sentence,all=related.some(e=>e.id===issue.id)?related:[...related,issue],origins=[];
  for(let index=source.indexOf(issue.original);index>=0;index=source.indexOf(issue.original,index+1))origins.push(issue.offset-index);
  if(!origins.length)return [];
  const fits=(edit,origin)=>edit.offset>=origin&&source.slice(edit.offset-origin,edit.offset-origin+edit.length)===edit.original;
  const origin=origins.sort((a,b)=>all.filter(e=>fits(e,b)).length-all.filter(e=>fits(e,a)).length)[0];
  const edits=all.filter(e=>fits(e,origin)).map(e=>({...e,offset:e.offset-origin}));
  let corrected;try{corrected=applyEdits(source,edits);}catch{return [];}
  const parts=practiceCorrectionParts(issue),items=[];
  const before=edits.filter(e=>e.offset<issue.offset-origin).reduce((sum,e)=>sum+e.replacement.length-e.length,0);let delta=0;
  for(const part of parts){
    const category=partCategory(part,issue.category),start=issue.offset-origin+before+part.offset+delta,end=start+part.replacement.length;
    delta+=part.replacement.length-part.length;
    if(!isAllowedEdit({...part,category})||part.original.length>70||part.replacement.length>70)continue;
    let left=0,right=corrected.length;
    for(const match of corrected.matchAll(clauseBoundary)){if(match.index<start)left=match.index+1;else if(match.index>=end){right=match.index+1;break;}}
    while(/\s/.test(corrected[left]||'')&&left<start)left++;
    // A standalone word hides why a sentence boundary requires a capital letter.
    if(left>0&&['capitalization','punctuation'].includes(category)&&words(corrected.slice(left,right)).length<=2){
      const previous=corrected.slice(0,left).trimEnd().slice(0,-1);
      left=([...previous.matchAll(clauseBoundary)].at(-1)?.index??-1)+1;
      while(/\s/.test(corrected[left]||'')&&left<start)left++;
    }
    const context=[...corrected.slice(left,right).matchAll(/\S+/g)];
    let clipped=false;
    if(context.length>90){const first=context.findIndex(m=>left+m.index+m[0].length>start),last=context.findLastIndex(m=>left+m.index<end);let low=Math.max(0,first-12);const subject=context.slice(low,first).findIndex(m=>/^(I|we|he|she|they|it)$/i.test(m[0]));if(subject>=0)low+=subject;const high=Math.min(context.length-1,last+12),base=left;left=base+context[low].index;right=base+context[high].index+context[high][0].length;clipped=true;}
    const offset=start-left;let good=corrected.slice(left,right).trimEnd();
    if(good.length>offset+part.replacement.length)good=good.replace(/[,;:]$/,'');
    if(clipped&&offset>0&&/^[a-z]/.test(good))good=good[0].toUpperCase()+good.slice(1);
    if(good.slice(offset,offset+part.replacement.length)!==part.replacement)continue;
    const bad=good.slice(0,offset)+part.original+good.slice(offset+part.replacement.length);
    items.push({bad,good,original:part.original,replacement:part.replacement,category,alternatives:[],alternateOrders:[],answers:[part.replacement],targetOffset:offset,targetLength:part.original.length,sourceOffset:issue.offset+part.offset,sourceLength:part.length});
  }
  return items.slice(0,3);
}
