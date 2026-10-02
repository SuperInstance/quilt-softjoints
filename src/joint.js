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

const CACHE = new Map(); // key: type|model|bucketed-vector → {answer, vector, confidence}
export function clearCache() { CACHE.clear(); }

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

// runJoint(sheet, jointId, moment, opts) — the executor.
// Order: cache → backend → fallback. Every path emits a trace the caller receipts.
export async function runJoint(sheet, jointId, moment, opts = {}) {
  const joint = sheet.cells.find(c => c.id === jointId);
  if (!joint || joint.kind !== 'softjoint') throw new Error(`runJoint: ${jointId} is not a softjoint cell`);
  const backend = opts.backend || makeBackend(joint.backend, opts);
  const labels = joint.vector.labels || [];
  const cacheKey = `${backend.type}|${backend.model}|${bucketVector(moment.vector || moment)}`;
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
