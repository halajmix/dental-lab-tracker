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
  Banknote,
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
  Search,
  ChevronRight,
  History,
  RotateCcw,
  Truck,
  Check,
} from "lucide-react";
import { CATEGORY_NAMES, ARCH_CATEGORIES } from "./PrescriptionForm.jsx";
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
  fetchChargedLineItems,
  fetchLoginEvents,
  fetchLabRoster,
  fetchCommissionRates,
  saveCommissionRates,
  fetchPayments,
  fetchExpenses,
  repriceUnbilledCases,
  updateCase,
  inviteLabMember,
  setMemberStatus,
  deleteInviteRows,
  addMemberRole,
  removeMemberRole,
  removeLabMember,
  logActivity,
  logDisplayName,
  fetchLoginEventsSince,
  logExportRows,
  fetchRoundCosts,
  upsertRoundCost,
  ROUND_KIND_LABELS,
  ROUND_FAULTS,
  ROUND_FAULT_LABELS,
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
const caseUnitsByCategory = (c) => {
  const out = {};
  const rest = c.prescription?.restorations;
  if (rest?.length) {
    for (const r of rest) out[r.category] = (out[r.category] ?? 0) + (r.teeth?.length || 1);
  } else if (c.prescription?.category) {
    out[c.prescription.category] = c.prescription?.teeth?.length || 1;
  }
  return out;
};

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
  const lines = ["category,code,price,per_tooth_fee,price_both_arches"];
  for (const it of schedule.items) {
    lines.push([csvEscape(it.category), csvEscape(it.code), it.basePrice, it.perToothFee ?? "", it.priceBothArches ?? ""].join(","));
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
    const [category, code, price, fee, both] = splitCsvLine(line);
    if (!category || category.toLowerCase() === "category") continue; // header
    const basePrice = Number.parseFloat(price);
    if (!Number.isFinite(basePrice) || basePrice < 0) continue;
    // Optional 4th/5th columns (Phases 44/45): denture per-tooth fee and the
    // both-arches price. Absent/blank in older files -> null, which keeps/
    // clears nothing on import below.
    const feeNum = Number.parseFloat(fee);
    const perToothFee = Number.isFinite(feeNum) && feeNum >= 0 ? feeNum : null;
    const bothNum = Number.parseFloat(both);
    const priceBothArches = Number.isFinite(bothNum) && bothNum >= 0 ? bothNum : null;
    rows.push({ category, code: code ?? "", basePrice, perToothFee, priceBothArches });
  }
  return rows;
}

/* ---------------- editable item row (uncontrolled; keyed by saved value) ---------------- */

// Only the denture is priced base + per-tooth (user decision 2026-08-21);
// splints and everything else stay flat.
const PER_TOOTH_CATEGORY = "Removable denture";

// Small numeric field for ItemRow: commits on blur, blank commits `clear`
// (when allowed), invalid input reverts to the saved value.
function PriceCell({ value, placeholder, title, busy, allowBlank = false, onCommit, wide = false }) {
  return (
    <input
      type="number"
      min="0"
      step="any"
      inputMode="decimal"
      defaultValue={value ?? ""}
      placeholder={placeholder}
      disabled={busy}
      title={title}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        if (raw === "") {
          if (allowBlank) onCommit("");
          else e.target.value = value ?? "";
          return;
        }
        const v = Number.parseFloat(raw);
        if (!Number.isFinite(v) || v < 0) {
          e.target.value = value ?? ""; // revert bad input
          return;
        }
        onCommit(v);
      }}
      className={`${wide ? "w-24" : "w-20"} rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-right text-sm outline-none transition focus:border-blue-400 focus:bg-white`}
    />
  );
}

function ItemRow({ item, busy, onSave, onDelete }) {
  // `code` survives in the row object and CSV round-trip even though the
  // column was removed from the UI (2026-08-17, user request) — commit()
  // passes it through untouched so imports/legacy data are never wiped.
  const commit = (patch) => {
    const next = {
      code: item.code,
      basePrice: item.basePrice,
      perToothFee: item.perToothFee,
      priceBothArches: item.priceBothArches,
      ...patch,
    };
    if (
      next.code === item.code &&
      next.basePrice === item.basePrice &&
      next.perToothFee === item.perToothFee &&
      next.priceBothArches === item.priceBothArches
    )
      return;
    onSave(item.id, next);
  };
  const perTooth = item.category === PER_TOOTH_CATEGORY;
  const archPriced = ARCH_CATEGORIES.includes(item.category);
  const hint = perTooth
    ? "single-arch base + both-arches base · + fee × each marked tooth (blanks = flat)"
    : archPriced
      ? "price for a single arch + price for both arches (leave 'both' empty to charge one price)"
      : null;
  return (
    <tr className="border-t border-slate-100">
      <td className="min-w-0 px-3 py-2 text-sm text-slate-700">
        {item.category}
        {hint && <span className="mt-0.5 block text-[10px] leading-tight text-slate-400">{hint}</span>}
      </td>
      <td className="px-2 py-1.5">
        <span className="flex flex-wrap items-center justify-end gap-1">
          <PriceCell
            value={item.basePrice}
            title={archPriced ? "Single-arch price" : undefined}
            busy={busy}
            wide
            onCommit={(v) => commit({ basePrice: v })}
          />
          {archPriced && (
            <>
              <span className="text-[10px] text-slate-400">both</span>
              <PriceCell
                value={item.priceBothArches}
                placeholder="both"
                title="Price when the appliance is for both arches (empty = same as single)"
                busy={busy}
                allowBlank
                onCommit={(v) => commit({ priceBothArches: v })}
              />
            </>
          )}
          {perTooth && (
            <>
              <span className="text-xs text-slate-400">+</span>
              <PriceCell
                value={item.perToothFee}
                placeholder="/tooth"
                title="Fee added for each marked tooth"
                busy={busy}
                allowBlank
                onCommit={(v) => commit({ perToothFee: v })}
              />
            </>
          )}
        </span>
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

function ScheduleCard({ schedule, busy, onMutate, onMakeDefault, onDelete, onReprice }) {
  // "Update case prices" feedback — count of unbilled cases recomputed.
  const [repriceMsg, setRepriceMsg] = useState("");
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
        // Legacy files lack the fee/both columns (null): leave any existing
        // values untouched rather than wiping them.
        const extras = {
          ...(row.perToothFee == null ? {} : { perToothFee: row.perToothFee }),
          ...(row.priceBothArches == null ? {} : { priceBothArches: row.priceBothArches }),
        };
        if (existing) {
          const feeChanged = row.perToothFee != null && existing.perToothFee !== row.perToothFee;
          const bothChanged = row.priceBothArches != null && existing.priceBothArches !== row.priceBothArches;
          if (existing.basePrice !== row.basePrice || existing.code !== row.code || feeChanged || bothChanged) {
            await updatePriceItem(existing.id, { code: row.code, basePrice: row.basePrice, ...extras });
          }
        } else {
          await addPriceItem(schedule.id, { category: row.category, code: row.code, basePrice: row.basePrice, ...extras });
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
          {repriceMsg && <span className="mr-1 text-xs font-semibold text-emerald-600">{repriceMsg}</span>}
          {onReprice && (
            <button
              onClick={async () => {
                setRepriceMsg("");
                const n = await onReprice();
                if (n != null) setRepriceMsg(`${n} case${n === 1 ? "" : "s"} updated.`);
              }}
              disabled={busy}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              title="Re-apply the current price lists to every unbilled case (manually set prices are never touched)"
            >
              <RefreshCcw size={13} /> Update case prices
            </button>
          )}
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
                <td colSpan={3} className="px-3 py-6 text-center text-sm text-slate-400">
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

// Charged history window for the generated clinic price lists.
const CHARGED_SINCE = "2026-01-01";

// Maps a lab's historical procedure names ("Zircon Crown", "PFM Bridge")
// onto the Rx form's category names so a clinic price list built from
// history can auto-price future platform cases. Deliberately conservative:
// temporaries, repairs, trays, retainers, night guards and other
// one-off/auxiliary work stay unmapped (reference rows) — mapping a 3 OMR
// temporary crown onto "Crown - tooth" would misprice every real crown.
function mapToRxCategory(name) {
  const s = String(name).toLowerCase();
  if (/repair|temp\b|temporary|provisional|wax|tray|study|model|post|core|\bbar\b|guard|retainer|bleach/.test(s)) return null;
  if (/implant/.test(s) && /bridge|fpd/.test(s)) return "Bridge - implant";
  if (/implant/.test(s)) return "Crown - implant";
  if (/maryland|resin\s*bond/.test(s)) return "Bridge - tooth (Resin Bonded)";
  if (/bridge|fpd/.test(s)) return "Bridge - tooth (conventional)";
  if (/veneer|laminate/.test(s)) return "Veneer";
  if (/crown/.test(s)) return "Crown - tooth";
  if (/michigan/.test(s)) return "Michigan splint";
  if (/denture|rpd|\bpartial\b|flexible/.test(s)) return "Removable denture";
  return null;
}

// One schedule item per mapped Rx category — the clinic's DOMINANT variant
// (most billed, tie -> most recent) sets the price; its origin is kept in
// the item's code (visible in CSV export). Rx categories the clinic's
// history never covered are filled from the lab's master list (falling
// back to the platform's standard estimates), so EVERY new case from this
// clinic auto-prices instead of silently staying blank. Unmapped items
// ride along under their historical names as reference rows the pricing
// trigger ignores.
function buildScheduleItemsFromHistory(items, masterItems = []) {
  const byCat = new Map();
  const reference = [];
  for (const it of items) {
    const rx = mapToRxCategory(it.name);
    if (!rx) {
      reference.push(it);
      continue;
    }
    const cur = byCat.get(rx);
    if (!cur || it.count > cur.count || (it.count === cur.count && it.lastDate > cur.lastDate)) byCat.set(rx, it);
  }
  // Fill gaps ONLY from the lab's own master list — never from the
  // platform's generic estimates, which are nowhere near a real lab's
  // rates and produced absurd auto-prices in production. A category
  // missing from both history and master simply doesn't auto-price.
  const fills = [];
  for (const category of CATEGORY_NAMES) {
    if (byCat.has(category)) continue;
    const master = masterItems.find((m) => m.category === category);
    if (master?.basePrice != null) fills.push({ category, code: "master list rate", basePrice: master.basePrice });
  }
  return [
    ...[...byCat.entries()].map(([category, src]) => ({ category, code: `from ${src.name}`, basePrice: src.lastPrice })),
    ...fills,
    ...reference.map((it) => ({ category: it.name, code: "history reference", basePrice: it.lastPrice })),
  ];
}

export function PriceListsManager({ lab, clinicsById, cases = [] }) {
  const [schedules, setSchedules] = useState(null); // null = loading
  const [rules, setRules] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addingList, setAddingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [repriceState, setRepriceState] = useState({ confirming: false, message: "" });
  // Clinic-specific price lists generated from charged history.
  const [chargedRows, setChargedRows] = useState(null); // null = loading
  const [chargedError, setChargedError] = useState("");
  const [clinicQuery, setClinicQuery] = useState("");
  const [openClinicKey, setOpenClinicKey] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchChargedLineItems(lab.id, CHARGED_SINCE)
      .then((rows) => !cancelled && setChargedRows(rows))
      .catch((err) => {
        if (!cancelled) {
          setChargedRows([]);
          setChargedError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [lab.id]);

  // One pass over charged history (+ billed platform cases) → per clinic, a
  // de-duplicated item list with the price that clinic actually paid.
  // "Last charged" wins when a price changed over time; a range is kept so
  // the UI can flag items whose price varied inside the window.
  const clinicPriceLists = useMemo(() => {
    const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
    const clinics = new Map(); // lowercase clinic name -> clinic entry
    const add = (clinicName, itemName, units, unitPrice, amount, dateIso) => {
      const cName = norm(clinicName);
      const iName = norm(itemName);
      if (!cName || !iName || !(unitPrice > 0)) return;
      const cKey = cName.toLowerCase();
      let c = clinics.get(cKey);
      if (!c) {
        c = { key: cKey, name: cName, items: new Map(), total: 0, lastDate: "" };
        clinics.set(cKey, c);
      }
      c.total += amount;
      if (dateIso > c.lastDate) c.lastDate = dateIso;
      const iKey = iName.toLowerCase();
      let it = c.items.get(iKey);
      if (!it) {
        it = { name: iName, count: 0, units: 0, lastPrice: unitPrice, lastDate: "", min: unitPrice, max: unitPrice };
        c.items.set(iKey, it);
      }
      it.count += 1;
      it.units += units;
      it.min = Math.min(it.min, unitPrice);
      it.max = Math.max(it.max, unitPrice);
      if (dateIso >= it.lastDate) {
        it.lastDate = dateIso;
        it.lastPrice = unitPrice;
      }
    };

    for (const st of chargedRows ?? []) {
      const clinicName = clinicsById[st.clinicId]?.name ?? st.clinicName;
      for (const li of st.lineItems ?? []) {
        const amount = Number(li.amount);
        if (!li.procedure || !(amount > 0)) continue;
        const units = Number(li.units) > 0 ? Number(li.units) : 1;
        const unitPrice = Number(li.price) > 0 ? Number(li.price) : amount / units;
        add(clinicName, li.procedure, units, unitPrice, amount, li.date || st.month);
      }
    }
    // Billed platform cases in the window (single-category ones — a unit
    // price is only meaningful when the whole fee belongs to one item).
    for (const c of cases) {
      if (!(c.totalPrice > 0)) continue;
      if (!c.statementId && c.invoiceStatus === "draft") continue; // not charged yet
      const day = (c.createdAt ?? c.createdDate ?? "").slice(0, 10);
      if (!day || day < CHARGED_SINCE) continue;
      const clinicName = clinicsById[c.clinicId]?.name;
      if (!clinicName) continue;
      const rest = c.prescription?.restorations;
      const cats = rest?.length
        ? [...new Set(rest.map((r) => r.category).filter(Boolean))]
        : [c.prescription?.category].filter(Boolean);
      if (cats.length !== 1) continue;
      const units = rest?.length
        ? rest.reduce((n, r) => n + (r.teeth?.length || 1), 0)
        : c.prescription?.teeth?.length || 1;
      add(clinicName, cats[0], units, c.totalPrice / units, c.totalPrice, day);
    }

    return [...clinics.values()]
      .map((c) => ({
        ...c,
        items: [...c.items.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => b.total - a.total);
  }, [chargedRows, cases, clinicsById]);

  const visibleClinicLists = useMemo(() => {
    const q = clinicQuery.trim().toLowerCase();
    if (!q) return clinicPriceLists;
    return clinicPriceLists.filter((c) => c.name.toLowerCase().includes(q));
  }, [clinicPriceLists, clinicQuery]);

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
          {/* How the wiring works — one strip that explains the whole tab. */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs leading-relaxed text-slate-600">
            <p className="font-bold text-slate-800">How clinic pricing is wired</p>
            <p className="mt-0.5">
              <b>①</b> The <b>master list</b> prices every clinic that has nothing special set up.{" "}
              <b>②</b> Create a <b>clinic-specific list</b> only when a clinic gets different rates.{" "}
              <b>③</b> The <b>assignment table</b> below is where you connect each clinic to its list
              (and an optional % discount). A clinic with no assignment simply uses the master list —
              most clinics need nothing at all.
            </p>
          </div>

          {(() => {
            const onReprice = async () => {
              let count = null;
              await mutate(async () => {
                count = await repriceUnbilledCases();
              });
              logActivity("re-priced unbilled cases", `${count ?? 0} cases`);
              return count;
            };
            const card = (s) => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                busy={busy}
                onMutate={mutate}
                onMakeDefault={(id) => mutate(() => setDefaultSchedule(lab.id, id))}
                onDelete={(id) => mutate(() => deletePriceSchedule(id))}
                onReprice={onReprice}
              />
            );
            const master = schedules.filter((s) => s.isDefault);
            const others = schedules.filter((s) => !s.isDefault);
            return (
              <>
                <h3 className="pt-1 text-xs font-bold uppercase tracking-wide text-slate-400">
                  ① Master price list — the default for every clinic
                </h3>
                {master.map(card)}
                <h3 className="pt-1 text-xs font-bold uppercase tracking-wide text-slate-400">
                  ② Clinic-specific price lists {others.length === 0 ? "— none yet (that's fine)" : ""}
                </h3>
                {others.map(card)}
              </>
            );
          })()}

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
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
              <Building2 size={15} className="text-blue-600" />
              <h3 className="text-sm font-bold text-slate-800">③ Which price list applies to each clinic</h3>
              <p className="ml-auto text-xs text-slate-400">No selection = master list · positive % = discount</p>
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

          {/* ---- Historical rates, generated from charged history. Collapsed
                  by default: it's a REFERENCE for setting your real lists, not
                  part of the pricing wiring — mixing it in with the editable
                  lists was the main source of confusion on this tab. ---- */}
          <details className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
              <History size={15} className="text-slate-400" />
              <h3 className="text-sm font-bold text-slate-800">Historical billed rates</h3>
              <p className="ml-auto text-xs text-slate-400">
                Reference only — what each clinic actually paid per item · tap to open
              </p>
            </summary>
            {chargedError && (
              <p className="border-b border-slate-100 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">
                Couldn't load charged history — {chargedError}
              </p>
            )}
            {chargedRows === null ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">Loading charged history…</p>
            ) : clinicPriceLists.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                No charged work since 1 January 2026 yet — these lists build themselves from statements
                and billed cases.
              </p>
            ) : (
              <div className="space-y-3 p-4">
                <label className="relative block max-w-sm">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={clinicQuery}
                    onChange={(e) => setClinicQuery(e.target.value)}
                    placeholder={`Search ${clinicPriceLists.length} clinics…`}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-sm outline-none transition focus:border-blue-400 focus:bg-white"
                  />
                </label>
                {visibleClinicLists.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">No clinic matches that search.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {visibleClinicLists.map((c) => {
                      const active = openClinicKey === c.key;
                      return (
                        <React.Fragment key={c.key}>
                          <button
                            onClick={() => setOpenClinicKey(active ? null : c.key)}
                            aria-pressed={active}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                              active ? "border-blue-400 bg-blue-50/60 ring-2 ring-blue-200" : "border-slate-200 hover:border-blue-300"
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-slate-800">{c.name}</span>
                              <span className="block text-[11px] text-slate-400">
                                {c.items.length} item{c.items.length === 1 ? "" : "s"} · {fmtOMR(c.total)} billed
                              </span>
                            </span>
                            <ChevronRight
                              size={14}
                              className={`shrink-0 text-slate-400 transition-transform ${active ? "rotate-90" : ""}`}
                            />
                          </button>
                          {/* The detail expands right under the clicked card's
                              row — col-span-full breaks it onto its own grid
                              row, so it's never below a 100-card grid. */}
                          {active && (() => {
                            const nameKey = c.name.trim().toLowerCase();
                            const editableCopy = (schedules ?? []).find(
                              (s) => (s.name ?? "").trim().toLowerCase() === nameKey
                            );
                            const registered = clinics.find(
                              (rc) => (rc.name ?? "").trim().toLowerCase() === nameKey
                            );
                            return (
                            <div className="col-span-full overflow-hidden rounded-xl border border-blue-200">
                              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-blue-50/50 px-3 py-2.5">
                                <h4 className="text-sm font-bold text-slate-800">{c.name}</h4>
                                <p className="mr-auto text-[11px] text-slate-500">
                                  {c.items.length} distinct items · generated from charged history
                                </p>
                                {editableCopy ? (
                                  <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                                    <CheckCheck size={12} /> Editable — see the “{editableCopy.name}” price-list card above
                                  </span>
                                ) : (
                                  <button
                                    onClick={() =>
                                      mutate(async () => {
                                        const schedId = await createPriceSchedule(lab.id, c.name, {
                                          items: buildScheduleItemsFromHistory(
                                            c.items,
                                            (schedules ?? []).find((s) => s.isDefault)?.items ?? []
                                          ),
                                        });
                                        logActivity("created clinic price list", c.name);
                                        if (registered) {
                                          await upsertClinicPriceRule(lab.id, registered.id, { priceScheduleId: schedId });
                                          // Existing unbilled cases from this clinic pick the new
                                          // list up immediately (manual prices stay untouched).
                                          const n = await repriceUnbilledCases();
                                          setRepriceState({
                                            confirming: false,
                                            message: `"${c.name}" list created and linked — ${n} unbilled case${n === 1 ? "" : "s"} repriced.`,
                                          });
                                        }
                                      })
                                    }
                                    disabled={busy}
                                    className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                                    title="Copies these items and prices into a price list you can edit item by item"
                                  >
                                    <Plus size={12} /> Make editable price list
                                  </button>
                                )}
                              </div>
                              {!editableCopy && (
                                <p className="border-b border-slate-100 bg-white px-3 py-2 text-[11px] text-slate-400">
                                  This view is read-only history. “Make editable price list” copies it into a price-list
                                  card above where every item and price can be changed, added, or removed. Items marked
                                  with an arrow map automatically onto the Rx form's categories (the most-billed variant
                                  sets the price)
                                  {registered
                                    ? " and will price this clinic's future cases; the rest ride along as reference rows."
                                    : "; this clinic isn't registered on Dr-Crown yet, so the list is a rate reference until they join."}
                                </p>
                              )}
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[420px]">
                                  <thead>
                                    <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                      <th className="px-3 py-2">Restoration</th>
                                      <th className="px-2 py-2 text-right">Price (OMR)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {c.items.map((it) => (
                                      <tr key={it.name} className="border-t border-slate-100">
                                        <td className="px-3 py-2">
                                          <p className="text-sm font-medium text-slate-700">{it.name}</p>
                                          <p className="text-[11px] text-slate-400">
                                            billed ×{it.count} ({it.units} unit{it.units === 1 ? "" : "s"})
                                            {mapToRxCategory(it.name) && (
                                              <span className="ml-1.5 text-blue-500">→ {mapToRxCategory(it.name)}</span>
                                            )}
                                          </p>
                                        </td>
                                        <td className="px-2 py-2 text-right align-top">
                                          <p className="text-sm font-semibold tabular-nums text-slate-800">{fmtOMR(it.lastPrice)}</p>
                                          {it.min !== it.max && (
                                            <p
                                              className="text-[11px] tabular-nums text-amber-600"
                                              title="This clinic paid different prices for this item inside the window — the main figure is the most recently charged one."
                                            >
                                              varied {fmtOMR(it.min)}–{fmtOMR(it.max)}
                                            </p>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                            );
                          })()}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </details>

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
      <div className="min-w-[13rem] flex-1 space-y-1">
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

/* ================================================================== */
/*  Top performers — top 10 clinics and dentists by billed value.       */
/*  Two revenue sources, merged (they never overlap):                   */
/*    1. imported statement line_items (each row carries its own date,  */
/*       dentist name and amount — this is what makes 6mo/1y/2y        */
/*       rankings possible over the pre-platform history), and          */
/*    2. platform cases completed in the window (caseFee), attributed   */
/*       to the clinic and its ordering dentist. Platform-generated     */
/*       statements link cases instead of carrying line_items, so a     */
/*       case is never counted twice.                                   */
/*  Cancelled cases are excluded (net revenue). The widest window (2y)  */
/*  is fetched ONCE; the dropdown filters client-side, so switching     */
/*  periods is instant with zero extra queries. No new indexes needed:  */
/*  the statements unique index (lab_id, clinic_id, month) already      */
/*  serves the eq(lab_id)+gte(month) fetch, and cases_lab_id_idx        */
/*  covers the cases the dashboard already loads.                       */
/* ================================================================== */

const TOP_PERIODS = [
  { id: "1m", label: "1 Month", days: 30 },
  { id: "6m", label: "6 Months", days: 180 },
  { id: "7m", label: "7 Months", days: 210 },
  { id: "1y", label: "1 Year", days: 365 },
  { id: "2y", label: "2 Years", days: 730 },
];

// A line item's own date beats its statement's month (month is the billing
// cycle; the work date is what a 30-day window should judge). Local-noon
// parsing sidesteps the UTC+4 off-by-one-day trap documented in the import.
function lineItemDate(li, month) {
  const raw = (li?.date || "").trim();
  if (raw) {
    const d = raw.includes("T") ? new Date(raw) : new Date(raw + "T12:00:00");
    if (!Number.isNaN(d.getTime())) return d;
  }
  const m = month ? new Date(String(month).slice(0, 10) + "T12:00:00") : null;
  return m && !Number.isNaN(m.getTime()) ? m : null;
}

function TopTable({ title, icon: Icon, rows, unitLabel }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-3">
        <Icon size={15} className="text-blue-500" />
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-slate-400">No data available for this period.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="w-10 px-3 py-2 text-center">#</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2 text-right">{unitLabel}</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td className="px-3 py-2 text-center">
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                    i === 0 ? "bg-amber-100 text-amber-700" : i < 3 ? "bg-slate-200 text-slate-600" : "text-slate-400"
                  }`}>
                    {i + 1}
                  </span>
                </td>
                <td className="max-w-0 truncate px-2 py-2 font-semibold text-slate-700" title={r.name}>{r.name}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-500">{r.count}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums text-slate-800">{fmtOMR(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function TopPerformers({ lab, cases, clinicsById = {} }) {
  const [period, setPeriod] = useState("1m");
  const [stmtRows, setStmtRows] = useState(null); // null = loading
  const [error, setError] = useState("");

  // One fetch for the WIDEST window; the dropdown never refetches. The since
  // month is built from local date parts (never toISOString — the UTC+4
  // month-rollback trap) and padded one month so a mid-month cutoff can't
  // clip a statement whose line items straddle it.
  const load = () => {
    if (!lab?.id) return;
    setError("");
    const d = new Date(Date.now() - 730 * 86_400_000);
    const since = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    fetchChargedLineItems(lab.id, since)
      .then(setStmtRows)
      .catch((e) => {
        setStmtRows([]);
        setError(e.message);
      });
  };
  useEffect(load, [lab?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clinics the owner has picked to add up (key + name persist across period
  // switches; totals re-resolve against the current period each render).
  const [picked, setPicked] = useState([]);
  const { clinics, dentists, allClinics } = useMemo(() => {
    const days = TOP_PERIODS.find((p) => p.id === period)?.days ?? 30;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const now = new Date();
    const clinicMap = new Map();
    const dentistMap = new Map();
    const bump = (map, key, name, amount) => {
      if (!key) return;
      const g = map.get(key) ?? { key, name, total: 0, count: 0 };
      g.total += amount;
      g.count += 1;
      if (name && (!g.name || g.name === "Unknown")) g.name = name;
      map.set(g.key, g);
    };

    // 1. historical / imported billing, one line item at a time
    for (const st of stmtRows ?? []) {
      const clinicKey = st.clinicId ?? `n:${st.clinicName.trim().toLowerCase()}`;
      const clinicName = clinicsById[st.clinicId]?.name ?? st.clinicName ?? "Unknown";
      for (const li of st.lineItems) {
        const d = lineItemDate(li, st.month);
        if (!d || d < cutoff || d > now) continue;
        const amount = Number(li.amount) || (Number(li.price) || 0) * (Number(li.units) || 1);
        bump(clinicMap, clinicKey, clinicName, amount);
        const dentist = String(li.dentist ?? "").trim();
        if (dentist && dentist !== "-") bump(dentistMap, dentist.toLowerCase(), dentist, amount);
      }
    }

    // 2. platform cases completed in the window (cancelled excluded = net)
    for (const c of cases) {
      if (c.cancelStatus === "cancelled") continue;
      const fin = completedAt(c);
      if (!fin || fin < cutoff || fin > now) continue;
      const fee = caseFee(c).total;
      const clinic = clinicsById[c.clinicId];
      bump(clinicMap, c.clinicId ?? "unknown", clinic?.name ?? "Unknown clinic", fee);
      const dentist = String(clinic?.dentist ?? "").trim();
      if (dentist) bump(dentistMap, dentist.toLowerCase(), dentist, fee);
    }

    const ranked = (map) => [...map.values()].sort((a, b) => b.total - a.total || b.count - a.count);
    const allClinics = ranked(clinicMap);
    return { clinics: allClinics.slice(0, 10), dentists: ranked(dentistMap).slice(0, 10), allClinics };
  }, [stmtRows, cases, clinicsById, period]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-800">Top performers</h3>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          Period
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700"
          >
            {TOP_PERIODS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="mb-2 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          Historical billing couldn't load ({error}) — showing platform cases only.
          <button onClick={load} className="rounded bg-white px-2 py-0.5 ring-1 ring-amber-200 hover:bg-amber-100">Retry</button>
        </p>
      )}
      {stmtRows === null ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">Loading top performers…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <TopTable title="Top 10 Clinics" icon={Building2} rows={clinics} unitLabel="Cases" />
            <TopTable title="Top 10 Dentists" icon={UserCheck} rows={dentists} unitLabel="Cases" />
          </div>

          {/* Add up any set of clinics — e.g. all the clinics one dentist
              works at. Every clinic in the data is pickable, not just the
              top 10; totals follow the Period dropdown above. */}
          <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-slate-800">Add up clinics</h4>
              {picked.length > 0 && (
                <p className="text-right">
                  <span className="text-lg font-black tabular-nums text-blue-700">
                    {fmtOMR(picked.reduce((s, p) => s + (allClinics.find((c) => c.key === p.key)?.total ?? 0), 0))}
                  </span>
                  <span className="ml-2 text-xs font-semibold text-slate-500">
                    {picked.reduce((s, p) => s + (allClinics.find((c) => c.key === p.key)?.count ?? 0), 0)} cases ·{" "}
                    {TOP_PERIODS.find((p) => p.id === period)?.label}
                  </span>
                </p>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <select
                value=""
                onChange={(e) => {
                  const c = allClinics.find((x) => x.key === e.target.value);
                  if (c && !picked.some((p) => p.key === c.key)) setPicked((prev) => [...prev, { key: c.key, name: c.name }]);
                }}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700"
              >
                <option value="">+ Add a clinic…</option>
                {allClinics
                  .filter((c) => !picked.some((p) => p.key === c.key))
                  .map((c) => (
                    <option key={c.key} value={c.key}>{c.name} — {fmtOMR(c.total)}</option>
                  ))}
              </select>
              {picked.map((p) => {
                const cur = allClinics.find((c) => c.key === p.key);
                return (
                  <span key={p.key} className="flex items-center gap-1 rounded-full bg-blue-50 py-1 pl-2.5 pr-1 text-xs font-semibold text-blue-800 ring-1 ring-blue-200">
                    {p.name}
                    <span className="tabular-nums text-blue-500">{fmtOMR(cur?.total ?? 0)}</span>
                    <button
                      type="button"
                      onClick={() => setPicked((prev) => prev.filter((x) => x.key !== p.key))}
                      className="rounded-full p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-700"
                      title={`Remove ${p.name}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
              {picked.length > 1 && (
                <button
                  type="button"
                  onClick={() => setPicked([])}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                >
                  Clear all
                </button>
              )}
            </div>
            {picked.length === 0 && (
              <p className="mt-1.5 text-[11px] text-slate-400">
                Pick clinics from the dropdown to see their combined billed value for the selected period —
                e.g. every clinic one doctor works at.
              </p>
            )}
          </div>
        </>
      )}
      <p className="mt-1.5 text-[11px] text-slate-400">
        Billed value per clinic/dentist in the period — imported billing history plus completed platform cases;
        cancelled cases excluded.
      </p>
    </div>
  );
}

export function OverviewDashboard({ cases, clinicsById = {}, lab }) {
  const [preset, setPreset] = useState("month");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const { from, to } = rangeBounds(preset, custom);

  // Money in / money out for the KPI cards. Fail-soft: before the Phase 26
  // SQL exists (or for non-admin fetch errors) the two cards just hide.
  const [money, setMoney] = useState(null);
  useEffect(() => {
    if (!lab?.id) return;
    let cancelled = false;
    Promise.all([fetchPayments(lab.id), fetchExpenses(lab.id)])
      .then(([payments, expenses]) => !cancelled && setMoney({ payments, expenses }))
      .catch(() => !cancelled && setMoney(null));
    return () => {
      cancelled = true;
    };
  }, [lab?.id]);
  const cashflow = useMemo(() => {
    if (!money) return null;
    const inRange = (iso) => {
      const d = iso ? new Date(iso + "T12:00:00") : null;
      return d && d >= from && d <= to;
    };
    const collected = money.payments.filter((p) => inRange(p.receivedDate)).reduce((s, p) => s + p.amount, 0);
    const spent = money.expenses.filter((e) => inRange(e.expenseDate)).reduce((s, e) => s + e.amount, 0);
    return { collected, net: collected - spent };
  }, [money, from.getTime(), to.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const inRange = (d) => d && d >= from && d <= to;
    const completed = cases.filter((c) => inRange(completedAt(c)));
    const revenue = completed.reduce((s, c) => s + caseFee(c).total, 0);
    const owed = (c) =>
      c.cancelStatus === "cancelled" ? (c.cancellationFee ?? 0) > 0 : !!completedAt(c);
    const outstanding = cases
      .filter((c) => owed(c) && c.invoiceStatus !== "paid")
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

  // Uncollected money grouped by owing clinic — same all-time definition as
  // the Uncollected card (completed but not marked paid), split into
  // "invoiced" (issued, covered by the monthly reminder email) vs cases the
  // lab hasn't issued an invoice for yet (reminders never mention those).
  const unpaidByClinic = useMemo(() => {
    const groups = new Map();
    for (const c of cases) {
      const owed = c.cancelStatus === "cancelled" ? (c.cancellationFee ?? 0) > 0 : !!completedAt(c);
      if (!owed || c.invoiceStatus === "paid") continue;
      const g = groups.get(c.clinicId) ?? { clinicId: c.clinicId, total: 0, issued: 0, notInvoiced: 0 };
      g.total += caseFee(c).total;
      if (c.invoiceStatus === "issued") g.issued += 1;
      else g.notInvoiced += 1;
      groups.set(c.clinicId, g);
    }
    return [...groups.values()]
      .map((g) => ({ ...g, clinic: clinicsById[g.clinicId] }))
      .sort((a, b) => b.total - a.total);
  }, [cases, clinicsById]);
  const unpaidMax = unpaidByClinic[0]?.total || 1;

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard icon={Banknote} label="Gross revenue" value={fmtOMR(stats.revenue)} sub="completed in period" />
        <StatCard icon={Wallet} label="Uncollected" value={fmtOMR(stats.outstanding)} sub="all time, not yet paid" />
        <StatCard icon={TrendingUp} label="Avg order value" value={fmtOMR(aov)} />
        <StatCard icon={CheckCheck} label="Cases completed" value={stats.completed.length} />
        <StatCard icon={RefreshCcw} label="Remake rate" value={`${remakeRate.toFixed(1)}%`} />
        {cashflow && <StatCard icon={Banknote} label="Collections" value={fmtOMR(cashflow.collected)} sub="payments received in period" />}
        {cashflow && (
          <StatCard
            icon={TrendingUp}
            label="Net cash flow"
            value={`${cashflow.net < 0 ? "−" : ""}${fmtOMR(Math.abs(cashflow.net))}`}
            sub="collections − expenses"
          />
        )}
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

      {unpaidByClinic.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-800">Unpaid work by clinic</h3>
            <span className="text-xs font-semibold text-slate-500">{fmtOMR(stats.outstanding)} outstanding</span>
          </div>
          {lab?.paymentRemindersEnabled === false ? (
            <p className="mb-3 text-[11px] font-semibold text-amber-600">
              Automatic monthly reminders are turned off — clinics are not being emailed. Turn them back on
              in Lab Settings.
            </p>
          ) : (
            <p className="mb-3 text-[11px] text-slate-400">
              Completed cases not yet marked paid. Clinics with <b>issued</b> invoices get an automatic email
              reminder on the 25th of each month — cases you haven't invoiced are never emailed.
            </p>
          )}
          <div className="space-y-3">
            {unpaidByClinic.map((g) => (
              <div key={g.clinicId ?? "unknown"}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-slate-700">
                    {g.clinic?.name ?? "Unknown clinic"}
                    {g.clinic && !g.clinic.email && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                        no email — can't be reminded
                      </span>
                    )}
                  </p>
                  <p className="text-sm font-bold text-slate-800">{fmtOMR(g.total)}</p>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.max(3, (g.total / unpaidMax) * 100)}%` }} />
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {g.issued > 0 && `${g.issued} invoiced unpaid`}
                  {g.issued > 0 && g.notInvoiced > 0 && " · "}
                  {g.notInvoiced > 0 && `${g.notInvoiced} not yet invoiced`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <TopPerformers lab={lab} cases={cases} clinicsById={clinicsById} />

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
  const [rates, setRates] = useState({}); // userId -> { category: OMR/unit }
  const [ratesFor, setRatesFor] = useState(null); // tech row or null

  useEffect(() => {
    let cancelled = false;
    fetchLabRoster(lab.id)
      .then((r) => !cancelled && setRoster(r))
      .catch((err) => !cancelled && setError(err.message));
    // Fail-soft: pre-Phase-26 databases just show — for commissions.
    fetchCommissionRates(lab.id)
      .then((r) => !cancelled && setRates(r))
      .catch(() => {});
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
    // Flat OMR-per-unit commission: this month's completed units per
    // category x the tech's configured rate for that category.
    const myRates = rates[t.userId] ?? {};
    const commissionMonth = finished
      .filter((x) => x.at >= monthStart)
      .reduce((sum, x) => {
        const byCat = caseUnitsByCategory(x.c);
        return sum + Object.entries(byCat).reduce((s, [cat, units]) => s + units * (Number(myRates[cat]) || 0), 0);
      }, 0);
    return {
      commissionMonth,
      hasRates: Object.values(myRates).some((v) => Number(v) > 0),
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
                <th className="px-2 py-2.5 text-right">Commission (OMR/mo)</th>
                <th className="px-2 py-2.5 text-right">Remake %</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {roster === null && !error && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-400">
                    Loading roster…
                  </td>
                </tr>
              )}
              {roster !== null && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-400">
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
                  <td className="px-2 py-2.5 text-right text-sm font-semibold text-emerald-700">
                    {t.hasRates ? fmtMoney(t.commissionMonth) : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-right text-sm text-slate-600">
                    {t.remakeRate == null ? "—" : `${t.remakeRate.toFixed(1)}%`}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <button
                      onClick={() => setRatesFor(t)}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-500 hover:border-blue-300 hover:text-blue-700"
                    >
                      Rates
                    </button>
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

      <CommissionRatesModal
        open={!!ratesFor}
        tech={ratesFor}
        labId={lab.id}
        initial={ratesFor ? rates[ratesFor.userId] ?? {} : {}}
        onClose={() => setRatesFor(null)}
        onSaved={(userId, next) => setRates((r) => ({ ...r, [userId]: next }))}
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
  const [inviteRoles, setInviteRoles] = useState({ lab_admin: false, lab_tech: true, accountant: false });
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
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              checked={inviteRoles.accountant}
              onChange={(e) => setInviteRoles((r) => ({ ...r, accountant: e.target.checked }))}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            Accountant
          </label>
          <button
            onClick={invite}
            disabled={busy || !EMAIL_RE.test(inviteEmail.trim()) || (!inviteRoles.lab_admin && !inviteRoles.lab_tech && !inviteRoles.accountant)}
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
                          {p.roles.includes("accountant") && (
                            <span className="flex items-center gap-0.5 rounded bg-emerald-100 px-1 py-px text-[9px] font-bold uppercase text-emerald-600">
                              <Wallet size={9} /> Accountant
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
                          <button
                            onClick={() => toggleRole(p, "accountant")}
                            disabled={busy}
                            title={p.roles.includes("accountant") ? "Revoke Accountant" : "Grant Accountant (billing, expenses, price lists + case queue; no admin panels)"}
                            className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase transition ${
                              p.roles.includes("accountant")
                                ? "bg-emerald-100 text-emerald-600 hover:bg-emerald-200"
                                : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-500"
                            }`}
                          >
                            <Wallet size={9} /> Accountant
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

/* ================================================================== */
/*  Remakes / returns tab (Phase 41) — lab admin + accountant only.     */
/*  Rounds are the shared, free follow-up records; the cost estimate +   */
/*  fault classification here are LAB-INTERNAL (case_round_costs), RLS-   */
/*  gated to finance roles, so technicians never see them.               */
/* ================================================================== */

const KIND_STYLE = {
  stage: "bg-sky-100 text-sky-700",
  remake: "bg-rose-100 text-rose-700",
  adjustment: "bg-amber-100 text-amber-700",
  refit: "bg-violet-100 text-violet-700",
};

function RemakeRow({ round, parent, clinicName, cost, onSaveCost, onResolve, saving }) {
  const [fault, setFault] = useState(cost?.fault ?? "unclassified");
  const [estimate, setEstimate] = useState(cost?.costEstimate == null ? "" : String(cost.costEstimate));
  const [dirty, setDirty] = useState(false);

  // Re-sync local editor when the stored cost changes (e.g. realtime refetch),
  // but never stomp an in-progress edit.
  useEffect(() => {
    if (dirty) return;
    setFault(cost?.fault ?? "unclassified");
    setEstimate(cost?.costEstimate == null ? "" : String(cost.costEstimate));
  }, [cost, dirty]);

  const save = async () => {
    await onSaveCost(round.id, { fault, costEstimate: estimate === "" ? null : Number(estimate) });
    setDirty(false);
  };

  return (
    <div className={`rounded-2xl border p-4 ${round.status === "open" ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${KIND_STYLE[round.kind] ?? "bg-slate-100 text-slate-600"}`}>
              {ROUND_KIND_LABELS[round.kind] ?? round.kind}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${round.status === "open" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
              {round.status === "open" ? "Open" : "Resolved"}
            </span>
            {round.pickupRequested && (
              <span className="flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700"><Truck size={11} /> Pick-up</span>
            )}
          </div>
          <p className="mt-1 truncate text-sm font-bold text-slate-800">
            {parent?.patientName ?? "Unknown patient"} <span className="font-mono text-[11px] font-medium text-slate-400">· {round.parentCaseId}</span>
          </p>
          <p className="truncate text-xs text-slate-500">{clinicName || "—"}{round.createdByName ? ` · from ${round.createdByName}` : ""}</p>
        </div>
        <span className="shrink-0 text-[11px] text-slate-400">{round.createdAt ? new Date(round.createdAt).toLocaleDateString() : ""}</span>
      </div>

      {round.instructions && <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-slate-600">{round.instructions}</p>}
      {Array.isArray(round.attachments) && round.attachments.length > 0 && (
        <p className="mt-1 text-[11px] text-slate-400">{round.attachments.length} attachment{round.attachments.length === 1 ? "" : "s"}</p>
      )}

      {/* Lab-internal: cost estimate + fault. Not a charge to the clinic. */}
      <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs">
          <span className="mb-1 block font-semibold text-slate-500">Fault (internal)</span>
          <select
            value={fault}
            onChange={(e) => { setFault(e.target.value); setDirty(true); }}
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            {ROUND_FAULTS.map((f) => (
              <option key={f} value={f}>{ROUND_FAULT_LABELS[f]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-semibold text-slate-500">Est. cost (OMR, internal)</span>
          <input
            type="number"
            min="0"
            step="0.001"
            inputMode="decimal"
            value={estimate}
            onChange={(e) => { setEstimate(e.target.value); setDirty(true); }}
            placeholder="—"
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className={`self-end rounded-lg px-3 py-1.5 text-sm font-semibold text-white ${dirty && !saving ? "bg-blue-600 hover:bg-blue-700" : "cursor-not-allowed bg-slate-300"}`}
        >
          Save
        </button>
      </div>

      {round.status === "open" && onResolve && (
        <button
          type="button"
          onClick={() => onResolve(round.id)}
          className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          <Check size={13} /> Mark resolved
        </button>
      )}
    </div>
  );
}

export function RemakesPanel({ lab, rounds = [], cases = [], clinicsById = {}, onResolve }) {
  const [costs, setCosts] = useState({});
  const [costError, setCostError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [savingId, setSavingId] = useState(null);

  const caseById = useMemo(() => Object.fromEntries((cases ?? []).map((c) => [c.id, c])), [cases]);

  const load = () => {
    if (!lab?.id) return;
    setCostError("");
    fetchRoundCosts(lab.id)
      .then((rows) => setCosts(Object.fromEntries(rows.map((r) => [r.roundId, r]))))
      .catch((e) => setCostError(e.message));
  };
  useEffect(load, [lab?.id, rounds.length]);

  // This lab's rounds only. `rounds` is RLS-scoped already; requiring the
  // parent case to be in the lab's own set is belt-and-suspenders isolation.
  const labRounds = useMemo(() => rounds.filter((r) => caseById[r.parentCaseId]), [rounds, caseById]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return labRounds
      .filter((r) => statusFilter === "all" || r.status === statusFilter)
      .filter((r) => {
        if (!q) return true;
        const c = caseById[r.parentCaseId];
        const clinic = clinicsById[c?.clinicId]?.name ?? "";
        return [c?.patientName, c?.id, clinic, ROUND_KIND_LABELS[r.kind]].some((v) => String(v ?? "").toLowerCase().includes(q));
      })
      .sort((a, b) => (a.status === b.status ? new Date(b.createdAt) - new Date(a.createdAt) : a.status === "open" ? -1 : 1));
  }, [labRounds, statusFilter, query, caseById, clinicsById]);

  const openCount = labRounds.filter((r) => r.status === "open").length;
  const totalEstimate = labRounds.reduce((s, r) => s + (costs[r.id]?.costEstimate ?? 0), 0);
  const faultTally = useMemo(() => {
    const t = { lab: 0, clinic: 0, shared: 0, unclassified: 0 };
    for (const r of labRounds) t[costs[r.id]?.fault ?? "unclassified"]++;
    return t;
  }, [labRounds, costs]);

  const saveCost = async (roundId, { fault, costEstimate }) => {
    setSavingId(roundId);
    try {
      const saved = await upsertRoundCost({ roundId, labId: lab.id, fault, costEstimate });
      setCosts((p) => ({ ...p, [roundId]: saved }));
      const parent = caseById[rounds.find((r) => r.id === roundId)?.parentCaseId];
      logActivity("set remake cost", `${parent?.patientName ?? ""} · ${costEstimate == null ? "—" : costEstimate + " OMR"} · ${ROUND_FAULT_LABELS[fault]}`);
    } catch (e) {
      alert("Couldn't save the cost estimate — " + e.message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Open returns</p>
          <p className="mt-1 text-2xl font-black text-amber-600">{openCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">All follow-ups</p>
          <p className="mt-1 text-2xl font-black text-slate-800">{labRounds.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Est. remake cost</p>
          <p className="mt-1 text-2xl font-black text-slate-800">{fmtOMR(totalEstimate)}</p>
          <p className="text-[10px] text-slate-400">internal estimate, not billed</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Fault split</p>
          <p className="mt-1 text-xs font-semibold text-slate-600">
            Lab {faultTally.lab} · Clinic {faultTally.clinic}
          </p>
          <p className="text-[10px] text-slate-400">Shared {faultTally.shared} · Unclassified {faultTally.unclassified}</p>
        </div>
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search patient, case #, clinic, type"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm"
          />
        </div>
        {["all", "open", "resolved"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${statusFilter === s ? "bg-blue-600 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            {s}
          </button>
        ))}
      </div>

      {costError && (
        <p className="rounded-lg bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">Cost estimates unavailable: {costError}</p>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center">
          <RotateCcw size={22} className="mx-auto text-slate-300" />
          <p className="mt-2 text-sm text-slate-400">
            {labRounds.length === 0 ? "No follow-ups or returns yet." : "No follow-ups match this filter."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((r) => (
            <RemakeRow
              key={r.id}
              round={r}
              parent={caseById[r.parentCaseId]}
              clinicName={clinicsById[caseById[r.parentCaseId]?.clinicId]?.name}
              cost={costs[r.id]}
              onSaveCost={saveCost}
              onResolve={onResolve}
              saving={savingId === r.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* Lab-side staff sign-in log (Phase 37b) — RLS scopes the rows to this
   lab's own members; clinics and other labs never appear here. */
const LOG_EXPORT_PERIODS = [
  { id: "1m", label: "Past month", days: 30 },
  { id: "2m", label: "Past 2 months", days: 60 },
  { id: "6m", label: "Past 6 months", days: 180 },
];

export function LabStaffLogsPanel() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  const [exportPeriod, setExportPeriod] = useState("1m");
  const [exporting, setExporting] = useState(false);

  const load = () => {
    setEvents(null);
    setError("");
    fetchLoginEvents(300)
      .then(setEvents)
      .catch((err) => {
        setEvents([]);
        setError(err.message);
      });
  };
  useEffect(load, []);

  // Excel download: fetch the FULL period (paginated — the on-screen list is
  // capped at 300 rows, the export must not be), then write via SheetJS
  // (dynamic import, same pattern as the finance history import).
  const downloadExcel = async () => {
    setExporting(true);
    try {
      const p = LOG_EXPORT_PERIODS.find((x) => x.id === exportPeriod) ?? LOG_EXPORT_PERIODS[0];
      const since = new Date(Date.now() - p.days * 86_400_000).toISOString();
      const all = await fetchLoginEventsSince(since);
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet(logExportRows(all));
      ws["!cols"] = [{ wch: 20 }, { wch: 22 }, { wch: 28 }, { wch: 10 }, { wch: 22 }, { wch: 22 }, { wch: 46 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Staff logs");
      XLSX.writeFile(wb, `staff-logs-${p.id}-${new Date().toISOString().slice(0, 10)}.xlsx`);
      logActivity("exported staff logs", `${p.label} · ${all.length} rows`);
    } catch (err) {
      alert("Couldn't export the logs — " + err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-800">Staff sign-ins</h3>
        <p className="text-xs text-slate-400">Sign-ins and actions by your lab's members, newest first.</p>
        <span className="ml-auto flex items-center gap-1.5">
          <select
            value={exportPeriod}
            onChange={(e) => setExportPeriod(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600"
          >
            {LOG_EXPORT_PERIODS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <button
            onClick={downloadExcel}
            disabled={exporting}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${exporting ? "cursor-wait bg-slate-300" : "bg-emerald-600 hover:bg-emerald-700"}`}
          >
            <Download size={13} /> {exporting ? "Preparing…" : "Download Excel"}
          </button>
          <button onClick={load} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600" title="Refresh">
            <RefreshCcw size={14} />
          </button>
        </span>
      </div>
      {error && <p className="border-b border-slate-100 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">{error}</p>}
      {events === null ? (
        <p className="px-4 py-10 text-center text-sm text-slate-400">Loading sign-ins…</p>
      ) : events.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-slate-400">
          No sign-ins recorded yet — entries appear as your staff log in from now on.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2">Date &amp; time</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-600">
                    {new Date(e.at).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-slate-800">
                    {logDisplayName(e)}
                    {e.email && e.email !== logDisplayName(e) && <span className="block text-[11px] font-normal text-slate-400">{e.email}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.action === "sign-in" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                      {e.action}
                    </span>
                  </td>
                  <td className="max-w-[240px] truncate px-4 py-2.5 text-slate-500" title={e.detail}>{e.detail || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default PriceListsManager;
export { fmtMoney };

/* ------------------------------------------------------------------ */
/*  Commission rates — flat OMR per completed unit, per Rx category,   */
/*  per technician ("Mr. Toney gets 5 OMR per zirconia unit").          */
/* ------------------------------------------------------------------ */

function CommissionRatesModal({ open, tech, labId, initial, onClose, onSaved }) {
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, String(v)])));
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const rates = {};
      for (const [cat, v] of Object.entries(draft)) {
        const n = Number(v);
        if (n > 0) rates[cat] = n;
      }
      await saveCommissionRates(labId, tech.userId, rates);
      onSaved(tech.userId, rates);
      onClose();
    } catch (err) {
      setError("Couldn't save rates — " + err.message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Wrench size={16} className="text-blue-600" />
          <h3 className="min-w-0 truncate text-sm font-bold text-slate-800">Commission rates — {tech.name}</h3>
          <button onClick={onClose} className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="mb-3 text-[11px] text-slate-400">
            OMR earned per completed unit of each procedure. Leave blank for no commission on that category.
          </p>
          <div className="space-y-1.5">
            {CATEGORY_NAMES.map((cat) => (
              <div key={cat} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{cat}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={draft[cat] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [cat]: e.target.value }))}
                    placeholder="0"
                    className="w-20 rounded-lg border border-transparent bg-gray-50 px-2 py-1.5 text-center text-sm text-slate-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs text-slate-400">OMR</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-slate-100 p-4">
          {error && <p className="mb-2 text-xs font-semibold text-rose-600">{error}</p>}
          <button onClick={save} disabled={busy} className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40">
            {busy ? "Saving…" : "Save rates"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
