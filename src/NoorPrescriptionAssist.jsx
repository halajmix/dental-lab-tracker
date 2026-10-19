import React,{useState,useEffect,useRef} from 'react';
import {Sparkles,Loader2,Check} from 'lucide-react';
import {noorPrescriptionStatus,draftPrescriptionWithNoor} from './lib/data.js';
import SpeechAnswer from './SpeechAnswer.jsx';
import {RX_CATEGORIES} from '../supabase/functions/_shared/rxCatalog.ts';
const DEFAULT_API={status:noorPrescriptionStatus,draft:draftPrescriptionWithNoor};
const QUESTIONS=['Which tooth or teeth?','Which prosthesis or treatment?','Which material?','Which shade?'];
export default function NoorPrescriptionAssist({clinicId,labId,notation,onApply,api=DEFAULT_API}) {
 const [text,setText]=useState(''),[answers,setAnswers]=useState([]),[index,setIndex]=useState(0);
 const [preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[applied,setApplied]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(null);
 const [photoReference,setPhotoReference]=useState(false);
 const request=useRef(null),live=useRef(true);
 useEffect(()=>{live.current=true;let active=true;api.status(clinicId,labId).then(s=>{if(active)setStatus(s);}).catch(()=>{if(active)setError('Noor is unavailable. Switch to Manual to continue.');});return()=>{active=false;live.current=false;request.current?.abort();};},[clinicId,labId,api]);
 const prepare=async(transcript)=>{
  if(busy||!transcript.trim())return;
  setBusy(true);setError('');const controller=new AbortController();request.current=controller;
  try{const r=await api.draft(transcript,{clinicId,labId,notation,signal:controller.signal});if(live.current){setPreview(r.draft);setStatus(s=>({...s,platform_budget:r.platform_budget}));setText('');}}
  catch(e){if(live.current&&e.name!=='AbortError')setError('Noor could not prepare the treatment. Retry or switch to Manual.');}
  finally{if(live.current)setBusy(false);}
 };
 const next=(answer=text)=>{
  if(busy||!answer.trim())return;
  const line=`${index<4?QUESTIONS[index]:preview?.questions?.[0]||'Clarification'} ${answer.trim()}`;
  const updated=[...answers,line];
  if(updated.join('\n').length>4000){setError('Instructions are too long. Edit the answers below.');return;}
  setAnswers(updated);setText('');setError('');
  const canonical=Object.entries(RX_CATEGORIES).find(([name])=>name.toLowerCase()===answer.trim().toLowerCase());
  const skipSpecs=index===1&&canonical&&canonical[1].materials.length===0;
  if(index<3&&!skipSpecs)setIndex(index+1);else{setIndex(4);prepare(updated.join('\n'));}
 };
 const ready=status?.enabled&&Number(status?.platform_budget?.remaining_usd)!==0;
 const question=index<4?QUESTIONS[index]:preview?.questions?.[0]||'Add any missing treatment details.';
 const apply=()=>{try{onApply({...preview,requiresShadePhotos:photoReference});setApplied(true);setError('');}catch(e){setError(e.message);}};
 return <section aria-label="Noor prescription assistant" className="rounded-2xl border border-violet-200 bg-white p-4 sm:p-5">
  <div className="mb-4 flex items-center justify-between gap-2"><h4 className="flex items-center gap-2 font-semibold text-slate-800"><Sparkles size={17} className="text-violet-600"/> Noor</h4><span className="text-xs text-slate-500">{applied?'Treatment added':preview?.canApply?'Review treatment':`Treatment · ${Math.min(index+1,4)} of 4`}</span></div>
  {applied?<p className="flex items-center gap-2 text-sm text-emerald-700"><Check size={16}/> Treatment added. Continue to the appointment.</p>:preview?.canApply?<div className="space-y-3">
   {preview.items.map((r,i)=><div key={i} className="rounded-xl bg-slate-50 p-3 text-sm"><p className="font-semibold">{r.category} · {r.teeth.map(t=>`${preview.notation==='FDI'?t.fdi:t.universal}${t.role==='pontic'?' (pontic)':''}`).join(', ')}</p><p>{[r.material,r.vitaShade].filter(Boolean).join(' · ')}</p>{r.category.includes('implant')&&<p>{[r.implantSystem,r.abutmentType,r.abutmentColor].join(' · ')}</p>}</div>)}
   {preview.notes&&<p className="text-sm" dir="auto">{preview.notes}</p>}
   <div className="flex gap-2"><button type="button" onClick={apply} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white">Use treatment</button><button type="button" onClick={()=>{setPreview(null);setIndex(0);setAnswers([]);setText('');}} className="rounded-lg border px-3 py-2 text-sm">Start treatment again</button></div>
  </div>:<>
   <SpeechAnswer prompt={question} value={text} onChange={setText} disabled={busy||!ready} hint={index===0?`${notation}: e.g. 21, 23 or “upper right 4”. For an appliance, say the arch.`:index===3?'Say the shade and guide, or choose below.':''}>
    <button type="button" onClick={()=>next()} disabled={!ready||busy||!text.trim()} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy?<span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin"/> Checking…</span>:index<3?'Next':'Check treatment'}</button>
   </SpeechAnswer>
   {index===3&&<div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!ready||busy} onClick={()=>{setPhotoReference(false);next('Shade by Lab');}} className="rounded-lg border px-3 py-2 text-sm">Shade by lab</button><button type="button" disabled={!ready||busy} onClick={()=>{setPhotoReference(true);next('Shade by Lab; shade reference photographs will be attached. The laboratory must confirm the shade.');}} className="rounded-lg border px-3 py-2 text-sm">Use shade photos</button></div>}
   {index===4&&!preview&&answers.length>0&&!busy&&<button type="button" onClick={()=>prepare(answers.join('\n'))} className="mt-3 rounded-lg border px-3 py-2 text-sm">Retry treatment check</button>}
  </>}
  {answers.length>0&&!applied&&<details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Your answers</summary><textarea aria-label="Edit treatment answers" rows={4} maxLength={4000} value={answers.join('\n')} disabled={busy} onChange={e=>{setAnswers([e.target.value]);setPreview(null);setIndex(4);}} className="mt-2 w-full rounded-lg border p-2"/><button type="button" disabled={busy||!ready} onClick={()=>prepare(answers.join('\n'))} className="mt-2 rounded border px-3 py-2">Check changes</button></details>}
  {!status&&!error&&<p className="mt-3 text-xs text-slate-500">Connecting to Noor…</p>}
  {status&&!ready&&<p className="mt-3 text-sm text-amber-800">Noor is unavailable. Switch to Manual to continue.</p>}
  {error&&<p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
 </section>;
}
