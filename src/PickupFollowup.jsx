import React, {useMemo,useState} from 'react';
import {pickupMonitor} from '../supabase/functions/_shared/pickupMonitor.js';
const stamp=v=>v?new Date(v).toLocaleString('en-GB',{timeZone:'Asia/Muscat',dateStyle:'medium',timeStyle:'short'}):'Not recorded';
export default function PickupFollowup({cases,clinics,labs}) {
  const [filter,setFilter]=useState('waiting');
  const [lab,setLab]=useState('');
  const now=Date.now();
  const today=new Date(now+4*3600000).toISOString().slice(0,10);
  const since=Date.parse(today+'T00:00:00+04:00');
  const report=useMemo(()=>pickupMonitor(cases,clinics,labs,now,since),[cases,clinics,labs,now,since]);
  const rows=(filter==='waiting'?report.waiting:filter==='new'?report.newCases:report.collected).filter(r=>!lab||r.lab===lab);
  return <section className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">{[['waiting','Awaiting collection',report.waiting.length],['new','Sent today',report.newCases.length],['collected','Recorded pickups today',report.collected.length]].map(([key,label,count])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)} className={`rounded-xl border p-4 text-left ${filter===key?'border-blue-400 bg-blue-50':'bg-white border-slate-200'}`}><span className="text-sm text-slate-600">{label}</span><strong className="mt-2 block text-2xl">{count}</strong><span className="text-xs text-slate-500">All labs</span></button>)}</div>
    <p className="text-sm text-slate-600">{report.waitingOver24h.length} cases have waited at least 24 elapsed hours. Time includes nights and weekends; this is a follow-up list, not a promised pickup deadline. Collection means the lab recorded “Picked Up by Lab.”</p>
    <select aria-label="Filter pickup lab" value={lab} onChange={e=>setLab(e.target.value)} className="rounded-lg border px-3 py-2 text-sm"><option value="">All labs</option>{[...new Set(report.rows.map(r=>r.lab))].sort().map(name=><option key={name}>{name}</option>)}</select>
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50"><tr>{['Case ID','Clinic','Lab','Sent (Oman time)','Status','Waiting / collected','Recorded by'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.id} className="border-t"><td className="p-3 font-semibold">{r.id}</td><td className="p-3">{r.clinic}</td><td className="p-3">{r.lab}</td><td className="p-3">{stamp(r.submittedAt)}</td><td className="p-3">{r.status}</td><td className="p-3">{r.waiting?(r.waitingHours==null?'Time unavailable':`${Math.floor(r.waitingHours)} hours`):stamp(r.collectedAt)}</td><td className="p-3">{r.collectedBy||'—'}</td></tr>)}</tbody></table>{!rows.length&&<p className="p-6 text-slate-500">No cases in this view.</p>}</div>
    <p className="text-xs text-slate-500">Dates use Oman time. Cancelled cases are excluded. This view refreshes every minute while open.</p>
  </section>;
}
