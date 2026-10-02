// examples/store/run-smoke.mjs — ONE live smoke of the corner-store sheet.
// Budget: <=2 typesafe calls, <=2 deepinfra calls (wave-66 brief §2). Receipts to
// receipts/live-smoke.jsonl. If channels fail, honest FAIL receipts and exit 0 —
// the unit tests carry the proof; this smoke carries the first real data point
// for the freezing test ("does jev's moment-read look table-izable?").
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const HERE = fileURLToPath(new URL('.', import.meta.url));
import { loadSheet, appendReceipt } from '../../src/store.js';
import { runJoint, makeBackend } from '../../src/joint.js';
import { freezingTest } from '../../src/decompose.js';

// keys: runtime-only from .env.keys (never printed)
const env = Object.fromEntries(
  fs.readFileSync('/home/z/my-project/.env.keys', 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;

const sheet = loadSheet(HERE + 'storefront-sheet.json');
const receipts = HERE + '../../receipts/live-smoke.jsonl';
const rec = (r) => { appendReceipt(receipts, r); console.log(JSON.stringify(r)); };

// 1) moment-read via typesafe (the vector half of the thesis)
try {
  const tsafe = makeBackend({ type: 'typesafe-systemone', model: 'jev-latest' });
  const out = await runJoint(sheet, 'moment-read',
    { state: { customer: 'regular, in a hurry, annoyed the store closes early tonight' }, vector: {} },
    { backend: tsafe, prompt: 'read the customer moment for a corner store assistant', cache: false });
  rec({ kind: 'live-smoke', cell: 'moment-read', source: out.source, vector: out.vector, answer: String(out.answer).slice(0, 160), usage: out.usage || null });
} catch (e) {
  rec({ kind: 'live-smoke', cell: 'moment-read', ok: false, error: String(e.message || e).slice(0, 160) });
}

// 2) refunder via deepinfra granite (judgment applying the policy)
try {
  const gi = makeBackend({ type: 'deepinfra-chat', model: 'gpt-oss-20b' });
  const out = await runJoint(sheet, 'refunder',
    { state: { customer: 'bought milk yesterday, it spoiled early, upset, shops here weekly', policy: 'within-7-days-receipt: full refund' }, vector: {} },
    { backend: gi, prompt: 'apply the refund policy to this customer moment; answer in one warm sentence', cache: false });
  rec({ kind: 'live-smoke', cell: 'refunder', source: out.source, vector: out.vector, answer: String(out.answer).slice(0, 200), usage: out.usage || null });
} catch (e) {
  rec({ kind: 'live-smoke', cell: 'refunder', ok: false, error: String(e.message || e).slice(0, 160) });
}

// 3) freezing test on synthetic observations — the first data point shape
const proposals = freezingTest([
  { vector: { urgency: 0.9, familiarity: 0.8, sentiment: 0.2 }, output: 'offer store credit + apology' },
  { vector: { urgency: 0.95, familiarity: 0.7, sentiment: 0.3 }, output: 'offer store credit + apology' },
  { vector: { urgency: 0.85, familiarity: 0.9, sentiment: 0.1 }, output: 'offer store credit + apology' },
]);
rec({ kind: 'freezing-test', proposals, note: 'synthetic: demonstrates the promotion instrument on the refunder surface' });
