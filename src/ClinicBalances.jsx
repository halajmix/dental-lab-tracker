import React, {useMemo, useState} from 'react';
import {clinicBalances} from './lib/clinicBalances.js';
const money = n => `${n.toLocaleString('en-GB', {maximumFractionDigits:3})} OMR`;
export default function ClinicBalances({statements, payments, clinicsById, loading, error, unbilled, onReview, paperBalanceAsOf}) {
  const [query,setQuery]=useState('');
  const accounts=useMemo(()=>clinicBalances(statements,payments,clinicsById,paperBalanceAsOf),[statements,payments,clinicsById,paperBalanceAsOf]);
  const visible=accounts.filter(a=>a.name.toLowerCase().includes(query.trim().toLowerCase()));
  const total=visible.reduce((n,a)=>n+a.remaining,0);
  const receipts=visible.reduce((n,a)=>n+a.unallocated,0);
  if(loading)return <p className="py-8 text-slate-500">Loading outstanding balances…</p>;
  if(error)return <p className="text-sm text-slate-500">Balances are unavailable until the billing data reloads successfully.</p>;
  return <section className="space-y-4">
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
      <p className="text-sm font-semibold text-blue-800">{query ? 'Matching clinics — recorded balance' : 'All clinics — recorded balance'}</p>
      <p className="mt-2 text-3xl font-bold text-blue-950">{money(total)}</p>
      <p className="mt-2 text-sm text-blue-800">{visible.length} clinic accounts. {paperBalanceAsOf ? `Paper opening balances cover work through ${paperBalanceAsOf}; earlier Excel bills are not added again.` : "Provisional until old balances and overlapping bills are reconciled."}</p>
    </div>
    <p className="text-sm text-slate-600">Old balance + Excel bills + Dr-Crown bills − payments applied = recorded balance. Columns below cover bills that still have a balance; settled bills remain in statement history.</p>
    {receipts > 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{money(receipts)} in receipts is not linked to bills. It is shown separately and has not been deducted again; some receipts may represent opening cash rather than clinic payments.</p>}
    {unbilled.count > 0 && <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{unbilled.count} completed Dr-Crown cases ({money(unbilled.total)}) still need billing. They are not included in the balance above.</p>}
    <input aria-label="Find clinic balance" placeholder="Find a clinic…" value={query} onChange={e=>setQuery(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[1050px] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr>{['Clinic','Old balance','Excel / paper bills','Dr-Crown bills','Payments applied','Recorded balance','Unlinked receipts','Review'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead>
        <tbody>{visible.map(a=><tr key={a.key} className="border-t border-slate-100">
          <td className="p-3 font-semibold">{a.name}{a.ambiguous && <p className="text-xs font-normal text-amber-700">Clinic name needs matching</p>}</td>
          {[a.opening,a.excel,a.platform,a.paid,a.remaining,a.unallocated].map((n,i)=><td key={i} className={`p-3 whitespace-nowrap tabular-nums ${i===4?'font-bold':''}`}>{money(n)}</td>)}
          <td className="p-3"><button onClick={()=>onReview(a)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-blue-700">View bills</button>{a.needsReview && <p className="mt-1 text-xs text-amber-700">Opening balance needs reconciliation</p>}</td>
        </tr>)}</tbody>
        <tfoot className="border-t bg-slate-50 font-semibold"><tr><td className="p-3">{query?'Matching total':'Total'}</td>{['opening','excel','platform','paid','remaining','unallocated'].map(k=><td key={k} className="p-3 whitespace-nowrap">{money(visible.reduce((n,a)=>n+a[k],0))}</td>)}<td /></tr></tfoot>
      </table>
      {!visible.length && <p className="p-5 text-sm text-slate-500">No matching outstanding clinic accounts.</p>}
    </div>
    <p className="text-xs text-slate-500">Imported names are grouped with a registered clinic only when the name matches uniquely. Different spellings stay separate until matched; no balances are moved or written off.</p>
  </section>;
}
