import { toothSummary } from "./PrescriptionForm.jsx";

// Escape a value for CSV (wrap in quotes, double internal quotes).
const cell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const HEADERS = [
  "Case ID",
  "Patient Name",
  "Dentist",
  "Target Lab",
  "Restoration Type",
  "Tooth Numbers",
  "Date Sent",
  "Target Date",
  "Current Stage (1-6)",
  "Handover Status",
  "Remake Status",
];

function rowFor(c, labName, dentist) {
  const handover = c.handover?.confirmed ? c.handover.type : "—";
  const remake = c.remake
    ? `${c.remake.classification === "clinical" ? "Clinical" : "Laboratory"}: ${c.remake.reason}`
    : "None";
  return [
    c.id,
    c.patientName,
    dentist,
    labName,
    c.prescription?.category ?? "—",
    toothSummary(c.prescription) || "—",
    c.createdDate ?? "—",
    c.appointmentDate ?? "—",
    (c.stageIndex ?? 0) + 1,
    handover,
    remake,
  ];
}

/**
 * Build a CSV string + trigger a client-side download.
 * Runs entirely in the browser (Blob + object URL); no data leaves the page.
 */
export function exportCasesCSV(cases, labs, dentist = "Dr. Chen", filename = "dentatrack-cases.csv") {
  const labName = (id) => labs.find((l) => l.id === id)?.name ?? "—";
  // `dentist` may be a fixed string, or a per-case resolver (labs can serve
  // more than one clinic, so a single fixed name would misattribute rows).
  const dentistFor = typeof dentist === "function" ? dentist : () => dentist;
  const lines = [HEADERS, ...cases.map((c) => rowFor(c, labName(c.labId), dentistFor(c)))];
  const csv = lines.map((row) => row.map(cell).join(",")).join("\r\n");

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
