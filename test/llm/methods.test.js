// Methods appendix content (UX pass 2026-10-02, findings D12, S17, D9, D4):
// the appendix describes each source by its role, only the attributes and
// replicate counts actually used, the attribute join, the time window and
// which measures the weighting reaches.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMethodsAppendix } from '../../src/llm/methods.js';

const slack = { format: 'slack', family: 'workplace', medium: 'chat', view: 'full', context: 'workplace', fileNames: ['export.zip'], counts: { messages: 900 } };
const hr = { format: 'tabular', family: 'tabular', medium: 'table', view: 'full', context: 'workplace', tableKind: 'nodes', fileNames: ['hr.csv'], counts: { rows: 120 } };
const meta = {
  sources: [slack, hr],
  profileJoins: [{ keyColumn: 'email', matchOn: 'email', columns: ['email', 'dept', 'title'], matched: 114, rows: 120 }],
};
const settings = { rules: { reply: { on: true, weight: 1 } }, directed: true, weighting: 'log' };
const t0 = Date.UTC(2025, 0, 6), t1 = Date.UTC(2025, 3, 5);
const dataset = { meta, nodes: { count: 121 }, events: { count: 3, t: Float64Array.from([t0, NaN, t1]) } };

const md = buildMethodsAppendix({
  dataset, settings, network: { n: 121, directed: true, edges: { count: 800 } },
  metrics: ['degree', 'strength', 'betweenness', 'closeness'], networkStats: ['density', 'avgPathLength'],
  groups: ['dept'], attributeLabels: { dept: 'Dept' },
  nullModels: [{ stats: ['transitivity', 'reciprocity'], reps: 100, seed: 1 }, { stats: ['attrAssortativity', 'eiIndex'], reps: 200, seed: 1, attr: 'dept' }],
  resampling: [{ metric: 'betweenness', reps: 50, top: 10, seed: 1 }],
});

test('an attribute table is described by its role, not as a full view of interactions', () => {
  const line = md.split('\n').find(l => l.startsWith('- **Spreadsheet**'));
  assert.ok(line, 'HR table has a source line');
  assert.match(line, /attribute table with one row per person/);
  assert.match(line, /records no interactions/);
  assert.doesNotMatch(line, /everyone's interactions are recorded/);
  // One interaction source plus a joined table is not a multi-source merge.
  assert.doesNotMatch(md, /Sources were merged by identity matching/);
});

test('the attribute join states its key and match rate', () => {
  assert.match(md, /column `email` to each person's email address; 114 of 120 rows \(95%\) matched exactly one person/);
  assert.match(md, /Columns added: `dept`, `title`\./);
  assert.match(md, /Attributes from joined tables are missing for people the join did not match/);
});

test('only the attributes analyzed are listed as groups', () => {
  assert.match(md, /Groups were defined by `Dept`\./);
  assert.doesNotMatch(md, /`title`.*Mixing/);
});

test('each null-model run carries its own replicate count', () => {
  assert.match(md, /Observed transitivity and reciprocity were compared with 100 degree-preserving randomizations produced by edge swapping/);
  assert.match(md, /Observed attribute assortativity and E-I index for groups defined by `Dept` were compared with 200 degree-preserving randomizations/);
  assert.match(md, /recomputing the network on 50 resamples/);
});

test('the time window is stated even when no range was set', () => {
  assert.match(md, /all events were used, from 6 Jan 2025 to 5 Apr 2025/);
});

test('path weighting: which measures the weighting reaches', () => {
  assert.match(md, /Path weighting: betweenness, closeness and average path length were computed on shortest paths that ignore tie weights/);
  assert.match(md, /Tie weights enter strength\./);
});

test('degree is described as in + out on directed networks, distinct contacts otherwise', () => {
  assert.match(md, /Degree: number of ties\. On a directed network this is in-degree plus out-degree/);
  const und = buildMethodsAppendix({ meta: { sources: [slack] }, settings: { directed: false }, network: { n: 3, directed: false, edges: { count: 2 } }, metrics: ['degree'] });
  assert.match(und, /Degree: number of distinct contacts\./);
});

test('source labels do not repeat the format, family and context (S17)', () => {
  const gmail = buildMethodsAppendix({ meta: { sources: [{ format: 'email', family: 'workplace', medium: 'email', view: 'ego', context: 'personal', egoKey: 'email:me@x.org' }] }, settings: {} });
  assert.match(gmail, /- \*\*Email\*\* \(personal\)\. View: \*ego\*/);
  assert.doesNotMatch(gmail, /email, email/i);
});

test('nothing is described that was not run', () => {
  const bare = buildMethodsAppendix({ meta: { sources: [slack] }, settings, metrics: ['degree'] });
  for (const h of ['Group comparison', 'Statistical comparison', 'Time windows', 'Content analysis']) assert.ok(!bare.includes(`## ${h}`), h);
});

test('survey sources state their combine rule; report labels name sources', () => {
  const survey = { format: 'survey', view: 'full', combine: 'intersection', counts: { responses: 40 } };
  const out = buildMethodsAppendix({ meta: { sources: [survey] }, settings: {}, sourceLabels: ['Roster survey'] });
  assert.match(out, /- \*\*Roster survey\*\*\. View: \*full\*.*Only reciprocated nominations were kept/);
});

test('time windows: resolved units, purposes, and repeated runs described once', () => {
  const md = buildMethodsAppendix({
    dataset: { meta: { sources: [{ format: 'slack', view: 'full', context: 'workplace', counts: {} }] }, nodes: { count: 5 }, events: { count: 9 } },
    settings: { rules: { reply: { on: true, weight: 1 } }, directed: true, weighting: 'count', time: { start: null, end: null } },
    times: [
      { window: 'week', metrics: ['degree'], purpose: 'Time view' },
      { window: 'month', metrics: ['degree'], purpose: 'person profiles' },
      { window: 'week', metrics: ['degree'], purpose: 'Time view' },
    ],
  });
  assert.match(md, /For the Time view, measures \(degree\) were recomputed in consecutive weekly windows/);
  assert.match(md, /For the person profiles, measures \(degree\) were recomputed in consecutive monthly windows/);
  assert.equal(md.match(/For the Time view/g).length, 1);
  assert.doesNotMatch(md, /auto windows/);
});
