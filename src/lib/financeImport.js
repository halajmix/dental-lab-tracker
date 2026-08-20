/* ------------------------------------------------------------------ */
/*  Historical finance import — reads the lab's old Excel workbook      */
/*  sheets and maps each supported sheet type onto the platform's       */
/*  financial tables (clinic_statements / lab_payments / lab_expenses). */
/*  SheetJS is imported dynamically so the ~400kB parser never loads    */
/*  unless someone actually imports a file.                             */
/*                                                                      */
/*  Column headers are matched tolerantly (case-insensitive keyword     */
/*  search), so "Clinic Name", "clinic", "Customer" all work. Rows      */
/*  with no parsable amount or date are skipped and counted.            */
/* ------------------------------------------------------------------ */

export const IMPORT_CATEGORIES = [
  {
    id: "bills",
    label: "Bills per clinic per month",
    hint: "Columns: clinic, month/date, total — optional: paid. One statement per row.",
  },
  {
    id: "work",
    label: "All work done per month",
    hint: "Columns: clinic, date, amount — optional: invoice no, doctor, patient, procedure, unit, price. Rows are grouped into one statement per clinic per month; the per-row detail is kept as statement line items. Don't also import Bills for the same months (double-counts).",
  },
  {
    id: "money_in",
    label: "Money collection (money in)",
    hint: "Columns: clinic, date, amount — optional: method (cash/cheque/bank), reference.",
  },
  {
    id: "commission",
    label: "Technician commission payouts",
    hint: "Columns: month/date, amount — optional: technician name. Booked as Salaries expenses.",
  },
  {
    id: "pending",
    label: "Pending payments — all clinics",
    hint: "Columns: clinic, amount — optional: month/date (defaults to last month). Becomes unpaid opening-balance statements.",
  },
  {
    id: "spending",
    label: "Spending per month (expenses)",
    hint: "Columns: date, amount — optional: category, method, description.",
  },
  {
    id: "cash",
    label: "Cash on hand / cheques (opening balances)",
    hint: "Columns: type (cash/bank/cheque), amount — optional: reference, date. Cheques land in the pending portfolio.",
  },
];

/* ---------------- header + value coercion helpers ---------------- */

const findKey = (keys, patterns) => {
  for (const p of patterns) {
    const hit = keys.find((k) => p.test(String(k).trim()));
    if (hit) return hit;
  }
  return null;
};

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n !== 0 ? Math.abs(n) : null;
};

// Accepts Date objects (SheetJS cellDates), Excel serials, "2025-07",
// "07/2025", "July 2025", "15/7/2025" — returns "YYYY-MM-DD" or null.
const localIso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const toIsoDate = (v) => {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) return localIso(v);
  if (typeof v === "number" && v > 20000 && v < 60000) {
    // Excel serial date (days since 1899-12-30); serial math is UTC-safe
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/); // 2025-07(-15)
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3] ?? 1).padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); // 15/7/2025 (day-first)
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/); // 7/2025
  if (m) return `${m[2]}-${String(m[1]).padStart(2, "0")}-01`;
  const d = new Date(s); // "July 2025", "Jul-25", full dates
  if (!isNaN(d)) return localIso(d);
  return null;
};

const monthOf = (iso) => iso.slice(0, 7) + "-01";

const toMethod = (v) => {
  const s = String(v ?? "").toLowerCase();
  if (/cheq|check/.test(s)) return "cheque";
  if (/bank|transfer|wire|card/.test(s)) return "bank";
  return "cash";
};

const EXPENSE_CATEGORIES = ["Materials", "Salaries", "Rent", "Utilities", "Maintenance", "Other"];
const toExpenseCategory = (v) => {
  const s = String(v ?? "").toLowerCase();
  if (/material|ceramic|zircon|alloy|supply|stock/.test(s)) return "Materials";
  if (/salar|wage|staff|commission|payroll/.test(s)) return "Salaries";
  if (/rent|lease/.test(s)) return "Rent";
  if (/util|electric|water|internet|phone/.test(s)) return "Utilities";
  if (/mainten|repair|service|machine/.test(s)) return "Maintenance";
  const exact = EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === s.trim());
  return exact ?? "Other";
};

/* ---------------- workbook -> raw rows ---------------- */

export async function readWorkbookRows(file) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

/* ---------------- category mappers ---------------- */

// Returns { statements: [], payments: [], expenses: [], skipped, summary }
// where each entry is ready for its table (snake-free client shapes).
export function mapImportRows(categoryId, rows) {
  const out = { statements: [], payments: [], expenses: [], skipped: 0 };
  if (!rows.length) return { ...out, summary: "The sheet has no data rows." };
  const keys = Object.keys(rows[0]);

  const kClinic = findKey(keys, [/clinic/i, /customer/i, /doctor/i, /^dr\b/i]);
  const kDate = findKey(keys, [/date/i, /month/i, /period/i]);
  const kAmount = findKey(keys, [/amount/i, /total/i, /value/i, /price/i, /omr/i, /cost/i, /balance/i, /pending/i]);
  const kPaid = findKey(keys, [/paid/i, /received/i, /collect/i]);
  const kMethod = findKey(keys, [/method/i, /^type$/i, /via/i, /payment/i, /mode/i]);
  const kRef = findKey(keys, [/ref/i, /cheque\s*no/i, /check\s*no/i, /receipt/i, /invoice/i]);
  const kCategory = findKey(keys, [/categor/i, /item/i, /expense/i]);
  const kDesc = findKey(keys, [/desc/i, /detail/i, /note/i, /patient/i, /work/i, /particular/i]);
  const kTech = findKey(keys, [/tech/i, /staff/i, /^name$/i, /employee/i]);
  // Line-item detail for the "work" category (all optional).
  const kDoctor = findKey(keys, [/doctor/i, /dentist/i, /^dr\.?\s/i]);
  const kPatient = findKey(keys, [/patient/i]);
  const kProc = findKey(keys, [/procedure/i, /^work/i, /treatment/i, /descript/i]);
  const kUnit = findKey(keys, [/^units?\b/i, /qty/i, /quantit/i]);
  const kPrice = findKey(keys, [/^price\b/i, /unit\s*price/i, /rate/i]);

  const clinicOf = (r) => String(kClinic ? r[kClinic] : "").trim();
  const dateOf = (r) => (kDate ? toIsoDate(r[kDate]) : null);
  const amountOf = (r) => (kAmount ? num(r[kAmount]) : null);

  if (categoryId === "bills") {
    for (const r of rows) {
      const clinic = clinicOf(r);
      const date = dateOf(r);
      const total = amountOf(r);
      if (!clinic || !date || !total) { out.skipped++; continue; }
      const paid = kPaid ? num(r[kPaid]) ?? 0 : 0;
      out.statements.push({ clinicName: clinic, month: monthOf(date), total, paid: Math.min(paid, total) });
    }
  } else if (categoryId === "work") {
    // Each row is one piece of work; rows group into one statement per
    // clinic per month, keeping the row detail as statement line items.
    const groups = new Map();
    const str = (k, r) => String(k ? r[k] : "").trim();
    for (const r of rows) {
      const clinic = clinicOf(r);
      const date = dateOf(r);
      const amount = amountOf(r);
      if (!clinic || !date || !amount) { out.skipped++; continue; }
      const key = `${clinic}::${monthOf(date)}`;
      const g = groups.get(key) ?? { total: 0, lines: [] };
      g.total += amount;
      g.lines.push({
        date,
        invoice: str(kRef, r),
        dentist: str(kDoctor, r),
        patient: str(kPatient, r),
        procedure: str(kProc, r),
        units: kUnit ? num(r[kUnit]) : null,
        price: kPrice ? num(r[kPrice]) : null,
        amount,
      });
      groups.set(key, g);
    }
    for (const [key, g] of groups) {
      const [clinicName, month] = key.split("::");
      g.lines.sort((a, b) => a.date.localeCompare(b.date));
      out.statements.push({ clinicName, month, total: g.total, paid: 0, lineItems: g.lines });
    }
    out.statements.sort((a, b) => a.month.localeCompare(b.month) || a.clinicName.localeCompare(b.clinicName));
  } else if (categoryId === "money_in") {
    for (const r of rows) {
      const clinic = clinicOf(r);
      const date = dateOf(r);
      const amount = amountOf(r);
      if (!amount || !date) { out.skipped++; continue; }
      out.payments.push({
        clinicName: clinic,
        amount,
        method: toMethod(kMethod ? r[kMethod] : ""),
        reference: String(kRef ? r[kRef] : "").trim(),
        receivedDate: date,
        cleared: true, // history: cheques from past months have long cleared
      });
    }
  } else if (categoryId === "commission") {
    for (const r of rows) {
      const date = dateOf(r);
      const amount = amountOf(r);
      if (!amount || !date) { out.skipped++; continue; }
      const tech = String(kTech ? r[kTech] : "").trim();
      out.expenses.push({
        category: "Salaries",
        amount,
        method: toMethod(kMethod ? r[kMethod] : ""),
        description: tech ? `Commission — ${tech}` : "Technician commission",
        expenseDate: date,
      });
    }
  } else if (categoryId === "pending") {
    const lastMonth = new Date();
    lastMonth.setDate(1);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const fallbackMonth = lastMonth.toISOString().slice(0, 8) + "01";
    for (const r of rows) {
      const clinic = clinicOf(r);
      const amount = amountOf(r);
      if (!clinic || !amount) { out.skipped++; continue; }
      const date = dateOf(r);
      out.statements.push({ clinicName: clinic, month: date ? monthOf(date) : fallbackMonth, total: amount, paid: 0 });
    }
  } else if (categoryId === "spending") {
    for (const r of rows) {
      const date = dateOf(r);
      const amount = amountOf(r);
      if (!amount || !date) { out.skipped++; continue; }
      out.expenses.push({
        category: toExpenseCategory(kCategory ? r[kCategory] : ""),
        amount,
        method: toMethod(kMethod ? r[kMethod] : ""),
        description: String(kDesc ? r[kDesc] : "").trim(),
        invoiceNumber: String(kRef ? r[kRef] : "").trim(),
        expenseDate: date,
      });
    }
  } else if (categoryId === "cash") {
    const today = new Date().toISOString().slice(0, 10);
    for (const r of rows) {
      const amount = amountOf(r);
      if (!amount) { out.skipped++; continue; }
      const method = toMethod(kMethod ? r[kMethod] : (kCategory ? r[kCategory] : ""));
      out.payments.push({
        clinicName: "",
        amount,
        method,
        reference: String(kRef ? r[kRef] : "").trim() || "Opening balance",
        receivedDate: dateOf(r) ?? today,
        cleared: method !== "cheque", // uncleared cheques stay in the portfolio
      });
    }
  }

  const parts = [];
  if (out.statements.length) parts.push(`${out.statements.length} statement${out.statements.length === 1 ? "" : "s"}`);
  if (out.payments.length) parts.push(`${out.payments.length} payment${out.payments.length === 1 ? "" : "s"}`);
  if (out.expenses.length) parts.push(`${out.expenses.length} expense${out.expenses.length === 1 ? "" : "s"}`);
  const total =
    out.statements.reduce((s, x) => s + x.total, 0) +
    out.payments.reduce((s, x) => s + x.amount, 0) +
    out.expenses.reduce((s, x) => s + x.amount, 0);
  return {
    ...out,
    summary: parts.length
      ? `${parts.join(", ")} — ${total.toLocaleString(undefined, { maximumFractionDigits: 3 })} OMR total${out.skipped ? ` (${out.skipped} row${out.skipped === 1 ? "" : "s"} skipped)` : ""}`
      : `Nothing importable found${out.skipped ? ` — all ${out.skipped} rows lacked a usable amount, clinic, or date` : ""}. Check the expected columns.`,
  };
}
