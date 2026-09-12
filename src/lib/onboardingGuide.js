export const CLINIC_ROLE_LABELS = Object.freeze({ admin: 'Owner/Admin', doctor: 'Dentist', receptionist: 'Receptionist' });
export function onboardingGuide(role) {
  if (role === 'admin') return { title: 'Welcome to Dr-Crown', action: 'Send your first case', steps: ['Add your team from Settings → My Clinics → Team.', 'Choose a lab in New Prescription.', 'Select the treating dentist and send your first case.'] };
  if (role === 'receptionist') return { title: 'Send a case for a dentist', action: 'Start a prescription', steps: ['Choose the clinic and treating dentist.', 'Enter the prescription and choose the lab.', 'Submit on the dentist’s behalf. Your name is recorded separately.'] };
  if (role === 'doctor') return { title: 'Send your first case', action: 'Start a prescription', steps: ['Open a new prescription for your clinic.', 'Add the prescription details and choose a lab.', 'Send the case, then track its progress on your dashboard.'] };
  return null;
}
