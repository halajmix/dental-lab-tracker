// Keep the same date precedence as the table's Sent to Lab column.
export function sortCasesBySubmission(cases, order = 'newest') {
  const timestamp = (c) => Date.parse(c.createdAt ?? c.history?.[0]?.at ?? c.createdDate);
  return [...cases].sort((a, b) => {
    const left = timestamp(a);
    const right = timestamp(b);
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
    if (!Number.isFinite(right)) return -1;
    return order === 'oldest' ? left - right : right - left;
  });
}
