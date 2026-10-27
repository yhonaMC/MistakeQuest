import test from 'node:test';
import assert from 'node:assert/strict';
import {nextMazeCell, mazePath, patrolRoute} from '../web/maze-utils.js';

const board={width:5,height:4,walls:[{x:2,y:0},{x:2,y:1},{x:2,y:2}],spawn:{x:0,y:0},exit:{x:4,y:0},tokens:[{id:'a',text:'I',x:1,y:0}]};

test('movement cannot cross a wall or leave the public grid',()=>{
 assert.equal(nextMazeCell(board,{x:1,y:1},'right'),null);
 assert.equal(nextMazeCell(board,{x:0,y:0},'up'),null);
 assert.equal(nextMazeCell(board,{x:0,y:0},'diagonal'),null);
 assert.deepEqual(nextMazeCell(board,{x:1,y:1},'down'),{x:1,y:2});
});

test('reachable routes turn through corridors instead of teleporting through walls',()=>{
 const path=mazePath(board,{x:1,y:0},{x:3,y:0});
 assert.deepEqual(path,[{x:1,y:1},{x:1,y:2},{x:1,y:3},{x:2,y:3},{x:3,y:3},{x:3,y:2},{x:3,y:1},{x:3,y:0}]);
 assert.equal(mazePath({...board,walls:[...board.walls,{x:2,y:3}]},{x:1,y:0},{x:3,y:0}),null);
 assert.deepEqual(mazePath(board,{x:0,y:0},{x:0,y:0}),[]);
});

test('patrol uses adjacent reachable floor cells and leaves reading, spawn and exit cells safe',()=>{
 const route=patrolRoute(board);
 assert.ok(route.length>=2);
 for(const [index,cell]of route.entries()){
  assert.ok(mazePath(board,board.spawn,cell),'A patrol must be in a reachable corridor');
  assert.ok(![board.spawn,board.exit,...board.tokens,...board.walls].some(other=>other.x===cell.x&&other.y===cell.y));
  if(index)assert.equal(Math.abs(cell.x-route[index-1].x)+Math.abs(cell.y-route[index-1].y),1);
 }
 assert.deepEqual(patrolRoute({width:2,height:1,walls:[],spawn:{x:0,y:0},exit:{x:1,y:0},tokens:[]}),[]);
});
