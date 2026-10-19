import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import {existsSync} from 'node:fs';import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {AppError,config} from './config.js';import {Store} from './store.js';import {Engines} from './engines.js';import {Reviewer} from './review.js';import {GameService,publicGame,modeInfo} from './games.js';
import {analyzeInput,settingsInput,gameInput,attemptInput} from './schemas.js';
import {practiceRoundInput,practiceRoundNextInput} from './schemas.js';import {PracticeRounds} from './practice-rounds.js';
export async function buildApp(options={}){
  const ownStore=!options.store,store=options.store||new Store(config.dbPath),engines=options.engines||new Engines(),reviewer=new Reviewer(store,engines),games=new GameService(store,engines);
  const rounds=new PracticeRounds(store,games);
  const app=Fastify({logger:options.logger||false,bodyLimit:65536,requestTimeout:0});
  app.decorate('store',store);
  app.addHook('onRequest',async(request,reply)=>{
    const host=request.headers.host||'';
    if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))throw new AppError('INVALID_HOST','Acceso permitido únicamente desde este PC.',403);
    const origin=request.headers.origin;
    if(origin&&origin!=='http://'+host)throw new AppError('INVALID_ORIGIN','La solicitud no pertenece a esta app local.',403);
    if(request.url.startsWith('/api/')&&!['GET','HEAD'].includes(request.method)){
      if(request.headers['x-mistakequest']!=='1')throw new AppError('INVALID_CLIENT','La solicitud no incluye la cabecera de la app.',403);
      if(!request.headers['content-type']?.startsWith('application/json'))throw new AppError('JSON_REQUIRED','La solicitud debe usar JSON.',415);
    }
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('Cross-Origin-Resource-Policy','same-origin').header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if(request.url.startsWith('/api/'))reply.header('Cache-Control','no-store');
  });
  app.setErrorHandler((error,request,reply)=>{
    if(error instanceof z.ZodError)return reply.code(400).send({error:{code:'INVALID_INPUT',message:error.issues.some(issue=>issue.code==='too_big')?'El texto o la respuesta supera el límite permitido.':'Revisa los datos de la solicitud.'}});
    const status=error.statusCode||500,code=error.code||'INTERNAL_ERROR';if(status>=500&&!(error instanceof AppError))app.log.error({code},'Unexpected local service error');
    return reply.code(status).send({error:{code,message:error instanceof AppError?error.message:status===413?'El texto supera el límite permitido.':'No se pudo completar la operación. Tus datos guardados siguen disponibles.'}});
  });
  async function cancellable(request,reply,callback){const controller=new AbortController(),close=()=>{if(!reply.raw.writableEnded)controller.abort();};reply.raw.once('close',close);try{return await callback(controller.signal);}finally{reply.raw.removeListener('close',close);}}
  app.get('/api/health',async()=>({app:'MistakeQuest',version:'1.0.0',database:true,...await engines.health(store.settings().model)}));
  app.get('/api/settings',async()=>({...store.settings(),dataDirectory:config.dataRoot,maxText:config.maxText}));
  app.patch('/api/settings',async request=>{const values=settingsInput.parse(request.body);if(values.model){const health=await engines.health(values.model);if(!health.models.some(model=>model.name===values.model&&!model.remote)||/cloud/i.test(values.model))throw new AppError('LOCAL_MODEL_REQUIRED','Elige un modelo local ya instalado.');}return store.updateSettings(values);});
  app.post('/api/analyze',async(request,reply)=>{const input=analyzeInput.parse(request.body);return cancellable(request,reply,signal=>reviewer.analyze(input.text,input.locale,signal));});
  app.post('/api/improvements',async(request,reply)=>{const input=analyzeInput.parse(request.body);return cancellable(request,reply,signal=>reviewer.improvements(input.text,input.locale,signal));});
  app.get('/api/modes',async()=>({modes:Object.entries(modeInfo).map(([id,value])=>({id,...value}))}));
  app.post('/api/practice-rounds',async(request,reply)=>{const input=practiceRoundInput.parse(request.body);return cancellable(request,reply,signal=>rounds.create(input,signal));});
  app.get('/api/practice-rounds/:id',async request=>rounds.get(request.params.id));
  app.post('/api/practice-rounds/:id/next',async request=>rounds.next(request.params.id,practiceRoundNextInput.parse(request.body).afterGameId));
  app.post('/api/games',async(request,reply)=>{const input=gameInput.parse(request.body);return cancellable(request,reply,signal=>games.create(input.issueId,input.mode,signal,{varied:input.varied,continuous:input.continuous,excludeIssueIds:input.excludeIssueIds}));});
  app.get('/api/games/:id',async request=>{const game=store.game(request.params.id);if(!game)throw new AppError('GAME_NOT_FOUND','Esta partida ya no está disponible.',404);return publicGame(game);});
  app.post('/api/games/:id/attempt',async(request,reply)=>{const answer=attemptInput.parse(request.body);const result=await cancellable(request,reply,signal=>games.attempt(request.params.id,answer,signal));const roundId=store.game(request.params.id)?.state.learningRoundId;return {...result,totals:store.progress().totals,...roundId?{practiceRound:rounds.get(roundId)}:{}};});
  app.post('/api/games/:id/hint',async request=>games.assist(request.params.id,false));
  app.post('/api/games/:id/reveal',async request=>games.assist(request.params.id,true));
  app.get('/api/progress',async()=>store.progress());
  app.get('/api/export',async(_request,reply)=>reply.header('Content-Disposition','attachment; filename="mistakequest-historial.json"').send(store.export()));
  app.delete('/api/data',async request=>{if(request.body?.confirmation!=='BORRAR')throw new AppError('CONFIRMATION_REQUIRED','Confirma el borrado desde los ajustes.');store.clearData();return {deleted:true,progress:store.progress()};});
  const dist=fileURLToPath(new URL('../dist/',import.meta.url));
  if(existsSync(dist)){await app.register(fastifyStatic,{root:dist,prefix:'/',wildcard:false});app.setNotFoundHandler((request,reply)=>{if(request.url.startsWith('/api/'))return reply.code(404).send({error:{code:'NOT_FOUND',message:'Esta ruta no existe.'}});return reply.header('Cache-Control','no-cache').sendFile('index.html');});}
  else app.get('/',async()=>({app:'MistakeQuest',message:'Ejecuta npm run build para preparar la interfaz.'}));
  app.addHook('onClose',async()=>{if(ownStore)store.close();});return app;
}
