import React, {useEffect,useMemo,useState} from 'react';
import {fetchStatements,fetchStatementLineItems,fetchPayments,fetchManualLabWork,saveManualLabWork,fetchPaperWorkClinics} from './lib/data.js';
import {workLedger,monthlyFinanceSummary,FINANCE_START,omanDate,workCompletedDate} from './lib/workLedger.js';
const money=n=>n==null?'—':`${Number(n).toLocaleString('en-GB',{maximumFractionDigits:3})} OMR`;
const field='w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';

export function PaperWorkForm({lab,clinicsById,onSaved,onClose,existing}) {
  const [id]=useState(()=>existing?.id || crypto.randomUUID());
  const [entry,setEntry]=useState(()=>existing?.entry || {clinicName:'',date:omanDate(new Date()),invoice:'',patient:'',dentist:'',procedure:'',units:'1',price:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [clinicNames,setClinicNames]=useState([]),[clinicsLoading,setClinicsLoading]=useState(true),[clinicError,setClinicError]=useState('');
  useEffect(()=>{let active=true;setClinicsLoading(true);setClinicError('');fetchPaperWorkClinics(lab.id,clinicsById).then(names=>{if(active)setClinicNames(names);}).catch(e=>{if(active)setClinicError('Could not load billing clinics: '+e.message);}).finally(()=>{if(active)setClinicsLoading(false);});return()=>{active=false;};},[lab.id]);
  const update=(key,value)=>setEntry(e=>({...e,[key]:value}));
  async function save(e){e.preventDefault();if(busy)return;if(!clinicNames.includes(entry.clinicName)){setError('Select a clinic from the list.');return;}setBusy(true);setError('');try{await saveManualLabWork(id,existing?.revision ?? null,entry);await onSaved?.();onClose();}catch(err){setError(err.message);}finally{setBusy(false);}}
  return <form onSubmit={save} className="space-y-4 rounded-2xl border border-blue-200 bg-white p-5">
    <h3 className="font-bold text-slate-800">{existing?'Correct paper work':'Add completed paper work'}</h3>
    <p className="text-sm text-slate-600">For physical prescriptions completed by {lab.name}. Saving adds this work and its unpaid bill once. Do not also upload this invoice from Excel or enter it as a Dr-Crown case.</p>
    {clinicError&&<p role="alert" className="text-sm text-red-700">{clinicError}</p>}
    {!clinicsLoading&&!clinicError&&!clinicNames.length&&<p className="text-sm text-amber-700">No clinics are available in this lab’s billing history yet.</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Clinic<select required disabled={clinicsLoading||!!clinicError} className={field} value={entry.clinicName} onChange={e=>update('clinicName',e.target.value)}><option value="">{clinicsLoading?'Loading billing clinics…':'Select a clinic'}</option>{clinicNames.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
      <label className="text-sm">Completion date<input required type="date" min={FINANCE_START} max={omanDate(new Date())} className={field} value={entry.date} onChange={e=>update('date',e.target.value)}/></label>
      {[['invoice','Invoice number',100],['patient','Patient',200],['dentist','Doctor',200],['procedure','Procedure',500]].map(([key,label,max])=><label key={key} className="text-sm">{label}<input required maxLength={max} className={field} value={entry[key]} onChange={e=>update(key,e.target.value)}/></label>)}
      <label className="text-sm">Units<input required type="number" min="1" max="1000" step="1" className={field} value={entry.units} onChange={e=>update('units',e.target.value)}/></label>
      <label className="text-sm">Price per unit (OMR)<input required type="number" min="0" max="100000" step="0.001" className={field} value={entry.price} onChange={e=>update('price',e.target.value)}/></label>
    </div>
    <p className="font-semibold">Total: {money(Math.round(Number(entry.units)*Number(entry.price)*1000)/1000)}</p>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex gap-2"><button disabled={busy||clinicsLoading||!clinicNames.includes(entry.clinicName)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy?'Saving…':'Save completed work'}</button><button type="button" disabled={busy} onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancel</button></div>
  </form>;
}

// Technicians can submit paper work without opening any clinic payment data.
export function TechnicianPaperWork({lab,clinicsById}) {
  const [open,setOpen]=useState(false),[done,setDone]=useState(false);
  if(!lab?.workLedgerEnabled)return null;
  return <div className="mb-4">{open?<PaperWorkForm lab={lab} clinicsById={clinicsById} onClose={()=>setOpen(false)} onSaved={()=>setDone(true)}/>:<button className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold text-blue-700" onClick={()=>{setOpen(true);setDone(false);}}>Add completed paper work</button>}{done&&<p role="status" className="mt-2 text-sm text-green-700">Paper work saved in All Work and billing.</p>}</div>;
}

export default function WorkLedger(props) {
  return props.lab ? <WorkLedgerContent {...props}/> : <p role="status" className="p-4 text-sm text-slate-500">Loading lab account…</p>;
}

function WorkLedgerContent({lab,clinicsById={},cases=[],summary=false,history=false,onReview}) {
  const [data,setData]=useState({statements:[],payments:[],manual:[]}),[busy,setBusy]=useState(true),[error,setError]=useState('');
  const [query,setQuery]=useState(''),[expanded,setExpanded]=useState(null),[form,setForm]=useState(null),[status,setStatus]=useState('all');
  const [month,setMonth]=useState(()=>omanDate(new Date()).slice(0,7));
  async function load(){setBusy(true);setError('');try{
    const [statements,lines,payments,manual]=await Promise.all([fetchStatements(lab.id),fetchStatementLineItems(lab.id),summary?fetchPayments(lab.id):Promise.resolve([]),fetchManualLabWork(lab.id)]);
    setData({statements:statements.map(s=>({...s,lineItems:lines.get(s.id)||[]})),payments,manual});
  }catch(e){setError('Could not load work records: '+e.message);}finally{setBusy(false);}}
  useEffect(()=>{load();},[lab.id,summary]);
  const groups=useMemo(()=>workLedger(cases,data.statements,clinicsById,FINANCE_START,history),[cases,data.statements,clinicsById,history]);
  const accounts=useMemo(()=>summary?monthlyFinanceSummary(cases,data.statements,data.payments,clinicsById,lab.paperBalanceAsOf,month):[],[summary,cases,data,clinicsById,lab.paperBalanceAsOf,month]);
  const visible=(summary?accounts:groups).filter(g=>g.name.toLowerCase().includes(query.trim().toLowerCase()) && (!summary || status==='all' || g.status===status));
  const undated=cases.filter(c=>c.stageIndex>=3&&c.cancelStatus!=='cancelled'&&!workCompletedDate(c)).length;
  const noDetail=data.statements.filter(s=>s.kind!=='opening_balance'&&!s.clinicId&&!s.lineItems.length&&(history?s.month<FINANCE_START:s.month>=FINANCE_START)).length;
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold text-slate-800">{summary?'Summary':history?'Completed work history':'All Work'}</h2>{!summary&&!history&&<button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white" onClick={()=>setForm({})}>Add completed paper work</button>}</div>
    <p className="text-sm text-slate-600">{summary?'Choose a month to see each clinic’s completed work and whether that month’s bills are paid, partially paid or unpaid. Payment status is current, including payments received later. Older debt remains in Outstanding Balances.':history?'Completed work before 1 September 2026. Payment status does not remove work.':'Work completed from 1 September 2026 onwards, grouped by clinic. Paid and unpaid work both stay here. Dates use Oman time.'}</p>
    {form&&<PaperWorkForm lab={lab} clinicsById={clinicsById} existing={form.id?form:null} onSaved={load} onClose={()=>setForm(null)}/>}
    {busy?<p className="text-sm text-slate-500">Loading…</p>:error?<div role="alert" className="text-red-700">{error}<button onClick={load} className="ml-3 underline">Retry</button></div>:<>
      {undated>0&&<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{undated} completed cases have no recorded completion date and cannot be placed in a date period. Review their case history.</p>}
      {noDetail>0&&<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{noDetail} paper bills have totals only, without dated work items. They remain in Billing{history?' history':''} and Outstanding Balances, but cannot supply itemized All Work rows.</p>}
      <div className="flex flex-wrap gap-3">{summary&&<label className="text-sm font-semibold">Month<input aria-label="Summary month" type="month" min="2026-09" className={field} value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/></label>}<input aria-label="Find work clinic" placeholder="Find a clinic…" className={field} value={query} onChange={e=>setQuery(e.target.value)}/>{summary&&<select aria-label="Payment status" className={field} value={status} onChange={e=>setStatus(e.target.value)}>{['all','Paid','Partially paid','Unpaid','Needs pricing','Review billing month'].map(s=><option key={s} value={s}>{s==='all'?'All payment statuses':s}</option>)}</select>}</div>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr>{(summary?['Clinic','Completed work','Paid toward this month’s bills','Unpaid for this month','Status','Review']:['Clinic','Work items','Total','Details']).map(h=><th key={h} className="whitespace-nowrap p-3">{h}</th>)}</tr></thead>
        <tbody>{visible.map(g=>summary?<tr key={g.key} className="border-t"><td className="p-3 font-semibold">{g.name}</td>{[g.work,g.paid,g.remaining].map((v,i)=><td key={i} className="whitespace-nowrap p-3">{money(v)}{i===2&&g.unpriced>0&&<span className="block text-xs text-amber-700">{g.unpriced} need pricing</span>}</td>)}<td className="p-3">{g.status}</td><td className="p-3"><button onClick={()=>onReview?.(g)} className="font-semibold text-blue-700">View bills</button></td></tr>:<React.Fragment key={g.key}>
          <tr className="cursor-pointer border-t hover:bg-blue-50" onClick={()=>setExpanded(expanded===g.key?null:g.key)}><td className="p-3 font-semibold">{g.name}</td><td className="p-3">{g.rows.length}</td><td className="whitespace-nowrap p-3 font-semibold">{money(g.total)}</td><td className="p-3"><button aria-expanded={expanded===g.key} className="font-semibold text-blue-700">{expanded===g.key?'Hide work':'View work'}</button></td></tr>
          {expanded===g.key&&<tr><td colSpan={4} className="p-3"><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-xs"><thead className="bg-slate-50 text-left"><tr>{['Completion date','Invoice','Patient','Doctor','Procedure','Units','Price','Total','Source',''].map((h,i)=><th className="p-2" key={i}>{h}</th>)}</tr></thead><tbody>{g.rows.map(r=><tr key={r.id} className="border-t">{[r.date,r.invoice,r.patient,r.dentist,r.procedure,r.units,money(r.price),money(r.amount),r.source].map((v,i)=><td className="p-2" key={i}>{v||'—'}</td>)}<td className="p-2">{r.unbilled&&<span className="text-amber-700">Needs billing</span>}{r.manualWorkId&&<button className="text-blue-700" onClick={()=>{const m=data.manual.find(w=>w.id===r.manualWorkId);if(m)setForm(m);}}>Edit</button>}</td></tr>)}</tbody></table></div><p className="mt-2 text-xs text-slate-500">Dr-Crown uses a case total; a separate unit price is shown only when recorded. Corrections to paid paper entries require the accountant to correct the payment first.</p></td></tr>}
        </React.Fragment>)}</tbody>
      </table>{!visible.length&&<p className="p-5 text-sm text-slate-500">No matching clinic records.</p>}</div>
      <p className="text-sm font-semibold">{summary?'Unpaid for selected month':'Completed work total'}: {money(visible.reduce((n,g)=>n+Math.round((summary?g.remaining:g.total)*1000),0)/1000)}</p>
      {summary&&<p className="text-xs text-slate-500">Completed work uses its completion month; bills use their billing month. “Paid” means that month’s recorded charges are settled. Imported paid bills may record settlement without a separate receipt. Unlinked receipts are not deducted. “Review billing month” flags older bills that include work from a different month, rather than guessing how their payments were allocated.</p>}
    </>}
  </section>;
}
