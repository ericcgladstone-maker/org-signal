// Classic datasets: every file loads through src/core/classic.js (the path
// the app uses), has the node and tie counts of the published data, carries
// its known answers, and gives the known values computed independently with
// networkx 3.2.1 (tools/datasets/verify.py on the raw files). The numbers in
// each card's lookFor are checked here too.
//
// Pending datasets (data/classic-pending/, not shipped) are tested when their
// files are present and skipped otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { listClassic, loadClassic, loadClassicPerceived, classicExample, classicSize } from '../../src/core/classic.js';
import { eventAttrs, twoModeOf, eventTargets } from '../../src/core/model.js';
import { defaultSettings, normalizeSettings, buildNetwork, computeNodeMetrics, computeNetworkMetrics, detectCommunities, groupMetrics } from '../../src/analysis/index.js';
import { consensus, las, toDataset, perInformantAccuracy, bestPerceiver } from '../../src/builders/perceived.js';

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const net = (ds, patch = {}) => buildNetwork(ds, normalizeSettings(ds, { ...defaultSettings(ds), ...patch }));
const filters = (...f) => ({ tieFields: { weight: null, filters: f } });
const byLabel = (ds, n, metric) => Object.fromEntries([...metric].map((x, v) => [ds.nodes.labels[n.nodeIds[v]], x]));
const topOf = (ds, n, metric) => Object.entries(byLabel(ds, n, metric)).sort((a, b) => b[1] - a[1]);
const countBy = (ds, key) => { const c = {}; for (const a of ds.nodes.attrs) if (a[key] !== undefined) c[a[key]] = (c[a[key]] || 0) + 1; return c; };
const tiesWhere = (ds, pred) => { let n = 0; for (let i = 0; i < ds.events.count; i++) if (pred(eventAttrs(ds, i))) n++; return n; };

async function pending(id) {
  const list = await listClassic({ pending: true });
  const e = list.find(x => x.id === id);
  return e && existsSync(new URL(e.file, new URL('../../data/classic/', import.meta.url))) ? e : null;
}
const skipUnlessPending = async (t, id) => { if (!(await pending(id))) { t.skip(`${id}: pending file not present`); return true; } return false; };

test('manifest: every dataset has its card, and only clear-licence datasets are bundled', async () => {
  const list = await listClassic();
  assert.deepEqual(list.map(e => e.id), ['karate', 'florentine', 'krackhardt', 'sampson', 'kapferer', 'newcomb', 'wiring', 'davis', 'lesmis', 'dolphins', 'enron']);
  const bundled = list.filter(e => e.distribution === 'bundled').map(e => e.id).sort();
  assert.deepEqual(bundled, ['davis', 'dolphins', 'florentine', 'karate', 'lesmis']);
  for (const e of list) {
    for (const k of ['title', 'description', 'year', 'findings', 'citation', 'license', 'mode', 'file']) assert.ok(e[k], `${e.id} ${k}`);
    assert.ok(e.sourceUrls.length && e.lookFor.length >= 3 && e.knownAnswers.length, e.id);
    assert.ok(e.assignment?.text, e.id);
    assert.equal(e.loadable, e.distribution === 'bundled', e.id);
    assert.doesNotMatch(JSON.stringify(e), /[\u{1F300}-\u{1FAFF}☀-➿]/u, `${e.id}: no emoji`);
  }
  assert.ok(list.find(e => e.id === 'enron').ethics.includes('real people'));
  assert.equal(classicSize(8334), '8 KB');
  assert.equal(classicSize(617570), '0.6 MB');
});

test('pending datasets do not load without the pending flag', async () => {
  await assert.rejects(loadClassic('sampson'), /not included in this build/);
});

test("Zachary's karate club: 34 members, 78 ties, faction, betweenness of the two leaders", async () => {
  const ds = await loadClassic('karate');
  assert.equal(ds.meta.example.title, "Zachary's karate club");
  assert.ok(ds.meta.example.lookFor.length >= 3);
  assert.equal(ds.nodes.count, 34);
  assert.equal(ds.events.count, 78);
  assert.deepEqual(countBy(ds, 'faction'), { 'Mr. Hi': 17, Officer: 17 });
  let w = 0; for (let i = 0; i < ds.events.count; i++) w += ds.events.weight[i];
  assert.equal(w, 231); // ZACHC strengths, as networkx
  const n = net(ds);
  assert.equal(n.directed, false);
  assert.equal(n.edges.count, 78);
  const nm = computeNetworkMetrics(n);
  near(nm.density, 0.139037, 1e-6);
  near(nm.transitivity, 0.255682, 1e-6);
  const m = computeNodeMetrics(n, { which: ['degree', 'betweenness'], approx: false });
  const btw = topOf(ds, n, m.betweenness);
  assert.equal(btw[0][0], '1 Mr. Hi'); near(btw[0][1], 0.437635, 1e-6);
  assert.equal(btw[1][0], '34 John A.'); near(btw[1][1], 0.304075, 1e-6);
  assert.equal(byLabel(ds, n, m.degree)['34 John A.'], 17);
  const g = groupMetrics(n, ds, 'faction');
  near(g.eiIndex?.observed ?? g.eiIndex, -0.718);
  // Communities (seed 1, as the app): 4, nested in the factions but for one member.
  const c = detectCommunities(n, { seed: 1 });
  assert.equal(c.count, 4);
  const mix = {};
  for (let v = 0; v < n.n; v++) { const k = c.membership[v]; mix[k] ||= {}; const f = ds.nodes.attrs[n.nodeIds[v]].faction; mix[k][f] = (mix[k][f] || 0) + 1; }
  const minority = Object.values(mix).reduce((s, x) => s + Math.min(x['Mr. Hi'] || 0, x.Officer || 0), 0);
  assert.equal(minority, 1);
});

test("Padgett's Florentine families (bundled): marriage network, Medici highest betweenness", async () => {
  const ds = await loadClassic('florentine');
  assert.equal(ds.nodes.count, 16);
  assert.equal(ds.events.count, 20);
  const n = net(ds);
  assert.equal(computeNetworkMetrics(n).components, 2); // Pucci is isolated
  const m = computeNodeMetrics(n, { which: ['degree', 'betweenness'], approx: false });
  const btw = topOf(ds, n, m.betweenness);
  assert.equal(btw[0][0], 'Medici'); near(btw[0][1], 0.452381, 1e-6);
  assert.equal(btw[1][0], 'Guadagni'); near(btw[1][1], 0.220635, 1e-6);
  const deg = byLabel(ds, n, m.degree);
  assert.deepEqual([deg.Medici, deg.Strozzi, deg.Guadagni, deg.Pucci], [6, 4, 4, 0]);
});

test('Florentine families (pending, full): 20 marriage and 15 business ties, wealth and priorates', async t => {
  if (await skipUnlessPending(t, 'florentine')) return;
  const ds = await loadClassic('florentine', { pending: true });
  assert.equal(tiesWhere(ds, a => a.relation === 'marriage'), 20);
  assert.equal(tiesWhere(ds, a => a.relation === 'business'), 15);
  const at = Object.fromEntries(ds.nodes.labels.map((l, i) => [l, ds.nodes.attrs[i]]));
  assert.deepEqual([at.Medici.wealth, at.Medici.priorates, at.Strozzi.wealth, at.Strozzi.priorates], [103, 53, 146, 74]);
  assert.deepEqual(['Barbadori', 'Lamberteschi', 'Pazzi', 'Tornabuoni', 'Ginori', 'Pucci'].map(f => at[f].priorates), [0, 0, 0, 0, 0, 0]);
  // Default: marriage only, as the bundled network.
  const n = net(ds);
  assert.equal(n.edges.count, 20);
  const both = net(ds, filters());
  assert.ok(both.edges.count > 20);
});

test("Krackhardt's managers: 190 advice, 102 friendship, 20 reports-to; perceptions load into the Perceived builder", async t => {
  if (await skipUnlessPending(t, 'krackhardt')) return;
  const ds = await loadClassic('krackhardt', { pending: true });
  assert.equal(ds.nodes.count, 21);
  assert.equal(tiesWhere(ds, a => a.relation === 'advice'), 190);
  assert.equal(tiesWhere(ds, a => a.relation === 'friendship'), 102);
  assert.equal(tiesWhere(ds, a => a.relation === 'reports to'), 20);
  assert.deepEqual(countBy(ds, 'level'), { Manager: 16, 'Vice president': 4, CEO: 1 });
  const n = net(ds);
  assert.equal(n.directed, true);
  assert.equal(n.edges.count, 190);
  const nm = computeNetworkMetrics(n);
  near(nm.density, 0.452381, 1e-6);
  near(nm.reciprocity, 0.473684, 1e-6);
  const m = computeNodeMetrics(n, { which: ['inDegree', 'betweenness'], approx: false });
  assert.deepEqual(topOf(ds, n, m.inDegree)[0], ['Manager 2', 18]);
  const btw = topOf(ds, n, m.betweenness);
  assert.equal(btw[0][0], 'Manager 18'); near(btw[0][1], 0.234, 1e-3);
  // Cognitive social structure: 21 informants; each one's own row is their
  // advice self-report; aggregates as computed with numpy on krackad.dat.
  const css = await loadClassicPerceived('krackhardt', 'advice', { pending: true });
  assert.equal(css.people.length, 21);
  assert.equal(css.informants.length, 21);
  assert.equal(css.relation.undirected, false);
  const self = new Set();
  for (const inf of css.informants) for (const k of Object.keys(inf.ties)) if (k.startsWith(inf.personId + '|')) self.add(k);
  assert.equal(self.size, 190);
  assert.equal(Object.keys(consensus(css, 0.5)).filter(k => consensus(css, 0.5)[k]).length, 95);
  const count = ties => Object.entries(ties).filter(([k, v]) => v && k.includes('|')).length;
  assert.equal(count(las(css, 'union')), 276);
  assert.equal(count(las(css, 'intersection')), 129);
  const fr = await loadClassicPerceived('krackhardt', 'friendship', { pending: true });
  assert.equal(fr.informants.length, 21);
  assert.equal(toDataset(css, { view: 'consensus' }).events.count, 95);
  const best = bestPerceiver(perInformantAccuracy(css, { threshold: 0.5 }), 'vsOthers');
  assert.deepEqual(best.labels, ['Manager 8']);
  near(best.jaccard, 0.58, 0.005);
});

test("Sampson's monastery: liking at five time points; T2-T4 equal UCINET's SAMPLK1-3; factions", async t => {
  if (await skipUnlessPending(t, 'sampson')) return;
  const ds = await loadClassic('sampson', { pending: true });
  assert.equal(ds.nodes.count, 25);
  assert.deepEqual(countBy(ds, 'faction'), { 'Young Turks': 7, 'Loyal Opposition': 5, Outcasts: 3, Interstitial: 3 });
  assert.deepEqual(countBy(ds, 'outcome'), { Expelled: 4, Left: 10, Stayed: 4 });
  const like = ['T1', 'T2', 'T3', 'T4', 'T5'].map(w => net(ds, filters({ key: 'relation', values: ['like'] }, { key: 'wave', values: [w] })).edges.count);
  assert.deepEqual(like, [39, 55, 57, 56, 21]);
  const n = net(ds); // default: like at T4
  assert.equal(n.edges.count, 56);
  const g = groupMetrics(n, ds, 'faction');
  near(g.eiIndex?.observed ?? g.eiIndex, -0.357);
  const m = computeNodeMetrics(n, { which: ['inDegree'] });
  const ind = byLabel(ds, n, m.inDegree);
  assert.deepEqual([ind.Gregory, ind.Bonaventure, ind.Winfrid], [6, 6, 6]);
});

test("Kapferer's tailor shop: 158 and 223 sociational, 109 and 147 instrumental ties, two dated periods", async t => {
  if (await skipUnlessPending(t, 'kapferer')) return;
  const ds = await loadClassic('kapferer', { pending: true });
  assert.equal(ds.nodes.count, 39);
  const c = (rel, time) => tiesWhere(ds, a => a.relation === rel && a.time === time);
  assert.deepEqual([c('sociational', 'Time 1'), c('sociational', 'Time 2'), c('instrumental', 'Time 1'), c('instrumental', 'Time 2')], [158, 223, 109, 147]);
  assert.deepEqual([...new Set(ds.events.t)].sort((a, b) => a - b).map(x => new Date(x).toISOString().slice(0, 7)), ['1965-06', '1966-01']);
  const n1 = net(ds, filters({ key: 'relation', values: ['sociational'] }, { key: 'time', values: ['Time 1'] }));
  const n2 = net(ds, filters({ key: 'relation', values: ['sociational'] }, { key: 'time', values: ['Time 2'] }));
  near(computeNetworkMetrics(n1).density, 0.213225, 1e-6);
  near(computeNetworkMetrics(n2).density, 0.300945, 1e-6);
  assert.deepEqual(topOf(ds, n2, computeNodeMetrics(n2, { which: ['degree'] }).degree)[0], ['Mukubwa', 25]);
  assert.deepEqual(topOf(ds, n1, computeNodeMetrics(n1, { which: ['degree'] }).degree)[0], ['Chisokone', 24]);
  assert.equal(net(ds).edges.count, 278);
});

test("Newcomb's fraternity: 15 weekly full rankings, valued ties, top-three default", async t => {
  if (await skipUnlessPending(t, 'newcomb')) return;
  const ds = await loadClassic('newcomb', { pending: true });
  assert.equal(ds.nodes.count, 17);
  assert.equal(ds.events.count, 15 * 272);
  const weeks = [...new Set(Array.from({ length: ds.events.count }, (_, i) => eventAttrs(ds, i).week))].sort((a, b) => a - b);
  assert.deepEqual(weeks, [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]);
  for (let i = 0; i < ds.events.count; i++) assert.equal(ds.events.weight[i], 17 - eventAttrs(ds, i).rank);
  const n = net(ds);
  assert.equal(n.edges.count, 129);
  near(computeNetworkMetrics(n).reciprocity, 0.558, 1e-3);
  const wk = w => net(ds, filters({ key: 'rank', max: 3 }, { key: 'week', min: w, max: w }));
  near(computeNetworkMetrics(wk(0)).reciprocity, 0.470588, 1e-6);
  near(computeNetworkMetrics(wk(15)).reciprocity, 0.352941, 1e-6);
});

test("Bank wiring room: six relations, Homans's cliques", async t => {
  if (await skipUnlessPending(t, 'wiring')) return;
  const ds = await loadClassic('wiring', { pending: true });
  assert.equal(ds.nodes.count, 14);
  const c = rel => tiesWhere(ds, a => a.relation === rel);
  assert.deepEqual(['games', 'window arguments', 'friendship', 'antagonism', 'helping', 'job trading'].map(c), [28, 19, 13, 19, 24, 7]);
  assert.deepEqual(countBy(ds, 'clique'), { A: 5, B: 4, Neither: 5 });
  const n = net(ds); // friendship only
  assert.equal(n.edges.count, 13);
  near(groupMetrics(n, ds, 'clique').eiIndex?.observed ?? groupMetrics(n, ds, 'clique').eiIndex, -0.846);
  const an = net(ds, filters({ key: 'relation', values: ['antagonism'] }));
  near(groupMetrics(an, ds, 'clique').eiIndex?.observed ?? groupMetrics(an, ds, 'clique').eiIndex, 0.579);
});

test("Davis's Southern Women: two-mode, 18 women x 14 dated events, 89 attendances, DGG groups", async () => {
  const ds = await loadClassic('davis');
  const tm = twoModeOf(ds);
  assert.ok(tm && tm.declared);
  assert.deepEqual(tm.labels, ['Women', 'Events']);
  assert.deepEqual(tm.counts, [18, 14]);
  assert.equal(ds.events.count, 89);
  for (let i = 0; i < ds.events.count; i++) assert.equal(eventTargets(ds, i)[0][1], 'member');
  const years = new Set(Array.from(ds.events.t, x => new Date(x).getUTCFullYear()));
  assert.deepEqual([...years], [1936]);
  assert.deepEqual(countBy(ds, 'dgg_group'), { 'Group 1': 8, Both: 1, 'Group 2': 9 });
  assert.deepEqual(countBy(ds, 'consensus_group'), { 'Women 1-9': 9, 'Women 10-18': 9 });
  assert.deepEqual(countBy(ds, 'dgg_position'), { Core: 7, Primary: 5, Secondary: 6 });
  const n = net(ds);
  assert.equal(n.edges.count, 89);
  const deg = topOf(ds, n, computeNodeMetrics(n, { which: ['degree'] }).degree);
  assert.deepEqual(deg[0], ['E8 (16 Sep)', 14]);
  const d = byLabel(ds, n, computeNodeMetrics(n, { which: ['degree'] }).degree);
  assert.deepEqual([d['Evelyn Jefferson'], d['Theresa Anderson'], d['Nora Fayette']], [8, 8, 8]);
  const p = net(ds, { twoMode: { view: 'mode0', projection: 'count', minShared: 1 } });
  assert.equal(p.n, 18);
  assert.equal(p.edges.count, 139); // networkx weighted_projected_graph
  const c = detectCommunities(n, { seed: 1 });
  assert.equal(c.count, 2);
});

test('Les Miserables: 77 characters, 254 weighted ties, Valjean central', async () => {
  const ds = await loadClassic('lesmis');
  assert.equal(ds.nodes.count, 77);
  assert.equal(ds.events.count, 254);
  let w = 0; for (let i = 0; i < ds.events.count; i++) w += ds.events.weight[i];
  assert.equal(w, 820);
  const n = net(ds);
  const m = computeNodeMetrics(n, { which: ['degree', 'strength', 'betweenness'], approx: false });
  assert.deepEqual(topOf(ds, n, m.degree)[0], ['Valjean', 36]);
  assert.deepEqual(topOf(ds, n, m.strength)[0], ['Valjean', 158]);
  const btw = topOf(ds, n, m.betweenness);
  assert.equal(btw[0][0], 'Valjean'); near(btw[0][1], 0.569989, 1e-6);
  assert.equal(btw[1][0], 'Myriel'); near(btw[1][1], 0.176842, 1e-6);
  assert.equal(byLabel(ds, n, m.degree).Myriel, 10);
});

test("Lusseau's dolphins: 62 dolphins, 159 ties, the 2004 split", async () => {
  const ds = await loadClassic('dolphins');
  assert.equal(ds.nodes.count, 62);
  assert.equal(ds.events.count, 159);
  assert.deepEqual(countBy(ds, 'split_2004'), { 'Larger group (41)': 41, 'Smaller group (21)': 21 });
  const n = net(ds);
  const nm = computeNetworkMetrics(n);
  near(nm.density, 0.084082, 1e-6);
  near(nm.transitivity, 0.308776, 1e-6);
  const btw = topOf(ds, n, computeNodeMetrics(n, { which: ['betweenness'], approx: false }).betweenness);
  assert.equal(btw[0][0], 'SN100'); near(btw[0][1], 0.248237, 1e-6);
  assert.equal(btw[1][0], 'Beescratch'); near(btw[1][1], 0.213324, 1e-6);
  near(groupMetrics(n, ds, 'split_2004').eiIndex?.observed ?? groupMetrics(n, ds, 'split_2004').eiIndex, -0.925);
});

test('Enron (core, headers only): 148 people, 21,052 messages, roles, no text', async t => {
  if (await skipUnlessPending(t, 'enron')) return;
  const ds = await loadClassic('enron', { pending: true });
  assert.equal(ds.nodes.count, 148);
  assert.equal(ds.events.count, 21052);
  assert.ok(ds.events.text.every(x => x == null), 'no message text');
  assert.ok(ds.contexts.names.every(x => /^Thread [0-9a-f]{10}$/.test(x)), 'no subjects');
  assert.ok(ds.events.keys.every(k => /^<[^>]+>$/.test(k)), 'message ids');
  const roles = {};
  for (let i = 0; i < ds.events.count; i++) for (const [, r] of eventTargets(ds, i)) roles[r] = (roles[r] || 0) + 1;
  assert.ok(roles.to > 0 && roles.cc > 0);
  const t0 = Math.min(...ds.events.t), t1 = Math.max(...ds.events.t);
  assert.ok(t0 >= Date.UTC(1998, 0, 1) && t1 < Date.UTC(2003, 0, 1));
  const n = net(ds);
  assert.equal(n.edges.count, 2440);
  const m = computeNodeMetrics(n, { which: ['degree', 'inDegree'] });
  assert.deepEqual(topOf(ds, n, m.degree)[0], ['Louise Kitchen', 104]);
  // Contacts as Network shows them: distinct people in either direction.
  const nb = new Map();
  for (let e = 0; e < n.edges.count; e++) for (const [a, b] of [[n.edges.src[e], n.edges.dst[e]], [n.edges.dst[e], n.edges.src[e]]]) { if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); }
  const contacts = Object.fromEntries([...nb].map(([v, s]) => [ds.nodes.labels[n.nodeIds[v]], s.size]));
  assert.deepEqual([contacts['Louise Kitchen'], contacts['John Lavorato']], [61, 61]);
  assert.ok(Math.max(...Object.values(contacts)) === 61);
  assert.deepEqual(topOf(ds, n, m.inDegree)[0], ['John Lavorato', 48]);
  const mon = {};
  for (let i = 0; i < ds.events.count; i++) { const k = new Date(ds.events.t[i]).toISOString().slice(0, 7); mon[k] = (mon[k] || 0) + 1; }
  assert.deepEqual(Object.entries(mon).sort((a, b) => b[1] - a[1])[0], ['2001-10', 1813]);
  const toOnly = net(ds, { rules: { ...defaultSettings(ds).rules, cc: { on: false, weight: 1 }, bcc: { on: false, weight: 1 } } });
  assert.equal(toOnly.edges.count, 2292);
});

test('classicExample gives Network the worked-example shape', async () => {
  const [e] = await listClassic();
  const x = classicExample(e);
  assert.equal(x.title, e.title);
  assert.deepEqual(x.lookFor, e.lookFor);
  assert.equal(x.classic, e.id);
});
