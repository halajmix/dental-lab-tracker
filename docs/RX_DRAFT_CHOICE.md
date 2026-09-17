# Explicit prescription draft recovery — 2026-09-18

The patient-name field starts empty. However, the existing saved-draft restoration hydrated a previous patient name while the form was closed, and New Prescription opened that same mounted draft without explaining that it was a continuation. This can reproduce a persistent value such as `5`; the user's production draft was not inspected or modified.

New Prescription now asks whether to resume an existing unfinished prescription or discard it and start blank. The saved patient name is identified as draft content. The existing Resume shortcut still resumes directly. The choice also allows entering the follow-up flow without discarding the unfinished new prescription.

Discard-and-start-blank waits for queued draft saves, pauses new autosaves, and requires successful server deletion before clearing the form. Failed deletion leaves the draft intact with retry/resume options. The dialog and controls are disabled during deletion. No hard-coded value is removed, no patient record is edited, and names are not silently rewritten.

Validation: Chromium and WebKit reproduce a saved name of `5`, verify no patient input appears before choosing, failed deletion retains the draft, explicit resume keeps its exact contents, successful discard opens an empty patient name, reload keeps it empty, and the Resume shortcut preserves newly entered work. Existing case browsing, desktop/phone scroll and submission tests pass. Both identifier checks and production build pass. Phone dialog visually checked at 390×844. Tests use intercepted fictional data only.

The full follow-up picker was published in Pages revision `92c4102b3378ab8cca0aad01c9b76efbd8168d0c` and verified live before this update. This update preserves that fix. Prior hashed assets are retained; reverting to that revision rolls back only the draft-choice change.
