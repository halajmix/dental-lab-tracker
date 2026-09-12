import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchClinicDentists, createClinicInvitation } from "./lib/data.js";

export default function ClinicDentistPicker({ clinicId, userId, value, onChange, onValidity }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [notice, setNotice] = useState("");
  const selectRef = useRef(null);
  const dialogRef = useRef(null);
  const activeClinic = useRef(clinicId);
  activeClinic.current = clinicId;

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setRows([]);
    onValidity(false);
    fetchClinicDentists(clinicId).then((data) => {
      if (!cancelled) { setRows(data); setLoading(false); }
    }).catch(() => {
      if (!cancelled) { setError("Couldn't load the clinic's dentists. Please try again."); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [clinicId, refresh, onValidity]);

  useEffect(() => {
    onValidity(!loading && !error && rows.some((d) => d.id === value));
  }, [rows, value, loading, error, onValidity]);

  useEffect(() => {
    setAdding(false); setNotice("");
  }, [clinicId]);

  const close = () => {
    if (busy) return;
    setAdding(false);
    selectRef.current?.focus();
  };
  const add = async (e) => {
    e.preventDefault();
    if (busy) return;
    const target = clinicId;
    setBusy(true); setInviteError("");
    try {
      const invitation = await createClinicInvitation(target, userId, { name, email, role: "doctor" });
      if (activeClinic.current !== target) return;
      // The roster row and invitation commit in one database transaction.
      // Keep the saved invite visible even if the subsequent list refresh fails.
      setNotice(invitation.reused ? "Dentist ready to select. They do not need to accept the invitation for you to submit on their behalf." : "Dentist added and invitation requested. You can submit on their behalf immediately.");
      setAdding(false); setName(""); setEmail("");
      try {
        const data = await fetchClinicDentists(target);
        if (activeClinic.current !== target) return;
        setRows(data); setError("");
        const dentist = data.find((d) => invitation.dentist_id ? d.id === invitation.dentist_id : d.invitation_id === invitation.id);
        if (dentist) onChange(dentist.id, dentist.name);
        else setError("The invitation was saved. Refresh the list to select the dentist.");
      } catch {
        setError("The invitation was saved, but the list couldn't refresh. Please try again.");
      }
      selectRef.current?.focus();
    } catch (err) {
      setInviteError(err.message);
    } finally { setBusy(false); }
  };
  const dialogKeys = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    if (e.key !== "Tab") return;
    const controls = [...dialogRef.current.querySelectorAll('input,button')].filter((el) => !el.disabled);
    const first = controls[0], last = controls[controls.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };

  return <div className="sm:col-span-2">
    <label htmlFor="treating-dentist" className="mb-1 block text-xs font-semibold text-slate-700">Treating dentist <span className="text-rose-500">*</span></label>
    <div className="flex flex-wrap gap-2">
      <select ref={selectRef} id="treating-dentist" value={rows.some((d) => d.id === value) ? value : ""} disabled={loading || busy}
        onChange={(e) => { const d = rows.find((r) => r.id === e.target.value); onChange(d?.id ?? "", d?.name ?? ""); }}
        className="min-w-48 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
        <option value="">{loading ? "Loading dentists…" : "Select a dentist"}</option>
        {rows.map((d) => <option key={d.id} value={d.id}>{d.name}{!d.user_id ? " · Invited" : ""}</option>)}
      </select>
      <button type="button" disabled={busy || !clinicId} onClick={() => { setInviteError(""); setAdding(true); }} className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 disabled:opacity-50">Add a Dentist</button>
    </div>
    {!loading && !error && rows.length === 0 && <p className="mt-1 text-xs text-slate-500">Add and invite a dentist to send this prescription on their behalf.</p>}
    {error && <p role="alert" className="mt-1 text-xs text-rose-700">{error} <button type="button" onClick={() => setRefresh((n) => n + 1)} className="underline">Try again</button></p>}
    {notice && <p role="status" className="mt-1 text-xs text-emerald-700">{notice}</p>}
    {adding && createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="add-dentist-title" onKeyDown={dialogKeys} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="add-dentist-title" className="text-lg font-bold text-slate-900">Add a Dentist</h2>
        <p className="mt-1 text-sm text-slate-500">Invite a dentist to this clinic. You can select them immediately.</p>
        <form onSubmit={add} className="mt-4 space-y-4">
          <label className="block text-sm font-semibold text-slate-700">Dentist name<input autoFocus required maxLength={160} disabled={busy} value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal" /></label>
          <label className="block text-sm font-semibold text-slate-700">Dentist email<input type="email" required disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal" /></label>
          {inviteError && <p role="alert" className="text-sm text-rose-700">{inviteError}</p>}
          <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={close} className="rounded-lg border px-4 py-2 text-sm">Cancel</button><button type="submit" disabled={busy || !name.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Adding…" : "Add and Invite"}</button></div>
        </form>
      </div>
    </div>, document.body)}
  </div>;
}
