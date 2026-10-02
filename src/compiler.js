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

// crude but honest keyword clustering: target cell + salient words of the hypothesis
function clusterKey(adj) {
  const words = String(adj?.why?.hypothesis || '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(w => w.length > 3).sort().slice(0, 6);
  return `${adj?.target?.cell_id || '?'}::${words.join('-')}`;
}

export function compileAdjustments(sheet, adjustments, { threshold = 2 } = {}) {
  const clusters = new Map();
  for (const adj of adjustments) {
    if (adj?.kind !== 'adjustment') continue;
    if (adj?.generalizes !== true) continue;
    const key = clusterKey(adj);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(adj);
  }

  const receipts = [];
  const compiledCells = [];

  for (const [key, group] of clusters) {
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
      cluster: key,
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
