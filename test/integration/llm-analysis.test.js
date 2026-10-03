// The LLM tools were written against a fake engine. This runs every tool
// against the real analysis code, both through the pure-function adapter and
// through the inline engine, on a small dataset with text, times and attrs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder } from '../../src/core/model.js';
import * as analysis from '../../src/analysis/index.js';
import { createEngine } from '../../src/analysis/engine.js';
import { createToolRunner, engineFromAnalysis, TOOL_DEFINITIONS } from '../../src/llm/tools.js';

function dataset() {
  const b = new DatasetBuilder({ name: 'tiny', source: { format: 'test', view: 'full', context: 'workplace' } });
  const names = ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal'];
  const ids = names.map((n, i) => b.node(`t:${n}`, { label: n, attrs: { dept: i < 4 ? 'Ops' : 'Eng' } }));
  const ch = b.context('t:#gen', { name: 'general', visibility: 'public' });
  const day = 86400000, t0 = Date.UTC(2026, 0, 5);
  const words = ['great launch today', 'blocked on the release', 'thanks for the help', 'meeting moved again'];
  let k = 0;
  for (let d = 0; d < 60; d++) for (let i = 0; i < ids.length; i++) {
    const j = (i + 1 + (d % 3)) % ids.length;
    b.event({ actor: ids[i], t: t0 + d * day + i * 60000, context: ch, key: `m${k++}`, text: words[(i + d) % 4], targets: [[ids[j], 'mention']] });
  }
  return b.build();
}

const ARGS = {
  top_nodes: { metric: 'betweenness', k: 3 },
  node_profile: { node: 'Ann' },
  group_comparison: { attribute: 'dept' },
  communities: {},
  null_model: { stats: ['reciprocity', 'transitivity'], reps: 20 },
  time_series: { metric: 'degree', window: 'week' },
  content_summary: { measure: 'affect', by: 'group' },
  edge_evidence: { a: 'Ann', b: 'Bo' },
  search_nodes: { query: 'a' },
};

async function runAll(engine, ds) {
  const runner = createToolRunner({ engine, dataset: ds });
  const names = runner.definitions.map(d => d.name);
  for (const def of TOOL_DEFINITIONS) assert.ok(names.includes(def.name), `tool ${def.name} not offered`);
  for (const name of names) {
    const rec = await runner.run(name, ARGS[name] || {});
    assert.equal(rec.error, null, `${name}: ${rec.error}`);
    assert.ok(rec.content.length > 20, `${name} returned almost nothing`);
  }
  return runner;
}

test('every LLM tool runs on the pure analysis adapter', async () => {
  const ds = dataset();
  const net = analysis.buildNetwork(ds, analysis.defaultSettings(ds));
  const runner = await runAll(engineFromAnalysis(analysis, ds, net), ds);
  const prof = runner.results.find(r => r.name === 'node_profile').result;
  assert.equal(prof.inNetwork, true);
  assert.ok(prof.ego && prof.ego.size > 0, 'ego metrics present for a dataset node');
  assert.ok(!('meta' in prof.metrics), 'meta is not a metric');
});

test('every LLM tool runs on the inline engine', async () => {
  const ds = dataset();
  const engine = createEngine({ worker: false });
  await engine.load(ds);
  await engine.build(await engine.defaultSettings());
  await runAll(engine, ds);
  engine.terminate();
});

test('content_summary works for every measure and breakdown', async () => {
  const ds = dataset();
  const net = analysis.buildNetwork(ds, analysis.defaultSettings(ds));
  const runner = createToolRunner({ engine: engineFromAnalysis(analysis, ds, net), dataset: ds });
  for (const measure of ['affect', 'keywords', 'topics']) {
    for (const by of ['network', 'node', 'group', 'context', 'visibility', 'time']) {
      const rec = await runner.run('content_summary', { measure, by, k: 3 });
      assert.equal(rec.error, null, `${measure} by ${by}: ${rec.error}`);
    }
  }
  const one = await runner.run('content_summary', { measure: 'affect', by: 'node', target: 'Cy' });
  assert.equal(one.error, null);
  assert.equal(one.result.result.node.label, 'Cy');
  assert.ok(Number.isFinite(one.result.result.value.mean));
});

test('LLM tools can query two-mode measures on an affiliation network', async () => {
  const { DatasetBuilder, declareTwoMode, addAffiliation } = await import('../../src/core/model.js');
  const b = new DatasetBuilder({ name: 'clubs', source: { format: 'test', view: 'full', context: 'survey' } });
  declareTwoMode(b, ['Students', 'Clubs']);
  const m = { Ana: ['Chess', 'Choir'], Ben: ['Chess'], Cy: ['Choir', 'Drama'], Di: ['Drama'], Ed: ['Chess', 'Drama'] };
  for (const [who, clubs] of Object.entries(m)) for (const c of clubs) addAffiliation(b, `s:${who}`, `c:${c}`, { actorLabel: who, eventLabel: c });
  const ds = b.build();
  const net = analysis.buildNetwork(ds, analysis.defaultSettings(ds));
  const runner = createToolRunner({ engine: engineFromAnalysis(analysis, ds, net), dataset: ds });
  const rec = await runner.run('top_nodes', { metric: 'twoModeBetweenness', k: 3 });
  assert.equal(rec.error, null, rec.error);
  const sum = await runner.run('network_summary', {});
  assert.equal(sum.error, null, sum.error);
});
