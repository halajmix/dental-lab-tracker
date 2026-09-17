# Prescription scrolling and sole-dentist identity — 2026-09-17

The September 14 prescription change made a fieldset the modal's scroll container. A real wheel event reproduced the reported failure: the fieldset stayed at scrollTop 0 while the background page moved 650px.

A normal div now owns scrolling, with an explicit minimum height, contained overscroll, and viewport height limits. The fieldset remains inside it to disable controls during submission. Opening the prescription locks background scrolling; closing or unmounting restores prior overflow styles. Header and footer stay visible.

Legacy self-service dentists have an internal clinic admin role. When the active roster contains exactly one dentist linked to the signed-in user, the form automatically selects that existing identity and displays its name without a picker or Add a Dentist button. Multiple dentists, receptionists, unlinked invited dentists, empty rosters, and failed roster requests retain the existing selection/error behavior. Clinic switching revalidates against the new roster. No account roles, permissions, database schema, or clinical records are changed.

Validation:
- Chromium and WebKit: actual wheel scrolling at 1041×631, 1440×900, 390×844, and 320×568; background stays still, footer remains onscreen, no horizontal overflow, close/reopen restores/reapplies scroll lock.
- Both engines: sole-self identity, multi-dentist selection, receptionist, empty/invited roster, clinic switching, and roster request failure.
- Both engines: restore a fictional draft, navigate all three steps, submit the correct treating dentist ID/name, retain disabled fields and close controls during save, then close successfully.
- All API requests in the browser fixture are intercepted; no production clinical writes. No browser runtime errors.
- 45 existing client tests and both undefined-identifier checks pass. Production build succeeds with existing chunk warnings.

Reproduce: `npm ci`, `npx playwright install chromium webkit`, then `RX_BROWSERS=chromium,webkit npm run test:rx-browser`.

Release uses the current production public client configuration and retains prior hashed assets for open tabs. Previous Pages revision: `9c2b86c984ff225d32a35065a6e57d266149e564`. Roll back by restoring that website artifact; no database rollback is needed.

Published and verified:
- Source change `9b2bbe0`; Pages release `71d8266b5c383e51054c53b4e4b015b2975b9d83` completed successfully.
- Live `/assets/index-DHIqlTVJ.js` and `/assets/index-Bt0enRuA.css` match the production build byte-for-byte by SHA-256.
- Previous entry `/assets/index-BuHJW46u.js` remains available for already-open tabs.
- Live login renders with no browser runtime errors. Authenticated clinical interactions were checked using the isolated fixture, not a production patient submission.
- Both-engine regression suite also passes with the fixture in standards mode and an explicit mobile viewport meta tag.
