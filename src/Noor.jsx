import React, { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, AlertTriangle, Clock, MessageSquareWarning, Send, Loader2, Check, CheckCheck, Inbox, Flag } from "lucide-react";
import { answerNoorClarification, askNoor, composeNoorBriefClient, setNoorEscalationStatus } from "./lib/data.js";

/**
 * Noor — the in-app surfaces for the AI case coordinator.
 *
 * Everything here is display and two narrow writes (answer a clarification,
 * acknowledge/resolve an escalation). Noor's decisions — what to flag, when
 * to escalate, what to ask — are made in the `noor` Edge Function; this file
 * never infers a verdict from case data. Visibility is gated twice: the lab's
 * `noorEnabled` flag decides whether these render at all, and RLS decides
 * which rows each account can see, so a clinic never sees a lab-only flag.
 */

/* ------------------------------------------------------------------ */
/*  Flag chips — on the lab card, the dentist row, and the drawer        */
/* ------------------------------------------------------------------ */

const FLAG_META = {
  overdue:             { label: "Overdue",   cls: "bg-rose-100 text-rose-700",   Icon: AlertTriangle },
  at_risk:             { label: "At risk",   cls: "bg-amber-100 text-amber-700", Icon: Clock },
  stale:               { label: "Stalled",   cls: "bg-orange-100 text-orange-700", Icon: Clock },
  needs_clarification: { label: "Question",  cls: "bg-sky-100 text-sky-700",     Icon: MessageSquareWarning },
};
const FLAG_ORDER = ["overdue", "stale", "at_risk", "needs_clarification"];

export function NoorFlagChips({ flags = [], compact = false }) {
  if (!flags.length) return null;
  const sorted = [...flags].sort((a, b) => FLAG_ORDER.indexOf(a.kind) - FLAG_ORDER.indexOf(b.kind));
  return (
    <>
      {sorted.map((f) => {
        const m = FLAG_META[f.kind] ?? { label: f.kind, cls: "bg-slate-100 text-slate-600", Icon: Flag };
        return (
          <span
            key={f.id ?? f.kind}
            title={`Noor: ${f.reason}`}
            className={`inline-flex items-center gap-1 rounded-full font-bold ${m.cls} ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"}`}
          >
            <m.Icon size={compact ? 10 : 11} /> {m.label}
            {f.kind === "overdue" && f.daysOver > 0 && <span className="font-semibold opacity-80">{f.daysOver}d</span>}
          </span>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Clarification — the dentist answers Noor's one question             */
/* ------------------------------------------------------------------ */

export function NoorClarificationBanner({ clarification, canAnswer, onAnswered }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!clarification) return null;
  const rtl = clarification.language === "ar" || /[؀-ۿ]/.test(clarification.question);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const updated = await answerNoorClarification(clarification.id, answer);
      onAnswered?.(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50 p-3.5" dir={rtl ? "rtl" : "ltr"}>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-sky-700">
        <Sparkles size={13} /> {rtl ? "سؤال من نور قبل أن يبدأ المختبر" : "One question from Noor before the lab can start"}
      </div>
      <p className="whitespace-pre-wrap text-sm text-slate-800">{clarification.question}</p>
      {canAnswer ? (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            maxLength={1000}
            placeholder={rtl ? "اكتب الإجابة هنا" : "Type your answer"}
            className="min-w-0 flex-1 rounded-lg border border-sky-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
          />
          <button type="submit" disabled={busy || !answer.trim()} className="flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {rtl ? "إرسال" : "Send"}
          </button>
        </form>
      ) : (
        <p className="mt-2 text-xs text-slate-500">{rtl ? "في انتظار رد العيادة." : "Waiting for the clinic to answer."} <span className="text-slate-400">· {new Date(clarification.askedAt).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}</span></p>
      )}
      {error && <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Ask Noor — free-text questions, answered only from tool results     */
/* ------------------------------------------------------------------ */

export function AskNoorPanel({ caseId = null, placeholder }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState([]); // {role:'user'|'noor', text, traceId?}
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [thread]);

  const ask = async (e) => {
    e?.preventDefault();
    const text = q.trim();
    if (!text || busy) return;
    setQ(""); setBusy(true);
    setThread((t) => [...t, { role: "user", text }]);
    try {
      const r = await askNoor(text, { caseId });
      setThread((t) => [...t, { role: "noor", text: r.answer, traceId: r.traceId }]);
    } catch (err) {
      setThread((t) => [...t, { role: "noor", text: err.message, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-400">
        <Sparkles size={13} className="text-violet-500" /> Ask Noor
        <span className="ml-auto text-[10px] font-medium normal-case tracking-normal text-slate-400">AI assistant · answers only from your cases</span>
      </div>
      {thread.length > 0 && (
        <div className="max-h-72 space-y-2 overflow-y-auto px-3.5 py-3">
          {thread.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                dir={/[؀-ۿ]/.test(m.text) ? "rtl" : "ltr"}
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${m.role === "user" ? "bg-slate-800 text-white" : m.error ? "bg-rose-50 text-rose-700" : "bg-violet-50 text-slate-800"}`}
              >
                {m.text}
                {m.traceId && <div className="mt-1 text-[10px] text-slate-400" dir="ltr">ref {m.traceId}</div>}
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={12} className="animate-spin" /> Noor is checking…</div>}
          <div ref={endRef} />
        </div>
      )}
      <form onSubmit={ask} className="flex gap-2 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={2000}
          placeholder={placeholder ?? (caseId ? `Ask about ${caseId}…` : "Where is case …? What's due this week?")}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
        <button type="submit" disabled={busy || !q.trim()} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
          <Send size={14} /> Ask
        </button>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Today's brief — the lab dashboard card                               */
/* ------------------------------------------------------------------ */

export function NoorBriefCard({ cases, flags, clarifications, escalations, clinicsById, onOpenCase }) {
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const brief = useMemo(() => composeNoorBriefClient({ cases, flags, clarifications, escalations, today }), [cases, flags, clarifications, escalations, today]);
  const Row = ({ c, note }) => (
    <button onClick={() => onOpenCase?.(c.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">
      <span className="font-semibold text-slate-800">{c.id}</span>
      <span className="truncate text-slate-500">{clinicsById?.[c.clinicId]?.name ?? "—"}</span>
      {note && <span className="ml-auto shrink-0 text-xs text-slate-400">{note}</span>}
    </button>
  );
  const Section = ({ title, tone, children, count }) =>
    count ? (
      <div>
        <p className={`mb-1 text-[11px] font-bold uppercase tracking-wide ${tone}`}>{title} <span className="opacity-70">({count})</span></p>
        <div className="divide-y divide-slate-100">{children}</div>
      </div>
    ) : null;

  return (
    <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={16} className="text-violet-500" />
        <h3 className="text-sm font-bold text-slate-800">Noor's brief</h3>
        <span className="ml-auto text-xs text-slate-400">{new Date().toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" })}</span>
      </div>
      {brief.isEmpty ? (
        <p className="text-sm text-slate-500">Nothing needs attention today.</p>
      ) : (
        <div className="space-y-3">
          <Section title="Due today" tone="text-sky-700" count={brief.dueToday.length}>{brief.dueToday.map((c) => <Row key={c.id} c={c} note={c.deliveryTime !== "Anytime" ? c.deliveryTime : null} />)}</Section>
          <Section title="Overdue" tone="text-rose-700" count={brief.overdue.length}>{brief.overdue.map((c) => <Row key={c.id} c={c} note={c.appointmentDate ? `needed ${c.appointmentDate}` : null} />)}</Section>
          <Section title="Stalled" tone="text-orange-700" count={brief.stale.length}>{brief.stale.map((c) => <Row key={c.id} c={c} note="no activity" />)}</Section>
          <Section title="Awaiting clarification" tone="text-amber-700" count={brief.awaiting.length}>{brief.awaiting.map((c) => <Row key={c.id} c={c} note="clinic to answer" />)}</Section>
          <Section title="Needs a decision" tone="text-violet-700" count={brief.decisions.length}>
            {brief.decisions.map((d, i) => {
              const c = cases.find((x) => x.id === d.caseId);
              return c ? <Row key={`${d.caseId}-${i}`} c={c} note={d.what} /> : <div key={i} className="px-2 py-1.5 text-sm text-slate-600">{d.what}</div>;
            })}
          </Section>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Escalation inbox — lab admins acknowledge and resolve                */
/* ------------------------------------------------------------------ */

const CATEGORY_LABEL = {
  fee_dispute: "Fee dispute", complaint: "Complaint", clinical_question: "Clinical question", clarification_failed: "Clarification failed",
  stale_case: "Stalled case", tool_failure: "Noor could not complete", user_requested: "Asked for a person", pattern_observation: "Observation",
};

export function NoorEscalationInbox({ escalations, loading, onChanged, onOpenCase }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const rows = useMemo(() => escalations.filter((e) => showResolved || e.status !== "resolved"), [escalations, showResolved]);

  const setStatus = async (e, status) => {
    setBusyId(e.id); setError("");
    try { const updated = await setNoorEscalationStatus(e.id, status); onChanged?.(updated); }
    catch (err) { setError(err.message); }
    finally { setBusyId(null); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-bold text-slate-800"><Inbox size={16} className="text-violet-500" /> Escalations from Noor</h3>
        <label className="flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> show resolved</label>
      </div>
      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">Nothing escalated. Noor raises cases here when a person needs to decide.</div>
      ) : (
        rows.map((e) => {
          const ctx = e.context ?? {};
          const open = e.status === "open";
          return (
            <article key={e.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${open ? "border-violet-200" : "border-slate-200 opacity-90"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${open ? "bg-violet-100 text-violet-700" : e.status === "acknowledged" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{e.status}</span>
                <span className="text-xs font-semibold text-slate-500">{CATEGORY_LABEL[e.category] ?? e.category}</span>
                {e.caseId && <button onClick={() => onOpenCase?.(e.caseId)} className="text-xs font-bold text-slate-800 underline-offset-2 hover:underline">{e.caseId}</button>}
                <span className="ml-auto text-xs text-slate-400">{new Date(e.createdAt).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{e.assignedToName ? ` · to ${e.assignedToName}` : ""}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800" dir={/[؀-ۿ]/.test(e.summary) ? "rtl" : "ltr"}>{e.summary}</p>
              {Array.isArray(ctx.timeline) && ctx.timeline.length > 0 && (
                <details className="mt-2 text-xs text-slate-600">
                  <summary className="cursor-pointer font-semibold text-slate-500">Context log</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">{ctx.timeline.map((l, i) => <li key={i}>{l}</li>)}</ul>
                  {ctx.attempted?.length > 0 && <p className="mt-1">What Noor did: {ctx.attempted.join(", ")}</p>}
                  {ctx.stop_reason && <p>Why it stopped: {ctx.stop_reason}</p>}
                </details>
              )}
              {e.status !== "resolved" && (
                <div className="mt-3 flex gap-2">
                  {open && (
                    <button disabled={busyId === e.id} onClick={() => setStatus(e, "acknowledged")} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Check size={13} /> Acknowledge</button>
                  )}
                  <button disabled={busyId === e.id} onClick={() => setStatus(e, "resolved")} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCheck size={13} /> Resolve</button>
                </div>
              )}
            </article>
          );
        })
      )}
    </div>
  );
}

/** Small header pill so the lab knows Noor is on. */
export function NoorStatusPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700" title="Noor, the AI case coordinator, is watching this lab's cases">
      <Sparkles size={11} /> Noor on
    </span>
  );
}

