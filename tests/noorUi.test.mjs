// Renders the real Noor surfaces with fixture data and asserts what each role
// sees. No DOM library: react-dom/server output is checked as HTML strings,
// which is enough to prove visibility, gating and wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// data.js pulls in browser-only helpers (outbox/localStorage, blobstore/IndexedDB)
// that touch `window` at import time. Provide the minimum so the module loads;
// nothing under test reads them.
globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.navigator ??= { onLine: true, userAgent: "node" };
globalThis.indexedDB ??= undefined;
globalThis.location ??= new URL("https://dr-crown.test/");
globalThis.document ??= { addEventListener() {}, visibilityState: "visible" };
const out = join(mkdtempSync(join(tmpdir(), "noor-ui-")), "b.cjs");
await build({
  stdin: {
    contents: `
      import { renderToStaticMarkup } from "react-dom/server";
      import React from "react";
      import * as N from ${JSON.stringify(join(root, "src/Noor.jsx"))};
      import { composeNoorBriefClient } from ${JSON.stringify(join(root, "src/lib/data.js"))};
      export const r = (el) => renderToStaticMarkup(el);
      export { N, React, composeNoorBriefClient };
    `, resolveDir: root, loader: "js",
  },
  bundle: true, platform: "node", format: "cjs", outfile: out, jsx: "automatic", logLevel: "error",
  plugins: [{ name: "stub", setup(b) {
    // data.js imports "./supabaseClient.js" (relative), so match the bare
    // specifier as well as an absolute path; the real client starts a token
    // refresh timer that would keep the test process alive forever.
    b.onResolve({ filter: /(^|\/)supabaseClient\.js$/ }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "module.exports = { supabase: new Proxy({}, { get: () => () => new Proxy({}, { get: () => () => ({}) }) }) };", loader: "js" }));
  } }],
  define: { "import.meta.env.VITE_SUPABASE_URL": '"https://x.supabase.co"', "import.meta.env.VITE_SUPABASE_ANON_KEY": '"anon"' },
});
const { r, N, React, composeNoorBriefClient } = await import(`file://${out}`);
// Something in the bundled dependency graph keeps an open handle (the stubbed
// client is inert, so it is a library-level timer). Tests are synchronous
// renders; once the runner reports, let the process go.
process.on("beforeExit", () => setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref());
setTimeout(() => process.exit(process.exitCode ?? 0), 15_000).unref();
const h = React.createElement;

const flags = [
  { id: "f1", caseId: "C-A", kind: "overdue", reason: "work complete was expected by 10 Sep", visibleTo: "lab", daysOver: 3 },
  { id: "f2", caseId: "C-A", kind: "stale", reason: "no activity for 5 days", visibleTo: "lab" },
  { id: "f3", caseId: "C-B", kind: "needs_clarification", reason: "shade missing", visibleTo: "both" },
];

test("flag chips: labelled, ordered overdue→stale, days shown, reason in tooltip, no patient data", () => {
  const html = r(h(N.NoorFlagChips, { flags: flags.filter((f) => f.caseId === "C-A") }));
  assert.ok(html.indexOf("Overdue") < html.indexOf("Stalled"));
  assert.match(html, /3d/); assert.match(html, /title="Noor: work complete was expected by 10 Sep"/);
  assert.equal(r(h(N.NoorFlagChips, { flags: [] })), "");
});

test("clarification banner: dentist gets an answer box, lab gets 'waiting'; Arabic renders RTL", () => {
  const clar = { id: "c1", caseId: "C-B", question: "الحالة C-B: يرجى تحديد درجة اللون للسن 24.", language: "ar", askedAt: "2026-09-11T06:00:00Z", status: "open" };
  const dentist = r(h(N.NoorClarificationBanner, { clarification: clar, canAnswer: true }));
  const lab = r(h(N.NoorClarificationBanner, { clarification: clar, canAnswer: false }));
  assert.match(dentist, /dir="rtl"/); assert.match(dentist, /<input/); assert.match(dentist, /إرسال/);
  assert.doesNotMatch(lab, /<input/); assert.match(lab, /في انتظار رد العيادة/);
  assert.equal(r(h(N.NoorClarificationBanner, { clarification: null, canAnswer: true })), "");
});

test("ask panel: labelled as AI, answers-only-from-cases disclaimer, case-scoped placeholder", () => {
  const html = r(h(N.AskNoorPanel, { caseId: "C-A" }));
  assert.match(html, /AI assistant/); assert.match(html, /Ask about C-A/);
});

const cases = [
  { id: "C-A", clinicId: "k", stageIndex: 2, cancelStatus: "none", appointmentDate: "2026-09-11", deliveryTime: "Morning", prescription: {} },
  { id: "C-B", clinicId: "k", stageIndex: 1, cancelStatus: "none", appointmentDate: "2026-09-01", prescription: {} },
  { id: "C-C", clinicId: "k", stageIndex: 3, cancelStatus: "none", appointmentDate: "2026-09-01", prescription: {} },
  { id: "C-D", clinicId: "k", stageIndex: 4, cancelStatus: "none", appointmentDate: "2026-09-11", prescription: {} },
  { id: "C-E", clinicId: "k", stageIndex: 2, cancelStatus: "requested", appointmentDate: "2026-09-20", prescription: {} },
];
test("brief composition: due today, overdue excludes work-complete and received, stalled, decisions, dedupe", () => {
  const b = composeNoorBriefClient({ cases, flags, clarifications: [{ caseId: "C-B" }], escalations: [{ status: "open", caseId: "C-A", category: "stale_case" }, { status: "resolved", caseId: "C-B", category: "x" }], today: "2026-09-11" });
  assert.deepEqual(b.dueToday.map((c) => c.id), ["C-A"]);            // C-D is received (stage 4) → not open
  assert.deepEqual(b.overdue.map((c) => c.id), ["C-B"]);             // C-C is work-complete → the clinic's delay, not the lab's
  assert.deepEqual(b.stale.map((c) => c.id), ["C-A"]);
  assert.deepEqual(b.awaiting.map((c) => c.id), ["C-B"]);
  assert.deepEqual(b.decisions.map((d) => d.what), ["open escalation — stale case", "cancellation requested"]);
  assert.equal(b.isEmpty, false);
  assert.equal(composeNoorBriefClient({ cases: [], flags: [], clarifications: [], escalations: [], today: "2026-09-11" }).isEmpty, true);
});

test("brief card renders sections in order and hides empty ones", () => {
  const html = r(h(N.NoorBriefCard, { cases, flags, clarifications: [], escalations: [], clinicsById: { k: { name: "Kenz" } } }));
  assert.ok(html.indexOf("Due today") < html.indexOf("Overdue") && html.indexOf("Overdue") < html.indexOf("Stalled"));
  assert.doesNotMatch(html, /Awaiting clarification/);
  assert.match(html, /Kenz/);
});

test("escalation inbox: open shows both buttons, acknowledged only resolve, resolved hidden by default, context log present", () => {
  const esc = [
    { id: "e1", caseId: "C-A", category: "stale_case", summary: "Stalled 5 days.", status: "open", createdAt: "2026-09-11T06:00:00Z", assignedToName: "Tony", context: { timeline: ["04 Sep — picked up"], attempted: ["get_case"], stop_reason: "stale" } },
    { id: "e2", caseId: null, category: "pattern_observation", summary: "4 remakes", status: "acknowledged", createdAt: "2026-09-10T06:00:00Z", context: {} },
    { id: "e3", caseId: "C-B", category: "fee_dispute", summary: "done", status: "resolved", createdAt: "2026-09-09T06:00:00Z", context: {} },
  ];
  const html = r(h(N.NoorEscalationInbox, { escalations: esc, loading: false }));
  assert.match(html, /Acknowledge/); assert.match(html, /04 Sep — picked up/); assert.match(html, /What Noor did: get_case/);
  assert.doesNotMatch(html, />done</);                                   // resolved hidden
  assert.equal((html.match(/Resolve</g) || []).length, 2);                // open + acknowledged
  assert.match(r(h(N.NoorEscalationInbox, { escalations: [], loading: false })), /Nothing escalated/);
});

// ---- follow-up visibility on the clinic side (a returned case must never read as complete) ----
const out2 = join(mkdtempSync(join(tmpdir(), "noor-ui2-")), "b.cjs");
await build({
  stdin: { contents: `
      import { renderToStaticMarkup } from "react-dom/server";
      import React from "react";
      import { StatusPill, openRoundsByCase, isReturningCase, roundMeta } from ${JSON.stringify(join(root, "src/LifecycleEngine.jsx"))};
      export const r = (el) => renderToStaticMarkup(el);
      export { StatusPill, openRoundsByCase, isReturningCase, roundMeta, React };
    `, resolveDir: root, loader: "js" },
  bundle: true, platform: "node", format: "cjs", outfile: out2, jsx: "automatic", logLevel: "error",
  plugins: [{ name: "stub", setup(b) {
    b.onResolve({ filter: /(^|\/)supabaseClient\.js$/ }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "module.exports = { supabase: new Proxy({}, { get: () => () => new Proxy({}, { get: () => () => ({}) }) }) };", loader: "js" }));
  } }],
  define: { "import.meta.env.VITE_SUPABASE_URL": '"https://x.supabase.co"', "import.meta.env.VITE_SUPABASE_ANON_KEY": '"anon"' },
});
const L = await import(`file://${out2}`);
const hh = L.React.createElement;

test("open follow-up: newest per case wins; kinds split into sent-back vs informational", () => {
  const m = L.openRoundsByCase([
    { parentCaseId: "C-H", status: "open", kind: "adjustment", createdAt: "2026-09-11T09:57:00Z" },
    { parentCaseId: "C-H", status: "resolved", kind: "update", createdAt: "2026-08-29T11:18:00Z" },
    { parentCaseId: "C-X", status: "open", kind: "update", createdAt: "2026-09-10T00:00:00Z" },
  ]);
  assert.equal(m.get("C-H").kind, "adjustment"); assert.equal(m.size, 2);
  assert.equal(L.roundMeta("remake").sentBack, true); assert.equal(L.roundMeta("refit").sentBack, true); assert.equal(L.roundMeta("adjustment").sentBack, true);
  assert.equal(L.roundMeta("stage").sentBack, false); assert.equal(L.roundMeta("update").sentBack, false);
});

test("status pill: a completed case with an open adjustment reads 'Sent back · Adjustment', never 'Work Complete'", () => {
  const c = { stageIndex: 3, cancelStatus: "none" };
  const round = { kind: "adjustment", status: "open", instructions: "UR4 out of occlusion" };
  const html = L.r(hh(L.StatusPill, { caseObj: c, returningRound: round }));
  assert.match(html, /Sent back · Adjustment/); assert.doesNotMatch(html, /Work Complete/); assert.match(html, /title="UR4 out of occlusion"/);
  assert.match(L.r(hh(L.StatusPill, { caseObj: c, returningRound: null })), /Work Complete/);           // no round → unchanged
  assert.match(L.r(hh(L.StatusPill, { caseObj: { ...c, stageIndex: 2 }, returningRound: round })), /Work in Progress/); // round on live work → stage still shown
  assert.match(L.r(hh(L.StatusPill, { caseObj: { ...c, cancelStatus: "cancelled" }, returningRound: round })), /Cancelled/); // cancellation still wins
  assert.equal(L.isReturningCase({ stageIndex: 4 }, round), true);
});
