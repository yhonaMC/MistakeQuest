import {applyEdits} from './edits.js';
const tokens=text=>[...text.matchAll(/\S+/g)].map(m=>({text:m[0],offset:m.index,end:m.index+m[0].length}));
const letters=text=>text.replace(/[^\p{L}\p{N}'’]/gu,'');
const simpleChange=(a,b)=>letters(a).toLowerCase()===letters(b).toLowerCase()||letters(b).toLowerCase()===letters(a).toLowerCase()+'s';
const functionWords=new Set('a an the am is are was were be been being i you he she it we they me him her us them my your his its our their myself yourself himself herself itself ourselves themselves this that these those there to for from of in on at by with about as than and or but because so if do does did'.split(' '));
export function preservesContentWords(original,replacement){const content=text=>(text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)||[]).filter(word=>!functionWords.has(word)).sort().join('|');return content(original)===content(replacement);}
const reorderPrepositions=new Set('to for from of in on at with'.split(' '));
export function preservesReorderTokens(original,replacement){
  const inventory=text=>(text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)||[]).map(word=>reorderPrepositions.has(word)?'@preposition':word).sort().join('|');
  return inventory(original)===inventory(replacement);
}
export function optionalConjunctionComma(original,replacement){return original!==replacement&&original.replace(/,/g,'')===replacement.replace(/,/g,'')&&/^(and|or)$/i.test(original.replace(/,/g,'').trim());}

// Keep coupled grammar repairs together; separate independent case/inflection changes.
export function correctionParts(original,replacement){
  if(original===replacement)return [];
  const a=tokens(original),b=tokens(replacement),width=b.length+1,lcs=new Uint16Array((a.length+1)*width),at=(i,j)=>lcs[i*width+j];
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)lcs[i*width+j]=a[i].text===b[j].text?1+at(i+1,j+1):Math.max(at(i+1,j),at(i,j+1));
  const parts=[];let i=0,j=0;
  const emit=(from,to,start,end)=>{
    if(from===to||start===end){if(from>0&&start>0){from--;start--;}else if(to<a.length&&end<b.length){to++;end++;}else return;}
    const offset=a[from].offset,length=a[to-1].end-offset;
    parts.push({offset,length,original:original.slice(offset,offset+length),replacement:replacement.slice(b[start].offset,b[end-1].end)});
  };
  while(i<a.length||j<b.length){
    if(i<a.length&&j<b.length&&a[i].text===b[j].text){i++;j++;continue;}
    const from=i,start=j;
    while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i].text===b[j].text)break;if(i<a.length&&(j===b.length||at(i+1,j)>=at(i,j+1)))i++;else j++;}
    if(i-from===j-start&&i>from&&a.slice(from,i).every((t,k)=>simpleChange(t.text,b[start+k].text)))for(let k=0;k<i-from;k++)emit(from+k,from+k+1,start+k,start+k+1);
    else emit(from,i,start,j);
  }
  try{if(parts.length&&applyEdits(original,parts)===replacement)return parts;}catch{}
  return [{offset:0,length:original.length,original,replacement}];
}

// Moving a word is one repair: splitting it invents a deletion and an insertion.
// Trim only the unchanged edges so Radar can still offer genuine distractors.
export function practiceCorrectionParts(issue){
  const {original,replacement,category}=issue;
  if(category!=='word_order')return correctionParts(original,replacement);
  if(original===replacement)return [];
  const scan=value=>[...value.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s]/gu)].map(match=>({text:match[0],offset:match.index,end:match.index+match[0].length}));
  const a=scan(original),b=scan(replacement),parts=[];let first=0,lastA=a.length,lastB=b.length;
  const keepCase=(left,right)=>{if(left.text!==right.text)parts.push({offset:left.offset,length:left.end-left.offset,original:left.text,replacement:right.text});};
  while(first<lastA&&first<lastB&&a[first].text.toLowerCase()===b[first].text.toLowerCase()){keepCase(a[first],b[first]);first++;}
  while(lastA>first&&lastB>first&&a[lastA-1].text.toLowerCase()===b[lastB-1].text.toLowerCase()){keepCase(a[lastA-1],b[lastB-1]);lastA--;lastB--;}
  if(first<lastA&&first<lastB){
    const offset=a[first].offset,length=a[lastA-1].end-offset,part={offset,length,original:original.slice(offset,offset+length),replacement:replacement.slice(b[first].offset,b[lastB-1].end)};
    parts.push(part);
  }
  parts.sort((left,right)=>left.offset-right.offset);
  if(parts.length&&applyEdits(original,parts)===replacement)return parts;
  return [{offset:0,length:original.length,original,replacement}];
}

const orderPair=(original,replacement)=>{
  let before=original.trim(),after=replacement.trim();
  const punctuation=value=>/[^\p{L}\p{N}\s]/u.test(value);
  while(before&&after&&before[0]===after[0]&&punctuation(before[0])){before=before.slice(1).trimStart();after=after.slice(1).trimStart();}
  while(before&&after&&before.at(-1)===after.at(-1)&&punctuation(before.at(-1))){before=before.slice(0,-1).trimEnd();after=after.slice(0,-1).trimEnd();}
  return JSON.stringify([before.replace(/\s+/g,' '),after.replace(/\s+/g,' ')]);
};
export function matchesPracticeOrder(issue,item,{allowContext=false}={}){
  if(issue.category!=='word_order')return true;
  if(typeof item?.original!=='string'||typeof item?.replacement!=='string')return false;
  const expected=new Set(practiceCorrectionParts(issue).map(part=>orderPair(part.original,part.replacement)));
  const actual=allowContext?practiceCorrectionParts({...item,category:'word_order'}):[item];
  return actual.some(part=>expected.has(orderPair(part.original,part.replacement)));
}
export const hasInvalidPracticeOrder=(issue,bank)=>Array.isArray(bank?.items)&&bank.items.some(item=>!matchesPracticeOrder(issue,item));

export function reviewSegments(text){
  const segments=[];let offset=0;
  while(offset<text.length){
    let end=Math.min(text.length,offset+180);
    if(end<text.length){const area=text.slice(offset,end),boundaries=[...area.matchAll(/[.!?;,\n](?:\s|$)/g)].filter(m=>m.index>=40);if(boundaries.length)end=offset+boundaries.at(-1).index+1;else{const space=area.lastIndexOf(' ');if(space>0)end=offset+space;}}
    const raw=text.slice(offset,end),leading=raw.length-raw.trimStart().length,value=raw.trim();if(value)segments.push({offset:offset+leading,text:value});offset=end;while(/\s/.test(text[offset]||'')&&offset<text.length)offset++;
  }
  return segments;
}

export function partCategory(part,fallback){
  const before=letters(part.original),after=letters(part.replacement);
  if(before===after)return 'punctuation';
  if(before.toLowerCase()===after.toLowerCase())return 'capitalization';
  if(/^(me|him|her|us|them)$/i.test(before)&&/self$|selves$/i.test(after))return 'pronouns';
  if(fallback==='verb_form'&&after===before+'s')return 'agreement';
  return fallback;
}
