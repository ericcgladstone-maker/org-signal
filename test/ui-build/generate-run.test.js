// The Generate view's worker-side work, run in Node: the recovery check gets
// real analysis results (P1), and native downloads load in Data as they are
// (P2, P37): one file is handed over as is, several files go in one zip with
// no zip inside it, and both read back like the generator's own files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from '../../vendor/fflate.js';
import { runGenerate, runRecovery } from '../../src/ui/generate/run.js';
import { packNative, groundTruthJSON, readmeText } from '../../src/ui/generate/pack.js';
import { runImport } from '../../src/core/pipeline.js';

const SPAN = { start: '2025-03-03', days: 21 };

test('recovery check compares detected communities and brokers, not "not checked"', async () => {
  const r = await runGenerate({ context: 'workplace', medium: 'slack', structure: 'bridge-dependent', seed: 1, size: 80, timespan: SPAN, content: 'none', output: 'dataset' });
  const { report } = await runRecovery(r.groundTruth, r.dataset, { seed: 1 });
  const byId = Object.fromEntries(report.checks.map(c => [c.id, c]));
  assert.notEqual(byId.communities.verdict, 'not checked', byId.communities.says);
  assert.notEqual(byId.bridges.verdict, 'not checked', byId.bridges.says);
  assert.match(byId.communities.name, /detected communities/);
});

const count = ds => [ds.nodes.count, ds.events.count];
async function readBack(download) {
  return runImport([{ blob: new Blob([download.bytes]), path: download.name }]);
}

test('a single-file export (Slack zip) is downloaded as it is and imports in one step', async () => {
  const r = await runGenerate({ context: 'workplace', medium: 'slack', seed: 2, size: 20, timespan: SPAN, output: 'native' });
  assert.match(r.download.name, /Slack export .*\.zip$/);
  assert.deepEqual(r.download.entries, [r.fileList[0].path]);
  const { dataset, plan } = await readBack(r.download);
  assert.deepEqual([...new Set(plan.map(p => p.id))], ['slack']);
  assert.deepEqual(count(dataset), count(r.dataset));
});

for (const [context, medium] of [['personal', 'whatsapp'], ['community', 'discord'], ['community', 'reddit']]) {
  test(`a multi-file export (${medium}) is one zip with no zip inside, reading back the same`, async () => {
    const spec = { context, medium, seed: 3, size: 20, timespan: SPAN, output: 'native', tzOffsetHours: 0 };
    const r = await runGenerate(spec);
    assert.ok(r.fileList.length > 1);
    const names = Object.keys(unzipSync(r.download.bytes));
    assert.ok(!names.some(n => /\.zip$/i.test(n)), names.join(', '));
    const { generate } = await import('../../src/generator/index.js');
    const { files } = generate(spec);
    const direct = await runImport(files.map(f => ({ blob: new Blob([f.bytes]), path: f.path })));
    const packed = await readBack(r.download);
    assert.deepEqual(count(packed.dataset), count(direct.dataset));
  });
}

test('ground truth JSON and README', async () => {
  const r = await runGenerate({ context: 'online', medium: 'x', seed: 1, size: 40, timespan: SPAN, output: 'native' });
  const gt = JSON.parse(groundTruthJSON(r.groundTruth));
  assert.equal(gt.communities.attr, 'planted_group');
  assert.equal(gt.communities.membership.length, 40);
  assert.ok(Array.isArray(gt.ties.a));
  const txt = readmeText({ spec: { context: 'online', medium: 'x', seed: 1 }, groundTruth: r.groundTruth, files: r.download.entries, gtName: 'x.ground-truth.json' });
  assert.match(txt, /x\.ground-truth\.json/);
  assert.match(txt, /fake/);
  assert.ok(txt.includes(r.download.entries[0]));
  assert.throws(() => packNative([]), /no native files/);
});
