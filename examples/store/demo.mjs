#!/usr/bin/env node
// examples/store/demo.mjs — the general store, END TO END, fully offline
// (mock client, zero network, zero spend). Run: node examples/store/demo.mjs
//
// Walks the whole loop the principal described:
//   lookups answer formulaic things,
//   softjoints read the moment as a vector and call a small model,
//   greeters stay human,
//   failures fall closed to the fallback,
//   identical vector-buckets hit the cache,
//   and repeated adjustments COMPILE into new cells so runs stop needing them.

import assert from 'node:assert/strict';
import { loadSheet, resolveLookupValue, readReceipts } from '../../src/store.js';
import { evalJoint, makeMockClient } from '../../src/joint.js';
import { compile, loadAdjustments } from '../../src/compiler.js';
import { proposeFreezes, applyFreeze, bucketVector } from '../../src/decompose.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sheet = loadSheet(path.join(HERE, 'sheet.json'));
console.log(`sheet "${sheet.sheet}": ${sheet.cells.length} cells, ${sheet.compiled_cells.length} compiled overlay(s)\n`);

// -- 1. formulaic parts: pure table -----------------------------------------
const sat = resolveLookupValue(sheet, 'hours.lookup', 'saturday');
console.log(`[lookup] hours Saturday -> ${sat.value}   (layer: ${sat.layer})`);
assert.equal(sat.layer, 'compiled', 'the compiled correction must intercept Saturday hours');
console.log('[lookup] stock milk      ->', resolveLookupValue(sheet, 'stock.lookup', 'milk').value);

// -- 2. a soft joint reads the moment as a VECTOR ----------------------------
const mock = makeMockClient({
  script: ({ kind }) => {
    if (kind === 'systemone') {
      return {
        answers: {
          v_urgency: { noul: 0.8 }, v_familiarity: { noul: 0.6 }, v_sentiment: { noul: 0.2 }, v_formality: { noul: 0.5 },
          action: { choice: 'store credit today, and I will swap the blender myself' },
          confidence: { noul: 0.9 },
        },
        usage: { total_tokens: 214 },
      };
    }
    return { content: '{"vector":{"urgency":0.2,"familiarity":0.7,"sentiment":0.8,"formality":0.3},"answer":"Day-old doughnuts, half price — on me today.","confidence":0.8}' };
  },
});
const refund = await evalJoint(sheet, 'refund.softjoint', {
  text: 'This blender broke after two uses and I need it fixed NOW',
  cells: { customer_text: 'This blender broke after two uses and I need it fixed NOW', customer_name: 'Sam' },
}, { client: mock });
console.log(`\n[joint] refund.softjoint source=${refund.source} conf=${refund.confidence}`);
console.log(`[joint] vector (${refund.vector.join(', ')}) bucket=${refund.bucket}`);
console.log(`[joint] answer: ${refund.answer}`);
assert.equal(refund.source, 'model');
assert.equal(refund.bucket, 'urgency:hi,familiarity:mid,sentiment:lo,formality:mid');

// -- 3. cache: identical (backend, model, joint, bucket) -> no second call ---
const before = mock.calls;
const refund2 = await evalJoint(sheet, 'refund.softjoint', {
  text: 'blender broke, need it fixed now, different words same moment',
  cells: { customer_text: 'blender broke, need it fixed now', customer_name: 'Sam' },
}, { client: mock });
console.log(`[cache] second same-bucket call: source=${refund2.source} (model calls made: ${mock.calls - before})`);
assert.equal(refund2.source, 'cache');
assert.equal(mock.calls - before, 0, 'cache hit must not call the backend');

// -- 4. fail-closed: dark channel -> fallback lookup --------------------------
const dark = makeMockClient({ script: () => { throw new Error('HTTP 503: channel dark'); } });
const fb = await evalJoint(sheet, 'refund.softjoint', {
  text: 'I lost my receipt but the eggs were bad', cells: { customer_text: 'lost receipt, eggs bad', customer_name: 'Priya' },
}, { client: dark });
console.log(`[fallback] source=${fb.source} layer=${fb.receipt.fallback}`);
console.log(`[fallback] answer: ${fb.answer}`);
assert.equal(fb.source, 'fallback');
assert.match(String(fb.answer), /30 days|store credit/i);

// -- 5. the freezing test: same region, same answer -> propose a freeze ------
const labels = ['urgency', 'familiarity', 'sentiment', 'formality'];
const obs = [
  { cell_id: 'refund.softjoint', labels, vector: [0.8, 0.6, 0.2, 0.5], output: 'Store credit today, no forms.' },
  { cell_id: 'refund.softjoint', labels, vector: [0.9, 0.6, 0.2, 0.4], output: 'Store credit today, no forms.' },
  { cell_id: 'refund.softjoint', labels, vector: [0.1, 0.3, 0.9, 0.5], output: 'A refund, happily given.' },
];
const { proposals, regions } = proposeFreezes(obs, { minObs: 2 });
console.log(`\n[freeze] regions observed: ${regions.length}; table-izable: ${regions.filter((r) => r.table_izable).length}`);
assert.equal(proposals.length, 1);
const frozen = applyFreeze(structuredClone(sheet), proposals[0]);
const fr = await evalJoint(frozen, 'refund.softjoint', {
  text: 'blender broke after two uses, need it fixed now', cells: { customer_text: 'blender broke', customer_name: 'Sam' },
}, { client: makeMockClient({ script: () => { throw new Error('should NOT be called for a frozen region'); } }) });
console.log(`[freeze] frozen region now answers from ${fr.source} (${fr.receipt.frozen_cell})`);
assert.equal(fr.source, 'frozen-lookup');

// -- 6. adjustments compile into cells ---------------------------------------
const raw = fs.readFileSync(path.join(HERE, 'adjustments.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map(JSON.parse);
const { adjustments } = loadAdjustments(raw);
const beforeCells = sheet.compiled_cells.length;
const out = compile(adjustments, structuredClone(sheet), { now: new Date().toISOString() });
console.log(`\n[compile] compiled=${out.receipts.filter((r) => r.kind === 'compile-receipt').length} skipped=${out.receipts.filter((r) => r.kind === 'compile-skip').length}`);
console.log('[compile] new cells:', out.sheet.compiled_cells.slice(beforeCells).map((c) => c.id));
assert.ok(out.receipts.some((r) => r.kind === 'compile-receipt'));
assert.ok(out.receipts.some((r) => r.kind === 'compile-skip' && r.code === 'SINGLE_OBSERVATION'));

// -- 7. greeters: present, never decomposed ----------------------------------
const greeters = sheet.cells.filter((c) => c.kind === 'softjoint' && c.greeter === true);
console.log(`\n[greeter] ${greeters.map((g) => g.id).join(', ')} — notes: ${greeters[0].notes.slice(0, 60)}...`);
assert.equal(greeters.length, 2);

const dec = readReceipts(path.join(__dirnameAt(), 'receipts', 'decomposition.jsonl'));
console.log(`\n[receipts] decomposition.jsonl: ${dec.records.length} records, ${dec.bad_lines.length} bad lines`);
assert.equal(dec.bad_lines.length, 0);
console.log('\nDEMO OK — the quilt answers everywhere; only the moments pay for models.');
function __dirnameAt() { return path.resolve(HERE, '..', '..'); }
