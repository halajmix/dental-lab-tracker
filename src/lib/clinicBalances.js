// Read-only rollup. Never guesses that an old bill is covered by an opening
// balance, and never applies an unallocated receipt to a bill automatically.
const mills = n => Math.round((Number(n) || 0) * 1000);
const normalize = name => String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export function coveredByOpeningBalance(statement, asOf) {
  // The confirmed snapshot covers all paper work through a month end.
  return !!asOf && !statement.clinicId && statement.kind !== 'opening_balance' && !!statement.month && statement.month.slice(0,7) <= asOf.slice(0,7);
}
export function clinicBalances(statements, payments, clinicsById = {}, paperBalanceAsOf = null) {
  const namedIds = new Map();
  const addName = (name, id) => {
    const key = normalize(name); if (!key || !id) return;
    if (!namedIds.has(key)) namedIds.set(key, new Set());
    namedIds.get(key).add(id);
  };
  for (const c of Object.values(clinicsById)) addName(c.name, c.id);
  for (const s of statements) addName(clinicsById[s.clinicId]?.name || s.clinicName, s.clinicId);
  const accounts = new Map();
  const accountFor = row => {
    const name = clinicsById[row.clinicId]?.name || row.clinicName || 'Unidentified clinic';
    const normalized = normalize(name), matches = namedIds.get(normalized);
    const id = row.clinicId || (matches?.size === 1 ? [...matches][0] : null);
    const key = id ? `id:${id}` : `name:${normalized}`;
    if (!accounts.has(key)) accounts.set(key, {key, name, opening:0, excel:0, platform:0, paid:0, remaining:0, unallocated:0, statementIds:[], needsReview:false, ambiguous:!id && matches?.size > 1});
    return accounts.get(key);
  };
  const paid = new Map();
  for (const p of payments) if (!p.voidedAt && !p.voided_at && p.statementId) paid.set(p.statementId, (paid.get(p.statementId)||0)+mills(p.amount));
  for (const s of statements) {
    if (coveredByOpeningBalance(s, paperBalanceAsOf)) continue;
    const account=accountFor(s);
    account.statementIds.push(s.id);
    if (s.status === 'paid') continue;
    const total=mills(s.total), received=paid.get(s.id)||0, remaining=Math.max(0,total-received);
    if (!remaining) continue;
    const source=s.kind==='opening_balance'?'opening':!s.clinicId?'excel':'platform';
    account[source]+=total;
    account.paid+=Math.min(total,received);
    account.remaining+=remaining;
    if (source==='opening' && !paperBalanceAsOf) account.needsReview=true;
  }
  for (const p of payments) if (!p.voidedAt && !p.voided_at && !p.statementId) accountFor(p).unallocated+=mills(p.amount);
  return [...accounts.values()].filter(a=>a.remaining || a.unallocated).map(a=>({...a,...Object.fromEntries(['opening','excel','platform','paid','remaining','unallocated'].map(k=>[k,a[k]/1000]))})).sort((a,b)=>b.remaining-a.remaining || a.name.localeCompare(b.name));
}
