# quilt-softjoints

**The soft-joint thesis, as code.** Decompose a domain until the formulaic parts are
**lookup tables**, leave **soft joints** where small dynamic models read the moment as a
*vector array* (not a value array), and keep **greeter cells** that are never decomposed
because connection is the product. Adjustments observed during runs **compile into new
cells**, so the next run hits those paths natively — runs stop needing adjustments.

```
 domain spec
     │  decompose()          rule-receipted classification
     ▼
 ┌───────────┬──────────────┬──────────┐
 │  lookup   │  softjoint   │ greeter  │
 │ (tables)  │ (vector read │ (never   │
 │           │  + fallback) │  frozen) │
 └───────────┴──────┬───────┴──────────┘
        ▲           │ runJoint()  cache → backend → fail-closed fallback
        │           ▼
        │     observations ──freezingTest()──▶ freeze-proposals (softjoint→lookup)
        │                                          │
   adjustments (wave-66 §5a, from runs)            │
        │  compileAdjustments()                    │
        └────────▶ compiled cells ────────────────-┘  (the sheet grinds toward tables)
```

## Quickstart

```js
import { decompose, runJoint, compileAdjustments, loadSheet } from 'quilt-softjoints';

const { sheet, receipts } = decompose(spec);            // spec.behaviors[] → classified cells
const out = await runJoint(sheet, 'refunder', moment);  // vector read + fallback law
const next = compileAdjustments(sheet, runAdjustments); // repeated fixes become cells
```

Live demo of the principal's own example — the corner store:

```bash
npm test          # 26 tests, no network
npm run smoke     # ≤2 typesafe + ≤2 deepinfra calls; receipts/live-smoke.jsonl
```

## The three cell classes

| class     | what it is | law |
|-----------|------------|-----|
| `lookup`  | closed mapping + default. Zero model cost. | the goal state: everything that can freeze, does |
| `softjoint` | small model reads the moment as a **named vector** (urgency, warmth, familiarity…), answers, carries a **fallback** | fails closed; identical bucketed moments cache |
| `greeter` | `greeter: true` softjoint | **never decomposed** — in the automated general store the greeter stays because human connection is relationship value; scripting it makes the store robotic |

## Why adjustments compile into cells

One manual fix during a run is an anecdote. The *same* fix twice is a missing cell.
`compileAdjustments()` clusters adjustment records (schema: wave-66 brief §5a, shared
with quilt-runbook) by target + hypothesis, and for repeated generalizable patterns
emits a `compiled_cell` with provenance (`compiled_from: run@seq`). The sheet absorbs
the lesson; future runs never see that failure again. See `DESIGN.md` for the full loop.

## Files

- `src/decompose.js` — classification + `freezingTest` (softjoint→lookup promotion)
- `src/joint.js` — soft-joint executor (typesafe systemone / deepinfra / local; cache; fail-closed fallback)
- `src/compiler.js` — adjustment→cell compiler
- `src/store.js` — append-only receipts (never delete data)
- `examples/store/` — the corner-store sheet: 4 lookups, 2 softjoints, 1 greeter

## License

MIT
