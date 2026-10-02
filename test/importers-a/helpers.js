// Shared test helpers for importers-A. Not a test file itself (no .test.js suffix).
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatasetBuilder, eventTargets, eventType, contextVisibility, EVENT_TYPES } from '../../src/core/model.js';
import { FileSet } from '../../src/core/fileset.js';

const here = dirname(fileURLToPath(import.meta.url));
export const FIX = join(here, '..', 'fixtures', 'importers-a');
export const fixture = (...p) => join(FIX, ...p);

// Run one importer over paths (files or folders) and return { ds, source, builder, fs, detect }.
export async function runImporter(importer, paths, options = {}) {
  const fs = await FileSet.fromPaths([].concat(paths));
  const detect = await importer.detect(fs);
  const builder = new DatasetBuilder({ name: 'test' });
  const opts = {};
  for (const o of importer.options || []) opts[o.key] = o.default;
  Object.assign(opts, options);
  await importer.import(fs, { builder, options: opts, progress: () => {}, signal: new AbortController().signal });
  const ds = builder.build();
  return { ds, source: ds.meta.sources[ds.meta.sources.length - 1], builder, fs, detect };
}

// Zip a folder into a temp dir with python's zipfile (independent of our zip reader).
// prefix: optional top folder inside the zip.
export function zipFolder(folder, name = 'export.zip', prefix = '') {
  const dir = mkdtempSync(join(tmpdir(), 'osa-'));
  const out = join(dir, name);
  execFileSync('python3', ['-c', `
import zipfile, os, sys
src, out, prefix = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(src):
        for f in sorted(files):
            p = os.path.join(root, f)
            z.write(p, prefix + os.path.relpath(p, src).replace(os.sep, '/'))
`, folder, out, prefix]);
  return out;
}

// Readable event list for assertions.
export function events(ds) {
  const out = [];
  for (let i = 0; i < ds.events.count; i++) {
    out.push({
      i,
      type: eventType(ds, i),
      t: ds.events.t[i],
      actor: ds.nodes.keys[ds.events.actor[i]],
      targets: eventTargets(ds, i).map(([n, r]) => [ds.nodes.keys[n], r]),
      context: ds.events.context[i] >= 0 ? ds.contexts.keys[ds.events.context[i]] : null,
      visibility: contextVisibility(ds, ds.events.context[i]),
      parent: ds.events.parent[i],
      key: ds.events.keys[i],
      weight: ds.events.weight[i],
      text: ds.events.text[i],
    });
  }
  return out;
}

export function node(ds, key) {
  const i = ds.nodes.keys.indexOf(key);
  if (i < 0) return null;
  return { i, key, label: ds.nodes.labels[i], attrs: ds.nodes.attrs[i], isBot: !!ds.nodes.isBot[i], platformIds: ds.nodes.platformIds[i] };
}

export function ctx(ds, key) {
  const i = ds.contexts.keys.indexOf(key);
  if (i < 0) return null;
  return { i, key, name: ds.contexts.names[i], kind: ds.contexts.kinds[i], visibility: contextVisibility(ds, i), members: ds.contexts.members[i] };
}

export function countBy(list, f) {
  const m = {};
  for (const x of list) { const k = f(x); m[k] = (m[k] || 0) + 1; }
  return m;
}

export function warning(source, code) { return source.warnings.find(w => w.code === code) ?? null; }

export { EVENT_TYPES };
