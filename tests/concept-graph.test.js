import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertInsertable,
  detectCycle,
  topoSort,
  validateNodeSpecs,
} from '../src/core/concept-graph.js';

const spec = (id, prerequisites = []) => ({
  id,
  title: id,
  description: `teach ${id}`,
  prerequisites,
});

test('topoSort respects prerequisites, input order breaks ties', () => {
  const sorted = topoSort([
    spec('c-advanced', ['a-basic', 'b-mid']),
    spec('b-mid', ['a-basic']),
    spec('a-basic'),
  ]);
  assert.deepEqual(sorted.map((s) => s.id), ['a-basic', 'b-mid', 'c-advanced']);
});

test('topoSort keeps independent nodes in input order', () => {
  const sorted = topoSort([spec('z-one'), spec('y-two'), spec('x-three')]);
  assert.deepEqual(sorted.map((s) => s.id), ['z-one', 'y-two', 'x-three']);
});

test('validateNodeSpecs rejects non-kebab ids', () => {
  assert.throws(() => validateNodeSpecs([spec('Bad Id')]), /kebab-case/);
  assert.throws(() => validateNodeSpecs([spec('_x')]), /kebab-case/);
});

test('validateNodeSpecs rejects duplicates and unknown prerequisites', () => {
  assert.throws(() => validateNodeSpecs([spec('a-one'), spec('a-one')]), /duplicate/);
  assert.throws(() => validateNodeSpecs([spec('a-one', ['b-missing'])]), /unknown node/);
  assert.throws(() => validateNodeSpecs([spec('a-one', ['a-one'])]), /itself/);
});

test('detectCycle throws on dependency cycles', () => {
  const cyclic = [spec('a-one', ['c-three']), spec('b-two', ['a-one']), spec('c-three', ['b-two'])];
  assert.throws(() => detectCycle(cyclic), /cycle/);
  assert.throws(() => topoSort(cyclic), /cycle/);
});

test('assertInsertable allows a valid insert and rejects a cyclic one', () => {
  const existing = [spec('a-one'), spec('b-two', ['a-one'])];
  assert.doesNotThrow(() => assertInsertable(existing, spec('c-three', ['b-two'])));
  assert.throws(() => assertInsertable(existing, spec('a-one', ['b-two'])), /duplicate|cycle/);
  assert.throws(() => assertInsertable(existing, spec('d-four', ['a-one', 'd-four'])), /itself|cycle/);
});

test('validateNodeSpecs rejects an empty node list', () => {
  assert.throws(() => validateNodeSpecs([]), /non-empty/);
  assert.throws(() => validateNodeSpecs('nope'), /non-empty/);
});
