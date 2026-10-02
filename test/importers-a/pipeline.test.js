import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { runImport, detectImports, planImports, subsetFileSet } from '../../src/core/pipeline.js';
import { FileSet } from '../../src/core/fileset.js';
import { fixture } from './helpers.js';

const workerPath = new URL('../../src/workers/import.worker.js', import.meta.url).href;

function takeoutZip() {
  const dir = mkdtempSync(join(tmpdir(), 'osa-pipe-'));
  const out = join(dir, 'takeout-20240905T120000Z-001.zip');
  execFileSync('python3', ['-c', `
import zipfile, os, sys
out = sys.argv[1]
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for src in sys.argv[2:]:
        for root, _, files in os.walk(src):
            for f in sorted(files):
                p = os.path.join(root, f)
                z.write(p, os.path.relpath(p, src).replace(os.sep, '/'))
`, out, fixture('email', 'takeout'), fixture('calendar', 'takeout')]);
  return out;
}

test('a Takeout zip with Mail and Calendar is split between the email and calendar importers', async () => {
  const fs = await FileSet.fromPaths([takeoutZip()]);
  const res = await runImport(fs, {});
  const ids = res.plan.map(p => p.id).sort();
  assert.deepEqual(ids, ['calendar', 'email']);
  const formats = res.dataset.meta.sources.map(s => s.format).sort();
  assert.deepEqual(formats, ['calendar', 'email']);
  // Each importer only got its own files.
  const email = res.plan.find(p => p.id === 'email');
  assert.ok(email.files.every(f => /mail/i.test(f)));
  const cal = res.plan.find(p => p.id === 'calendar');
  assert.ok(cal.files.every(f => /calendar/i.test(f)));
  assert.equal(res.report.sources.length, 2);
  assert.ok(res.report.sources.every(s => s.view === 'ego'));
  // Calendar and email share the email: namespace, so people coincide without merging.
  const types = new Set();
  for (let i = 0; i < res.dataset.events.count; i++) types.add(res.dataset.events.type[i]);
  assert.ok(types.size >= 2);
  assert.ok(res.dataset.nodes.keys.every(k => k.startsWith('email:')));
});

test('mixed drop: Slack folder plus HR CSV; the CSV is left for the profile join', async () => {
  const fs = await FileSet.fromPaths([fixture('slack', 'standard'), fixture('tabular', 'people.csv')]);
  const det = await detectImports(fs);
  assert.equal(det[0].id, 'slack');
  const res = await runImport(fs, {});
  assert.deepEqual(res.plan.map(p => p.id), ['slack']);
  assert.equal(res.plan[0].root, 'standard/');
  // integration_logs.json is part of the export (no network data): Slack claims
  // it without reading it, so only the HR CSV is left for the profile join.
  assert.deepEqual(res.unclaimed.sort(), ['people.csv']);
  assert.deepEqual(res.report.unclaimed, res.unclaimed);
  assert.equal(res.dataset.meta.sources[0].format, 'slack');
  assert.ok(res.dataset.events.count > 0);
});

test('explicit choices and per-importer options', async () => {
  const fs = await FileSet.fromPaths([fixture('tabular', 'edges.tsv')]);
  const res = await runImport(fs, {
    choices: ['tabular'],
    options: { tabular: { kind: 'edges', mapping: { actor: 'Source', targets: 'Target', weight: 'Weight', directed: 'Type', namespace: 'g' } } },
  });
  assert.equal(res.dataset.events.count, 2);
  assert.equal(res.dataset.nodes.keys[0], 'g:A');
});

test('falls back to the spreadsheet mapper when nothing else matches', async () => {
  const fs = await FileSet.fromPaths([fixture('tabular', 'people.csv')]);
  const res = await runImport(fs, {});
  assert.deepEqual(res.plan.map(p => p.id), ['tabular']);
  assert.equal(res.dataset.nodes.count, 3);
  assert.equal(res.report.sources[0].warnings[0].code, 'auto-mapping');
});

test('progress is monotonic and ends at 1; abort rejects', async () => {
  const fs = await FileSet.fromPaths([fixture('slack', 'standard')]);
  const seen = [];
  await runImport(fs, { progress: f => seen.push(f) });
  assert.equal(seen.at(-1), 1);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1] - 1e-9, `progress went back at ${i}`);
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(runImport(fs, { signal: ac.signal }), e => e.name === 'AbortError');
});

test('a failing importer is reported, not swallowed; all failing throws', async () => {
  const fs = await FileSet.fromPaths([fixture('tabular', 'edges.tsv')]);
  const ok = { id: 'ok', label: 'OK', family: 'x', detect: async () => ({ score: 0.9, files: ['edges.tsv'] }), async import(f, { builder }) { builder.beginSource({ format: 'ok' }); const a = builder.node('x:a'), b = builder.node('x:b'); builder.event({ actor: a, targets: [[b, 'to']] }); } };
  const bad = { id: 'bad', label: 'Bad', family: 'x', detect: async () => ({ score: 0.8 }), async import() { throw new Error('boom'); } };
  // 'bad' claims nothing because 'ok' took the only file, so give it its own choice.
  const res = await runImport(fs, { importers: [ok, bad], choices: ['ok', 'bad'] });
  const failed = res.report.sources.find(s => s.format === 'bad');
  assert.equal(failed.warnings[0].code, 'import-failed');
  assert.equal(failed.warnings[0].severity, 'error');
  assert.match(failed.warnings[0].message, /boom/);
  await assert.rejects(runImport(fs, { importers: [bad] }), /boom/);
  await assert.rejects(runImport(fs, { importers: [] }), /No importer recognised/);
});

test('planImports: higher score claims shared files first; unclaimed listed', () => {
  const det = [
    { id: 'a', score: 0.95, files: ['x.graphml'] },
    { id: 'b', score: 0.9, files: ['x.graphml', 'y.net'] },
    { id: 'c', score: 0.3, files: ['z.csv'] },
  ];
  const { plan, unclaimed } = planImports(det, undefined, ['x.graphml', 'y.net', 'z.csv']);
  assert.deepEqual(plan, [{ id: 'a', root: '', files: ['x.graphml'] }, { id: 'b', root: '', files: ['y.net'] }]);
  assert.deepEqual(unclaimed, ['z.csv']);
});

test('subsetFileSet keeps rel paths', async () => {
  const fs = await FileSet.fromPaths([fixture('slack', 'standard')]);
  const sub = subsetFileSet(fs, ['general/2024-03-04.json', 'users.json'].filter(r => fs.get(r)));
  for (const e of sub.entries) assert.ok(fs.get(e.rel));
  assert.ok(sub.get('users.json'));
});

// Runs the real worker module in a Node worker thread with a tiny `self` shim,
// passing Blobs across the thread boundary the way a browser passes Files.
// (Node cannot clone file-backed Blobs from fs.openAsBlob; browsers clone File
// objects fine, so tests use in-memory Blobs.)
const memBlob = p => new Blob([readFileSync(p)]);
function runWorker(msg) {
  const boot = `
    import { parentPort } from 'node:worker_threads';
    const listeners = [];
    globalThis.self = { postMessage: (m, t) => parentPort.postMessage(m, t), addEventListener: (type, f) => listeners.push(f) };
    parentPort.on('message', data => listeners.forEach(f => f({ data })));
    await import(${JSON.stringify(workerPath)});
    parentPort.postMessage({ type: 'ready' });
  `;
  const w = new Worker(new URL('data:text/javascript,' + encodeURIComponent(boot)));
  const progress = [];
  return new Promise((resolve, reject) => {
    w.on('message', m => {
      if (m.type === 'ready') {
        try { w.postMessage(msg); } catch (e) { w.terminate(); reject(e); }
        return;
      }
      if (m.type === 'progress') { progress.push(m.fraction); return; }
      w.terminate();
      if (m.type === 'done') resolve({ result: m.result, progress }); else reject(Object.assign(new Error(m.message), { name: m.name }));
    });
    w.on('error', reject);
  });
}

test('import worker: runs the pipeline on Blobs and transfers a usable dataset', async () => {
  const zip = takeoutZip();
  const { result, progress } = await runWorker({ type: 'run', files: [{ blob: memBlob(zip), path: 'takeout.zip' }], opts: { name: 'w' } });
  assert.equal(result.dataset.meta.name, 'w');
  assert.ok(result.dataset.events.t instanceof Float64Array);
  assert.ok(result.dataset.events.count > 0);
  assert.equal(result.report.sources.length, 2);
  assert.ok(progress.length >= 1);
  const det = await runWorker({ type: 'detect', files: [{ blob: memBlob(zip), path: 'takeout.zip' }] });
  assert.ok(det.result.detections.some(d => d.id === 'email'));
  assert.equal(typeof det.result.detections[0].score, 'number');
});

test('import worker: errors come back as messages', async () => {
  await assert.rejects(runWorker({ type: 'run', files: [] }), /No files to import/);
});

test('a zip that holds only a zip is opened one level further (P2)', async () => {
  const { zipSync, strToU8 } = await import('../../vendor/fflate.js');
  const inner = zipSync({ 'export/hr.csv': strToU8('source,target\nAna,Ben\nBen,Chen\n') });
  const outer = zipSync({ 'download.zip': inner, '__MACOSX/._download.zip': strToU8('x') });
  const fs = await FileSet.from([{ blob: new Blob([outer]), path: 'wrapped.zip' }]);
  assert.deepEqual(fs.entries.map(e => e.rel), ['hr.csv']);
  assert.deepEqual(fs.unwrapped, [{ outer: 'wrapped.zip', inner: 'download.zip' }]);
  const res = await runImport([{ blob: new Blob([outer]), path: 'wrapped.zip' }], {});
  assert.equal(res.dataset.events.count, 2);
  assert.ok(res.dataset.meta.sources[0].warnings.some(w => w.code === 'nested-zip' && /download\.zip/.test(w.message)));
  // Several inner zips keep their names as folders; a zip with other files is left alone.
  const two = zipSync({ 'a.zip': inner, 'b.zip': inner });
  const fs2 = await FileSet.from([{ blob: new Blob([two]), path: 'two.zip' }]);
  assert.deepEqual(fs2.entries.map(e => e.path).sort(), ['a/export/hr.csv', 'b/export/hr.csv']);
  const mixed = zipSync({ 'a.zip': inner, 'notes.txt': strToU8('hi') });
  const fs3 = await FileSet.from([{ blob: new Blob([mixed]), path: 'mixed.zip' }]);
  assert.deepEqual(fs3.entries.map(e => e.rel).sort(), ['a.zip', 'notes.txt']);
});

test('detection reports progress, and its result can be reused by the import', async () => {
  const fs = await FileSet.fromPaths([fixture('slack', 'standard')]);
  const seen = [];
  const det = await detectImports(fs, { progress: (f, m) => seen.push([f, m]) });
  assert.ok(seen.length > 5 && /Checking \d+ files/.test(seen[0][1]), seen[0]?.[1]);
  let calls = 0;
  const counting = (await import('../../src/importers/registry.js')).IMPORTERS.map(i => ({ ...i, detect: async f => { calls++; return i.detect(f); } }));
  const res = await runImport(fs, { detections: det, importers: counting });
  assert.equal(calls, 0);
  assert.equal(res.plan[0].id, 'slack');
});
