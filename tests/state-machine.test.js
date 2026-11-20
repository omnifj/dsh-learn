import assert from 'node:assert/strict';
import test from 'node:test';
import { canTransition, transition } from '../src/core/state-machine.js';

test('happy path: IDLE -> DIAGNOSING -> ROADMAP_READY -> TEACHING', () => {
  let state = 'IDLE';
  state = transition(state, 'DIAGNOSE');
  assert.equal(state, 'DIAGNOSING');
  state = transition(state, 'ROADMAP');
  assert.equal(state, 'ROADMAP_READY');
  state = transition(state, 'TEACH');
  assert.equal(state, 'TEACHING');
});

test('question/checkpoint/remediate loop (plan §4.3)', () => {
  let state = 'TEACHING';
  state = transition(state, 'QUESTION');
  assert.equal(state, 'QUESTIONING');
  state = transition(state, 'CHECKPOINT');
  assert.equal(state, 'CHECKPOINT');
  state = transition(state, 'TEACH'); // >=80 unlock, next node
  assert.equal(state, 'TEACHING');
  state = transition(state, 'QUESTION');
  state = transition(state, 'REMEDIATE'); // 不达标
  assert.equal(state, 'REMEDIATING');
  state = transition(state, 'QUESTION');
  assert.equal(state, 'QUESTIONING');
});

test('REVIEW is allowed from any active state and returns via TEACH/QUESTION', () => {
  for (const from of ['IDLE', 'DIAGNOSING', 'ROADMAP_READY', 'TEACHING', 'QUESTIONING', 'CHECKPOINT', 'REMEDIATING']) {
    assert.equal(transition(from, 'REVIEW'), 'REVIEWING');
  }
  assert.equal(transition('REVIEWING', 'TEACH'), 'TEACHING');
  assert.equal(transition('REVIEWING', 'QUESTION'), 'QUESTIONING');
});

test('invalid transitions throw', () => {
  assert.throws(() => transition('IDLE', 'TEACH'), /cannot handle/);
  assert.throws(() => transition('CHECKPOINT', 'DIAGNOSE'), /cannot handle/);
  assert.throws(() => transition('COMPLETED', 'REVIEW'), /cannot handle/);
  assert.throws(() => transition('REMEDIATING', 'CHECKPOINT'), /cannot handle/);
  assert.throws(() => transition('TEACHING', 'ROADMAP'), /cannot handle/);
  assert.throws(() => transition('TEACHING', 'BOGUS'), /unknown tutor event/);
});

test('course completion', () => {
  assert.equal(transition('TEACHING', 'COMPLETE'), 'COMPLETED');
  assert.ok(canTransition('CHECKPOINT', 'COMPLETE'));
});
