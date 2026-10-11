import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCcw, Clock, Download } from 'lucide-react';
import { supabase } from './lib/supabaseClient.js';
import { attendancePeriod, attendanceStateLabel, fetchAttendanceReportRows, omanDay } from './lib/attendanceReport.mjs';

export async function fetchAttendanceConnections(labId) {
  const { data, error } = await supabase.from('attendance_connections')
    .select('id,device_name,device_serial,enabled,last_received_at,employee_ids').eq('lab_id',labId);
  if (error) throw error;
  return data ?? [];
}
const fmtTime = value => value ? new Date(value).toLocaleString('en-GB', {timeZone:'Asia/Muscat',dateStyle:'medium',timeStyle:'short'}) : 'No punches received yet';

export default function AttendancePanel({lab}) {
  const [day,setDay]=useState(omanDay);
  const [connections,setConnections]=useState([]);
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [more,setMore]=useState(false);
  const [reportKind,setReportKind]=useState('week');
  const [reportDate,setReportDate]=useState(omanDay);
  const [reportMonth,setReportMonth]=useState(()=>omanDay().slice(0,7));
  const [reportStaff,setReportStaff]=useState('');
  const [staffOptions,setStaffOptions]=useState([]);
  const [exporting,setExporting]=useState(false);
  const [exportError,setExportError]=useState('');
  const [exportStatus,setExportStatus]=useState('');
  const requestId=useRef(0);
  const refresh=useCallback(async()=>{
    const current=++requestId.current;
    setLoading(true);setError('');
    try {
      const [links,result]=await Promise.all([
        fetchAttendanceConnections(lab.id),
        supabase.from('attendance_punches').select('id,employee_id,employee_name,punched_at,punch_state')
          .eq('lab_id',lab.id).gte('punched_at',`${day}T00:00:00+04:00`)
          .lt('punched_at',`${new Date(Date.parse(`${day}T00:00:00Z`)+86400000).toISOString().slice(0,10)}T00:00:00+04:00`)
          .order('punched_at',{ascending:false}).limit(501)
      ]);
      if(result.error) throw result.error;
      if(current!==requestId.current)return;
      setConnections(links);setRows((result.data??[]).slice(0,500));setMore((result.data??[]).length>500);
    } catch {if(current===requestId.current){setError('Attendance could not load. Please try again.');setRows([]);}}
    finally {if(current===requestId.current)setLoading(false);}
  },[lab.id,day]);
  useEffect(()=>{refresh();const timer=setInterval(refresh,60000);return()=>{requestId.current++;clearInterval(timer);};},[refresh]);
  useEffect(()=>{
    let cancelled=false;
    setStaffOptions([]);setReportStaff('');setExportError('');setExportStatus('');
    (async()=>{
      try {
        const links=await fetchAttendanceConnections(lab.id);
        const ids=[...new Set(links.flatMap(c=>c.employee_ids??[]))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
        const options=await Promise.all(ids.map(async id=>{
          const {data,error:staffError}=await supabase.from('attendance_punches').select('employee_name')
            .eq('lab_id',lab.id).eq('employee_id',id).order('punched_at',{ascending:false}).order('id',{ascending:false}).limit(1);
          if(staffError)throw staffError;
          return {id,label:data?.[0]?.employee_name||`Employee ${id}`};
        }));
        if(!cancelled)setStaffOptions(options);
      } catch {if(!cancelled)setExportError('Staff choices could not load. Refresh the page to try again.');}
    })();
    return()=>{cancelled=true;};
  },[lab.id]);
  let reportPeriod;
  try {reportPeriod=attendancePeriod(reportKind,reportKind==='week'?reportDate:reportMonth);} catch {reportPeriod=null;}
  const exportPdf=async()=>{
    if(!reportPeriod || exporting)return;
    setExporting(true);setExportError('');setExportStatus('');
    try {
      const generatedAt=new Date().toISOString();
      const reportRows=await fetchAttendanceReportRows(supabase,{labId:lab.id,period:reportPeriod,employeeId:reportStaff,cutoff:generatedAt});
      const {downloadAttendancePdf}=await import('./lib/attendancePdf.js');
      await downloadAttendancePdf({labName:lab.name,period:reportPeriod,employeeId:reportStaff,
        staffLabel:reportStaff?`${staffOptions.find(s=>s.id===reportStaff)?.label||`Employee ${reportStaff}`} (ID ${reportStaff})`:'All staff',
        rows:reportRows,generatedAt});
      setExportStatus(`PDF downloaded with ${reportRows.length} recorded punches.`);
    } catch {setExportError('The attendance PDF could not be downloaded. Please try again.');}
    finally {setExporting(false);}
  };
  return <section className="rounded-xl border border-slate-200 bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="flex items-center gap-2 font-bold text-slate-800"><Clock size={18}/>Staff attendance</h3>
        <p className="mt-1 text-sm text-slate-500">{lab.name} · Times shown in Oman time</p></div>
      <button disabled={loading} onClick={refresh} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"><RefreshCcw size={14}/>Refresh</button>
    </div>
    {connections.map(c=><div key={c.id} className="my-4 rounded-lg bg-slate-50 p-3 text-sm">
      <p className="font-semibold">{c.device_name} · Hikvision</p>
      <p className="mt-1 text-slate-600">{!c.enabled?'Awaiting device activation':c.last_received_at?`Last punch received: ${fmtTime(c.last_received_at)}`:'Activated · Waiting for the first device punch'}</p>
    </div>)}
    <div className="my-4 rounded-lg border border-slate-200 p-4">
      <h4 className="font-semibold text-slate-800">Download attendance PDF</h4>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">Period<select aria-label="PDF report period" disabled={exporting} value={reportKind} onChange={e=>{setReportKind(e.target.value);setExportStatus('');}} className="rounded-lg border p-2"><option value="week">Week</option><option value="month">Month</option></select></label>
        {reportKind==='week'?<label className="flex flex-col gap-1 text-sm">Any date in the week<input aria-label="PDF week date" type="date" required disabled={exporting} value={reportDate} onChange={e=>{setReportDate(e.target.value);setExportStatus('');}} className="rounded-lg border p-2"/></label>:<label className="flex flex-col gap-1 text-sm">Month<input aria-label="PDF month" type="month" required disabled={exporting} value={reportMonth} onChange={e=>{setReportMonth(e.target.value);setExportStatus('');}} className="rounded-lg border p-2"/></label>}
        <label className="flex flex-col gap-1 text-sm">Staff<select aria-label="PDF staff" disabled={exporting} value={reportStaff} onChange={e=>{setReportStaff(e.target.value);setExportStatus('');}} className="max-w-full rounded-lg border p-2"><option value="">All staff</option>{staffOptions.map(s=><option key={s.id} value={s.id}>{s.label} (ID {s.id})</option>)}</select></label>
        <button disabled={exporting||!reportPeriod} onClick={exportPdf} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Download size={16}/>{exporting?'Preparing PDF…':'Download PDF'}</button>
      </div>
      {reportPeriod&&<p className="mt-2 text-xs text-slate-500">{reportPeriod.start} to {reportPeriod.lastDay} · Oman time{reportKind==='week'?' · Monday to Sunday':''}</p>}
      {exportError&&<p role="alert" className="mt-2 text-sm text-rose-700">{exportError}</p>}
      {exportStatus&&<p role="status" className="mt-2 text-sm text-emerald-700">{exportStatus}</p>}
    </div>
    <label className="my-4 flex items-center gap-3 text-sm font-medium">Date<input aria-label="Attendance date" type="date" required value={day} onChange={e=>{if(e.target.value)setDay(e.target.value);}} className="rounded-lg border p-2"/></label>
    <p className="mb-3 text-xs text-slate-500">Recorded device punches. Missing punches do not establish absence, and unspecified punches are not classified as check-in or check-out.</p>
    {error?<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:loading?<p role="status" className="p-4 text-sm text-slate-500">Loading attendance…</p>:rows.length===0?<p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">No punches recorded for this date.</p>:<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-3">Staff</th><th className="p-3">Device employee ID</th><th className="p-3">Punch time</th><th className="p-3">Punch state</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} className="border-b"><td className="p-3 font-medium">{r.employee_name||`Employee ${r.employee_id}`}</td><td className="p-3">{r.employee_id}</td><td className="p-3">{fmtTime(r.punched_at)}</td><td className="p-3">{attendanceStateLabel(r.punch_state)}</td></tr>)}</tbody></table>{more&&<p className="mt-3 text-sm text-amber-700">Showing the latest 500 punches for this date.</p>}</div>}
  </section>;
}
