// Shared test helpers for importers-B. Not a test file itself (no .test.js suffix).

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FileSet } from '../../src/core/fileset.js';
import { DatasetBuilder, eventTargets, EVENT_TYPES, VISIBILITY } from '../../src/core/model.js';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'importers-b');
export const fixture = (...p) => path.join(FIXTURES, ...p);

// FileSet from paths on disk (files or folders), relative to the fixtures root.
export async function fsFromFixtures(...rels) {
  return FileSet.fromPaths(rels.map(r => fixture(r)));
}

// FileSet from in-memory files: { 'dir/name.ext': string | Uint8Array }.
export async function fsFromMemory(files) {
  return FileSet.from(Object.entries(files).map(([p, c]) => ({ blob: new Blob([c]), path: p })));
}

// Run detect + import, return { det, ds, builder }.
export async function runImport(importer, fs, options = {}) {
  const det = await importer.detect(fs);
  const builder = new DatasetBuilder({ name: 'test' });
  await importer.import(fs, { builder, options, progress() {}, signal: new AbortController().signal });
  return { det, ds: builder.build(), builder };
}

// Human-readable event list: { type, t, actor, targets:[[key, role]], context, text, parent, weight, key }.
export function events(ds) {
  const out = [];
  for (let i = 0; i < ds.events.count; i++) {
    const c = ds.events.context[i];
    out.push({
      i,
      type: EVENT_TYPES[ds.events.type[i]],
      t: ds.events.t[i],
      actor: ds.nodes.keys[ds.events.actor[i]],
      targets: eventTargets(ds, i).map(([n, r]) => [ds.nodes.keys[n], r]),
      context: c >= 0 ? ds.contexts.keys[c] : null,
      visibility: c >= 0 ? VISIBILITY[ds.contexts.visibility[c]] : null,
      text: ds.events.text[i],
      parent: ds.events.parent[i],
      weight: ds.events.weight[i],
      key: ds.events.keys[i],
    });
  }
  return out;
}

export function node(ds, key) {
  const i = ds.nodes.keys.indexOf(key);
  if (i < 0) return null;
  return { key, label: ds.nodes.labels[i], attrs: ds.nodes.attrs[i], isBot: !!ds.nodes.isBot[i], platformIds: ds.nodes.platformIds[i] };
}

export function context(ds, key) {
  const i = ds.contexts.keys.indexOf(key);
  if (i < 0) return null;
  return { key, name: ds.contexts.names[i], kind: ds.contexts.kinds[i], visibility: VISIBILITY[ds.contexts.visibility[i]], medium: ds.contexts.medium[i], members: ds.contexts.members[i] };
}

export const source = (ds, i = 0) => ds.meta.sources[i];
export const warningCodes = (ds, i = 0) => ds.meta.sources[i].warnings.map(w => w.code);
export const countBy = (evs, f) => evs.reduce((m, e) => { const k = f(e); m[k] = (m[k] || 0) + 1; return m; }, {});
