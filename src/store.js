// src/store.js — sheet persistence + append-only receipts (wave-66 lane 66-a).
//
// Laws inherited from the fleet:
//   - NEVER delete data. Corrections are appended receipts, not rewrites.
//   - Sheets are plain JSON so they can be nested into other programs (organ law).
//   - Every receipt line is self-describing; a stranger reads receipts/ top to bottom
//     and reconstructs what happened without asking anyone.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function sha(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

export function loadSheet(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const sheet = JSON.parse(raw);
  if (!Array.isArray(sheet.cells)) throw new Error(`sheet ${file}: missing cells[]`);
  return sheet;
}

export function saveSheet(sheet, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sheet, null, 2) + '\n');
  return sha(sheet);
}

// Append one receipt object to a jsonl file. Returns the envelope as written.
export function appendReceipt(file, receipt) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const env = { ts_utc: new Date().toISOString(), ...receipt };
  fs.appendFileSync(file, JSON.stringify(env) + '\n');
  return env;
}

export function readReceipts(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n').filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return { kind: 'corrupt-line', raw: l }; } });
}
