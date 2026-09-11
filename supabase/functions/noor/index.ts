import { createClient } from "jsr:@supabase/supabase-js@2";
import { readEnv } from "./env.ts";
import { noorEnabled, claimIdempotency, withinRateLimit, idempotencyKeyFor } from "./gate.ts";
import { makeAudit } from "./audit.ts";
import { createLlm } from "./llm.ts";
import { runAgent } from "./runner.ts";
import { liveExecutor } from "./tools/index.ts";
import { buildSystemPrompt, callerBlock } from "./lib/prompt.ts";
import { validatePrescription, primaryIssue } from "./lib/validate.ts";
import { templateForStage, renderStatus } from "./lib/templates.ts";
import { stageOf } from "./lib/types.ts";
import type { Caller, CaseRow, Language, LlmClient, ToolContext, Trigger } from "./lib/types.ts";
import { intakeContext, questionContext, remakeContext } from "./context.ts";
import { loadSummary } from "./tools/get_case.ts";
import { sendStatusUpdate } from "./tools/send_status_update.ts";
import { requestClarification } from "./tools/request_clarification.ts";
import { recordRemakeReason } from "./tools/record_remake_reason.ts";
import { resolveFlag } from "./tools/flag_case_risk.ts";
import { runWatch } from "./jobs/watch.ts";
import { runBrief } from "./jobs/brief.ts";
import { runPatterns } from "./jobs/patterns.ts";

/**
 * Noor — the case-coordinator agent. One function, three kinds of caller:
 *   - database webhooks (cases / case_rounds / case_clarifications) → shared secret
 *   - pg_cron via private.run_noor(trigger)                          → shared secret
 *   - a signed-in user asking a question                              → Supabase JWT
 * Deploy with Verify JWT OFF (the secret and the JWT are checked here).
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
const traceId = () => `nr_${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`;

type Body = { source?: string; trigger?: string; type?: string; table?: string; record?: Record<string, unknown>; old_record?: Record<string, unknown> | null; question?: string; case_id?: string };

function classify(b: Body): Trigger | null {
  if (b.source === "pg_cron" && b.trigger) return b.trigger as Trigger;
  if (b.table === "cases" && b.type === "INSERT") return "prescription_submitted";
  if (b.table === "cases" && b.type === "UPDATE") {
    if (b.old_record && b.record && b.old_record.stage_index !== b.record.stage_index) return "stage_changed";
    if (b.old_record && b.record && JSON.stringify(b.old_record.remake ?? null) !== JSON.stringify(b.record.remake ?? null)) return "remake_recorded";
    return null;
  }
  if (b.table === "case_rounds" && b.type === "INSERT") return "remake_recorded";
  if (b.table === "case_clarifications" && b.type === "UPDATE") return "clarification_answered";
  if (typeof b.question === "string") return "user_question";
  return null;
}

const REMAKE_KEYWORDS: Array<[RegExp, "clinical" | "laboratory", string]> = [
  [/shade|colou?r|لون/i, "laboratory", "shade_mismatch"], [/margin.*(open|die)|open margin/i, "laboratory", "open_margin_on_die"],
  [/contact/i, "laboratory", "proximal_contacts"], [/framework|fit(ting)? error|doesn'?t fit|لا يثبت/i, "laboratory", "framework_fitting_error"],
  [/fractur|chip|كسر/i, "laboratory", "porcelain_fracture"], [/prep|margin distort|unclear/i, "clinical", "margin_distortion_unclear_prep"],
  [/clearance|occlus/i, "clinical", "insufficient_occlusal_clearance"], [/drag|impression/i, "clinical", "impression_drag"],
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(null, 204);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const env = readEnv();
  const admin = createClient(env.supabaseUrl, env.serviceKey);
  const now = new Date();
  // ---- authenticate FIRST, by credential type, before the body decides anything ----
  // A shared secret marks a database/cron caller; a Bearer JWT marks a user.
  // Neither present → 401 before a single byte of the body is interpreted.
  const secretHeader = req.headers.get("x-webhook-secret");
  const auth = req.headers.get("Authorization") ?? "";
  let caller: Caller;
  let userDb = admin;
  let body: Body;
  if (secretHeader !== null) {
    if (!env.webhookSecret) return json({ error: "Server misconfigured" }, 500);
    if (secretHeader !== env.webhookSecret) return json({ error: "Unauthorized" }, 401);
    caller = { kind: "system", language: "en", timezone: "Asia/Muscat" };
  } else if (auth.startsWith("Bearer ")) {
    userDb = createClient(env.supabaseUrl, env.anonKey, { global: { headers: { Authorization: auth } } });
    const { data: u, error } = await userDb.auth.getUser();
    if (error || !u.user) return json({ error: "Unauthorized" }, 401);
    const [{ data: p }, { data: cm }] = await Promise.all([
      admin.from("profiles").select("role,name,lab_id,clinic_id,language,status").eq("id", u.user.id).maybeSingle(),
      admin.from("clinic_members").select("clinic_id").eq("user_id", u.user.id),
    ]);
    if (!p || p.status === "inactive") return json({ error: "Unauthorized" }, 401);
    const clinicIds = [...new Set([...(cm ?? []).map((m: { clinic_id: string }) => m.clinic_id), ...(p.clinic_id ? [p.clinic_id] : [])])];
    const { data: lab } = p.lab_id ? await admin.from("labs").select("timezone").eq("id", p.lab_id).maybeSingle() : { data: null };
    caller = { kind: "user", userId: u.user.id, role: p.role, labId: p.lab_id ?? null, clinicIds, name: p.name ?? undefined, language: (p.language as Language) ?? "en", timezone: lab?.timezone ?? "Asia/Muscat" };
  } else {
    return json({ error: "Unauthorized" }, 401);
  }
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const trigger = classify(body);
  if (!trigger) return json({ ok: true, skipped: "no-op event" });
  // A user token may only ask questions; a secret may do anything but that.
  if (caller.kind === "user" && trigger !== "user_question") return json({ error: "Forbidden" }, 403);
  if (caller.kind === "system" && trigger === "user_question") return json({ error: "Forbidden" }, 403);

  // ---- gate ----
  const rec = (body.record ?? {}) as Partial<CaseRow> & { parent_case_id?: string; case_id?: string; kind?: string; instructions?: string; id?: string };
  const caseId = trigger === "prescription_submitted" || trigger === "stage_changed" ? rec.id : trigger === "remake_recorded" ? (rec.parent_case_id ?? rec.id) : trigger === "clarification_answered" ? rec.case_id : body.case_id;
  let labId: string | null | undefined = (rec as Partial<CaseRow>).lab_id ?? caller.labId ?? null;
  if (caseId && !labId) { const { data: c } = await admin.from("cases").select("lab_id,clinic_id").eq("id", caseId).maybeSingle(); labId = c?.lab_id ?? null; }
  if (!(await noorEnabled(admin, trigger.startsWith("scheduled") ? null : labId))) return json({ ok: true, skipped: "noor disabled" });
  if (trigger === "user_question") {
    if (!(await withinRateLimit(admin, `user:${caller.userId}`, env.userPerHour, 3600000, now))) return json({ error: "Rate limit: 20 questions per hour" }, 429);
    const tenant = caller.labId ?? caller.clinicIds?.[0] ?? "none";
    if (!(await withinRateLimit(admin, `tenant:${tenant}`, env.tenantPerDay, 86400000, now))) return json({ error: "Rate limit: 200 questions per day for this organisation" }, 429);
  } else if (!trigger.startsWith("scheduled")) {
    const key = idempotencyKeyFor(trigger, [caseId, (body.old_record as { stage_index?: number } | null)?.stage_index, rec.stage_index, rec.id]);
    if (!(await claimIdempotency(admin, key))) return json({ ok: true, skipped: "duplicate delivery" });
  }

  // ---- run ----
  const tid = traceId();
  const audit = makeAudit(admin, tid);
  await audit.start({ trigger, labId, clinicId: (rec as Partial<CaseRow>).clinic_id ?? caller.clinicIds?.[0] ?? null, userId: caller.userId ?? null, caseId: caseId ?? null, shadow: env.shadow });
  // Every context created for this run shares one would_have list, so a
  // scheduled job that fans out per lab still lands its evidence on the run.
  const wouldHave: ToolContext["wouldHave"] = [];
  const makeCtx = (jobLabId?: string): ToolContext => ({
    caller: jobLabId ? { ...caller, kind: "system", jobLabId } : caller, db: userDb, admin, shadow: env.shadow, now, traceId: tid, resendKey: env.resendKey, wouldHave,
  });
  const llm: LlmClient | null = env.anthropicKey ? createLlm({ apiKey: env.anthropicKey, modelAnswer: env.modelAnswer, modelPhrase: env.modelPhrase, effort: env.effort, timeoutMs: env.runTimeoutMs }) : null;
  const limits = { maxToolCalls: env.maxToolCalls, toolTimeoutMs: env.toolTimeoutMs, maxTokens: env.maxTokens };
  const system = (lang: Language, trg: Trigger, org?: { labName?: string; clinicName?: string }) =>
    buildSystemPrompt({ caller_block: callerBlock({ kind: caller.kind, role: caller.role, name: caller.name, language: lang, timezone: caller.timezone, trigger: trg, ...org }), recipient_language: lang, stale_days: env.staleDays, max_tool_calls: env.maxToolCalls });
  const finish = async (outcome: string, extra: Record<string, unknown> = {}, _ctx?: ToolContext) => {
    const { model, inputTokens, outputTokens, error, text, answer, ...summary } = extra;
    const evidence = [...(Object.keys(summary).length ? [{ tool: "summary", input: summary }] : []), ...wouldHave];
    await audit.finish({ outcome, model: (model as string) ?? null, inputTokens: inputTokens as number, outputTokens: outputTokens as number, error: (error as string) ?? null, wouldHave: evidence.length ? evidence : undefined });
    return json({ ok: true, trace_id: tid, trigger, outcome, shadow: env.shadow, ...extra });
  };

  try {
    switch (trigger) {
      case "prescription_submitted":
      case "clarification_answered": {
        const ctx = makeCtx(labId ?? undefined);
        const loaded = caseId ? await loadSummary(ctx, caseId, false) : null;
        if (!loaded) return finish("skipped", { reason: "case not found" });
        const issues = validatePrescription(loaded.row);
        if (trigger === "clarification_answered" && !issues.length) {
          await resolveFlag(ctx, loaded.row.id, "needs_clarification");
          if (!env.shadow) await admin.from("case_notes").insert({ case_id: loaded.row.id, author_name: "Noor", author_role: "agent", body: `Noor: clarification answered — prescription now complete` });
        }
        if (!issues.length) return finish("completed", { text: "PASS" }, ctx);
        if (trigger === "clarification_answered") return finish("completed", { text: "issues remain", remaining: issues.map((i) => i.field) }, ctx);
        const { data: clinic } = await admin.from("clinics").select("language,name").eq("id", loaded.row.clinic_id).maybeSingle();
        const lang = (clinic?.language as Language) ?? "en";
        if (llm) {
          const r = await runAgent({ trigger, caller: { ...ctx.caller, language: lang }, systemPrompt: system(lang, trigger, { clinicName: clinic?.name }), userMessage: intakeContext(loaded.summary, issues), toolNames: ["request_clarification"], executor: liveExecutor, llm, ctx, audit: audit.sink, limits, purpose: "phrase" });
          if (r.toolCalls.some((c) => c.name === "request_clarification" && !c.error)) return finish(r.outcome, { text: r.text, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens }, ctx);
        }
        // Deterministic fallback (no model, or the model did not ask): one question from the primary issue.
        const issue = primaryIssue(issues)!;
        const question = lang === "ar"
          ? `الحالة ${loaded.row.id}: ${issue.detail}. يرجى توضيح هذا البند حتى يتمكن المختبر من البدء.`
          : `Case ${loaded.row.id}: ${issue.detail}. Please clarify this item so the lab can start.`;
        const out = await requestClarification({ case_id: loaded.row.id, issue, question, language: lang }, ctx);
        await audit.sink.toolCall(1, "request_clarification", { case_id: loaded.row.id, issue, language: lang }, out, 0);
        return finish("completed", { text: question, fallback: true }, ctx);
      }
      case "stage_changed": {
        const ctx = makeCtx(labId ?? undefined);
        const newStage = stageOf(Number(rec.stage_index));
        const oldStage = Number((body.old_record as { stage_index?: number } | null)?.stage_index ?? -1);
        if (Number(rec.stage_index) < oldStage) return finish("skipped", { reason: "revert" });
        const template = templateForStage(newStage);
        if (!template || !caseId) return finish("skipped", { reason: "no template for stage" });
        const out = await sendStatusUpdate({ case_id: caseId, template_id: template, idempotency_key: `${oldStage}->${rec.stage_index}` }, ctx);
        await audit.sink.toolCall(1, "send_status_update", { case_id: caseId, template_id: template }, out, 0);
        if (Number(rec.stage_index) >= 3) { await resolveFlag(ctx, caseId, "at_risk"); await resolveFlag(ctx, caseId, "overdue"); await resolveFlag(ctx, caseId, "stale"); }
        return finish("completed", { sent: out.sent, skipped_reason: out.skipped_reason }, ctx);
      }
      case "remake_recorded": {
        const ctx = makeCtx(labId ?? undefined);
        if (!caseId) return finish("skipped", { reason: "no case" });
        const roundId = body.table === "case_rounds" ? rec.id : undefined;
        const text = body.table === "case_rounds" ? String(rec.instructions ?? "") : String(((rec as Partial<CaseRow>).remake?.reason ?? ""));
        if (llm) {
          const r = await runAgent({ trigger, caller: ctx.caller, systemPrompt: system("en", trigger), userMessage: remakeContext(caseId, roundId, text), toolNames: ["record_remake_reason"], executor: liveExecutor, llm, ctx, audit: audit.sink, limits, purpose: "phrase" });
          if (r.toolCalls.some((c) => c.name === "record_remake_reason" && !c.error)) return finish(r.outcome, { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens }, ctx);
        }
        const hit = REMAKE_KEYWORDS.find(([re]) => re.test(text));
        const out = await recordRemakeReason({ case_id: caseId, round_id: roundId, reason_class: hit?.[1] ?? "laboratory", reason_code: hit?.[2] ?? "other", stated_text: text }, ctx);
        await audit.sink.toolCall(1, "record_remake_reason", { case_id: caseId, reason_code: hit?.[2] ?? "other" }, out, 0);
        return finish("completed", { fallback: true, reason_code: hit?.[2] ?? "other" }, ctx);
      }
      case "scheduled_watch": { const r = await runWatch(admin, (id) => makeCtx(id), env.staleDays); return finish("completed", r); }
      case "scheduled_brief": { const r = await runBrief(admin, (id) => makeCtx(id)); return finish("completed", r); }
      case "scheduled_patterns": { const r = await runPatterns(admin, (id) => makeCtx(id)); return finish("completed", r); }
      case "user_question": {
        const ctx = makeCtx();
        if (!llm) return finish("failed", { error: "no model configured", answer: "Noor is not available right now." }, ctx);
        const orgName = caller.labId ? (await admin.from("labs").select("name").eq("id", caller.labId).maybeSingle()).data?.name : caller.clinicIds?.[0] ? (await admin.from("clinics").select("name").eq("id", caller.clinicIds[0]).maybeSingle()).data?.name : undefined;
        const r = await runAgent({ trigger, caller, systemPrompt: system(caller.language, trigger, caller.labId ? { labName: orgName } : { clinicName: orgName }), userMessage: questionContext(String(body.question)), toolNames: ["get_case", "list_cases", "get_turnaround_benchmark", "escalate_to_human", "add_case_note"], executor: liveExecutor, llm, ctx, audit: audit.sink, limits, purpose: "answer" });
        return finish(r.outcome, { answer: r.text, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens }, ctx);
      }
    }
  } catch (err) {
    console.error("noor run failed", tid, err);
    return finish("failed", { error: (err as Error).message });
  }
  return finish("skipped");
});
