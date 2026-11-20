import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutDag } from '../src/core/dag-layout.js';

const node = (id, prerequisites = []) => ({ id, title: id, prerequisites });

test('layoutDag: layers by dependency depth', () => {
  const { positions, edges, width, height } = layoutDag([
    node('c', ['a', 'b']),
    node('a'),
    node('b', ['a']),
    node('d', ['c']),
  ]);
  assert.deepEqual(positions.a, { x: 0, y: 0 });
  assert.deepEqual(positions.b, { x: 1, y: 0 });
  assert.deepEqual(positions.c, { x: 2, y: 0 });
  assert.deepEqual(positions.d, { x: 3, y: 0 });
  assert.equal(width, 4);
  assert.equal(height, 1);
  assert.deepEqual(edges, [
    { from: 'a', to: 'c' },
    { from: 'b', to: 'c' },
    { from: 'a', to: 'b' },
    { from: 'c', to: 'd' },
  ]);
});

test('layoutDag: multiple nodes share a layer with increasing y', () => {
  const { positions, height, width } = layoutDag([node('x'), node('y'), node('z', ['x'])]);
  assert.deepEqual(positions.x, { x: 0, y: 0 });
  assert.deepEqual(positions.y, { x: 0, y: 1 });
  assert.deepEqual(positions.z, { x: 1, y: 0 });
  assert.equal(width, 2);
  assert.equal(height, 2);
});

test('layoutDag: ignores dangling prerequisites and empty input', () => {
  const { positions, edges } = layoutDag([node('a', ['ghost'])]);
  assert.deepEqual(positions.a, { x: 0, y: 0 });
  assert.deepEqual(edges, []);
  assert.deepEqual(layoutDag([]), { positions: {}, edges: [], width: 0, height: 0 });
});

test('layoutDag: defensive against cycles (never hangs)', () => {
  const { positions } = layoutDag([node('a', ['b']), node('b', ['a'])]);
  assert.ok(positions.a && positions.b);
});
