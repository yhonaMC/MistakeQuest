import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
export const dataRoot=resolve(process.env.MQ_DATA_DIR||join(process.env.LOCALAPPDATA||join(homedir(),'.local','share'),'MistakeQuest'));
export const config={host:'127.0.0.1',port:Number(process.env.MQ_PORT||3210),dataRoot,dbPath:join(dataRoot,'data','mistakequest.sqlite'),ollamaUrl:'http://127.0.0.1:11434',languageToolUrl:'http://127.0.0.1:8081',defaultModel:'qwen3:8b',maxText:6000};
export class AppError extends Error{constructor(code,message,statusCode=400){super(message);this.code=code;this.statusCode=statusCode;}}
export const categoryLabels={articles:'Artículos',agreement:'Concordancia',verb_tense:'Tiempos verbales',verb_form:'Forma del verbo',prepositions:'Preposiciones',word_order:'Orden de palabras',pronouns:'Pronombres',spelling:'Ortografía',capitalization:'Mayúsculas',punctuation:'Puntuación',other:'Otra regla gramatical'};
export const modes=['radar','repair','choice','order','pairs','judge','jump'];
