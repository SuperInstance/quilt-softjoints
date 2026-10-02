# RECEIPT — 68-a death audit (lane 68-a-r2, the finisher)

At: 2026-10-02 ~18:00Z. Auditor: general-purpose fleet lane 68-a-r2.
Subject: what dead lane 68-a left uncommitted in quilt-softjoints (HEAD ea0ac80)
and quilt-storefront (HEAD d7242c3) when it died on its result-return deadline.

## Verdict: SOFTJOINTS ~100% complete · STOREFRONT ~55% (contract done, wiring dead)

### quilt-softjoints (the CONTRACT) — complete, 42/42 tests green at audit time
- `src/facts.js` NEW: the full Fact vocabulary — `isValidFact`/`validateFacts`
  (kind/value/evidence/how schema, provenance-or-nothing), `factsClass` (discrete
  region key, sorted, numbers bucketed, `∅facts` for starved),
  `missingRequiredFacts` (stated-unknown does NOT ground), `E_FACTS_REQUIRED`,
  `momentFacts` (v1 backward compat), `makeModelFactExtractor` (pluggable
  adapter, usage-sink receipted, ungrounded kinds come back null — never invented).
- `src/joint.js`: the fact gate BEFORE any backend call (factRequired joints
  refuse fact-starved or ungrounded-required moments with the named error),
  facts joined into the cache identity (the 66-e cache-collapse leak closed
  under facts), `routeFactRefusal` (fact_fallback → greeter → fallback → null).
- `src/decompose.js`: `classifyRegion` (starvation is a CLASSIFICATION, visible
  in the key) + `freezingTest v2` (`requireFacts`: a fact-starved region can
  never freeze an outcome; v1 byte-identical without it).
- `src/index.js`: all v2 exports wired. `tests/facts.test.mjs` NEW: 16 tests,
  all green. `docs/fact-tone-v2.md` NEW: the zero-shot design doc (laws F1–F6,
  extraction pipeline, freezing v2, reception of the wave-67 adjustment seq 18).

### quilt-storefront (the DOMAIN) — half-done; the lane died mid-wiring
Done by 68-a:
- `src/facts.js` NEW: the rule-based domain extractor (receipt-mentioned with
  evidence spans, purchase-window, item, defect-claimed), FACT_EXTRACTORS
  registry, REFUNDER_FREEZE_FACTS, the deterministic RENDER table.
- `sheets/storefront.json`: refunder.joint declared `factRequired` +
  `requiredFacts` + `fact_fallback: refunder.ask-receipt` (NEW ask-back cell),
  freeze_facts, v2 notes; meta carries fact_tone_v2 + version bump.
- `src/vector.js`: RLEX exported for the extractor (additive).
- `src/engine.js`: `factsFor`/`tryFrozen(facts)` sketched, `factsClass` +
  `routeFactRefusal` IMPORTED — and there it stopped.

Broken/missing at death (found by diff + red suite: 6 pre-existing tests red):
1. **The gate was armed but never fed** — `evalSoftjoint` never built
   `moment.facts`, so EVERY refunder moment was refused; the sheet's own tests
   failed 6/26 (frozen-path, cache-law, policy-state, fallback-REF).
2. **`routeFactRefusal` was imported, never called** — refusals would have
   handed customers `answer: null`.
3. **`turn()` never passed facts to `tryFrozen`** — the frozen path keyed
   `|∅facts` forever; the grind-down was dead on arrival.
4. **`factsClass(facts, { kinds })` was called with an option the contract did
   not implement** (softjoints `factsClass` ignored `kinds`) — context facts
   (item, defect) would have fractured every outcome region.
5. No storefront facts test, no grown corpus, no freeze re-run, no
   pre-registration — the empirical half of the design (§6) was untouched.
6. Extractor gap found during completion: DAYS_PATTERNS read digits only
   ("three weeks ago" → null window).

### What 68-a-r2 did (same session, receipts in both repos)
- softjoints: `factsClass`/`freezingTest` gained the additive `kinds` filter
  (policy-input kinds only; context facts ride, never key) + 2 tests. 44/44.
- storefront: extraction pre-step wired into `evalSoftjoint` and `turn()`;
  E_FACTS_REQUIRED refusals ROUTED (ask-back served to the customer,
  `fact_refused`/`missing_facts`/`routed_to` receipted in the trace); facts
  receipted per turn; spelled-out day/week/month phrases added to the
  extractor; 6 pre-existing tests updated to the v2 contract (messages ground
  their receipt facts — the assertions' MECHANISMS unchanged); new
  `tests/08-facts.test.mjs` (8 tests). 26/26.
- corpus + instrument: `eval/battery-v2.json` (18 synthetic refunder-region
  observations: 13 grounded + 5 fact-starved), `eval/freeze-v2.js` (rule-path
  only, ZERO model calls — receipted choice), report `eval/freeze-report-v2.json`.
- pre-registration (fleet-seeds): claims sealed sha256:58fbbb0e, pushed
  (a1adfe6) BEFORE the run; verdicts 3/3 PASS appended (a22a87b). Verdict:
  **freeze** — 6 fact-bearing proposals across buckets 2/3/4; the live
  `refunder.frozen` table stays EMPTY (synthetic corpus ≠ live evidence;
  evidence-or-nothing unchanged).

L16 note: the dead lane's code was GOOD — its only true loss was the last
mile: wiring, tests, corpus, and the run. Everything above was finished
without rewriting a single 68-a decision.
