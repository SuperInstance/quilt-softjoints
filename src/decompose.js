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
import { factsClass, momentFacts } from './facts.js';

// Classification rules, in priority order. Each rule returns a receipt fragment.
// Spec behaviors look like:
//   { id, kind: 'deterministic'|'judgment'|'connection',
//     map?: {input: output, ...}, default?: any,
//     vector?: {dim, labels}, backend?: {...}, fallback?: {...},
//     notes?: string }
export function decompose(spec, { liftReports = null } = {}) {
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

    // GREETER-LAW (wave-72): the wrong-joint tell as a SELECTION RULE
    // (docs/greeter-law.md). A candidate region is GREETER-TERRITORY when
    // (a) NO policy outcome depends on it — outcomes bind to FACTS (§5b-v2):
    //     a factRequired/requiredFacts/outcome-bound behavior is FACT territory
    //     and is never tagged — AND (b) the blind-judge lift of model-over-table
    //     is ≤ 0 on its moments with ≥1 usable pair (greeterLiftTest, src/greeter.js;
    //     the evidence rides in as liftReports[behavior.id]). Greeter-territory
    //     cells route GREETER-FIRST (runJoint) and are EXEMPT from freezing
    //     (they never freeze — the greeter is a relationship joint, not a lookup).
    // Additive: no liftReports → no new keys anywhere (v1 output byte-identical).
    const ev = liftReports && typeof liftReports === 'object' ? liftReports[b.id] : null;
    if (ev && (b.kind === 'judgment' || b.kind === 'connection')) {
      const outcomeFree = !b.factRequired && !((b.requiredFacts || []).length) && b.outcome === undefined;
      const lift = Number(ev.lift);
      const usablePairs = Number(ev.usablePairs) || 0;
      const territory = outcomeFree && Number.isFinite(lift) && lift <= 0 && usablePairs >= 1;
      cell.greeterTerritory = territory;
      receipt.greeterTerritory = {
        greeterTerritory: territory,
        outcomeFree,
        lift: Number.isFinite(lift) ? lift : null,
        usablePairs,
        reason: !outcomeFree
          ? 'refused: a policy outcome depends on this region (facts decide outcomes — §5b-v2); this is FACT territory, the seat earns its keep where outcomes move'
          : territory
            ? 'tagged: outcome-free + no lift over the table (blind judge ≤ 0) — route greeter-first, never freeze'
            : 'refused: lift evidence does not show no-lift (lift > 0 or zero usable pairs) — the seat is still open here',
      };
      if (territory) {
        // routing hints pass through only on a tagged cell — decompose classifies,
        // runJoint routes (greeter_route lookup consulted before the model seat).
        if (b.greeter_route) cell.greeter_route = b.greeter_route;
        if (b.greeter_miss) cell.greeter_miss = b.greeter_miss;
        if (b.ask_back) cell.ask_back = b.ask_back;
      }
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
        // additive (wave-72): surfaced only when the greeter law tagged something
        ...(cells.some(c => c.greeterTerritory !== undefined)
          ? { greeterTerritory: cells.filter(c => c.greeterTerritory === true).length }
          : {}),
      },
    },
  };

  return { sheet, receipts };
}

// classifyRegion(moment, {buckets}) — the v2 REGION CLASSIFIER.
// The region key of a moment = bucketed emotion/style vector + the discrete
// facts class (docs/fact-tone-v2.md). A moment without facts is FACT-STARVED:
// legal, but marked — an outcome ruling over it is a guess (v2 law F4), and a
// freezing test with requireFacts will exclude its region from proposals.
export function classifyRegion(moment, { buckets = 3 } = {}) {
  const { facts, starved } = momentFacts(moment);
  const emotion = bucketKey(moment?.vector || {}, buckets);
  const fc = factsClass(facts, { buckets });
  return {
    emotionRegion: emotion,
    factsClass: fc,
    factStarved: starved,
    region: starved ? `${emotion}|∅facts` : `${emotion}|${fc}`,
  };
}

function bucketKey(vector, buckets) {
  return Object.entries(vector || {})
    .map(([k, v]) => `${k}:${Math.min(buckets - 1, Math.floor((Number(v) || 0) * buckets))}`)
    .sort().join('|');
}

// freezingTest(observations, {threshold, buckets, requireFacts, exemptRegions, detail}) — the promotion instrument.
// observations: [{vector: {label: value}, output, facts?: Fact[], greeterTerritory?: true}]
// When every observation in the largest region (bucketed vector + v2 facts class)
// shares one output and count >= threshold, that region should freeze into a
// lookup row.
//
// v2 (requireFacts: true — the OUTCOME law): a region may freeze ONLY if every
// observation in it is fact-bearing. Fact-starved observations are counted and
// reported (fact_starved, with their members), never silently merged: a frozen
// outcome row keyed on an emotion-only region is a guess wearing a table's
// clothes — the wave-67 diagnosis, codified. v1 callers (no requireFacts) keep
// the exact v1 behavior.
//
// GREETER-LAW exemption (wave-72): a region tagged greeter-territory NEVER
// freezes — the greeter is a relationship joint, not a lookup. An observation
// carries `greeterTerritory: true` (per the decompose() selection rule or the
// host's own verdict), or the caller passes `exemptRegions: [region keys]`.
// Exempt observations are bucketed and REPORTED (never silently dropped —
// detail: true returns {proposals, greeterExempt}), but emit no freeze-proposal:
// auto-frozen warmth would be a script wearing evidence's clothes.
export function freezingTest(observations, { threshold = 3, buckets = 3, requireFacts = false, kinds = null, exemptRegions = null, detail = false } = {}) {
  const exempt = Array.isArray(exemptRegions) ? new Set(exemptRegions) : null;
  const regions = new Map();
  const greeterExempt = new Map();
  for (const o of observations || []) {
    // v1 callers (requireFacts=false) get the byte-identical v1 key: emotion
    // buckets only, facts invisible. v2 keys append the discrete facts class
    // (with the literal ∅facts marker for fact-starved observations); `kinds`
    // restricts the key to the policy-input kinds (v2.1 — the frozen-table key
    // must see exactly the facts the OUTCOME keys on, not context facts).
    const starved = requireFacts ? momentFacts(o).starved : false;
    const key = requireFacts
      ? `${bucketKey(o.vector, buckets)}|${factsClass(momentFacts(o).facts, { buckets, kinds })}`
      : bucketKey(o.vector, buckets);
    if (!regions.has(key)) regions.set(key, { region: key, outputs: new Map(), n: 0 });
    const r = regions.get(key);
    r.n += 1;
    r.factStarved = r.factStarved || starved;
    // GREETER-LAW exemption: the region never freezes. Flagged observations and
    // exemptRegions keys both mark it; the exemption is reported, not silent.
    // `flagged` counts observation-FLAGS; exemptRegions marks the region itself.
    if (o.greeterTerritory === true) {
      const prev = greeterExempt.get(key);
      greeterExempt.set(key, { flagged: (prev?.flagged || 0) + 1, byObservationFlag: true, byExemptRegions: !!prev?.byExemptRegions });
    } else if (exempt && exempt.has(key)) {
      const prev = greeterExempt.get(key);
      greeterExempt.set(key, { flagged: prev?.flagged || 0, byObservationFlag: !!prev?.byObservationFlag, byExemptRegions: true });
    }
    r.outputs.set(o.output, (r.outputs.get(o.output) || 0) + 1);
  }
  const proposals = [];
  for (const r of regions.values()) {
    if (greeterExempt.has(r.region)) continue; // the greeter law: warmth never auto-freezes
    if (requireFacts && r.factStarved) continue; // the outcome law: no facts, no frozen outcome
    let best = null, bestN = 0;
    for (const [out, n] of r.outputs) if (n > bestN) { best = out; bestN = n; }
    if (best !== null && bestN >= threshold && bestN === r.n) {
      const p = {
        kind: 'freeze-proposal',
        region: r.region,
        output: best,
        n: r.n,
        rationale: `region ${r.region} mapped to the same output ${r.n} times — deterministic at this granularity; freeze into a lookup row`,
      };
      if (requireFacts) p.factBearing = true;
      proposals.push(p);
    }
  }
  // v1/v2 shape is a bare array (byte-identical callers); detail: true opts into
  // the greeter-exemption report — the exemption is visible, never silent.
  if (detail) {
    const greeterExemptReport = [...greeterExempt.entries()].map(([region, f]) => ({
      region,
      n: regions.get(region)?.n ?? f.flagged,
      flagged: f.flagged,
      source: f.byObservationFlag ? 'observation-flag' : 'exemptRegions',
      note: 'greeter-territory: exempt from freezing (relationship joint, not a lookup — docs/greeter-law.md)',
    }));
    return { proposals, greeterExempt: greeterExemptReport };
  }
  return proposals;
}
