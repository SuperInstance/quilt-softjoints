// src/decompose.js — the decomposition pass (wave-66 lane 66-a).
//
// Given a domain behavior spec, classify every behavior into one of three cell
// classes and emit a decomposition receipt for each — the WHY is a first-class
// output, not a comment:
//
//   lookup    — pure formulaic mapping (table + default). No model, no latency,
//               no budget. The goal state: everything that CAN freeze, does.
//   softjoint — needs a dynamic model reading the moment as a VECTOR across named
//               dimensions (urgency, familiarity, warmth, ...). Has a fallback.
//   greeter   — deliberately NEVER decomposed. Connection value. Every greeter
//               carries `notes` explaining why it must stay dynamic.
//
// The FREEZING TEST drives softjoint → lookup promotion: when a soft joint's
// vector region always maps to the same output across N observations, emit a
// freeze-proposal. Over time the domain grinds down into lookup tables and the
// soft joints shrink to the genuinely open surface — that is the thesis.

import { sha } from './store.js';

// Classification rules, in priority order. Each rule returns a receipt fragment.
// Spec behaviors look like:
//   { id, kind: 'deterministic'|'judgment'|'connection',
//     map?: {input: output, ...}, default?: any,
//     vector?: {dim, labels}, backend?: {...}, fallback?: {...},
//     notes?: string }
export function decompose(spec) {
  const receipts = [];
  const cells = [];

  if (!spec || !Array.isArray(spec.behaviors)) {
    throw new Error('decompose: spec.behaviors[] required');
  }

  for (const b of spec.behaviors) {
    const receipt = {
      kind: 'decomposition-receipt',
      behavior: b.id,
      at_utc: new Date().toISOString(),
      rule: null,
      cell: null,
      promote: null,   // what would promote this cell toward lookup
    };

    let cell = null;

    if (b.kind === 'connection') {
      // GREETER: the principal's general-store law. Humans stay in the loop.
      cell = {
        id: b.id, kind: 'softjoint', greeter: true,
        inputs: b.inputs || [],
        vector: b.vector || { dim: 4, labels: ['warmth', 'familiarity', 'mood', 'openness'] },
        backend: b.backend || { type: 'deepinfra-chat', model: 'granite-4.2-3b' },
        fallback: b.fallback || null, // greeters degrade to silence, not scripts
        notes: b.notes || 'kept dynamic: this surface IS the human connection; scripting it makes the store robotic.',
      };
      receipt.rule = 'kind=connection → greeter cell (never decomposed; notes mandatory)';
    } else if (b.kind === 'deterministic' && b.map) {
      // LOOKUP: closed mapping with a default. The grind-down goal state.
      cell = {
        id: b.id, kind: 'lookup',
        table: b.map, default: b.default ?? null,
        inputs: b.inputs || [],
      };
      receipt.rule = 'kind=deterministic with closed map → lookup cell (zero model cost)';
    } else {
      // SOFTJOINT: judgment under context. Vector read + backend + fallback.
      cell = {
        id: b.id, kind: 'softjoint', greeter: false,
        inputs: b.inputs || [],
        vector: b.vector || { dim: 3, labels: ['urgency', 'familiarity', 'sentiment'] },
        backend: b.backend || { type: 'typesafe-systemone', model: 'jev-latest' },
        fallback: b.fallback || { type: 'default', note: 'no fallback supplied: fails closed' },
        notes: b.notes || null,
      };
      receipt.rule = 'kind=judgment (or unmapped) → softjoint cell (vector read, fallback mandatory)';
      receipt.promote = 'freezes when the freezing test sees the same vector region → same output N times (see freezingTest)';
    }

    cells.push(cell);
    receipt.cell = { id: cell.id, kind: cell.kind, greeter: cell.greeter === true };
    receipts.push(receipt);
  }

  const sheet = {
    id: spec.id || ('sheet-' + sha(spec).slice(0, 8)),
    domain: spec.domain || null,
    cells,
    meta: {
      decomposed_at: new Date().toISOString(),
      counts: {
        lookup: cells.filter(c => c.kind === 'lookup').length,
        softjoint: cells.filter(c => c.kind === 'softjoint' && !c.greeter).length,
        greeter: cells.filter(c => c.greeter).length,
      },
    },
  };

  return { sheet, receipts };
}

// freezingTest(observations, {threshold}) — the promotion instrument.
// observations: [{vector: {label: value}, output}]
// When every observation in the largest region (bucketed vector) shares one output
// and count >= threshold, that region should freeze into a lookup row.
export function freezingTest(observations, { threshold = 3, buckets = 3 } = {}) {
  const regions = new Map();
  for (const o of observations) {
    const key = Object.entries(o.vector || {})
      .map(([k, v]) => `${k}:${Math.min(buckets - 1, Math.floor((Number(v) || 0) * buckets))}`)
      .sort().join('|');
    if (!regions.has(key)) regions.set(key, { region: key, outputs: new Map(), n: 0 });
    const r = regions.get(key);
    r.n += 1;
    r.outputs.set(o.output, (r.outputs.get(o.output) || 0) + 1);
  }
  const proposals = [];
  for (const r of regions.values()) {
    let best = null, bestN = 0;
    for (const [out, n] of r.outputs) if (n > bestN) { best = out; bestN = n; }
    if (best !== null && bestN >= threshold && bestN === r.n) {
      proposals.push({
        kind: 'freeze-proposal',
        region: r.region,
        output: best,
        n: r.n,
        rationale: `region ${r.region} mapped to the same output ${r.n} times — deterministic at this granularity; freeze into a lookup row`,
      });
    }
  }
  return proposals;
}
