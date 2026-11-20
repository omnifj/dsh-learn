import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnalysis } from '../src/analysis.js';
import { DAY_MS } from '../src/core/sm2.js';

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);

const roadmap = (id, topic, createdAt, nodes) => ({
  id,
  topic,
  state: 'TEACHING',
  createdAt,
  updatedAt: createdAt,
  nodes: nodes.map((n) => ({
    id: n.id,
    title: n.id,
    status: n.status,
    mastery: n.total != null ? { total: n.total, assessedAt: n.assessedAt } : undefined,
    checkpoint: n.attempts ? { attempts: n.attempts } : undefined,
  })),
});

test('buildAnalysis: one cumulative series per plan', () => {
  const rm = roadmap('rm-1', 'React Hooks', NOW - 10 * DAY_MS, [
    { id: 'a', status: 'mastered', total: 90, assessedAt: NOW - 8 * DAY_MS },
    { id: 'b', status: 'mastered', total: 85, assessedAt: NOW - 3 * DAY_MS },
    { id: 'c', status: 'active' },
  ]);
  const result = buildAnalysis({ roadmaps: [rm], reviewItems: [], now: NOW });
  assert.equal(result.plans.length, 1);
  assert.deepEqual(
    result.plans[0].series.map((p) => p.mastered),
    [0, 1, 2],
  );
  assert.equal(result.plans[0].series[0].t, rm.createdAt);
  assert.equal(result.plans[0].masteredCount, 2);
  assert.equal(result.plans[0].avgMastery, 88); // (90+85)/2 rounded
  assert.equal(result.totals.nodes, 3);
  assert.equal(result.totals.masteredNodes, 2);
});

test('buildAnalysis: heatmap buckets assessments, attempts, reviews, diagnoses by day', () => {
  const rm = roadmap('rm-1', 'T', NOW - 30 * DAY_MS, [
    { id: 'a', status: 'mastered', total: 90, assessedAt: NOW - DAY_MS },
    { id: 'b', status: 'active', attempts: [{ at: NOW - DAY_MS }, { at: NOW }] },
  ]);
  const result = buildAnalysis({
    roadmaps: [rm],
    reviewItems: [{ nodeId: 'a', nextReviewAt: NOW + DAY_MS, lastReviewAt: NOW }],
    diagnoses: [{ createdAt: NOW - 30 * DAY_MS }],
    now: NOW,
    days: 35,
  });
  assert.equal(result.heatmap.length, 35);
  const byDay = new Map(result.heatmap.map((d) => [Math.floor(d.day / DAY_MS), d.count]));
  const todayKey = result.heatmap[result.heatmap.length - 1].day / DAY_MS;
  assert.equal(byDay.get(todayKey), 2); // attempt + review today
  assert.equal(byDay.get(todayKey - 1), 2); // assessment + attempt yesterday
  assert.equal(byDay.get(todayKey - 30), 1); // diagnosis
  assert.equal(
    result.heatmap.reduce((s, d) => s + d.count, 0),
    5,
  );
});

test('buildAnalysis: due review count and empty state', () => {
  const result = buildAnalysis({
    roadmaps: [],
    reviewItems: [
      { nodeId: 'a', nextReviewAt: NOW - 1 },
      { nodeId: 'b', nextReviewAt: NOW + DAY_MS },
    ],
    now: NOW,
  });
  assert.deepEqual(result.plans, []);
  assert.equal(result.review.due, 1);
  assert.equal(result.review.total, 2);
  assert.ok(result.heatmap.every((d) => d.count === 0));
});

test('buildAnalysis: events outside the window are excluded', () => {
  const rm = roadmap('rm-1', 'T', NOW - 400 * DAY_MS, [
    { id: 'a', status: 'mastered', total: 90, assessedAt: NOW - 300 * DAY_MS },
  ]);
  const result = buildAnalysis({ roadmaps: [rm], reviewItems: [], now: NOW, days: 30 });
  assert.ok(result.heatmap.every((d) => d.count === 0));
  // but the plan series still spans from its creation
  assert.equal(result.plans[0].series.length, 2);
});
