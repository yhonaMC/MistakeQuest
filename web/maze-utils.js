const directions={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
const key=cell=>`${cell.x},${cell.y}`;
const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;

export function nextMazeCell(board,position,direction){
 const delta=directions[direction];
 if(!delta||!position)return null;
 const cell={x:position.x+delta.x,y:position.y+delta.y};
 if(cell.x<0||cell.y<0||cell.x>=board.width||cell.y>=board.height||(board.walls||[]).some(wall=>same(wall,cell)))return null;
 return cell;
}

/** Returns adjacent steps, excluding the starting cell. Null means unreachable. */
export function mazePath(board,start,target){
 const queue=[{cell:start,path:[]}],visited=new Set([key(start)]);
 for(let index=0;index<queue.length;index++){
  const {cell,path}=queue[index];
  if(same(cell,target))return path;
  for(const direction of Object.keys(directions)){
   const next=nextMazeCell(board,cell,direction);
   if(next&&!visited.has(key(next))){visited.add(key(next));queue.push({cell:next,path:[...path,next]});}
  }
 }
 return null;
}

/** A short floor-only patrol never occupies a word, spawn or exit tile. */
export function patrolRoute(board){
 const reserved=[board.spawn,board.exit,...(board.tokens||[])],candidates=[];
 for(let y=0;y<board.height;y++)for(let x=0;x<board.width;x++){
  const cell={x,y};
  if(!reserved.some(other=>same(cell,other))&&!(board.walls||[]).some(wall=>same(cell,wall))&&mazePath(board,board.spawn,cell))candidates.push(cell);
 }
 let best=[];
 for(const start of candidates){
  const route=[start];
  while(route.length<4){
   const next=candidates.find(cell=>!route.some(other=>same(other,cell))&&Math.abs(cell.x-route.at(-1).x)+Math.abs(cell.y-route.at(-1).y)===1);
   if(!next)break;
   route.push(next);
  }
  if(route.length>best.length)best=route;
 }
 return best.length>=2?best:[];
}
