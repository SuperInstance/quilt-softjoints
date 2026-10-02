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
export { decompose, freezingTest } from './decompose.js';
export { runJoint, makeBackend } from './joint.js';
export { compileAdjustments } from './compiler.js';
export { loadSheet, saveSheet, appendReceipt, readReceipts } from './store.js';
