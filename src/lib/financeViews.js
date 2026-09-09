// Date views never split or duplicate database rows or change money.
export function statementPeriod(statement, cutoff, cases = []) {
  if (!cutoff) return 'current';
  if (statement.kind === 'opening_balance') return 'opening';
  const dates = (statement.lineItems ?? []).map(l => l.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d ?? ''));
  for (const c of cases) {
    if (c.statementId === statement.id && c.createdAt) {
      dates.push(new Date(c.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' }));
    }
  }
  if (!dates.length) {
    // A monthly bill in the cutoff month cannot safely be assigned to a day.
    if (statement.month.slice(0, 7) === cutoff.slice(0, 7)) return 'mixed';
    return statement.month < cutoff ? 'history' : 'current';
  }
  const old = dates.some(d => d < cutoff), recent = dates.some(d => d >= cutoff);
  return old && recent ? 'mixed' : old ? 'history' : 'current';
}

export function statementInView(statement, view, cutoff, cases, paid = 0, includeSettled = false) {
  if (view === 'pending') return includeSettled || statement.status !== 'paid' && statement.total - paid > 0.0005;
  const period = statementPeriod(statement, cutoff, cases);
  if (view === 'history') return period === 'history' || period === 'mixed';
  return !cutoff || period === 'current' || period === 'mixed';
}

export function expenseInView(expense, view, cutoff) {
  if (!cutoff) return view !== 'history';
  return view === 'history' ? expense.expenseDate < cutoff : expense.expenseDate >= cutoff;
}
