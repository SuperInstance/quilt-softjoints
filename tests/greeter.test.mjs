// tests/greeter.test.mjs — the GREETER-LAW (wave-72): the wrong-joint tell as a
// joint-selection rule. docs/greeter-law.md. Zero network; synthetic corpora.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decompose, freezingTest } from '../src/decompose.js';
import { runJoint, clearCache } from '../src/joint.js';
import { greeterLiftTest, greeterTerritoryVerdict } from '../src/greeter.js';

// ---- greeterLiftTest: the arithmetic of the tell -----------------------------

const PAIRS = [
  { id: 'a', table: 'table a', model: 'model a', scores: { table: 9, model: 8 } },
  { id: 'b', table: 'table b', model: 'model b', scores: { table: 8, model: 9 } },
  { id: 'c', table: 'table c', model: 'model c', scores: { table: 9, model: 7 } },
  { id: 'd', table: 'table d', model: 'model d', scores: { table: 7, model: 8 } },
]; // the 71-c shape: split 2–2, table mean 8.25, model mean 8.0, lift −0.25

function corpus(items, { modelSilentFor = [], judgeRefuses = [] } = {}) {
  return items.map((it) => ({
    ...it,
    modelSilent: modelSilentFor.includes(it.id),
    judgeRefuses: judgeRefuses.includes(it.id),
  }));
}

test('greeterLiftTest measures negative lift on a 71-c-shaped corpus (agreement without lift)', async () => {
  const moments = corpus(PAIRS);
  const m = await greeterLiftTest(moments, {
    tableFn: (x) => x.table,
    modelFn: (x) => (x.modelSilent ? null : x.model),
    judgeFn: (x) => (x.judgeRefuses ? null : { table: x.scores.table, model: x.scores.model }),
  });
  assert.equal(m.n, 4);
  assert.equal(m.usablePairs, 4);
  assert.equal(m.unpaired, 0);
  assert.equal(m.tableMean, 8.25);
  assert.equal(m.modelMean, 8);
  assert.equal(m.lift, -0.25);
  assert.equal(m.vacuous, false);
});

test('greeterLiftTest is positive when the vote changes the outcome (the seat earns its keep)', async () => {
  // the fact-control shape (receipted 71-c): the frozen rows rule 5 correct;
  // on the un-frozen control the table-only arm cannot rule (policy prose that
  // names no single outcome) while the live seat rules it — the vote moved it.
  const moments = [
    { id: 'c1', table: 'row1: full refund', model: 'row1: full refund', tableOk: 1, modelOk: 1 },
    { id: 'c2', table: 'row2: store credit', model: 'row2: store credit', tableOk: 1, modelOk: 1 },
    { id: 'c3', table: 'row3: full refund', model: 'row3: full refund', tableOk: 1, modelOk: 1 },
    { id: 'c4', table: 'row4: store credit', model: 'row4: store credit', tableOk: 1, modelOk: 1 },
    { id: 'c5', table: 'row5: store credit', model: 'row5: store credit', tableOk: 1, modelOk: 1 },
    { id: 'c6', table: 'Our policy: full refund within 7 days with a receipt, store credit without.', model: 'store credit for the broken toaster', tableOk: 0, modelOk: 1 },
  ];
  const m = await greeterLiftTest(moments, {
    tableFn: (x) => x.table,
    modelFn: (x) => x.model,
    judgeFn: (x) => ({ table: x.tableOk, model: x.modelOk }), // the mechanical outcome judge
  });
  assert.equal(m.usablePairs, 6);
  assert.equal(m.unpaired, 0);
  assert.ok(m.lift > 0, `outcome-axis lift must be > 0, got ${m.lift}`);
  assert.ok(Math.abs(m.lift - 1 / 6) < 1e-9);
  assert.ok(Math.abs(m.tableMean - 5 / 6) < 1e-9);
});

test('greeterLiftTest receipts unpaired moments and judge refusals — zero pairs is VACUOUS, never PASS', async () => {
  const silent = await greeterLiftTest(corpus(PAIRS, { modelSilentFor: ['a', 'b', 'c', 'd'] }), {
    tableFn: (x) => x.table, modelFn: () => null, judgeFn: () => { throw new Error('judge must not be called'); },
  });
  assert.equal(silent.usablePairs, 0);
  assert.equal(silent.unpaired, 4);
  assert.equal(silent.lift, null);
  assert.equal(silent.vacuous, true);
  const refused = await greeterLiftTest(corpus(PAIRS, { judgeRefuses: ['a', 'b', 'c', 'd'] }), {
    tableFn: (x) => x.table, modelFn: (x) => x.model, judgeFn: () => null,
  });
  assert.equal(refused.usablePairs, 0);
  assert.equal(refused.vacuous, true);
  assert.ok(refused.perItem.every((r) => r.judgeRefused === true), 'judge refusals receipted per item');
});

test('greeterLiftTest is fail-closed on missing arms', async () => {
  await assert.rejects(() => greeterLiftTest([], { modelFn: async () => 1, judgeFn: async () => ({}) }));
  await assert.rejects(() => greeterLiftTest('nope', { tableFn: async () => 1, modelFn: async () => 1, judgeFn: async () => ({}) }));
});

// ---- greeterTerritoryVerdict: the selection rule -----------------------------

test('the selection rule: outcome-free + no lift → greeter-territory (both conditions required)', () => {
  const measured = { lift: -0.25, usablePairs: 4 };
  assert.equal(greeterTerritoryVerdict(measured, { outcomeFree: true }).greeterTerritory, true);
  // (a) fails: outcomes bind to facts — never greeter territory
  assert.equal(greeterTerritoryVerdict(measured, { outcomeFree: false }).greeterTerritory, false);
  // (b) fails: the seat adds lift — the region stays open to the model
  assert.equal(greeterTerritoryVerdict({ lift: 0.5, usablePairs: 4 }, { outcomeFree: true }).greeterTerritory, false);
  // (b) vacuous: zero usable pairs refuses (murmuration law), never passes
  assert.equal(greeterTerritoryVerdict({ lift: null, usablePairs: 0 }, { outcomeFree: true }).greeterTerritory, false);
  // lift == 0 is still no lift (≤ 0): agreement at the table's level is the tell
  assert.equal(greeterTerritoryVerdict({ lift: 0, usablePairs: 3 }, { outcomeFree: true }).greeterTerritory, true);
});

// ---- decompose: the greeterTerritory dimension (additive) ---------------------

const spec = {
  id: 'greeter-law-domain',
  behaviors: [
    { id: 'hours', kind: 'deterministic', map: { 'mon-fri': '7-9' }, default: 'call' },
    { id: 'warmth', kind: 'connection', notes: 'human surface', greeter_route: 'lexicon', greeter_miss: 'ask-back', ask_back: 'ask-back' },
    { id: 'hunch', kind: 'judgment', vector: { dim: 2, labels: ['urgency', 'warmth'] } },
    { id: 'ruling', kind: 'judgment', factRequired: true, requiredFacts: ['receipt-mentioned'], vector: { dim: 2, labels: ['distress', 'goodwill'] } },
  ],
};
const EVIDENCE = { lift: -0.25, usablePairs: 4 };

test('decompose without liftReports is byte-identical v1 (no greeterTerritory keys anywhere)', () => {
  const { sheet, receipts } = decompose(spec);
  for (const c of sheet.cells) assert.equal(c.greeterTerritory, undefined, 'no tag without evidence');
  for (const r of receipts) assert.equal(r.greeterTerritory, undefined);
  assert.equal(sheet.meta.counts.greeterTerritory, undefined);
});

test('decompose tags greeter-territory on (a)+(b) evidence and passes routing hints through', () => {
  const { sheet, receipts } = decompose(spec, { liftReports: { warmth: EVIDENCE, hunch: EVIDENCE, ruling: EVIDENCE } });
  const warmth = sheet.cells.find((c) => c.id === 'warmth');
  const hunch = sheet.cells.find((c) => c.id === 'hunch');
  const ruling = sheet.cells.find((c) => c.id === 'ruling');
  assert.equal(warmth.greeterTerritory, true, 'outcome-free connection + lift ≤ 0 → tagged');
  assert.equal(warmth.greeter_route, 'lexicon');
  assert.equal(warmth.greeter_miss, 'ask-back');
  assert.equal(warmth.ask_back, 'ask-back');
  assert.equal(hunch.greeterTerritory, true, 'an outcome-free judgment region can be greeter territory too');
  assert.equal(hunch.greeter_route, undefined, 'no hints declared → none passed');
  assert.equal(ruling.greeterTerritory, false, 'factRequired is FACT territory — the tell never tags it');
  assert.match(receipts.find((r) => r.behavior === 'ruling').greeterTerritory.reason, /FACT territory/);
  assert.equal(sheet.meta.counts.greeterTerritory, 2);
});

test('decompose refuses the tag when the lift evidence shows lift > 0 or zero usable pairs', () => {
  const lift = decompose(spec, { liftReports: { warmth: { lift: 0.5, usablePairs: 4 } } });
  assert.equal(lift.sheet.cells.find((c) => c.id === 'warmth').greeterTerritory, false);
  const vacuous = decompose(spec, { liftReports: { warmth: { lift: -1, usablePairs: 0 } } });
  assert.equal(vacuous.sheet.cells.find((c) => c.id === 'warmth').greeterTerritory, false);
});

// ---- freezingTest: greeter-territory regions never freeze ---------------------

test('freezingTest exempts greeter-territory regions from freeze-proposals (they never freeze)', () => {
  const obs = [
    { vector: { warmth: 0.9 }, output: 'authored line 1' },
    { vector: { warmth: 0.9 }, output: 'authored line 1' },
    { vector: { warmth: 0.9 }, output: 'authored line 1', greeterTerritory: true }, // unanimous n=3 — and still no proposal
    { vector: { urgency: 0.9 }, output: 'ruling A' },
    { vector: { urgency: 0.9 }, output: 'ruling A' },
    { vector: { urgency: 0.9 }, output: 'ruling A' },
  ];
  const proposals = freezingTest(obs, { threshold: 3 });
  assert.equal(proposals.length, 1, 'only the fact region proposes');
  assert.equal(proposals[0].region, 'urgency:2');
  const d = freezingTest(obs, { threshold: 3, detail: true });
  assert.equal(d.proposals.length, 1);
  assert.deepEqual(d.greeterExempt, [{
    region: 'warmth:2', n: 3, flagged: 1, source: 'observation-flag',
    note: 'greeter-territory: exempt from freezing (relationship joint, not a lookup — docs/greeter-law.md)',
  }]);
  // exemptRegions keys exempt without per-observation flags
  const obsNoFlag = obs.map(({ greeterTerritory, ...rest }) => rest);
  const byKey = freezingTest(obsNoFlag, { threshold: 3, exemptRegions: ['warmth:2'], detail: true });
  assert.equal(byKey.proposals.length, 1);
  assert.equal(byKey.greeterExempt[0].source, 'exemptRegions');
  assert.equal(byKey.greeterExempt[0].flagged, 0);
  // v1/v2 shape stays a bare array
  assert.ok(Array.isArray(freezingTest(obs, { threshold: 3 })));
});

// ---- runJoint: greeter-first routing -------------------------------------------

function lawSheet({ askBack = true } = {}) {
  return {
    cells: [
      {
        id: 'lexicon', kind: 'lookup', inputs: ['key'],
        keymap: { 'good morning': 'morning' },
        table: { morning: 'Good morning! It is good to see you.' },
        default: null,
      },
      ...(askBack ? [{ id: 'ask-back', kind: 'lookup', inputs: ['key'], table: { default: 'What can I help you find today?' }, default: 'What can I help you find today?' }] : []),
      {
        id: 'voice', kind: 'softjoint', greeter: true,
        greeterTerritory: true, greeter_route: 'lexicon',
        ...(askBack ? { greeter_miss: 'ask-back', ask_back: 'ask-back' } : {}),
        vector: { dim: 2, labels: ['warmth', 'mood'] },
        backend: { type: 'local', model: 'stub' },
        fallback: null,
      },
      {
        id: 'plain', kind: 'softjoint', greeter: false,
        vector: { dim: 1, labels: ['x'] },
        backend: { type: 'local', model: 'stub' },
        fallback: { type: 'default', note: null },
      },
    ],
  };
}
const spyBackend = () => ({ type: 'local', model: 'spy', calls: 0, async call() { this.calls++; return { answer: 'MODEL VOTE', vector: { warmth: 0.5, mood: 0.5 }, confidence: 1, usage: null, latency_ms: 0, model: 'spy' }; } });

test('runJoint routes greeter-territory cells greeter-first: table hit serves at zero model cost', async () => {
  clearCache();
  const sheet = lawSheet();
  const backend = spyBackend();
  const out = await runJoint(sheet, 'voice', { state: { message: 'good morning! lovely day' }, vector: { warmth: 0.9, mood: 0.8 } }, { backend, cache: false });
  assert.equal(out.source, 'greeter-table');
  assert.equal(out.answer, 'Good morning! It is good to see you.');
  assert.equal(out.greeter_first, true);
  assert.equal(out.usage, null);
  assert.equal(backend.calls, 0, 'the model seat is never spent on a table hit');
});

test('runJoint greeter-first with the ask-back strength: a table miss lands on the ask-back, never the model', async () => {
  clearCache();
  const sheet = lawSheet();
  const backend = spyBackend();
  const out = await runJoint(sheet, 'voice', { state: { message: 'something entirely unregistered' }, vector: null }, { backend, cache: false });
  assert.equal(out.source, 'ask-back');
  assert.equal(out.answer, 'What can I help you find today?');
  assert.equal(out.routed_to, 'ask-back');
  assert.equal(out.routed_via, 'greeter-ask-back');
  assert.equal(backend.calls, 0, 'the model seat is bypassed even on a miss');
});

test('runJoint greeter-first default strength: model only if the table misses (the demoted seat)', async () => {
  clearCache();
  const sheet = lawSheet({ askBack: false }); // no ask-back declared → default strength
  const backend = spyBackend();
  const out = await runJoint(sheet, 'voice', { state: { message: 'something entirely unregistered' }, vector: null }, { backend, cache: false });
  assert.equal(out.source, 'local');
  assert.equal(out.answer, 'MODEL VOTE');
  assert.equal(backend.calls, 1, 'the demoted seat runs only on the miss');
  const hit = await runJoint(sheet, 'voice', { state: { message: 'good morning' }, vector: null }, { backend, cache: false });
  assert.equal(hit.source, 'greeter-table');
  assert.equal(backend.calls, 1, 'and never on a hit');
});

test('runJoint greeter-first with a missing ask-back cell fails closed toward silence (no-script law)', async () => {
  clearCache();
  const sheet = lawSheet();
  const ab = sheet.cells.find((c) => c.id === 'ask-back');
  ab.table = {}; ab.default = null; // the ask-back itself is empty (both carriers)
  const backend = spyBackend();
  const out = await runJoint(sheet, 'voice', { state: { message: 'unregistered' }, vector: null }, { backend, cache: false });
  assert.equal(out.source, 'ask-back');
  assert.equal(out.answer, null);
  assert.match(out.reason, /silence/);
  assert.equal(backend.calls, 0);
});

test('an untagged joint keeps the plain order (no greeter-first interference)', async () => {
  clearCache();
  const sheet = lawSheet();
  const backend = spyBackend();
  const out = await runJoint(sheet, 'plain', { state: { message: 'good morning' }, vector: {} }, { backend, cache: false });
  assert.equal(out.source, 'local');
  assert.equal(out.answer, 'MODEL VOTE');
});
