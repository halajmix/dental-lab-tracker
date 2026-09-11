# noor — the case-coordinator agent

Design: `docs/agents/noor/`. This directory is the implementation.

## Run the tests (no database, no model, no network)

```bash
npm run noor:test      # unit + integration (Node 22+, native TypeScript)
npm run noor:check     # committed tool schemas and prompt == design docs
npm run noor:evals     # eval fixtures; model scenarios need ANTHROPIC_API_KEY
```

## Run locally in shadow mode

Shadow is the default (`NOOR_SHADOW` unset or anything but `false`): every
trigger runs, reads are real, and every would-be write — flag, clarification,
email, escalation, note — is recorded on the `agent_runs` row as `would_have`
instead of happening.

1. Apply `supabase/migrations/20260911_noor_phase2_schema.sql` in the SQL editor
   (additive; the flag stays **off**).
2. Deploy this function: Supabase → Edge Functions → new function named exactly
   `noor`, paste `index.ts` and its imports, **Verify JWT OFF**. Secrets it reads:
   `CASE_NOTIFY_SECRET`, `RESEND_API_KEY`, `SUPABASE_*` (already set), plus
   `ANTHROPIC_API_KEY` and optionally `NOOR_MODEL_ANSWER` (default `claude-opus-5`),
   `NOOR_MODEL_PHRASE` (default `claude-haiku-4-5`), `NOOR_EFFORT` (default `medium`).
3. Apply `20260911_noor_phase2_jobs.sql`.
4. `update feature_flags set enabled = true where key = 'noor.global';`
   `update labs set noor_enabled = true where id = '<pilot lab>';`
5. Watch `agent_runs` / `agent_tool_calls` (super-admin only). Flip the flag off to stop.

To leave shadow for one lab: set `NOOR_SHADOW=false` on the function and keep
`noor_enabled` true only for that lab.

## Layout

```
index.ts     entry: auth → gate → route by trigger        env.ts   the only Deno.env reader
gate.ts      kill switch · per-lab flag · idempotency · rate limit
runner.ts    manual tool loop: hard cap, timeouts, fail-closed, audit per call
llm.ts       Anthropic SDK adapter (strict tools, cached system prompt, fallbacks)
authz.ts     server-side tenancy re-check for every write tool
audit.ts     agent_runs / agent_tool_calls, redacted
context.ts   what the model may see, per trigger
tools/       registry (schemas.json == docs 03) + one file per tool
lib/         pure, runtime-agnostic: validate · benchmark · redact · templates · patterns · brief · prompt
jobs/        watch · brief · patterns — code only, no model
tests/       node --test
```

Roles 2, 3 and 6 never call a model. Roles 1 and 5 call the phrasing model
and fall back to a deterministic question / keyword mapping when no key is
configured, so the pipeline works end to end in shadow without a provider.
