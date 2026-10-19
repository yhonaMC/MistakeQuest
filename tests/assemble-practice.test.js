import test from 'node:test';import assert from 'node:assert/strict';
import * as games from '../service/games.js';
test('new examples apply the confirmed correction instead of trusting a conflicting model good sentence',()=>{
  assert.equal(typeof games.assemblePracticeBank,'function');
  const bank=games.assemblePracticeBank({items:[{bad:'I look for a jobs opportunities online.',good:'I look for a job opportunities online.',original:'a jobs',replacement:'jobs',alternatives:[],alternateOrders:[]}]},{category:'articles',original:'a jobs',replacement:'job'});
  assert.equal(bank.items[0].good,'I look for job opportunities online.');assert.equal(bank.items[0].replacement,'job');
});
test('an invented or ambiguous target cannot be assembled into a new practice sentence',()=>{
  assert.equal(typeof games.assemblePracticeBank,'function');
  const bank=games.assemblePracticeBank({items:[{bad:'I look for work online.',original:'a jobs',replacement:'job'},{bad:'I see a jobs here and a jobs there.',original:'a jobs',replacement:'job'}]},{category:'articles',original:'a jobs',replacement:'job'});assert.deepEqual(bank.items,[]);
});
