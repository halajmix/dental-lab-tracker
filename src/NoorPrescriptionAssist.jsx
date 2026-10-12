import React,{useState,useEffect,useRef} from 'react';
import {Sparkles,Mic,Square,Loader2,Check} from 'lucide-react';
import {noorPrescriptionStatus,draftPrescriptionWithNoor} from './lib/data.js';
const DEFAULT_API={status:noorPrescriptionStatus,draft:draftPrescriptionWithNoor};
export default function NoorPrescriptionAssist({clinicId,labId,notation,onApply,api=DEFAULT_API}) {
 const [text,setText]=useState(''),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[applied,setApplied]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(null),[listening,setListening]=useState(false),[interim,setInterim]=useState(''),[language,setLanguage]=useState('en-GB');
 const speech=useRef(null),timer=useRef(null),request=useRef(null),live=useRef(true);
 const Recognition=typeof window!=='undefined'&&(window.SpeechRecognition||window.webkitSpeechRecognition);
 useEffect(()=>{live.current=true;let active=true;api.status(clinicId,labId).then(s=>{if(active)setStatus(s);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;live.current=false;request.current?.abort();clearTimeout(timer.current);try{speech.current?.abort();}catch{}};},[clinicId,labId,api]);
 const change=value=>{setText(value);setPreview(null);setApplied(false);setError('');};
 const record=()=>{
  if(listening){try{speech.current?.stop();}catch{setListening(false);}clearTimeout(timer.current);return;}
  if(!Recognition)return;
  setError('');const rec=new Recognition();speech.current=rec;rec.lang=language;rec.continuous=true;rec.interimResults=true;
  rec.onresult=e=>{if(!live.current)return;let final='',pending='';for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)final+=e.results[i][0].transcript+' ';else pending+=e.results[i][0].transcript;}if(final){setText(t=>(t+' '+final).trim().slice(0,4000));setPreview(null);setApplied(false);}setInterim(pending);};
  rec.onerror=e=>{if(live.current){setListening(false);setInterim('');setError(e.error==='not-allowed'?'Microphone permission was not granted. You can type instead.':'Dictation stopped. Check the transcript, then type or try again.');}};
  rec.onend=()=>{if(live.current){setListening(false);setInterim('');}clearTimeout(timer.current);};
  try{rec.start();setListening(true);timer.current=setTimeout(()=>{try{rec.stop();}catch{}},45000);}catch{setError('Voice dictation is unavailable. Type your instructions instead.');}
 };
 const prepare=async()=>{
  if(busy||listening||!text.trim())return;
  setBusy(true);setError('');setPreview(null);setApplied(false);const controller=new AbortController();request.current=controller;
  try{const r=await api.draft(text,{clinicId,labId,notation,signal:controller.signal});if(live.current){setPreview(r.draft);setStatus(s=>({...s,platform_budget:r.platform_budget}));}}
  catch(e){if(live.current&&e.name!=='AbortError')setError(e.message);}
  finally{if(live.current)setBusy(false);}
 };
 const apply=()=>{try{onApply(preview);setApplied(true);setError('');}catch(e){setError(e.message);}};
 const budget=status?.platform_budget;
 return <section aria-label="Noor prescription assistant" className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm">
  <div className="flex flex-wrap items-center gap-2"><Sparkles size={17} className="text-violet-600"/><h4 className="font-bold text-slate-800">Describe the prescription to Noor</h4><span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700">Doctor preview</span></div>
  <p className="mt-1 text-sm text-slate-600">Speak or type the treatment, teeth, material and shade. Review the draft, then add it to your form. Noor never submits it.</p>
  <p className="mt-1 text-xs text-slate-500">Keep patient names and contact details in the patient section. Dictation may use your browser’s speech service; only the transcript you send is processed by Noor.</p>
  <label className="mt-3 block text-xs font-semibold text-slate-700" htmlFor="noor-rx-instructions">Treatment instructions · current notation: {notation}</label>
  <textarea id="noor-rx-instructions" value={text} onChange={e=>change(e.target.value)} disabled={busy} maxLength={4000} dir="auto" rows={3} placeholder="For example: FDI 26, monolithic zirconia crown, Vita Classical A2. " className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"/>
  {interim&&<p className="mt-1 text-sm italic text-slate-500" dir="auto">{interim}</p>}
  <div className="mt-2 flex flex-wrap items-center gap-2">
   <select aria-label="Dictation language" value={language} onChange={e=>setLanguage(e.target.value)} disabled={listening||busy} className="rounded-lg border border-slate-200 p-2 text-xs"><option value="en-GB">English</option><option value="ar-OM">العربية</option></select>
   <button type="button" onClick={record} disabled={!Recognition||busy} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${listening?'border-rose-300 bg-rose-50 text-rose-700':'border-slate-200 text-slate-700'} disabled:opacity-50`}>{listening?<Square size={14}/>:<Mic size={14}/>} {listening?'Stop dictation':'Dictate'}</button>
   <button type="button" onClick={prepare} disabled={busy||listening||!text.trim()||!status?.enabled||Number(status?.platform_budget?.remaining_usd)===0} className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{busy?<Loader2 size={14} className="animate-spin"/>:<Sparkles size={14}/>} {busy?'Preparing draft…':'Prepare draft'}</button>
   {budget&&<span className="text-xs text-slate-500">Platform allowance: ${Number(budget.remaining_usd).toFixed(2)} left of ${Number(budget.limit_usd).toFixed(2)} this month</span>}
  </div>
  {!Recognition&&<p className="mt-2 text-xs text-slate-500">Browser dictation is unavailable here. Use your keyboard’s microphone or type your instructions.</p>}
  {budget&&Number(budget.remaining_usd)===0&&<p className="mt-2 text-xs text-amber-700">The shared $15 monthly allowance is used. It resets on the first of next month in Oman time. You can still fill the form manually.</p>}
  {status&&!status.enabled&&<p className="mt-2 text-xs text-amber-700">Noor assistance is paused. You can fill the form manually.</p>}
  {error&&<p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
  {preview&&<div className="mt-3 rounded-xl bg-violet-50 p-3">
   <h5 className="text-sm font-bold text-violet-900">Review Noor’s draft · {preview.notation}</h5>
   {preview.items.map((r,i)=><div key={i} className="mt-2 rounded-lg bg-white p-3 text-sm text-slate-700"><p className="font-semibold">{r.category||'Treatment not specified'}</p><p>Teeth: {r.teeth.map(t=>`${preview.notation==='FDI'?t.fdi:t.universal}${t.role==='pontic'?' (pontic)':''}`).join(', ')||'Not specified'}</p><p>Material: {r.material||'Not specified / not required'}</p>{r.vitaShade&&<p>Shade: {r.shadeGuide} · {r.vitaShade}</p>}{r.implantSystem&&<p>Implant: {r.implantSystem} · {r.abutmentType}</p>}</div>)}
   {preview.notes&&<p className="mt-2 whitespace-pre-wrap text-sm" dir="auto">Notes: {preview.notes}</p>}
   {preview.appointmentDate&&<p className="mt-2 text-sm">Appointment: {preview.appointmentDate}</p>}
   {preview.questions.length>0&&<div className="mt-2 text-sm text-amber-900"><p className="font-semibold">Clarify before adding</p><ul className="list-disc pl-5">{preview.questions.map((q,i)=><li key={i} dir="auto">{q}</li>)}</ul><p className="mt-1">Add the answers to your instructions above, then prepare the draft again.</p></div>}
   <p className="mt-2 text-xs text-slate-600">Check tooth numbering, material, shade and any implant details. Existing patient details, lab selection and appointment are kept.</p>
   <button type="button" onClick={apply} disabled={!preview.canApply||applied} className="mt-3 flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{applied&&<Check size={14}/>} {applied?'Added to form':'Review complete — add to form'}</button>
  </div>}
 </section>;
}
