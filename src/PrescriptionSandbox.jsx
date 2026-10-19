import React from 'react';
import PrescriptionForm from './PrescriptionForm.jsx';

// Admin-only entry point: no impersonation, persistent draft identity, case
// save callbacks or email paths. Existing IDs supply read-only Noor context.
export default function PrescriptionSandbox({ clinics, labs, onClose }) {
  const contexts = clinics.filter(c => c.status === 'active').map(c => ({ ...c, myRole: 'doctor' }));
  const context = contexts.find(c => c.name.trim().toLowerCase() === 'testing platform') || contexts[0];
  if (!context) return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"><div role="dialog" aria-label="Test prescription" className="rounded-2xl bg-white p-5"><p>An active clinic is needed for test settings.</p><button type="button" onClick={onClose} className="mt-4 rounded-lg border px-4 py-2">Close test</button></div></div>;
  return <PrescriptionForm open sandbox onClose={onClose} labs={labs.filter(l => l.status === 'active')} clinics={contexts} defaultClinicId={context.id} authorName="Test dentist" />;
}
