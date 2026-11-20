import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LearnerRegistry } from '../src/store/learner-registry.js';
import { createLearnTools } from '../src/tools/learn-tools.js';

async function withTools(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-learn-e2e-'));
  try {
    const registry = new LearnerRegistry({ fallbackRoot: dir, masteryThreshold: 80 });
    const tools = new Map(
      createLearnTools({ registry, masteryThreshold: 80 }).map((t) => [t.name, t]),
    );
    const call = (name, args = {}) => tools.get(name).execute(args, {});
    await fn({ call, tools, registry, dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const NODES = [
  { id: 'hooks-basics', title: 'Hooks 基础', description: 'useState/useEffect 的心智模型' },
  { id: 'hooks-deps', title: '依赖数组', description: 'effect 依赖与陈旧闭包', prerequisites: ['hooks-basics'] },
  { id: 'hooks-custom', title: '自定义 Hook', description: '逻辑抽取与复用', prerequisites: ['hooks-deps'] },
];

test('M0: ai_learn_profile_get returns an empty profile on a fresh install', () =>
  withTools(async ({ call, dir }) => {
    const profile = await call('ai_learn_profile_get');
    assert.equal(profile.id, 'default');
    assert.equal(profile.learnerId, 'default');
    assert.deepEqual(profile.courseHistory, []);
    // data is persisted per learner under learn-<id>/ inside the root
    assert.ok(profile.dir.startsWith(join(dir, 'learn-default')));
  }));

test('workspace layout: each learner gets a learn-<id> folder with multiple JSON files', () =>
  withTools(async ({ call, dir }) => {
    await call('ai_learn_create_roadmap', {
      topic: 't',
      nodes: NODES,
      learnerId: 'Alice',
      estimates: [{ nodeId: 'hooks-basics', estimatedMastery: 90, evidence: '已会' }],
    });
    await call('ai_learn_profile_update', { learnerId: 'Alice', background: '前端 3 年' });
    const base = join(dir, 'learn-alice');
    for (const file of ['profile.json', 'review-queue.json']) {
      assert.ok((await stat(join(base, file))).isFile(), `missing ${file}`);
    }
    assert.ok((await stat(join(base, 'roadmaps'))).isDirectory());

    // learners are isolated from each other
    const list = await call('ai_learn_learners');
    assert.equal(list.learners.length, 1);
    assert.equal(list.learners[0].learnerId, 'alice');
    assert.equal(list.learners[0].roadmaps, 1);
    const other = await call('ai_learn_profile_get', { learnerId: 'bob' });
    assert.equal(other.background, '');
  }));

test('M1: full teaching loop — diagnose -> roadmap -> checkpoint -> mastery gate -> unlock', () =>
  withTools(async ({ call }) => {
    // 1. diagnosis: learner already knows the basics
    const { diagnosis } = await call('ai_learn_diagnose', {
      topic: 'React Hooks',
      questions: [
        { question: '组件重新渲染时 useState 的值从哪来？', answer: '感觉像是 React 帮我把状态挂在组件实例外面了' },
        { question: 'effect 的依赖数组是干什么的？', answer: '不太清楚，好像不写就会一直执行' },
      ],
      estimates: [
        { concept: 'Hooks 基础', estimatedMastery: 85, evidence: '“React 帮我把状态挂在组件实例外面了”说明已理解状态存于 fiber' },
        { concept: '依赖数组', estimatedMastery: 30, evidence: '“不太清楚”' },
      ],
      suggestedStartNodeId: 'hooks-deps',
    });
    assert.ok(diagnosis.id);

    // 2. roadmap: basics skipped via diagnosis, deps becomes the active start
    const roadmap = await call('ai_learn_create_roadmap', {
      topic: 'React Hooks',
      nodes: NODES,
      estimates: diagnosis.estimates,
    });
    assert.equal(roadmap.state, 'ROADMAP_READY');
    assert.equal(roadmap.nodes[0].status, 'mastered');
    assert.equal(roadmap.nodes[0].skippedByDiagnosis, true);
    assert.equal(roadmap.nodes[1].status, 'active');
    assert.equal(roadmap.currentNodeId, 'hooks-deps');
    assert.equal(roadmap.nodes[2].status, 'locked');

    // 3. checkpoint questions for the active node
    const { questions } = await call('ai_learn_checkpoint', {
      roadmapId: roadmap.id,
      nodeId: 'hooks-deps',
      questions: [
        { kind: 'understanding', text: '依赖数组为空时 effect 什么时候执行？' },
        { kind: 'transfer', text: '下面这段代码为什么拿到的 count 一直是 0？' },
      ],
    });
    assert.equal(questions.length, 2);
    assert.ok(questions[0].id);

    // 4. first answer fails -> error cause recorded in the profile
    const fail1 = await call('ai_learn_submit_answer', {
      roadmapId: roadmap.id,
      nodeId: 'hooks-deps',
      questionId: questions[0].id,
      answer: '每次渲染都执行',
      passed: false,
      cause: 'surface-memory',
      feedback: '顺着你的说法：那传 [] 和不传数组还有什么区别？',
    });
    assert.equal(fail1.remediate, false);
    assert.equal(fail1.consecutiveFails, 1);
    const profile = await call('ai_learn_profile_get');
    assert.equal(profile.errorPatterns['surface-memory'], 1);

    // second consecutive failure -> remediate
    const fail2 = await call('ai_learn_submit_answer', {
      roadmapId: roadmap.id,
      nodeId: 'hooks-deps',
      questionId: questions[1].id,
      answer: '因为没写依赖所以不更新',
      passed: false,
      cause: 'concept-confusion',
      feedback: '注意区分“effect 没重新跑”和“state 没更新”',
    });
    assert.equal(fail2.remediate, true);

    // re-taught, then passes
    const pass = await call('ai_learn_submit_answer', {
      roadmapId: roadmap.id,
      nodeId: 'hooks-deps',
      questionId: questions[0].id,
      answer: '空数组表示只在挂载后执行一次，因为依赖从未变化',
      passed: true,
    });
    assert.equal(pass.passed, true);

    // 5. mastery below 60 -> remediate, no unlock
    const low = await call('ai_learn_assess_mastery', {
      roadmapId: roadmap.id,
      nodeId: 'hooks-deps',
      scores: { accuracy: 55, depth: 40, transfer: 30, discrimination: 50 },
      rationale: '学习者说“不太清楚依赖什么时候该加”，迁移题未答出',
    });
    assert.equal(low.action, 'remediate');
    assert.equal(low.nextNodeId, 'hooks-deps');

    // 6. mastery >= 80 -> unlock next node, review item scheduled
    const high = await call('ai_learn_assess_mastery', {
      roadmapId: roadmap.id,
      nodeId: 'hooks-deps',
      scores: { accuracy: 90, depth: 85, transfer: 80, discrimination: 88 },
      rationale: '学习者解释“依赖从未变化所以只跑一次”，并举出轮询场景的新例子',
    });
    assert.equal(high.action, 'unlock');
    assert.equal(high.nextNodeId, 'hooks-custom');
    assert.equal(high.courseCompleted, false);

    // 7. notes require learner quotes
    await assert.rejects(
      () => call('ai_learn_gen_notes', { roadmapId: roadmap.id, nodeId: 'hooks-deps', content: 'x', learnerQuotes: [] }),
      /learnerQuotes/,
    );
    const { notePath } = await call('ai_learn_gen_notes', {
      roadmapId: roadmap.id,
      nodeId: 'hooks-deps',
      content: '## 关键推理\n依赖数组决定 effect 何时重跑……',
      learnerQuotes: ['空数组表示只在挂载后执行一次，因为依赖从未变化'],
    });
    const note = await readFile(notePath, 'utf8');
    assert.match(note, /学习者自己的表述/);
    assert.match(note, /空数组表示只在挂载后执行一次/);

    // 8. finish the last node -> course completed, history recorded
    const done = await call('ai_learn_assess_mastery', {
      roadmapId: roadmap.id,
      nodeId: 'hooks-custom',
      scores: { accuracy: 92, depth: 90, transfer: 85, discrimination: 90 },
      rationale: '学习者现场把 useLocalStorage 抽成了自定义 Hook 并讲清了封装边界',
    });
    assert.equal(done.courseCompleted, true);
    const after = await call('ai_learn_profile_get');
    assert.equal(after.courseHistory.length, 1);
    assert.equal(after.courseHistory[0].topic, 'React Hooks');

    // 9. review queue: mastered nodes scheduled; a failed review downgrades the node
    const due = await call('ai_learn_review_due', {});
    assert.equal(due.count, 3); // basics (diagnosis) + deps + custom
    const reviewed = await call('ai_learn_review_update', { nodeId: 'hooks-deps', roadmapId: roadmap.id, quality: 2 });
    assert.equal(reviewed.relearn, true);
    assert.equal(reviewed.item.repetitions, 0);
    const roadmapAfter = await call('ai_learn_update_roadmap', {
      roadmapId: roadmap.id,
      op: 'insertNode',
      payload: {
        node: { id: 'hooks-deps-refresher', title: '依赖数组回炉', description: '针对遗忘点重学', prerequisites: ['hooks-basics'] },
      },
    });
    const refreshed = roadmapAfter.nodes.find((n) => n.id === 'hooks-deps');
    assert.equal(refreshed.status, 'needs-relearn');
  }));

test('M1 acceptance: insertNode rejects dependency cycles', () =>
  withTools(async ({ call }) => {
    const roadmap = await call('ai_learn_create_roadmap', { topic: 't', nodes: NODES });
    await assert.rejects(
      () =>
        call('ai_learn_update_roadmap', {
          roadmapId: roadmap.id,
          op: 'insertNode',
          payload: { node: { id: 'hooks-basics', title: 'x', description: 'y', prerequisites: ['hooks-custom'] } },
        }),
      /duplicate|cycle/,
    );
    // valid insert lands right after the current node
    const updated = await call('ai_learn_update_roadmap', {
      roadmapId: roadmap.id,
      op: 'insertNode',
      payload: {
        node: { id: 'closure-recap', title: '闭包回顾', description: '补上暴露的前置盲区', prerequisites: [] },
      },
    });
    const ids = updated.nodes.map((n) => n.id);
    assert.ok(ids.indexOf('closure-recap') === ids.indexOf('hooks-basics') + 1);
  }));

test('M1 acceptance: skipNode advances to the next node', () =>
  withTools(async ({ call }) => {
    const roadmap = await call('ai_learn_create_roadmap', { topic: 't', nodes: NODES });
    const updated = await call('ai_learn_update_roadmap', {
      roadmapId: roadmap.id,
      op: 'skipNode',
      payload: { nodeId: 'hooks-basics' },
    });
    assert.equal(updated.nodes[0].status, 'mastered');
    assert.equal(updated.nodes[0].skippedByRequest, true);
    assert.equal(updated.currentNodeId, 'hooks-deps');
    assert.equal(updated.nodes[1].status, 'active');
  }));

test('M4 acceptance: mastery without rationale is rejected; diagnosis questions reject recitation flow', () =>
  withTools(async ({ call }) => {
    const roadmap = await call('ai_learn_create_roadmap', { topic: 't', nodes: NODES });
    await assert.rejects(
      () =>
        call('ai_learn_assess_mastery', {
          roadmapId: roadmap.id,
          nodeId: 'hooks-basics',
          scores: { accuracy: 90, depth: 90, transfer: 90, discrimination: 90 },
          rationale: '  ',
        }),
      /rationale/,
    );
    await assert.rejects(
      () =>
        call('ai_learn_assess_mastery', {
          roadmapId: roadmap.id,
          nodeId: 'hooks-basics',
          scores: { accuracy: 90, depth: 90, transfer: 90 },
          rationale: 'x',
        }),
      /discrimination/,
    );
    await assert.rejects(() => call('ai_learn_diagnose', { topic: 'x', questions: [], estimates: [] }), /questions/);
  }));

test('M5 acceptance: unknown cause rejected; passing answer needs none', () =>
  withTools(async ({ call }) => {
    const roadmap = await call('ai_learn_create_roadmap', { topic: 't', nodes: NODES });
    const { questions } = await call('ai_learn_checkpoint', {
      roadmapId: roadmap.id,
      nodeId: 'hooks-basics',
      questions: [{ text: '为什么 Hook 不能写在 if 里？' }],
    });
    await assert.rejects(
      () =>
        call('ai_learn_submit_answer', {
          roadmapId: roadmap.id,
          nodeId: 'hooks-basics',
          questionId: questions[0].id,
          answer: '不知道',
          passed: false,
        }),
      /cause is required/,
    );
    await assert.rejects(
      () =>
        call('ai_learn_submit_answer', {
          roadmapId: roadmap.id,
          nodeId: 'hooks-basics',
          questionId: 'no-such-q',
          answer: 'x',
          passed: true,
        }),
      /no question/,
    );
  }));

test('tool definitions carry model-facing schemas for all 14 tools', () =>
  withTools(async ({ tools }) => {
    assert.equal(tools.size, 14);
    for (const tool of tools.values()) {
      assert.ok(tool.name.startsWith('ai_learn_'));
      assert.ok(tool.description.length > 20);
      assert.equal(tool.parameters.type, 'object');
      assert.equal(typeof tool.output.render, 'function');
      const rendered = tool.output.render({}, { ok: true });
      assert.equal(rendered[0].type, 'text');
    }
  }));
