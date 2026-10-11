# Smile World attendance connection

Attendance is separate from application sign-in logs. Only lab administrators
and platform administrators can read it; client users cannot write punches or
read device credentials. No other lab has a connection configured by this release.

The Attendance tab queries a per-lab connection and raw punches, displays Oman
time, supports date selection, and refreshes every minute. It does not calculate
absence, lateness, hours or payroll from incomplete or unspecified punches.

## Deployment and activation

- Applied `20261011_lab_attendance.sql` to project `mtxkushcxczjwypwoxdh`.
- Deployed `attendance-webhook` with gateway JWT verification off. The handler
  verifies a 256-bit credential hash before accepting the body. There is no
  browser-accessible credential table or registration endpoint.
- Connection: Smile World lab `fb7401df-c26f-4f53-ab5a-a508ec490047`, terminal
  DS-K1T321MFWX20241227V030920ENGM9635172. Allowed device employee IDs: 1, 2, 3.
- The connection defaults to **disabled**. Activation requires approval for the
  terminal's new external connection and an actual device punch to verify delivery.
- Device UI: System and Maintenance → System Configuration → Network →
  Network Service → HTTP(S) → HTTP Listening. Destination domain:
  `mtxkushcxczjwypwoxdh.supabase.co`, port 443, protocol HTTPS. URL:
  `/functions/v1/attendance-webhook/<256-bit credential>`.
- Keep the credential out of Git, screenshots, reports and logs. Persist only
  its SHA-256 hash in `attendance_device_secrets`. Disable the connection server
  side to revoke it; rotate the hash and device URL when replacing a credential.
- Save metadata only: employee ID/name, timestamp, punch state. Incoming images
  are discarded. JSON or multipart JSON is supported; other formats fail closed.
- Major event 5 with Hikvision documented successful verification codes only.
  Unknown employees, failed verifications, inactive events and unrelated events
  are ignored. Source for event codes:
  https://open.hikvision.com/hardware/structures/NET_DVR_ACS_ALARM_INFO.html
- Replays deduplicate on connection + employee + timestamp + event serial + state.
- First activation must confirm a live successful fingerprint punch appears
  once under the correct lab and time, and that a repeat delivery cannot add a row.
  A deployment or synthetic fixture alone is not evidence of device connectivity.

## Validation

`node --test tests/attendance.test.mjs`: verification failure filtering, payload
minimization, replay identity, time offsets, invalid dates, multipart JSON.

`supabase/tests/attendance.sql`: rolled-back fixture proves replay uniqueness,
owner read access, denial to technicians/accountants/unrelated users, no browser
credential access, and no client punch fabrication. No test punches remain.

Frontend deployment uses the standard identifier checks and build, and retains
previous release assets for existing sessions. New Attendance UI must be inspected
in the signed-in Smile World support session after release.
