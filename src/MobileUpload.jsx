import React, { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, FileUp, FileText, ScanLine, X, Loader2, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { scanPickerAccept } from "./lib/data.js";

/* ------------------------------------------------------------------ */
/*  /mobile-upload/<token> — the page a phone lands on after scanning   */
/*  the desktop QR. Deliberately OUTSIDE the AuthGate: the single-use,  */
/*  15-minute session token is the only credential, and the phone only  */
/*  ever talks to the mobile-upload Edge Function (which validates it   */
/*  fail-closed and writes into the private bucket server-side).        */
/*                                                                      */
/*  No patient data is shown here — this page can only ADD photos to    */
/*  the session that created the QR; it can read nothing.               */
/* ------------------------------------------------------------------ */

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mobile-upload`;
const MAX_FILES = 10;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_SCAN_BYTES = 50 * 1024 * 1024; // STL exports dwarf photos
const isScanFile = (name) => /\.(stl|pdf)$/i.test(name || "");
// With the accept filter off on iOS (see scanPickerAccept) the picker can
// hand over anything — only images and scan files may join the upload.
const isSupportedFile = (file) =>
  isScanFile(file.name) || (file.type || "").startsWith("image/") || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(file.name || "");

export default function MobileUpload({ token }) {
  // gate: checking | ready | invalid ; then upload: idle | sending | done | error
  const [gate, setGate] = useState("checking");
  const [files, setFiles] = useState([]); // {id, file, previewUrl|null, scan}
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const scanRef = useRef(null); // Phase 61: STL / PDF picker

  useEffect(() => {
    let alive = true;
    fetch(`${FN_URL}?action=info&token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("invalid"))))
      .then((d) => alive && setGate(d.ok ? "ready" : "invalid"))
      .catch(() => alive && setGate("invalid"));
    return () => {
      alive = false;
    };
  }, [token]);

  const addFiles = (list) => {
    setError("");
    const picked = Array.from(list ?? []);
    const incoming = picked.filter(isSupportedFile);
    const rejected = picked.find((f) => !isSupportedFile(f));
    if (rejected) setError(`"${rejected.name}" isn't a photo, STL, or PDF — it was left out.`);
    setFiles((prev) => {
      const room = MAX_FILES - prev.length;
      const extra = incoming.slice(0, Math.max(0, room)).map((file) => {
        const scan = isScanFile(file.name);
        return {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          scan,
          previewUrl: scan ? null : URL.createObjectURL(file),
        };
      });
      if (incoming.length > room) setError(`At most ${MAX_FILES} files per upload.`);
      return [...prev, ...extra];
    });
  };

  const removeFile = (id) =>
    setFiles((prev) => {
      const t = prev.find((f) => f.id === id);
      if (t?.previewUrl) URL.revokeObjectURL(t.previewUrl);
      return prev.filter((f) => f.id !== id);
    });

  const submit = async () => {
    if (files.length === 0) return;
    const tooBig = files.find((f) => f.file.size > (f.scan ? MAX_SCAN_BYTES : MAX_PHOTO_BYTES));
    if (tooBig) {
      setError(`"${tooBig.file.name}" is over ${tooBig.scan ? 50 : 10} MB — remove it and try again.`);
      return;
    }
    setPhase("sending");
    setError("");
    try {
      const form = new FormData();
      form.set("token", token);
      for (const f of files) form.append("photos", f.file, f.file.name);
      const res = await fetch(FN_URL, { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Upload failed — please try again.");
      setPhase("done");
    } catch (err) {
      setPhase("idle");
      setError(err.message || "Upload failed — check your connection and try again.");
    }
  };

  const shell = (children) => (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="bg-white px-5 py-4 shadow-sm">
        <h1 className="text-base font-black text-slate-800">Dr-Crown — Case Upload</h1>
        <p className="flex items-center gap-1 text-[11px] text-slate-400">
          <ShieldCheck size={12} className="text-emerald-500" /> Secure one-time link · files go straight to the case
        </p>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-5">{children}</main>
    </div>
  );

  if (gate === "checking")
    return shell(
      <p className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
        <Loader2 size={16} className="animate-spin" /> Checking your link…
      </p>
    );

  if (gate === "invalid")
    return shell(
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center">
        <AlertTriangle size={26} className="mx-auto text-rose-500" />
        <h2 className="mt-2 text-sm font-bold text-rose-800">This link has expired or was already used</h2>
        <p className="mt-1 text-xs text-rose-600">
          Ask for a fresh QR code on the computer (each code works once, for 15 minutes).
        </p>
      </div>
    );

  if (phase === "done")
    return shell(
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <CheckCircle2 size={30} className="mx-auto text-emerald-500" />
        <h2 className="mt-2 text-base font-bold text-emerald-800">
          {files.length} file{files.length === 1 ? "" : "s"} sent
        </h2>
        <p className="mt-1 text-xs text-emerald-700">
          They're already on the computer screen — you can close this page.
        </p>
      </div>
    );

  return shell(
    <>
      {/* capture="environment" opens the rear camera directly; the gallery
          input has no capture attr so the photo library opens instead. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <input ref={scanRef} type="file" accept={scanPickerAccept()} multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => cameraRef.current?.click()} className="flex flex-col items-center gap-2 rounded-2xl border border-blue-200 bg-white px-4 py-6 text-sm font-bold text-blue-700 shadow-sm active:bg-blue-50">
          <Camera size={26} /> Take photo
        </button>
        <button type="button" onClick={() => galleryRef.current?.click()} className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm font-bold text-slate-700 shadow-sm active:bg-slate-50">
          <ImagePlus size={26} /> From gallery
        </button>
      </div>
      <button type="button" onClick={() => scanRef.current?.click()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-violet-200 bg-white px-4 py-4 text-sm font-bold text-violet-700 shadow-sm active:bg-violet-50">
        <FileUp size={22} /> STL scan / PDF file
      </button>

      {files.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {files.map((f) => (
            <div key={f.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white">
              {f.previewUrl ? (
                <img src={f.previewUrl} alt="" className="h-28 w-full object-cover" />
              ) : (
                <div className="flex h-28 w-full flex-col items-center justify-center gap-1 px-2 text-violet-600">
                  {/\.pdf$/i.test(f.file.name) ? <FileText size={24} /> : <ScanLine size={24} />}
                  <span className="w-full truncate text-center text-[10px] font-semibold text-slate-600">{f.file.name}</span>
                </div>
              )}
              <button type="button" onClick={() => removeFile(f.id)} className="absolute right-1 top-1 rounded-full bg-slate-900/60 p-1 text-white active:bg-rose-600" aria-label="Remove">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={files.length === 0 || phase === "sending"}
        className={`mt-5 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-base font-bold text-white ${
          files.length === 0 || phase === "sending" ? "cursor-not-allowed bg-slate-300" : "bg-blue-600 active:bg-blue-700"
        }`}
      >
        {phase === "sending" ? (
          <>
            <Loader2 size={18} className="animate-spin" /> Uploading…
          </>
        ) : (
          <>Send {files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"}` : "files"} to the case</>
        )}
      </button>
      <p className="mt-2 text-center text-[11px] text-slate-400">Up to {MAX_FILES} files — photos 10 MB, STL/PDF 50 MB. This link works once.</p>
    </>
  );
}
