import React, { useEffect, useState } from "react";
import { X, MessageCircle, Mail, Phone, Copy, Check, Send } from "lucide-react";
import { toothSummary } from "./PrescriptionForm.jsx";
import { STAGES } from "./LifecycleEngine.jsx";

// Digits only, no leading zeros — the format wa.me expects.
const waPhone = (p) => (p || "").replace(/\D/g, "").replace(/^0+/, "");

/**
 * Build the case context block that heads every message to the lab, so the
 * technician never has to look the case up before reading the request.
 */
export function buildCaseContext(caseObj, clinic) {
  const rx = caseObj.prescription;
  const stage = STAGES[caseObj.stageIndex];
  const lines = [
    `Case: ${caseObj.id}`,
    `Patient: ${caseObj.patientName} (${caseObj.patientId})`,
  ];
  if (rx) {
    lines.push(`Restoration: ${rx.category}${rx.material ? ` — ${rx.material}` : ""}`);
    if (toothSummary(rx)) lines.push(`Teeth: ${toothSummary(rx)}`);
    if (rx.vitaShade && rx.vitaShade !== "N/A") lines.push(`Shade: ${rx.vitaShade}`);
    if (rx.implantSystem) {
      lines.push(`Implant: ${rx.implantSystem} · ${rx.abutmentType} · ${rx.abutmentDiameter}`);
    }
    if (rx.rush) lines.push(`Express order`);
  }
  lines.push(`Status: ${stage?.label ?? "—"} (${stage?.pct ?? 0}%)`);
  lines.push(
    `Deliver by: ${caseObj.appointmentDate}${
      caseObj.deliveryTime && caseObj.deliveryTime !== "Anytime" ? ` (${caseObj.deliveryTime})` : ""
    }`
  );
  return lines.join("\n");
}

function openInNewTab(url) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function ContactLabModal({ open, caseObj, lab, clinic, onClose }) {
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setNote("");
      setCopied(false);
    }
  }, [open, caseObj?.id]);

  if (!open || !caseObj) return null;

  const context = buildCaseContext(caseObj, clinic);
  const signature = `— ${clinic.dentist}, ${clinic.name}`;
  const fullMessage = [context, "", note.trim() || "(your message)", "", signature].join("\n");
  const subject = `${caseObj.id} — ${caseObj.patientName} · ${caseObj.prescription?.category ?? "Lab case"}`;

  const phone = waPhone(lab?.contact);
  const waUrl = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(fullMessage)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(fullMessage)}`;
  const mailUrl = `mailto:${lab?.email ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(fullMessage)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the textarea below is still selectable */
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        {/* header */}
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-800">
              <MessageCircle size={17} className="text-blue-600" /> Contact {lab?.name ?? "Lab"}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Re: {caseObj.id} · {caseObj.patientName}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* lab contact shortcuts */}
          <div className="flex flex-wrap gap-2">
            {lab?.contact && (
              <a
                href={`tel:${lab.contact.replace(/[^\d+]/g, "")}`}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Phone size={13} /> {lab.contact}
              </a>
            )}
            {lab?.email && (
              <a
                href={`mailto:${lab.email}`}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Mail size={13} /> {lab.email}
              </a>
            )}
          </div>

          {/* auto-generated context */}
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Case details (added automatically)</p>
            <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600 ring-1 ring-inset ring-slate-200">
              {context}
            </pre>
          </div>

          {/* the dentist's own message */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Your message</span>
            <textarea
              autoFocus
              rows={5}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Please reduce the mesial contact on 11 and re-glaze before delivery."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
        </div>

        {/* actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button
            onClick={copy}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <div className="flex gap-2">
            <a
              href={mailUrl}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ${
                lab?.email ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100" : "pointer-events-none border border-slate-200 bg-slate-100 text-slate-400"
              }`}
              title={lab?.email ? `Email ${lab.email}` : "No email on file for this lab"}
            >
              <Mail size={15} /> Email
            </a>
            <button
              onClick={() => openInNewTab(waUrl)}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <Send size={15} /> Send on WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
