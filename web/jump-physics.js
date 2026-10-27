export function createJumpWorld(){return {width:1000,height:480,platforms:[{id:'spawn',x:390,y:430,width:220},{id:'step-left',x:200,y:340,width:200},{id:'step-right',x:600,y:340,width:200},{id:'answer-0',x:50,y:245,width:260,optionIndex:0},{id:'answer-1',x:690,y:245,width:260,optionIndex:1}]};}
export function createJumpPlayer(){return {x:500,y:430,vx:0,vy:0,grounded:true,platformId:'spawn',facing:1};}
const GRAVITY=1500,SPEED=290,JUMP_SPEED=630,FOOT_RADIUS=14;

/** Feet coordinates, seconds and public platform IDs only. No answer evaluation lives here. */
export function stepJump(player,input={},seconds=1/120,world=createJumpWorld(),{paused=false}={}){
 if(paused||seconds<=0)return {player,event:null};
 const dt=Math.min(seconds,.04),next={...player};
 next.vx=input.coast?player.vx:Math.max(-1,Math.min(1,input.horizontal||0))*SPEED;
 if(next.vx)next.facing=Math.sign(next.vx);
 if(input.jump&&player.grounded){next.vy=-JUMP_SPEED;next.grounded=false;next.platformId=null;}
 next.x=Math.max(22,Math.min(world.width-22,next.x+next.vx*dt));
 if(next.grounded){
  const support=world.platforms.find(platform=>platform.id===next.platformId);
  if(!support||next.x+FOOT_RADIUS<support.x||next.x-FOOT_RADIUS>support.x+support.width){next.grounded=false;next.platformId=null;}
 }
 if(!next.grounded){
  next.vy+=GRAVITY*dt;next.y+=next.vy*dt;
  if(next.vy>0){
   const landing=world.platforms.filter(platform=>player.y<=platform.y&&next.y>=platform.y&&next.x+FOOT_RADIUS>=platform.x&&next.x-FOOT_RADIUS<=platform.x+platform.width).sort((a,b)=>a.y-b.y)[0];
   if(landing){next.y=landing.y;next.vy=0;next.vx=0;next.grounded=true;next.platformId=landing.id;return {player:next,event:{type:'land',platformId:landing.id,...(landing.optionIndex==null?{}:{optionIndex:landing.optionIndex})}};}
  }
 }
 if(next.y>world.height+75)return {player:next,event:{type:'fall'}};
 return {player:next,event:null};
}

/** Assisted travel still goes through gravity and the ordinary descending landing check. */
export function launchAssistedJump(player,platform){
 const duration=.9;
 return {...player,vx:(platform.x+platform.width/2-player.x)/duration,vy:(platform.y-player.y-.5*GRAVITY*duration*duration)/duration,grounded:false,platformId:null};
}
