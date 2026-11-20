import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAnalysis } from '../src/analysis.js';
import { LearnerRegistry } from '../src/store/learner-registry.js';

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);

test('buildAnalysis: quality metrics from attempts and review history', () => {
  const roadmaps = [{
    id: 'rm-1',
    topic: 'T',
    state: 'TEACHING',
    createdAt: NOW - 1000,
    updatedAt: NOW,
    nodes: [
      { id: 'a', title: 'a', status: 'mastered', mastery: { accuracy: 90, depth: 80, transfer: 85, discrimination: 88, total: 86, assessedAt: NOW }, checkpoint: { attempts: [{ at: NOW }, { at: NOW }, { at: NOW }] } },
      { id: 'b', title: 'b', status: 'active', checkpoint: { attempts: [{ at: NOW }] } },
    ],
  }];
  const reviewItems = [
    { nodeId: 'a', nextReviewAt: NOW + 1, history: [{ at: NOW, quality: 4 }, { at: NOW, quality: 2 }, { at: NOW, quality: 5 }] },
    { nodeId: 'x', nextReviewAt: NOW + 1 }, // no history yet
  ];
  const result = buildAnalysis({ roadmaps, reviewItems, learners: [{ learnerId: 'default' }], now: NOW });
  assert.equal(result.quality.avgAttemptsPerNode, 2); // (3+1)/2
  assert.equal(result.quality.reviewedCount, 3);
  assert.equal(result.quality.reviewPassRate, 67); // 2/3
  assert.deepEqual(result.learners, [{ learnerId: 'default' }]);
  // dag attached per plan
  assert.deepEqual(result.plans[0].dag.positions.a, { x: 0, y: 0 });
  assert.equal(result.plans[0].nodes[0].mastery.accuracy, 90);
  assert.equal(result.plans[0].nodes[0].attempts, 3);
});

test('LearnerRegistry.aggregate merges fallback root and seen workspace roots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-learn-agg-'));
  try {
    const fallback = join(dir, 'fallback');
    const workspace = join(dir, 'ws');
    const registry = new LearnerRegistry({ fallbackRoot: fallback });

    // learner "default" in the fallback root
    const a = await registry.stores(null, undefined);
    await a.progressStore.createRoadmap({ topic: '全局课程', nodes: [{ id: 'n-a', title: 'A', description: 'a' }] });
    // learner "bob" in a workspace root (exec carries no agent → cwd root via workingDirectory stub)
    const registryWs = registry; // same registry sees both roots
    const fakeWorkingDirectory = { ensure: async () => workspace };
    registry.workingDirectory = fakeWorkingDirectory;
    const b = await registryWs.stores({ agent: { id: 's1' } }, 'bob');
    await b.progressStore.createRoadmap({ topic: '工作区课程', nodes: [{ id: 'n-b', title: 'B', description: 'b' }] });

    const merged = await registry.aggregate(null);
    assert.deepEqual(merged.learners.map((l) => l.learnerId).sort(), ['bob', 'default']);
    assert.deepEqual(merged.roadmaps.map((r) => r.topic).sort(), ['全局课程', '工作区课程']);
    assert.ok(merged.roots.length === 2);

    // findLearnerDir across roots
    const found = await registry.findLearnerDir(null, 'bob');
    assert.ok(found.dir.includes('learn-bob'));
    const missing = await registry.findLearnerDir(null, 'nobody');
    assert.equal(missing, null);

    // bundleFromDir round-trips through export format
    const bundle = await registry.bundleFromDir(found.dir, 'bob');
    assert.equal(bundle.format, 'dsh-learn/bundle');
    assert.ok(bundle.files.some((f) => f.path.startsWith('roadmaps/')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
