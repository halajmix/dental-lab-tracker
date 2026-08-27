import React, { useEffect, useState } from "react";
import { X, Users, Mail, Loader2, Trash2, Crown, Send, Ban } from "lucide-react";
import {
  fetchClinicTeam,
  createClinicInvitation,
  revokeClinicInvitation,
  updateClinicMemberRole,
  removeClinicMember,
  logActivity,
} from "./lib/data.js";

const ROLE_LABEL = { admin: "Admin", receptionist: "Receptionist", doctor: "Doctor" };
const ROLE_BADGE = {
  admin: "bg-blue-50 text-blue-700 ring-blue-200",
  receptionist: "bg-amber-50 text-amber-700 ring-amber-200",
  doctor: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

/**
 * Clinic team management (Phase 57): roster + role management + email
 * invitations. Admins manage everything; receptionists can view the
 * roster and invite doctors/receptionists (never admins — mirrors the
 * clinic_invitations RLS, which enforces all of this server-side anyway).
 */
export default function ClinicTeamPanel({ clinic, myRole, currentUserId, onClose }) {
  const isAdmin = myRole === "admin";
  const [team, setTeam] = useState(null); // {members, invitations} | null while loading
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("doctor");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null); // member object | null

  const load = async () => {
    setError("");
    try {
      setTeam(await fetchClinicTeam(clinic.id));
    } catch (err) {
      setError("Couldn't load the team — " + err.message);
      setTeam({ members: [], invitations: [] });
    }
  };
  useEffect(() => {
    setTeam(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic.id]);

  const invite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim() || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await createClinicInvitation(clinic.id, currentUserId, { email: inviteEmail, role: inviteRole });
      logActivity("invited clinic member", `${inviteEmail} as ${inviteRole} — ${clinic.name}`);
      setNotice(`Invitation emailed to ${inviteEmail.trim()} — it expires in 7 days.`);
      setInviteEmail("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (inv) => {
    setError("");
    setNotice("");
    try {
      await revokeClinicInvitation(inv.id);
      logActivity("revoked clinic invitation", `${inv.email} — ${clinic.name}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const changeRole = async (m, role) => {
    setError("");
    setNotice("");
    try {
      await updateClinicMemberRole(m.id, role);
      logActivity("changed clinic member role", `${m.email || m.name} → ${role} — ${clinic.name}`);
      await load();
    } catch (err) {
      setError(err.message);
      await load(); // snap the select back to reality
    }
  };

  const remove = async (m) => {
    setConfirmRemove(null);
    setError("");
    setNotice("");
    try {
      await removeClinicMember(clinic.id, m.userId);
      logActivity("removed clinic member", `${m.email || m.name} — ${clinic.name}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-800">
            <Users size={16} className="shrink-0 text-blue-600" />
            <span className="truncate">Team — {clinic.name}</span>
          </h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}
          {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{notice}</p>}

          {/* ------------ roster ------------ */}
          {team === null ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : (
            <div>
              <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Members ({team.members.length})
              </h4>
              <div className="space-y-2">
                {team.members.map((m) => {
                  const isOwner = m.userId === clinic.ownerId;
                  const isSelf = m.userId === currentUserId;
                  return (
                    <div key={m.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-800">
                          {m.name || m.email || "Member"}
                          {isOwner && <Crown size={12} className="shrink-0 text-amber-500" title="Clinic owner" />}
                          {isSelf && <span className="text-[10px] font-medium text-slate-400">(you)</span>}
                        </p>
                        {m.email && <p className="truncate text-xs text-slate-500">{m.email}</p>}
                      </div>
                      {isAdmin && !isOwner && !isSelf ? (
                        <>
                          <select
                            value={m.role}
                            onChange={(e) => changeRole(m, e.target.value)}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"
                          >
                            <option value="admin">Admin</option>
                            <option value="receptionist">Receptionist</option>
                            <option value="doctor">Doctor</option>
                          </select>
                          <button
                            onClick={() => setConfirmRemove(m)}
                            title="Remove from clinic"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      ) : (
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${ROLE_BADGE[m.role] ?? ROLE_BADGE.doctor}`}>
                          {ROLE_LABEL[m.role] ?? m.role}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ------------ invite ------------ */}
          <div className="border-t border-slate-100 pt-4">
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Invite someone</h4>
            <form onSubmit={invite} className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1">
                <Mail size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm"
                />
              </div>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-semibold text-slate-700"
              >
                <option value="doctor">Doctor</option>
                <option value="receptionist">Receptionist</option>
                {/* Receptionists never mint admins — clinic_invitations RLS enforces it */}
                {isAdmin && <option value="admin">Admin</option>}
              </select>
              <button
                type="submit"
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Invite
              </button>
            </form>
            <p className="mt-1.5 text-[11px] text-slate-400">
              They'll get an email link — new users create an account, existing dentist accounts just join.
            </p>
          </div>

          {/* ------------ pending invitations ------------ */}
          {team && team.invitations.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Invitations</h4>
              <div className="space-y-2">
                {team.invitations.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-700">{inv.email}</p>
                      <p className="text-[11px] text-slate-400">
                        {ROLE_LABEL[inv.role] ?? inv.role}
                        {inv.status === "pending" &&
                          ` · expires ${new Date(inv.expiresAt).toLocaleDateString("en-GB")}`}
                      </p>
                    </div>
                    {inv.status === "pending" ? (
                      <button
                        onClick={() => revoke(inv)}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-500 hover:border-rose-300 hover:text-rose-600"
                      >
                        <Ban size={11} /> Revoke
                      </button>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold capitalize text-slate-500">
                        {inv.status}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ------------ remove confirmation ------------ */}
        {confirmRemove && (
          <div className="border-t border-rose-100 bg-rose-50/60 px-5 py-3">
            <p className="text-xs font-semibold text-rose-700">
              Remove {confirmRemove.name || confirmRemove.email} from {clinic.name}? They lose access to the
              clinic's cases immediately.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => remove(confirmRemove)}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700"
              >
                Remove
              </button>
              <button
                onClick={() => setConfirmRemove(null)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
