import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Tags,
  Plus,
  Trash2,
  Download,
  Upload,
  Star,
  AlertTriangle,
  Building2,
  DollarSign,
  Wallet,
  TrendingUp,
  CheckCheck,
  RefreshCcw,
  Users,
  UserCheck,
  UserPlus,
  X,
  Shield,
  Wrench,
} from "lucide-react";
import { CATEGORY_NAMES } from "./PrescriptionForm.jsx";
import { BASE_PRICE, caseFee } from "./Analytics.jsx";
import { STAGE_INDEX } from "./LifecycleEngine.jsx";
import {
  fetchPriceSchedules,
  createPriceSchedule,
  addPriceItem,
  updatePriceItem,
  deletePriceItem,
  setDefaultSchedule,
  deletePriceSchedule,
  fetchClinicPriceRules,
  upsertClinicPriceRule,
  deleteClinicPriceRule,
  fetchLabRoster,
  repriceUnbilledCases,
  updateCase,
  inviteLabMember,
  setMemberStatus,
  deleteInviteRows,
  addMemberRole,
  removeMemberRole,
  removeLabMember,
} from "./lib/data.js";

/* ================================================================== */
/*  Shared helpers — completion dates, units, money                    */
/* ================================================================== */

// First timestamp a case reached a given stage (same rule as Analytics).
const reachedDate = (c, stage) => {
  const e = (c.history ?? []).find((h) => h.toStage === stage && (h.action === "advance" || h.action === "created"));
  return e ? new Date(e.at) : null;
};
const completedAt = (c) => reachedDate(c, STAGE_INDEX.WORK_COMPLETE);

// Billable units on a case = teeth per restoration (min 1), matching the
// pricing trigger's math.
const caseUnits = (c) => {
  const rest = c.prescription?.restorations;
  if (rest?.length) return rest.reduce((n, r) => n + (r.teeth?.length || 1), 0);
  return c.prescription?.teeth?.length || 1;
};

/* ================================================================== */
/*  Price Lists manager — Lab Admin workspace (Phase 17)               */
/*  Prices live in price_schedules/price_schedule_items; actual case   */
/*  pricing happens in a DB trigger, so this UI only manages the data. */
/* ================================================================== */

const seedItems = () =>
  CATEGORY_NAMES.map((category) => ({ category, code: "", basePrice: BASE_PRICE[category] ?? 400 }));

const fmtMoney = (n) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });

/* ---------------- CSV helpers (quote-aware: categories contain commas) ---------------- */

const csvEscape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

function scheduleToCsv(schedule) {
  const lines = ["category,code,price"];
  for (const it of schedule.items) {
    lines.push([csvEscape(it.category), csvEscape(it.code), it.basePrice].join(","));
  }
  return lines.join("\n");
}

// Minimal RFC-ish parser: splits one line into fields honoring "quoted, fields".
function splitCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

function parsePriceCsv(text) {
  const rows = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const [category, code, price] = splitCsvLine(line);
    if (!category || category.toLowerCase() === "category") continue; // header
    const basePrice = Number.parseFloat(price);
    if (!Number.isFinite(basePrice) || basePrice < 0) continue;
    rows.push({ category, code: code ?? "", basePrice });
  }
  return rows;
}

/* ---------------- editable item row (uncontrolled; keyed by saved value) ---------------- */

function ItemRow({ item, busy, onSave, onDelete }) {
  const commit = (patch) => {
    const next = { code: item.code, basePrice: item.basePrice, ...patch };
    if (next.code === item.code && next.basePrice === item.basePrice) return;
    onSave(item.id, next);
  };
  return (
    <tr className="border-t border-slate-100">
      <td className="min-w-0 px-3 py-2 text-sm text-slate-700">{item.category}</td>
      <td className="px-2 py-1.5">
        <input
          defaultValue={item.code}
          disabled={busy}
          onBlur={(e) => commit({ code: e.target.value.trim() })}
          placeholder="—"
          className="w-20 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none transition focus:border-blue-400 focus:bg-white"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          defaultValue={item.basePrice}
          disabled={busy}
          onBlur={(e) => {
            const v = Number.parseFloat(e.target.value);
            if (!Number.isFinite(v) || v < 0) {
              e.target.value = item.basePrice; // revert bad input
              return;
            }
            commit({ basePrice: v });
          }}
          className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-right text-sm outline-none transition focus:border-blue-400 focus:bg-white"
        />
      </td>
      <td className="px-2 py-1.5 text-right">
        <button
          onClick={() => onDelete(item.id)}
          disabled={busy}
          className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600"
          title="Remove item"
        >
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  );
}

/* ---------------- one price list card ---------------- */

function ScheduleCard({ schedule, busy, onMutate, onMakeDefault, onDelete }) {
  const fileRef = useRef(null);
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const exportCsv = () => {
    const blob = new Blob([scheduleToCsv(schedule)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${schedule.name.replace(/[^\w-]+/g, "_").toLowerCase()}_prices.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importCsv = async (file) => {
    const text = await file.text();
    const rows = parsePriceCsv(text);
    if (!rows.length) return;
    await onMutate(async () => {
      const byCategory = Object.fromEntries(schedule.items.map((it) => [it.category, it]));
      for (const row of rows) {
        const existing = byCategory[row.category];
        if (existing) {
          if (existing.basePrice !== row.basePrice || existing.code !== row.code) {
            await updatePriceItem(existing.id, { code: row.code, basePrice: row.basePrice });
          }
        } else {
          await addPriceItem(schedule.id, row);
        }
      }
    });
  };

  const addItem = () => {
    const category = newCat.trim();
    const basePrice = Number.parseFloat(newPrice);
    if (!category || !Number.isFinite(basePrice) || basePrice < 0) return;
    onMutate(() => addPriceItem(schedule.id, { category, code: "", basePrice }));
    setNewCat("");
    setNewPrice("");
    setAdding(false);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-800">{schedule.name}</h3>
        {schedule.isDefault ? (
          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
            <Star size={10} /> Default
          </span>
        ) : (
          <button
            onClick={() => onMakeDefault(schedule.id)}
            disabled={busy}
            className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 transition hover:border-amber-300 hover:text-amber-700"
          >
            Make default
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={exportCsv}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
          >
            <Download size={13} /> Export
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
          >
            <Upload size={13} /> Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) importCsv(f);
            }}
          />
          {!schedule.isDefault &&
            (confirmDelete ? (
              <span className="flex items-center gap-1 text-xs">
                <button
                  onClick={() => onDelete(schedule.id)}
                  disabled={busy}
                  className="rounded-lg bg-rose-600 px-2 py-1.5 font-semibold text-white hover:bg-rose-700"
                >
                  Delete list
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg px-2 py-1.5 font-semibold text-slate-500 hover:bg-slate-50"
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600"
                title="Delete price list"
              >
                <Trash2 size={14} />
              </button>
            ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px]">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2">Restoration</th>
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2 text-right">Price (OMR)</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {schedule.items.map((it) => (
              <ItemRow
                key={`${it.id}:${it.basePrice}:${it.code}`}
                item={it}
                busy={busy}
                onSave={(id, patch) => onMutate(() => updatePriceItem(id, patch))}
                onDelete={(id) => onMutate(() => deletePriceItem(id))}
              />
            ))}
            {schedule.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-400">
                  No items yet — add one below or import a CSV.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-100 px-3 py-2.5">
        {adding ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              placeholder="Restoration / item name"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none transition focus:border-blue-400 focus:bg-white"
            />
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="Price"
              className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-right text-sm outline-none transition focus:border-blue-400 focus:bg-white"
            />
            <button
              onClick={addItem}
              disabled={busy}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            >
              Add
            </button>
            <button
              onClick={() => setAdding(false)}
              className="rounded-lg px-2 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            <Plus size={15} /> Add item
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- clinic tier rates ---------------- */

function ClinicTierRow({ clinic, rule, schedules, busy, onChange, onClear }) {
  return (
    <tr className="border-t border-slate-100">
      <td className="min-w-0 px-3 py-2">
        <p className="truncate text-sm font-medium text-slate-700">{clinic.name}</p>
        <p className="truncate text-xs text-slate-400">{clinic.dentist || "—"}</p>
      </td>
      <td className="px-2 py-1.5">
        <select
          value={rule?.priceScheduleId ?? ""}
          disabled={busy}
          onChange={(e) => onChange({ priceScheduleId: e.target.value || null, discountPct: rule?.discountPct ?? 0 })}
          className="w-full max-w-[180px] rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none transition focus:border-blue-400 focus:bg-white"
        >
          <option value="">Default list</option>
          {schedules.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          min="-100"
          max="100"
          step="any"
          inputMode="decimal"
          defaultValue={rule?.discountPct ?? 0}
          disabled={busy}
          onBlur={(e) => {
            const v = Number.parseFloat(e.target.value);
            const pct = Number.isFinite(v) ? Math.max(-100, Math.min(100, v)) : 0;
            if (pct === (rule?.discountPct ?? 0)) return;
            onChange({ priceScheduleId: rule?.priceScheduleId ?? null, discountPct: pct });
          }}
          className="w-20 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-right text-sm outline-none transition focus:border-blue-400 focus:bg-white"
        />
      </td>
      <td className="px-2 py-1.5 text-right">
        {rule && (
          <button
            onClick={onClear}
            disabled={busy}
            className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
          >
            Reset
          </button>
        )}
      </td>
    </tr>
  );
}

/* ---------------- top-level manager ---------------- */

export function PriceListsManager({ lab, clinicsById }) {
  const [schedules, setSchedules] = useState(null); // null = loading
  const [rules, setRules] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addingList, setAddingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [repriceState, setRepriceState] = useState({ confirming: false, message: "" });

  const load = () => {
    Promise.all([fetchPriceSchedules(lab.id), fetchClinicPriceRules(lab.id)])
      .then(([s, r]) => {
        setSchedules(s);
        setRules(r);
        setError("");
      })
      .catch((err) => setError(err.message));
  };

  useEffect(load, [lab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run a mutation, then refetch — data is small, correctness beats cleverness.
  const mutate = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const clinics = Object.values(clinicsById ?? {}).sort((a, b) => a.name.localeCompare(b.name));
  const ruleByClinic = Object.fromEntries(rules.map((r) => [r.clinicId, r]));

  // Initial load never finished: show only the error + retry (offering
  // "Create price list" on top of a failed load would just fail again).
  if (schedules === null) {
    return error ? (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
        <AlertTriangle size={15} className="shrink-0" />
        <span className="min-w-0 flex-1">{error}</span>
        <button
          onClick={load}
          className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Retry
        </button>
      </div>
    ) : (
      <p className="py-16 text-center text-sm text-slate-400">Loading price lists…</p>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          <AlertTriangle size={15} className="shrink-0" /> {error}
        </div>
      )}

      {(schedules ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <Tags size={22} />
          </div>
          <h3 className="text-sm font-bold text-slate-700">No price list yet</h3>
          <p className="max-w-sm text-sm text-slate-500">
            Create your master price list to start pricing incoming cases automatically. It starts
            pre-filled with every restoration type — adjust the numbers to your lab's rates.
          </p>
          <button
            onClick={() =>
              mutate(() => createPriceSchedule(lab.id, "Master Price List", { isDefault: true, items: seedItems() }))
            }
            disabled={busy}
            className="mt-1 flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-40"
          >
            <Plus size={15} /> Create master price list
          </button>
        </div>
      ) : (
        <>
          {schedules.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              busy={busy}
              onMutate={mutate}
              onMakeDefault={(id) => mutate(() => setDefaultSchedule(lab.id, id))}
              onDelete={(id) => mutate(() => deletePriceSchedule(id))}
            />
          ))}

          {addingList ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <input
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder='Price list name (e.g. "VIP rate")'
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:bg-white"
              />
              <button
                onClick={() => {
                  const name = newListName.trim();
                  if (!name) return;
                  mutate(() => createPriceSchedule(lab.id, name, { items: seedItems() }));
                  setNewListName("");
                  setAddingList(false);
                }}
                disabled={busy}
                className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              >
                Create
              </button>
              <button
                onClick={() => setAddingList(false)}
                className="rounded-lg px-2 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingList(true)}
              className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              <Plus size={15} /> New price list
            </button>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <Building2 size={15} className="text-blue-600" />
              <h3 className="text-sm font-bold text-slate-800">Clinic rates</h3>
              <p className="ml-auto text-xs text-slate-400">Positive % = discount</p>
            </div>
            {clinics.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                Clinics appear here once they've sent you a case.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px]">
                  <thead>
                    <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      <th className="px-3 py-2">Clinic</th>
                      <th className="px-2 py-2">Price list</th>
                      <th className="px-2 py-2 text-right">Discount %</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {clinics.map((c) => {
                      const rule = ruleByClinic[c.id];
                      return (
                        <ClinicTierRow
                          key={`${c.id}:${rule?.discountPct ?? 0}:${rule?.priceScheduleId ?? ""}`}
                          clinic={c}
                          rule={rule}
                          schedules={schedules}
                          busy={busy}
                          onChange={(next) => mutate(() => upsertClinicPriceRule(lab.id, c.id, next))}
                          onClear={() => mutate(() => deleteClinicPriceRule(lab.id, c.id))}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Re-price every draft case at current rates. Issued/paid
              invoices are frozen server-side, so this can't rewrite
              anything already billed. */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <RefreshCcw size={15} className="shrink-0 text-blue-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-700">Re-price unbilled cases</p>
              <p className="text-xs text-slate-400">
                Applies your current price lists to every case not yet issued or paid — including cases created
                before pricing existed.
              </p>
            </div>
            {repriceState.message && <p className="text-xs font-semibold text-emerald-600">{repriceState.message}</p>}
            {repriceState.confirming ? (
              <span className="flex items-center gap-1.5">
                <button
                  onClick={() =>
                    mutate(async () => {
                      const n = await repriceUnbilledCases();
                      setRepriceState({ confirming: false, message: `Re-priced ${n} case${n === 1 ? "" : "s"}.` });
                    })
                  }
                  disabled={busy}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  {busy ? "Working…" : "Yes, re-price"}
                </button>
                <button
                  onClick={() => setRepriceState({ confirming: false, message: "" })}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setRepriceState({ confirming: true, message: "" })}
                disabled={busy}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
              >
                Re-price now
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Charts — hand-rolled SVG, validated categorical palette            */
/*  (slots in fixed order; "Other" is neutral, never a series hue)     */
/* ================================================================== */

const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const OTHER_COLOR = "#898781";
const fmtOMR = (n) => `${fmtMoney(n)} OMR`;

function LineChart({ labels, series }) {
  const [hover, setHover] = useState(null);
  const W = 760;
  const H = 240;
  const padL = 40;
  const padR = 96; // room for direct end-labels
  const padT = 14;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = labels.length;
  const maxY = Math.max(1, ...series.flatMap((s) => s.values));
  const yMax = Math.max(4, Math.ceil(maxY / 4) * 4);
  const x = (i) => padL + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const y = (v) => padT + innerH * (1 - v / yMax);
  const tickEvery = Math.max(1, Math.ceil(n / 6));

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - padL) / innerW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap gap-4">
        {series.map((s, si) => (
          <span key={s.name} className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES_COLORS[si] }} />
            {s.name}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {[1, 2, 3, 4].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y((yMax / 4) * t)} y2={y((yMax / 4) * t)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={padL - 6} y={y((yMax / 4) * t) + 3} textAnchor="end" fontSize="10" fill="#898781">
              {(yMax / 4) * t}
            </text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="#c3c2b7" strokeWidth="1" />
        {labels.map((lb, i) =>
          i % tickEvery === 0 ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#898781">
              {lb}
            </text>
          ) : null
        )}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={y(0)} stroke="#cbd5e1" strokeDasharray="3 3" />}
        {series.map((s, si) => (
          <g key={s.name}>
            <polyline
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              fill="none"
              stroke={SERIES_COLORS[si]}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {n > 0 && (
              <g>
                <circle cx={x(n - 1)} cy={y(s.values[n - 1])} r="3" fill={SERIES_COLORS[si]} />
                <text x={x(n - 1) + 7} y={y(s.values[n - 1]) + 3} fontSize="11" fill="#52514e">
                  {s.name}
                </text>
              </g>
            )}
            {hover != null && (
              <circle cx={x(hover)} cy={y(s.values[hover])} r="4" fill={SERIES_COLORS[si]} stroke="#ffffff" strokeWidth="2" />
            )}
          </g>
        ))}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-8 z-10 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-md"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          <p className="text-[10px] font-semibold text-slate-400">{labels[hover]}</p>
          {series.map((s, si) => (
            <p key={s.name} className="flex items-center gap-1.5 text-xs text-slate-700">
              <span className="h-2 w-2 rounded-full" style={{ background: SERIES_COLORS[si] }} />
              {s.name}: <span className="font-semibold">{s.values[hover]}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function DonutChart({ slices, centerLabel }) {
  const [hover, setHover] = useState(null);
  const total = slices.reduce((a, s) => a + s.value, 0);
  const R = 56;
  const C = 2 * Math.PI * R;
  const gap = 2;
  let acc = 0;
  const segments = slices.map((s) => {
    const len = total > 0 ? (s.value / total) * C : 0;
    const seg = { ...s, offset: acc, len };
    acc += len;
    return seg;
  });
  const shown = hover != null ? segments[hover] : null;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 160 160" className="h-40 w-40 shrink-0">
        <g transform="rotate(-90 80 80)">
          {segments.map((s, i) => (
            <circle
              key={s.label}
              cx="80"
              cy="80"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === i ? 30 : 26}
              strokeDasharray={`${Math.max(0.1, s.len - gap)} ${C - Math.max(0.1, s.len - gap)}`}
              strokeDashoffset={-s.offset}
              style={{ cursor: "pointer", transition: "stroke-width 120ms" }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </g>
        <text x="80" y="76" textAnchor="middle" fontSize="12" fill="#52514e">
          {shown ? `${total > 0 ? Math.round((shown.value / total) * 100) : 0}%` : centerLabel}
        </text>
        <text x="80" y="94" textAnchor="middle" fontSize="13" fontWeight="700" fill="#0b0b0b">
          {fmtMoney(shown ? shown.value : total)}
        </text>
      </svg>
      {/* value-labeled legend doubles as the table view */}
      <div className="min-w-0 flex-1 space-y-1">
        {segments.map((s, i) => (
          <div
            key={s.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={`flex items-center gap-2 rounded-md px-1.5 py-1 text-xs ${hover === i ? "bg-slate-50" : ""}`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className={`min-w-0 flex-1 truncate ${hover === i ? "font-semibold text-slate-800" : "text-slate-600"}`}>
              {s.label}
            </span>
            <span className="font-semibold text-slate-700">{fmtMoney(s.value)}</span>
            <span className="w-9 text-right text-slate-400">
              {total > 0 ? `${Math.round((s.value / total) * 100)}%` : "—"}
            </span>
          </div>
        ))}
        {segments.length === 0 && <p className="text-xs text-slate-400">No revenue in this period yet.</p>}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Overview — executive analytics (Lab Admin workspace)               */
/* ================================================================== */

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const RANGE_PRESETS = [
  { id: "7d", label: "7 days" },
  { id: "month", label: "This month" },
  { id: "quarter", label: "Quarter" },
  { id: "year", label: "Year" },
  { id: "custom", label: "Custom" },
];

function rangeBounds(preset, custom) {
  const now = new Date();
  const endToday = new Date(startOfDay(now).getTime() + 86_400_000 - 1);
  if (preset === "7d") return { from: new Date(startOfDay(now).getTime() - 6 * 86_400_000), to: endToday };
  if (preset === "quarter")
    return { from: new Date(now.getFullYear(), now.getMonth() - (now.getMonth() % 3), 1), to: endToday };
  if (preset === "year") return { from: new Date(now.getFullYear(), 0, 1), to: endToday };
  if (preset === "custom") {
    const from = custom.from ? new Date(custom.from + "T00:00:00") : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = custom.to ? new Date(custom.to + "T23:59:59") : endToday;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endToday };
}

function StatCard({ icon: Icon, label, value, sub }) {
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

function revenueByCategory(cases) {
  const map = {};
  for (const c of cases) {
    const total = caseFee(c).total;
    const rest = c.prescription?.restorations;
    if (rest?.length) {
      const weights = rest.map((r) => (BASE_PRICE[r.category] ?? 400) * (r.teeth?.length || 1));
      const wSum = weights.reduce((a, b) => a + b, 0) || 1;
      rest.forEach((r, i) => {
        map[r.category] = (map[r.category] ?? 0) + (total * weights[i]) / wSum;
      });
    } else {
      const cat = c.prescription?.category || "Uncategorised";
      map[cat] = (map[cat] ?? 0) + total;
    }
  }
  return map;
}

export function OverviewDashboard({ cases }) {
  const [preset, setPreset] = useState("month");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const { from, to } = rangeBounds(preset, custom);

  const stats = useMemo(() => {
    const inRange = (d) => d && d >= from && d <= to;
    const completed = cases.filter((c) => inRange(completedAt(c)));
    const revenue = completed.reduce((s, c) => s + caseFee(c).total, 0);
    const outstanding = cases
      .filter((c) => completedAt(c) && c.invoiceStatus !== "paid")
      .reduce((s, c) => s + caseFee(c).total, 0);
    const remakes = completed.filter((c) => c.remake).length;
    const hasEstimates = completed.some((c) => !caseFee(c).priced);

    // daily buckets (weekly past ~3 months to keep the chart readable)
    const dayMs = 86_400_000;
    const spanDays = Math.max(1, Math.round((to - from) / dayMs));
    const weekly = spanDays > 92;
    const bucketMs = weekly ? 7 * dayMs : dayMs;
    const bucketCount = Math.max(1, Math.ceil((to - from) / bucketMs));
    const labels = [];
    const intake = new Array(bucketCount).fill(0);
    const done = new Array(bucketCount).fill(0);
    for (let i = 0; i < bucketCount; i++) {
      const d = new Date(from.getTime() + i * bucketMs);
      labels.push(d.toLocaleDateString(undefined, { day: "numeric", month: "short" }));
    }
    const bucketOf = (d) => Math.min(bucketCount - 1, Math.max(0, Math.floor((d - from) / bucketMs)));
    for (const c of cases) {
      const created = c.createdAt ? new Date(c.createdAt) : null;
      if (inRange(created)) intake[bucketOf(created)] += 1;
      const fin = completedAt(c);
      if (inRange(fin)) done[bucketOf(fin)] += 1;
    }

    const byCat = revenueByCategory(completed);
    const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5).map(([label, value], i) => ({ label, value, color: SERIES_COLORS[i] }));
    const otherSum = sorted.slice(5).reduce((s, [, v]) => s + v, 0);
    if (otherSum > 0) top.push({ label: "Other", value: otherSum, color: OTHER_COLOR });

    return { completed, revenue, outstanding, remakes, hasEstimates, labels, intake, done, donut: top };
  }, [cases, from.getTime(), to.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const aov = stats.completed.length ? stats.revenue / stats.completed.length : 0;
  const remakeRate = stats.completed.length ? (stats.remakes / stats.completed.length) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              preset === p.id ? "bg-blue-600 text-white shadow-sm" : "bg-white text-slate-500 hover:text-slate-700"
            }`}
          >
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <span className="flex items-center gap-1.5">
            <input
              type="date"
              value={custom.from}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
            />
            <span className="text-xs text-slate-400">→</span>
            <input
              type="date"
              value={custom.to}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
            />
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={DollarSign} label="Gross revenue" value={fmtOMR(stats.revenue)} sub="completed in period" />
        <StatCard icon={Wallet} label="Uncollected" value={fmtOMR(stats.outstanding)} sub="all time, not yet paid" />
        <StatCard icon={TrendingUp} label="Avg order value" value={fmtOMR(aov)} />
        <StatCard icon={CheckCheck} label="Cases completed" value={stats.completed.length} />
        <StatCard icon={RefreshCcw} label="Remake rate" value={`${remakeRate.toFixed(1)}%`} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 lg:col-span-3">
          <h3 className="mb-3 text-sm font-bold text-slate-800">Case intake vs completed</h3>
          <LineChart
            labels={stats.labels}
            series={[
              { name: "Intake", values: stats.intake },
              { name: "Completed", values: stats.done },
            ]}
          />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-bold text-slate-800">Revenue by restoration type</h3>
          <DonutChart slices={stats.donut} centerLabel="Total OMR" />
        </div>
      </div>

      {stats.hasEstimates && (
        <p className="text-[11px] text-slate-400">
          * Includes estimated fees for cases created before your price lists — use “Re-price unbilled cases” in
          Price Lists to apply real rates.
        </p>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Technicians — roster, output, batch re-assignment                  */
/* ================================================================== */

const STATUS_CHIP = {
  active: "bg-emerald-100 text-emerald-700",
  read_only: "bg-amber-100 text-amber-700",
  suspended: "bg-rose-100 text-rose-700",
  invited: "bg-slate-100 text-slate-500",
};

function AssignModal({ open, onClose, techs, cases, techNameById }) {
  const [selected, setSelected] = useState({});
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setSelected({});
      setTarget("");
      setError("");
    }
  }, [open]);

  if (!open) return null;
  const chosen = Object.keys(selected).filter((id) => selected[id]);

  const assign = async () => {
    if (!target || !chosen.length || busy) return;
    setBusy(true);
    setError("");
    try {
      for (const id of chosen) {
        await updateCase(id, { assignedTechId: target === "__none" ? null : target });
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <UserCheck size={16} className="text-blue-600" />
          <h3 className="text-sm font-bold text-slate-800">Re-assign cases</h3>
          <button onClick={onClose} className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {cases.length === 0 && <p className="px-3 py-8 text-center text-sm text-slate-400">No active cases.</p>}
          {cases.map((c) => (
            <label
              key={c.id}
              className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ${selected[c.id] ? "bg-blue-50" : "hover:bg-slate-50"}`}
            >
              <input
                type="checkbox"
                checked={!!selected[c.id]}
                onChange={(e) => setSelected((s) => ({ ...s, [c.id]: e.target.checked }))}
                className="h-4 w-4 accent-blue-600"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-700">{c.patientName}</span>
                <span className="block truncate text-xs text-slate-400">
                  {caseUnits(c)} unit{caseUnits(c) === 1 ? "" : "s"} ·{" "}
                  {c.assignedTechId ? techNameById[c.assignedTechId] ?? "Assigned" : "Unassigned"}
                </span>
              </span>
            </label>
          ))}
        </div>
        {error && <p className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-600">{error}</p>}
        <div className="flex items-center gap-2 border-t border-slate-100 p-3">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white"
          >
            <option value="">Assign to…</option>
            {techs.map((t) => (
              <option key={t.userId} value={t.userId}>
                {t.name}
              </option>
            ))}
            <option value="__none">— Unassign —</option>
          </select>
          <button
            onClick={assign}
            disabled={busy || !target || !chosen.length}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {busy ? "Assigning…" : `Assign ${chosen.length || ""}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function TechniciansPanel({ lab, cases }) {
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLabRoster(lab.id)
      .then((r) => !cancelled && setRoster(r))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [lab.id]);

  const techs = (roster ?? []).filter((p) => p.userId && p.roles.includes("lab_tech"));
  const techNameById = Object.fromEntries(techs.map((t) => [t.userId, t.name]));
  const activeCases = cases.filter((c) => c.stageIndex < STAGE_INDEX.WORK_COMPLETE);
  const unassigned = activeCases.filter((c) => !c.assignedTechId);

  const now = new Date();
  const dayStart = startOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const rows = techs.map((t) => {
    const assigned = cases.filter((c) => c.assignedTechId === t.userId);
    const finished = assigned
      .map((c) => ({ c, at: completedAt(c) }))
      .filter((x) => x.at);
    const unitsSince = (since) => finished.filter((x) => x.at >= since).reduce((s, x) => s + caseUnits(x.c), 0);
    const laborMonth = finished.filter((x) => x.at >= monthStart).reduce((s, x) => s + caseFee(x.c).total, 0);
    return {
      ...t,
      activeLoad: assigned.filter((c) => c.stageIndex < STAGE_INDEX.WORK_COMPLETE).length,
      unitsDay: unitsSince(dayStart),
      unitsMonth: unitsSince(monthStart),
      unitsYear: unitsSince(yearStart),
      laborMonth,
      remakeRate: finished.length ? (finished.filter((x) => x.c.remake).length / finished.length) * 100 : null,
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-blue-600" />
          <h3 className="text-sm font-bold text-slate-800">Technician workload</h3>
        </div>
        <p className="text-xs text-slate-400">
          {unassigned.length} unassigned active case{unassigned.length === 1 ? "" : "s"}
        </p>
        <button
          onClick={() => setAssignOpen(true)}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <UserCheck size={15} /> Re-assign cases
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          <AlertTriangle size={15} className="shrink-0" /> {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2.5">Technician</th>
                <th className="px-2 py-2.5 text-right">Active load</th>
                <th className="px-2 py-2.5 text-right">Units today</th>
                <th className="px-2 py-2.5 text-right">Month</th>
                <th className="px-2 py-2.5 text-right">Year</th>
                <th className="px-2 py-2.5 text-right">Value (OMR/mo)</th>
                <th className="px-2 py-2.5 text-right">Remake %</th>
              </tr>
            </thead>
            <tbody>
              {roster === null && !error && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">
                    Loading roster…
                  </td>
                </tr>
              )}
              {roster !== null && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">
                    No technicians yet — invite your team from the Staff tab.
                  </td>
                </tr>
              )}
              {rows.map((t) => (
                <tr key={t.userId} className="border-t border-slate-100">
                  <td className="min-w-0 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-700">{t.name}</span>
                        <span className="mt-0.5 flex items-center gap-1">
                          {t.roles.includes("lab_admin") && (
                            <span className="flex items-center gap-0.5 rounded bg-violet-100 px-1 py-px text-[9px] font-bold uppercase text-violet-600">
                              <Shield size={9} /> Admin
                            </span>
                          )}
                          <span className="flex items-center gap-0.5 rounded bg-blue-100 px-1 py-px text-[9px] font-bold uppercase text-blue-600">
                            <Wrench size={9} /> Tech
                          </span>
                          <span className={`rounded px-1 py-px text-[9px] font-bold uppercase ${STATUS_CHIP[t.status] ?? STATUS_CHIP.invited}`}>
                            {t.status.replace("_", "-")}
                          </span>
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-right text-sm font-semibold text-slate-700">{t.activeLoad}</td>
                  <td className="px-2 py-2.5 text-right text-sm text-slate-600">{t.unitsDay}</td>
                  <td className="px-2 py-2.5 text-right text-sm text-slate-600">{t.unitsMonth}</td>
                  <td className="px-2 py-2.5 text-right text-sm text-slate-600">{t.unitsYear}</td>
                  <td className="px-2 py-2.5 text-right text-sm text-slate-600">{fmtMoney(t.laborMonth)}</td>
                  <td className="px-2 py-2.5 text-right text-sm text-slate-600">
                    {t.remakeRate == null ? "—" : `${t.remakeRate.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AssignModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        techs={techs}
        cases={activeCases}
        techNameById={techNameById}
      />
    </div>
  );
}

/* ================================================================== */
/*  Staff — invites + access control (Phase 19)                        */
/* ================================================================== */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function StaffPanel({ lab, meId }) {
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoles, setInviteRoles] = useState({ lab_admin: false, lab_tech: true });
  const [confirmRemove, setConfirmRemove] = useState(null); // userId pending removal confirm

  const load = () => {
    fetchLabRoster(lab.id)
      .then((r) => {
        setRoster(r);
        setError("");
      })
      .catch((err) => setError(err.message));
  };
  useEffect(load, [lab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutate = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const invite = () => {
    const email = inviteEmail.trim();
    const roles = Object.keys(inviteRoles).filter((r) => inviteRoles[r]);
    if (!EMAIL_RE.test(email) || !roles.length) return;
    mutate(() => inviteLabMember(lab.id, email, roles));
    setInviteEmail("");
    setInviteRoles({ lab_admin: false, lab_tech: true });
  };

  // Grant/revoke one role on an existing member. Revoking their last role is
  // blocked — that's what Remove is for.
  const toggleRole = (p, role) => {
    const has = p.roles.includes(role);
    if (has && p.roles.length === 1) {
      setError("A member needs at least one role — use Remove to take them off the lab entirely.");
      return;
    }
    mutate(() =>
      has ? removeMemberRole(p.roleRows[role]) : addMemberRole(lab.id, p.userId, p.email, role, p.status)
    );
  };

  const people = roster ?? [];

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          <AlertTriangle size={15} className="shrink-0" /> {error}
        </div>
      )}

      {/* invite */}
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <UserPlus size={15} className="text-blue-600" />
          <h3 className="text-sm font-bold text-slate-800">Invite a team member</h3>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          When someone signs up with this email and picks “Laboratory”, they'll be offered to join {lab.name}{" "}
          automatically.
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="technician@example.com"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:bg-white"
          />
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              checked={inviteRoles.lab_tech}
              onChange={(e) => setInviteRoles((r) => ({ ...r, lab_tech: e.target.checked }))}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            Technician
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              checked={inviteRoles.lab_admin}
              onChange={(e) => setInviteRoles((r) => ({ ...r, lab_admin: e.target.checked }))}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            Lab Admin
          </label>
          <button
            onClick={invite}
            disabled={busy || !EMAIL_RE.test(inviteEmail.trim()) || (!inviteRoles.lab_admin && !inviteRoles.lab_tech)}
            className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            Invite
          </button>
        </div>
      </div>

      {/* roster */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2.5">Member</th>
                <th className="px-2 py-2.5">Roles</th>
                <th className="px-2 py-2.5">Access</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {roster === null && !error && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-400">Loading roster…</td>
                </tr>
              )}
              {roster !== null && people.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-400">
                    No staff yet — send your first invite above.
                  </td>
                </tr>
              )}
              {people.map((p) => {
                const isInvitePending = !p.userId;
                const isOwner = p.userId && p.userId === lab.ownerId;
                const isSelf = p.userId && p.userId === meId;
                const locked = isOwner || isSelf;
                return (
                  <tr key={p.userId ?? p.email} className="border-t border-slate-100">
                    <td className="min-w-0 px-3 py-2.5">
                      <p className="truncate text-sm font-medium text-slate-700">
                        {p.name}
                        {isOwner && <span className="ml-1.5 text-[10px] font-bold uppercase text-amber-600">Owner</span>}
                        {isSelf && !isOwner && <span className="ml-1.5 text-[10px] font-bold uppercase text-slate-400">You</span>}
                      </p>
                      <p className="truncate text-xs text-slate-400">{p.email || "—"}</p>
                    </td>
                    <td className="px-2 py-2.5">
                      {isInvitePending || locked ? (
                        <span className="flex items-center gap-1">
                          {p.roles.includes("lab_admin") && (
                            <span className="flex items-center gap-0.5 rounded bg-violet-100 px-1 py-px text-[9px] font-bold uppercase text-violet-600">
                              <Shield size={9} /> Admin
                            </span>
                          )}
                          {p.roles.includes("lab_tech") && (
                            <span className="flex items-center gap-0.5 rounded bg-blue-100 px-1 py-px text-[9px] font-bold uppercase text-blue-600">
                              <Wrench size={9} /> Tech
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <button
                            onClick={() => toggleRole(p, "lab_admin")}
                            disabled={busy}
                            title={p.roles.includes("lab_admin") ? "Revoke Lab Admin" : "Grant Lab Admin"}
                            className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase transition ${
                              p.roles.includes("lab_admin")
                                ? "bg-violet-100 text-violet-600 hover:bg-violet-200"
                                : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-500"
                            }`}
                          >
                            <Shield size={9} /> Admin
                          </button>
                          <button
                            onClick={() => toggleRole(p, "lab_tech")}
                            disabled={busy}
                            title={p.roles.includes("lab_tech") ? "Revoke Technician" : "Grant Technician"}
                            className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase transition ${
                              p.roles.includes("lab_tech")
                                ? "bg-blue-100 text-blue-600 hover:bg-blue-200"
                                : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-500"
                            }`}
                          >
                            <Wrench size={9} /> Tech
                          </button>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      {isInvitePending ? (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_CHIP.invited}`}>
                          Invited — awaiting signup
                        </span>
                      ) : locked ? (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_CHIP[p.status] ?? STATUS_CHIP.invited}`}>
                          {p.status.replace("_", "-")}
                        </span>
                      ) : (
                        <select
                          value={p.status}
                          disabled={busy}
                          onChange={(e) => mutate(() => setMemberStatus(p.memberRowIds, e.target.value))}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-semibold outline-none focus:border-blue-400 focus:bg-white"
                        >
                          <option value="active">Active</option>
                          <option value="read_only">Read-only</option>
                          <option value="suspended">Suspended</option>
                        </select>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {isInvitePending ? (
                        <button
                          onClick={() => mutate(() => deleteInviteRows(p.memberRowIds))}
                          disabled={busy}
                          className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600"
                          title="Cancel invite"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : locked ? null : confirmRemove === p.userId ? (
                        <span className="flex items-center justify-end gap-1 text-xs">
                          <button
                            onClick={() => {
                              setConfirmRemove(null);
                              mutate(() => removeLabMember(p.userId));
                            }}
                            disabled={busy}
                            className="rounded-lg bg-rose-600 px-2 py-1.5 font-semibold text-white hover:bg-rose-700"
                          >
                            Remove
                          </button>
                          <button
                            onClick={() => setConfirmRemove(null)}
                            className="rounded-lg px-2 py-1.5 font-semibold text-slate-500 hover:bg-slate-50"
                          >
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmRemove(p.userId)}
                          disabled={busy}
                          className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600"
                          title="Remove from lab"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        Suspended members lose all access instantly; read-only members can view but not change anything. The owner
        and your own row can't be locked out from here.
      </p>
    </div>
  );
}

export default PriceListsManager;
export { fmtMoney };
