# DESIGN — the FACT/TONE moment vector, v2 (wave-68, lane 68-a)

Zero-shot, written BEFORE any v2 implementation code exists in this repo.
Written in answer to the wave-67 storefront diagnosis (quilt-storefront
eval/freeze-report.json, lane 67-c): **"the deciding feature is not in the
vector"** — the refunder's policy ruling keys on RECEIPT PRESENCE, a fact in
the message text, while the declared vector carried only emotional dims
(distress, goodwill, repeat-customer). The same emotional region therefore
legitimately split by outcome ("store credit" vs "full refund" for the same
upset-milk message), and the freezing test — correctly — refused to freeze
anything. 7 observations, 0 unanimous n≥3 regions, one honest non-result.

The principal's directive this wave: **facts decide outcomes; emotion decides
tone.** The moment was never a value array; wave-66 made it a vector array;
v2 makes it the honest heterogeneous vector it always was: some dimensions are
FEELINGS (continuous, 0..1, model-read), and some are FACTS (discrete,
extractable, checkable — and they must be EXTRACTED, never guessed).

## 1. The v2 moment vector

```
moment v2 := {
  state,                    // unchanged v1 payload (message, cart, ...)
  vector?: {label: 0..1},   // v1 emotion/style dims, unchanged shape
  facts?: Fact[],           // NEW: structured facts extracted from state
  intent?: string,          // NEW (optional): the routed intent, when known
  urgency?: 0..1,           // NEW (optional): urgency elevated out of emotion
}

Fact := { kind: string,     // snake-case, e.g. "receipt-mentioned", "item"
          value: boolean|number|string|null,
          evidence?: string,  // the span/lookup that produced it (auditability)
          how: "rule"|"model"|"lookup"|"session" }
```

Laws:

- **F1 — additive**: a v1 moment (no `facts`) is a valid v2 moment. Every v1
  code path behaves byte-identically. `missing FACTS` is not an error; it is a
  CLASSIFICATION: the region classifier marks such moments **fact-starved**.
- **F2 — facts are extracted, never guessed**: every fact carries its evidence
  (the matched span, the table row, the session state) and how it was obtained.
  A fact with no evidence is a confession, not a fact.
- **F3 — discrete keys**: facts enter region keys as a *class string*
  (`kind:value`, sorted, e.g. `receipt-mentioned:true|item:milk`), not as
  buckets. Numbers bucket (like vectors); booleans/strings are exact. A
  fact-starved moment's class is the literal `∅facts` — visible in every
  region key, never silently merged with fact-bearing moments.

## 2. The joint contract: factRequired regions

A softjoint cell MAY declare:

```
factRequired: true,
requiredFacts: ["receipt-mentioned"],   // kinds that MUST be present to rule
fact_fallback: "refunder.ask-receipt",  // optional cell ref for refusals
```

- **F4 — E_FACTS_REQUIRED**: when a `factRequired` joint is run on a moment
  whose facts are missing, empty, or do not cover `requiredFacts`, `runJoint`
  refuses BEFORE any backend call with the named error `E_FACTS_REQUIRED`,
  returning `{ source: "fact-refused", error: "E_FACTS_REQUIRED",
  missingFacts: [...] }`. A policy/outcome ruling on empty facts is REFUSED —
  never guessed. This is fail-closed with a name, the fleet's refusal dialect.
- **F5 — tone is free**: dims that decide TONE/STYLE (warmth, distress,
  familiarity...) may run on emotion alone. Greeters stay emotion-only by
  nature: a greeter has no facts to require, and v2 adds nothing to the
  greeter law (never decomposed, no scripted fallback). v2 gates OUTCOMES,
  not conversation.
- **F6 — routing refusals, not dropping them**: `routeFactRefusal(sheet,
  joint)` resolves where a refused moment goes: the joint's `fact_fallback`
  cell if declared, else the sheet's greeter cell (hand it to a human
  connection surface), else the joint's ordinary fallback chain. The refusal
  is a ROUTE, not an error swallowed — the trace receipts
  `fact_refused: true`.

## 3. The fact-extraction pre-step

Extraction is a PIPELINE with an order of authority:

1. **rules first** (regex/lookup over the domain — for the storefront: receipt
   mention, item catalog, defect claims, days-elapsed phrases). Deterministic,
   free, auditable, and the only extractor the storefront needs.
2. **model only if rules starve** — and ONLY when the text may still contain
   the fact (weak rules, not absent facts). A model-extracted fact is
   receipted (provider, model, tokens) and carries `how: "model"`. If the
   text does not state the fact, extraction is IMPOSSIBLE, not starved: a
   model call there would be the guessing F4 forbids. The honest move for a
   genuinely absent required fact is the refusal, not an extraction attempt.
3. **session/lookup facts** (`how: "session"`): facts the store already knows
   (cart contents, order history) may be injected by the host engine; they are
   facts about the WORLD, and still carry provenance.

The softjoints engine ships the CONTRACT and the validators
(`isValidFact`, `validateFacts`, `missingRequiredFacts`, `factsClass`) plus a
pluggable `modelFactExtractor` adapter shape; the DOMAIN ships the rules.
Extraction lives before `runJoint` (the engine builds `moment.facts`), because
`runJoint` is single-joint scoped and the extractor is domain-specific.

## 4. Freezing test v2: outcomes bind to facts

`freezingTest(observations, { threshold, buckets, requireFacts })`:

- v1 behavior preserved exactly when callers pass fact-less observations and
  do not set `requireFacts` (all 26 existing tests stay green untouched).
- With `requireFacts: true` (the v2 outcome law): a region can freeze ONLY if
  every observation in it is fact-bearing (`∅facts` observations are counted,
  reported as `fact_starved`, and excluded from proposals). Rationale: a
  frozen outcome row will be served by lookup on the strength of its region
  key; if the key cannot see the deciding feature (receipt presence), the row
  is a guess wearing a table's clothes. This codifies the wave-67 diagnosis
  as law: **the same emotional region containing both outcomes was the
  instrument telling us the key was wrong.**

The frozen-table key becomes `bucketVector(emotion) + "|" + factsClass`, and
the pre-vector (the key computable BEFORE a model call) must therefore be
facts-AWARE: the storefront's `refunderPreVector` gains the extracted facts as
discrete components. The fallback-first frozen lookup consults the same key.

## 5. What this is NOT

- Not a decision tree: facts gate outcome rulings only; the router stays a
  nexus; emotion keeps deciding tone; the greeter stays human.
- Not fact-freezing on desire: rows freeze only from receipted observations
  (evidence or nothing, unchanged from 67-c).
- Not a model dependency: the v2 contract is pure code; the model is one
  extraction authority of three, used sparingly and receipted.

## 6. Reception of the wave-67 adjustment (seq 18)

Wave-67's adjustment record proposed exactly this ("give the refunder
pre-vector a FACT dimension — v2 regions may then be deterministic enough to
freeze. Not hand-wired"). This design adopts it: the fact dimension is added
to the CONTRACT (schema + refusal + region key), and whether regions actually
freeze remains an empirical question answered only by the grown corpus (n≥14)
through the unchanged instrument. If the emergent region still refuses to
freeze, the refusal is the result and it will be receipted with its count.
