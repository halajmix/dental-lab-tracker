import React, { useState, useEffect, useCallback } from "react";
import { Mail, Lock, LogIn, UserPlus, Stethoscope, Building2, Loader2, ArrowLeft, CheckCircle2, KeyRound } from "lucide-react";
import { supabase } from "./lib/supabaseClient.js";
import { useAuth } from "./lib/useAuth.js";
import { heartbeat } from "./lib/deviceSession.js";
import DeviceChallenge from "./DeviceChallenge.jsx";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

// window.location.origin alone drops the "/dental-lab-tracker/" sub-path GitHub
// Pages serves this app from, which 404s ("There isn't a GitHub Pages site
// here"). import.meta.env.BASE_URL is "/dental-lab-tracker/" in prod builds
// and "/" in dev (see vite.config.js), so this always lands on a real page.
const authRedirectUrl = () => window.location.origin + import.meta.env.BASE_URL;

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

/** Omani number: fixed 00968 chip, 8 local digits — same pattern as Settings. */
function OmaniPhoneInput({ value, onChange, required }) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-500">
        00968
      </span>
      <input
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
        className={inputCls}
        placeholder="9XXXXXXX"
        inputMode="numeric"
        pattern="\d{8}"
        title="8-digit Omani number, no country code"
      />
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 text-white">
            <Stethoscope size={20} />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight text-slate-800">Dr-Crown</h1>
            <p className="text-[11px] leading-tight text-slate-500">Lab Case Tracking · Lifecycle Engine</p>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Login / Signup                                                     */
/* ------------------------------------------------------------------ */

function LoginScreen({ onSwitch, onForgot }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message);
  };

  return (
    <Shell>
      <h2 className="mb-1 text-lg font-bold text-slate-800">Log in</h2>
      <p className="mb-5 text-xs text-slate-500">Access your clinic or lab dashboard.</p>
      <ErrorBanner message={error} />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <div className="relative">
            <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} pl-9`} placeholder="you@clinic.com" />
          </div>
        </Field>
        <Field label="Password">
          <div className="relative">
            <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputCls} pl-9`} placeholder="••••••••" />
          </div>
        </Field>
        <div className="-mt-2 text-right">
          <button type="button" onClick={onForgot} className="text-xs font-semibold text-blue-600 hover:underline">
            Forgot password?
          </button>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
          Log in
        </button>
      </form>
      <p className="mt-5 text-center text-xs text-slate-500">
        Don't have an account?{" "}
        <button onClick={onSwitch} className="font-semibold text-blue-600 hover:underline">
          Register your clinic or lab
        </button>
      </p>
    </Shell>
  );
}

function ForgotPasswordScreen({ onBack }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: authRedirectUrl(),
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <Shell>
        <div className="flex flex-col items-center py-4 text-center">
          <CheckCircle2 size={36} className="mb-3 text-emerald-500" />
          <h2 className="mb-1 text-lg font-bold text-slate-800">Check your email</h2>
          <p className="mb-5 text-sm text-slate-500">
            If an account exists for <span className="font-semibold text-slate-700">{email}</span>, we sent a password reset link. Click it to set a new password.
          </p>
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:underline">
            <ArrowLeft size={14} /> Back to log in
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <button onClick={onBack} className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ArrowLeft size={13} /> Back to log in
      </button>
      <h2 className="mb-1 text-lg font-bold text-slate-800">Reset your password</h2>
      <p className="mb-5 text-xs text-slate-500">We'll email you a link to set a new one.</p>
      <ErrorBanner message={error} />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <div className="relative">
            <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} pl-9`} placeholder="you@clinic.com" />
          </div>
        </Field>
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
          Send reset link
        </button>
      </form>
    </Shell>
  );
}

function ResetPasswordScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    onDone();
  };

  return (
    <Shell>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-slate-800">
        <KeyRound size={18} className="text-blue-600" /> Set a new password
      </h2>
      <p className="mb-5 text-xs text-slate-500">Choose a new password for your account.</p>
      <ErrorBanner message={error} />
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password">
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="At least 6 characters" />
        </Field>
        <Field label="Confirm new password">
          <input type="password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} placeholder="Re-enter password" />
        </Field>
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          Update password
        </button>
      </form>
    </Shell>
  );
}

function SignupScreen({ onSwitch }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Supabase deliberately reports success for an already-registered email
    // (anti-probing) — the only tell is an empty identities array. Without
    // this check the user waits forever for an email that will never come.
    if (!data.session && data.user && (data.user.identities?.length ?? 0) === 0) {
      setError(
        "This email is already registered — log in instead. If you left setup unfinished, it resumes exactly where you stopped.",
      );
      return;
    }
    // If the project requires email confirmation, no session comes back yet —
    // the user completes org setup (Onboarding) after they confirm and log in.
    if (!data.session) {
      setAwaitingConfirm(true);
    }
    // If a session DID come back, useAuth's onAuthStateChange fires on its
    // own and AuthGate will drop straight into Onboarding — nothing to do here.
  };

  if (awaitingConfirm) {
    return (
      <Shell>
        <div className="flex flex-col items-center py-4 text-center">
          <CheckCircle2 size={36} className="mb-3 text-emerald-500" />
          <h2 className="mb-1 text-lg font-bold text-slate-800">Check your email</h2>
          <p className="mb-5 text-sm text-slate-500">
            We sent a confirmation link to <span className="font-semibold text-slate-700">{email}</span>. Click it, then come back and log in.
          </p>
          <button onClick={onSwitch} className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:underline">
            <ArrowLeft size={14} /> Back to log in
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h2 className="mb-1 text-lg font-bold text-slate-800">Create an account</h2>
      <p className="mb-5 text-xs text-slate-500">You'll choose Dentist or Lab next.</p>
      <ErrorBanner message={error} />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <div className="relative">
            <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} pl-9`} placeholder="you@clinic.com" />
          </div>
        </Field>
        <Field label="Password">
          <div className="relative">
            <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputCls} pl-9`} placeholder="At least 6 characters" />
          </div>
        </Field>
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
          Continue
        </button>
      </form>
      <p className="mt-5 text-center text-xs text-slate-500">
        Already have an account?{" "}
        <button onClick={onSwitch} className="font-semibold text-blue-600 hover:underline">
          Log in
        </button>
      </p>
    </Shell>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState("login"); // "login" | "signup" | "forgot"
  if (mode === "signup") return <SignupScreen onSwitch={() => setMode("login")} />;
  if (mode === "forgot") return <ForgotPasswordScreen onBack={() => setMode("login")} />;
  return <LoginScreen onSwitch={() => setMode("signup")} onForgot={() => setMode("forgot")} />;
}

/* ------------------------------------------------------------------ */
/*  Onboarding — runs once a session exists but no profile row does    */
/* ------------------------------------------------------------------ */

function DentistOnboarding({ userId, userEmail, onDone, onBack }) {
  const [clinicName, setClinicName] = useState("");
  const [dentistName, setDentistName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(userEmail || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data: newClinic, error: clinicErr } = await supabase
      .from("clinics")
      .insert({
        owner_id: userId,
        name: clinicName.trim(),
        dentist: dentistName.trim(),
        contact: `00968${phone}`,
        email: email.trim(),
      })
      .select()
      .single();
    if (clinicErr) {
      setBusy(false);
      setError(clinicErr.message);
      return;
    }
    const { error: profErr } = await supabase
      .from("profiles")
      .insert({ id: userId, role: "dentist", name: dentistName.trim(), clinic_id: newClinic.id, phone });
    setBusy(false);
    if (profErr) {
      setError(profErr.message);
      return;
    }
    onDone();
  };

  return (
    <Shell>
      <button onClick={onBack} className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ArrowLeft size={13} /> Back
      </button>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-slate-800">
        <Stethoscope size={18} className="text-blue-600" /> Set up your clinic
      </h2>
      <p className="mb-5 text-xs text-slate-500">This creates your clinic's private workspace.</p>
      <ErrorBanner message={error} />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Clinic name *">
          <input required value={clinicName} onChange={(e) => setClinicName(e.target.value)} className={inputCls} placeholder="Muscat Smile Dental Clinic" />
        </Field>
        <Field label="Dentist name *">
          <input required value={dentistName} onChange={(e) => setDentistName(e.target.value)} className={inputCls} placeholder="Dr. A. Chen, BDS" />
        </Field>
        <Field label="Contact number *">
          <OmaniPhoneInput required value={phone} onChange={setPhone} />
        </Field>
        <Field label="E-mail *">
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="care@clinic.com" />
        </Field>
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          Create clinic workspace
        </button>
      </form>
    </Shell>
  );
}

function LabOnboarding({ userId, userEmail, onDone, onBack }) {
  const [checked, setChecked] = useState(false);
  const [claimable, setClaimable] = useState(null); // lab row found by email, unclaimed
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);

  // New-lab form fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(userEmail || "");
  const [displayName, setDisplayName] = useState("");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("labs")
        .select("*")
        .is("owner_id", null)
        .ilike("email", (userEmail || "").trim())
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setClaimable(data ?? null);
        setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userEmail]);

  const claim = async () => {
    setBusy(true);
    setError("");
    // Profile FIRST: the labs update policy passes via "id = my_lab_id()",
    // which only works once profiles.lab_id points at this lab. The old
    // order (lab first) made the owner_id update a silent 0-row RLS no-op.
    const { error: profErr } = await supabase
      .from("profiles")
      .insert({ id: userId, role: "lab", name: displayName.trim() || "Lab Tech", lab_id: claimable.id });
    if (profErr) {
      setBusy(false);
      setError(profErr.message);
      return;
    }
    const { error: labErr } = await supabase.from("labs").update({ owner_id: userId }).eq("id", claimable.id);
    setBusy(false);
    if (labErr) {
      setError(labErr.message);
      return;
    }
    onDone();
  };

  const createNew = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    // TAT starts at a sensible default — the lab tunes it later in Lab
    // Settings, keeping onboarding to the four identity fields only.
    const { data: newLab, error: labErr } = await supabase
      .from("labs")
      .insert({
        owner_id: userId,
        name: name.trim(),
        contact: `00968${phone}`,
        email: email.trim(),
        tat: 5,
      })
      .select()
      .single();
    if (labErr) {
      setBusy(false);
      setError(labErr.message);
      return;
    }
    const { error: profErr } = await supabase
      .from("profiles")
      .insert({ id: userId, role: "lab", name: (displayName || name).trim(), lab_id: newLab.id, phone });
    setBusy(false);
    if (profErr) {
      setError(profErr.message);
      return;
    }
    onDone();
  };

  return (
    <Shell>
      <button onClick={onBack} className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ArrowLeft size={13} /> Back
      </button>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-slate-800">
        <Building2 size={18} className="text-blue-600" /> Set up your lab
      </h2>
      <ErrorBanner message={error} />

      {!checked && (
        <div className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {checked && claimable && !showNewForm && (
        <div>
          <p className="mb-4 text-xs text-slate-500">
            A dental clinic already added a lab profile using your email — claim it to link your account instead of starting from scratch.
          </p>
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-bold text-slate-800">{claimable.name}</p>
            <p className="text-xs text-slate-500">{claimable.contact || "No phone on file"} · {claimable.email || "No email"}</p>
            <p className="mt-1 text-xs text-slate-500">Turn around time {claimable.tat}d</p>
          </div>
          <Field label="Technician name">
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} placeholder="e.g. Ahmed Al-Balushi" />
          </Field>
          <button
            onClick={claim}
            disabled={busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Claim this lab profile
          </button>
          <button onClick={() => setShowNewForm(true)} className="mt-3 w-full text-center text-xs font-semibold text-slate-500 hover:text-slate-700">
            Not us — register a new lab instead
          </button>
        </div>
      )}

      {checked && (!claimable || showNewForm) && (
        <form onSubmit={createNew} className="space-y-4">
          {!claimable && <p className="mb-1 text-xs text-slate-500">No existing profile found for your email — let's register your lab.</p>}
          <Field label="Lab name *">
            <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Apex Dental Lab" />
          </Field>
          <Field label="Technician name *">
            <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} placeholder="e.g. Ahmed Al-Balushi" />
          </Field>
          <Field label="Phone number *">
            <OmaniPhoneInput required value={phone} onChange={setPhone} />
          </Field>
          <Field label="E-mail *">
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </Field>
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Create lab workspace
          </button>
          {claimable && (
            <button type="button" onClick={() => setShowNewForm(false)} className="w-full text-center text-xs font-semibold text-slate-500 hover:text-slate-700">
              Back to claiming {claimable.name}
            </button>
          )}
        </form>
      )}
    </Shell>
  );
}

function Onboarding({ session, onDone }) {
  const [role, setRole] = useState(null); // null | "dentist" | "lab"

  if (role === "dentist") return <DentistOnboarding userId={session.user.id} userEmail={session.user.email} onDone={onDone} onBack={() => setRole(null)} />;
  if (role === "lab") return <LabOnboarding userId={session.user.id} userEmail={session.user.email} onDone={onDone} onBack={() => setRole(null)} />;

  return (
    <Shell>
      <h2 className="mb-1 text-lg font-bold text-slate-800">One more step</h2>
      <p className="mb-1 text-xs text-slate-500">Are you a dental clinic or a laboratory?</p>
      <p className="mb-5 text-[11px] text-slate-400">
        Signed in as <span className="font-semibold text-slate-500">{session.user.email}</span> — you
        can leave and log back in any time; setup resumes here.{" "}
        <button
          onClick={() => supabase.auth.signOut()}
          className="font-semibold text-blue-600 hover:underline"
        >
          Sign out
        </button>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setRole("dentist")}
          className="flex flex-col items-center gap-2 rounded-xl border-2 border-slate-200 p-5 text-center hover:border-blue-400 hover:bg-blue-50"
        >
          <Stethoscope size={24} className="text-blue-600" />
          <span className="text-sm font-bold text-slate-800">Dentist / Clinic</span>
          <span className="text-[11px] text-slate-500">Create cases, track lab work</span>
        </button>
        <button
          onClick={() => setRole("lab")}
          className="flex flex-col items-center gap-2 rounded-xl border-2 border-slate-200 p-5 text-center hover:border-blue-400 hover:bg-blue-50"
        >
          <Building2 size={24} className="text-blue-600" />
          <span className="text-sm font-bold text-slate-800">Laboratory</span>
          <span className="text-[11px] text-slate-500">Receive & fulfill cases</span>
        </button>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/*  Lab Station device session                                          */
/* ------------------------------------------------------------------ */

const HEARTBEAT_MS = 15 * 60 * 1000;

/**
 * Registers this bench with the station-session Edge Function once a real
 * profile session exists, then re-checks periodically and whenever the
 * device comes back online (an IP change while asleep is exactly the case
 * the audit exists to catch).
 *
 * Fails open by design: if the function is unreachable the technician keeps
 * working. This is an audit and step-up layer on top of Supabase auth, not
 * the thing standing between an anonymous visitor and the data — that is
 * still RLS.
 */
function useStationSession(session) {
  const [state, setState] = useState({ status: null, sessionId: null });

  const ping = useCallback(async () => {
    const result = await heartbeat();
    if (result) setState(result);
  }, []);

  useEffect(() => {
    if (!session) {
      setState({ status: null, sessionId: null });
      return;
    }
    ping();
    const interval = setInterval(ping, HEARTBEAT_MS);
    window.addEventListener("online", ping);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", ping);
    };
  }, [session, ping]);

  const clear = useCallback(() => setState((s) => ({ ...s, status: "ACTIVE" })), []);
  return { ...state, clear };
}

/* ------------------------------------------------------------------ */
/*  Top-level gate                                                     */
/* ------------------------------------------------------------------ */

export function AuthGate({ children }) {
  const auth = useAuth();
  const station = useStationSession(auth.profile ? auth.session : null);

  if (auth.loading || auth.session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 size={24} className="animate-spin text-blue-500" />
      </div>
    );
  }

  if (!auth.session) return <AuthScreen />;

  // A password-reset link signs the user in with a temporary session — force
  // the "set new password" screen before letting them into the app itself.
  if (auth.recovery) {
    return <ResetPasswordScreen onDone={auth.clearRecovery} />;
  }

  if (auth.profile === null) {
    return <Onboarding session={auth.session} onDone={auth.refreshProfile} />;
  }

  if (auth.profile === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 size={24} className="animate-spin text-blue-500" />
      </div>
    );
  }

  // Bench signed in from an unrecognised network — gate the app behind the
  // emailed step-up code before any patient data renders.
  if (station.status === "CHALLENGE_REQUIRED") {
    return (
      <DeviceChallenge
        sessionId={station.sessionId}
        location={station.location}
        emailed={station.emailed}
        reason={station.reason}
        onVerified={station.clear}
        onSignOut={auth.signOut}
      />
    );
  }

  if (station.status === "REVOKED") {
    return (
      <Shell>
        <div className="py-2 text-center">
          <h2 className="mb-1 text-lg font-bold text-slate-800">Device revoked</h2>
          <p className="mb-5 text-sm text-slate-500">
            This bench was signed out by an administrator. Sign in again to re-register it.
          </p>
          <button
            onClick={auth.signOut}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
          >
            Sign out
          </button>
        </div>
      </Shell>
    );
  }

  return children(auth);
}
