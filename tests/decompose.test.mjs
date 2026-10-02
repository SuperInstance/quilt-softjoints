// tests/decompose.test.mjs — decomposition classification + freezing test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decompose, freezingTest } from '../src/decompose.js';

const spec = {
  id: 'test-domain',
  behaviors: [
    { id: 'hours', kind: 'deterministic', map: { 'mon-fri': '7-9', sat: '8-10' }, default: 'call' },
    { id: 'stock', kind: 'deterministic', map: { milk: 12 }, default: 0 },
    { id: 'moment-read', kind: 'judgment', vector: { dim: 2, labels: ['urgency', 'warmth'] } },
    { id: 'greeter', kind: 'connection', notes: 'human surface' },
  ],
};

test('decompose classifies deterministic behaviors into lookup cells', () => {
  const { sheet } = decompose(spec);
  const hours = sheet.cells.find(c => c.id === 'hours');
  assert.equal(hours.kind, 'lookup');
  assert.equal(hours.table['mon-fri'], '7-9');
  assert.equal(hours.default, 'call');
});

test('decompose classifies judgment behaviors into softjoint cells with fallback law', () => {
  const { sheet } = decompose(spec);
  const mj = sheet.cells.find(c => c.id === 'moment-read');
  assert.equal(mj.kind, 'softjoint');
  assert.equal(mj.greeter, false);
  assert.ok(mj.fallback, 'every softjoint carries a fallback (fail-closed law)');
  assert.deepEqual(mj.vector.labels, ['urgency', 'warmth']);
});

test('greeter cells are never decomposed and always carry notes', () => {
  const { sheet } = decompose(spec);
  const g = sheet.cells.find(c => c.id === 'greeter');
  assert.equal(g.kind, 'softjoint');
  assert.equal(g.greeter, true);
  assert.equal(g.notes, 'human surface');
});

test('decomposition receipts record rule + cell for every behavior', () => {
  const { receipts } = decompose(spec);
  assert.equal(receipts.length, spec.behaviors.length);
  for (const r of receipts) {
    assert.equal(r.kind, 'decomposition-receipt');
    assert.ok(r.rule, 'rule (the WHY) is mandatory');
    assert.ok(r.cell.id);
  }
});

test('meta counts reflect the three cell classes', () => {
  const { sheet } = decompose(spec);
  assert.equal(sheet.meta.counts.lookup, 2);
  assert.equal(sheet.meta.counts.softjoint, 1);
  assert.equal(sheet.meta.counts.greeter, 1);
});

test('decompose rejects malformed specs (fail-closed)', () => {
  assert.throws(() => decompose({}), /behaviors/);
  assert.throws(() => decompose(null), /behaviors/);
});

test('freezing test proposes promotion for deterministic vector regions', () => {
  const obs = [
    { vector: { urgency: 0.9, familiarity: 0.8 }, output: 'credit' },
    { vector: { urgency: 0.85, familiarity: 0.9 }, output: 'credit' },
    { vector: { urgency: 0.95, familiarity: 0.7 }, output: 'credit' },
  ];
  const props = freezingTest(obs, { threshold: 3 });
  assert.equal(props.length, 1);
  assert.equal(props[0].kind, 'freeze-proposal');
  assert.equal(props[0].output, 'credit');
});

test('freezing test stays silent on mixed regions (honest non-promotion)', () => {
  const obs = [
    { vector: { urgency: 0.9, familiarity: 0.8 }, output: 'credit' },
    { vector: { urgency: 0.85, familiarity: 0.9 }, output: 'refund' },
    { vector: { urgency: 0.95, familiarity: 0.7 }, output: 'credit' },
  ];
  assert.equal(freezingTest(obs, { threshold: 3 }).length, 0);
});
