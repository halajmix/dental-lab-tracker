import { attendanceStateLabel } from './attendanceReport.mjs';

const dateLabel = day => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'});
const timeLabel = value => new Date(value).toLocaleTimeString('en-GB',{timeZone:'Asia/Muscat',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
const punchDate = value => new Date(value).toLocaleDateString('en-GB',{timeZone:'Asia/Muscat',day:'2-digit',month:'short',year:'numeric'});

// Canvas handles names beyond the built-in PDF font's character set without
// uploading names or fetching a third-party font. Ordinary text stays selectable.
function textLines(doc,text,width,size) {
  if (/^[\x20-\x7e]*$/.test(text))return doc.splitTextToSize(text,width);
  if(typeof document==='undefined')throw new Error('Unicode report text needs browser rendering.');
  const canvas=document.createElement('canvas');
  const scale=6;
  canvas.width=Math.ceil(width*scale);
  const context=canvas.getContext('2d');
  const px=size*25.4/72*scale;
  context.font=`${px}px sans-serif`;
  const lines=[];let line='';
  for(const char of text) {
    if(context.measureText(line+char).width>canvas.width && line){lines.push(line);line=char;}else line+=char;
  }
  if(line)lines.push(line);
  return {canvas,lines,px,scale};
}
function write(doc,text,x,y,width,size=9) {
  doc.setFont('helvetica','normal');doc.setFontSize(size);
  const result=textLines(doc,String(text),width,size);
  if(Array.isArray(result)){doc.text(result,x,y);return Math.max(1,result.length)*4.6;}
  const {canvas,lines,px,scale}=result;
  canvas.height=Math.ceil(Math.max(1,lines.length)*4.6*scale);
  const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
  context.fillStyle='#1e293b';context.font=`${px}px sans-serif`;context.textBaseline='top';
  lines.forEach((line,i)=>context.fillText(line,0,i*4.6*scale));
  doc.addImage(canvas.toDataURL('image/png'),'PNG',x,y-3.3,width,canvas.height/scale);
  return canvas.height/scale;
}

export function renderAttendancePdf(doc,{labName,period,staffLabel,rows,generatedAt=new Date().toISOString()}) {
  const margin=16;let y;
  const pageHeader=()=>{
    y=20;doc.setTextColor(30,41,59);
    y+=write(doc,labName||'Dental laboratory',margin,y,178,15)+4;
    doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text(`${period.kind==='week'?'Weekly':'Monthly'} staff attendance`,margin,y);y+=7;
    y+=write(doc,`${dateLabel(period.start)} - ${dateLabel(period.lastDay)} | Oman time (UTC+04:00)`,margin,y,178)+2;
    y+=write(doc,`Staff: ${staffLabel}`,margin,y,178)+2;
    y+=write(doc,`${rows.length} recorded punches | Generated ${punchDate(generatedAt)} ${timeLabel(generatedAt)}`,margin,y,178,8)+5;
    doc.setFillColor(241,245,249);doc.rect(margin,y-4,178,8,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(8);
    [['Staff',16],['Employee ID',78],['Date',103],['Time',132],['Punch state',158]].forEach(([label,x])=>doc.text(label,x,y));
    y+=8;
  };
  pageHeader();
  if(!rows.length) {write(doc,'No recorded punches for this staff selection and period.',margin,y,178);y+=10;}
  for(const row of rows) {
    doc.setFontSize(9);
    const name=row.employee_name||`Employee ${row.employee_id}`;
    const nameLines=textLines(doc,name,57,9);
    const idLines=textLines(doc,row.employee_id,20,8);
    const height=Math.max(8,(Array.isArray(nameLines)?nameLines.length:nameLines.lines.length)*4.6+3,(Array.isArray(idLines)?idLines.length:idLines.lines.length)*4.6+3);
    if(y+height>261){doc.addPage();pageHeader();}
    write(doc,name,16,y,57,9);write(doc,row.employee_id,78,y,20,8);
    write(doc,punchDate(row.punched_at),103,y,27,8);write(doc,timeLabel(row.punched_at),132,y,24,8);
    write(doc,attendanceStateLabel(row.punch_state),158,y,36,8);
    y+=height;doc.setDrawColor(226,232,240);doc.line(16,y-4,194,y-4);
  }
  const pages=doc.getNumberOfPages();
  for(let page=1;page<=pages;page++){
    doc.setPage(page);doc.setTextColor(100);doc.setFontSize(8);doc.setFont('helvetica','normal');
    doc.text(['Recorded punches only. Missing punches do not establish absence.','Unspecified punches do not establish check-in, check-out or hours worked.'],16,276);
    doc.text('Dr-Crown | Confidential attendance report',16,290);doc.text(`Page ${page} of ${pages}`,194,290,{align:'right'});
  }
  return doc;
}

export async function downloadAttendancePdf(options) {
  const {jsPDF}=await import('jspdf');
  const doc=renderAttendancePdf(new jsPDF({unit:'mm',format:'a4'}),options);
  const staff=options.employeeId?`staff-${options.employeeId.replace(/[^\w-]/g,'-')}`:'all-staff';
  doc.save(`attendance-${options.period.kind}-${options.period.start}-${staff}.pdf`);
}
