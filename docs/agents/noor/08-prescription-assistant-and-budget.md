# Dentist prescription pilot and platform budget — 13 October 2026

The owner requested a maximum of $15 per calendar month for all Noor AI across Dr-Crown and prioritized dentist prescription entry with voice and typed instructions. The Smile World pilot remains the rollout boundary. Existing Noor emails remain disabled.

## Budget

`noor_platform_budget` is service-only and cannot be configured above $15. All provider calls reserve their maximum estimated input/output cost under a locked monthly row before generation. Actual charges include cache reads and cache creation. Unknown failures keep the reservation; confirmed provider rejections release it. Existing unmetered runs have a conservative hold. Settlement updates the original reservation month and is idempotent. Oman midnight on the first of each month resets the allowance. The existing $2 lab daily guard remains additional protection. Monitoring without model calls continues at the monthly limit. Provider price changes require updating `budget.ts`.

## Prescription assistance

Available in the Treatment step of new prescriptions, for active doctor/admin clinic memberships sending to the pilot lab. Receptionists, lab accounts, other-clinic requests and non-pilot labs cannot generate drafts. The independent `noor.prescription_assist` flag can pause this feature without disabling manual entry. Migration creates this flag disabled; production was explicitly activated after real provider verification.

The assistant extracts treatment only, validates the shared form catalog and tooth notation, asks about missing material/shade/bridge roles, and returns a preview. The dentist must review and add it. No automatic submission, case mutation or emails occur. Patient identity, lab, dentist and existing appointment remain protected. Existing restorations are appended without duplicate teeth; an appliance cannot replace an existing treatment.

Dictation uses browser SpeechRecognition with English/Arabic language choices and an editable transcript. Browser availability varies and audio may go to the browser's speech service. Recording requires a deliberate click, stops after 45 seconds, and is cleaned up on close. Typed entry remains available. Only the submitted transcript is sent to Noor. Do not include patient identifiers in treatment instructions.

## Verification and authentication recovery

Anthropic returned authentication_error / invalid x-api-key. The console independently showed dr-crown-noor expired on 11 October. The owner created and saved a replacement in Supabase; workers were refreshed. Three live agent evals then passed (approximately $0.0255 total), followed by authenticated doctor checks for a complete crown, omitted material/shade, a bridge with explicit pontic/abutments, and foreign-clinic rejection. No real prescription was saved and temporary test sessions were closed. The old expired key was already inactive; no additional revocation was performed.

62 runtime tests and 9 existing UI tests pass. The database test exercises cross-lab/month cap, concurrent reservations, settlement isolation/idempotence, legacy accounting and privilege boundaries: `node tests/noorMonthlyBudget.mjs` (PGlite dev dependency). Deno type-check and production deployment checks passed. UI verification used a clearly labelled synthetic fixture: dictation transcript, missing details blocked, review adds exactly one restoration, repeat add disabled, patient/lab preserved. Actual microphone hardware was not tested; real model generation was verified separately.
