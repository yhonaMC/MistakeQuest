import {applyEdits,isAllowedEdit,locateIssue,normalizeAnswer,normalizeSentence} from './edits.js';
import {matchesPracticeOrder} from './corrections.js';

const sentenceKey=value=>typeof value==='string'?normalizeSentence(value):'';

// Reuse the immutable game snapshots so rotation survives restarting the app.
// Every visible sentence in a pairs/judge game participates in the same history.
export function selectPracticeItems(store,issueId,bank){
  const exposure=new Map();
  for(const row of store.db.prepare('SELECT rowid AS sequence,mode,private_data,state,completed FROM games WHERE issue_id=? ORDER BY rowid').all(issueId)){
    let data;try{data=JSON.parse(row.private_data);}catch{continue;}
    let shown=row.mode==='pairs'?data?.bank?.items:row.mode==='judge'?data?.judges:[data?.item];
    if(['jump','maze'].includes(row.mode)&&Array.isArray(data?.items)){
      let state;try{state=JSON.parse(row.state);}catch{state={};}
      const visible=Number.isInteger(state?.step)&&state.step>=0?state.step+1:1;
      shown=data.items.slice(0,row.completed?data.items.length:visible);
    }
    if(!Array.isArray(shown))continue;
    const seen=new Set(shown.map(item=>sentenceKey(item?.good)).filter(Boolean));
    for(const key of seen){
      const previous=exposure.get(key);
      exposure.set(key,{count:(previous?.count||0)+1,lastSeen:Number(row.sequence)});
    }
  }
  const unique=new Map();
  for(const [index,item] of (Array.isArray(bank?.items)?bank.items:[]).entries()){
    const key=sentenceKey(item?.good);if(!key||unique.has(key))continue;
    const history=exposure.get(key)||{count:0,lastSeen:-1};
    unique.set(key,{item,index,...history});
  }
  return [...unique.values()].sort((a,b)=>a.count-b.count||a.lastSeen-b.lastSeen||a.index-b.index).map(value=>value.item);
}

const choicePairKey=item=>typeof item?.original==='string'&&typeof item?.replacement==='string'?JSON.stringify([normalizeAnswer(item.original,true),normalizeAnswer(item.replacement,true)]):'';
function verifiedChoiceItems(issue,bank){
  const items=[];
  for(const item of Array.isArray(bank.items)?bank.items:[]){
    if(!item||!['bad','good','original','replacement'].every(key=>typeof item[key]==='string'&&item[key].trim()))continue;
    if(!matchesPracticeOrder(issue,item))continue;
    const category=item.category||issue.category,anchor=Number.isInteger(item.targetOffset)&&Number.isInteger(item.targetLength)?{offset:item.targetOffset,length:item.targetLength}:undefined;
    try{
      const edit=locateIssue(item.bad,{original:item.original,replacement:item.replacement,sentence:item.bad,category},anchor);
      if(!edit||!isAllowedEdit(edit)||applyEdits(item.bad,[edit])!==item.good)continue;
      const answers=Array.isArray(item.answers)?item.answers.filter(value=>typeof value==='string'&&value.trim()):[];
      items.push({...item,category,targetOffset:edit.offset,targetLength:edit.length,answers:[...new Set([item.replacement,...answers])],alternatives:Array.isArray(item.alternatives)?item.alternatives:[],alternateOrders:Array.isArray(item.alternateOrders)?item.alternateOrders:[]});
    }catch{/* An unusable cached candidate must not block other verified games. */}
  }
  return items;
}

// Choice rounds can practice another real saved mistake without asking the AI
// for a fresh bank. Pair history is shared across duplicate reviews and survives restart.
export function selectVariedChoiceCandidates(store,issueId,{excludeIssueIds=[],validatorVersion=10}={}){
  const requested=store.issue(issueId),locale=requested&&store.analysis(requested.analysisId)?.locale;
  if(!locale)return [];
  const excluded=new Set(Array.isArray(excludeIssueIds)?excludeIssueIds:[]),pairs=new Map(),issues=new Map(),latestByIssue=new Map();
  const history=store.db.prepare("SELECT g.rowid AS sequence,g.issue_id,g.private_data FROM games g JOIN issues i ON i.id=g.issue_id JOIN analyses a ON a.id=i.analysis_id WHERE g.mode='choice' AND a.locale=? ORDER BY g.rowid").all(locale);
  for(const row of history){
    let data;try{data=JSON.parse(row.private_data);}catch{continue;}
    const key=choicePairKey(data?.item);if(!key)continue;
    const sequence=Number(row.sequence);
    pairs.set(key,{count:(pairs.get(key)?.count||0)+1,lastSeen:sequence});
    issues.set(row.issue_id,{count:(issues.get(row.issue_id)?.count||0)+1,lastSeen:sequence});
    latestByIssue.set(row.issue_id,key);
  }
  const currentPair=latestByIssue.get(issueId)||choicePairKey(requested),roundPairs=new Set([...excluded].map(id=>latestByIssue.get(id)).filter(Boolean)),candidates=[];
  const saved=store.db.prepare('SELECT i.id FROM issues i JOIN analyses a ON a.id=i.analysis_id WHERE a.locale=? ORDER BY i.rowid').all(locale);
  for(const [issueIndex,row] of saved.entries()){
    const issue=store.issue(row.id);let bank;
    try{bank=store.getBank(issue.id);}catch{continue;}
    if(bank?.validatorVersion!==validatorVersion||bank.status==='already_correct')continue;
    const items=selectPracticeItems(store,issue.id,{items:verifiedChoiceItems(issue,bank)});
    for(const [itemIndex,item] of items.entries()){
      const key=choicePairKey(item),pairHistory=pairs.get(key)||{count:0,lastSeen:-1},issueHistory=issues.get(issue.id)||{count:0,lastSeen:-1};
      const rank=[Number(key===currentPair),Number(roundPairs.has(key)),Number(excluded.has(issue.id)),pairHistory.count,pairHistory.lastSeen,issueHistory.count,issueHistory.lastSeen,itemIndex,issueIndex];
      candidates.push({issue,bank:{...bank,items:[item,...items.filter(other=>other!==item)]},rank});
    }
  }
  return candidates.sort((a,b)=>{for(let index=0;index<a.rank.length;index++){const difference=a.rank[index]-b.rank[index];if(difference)return difference;}return 0;}).map(({issue,bank})=>({issue,bank}));
}
