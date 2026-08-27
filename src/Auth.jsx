import React, { useState, useEffect } from "react";
import { Mail, Lock, LogIn, UserPlus, Stethoscope, Building2, Loader2, ArrowLeft, CheckCircle2, KeyRound, Users } from "lucide-react";
import { supabase } from "./lib/supabaseClient.js";
import { useAuth } from "./lib/useAuth.js";
import { peekClinicInvitation, acceptClinicInvitation } from "./lib/data.js";
import { OmanLocationFields } from "./lib/omanRegions.jsx";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

// window.location.origin alone drops the "/dental-lab-tracker/" sub-path GitHub
// Pages serves this app from, which 404s ("There isn't a GitHub Pages site
// here"). import.meta.env.BASE_URL is "/dental-lab-tracker/" in prod builds
// and "/" in dev (see vite.config.js), so this always lands on a real page.
const authRedirectUrl = () => window.location.origin + import.meta.env.BASE_URL;

// Staff-invitation deep link (Phase 21): the invite email links to
// /?invite_email=<address>, which opens signup with the address pre-filled —
// the invitation is matched by email at onboarding, so signing up with the
// exact invited address is what makes the "Join {lab}" card appear.
const inviteEmailParam = (() => {
  try {
    return new URLSearchParams(window.location.search).get("invite_email")?.trim() ?? "";
  } catch {
    return "";
  }
})();

// Clinic team invitation deep link (Phase 57): /?clinic_invite=<token>.
// Unlike the lab email-match flow above, the token IS the invitation —
// peek_clinic_invitation() shows who/what it's for, and once a session
// exists AuthGate routes through ClinicInviteAccept to bind the account.
const clinicInviteToken = (() => {
  try {
    return new URLSearchParams(window.location.search).get("clinic_invite")?.trim() ?? "";
  } catch {
    return "";
  }
})();

const clearClinicInviteParam = () => {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("clinic_invite");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  } catch {
    /* cosmetic only */
  }
};

// One shared peek for the signup banner and the accept screen.
function useClinicInvitePeek() {
  const [peek, setPeek] = useState(undefined); // undefined loading | null invalid | {clinicName,email,role,status}
  useEffect(() => {
    if (!clinicInviteToken) {
      setPeek(null);
      return;
    }
    let cancelled = false;
    peekClinicInvitation(clinicInviteToken)
      .then((v) => !cancelled && setPeek(v ?? null))
      .catch(() => !cancelled && setPeek(null));
    return () => {
      cancelled = true;
    };
  }, []);
  return peek;
}

const INVITE_ROLE_LABEL = { admin: "Clinic Admin", receptionist: "Receptionist", doctor: "Doctor" };

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
  const [email, setEmail] = useState(inviteEmailParam);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const clinicInvitePeek = useClinicInvitePeek();
  // Clinic invites carry the address server-side — prefill once peeked.
  useEffect(() => {
    if (clinicInvitePeek?.status === "pending" && !email) setEmail(clinicInvitePeek.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicInvitePeek]);

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
      {inviteEmailParam && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
          <b>You've been invited to join a lab.</b> Sign up with this exact email address and choose a
          password — your invitation is linked to it.
        </div>
      )}
      {clinicInvitePeek?.status === "pending" && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
          <b>You've been invited to join {clinicInvitePeek.clinicName}</b> as{" "}
          {INVITE_ROLE_LABEL[clinicInvitePeek.role] ?? clinicInvitePeek.role}. Sign up with{" "}
          <b>{clinicInvitePeek.email}</b> and choose a password — the invitation only works for that address.
        </div>
      )}
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
  // An invitation link drops the visitor straight onto signup.
  const [mode, setMode] = useState(inviteEmailParam || clinicInviteToken ? "signup" : "login"); // "login" | "signup" | "forgot"
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
  const [location, setLocation] = useState({ governorate: "", wilayat: "" });
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
        governorate: location.governorate,
        wilayat: location.wilayat,
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
        {/* Location drives the Rx form's "Near you" lab grouping, which keys
            off the sending clinic's governorate — asking here keeps it from
            silently never appearing. */}
        <OmanLocationFields
          required
          stacked
          value={location}
          onChange={(patch) => setLocation((l) => ({ ...l, ...patch }))}
          inputCls={inputCls}
        />
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
  const [invites, setInvites] = useState([]); // staff invites addressed to this email (Phase 19)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);

  // New-lab form fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(userEmail || "");
  const [displayName, setDisplayName] = useState("");
  const [location, setLocation] = useState({ governorate: "", wilayat: "" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data }, invitesRes] = await Promise.all([
        supabase
          .from("labs")
          .select("*")
          .is("owner_id", null)
          .ilike("email", (userEmail || "").trim())
          .limit(1)
          .maybeSingle(),
        // Staff invites: RLS only ever exposes rows addressed to the
        // caller's own login email, so no filter beyond user_id is needed.
        supabase.from("lab_members").select("id, lab_id, role, labs(name, contact)").is("user_id", null),
      ]);
      if (!cancelled) {
        setClaimable(data ?? null);
        setInvites(invitesRes.data ?? []);
        setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userEmail]);

  // Join via staff invite: profile first (can_join_lab passes because the
  // invite exists), then claim the invite rows (user_id only — the claim
  // guard trigger forces status to active and pins role/lab).
  const joinInvitedLab = async (labId) => {
    setBusy(true);
    setError("");
    const ids = invites.filter((i) => i.lab_id === labId).map((i) => i.id);
    const { error: profErr } = await supabase
      .from("profiles")
      .insert({ id: userId, role: "lab", name: displayName.trim() || "Lab Tech", lab_id: labId });
    if (profErr) {
      setBusy(false);
      setError(profErr.message);
      return;
    }
    const { data: claimed, error: claimErr } = await supabase
      .from("lab_members")
      .update({ user_id: userId })
      .in("id", ids)
      .select();
    setBusy(false);
    if (claimErr) {
      setError(claimErr.message);
      return;
    }
    if (!claimed?.length) {
      // RLS no-op guard: never assume a 0-row update succeeded
      setError("Could not claim the invite — ask your lab admin to re-invite you.");
      return;
    }
    onDone();
  };

  // The claimable row was created by a clinic before labs self-registered,
  // so it almost never carries a location. Ask for one on the way in.
  const claimNeedsLocation = !claimable?.governorate;

  const claim = async () => {
    if (claimNeedsLocation && (!location.governorate || !location.wilayat)) {
      // This button isn't a form submit, so `required` never fires here.
      setError("Pick your governorate and wilayat so clinics can find you.");
      return;
    }
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
    const labPatch = { owner_id: userId };
    if (claimNeedsLocation) {
      labPatch.governorate = location.governorate;
      labPatch.wilayat = location.wilayat;
    }
    const { error: labErr } = await supabase.from("labs").update(labPatch).eq("id", claimable.id);
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
        governorate: location.governorate,
        wilayat: location.wilayat,
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

  // One card per inviting lab (dual-role invites collapse into one card).
  const inviteLabs = [];
  for (const inv of invites) {
    let g = inviteLabs.find((x) => x.labId === inv.lab_id);
    if (!g) {
      g = { labId: inv.lab_id, name: inv.labs?.name ?? "A dental lab", roles: [] };
      inviteLabs.push(g);
    }
    if (!g.roles.includes(inv.role)) g.roles.push(inv.role);
  }
  const roleWords = (roles) =>
    roles
      .map((r) => (r === "lab_admin" ? "Lab Admin" : "Technician"))
      .join(" + ");

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

      {checked && inviteLabs.length > 0 && !showNewForm && (
        <div>
          <p className="mb-4 text-xs text-slate-500">
            You've been invited to join {inviteLabs.length === 1 ? "a lab team" : "lab teams"} — joining links your
            account to their workspace.
          </p>
          <Field label="Your name">
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} placeholder="e.g. Ahmed Al-Balushi" />
          </Field>
          {inviteLabs.map((g) => (
            <div key={g.labId} className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-bold text-slate-800">{g.name}</p>
              <p className="text-xs text-slate-500">Invited as: {roleWords(g.roles)}</p>
              <button
                onClick={() => joinInvitedLab(g.labId)}
                disabled={busy}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Join {g.name}
              </button>
            </div>
          ))}
          <button onClick={() => setShowNewForm(true)} className="mt-4 w-full text-center text-xs font-semibold text-slate-500 hover:text-slate-700">
            Not you? Register a separate lab instead
          </button>
        </div>
      )}

      {checked && claimable && inviteLabs.length === 0 && !showNewForm && (
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
          {claimNeedsLocation && (
            <div className="mt-4">
              <OmanLocationFields
                required
                stacked
                value={location}
                onChange={(patch) => setLocation((l) => ({ ...l, ...patch }))}
                inputCls={inputCls}
              />
            </div>
          )}
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

      {checked && ((!claimable && inviteLabs.length === 0) || showNewForm) && (
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
          {/* Without this the lab lands in the Rx form's lab picker reading
              "Location not set" and never joins a "Near you" group. */}
          <OmanLocationFields
            required
            stacked
            value={location}
            onChange={(patch) => setLocation((l) => ({ ...l, ...patch }))}
            inputCls={inputCls}
          />
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
/*  Clinic invite acceptance (Phase 57) — shown by AuthGate when a     */
/*  session exists and /?clinic_invite=<token> is present. Works for   */
/*  brand-new signups (asks for a name, the RPC creates the dentist    */
/*  profile) and for existing dentist accounts (joins as an extra      */
/*  clinic). Exported for the test harness.                            */
/* ------------------------------------------------------------------ */

export function ClinicInviteAccept({ session, profile, onDone }) {
  const peek = useClinicInvitePeek();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(null); // accept RPC result

  const myEmail = (session?.user?.email ?? "").toLowerCase();
  const emailMismatch = peek?.status === "pending" && myEmail && myEmail !== (peek.email ?? "").toLowerCase();
  const needsName = profile === null;
  const wrongAccountType = profile && profile.role !== "dentist";

  const join = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await acceptClinicInvitation(clinicInviteToken, needsName ? name : null);
      setJoined(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Loading: token peek or (post-login) profile still resolving.
  if (peek === undefined || profile === undefined) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-10 text-blue-500">
          <Loader2 size={22} className="animate-spin" />
        </div>
      </Shell>
    );
  }

  if (joined) {
    return (
      <Shell>
        <div className="mb-3 flex justify-center"><CheckCircle2 size={32} className="text-emerald-500" /></div>
        <h2 className="mb-1 text-center text-lg font-bold text-slate-800">You've joined {joined.clinicName}</h2>
        <p className="mb-5 text-center text-xs text-slate-500">
          Your role: {INVITE_ROLE_LABEL[joined.role] ?? joined.role}.
        </p>
        <button onClick={onDone} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
          Open Dr-Crown
        </button>
      </Shell>
    );
  }

  const dead =
    !peek
      ? "This invitation link is not valid — ask the clinic to send a new one."
      : peek.status === "revoked"
        ? "This invitation was withdrawn by the clinic."
        : peek.status === "expired"
          ? "This invitation has expired — ask the clinic to send a new one."
          : peek.status === "accepted"
            ? "This invitation has already been used."
            : "";

  return (
    <Shell>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-slate-800">
        <Users size={18} className="text-blue-600" /> Clinic invitation
      </h2>
      {dead ? (
        <>
          <p className="mb-5 mt-2 text-sm text-slate-600">{dead}</p>
          <button onClick={onDone} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
            Continue to Dr-Crown
          </button>
        </>
      ) : (
        <>
          <p className="mb-4 mt-1 text-sm text-slate-600">
            You've been invited to join <b>{peek.clinicName}</b> as{" "}
            <b>{INVITE_ROLE_LABEL[peek.role] ?? peek.role}</b>.
          </p>
          {emailMismatch ? (
            <>
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
                This invitation was sent to <b>{peek.email}</b>, but you're signed in as <b>{session.user.email}</b>.
                Sign out and use the invited address.
              </div>
              <div className="flex gap-2">
                <button onClick={() => supabase.auth.signOut()} className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
                  Sign out
                </button>
                <button onClick={onDone} className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">
                  Not now
                </button>
              </div>
            </>
          ) : wrongAccountType ? (
            <>
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
                You're signed in with a {profile.role} account — clinic invitations need a dentist account.
                Sign out and create one with {peek.email}.
              </div>
              <div className="flex gap-2">
                <button onClick={() => supabase.auth.signOut()} className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
                  Sign out
                </button>
                <button onClick={onDone} className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">
                  Not now
                </button>
              </div>
            </>
          ) : (
            <>
              {error && <ErrorBanner message={error} />}
              {needsName && (
                <Field label="Your name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Dr. …"
                    className={inputCls}
                  />
                </Field>
              )}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={join}
                  disabled={busy || (needsName && !name.trim())}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Users size={15} />}
                  Join {peek.clinicName}
                </button>
                <button onClick={onDone} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">
                  Not now
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/*  Top-level gate                                                     */
/*                                                                     */
/*  Used to also gate on a Lab Station device-session heartbeat + OTP  */
/*  step-up (station-session Edge Function) — removed 2026-08-13 per   */
/*  explicit user request: the heartbeat was firing far more often     */
/*  than intended (see Auth.jsx git history / project memory) and, on  */
/*  cellular data where the IP legitimately rotates, that meant real   */
/*  lab technicians kept hitting real OTP-email step-ups as a matter   */
/*  of normal phone use — too much friction for what it protected      */
/*  (it was always an audit/step-up layer on top of RLS, never the     */
/*  actual security boundary). The `lab_device_sessions` table, the    */
/*  Settings → "Signed-in devices" viewer (DeviceManagement.jsx), and  */
/*  the Edge Function itself are untouched — only the client no longer */
/*  calls the heartbeat or blocks on its result.                       */
/* ------------------------------------------------------------------ */

export function AuthGate({ children }) {
  const auth = useAuth();
  // Clinic invite deep link: held in state so accepting (or declining)
  // dismisses the screen for the rest of the session.
  const [pendingClinicInvite, setPendingClinicInvite] = useState(clinicInviteToken);

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

  // Clinic invitation (Phase 57): runs BEFORE Onboarding on purpose —
  // invited staff join an existing clinic instead of creating one.
  if (pendingClinicInvite) {
    return (
      <ClinicInviteAccept
        session={auth.session}
        profile={auth.profile}
        onDone={() => {
          clearClinicInviteParam();
          setPendingClinicInvite("");
          auth.refreshProfile();
        }}
      />
    );
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

  return children(auth);
}
