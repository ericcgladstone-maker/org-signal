// Engine tests. Node has no Web Worker, so the worker path is exercised with an
// in-process double that runs the real worker-side code (attachWorker) behind
// structured-clone message passing. No real workers are created, so nothing
// can leak handles.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, attachWorker } from '../../src/analysis/engine.js';
import { messageDataset } from './helpers.js';

function fakeWorkerFactory(stats = { spawned: 0, terminated: 0 }) {
  return () => {
    stats.spawned++;
    let dead = false;
    const w = { onmessage: null, onerror: null };
    const scope = {
      onmessage: null,
      postMessage(msg) { const data = structuredClone(msg); setImmediate(() => { if (!dead) w.onmessage?.({ data }); }); },
    };
    attachWorker(scope);
    w.postMessage = (msg, transfer = []) => {
      const data = structuredClone(msg, { transfer });
      setImmediate(() => { if (!dead) scope.onmessage({ data }); });
    };
    w.terminate = () => { dead = true; stats.terminated++; };
    return w;
  };
}

for (const mode of ['inline', 'worker']) {
  test(`engine (${mode}): full flow mirrors the pure functions`, async () => {
    const ds = messageDataset(30, 500, { text: (a) => (a % 2 ? 'great work on the product launch timeline' : 'the release build is broken again today') });
    const engine = mode === 'inline' ? createEngine({ worker: false }) : createEngine({ workerFactory: fakeWorkerFactory() });
    assert.equal(engine.mode, mode);
    await engine.load(ds);
    const s = await engine.defaultSettings();
    assert.equal(s.rules.dm.on, true);
    const info = await engine.build(s);
    assert.equal(info.n, 30);
    assert.ok(info.nodeIds instanceof Int32Array);
    const progress = [];
    const m = await engine.nodeMetrics({ which: ['degree', 'betweenness'] }, { onProgress: (f) => progress.push(f) });
    assert.equal(m.degree.length, 30);
    // The worker throttles progress to one message per 50 ms; inline sees every step.
    assert.ok(progress.length >= (mode === 'inline' ? 4 : 1) && progress.at(-1) === 1);
    const nm = await engine.networkMetrics();
    assert.ok(nm.density > 0);
    const c = await engine.communities({ seed: 1 });
    assert.equal(c.membership.length, 30);
    const g = await engine.groups('team');
    assert.equal(g.groups.length, 4);
    assert.equal((await engine.groupMetrics('team')).eiIndex, g.eiIndex);
    const ego = await engine.ego(info.nodeIds[0], { attr: 'team' });
    assert.ok(ego.size > 0 && ego.diversity >= 0);
    const nul = await engine.nullModel({ stats: ['reciprocity'], reps: 10 });
    assert.ok(Number.isFinite(nul.reciprocity.z));
    const rr = await engine.resampleRanks({ metric: 'degree', reps: 5, top: 3 });
    assert.equal(rr.length, 30);
    const ap = await engine.applicability();
    assert.equal(ap.reciprocity.level, 'ok');
    const ts = await engine.timeSeries({ window: 'month' });
    assert.ok(ts.windows.length >= 3);
    const sh = await engine.detectShifts(ts, {});
    assert.ok(Array.isArray(sh.shifts));
    const ba = await engine.compareBeforeAfter(Date.UTC(2026, 1, 15), { reps: 50 });
    assert.ok(ba.node.degree.n > 0);
    const af = await engine.affect({ by: 'node' });
    assert.equal(af.coverage.withText, 500);
    const kw = await engine.keywords({ by: 'group', attr: 'team' });
    assert.ok(kw.units.length > 0);
    const tp = await engine.topics({ k: 2, iterations: 10, maxDfShare: 1 });
    assert.equal(tp.topics.length, 2);
    const df = await engine.diffusion({ terms: ['launch'], reps: 10 });
    assert.equal(df.terms[0].term, 'launch');
    const ev = await engine.edgeEvidence(ds.events.actor[0], ds.events.tgt[0], { limit: 3 });
    assert.ok(ev.length >= 1 && ev[0].rule === 'dm');
    assert.equal((await engine.info()).n, 30);
    assert.deepEqual(await engine.nodeIds(), info.nodeIds);
    const gl = await engine.glossary();
    assert.ok(gl.betweenness.meaning);
    engine.terminate();
  });
}

test('graphForRender: capped, laid out, stable across calls and engines', async () => {
  const ds = messageDataset(80, 600, { seed: 3 });
  const e1 = createEngine({ worker: false });
  await e1.load(ds);
  await e1.build();
  const r1 = await e1.graphForRender({ maxNodes: 50, iterations: 50, seed: 2 });
  assert.equal(r1.nodes.count, 50);
  assert.equal(r1.truncated.nodes, 30);
  assert.equal(r1.nodes.x.length, 50);
  assert.ok(r1.nodes.x.every(Number.isFinite));
  for (let e = 0; e < r1.edges.count; e++) assert.ok(r1.edges.src[e] < 50 && r1.edges.dst[e] < 50);
  const r1b = await e1.graphForRender({ maxNodes: 50, iterations: 50, seed: 2 });
  assert.deepEqual(r1b.nodes.x, r1.nodes.x, 'same call, same positions');
  const e2 = createEngine({ workerFactory: fakeWorkerFactory() });
  await e2.load(ds);
  await e2.build();
  const r2 = await e2.graphForRender({ maxNodes: 50, iterations: 50, seed: 2 });
  assert.deepEqual(r2.nodes.x, r1.nodes.x, 'deterministic across engines');
  assert.deepEqual(r2.nodes.labels, r1.nodes.labels);
  // A rebuilt network starts from the previous positions.
  await e1.build({ weighting: 'binary' });
  const r3 = await e1.graphForRender({ maxNodes: 50, iterations: 1, seed: 2 });
  const i = r3.nodes.ids.indexOf(r1.nodes.ids[0]);
  if (i >= 0) assert.ok(Math.abs(r3.nodes.x[i] - r1.nodes.x[0]) < Math.abs(r1.nodes.x[0]) + 50);
  e1.terminate(); e2.terminate();
});

test('cancel rejects pending calls with AbortError and the engine recovers', async () => {
  const stats = { spawned: 0, terminated: 0 };
  const engine = createEngine({ workerFactory: fakeWorkerFactory(stats) });
  const ds = messageDataset(20, 200);
  await engine.load(ds);
  await engine.build({ weighting: 'log' });
  const p = engine.nodeMetrics({});
  engine.cancel();
  await assert.rejects(p, { name: 'AbortError' });
  assert.equal(stats.terminated, 1);
  // Next call restores the dataset and the last settings in a fresh worker.
  const info = await engine.network();
  assert.equal(stats.spawned, 2);
  assert.equal(info.settings.weighting, 'log');
  const ac = new AbortController();
  const q = engine.nodeMetrics({ which: ['degree'] }, { signal: ac.signal });
  ac.abort();
  await assert.rejects(q, { name: 'AbortError' });
  const m = await engine.nodeMetrics({ which: ['degree'] });
  assert.equal(m.degree.length, info.n);
  // Errors in the worker come back as rejections, not crashes.
  await assert.rejects(engine.groups('no-such-attr-but-fine').then(() => engine.compareBeforeAfter(0)), /inside the data|dated/);
  engine.terminate();
  // The signal fired before the call was posted, so no worker had to be killed for it.
  assert.equal(stats.terminated, 2);
});

test('progress callbacks passed inside options are lifted out before posting', async () => {
  const engine = createEngine({ workerFactory: fakeWorkerFactory() });
  await engine.load(messageDataset(15, 100));
  let calls = 0;
  const r = await engine.nullModel({ stats: ['transitivity'], reps: 5, onProgress: () => calls++ });
  assert.ok(r.transitivity);
  assert.ok(calls >= 1);
  engine.terminate();
});

test('graphForRender exposes flat aliases the UI adapter reads', async () => {
  const engine = createEngine({ worker: false });
  await engine.load(messageDataset(25, 200));
  const r = await engine.graphForRender({ iterations: 5 });
  assert.equal(r.x, r.nodes.x);
  assert.equal(r.nodeIds, r.nodes.ids);
  assert.equal(r.src.length, r.edges.count);
  assert.equal(r.layerMask.length, r.edges.count);
  assert.equal(r.byRule.dm.length, r.edges.count);
  engine.terminate();
});
