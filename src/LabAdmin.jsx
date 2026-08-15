import React, { useEffect, useRef, useState } from "react";
import {
  Tags,
  Plus,
  Trash2,
  Download,
  Upload,
  Star,
  AlertTriangle,
  Building2,
} from "lucide-react";
import { CATEGORY_NAMES } from "./PrescriptionForm.jsx";
import { BASE_PRICE } from "./Analytics.jsx";
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
} from "./lib/data.js";

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
        </>
      )}
    </div>
  );
}

export default PriceListsManager;
export { fmtMoney };
