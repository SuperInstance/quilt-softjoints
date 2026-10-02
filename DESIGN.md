# DESIGN — quilt-softjoints (wave-66, lane 66-a)

## The ideation pass (alternatives considered)

1. **Fully-neural router**: one small model sees every input and decides everything.
   Rejected: it re-answers formulaic questions every time — expensive, inconsistent,
   and exactly the "robotic" surface the principal wants removed. It also can't be
   rewound or audited: the behavior lives in weights, not cells.

2. **Rules/decision-trees only**: everything decomposes into branches.
   Rejected by the principal explicitly ("not decomposing a website's digital assistant
   completely into decision trees"): branches can only see **values**, so the assistant
   loses the moment — the difference between a rushed regular and a browsing tourist.
   This is the value-array trap; the fix is vector arrays at the joints.

3. **Hybrid (chosen)**: lookup tables for the formulaic bulk + **soft joints** where a
   small model reads the moment as a named vector and answers + **greeter cells** that
   stay dynamic by law. This is the general-store decomposition: shelves and prices
   become tables; the checkout keeps a human; the greeter is never automated away.

## The mechanisms

### Freezing test (softjoint → lookup promotion)
A soft joint earns its keep only while its surface is genuinely open. `freezingTest()`
buckets observed moment-vectors into regions; when one region maps to one output
repeatedly (threshold ≥ 3), it emits a `freeze-proposal` — that region should become a
lookup row. Over a domain's life, joints grind down into tables and the model surface
shrinks to what is actually dynamic. This is the "more and more a lookup table" thesis
as an executable instrument, not a slogan.

### Adjustment → cell compiler ("runs stop needing adjustments")
During a run, whenever state had to be adjusted by hand, the run records an adjustment
(wave-66 §5a schema: target, before, after, **why**{trigger, hypothesis, evidence},
generalizes). The compiler clusters by (target cell, hypothesis keywords) and when a
generalizable pattern repeats ≥ 2 times, emits a `compiled_cell`:
- adjustments keyed by an input → the cluster **is** a table → `lookup` cell
- otherwise → a `formula` guard cell bounding the drift the fixes kept correcting

Every emission carries provenance (`compiled_from: run@seq`) and a rationale line.
Idempotent: recompiling adds nothing new. History is never rewritten — the sheet
*gains* cells.

### Fail-closed joints
`runJoint` order: cache → backend → fallback. Backend failure or exhausted budget
lands on the joint's `fallback` (often a lookup cell), never silence, never a script.
Greeters have **no** fallback to a canned line — degrading a greeter to a script is the
exact robotic failure mode; they fail to silence instead.

### Why buckets
`bucketVector` rounds each vector dimension to N levels (default 3). Identical-ish
moments share cache slots and the freezing test sees stable regions. Too-fine buckets
would make every moment unique; too-coarse would erase the moment. Three levels is the
honest v0; tuning is receipted future work, not a silent knob.

## Rejected variants (kept for the record)

- `compiled_cell` as a *patch* to an existing cell (rejected: mutates history; v0 only
  appends cells; patching needs an organ-style transaction, see quilt-jev-toolkit v2).
- HMAC-signing decomposition receipts (parked: receipts are local artifacts; the organ
  protocol already gives signed checkpoints when bundles leave the machine).
- LLM-driven clustering of adjustments (parked: v0 keyword clustering is transparent
  and deterministic; model-driven clustering is a softjoint above the compiler itself —
  a deliberate next-wave experiment).

## What the next wave should consume

- quilt-runbook (66-c) writes the §5a adjustments this repo consumes — wire them.
- quilt-lookup (66-d) classifies the spreadsheet catalog into pure-lookup vs
  needs-dynamic-model — its classification feeds `decompose()` directly.
- The storefront (66-e) is the live proof domain; migrate its ai cells onto
  `runJoint` and measure the freezing test on real sessions.
