// src/joint.js — soft-joint execution (wave-66 lane 66-a).
//
// A soft joint reads the moment as a VECTOR: named dimensions (urgency, warmth,
// familiarity...) — a shape a downstream cell can reason over, not a single value.
// The backend call returns {answer, vector, confidence}; on failure or exhausted
// budget we fail CLOSED to the joint's fallback cell (never silently).
//
// Backends:
//   typesafe-systemone — the fleet's primary (canonical client shape, receipted)
//   deepinfra-chat     — OpenAI-compatible cheap racing horses (granite-4.2-3b etc.)
//   local              — deterministic stub for tests/smoke (no network)
//
// v2 fact gate: factRequired joints (policy/outcome regions) refuse to rule on
// fact-starved moments — E_FACTS_REQUIRED, routed by the caller, never guessed.

import { createHash } from 'node:crypto';
import { factsClass, missingRequiredFacts, momentFacts, E_FACTS_REQUIRED } from './facts.js';

const CACHE = new Map(); // key: type|model|bucketed-vector → {answer, vector, confidence}
export function clearCache() { CACHE.clear(); }
function rawHash(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

export function makeBackend(desc, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const type = desc?.type || 'local';
  const model = desc?.model || 'jev-latest';

  async function typesafeSystemone({ prompt, vectorLabels, state, choices }) {
    const key = process.env.TYPESAFE_API_KEY;
    if (!key) throw new Error('TYPESAFE_API_KEY missing — joint channel closed (fail-closed)');
    const t0 = now();
    // NOTE (wire-shape law, learned from lode run-1's honest FAIL): score questions
    // REQUIRE a `criteria` field — omitting it is a 422. Keep the criteria text
    // explicit per label so the model's scoring anchor is receipted.
    const questions = Object.fromEntries(vectorLabels.map(l => [
      `v_${l}`, { type: 'score', instructions: `score this dimension of the moment from 0.0 to 1.0`, criteria: ["0.0 = absent", "1.0 = maximal"] },
    ]));
    questions.answer = choices
      ? { type: 'choice', instructions: prompt, criteria: Object.fromEntries(choices.map(c => [c, c])) }
      : null;
    if (questions.answer === null) delete questions.answer;
    const r = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`systemone HTTP ${r.status}`);
    const vector = {};
    for (const l of vectorLabels) {
      const a = body.answers?.[`v_${l}`];
      vector[l] = typeof a?.score === 'number' ? a.score : (typeof a === 'number' ? a : 0.5);
    }
    const ans = body.answers?.answer;
    // noul is a PROBABILITY, not prose (wire law). With no choices, the joint's
    // product IS the vector — answer = the vector as a JSON string.
    const answerText = ans?.choice ?? (ans ? JSON.stringify(ans) : JSON.stringify(vector));
    return {
      answer: answerText,
      vector,
      confidence: ans?.confidence ?? 0.5,
      usage: body.usage || null,
      latency_ms: now() - t0,
      model: body.model || model,
    };
  }

  async function deepinfraChat({ prompt, vectorLabels, state }) {
    const key = process.env.DEEPINFRA_API_KEY;
    if (!key) throw new Error('DEEPINFRA_API_KEY missing — joint channel closed (fail-closed)');
    // deepinfra model ids are namespaced (ibm-granite/granite-4.2-3b, openai/gpt-oss-20b);
    // auto-namespace bare names for the common families so cell authors can write short names.
    const MODEL = model.includes('/') ? model
      : model.startsWith('granite') ? `ibm-granite/${model}`
      : model.startsWith('gpt-oss') ? `openai/${model}`
      : model.startsWith('Nemotron') ? `nvidia/${model}`
      : model.startsWith('Qwen') ? `Qwen/${model}`
      : model;
    const t0 = now();
    const r = await fetchImpl('https://api.deepinfra.com/v1/openai/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: 'You are one cell in a quilt — a small model at a soft joint. Read the moment as a vector, then answer. Reply with STRICT JSON: {"vector":{' + vectorLabels.map(l => `"${l}":0.0`).join(',') + '},"answer":"..."} — no other keys, no prose.' },
          { role: 'user', content: JSON.stringify({ moment: state, task: prompt }) },
        ],
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`deepinfra HTTP ${r.status}`);
    const text = body.choices?.[0]?.message?.content || '';
    let parsed = null;
    try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { /* fail-closed below */ }
    if (!parsed || typeof parsed.answer === 'undefined') throw new Error('deepinfra: unparseable joint reply');
    const vector = {};
    for (const l of vectorLabels) vector[l] = Number(parsed.vector?.[l] ?? 0.5);
    return {
      answer: String(parsed.answer),
      vector,
      confidence: 0.6,
      usage: body.usage || null,
      latency_ms: now() - t0,
      model,
    };
  }

  async function local({ prompt, vectorLabels, state }) {
    return { answer: `local:${prompt}`, vector: Object.fromEntries(vectorLabels.map(l => [l, 0.5])), confidence: 1, usage: null, latency_ms: 0, model: 'local' };
  }

  const table = { 'typesafe-systemone': typesafeSystemone, 'deepinfra-chat': deepinfraChat, local };
  const fn = table[type];
  if (!fn) throw new Error(`unknown backend type ${type}`);
  return { type, model, call: fn };
}

// bucketVector rounds each dimension into `buckets` levels so identical-ish moments
// share cache slots and feed the freezing test comparable regions.
export function bucketVector(vector, buckets = 3) {
  return Object.entries(vector)
    .map(([k, v]) => `${k}:${Math.min(buckets - 1, Math.floor((Number(v) || 0) * buckets))}`)
    .sort().join('|');
}

// GREETER-FIRST (wave-72, the greeter law — docs/greeter-law.md): a cell tagged
// greeterTerritory routes GREETER-FIRST. Its authored greeter table (greeter_route
// → a lookup cell in this sheet; keymap matched on the message, like inferKey)
// is consulted BEFORE the model seat — the blind judge ranked the table
// at-or-above the model on this region (lift ≤ 0, the measured tell), so the
// table is first among equals. On a table MISS:
//   · greeter_miss: 'ask-back' — the miss lands on the ask-back cell (ask_back),
//     the human-connection channel; the model seat is NEVER spent on this region
//     (the storefront's strength: warmth is authored or asked-back, never bought).
//   · default — the demoted model seat runs ("model only if the table misses"),
//     still ahead of the fail-closed fallback.
// Both zero-spend paths return before the cache/model machinery; a null ask-back
// answer fails closed toward silence (the greeter no-script law), never a script.
function serveGreeterFirst(sheet, joint, moment) {
  const cell = sheet.cells.find(c => c.id === joint.greeter_route);
  const state = moment?.state;
  const message = String(typeof state === 'string' ? state : state?.message ?? '').toLowerCase();
  let value = null;
  if (cell && cell.kind === 'lookup') {
    let key = null;
    for (const [kw, k] of Object.entries(cell.keymap || {})) {
      if (message.includes(kw)) { key = k; break; }
    }
    if (key !== null && Object.prototype.hasOwnProperty.call(cell.table || {}, key)) value = cell.table[key] ?? null;
    else value = cell.default ?? null;
  }
  if (value !== null && value !== '') {
    return {
      answer: value, vector: moment?.vector || null, confidence: 0.9,
      source: 'greeter-table', greeter_first: true, greeter_route: joint.greeter_route,
      usage: null, latency_ms: 0, model: null,
    };
  }
  if (joint.greeter_miss === 'ask-back' && joint.ask_back) {
    const ab = sheet.cells.find(c => c.id === joint.ask_back);
    const v = ab && ab.kind === 'lookup' ? (ab.table?.default ?? ab.default ?? null) : null;
    return {
      answer: v, vector: moment?.vector || null, confidence: v !== null ? 0.5 : 0,
      source: 'ask-back', greeter_first: true, greeter_route: joint.greeter_route,
      routed_to: joint.ask_back, routed_via: 'greeter-ask-back',
      usage: null, latency_ms: 0, model: null,
      ...(v === null ? { reason: 'ask-back missing/empty — fail-closed silence (the greeter no-script law), never a script' } : {}),
    };
  }
  return null; // miss with the default strength → the demoted model seat (below)
}

// runJoint(sheet, jointId, moment, opts) — the executor.
// Order: FACT GATE (v2, factRequired joints only) → GREETER-FIRST (wave-72,
// greeterTerritory joints only) → cache → backend → fallback.
// Every path emits a trace the caller receipts.
//
// v2 (wave-68): a joint declaring factRequired:true is a POLICY/OUTCOME region.
// A ruling on missing/empty facts, or facts that do not cover requiredFacts,
// is refused with the named error E_FACTS_REQUIRED BEFORE any backend call —
// never guessed (facts decide outcomes; emotion decides tone; see
// docs/fact-tone-v2.md). The caller routes the refusal (routeFactRefusal).
export async function runJoint(sheet, jointId, moment, opts = {}) {
  const joint = sheet.cells.find(c => c.id === jointId);
  if (!joint || joint.kind !== 'softjoint') throw new Error(`runJoint: ${jointId} is not a softjoint cell`);
  // ---- FACT GATE (v2) -------------------------------------------------------
  if (joint.factRequired) {
    const { facts, starved } = momentFacts(moment);
    const missing = missingRequiredFacts(joint.requiredFacts, facts);
    if (starved || missing.length > 0) {
      return {
        answer: null,
        vector: moment?.vector || null,
        confidence: 0,
        source: 'fact-refused',
        error: E_FACTS_REQUIRED,
        missingFacts: starved && (joint.requiredFacts || []).length ? [...(joint.requiredFacts || [])] : missing,
        reason: starved
          ? `fact-starved moment: no facts extracted; a ruling here would be a guess (required: ${(joint.requiredFacts || []).join(', ') || 'none declared'})`
          : `required fact(s) not grounded by extraction: ${missing.join(', ')}`,
      };
    }
  }
  const backend = opts.backend || makeBackend(joint.backend, opts);
  const labels = joint.vector.labels || [];
  // ---- GREETER-FIRST (wave-72) ----------------------------------------------
  // Tagged cells consult their authored greeter table before the model seat;
  // with the ask-back strength a miss lands on the ask-back cell and the model
  // seat is never spent on greeter territory. (Placed AFTER the fact gate: a
  // misconfigured factRequired+greeterTerritory cell still refuses first —
  // fail-closed wins ties. Greeter-territory cells are outcome-free by law.)
  if (joint.greeterTerritory === true && joint.greeter_route) {
    const greeter = serveGreeterFirst(sheet, joint, moment);
    if (greeter) return greeter;
  }
  // CACHE LAW (bug fixed live in lane 66-e): a moment WITH a vector caches by its
  // bucketed region — identical-ish moments share slots and feed the freezing test.
  // A moment WITHOUT a vector caches by its exact state hash — never collapse two
  // different messages into one slot (the greeter's greeting once leaked into the
  // refunder's answer because unvectorized moments all bucketed to the same key).
  // v2: facts are part of the cache identity. A with-receipt moment must never
  // be served the cached ruling of a fact-starved moment in the same emotional
  // bucket — that would be the cache-collapse leak (66-e) wearing a fact hat.
  const fClass = Array.isArray(moment?.facts) && moment.facts.length ? `|${factsClass(moment.facts)}` : '';
  const cacheKey = moment.vector
    ? `${backend.type}|${backend.model}|${bucketVector(moment.vector)}${fClass}`
    : `${backend.type}|${backend.model}|raw:${rawHash(moment.state ?? moment)}${fClass}`;
  const budget = opts.budget ?? Infinity;

  if (CACHE.has(cacheKey) && opts.cache !== false) {
    const hit = CACHE.get(cacheKey);
    return { ...hit, source: 'cache' };
  }
  if (opts.cache !== false) CACHE.set(cacheKey, null); // reserve slot (dedupes concurrent)

  if (budget <= 0) return fallbackPath(joint, moment, 'budget-exhausted');

  try {
    const out = await backend.call({
      prompt: opts.prompt || joint.notes || `serve ${jointId}`,
      vectorLabels: labels,
      state: moment.state ?? moment,
      choices: joint.choices || null,
    });
    const result = { answer: out.answer, vector: out.vector, confidence: out.confidence, source: backend.type, usage: out.usage, latency_ms: out.latency_ms, model: out.model };
    if (opts.cache !== false) CACHE.set(cacheKey, result);
    return result;
  } catch (err) {
    return fallbackPath(joint, moment, `backend-failed: ${String(err.message || err).slice(0, 120)}`);
  }
}

function fallbackPath(joint, moment, reason) {
  const fb = joint.fallback;
  if (!fb || fb.type === 'default') {
    return { answer: null, vector: moment.vector || null, confidence: 0, source: 'fail-closed', reason };
  }
  // Fallback may reference a lookup cell in the same sheet or carry an inline default.
  return {
    answer: fb.ref ? `fallback→${fb.ref}` : (fb.note ?? null),
    vector: moment.vector || null,
    confidence: 0.25,
    source: 'fallback',
    reason,
  };
}

// routeFactRefusal(sheet, jointId) — where a fact-refused moment goes (v2).
// Order of authority: the joint's own `fact_fallback` cell (e.g. an ask-back
// lookup), else the sheet's GREETER cell (hand the moment to the human
// connection surface — the greeter law intact), else the joint's declared
// fallback ref, else null (caller fail-closes). The refusal is a ROUTE, never
// a swallowed error; the caller receipts `fact_refused: true` in the trace.
export function routeFactRefusal(sheet, jointId) {
  const joint = sheet.cells.find(c => c.id === jointId);
  if (!joint || joint.kind !== 'softjoint') return null;
  if (joint.fact_fallback) {
    const cell = sheet.cells.find(c => c.id === joint.fact_fallback);
    if (cell) return { route: cell.id, via: 'fact_fallback' };
  }
  const greeter = sheet.cells.find(c => c.kind === 'softjoint' && c.greeter === true);
  if (greeter) return { route: greeter.id, via: 'greeter' };
  if (joint.fallback?.ref) {
    const cell = sheet.cells.find(c => c.id === joint.fallback.ref);
    if (cell) return { route: cell.id, via: 'fallback' };
  }
  return null;
}
