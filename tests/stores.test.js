import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ProfileStore, emptyProfile } from '../src/store/profile-store.js';
import { ReviewQueue } from '../src/store/review-queue.js';

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-learn-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('ProfileStore: empty profile before first write', () =>
  withTempDir(async (dir) => {
    const store = new ProfileStore(dir);
    const profile = await store.get();
    assert.equal(profile.id, 'default');
    assert.deepEqual(profile.strengths, []);
    assert.deepEqual(profile.errorPatterns, {});
  }));

test('ProfileStore.update: merge semantics', () =>
  withTempDir(async (dir) => {
    const store = new ProfileStore(dir);
    await store.update({
      background: '前端 3 年',
      strengths: ['css'],
      errorPatterns: { 'concept-confusion': 1 },
      preferences: { style: 'example-first' },
    });
    const merged = await store.update({
      strengths: ['react'],
      errorPatterns: { 'concept-confusion': 2, 'transfer-failure': 1 },
      preferences: { pace: 'slow' },
      courseHistory: [{ topic: 'JS 基础', masteredNodes: ['a'], finishedAt: 1 }],
    });
    assert.equal(merged.background, '前端 3 年');
    assert.deepEqual(merged.strengths, ['css', 'react']); // union
    assert.equal(merged.errorPatterns['concept-confusion'], 3); // added
    assert.equal(merged.errorPatterns['transfer-failure'], 1);
    assert.deepEqual(merged.preferences, { style: 'example-first', pace: 'slow' });
    assert.equal(merged.courseHistory.length, 1);

    const replaced = await store.update({ strengths: ['only'], strengthsMode: 'replace' });
    assert.deepEqual(replaced.strengths, ['only']);
  }));

test('ProfileStore.update: rejects unknown error causes', () =>
  withTempDir(async (dir) => {
    const store = new ProfileStore(dir);
    await assert.rejects(() => store.update({ errorPatterns: { typo: 1 } }), /unknown error cause/);
  }));

test('ProfileStore.recordErrorCause increments', () =>
  withTempDir(async (dir) => {
    const store = new ProfileStore(dir);
    await store.recordErrorCause('surface-memory');
    await store.recordErrorCause('surface-memory');
    const profile = await store.get();
    assert.equal(profile.errorPatterns['surface-memory'], 2);
    await assert.rejects(() => store.recordErrorCause('nope'), /unknown error cause/);
  }));

test('emptyProfile shape matches plan §4.1', () => {
  const profile = emptyProfile();
  for (const key of ['id', 'background', 'strengths', 'errorPatterns', 'preferences', 'courseHistory', 'updatedAt']) {
    assert.ok(key in profile, `missing ${key}`);
  }
});

test('ReviewQueue: ensure is idempotent, update applies SM-2, due filters', () =>
  withTempDir(async (dir) => {
    const queue = new ReviewQueue(dir);
    const t0 = Date.now();
    const first = await queue.ensure('node-a', 'rm-1', t0);
    const again = await queue.ensure('node-a', 'rm-1', t0);
    assert.equal(first.easiness, 2.5);
    assert.equal((await queue.list()).length, 1);
    assert.equal(again.repetitions, 0);

    // fresh item (nextReviewAt = now) is immediately due
    assert.equal((await queue.due(t0)).length, 1);

    const updated = await queue.update('node-a', 4, { roadmapId: 'rm-1', now: t0 });
    assert.equal(updated.interval, 1);
    assert.equal(updated.repetitions, 1);
    assert.equal((await queue.due(t0)).length, 0); // no longer due

    await assert.rejects(() => queue.update('node-missing', 4), /no review item/);
    await assert.rejects(() => queue.update('node-a', 9), /quality/);
  }));
