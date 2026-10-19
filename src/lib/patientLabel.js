// Patient identification is typed by the dentist, never extracted from speech
// or inferred from an existing full name.
export function validPatientLabel(value) {
  return /^\p{L}\p{M}*\. [\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u.test(String(value || '').normalize('NFC'));
}
export function patientLabelParts(value) {
  const match = String(value || '').normalize('NFC').match(/^(\p{L}\p{M}*)\.(?: (.*))?$/u);
  return match ? {initial:match[1],surname:match[2]||''} : {initial:'',surname:''};
}
export function formatPatientLabel(initial, surname) {
  const first=initial.trim().replace(/\.$/,'').normalize('NFC').replace(/[a-z]/g,c=>c.toUpperCase());
  return [first ? `${first}.` : '',surname.trim().replace(/\s+/g,' ').normalize('NFC')].filter(Boolean).join(' ');
}
