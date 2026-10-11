import test from 'node:test';
import assert from 'node:assert/strict';
import {attendancePeriod,fetchAttendanceReportRows} from '../src/lib/attendanceReport.mjs';
import {renderAttendancePdf} from '../src/lib/attendancePdf.js';
import {jsPDF} from 'jspdf';

test('weeks use Monday to Sunday across month and year boundaries in Oman',()=>{
  assert.deepEqual(attendancePeriod('week','2026-01-01'),{kind:'week',start:'2025-12-29',end:'2026-01-05',lastDay:'2026-01-04',from:'2025-12-29T00:00:00+04:00',until:'2026-01-05T00:00:00+04:00'});
  assert.equal(attendancePeriod('week','2026-10-11').start,'2026-10-05');
  assert.equal(attendancePeriod('week','2026-10-12').start,'2026-10-12');
});
test('months cover leap February and December with exclusive end boundaries',()=>{
  assert.equal(attendancePeriod('month','2024-02').lastDay,'2024-02-29');
  assert.equal(attendancePeriod('month','2026-12').until,'2027-01-01T00:00:00+04:00');
  assert.throws(()=>attendancePeriod('week','2026-02-30'));
  assert.throws(()=>attendancePeriod('month','2026-13'));
});
test('export fetches beyond API cap and confines every page to selected lab, dates and staff',async()=>{
  const calls=[];let page=0;
  const db={from(table){const filters={table};calls.push(filters);const q={select(){return q;},eq(k,v){filters[k]=v;return q;},gte(k,v){filters['gte:'+k]=v;return q;},lt(k,v){filters['lt:'+k]=v;return q;},lte(k,v){filters['lte:'+k]=v;return q;},gt(k,v){filters['gt:'+k]=v;return q;},order(){return q;},limit(){return q;},then(resolve){const count=page++===0?1000:7;const start=filters['gt:id'];return Promise.resolve({data:Array.from({length:count},(_,i)=>({id:start+i+1,employee_id:'2',employee_name:'Yusef',punched_at:'2026-10-05T10:00:00Z'})),error:null}).then(resolve);}};return q;}};
  const period=attendancePeriod('week','2026-10-05');
  const rows=await fetchAttendanceReportRows(db,{labId:'lab-one',period,employeeId:'2',cutoff:'2026-10-11T08:00:00Z'});
  assert.equal(rows.length,1007);assert.equal(calls[1]['gt:id'],1000);
  for(const call of calls){assert.equal(call.lab_id,'lab-one');assert.equal(call.employee_id,'2');assert.equal(call['gte:punched_at'],period.from);assert.equal(call['lt:punched_at'],period.until);assert.equal(call['lte:received_at'],'2026-10-11T08:00:00Z');}
});
test('failed report query rejects rather than exporting a partial report',async()=>{
  const q={select(){return q;},eq(){return q;},gte(){return q;},lt(){return q;},lte(){return q;},gt(){return q;},order(){return q;},limit(){return q;},then(resolve){return Promise.resolve({error:new Error('Denied')}).then(resolve);}};
  await assert.rejects(fetchAttendanceReportRows({from(){return q;}},{labId:'other',period:attendancePeriod('month','2026-10')}));
});
test('PDF repeats headers and footers across pages and supports empty periods',()=>{
  const period=attendancePeriod('month','2026-10');
  const options={labName:'Smile world dental lab',period,staffLabel:'All staff',rows:Array.from({length:105},(_,i)=>({employee_name:'Long staff name for readable wrapping in the attendance report',employee_id:'2',punched_at:'2026-10-05T05:00:00Z',punch_state:'undefined'}))};
  const pdf=renderAttendancePdf(new jsPDF(),options);
  assert.ok(pdf.getNumberOfPages()>1);
  const text=pdf.output();assert.ok(text.includes('Page 1 of'));assert.ok(text.includes('Monthly staff attendance'));assert.ok(text.includes('Unspecified'));
  const empty=renderAttendancePdf(new jsPDF(),{...options,rows:[]});assert.equal(empty.getNumberOfPages(),1);assert.ok(empty.output().includes('No recorded punches'));
});
