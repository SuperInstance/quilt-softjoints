// src/index.js — quilt-softjoints public surface.
//
// WHAT THIS PACKAGE IS (read this first):
//   The soft-joint thesis: decompose a domain until the formulaic parts are LOOKUP
//   tables, leave SOFT JOINTS where small dynamic models read the moment as a VECTOR
//   (not a single value), and keep GREETER cells that are never decomposed because
//   connection is the product. Adjustments observed during runs compile into new
//   cells, so the next run hits those paths natively — runs stop needing adjustments.
//
// Three entry points, one per mechanism:
//   decompose(spec)  -> sheet + decomposition receipts (what became what, and why)
//   runJoint(sheet, jointId, moment) -> execute one soft joint (backend + fallback)
//   compileAdjustments(sheet, adjustments) -> new cells mined from run adjustments
//
// v2 (wave-68) — the FACT/TONE contract (docs/fact-tone-v2.md):
//   facts decide OUTCOMES, emotion decides TONE. The moment gains `facts`
//   (extracted, never guessed); factRequired joints refuse to rule on
//   fact-starved moments (E_FACTS_REQUIRED, routed — never guessed);
//   the region classifier marks fact-starved moments; freezingTest gains
//   requireFacts (a frozen outcome row must be keyed on facts).
// GREETER-LAW (wave-72) — the wrong-joint tell as a joint-SELECTION rule
//   (docs/greeter-law.md): a region is GREETER-TERRITORY when (a) no policy
//   outcome depends on it (outcomes bind to FACTS) AND (b) blind-judge lift of
//   model-over-table ≤ 0 (greeterLiftTest + greeterTerritoryVerdict);
//   decompose() tags such cells (liftReports evidence), runJoint routes them
//   GREETER-FIRST (model only if the table misses — or the ask-back path), and
//   freezingTest exempts them (they never freeze — a relationship joint, not a
//   lookup).
export { decompose, freezingTest, classifyRegion } from './decompose.js';
export { runJoint, makeBackend, bucketVector, routeFactRefusal } from './joint.js';
export { compileAdjustments } from './compiler.js';
export { loadSheet, saveSheet, appendReceipt, readReceipts } from './store.js';
export { greeterLiftTest, greeterTerritoryVerdict } from './greeter.js';
export {
  E_FACTS_REQUIRED, isValidFact, validateFacts, factsClass,
  missingRequiredFacts, momentFacts, makeModelFactExtractor,
} from './facts.js';
