// src/greeter.js — the GREETER-LAW lift instrument (wave-72, lane 72-b).
//
// GREETER-DEMO-1 (quilt-storefront @ b970341, wave-71 lane 71-c) MEASURED the
// wrong-joint tell: "you seated the model at the wrong joint when the blind
// judge cannot rank its vote above the table's — agreement without lift"
// (model 8.0 vs authored 8.25, pairs split 2–2, while the table served 12/12
// at zero cost). This module turns that anecdote into a SELECTION RULE:
//
//   A candidate region is GREETER-TERRITORY when
//     (a) NO policy outcome depends on it — outcomes bind to FACTS (the
//         §5b-v2 law, docs/fact-tone-v2.md); a region whose extracted facts
//         move the outcome is FACT territory, whatever its emotions read —
//   AND
//     (b) the blind-judge lift of model-over-table is ≤ 0 on its moments,
//         measured with ≥ 1 usable pair (greeterLiftTest below — the measured
//         tell, as an instrument).
//
// One instrument, two corpora, opposite signs: on greeter moments the judge
// ranks the table at-or-above the model (lift ≤ 0 → territory confirmed); on
// fact-bearing controls the model's vote CHANGES the outcome where the table
// misses (lift > 0 → territory refused, the seat earns its keep — P3's 6/6).
//
// Zero network. The judge/table/model arms are FUNCTIONS the caller supplies;
// validation replays receipted corpora (verify-then-adopt) or wires live ones.

// greeterLiftTest(moments, {tableFn, modelFn, judgeFn}) — the lift measurement.
//   moments : array (any moment shape; the three fns interpret them)
//   tableFn(moment)           -> the table's answer (null = miss/silence)
//   modelFn(moment)           -> the model seat's answer (null = silence/not-run)
//   judgeFn(moment, table, model) -> {table, model} blind scores (numbers),
//                                    or null/falsy when the judge refuses
// A moment is a USABLE PAIR when both arms answered AND the judge scored both;
// everything else is receipted as unpaired (the model seat silent / not run /
// judge refused — never guessed into the mean).
//
// Returns (a pure function of its inputs — sealed-claim friendly):
//   { n, usablePairs, unpaired, modelMean, tableMean, lift, vacuous, perItem }
//   lift = mean(model) − mean(table) over usable pairs; null when 0 pairs
//   (vacuous — the murmuration law: no discriminating evidence, never PASS).
export async function greeterLiftTest(moments, { tableFn, modelFn, judgeFn } = {}) {
  if (!Array.isArray(moments)) throw new Error('greeterLiftTest: moments[] required');
  for (const [k, fn] of [['tableFn', tableFn], ['modelFn', modelFn], ['judgeFn', judgeFn]]) {
    if (typeof fn !== 'function') throw new Error(`greeterLiftTest: ${k} required`);
  }
  const perItem = [];
  const deltas = [];
  for (const m of moments) {
    const tableAnswer = (await tableFn(m)) ?? null;
    const modelAnswer = (await modelFn(m)) ?? null;
    const row = { tableAnswer, modelAnswer, paired: tableAnswer !== null && modelAnswer !== null, table: null, model: null };
    if (row.paired) {
      const j = await judgeFn(m, tableAnswer, modelAnswer);
      const t = Number(j?.table), v = Number(j?.model);
      if (j && Number.isFinite(t) && Number.isFinite(v)) {
        row.table = t; row.model = v;
        deltas.push(v - t);
      } else {
        row.paired = false; // judge refused — an unusable pair, receipted below
        row.judgeRefused = true;
      }
    }
    perItem.push(row);
  }
  const usablePairs = deltas.length;
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const pairedRows = perItem.filter((r) => r.table !== null && r.model !== null);
  return {
    n: perItem.length,
    usablePairs,
    unpaired: perItem.length - usablePairs,
    modelMean: usablePairs ? mean(pairedRows.map((r) => r.model)) : null,
    tableMean: usablePairs ? mean(pairedRows.map((r) => r.table)) : null,
    lift: usablePairs ? mean(deltas) : null,
    vacuous: usablePairs === 0,
    perItem,
  };
}

// greeterTerritoryVerdict(measurement, {outcomeFree, minPairs}) — the SELECTION
// RULE applied. `outcomeFree` is condition (a): the caller's structural finding
// that no policy outcome depends on the region (decompose() computes it from
// the absence of factRequired/requiredFacts/outcome bindings; hosts may derive
// it from their own policy map). Condition (b) is the measurement: lift ≤ 0
// with ≥ minPairs usable pairs (default 1 — a lone pair can confirm, zero
// pairs cannot). The verdict is fail-closed: any missing input refuses.
export function greeterTerritoryVerdict(measurement, { outcomeFree, minPairs = 1 } = {}) {
  const lift = measurement?.lift ?? null;
  const usablePairs = Number(measurement?.usablePairs) || 0;
  const noLift = lift !== null && Number.isFinite(lift) && lift <= 0 && usablePairs >= minPairs;
  return {
    greeterTerritory: outcomeFree === true && noLift,
    outcomeFree: outcomeFree === true,
    lift,
    usablePairs,
    noLift,
    rule: 'GREETER-TERRITORY ⇐ (a) no policy outcome depends on the region (outcomes bind to FACTS — §5b-v2) AND (b) blind-judge lift of model-over-table ≤ 0 on ≥1 usable pair — agreement without lift (docs/greeter-law.md)',
  };
}
