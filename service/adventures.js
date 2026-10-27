import {AppError,categoryLabels} from './config.js';
import {applyEdits,isAllowedEdit,locateIssue,normalizeAnswer,normalizeSentence,words} from './edits.js';
import {matchesPracticeOrder} from './corrections.js';
import {digest} from './store.js';

export const isAdventure=mode=>mode==='jump'||mode==='maze';
export const adventureItem=game=>game.privateData.items[Math.min(game.state.step,game.privateData.items.length-1)];
export const adventureWordBank=game=>words(adventureItem(game).good).map((text,id)=>({id,text}));
export const adventureRequestHash=input=>digest(Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b))));
export function validateAdventureCheckpoint(game,input){
  if(!Number.isInteger(input.checkpoint)||input.checkpoint<0)throw new AppError('CHECKPOINT_REQUIRED','Indica el punto de control actual.');
  if(input.checkpoint!==game.state.step)throw new AppError('STALE_CHECKPOINT','El punto de control cambió. Recupera la partida guardada.',409);
}
function verifiedItems(issue,bank,index){
  const source=Array.isArray(bank.items)?bank.items:[],start=source.length?index%source.length:0,ordered=[...source.slice(start),...source.slice(0,start)],seen=new Set();
  return ordered.flatMap(item=>{
    if(!item||!['bad','good','original','replacement'].every(key=>typeof item[key]==='string'&&item[key].trim())||words(item.bad).length>18||words(item.good).length>18||!matchesPracticeOrder(issue,item))return [];
    const key=normalizeSentence(item.good);if(seen.has(key))return [];
    const category=item.category||issue.category,anchor=Number.isInteger(item.targetOffset)?{offset:item.targetOffset,length:item.targetLength}:undefined;
    const edit=locateIssue(item.bad,{...item,sentence:item.bad,category},anchor);
    if(!edit||!isAllowedEdit(edit)||applyEdits(item.bad,[edit])!==item.good)return [];
    seen.add(key);return [{...item,category,targetOffset:edit.offset,targetLength:edit.length,answers:item.answers||[item.replacement],alternatives:item.alternatives||[],alternateOrders:item.alternateOrders||[]}];
  }).slice(0,3);
}
export function makeAdventure(issue,bank,mode,index=0){
  const items=verifiedItems(issue,bank,index);
  if(!isAdventure(mode)||!items.length)throw new AppError('INVALID_GAME','No se pudo preparar este formato con frases verificadas.');
  const category=items[0].category||issue.category;
  const content=items.map(item=>[item.bad,item.good]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {issueId:issue.id,mode,exerciseKey:digest({category,mode,content}),privateData:{item:items[0],items,bank:{...bank,items}},publicData:{category,label:categoryLabels[category]||issue.label,source:{id:issue.id,label:issue.label,original:issue.original,replacement:issue.replacement}},state:{help:'none',step:0,movementMistakes:0,position:{x:1,y:1},collected:[]}};
}
export function mazeBoard(game){
  const width=9,height=9,walls=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x===0||y===0||x===width-1||y===height-1||(x===3&&y>=2&&y<=6&&y!==4)||(x===5&&y>=2&&y<=6&&y!==4))walls.push({x,y});
  const spawn={x:1,y:1},exit={x:7,y:7},blocked=new Set(walls.map(cell=>`${cell.x},${cell.y}`)),available=[];
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++)if(!blocked.has(`${x},${y}`)&&!(x===spawn.x&&y===spawn.y)&&!(x===exit.x&&y===exit.y))available.push({x,y});
  // Every interior tile connects through the outer corridor and the middle gaps.
  // A coprime stride distributes words without displaying their answer order.
  const tokens=adventureWordBank(game).map(token=>({...token,...available[(token.id*11+7)%available.length]}));
  return {width,height,walls,spawn,exit,tokens};
}
export function publicAdventure(game,info){
  const item=adventureItem(game),state=game.state,total=game.privateData.items.length,options=[{id:0,text:item.original},{id:1,text:item.replacement}];
  return {id:game.id,issueId:game.issueId,mode:game.mode,...game.publicData,name:info.name,instruction:info.description,text:item.bad,target:{offset:item.targetOffset,length:item.targetLength,text:item.original},...game.mode==='jump'?{options:state.step%2?options.toReversed():options}:{wordBank:adventureWordBank(game).toReversed(),board:mazeBoard(game)},adventure:{step:state.step,total,movementMistakes:state.movementMistakes,position:{...state.position},collected:[...state.collected]},progress:{current:state.step,total},help:state.help,completed:Boolean(game.completed)};
}
export function evaluateAdventure(game,answer,override=false){
  validateAdventureCheckpoint(game,answer);
  const state=structuredClone(game.state),item=adventureItem(game);let correct,correctedSentence;
  if(game.mode==='jump'){
    if(Object.keys(answer).some(key=>!['idempotencyKey','checkpoint','answer'].includes(key))||!['0','1'].includes(answer.answer))throw new AppError('ANSWER_REQUIRED','Elige una de las dos opciones.');
    correct=answer.answer==='1';correctedSentence=correct?item.good:undefined;
  }else{
    const board=mazeBoard(game),wordBank=adventureWordBank(game),ids=answer.tokenIds;
    if(Object.keys(answer).some(key=>!['idempotencyKey','checkpoint','tokenIds'].includes(key))||!Array.isArray(ids)||ids.length!==wordBank.length||new Set(ids).size!==wordBank.length||ids.some(id=>!Number.isInteger(id)||!wordBank[id])||state.collected.length!==ids.length||state.collected.some((id,index)=>id!==ids[index])||state.position.x!==board.exit.x||state.position.y!==board.exit.y)throw new AppError('INCOMPLETE_MAZE','Recoge todas las palabras en ese orden y llega a la salida.');
    const phrase=ids.map(id=>wordBank[id].text).join(' '),sequence=value=>normalizeAnswer(words(value).join(' '));
    const matched=[item.good,...item.alternateOrders].find(value=>sequence(value)===sequence(phrase));
    correct=Boolean(matched)||Boolean(override&&sequence(phrase)!==sequence(item.bad));
    correctedSentence=correct?(matched||phrase[0].toUpperCase()+phrase.slice(1)+'.'):undefined;
  }
  if(correct){state.step++;state.position={x:1,y:1};state.collected=[];}
  const completed=correct&&state.step===game.privateData.items.length;
  return {correct,completed,state,help:state.help,answer,response:{message:correct?(completed?'Bien. Aventura terminada.':'Bien. Continúa con el siguiente punto de control.'):'Todavía no corresponde a este reto. Puedes volver a intentar o pedir una pista.',help:state.help,correctedSentence,explanation:correct?game.privateData.bank.explanation:undefined,progress:{current:state.step,total:game.privateData.items.length}}};
}
export function applyAdventureAction(game,input){
  if(!isAdventure(game.mode))throw new AppError('INVALID_GAME_ACTION','Esta partida no tiene acciones de movimiento.');
  validateAdventureCheckpoint(game,input);
  if(game.completed)return {state:game.state,unchanged:true};
  if(game.mode==='jump'){
    if(!['fall','collision'].includes(input.type)||input.direction!==undefined)throw new AppError('INVALID_GAME_ACTION','Esta acción no corresponde a la aventura.');
    return {state:{...game.state,movementMistakes:game.state.movementMistakes+1}};
  }
  const state=structuredClone(game.state),board=mazeBoard(game);
  if(input.type==='move'){
    const directions={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]},delta=directions[input.direction];
    if(!delta)throw new AppError('INVALID_GAME_ACTION','Elige una dirección.');
    const position={x:state.position.x+delta[0],y:state.position.y+delta[1]};
    if(position.x>=0&&position.y>=0&&position.x<board.width&&position.y<board.height&&!board.walls.some(wall=>wall.x===position.x&&wall.y===position.y))state.position=position;
  }else if(input.type==='collect'){
    const token=board.tokens.find(token=>token.x===state.position.x&&token.y===state.position.y);
    if(token&&!state.collected.includes(token.id))state.collected.push(token.id);
  }else if(input.type==='undo')state.collected.pop();
  else if(input.type==='reset'){state.position={...board.spawn};state.collected=[];}
  else if(input.type==='collision'){state.movementMistakes++;state.position={...board.spawn};}
  else throw new AppError('INVALID_GAME_ACTION','Esta acción no corresponde al laberinto.');
  return {state};
}
