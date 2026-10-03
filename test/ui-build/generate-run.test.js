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

test('decision 9: one verdict rule, planted brokers named with ranks, current construction settings', async () => {
  const { scoreVerdict, RULE } = await import('../../src/generator/recovery.js');
  const { defaultSettings } = await import('../../src/analysis/index.js');
  const res = {};
  for (const structure of ['distributed', 'bridge-dependent', 'siloed']) {
    const r = await runGenerate({ context: 'workplace', medium: 'slack', structure, seed: 1, size: 120, timespan: SPAN, content: 'none', output: 'dataset' });
    const { report } = await runRecovery(r.groundTruth, r.dataset, { seed: 1 });
    assert.equal(report.rule, RULE);
    const b = report.checks.find(c => c.id === 'bridges');
    // J5: every planted broker by name, with a measured rank, in the reading too.
    assert.equal(b.brokers.length, r.groundTruth.bridges.brokers.length);
    for (const x of b.brokers) { assert.ok(x.name && x.rank >= 1, JSON.stringify(x)); assert.ok(b.says.includes(`${x.name} ${x.rank}`)); }
    // J9: the verdict follows the stated rule from the share and its chance level (same unit).
    assert.equal(b.verdict, scoreVerdict(b.value, b.baseline));
    assert.ok(b.baseline < 0.1 && b.value <= 1);
    // J13: accounts and bots are counted for the header.
    assert.equal(report.mapping.datasetNodes, r.dataset.nodes.count);
    assert.ok(report.mapping.networkPeople <= r.dataset.nodes.count - report.mapping.bots);
    // N15: plain words with the terms in parentheses; no "communitys", dates as "24 Feb 2025".
    const com = report.checks.find(c => c.id === 'communities');
    assert.match(com.says, /\(agreement [\d.]+ out of 1; normalized mutual information \(NMI\)/);
    for (const c of report.checks) { assert.doesNotMatch(c.name + c.says, /communitys|\d{4}-\d{2}-\d{2}|within 1 days/); }
    res[structure] = { b, r };
  }
  // N24: a construction choice changes the network the check reads.
  const { r } = res['bridge-dependent'];
  const st = defaultSettings(r.dataset);
  const repliesOnly = { ...st, rules: Object.fromEntries(Object.entries(st.rules).map(([k, v]) => [k, { ...v, on: k === 'reply' }])) };
  const a = await runRecovery(r.groundTruth, r.dataset, { seed: 1 });
  const b = await runRecovery(r.groundTruth, r.dataset, { seed: 1, settings: repliesOnly });
  assert.equal(b.settings.given, true);
  const cov = rep => rep.report.checks.find(c => c.id === 'tie-coverage').value;
  assert.ok(cov(b) < cov(a), `${cov(b)} < ${cov(a)}`);
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
