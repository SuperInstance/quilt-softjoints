// tests/store.test.mjs — persistence + append-only receipts law.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSheet, saveSheet, appendReceipt, readReceipts, sha } from '../src/store.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'softjoints-'));
}

test('saveSheet round-trips and returns a stable hash', () => {
  const dir = tmp();
  const sheet = { id: 's', cells: [{ id: 'a', kind: 'lookup', table: {}, default: 1 }], meta: {} };
  const f = path.join(dir, 'sheets', 's.json');
  const h1 = saveSheet(sheet, f);
  const h2 = saveSheet(sheet, f);
  assert.equal(h1, h2);
  assert.equal(loadSheet(f).cells[0].id, 'a');
});

test('loadSheet rejects malformed sheets (fail-closed)', () => {
  const dir = tmp();
  const f = path.join(dir, 'bad.json');
  fs.writeFileSync(f, JSON.stringify({ nope: true }));
  assert.throws(() => loadSheet(f), /cells/);
});

test('receipts are append-only: corrections never rewrite history', () => {
  const dir = tmp();
  const f = path.join(dir, 'receipts', 'r.jsonl');
  appendReceipt(f, { kind: 'adjustment', note: 'wrong table row' });
  appendReceipt(f, { kind: 'adjustment', note: 'correction: right table row', corrects: 1 });
  const rows = readReceipts(f);
  assert.equal(rows.length, 2, 'both rows remain — the mistake is data too');
  assert.equal(rows[1].corrects, 1);
});

test('readReceipts surfaces corrupt lines instead of skipping them', () => {
  const dir = tmp();
  const f = path.join(dir, 'receipts', 'r.jsonl');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '{"kind":"ok"}\nNOT-JSON\n');
  const rows = readReceipts(f);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].kind, 'corrupt-line');
});

test('sha is deterministic and short', () => {
  assert.equal(sha({ a: 1 }), sha({ a: 1 }));
  assert.notEqual(sha({ a: 1 }), sha({ a: 2 }));
  assert.ok(sha({ a: 1 }).length === 16);
});
