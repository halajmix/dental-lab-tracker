import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCcw, Clock } from 'lucide-react';
import { supabase } from './lib/supabaseClient.js';

export async function fetchAttendanceConnections(labId) {
  const { data, error } = await supabase.from('attendance_connections')
    .select('id,device_name,device_serial,enabled,last_received_at').eq('lab_id',labId);
  if (error) throw error;
  return data ?? [];
}
const fmtTime = value => value ? new Date(value).toLocaleString('en-GB', {timeZone:'Asia/Muscat',dateStyle:'medium',timeStyle:'short'}) : 'No punches received yet';
const dayInOman = () => new Date(Date.now()+4*3600000).toISOString().slice(0,10);
const displayState = value => ({checkIn:'Check-in',checkOut:'Check-out',breakOut:'Break out',breakIn:'Break in',overtimeIn:'Overtime in',overtimeOut:'Overtime out',unspecified:'Unspecified'})[value] ?? 'Unspecified';

export default function AttendancePanel({lab}) {
  const [day,setDay]=useState(dayInOman);
  const [connections,setConnections]=useState([]);
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [more,setMore]=useState(false);
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
    <label className="my-4 flex items-center gap-3 text-sm font-medium">Date<input aria-label="Attendance date" type="date" required value={day} onChange={e=>{if(e.target.value)setDay(e.target.value);}} className="rounded-lg border p-2"/></label>
    <p className="mb-3 text-xs text-slate-500">Recorded device punches. Missing punches do not establish absence, and unspecified punches are not classified as check-in or check-out.</p>
    {error?<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:loading?<p role="status" className="p-4 text-sm text-slate-500">Loading attendance…</p>:rows.length===0?<p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">No punches recorded for this date.</p>:<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-3">Staff</th><th className="p-3">Device employee ID</th><th className="p-3">Punch time</th><th className="p-3">Punch state</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} className="border-b"><td className="p-3 font-medium">{r.employee_name||`Employee ${r.employee_id}`}</td><td className="p-3">{r.employee_id}</td><td className="p-3">{fmtTime(r.punched_at)}</td><td className="p-3">{displayState(r.punch_state)}</td></tr>)}</tbody></table>{more&&<p className="mt-3 text-sm text-amber-700">Showing the latest 500 punches for this date.</p>}</div>}
  </section>;
}
