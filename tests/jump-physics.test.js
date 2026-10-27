import test from 'node:test';
import assert from 'node:assert/strict';
import {createJumpWorld,createJumpPlayer,stepJump,launchAssistedJump} from '../web/jump-physics.js';

const world=createJumpWorld();
function tick(player,input={},seconds=1/120){return stepJump(player,input,seconds,world);}
function run(player,input,frames){let result;for(let i=0;i<frames;i++){result=tick(player,typeof input==='function'?input(player,i):input);player=result.player;}return result;}

test('jump rises, gravity reverses it, and a descending actor lands on a platform',()=>{
 let player=createJumpPlayer(world);
 const rising=tick(player,{jump:true});
 assert.ok(rising.player.y<player.y);
 assert.ok(rising.player.vy<0);
 player=rising.player;
 const apex=run(player,{},55).player;
 assert.ok(apex.y<player.y-70,'A jump has a visible upward arc');
 const landed=run(apex,{},80);
 assert.equal(landed.player.grounded,true);
 assert.equal(landed.player.platformId,'spawn');
 assert.equal(landed.player.y,430);
});

test('both answer pads are reachable through neutral platforms using manual movement and jumps',()=>{
 for(const direction of [-1,1]){
  let player=createJumpPlayer(world),landings=[];
  // This literal route uses the same directional input a person holds, without teleporting.
  for(let frame=0;frame<360;frame++){
   const target=player.platformId==='spawn'?(direction<0?300:700):(direction<0?180:820);
   const input={horizontal:Math.abs(player.x-target)<7?0:Math.sign(target-player.x),jump:player.grounded};
   const result=tick(player,input);player=result.player;
   if(result.event?.type==='land')landings.push(result.event.platformId);
   if(result.event?.optionIndex!=null)break;
  }
  assert.ok(landings.includes(direction<0?'step-left':'step-right'),'The learner reaches the neutral stepping stone');
  assert.equal(player.platformId,direction<0?'answer-0':'answer-1');
  assert.equal(player.grounded,true);
 }
});

test('walking off the start platform creates a fall event and never an answer landing',()=>{
 let player=createJumpPlayer(world),events=[];
 for(let frame=0;frame<300;frame++){
  const result=tick(player,{horizontal:1});player=result.player;
  if(result.event)events.push(result.event);
  if(result.event?.type==='fall')break;
 }
 assert.equal(events.at(-1)?.type,'fall');
 assert.equal(events.some(event=>event.optionIndex!=null),false);
});

test('pause freezes an airborne actor and produces no landing or motor event',()=>{
 const player=tick(createJumpPlayer(world),{horizontal:1,jump:true}).player;
 const result=stepJump(player,{horizontal:-1,jump:true},4,world,{paused:true});
 assert.deepEqual(result.player,player);
 assert.equal(result.event,null);
});

test('assistance is a visible ballistic jump that lands on the chosen public pad',()=>{
 const spawn=createJumpPlayer(world);
 let player=launchAssistedJump(spawn,world.platforms.find(platform=>platform.id==='answer-1'));
 assert.equal(player.x,spawn.x,'Assistance does not teleport to an answer');
 assert.equal(player.y,spawn.y);
 assert.equal(player.grounded,false);
 let event;
 for(let i=0;i<180;i++){
  const result=tick(player,{coast:true});player=result.player;
  if(result.event){event=result.event;break;}
 }
 assert.equal(event?.type,'land');
 assert.equal(event?.optionIndex,1);
 assert.equal(player.platformId,'answer-1');
});
