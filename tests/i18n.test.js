import test from 'node:test';
import assert from 'node:assert/strict';
import {english,translate,translateError} from '../web/i18n.js';

test('interface translations keep Spanish source copy and interpolate both languages',()=>{
  assert.equal(translate('es','Revisar mi texto'),'Revisar mi texto');
  assert.equal(translate('en','Revisar mi texto'),'Review my text');
  assert.equal(translate('es','{current} de {total}',{current:2,total:3}),'2 de 3');
  assert.equal(translate('en','{current} de {total}',{current:2,total:3}),'2 of 3');
  assert.equal(translate('en','Tu corrección para «{target}»',{target:"don't"}),'Your correction for “don\'t”');
});
test('unknown learner content and historical AI explanations remain unchanged',()=>{
  for(const value of ['I like coffee.','Una explicación histórica sin traducción.','constructor','__proto__'])assert.equal(translate('en',value),value);
  assert.equal(translate('en','Ya está bien: I like coffee.'),'Already correct: I like coffee.');
  assert.equal(translate('en','Necesita un cambio: She likes coffee.'),'Needs a change: She likes coffee.');
});
test('fixed service failures use translated messages or stable error codes',()=>{
  assert.equal(translateError('en',{code:'OLLAMA_OFFLINE',message:'Un texto del motor anterior.'}),english['La IA local no respondió a tiempo. Tu texto sigue intacto; comprueba los motores.']);
  assert.equal(translateError('en',{code:'ANSWER_REQUIRED',message:'Elige una de las dos opciones.'}),'Choose one of the two options.');
  assert.equal(translateError('en',new TypeError('Failed to fetch')),'Could not connect to the local service.');
  assert.equal(translateError('es',{message:'Este error ya no está en tu historial.'}),'Este error ya no está en tu historial.');
});
