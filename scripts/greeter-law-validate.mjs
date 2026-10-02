#!/usr/bin/env node
// scripts/greeter-law-validate.mjs — GREETER-LAW VALIDATION (wave-72, lane 72-b).
//
// Runs src/greeter.js's greeterLiftTest + greeterTerritoryVerdict on the
// storefront's REAL 71-c corpus (GREETER-DEMO-1), in RECEIPTED-REPLAY mode:
// every table answer, model answer, and judge score is ADOPTED from the
// receipted run (quilt-storefront eval/greeter-demo-results-r2.json — 6/6
// calls receipted by lane 71-c). ZERO new model calls: re-judging receipted
// pairs would double-spend the budget (the 71-c-r2 verify-then-adopt
// precedent). The judge arms are replayed blind — scores were produced with
// source hidden and letters seeded per pair, sealed before that run.
//
// Two corpora, one instrument, opposite signs (docs/greeter-law.md):
//   corpus A — the 12 greeter moments  : expect lift ≤ 0 → GREETER-TERRITORY
//   corpus B — the 6 fact-bearing controls: expect lift > 0 → territory REFUSED
//
// Output: receipts/greeter-law-validation.json — the results document scored
// by fleet-seeds tools/preregister.mjs against seeds/preregister-72b.*.
// Zero network (reads sibling-repo files; the repos ship together).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { greeterLiftTest, greeterTerritoryVerdict } from '../src/greeter.js';

const SF = fileURLToPath(new URL('../../quilt-storefront/', import.meta.url));
const sha256File = (p) => 'sha256:' + createHash('sha256').update(readFileSync(p)).digest('hex');

const battery = JSON.parse(readFileSync(SF + 'eval/greeter-battery.json', 'utf8'));
const run = JSON.parse(readFileSync(SF + 'eval/greeter-demo-results-r2.json', 'utf8'));
const sheet = JSON.parse(readFileSync(SF + 'sheets/storefront.json', 'utf8'));

// fail-closed pre-flight: the replay binds the SAME receipted artifacts the
// 71-c demo scored (battery sha receipted in the run document itself).
if (run.battery_sha256 !== sha256File(SF + 'eval/greeter-battery.json')) {
  console.error('[pre-flight] battery sha drift vs the receipted run — refusing to replay');
  process.exit(1);
}

// mapAnswer — copied VERBATIM from quilt-storefront eval/greeter-demo-common.js
// (itself copied verbatim from eval/live-freeze-69a.js). Any drift is a scoring
// bug; keep in sync. (Importing that file would execute its analysis.)
function mapAnswer(answer) {
  const text = String(answer ?? '');
  const hits = [];
  for (const [cls, re] of [
    ['full refund', /full refund/i],
    ['store credit', /store credit/i],
    ['manager review', /manager review|manager will|manager can/i],
  ]) {
    const m = text.match(re);
    if (m) hits.push({ cls, at: m.index });
  }
  if (hits.length === 0) return { cls: null, ambiguous: false, hits };
  hits.sort((a, b) => a.at - b.at);
  return { cls: hits[0].cls, ambiguous: hits.length > 1, hits: hits.map(h => h.cls) };
}

const armAById = new Map(run.armA.rows.map((r) => [r.id, r]));
const armBById = new Map(run.armB.rows.map((r) => [r.id, r]));
const armCById = new Map(run.armC.rows.map((r) => [r.id, r]));
const pairById = new Map(run.judge.blind_pairs.map((p) => [p.id, p]));
const frozenTable = sheet.cells.find((c) => c.id === 'refunder.frozen')?.table || {};
const policyCell = sheet.cells.find((c) => c.id === 'refund-policy');
const greeterVoice = sheet.cells.find((c) => c.id === 'greeter.voice');

// pre-flight assertions: the structural halves of the selection rule, read from
// the receipted sheet + battery (never guessed here).
if (greeterVoice?.factRequired) { console.error('[pre-flight] greeter.voice is factRequired?'); process.exit(1); }
if (!battery.greeterMoments.every((m) => m.modelServed === armBById.has(m.id))) {
  console.error('[pre-flight] battery modelServed flags disagree with the receipted arm B subsample');
  process.exit(1);
}

// ---- corpus A: the 12 greeter moments (the greeter joint) --------------------
const corpusA = battery.greeterMoments.map((m) => {
  const a = armAById.get(m.id);
  const b = armBById.get(m.id) || null;
  const p = pairById.get(m.id) || null;
  return { id: m.id, family: m.family, modelServed: m.modelServed, greeterReply: a?.reply ?? null, modelReply: b?.answer ?? null, pair: p ? { table: p.greeter, model: p.model } : null };
});

const measurementA = await greeterLiftTest(corpusA, {
  tableFn: (m) => m.greeterReply,   // the receipted authored serving (greeter path, zero model)
  modelFn: (m) => m.modelReply,     // the receipted seat answer (4 moments) / receipted not-served (8 → null)
  judgeFn: (m) => m.pair,           // the receipted blind-judge scores (letters seeded, source hidden — 71-c)
});
const verdictA = greeterTerritoryVerdict(measurementA, {
  outcomeFree: true, // battery groundRules: greeter moments carry NO policy ruling; greeter.voice declares no factRequired
});

// ---- corpus B: the 6 fact-bearing controls (the fact joint) -------------------
const corpusB = battery.factControls.map((c) => {
  const r = armCById.get(c.id);
  if (!r) throw new Error(`corpus B: no receipted row for ${c.id}`);
  let tableAnswer;
  let tableSource;
  if (r.frozen?.region && frozenTable[r.frozen.region]?.answer) {
    // the receipted frozen-first serving IS the table arm — cross-check the row
    if (frozenTable[r.frozen.region].answer !== r.reply) throw new Error(`${c.id}: frozen row != receipted reply`);
    tableAnswer = frozenTable[r.frozen.region].answer;
    tableSource = `frozen row ${r.frozen.region}`;
  } else {
    // the table-only arm where the region never froze: the joint's own fallback
    // lookup (refund-policy) — the sheet's answer without the model seat.
    tableAnswer = policyCell?.table?.default ?? policyCell?.default ?? null;
    tableSource = 'joint fallback lookup (refund-policy) — the region is receipted un-frozen';
  }
  return { id: c.id, expected: c.expected, expectFrozen: c.expectFrozen, frozenRegion: r.frozen?.region ?? null, tableAnswer, tableSource, modelAnswer: r.reply, ruled: r.ruled ?? null };
});

const measurementB = await greeterLiftTest(corpusB, {
  tableFn: (c) => c.tableAnswer,
  modelFn: (c) => c.modelAnswer,
  judgeFn: (_c, tableAnswer, modelAnswer) => ({
    // the MECHANICAL outcome judge (the receipted P3 accounting): an answer
    // scores 1 iff it names exactly the expected policy outcome class.
    table: mapAnswer(tableAnswer).cls === _c.expected && !mapAnswer(tableAnswer).ambiguous ? 1 : 0,
    model: mapAnswer(modelAnswer).cls === _c.expected && !mapAnswer(modelAnswer).ambiguous ? 1 : 0,
  }),
});
const verdictB = greeterTerritoryVerdict(measurementB, {
  outcomeFree: false, // refunder.joint is factRequired — outcomes bind to FACTS (§5b-v2)
});

const pick = (m, v) => ({
  lift: m.lift, usablePairs: m.usablePairs, unpaired: m.unpaired, n: m.n,
  modelMean: m.modelMean, tableMean: m.tableMean, vacuous: m.vacuous,
  outcomeFree: v.outcomeFree, territory: v.greeterTerritory,
});

const results = {
  at_utc: new Date().toISOString(),
  lane: '72-b (greeter-law upstream — the tell as a joint-selection rule)',
  instrument: 'quilt-softjoints src/greeter.js greeterLiftTest + greeterTerritoryVerdict (docs/greeter-law.md)',
  mode: 'receipted-replay of GREETER-DEMO-1 (71-c): ZERO new model calls — every table answer, model answer and judge score adopted from the receipted run (verify-then-adopt; re-judging would double-spend)',
  sources: {
    battery: sha256File(SF + 'eval/greeter-battery.json'),
    receipted_run: 'eval/greeter-demo-results-r2.json (receipts: runs/greeter-demo-*.jsonl, 6/6 calls, lane 71-c)',
    battery_sha: run.battery_sha256,
    live_sheet_sha: run.live_sheet_sha256,
    corpus_files: {
      battery: 'quilt-storefront eval/greeter-battery.json',
      run: 'quilt-storefront eval/greeter-demo-results-r2.json',
      sheet: 'quilt-storefront sheets/storefront.json',
    },
  },
  metrics: {
    greeter: pick(measurementA, verdictA),
    controls: pick(measurementB, verdictB),
  },
  evidence: {
    corpusA_greeterMoments: corpusA.map((m, i) => ({
      id: m.id, family: m.family, modelServed: m.modelServed,
      tableScore: measurementA.perItem[i].table, modelScore: measurementA.perItem[i].model,
      paired: measurementA.perItem[i].paired,
      greeterReply: m.greeterReply, modelReply: m.modelReply,
    })),
    corpusB_factControls: corpusB.map((c, i) => ({
      id: c.id, expected: c.expected, tableSource: c.tableSource, frozenRegion: c.frozenRegion,
      tableScore: measurementB.perItem[i].table, modelScore: measurementB.perItem[i].model,
      paired: measurementB.perItem[i].paired,
      tableAnswer: c.tableAnswer, modelAnswer: c.modelAnswer,
    })),
    outcomeFreeReads: {
      greeterVoice: 'no factRequired/requiredFacts/outcome binding; battery groundRules: greeter moments carry NO policy ruling',
      refunderJoint: 'factRequired:true, requiredFacts:[receipt-mentioned] — outcomes bind to facts (§5b-v2); territory refused on (a) alone',
    },
    judgeProvenance: 'blind-judge scores receipted by 71-c (nvidia/NVIDIA-Nemotron-3.5-Lightning @ temp 0, letters seeded per pair, source hidden, 1280 tokens) — replayed verbatim, re-judged by NOBODY here',
  },
  claimsHashExpected: 'scored by fleet-seeds tools/preregister.mjs against seeds/preregister-72b.json (sealed BEFORE this run)',
};

const { writeFileSync } = await import('node:fs');
// GREETER_LAW_OUT: the PRE-SEAL dry-run's output path (the fleet's dry-run-then-run
// pattern); the scored run uses the default receipts path AFTER the seal is pushed.
const out = process.env.GREETER_LAW_OUT || fileURLToPath(new URL('../receipts/greeter-law-validation.json', import.meta.url));
writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
console.log('[greeter-law] corpus A (12 greeter moments): lift', measurementA.lift, '| usablePairs', measurementA.usablePairs, '| territory', verdictA.greeterTerritory);
console.log('[greeter-law] corpus B (6 fact controls):   lift', measurementB.lift, '| usablePairs', measurementB.usablePairs, '| territory', verdictB.greeterTerritory);
console.log('[greeter-law] results written:', out);
