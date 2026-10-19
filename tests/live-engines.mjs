import assert from 'node:assert/strict';
import {Store} from '../service/store.js';
import {Engines} from '../service/engines.js';
import {Reviewer} from '../service/review.js';
import {GameService,validateBank,verifyBank} from '../service/games.js';
const store=new Store(':memory:'),engines=new Engines(),reviewer=new Reviewer(store,engines),games=new GameService(store,engines);
try{
  const health=await engines.health('qwen3:8b');assert.ok(health.ollama&&health.languageTool&&health.modelReady);console.log('Motores y modelo: listos');
  for(const text of ['I like coffee.','I am happy. This is a book.','I like coffee and I like tea.',"I don't have a car.",'I go to work.','I went to work.']){const result=await reviewer.analyze(text,'en-US');assert.equal(result.correctedText,text);assert.equal(result.status,'correct');console.log('Correcto sin reescritura:',text);}
  const cases=[['Yesterday I go to the park. She don\'t like coffee.',"Yesterday I went to the park. She doesn't like coffee."],['My brother have two dog. He can plays guitar.','My brother has two dogs. He can play guitar.']];let issue;
  for(const [text,expected]of cases){const result=await reviewer.analyze(text,'en-US');console.log('Revisión:',JSON.stringify({text:result.correctedText,issues:result.issues.map(i=>[i.original,i.replacement,i.category]),seconds:result.timing?.seconds}));assert.equal(result.correctedText,expected);issue=result.issues.find(i=>i.category==='agreement')||result.issues[0];}
  for(const [text,expected] of [['I think tha my friend richard is kind because he says tha he likes coffee.','I think that my friend Richard is kind because he says that he likes coffee.'],['I think tha this book is better tha that one.','I think that this book is better than that one.']]){
    const result=await reviewer.analyze(text,'en-US');assert.equal(result.correctedText,expected);assert.equal(result.issues.filter(i=>i.original==='tha').length,2);console.log('Ortografía repetida y contexto:',result.correctedText);
  }
  for(const [text,expected] of [['your dia','your day'],['Have a nice dia.','Have a nice day.']]){const result=await reviewer.analyze(text,'en-US');assert.equal(result.correctedText,expected);const issue=result.issues.find(issue=>issue.original==='dia');assert.ok(issue);assert.match(issue.explanation,/español/);console.log('Palabra española en contexto:',result.correctedText);}
  for(const text of ['We met Dia yesterday.','I had a taco on the patio.','The DIA released a report.']){const result=await reviewer.analyze(text,'en-US');assert.equal(result.correctedText,text);assert.equal(result.issues.length,0);console.log('Nombre, préstamo o sigla conservado:',text);}
  const order=await reviewer.analyze('Still is difficult to me this theme.','en-US');assert.equal(order.correctedText,'This theme is still difficult for me.');console.log('Orden de palabras sin añadir vocabulario:',order.correctedText);
  const validLong='I study English every day. I usually read a book after work. I practice with my teacher and I write simple sentences about my day.';
  const preserved=await reviewer.analyze(validLong,'en-US');assert.equal(preserved.correctedText,validLong);assert.equal(preserved.issues.length,0);console.log('Párrafo correcto conservado sin retos');
  for(const mode of ['radar','repair','choice','order','pairs','judge']){let game=await games.create(issue.id,mode);const stored=store.game(game.id),data=stored.privateData;let answer;
    if(mode==='radar')answer={tokenIndex:data.tokens.find(t=>t.offset<data.item.targetOffset+data.item.targetLength&&t.offset+t.length>data.item.targetOffset).id};
    if(mode==='repair')answer={answer:data.item.replacement};if(mode==='choice')answer={answer:'1'};
    if(mode==='order')answer={tokenIds:data.wordBank.map(t=>t.id)};
    if(mode==='pairs'){for(let i=0;i<data.bank.items.length;i++){answer={leftId:i,rightId:i,idempotencyKey:crypto.randomUUID()};const result=await games.attempt(game.id,answer);assert.ok(result.correct);}console.log('Juego real:',mode,'verificado');continue;}
    if(mode==='judge'){for(const question of data.judges){const result=await games.attempt(game.id,{needsChange:question.needsChange,idempotencyKey:crypto.randomUUID()});assert.ok(result.correct);}console.log('Juego real:',mode,'verificado');continue;}
    const result=await games.attempt(game.id,{...answer,idempotencyKey:crypto.randomUUID()});assert.ok(result.correct&&result.completed);console.log('Juego real:',mode,'verificado');
  }
  const simple=await reviewer.improvements('I like coffee.','en-US');assert.equal(simple.suggestions.length,0);
  assert.equal(store.progress().totals.completedGames,6);console.log('Mejoras opcionales y progreso: verificados');
  // A historical correction can include unrelated mistakes and a misleading explanation.
  // New exercises must use only its smallest change, with fresh, verifiable context.
  const legacyText='I was studying because still is difficult to me this lesson.';
  const legacy=store.saveAnalysis({key:'legacy-tense-bank-regression',locale:'en-US',status:'issues',originalText:legacyText,correctedText:legacyText,model:'qwen3:8b',issues:[{category:'verb_tense',original:'still is difficult',replacement:'still was difficult',offset:legacyText.indexOf('still is difficult'),length:18,sentence:legacyText,explanation:'All subordinate verbs must use the same tense as the main verb.'}]});
  for(const mode of ['radar','repair','choice','order','pairs','judge']){
    const game=await games.create(legacy.issues[0].id,mode);assert.equal(game.mode,mode);
    const bank=store.game(game.id).privateData.bank;
    assert.ok(bank.items.length);assert.ok(bank.items.every(item=>/\b(yesterday|last night|last week)\b/i.test(item.bad)));
    assert.ok(bank.items.every(item=>item.original==='is'&&item.replacement==='was'));
    assert.ok(!bank.explanation.includes('All subordinate verbs'));
  }
  console.log('Regresión real: seis formatos disponibles para is → was, con contexto pasado explícito y sin copiar otros errores del original');
  const invalid={label:issue.label,explanation:issue.explanation,hint:'Prueba',items:[{bad:'I like coffee.',good:'I enjoy coffee.',original:'like',replacement:'enjoy',alternatives:[],alternateOrders:[]}]};
  const audited=await verifyBank(await validateBank(invalid,issue,engines,'en-US'),issue,engines,{locale:'en-US',model:'qwen3:8b'});assert.equal(audited.items.length,0);console.log('Auditoría real: rechaza convertir una frase correcta en un error');
  const swapped={...invalid,items:[{bad:'Every day the dog bite the man.',good:'Every day the dog bites the man.',original:'bite',replacement:'bites',alternatives:[],alternateOrders:['Every day the man bites the dog.']}]};
  const source={...issue,original:'bite',replacement:'bites',sentence:'Every day the dog bite the man.',explanation:'Con un sujeto singular, el verbo en presente lleva s.'};
  const meaning=await verifyBank(await validateBank(swapped,source,engines,'en-US'),source,engines,{locale:'en-US',model:'qwen3:8b'});assert.equal(meaning.items.length,1);assert.equal(meaning.items[0].alternateOrders.length,0);console.log('Auditoría real: rechaza invertir quién hace la acción');
  const correctTense={...invalid,items:[{bad:'I go to work.',good:'I went to work.',original:'go',replacement:'went',alternatives:[],alternateOrders:[]}]},pastSource={...issue,category:'verb_tense',original:'go',replacement:'went',sentence:'Yesterday I go home.'};
  const unchanged=await verifyBank(await validateBank(correctTense,pastSource,engines,'en-US'),pastSource,engines,{locale:'en-US',model:'qwen3:8b'});assert.equal(unchanged.items.length,0);console.log('Auditoría real: rechaza cambiar un presente que ya es correcto');
}finally{store.close();}
