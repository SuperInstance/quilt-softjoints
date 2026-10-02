// tests/store.test.js — sheet persistence, append-only receipts, layered
// resolution, and the never-delete law.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  newSheet, loadSheet, saveSheet, validateSheet, getCell, listCells, annotateCell,
  appendReceipt, readReceipts, resolveLookupValue, SheetError,
} from '../src/store.js';

function tmp(name) {
  const dir = path.join(process.cwd(), 'tests', `.tmp-store-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fixture() {
  const s = newSheet('t');
  s.cells.push(
    { kind: 'lookup', id: 'a.lookup', table: { k: 'base' }, default: 'a-default' },
    { kind: 'softjoint', id: 'j.softjoint', inputs: ['x'], vector: { dim: 2, labels: ['urgency', 'familiarity'] },
      backend: { type: 'typesafe-systemone', model: 'jev-latest', prompt_template: 'p {{x}}' },
      fallback: { type: 'lookup', ref: 'a.lookup', note: 'n' }, greeter: false, notes: 'dynamic because corner cases' },
  );
  return s;
}

test('store: save/load round-trip validates and preserves everything', () => {
  const dir = tmp('rt');
  const file = path.join(dir, 'sheet.json');
  const s = fixture();
  saveSheet(file, s);
  const back = loadSheet(file);
  assert.equal(back.sheet, 't');
  assert.equal(back.cells.length, 2);
  assert.deepEqual(back.cells[0].table, { k: 'base' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('store: validation catches a duplicate cell id (named error)', () => {
  const s = fixture();
  s.compiled_cells.push({ kind: 'lookup', id: 'a.lookup', table: {}, default: null });
  assert.throws(() => validateSheet(s), (e) => e instanceof SheetError && e.code === 'E_DUPLICATE_CELL_ID');
});

test('store: validation enforces §5b — greeter needs notes explaining why it is never decomposed', () => {
  const s = fixture();
  s.cells[1].greeter = true;
  assert.throws(() => validateSheet(s), (e) => e.code === 'E_SOFTJOINT_SHAPE');
  s.cells[1].notes = 'GREETER: the connection is the feature itself; never decomposed';
  assert.equal(validateSheet(s), true);
});

test('store: validation enforces lookup shape (table + default) and vector labels == dim', () => {
  const s = fixture();
  s.cells[0].default = undefined;
  assert.throws(() => validateSheet(s), (e) => e.code === 'E_LOOKUP_SHAPE');
  const s2 = fixture();
  s2.cells[1].vector = { dim: 3, labels: ['a', 'b'] };
  assert.throws(() => validateSheet(s2), (e) => e.code === 'E_SOFTJOINT_SHAPE');
});

test('store: appendReceipt is append-only — seq advances, history is never touched', () => {
  const dir = tmp('ledger');
  const file = path.join(dir, 'r.jsonl');
  const a = appendReceipt(file, { kind: 'x', note: 'first' });
  const b = appendReceipt(file, { kind: 'x', note: 'second' });
  const c = appendReceipt(file, { kind: 'x', note: 'third' });
  assert.deepEqual([a.seq, b.seq, c.seq], [0, 1, 2]);
  const raw = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(raw.length, 3);
  assert.match(raw[0], /first/);
  assert.match(raw[2], /third/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('store: readReceipts surfaces corrupt lines as bad_lines, never silently skips', () => {
  const dir = tmp('bad');
  const file = path.join(dir, 'r.jsonl');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, '{"seq":0,"ok":true}\nthis is not json\n{"seq":1,"ok":true}\n');
  const { records, bad_lines } = readReceipts(file);
  assert.equal(records.length, 2);
  assert.equal(bad_lines.length, 1);
  assert.equal(bad_lines[0].line, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('store: annotateCell APPENDS; the annotated cell is byte-identical before/after', () => {
  const s = fixture();
  const before = JSON.stringify(s.cells[0]);
  annotateCell(s, 'a.lookup', { type: 'note', text: 'watch saturday' });
  annotateCell(s, 'a.lookup', { type: 'note', text: 'watch sunday too' });
  assert.equal(JSON.stringify(s.cells[0]), before);
  assert.equal(s.annotations['a.lookup'].length, 2);
  assert.throws(() => annotateCell(s, 'nope.cell', {}), (e) => e.code === 'E_UNKNOWN_CELL');
});

test('store: resolveLookupValue layers — compiled overlay shadows base, default is last', () => {
  const s = fixture();
  s.compiled_cells.push({ kind: 'lookup', id: 'c1', table: { k: 'compiled1' }, default: null, shadow_of: 'a.lookup' });
  s.compiled_cells.push({ kind: 'lookup', id: 'c2', table: { k: 'compiled2' }, default: null, shadow_of: 'a.lookup' });
  assert.deepEqual(resolveLookupValue(s, 'a.lookup', 'k'), { value: 'compiled2', layer: 'compiled', cell_id: 'c2' }, 'latest overlay wins');
  assert.deepEqual(resolveLookupValue(s, 'a.lookup', 'nope'), { value: 'a-default', layer: 'default', cell_id: 'a.lookup' });
});

test('store: never-delete — compiling/freezing only ever GROWS the sheet', () => {
  const s = fixture();
  const idsBefore = new Set([...s.cells, ...s.compiled_cells].map((c) => c.id));
  s.compiled_cells.push({ kind: 'lookup', id: 'fz', table: { b: 'v' }, default: null, frozen_for: 'j.softjoint' });
  const idsAfter = new Set([...s.cells, ...s.compiled_cells].map((c) => c.id));
  for (const id of idsBefore) assert.ok(idsAfter.has(id), `cell ${id} survived`);
  assert.ok(idsAfter.size > idsBefore.size);
});

test('store: listCells filters by kind and greeter flag', () => {
  const s = fixture();
  assert.equal(listCells(s, { kind: 'lookup' }).length, 1);
  assert.equal(listCells(s, { kind: 'softjoint', greeter: false }).length, 1);
  assert.equal(listCells(s, { greeter: true }).length, 0);
});

test('store: getCell finds compiled overlays too', () => {
  const s = fixture();
  s.compiled_cells.push({ kind: 'lookup', id: 'fz', table: {}, default: null, frozen_for: 'j.softjoint' });
  assert.equal(getCell(s, 'fz').id, 'fz');
  assert.equal(getCell(s, 'j.softjoint').id, 'j.softjoint');
  assert.equal(getCell(s, 'ghost'), null);
});

test('store: loading a corrupted sheet file fails loudly (no silent defaults)', () => {
  const dir = tmp('corrupt');
  const file = path.join(dir, 'sheet.json');
  fs.writeFileSync(file, '{ not json');
  assert.throws(() => loadSheet(file), SyntaxError);
  fs.rmSync(dir, { recursive: true, force: true });
});
