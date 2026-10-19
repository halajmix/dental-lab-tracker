import React,{useEffect,useRef,useState} from 'react';
import {patientLabelParts,formatPatientLabel} from './lib/patientLabel.js';

export default function PatientNameInput({value,onChange,invalid=false}) {
  const [parts,setParts]=useState(()=>patientLabelParts(value));
  const emitted=useRef(value);
  useEffect(()=>{if(value!==emitted.current){setParts(patientLabelParts(value));emitted.current=value;}},[value]);
  const change=(key,text)=>{
    const next={...parts,[key]:text};setParts(next);
    const label=formatPatientLabel(next.initial,next.surname);emitted.current=label;onChange(label);
  };
  const input=`mt-1 w-full rounded-lg border px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-violet-200 ${invalid?'border-rose-400':'border-slate-300'}`;
  return <fieldset aria-label="Patient identification" className="space-y-2">
    <legend className="text-base font-semibold text-slate-800">Patient identification</legend>
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
      <label className="text-sm font-medium">First-name initial<input type="text" aria-label="First-name initial" required maxLength={2} value={parts.initial} onChange={e=>change('initial',e.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="A" className={input}/></label>
      <label className="text-sm font-medium">Surname<input type="text" aria-label="Patient surname" required maxLength={100} value={parts.surname} onChange={e=>change('surname',e.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false} dir="auto" placeholder="Al Harthi" className={input}/></label>
    </div>
    {parts.initial&&!/^\p{L}\p{M}*\.?$/u.test(parts.initial.trim())&&<p role="alert" className="text-xs text-rose-700">Use one letter for the initial.</p>}
    <p className="text-xs text-slate-500">Type the initial and surname only, e.g. A. Al Harthi.</p>
  </fieldset>;
}
