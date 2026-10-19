import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {Engines} from '../service/engines.js';

const schema=z.object({answer:z.string()});
function heldQueue(engines){let release;engines.queue=new Promise(resolve=>{release=resolve;});return release;}
function localResponse(answer){return {ok:true,json:async()=>({message:{content:JSON.stringify({answer})},eval_count:3})};}
async function expectPromptCancellation(request,reason){await assert.rejects(Promise.race([request,delay(80).then(()=>{throw new Error('La cancelación esperó a que terminara la cola.');})]),error=>error===reason);}

test('cancelar una petición en cola responde sin esperar al trabajo anterior',async t=>{
  const engines=new Engines(),release=heldQueue(engines),controller=new AbortController(),reason=new Error('Cancelado por tiempo de espera');
  const fetchMock=t.mock.method(globalThis,'fetch',async()=>localResponse('No debe solicitarse')),removeListener=t.mock.method(controller.signal,'removeEventListener');
  const request=engines.chat(schema,'Test',{text:'Queued'},{signal:controller.signal});
  try{
    assert.equal(engines.pending,1);controller.abort(reason);
    await expectPromptCancellation(request,reason);
    assert.equal(engines.pending,0,'La espera cancelada libera su contador inmediatamente');
    assert.equal(fetchMock.mock.callCount(),0);
    assert.equal(removeListener.mock.callCount(),1,'La espera desregistra su listener al cancelarse');
  }finally{release();await engines.queue;await request.catch(()=>{});}
  assert.equal(engines.pending,0,'La tarea cancelada no decrementa el contador por segunda vez al salir de la cola');
  assert.equal(fetchMock.mock.callCount(),0,'La petición cancelada tampoco llega al motor posteriormente');
});

test('una cancelación en cola no impide completar la siguiente petición',async t=>{
  const engines=new Engines(),release=heldQueue(engines),controller=new AbortController(),reason=new Error('Cancelado');
  const fetchMock=t.mock.method(globalThis,'fetch',async()=>localResponse('Next response'));
  const canceled=engines.chat(schema,'Test',{text:'Canceled'},{signal:controller.signal});
  controller.abort(reason);
  try{
    await expectPromptCancellation(canceled,reason);
    const nextController=new AbortController(),removeListener=t.mock.method(nextController.signal,'removeEventListener');
    const next=engines.chat(schema,'Test',{text:'Next'},{signal:nextController.signal});
    assert.equal(engines.pending,1);release();
    assert.equal((await next).value.answer,'Next response');
    assert.equal(engines.pending,0);
    assert.equal(fetchMock.mock.callCount(),1);
    assert.equal(removeListener.mock.callCount(),1,'También desregistra su listener cuando termina normalmente');
    assert.equal(JSON.parse(fetchMock.mock.calls[0].arguments[1].body).messages[1].content,JSON.stringify({text:'Next'}));
  }finally{release();await engines.queue;await canceled.catch(()=>{});}
});

test('una señal ya cancelada tampoco queda esperando en la cola ni solicita el motor',async t=>{
  const engines=new Engines(),release=heldQueue(engines),controller=new AbortController(),reason=new Error('Ya cancelado');
  const fetchMock=t.mock.method(globalThis,'fetch',async()=>localResponse('No debe solicitarse'));
  controller.abort(reason);const request=engines.chat(schema,'Test',{}, {signal:controller.signal});
  try{await expectPromptCancellation(request,reason);assert.equal(engines.pending,0);}finally{release();await engines.queue;await request.catch(()=>{});}
  assert.equal(fetchMock.mock.callCount(),0);assert.equal(engines.pending,0);
});
