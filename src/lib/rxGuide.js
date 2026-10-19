export const guideLabels = ['Patient & lab', 'Treatment', 'Appointment & files'];
export function matchSpokenLab(text, labs) {
  const normalize=s=>s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const exact=labs.filter(l=>normalize(l.name)===normalize(text));
  return exact.length===1?exact[0]:null;
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
