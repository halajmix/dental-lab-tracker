import test from 'node:test';
import assert from 'node:assert/strict';
import { sortCasesBySubmission } from '../src/lib/caseSubmissionOrder.js';

test('submission order uses original submission dates, preserves input, and leaves missing dates last', () => {
  const cases = [
    { id: 'missing' },
    { id: 'middle', history: [{ at: '2026-10-10T12:00:00Z' }] },
    { id: 'latest', createdAt: '2026-10-11T12:00:00Z', history: [{ at: '2020-01-01' }] },
    { id: 'earliest', createdDate: '2026-10-09' },
    { id: 'invalid', createdAt: 'not a date' },
  ];
  assert.deepEqual(sortCasesBySubmission(cases).map(c => c.id), ['latest', 'middle', 'earliest', 'missing', 'invalid']);
  assert.deepEqual(sortCasesBySubmission(cases, 'oldest').map(c => c.id), ['earliest', 'middle', 'latest', 'missing', 'invalid']);
  assert.equal(cases[0].id, 'missing');
});
