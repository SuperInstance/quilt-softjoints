// src/facts.js — the FACT half of the v2 moment vector (wave-68, lane 68-a).
//
// Wave-67's diagnosis (quilt-storefront eval/freeze-report.json): the refunder's
// ruling keys on RECEIPT PRESENCE — a FACT in the message text — which the
// emotional vector cannot see. v2 law (docs/fact-tone-v2.md): FACTS DECIDE
// OUTCOMES; EMOTION DECIDES TONE.
//
// This module owns the fact vocabulary:
//   - isValidFact / validateFacts   — the Fact schema (kind/value/evidence/how)
//   - factsClass                    — the discrete region-key class string
//   - missingRequiredFacts          — which required kinds a moment lacks
//   - E_FACTS_REQUIRED              — the named refusal (never guessed)
//   - modelFactExtractor            — the pluggable model-extraction adapter
//                                     (rules first; model only when the text may
//                                     still contain the fact; receipted)
// Domain rules live in the DOMAIN (the storefront ships its own extractor);
// this module ships the CONTRACT.

export const E_FACTS_REQUIRED = 'E_FACTS_REQUIRED';

// The Fact schema: {kind, value, evidence?, how}. `how` names the authority
// that produced it — a fact with no provenance is a confession, not a fact.
const HOWS = new Set(['rule', 'model', 'lookup', 'session']);

export function isValidFact(f) {
  return f != null && typeof f === 'object' && !Array.isArray(f)
    && typeof f.kind === 'string' && f.kind.length > 0 && /^[a-z0-9-]+$/.test(f.kind)
    && (f.value === null || typeof f.value === 'boolean' || typeof f.value === 'number' || typeof f.value === 'string')
    && typeof f.how === 'string' && HOWS.has(f.how)
    && (f.evidence === undefined || f.evidence === null || typeof f.evidence === 'string');
}

export function validateFacts(facts) {
  if (facts === undefined || facts === null) return { ok: true, facts: [], starved: true };
  if (!Array.isArray(facts)) return { ok: false, reason: 'facts must be an array' };
  for (const f of facts) if (!isValidFact(f)) return { ok: false, reason: `malformed fact ${JSON.stringify(f).slice(0, 80)}` };
  return { ok: true, facts, starved: facts.length === 0 };
}

// factsClass — the discrete key a region/freezing/cache key uses. Discrete
// facts enter exactly (kind:value); numbers bucket (default 3, like vectors);
// null values record the kind with `null` (a stated-unknown is itself a fact:
// "receipt-mentioned:null" means the message did not say). A fact-starved
// moment's class is `∅facts` — visible, never silently merged.
// v2.1 (lane 68-a-r2 completion, additive): `kinds` restricts the class to the
// POLICY-INPUT kinds (the outcome key) — context facts (item, defect-claimed)
// ride in the receipt but never key an outcome region. A kinds filter that
// matches nothing is still '∅facts' (no outcome-keying facts = no outcome key).
export function factsClass(facts, { buckets = 3, kinds = null } = {}) {
  if (!Array.isArray(facts) || facts.length === 0) return '∅facts';
  const allow = Array.isArray(kinds) && kinds.length ? new Set(kinds) : null;
  const chosen = allow ? facts.filter((f) => allow.has(f.kind)) : facts;
  if (chosen.length === 0) return '∅facts';
  return chosen
    .map((f) => {
      const v = f.value;
      const s = typeof v === 'number' && Number.isFinite(v)
        ? String(Math.min(buckets - 1, Math.floor(Math.max(0, v) * buckets)))
        : String(v);
      return `${f.kind}:${s}`;
    })
    .sort()
    .join('|');
}

// missingRequiredFacts(['receipt-mentioned'], facts) -> kinds missing.
// A required kind is COVERED when some fact of that kind carries a non-null value.
export function missingRequiredFacts(required, facts) {
  const have = new Set((Array.isArray(facts) ? facts : [])
    .filter((f) => f.value !== null && f.value !== undefined)
    .map((f) => f.kind));
  return (required || []).filter((k) => !have.has(k));
}

// momentFacts(moment) -> {facts, starved} — the v2 read of a moment.
// Backward compatible: a v1 moment (no facts field) is fact-STARVED, not invalid.
export function momentFacts(moment) {
  const m = moment ?? {};
  return validateFacts(m.facts);
}

// The model-extraction adapter shape (used ONLY when rules starve but the text
// may still contain the fact — never to conjure an absent fact; that would be
// the guessing F4 forbids). Hosts wire their own receipted client; the adapter
// contract mirrors makeBackend: {type:'model', async extract({state, kinds})} →
// Fact[] with how:'model' and evidence quoting the span the model read.
// Refusal law survives extraction: an extractor that cannot find a kind
// returns a `kind:null` fact (stated-unknown), not an invented value.
export function makeModelFactExtractor({ call, name = 'model-fact-extractor' } = {}) {
  if (typeof call !== 'function') throw new Error(`${name}: call() required`);
  return {
    type: 'model',
    name,
    async extract({ state, kinds, usageSink = null }) {
      const out = await call({ state, kinds });
      const facts = (Array.isArray(out?.facts) ? out.facts : [])
        .map((f) => ({ ...f, how: 'model' }))
        .filter(isValidFact);
      if (usageSink && out?.usage) usageSink.push({ extractor: name, usage: out.usage });
      // kinds the model could not ground come back as stated-unknowns
      const grounded = new Set(facts.filter((f) => f.value !== null).map((f) => f.kind));
      for (const k of kinds || []) {
        if (!grounded.has(k)) facts.push({ kind: k, value: null, evidence: null, how: 'model' });
      }
      return facts;
    },
  };
}
