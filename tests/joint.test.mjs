// tests/joint.test.mjs — soft-joint execution with MOCK backends (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runJoint, makeBackend, bucketVector, clearCache } from '../src/joint.js';

const sheet = {
  cells: [
    { id: 'policy', kind: 'lookup', table: { a: 1 }, default: 0 },
    {
      id: 'judger', kind: 'softjoint', greeter: false,
      inputs: ['policy'],
      vector: { dim: 2, labels: ['urgency', 'warmth'] },
      backend: { type: 'local', model: 'stub' },
      fallback: { type: 'lookup', ref: 'policy', note: 'degrade to table' },
    },
    {
      id: 'nofb', kind: 'softjoint', greeter: false,
      inputs: [], vector: { dim: 1, labels: ['x'] },
      backend: { type: 'local', model: 'stub' },
      fallback: { type: 'default', note: null },
    },
  ],
};

function flakyBackend(failTimes) {
  let n = 0;
  return {
    type: 'local', model: 'flaky',
    async call() {
      if (n++ < failTimes) throw new Error('simulated outage');
      return { answer: 'recovered', vector: { urgency: 0.5, warmth: 0.5 }, confidence: 0.9, usage: { t: 1 }, latency_ms: 1, model: 'flaky' };
    },
  };
}

test('runJoint returns the backend answer with a vector (shape law)', async () => {
  clearCache();
  const out = await runJoint(sheet, 'judger', { state: { m: 1 }, vector: {} }, { backend: flakyBackend(0), cache: false });
  assert.equal(out.source, 'local');
  assert.equal(typeof out.answer, 'string');
  assert.ok(out.vector && 'urgency' in out.vector && 'warmth' in out.vector, 'vector array, not value array');
});

test('backend failure fails CLOSED to the fallback (never silent, never a script)', async () => {
  clearCache();
  const out = await runJoint(sheet, 'judger', { state: {}, vector: {} }, { backend: flakyBackend(99), cache: false });
  assert.equal(out.source, 'fallback');
  assert.match(out.answer, /fallback→policy/);
  assert.ok(out.reason.startsWith('backend-failed'));
});

test('joint without fallback degrades to fail-closed null', async () => {
  clearCache();
  const out = await runJoint(sheet, 'nofb', { state: {}, vector: {} }, { backend: flakyBackend(99), cache: false });
  assert.equal(out.source, 'fail-closed');
  assert.equal(out.answer, null);
});

test('budget exhaustion routes to fallback without calling the backend', async () => {
  clearCache();
  const out = await runJoint(sheet, 'judger', { state: {}, vector: {} }, { backend: flakyBackend(0), budget: 0, cache: false });
  assert.equal(out.source, 'fallback');
});

test('cache: identical bucketed moments hit the cache (second call no backend)', async () => {
  clearCache();
  let calls = 0;
  const counting = {
    type: 'local', model: 'counter',
    async call() { calls++; return { answer: `c${calls}`, vector: { urgency: 0.5, warmth: 0.5 }, confidence: 1, usage: null, latency_ms: 0, model: 'counter' }; },
  };
  const m = { state: { k: 1 }, vector: { urgency: 0.42, warmth: 0.61 } };
  const a = await runJoint(sheet, 'judger', m, { backend: counting, cache: true });
  const b = await runJoint(sheet, 'judger', { ...m, state: { k: 999 } }, { backend: counting, cache: true }); // same bucket, different state
  assert.equal(a.source, 'local');
  assert.equal(b.source, 'cache');
  assert.equal(b.answer, a.answer);
  assert.equal(calls, 1);
});

test('runJoint rejects non-softjoint targets (fail-closed)', async () => {
  await assert.rejects(() => runJoint(sheet, 'policy', {}), /not a softjoint/);
});

test('makeBackend refuses unknown types', () => {
  assert.throws(() => makeBackend({ type: 'carrier-pigeon' }), /unknown backend/);
});

test('bucketVector is stable under label permutation', () => {
  const a = bucketVector({ urgency: 0.42, warmth: 0.61 });
  const b = bucketVector({ warmth: 0.61, urgency: 0.42 });
  assert.equal(a, b);
});
