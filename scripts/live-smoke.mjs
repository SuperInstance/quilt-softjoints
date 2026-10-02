#!/usr/bin/env node
// scripts/live-smoke.mjs — ONE live smoke run of the general-store quilt.
//
// Budget caps (asserted, hard): TYPESAFE <= 4 calls, DEEPINFRA <= 6 calls.
// Every call lands in receipts/live-smoke.jsonl (append-only, with tokens).
// No answers are cached across probes: each pair runs with a fresh cache so
// the freezing test sees genuine model behavior, not our own memoization.
//
// The freezing test's first real data point: for each softjoint we probe TWO
// moments that the local sensor reads as the same vector region, then check
// whether the model answers the same thing (normalized). Same region + same
// answer => emit a provisional freeze-proposal (never auto-applied).
//
// Keys: TYPESAFE_API_KEY / DEEPINFRA_API_KEY from env, runtime-only, never
// echoed, never receipted. Run: node scripts/live-smoke.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSheet, appendReceipt, readReceipts } from '../src/store.js';
import { evalJoint, makeTypesafeClient, makeDeepInfraClient } from '../src/joint.js';
import { proposeFreezes, bucketVector } from '../src/decompose.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = path.join(ROOT, 'examples', 'store', 'sheet.json');
const LEDGER = path.join(ROOT, 'receipts', 'live-smoke.jsonl');
const RUN = `66a-smoke-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z')}`;

const TYPESAFE_CAP = 4, DEEPINFRA_CAP = 6;
const sheet = loadSheet(SHEET);
const tsClient = makeTypesafeClient({ budget: TYPESAFE_CAP });
const diClient = makeDeepInfraClient({ budget: DEEPINFRA_CAP });
const L = ['urgency', 'familiarity', 'sentiment', 'formality'];

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter(Boolean);
const jaccard = (a, b) => {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let i = 0; for (const t of A) if (B.has(t)) i++;
  return i / (A.size + B.size - i);
};

async function probe(cellId, moments, client, { label }) {
  const out = [];
  for (const m of moments) {
    const r = await evalJoint(sheet, cellId, m, { client, cache: new Map(), receiptsFile: LEDGER });
    out.push({ r, text: m.text });
  }
  const [a, b] = out;
  const record = {
    kind: 'live-smoke-probe', run: RUN, cell_id: cellId, label,
    vector_labels: L,
    probes: out.map(({ r, text }) => ({
      moment_text: text,
      bucket_local: r.bucket, vector_model: r.vector, bucket_model: bucketVector(r.vector, L),
      answer: r.answer, source: r.source, confidence: r.confidence,
      usage: r.receipt.usage, latency_ms: r.receipt.latency_ms, ok: r.receipt.ok, code: r.receipt.code ?? null,
    })),
    local_buckets_match: b ? a.r.bucket === b.r.bucket : null,
    model_buckets_match: b ? bucketVector(a.r.vector, L) === bucketVector(b.r.vector, L) : null,
    answers_normalized_equal: b ? norm(a.r.answer) === norm(b.r.answer) : null,
    answer_jaccard: b ? Number(jaccard(a.r.answer, b.r.answer).toFixed(3)) : null,
  };
  appendReceipt(LEDGER, record);
  return record;
}

// ------------------------------------------------------------- the probes --
console.log(`live smoke ${RUN} — caps: typesafe<=${TYPESAFE_CAP}, deepinfra<=${DEEPINFRA_CAP}`);

// typesafe (decision joint): two angry-refund moments the local sensor reads as one region
const refund = await probe('refund.softjoint', [
  { text: 'This blender broke after two uses and I want my money back now', cells: { customer_text: 'This blender broke after two uses and I want my money back now', customer_name: 'Sam' } },
  { text: 'the kettle I bought here broke on day two — refund time, now', cells: { customer_text: 'the kettle I bought here broke on day two — refund time, now', customer_name: 'Jordan' } },
], tsClient, { label: 'angry-refund pair (decision joint, jev-latest)' });

// deepinfra (text joints): greet once; chitchat pair; recommend pair
const greet = await probe('greet.greeter', [
  { text: 'Morning! Heard you got fresh cider donuts today', cells: { customer_text: 'Morning! Heard you got fresh cider donuts today', customer_name: 'River' } },
], diClient, { label: 'greeter single (granite-4.2-3b)' });

const chitchat = await probe('chitchat.greeter', [
  { text: 'catch the game last night?', cells: { customer_text: 'catch the game last night?', customer_name: 'Ada' } },
  { text: 'big game last night, huh?', cells: { customer_text: 'big game last night, huh?', customer_name: 'Ben' } },
], diClient, { label: 'chitchat pair (greeter, granite-4.2-3b)' });

const recommend = await probe('recommend.softjoint', [
  { text: 'feeling cozy, something warm please', cells: { customer_text: 'feeling cozy, something warm please', customer_name: 'Maya' } },
  { text: 'it is cold out, I want something warm and sweet', cells: { customer_text: 'it is cold out, I want something warm and sweet', customer_name: 'Noah' } },
], diClient, { label: 'cozy-recommend pair (granite-4.2-3b)' });

// ---------------------------------------------- the freezing test, live --
const observations = [];
for (const pr of [refund, chitchat, recommend]) {
  if (pr.probes.every((p) => p.ok)) {
    observations.push({ cell_id: pr.cell_id, labels: L, vector: pr.probes[0].vector_model, output: pr.probes[0].answer });
    observations.push({ cell_id: pr.cell_id, labels: L, vector: pr.probes[1].vector_model, output: pr.probes[1].answer });
  }
}
const { proposals, regions } = proposeFreezes(observations, { minObs: 2 });
for (const p of proposals) {
  appendReceipt(LEDGER, { ...p, source: 'live-smoke', run: RUN, note: 'provisional: first live data point of the freezing test (n=2); do NOT auto-apply — needs N>=5 or a human' });
}

// ------------------------------------- budget honesty + run summary row --
const usage = {
  typesafe_calls: tsClient.calls, typesafe_cap: TYPESAFE_CAP,
  deepinfra_calls: diClient.calls, deepinfra_cap: DEEPINFRA_CAP,
  typesafe_usage: tsClient.usage, deepinfra_usage_tokens: diClient.usage,
};
const verdict = {
  refund: { table_izable_by_answer: refund.answers_normalized_equal, same_action: refund.answers_normalized_equal, jaccard: refund.answer_jaccard, local_buckets_match: refund.local_buckets_match, model_buckets_match: refund.model_buckets_match },
  chitchat: { table_izable_by_answer: chitchat.answers_normalized_equal, jaccard: chitchat.answer_jaccard, local_buckets_match: chitchat.local_buckets_match, model_buckets_match: chitchat.model_buckets_match },
  recommend: { table_izable_by_answer: recommend.answers_normalized_equal, jaccard: recommend.answer_jaccard, local_buckets_match: recommend.local_buckets_match, model_buckets_match: recommend.model_buckets_match },
  greeter_aliveness: greet.probes[0]?.answer ?? null,
};
appendReceipt(LEDGER, {
  kind: 'live-smoke-summary', run: RUN, usage, verdict,
  freeze_proposals: proposals.map((p) => p.proposal.new_cell_id),
  note: 'receipts append-only; probes ran with fresh caches so answers are genuine model behavior',
});

// ------------------------------------------------------------- reporting --
console.log('\n-- probe verdicts (the freezing test, first live data point) --');
for (const [k, v] of Object.entries(verdict)) {
  if (k === 'greeter_aliveness') { console.log(`greet.greeter said: ${JSON.stringify(v)}`); continue; }
  console.log(`${k}: same-local-bucket=${v.local_buckets_match} same-model-bucket=${v.model_buckets_match} identical-answer=${v.table_izable_by_answer} lexical-overlap=${v.jaccard}`);
}
console.log(`\nbudget: typesafe ${usage.typesafe_calls}/${usage.typesafe_cap}, deepinfra ${usage.deepinfra_calls}/${usage.deepinfra_cap}`);
const { records, bad_lines } = readReceipts(LEDGER);
console.log(`receipts: ${LEDGER} now holds ${records.length} records, ${bad_lines.length} bad line(s)`);
console.log(`freeze-proposals emitted: ${proposals.length ? proposals.map((p) => p.proposal.new_cell_id).join(', ') : '(none — joints still read as dynamic)'}`);
console.log(`\nFELT TABLE-IZABLE? refund(same action)=${verdict.refund.same_action} · chitchat=${verdict.chitchat.table_izable_by_answer} · recommend=${verdict.recommend.table_izable_by_answer}`);
console.log('(lexical overlap >=0.6 counts as paraphrase-same; greeters are NOT supposed to table-ize — that is the point of greeters)');
