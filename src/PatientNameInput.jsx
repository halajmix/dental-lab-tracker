import React from 'react';

export default function PatientNameInput({value,onChange,invalid=false}) {
  return <label className="block text-sm font-medium">Patient Name
    <input type="text" aria-label="Patient Name" required aria-invalid={invalid} value={value} onChange={e=>onChange(e.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false} dir="auto" placeholder="Patient Name.." className={`mt-1 w-full rounded-lg border px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-violet-200 ${invalid?'border-rose-400':'border-slate-300'}`}/>
    {invalid&&<span className="mt-1 block text-xs text-rose-700">Enter a patient name or reference.</span>}
  </label>;
}
