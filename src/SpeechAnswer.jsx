import React, { useEffect, useId, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import {collectSpeechResults} from './lib/speechResults.js';

// Voice stays in the browser. Only the treatment component sends a reviewed
// transcript to Noor; identity and appointment inputs never enter that request.
export default function SpeechAnswer({ prompt, value, onChange, disabled = false, children, hint = '', singleUtterance = false, replaceOnDictate = false, onFinal, onDictationStart }) {
  const id = useId(), speech = useRef(null), timer = useRef(null), latest = useRef({value,onChange,onFinal,onDictationStart});
  latest.current = {value,onChange,onFinal,onDictationStart};
  const [listening,setListening] = useState(false), [pending,setPending] = useState('');
  const [language,setLanguage] = useState('en-GB'), [mic,setMic] = useState(''), [error,setError] = useState('');
  const live = useRef(true), generation = useRef(0);
  const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  useEffect(() => {
    live.current = true;
    return () => { live.current=false;generation.current++; clearTimeout(timer.current); try {speech.current?.abort();} catch {} };
  }, []);
  useEffect(() => {
    generation.current++;
    try { speech.current?.abort(); } catch {}
    clearTimeout(timer.current); setListening(false); setPending(''); setError('');
  }, [prompt]);
  const enable = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {setError('Type your answer or use a browser with microphone support.'); return;}
    setMic('requesting'); setError('');
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      stream.getTracks().forEach(t=>t.stop());
      if(live.current)setMic('allowed');
    } catch {if(live.current){setMic('');setError('Allow microphone access in your browser settings, or type.');}}
  };
  const dictate = () => {
    if(listening){speech.current?.stop();return;}
    if(!Recognition)return;
    const turn=++generation.current;
    const rec=new Recognition();speech.current=rec; rec.lang=language;rec.continuous=!singleUtterance;rec.interimResults=true;rec.maxAlternatives=singleUtterance?5:1;
    const base=replaceOnDictate?'':latest.current.value;
    let receivedFinal=false, failed=false, alternatives=[];
    setError('');
    rec.onresult=e=>{
      if(!live.current||turn!==generation.current)return;
      const result=collectSpeechResults(e.results,base);alternatives=result.alternatives;
      if(result.hasFinal){receivedFinal=true;latest.current.value=result.text;latest.current.onChange(result.text);}
      setPending(result.interim);
    };
    rec.onstart=()=>{if(live.current&&turn===generation.current){setListening(true);setMic('allowed');}};
    rec.onerror=e=>{failed=true;if(live.current&&turn===generation.current){setError(e.error==='not-allowed'?'Allow the microphone in your browser settings, or type.':'Dictation stopped. Check your answer and try again.');setListening(false);setPending('');}};
    rec.onend=()=>{if(live.current&&turn===generation.current){clearTimeout(timer.current);setListening(false);setPending('');if(receivedFinal&&!failed)latest.current.onFinal?.(latest.current.value,alternatives);else if(singleUtterance&&!failed)setError('No speech was recognised. Try again or type the lab name.');}};
    try{latest.current.onDictationStart?.();if(replaceOnDictate){latest.current.value='';latest.current.onChange('');}rec.start();setListening(true);timer.current=setTimeout(()=>{try{rec.stop();}catch{}},45000);}catch{setError('Dictation is unavailable. You can type instead.');}
  };
  return <div className="space-y-3">
    <label htmlFor={id} className="block text-base font-semibold text-slate-800">{prompt}</label>
    {hint && <p className="text-xs text-slate-500">{hint}</p>}
    <textarea id={id} rows={2} maxLength={4000} value={value} disabled={disabled||listening} onChange={e=>onChange(e.target.value)} dir="auto" placeholder="Speak or type your answer…" className="w-full rounded-xl border border-slate-300 p-3 text-base outline-none focus:ring-2 focus:ring-violet-200" />
    {pending&&<p aria-live="polite" className="text-sm text-slate-500">{pending}</p>}
    <div className="flex flex-wrap gap-2">
      <select aria-label="Dictation language" value={language} onChange={e=>setLanguage(e.target.value)} disabled={disabled||listening} className="rounded-lg border bg-white p-2 text-sm"><option value="en-GB">English</option><option value="ar-OM">العربية</option></select>
      <button type="button" onClick={enable} disabled={disabled||listening||mic==='requesting'||mic==='allowed'} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{mic==='requesting'?'Allow access…':mic==='allowed'?'Mic enabled':'Enable mic'}</button>
      <button type="button" onClick={dictate} disabled={disabled||!Recognition||mic==='requesting'} className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{listening?<Square size={14}/>:<Mic size={14}/>} {listening?'Stop':'Dictate'}</button>
      <fieldset disabled={disabled||listening} className="contents">{children}</fieldset>
    </div>
    <details className="text-xs text-slate-500"><summary className="cursor-pointer">Voice privacy</summary><p className="mt-1">Your browser may process audio. Only treatment answers go to Noor.</p></details>
    {!Recognition&&<p className="text-xs text-slate-500">Use your keyboard microphone or type.</p>}
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
  </div>;
}
