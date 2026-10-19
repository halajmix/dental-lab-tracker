import React, { useState } from "react";
import PrescriptionForm from "./PrescriptionForm.jsx";

// This mounts directly under Super Admin, without impersonation or any live
// case-save callback. Context IDs are only for Noor's existing read-only gates.
export default function PrescriptionSandbox({ clinics, labs, onClose }) {
  const contexts = clinics.filter(c => c.status === "active").map(c => ({ ...c, myRole: "doctor" }));
  const [clinicId, setClinicId] = useState("");
  if (!clinicId) return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="rx-test-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
      <h2 id="rx-test-title" className="text-lg font-bold">Test prescription</h2>
      <p className="mt-2 text-sm text-slate-600">Try voice or typed instructions with fictional patient details. Nothing is sent to a lab or saved as a case.</p>
      <label className="mt-4 block text-sm font-semibold">Clinic context
        <select className="mt-1 w-full rounded-lg border p-2" value="" onChange={e => setClinicId(e.target.value)}>
          <option value="" disabled>Select a clinic</option>
          {contexts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <p className="mt-2 text-xs text-slate-500">This uses the clinic’s form settings only. File uploads are disabled. Closing clears the test.</p>
      <button type="button" onClick={onClose} className="mt-4 rounded-lg border px-4 py-2">Close test</button>
    </div>
  </div>;
  return <PrescriptionForm open sandbox onClose={onClose} labs={labs.filter(l => l.status === "active")} clinics={contexts} defaultClinicId={clinicId} authorName="Test dentist" />;
}
