# DESIGN — the GREETER-LAW: the wrong-joint tell as a joint-selection rule (wave-72, lane 72-b)

Zero implementation-first prose, written upstream the same wave the tell was
measured. GREETER-DEMO-1 (quilt-storefront @ b970341, wave-71 lane 71-c)
measured the tell bobbin asked for in round 1:

> **when you cut a job into tables-plus-a-model, what's the tell that you
> seated the model at the wrong joint?**

The measured answer: *the blind judge cannot rank the model's vote above the
table's — agreement without lift* (judge 8.0 model vs 8.25 authored, pairs
split 2–2, while the ledger shows only cost and risk: 2,145 tokens, one
confabulated "hot drink", against 12/12 zero-call servings; and on the fact
controls the same model ruled 6/6 — the seat earns its keep where outcomes
move). An anecdote proves a demo. This repo makes it a LAW.

## 1. The selection rule

A candidate region R is **GREETER-TERRITORY** iff:

- **(a) OUTCOME-FREE** — NO policy outcome depends on R. Outcomes bind to
  FACTS (§5b-v2's law, `docs/fact-tone-v2.md`): a region whose extracted facts
  move the outcome (a `factRequired` joint, declared `requiredFacts`, any
  outcome binding) is FACT territory — never greeter territory, whatever its
  emotions read. Structurally: the behavior declares no
  `factRequired`/`requiredFacts`/`outcome`.
- **(b) NO LIFT** — the blind-judge lift of model-over-table is **≤ 0** on R's
  moments, measured with **≥ 1 usable pair** (`greeterLiftTest`, below — the
  measured tell as an instrument; zero usable pairs is VACUOUS, never PASS).

One instrument, two corpora, opposite signs. On greeter moments the judge
ranks the table at-or-above the model (lift ≤ 0 → territory confirmed). On
fact-bearing controls the model's vote CHANGES the outcome where the table
misses (lift > 0 → territory refused — twice over, since (a) already fails).

## 2. The lift test (the instrument)

```
greeterLiftTest(moments, {tableFn, modelFn, judgeFn})
  tableFn(moment)              -> the table's answer (null = miss/silence)
  modelFn(moment)              -> the model seat's answer (null = silence/not-run)
  judgeFn(moment, table, model) -> {table, model} blind scores | null (refused)
→ { n, usablePairs, unpaired, modelMean, tableMean, lift, vacuous, perItem }
```

`lift = mean(model) − mean(table)` over **usable pairs** (both arms answered
AND the judge scored both). A silent model seat, an un-run seat, or a judge
refusal is receipted as unpaired — never guessed into the mean. The test is a
pure function of its inputs, so its predictions can be SEALED before the run
(fleet-seeds `tools/preregister.mjs`; the murmuration vacuity law rides in
`greeterTerritoryVerdict` and in every sealed claim's `vacuousIf`).

`greeterTerritoryVerdict(measurement, {outcomeFree})` applies the rule
fail-closed: territory ⇐ outcome-free AND lift ≤ 0 AND usablePairs ≥ 1.

## 3. What the tag does in code

- **`decompose(spec, {liftReports})`** tags a behavior's cell
  `greeterTerritory: true/false` when lift evidence rides in
  (`liftReports[behavior.id] = {lift, usablePairs}`), computing (a)
  structurally and (b) from the evidence; the receipt carries the WHY.
  No evidence → no new keys (v1 output byte-identical).
- **`runJoint` routes greeter-territory cells GREETER-FIRST**: the cell's
  authored greeter table (`greeter_route` → a lookup cell; keymap on the
  message) is consulted BEFORE the model seat — "model only if the table
  misses". The cell may declare the stronger ask-back strength
  (`greeter_miss: 'ask-back'` + `ask_back: '<cell>'`): a miss lands on the
  ask-back cell — the human-connection channel — and the model seat is never
  spent on the region. A null ask-back fails closed toward silence (the
  greeter no-script law), never a script.
- **`freezingTest` exempts greeter-territory regions** — they NEVER freeze.
  The greeter is a relationship joint, not a lookup: auto-frozen warmth would
  be a script wearing evidence's clothes. Warmth is AUTHORED (hand-written
  register lines, the routed ask-back pattern of `refunder.ask-receipt`),
  never ground down from observations, never bought from a seat the judge
  already ranked below the table. Exempt observations are bucketed and
  reported (`detail: true` → `greeterExempt`), never silently dropped.

## 4. The two strengths, and why the storefront takes the stronger one

The generic mechanism (default) keeps the demoted seat reachable — a table
miss hands the moment to the model before fail-closing, because somewhere the
surface is still open. The storefront declares the ask-back strength: its
greeter territory was measured (71-c) with the model BELOW the table and the
table already serving 12/12 at zero cost, so a miss there is an unknown
register — the human channel opens (ask-back), it does not buy a vote. Both
strengths are the same law at two trust levels in the same evidence.

## 5. Validation (pre-registered; see fleet-seeds seeds/preregister-72b.*)

Sealed BEFORE the run, scored from the receipted 71-c corpus
(quilt-storefront `eval/greeter-demo-results-r2.json` — verify-then-adopt,
zero new model calls; re-judging receipted pairs would double-spend):

- **P1** — the 12 greeter moments: lift ≤ 0 with ≥1 usable pair and the rule
  returns GREETER-TERRITORY. (Receipted: 4 usable pairs, lift −0.25.)
  Refusal branch: lift > 0 falsifies the law on its home corpus — the tag
  must not be wired.
- **P2** — the 6 fact-bearing controls: outcome-axis lift > 0 and the rule
  refuses greeter-territory. (Receipted: the table misses C03, the seat rules
  it — 6/6 vs 5/6, lift +1/6.) Refusal branch: lift ≤ 0 on fact territory
  means the tell does not discriminate the joints and condition (b) is
  uninformative.

## 6. What the next wave should consume

- The storefront wiring (this wave) is the live proof: warmth rules →
  `greeter-lexicon` (authored, zero-call) → missing row → `greeter.ask-back`;
  `greeter.voice` tagged on 71-c evidence, its seat bypassed while the tag
  stands. A future lift test showing lift > 0 on a region LIFTS the tag — the
  law is a selection rule, reversible by evidence, not a monument.
- Domains adopting softjoints should run `greeterLiftTest` BEFORE seating a
  model: it is cheaper than the seat and it tells you the joint.
