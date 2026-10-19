import test from 'node:test';import assert from 'node:assert/strict';
import {validateBank} from '../service/games.js';
const issue={category:'punctuation',label:'Puntuación',original:'speaking,',replacement:'speaking.',sentence:'I practice speaking, I have a lesson.',explanation:'Separa dos oraciones.'},engines={check:async()=>({matches:[]})};
const item={bad:'I went home, I was tired.',good:'I went home. I was tired.',original:'home,',replacement:'home.',alternatives:[],alternateOrders:[]};
test('punctuation practice varies everyday words while retaining the same comma-to-period repair',async()=>{
  const bank=await validateBank({explanation:issue.explanation,hint:'Separa las dos ideas.',items:[item]},issue,engines,'en-US');assert.equal(bank.items.length,1);assert.equal(bank.items[0].good,'I went home. I was tired.');
});
test('punctuation variety cannot substitute another punctuation rule or change vocabulary',async()=>{
  for(const wrong of [{...item,good:'I went home? I was tired.',replacement:'home?'},{...item,good:'I went away. I was tired.',replacement:'away.'}])assert.equal((await validateBank({items:[wrong]},issue,engines,'en-US')).items.length,0);
});
