// tests/joint.test.js — softjoint execution: vectors, backends (MOCK, no
// network), fail-closed fallback, budget, cache, frozen regions, receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evalJoint, makeMockClient, makeTypesafeClient, deriveVector, renderTemplate, defaultCache } from '../src/joint.js';
import { proposeFreezes, applyFreeze, bucketVector } from '../src/decompose.js';
import { newSheet, getCell, appendReceipt } from '../src/store.js';

const LABELS = ['urgency', 'familiarity', 'sentiment', 'formality'];

// wire-shaped systemone mock: typed answers (noul | choice) as probed live on
// POST /v1/systemone — noul: {noul: 0..1}, choice: {choice: string}.
function systemoneAnswers({ vector, action = 'store credit today', confidence = 0.9 }) {
  const a = {};
  LABELS.forEach((l, i) => { a[`v_${l}`] = { noul: vector[i] }; });
  a.action = { choice: action };
  a.confidence = { noul: confidence };
  return a;
}

function fixtureSheet() {
  const sheet = newSheet('test-sheet');
  sheet.cells.push(
    { kind: 'lookup', id: 'policy.base', table: {}, default: 'Base policy: 30 days with a receipt.' },
    {
      kind: 'softjoint', id: 'refund.softjoint', inputs: ['customer_text'],
      vector: { dim: 4, labels: LABELS },
      backend: {
        type: 'typesafe-systemone', model: 'jev-latest', prompt_template: 'Handle: {{customer_text}} (policy: {{policy.base}})',
        criteria: { 'refund to card': 'money back', 'store credit': 'goodwill default', 'deny politely': 'decline' },
      },
      fallback: { type: 'lookup', ref: 'policy.base', note: 'dark channel' },
      greeter: false, notes: 'corner cases need judgment over the moment',
    },
    {
      kind: 'softjoint', id: 'chat.softjoint', inputs: ['customer_text'],
      vector: { dim: 4, labels: LABELS },
      backend: { type: 'deepinfra-chat', model: 'granite-4.2-3b', prompt_template: 'Chat: {{customer_text}}' },
      fallback: { type: 'default', value: 'a fixed warm line', note: 'dark channel' },
      greeter: false, notes: 'mood-aware recommendation',
    },
  );
  return sheet;
}

const okSystemone = makeMockClient({
  script: ({ kind }) => kind === 'systemone'
    ? { answers: systemoneAnswers({ vector: [0.9, 0.6, 0.2, 0.5] }), usage: { total_tokens: 100 } }
    : { content: 'nope' },
});
const okChat = makeMockClient({
  script: ({ kind }) => kind === 'chat'
    ? { content: 'Here you go: {"vector":{"urgency":0.2,"familiarity":0.7,"sentiment":0.8,"formality":0.3},"answer":"doughnuts today","confidence":0.8}', usage: { total_tokens: 50 } }
    : null,
});

test('joint: model path — answer, vector (model overrides local), confidence, receipt', async () => {
  const sheet = fixtureSheet();
  defaultCache.clear();
  const r = await evalJoint(sheet, 'refund.softjoint', { text: 'broken now', cells: { customer_text: 'broken now' } }, { client: okSystemone });
  assert.equal(r.source, 'model');
  assert.equal(r.answer, 'store credit today');
  assert.deepEqual(r.vector, [0.9, 0.6, 0.2, 0.5]);
  assert.equal(r.confidence, 0.9);
  assert.equal(r.receipt.ok, true);
  assert.equal(r.receipt.usage.total_tokens, 100);
  assert.equal(r.receipt.greeter, false);
  // typed wire: noul vector + choice action arrived and were parsed
  assert.deepEqual(r.receipt.model_vector, { urgency: 0.9, familiarity: 0.6, sentiment: 0.2, formality: 0.5 });
  assert.equal(r.receipt.served_model, 'mock-latest');
});

test('joint: deepinfra-chat path parses strict-JSON answers out of chat content', async () => {
  const sheet = fixtureSheet();
  defaultCache.clear();
  const r = await evalJoint(sheet, 'chat.softjoint', { text: 'hello', cells: { customer_text: 'hello' } }, { client: okChat });
  assert.equal(r.source, 'model');
  assert.equal(r.answer, 'doughnuts today');
  assert.deepEqual(r.vector, [0.2, 0.7, 0.8, 0.3]);
  assert.equal(r.receipt.backend.type, 'deepinfra-chat');
});

test('joint: fail-closed — backend throws -> fallback lookup answers, receipt records the failure', async () => {
  const sheet = fixtureSheet();
  defaultCache.clear();
  const dark = makeMockClient({ script: () => { throw new Error('HTTP 503'); } });
  const r = await evalJoint(sheet, 'refund.softjoint', { text: 'whatever', cells: { customer_text: 'whatever' } }, { client: dark });
  assert.equal(r.source, 'fallback');
  assert.match(r.answer, /30 days with a receipt/);
  assert.equal(r.confidence, 1, 'the fallback lookup is deterministic — full confidence in ITS answer');
  assert.equal(r.receipt.ok, false);
  assert.equal(r.receipt.failed, true);
  assert.match(r.receipt.error, /503/);
  assert.equal(r.receipt.fallback, 'fallback.lookup:policy.base@default');
});

test('joint: budget exhausted BEFORE the wire -> fail-closed fallback (BUDGET_EXHAUSTED)', async () => {
  const sheet = fixtureSheet();
  defaultCache.clear();
  const broke = makeMockClient({ budget: 0, script: () => ({ answers: { answer: 'x' } }) });
  const r = await evalJoint(sheet, 'refund.softjoint', { text: 'x', cells: { customer_text: 'x' } }, { client: broke });
  assert.equal(r.source, 'fallback');
  assert.equal(r.receipt.code, 'BUDGET_EXHAUSTED');
  assert.equal(broke.calls, 0);
});

test('joint: unparseable model answer -> E_PARSE -> fallback (never a silent guess)', async () => {
  const sheet = fixtureSheet();
  defaultCache.clear();
  const garbage = makeMockClient({ script: ({ kind }) => kind === 'systemone' ? { answers: { action: { choice: '   ' } } } : null });
  const r = await evalJoint(sheet, 'refund.softjoint', { text: 'x', cells: { customer_text: 'x' } }, { client: garbage });
  assert.equal(r.source, 'fallback');
  assert.equal(r.receipt.code, 'E_PARSE');
});

test('joint: typesafe decision joint WITHOUT criteria is refused before the wire (typed-wire law)', async () => {
  const sheet = fixtureSheet();
  delete getCell(sheet, 'refund.softjoint').backend.criteria;
  defaultCache.clear();
  const never = makeMockClient({ script: () => { throw new Error('must not reach the wire'); } });
  const r = await evalJoint(sheet, 'refund.softjoint', { text: 'x', cells: { customer_text: 'x' } }, { client: never });
  assert.equal(r.source, 'fallback');
  assert.equal(r.receipt.code, 'E_CRITERIA_REQUIRED');
  assert.equal(never.calls, 0);
});

test('joint: cache — identical (backend, model, joint, bucket) is served without a second call', async () => {
  const sheet = fixtureSheet();
  defaultCache.clear();
  const shared = new Map();
  const a = await evalJoint(sheet, 'refund.softjoint', { text: 'broken, fix it now', cells: { customer_text: 'broken, fix it now' } }, { client: okSystemone, cache: shared });
  const callsAfterFirst = okSystemone.calls;
  const b = await evalJoint(sheet, 'refund.softjoint', { text: 'it broke, need it fixed now', cells: { customer_text: 'b' } }, { client: okSystemone, cache: shared });
  assert.equal(a.source, 'model');
  assert.equal(b.source, 'cache');
  assert.equal(b.answer, a.answer, 'same vector region -> same answer (the freezing hypothesis)');
  assert.equal(okSystemone.calls, callsAfterFirst, 'cache hit must not touch the backend');
  assert.equal(b.receipt.source, 'cache');
});

test('joint: a DIFFERENT bucket pays for its own call', async () => {
  const sheet = fixtureSheet();
  const shared = new Map();
  await evalJoint(sheet, 'chat.softjoint', { text: 'calm hello there', cells: { customer_text: 'calm hello there' } }, { client: okChat, cache: shared });
  const after1 = okChat.calls;
  const r2 = await evalJoint(sheet, 'chat.softjoint', { text: 'MONEY BACK NOW, broken, furious', cells: { customer_text: 'angry' } }, { client: okChat, cache: shared });
  assert.equal(r2.source, 'model');
  assert.ok(okChat.calls > after1);
});

test('joint: frozen region answers from the table without any backend call', async () => {
  const sheet = fixtureSheet();
  const bucket = 'urgency:hi,familiarity:lo,sentiment:lo,formality:mid';
  const proposal = {
    kind: 'freeze-proposal', cell_id: 'refund.softjoint', bucket, labels: LABELS, output: 'cooled answer', n: 3,
    proposal: { new_cell_id: 'frozen.refund.test', kind: 'lookup', table: { [bucket]: 'cooled answer' }, rationale: 'cooled' },
  };
  applyFreeze(sheet, proposal);
  const never = makeMockClient({ script: () => { throw new Error('must not be called'); } });
  const r = await evalJoint(sheet, 'refund.softjoint', { text: 'this broke and I need it fixed NOW', cells: { customer_text: 'broke fixed now' } }, { client: never });
  assert.equal(r.source, 'frozen-lookup');
  assert.equal(r.answer, 'cooled answer');
  assert.equal(r.receipt.frozen_cell, 'frozen.refund.test');
});

test('joint: evalJoint refuses non-softjoint cells with a named error', async () => {
  const sheet = fixtureSheet();
  await assert.rejects(() => evalJoint(sheet, 'policy.base', {}, { client: okSystemone }), /E_NOT_A_SOFTJOINT/);
  await assert.rejects(() => evalJoint(sheet, 'nope.cell', {}, { client: okSystemone }), /E_NOT_A_SOFTJOINT/);
});

test('joint: receipts are appended to the receipts file when asked (append-only)', async () => {
  const sheet = fixtureSheet();
  defaultCache.clear();
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tests', '.tmp-'));
  const file = path.join(dir, 'joint-calls.jsonl');
  await evalJoint(sheet, 'refund.softjoint', { text: 'broken now', cells: { customer_text: 'x' } }, { client: okSystemone, receiptsFile: file });
  await evalJoint(sheet, 'refund.softjoint', { text: 'broke, fix now', cells: { customer_text: 'x' } }, { client: okSystemone, receiptsFile: file });
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]).seq, 0);
  assert.deepEqual(JSON.parse(lines[1]).seq, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('typesafe client: NO_KEY fail-closed without network; state-object guard', async () => {
  const saved = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  const c = makeTypesafeClient({});
  await assert.rejects(() => c.systemone({ state: {}, questions: {} }), /TYPESAFE_API_KEY missing/);
  process.env.TYPESAFE_API_KEY = saved;
  const c2 = makeTypesafeClient({});
  process.env.TYPESAFE_API_KEY = 'unused-in-this-test'; // guarded BEFORE any fetch
  await assert.rejects(() => c2.systemone({ state: 'not-an-object', questions: {} }), /state must be an OBJECT/);
  delete process.env.TYPESAFE_API_KEY;
});

test('deriveVector: deterministic local sensor; unknown labels honestly score 0.5', () => {
  const v = deriveVector('I need a refund NOW, it broke, this is urgent', { cells: { customer_name: 'Sam' } }, LABELS);
  assert.ok(v[0] > 0.6, 'urgency spikes');
  assert.ok(v[2] < 0.5, 'sentiment dips on angry words');
  const w = deriveVector('I need a refund NOW, it broke, this is urgent', {}, LABELS);
  assert.ok(w[1] < v[1], 'known customer reads more familiar');
  const z = deriveVector('hello', {}, ['urgency', 'weather']);
  assert.deepEqual(z[1], 0.5);
});

test('renderTemplate: {{cell}} refs resolve from the moment first, then the sheet', () => {
  const sheet = fixtureSheet();
  assert.equal(renderTemplate('Hi {{customer_name}}: {{customer_text}}', { customer_name: 'Sam', customer_text: 'hello' }), 'Hi Sam: hello');
  assert.match(renderTemplate('policy: {{policy.base}}', {}, sheet), /Base policy: 30 days/);
  assert.equal(renderTemplate('missing: {{nope}}', {}), 'missing: ');
});

test('joint: greeter cells execute like any softjoint but are receipted as greeters', async () => {
  const sheet = fixtureSheet();
  sheet.cells.push({
    kind: 'softjoint', id: 'greet.greeter', inputs: ['customer_text'], vector: { dim: 4, labels: LABELS },
    backend: { type: 'deepinfra-chat', model: 'granite-4.2-3b', prompt_template: 'Greet: {{customer_text}}' },
    fallback: { type: 'default', value: 'Welcome in!', note: 'dark channel' },
    greeter: true, notes: 'GREETER: never decomposed — the welcome is the product',
  });
  defaultCache.clear();
  const r = await evalJoint(sheet, 'greet.greeter', { text: 'hi', cells: { customer_text: 'hi' } }, { client: okChat });
  assert.equal(r.source, 'model');
  assert.equal(r.receipt.greeter, true);
});

test('joint: bucket for cache/freeze comes from the deterministic LOCAL sensor', () => {
  const v = deriveVector('MONEY BACK NOW, broken, furious', {}, LABELS);
  const b = bucketVector(v, LABELS);
  assert.equal(b, bucketVector(deriveVector('broken, give me my money back NOW', {}, LABELS), LABELS),
    'same-signal moments must land in the same bucket regardless of word order');
  assert.match(b, /urgency:hi/);
});

test('joint: appendReceipt integration — joint receipts fit the ledger shape', async () => {
  const sheet = fixtureSheet();
  defaultCache.clear();
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tests', '.tmp-'));
  const file = path.join(dir, 'ledger.jsonl');
  appendReceipt(file, { kind: 'decomposition-receipt', note: 'seed' });
  const r = await evalJoint(sheet, 'refund.softjoint', { text: 'broken now', cells: { customer_text: 'x' } }, { client: okSystemone, receiptsFile: file });
  const { readReceipts } = await import('../src/store.js');
  const { records, bad_lines } = readReceipts(file);
  assert.equal(bad_lines.length, 0);
  assert.equal(records.length, 2);
  assert.equal(records[1].kind, 'joint-call');
  assert.equal(records[1].cell_id, 'refund.softjoint');
  assert.equal(records[1].seq, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
