import { clinicBalances, coveredByOpeningBalance } from './clinicBalances.js';
export const FINANCE_START = '2026-09-01';
export const normalizeClinic = s => String(s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export const omanDate = value => {
  const d = new Date(value);
  return value && Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-CA', {timeZone:'Asia/Muscat'}) : null;
};
// History can be newest-first. Only an actual completion event establishes a
// completion date; creation is never substituted for missing completion data.
export function workCompletedDate(c) {
  if (c.stageIndex < 3 || c.cancelStatus === 'cancelled') return null;
  return (c.history || []).filter(h => ['advance','created'].includes(h.action) && Number(h.toStage) === 3)
    .map(h => omanDate(h.at)).filter(Boolean).sort()[0] || null;
}
export function accountResolver(clinics, statements = []) {
  const names = new Map();
  for (const c of [...Object.values(clinics), ...statements.map(s => ({id:s.clinicId,name:s.clinicName}))]) {
    if (!c.id || !c.name) continue;
    const n=normalizeClinic(c.name); if(!names.has(n))names.set(n,new Set()); names.get(n).add(c.id);
  }
  return row => {
    const name=clinics[row.clinicId]?.name || row.clinicName || 'Unidentified clinic';
    const matches=names.get(normalizeClinic(name));
    const id=row.clinicId || (matches?.size===1 ? [...matches][0] : null);
    return {key:id?`id:${id}`:`name:${normalizeClinic(name)}`,name};
  };
}
export function workLedger(cases, statements, clinics, cutoff=FINANCE_START, history=false) {
  const resolve=accountResolver(clinics,statements), rows=[];
  const inPeriod = date => typeof date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && (history ? date < cutoff : date >= cutoff);
  for(const c of cases) {
    const date=workCompletedDate(c); if(!inPeriod(date))continue;
    const parts=c.prescription?.restorations?.length?c.prescription.restorations:[c.prescription || {}];
    const units=parts.reduce((n,r)=>n+(r.teeth?.length || 1),0);
    rows.push({...resolve(c),id:`case:${c.id}`,date,invoice:c.invoiceNumber || `INV-${c.id.replace(/^C-/,'')}`,patient:c.patientName || '',dentist:c.history?.find(h=>h.action==='created' && h.role==='dentist')?.by || c.prescription?.dentist || clinics[c.clinicId]?.dentist || '',procedure:parts.map(r=>[r.category,r.material].filter(Boolean).join(' — ')).join('; '),units,price:null,amount:c.totalPrice == null ? null:Number(c.totalPrice),source:'Dr-Crown',statementId:c.statementId,unbilled:!c.statementId && c.invoiceStatus!=='paid'});
  }
  for(const s of statements) {
    if(s.kind==='opening_balance')continue;
    // Digital statements already get their detail from cases, once only.
    if(s.clinicId)continue;
    for(const [i,line] of (s.lineItems || []).entries()) {
      if(!inPeriod(line.date))continue;
      rows.push({...resolve(s),...line,id:`line:${s.id}:${i}`,source:line.manualWorkId?'Paper entry':'Excel / paper',statementId:s.id,manualWorkId:line.manualWorkId,unbilled:false});
    }
  }
  const groups=new Map();
  for(const row of rows) {
    if(!groups.has(row.key))groups.set(row.key,{key:row.key,name:row.name,rows:[],total:0});
    const g=groups.get(row.key);g.rows.push(row);g.total+=Math.round(Number(row.amount || 0)*1000);
  }
  return [...groups.values()].map(g=>({...g,total:g.total/1000,rows:g.rows.sort((a,b)=>b.date.localeCompare(a.date))})).sort((a,b)=>a.name.localeCompare(b.name));
}
export function financeSummary(cases, statements, payments, clinics, paperAsOf, cutoff=FINANCE_START) {
  const resolve=accountResolver(clinics,statements), groups=new Map();
  const get=row=>{const a=resolve(row);if(!groups.has(a.key))groups.set(a.key,{...a,work:0,paid:0,remaining:0,unallocated:0,unbilled:0,unpriced:0,statementIds:[],active:false});return groups.get(a.key);};
  for(const s of statements)if(!coveredByOpeningBalance(s,paperAsOf)){const a=get(s);a.statementIds.push(s.id);if(s.kind!=='opening_balance' && s.month>=cutoff)a.active=true;}
  for(const g of workLedger(cases,statements,clinics,cutoff)) {
    if(!groups.has(g.key))groups.set(g.key,{key:g.key,name:g.name,work:0,paid:0,remaining:0,unallocated:0,unbilled:0,unpriced:0});
    const a=groups.get(g.key);a.work=g.total;a.active=true;
    for(const r of g.rows)if(r.unbilled){a.unbilled+=Math.round(Number(r.amount||0)*1000)/1000;if(r.amount==null)a.unpriced++;}
  }
  for(const a of clinicBalances(statements,payments,clinics,paperAsOf)) {
    if(!groups.has(a.key))groups.set(a.key,{key:a.key,name:a.name,work:0,paid:0,unbilled:0,unpriced:0});
    Object.assign(groups.get(a.key),{remaining:a.remaining,unallocated:a.unallocated,appliedToOpen:a.paid});
  }
  const byId=new Map(statements.map(s=>[s.id,s]));
  for(const p of payments)if(!p.voidedAt && !p.voided_at && p.receivedDate>=cutoff && p.statementId) {
    const s=byId.get(p.statementId);if(s && !coveredByOpeningBalance(s,paperAsOf)){get(s).paid+=Math.round(Number(p.amount)*1000)/1000;get(s).active=true;}
  }
  return [...groups.values()].filter(a=>a.active || a.remaining || a.unallocated).map(a=>({...a,statementIds:a.statementIds||[],status:a.remaining>0 ? (a.paid>0 || a.appliedToOpen>0?'Partially paid':'Unpaid') : a.unbilled>0 || a.unpriced>0 ? 'Needs billing' : 'Paid'})).sort((a,b)=>b.remaining-a.remaining || a.name.localeCompare(b.name));
}
