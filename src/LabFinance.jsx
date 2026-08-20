import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Upload,
  FileText,
  Banknote,
  Wallet,
  Landmark,
  Coins,
  Plus,
  Trash2,
  Download,
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronRight,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import { STAGE_INDEX } from "./LifecycleEngine.jsx";
import {
  fetchStatements,
  fetchPayments,
  fetchExpenses,
  generateStatements,
  insertPayment,
  markChequeCleared,
  insertExpense,
  deleteExpense,
  importFinanceRows,
  logActivity,
} from "./lib/data.js";
import { downloadStatementPdf } from "./lib/statementPdf.js";
import { IMPORT_CATEGORIES, readWorkbookRows, mapImportRows } from "./lib/financeImport.js";

/* ================================================================== */
/*  Shared helpers (mirrors LabAdmin's money + completion helpers)     */
/* ================================================================== */

const fmtMoney = (n) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const fmtOMR = (n) => `${fmtMoney(n)} OMR`;

const completedAt = (c) => {
  const e = (c.history ?? []).find(
    (h) => h.toStage === STAGE_INDEX.WORK_COMPLETE && (h.action === "advance" || h.action === "created"),
  );
  return e ? new Date(e.at) : null;
};

const monthLabel = (isoMonth) =>
  new Date(isoMonth + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

const inputCls =
  "w-full rounded-lg border border-transparent bg-gray-50 px-3 py-2 text-sm text-slate-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-500";

const STATUS_BADGE = {
  unpaid: "bg-rose-100 text-rose-700",
  partial: "bg-amber-100 text-amber-700",
  paid: "bg-emerald-100 text-emerald-700",
};

const METHOD_LABEL = { cash: "Cash", cheque: "Cheque", bank: "Bank transfer" };

function ErrorBanner({ message, onRetry }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
      <AlertTriangle size={15} className="shrink-0 text-rose-500" />
      <p className="min-w-0 flex-1 text-sm text-rose-700">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100">
          Retry
        </button>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Billing — statements, payment recording, receivables aging         */
/* ================================================================== */

// Last 6 whole months (newest first) as first-of-month ISO dates.
const recentMonths = () => {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < 6; i++) {
    out.push(new Date(d.getFullYear(), d.getMonth() - i, 1));
  }
  return out.map((m) => `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-01`);
};

export function BillingPanel({ lab, clinicsById = {}, cases = [] }) {
  const [statements, setStatements] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const months = useMemo(recentMonths, []);
  const [genMonth, setGenMonth] = useState(months[1]); // default: previous month
  const [genState, setGenState] = useState({ confirming: false, busy: false, message: "" });
  const [payFor, setPayFor] = useState(null); // statement object or null
  // Imported-history statements expand to show their work line items.
  const [openStatementId, setOpenStatementId] = useState(null);
  // Table controls: omni-search, filters, sort, pagination, bulk selection.
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [agingFilter, setAgingFilter] = useState(null); // bucket label or null
  const [sort, setSort] = useState({ key: "month", dir: "desc" });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [st, pay] = await Promise.all([fetchStatements(lab.id), fetchPayments(lab.id)]);
      setStatements(st);
      setPayments(pay);
    } catch (err) {
      setError("Couldn't load billing data — " + err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab.id]);

  const paidByStatement = useMemo(() => {
    const m = {};
    for (const p of payments) if (p.statementId) m[p.statementId] = (m[p.statementId] ?? 0) + p.amount;
    return m;
  }, [payments]);

  // Completed, priced work not yet on any statement — what the next
  // "Generate" run would pick up.
  const unbilled = useMemo(() => {
    // Mirrors the RPC's eligibility: completed work at full price, or an
    // approved cancellation billed at its fee.
    const value = (c) => (c.cancelStatus === "cancelled" ? c.cancellationFee ?? 0 : c.totalPrice ?? 0);
    const rows = cases.filter(
      (c) =>
        c.invoiceStatus === "draft" &&
        !c.statementId &&
        (c.cancelStatus === "cancelled" ? (c.cancellationFee ?? 0) > 0 : completedAt(c) && (c.totalPrice ?? 0) > 0),
    );
    return { count: rows.length, total: rows.reduce((s, c) => s + value(c), 0) };
  }, [cases]);

  // Receivables aging: remaining balance of open statements bucketed by
  // how long since the billed month ended. statementMeta keeps each
  // statement's remaining balance + bucket so the cards, the bucket
  // quick-filter, and bulk payments all share one computation.
  const statementMeta = useMemo(() => {
    const m = new Map();
    const now = Date.now();
    for (const s of statements) {
      const remaining = s.status === "paid" ? 0 : Math.max(0, s.total - (paidByStatement[s.id] ?? 0));
      let bucket = null;
      if (remaining > 0) {
        const end = new Date(s.month + "T00:00:00");
        end.setMonth(end.getMonth() + 1);
        const days = Math.floor((now - end.getTime()) / 86400000);
        bucket = days <= 30 ? "0–30 days" : days <= 60 ? "31–60 days" : "60+ days";
      }
      m.set(s.id, { remaining, bucket });
    }
    return m;
  }, [statements, paidByStatement]);

  const aging = useMemo(() => {
    const buckets = {
      "0–30 days": { value: 0, count: 0 },
      "31–60 days": { value: 0, count: 0 },
      "60+ days": { value: 0, count: 0 },
    };
    for (const { remaining, bucket } of statementMeta.values()) {
      if (bucket) {
        buckets[bucket].value += remaining;
        buckets[bucket].count += 1;
      }
    }
    return buckets;
  }, [statementMeta]);
  const outstanding = Object.values(aging).reduce((a, b) => a + b.value, 0);

  const runGenerate = async () => {
    setGenState({ confirming: false, busy: true, message: "" });
    try {
      const n = await generateStatements(genMonth);
      logActivity("generated statements", `${n} for ${genMonth.slice(0, 7)}`);
      setGenState({ confirming: false, busy: false, message: n ? `${n} statement${n === 1 ? "" : "s"} generated.` : "Nothing to bill for that month." });
      await load();
    } catch (err) {
      setGenState({ confirming: false, busy: false, message: "" });
      setError("Couldn't generate statements — " + err.message);
    }
  };

  const clinicLabel = (s) => clinicsById[s.clinicId]?.name ?? s.clinicName ?? "Unknown clinic";

  const downloadPdf = async (s) => {
    const included = cases
      .filter((c) => c.statementId === s.id)
      .map((c) => ({ ...c, completedAtLabel: completedAt(c)?.toLocaleDateString("en-GB") ?? "" }));
    logActivity("downloaded statement PDF", `${clinicLabel(s)} — ${s.month.slice(0, 7)} — ${s.total} OMR`);
    await downloadStatementPdf({
      lab,
      clinic: clinicsById[s.clinicId] ?? { name: s.clinicName || "Clinic" },
      statement: s,
      cases: included,
      paidSoFar: paidByStatement[s.id] ?? 0,
    });
  };

  // One lowercase haystack per statement: clinic, month, status, and every
  // line item's invoice/patient/dentist/procedure. Built once; each search
  // keystroke is then a cheap substring scan even over 8 years of history.
  const searchIndex = useMemo(() => {
    const m = new Map();
    for (const s of statements) {
      const parts = [clinicLabel(s), monthLabel(s.month), s.status];
      for (const li of s.lineItems ?? []) parts.push(li.invoice, li.patient, li.dentist, li.procedure);
      m.set(s.id, parts.filter(Boolean).join(" ").toLowerCase());
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statements, clinicsById]);

  const years = useMemo(
    () => [...new Set(statements.map((s) => s.month.slice(0, 4)))].sort().reverse(),
    [statements],
  );

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return statements.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (yearFilter !== "all" && !s.month.startsWith(yearFilter)) return false;
      if (monthFilter !== "all" && s.month.slice(5, 7) !== monthFilter) return false;
      if (agingFilter && statementMeta.get(s.id)?.bucket !== agingFilter) return false;
      if (terms.length) {
        const hay = searchIndex.get(s.id) ?? "";
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }, [statements, query, statusFilter, yearFilter, monthFilter, agingFilter, statementMeta, searchIndex]);

  const sorted = useMemo(() => {
    const val = {
      month: (s) => s.month,
      clinic: (s) => clinicLabel(s).toLowerCase(),
      total: (s) => s.total,
      paid: (s) => paidByStatement[s.id] ?? 0,
      status: (s) => ({ unpaid: 0, partial: 1, paid: 2 })[s.status] ?? 3,
    }[sort.key];
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.id < b.id ? -1 : 1; // stable tiebreak
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, paidByStatement, clinicsById]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const curPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((curPage - 1) * perPage, curPage * perPage);

  // Any control change jumps back to the first page.
  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, yearFilter, monthFilter, agingFilter, sort, perPage]);

  const toggleSort = (key) =>
    setSort((p) => ({ key, dir: p.key === key && p.dir === "desc" ? "asc" : "desc" }));

  const toggleSelected = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Header checkbox drives the current page's payable rows.
  const payablePageIds = pageRows.filter((s) => (statementMeta.get(s.id)?.remaining ?? 0) > 0).map((s) => s.id);
  const allPageSelected = payablePageIds.length > 0 && payablePageIds.every((id) => selected.has(id));
  const togglePageSelection = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) payablePageIds.forEach((id) => next.delete(id));
      else payablePageIds.forEach((id) => next.add(id));
      return next;
    });

  const selectedStatements = useMemo(
    () => statements.filter((s) => selected.has(s.id) && (statementMeta.get(s.id)?.remaining ?? 0) > 0),
    [statements, selected, statementMeta],
  );
  const selectedRemaining = selectedStatements.reduce((s, x) => s + (statementMeta.get(x.id)?.remaining ?? 0), 0);

  const runBulkPayments = async ({ method, reference, date }) => {
    let done = 0;
    for (const s of selectedStatements) {
      await insertPayment(lab.id, {
        clinicId: s.clinicId,
        clinicName: s.clinicName,
        statementId: s.id,
        amount: statementMeta.get(s.id)?.remaining ?? 0,
        method,
        reference,
        receivedDate: date,
      });
      done++;
    }
    logActivity("recorded payments (bulk)", `${done} statements — ${fmtOMR(selectedRemaining)}`);
    setSelected(new Set());
    setBulkMsg(`${done} payment${done === 1 ? "" : "s"} recorded — ${fmtOMR(selectedRemaining)}.`);
    await load();
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={load} />}

      {/* Generate */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <FileText size={15} className="shrink-0 text-blue-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-700">Generate monthly statements</p>
          <p className="text-xs text-slate-400">
            Sweeps every completed, unbilled case finished up to the end of the chosen month into one bill per
            clinic and marks them invoiced.
            {unbilled.count > 0 && (
              <span className="font-semibold text-amber-600">
                {" "}{unbilled.count} case{unbilled.count === 1 ? "" : "s"} ({fmtOMR(unbilled.total)}) awaiting billing.
              </span>
            )}
          </p>
        </div>
        {genState.message && <p className="text-xs font-semibold text-emerald-600">{genState.message}</p>}
        <span className="flex shrink-0 items-center gap-1.5">
          <select value={genMonth} onChange={(e) => setGenMonth(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600">
            {months.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
          {genState.confirming ? (
            <>
              <button onClick={runGenerate} disabled={genState.busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
                {genState.busy ? "Working…" : "Yes, generate"}
              </button>
              <button onClick={() => setGenState({ confirming: false, busy: false, message: "" })} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                Cancel
              </button>
            </>
          ) : (
            <button onClick={() => setGenState({ confirming: true, busy: false, message: "" })} disabled={genState.busy} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-300 hover:text-blue-700">
              Generate
            </button>
          )}
        </span>
      </div>

      {/* Aging — each card doubles as a quick-filter for the table below */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Object.entries(aging).map(([label, { value, count }]) => {
          const active = agingFilter === label;
          return (
            <button
              key={label}
              onClick={() => setAgingFilter(active ? null : label)}
              aria-pressed={active}
              title={active ? "Clear this filter" : `Show only ${label} statements`}
              className={`rounded-2xl border bg-white p-4 text-left transition ${
                active ? "border-blue-400 ring-2 ring-blue-200" : "border-slate-200 hover:border-blue-300"
              }`}
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Outstanding {label}</p>
              <p className={`mt-1.5 text-xl font-bold ${value > 0 && label === "60+ days" ? "text-rose-600" : "text-slate-800"}`}>{fmtOMR(value)}</p>
              <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                {count} statement{count === 1 ? "" : "s"}{active ? " — tap to clear filter" : ""}
              </p>
            </button>
          );
        })}
      </div>

      {/* Statements */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-800">Statements</h3>
          <span className="text-xs font-semibold text-slate-500">{fmtOMR(outstanding)} outstanding</span>
        </div>

        {/* Omni-search + filters */}
        {statements.length > 0 && (
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <label className="relative min-w-[220px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search invoice no, patient, clinic, doctor, procedure…"
                  className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                />
              </label>
              <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600">
                <option value="all">All years</option>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600">
                <option value="all">All months</option>
                {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m) => (
                  <option key={m} value={m}>
                    {new Date(`2000-${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long" })}
                  </option>
                ))}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600">
                <option value="all">All statuses</option>
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partially paid</option>
                <option value="paid">Paid</option>
              </select>
            </div>
            {(selected.size > 0 || bulkMsg) && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
                {selectedStatements.length > 0 ? (
                  <>
                    <span className="text-xs font-semibold text-emerald-800">
                      {selectedStatements.length} statement{selectedStatements.length === 1 ? "" : "s"} selected — {fmtOMR(selectedRemaining)} due
                    </span>
                    <button
                      onClick={() => setBulkOpen(true)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      Record selected payments
                    </button>
                    <button
                      onClick={() => setSelected(new Set())}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-700"
                    >
                      Clear selection
                    </button>
                  </>
                ) : (
                  <span className="text-xs font-semibold text-emerald-700">{bulkMsg}</span>
                )}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : statements.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No statements yet — generate your first monthly run above.</p>
        ) : sorted.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Nothing matches the current search or filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  <th className="w-8 pb-2 pr-2">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={togglePageSelection}
                      disabled={payablePageIds.length === 0}
                      title="Select every unpaid statement on this page"
                      className="h-3.5 w-3.5 accent-emerald-600"
                    />
                  </th>
                  {[
                    { k: "month", label: "Month" },
                    { k: "clinic", label: "Clinic" },
                    { k: "total", label: "Total", right: true },
                    { k: "paid", label: "Paid", right: true },
                    { k: "status", label: "Status" },
                  ].map(({ k, label, right }) => (
                    <th key={k} className="pb-2 pr-3">
                      <button
                        onClick={() => toggleSort(k)}
                        className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 hover:text-slate-600 ${right ? "ml-auto" : ""}`}
                        title={`Sort by ${label.toLowerCase()}`}
                      >
                        {label}
                        {sort.key === k ? (
                          sort.dir === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />
                        ) : (
                          <ArrowUpDown size={11} className="opacity-40" />
                        )}
                      </button>
                    </th>
                  ))}
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((s) => {
                  const paid = paidByStatement[s.id] ?? 0;
                  const hasLines = s.lineItems?.length > 0;
                  const open = openStatementId === s.id;
                  const payable = (statementMeta.get(s.id)?.remaining ?? 0) > 0;
                  return (
                    <React.Fragment key={s.id}>
                      <tr
                        className={`border-t border-slate-100 ${hasLines ? "cursor-pointer hover:bg-slate-50/70" : ""} ${selected.has(s.id) ? "bg-emerald-50/40" : ""}`}
                        onClick={hasLines ? () => setOpenStatementId(open ? null : s.id) : undefined}
                      >
                        <td className="py-2.5 pr-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(s.id)}
                            onChange={() => toggleSelected(s.id)}
                            disabled={!payable}
                            title={payable ? "Select for bulk payment" : "Already fully paid"}
                            className="h-3.5 w-3.5 accent-emerald-600 disabled:opacity-30"
                          />
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap text-slate-600">
                          <span className="flex items-center gap-1">
                            {hasLines && (
                              <ChevronRight size={13} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
                            )}
                            {monthLabel(s.month)}
                          </span>
                        </td>
                        <td className="max-w-[180px] truncate py-2.5 pr-3 font-semibold text-slate-700">
                          {clinicLabel(s)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-semibold text-slate-800 whitespace-nowrap">{fmtOMR(s.total)}</td>
                        <td className="py-2.5 pr-3 text-right text-slate-600 whitespace-nowrap">{fmtOMR(paid)}</td>
                        <td className="py-2.5 pr-3">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {s.status !== "paid" && (
                            <button onClick={() => setPayFor(s)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-emerald-300 hover:text-emerald-700">
                              Record payment
                            </button>
                          )}
                          <button onClick={() => downloadPdf(s)} title="Download PDF" className="ml-1.5 rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-blue-300 hover:text-blue-700">
                            <Download size={13} />
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-t border-slate-100 bg-slate-50/60">
                          <td colSpan={7} className="px-3 py-3">
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[640px] text-xs">
                                <thead>
                                  <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                    <th className="pb-1.5 pr-3">Date</th>
                                    <th className="pb-1.5 pr-3">Invoice</th>
                                    <th className="pb-1.5 pr-3">Patient</th>
                                    <th className="pb-1.5 pr-3">Doctor</th>
                                    <th className="pb-1.5 pr-3">Procedure</th>
                                    <th className="pb-1.5 pr-3 text-right">Units</th>
                                    <th className="pb-1.5 pr-3 text-right">Price</th>
                                    <th className="pb-1.5 text-right">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {s.lineItems.map((li, i) => (
                                    <tr key={i} className="border-t border-slate-200/70">
                                      <td className="py-1.5 pr-3 whitespace-nowrap text-slate-500">
                                        {li.date ? new Date(li.date + "T00:00:00").toLocaleDateString("en-GB") : "—"}
                                      </td>
                                      <td className="py-1.5 pr-3 text-slate-600">{li.invoice || "—"}</td>
                                      <td className="max-w-[140px] truncate py-1.5 pr-3 text-slate-700">{li.patient || "—"}</td>
                                      <td className="max-w-[120px] truncate py-1.5 pr-3 text-slate-600">{li.dentist || "—"}</td>
                                      <td className="max-w-[180px] truncate py-1.5 pr-3 text-slate-700">{li.procedure || "—"}</td>
                                      <td className="py-1.5 pr-3 text-right text-slate-600">{li.units ?? "—"}</td>
                                      <td className="py-1.5 pr-3 text-right text-slate-600">{li.price ?? "—"}</td>
                                      <td className="py-1.5 text-right font-semibold text-slate-700 whitespace-nowrap">{fmtOMR(li.amount ?? 0)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {/* Pagination */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-500">
                Showing {(curPage - 1) * perPage + 1}–{Math.min(curPage * perPage, sorted.length)} of {sorted.length.toLocaleString()} statement{sorted.length === 1 ? "" : "s"}
              </span>
              <span className="flex items-center gap-1.5">
                <select
                  value={perPage}
                  onChange={(e) => setPerPage(Number(e.target.value))}
                  className="rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-xs font-semibold text-slate-600"
                  title="Rows per page"
                >
                  {[25, 50, 100].map((n) => (
                    <option key={n} value={n}>{n} / page</option>
                  ))}
                </select>
                <button
                  onClick={() => setPage(curPage - 1)}
                  disabled={curPage <= 1}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-700 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="px-1 text-xs font-semibold text-slate-500 whitespace-nowrap">
                  Page {curPage} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(curPage + 1)}
                  disabled={curPage >= totalPages}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-700 disabled:opacity-40"
                >
                  Next
                </button>
              </span>
            </div>
          </div>
        )}
      </div>

      <ImportHistoryCard lab={lab} onImported={load} />

      <RecordPaymentModal
        open={!!payFor}
        statement={payFor}
        clinic={payFor ? clinicsById[payFor.clinicId] ?? { name: payFor.clinicName || "Clinic" } : null}
        remaining={payFor ? Math.max(0, payFor.total - (paidByStatement[payFor.id] ?? 0)) : 0}
        labId={lab.id}
        onClose={() => setPayFor(null)}
        onSaved={load}
      />
      <BulkPaymentModal
        open={bulkOpen}
        count={selectedStatements.length}
        total={selectedRemaining}
        onClose={() => setBulkOpen(false)}
        onConfirm={runBulkPayments}
      />
    </div>
  );
}

/* Bulk payment: settles the FULL remaining balance of every selected
   statement with one method/date/reference. Runs the inserts one by one so
   the statement status trigger fires per row; a failure stops the run with
   what was already recorded left in place. */
function BulkPaymentModal({ open, count, total, onClose, onConfirm }) {
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setMethod("cash");
    setReference("");
    setDate(new Date().toISOString().slice(0, 10));
    setError("");
    setBusy(false);
  }, [open]);

  if (!open) return null;

  const save = async () => {
    if (method === "cheque" && !reference.trim()) {
      setError("Enter the cheque number as the reference.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onConfirm({ method, reference: reference.trim(), date });
      onClose();
    } catch (err) {
      setError("Stopped part-way — " + err.message + ". Already-recorded payments are kept; reselect and retry the rest.");
      setBusy(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none";
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Banknote size={16} className="text-emerald-600" />
          <h3 className="min-w-0 truncate text-sm font-bold text-slate-800">Record {count} payment{count === 1 ? "" : "s"}</h3>
          <button onClick={onClose} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto px-4 py-4">
          <p className="text-sm text-slate-600">
            Each selected statement is settled in full — <b>{fmtOMR(total)}</b> across {count} statement{count === 1 ? "" : "s"}.
          </p>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}
          <label className="block text-xs font-semibold text-slate-500">
            Method
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={`mt-1 ${inputCls}`}>
              <option value="cash">Cash</option>
              <option value="bank">Bank transfer</option>
              <option value="cheque">Cheque</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-500">
            Received date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`mt-1 ${inputCls}`} />
          </label>
          <label className="block text-xs font-semibold text-slate-500">
            Reference {method === "cheque" ? "(cheque no — required)" : "(optional)"}
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === "cheque" ? "Cheque number" : "Receipt / note"} className={`mt-1 ${inputCls}`} />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? "Recording…" : `Record ${fmtOMR(total)}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RecordPaymentModal({ open, statement, clinic, remaining, labId, onClose, onSaved }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount(remaining ? String(remaining) : "");
    setMethod("cash");
    setReference("");
    setDate(new Date().toISOString().slice(0, 10));
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const save = async () => {
    const n = Number(amount);
    if (!n || n <= 0) {
      setError("Enter a payment amount above zero.");
      return;
    }
    if (method === "cheque" && !reference.trim()) {
      setError("Enter the cheque number as the reference.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await insertPayment(labId, {
        clinicId: statement.clinicId,
        clinicName: statement.clinicName,
        statementId: statement.id,
        amount: n,
        method,
        reference: reference.trim(),
        receivedDate: date,
      });
      logActivity("recorded payment", `${fmtOMR(n)} — ${clinic?.name ?? statement.clinicName ?? ""}`);
      await onSaved();
      onClose();
    } catch (err) {
      setError("Couldn't record the payment — " + err.message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Banknote size={16} className="text-emerald-600" />
          <h3 className="min-w-0 truncate text-sm font-bold text-slate-800">
            Record payment — {clinic?.name ?? "clinic"}
          </h3>
          <button onClick={onClose} className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-xs text-slate-400">
            {monthLabel(statement.month)} statement · {fmtOMR(statement.total)} total · {fmtOMR(remaining)} remaining
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Amount (OMR)</span>
            <input type="number" min="0" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Method</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="bank">Bank transfer</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Received on</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Reference {method === "cheque" ? "(cheque no. — required)" : "(optional)"}
            </span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} placeholder={method === "cheque" ? "Cheque number" : "Transfer ref, receipt no…"} />
          </label>
          {method === "cheque" && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              Cheques count toward this statement immediately but stay in the pending portfolio (Expenses &amp;
              Treasury tab) until you mark them cleared.
            </p>
          )}
        </div>
        <div className="border-t border-slate-100 p-4">
          {error && <p className="mb-2 text-xs font-semibold text-rose-600">{error}</p>}
          <button onClick={save} disabled={busy} className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
            {busy ? "Saving…" : "Record payment"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ================================================================== */
/*  Expenses & Treasury — spending ledger, cash/bank/cheque position    */
/* ================================================================== */

const EXPENSE_CATEGORIES = ["Materials", "Salaries", "Rent", "Utilities", "Maintenance", "Other"];

export function ExpensesPanel({ lab }) {
  const [expenses, setExpenses] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ category: "Materials", amount: "", method: "cash", description: "", invoiceNumber: "", date: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [ex, pay] = await Promise.all([fetchExpenses(lab.id), fetchPayments(lab.id)]);
      setExpenses(ex);
      setPayments(pay);
    } catch (err) {
      setError("Couldn't load expenses — " + err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab.id]);

  const treasury = useMemo(() => {
    let cashIn = 0, bankIn = 0, pendingCheques = 0, cashOut = 0, bankOut = 0;
    for (const p of payments) {
      if (p.method === "cash") cashIn += p.amount;
      else if (p.cleared) bankIn += p.amount; // cleared cheques land in the bank
      else pendingCheques += p.amount;
    }
    for (const e of expenses) {
      if (e.method === "cash") cashOut += e.amount;
      else bankOut += e.amount;
    }
    const thisMonth = new Date().toISOString().slice(0, 7);
    const monthSpend = expenses.filter((e) => (e.expenseDate ?? "").startsWith(thisMonth)).reduce((s, e) => s + e.amount, 0);
    return { cash: cashIn - cashOut, bank: bankIn - bankOut, pendingCheques, monthSpend };
  }, [payments, expenses]);

  const uncleared = payments.filter((p) => p.method === "cheque" && !p.cleared);

  const addExpense = async () => {
    const n = Number(form.amount);
    if (!n || n <= 0) {
      setError("Enter an expense amount above zero.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await insertExpense(lab.id, { category: form.category, amount: n, method: form.method, description: form.description.trim(), invoiceNumber: form.invoiceNumber.trim(), expenseDate: form.date });
      logActivity("added expense", `${fmtOMR(n)} — ${form.category}${form.description ? ` — ${form.description.trim()}` : ""}`);
      setForm((f) => ({ ...f, amount: "", description: "", invoiceNumber: "" }));
      await load();
    } catch (err) {
      setError("Couldn't save the expense — " + err.message);
    } finally {
      setBusy(false);
    }
  };

  const clearCheque = async (id) => {
    try {
      await markChequeCleared(id);
      await load();
    } catch (err) {
      setError("Couldn't mark the cheque cleared — " + err.message);
    }
  };

  const removeExpense = async (id) => {
    try {
      await deleteExpense(id);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError("Couldn't delete the expense — " + err.message);
    }
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={load} />}

      {/* Treasury */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TreasuryCard icon={Coins} label="Cash on hand" value={fmtOMR(treasury.cash)} sub="cash collected − cash spent" />
        <TreasuryCard icon={Landmark} label="Bank" value={fmtOMR(treasury.bank)} sub="transfers + cleared cheques − bank spend" />
        <TreasuryCard icon={Clock} label="Pending cheques" value={fmtOMR(treasury.pendingCheques)} sub={`${uncleared.length} awaiting clearance`} />
        <TreasuryCard icon={Wallet} label="Spend this month" value={fmtOMR(treasury.monthSpend)} sub="all methods" />
      </div>

      {/* Cheque portfolio */}
      {uncleared.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <h3 className="mb-2 text-sm font-bold text-slate-800">Cheques awaiting clearance</h3>
          <div className="space-y-1.5">
            {uncleared.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white px-3 py-2">
                <span className="text-sm font-semibold text-slate-700">{fmtOMR(p.amount)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
                  Cheque {p.reference || "—"} · received {p.receivedDate}
                </span>
                <button onClick={() => clearCheque(p.id)} className="flex shrink-0 items-center gap-1 rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                  <CheckCircle2 size={12} /> Mark cleared
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add expense */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-bold text-slate-800">Add expense</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Category</span>
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={inputCls}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Amount (OMR)</span>
            <input type="number" min="0" step="0.001" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Paid by</span>
            <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} className={inputCls}>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="bank">Bank</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Date</span>
            <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Invoice #</span>
            <input value={form.invoiceNumber} onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))} className={inputCls} placeholder="Supplier invoice no." />
          </label>
          <label className="block sm:col-span-2 lg:col-span-1">
            <span className="mb-1 block text-xs font-medium text-slate-600">Description</span>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={inputCls} placeholder="Zirconia discs, July rent…" />
          </label>
        </div>
        <button onClick={addExpense} disabled={busy} className="mt-3 flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40">
          <Plus size={14} /> {busy ? "Saving…" : "Add expense"}
        </button>
      </div>

      {/* Ledger */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-bold text-slate-800">Expense ledger</h3>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : expenses.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No expenses recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3">Invoice #</th>
                  <th className="pb-2 pr-3">Category</th>
                  <th className="pb-2 pr-3">Description</th>
                  <th className="pb-2 pr-3">Method</th>
                  <th className="pb-2 pr-3 text-right">Amount</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="py-2.5 pr-3 whitespace-nowrap text-slate-600">{e.expenseDate}</td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-slate-500">{e.invoiceNumber || "—"}</td>
                    <td className="py-2.5 pr-3 font-semibold text-slate-700">{e.category}</td>
                    <td className="max-w-[220px] truncate py-2.5 pr-3 text-slate-500">{e.description || "—"}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{METHOD_LABEL[e.method]}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800 whitespace-nowrap">{fmtOMR(e.amount)}</td>
                    <td className="py-2.5 text-right">
                      {confirmDelete === e.id ? (
                        <span className="whitespace-nowrap">
                          <button onClick={() => removeExpense(e.id)} className="rounded-lg bg-rose-600 px-2 py-1 text-[11px] font-bold text-white">Delete</button>
                          <button onClick={() => setConfirmDelete(null)} className="ml-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50">Keep</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDelete(e.id)} className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function TreasuryCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon size={14} />
        <p className="text-[10px] font-bold uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-1.5 text-xl font-bold text-slate-800">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

/* ================================================================== */
/*  Historical import — upload the old Excel workbook, sheet by sheet,  */
/*  so a lab joining the platform starts with its finance history.      */
/* ================================================================== */

function ImportHistoryCard({ lab, onImported }) {
  const [category, setCategory] = useState(IMPORT_CATEGORIES[0].id);
  const [fileName, setFileName] = useState("");
  const [mapped, setMapped] = useState(null); // result of mapImportRows
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  const cat = IMPORT_CATEGORIES.find((c) => c.id === category);

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // same file can be re-picked after changing category
    if (!file) return;
    setError("");
    setDone("");
    setBusy(true);
    try {
      const rows = await readWorkbookRows(file);
      setFileName(file.name);
      setMapped(mapImportRows(category, rows));
    } catch (err) {
      setMapped(null);
      setError("Couldn't read that file — " + err.message);
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!mapped) return;
    setBusy(true);
    setError("");
    try {
      await importFinanceRows(lab.id, mapped);
      logActivity("imported finance history", mapped.summary ?? "");
      setDone(`Imported: ${mapped.summary}`);
      setMapped(null);
      setFileName("");
      await onImported();
    } catch (err) {
      setError("Import failed — " + err.message + " (nothing after the failing row was written; fix the sheet and re-import the remainder)");
    } finally {
      setBusy(false);
    }
  };

  const hasRows = mapped && (mapped.statements.length || mapped.payments.length || mapped.expenses.length);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <Upload size={15} className="text-blue-600" />
        <h3 className="text-sm font-bold text-slate-800">Import finance history from Excel</h3>
      </div>
      <p className="mb-3 text-[11px] text-slate-400">
        Bring your old bookkeeping onto the platform — upload one sheet at a time (.xlsx or .csv, first
        worksheet is read). Imported bills and payments keep the clinic's name as text; they don't need the
        clinic to be registered.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Sheet type</span>
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setMapped(null); setFileName(""); setDone(""); }}
            className={inputCls}
          >
            {IMPORT_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <div className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Excel file</span>
          <label className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-gray-50 px-3 py-2 text-sm font-semibold text-slate-500 transition hover:border-blue-300 hover:text-blue-700">
            <Upload size={14} /> {fileName || "Choose file…"}
            <input type="file" accept=".xlsx,.xls,.csv" onChange={pickFile} className="hidden" />
          </label>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">{cat.hint}</p>

      {error && <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}
      {done && <p className="mt-2 text-xs font-semibold text-emerald-600">{done}</p>}

      {mapped && (
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
          <p className="text-xs font-semibold text-slate-700">{mapped.summary}</p>
          {hasRows ? (
            <>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {[...mapped.statements.slice(0, 4).map((x) => `Statement · ${x.clinicName} · ${monthLabel(x.month)} · ${fmtOMR(x.total)}${x.paid ? ` (paid ${fmtOMR(x.paid)})` : ""}`),
                  ...mapped.payments.slice(0, 4).map((x) => `Payment · ${x.clinicName || "—"} · ${x.receivedDate} · ${fmtOMR(x.amount)} · ${METHOD_LABEL[x.method]}${x.cleared === false ? " (pending)" : ""}`),
                  ...mapped.expenses.slice(0, 4).map((x) => `Expense · ${x.category} · ${x.expenseDate} · ${fmtOMR(x.amount)}`),
                ].map((line, i) => (
                  <p key={i} className="truncate text-[11px] text-slate-500">{line}</p>
                ))}
              </div>
              <button
                onClick={runImport}
                disabled={busy}
                className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
              >
                {busy ? "Importing…" : "Import these rows"}
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
