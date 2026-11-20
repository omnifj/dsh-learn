import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY_MS, createReviewItem, dueItems, reviewOnce } from '../src/core/sm2.js';

const T0 = 1_700_000_000_000;

// Plan Appendix A test vectors.
test('SM-2 vector: initial item (EF=2.5, rep=0), quality=4 -> interval=1, EF=2.5', () => {
  const item = createReviewItem('node-a', 'rm-1', T0);
  assert.equal(item.easiness, 2.5);
  assert.equal(item.repetitions, 0);
  const next = reviewOnce(item, 4, T0);
  assert.equal(next.interval, 1);
  assert.equal(next.easiness, 2.5);
  assert.equal(next.repetitions, 1);
  assert.equal(next.nextReviewAt, T0 + DAY_MS);
});

test('SM-2 vector: second quality=4 -> interval=6, EF=2.5', () => {
  let item = createReviewItem('node-a', 'rm-1', T0);
  item = reviewOnce(item, 4, T0);
  item = reviewOnce(item, 4, T0 + DAY_MS);
  assert.equal(item.interval, 6);
  assert.equal(item.easiness, 2.5);
  assert.equal(item.repetitions, 2);
});

test('SM-2 vector: third quality=5 -> interval=round(6*2.6)=16, EF=2.6', () => {
  let item = createReviewItem('node-a', 'rm-1', T0);
  item = reviewOnce(item, 4, T0);
  item = reviewOnce(item, 4, T0 + DAY_MS);
  item = reviewOnce(item, 5, T0 + 7 * DAY_MS);
  assert.equal(item.interval, 16);
  assert.equal(item.easiness, 2.6);
  assert.equal(item.repetitions, 3);
});

test('SM-2 vector: quality=2 -> interval=1, repetitions=0, EF drops per formula', () => {
  let item = createReviewItem('node-a', 'rm-1', T0);
  item = reviewOnce(item, 4, T0);
  item = reviewOnce(item, 4, T0 + DAY_MS);
  item = reviewOnce(item, 5, T0 + 7 * DAY_MS); // EF=2.6, rep=3
  item = reviewOnce(item, 2, T0 + 23 * DAY_MS);
  assert.equal(item.interval, 1);
  assert.equal(item.repetitions, 0);
  // EF = 2.6 + 0.1 - 3*(0.08 + 3*0.02) = 2.28
  assert.ok(Math.abs(item.easiness - 2.28) < 1e-9, `EF ${item.easiness}`);
});

test('SM-2: easiness floor 1.3 holds under repeated low quality', () => {
  let item = createReviewItem('node-a', 'rm-1', T0);
  for (let i = 0; i < 30; i += 1) item = reviewOnce(item, 0, T0 + i * DAY_MS);
  assert.equal(item.easiness, 1.3);
  assert.equal(item.interval, 1);
  assert.equal(item.repetitions, 0);
});

test('SM-2: quality 3 resets interval to 1 but keeps counting', () => {
  let item = createReviewItem('node-a', 'rm-1', T0);
  item = reviewOnce(item, 3, T0);
  assert.equal(item.interval, 1);
  assert.equal(item.repetitions, 1);
  item = reviewOnce(item, 3, T0 + DAY_MS);
  assert.equal(item.interval, 6);
  assert.equal(item.repetitions, 2);
});

test('SM-2: rejects out-of-range quality', () => {
  const item = createReviewItem('node-a', 'rm-1', T0);
  assert.throws(() => reviewOnce(item, 6, T0), /quality/);
  assert.throws(() => reviewOnce(item, 2.5, T0), /quality/);
});

test('SM-2: input item is not mutated', () => {
  const item = createReviewItem('node-a', 'rm-1', T0);
  const snapshot = structuredClone(item);
  reviewOnce(item, 5, T0);
  assert.deepEqual(item, snapshot);
});

test('dueItems: filters and sorts by nextReviewAt', () => {
  const items = [
    { nodeId: 'b', nextReviewAt: T0 + 100 },
    { nodeId: 'a', nextReviewAt: T0 - 1 },
    { nodeId: 'c', nextReviewAt: T0 },
  ];
  assert.deepEqual(dueItems(items, T0).map((i) => i.nodeId), ['a', 'c']);
});
