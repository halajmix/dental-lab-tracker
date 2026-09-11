/* Remake pattern detection. Pure statistics; the model only phrases what
   crosses a threshold, and never sees individual cases or patients. */

export interface RemakeRecord { clinic_id: string; clinic_name: string; reason_class: "clinical" | "laboratory"; reason_code: string; created_at: string }
export interface ClinicVolume { clinic_id: string; cases_in_period: number }
export interface PatternThresholds { minSameCode: number; rateMultiplier: number; minCasesForRate: number }
export const DEFAULT_THRESHOLDS: PatternThresholds = { minSameCode: 3, rateMultiplier: 2, minCasesForRate: 10 };
export interface Pattern { clinic_name: string; reason_class: "clinical" | "laboratory"; reason_code: string; count: number; cases_in_period: number; lab_median_rate: number; trigger: "same_code" | "rate" }

const median = (xs: number[]): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function detectPatterns(remakes: RemakeRecord[], volumes: ClinicVolume[], t: PatternThresholds = DEFAULT_THRESHOLDS): Pattern[] {
  const vol = new Map(volumes.map((v) => [v.clinic_id, v.cases_in_period]));
  const byClinic = new Map<string, RemakeRecord[]>();
  for (const r of remakes) byClinic.set(r.clinic_id, [...(byClinic.get(r.clinic_id) ?? []), r]);
  const rates = [...byClinic.entries()].map(([id, rs]) => (vol.get(id) ?? 0) ? rs.length / (vol.get(id) as number) : 0);
  const labMedian = median(rates);
  const out: Pattern[] = [];
  for (const [id, rs] of byClinic) {
    const cases = vol.get(id) ?? 0;
    const name = rs[0].clinic_name;
    const byCode = new Map<string, RemakeRecord[]>();
    for (const r of rs) byCode.set(`${r.reason_class}|${r.reason_code}`, [...(byCode.get(`${r.reason_class}|${r.reason_code}`) ?? []), r]);
    for (const [key, group] of byCode) {
      const [cls, code] = key.split("|") as [Pattern["reason_class"], string];
      if (group.length >= t.minSameCode)
        out.push({ clinic_name: name, reason_class: cls, reason_code: code, count: group.length, cases_in_period: cases, lab_median_rate: +labMedian.toFixed(3), trigger: "same_code" });
    }
    if (cases >= t.minCasesForRate && labMedian > 0 && rs.length / cases >= t.rateMultiplier * labMedian) {
      const top = [...byCode.entries()].sort((a, b) => b[1].length - a[1].length)[0];
      const [cls, code] = top[0].split("|") as [Pattern["reason_class"], string];
      if (!out.some((p) => p.clinic_name === name && p.reason_code === code))
        out.push({ clinic_name: name, reason_class: cls, reason_code: code, count: rs.length, cases_in_period: cases, lab_median_rate: +labMedian.toFixed(3), trigger: "rate" });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

/** Neutral, count-only wording. No fault, no intent, no other party. */
export function observationText(p: Pattern, periodDays: number, lang: "en" | "ar"): string {
  const code = p.reason_code.replace(/_/g, " ");
  return lang === "ar"
    ? `ملاحظة: سُجِّلت ${p.count} حالات إعادة صنع بسبب «${code}» لعيادة ${p.clinic_name} خلال آخر ${periodDays} يومًا، من أصل ${p.cases_in_period} حالة. متوسط المختبر ${p.lab_median_rate}.`
    : `Observation: ${p.count} remakes coded "${code}" for ${p.clinic_name} in the last ${periodDays} days, across ${p.cases_in_period} cases. The lab's median remake rate is ${p.lab_median_rate}.`;
}
