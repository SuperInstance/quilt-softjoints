// src/compiler.js — the adjustment→cell compiler (wave-66 lane 66-a).
//
// THE MECHANISM BEHIND "runs stop needing adjustments":
//   During a run, an operator (or the runbook, lane 66-c) records an ADJUSTMENT
//   whenever the sheet needed a manual state change: {target, before, after,
//   why:{trigger,hypothesis,evidence}, generalizes}. One adjustment is an anecdote;
//   a REPEATED generalizable adjustment is a missing cell. This compiler clusters
//   adjustments and, when a pattern repeats >= threshold times, emits a
//   compiled_cell that would have PREVENTED the adjustment — then patches the sheet.
//
// Interop: adjustment records use the wave-66 canonical schema (brief §5a), which
// lane 66-c (quilt-runbook) writes and lane 66-a consumes. Either side may compile;
// the receipts record who did.

import { sha } from './store.js';

// v1 clustering (upgraded from single-key hashing after the lane 66-c cross-compile):
// two adjustments belong to the same pattern when they target the same cell AND their
// hypotheses share >= MIN_SHARED significant words. Union-find over that relation —
// "hardcoded timing convention" and "hardcoded compounding frequency, same root-cause
// class" now cluster (they share {hardcoded, convention, root?} but sorted-top-6 keys
// previously diverged). Transparency note: shared-word overlap is still a heuristic;
// it is receipted in each compile-receipt as the cluster's evidence.
const STOP = new Set(['this','that','with','from','have','must','been','were','their','them','when','what','into','than','then','only','over','also','because','should','would','cell','cells','table','adjustment']);
function sigWords(adj) {
  return new Set(String(adj?.why?.hypothesis || '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(w => w.length > 4 && !STOP.has(w)));
}
function cluster(adjustments, { minShared = 2 } = {}) {
  const parent = adjustments.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(a)] = find(b); };
  const words = adjustments.map(sigWords);
  for (let i = 0; i < adjustments.length; i++) {
    for (let j = i + 1; j < adjustments.length; j++) {
      if (adjustments[i]?.target?.cell_id !== adjustments[j]?.target?.cell_id) continue;
      let shared = 0;
      for (const w of words[i]) if (words[j].has(w)) shared += 1;
      if (shared >= minShared) union(i, j);
    }
  }
  const groups = new Map();
  adjustments.forEach((a, i) => {
    const k = find(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  });
  return [...groups.values()];
}

export function compileAdjustments(sheet, adjustments, { threshold = 2 } = {}) {
  const candidates = adjustments.filter(a => a?.kind === 'adjustment' && a?.generalizes === true);
  const groups = cluster(candidates);

  const receipts = [];
  const compiledCells = [];

  for (const group of groups) {
    if (group.length < threshold) continue;
    const first = group[0];
    const cellId = `auto-${(first.target?.cell_id || 'cell').replace(/[^a-z0-9-]/gi, '-')}-${sha(group).slice(0, 6)}`;

    // Choose the compiled cell kind from the evidence shape:
    //   - adjustments keyed by an input (target.input) → they ARE table rows → lookup
    //   - adjustments that only retune behavior → formula guard cell
    const rowLike = group.filter(g => g.target?.input !== undefined && g.target?.input !== null).length;
    const kind = rowLike >= threshold ? 'lookup' : 'formula';

    const compiledCell = kind === 'lookup'
      ? {
          id: cellId, kind: 'lookup',
          table: Object.fromEntries(group.map(g => [String(g.target?.input ?? g.why?.trigger ?? 'default'), g.after])),
          default: first.after ?? null,
          inputs: [first.target?.cell_id].filter(Boolean),
          compiled_from: group.map(g => `${g.run_id}@${g.at_seq}`),
        }
      : {
          id: cellId, kind: 'formula',
          inputs: [first.target?.cell_id].filter(Boolean),
          // A guard formula: clamp/normalize the target so the drift the adjustments
          // kept correcting is bounded by construction. Expression kept explicit.
          expr: `guard(${first.target?.cell_id})`, // realized by host engine's guard()
          guard_note: `emitted from ${group.length} adjustments; hypothesis: ${first.why?.hypothesis}`,
          compiled_from: group.map(g => `${g.run_id}@${g.at_seq}`),
        };

    compiledCells.push(compiledCell);
    receipts.push({
      kind: 'compile-receipt',
      at_utc: new Date().toISOString(),
      cluster: [...sigWords(first)].slice(0, 6).join('+') || '(no hypothesis words)',
      adjustments_consumed: group.length,
      pattern: first.why?.hypothesis,
      new_cell: { id: cellId, kind },
      rationale: `${group.length} generalizable adjustments kept hitting ${first.target?.cell_id} for the same reason — the fix is a cell, not another manual pass`,
    });
  }

  // Patch the sheet (append-only in spirit: new cells added, nothing removed).
  const patched = { ...sheet, cells: [...sheet.cells] };
  for (const c of compiledCells) {
    if (!patched.cells.some(x => x.id === c.id)) patched.cells.push(c);
  }
  patched.meta = { ...(sheet.meta || {}), compiled_at: new Date().toISOString(), compiled_cells: compiledCells.length };

  return { sheet: patched, receipts, compiledCells };
}
