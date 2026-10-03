// The methods appendix reports what was run and what it found (Networks 101
// round, N4, N5, N6, N7, N12, N13, N23, C3, C10): null means, sd, intervals, z
// and p for each randomization test; group mixing; rank intervals; window
// dates that agree with the data; shift detection, before/after and
// diffusion with their parameters; survey and personal-export wording.
// Results are produced by the real analysis on a small generated workplace
// and summarized with summarizeRun, as the engine adapter does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../../src/generator/index.js';
import * as X from '../../src/analysis/index.js';
import { summarizeRun, buildMethodsAppendix, summaryResults, wholeNetworkLines } from '../../src/llm/methods.js';

const { dataset: ds } = generate({ context: 'workplace', medium: 'slack', structure: 'bridge-dependent', size: 40, seed: 3, content: 'light' });
const settings = X.defaultSettings(ds);
const net = X.buildNetwork(ds, settings);
const nm = X.nullModel(net, { stats: ['transitivity', 'modularity'], reps: 20, seed: 1 });
const nmDept = X.nullModel(net, { stats: ['attrAssortativity', 'eiIndex'], ds, attr: 'department', reps: 20, seed: 1 });
const grp = X.groupMetrics(net, ds, 'department');
const ts = X.timeSeries(ds, settings, { window: 'week', metrics: ['degree', 'strength'] });
const sh = X.detectShifts(ts, { labels: ds.nodes.labels });
const date = ts.windows[Math.floor(ts.windows.length / 2)].start;
const ba = X.compareBeforeAfter(ds, settings, date, { metrics: ['degree', 'strength'], reps: 200, metricReps: 20 });
const df = X.diffusion(ds, net, { auto: 3, reps: 50, seed: 1 });
const rr = X.resampleRanks(ds, settings, { metric: 'betweenness', reps: 10, top: 5, seed: 1 });

const S = (k, r) => summarizeRun(k, r, { labels: ds.nodes.labels });
const input = {
  dataset: ds, settings,
  network: { n: net.n, directed: net.directed, edges: { count: net.edges.count } },
  metrics: ['contacts', 'degree', 'betweenness', 'closeness', 'eigenvector', 'pagerank'],
  networkStats: ['density', 'reciprocity', 'largestComponentShare'],
  communities: { resolution: 1, seed: 1, runs: 1, count: 4, modularity: 0.35 },
  groups: [{ attr: 'department', result: S('groups', grp) }, { attr: '__community' }],
  attributeLabels: { department: 'Department' },
  nullModels: [{ seed: 1, communities: true, result: S('nullModel', nm) }, { seed: 1, attr: 'department', result: S('nullModel', nmDept) }],
  resampling: [{ metric: 'betweenness', reps: 10, top: 5, seed: 1, scheme: 'events resampled with replacement', result: S('resampling', rr) }],
  time: [{ window: 'week', metrics: ['degree', 'strength'], purpose: 'Time view', result: S('time', ts) }],
  shifts: [{ window: 'week', result: S('shifts', sh) }],
  beforeAfter: [{ date, metrics: ['degree', 'strength'], result: S('beforeAfter', ba) }],
  diffusion: [{ terms: undefined, result: S('diffusion', df) }],
};
const md = buildMethodsAppendix(input);
const n3 = x => String(Number(x.toPrecision(3)));
const day = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/Sept/, 'Sep');

test('every null-model run reports observed, null mean, sd, interval, z and p (N4)', () => {
  const t = nm.transitivity;
  assert.ok(md.includes(`Transitivity: observed ${n3(t.observed)}; the randomized networks averaged ${n3(t.mean)} (sd ${n3(t.sd)}; 95% between ${n3(t.lo)} and ${n3(t.hi)}); z ${n3(t.z)};`), md);
  // At the smallest p 20 replicates allow, say so in words.
  assert.match(md, /Modularity: observed [\d.]+; .*none of the 20 randomized networks came this close \(p ≤ 1\/21\), two-sided/);
  assert.match(md, /For modularity, Louvain community detection was re-run on each of the 20 rewired networks \(seeded per network\), and the best modularity it found there was compared with what the same search finds on the observed ties; tie weights were ignored on both sides\./);
  assert.match(md, /Observed attribute assortativity and E-I index for groups defined by `Department` were compared with 20 degree-preserving randomizations/);
  assert.match(md, /its smallest possible value is 1 \/ \(R \+ 1\)/);
});

test('group mixing results, and no internal keys (N12)', () => {
  assert.ok(md.includes(`- \`Department\`: assortativity ${n3(grp.assortativity)}, E-I index ${n3(grp.eiIndex)} (${grp.withinTies} ties within groups, ${grp.betweenTies} between) across 5 groups.`));
  assert.match(md, /Groups were defined by each of `Department` and the detected communities\./);
  assert.doesNotMatch(md, /__community/);
});

test('rank intervals are listed with the resampling caveat (N14 wording)', () => {
  const first = rr[0];
  assert.ok(md.includes(`- ${first.label}: rank 1; 95% interval 1 to 1; in the top 5 in 100% of resamples.`));
  assert.match(md, /it cannot test whether a tie exists at all/);
});

test('window dates agree with the data: inclusive last day and partial windows (N7)', () => {
  const w = ts.windows;
  assert.ok(md.includes(`For the Time view, total ties (in + out) and strength were recomputed in ${w.length} consecutive weekly windows, the first starting ${day(w[0].start)} and the last ending ${day(w[w.length - 1].end - 1)} (inclusive)`), md);
  assert.ok(md.includes(`The data run from ${day(ts.meta.start)} to ${day(ts.meta.end - 1)}, so 2 windows at the edges are only partly covered`));
});

test('shift detection, before/after and diffusion are described with parameters and results (N5, N6)', () => {
  assert.match(md, /robust z-score: each window's value against the median and median absolute deviation \(MAD\) of the 8 preceding windows, flagged at \|z\| ≥ 3\.5 for whole-network series, 4\.5 for each group and 5 for each person/);
  assert.match(md, /2 shifts were flagged; the largest: [^;]+ \(total ties \(in \+ out\), drop in the week starting 24 Feb 2025, z -5\.12\)/);
  assert.match(md, new RegExp(`Before and after ${day(date)}: two periods of equal length`));
  assert.match(md, /every event in the two periods was reassigned to before or after at random, 2,000 times|every event in the two periods was reassigned to before or after at random, 200 times/);
  assert.doesNotMatch(md, /sign-flip|paired/i);
  const d = ba.node.degree;
  assert.ok(md.includes(`- Total ties (in + out): mean ${n3(d.meanBefore)} before and ${n3(d.meanAfter)} after (${d.n} people; d_z ${n3(d.dz)}; none of the 200 random relabellings came this close (p ≤ 1/201)).`), md);
  assert.match(md, /Diffusion along ties: .* compared with 50 timelines in which adoption times were shuffled among the same adopters/);
  const t0 = df.terms[0];
  assert.ok(md.includes(`- "${t0.term}": ${t0.adopters} adopters; ${t0.exposed} of ${t0.eligible} (100%) had an earlier-adopting contact, against ${Math.round(t0.null.mean * 100)}% in the shuffled timelines`), md);
  assert.match(md, /The shuffled baseline is already near 100%, so this test has little room to show spread along ties: inconclusive/);
  assert.match(md, /p-values were adjusted for the 2 terms tested with Holm's step-down method/);
  assert.match(md, /Holm-adjusted p = /);
});

test('measure definitions: contacts, normalized betweenness, harmonic closeness, eigenvector and PageRank details (N23)', () => {
  assert.match(md, /- Contacts: number of distinct people/);
  assert.match(md, /Betweenness \(normalized\): .*multiplying by that number gives the raw count/);
  assert.match(md, /Closeness \(harmonic\): the mean of 1 \/ distance .* The textbook closeness, 1 \/ \(sum of distances\)/);
  assert.match(md, /Eigenvector centrality: .*undirected network with tie weights summed in both directions/);
  assert.match(md, /PageRank: .*damping factor 0\.85/);
  assert.match(md, /numbered from 1 by size in the app and in every export/);
});

test('summary report sections read verdict first, with network-level wording (N13)', () => {
  const L = summaryResults(input).join('\n');
  assert.match(L, /## Compared with random networks/);
  assert.match(L, /\*\*The network splits into communities far more clearly than chance\.\*\* Observed/);
  assert.match(L, /## Groups/);
  assert.match(L, /\*\*By department\.\*\*/);
  assert.match(L, /People tie within their own department (far )?more than chance \(assortativity\)/);
  const W = wholeNetworkLines({ reciprocity: 1, largestComponentShare: 1, components: 1 }, k => k).join('\n');
  assert.match(W, /reciprocity: 1\.\*\* Reciprocity \(share of directed ties that are returned, over the whole network\)/);
  assert.match(W, /largestComponentShare: 100%/);
  assert.doesNotMatch(W, /this person/);
});

test('survey data: survey wording, combine rule and no message construction text (C10)', () => {
  const survey = { format: 'roster', family: 'survey', medium: 'survey', view: 'full', context: 'survey', tz: 'UTC', fileNames: ['9 response files'], mergeRule: 'intersection', counts: { ties: 12 },
    survey: { responded: Array(9).fill('x'), missing: ['Gabe Turner'] } };
  const out = buildMethodsAppendix({
    meta: { sources: [survey] },
    settings: { rules: { declared: { on: true, weight: 1 } }, directed: false, weighting: 'count', maxRecipients: 25, excludeBots: true, includeIsolates: true, visibility: ['private', 'unknown'] },
    network: { n: 10, directed: false, edges: { count: 12 } }, sourceLabels: ['Roster'],
  });
  assert.match(out, /- \*\*Roster\*\*\. A roster survey: .*Only reciprocated nominations were kept: a tie exists only if both people named each other/);
  assert.match(out, /9 people responded; 1 did not/);
  assert.match(out, /9 response files read\./);
  assert.doesNotMatch(out, /1 file read|broadcast|bots|Communication traces|Time zone|contexts were limited/);
  assert.match(out, /Survey answers are self-reports/);
});

test('many personal exports: one person\'s slice, the owner bridges by construction (C3)', () => {
  const chat = i => ({ format: 'whatsapp', family: 'personal', medium: 'whatsapp', view: 'chat', context: 'personal', fileNames: [`chat${i}.txt`] });
  const out = buildMethodsAppendix({ meta: { sources: Array.from({ length: 56 }, (_, i) => chat(i)) }, settings: {} });
  assert.match(out, /The 56 personal sources are one person's slice: .*the owner is tied to everyone and bridges them by construction/);
  assert.doesNotMatch(out, /Chat-view sources cover single conversations/);
});

test('survey tie weights from the builders are described: roster ratings and consensus shares', () => {
  const settings = { rules: { declared: { on: true, weight: 1 } }, directed: false, weighting: 'count' };
  const rated = { format: 'roster', family: 'survey', view: 'full', mergeRule: 'union', warnings: [{ code: 'roster-tie-weight', message: "Friendship: each tie's weight is its Closeness (1 to 5).", count: 1 }] };
  const a = buildMethodsAppendix({ meta: { sources: [rated] }, settings });
  assert.match(a, /tie weights were the respondents' ratings of each tie/);
  assert.match(a, /Import note: Friendship: each tie's weight is its Closeness \(1 to 5\)\./);
  const css = { format: 'perceived', family: 'survey', view: 'full', warnings: [{ code: 'css-consensus-weight', message: 'Each tie\'s weight is the share of the 4 informants who reported it.', count: 1 }] };
  assert.match(buildMethodsAppendix({ meta: { sources: [css] }, settings }), /tie weights were the share of informants who reported each tie/);
  assert.doesNotMatch(buildMethodsAppendix({ meta: { sources: [rated] }, settings: { ...settings, weighting: 'binary' } }), /respondents' ratings/);
});

test('communities: isolates are not counted; numbering by matching is stated after a rebuild (N17)', () => {
  const m2 = buildMethodsAppendix({ ...input, communities: { ...input.communities, count: 6, isolates: 1, numbering: 'matched' } });
  assert.match(m2, /it found 6 communities of two or more people, plus 1 person with no ties \(not counted as communities\)/);
  assert.match(m2, /numbered from 1 by matching \(after a rebuild/);
  assert.match(md, /numbered from 1 by size in the app/);
});
