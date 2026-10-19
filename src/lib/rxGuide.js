export const guideLabels = ['Patient & lab', 'Treatment', 'Appointment & files'];
const normalizeLab=s=>String(s||'').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const labWords=new Set(['dental','dentistry','lab','labs','laboratory','laboratories','centre','center']);
const brand=s=>normalizeLab(s).split(' ').filter(w=>!labWords.has(w)).join(' ');
function labUtterance(text) {
  return normalizeLab(text).replace(/^(?:please )?(?:select|choose|use|send to|send it to|send the case to|the lab is|the laboratory is) /,'').replace(/ please$/,'');
}
export function matchSpokenLab(text, labs) {
  const said=labUtterance(text);
  if(!said)return null;
  const exact=labs.filter(l=>normalizeLab(l.name)===said);
  if(exact.length)return exact.length===1?exact[0]:null;
  const key=brand(said);
  if(!key||key.length<4&&!said.split(' ').some(w=>labWords.has(w)))return null;
  // A shortened brand must identify one available lab, including branches.
  const compact=key.replace(/ /g,'');
  const possible=labs.filter(l=>brand(l.name).replace(/ /g,'').startsWith(compact));
  return possible.length===1&&brand(possible[0].name).replace(/ /g,'')===compact?possible[0]:null;
}
export function labFromAlternatives(alternatives, labs) {
  const first=alternatives?.[0];
  const primary=normalizeLab(typeof first==='string'?first:first?.transcript);
  if(/\b(not|no|or|except|instead|neither)\b/.test(primary))return {lab:null,ambiguous:true};
  const matches=new Map();
  for(const item of alternatives||[]){const lab=matchSpokenLab(typeof item==='string'?item:item.transcript,labs);if(lab)matches.set(lab.id,lab);}
  return {lab:matches.size===1?[...matches.values()][0]:null,ambiguous:matches.size>1};
}
function distance(a,b) {
  let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}
  return row[b.length];
}
export function suggestSpokenLabs(text,labs) {
  const said=labUtterance(text);if(!said||said.length>120)return [];
  const tokens=brand(said).split(' ').filter(w=>w.length>=4);
  return labs.map(l=>{
    const key=brand(l.name),words=key.split(' ');
    if(!tokens.some(w=>words.includes(w)))return {lab:l,score:0};
    const choices=[normalizeLab(l.name),key,key+' lab'];
    const score=Math.max(...choices.map(v=>1-distance(said,v)/Math.max(said.length,v.length)));
    return {lab:l,score};
  }).filter(x=>x.score>=0.6).sort((a,b)=>b.score-a.score).slice(0,3).map(x=>x.lab);
}
// Ambiguous numeric dates and relative dates are deliberately not guessed.
export function spokenAppointment(text) {
  const s=text.trim().toLowerCase();
  const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
  let date=s.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1]||'';
  const words=s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})\b/);
  if(!date&&words&&months.includes(words[2]))date=`${words[3]}-${String(months.indexOf(words[2])+1).padStart(2,'0')}-${words[1].padStart(2,'0')}`;
  const validDate=date&&!Number.isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
  const time=s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)||s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  let appointmentTime='';
  if(time){let h=Number(time[1]),m=Number(time[2]||0);if(time[3]){if(h>=1&&h<=12)h=h%12+(time[3]==='pm'?12:0);else h=-1;}if(h>=0&&h<24&&m<60)appointmentTime=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;}
  return {date:validDate?date:'',time:appointmentTime};
}
