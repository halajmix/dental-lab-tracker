export const attendanceStateLabel = value => ({checkIn:'Check-in',checkOut:'Check-out',breakOut:'Break out',breakIn:'Break in',overtimeIn:'Overtime in',overtimeOut:'Overtime out'})[value] ?? 'Unspecified';
export const omanDay = () => new Date(Date.now()+4*3600000).toISOString().slice(0,10);
const shiftDay = (day,n) => new Date(Date.parse(`${day}T00:00:00Z`)+n*86400000).toISOString().slice(0,10);

export function attendancePeriod(kind,value) {
  if (!['week','month'].includes(kind)) throw new Error('Choose a report period.');
  const day=kind==='month'?`${value}-01`:value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0,10)!==day) throw new Error('Choose a valid report date.');
  let start,end;
  if(kind==='week') {
    const weekday=new Date(`${day}T00:00:00Z`).getUTCDay();
    start=shiftDay(day,-((weekday+6)%7));end=shiftDay(start,7);
  } else {
    start=day;
    const next=new Date(`${day}T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
    end=next.toISOString().slice(0,10);
  }
  return {kind,start,end,lastDay:shiftDay(end,-1),from:`${start}T00:00:00+04:00`,until:`${end}T00:00:00+04:00`};
}

// Keyset pagination avoids both the API row cap and shifting pages while
// the terminal backfills history. Only records received before export are used.
export async function fetchAttendanceReportRows(db,{labId,period,employeeId='',cutoff=new Date().toISOString()}) {
  const rows=[];
  let lastId=0;
  for (;;) {
    let query=db.from('attendance_punches').select('id,employee_id,employee_name,punched_at,punch_state')
      .eq('lab_id',labId).gte('punched_at',period.from).lt('punched_at',period.until)
      .lte('received_at',cutoff).gt('id',lastId).order('id',{ascending:true}).limit(1000);
    if(employeeId) query=query.eq('employee_id',employeeId);
    const {data,error}=await query;
    if(error) throw error;
    const batch=data??[];
    rows.push(...batch);
    if(batch.length<1000)break;
    const nextId=batch.at(-1).id;
    if(nextId<=lastId)throw new Error('Attendance pagination did not advance.');
    lastId=nextId;
  }
  return rows.sort((a,b)=>a.employee_id.localeCompare(b.employee_id,undefined,{numeric:true}) || a.punched_at.localeCompare(b.punched_at) || a.id-b.id);
}
