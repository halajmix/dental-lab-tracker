// Permanent quadrant names are from the patient's perspective.
// Unrecognized or primary-tooth names remain untouched for clarification.
const positions:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8};
const quadrant:Record<string,number>={ur:1,ul:2,ll:3,lr:4,'upper right':1,'upper left':2,'lower left':3,'lower right':4};
export function normalizeSpokenToothNames(text:string):string {
 return text.replace(/\b(upper[ -]+right|upper[ -]+left|lower[ -]+left|lower[ -]+right|ur|ul|ll|lr)\s*(?:tooth\s*)?(one|two|three|four|five|six|seven|eight|[1-8])\b/gi,(_,q:string,n:string)=>{
  const side=quadrant[q.toLowerCase().replace(/[ -]+/g,' ')];
  const position=positions[n.toLowerCase()]??Number(n);
  return `FDI tooth ${side*10+position}`;
 });
}

import {UNIVERSAL_TO_FDI} from './rxCatalog.ts';
export function spokenToothReferences(text:string,notation:string) {
 const normalized=normalizeSpokenToothNames(text);
 const references=[...normalized.matchAll(/\bFDI\s*(?:tooth\s*)?(\d{1,2})\b|\btooth\s*(\d{1,2})\b/gi)].map(m=>{
  const number=Number(m[1]??m[2]);const fdi=m[1]||notation==='FDI'?number:(UNIVERSAL_TO_FDI as Record<number,number>)[number];
  const universal=Number(Object.entries(UNIVERSAL_TO_FDI).find(([,v])=>v===fdi)?.[0]);
  return {fdi,universal,outputNumber:notation==='Universal'?universal:fdi};
 });
 return references.filter(r=>r.universal>=1&&r.universal<=32);

}
export function enforceRxToothReferences<T extends {notation:string;items:{teeth:{fdi:number}[]}[];questions:string[];canApply:boolean}>(draft:T,instructions:string,sourceNotation=draft.notation):T {
 const questions=[...draft.questions];const ask=(q:string)=>{if(!questions.includes(q))questions.push(q);};
 const normalized=normalizeSpokenToothNames(instructions);
 if(/\b(?:left|right|upper|lower)\s*(?:tooth\s*)?(?:one|two|three|four|five|six|seven|eight|[1-8])\b/i.test(normalized))ask('Please specify both the jaw and side (upper/lower, right/left), or the exact FDI tooth number.');
 if(/\b(?:upper[ -]+right|upper[ -]+left|lower[ -]+left|lower[ -]+right|ur|ul|ll|lr)\s*(?:tooth\s*)?(?:\d+|[A-E])\b/i.test(normalized))ask('Please confirm the exact permanent FDI tooth numbers; this quadrant reference is unsupported or ambiguous.');
 for(const match of normalized.matchAll(/\bFDI\s*(?:tooth\s*)?(\d+)\b|\btooth\s*(\d+)\b/gi)){
  const number=Number(match[1]??match[2]);const valid=match[1]||sourceNotation==='FDI'?Object.values(UNIVERSAL_TO_FDI).includes(number):number>=1&&number<=32;
  if(!valid)ask(`Please confirm tooth ${number}; it is not supported in the stated notation.`);
 }
 for(const {fdi} of spokenToothReferences(instructions,sourceNotation))if(!draft.items.some(item=>item.teeth.some(t=>t.fdi===fdi)))ask(`The instructions mention FDI ${fdi}, but the draft does not match. Confirm the intended tooth numbers and prepare the draft again.`);
 return {...draft,questions,canApply:draft.canApply&&questions.length===0};
}
