import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
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
} from "./lib/data.js";
import { downloadStatementPdf } from "./lib/statementPdf.js";

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
    const rows = cases.filter(
      (c) => c.invoiceStatus === "draft" && !c.statementId && completedAt(c) && (c.totalPrice ?? 0) > 0,
    );
    return { count: rows.length, total: rows.reduce((s, c) => s + (c.totalPrice ?? 0), 0) };
  }, [cases]);

  // Receivables aging: remaining balance of open statements bucketed by
  // how long since the billed month ended.
  const aging = useMemo(() => {
    const buckets = { "0–30 days": 0, "31–60 days": 0, "60+ days": 0 };
    const now = Date.now();
    for (const s of statements) {
      if (s.status === "paid") continue;
      const remaining = Math.max(0, s.total - (paidByStatement[s.id] ?? 0));
      if (remaining <= 0) continue;
      const end = new Date(s.month + "T00:00:00");
      end.setMonth(end.getMonth() + 1);
      const days = Math.floor((now - end.getTime()) / 86400000);
      buckets[days <= 30 ? "0–30 days" : days <= 60 ? "31–60 days" : "60+ days"] += remaining;
    }
    return buckets;
  }, [statements, paidByStatement]);
  const outstanding = Object.values(aging).reduce((a, b) => a + b, 0);

  const runGenerate = async () => {
    setGenState({ confirming: false, busy: true, message: "" });
    try {
      const n = await generateStatements(genMonth);
      setGenState({ confirming: false, busy: false, message: n ? `${n} statement${n === 1 ? "" : "s"} generated.` : "Nothing to bill for that month." });
      await load();
    } catch (err) {
      setGenState({ confirming: false, busy: false, message: "" });
      setError("Couldn't generate statements — " + err.message);
    }
  };

  const downloadPdf = async (s) => {
    const included = cases
      .filter((c) => c.statementId === s.id)
      .map((c) => ({ ...c, completedAtLabel: completedAt(c)?.toLocaleDateString("en-GB") ?? "" }));
    await downloadStatementPdf({
      lab,
      clinic: clinicsById[s.clinicId],
      statement: s,
      cases: included,
      paidSoFar: paidByStatement[s.id] ?? 0,
    });
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

      {/* Aging */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Object.entries(aging).map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Outstanding {label}</p>
            <p className={`mt-1.5 text-xl font-bold ${value > 0 && label === "60+ days" ? "text-rose-600" : "text-slate-800"}`}>{fmtOMR(value)}</p>
          </div>
        ))}
      </div>

      {/* Statements */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-800">Statements</h3>
          <span className="text-xs font-semibold text-slate-500">{fmtOMR(outstanding)} outstanding</span>
        </div>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : statements.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No statements yet — generate your first monthly run above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-3">Month</th>
                  <th className="pb-2 pr-3">Clinic</th>
                  <th className="pb-2 pr-3 text-right">Total</th>
                  <th className="pb-2 pr-3 text-right">Paid</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {statements.map((s) => {
                  const paid = paidByStatement[s.id] ?? 0;
                  return (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="py-2.5 pr-3 whitespace-nowrap text-slate-600">{monthLabel(s.month)}</td>
                      <td className="max-w-[180px] truncate py-2.5 pr-3 font-semibold text-slate-700">
                        {clinicsById[s.clinicId]?.name ?? "Unknown clinic"}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-semibold text-slate-800 whitespace-nowrap">{fmtOMR(s.total)}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600 whitespace-nowrap">{fmtOMR(paid)}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RecordPaymentModal
        open={!!payFor}
        statement={payFor}
        clinic={payFor ? clinicsById[payFor.clinicId] : null}
        remaining={payFor ? Math.max(0, payFor.total - (paidByStatement[payFor.id] ?? 0)) : 0}
        labId={lab.id}
        onClose={() => setPayFor(null)}
        onSaved={load}
      />
    </div>
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
        statementId: statement.id,
        amount: n,
        method,
        reference: reference.trim(),
        receivedDate: date,
      });
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
  const [form, setForm] = useState({ category: "Materials", amount: "", method: "cash", description: "", date: new Date().toISOString().slice(0, 10) });
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
      await insertExpense(lab.id, { category: form.category, amount: n, method: form.method, description: form.description.trim(), expenseDate: form.date });
      setForm((f) => ({ ...f, amount: "", description: "" }));
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-3">Date</th>
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
