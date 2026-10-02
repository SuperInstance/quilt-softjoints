// tests/compiler.test.mjs — adjustment→cell compilation (the "runs stop needing
// adjustments" mechanism). Synthetic adjustments in the wave-66 §5a schema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileAdjustments } from '../src/compiler.js';

const sheet = { id: 's', cells: [{ id: 'refunder', kind: 'softjoint' }], meta: {} };

const adj = (run_id, at_seq, hypothesis, input, after, generalizes = true) => ({
  kind: 'adjustment', run_id, at_seq, ts_utc: '2026-10-02T00:00:00Z',
  target: { cell_id: 'refunder', sheet: 'corner-store', input },
  before: 'manual', after,
  why: { trigger: 'run needed a manual fix', hypothesis, evidence: ['receipt-1'] },
  generalizes,
});

test('repeated generalizable adjustments compile into a new cell', () => {
  const adjustments = [
    adj('r1', 3, 'same vector region always needs store credit', 'upset-regular', 'store credit + apology'),
    adj('r2', 7, 'same vector region always needs store credit', 'upset-regular-2', 'store credit + apology'),
  ];
  const { compiledCells, receipts, sheet: patched } = compileAdjustments(sheet, adjustments);
  assert.equal(compiledCells.length, 1);
  assert.equal(compiledCells[0].kind, 'lookup');
  assert.match(compiledCells[0].id, /^auto-refunder-/);
  assert.equal(patched.cells.length, sheet.cells.length + 1, 'new cell appended, nothing removed');
  assert.equal(receipts[0].kind, 'compile-receipt');
  assert.match(receipts[0].rationale, /2 generalizable adjustments/);
});

test('singletons and non-generalizing adjustments do NOT compile (anecdote ≠ pattern)', () => {
  const adjustments = [
    adj('r1', 3, 'one-off typo fix', 'x', 'y', false),
    adj('r2', 4, 'totally different cause', 'a', 'b', true),
  ];
  const { compiledCells } = compileAdjustments(sheet, adjustments);
  assert.equal(compiledCells.length, 0);
});

test('compiler is idempotent: recompiling the same adjustments does not duplicate cells', () => {
  const adjustments = [
    adj('r1', 3, 'same cause', 'x', 'y'),
    adj('r2', 7, 'same cause', 'x2', 'y'),
  ];
  const pass1 = compileAdjustments(sheet, adjustments);
  const pass2 = compileAdjustments(pass1.sheet, adjustments);
  const ids1 = pass1.compiledCells.map(c => c.id);
  const added2 = pass2.compiledCells.filter(c => !ids1.includes(c.id));
  assert.equal(added2.length, 0, 'second pass adds nothing new');
});

test('clusters are scoped per target cell', () => {
  const adjustments = [
    adj('r1', 3, 'gate needs loosening', 'x', 'y'),
    { ...adj('r2', 5, 'gate needs loosening', 'x', 'y'), target: { cell_id: 'greeter', sheet: 'corner-store' } },
  ];
  const { compiledCells } = compileAdjustments(sheet, adjustments);
  assert.equal(compiledCells.length, 0, 'same words on different cells are different clusters');
});

test('compiled lookup table carries provenance (compiled_from run@seq)', () => {
  const adjustments = [adj('r1', 3, 'pattern P', 'x', 'y'), adj('r2', 7, 'pattern P', 'w', 'y')];
  const { compiledCells } = compileAdjustments(sheet, adjustments);
  assert.deepEqual(compiledCells[0].compiled_from, ['r1@3', 'r2@7']);
});
