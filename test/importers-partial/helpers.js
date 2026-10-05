// Shared helpers for the incomplete-and-wrong-uploads tests. Not a test file.
//
// Every case goes through the real pipeline, as the Data view does:
// runImport(await FileSet.fromPaths([...])), each path one dropped item.
// Fixtures: test/fixtures/partial/ (make_fixtures.mjs, README.md).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { FileSet } from '../../src/core/fileset.js';
import { runImport } from '../../src/core/pipeline.js';

export const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'partial');
export const P = (...p) => path.join(FIX, ...p);

// Import the given fixture paths (relative to test/fixtures/partial) as one drop.
export async function upload(...rels) {
  const r = await runImport(await FileSet.fromPaths(rels.map(x => P(x))));
  const sources = r.report.sources;
  return {
    ...r, sources,
    // The warning with this code on source i (default: the first source that has it).
    warn: (code, i) => (i == null ? sources.flatMap(s => s.warnings).find(w => w.code === code) : sources[i].warnings.find(w => w.code === code)) ?? null,
    codes: i => (i == null ? sources.flatMap(s => s.warnings) : sources[i].warnings).map(w => w.code),
  };
}

// The drop is refused with an UploadError of this code; returns the error.
export async function refused(code, ...rels) {
  let err = null;
  try { await runImport(await FileSet.fromPaths(rels.map(x => P(x)))); } catch (e) { err = e; }
  assert.ok(err, `expected the upload to be refused with ${code}`);
  assert.equal(err.code, code, `code: ${err.code} (${err.message})`);
  return err;
}

// The register of docs/ux/copy-audit-eric-2026-10-04.md: no exclamations,
// no rhetorical questions, no classroom phrasing, no emoji.
export function plain(message) {
  assert.ok(message && message.length > 20, 'message present');
  assert.doesNotMatch(message, /!|\?\s|oops|sorry|please|don't worry|unfortunately/i, `register: ${message}`);
  assert.doesNotMatch(message, /\p{Extended_Pictographic}/u, `emoji: ${message}`);
}
