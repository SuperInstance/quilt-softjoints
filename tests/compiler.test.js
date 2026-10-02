// tests/compiler.test.js — adjustment -> compiled cell (§5a interop contract).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, loadAdjustments, similarity } from '../src/compiler.js';
import { resolveLookupValue, getCell } from '../src/store.js';

function adj(over = {}) {
  return {
    kind: 'adjustment', run_id: 'run-t', at_seq: 1, ts_utc: '2026-10-02T00:00:00Z',
    target: { cell_id: 'hours.lookup', sheet: 'corner-store' },
    before: { saturday: '9am-5pm' }, after: { saturday: '9am-6pm' },
    why: { trigger: 'told wrong hours', hypothesis: 'Saturday hours wrong; sign says 9am-6pm', evidence: [] },
    generalizes: true, compiled_cell: null, ...over,
  };
}

function sheet() {
  return {
    sheet: 'corner-store', version: 1, created_utc: '2026-10-02T00:00:00Z', description: '',
    cells: [{ kind: 'lookup', id: 'hours.lookup', table: { friday: '7am-10pm', saturday: '9am-5pm' }, default: 'call us' }],
    compiled_cells: [], annotations: {},
  };
}

test('compiler: two similar generalizing adjustments compile ONE lookup overlay', () => {
  const s = sheet();
  const input = [
    adj({ run_id: 'run-101', at_seq: 3 }),
    adj({ run_id: 'run-102', at_seq: 5, why: { trigger: 'again told wrong hours', hypothesis: 'Saturday hours wrong again; door sign reads 9am-6pm', evidence: ['x'] } }),
  ];
  const { sheet: out, receipts, filled } = compile(input, s, { now: '2026-10-02T00:00:00Z' });
  const creceipts = receipts.filter((r) => r.kind === 'compile-receipt');
  assert.equal(creceipts.length, 1);
  const rc = creceipts[0];
  assert.equal(rc.target.cell_id, 'hours.lookup');
  assert.deepEqual(rc.consumed, [{ run_id: 'run-101', at_seq: 3 }, { run_id: 'run-102', at_seq: 5 }]);
  assert.ok(rc.pattern.shared_tokens.includes('saturday'));
  assert.ok(rc.rationale.length > 20);
  // compiled cell patched into the sheet
  assert.equal(out.compiled_cells.length, 1);
  const cell = out.compiled_cells[0];
  assert.equal(cell.kind, 'lookup');
  assert.equal(cell.shadow_of, 'hours.lookup');
  assert.deepEqual(cell.table, { saturday: '9am-6pm' });
  // §5a: "compiled_cell may be null at write time; the compiler fills it later"
  assert.equal(filled[0].compiled_cell.id, cell.id);
  assert.equal(filled[0].compiled_cell.kind, 'lookup');
  // annotation appended on the target cell
  assert.equal(out.annotations['hours.lookup'][0].type, 'compiled-correction');
  // the overlay actually intercepts — this is what "runs stop needing adjustments" means
  assert.deepEqual(resolveLookupValue(out, 'hours.lookup', 'saturday'), { value: '9am-6pm', layer: 'compiled', cell_id: cell.id });
  assert.deepEqual(resolveLookupValue(out, 'hours.lookup', 'friday'), { value: '7am-10pm', layer: 'base', cell_id: 'hours.lookup' });
});

test('compiler: single observation is honestly skipped (SINGLE_OBSERVATION), nothing compiled', () => {
  const { receipts, sheet: out } = compile([adj()], sheet());
  assert.equal(out.compiled_cells.length, 0);
  const skip = receipts.find((r) => r.kind === 'compile-skip');
  assert.equal(skip.code, 'SINGLE_OBSERVATION');
});

test('compiler: repeated but non-generalizing adjustments are NOT compiled', () => {
  const s = sheet();
  const input = [
    adj({ generalizes: false, run_id: 'a' }),
    adj({ generalizes: false, run_id: 'b', at_seq: 2 }),
  ];
  const { receipts, sheet: out } = compile(input, s);
  assert.equal(out.compiled_cells.length, 0);
  assert.equal(receipts.find((r) => r.kind === 'compile-skip').code, 'NOT_GENERALIZING');
});

test('compiler: mixed generalizes (one true one false) with 2 records -> not compiled', () => {
  const s = sheet();
  const { sheet: out } = compile([adj({ generalizes: true }), adj({ generalizes: false, at_seq: 2 })], s);
  assert.equal(out.compiled_cells.length, 0);
});

test('compiler: inconsistent after-values are refused (no guessing)', () => {
  const s = sheet();
  const input = [
    adj({ run_id: 'a', after: { saturday: '9am-6pm' } }),
    adj({ run_id: 'b', at_seq: 2, after: { saturday: '10am-6pm' } }),
  ];
  const { receipts, sheet: out } = compile(input, s);
  assert.equal(out.compiled_cells.length, 0);
  assert.equal(receipts.find((r) => r.kind === 'compile-skip').code, 'INCONSISTENT_PAYLOAD');
});

test('compiler: a record carrying compiled_cell.sheet_fragment (formula) is honored', () => {
  const s = sheet();
  const input = [
    adj({
      run_id: 'a', after: null,
      compiled_cell: { id: 'compiled.hours.holiday', kind: 'formula', sheet_fragment: { inputs: ['hours.lookup'], op: 'template', with: { text: 'Holiday hours differ: {{hours.lookup}}' } }, rationale: 'holiday hours need composition' },
    }),
    adj({
      run_id: 'b', at_seq: 2, after: null,
      compiled_cell: { id: 'compiled.hours.holiday', kind: 'formula', sheet_fragment: { inputs: ['hours.lookup'], op: 'template', with: { text: 'Holiday hours differ: {{hours.lookup}}' } }, rationale: 'same' },
    }),
  ];
  const { sheet: out, receipts } = compile(input, s);
  const cell = out.compiled_cells[0];
  assert.equal(cell.kind, 'formula');
  assert.equal(cell.id, 'compiled.hours.holiday');
  assert.equal(cell.op, 'template');
  const rc = receipts.find((r) => r.kind === 'compile-receipt');
  assert.equal(rc.compiled_cell.kind, 'formula');
});

test('compiler: different target cells do NOT cluster together', () => {
  const s = sheet();
  const input = [
    adj({ run_id: 'a' }),
    adj({ run_id: 'b', at_seq: 2, target: { cell_id: 'stock.lookup', sheet: 'corner-store' } }),
  ];
  const { receipts, sheet: out } = compile(input, s);
  assert.equal(out.compiled_cells.length, 0);
  assert.equal(receipts.filter((r) => r.kind === 'compile-skip' && r.code === 'SINGLE_OBSERVATION').length, 2);
});

test('compiler: distinct problems against the SAME cell do not cluster (similarity gate)', () => {
  const s = sheet();
  const input = [
    adj({ run_id: 'a', after: { saturday: '9am-6pm' }, why: { trigger: 'x', hypothesis: 'Saturday closing hour mismatch on the weekend table', evidence: [] } }),
    adj({ run_id: 'b', at_seq: 2, after: { monday: '8am' }, why: { trigger: 'y', hypothesis: 'Monday opening typo — weekday hours begin too late in the morning', evidence: [] } }),
  ];
  // hypotheses share no content tokens -> separate clusters, each a single observation
  const { receipts, sheet: out } = compile(input, s);
  assert.equal(out.compiled_cells.length, 0);
  assert.equal(receipts.filter((r) => r.code === 'SINGLE_OBSERVATION').length, 2);
});

test('compiler: loadAdjustments surfaces non-adjustment records instead of skipping them', () => {
  const { adjustments, bad_lines } = loadAdjustments([
    { kind: 'adjustment', target: { cell_id: 'x' } },
    { kind: 'stablepoint', run_id: 'r' },
    null,
  ]);
  assert.equal(adjustments.length, 1);
  assert.equal(bad_lines.length, 2);
});

test('similarity: identical -> 1, disjoint -> 0, stopword noise ignored', () => {
  assert.equal(similarity('hours are wrong', 'hours are wrong'), 1);
  assert.equal(similarity('cats', 'dogs'), 0);
  assert.ok(similarity('the hours were wrong on saturday', 'hours wrong saturday') >= 0.6);
});

test('compiler: base cells are never mutated — corrections only shadow', () => {
  const s = sheet();
  const before = JSON.stringify(s.cells);
  compile([adj({ run_id: 'a' }), adj({ run_id: 'b', at_seq: 2 })], s);
  assert.equal(JSON.stringify(s.cells), before);
  assert.equal(getCell(s, 'hours.lookup').table.saturday, '9am-5pm', 'base table untouched');
});
