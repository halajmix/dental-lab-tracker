// Shared by the dashboard and daily digest. No patient fields are accessed.
export function pickupMonitor(cases, clinics = [], labs = [], now = Date.now(), since = now - 86400000) {
  const clinicNames = new Map(clinics.map(c => [c.id,c.name]));
  const labNames = new Map(labs.map(l => [l.id,l.name]));
  const rows = cases.filter(c => (c.labId ?? c.lab_id) && (c.cancelStatus ?? c.cancel_status) !== 'cancelled').map(c => {
    const submittedAt=c.createdAt ?? c.created_at;
    const submitted=Date.parse(submittedAt);
    const stage=Number(c.stageIndex ?? c.stage_index);
    const pickupEvents=(c.history ?? []).filter(h=>h.action==='advance' && h.toStage===1 && Number.isFinite(Date.parse(h.at))).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
    const pickup=pickupEvents[0];
    const waiting=stage===0;
    return {id:c.id,clinic:clinicNames.get(c.clinicId ?? c.clinic_id)||'Unknown clinic',lab:labNames.get(c.labId ?? c.lab_id)||'Unknown lab',submittedAt,waiting,
      waitingHours:waiting && Number.isFinite(submitted)?Math.max(0,(now-submitted)/3600000):null,
      collectedAt:!waiting ? pickup?.at ?? null : null,
      collectedBy:!waiting ? pickup?.by ?? '' : '',
      newInPeriod:Number.isFinite(submitted) && submitted>=since && submitted<=now,
      collectedInPeriod:stage>=1 && !!pickup && Date.parse(pickup.at)>=since && Date.parse(pickup.at)<=now,
      status:waiting?'Awaiting collection':stage>=1?'Recorded as collected':'Status needs review'};
  });
  const waiting=rows.filter(r=>r.waiting).sort((a,b)=>(b.waitingHours??-1)-(a.waitingHours??-1));
  return {rows,waiting,newCases:rows.filter(r=>r.newInPeriod),collected:rows.filter(r=>r.collectedInPeriod),waitingOver24h:waiting.filter(r=>r.waitingHours>=24)};
}
export function pickupEmail(report, day) {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const groups=new Map();
  for(const row of report.rows){if(!row.waiting&&!row.newInPeriod&&!row.collectedInPeriod)continue;const group=groups.get(row.lab)||{new:0,collected:0,waiting:0};group.new+=Number(row.newInPeriod);group.collected+=Number(row.collectedInPeriod);group.waiting+=Number(row.waiting);groups.set(row.lab,group);}
  return `<div style="font-family:Arial,sans-serif;color:#334155;max-width:760px"><h2>Dr-Crown pickup summary — ${esc(day)}</h2><p>Past 24 hours: <b>${report.newCases.length}</b> new cases; <b>${report.collected.length}</b> recorded pickups. Currently waiting: <b>${report.waiting.length}</b> (${report.waitingOver24h.length} waiting 24 hours or more).</p><table cellpadding="8" style="border-collapse:collapse"><tr><th>Lab</th><th>New</th><th>Collected</th><th>Waiting</th></tr>${[...groups].map(([lab,g])=>`<tr><td>${esc(lab)}</td><td>${g.new}</td><td>${g.collected}</td><td>${g.waiting}</td></tr>`).join('')}</table><h3>Oldest cases awaiting collection</h3><ul>${report.waiting.slice(0,30).map(r=>`<li>${esc(r.id)} — ${esc(r.clinic)} → ${esc(r.lab)} (${r.waitingHours==null?'time unavailable':Math.floor(r.waitingHours)+' elapsed hours'})</li>`).join('')||'<li>No cases awaiting collection.</li>'}</ul>${report.waiting.length>30?'<p>Showing the oldest 30; the dashboard lists all waiting cases.</p>':''}<p>Collection is based on the lab’s recorded stage, not an independent pickup confirmation. Waiting time includes nights and weekends; it is not a missed-deadline calculation. Cancelled cases are excluded.</p><p><a href="https://dr-crown.com/">Open Dr-Crown → Pickup follow-up</a></p></div>`;
}
