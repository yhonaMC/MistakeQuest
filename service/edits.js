import {categoryLabels} from './config.js';
function canonical(source){let text='';const starts=[],ends=[];for(let i=0;i<source.length;i++){let ch=source[i];if(/\s/.test(ch)){const start=i;while(i+1<source.length&&/\s/.test(source[i+1]))i++;text+=' ';starts.push(start);ends.push(i+1);}else{text+=ch==='’'||ch==='‘'?"'":ch;starts.push(i);ends.push(i+1);}}return{text,starts,ends};}
const word=char=>Boolean(char&&/[\p{L}\p{N}]/u.test(char));
function occurrences(text,query){const result=[];for(let start=text.indexOf(query);start>=0;start=text.indexOf(query,start+1)){if(word(query[0])&&word(text[start-1]))continue;if(word(query.at(-1))&&word(text[start+query.length]))continue;result.push(start);}return result;}
export function locateIssue(text,candidate,anchor){
  if(!candidate||!candidate.original||!candidate.replacement||candidate.original===candidate.replacement)return null;
  if(anchor){
    const {offset,length}=anchor;
    if(!Number.isInteger(offset)||!Number.isInteger(length)||offset<0||length<1||offset+length>text.length)return null;
    const original=text.slice(offset,offset+length);
    if(canonical(original).text!==canonical(candidate.original).text||word(original[0])&&word(text[offset-1])||word(original.at(-1))&&word(text[offset+length]))return null;
    return {...candidate,offset,length,original,label:categoryLabels[candidate.category]||categoryLabels.other};
  }
  const full=canonical(text),part=canonical(candidate.original).text,context=canonical(candidate.sentence||'').text.trim();
  const matches=occurrences(full.text,part);const contexts=context?occurrences(full.text,context):[];
  // Exact unique source fragments are safe even if the model quotes its corrected context.
  const anchored=context&&contexts.length?matches.filter(start=>contexts.some(c=>start>=c&&start+part.length<=c+context.length)):matches;
  if(anchored.length!==1)return null;const start=anchored[0],offset=full.starts[start],end=full.ends[start+part.length-1];
  return {...candidate,offset,length:end-offset,original:text.slice(offset,end),label:categoryLabels[candidate.category]||categoryLabels.other};
}
export function applyEdits(text,edits){
  const sorted=[...edits].sort((a,b)=>a.offset-b.offset||a.length-b.length);let end=-1;
  for(const edit of sorted){if(!Number.isInteger(edit.offset)||edit.offset<0||!Number.isInteger(edit.length)||edit.length<0||edit.offset+edit.length>text.length||text.slice(edit.offset,edit.offset+edit.length)!==edit.original||edit.offset<end)throw Error('Invalid or overlapping correction span');end=edit.offset+edit.length;}
  let result=text;for(const edit of sorted.reverse())result=result.slice(0,edit.offset)+edit.replacement+result.slice(edit.offset+edit.length);return result;
}
const expanded=value=>value.toLowerCase().replace(/[’‘]/g,"'").replace(/\b(don't|doesn't|didn't|can't|isn't|aren't|wasn't|weren't|won't|i'm|it's|he's|she's)\b/g,term=>({"don't":'do not',"doesn't":'does not',"didn't":'did not',"can't":'cannot',"isn't":'is not',"aren't":'are not',"wasn't":'was not',"weren't":'were not',"won't":'will not',"i'm":'i am',"it's":'it is',"he's":'he is',"she's":'she is'}[term])).replace(/\s+/g,' ').trim();
export function isAllowedEdit(edit){
  if(!edit||!Object.hasOwn(categoryLabels,edit.category)||edit.original===edit.replacement)return false;
  if(['punctuation','capitalization'].includes(edit.category)&&edit.original.replace(/[^\p{L}\p{N}]/gu,'').toLowerCase()!==edit.replacement.replace(/[^\p{L}\p{N}]/gu,'').toLowerCase())return false;
  if(expanded(edit.original)===expanded(edit.replacement)&&edit.category!=='capitalization'&&edit.category!=='punctuation')return false;
  const before=edit.original.trim().split(/\s+/).length,after=edit.replacement.trim().split(/\s+/).length;
  if(before>12||after>before+3||edit.replacement.length>Math.max(24,edit.original.length*2.2))return false;
  return true;
}
export function nonOverlapping(edits){const result=[];for(const edit of [...edits].sort((a,b)=>a.offset-b.offset||a.length-b.length)){if(!result.some(other=>edit.offset<other.offset+other.length&&other.offset<edit.offset+edit.length))result.push(edit);}return result;}
export const normalizeAnswer=(text,caseSensitive=false)=>{const result=text.trim().replace(/[’‘]/g,"'").replace(/\s+/g,' ');return caseSensitive?result:result.toLowerCase();};
export const words=text=>text.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)||[];
export const normalizeSentence=text=>normalizeAnswer(text).replace(/[.!?]+$/,'');
export function sentenceAt(text,offset){const left=Math.max(text.lastIndexOf('.',offset-1),text.lastIndexOf('!',offset-1),text.lastIndexOf('?',offset-1),text.lastIndexOf('\n',offset-1))+1;const stops=['.','!','?','\n'].map(char=>text.indexOf(char,offset)).filter(index=>index>=0);const right=stops.length?Math.min(...stops)+1:text.length;return text.slice(left,right).trim();}
