import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeReport, REPORT_SECTIONS, reportPlan, ensureSections } from '../../src/llm/reports.js';
import { buildMethodsAppendix, REFERENCES } from '../../src/llm/methods.js';
import { makeDataset, makeEngine, fakeProvider } from './helpers.js';

const ds = makeDataset();

function writerFor(sections, extra = '') {
  return req => {
    const ids = [...req.messages[0].content.matchAll(/"result_id":"(T\d+)"/g)].map(m => m[1]);
    return { text: sections.map(s => `## ${s}\n\nText for ${s} [${ids[0]}].`).join('\n\n') + extra };
  };
}

for (const scope of ['network', 'group', 'node']) {
  test(`${scope} report has every section, a result index and passes the citation check`, async () => {
    const target = scope === 'group' ? 'dept' : scope === 'node' ? 'slack:U1' : undefined;
    const provider = fakeProvider([writerFor(REPORT_SECTIONS[scope])]);
    const r = await writeReport({ scope, target, provider, key: 'k', engine: makeEngine(), dataset: ds });
    for (const s of REPORT_SECTIONS[scope]) assert.match(r.markdown, new RegExp(`^## ${s}$`, 'm'));
    assert.deepEqual(r.missingSections, []);
    assert.match(r.markdown, /## Result index\n\n- T1: network_summary/);
    assert.deepEqual(r.unverifiedNumbers, []);
    // The model was given results, not tools.
    assert.deepEqual(provider.requests[0].tools, []);
    assert.ok(r.toolResults.length >= 3);
    assert.match(provider.requests[0].system, /Do not infer personal traits/);
  });
}

test('report: code chooses the tool calls; missing engine methods are skipped', async () => {
  const engine = makeEngine({ timeSeries: undefined });
  const provider = fakeProvider([writerFor(REPORT_SECTIONS.network)]);
  const r = await writeReport({ scope: 'network', provider, key: 'k', engine, dataset: ds });
  const names = r.toolResults.map(t => t.name);
  assert.deepEqual(names, ['network_summary', 'applicability', 'null_model', 'top_nodes', 'top_nodes', 'top_nodes', 'communities', 'group_comparison', 'content_summary', 'content_summary']);
  const plan = reportPlan('group', 'dept', ds);
  assert.equal(plan.filter(p => p[0] === 'top_nodes').length, 3); // one per dept value
});

test('report: missing sections are added, invented numbers flagged', async () => {
  const provider = fakeProvider([{ text: '## Overview\n\nThere are 6 nodes [T1] and 99 teams.' }]);
  const r = await writeReport({ scope: 'node', target: 'Ada Park', provider, key: 'k', engine: makeEngine(), dataset: ds });
  assert.deepEqual(r.missingSections, REPORT_SECTIONS.node.slice(1));
  assert.match(r.markdown, /## Caveats\n\n_No text was written for this section._/);
  assert.deepEqual(r.unverifiedNumbers.map(u => u.text), ['99']);
  assert.equal(ensureSections('## A\n\nx', ['A']).missing.length, 0);
  await assert.rejects(writeReport({ scope: 'node', provider, key: 'k', engine: makeEngine(), dataset: ds }), /needs a target/);
});

// ---- methods appendix ----------------------------------------------------------

const settings = {
  rules: { reply: { on: true, weight: 2 }, mention: { on: true, weight: 1 }, adjacency: { on: true, weight: 0.5, windowMin: 10 }, dm: { on: false, weight: 1 } },
  directed: true, weighting: 'log', minWeight: 2, maxRecipients: 25, time: { start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 5, 30) },
  visibility: ['public'], media: null, excludeBots: true, includeIsolates: false,
};

test('methods appendix: full analysis with every component', () => {
  const md = buildMethodsAppendix({
    dataset: ds, settings, network: { n: 6, directed: true, edges: { count: 11 } },
    metrics: ['degree', 'betweenness', 'closeness', 'constraint', 'pagerank', 'coreNumber'], networkStats: ['density', 'transitivity', 'modularity'],
    approx: { betweenness: 'sampled from 256 pivot nodes' },
    communities: { method: 'louvain', resolution: 1, seed: 42 }, groups: ['dept'],
    nullModel: { stats: ['transitivity'], reps: 500, seed: 7 }, resampling: { metric: 'betweenness', reps: 200, top: 5, seed: 3, scheme: 'events resampled with replacement' },
    time: { window: 'month', start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 5, 30), metrics: ['density'] },
    content: { affect: { by: 'group' }, keywords: { by: 'context', k: 10 }, topics: { k: 8, seed: 1 } },
    software: { name: 'Org Signal', version: '2.0.0-dev' },
  });
  for (const h of ['Data sources', 'Network construction', 'Measures', 'Community detection', 'Group comparison', 'Statistical comparison and robustness', 'Time windows', 'Content analysis', 'Limitations', 'References']) {
    assert.match(md, new RegExp(`^## ${h}$`, 'm'), h);
  }
  assert.match(md, /Replies: a reply links the replier.*weight 2\./);
  assert.match(md, /Turn-taking: .*\(window 10 minutes\); weight 0\.5\./);
  assert.ok(!/- Direct messages:/.test(md), 'disabled rules are not listed');
  assert.match(md, /log-transformed/);
  assert.match(md, /more than 25 recipients/);
  assert.match(md, /from 1 Jan 2026 to 30 Jun 2026/);
  assert.match(md, /\(Freeman, 1977; Brandes, 2001\) Approximation: sampled from 256 pivot nodes\./);
  assert.match(md, /Louvain method \(Blondel et al., 2008\)/);
  assert.match(md, /seed 42/);
  assert.match(md, /Krackhardt & Stern, 1988/);
  assert.match(md, /500 degree-preserving randomizations produced by edge swapping \(Maslov & Sneppen, 2002\)/);
  assert.match(md, /VADER \(Hutto & Gilbert, 2014\)/);
  assert.match(md, /latent Dirichlet allocation \(Blei et al., 2003\) with 8 topics/);
  for (const k of ['brandes2001', 'burt1992', 'blondel2008', 'newman2003', 'krackhardt1988', 'hutto2014', 'maslov2002']) {
    assert.ok(md.includes(REFERENCES[k]), k);
  }
  assert.ok(!md.includes(REFERENCES.cohen1960), 'uncited references are not listed');
});

test('methods appendix: minimal settings, ego view limitations, no inference sections', () => {
  const ego = { meta: { sources: [{ format: 'mbox', family: 'email', medium: 'email', view: 'ego', context: 'personal', egoKey: 'email:me@x.org', fileNames: ['a.mbox'], counts: { messages: 1200 }, warnings: [{ code: 'x', message: 'Messages without a date', count: 3 }] }] } };
  const md = buildMethodsAppendix({ ...ego, settings: { rules: { to: { on: true, weight: 1 } }, directed: false, weighting: 'binary' }, metrics: ['degree'] });
  assert.match(md, /View: \*ego\*, i\.e\. one person's own interactions/);
  assert.match(md, /The ego is the export owner\./);
  assert.match(md, /Records: 1,200 messages\./);
  assert.match(md, /Import note: Messages without a date \(3\)\./);
  assert.match(md, /treated as undirected; tie weights were binary/);
  assert.match(md, /Ego-view sources record only the export owner's own interactions/);
  for (const h of ['Community detection', 'Statistical comparison', 'Time windows', 'Content analysis']) assert.ok(!md.includes(`## ${h}`), h);
  assert.match(md, /Freeman, L\. C\. \(1978\)/);
});

test('methods appendix: LLM coding with and without double-coding', () => {
  const codebook = { name: 'Help', multiLabel: false, codes: [{ id: 'ask', label: 'Request', definition: 'Asks for help' }, { id: 'give', definition: 'Offers help' }] };
  const coding = { codebook, sample: { size: 120, population: 4000, strataBy: 'context', seed: 9 },
    settings: { provider: 'anthropic', model: 'claude-opus-5-5', batchSize: 20, doubleCode: true, secondModel: 'claude-opus-5-5', maxChars: 1000 },
    agreement: { overall: { kappa: 0.8123, alpha: 0.8101, agreement: 0.9 } } };
  const md = buildMethodsAppendix({ meta: { sources: [] }, settings: {}, content: { coding } });
  assert.match(md, /model `claude-opus-5-5`\) using a codebook of 2 codes \(one code per message\)/);
  assert.match(md, /120 messages was drawn from 4,000 eligible messages, stratified by context/);
  assert.match(md, /Cohen's kappa 0\.812, Krippendorff's alpha 0\.810, raw agreement 0\.900/);
  assert.match(md, /Cohen, J\. \(1960\)/);
  assert.match(md, /- `ask` \(Request\): Asks for help/);
  const single = buildMethodsAppendix({ meta: { sources: [] }, settings: {}, content: { coding: { ...coding, settings: { ...coding.settings, doubleCode: false } } } });
  assert.match(single, /not double-coded/);
  assert.ok(!single.includes('Cohen, J.'));
});
