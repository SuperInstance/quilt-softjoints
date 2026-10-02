// tests/decompose.test.js — classification rules, receipts, freezing test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decompose, classifyIntent, bucketVector, proposeFreezes, applyFreeze, DEFAULT_VECTOR } from '../src/decompose.js';
import { validateSheet, getCell } from '../src/store.js';

const SPEC = {
  domain: 'test-store',
  vector: { dim: 4, labels: ['urgency', 'familiarity', 'sentiment', 'formality'] },
  intents: [
    { id: 'hours', enum: { monday: '9-5', tuesday: '9-5' }, default: 'call us' },
    { id: 'greet', human_connection: true },
    { id: 'welcome', notes: 'social' },
    { id: 'refund', corner_cases: ['no receipt'], policies: ['de-escalate first'] },
    { id: 'chitchat', human_connection: true, notes: 'connection maintenance' },
    { id: 'mystery' },
    { id: 'overridden', enum: { a: 1 }, classify: 'softjoint' },
  ],
};

test('decompose: closed enum -> lookup cell holding table + default', () => {
  const { sheet } = decompose(SPEC);
  const c = getCell(sheet, 'hours.lookup');
  assert.equal(c.kind, 'lookup');
  assert.deepEqual(c.table, { monday: '9-5', tuesday: '9-5' });
  assert.equal(c.default, 'call us');
});

test('decompose: human_connection -> greeter softjoint (§5b) that is NEVER decomposed', () => {
  const { sheet } = decompose(SPEC);
  const c = getCell(sheet, 'greet.greeter');
  assert.equal(c.kind, 'softjoint');
  assert.equal(c.greeter, true);
  assert.match(c.notes, /never decomposed|NEVER|connection/i);
  // §5b exact fields present
  assert.deepEqual(Object.keys(c).sort(), ['backend', 'fallback', 'greeter', 'id', 'inputs', 'kind', 'notes', 'vector'].sort());
  assert.deepEqual(c.vector, { dim: 4, labels: ['urgency', 'familiarity', 'sentiment', 'formality'] });
  assert.equal(c.backend.type, 'typesafe-systemone');
});

test('decompose: social-surface name falls to greeter even without a hint', () => {
  const cls = classifyIntent({ id: 'welcome' });
  assert.equal(cls.emission, 'greeter');
  assert.equal(cls.rule, 'RULE_SOCIAL_SURFACE');
});

test('decompose: corner cases -> softjoint reading the moment as a vector', () => {
  const { sheet } = decompose(SPEC);
  const c = getCell(sheet, 'refund.softjoint');
  assert.equal(c.kind, 'softjoint');
  assert.equal(c.greeter, false);
  assert.equal(c.vector.dim, 4);
  assert.ok(Array.isArray(c.vector.labels) && c.vector.labels.length === 4);
  assert.ok(c.notes && c.notes.length > 10, 'softjoint carries why-it-stays-dynamic notes');
});

test('decompose: policies-only intent is a softjoint with a fallback lookup cell', () => {
  const spec = { intents: [{ id: 'rec', policies: ['recommend off the mood'], fallback: { id: 'rec.base', enum: { k: 'v' }, default: 'd' } }] };
  const { sheet } = decompose(spec);
  const joint = getCell(sheet, 'rec.softjoint');
  assert.equal(joint.kind, 'softjoint');
  assert.equal(joint.fallback.type, 'lookup');
  assert.equal(joint.fallback.ref, 'rec.base');
  const base = getCell(sheet, 'rec.base');
  assert.equal(base.kind, 'lookup');
  assert.equal(base.default, 'd');
});

test('decompose: unknown intent defaults to dynamic (freezing can promote, demotion is harder)', () => {
  const cls = classifyIntent({ id: 'mystery' });
  assert.equal(cls.emission, 'softjoint');
  assert.equal(cls.rule, 'RULE_DEFAULT_DYNAMIC');
  assert.equal(cls.confidence, 0.5);
});

test('decompose: classify hint that OVERRIDES the heuristic is audited (confidence capped 0.6)', () => {
  const cls = classifyIntent({ id: 'overridden', enum: { a: 1 }, classify: 'softjoint' });
  assert.equal(cls.emission, 'softjoint');
  assert.equal(cls.confidence, 0.6);
  assert.match(cls.why, /OVER|audited/i);
});

test('decompose: every cell gets a decomposition-receipt with rule/emission/confidence/why', () => {
  const { sheet, receipts } = decompose(SPEC);
  assert.equal(receipts.length, sheet.cells.length);
  for (const r of receipts) {
    assert.equal(r.kind, 'decomposition-receipt');
    assert.ok(r.cell_id && r.rule && r.emission);
    assert.ok(Number.isFinite(r.confidence) && r.confidence > 0 && r.confidence <= 1);
    assert.ok(r.why && r.why.length > 10);
  }
});

test('decompose: softjoint receipts carry the freezing-test promotion contract', () => {
  const { receipts } = decompose(SPEC);
  const r = receipts.find((x) => x.cell_id === 'refund.softjoint');
  assert.equal(r.promote.to, 'lookup');
  assert.equal(r.promote.test, 'freezing-test');
  assert.equal(r.promote.freeze_watch.min_obs, 2);
  const g = receipts.find((x) => x.cell_id === 'greet.greeter');
  assert.equal(g.promote.to, null, 'greeters are never promoted');
});

test('decompose: sheet validates and ids are unique', () => {
  const { sheet } = decompose(SPEC);
  assert.equal(validateSheet(sheet), true);
  const ids = sheet.cells.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('decompose: deterministic — same spec, same classification and ids', () => {
  const a = decompose(SPEC), b = decompose(SPEC);
  assert.deepEqual(a.sheet.cells.map((c) => [c.id, c.kind, c.greeter ?? null]), b.sheet.cells.map((c) => [c.id, c.kind, c.greeter ?? null]));
  assert.deepEqual(a.receipts.map((r) => [r.cell_id, r.rule, r.confidence]), b.receipts.map((r) => [r.cell_id, r.rule, r.confidence]));
});

test('bucketVector: dims bucket to lo/mid/hi thirds; malformed -> unbucketed', () => {
  const L = DEFAULT_VECTOR.labels;
  assert.equal(bucketVector([0.0, 0.2, 0.34, 1], L), 'urgency:lo,familiarity:lo,sentiment:mid,formality:hi');
  assert.equal(bucketVector([0.66, 0.67, 2, -1], L), 'urgency:mid,familiarity:hi,sentiment:hi,formality:lo');
  assert.equal(bucketVector([0.5], L), 'unbucketed');
});

test('freezing test: same region mapping to the same output across N=2 -> freeze-proposal', () => {
  const L = DEFAULT_VECTOR.labels;
  const obs = [
    { cell_id: 'x.softjoint', labels: L, vector: [0.8, 0.6, 0.2, 0.5], output: 'store credit today' },
    { cell_id: 'x.softjoint', labels: L, vector: [0.9, 0.6, 0.1, 0.5], output: 'Store Credit today!' },
  ];
  const { proposals, regions } = proposeFreezes(obs, { minObs: 2 });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, 'freeze-proposal');
  assert.equal(proposals[0].n, 2);
  assert.equal(proposals[0].status, 'provisional');
  assert.match(proposals[0].proposal.new_cell_id, /^frozen\.x-softjoint\.[0-9a-z]+$/);
  assert.deepEqual(proposals[0].proposal.table, { [regions[0].bucket]: 'store credit today' });
});

test('freezing test: same region with DIFFERENT outputs -> no proposal, region honestly reported', () => {
  const L = DEFAULT_VECTOR.labels;
  const obs = [
    { cell_id: 'x.softjoint', labels: L, vector: [0.8, 0.6, 0.2, 0.5], output: 'answer A' },
    { cell_id: 'x.softjoint', labels: L, vector: [0.85, 0.6, 0.2, 0.5], output: 'answer B' },
  ];
  const { proposals, regions } = proposeFreezes(obs, { minObs: 2 });
  assert.equal(proposals.length, 0);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].distinct_outputs, 2);
  assert.equal(regions[0].table_izable, false);
});

test('applyFreeze: appends a frozen lookup overlay + annotation; base cells untouched', () => {
  const { sheet } = decompose(SPEC);
  const before = JSON.stringify(sheet.cells);
  const p = {
    kind: 'freeze-proposal', cell_id: 'refund.softjoint', bucket: 'urgency:hi,familiarity:mid,sentiment:lo,formality:mid',
    labels: DEFAULT_VECTOR.labels, output: 'store credit', n: 2, distinct_outputs: 1, status: 'provisional',
    proposal: { new_cell_id: 'frozen.refund.test', kind: 'lookup', table: { 'urgency:hi,familiarity:mid,sentiment:lo,formality:mid': 'store credit' }, rationale: 'cooled' },
  };
  applyFreeze(sheet, p);
  assert.equal(JSON.stringify(sheet.cells), before, 'base cells must never be mutated');
  const frozen = sheet.compiled_cells.find((c) => c.id === 'frozen.refund.test');
  assert.equal(frozen.kind, 'lookup');
  assert.equal(frozen.frozen_for, 'refund.softjoint');
  assert.equal(sheet.annotations['refund.softjoint'].length, 1);
  assert.equal(sheet.annotations['refund.softjoint'][0].type, 'freeze-applied');
});
