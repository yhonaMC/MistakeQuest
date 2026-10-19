import {buildApp} from './app.js';import {config} from './config.js';
const app=await buildApp();
try{await app.listen({host:config.host,port:config.port});console.log('MistakeQuest está disponible en http://'+config.host+':'+config.port);}catch(error){console.error('No se pudo iniciar MistakeQuest:',error.code||error.message);process.exitCode=1;await app.close();}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
