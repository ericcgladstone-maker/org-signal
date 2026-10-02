import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyst, ANALYST_SYSTEM_PROMPT } from '../../src/llm/analyst.js';
import { createToolRunner, availableTools, TOOL_DEFINITIONS, validate, engineFromAnalysis, compact } from '../../src/llm/tools.js';
import { checkCitations, extractNumbers } from '../../src/llm/citations.js';
import { anthropic } from '../../src/llm/providers/index.js';
import { makeDataset, makeEngine, fakeProvider, fakeFetch, fixture } from './helpers.js';

const ds = makeDataset();

// ---- tools ---------------------------------------------------------------------

test('every tool has a valid schema and a handler result with an id', async () => {
  const engine = makeEngine();
  const runner = createToolRunner({ engine, dataset: ds });
  assert.equal(runner.definitions.length, TOOL_DEFINITIONS.length);
  const args = {
    network_summary: {}, top_nodes: { metric: 'betweenness', k: 3, uncertainty: true }, node_profile: { node: 'Ada Park' },
    group_comparison: { attribute: 'dept' }, communities: {}, null_model: { stats: ['transitivity'] },
    time_series: { metric: 'density', window: 'month' }, content_summary: { measure: 'affect' },
    edge_evidence: { a: 'slack:U1', b: 'Ben Ortiz' }, applicability: {}, search_nodes: { query: 'sales' },
  };
  for (const d of runner.definitions) {
    assert.equal(d.parameters.type, 'object', d.name);
    const rec = await runner.run(d.name, args[d.name]);
    assert.equal(rec.error, null, `${d.name}: ${rec.error}`);
    assert.match(rec.id, /^T\d+$/);
    assert.equal(JSON.parse(rec.content).result_id, rec.id);
  }
  const ids = runner.results.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('top_nodes ranks, filters and attaches resampled uncertainty', async () => {
  const runner = createToolRunner({ engine: makeEngine(), dataset: ds });
  const r = (await runner.run('top_nodes', { metric: 'betweenness', k: 2, uncertainty: true })).result;
  assert.deepEqual(r.nodes.map(n => [n.rank, n.label, n.value]), [[1, 'Ada Park', 0.4123], [2, 'Dev Rao', 0.3]]);
  assert.equal(r.nodes[0].topShare, 0.93);
  assert.equal(r.applicability.level, 'ok');
  const f = (await runner.run('top_nodes', { metric: 'degree', k: 5, filter: { attribute: 'dept', value: 'sales' } })).result;
  assert.deepEqual(f.nodes.map(n => n.label), ['Cara Liu', 'Dev Rao']);
  const low = (await runner.run('top_nodes', { metric: 'constraint', k: 1, ascending: true })).result;
  assert.equal(low.nodes[0].label, 'Ada Park');
});

test('tool input is validated before anything runs', async () => {
  const engine = makeEngine();
  const runner = createToolRunner({ engine, dataset: ds });
  const before = engine.calls.length;
  const bad = await runner.run('top_nodes', { metric: 'charisma' });
  assert.match(bad.error, /must be one of/);
  const trunc = await runner.run('top_nodes', {}, { invalidArguments: '{"metric": "betw' });
  assert.match(trunc.error, /not valid JSON/);
  const extra = await runner.run('network_summary', { hack: 1 });
  assert.match(extra.error, /not a known parameter/);
  const unknown = await runner.run('rm_rf', {});
  assert.match(unknown.error, /Unknown tool/);
  assert.equal(engine.calls.length, before);
  assert.equal(validate({ type: 'integer', minimum: 1 }, 0, 'k'), 'k must be >= 1');
});

test('node references: ambiguous and missing are errors, not guesses', async () => {
  const runner = createToolRunner({ engine: makeEngine(), dataset: ds });
  const amb = await runner.run('node_profile', { node: 'a' });
  assert.match(amb.error, /ambiguous/);
  assert.ok(amb.result.candidates.length > 1);
  const none = await runner.run('node_profile', { node: 'Zed' });
  assert.match(none.error, /No node matches/);
  const ok = await runner.run('node_profile', { node: 'eve kim' });
  assert.equal(ok.result.key, 'slack:U5');
  assert.equal(ok.result.metrics.degree.value, 1);
  assert.equal(ok.result.community, 2);
});

test('tools missing from the engine are not offered', () => {
  const engine = makeEngine({ nullModel: undefined, timeSeries: undefined, affect: undefined, keywords: undefined });
  const names = availableTools(engine).map(t => t.name);
  assert.ok(!names.includes('null_model'));
  assert.ok(!names.includes('time_series'));
  assert.ok(!names.includes('content_summary'));
  assert.ok(names.includes('top_nodes'));
});

test('engineFromAnalysis adapts the pure analysis API', async () => {
  const net = { n: 6, directed: false, nodeIds: Int32Array.from([0, 1, 2, 3, 4, 5]), edges: { count: 7 }, settings: {}, summary: {} };
  let metricCalls = 0;
  const analysis = {
    computeNetworkMetrics: () => ({ density: 0.4667 }),
    computeNodeMetrics: (n, { which }) => { metricCalls++; return Object.fromEntries(which.map(m => [m, new Float64Array(6).fill(1)])); },
    detectCommunities: () => ({ membership: Int32Array.from([0, 0, 0, 1, 1, 1]), modularity: 0.3, count: 2 }),
    applicability: () => ({}),
  };
  const engine = engineFromAnalysis(analysis, ds, net);
  const runner = createToolRunner({ engine, dataset: ds });
  assert.deepEqual(runner.definitions.map(d => d.name).sort(), ['applicability', 'communities', 'network_summary', 'node_profile', 'search_nodes', 'top_nodes']);
  assert.equal((await runner.run('network_summary', {})).result.metrics.density, 0.4667);
  await runner.run('top_nodes', { metric: 'degree' });
  await runner.run('top_nodes', { metric: 'degree' });
  assert.equal(metricCalls, 1); // memoized
});

test('compact rounds floats and caps lists', () => {
  assert.deepEqual(compact({ a: 0.123456, b: Float64Array.from([1.23456, NaN]), c: 'x'.repeat(500).length }), { a: 0.1235, b: [1.235, null], c: 500 });
  assert.equal(compact(Array.from({ length: 60 }, (_, i) => i)).length, 51);
});

// ---- citation check ------------------------------------------------------------

test('number extraction', () => {
  const n = extractNumbers('Density is 0.37, 1,234 ties, 23.4% and -0.12 (z = 3.3) on 2026-01-02 [T3].');
  assert.deepEqual(n.map(x => [x.value, x.percent]), [[0.37, false], [1234, false], [23.4, true], [-0.12, false], [3.3, false], [2026, false], [1, false], [2, false]]);
});

test('citation check passes rounded real numbers and flags invented ones', () => {
  const results = [{ id: 'T1', name: 'network_summary', args: {}, result: { density: 0.3667, nodes: 6, transitivity: 0.3125 } },
    { id: 'T2', name: 'null_model', args: { stats: ['transitivity'] }, result: { results: { transitivity: { z: 3.31, p: 0.002 } } } }];
  const ok = checkCitations('Density is 0.37 [T1] and about 0.4 overall; transitivity 31.25% (z = 3.3, p = 0.002) [T2] across 6 people.', results);
  assert.deepEqual(ok.unverifiedNumbers, []);
  assert.deepEqual(ok.citations.map(c => c.id), ['T1', 'T2']);
  const bad = checkCitations('Density is 0.37 [T1], and 42% of ties cross departments [T9]. Transitivity is 0.35.', results);
  assert.deepEqual(bad.unverifiedNumbers.map(u => u.text), ['42%', '0.35']);
  assert.deepEqual(bad.unknownCitationIds, ['T9']);
});

test('citation check exempts list markers and author-year references', () => {
  const r = checkCitations('1. Ada leads [T1].\n2. Burt (1992) and Blondel et al. 2008 describe this.', [{ id: 'T1', name: 'x', args: {}, result: {} }]);
  assert.deepEqual(r.unverifiedNumbers, []);
  const neg = checkCitations('The E-I index is 0.12.', [{ id: 'T1', name: 'x', args: {}, result: { ei: -0.12 } }]);
  assert.equal(neg.unverifiedNumbers.length, 1); // sign must match
});

// ---- analyst loop --------------------------------------------------------------

test('analyst runs tool calls, feeds results back, and checks citations', async () => {
  const engine = makeEngine();
  const provider = fakeProvider([
    { text: 'Checking.', toolCalls: [{ id: 'c1', name: 'applicability', arguments: {} }, { id: 'c2', name: 'top_nodes', arguments: { metric: 'betweenness', k: 2, uncertainty: true } }] },
    req => {
      // The second request must contain the tool results with their ids.
      const tools = req.messages.filter(m => m.role === 'tool');
      assert.equal(tools.length, 2);
      assert.equal(JSON.parse(tools[1].content).result_id, 'T2');
      return { text: 'Ada Park has the highest betweenness, 0.41 [T2], and stays in the top 2 in 93% of resamples [T2]. Betweenness applies to this data [T1].' };
    },
  ]);
  const analyst = createAnalyst({ provider, key: 'k', model: 'fake-1', engine, dataset: ds });
  const seen = [];
  const out = await analyst.ask('Who brokers between teams?', { onToolCall: c => seen.push(c.name) });
  assert.deepEqual(seen, ['applicability', 'top_nodes']);
  assert.deepEqual(out.unverifiedNumbers, []);
  assert.deepEqual(out.citations.map(c => c.id).sort(), ['T1', 'T2']);
  assert.equal(out.toolResults.length, 2);
  assert.equal(out.usage.inputTokens, 200);
  // System prompt carries the grounding and trait rules plus dataset context, no numbers.
  const sys = provider.requests[0].system;
  assert.ok(sys.startsWith(ANALYST_SYSTEM_PROMPT));
  assert.match(sys, /flight risk/);
  assert.match(sys, /General research context \(not computed from this data\)/);
  assert.match(sys, /view: full/);
  assert.equal(provider.requests[0].tools.length, TOOL_DEFINITIONS.length);
  assert.equal(analyst.history.length, 5);
});

test('analyst flags an invented number', async () => {
  const provider = fakeProvider([
    { toolCalls: [{ id: 'c1', name: 'network_summary', arguments: {} }] },
    { text: 'Density is 0.37 [T1], which is higher than the typical 0.15 for firms this size.' },
  ]);
  const out = await createAnalyst({ provider, key: 'k', engine: makeEngine(), dataset: ds }).ask('How dense is it?');
  assert.deepEqual(out.unverifiedNumbers.map(u => u.text), ['0.15']);
});

test('analyst: numbers from an earlier turn must be re-fetched (turn scope)', async () => {
  const provider = fakeProvider([
    { toolCalls: [{ id: 'c1', name: 'network_summary', arguments: {} }] },
    { text: 'Density 0.37 [T1].' },
    { text: 'As before, density is 0.37.' },
  ]);
  const analyst = createAnalyst({ provider, key: 'k', engine: makeEngine(), dataset: ds });
  await analyst.ask('density?');
  const second = await analyst.ask('remind me');
  assert.equal(second.unverifiedNumbers.length, 1);
  // The second request carried the whole first turn.
  assert.equal(provider.requests[2].messages.length, 5);
  analyst.reset();
  assert.equal(analyst.history.length, 0);
});

test('analyst returns bad tool input to the model instead of running it', async () => {
  const engine = makeEngine();
  const provider = fakeProvider([
    { toolCalls: [{ id: 'c1', name: 'top_nodes', arguments: {}, invalidArguments: '{"metric":' }] },
    req => {
      const t = req.messages.find(m => m.role === 'tool');
      assert.equal(t.isError, true);
      return { text: 'I could not compute that.' };
    },
  ]);
  const out = await createAnalyst({ provider, key: 'k', engine, dataset: ds }).ask('top?');
  assert.equal(out.toolResults[0].error.startsWith('Arguments were not valid JSON'), true);
  assert.ok(!engine.calls.some(c => c[0] === 'nodeMetrics'));
});

test('analyst handles refusal and step limit', async () => {
  const refuse = fakeProvider([{ text: '', stopReason: 'refusal' }]);
  const r = await createAnalyst({ provider: refuse, key: 'k', engine: makeEngine(), dataset: ds }).ask('x');
  assert.equal(r.refused, true);
  const loop = fakeProvider(Array.from({ length: 3 }, (_, i) => ({ toolCalls: [{ id: `c${i}`, name: 'applicability', arguments: {} }] })));
  const l = await createAnalyst({ provider: loop, key: 'k', engine: makeEngine(), dataset: ds, maxSteps: 3 }).ask('x');
  assert.equal(l.stopReason, 'max_steps');
});

test('analyst end to end over the Anthropic adapter with replayed SSE', async () => {
  const toolTurn = fixture('anthropic-tool.sse');
  const answer = fixture('anthropic-text.sse').replace('"Hello"', '"Ada Park ranks first at 0.4123 [T1]."').replace('" there!"', '""');
  const fetch = fakeFetch([{ sse: true, body: toolTurn }, { sse: true, body: answer }]);
  const out = await createAnalyst({ provider: anthropic, key: 'sk-ant-api03-FAKEFAKEFAKEFAKE', model: 'claude-opus-5-5', engine: makeEngine(), dataset: ds, fetch }).ask('Who brokers?');
  assert.equal(out.text, 'Ada Park ranks first at 0.4123 [T1].');
  assert.deepEqual(out.unverifiedNumbers, []);
  const second = fetch.calls[1].body.messages;
  assert.equal(second[2].content[0].type, 'tool_result');
  assert.equal(JSON.parse(second[2].content[0].content).result_id, 'T1');
});
