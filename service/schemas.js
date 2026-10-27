import {z} from 'zod';
export const category=z.enum(['articles','agreement','verb_tense','verb_form','prepositions','word_order','pronouns','spelling','capitalization','punctuation','other']);
export const aiIssueSchema=z.object({original:z.string().min(1).max(180),replacement:z.string().min(1).max(180),sentence:z.string().min(1).max(700),category,explanation:z.string().min(1).max(320),confidence:z.number().min(0).max(1)});
export const reviewSchema=z.object({isEnglish:z.boolean(),issues:z.array(aiIssueSchema).max(60),uncertain:z.boolean()});
export const bankItemSchema=z.object({bad:z.string().min(3).max(180),good:z.string().min(3).max(180),original:z.string().min(1).max(70),replacement:z.string().min(1).max(70),alternatives:z.array(z.string().min(1).max(70)).max(3),alternateOrders:z.array(z.string().min(3).max(180)).max(2)});
export const bankSchema=z.object({label:z.string().min(1).max(70),explanation:z.string().min(1).max(280),hint:z.string().min(1).max(220),items:z.array(bankItemSchema).min(1).max(3)});
export const improvementSchema=z.object({suggestions:z.array(z.object({after:z.string().min(1).max(6000),reason:z.string().min(1).max(260),goal:z.enum(['concision','clarity'])})).max(1)});
export const analyzeInput=z.object({text:z.string().min(1).max(6000),locale:z.enum(['en-US','en-GB']).default('en-US')});
export const settingsInput=z.object({locale:z.enum(['en-US','en-GB']).optional(),model:z.string().min(1).max(100).regex(/^[a-zA-Z0-9._:/-]+$/).optional(),saveTexts:z.boolean().optional()}).strict();
export const gameInput=z.object({issueId:z.string().uuid(),mode:z.enum(['radar','repair','choice','order','pairs','judge','jump','maze']),varied:z.boolean().optional(),continuous:z.boolean().optional(),excludeIssueIds:z.array(z.string().uuid()).max(100).optional()}).strict().superRefine((value,context)=>{
  if(value.varied&&value.mode!=='choice')context.addIssue({code:'custom',path:['varied'],message:'Varied rounds are only available in choice.'});
  if(value.continuous&&value.mode!=='choice')context.addIssue({code:'custom',path:['continuous'],message:'Continuous play is only available in choice.'});
  if(value.excludeIssueIds?.length&&!value.varied)context.addIssue({code:'custom',path:['excludeIssueIds'],message:'Excluded issues require a varied choice round.'});
});
export const attemptInput=z.object({idempotencyKey:z.string().min(8).max(100),checkpoint:z.number().int().min(0).max(3).optional(),answer:z.string().max(600).optional(),timedOut:z.literal(true).optional(),tokenIndex:z.number().int().min(0).max(100).optional(),tokenIds:z.array(z.number().int().min(0).max(100)).max(100).optional(),leftId:z.number().int().min(0).max(2).optional(),rightId:z.number().int().min(0).max(2).optional(),needsChange:z.boolean().optional()}).strict().superRefine((value,context)=>{
  if(value.timedOut&&['answer','tokenIndex','tokenIds','leftId','rightId','needsChange'].some(key=>value[key]!==undefined))context.addIssue({code:'custom',path:['timedOut'],message:'A timeout cannot include an answer.'});
});
export const gameActionInput=z.object({idempotencyKey:z.string().min(8).max(100),checkpoint:z.number().int().min(0).max(3),type:z.enum(['fall','collision','move','collect','undo','reset']),direction:z.enum(['up','down','left','right']).optional()}).strict().superRefine((value,context)=>{
  if((value.type==='move')!==(value.direction!==undefined))context.addIssue({code:'custom',path:['direction'],message:'Only movement requires a direction.'});
});
export const practiceRoundInput=z.object({issueId:z.string().uuid(),mode:z.enum(['choice','radar']),previousRoundId:z.string().uuid().optional(),idempotencyKey:z.string().uuid()}).strict();
export const practiceRoundNextInput=z.object({afterGameId:z.string().uuid()}).strict();
