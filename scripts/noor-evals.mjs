// Eval harness for docs/agents/noor/05-evals.md. Fixtures live in
// docs/agents/noor/evals/*.json. Code-path scenarios run offline; model
// scenarios run only with ANTHROPIC_API_KEY and @anthropic-ai/sdk present,
// and are reported as SKIPPED otherwise — never silently passed.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "docs/agents/noor/evals");
const { validatePrescription, primaryIssue } = await import(join(root, "supabase/functions/noor/lib/validate.ts"));
const { benchmark } = await import(join(root, "supabase/functions/noor/lib/benchmark.ts"));
const { renderStatus } = await import(join(root, "supabase/functions/noor/lib/templates.ts"));
const { detectPatterns, observationText } = await import(join(root, "supabase/functions/noor/lib/patterns.ts"));
const { composeBrief } = await import(join(root, "supabase/functions/noor/lib/brief.ts"));

const check = (name, cond, why) => ({ name, pass: !!cond, why });
const results = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
  try {
    if (s.kind === "validate") {
      const issues = validatePrescription(s.input);
      const fields = issues.map((i) => i.field);
      const ok = s.expect.fields ? JSON.stringify(fields) === JSON.stringify(s.expect.fields) : true;
      const pi = primaryIssue(issues);
      results.push(check(s.id, ok && (!s.expect.primary || pi?.field === s.expect.primary) && (!s.expect.detailMatch || new RegExp(s.expect.detailMatch).test(pi?.detail ?? "")), `fields=${JSON.stringify(fields)}`));
    } else if (s.kind === "benchmark") {
      const b = benchmark({ ...s.input, now: new Date(s.input.now) });
      results.push(check(s.id, Object.entries(s.expect).every(([k, v]) => JSON.stringify(b[k]) === JSON.stringify(v)), `verdict=${b.verdict} confirmed=${b.overdue_confirmed} stale=${b.stale}`));
    } else if (s.kind === "template") {
      const r = renderStatus(s.template, s.summary, s.language, s.extra ?? {});
      const must = (s.expect.match ?? []).every((re) => new RegExp(re).test(r.subject + "\n" + r.text));
      const mustNot = (s.expect.noMatch ?? []).every((re) => !new RegExp(re).test(r.subject + "\n" + r.text));
      results.push(check(s.id, must && mustNot, r.subject));
    } else if (s.kind === "patterns") {
      const p = detectPatterns(s.remakes, s.volumes);
      const text = p.map((x) => observationText(x, 90, s.language ?? "en")).join(" ");
      results.push(check(s.id, p.length === s.expect.count && (s.expect.noMatch ?? []).every((re) => !new RegExp(re, "i").test(text)), `patterns=${p.length}`));
    } else if (s.kind === "brief") {
      const b = composeBrief(s.input);
      results.push(check(s.id, Object.entries(s.expect).every(([k, v]) => JSON.stringify(b[k].map((x) => x.case_id ?? x)) === JSON.stringify(v)), JSON.stringify(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.length])))));
    } else if (s.kind === "runner") {
      results.push({ name: s.id, pass: null, why: "model scenario — run with ANTHROPIC_API_KEY and @anthropic-ai/sdk installed (see README)" });
    }
  } catch (e) { results.push(check(s.id, false, e.message)); }
}
let pass = 0, fail = 0, skip = 0;
for (const r of results) { const tag = r.pass === null ? "SKIP" : r.pass ? "PASS" : "FAIL"; if (r.pass === null) skip++; else if (r.pass) pass++; else fail++; console.log(`${tag.padEnd(5)} ${String(r.name).padEnd(8)} ${r.why ?? ""}`); }
console.log(`\n${pass} passed · ${fail} failed · ${skip} skipped (model)`);
process.exit(fail ? 1 : 0);
