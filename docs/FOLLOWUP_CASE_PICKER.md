# All cases in the follow-up picker — 2026-09-18

The picker previously truncated the already-loaded case list to eight rows with an empty search and twenty matching rows while searching. Remove both caps. Display the total/matching count and keep the list scrollable with contained overscroll. Active and completed cases retain their existing ordering and access controls. The shared case fetcher already pages through database results, so no backend change is required.

Browser regression checks in Chromium and WebKit use 35 fictional cases on desktop and phone viewports: all rows appear, a broad search returns all 35, a completed case beyond row 20 can be selected, Change returns to the full list, scrolling reaches the last case, and clearing a no-match search restores all rows. Existing prescription scroll, identity and submission checks still pass. Both undefined-identifier checks and the production build pass; existing build warnings are unchanged. No production case writes were used.

Run `RX_BROWSERS=chromium,webkit npm run test:rx-browser`.

Prior Pages revision for rollback: `71d8266b5c383e51054c53b4e4b015b2975b9d83`. Existing hashed assets are retained during publication.
