// Patient identification is typed by the dentist. Only a blank entry is
// invalid; never impose a spelling, notation, character or name format.
export function validPatientLabel(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
