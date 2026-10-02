#!/usr/bin/env node
// examples/store/generate.mjs — build the general-store demo sheet FROM ITS
// SPEC with the real decomposer, then run the real compiler over the sample
// adjustment records. Deterministic: same spec + adjustments -> same sheet.
//
// Receipt discipline: receipts/decomposition.jsonl and receipts/compile.jsonl
// are GENERATED ARTIFACTS of this example (they record the decomposition of
// the CURRENT spec). This script overwrites them — BUT refuses if the
// existing files carry records for cells the fresh run does not produce
// (that would mean real run data was appended; never-delete law applies and
// the human wins). Live run receipts (live-smoke.jsonl) are ALWAYS appended,
// never touched by this script.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decompose } from '../../src/decompose.js';
import { compile, loadAdjustments } from '../../src/compiler.js';
import { saveSheet, readReceipts } from '../../src/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SPEC = path.join(HERE, 'spec.json');
const ADJUSTMENTS = path.join(HERE, 'adjustments.jsonl');
const SHEET_OUT = path.join(HERE, 'sheet.json');
const DECOMP_RECEIPTS = path.join(ROOT, 'receipts', 'decomposition.jsonl');
const COMPILE_RECEIPTS = path.join(ROOT, 'receipts', 'compile.jsonl');

const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
const now = new Date().toISOString();

// --- 1. decompose: spec -> sheet + receipts --------------------------------
const { sheet, receipts } = decompose(spec, { now, sheetId: 'corner-store' });

// --- 2. compile: adjustments -> compiled overlay cells + receipts ----------
const rawLines = fs.readFileSync(ADJUSTMENTS, 'utf8').split('\n')
  .filter((l) => l.trim()).map((l) => JSON.parse(l));
const { adjustments, bad_lines } = loadAdjustments(rawLines);
if (bad_lines.length) {
  console.error('FATAL: examples/store/adjustments.jsonl has non-adjustment records:', bad_lines);
  process.exit(1);
}
const compiled = compile(adjustments, structuredClone(sheet), { now });
const finalSheet = compiled.sheet;

// --- 3. safety valve, then write -------------------------------------------
for (const [file, fresh] of [[DECOMP_RECEIPTS, receipts], [COMPILE_RECEIPTS, compiled.receipts]]) {
  if (fs.existsSync(file)) {
    const { records } = readReceipts(file);
    const freshIds = new Set(fresh.map((r) => r.cell_id ?? r.target?.cell_id));
    const foreign = records.filter((r) => {
      const id = r.cell_id ?? r.target?.cell_id;
      return id && !freshIds.has(id);
    });
    if (foreign.length) {
      console.error(`FATAL: ${file} holds ${foreign.length} record(s) for cells this generation does not produce — refusing to overwrite (never-delete law). Move the file or pass --force.`);
      process.exit(1);
    }
  }
}
saveSheet(SHEET_OUT, finalSheet);
fs.mkdirSync(path.dirname(DECOMP_RECEIPTS), { recursive: true });
fs.writeFileSync(DECOMP_RECEIPTS, receipts.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(COMPILE_RECEIPTS, compiled.receipts.map((r) => JSON.stringify(r)).join('\n') + '\n');

// --- 4. honest summary ------------------------------------------------------
const lookups = finalSheet.cells.filter((c) => c.kind === 'lookup');
const joints = finalSheet.cells.filter((c) => c.kind === 'softjoint');
const greeters = joints.filter((c) => c.greeter === true);
console.log(`decomposed "${spec.domain}": ${finalSheet.cells.length} cells -> ${lookups.length} lookup, ${joints.length - greeters.length} softjoint, ${greeters.length} greeter`);
console.log(`decomposition receipts: ${receipts.length} -> ${DECOMP_RECEIPTS}`);
console.log(`compile: ${compiled.receipts.filter((r) => r.kind === 'compile-receipt').length} compiled, ${compiled.receipts.filter((r) => r.kind === 'compile-skip').length} skipped -> ${COMPILE_RECEIPTS}`);
console.log(`compiled cells on sheet: ${finalSheet.compiled_cells.map((c) => c.id).join(', ') || '(none)'}`);
console.log(`sheet -> ${SHEET_OUT}`);
