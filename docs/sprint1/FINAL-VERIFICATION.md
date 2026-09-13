> Update: approved production rollout is complete, guidance OFF. See [PRODUCTION-ROLLOUT.md](PRODUCTION-ROLLOUT.md) for current status and live verification.

# Dr-Crown release status — 13 September 2026

The focused staging workflows and non-destructive client rollback rehearsal passed. Production has not been migrated or deployed. Targeted live catalog verification passed on 13 September; final owner approval remains required before release. See LIVE-PREFLIGHT.md.

## Implemented and prepared

The onboarding candidate preserves the existing treating-dentist roster, receptionist selector, invitation mechanisms, clinic role values and password authentication. It adds server-stamped Submitted By for new cases; historical cases retain their prior data/display. Owner/Admin, Dentist and Receptionist labels are clearer. Optional, role-specific guidance enrolls only accounts created after installation, supports Skip, and defaults off. Legacy unnamed dentist invitations remain accepted. A password-provider boundary prepares future additional login methods without enabling OTP or magic links.

Three security migrations were also prepared after reproduced staging findings:

- Restore protection for lab-owned invoice number, statement link, price-override marker and shade, retaining the discount/note protections.
- Prevent moving lab memberships between labs or reassigning an already claimed user, preserving invitation claiming and normal staff edits.
- Restrict platform-controlled clinic/lab status, visibility and rollout/finance settings to administrator/service-role operations; ordinary profile/settings edits remain available. Existing ownership is pinned for ordinary callers.

These change permissions, not stored historical data. The security findings were reproduced in the reconstructed staging schema; exact live function/policy definitions still need comparison. Packaged migrations have 5-second lock and 30-second statement timeouts. Source changes are on feature/sprint1-safe-onboarding: 69274f4 onboarding, 111aa87 security fixes/tests, 527a93a read-only preflight. No changes were pushed to the deployment branch.

## Verification

| Area | Evidence |
|---|---|
| Lab lifecycle, prices, discounts, billing, payments, remakes, receipt/invoice rendering | Final run: 78/78 |
| Authenticated previous-client rollback and switch forward, retaining new cases and files | 27/27 |
| Mobile upload through the local backend, storage, desktop polling, invalid/used/expired links | 43/43 |
| Additional historical displays: multiple restorations, named dentist, notes | 79/79 |
| Self-signup, pending approval, administrator activation, new-user guidance | Final report records 102/102 |
| Security fixes: before/after access checks | 17/17 after fixes; four checks failed before |
| Independent security migration regression | Passed in disposable PGlite using fictional records |
| Independent finance history, auto-billing and work-ledger database suites | All three passed; synthetic fixtures |
| Independent installed-app login-shell upgrade and rollback | Previous -> candidate -> previous, expected bundles and service worker; no page exceptions |
| Final original-record comparison | All 2,935 backed-up records still present; differences limited to intentional staging email/avatar substitutions and the new case column; no original clinical/financial value differences reported |
| Final original storage comparison | All 77 original files downloaded read-only from staging and hash-identical |

Earlier staging passes covered role logins, historical cases/files, 960 read-permission comparisons, receptionist submissions, invitation acceptance/local mail and new-user-only guidance. The final lab rerun corrected test timing, selectors and expectations for payments accumulated by prior test runs. Earlier failed runs were not counted as successful verification.

## Rollback procedure

1. Disable optional guidance. Preserve enrollment and dismissal records.
2. Republish the exact previous deployed Pages tree, commit 81559e0ca03e497d6176478a66a2f88985e3d840, retaining the candidate hashed assets alongside it for stale tabs. The saved archive and SHA-256 manifest accompany this report.
3. Keep additive schema, submitter identities, cases, invitations, files and security fixes. Do not apply an old schema or restore an older database over current production.
4. Verify both old and newly created cases, new submissions, invitations and files. The staging rehearsal covered these operations and returning to the candidate.

The previous deployed archive is for production rollback. Do not serve it against production during staging tests without replacing its backend configuration and blocking external traffic.

## Remaining release gates and limits

- Targeted live schema preflight completed through the signed-in dashboard; relevant definitions, policies, triggers and column types match the tested baseline. See LIVE-PREFLIGHT.md. Recheck if another actor changes production before release.
- Confirm a current provider recovery point immediately before rollout. This is a release safeguard, not a request to restart historical backup work. The accepted staging scope uses local test credentials; it does not prove production credential recovery or an exact full-database disaster restore.
- Obtain final owner approval for the concrete migrations/client and guide activation. Apply only reviewed migrations, not schema.sql. Start with guidance off and check controlled non-patient flows. Never run the mutating staging probe script against historical production rows.
- The current guide switch applies to all eligible new accounts; there is no per-clinic pilot allowlist. Keep it off until the intended activation scope is approved.
- Receipt and invoice UI plus print invocation were tested. Physical printer/driver output was not tested. No zero-error guarantee is made.
- Realtime and Noor were not live-equivalent in staging; polling worked and Noor remains shadow. External delivery, production password-reset mail, and destructive administrator operations were not exercised. Malformed non-multipart mobile-upload requests still return 500; valid upload tests pass.
- Keep staged source, private test data and production separate. No new historical backup was made in this pass and no production records were removed or overwritten.
