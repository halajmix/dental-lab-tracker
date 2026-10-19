import React,{useState} from 'react';
import SpeechAnswer from './SpeechAnswer.jsx';
import PatientNameInput from './PatientNameInput.jsx';
import {validPatientLabel} from './lib/patientLabel.js';
import NoorPrescriptionAssist from './NoorPrescriptionAssist.jsx';
import {matchSpokenLab,spokenAppointment} from './lib/rxGuide.js';
const button='rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const input='w-full rounded-lg border border-slate-300 bg-white p-2.5 text-base';
export default function GuidedPrescription({step,setStep,review,edit,form,setField,labs,onApply,api,onNext,files,onScans,onPhotos,onRemoveFile,sandbox}) {
 const [answer,setAnswer]=useState(''),[error,setError]=useState('');
 const [identityPart,setIdentityPart]=useState(validPatientLabel(form.patientName)?'lab':'patient');
 const changeStep=n=>{setAnswer('');setError('');setStep(n);};
 const usePatient=()=>{if(!validPatientLabel(form.patientName))return;setAnswer('');setIdentityPart('lab');};
 const useLab=()=>{
  const match=matchSpokenLab(answer,labs);
  if(!match){setError('Select the lab below to confirm the name.');return;}
  setField('labId',match.id);setAnswer('');setError('');
 };
 const useAppointment=()=>{
  const parsed=spokenAppointment(answer);
  if(!parsed.date||!parsed.time){setError('Say a full date and time, e.g. 2 November 2026 at 10 am, or use the fields below.');return;}
  setField('insertionDate',parsed.date);setField('appointmentTime',parsed.time);setAnswer('');setError('');
 };
 if(review)return <section aria-label="Review prescription" className="space-y-4 rounded-2xl border bg-white p-4 sm:p-5">
  <h4 className="text-lg font-semibold">Review prescription</h4>
  <div><button type="button" onClick={()=>edit(1)} className="float-right text-sm text-violet-700">Edit patient & lab</button><p className="font-semibold">{form.patientName}</p><p className="text-sm text-slate-600">{labs.find(l=>l.id===form.labId)?.name}</p></div>
  <div><button type="button" onClick={()=>edit(2)} className="float-right text-sm text-violet-700">Edit treatment</button>{form.treatment.map((r,i)=><div key={i} className="mb-2 rounded-xl bg-slate-50 p-3 text-sm"><p className="font-semibold">{r.category} · {r.teeth.map(t=>`${form.notation==='FDI'?t.fdi:t.universal}${t.role==='pontic'?' (pontic)':''}`).join(', ')}</p><p>{[r.material,r.vitaShade].filter(Boolean).join(' · ')}</p>{r.implantSystem&&<p>{[r.implantSystem,r.abutmentType,r.abutmentColor].join(' · ')}</p>}</div>)}</div>
  <div><button type="button" onClick={()=>edit(3)} className="float-right text-sm text-violet-700">Edit appointment & files</button><p className="font-semibold">{form.insertionDate} · {form.appointmentTime}</p><p className="text-sm text-slate-600">{files.length?files.map(f=>f.name).join(', '):'No files'}</p></div>
  {form.notes&&<p className="whitespace-pre-wrap text-sm" dir="auto">{form.notes}</p>}
  <p className="text-xs text-slate-500">{sandbox?'Confirm below to test. Nothing is sent.':'Submit when you have checked every detail.'}</p>
 </section>;
 return <section aria-label="Guided prescription" className="space-y-4 rounded-2xl border border-violet-100 bg-white p-4 sm:p-5">
  {step===1&&<>
   {identityPart==='patient'?<div className="space-y-4"><PatientNameInput value={form.patientName} onChange={v=>setField('patientName',v)}/><button type="button" disabled={!validPatientLabel(form.patientName)} onClick={usePatient} className={button}>Continue to lab</button></div>:<>
    <div className="flex items-center justify-between text-sm"><span>{form.patientName||'Patient name needed'}</span><button type="button" onClick={()=>{setIdentityPart('patient');setAnswer('');}} className="text-violet-700">Edit name</button></div>
    <SpeechAnswer prompt="Which laboratory?" value={answer} onChange={setAnswer}><button type="button" disabled={!answer.trim()} onClick={useLab} className={button}>Use lab name</button></SpeechAnswer>
    <label className="block text-sm font-medium">Laboratory<select aria-label="Laboratory" value={form.labId} onChange={e=>{setField('labId',e.target.value);setError('');}} className={'mt-1 '+input}><option value="">Select a lab</option>{labs.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
   </>}
   <div className="flex justify-end"><button type="button" disabled={!validPatientLabel(form.patientName)||!form.labId} onClick={()=>{setAnswer('');setError('');onNext(1);}} className={button}>Continue to treatment</button></div>
  </>}
  {step===2&&<>
   {form.treatment.length>0&&<div className="rounded-xl bg-slate-50 p-3 text-sm">{form.treatment.map((r,i)=><p key={i}>{r.category} · {r.teeth.map(t=>form.notation==='FDI'?t.fdi:t.universal).join(', ')} · {r.material} · {r.vitaShade}</p>)}<button type="button" onClick={()=>setField('assistMode','manual')} className="mt-2 text-violet-700">Edit in manual form</button></div>}
   <NoorPrescriptionAssist key={`${form.clinicId}:${form.labId}`} clinicId={form.clinicId} labId={form.labId} notation={form.notation} onApply={onApply} api={api}/>
   <div className="flex justify-between"><button type="button" onClick={()=>changeStep(1)} className="text-sm text-slate-600">Back</button><button type="button" disabled={!form.treatment.length} onClick={()=>{setAnswer('');onNext(2);}} className={button}>Continue to appointment</button></div>
  </>}
  {step===3&&<>
   <SpeechAnswer prompt="When is the patient’s next appointment?" hint="Date and time are required." value={answer} onChange={setAnswer}><button type="button" disabled={!answer.trim()} onClick={useAppointment} className={button}>Use appointment</button></SpeechAnswer>
   <div className="grid grid-cols-2 gap-3"><label className="text-sm font-medium">Date<input aria-label="Appointment date" type="date" required value={form.insertionDate} onChange={e=>setField('insertionDate',e.target.value)} className={'mt-1 '+input}/></label><label className="text-sm font-medium">Time<input aria-label="Appointment time" type="time" required value={form.appointmentTime} onChange={e=>setField('appointmentTime',e.target.value)} className={'mt-1 '+input}/></label></div>
   {form.insufficientTime&&<p role="alert" className="text-sm text-amber-800">The appointment is before the estimated ready date ({form.estReady}). Confirm timing with the lab.</p>}
   <fieldset className="border-t pt-4"><legend className="text-base font-semibold">Any STL files, PDFs or photographs?</legend><div className="mt-2 flex gap-2"><button type="button" aria-pressed={form.filesChoice===true} onClick={()=>setField('filesChoice',true)} className={`rounded-lg border px-4 py-2 text-sm ${form.filesChoice===true?'border-violet-500 bg-violet-50':''}`}>Add files</button><button type="button" disabled={files.length>0||form.shadePhotosRequired} aria-pressed={form.filesChoice===false} onClick={()=>setField('filesChoice',false)} className={`rounded-lg border px-4 py-2 text-sm disabled:opacity-50 ${form.filesChoice===false?'border-violet-500 bg-violet-50':''}`}>No files</button></div>
   {form.filesChoice===true&&<div className="mt-3 space-y-3"><label className="block text-sm">STL / PDF<input aria-label="Add STL or PDF" type="file" accept=".stl,.pdf" multiple onChange={e=>{onScans(e.target.files);e.target.value='';}} className="mt-1 block w-full text-sm"/></label><label className="block text-sm">Photographs<input aria-label="Add photographs" type="file" accept="image/*" multiple onChange={e=>{onPhotos(e.target.files);e.target.value='';}} className="mt-1 block w-full text-sm"/></label>{sandbox&&<p className="text-xs text-slate-500">Files stay in this test.</p>}</div>}
   {form.shadePhotosRequired&&<p className="mt-2 text-xs text-amber-800">Attach the shade reference photos you selected.</p>}
   {files.map(f=><div key={f.id} className="mt-2 flex items-center justify-between gap-2 text-sm"><span className="truncate">{f.name}{f.uploading?' · Uploading…':f.error?` · ${f.error}`:''}</span><button type="button" onClick={()=>onRemoveFile(f)} className="text-rose-700">Remove</button></div>)}
   </fieldset>
   <div className="flex justify-start"><button type="button" onClick={()=>changeStep(2)} className="text-sm text-slate-600">Back</button></div>
  </>}
  {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
 </section>;
}
