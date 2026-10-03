import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, listContexts, recoveryCheck } from '../../src/generator/index.js';
import { toJSON, eventTargets, EVENT_TYPES } from '../../src/core/model.js';
import vader from '../../vendor/vader.js';
import { analyze } from './helpers.js';

const score = t => vader.SentimentIntensityAnalyzer.polarity_scores(t).compound;
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const stable = ds => { const c = { ...ds, meta: { ...ds.meta, createdAt: 0 } }; return toJSON(c); };

test('listContexts describes every context, medium, preset and param', () => {
  const list = listContexts();
  assert.deepEqual(list.map(c => c.id), ['workplace', 'online', 'professional', 'personal', 'community', 'survey']);
  for (const c of list) {
    assert.ok(c.media.length && c.media.every(m => m.id && m.label && Array.isArray(m.observations) && m.importer), c.id);
    assert.ok(c.params.find(p => p.key === 'size'), c.id);
    assert.ok(c.presets.length >= 3, c.id);
    for (const p of c.params) assert.ok(p.key in c.defaults, `${c.id}.${p.key}`);
  }
  const wp = list[0];
  assert.deepEqual(wp.presets.map(p => p.id), ['distributed', 'bridge-dependent', 'siloed', 'consolidating', 'declining', 'reorg-midpoint']);
});

test('every context, medium and preset generates a non-empty dataset', () => {
  for (const c of listContexts()) for (const m of c.mediaIds) for (const p of c.presets) {
    const { dataset, groundTruth } = generate({ context: c.id, medium: m, structure: p.id, seed: 2, size: c.id === 'survey' ? 20 : 60, content: 'light' });
    assert.ok(dataset.events.count > 0, `${c.id}/${m}/${p.id}`);
    assert.equal(groundTruth.people.count, groundTruth.people.keys.length);
    assert.equal(dataset.meta.sources[0].context, c.id);
  }
});

test('determinism: same spec and seed give identical output; another seed differs', () => {
  const spec = { context: 'workplace', medium: 'slack', size: 60, seed: 42, content: 'full', structure: 'reorg-midpoint' };
  const a = generate(spec), b = generate(spec), c = generate({ ...spec, seed: 43 });
  assert.equal(stable(a.dataset), stable(b.dataset));
  assert.equal(JSON.stringify(a.groundTruth, rep), JSON.stringify(b.groundTruth, rep));
  assert.notEqual(stable(a.dataset), stable(c.dataset));
  const n1 = generate({ ...spec, output: 'native' }), n2 = generate({ ...spec, output: 'native' });
  assert.equal(n1.files.length, n2.files.length);
  for (let i = 0; i < n1.files.length; i++) { assert.equal(n1.files[i].path, n2.files[i].path); assert.deepEqual(n1.files[i].bytes, n2.files[i].bytes); }
  for (const ctx of ['online', 'personal', 'community', 'professional', 'survey']) {
    const s = { context: ctx, size: 40, seed: 9, content: 'light' };
    assert.equal(stable(generate(s).dataset), stable(generate(s).dataset), ctx);
  }
});
function rep(k, v) { return ArrayBuffer.isView(v) ? Array.from(v) : v; }

test('scale: 50,000-person workplace in dataset mode', t => {
  const t0 = performance.now();
  const { dataset, groundTruth } = generate({ context: 'workplace', medium: 'slack', size: 50000, seed: 5, content: 'none', timespan: { start: '2025-01-06', days: 14 } });
  const secs = (performance.now() - t0) / 1000;
  const mem = process.memoryUsage();
  t.diagnostic(`50k people, ${groundTruth.ties.count} true ties, ${dataset.events.count} events in ${secs.toFixed(1)} s; heap ${Math.round(mem.heapUsed / 1e6)} MB, rss ${Math.round(mem.rss / 1e6)} MB`);
  assert.equal(dataset.nodes.count, 50001); // people plus the deploy bot
  assert.ok(dataset.events.count > 1e6);
  assert.ok(secs < 90, `took ${secs}s`);
});

test('workplace structure: departments are denser inside, hierarchy is a tree, brokers bridge', () => {
  const { groundTruth: g } = generate({ context: 'workplace', size: 300, seed: 3, structure: 'bridge-dependent' });
  const n = g.people.count, mem = g.communities.membership, T = g.ties;
  const size = new Map();
  for (const x of mem) size.set(x, (size.get(x) || 0) + 1);
  let inside = 0, cross = 0;
  for (let i = 0; i < T.count; i++) (mem[T.a[i]] === mem[T.b[i]] ? inside++ : cross++);
  let pairsIn = 0; for (const s of size.values()) pairsIn += s * (s - 1) / 2;
  const pairsOut = n * (n - 1) / 2 - pairsIn;
  assert.ok(inside / pairsIn > 10 * (cross / pairsOut), `density in ${inside / pairsIn} vs out ${cross / pairsOut}`);
  // tree: one root, every other person reaches it without cycles
  const m = g.hierarchy.manager;
  assert.equal([...m].filter(x => x < 0).length, 1);
  for (let i = 0; i < n; i++) { let x = i, steps = 0; while (m[x] >= 0) { x = m[x]; assert.ok(++steps < n, 'cycle'); } assert.equal(x, g.hierarchy.root); }
  // brokers carry ties into other departments
  for (const b of g.bridges.brokers) {
    const depts = new Set();
    for (let i = 0; i < T.count; i++) if (T.a[i] === b || T.b[i] === b) depts.add(mem[T.a[i] === b ? T.b[i] : T.a[i]]);
    assert.ok(depts.size >= 3, `broker ${b} reaches ${depts.size} departments`);
  }
  const dep = g.events.find(e => e.type === 'departure');
  assert.ok(dep && g.bridges.brokers.includes(dep.person) && Number.isFinite(g.people.leftAt[dep.person]));
});

test('online structure: heavy-tailed follower counts, low reciprocity, bots behave like bots', () => {
  const { groundTruth: g, dataset } = generate({ context: 'online', medium: 'x', size: 1500, seed: 4, structure: 'bot-amplified' });
  const T = g.ties, n = g.people.count;
  assert.ok(T.directed);
  const indeg = new Array(n).fill(0);
  const pairs = new Set();
  for (let i = 0; i < T.count; i++) { indeg[T.b[i]]++; pairs.add(T.a[i] * n + T.b[i]); }
  const human = indeg.filter((_, i) => !g.people.isBot[i]).sort((a, b) => a - b);
  const median = human[Math.floor(human.length / 2)], max = human[human.length - 1];
  assert.ok(max > 8 * Math.max(1, median), `max ${max} median ${median}`);
  const top = human.slice(-Math.ceil(human.length * 0.05)).reduce((s, x) => s + x, 0) / human.reduce((s, x) => s + x, 0);
  assert.ok(top > 0.2, `top 5% hold ${top}`);
  let recip = 0; for (let i = 0; i < T.count; i++) if (pairs.has(T.b[i] * n + T.a[i])) recip++;
  assert.ok(recip / T.count < 0.35, `reciprocity ${recip / T.count}`);
  // bots: young accounts, few followers, many posts, mostly reposts
  const bots = [...g.people.isBot.keys()].filter(i => g.people.isBot[i]);
  assert.ok(bots.length > 0);
  assert.ok(mean(bots.map(i => indeg[i])) < mean(human));
  const repost = EVENT_TYPES.indexOf('repost');
  const keyIdx = new Map(dataset.nodes.keys.map((k, i) => [k, i]));
  const botDs = new Set(bots.map(i => keyIdx.get(g.people.keys[i])));
  let botEv = 0, botRepost = 0;
  for (let i = 0; i < dataset.events.count; i++) if (botDs.has(dataset.events.actor[i])) { botEv++; if (dataset.events.type[i] === repost) botRepost++; }
  assert.ok(botEv / bots.length > 20 && botRepost / botEv > 0.4, `bot events ${botEv}, reposts ${botRepost}`);
});

test('personal structure: closeness layers have the specified cumulative sizes; family is densest', () => {
  const { groundTruth: g } = generate({ context: 'personal', medium: 'whatsapp', seed: 6 });
  const layers = g.people.attrs.map(a => a.layer);
  const cum = [1, 2, 3, 4].map(L => layers.filter(x => x >= 1 && x <= L).length);
  assert.deepEqual(cum, [5, 15, 50, 150]);
  const mem = g.communities.membership, T = g.ties;
  const dens = c => { const m = [...mem.keys()].filter(i => mem[i] === c); let k = 0; for (let i = 0; i < T.count; i++) if (mem[T.a[i]] === c && mem[T.b[i]] === c) k++; return k / (m.length * (m.length - 1) / 2); };
  const fam = dens(0);
  for (let c = 1; c < 6; c++) assert.ok(fam > dens(c), `family ${fam} vs cluster ${c} ${dens(c)}`);
});

test('community and professional structure', () => {
  const { groundTruth: c } = generate({ context: 'community', medium: 'reddit', size: 400, seed: 7 });
  const deg = new Array(c.people.count).fill(0);
  for (let i = 0; i < c.ties.count; i++) { deg[c.ties.a[i]]++; deg[c.ties.b[i]]++; }
  const core = c.people.attrs.map((a, i) => [a.role !== 'periphery', deg[i]]);
  assert.ok(mean(core.filter(x => x[0]).map(x => x[1])) > 3 * mean(core.filter(x => !x[0]).map(x => x[1])));
  const { groundTruth: p } = generate({ context: 'professional', medium: 'linkedin', size: 300, seed: 7 });
  const kinds = p.ties.kinds;
  const counts = {};
  for (let i = 0; i < p.ties.count; i++) counts[kinds[p.ties.kind[i]]] = (counts[kinds[p.ties.kind[i]]] || 0) + 1;
  assert.ok(counts.coworker > 0 && counts.cohort > 0 && counts.weak > 0, JSON.stringify(counts));
  assert.ok(p.events.some(e => e.type === 'job-change'));
});

test('survey: recall error is planted as specified (weak ties forgotten more, caps, boundary)', () => {
  const { groundTruth: g, dataset } = generate({ context: 'survey', medium: 'survey', size: 40, seed: 8, variant: 'ego-interview', maxNames: 0, forgetWeak: 0.6, forgetStrong: 0.05 });
  const s = g.recall.stats;
  assert.ok(s.byStrength.strong.recall > s.byStrength.weak.recall + 0.2, JSON.stringify(s.byStrength));
  assert.ok(s.boundaryNamed > 0);
  const capped = generate({ context: 'survey', medium: 'survey', size: 40, seed: 8, variant: 'ego-interview', maxNames: 2 }).groundTruth.recall;
  assert.ok(capped.respondents.every(r => r.named.length <= 2));
  const perceived = generate({ context: 'survey', structure: 'perceived-network', seed: 8 }).groundTruth.recall.perceived;
  assert.equal(perceived.reports.length, 5);
  assert.ok(dataset.events.count > 0);
});

test('content: planted affect differences are measurable with VADER', () => {
  // group difference and a planted shift (personal group conflict)
  const { dataset: ds, groundTruth: g } = generate({ context: 'personal', medium: 'whatsapp', seed: 10, structure: 'group-conflict', content: 'light' });
  const key = new Map(g.people.keys.map((k, i) => [k, i]));
  const shift = g.events.find(e => e.type === 'affect-shift');
  const before = [], after = [], family = [];
  for (let i = 0; i < ds.events.count; i++) {
    const tx = ds.events.text[i];
    if (!tx) continue;
    const p = key.get(ds.nodes.keys[ds.events.actor[i]]);
    if (g.communities.membership[p] === shift.group) (ds.events.t[i] < shift.t ? before : after).push(score(tx));
    if (g.communities.membership[p] === 0) family.push(score(tx));
  }
  assert.ok(mean(after) < mean(before) - 0.2, `before ${mean(before)} after ${mean(after)}`);
  assert.ok(mean(family) > mean(after) + 0.3);
  // public vs private gap in a workplace
  const w = generate({ context: 'workplace', medium: 'slack', size: 80, seed: 10, affectGap: 0.5, content: 'light' }).dataset;
  const pub = [], priv = [];
  for (let i = 0; i < w.events.count; i++) {
    const tx = w.events.text[i], c = w.events.context[i];
    if (!tx || c < 0 || w.nodes.isBot[w.events.actor[i]]) continue;
    (w.contexts.visibility[c] === 0 ? pub : priv).push(score(tx));
  }
  assert.ok(mean(pub) > mean(priv) + 0.1, `public ${mean(pub)} private ${mean(priv)}`);
});

test('content: seed terms spread along true ties with a known cascade', () => {
  const { dataset: ds, groundTruth: g } = generate({ context: 'workplace', medium: 'slack', size: 150, seed: 12, content: 'light' });
  const n = g.people.count, T = g.ties;
  const tie = new Set();
  for (let i = 0; i < T.count; i++) { tie.add(T.a[i] * n + T.b[i]); tie.add(T.b[i] * n + T.a[i]); }
  for (const c of g.diffusion.cascades) {
    assert.ok(c.adopters.length >= 3, `${c.term} reached ${c.adopters.length}`);
    const at = new Map(c.adopters.map(a => [a.node, a.t]));
    for (const a of c.adopters) {
      if (a.from < 0) { assert.equal(a.node, c.seed); continue; }
      assert.ok(tie.has(a.from * n + a.node), 'transmission along a true tie');
      assert.ok(at.get(a.from) < a.t, 'source adopted first');
    }
    // in the text, nobody uses the term before adopting it, and the seed's first use comes before others
    const key = new Map(g.people.keys.map((k, i) => [k, i]));
    const first = new Map();
    for (let i = 0; i < ds.events.count; i++) {
      const tx = ds.events.text[i];
      if (!tx || !tx.includes(c.term)) continue;
      const p = key.get(ds.nodes.keys[ds.events.actor[i]]);
      assert.ok(at.has(p) && at.get(p) <= ds.events.t[i], 'term used only after adoption');
      if (!(first.get(p) <= ds.events.t[i])) first.set(p, ds.events.t[i]);
    }
    assert.ok(first.size >= 3);
  }
});

test('observation: ego, authored, chat and sample slices contain only what they should', () => {
  const ego = generate({ context: 'workplace', medium: 'slack', size: 80, seed: 13, observation: 'ego' });
  const e = ego.dataset.events, egoKey = ego.groundTruth.observation.egoKey;
  const egoIdx = ego.dataset.nodes.keys.indexOf(egoKey);
  assert.ok(egoIdx >= 0 && e.count > 0);
  for (let i = 0; i < e.count; i++) {
    const involved = e.actor[i] === egoIdx || eventTargets(ego.dataset, i).some(([n]) => n === egoIdx);
    assert.ok(involved, `event ${i} does not involve the ego`);
  }
  assert.equal(ego.dataset.meta.sources[0].view, 'ego');
  assert.equal(ego.dataset.meta.sources[0].egoKey, egoKey);
  const full = generate({ context: 'workplace', medium: 'slack', size: 80, seed: 13 });
  assert.ok(full.dataset.events.count > 3 * e.count);

  const au = generate({ context: 'online', medium: 'x', size: 200, seed: 13, observation: { view: 'authored' } });
  const ai = au.dataset.nodes.keys.indexOf(au.groundTruth.observation.egoKey);
  assert.ok([...au.dataset.events.actor].every(a => a === ai));

  const chat = generate({ context: 'personal', medium: 'whatsapp', seed: 13, observation: 'chat' });
  assert.equal(new Set(chat.dataset.events.context).size, 1);
  assert.equal(chat.dataset.contexts.names[chat.dataset.events.context[0]], 'Family');

  const sample = generate({ context: 'community', medium: 'reddit', size: 300, seed: 13, observation: { view: 'sample', rate: 0.2 } });
  const s = sample.groundTruth.observation.sampled;
  const key = new Map(sample.groundTruth.people.keys.map((k, i) => [k, i]));
  for (let i = 0; i < sample.dataset.events.count; i++) assert.equal(s[key.get(sample.dataset.nodes.keys[sample.dataset.events.actor[i]])], 1);
});

test('planted events change observed activity (silo, departure)', () => {
  const { dataset: ds, groundTruth: g } = generate({ context: 'workplace', medium: 'slack', size: 150, seed: 14, structure: 'siloed' });
  const key = new Map(g.people.keys.map((k, i) => [k, i]));
  const t = g.events.find(e => e.type === 'silo').t;
  const rate = (from, until) => {
    let cross = 0, all = 0;
    for (let i = 0; i < ds.events.count; i++) {
      if (ds.events.t[i] < from || ds.events.t[i] >= until) continue;
      const a = key.get(ds.nodes.keys[ds.events.actor[i]]);
      if (a === undefined) continue;
      for (const [b] of eventTargets(ds, i)) { const bb = key.get(ds.nodes.keys[b]); all++; if (g.communities.membership[a] !== g.communities.membership[bb]) cross++; }
    }
    return cross / all;
  };
  assert.ok(rate(t, g.timespan.end) < 0.5 * rate(g.timespan.start, t));
  const dep = generate({ context: 'workplace', medium: 'slack', size: 150, seed: 14, structure: 'bridge-dependent' });
  const ev = dep.groundTruth.events.find(e => e.type === 'departure');
  const who = dep.dataset.nodes.keys.indexOf(ev.personKey);
  const msg = EVENT_TYPES.indexOf('message');
  for (let i = 0; i < dep.dataset.events.count; i++) if (dep.dataset.events.actor[i] === who && dep.dataset.events.type[i] === msg) assert.ok(dep.dataset.events.t[i] < ev.t);
});

test('recoveryCheck tabulates planted vs recovered features with verdicts', () => {
  const { dataset, groundTruth } = generate({ context: 'workplace', medium: 'slack', size: 120, seed: 15, structure: 'declining', content: 'light' });
  const a = analyze(dataset);
  const shifts = groundTruth.events.map(e => ({ t: e.t + 86400000 }));
  const rep = recoveryCheck(groundTruth, dataset, { membership: a.membership, nodeMetrics: a.nodeMetrics, shifts });
  assert.ok(Array.isArray(rep.checks) && rep.checks.length >= 6);
  for (const c of rep.checks) {
    assert.ok(['recovered', 'partly', 'missed', 'not checked'].includes(c.verdict), c.verdict);
    assert.equal(typeof c.says, 'string');
    assert.ok(c.name && c.area && 'value' in c && 'metric' in c);
  }
  const by = id => rep.checks.find(c => c.id === id);
  assert.equal(by('communities').verdict, 'recovered');
  assert.equal(by('affect-groups').verdict, 'recovered');
  assert.equal(by('affect-shift').verdict, 'recovered');
  assert.equal(by('shift-quiet').verdict, 'recovered');
  assert.equal(rep.mapping.matched, 120);
  // with a network object, arrays are indexed by network node
  const net = { nodeIds: Int32Array.from({ length: dataset.nodes.count }, (_, i) => dataset.nodes.count - 1 - i) };
  const reversed = Int32Array.from(net.nodeIds, k => a.membership[k]);
  const rep2 = recoveryCheck(groundTruth, dataset, net, { membership: reversed });
  assert.equal(rep2.checks.find(c => c.id === 'communities').value, by('communities').value);
  // a wrong answer is judged as wrong
  const bad = recoveryCheck(groundTruth, dataset, { membership: Int32Array.from(a.membership, (_, i) => i % 3), shifts: [groundTruth.timespan.start] });
  assert.equal(bad.checks.find(c => c.id === 'communities').verdict, 'missed');
  assert.equal(bad.checks.find(c => c.id === 'shift-quiet').verdict, 'missed');
});

test('dataset and ground truth are structured-cloneable (they cross a worker boundary)', () => {
  for (const context of ['workplace', 'online', 'survey']) {
    const { dataset, groundTruth } = generate({ context, size: 40, seed: 3, onProgress: () => {} });
    assert.doesNotThrow(() => structuredClone(dataset));
    assert.doesNotThrow(() => structuredClone(groundTruth));
  }
});

test('onProgress reports increasing fractions and finishes at 1', () => {
  const seen = [];
  generate({ context: 'personal', medium: 'telegram', seed: 1, onProgress: (f, m) => seen.push([f, m]) });
  assert.ok(seen.length >= 4);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i][0] >= seen[i - 1][0]);
  assert.equal(seen.at(-1)[0], 1);
});

test('spec validation: unknown context or unfit medium throws a clear error', () => {
  assert.throws(() => generate({ context: 'galaxy' }), /Unknown context/);
  assert.throws(() => generate({ context: 'workplace', medium: 'reddit' }), /does not fit/);
  assert.throws(() => generate({ context: 'online', medium: 'bluesky', output: 'native' }), /No native writer/);
  const { groundTruth } = generate({ context: 'workplace', size: 20, departments: 30, seed: 1 });
  assert.ok(groundTruth.notes.some(n => /departments/.test(n)));
});

test('planted groups are one attribute, planted_group, never "community"', () => {
  for (const [context, medium, own] of [['online', 'x', 'community'], ['workplace', 'slack', null], ['personal', 'whatsapp', 'cluster'], ['survey', 'survey', 'friend_group'], ['community', 'reddit', 'home_space']]) {
    const { dataset, groundTruth } = generate({ context, medium, size: 40, seed: 3, content: 'none', timespan: { days: 14 } });
    assert.equal(groundTruth.communities.attr, 'planted_group', context);
    assert.equal(dataset.meta.attrLabels.planted_group, 'Planted group (ground truth)');
    const names = new Set(groundTruth.communities.names);
    let labelled = 0;
    for (let i = 0; i < dataset.nodes.count; i++) {
      const a = dataset.nodes.attrs[i] || {};
      if (own) assert.equal(a[own], undefined, `${context}: the context's own group key is gone`);
      if (a.planted_group !== undefined) labelled++;
    }
    assert.ok(labelled > 0, context);
    // every member of a planted group carries that group's name
    groundTruth.communities.membership.forEach((g, i) => { if (g >= 0) assert.ok(names.has(groundTruth.people.attrs[i].planted_group), `${context} person ${i}`); });
  }
  // keys that real exports or HR files carry stay beside it
  const { dataset } = generate({ context: 'workplace', medium: 'slack', size: 30, seed: 1, content: 'none', timespan: { days: 7 } });
  assert.ok(dataset.nodes.attrs.some(a => a && a.department));
});

test('workplace: every department rolls up to a division, at most eight of them, deterministically', () => {
  const spec = { context: 'workplace', medium: 'network', size: 600, departments: 33, seed: 7, content: 'none', timespan: { days: 7 } };
  const { dataset, groundTruth } = generate(spec);
  const attrs = groundTruth.people.attrs;
  const deptToDiv = new Map();
  for (const a of attrs) {
    assert.ok(a.division, 'every person has a division');
    const prev = deptToDiv.get(a.department);
    assert.ok(prev == null || prev === a.division, `${a.department} sits in one division`);
    deptToDiv.set(a.department, a.division);
  }
  const departments = new Set(attrs.map(a => a.department));
  const divisions = new Set(attrs.map(a => a.division));
  assert.ok(departments.size > 8);
  assert.ok(divisions.size >= 2 && divisions.size <= 8, `${divisions.size} divisions`);
  assert.equal(attrs[0].division, 'Executive');
  // Regional departments sit in their function's division.
  for (const [d, v] of deptToDiv) {
    if (/^Sales\b/.test(d)) assert.equal(v, 'Sales', d);
    if (/^Engineering\b/.test(d)) assert.equal(v, 'Engineering', d);
  }
  assert.ok([...departments].some(d => /^Sales (Americas|EMEA|APAC)/.test(d)));
  // The imported dataset carries division as an attribute, next to department.
  assert.ok(dataset.attributeSchema.some(a => a.key === 'division'));
  assert.ok(dataset.attributeSchema.some(a => a.key === 'department'));
  // Same seed, same divisions.
  const again = generate(spec).groundTruth.people.attrs.map(a => a.division);
  assert.deepEqual(again, attrs.map(a => a.division));
});
