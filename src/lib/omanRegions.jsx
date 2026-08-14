// Oman's 11 governorates (muhafazat) and their wilayats — standard, stable
// administrative divisions. Used for the Governorate → Wilayat dependent
// dropdowns on clinic/lab onboarding and settings. Country is always Oman
// (locked, not a free-text field) since this app only serves Oman-based
// clinics and labs.
export const OMAN_REGIONS = {
  "Muscat": ["Muscat", "Muttrah", "Bawshar", "A'Seeb", "Al Amerat", "Qurayyat"],
  "Dhofar": ["Salalah", "Taqah", "Mirbat", "Rakhyut", "Dhalkut", "Thumrait", "Muqshin", "Sadah", "Al Mazyona", "Shalim and the Hallaniyat Islands"],
  "Musandam": ["Khasab", "Bukha", "Daba Al-Bay'ah", "Madha"],
  "Al Buraimi": ["Al Buraimi", "Mahdah", "As-Sunaynah"],
  "Ad Dakhiliyah": ["Nizwa", "Bahla", "Manah", "Al Hamra", "Adam", "Izki", "Samail", "Bidbid"],
  "Al Batinah North": ["Sohar", "Shinas", "Liwa", "Saham", "Al Khaburah", "Suwaiq"],
  "Al Batinah South": ["Rustaq", "Al Awabi", "Nakhal", "Wadi Al Ma'awil", "Barka", "Al Musanaah"],
  "Ash Sharqiyah North": ["Ibra", "Al Qabil", "Bidiyah", "Wadi Bani Khalid", "Mudhaibi", "Dema Wa Al Taeen"],
  "Ash Sharqiyah South": ["Sur", "Al Kamil Wal Wafi", "Jalan Bani Bu Ali", "Jalan Bani Bu Hassan", "Masirah"],
  "Ad Dhahirah": ["Ibri", "Yanqul", "Dhank"],
  "Al Wusta": ["Haima", "Mahout", "Duqm", "Al Jazir"],
};

export const OMAN_GOVERNORATES = Object.keys(OMAN_REGIONS);

/**
 * Governorate + Wilayat dependent-dropdown pair, with Country locked to
 * Oman. Reused by clinic and lab onboarding/settings forms. `value` is
 * `{ governorate, wilayat }`; `onChange` receives a partial patch — when
 * the governorate changes, the caller should clear wilayat itself (this
 * component doesn't assume how the parent stores state).
 */
import React from "react";

export function OmanLocationFields({ value, onChange, inputCls, required }) {
  const wilayats = OMAN_REGIONS[value.governorate] ?? [];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Country</span>
        <input value="Oman" disabled readOnly className={`${inputCls} cursor-not-allowed text-slate-400`} />
      </label>
      <label className="block">
        <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
          Governorate {required && <span className="text-rose-500">*</span>}
        </span>
        <select
          required={required}
          value={value.governorate}
          onChange={(e) => onChange({ governorate: e.target.value, wilayat: "" })}
          className={inputCls}
        >
          <option value="">Select governorate…</option>
          {OMAN_GOVERNORATES.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
          Wilayat {required && <span className="text-rose-500">*</span>}
        </span>
        <select
          required={required}
          disabled={!value.governorate}
          value={value.wilayat}
          onChange={(e) => onChange({ wilayat: e.target.value })}
          className={inputCls}
        >
          <option value="">{value.governorate ? "Select wilayat…" : "Pick a governorate first"}</option>
          {wilayats.map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
