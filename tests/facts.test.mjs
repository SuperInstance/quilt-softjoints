// tests/facts.test.mjs — wave-68 lane 68-a: the FACT/TONE contract, under test.
//
// The wave-67 diagnosis codified: facts decide outcomes, emotion decides tone.
// Covers: the Fact schema, the discrete facts class, the E_FACTS_REQUIRED gate
// (refused BEFORE any backend call — never guessed), refusal routing
// (fact_fallback → greeter → fallback), fact-starved region classification,
// the requireFacts freezing law, v1 byte-compatibility, and the cache identity
// law (facts part of the cache key). Mock backends only — no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runJoint, routeFactRefusal, bucketVector, clearCache,
} from '../src/joint.js';
import {
  E_FACTS_REQUIRED, isValidFact, validateFacts, factsClass,
  missingRequiredFacts, momentFacts, makeModelFactExtractor,
} from '../src/facts.js';
import { freezingTest, classifyRegion } from '../src/decompose.js';

const RECEIPT = { kind: 'receipt-mentioned', value: true, evidence: 'I have the receipt', how: 'rule' };
const RECEIPT_NO = { kind: 'receipt-mentioned', value: false, evidence: 'threw the receipt away', how: 'rule' };
const RECEIPT_UNKNOWN = { kind: 'receipt-mentioned', value: null, evidence: null, how: 'rule' };
const ITEM = { kind: 'item', value: 'socks', evidence: 'these socks', how: 'rule' };

const sheet = {
  cells: [
    { id: 'policy', kind: 'lookup', table: {}, default: 'policy-text' },
    {
      id: 'refunder', kind: 'softjoint', greeter: false,
      factRequired: true, requiredFacts: ['receipt-mentioned'],
      fact_fallback: 'ask-receipt',
      vector: { dim: 3, labels: ['distress', 'goodwill', 'repeat-customer'] },
      backend: { type: 'local', model: 'stub' },
      fallback: { type: 'lookup', ref: 'policy' },
    },
    {
      id: 'no-fact-fb', kind: 'softjoint', greeter: false,
      factRequired: true, requiredFacts: ['receipt-mentioned'],
      vector: { dim: 1, labels: ['x'] },
      backend: { type: 'local', model: 'stub' },
      fallback: { type: 'lookup', ref: 'policy' },
    },
    {
      id: 'greeter.voice', kind: 'softjoint', greeter: true,
      vector: { dim: 2, labels: ['warmth', 'mood'] },
      backend: { type: 'local', model: 'stub' },
      fallback: null,
    },
    { id: 'ask-receipt', kind: 'lookup', table: {}, default: 'Do you have the receipt? With it, a full refund within 7 days; without, store credit.' },
    {
      id: 'plain-joint', kind: 'softjoint', greeter: false,
      vector: { dim: 2, labels: ['urgency', 'warmth'] },
      backend: { type: 'local', model: 'stub' },
      fallback: { type: 'lookup', ref: 'policy' },
    },
  ],
};

let backendCalls = 0;
function countingBackend() {
  return {
    type: 'local', model: 'counter',
    async call() {
      backendCalls += 1;
      return { answer: 'full refund', vector: { distress: 0.5, goodwill: 0.5, 'repeat-customer': 0.5 }, confidence: 1, usage: null, latency_ms: 0, model: 'counter' };
    },
  };
}

// ---- the Fact schema --------------------------------------------------------

test('fact schema: kind/evidence/how required, value boolean|number|string|null', () => {
  assert.ok(isValidFact(RECEIPT));
  assert.ok(isValidFact(RECEIPT_UNKNOWN), 'a stated-unknown (null) is a fact, not a gap');
  assert.ok(!isValidFact({ kind: 'receipt-mentioned', value: true }), 'no how = no provenance = not a fact');
  assert.ok(!isValidFact({ kind: 'Receipt Mentioned', value: true, how: 'rule' }), 'kind is snake-case');
  assert.ok(!isValidFact({ kind: 'x', value: true, how: 'vibes' }), 'unknown authority refused');
  assert.equal(validateFacts(undefined).starved, true, 'a v1 moment is fact-STARVED, not invalid');
  assert.equal(validateFacts([RECEIPT, ITEM]).ok, true);
  assert.equal(validateFacts('receipt').ok, false);
});

test('factsClass: discrete key, sorted, numbers bucketed, starved = ∅facts', () => {
  assert.equal(factsClass([]), '∅facts');
  assert.equal(factsClass(undefined), '∅facts');
  const a = factsClass([RECEIPT, ITEM]);
  const b = factsClass([ITEM, RECEIPT]);
  assert.equal(a, 'item:socks|receipt-mentioned:true', 'exact discrete values, sorted');
  assert.equal(a, b, 'order-independent');
  assert.equal(factsClass([RECEIPT_UNKNOWN]), 'receipt-mentioned:null', 'stated-unknown is visible in the key');
  assert.equal(factsClass([{ kind: 'days-elapsed', value: 0.9, how: 'rule' }]), 'days-elapsed:2', 'numbers bucket like vectors');
});

test('missingRequiredFacts: covered means non-null; stated-unknown does NOT cover', () => {
  assert.deepEqual(missingRequiredFacts(['receipt-mentioned'], [RECEIPT]), []);
  assert.deepEqual(missingRequiredFacts(['receipt-mentioned'], [RECEIPT_NO]), []);
  assert.deepEqual(missingRequiredFacts(['receipt-mentioned'], [RECEIPT_UNKNOWN]), ['receipt-mentioned'],
    'null value is an UN-grounded fact: the ruling would still be a guess');
  assert.deepEqual(missingRequiredFacts(['receipt-mentioned'], [ITEM]), ['receipt-mentioned']);
  assert.deepEqual(missingRequiredFacts(['receipt-mentioned'], undefined), ['receipt-mentioned']);
});

// ---- the E_FACTS_REQUIRED gate ---------------------------------------------

test('factRequired joint on a fact-STARVED moment: E_FACTS_REQUIRED, zero backend calls', async () => {
  clearCache(); backendCalls = 0;
  const out = await runJoint(sheet, 'refunder', { state: { message: 'the milk I bought yesterday spoiled and I am upset' }, vector: { distress: 0.42, goodwill: 0.4, 'repeat-customer': 0.2 } }, { backend: countingBackend(), cache: false });
  assert.equal(out.source, 'fact-refused');
  assert.equal(out.error, E_FACTS_REQUIRED);
  assert.deepEqual(out.missingFacts, ['receipt-mentioned']);
  assert.match(out.reason, /fact-starved/);
  assert.equal(backendCalls, 0, 'the refusal happens BEFORE any backend call — never guessed');
  assert.equal(out.answer, null, 'no ruling is produced');
});

test('factRequired joint with a stated-unknown required fact: still refused (grounded or nothing)', async () => {
  clearCache(); backendCalls = 0;
  const out = await runJoint(sheet, 'refunder', { state: {}, vector: {}, facts: [RECEIPT_UNKNOWN, ITEM] }, { backend: countingBackend(), cache: false });
  assert.equal(out.error, E_FACTS_REQUIRED);
  assert.deepEqual(out.missingFacts, ['receipt-mentioned']);
  assert.match(out.reason, /not grounded/);
  assert.equal(backendCalls, 0);
});

test('factRequired joint with grounded facts: rules normally', async () => {
  clearCache(); backendCalls = 0;
  const out = await runJoint(sheet, 'refunder', { state: {}, vector: {}, facts: [RECEIPT, ITEM] }, { backend: countingBackend(), cache: false });
  assert.equal(out.source, 'local');
  assert.equal(out.answer, 'full refund');
  assert.equal(backendCalls, 1);
});

test('v1 joints are untouched by the gate: a fact-less moment rules as before (additive law)', async () => {
  clearCache(); backendCalls = 0;
  const out = await runJoint(sheet, 'plain-joint', { state: { m: 1 }, vector: { urgency: 0.2, warmth: 0.8 } }, { backend: countingBackend(), cache: false });
  assert.equal(out.source, 'local');
  assert.equal(backendCalls, 1, 'no factRequired declared → no gate');
});

// ---- refusal routing ---------------------------------------------------------

test('routeFactRefusal: fact_fallback first, then greeter, then fallback ref, else null', () => {
  assert.deepEqual(routeFactRefusal(sheet, 'refunder'), { route: 'ask-receipt', via: 'fact_fallback' });
  assert.deepEqual(routeFactRefusal(sheet, 'no-fact-fb'), { route: 'greeter.voice', via: 'greeter' },
    'without a declared fact_fallback the moment routes to the GREETER — the human connection surface');
  assert.equal(routeFactRefusal({ cells: [] }, 'refunder'), null);
});

// ---- region classification + freezing v2 ------------------------------------

test('classifyRegion: fact-starved marked, facts join the region key, v1 vector untouched', () => {
  const emotion = { distress: 0.42, goodwill: 0.4, 'repeat-customer': 0.2 };
  const starved = classifyRegion({ vector: emotion });
  assert.equal(starved.factStarved, true);
  assert.equal(starved.region, `${bucketVector(emotion)}|∅facts`, 'starved is VISIBLE, never merged');
  const bear = classifyRegion({ vector: emotion, facts: [RECEIPT, ITEM] });
  assert.equal(bear.factStarved, false);
  assert.equal(bear.region, `${bucketVector(emotion)}|item:socks|receipt-mentioned:true`);
});

test('freezingTest v1: byte-identical region keys when requireFacts is not set', () => {
  const v = { distress: 0.42, goodwill: 0.4, 'repeat-customer': 0.2 };
  const obs = [
    { vector: v, output: 'store credit' },
    { vector: v, output: 'store credit' },
    { vector: v, output: 'store credit' },
  ];
  const props = freezingTest(obs, { threshold: 3, buckets: 3 });
  assert.equal(props.length, 1);
  assert.equal(props[0].region, 'distress:1|goodwill:1|repeat-customer:0', 'the exact v1 region string');
  assert.equal(props[0].factBearing, undefined, 'v1 proposal shape unchanged');
});

test('freezingTest v2 (requireFacts): a fact-bearing unanimous n>=3 region freezes', () => {
  const calm = { distress: 0.05, goodwill: 0.6, 'repeat-customer': 0.2 };
  const obs = [
    { vector: calm, output: 'full refund', facts: [RECEIPT] },
    { vector: calm, output: 'full refund', facts: [RECEIPT] },
    { vector: calm, output: 'full refund', facts: [RECEIPT] },
  ];
  const props = freezingTest(obs, { threshold: 3, buckets: 3, requireFacts: true });
  assert.equal(props.length, 1, 'the with-receipt calm region froze');
  assert.equal(props[0].region, 'distress:0|goodwill:1|repeat-customer:0|receipt-mentioned:true');
  assert.equal(props[0].factBearing, true);
  assert.equal(props[0].n, 3);
});

test('freezingTest v2: fact-STARVED observations can never freeze an outcome (the wave-67 law)', () => {
  const upset = { distress: 0.42, goodwill: 0.4, 'repeat-customer': 0.2 };
  const calm = { distress: 0.05, goodwill: 0.6, 'repeat-customer': 0.2 };
  // three identical upset-milk observations, NO receipt fact: v1 would freeze this
  const starved = [1, 2, 3].map(() => ({ vector: upset, output: 'full refund' }));
  assert.equal(freezingTest(starved, { threshold: 3, buckets: 3 }).length, 1, 'v1 semantics unchanged');
  assert.equal(freezingTest(starved, { threshold: 3, buckets: 3, requireFacts: true }).length, 0,
    'requireFacts: the emotion-only region is excluded — a frozen outcome keyed on emotion alone is a guess wearing a table\u2019s clothes');
  // the SAME moments with the receipt fact grounded DO freeze
  const grounded = starved.map(o => ({ ...o, facts: [RECEIPT] }));
  assert.equal(freezingTest(grounded, { threshold: 3, buckets: 3, requireFacts: true }).length, 1);
});

test('freezingTest v2: a single fact-starved member poisons its own region only', () => {
  const calm = { distress: 0.05, goodwill: 0.6, 'repeat-customer': 0.2 };
  const grounded = [1, 2, 3].map(() => ({ vector: calm, output: 'full refund', facts: [RECEIPT] }));
  assert.equal(freezingTest(grounded, { threshold: 3, buckets: 3, requireFacts: true }).length, 1);
  const poisoned = [...grounded, { vector: calm, output: 'full refund' }]; // starved member, same emotion, DIFFERENT region
  const props = freezingTest(poisoned, { threshold: 3, buckets: 3, requireFacts: true });
  assert.equal(props.length, 1, 'the grounded region still freezes; the ∅facts region is separate and excluded');
  assert.equal(props[0].region.includes('receipt-mentioned:true'), true);
});

// ---- cache identity -----------------------------------------------------------

test('facts are part of the cache identity: same emotion bucket, different facts, different rulings', async () => {
  clearCache(); backendCalls = 0;
  const B = countingBackend();
  const m1 = { state: { message: 'a' }, vector: { distress: 0.42, goodwill: 0.4, 'repeat-customer': 0.2 }, facts: [RECEIPT] };
  const m2 = { state: { message: 'b' }, vector: { distress: 0.42, goodwill: 0.4, 'repeat-customer': 0.2 }, facts: [RECEIPT_NO] };
  const a = await runJoint(sheet, 'refunder', m1, { backend: B, cache: true });
  const b = await runJoint(sheet, 'refunder', m2, { backend: B, cache: true });
  assert.equal(a.source, 'local');
  assert.equal(b.source, 'local', 'receipt-mentioned:true vs false are DIFFERENT cache slots');
  assert.equal(backendCalls, 2);
  const c = await runJoint(sheet, 'refunder', m1, { backend: B, cache: true });
  assert.equal(c.source, 'cache', 'identical emotion+facts still share a slot');
  assert.equal(backendCalls, 2);
});

// ---- the model extractor adapter ------------------------------------------------

test('makeModelFactExtractor: rules starve, model grounds, ungrounded kinds come back null (never invented)', async () => {
  const ext = makeModelFactExtractor({
    async call({ kinds }) {
      return { facts: [{ kind: 'receipt-mentioned', value: true, evidence: 'receipt is in the bag' }], usage: { total_tokens: 42 } };
    },
  });
  const sink = [];
  const facts = await ext.extract({ state: { message: 'the receipt is in the bag' }, kinds: ['receipt-mentioned', 'item'], usageSink: sink });
  assert.equal(facts.find(f => f.kind === 'receipt-mentioned').value, true);
  assert.equal(facts.find(f => f.kind === 'receipt-mentioned').how, 'model');
  assert.equal(facts.find(f => f.kind === 'item').value, null, 'ungrounded kinds return stated-unknown, never an invented value');
  assert.equal(sink.length, 1, 'the extraction call is receipted (usage sink)');
  assert.throws(() => makeModelFactExtractor({}), /call\(\) required/);
});

test('momentFacts: the v2 read of a moment is backward compatible', () => {
  assert.deepEqual(momentFacts({ state: {} }), { ok: true, facts: [], starved: true });
  assert.deepEqual(momentFacts({ facts: [RECEIPT] }), { ok: true, facts: [RECEIPT], starved: false });
  assert.equal(momentFacts({ facts: 'nope' }).ok, false);
});

// ---- v2.1 (lane 68-a-r2): the kinds filter — context facts never key an outcome

test('factsClass kinds filter: policy facts key the region, context facts ride but never key', () => {
  const full = [RECEIPT, ITEM, { kind: 'defect-claimed', value: true, evidence: 'ripped', how: 'rule' }];
  assert.equal(factsClass(full, { kinds: ['receipt-mentioned'] }), 'receipt-mentioned:true',
    'only the policy-input kinds enter the class');
  assert.equal(factsClass(full, { kinds: ['receipt-mentioned', 'purchase-window'] }),
    'receipt-mentioned:true', 'a missing policy kind simply does not appear (it is stated by absence)');
  assert.equal(factsClass(full), 'defect-claimed:true|item:socks|receipt-mentioned:true',
    'without kinds the class is the full receipt (unchanged)');
  assert.equal(factsClass(full, { kinds: ['purchase-window'] }), '∅facts',
    'a filter matching nothing is ∅facts — no outcome-keying facts, no outcome key');
  assert.equal(factsClass(full, { kinds: [] }), 'defect-claimed:true|item:socks|receipt-mentioned:true',
    'an empty kinds array means NO filter (all kinds), not a filter of nothing');
});

test('freezingTest kinds: the v2 region key sees exactly the policy-input kinds', () => {
  const calm = { distress: 0.05, goodwill: 0.6, 'repeat-customer': 0.2 };
  const obs = [1, 2, 3].map((i) => ({
    vector: calm, output: 'full refund',
    facts: [RECEIPT, { kind: 'item', value: `item-${i}`, evidence: null, how: 'rule' }],
  }));
  // WITHOUT kinds, item-0/1/2 split the region into three n=1 regions — no freeze.
  assert.equal(freezingTest(obs, { threshold: 3, buckets: 3, requireFacts: true }).length, 0,
    'context facts in the key would fracture the region (the bug the filter exists for)');
  // WITH the policy kinds, the three observations share one region and freeze.
  const props = freezingTest(obs, { threshold: 3, buckets: 3, requireFacts: true, kinds: ['receipt-mentioned'] });
  assert.equal(props.length, 1);
  assert.equal(props[0].region, 'distress:0|goodwill:1|repeat-customer:0|receipt-mentioned:true');
});
