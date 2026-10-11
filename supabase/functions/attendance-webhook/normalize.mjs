// Keep only attendance fields. Images, card numbers, biometric data, IPs,
// and the full device payload are never persisted or logged.
export function normalizeEvent(payload, allowedIds) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid event');
  if (!['AccessControllerEvent', 'attendance'].includes(payload.eventType)) return null;
  if (payload.eventState === 'inactive') return null;
  const event = payload.AccessControllerEvent ?? payload.AttendanceEvent ?? payload;
  if (event.currentVerifyMode === 'invalid' || event.verifyResult === 'failed') return null;
  const employeeId = String(event.employeeNoString ?? event.employeeNo ?? '').trim();
  if (!allowedIds.includes(employeeId)) return null;
  // A successful identity verification is necessary; access failures must
  // not turn into attendance. The terminal's actual payload is verified at activation.
  // Hikvision MAJOR_EVENT (5): legal card (0x01), fingerprint (0x26),
  // face (0x4b), employee number + face (0x4d), employee number + PIN (0x65).
  // Source: https://open.hikvision.com/hardware/structures/NET_DVR_ACS_ALARM_INFO.html
  const successCodes = new Set([1, 2, 16, 34, 38, 40, 43, 46, 54, 57, 60, 63, 66, 69, 72, 75, 77, 101]);
  if (payload.eventType === 'AccessControllerEvent' &&
      (Number(event.majorEventType) !== 5 || !successCodes.has(Number(event.subEventType)))) return null;
  let at = String(payload.dateTime ?? payload.time ?? event.dateTime ?? '').trim();
  // Terminal and lab are in Oman. Respect an explicit offset; use Oman only
  // for a device timestamp that omits it. Reject date-only/invalid input.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(at)) throw new Error('Invalid event time');
  const wallTime = at.slice(0,19);
  const wallDate = new Date(`${wallTime}Z`);
  if (!Number.isFinite(wallDate.getTime()) || wallDate.toISOString().slice(0,19)!==wallTime) throw new Error('Invalid event time');
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(at)) at += '+04:00';
  const timestamp = Date.parse(at);
  if (!Number.isFinite(timestamp)) throw new Error('Invalid event time');
  const iso = new Date(timestamp).toISOString();
  const state = String(event.attendanceStatus ?? 'unspecified').slice(0,64);
  return {
    employee_id: employeeId,
    employee_name: String(event.name ?? '').slice(0,200),
    punched_at: iso,
    punch_state: state,
    // Ignore retry counters: repeated delivery of the same punch is one row.
    event_identity: `${employeeId}|${iso}|${String(event.serialNo ?? '')}|${state}`,
  };
}

export async function readEvent(req) {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('multipart/form-data')) {
    const form = await req.formData();
    for (const value of form.values()) {
      if (typeof value === 'string' && value.trim().startsWith('{')) return JSON.parse(value);
      if (typeof value !== 'string' && (value.type.includes('json') || value.name.endsWith('.json'))) {
        return JSON.parse(await value.text());
      }
    }
    throw new Error('JSON event missing');
  }
  if (type.includes('json')) return req.json();
  throw new Error('Unsupported event format');
}
