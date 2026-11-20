import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LearnerRegistry, slugLearnerId } from '../src/store/learner-registry.js';
import { createLearnTools } from '../src/tools/learn-tools.js';

async function withRegistry(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-learn-registry-'));
  try {
    const registry = new LearnerRegistry({ fallbackRoot: dir, masteryThreshold: 80 });
    const tools = new Map(createLearnTools({ registry, masteryThreshold: 80 }).map((t) => [t.name, t]));
    const call = (name, args = {}) => tools.get(name).execute(args, {});
    await fn({ registry, call, dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const NODES = [
  { id: 'a', title: 'A', description: 'first' },
  { id: 'b', title: 'B', description: 'second', prerequisites: ['a'] },
];

test('slugLearnerId normalizes and defaults', () => {
  assert.equal(slugLearnerId(undefined), 'default');
  assert.equal(slugLearnerId('  '), 'default');
  assert.equal(slugLearnerId('Alice'), 'alice');
  assert.equal(slugLearnerId('小明 01'), '小明-01');
});

test('root() prefers the session workspace from the workingDirectory service', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-learn-ws-'));
  try {
    const registry = new LearnerRegistry({
      fallbackRoot: join(dir, 'fallback'),
      workingDirectory: { ensure: async () => join(dir, 'workspace') },
    });
    const fakeExec = { agent: { session: {} }, signal: undefined };
    const { root, dir: learnerDir } = await registry.stores(fakeExec, 'x');
    assert.equal(root, join(dir, 'workspace', 'dsh-learn'));
    assert.equal(learnerDir, join(dir, 'workspace', 'dsh-learn', 'learn-x'));
    // without an agent on the execution, the fallback root is used
    const fallback = await registry.stores({}, 'x');
    assert.equal(fallback.root, join(dir, 'fallback'));
    // a failing workingDirectory service also falls back
    const broken = new LearnerRegistry({
      fallbackRoot: join(dir, 'fallback'),
      workingDirectory: { ensure: async () => { throw new Error('unavailable'); } },
    });
    assert.equal((await broken.stores(fakeExec, 'x')).root, join(dir, 'fallback'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('legacy flat layout migrates into learn-default on first access', () =>
  withRegistry(async ({ registry, dir }) => {
    await mkdir(join(dir, 'roadmaps'), { recursive: true });
    await writeFile(join(dir, 'profile.json'), '{"id":"default","background":"old"}\n', 'utf8');
    await writeFile(join(dir, 'roadmaps', 'r1.json'), '{"id":"r1","nodes":[],"updatedAt":1}\n', 'utf8');

    const { dir: learnerDir } = await registry.stores({}, undefined);
    assert.equal((await readFile(join(learnerDir, 'profile.json'), 'utf8')).includes('"old"'), true);
    assert.ok((await stat(join(learnerDir, 'roadmaps', 'r1.json'))).isFile());
    // root no longer holds the legacy files
    await assert.rejects(() => stat(join(dir, 'profile.json')));
  }));

test('export → import round-trips a learner across workspaces', () =>
  withRegistry(async ({ call, dir }) => {
    // build some learning state
    const roadmap = await call('ai_learn_create_roadmap', { topic: 'React Hooks', nodes: NODES, learnerId: 'ming' });
    await call('ai_learn_profile_update', { learnerId: 'ming', background: '前端 3 年' });
    await call('ai_learn_gen_notes', {
      learnerId: 'ming',
      roadmapId: roadmap.id,
      nodeId: 'a',
      content: '笔记正文',
      learnerQuotes: ['我自己的话'],
    });

    // export
    const exported = await call('ai_learn_export', { learnerId: 'ming' });
    assert.ok(exported.path.includes('exports'));
    assert.ok(exported.fileCount >= 3); // profile + review-queue + roadmap + note
    const bundle = JSON.parse(await readFile(exported.path, 'utf8'));
    assert.equal(bundle.format, 'dsh-learn/bundle');
    assert.equal(bundle.learnerId, 'ming');

    // import into the same workspace under a new id
    const imported = await call('ai_learn_import', { path: exported.path, learnerId: 'copy-of-ming' });
    assert.equal(imported.learnerId, 'copy-of-ming');
    const profile = await call('ai_learn_profile_get', { learnerId: 'copy-of-ming' });
    assert.equal(profile.background, '前端 3 年');
    const note = await readFile(join(dir, 'learn-copy-of-ming', 'notes', roadmap.id, 'a.md'), 'utf8');
    assert.match(note, /笔记正文/);

    // importing again without overwrite refuses
    await assert.rejects(
      () => call('ai_learn_import', { path: exported.path, learnerId: 'copy-of-ming' }),
      /overwrite=true/,
    );
    // overwrite merges over the existing folder
    const again = await call('ai_learn_import', { path: exported.path, learnerId: 'copy-of-ming', overwrite: true });
    assert.equal(again.overwritten, true);
  }));

test('export rejects an empty learner; import rejects bad bundles', () =>
  withRegistry(async ({ call, dir }) => {
    await assert.rejects(() => call('ai_learn_export', { learnerId: 'ghost' }), /no data to export/);

    const bad = join(dir, 'bad.json');
    await writeFile(bad, '{"format":"other"}\n', 'utf8');
    await assert.rejects(() => call('ai_learn_import', { path: bad }), /not a dsh-learn export bundle/);

    const evil = join(dir, 'evil.json');
    await writeFile(
      evil,
      JSON.stringify({
        format: 'dsh-learn/bundle',
        version: 1,
        learnerId: 'x',
        files: [{ path: '../../escape.json', data: '{}' }],
      }),
      'utf8',
    );
    await assert.rejects(() => call('ai_learn_import', { path: evil }), /escapes the learner directory/);
  }));
