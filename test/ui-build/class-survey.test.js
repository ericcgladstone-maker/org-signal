// The Networks 101 class survey (findings-class-survey.md), replayed from the
// response files the simulated students sent: the roster friendship survey
// (A4) and its ego-interview version against the roster. Expected numbers are
// the class's networkx checks (SCRATCH/ux/students/survey/py/a4.py).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../../src/builders/share.js';
import { defaultSettings, buildNetwork, computeNetworkMetrics, edgeTieAttributes } from '../../src/analysis/index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
function load(sub) {
  const out = [];
  for (const f of fs.readdirSync(path.join(dir, sub)).sort()) {
    if (!/\.(json|txt)$/.test(f)) continue;
    out.push(...S.parseResponses(fs.readFileSync(path.join(dir, sub, f), 'utf8'), { file: f }).responses);
  }
  return out;
}
const build = ds => buildNetwork(ds, defaultSettings(ds));

test('A4 roster survey: 9 of 10 responded, union 18 ties, reciprocated 12', () => {
  const res = S.recombine(load('a4-roster'));
  assert.equal(res.accepted.length, 9);
  assert.deepEqual(res.missing, ['Gabe Turner']);
  assert.equal(res.duplicates.length, 1);
  const union = build(S.recombinedDataset(res, { mergeRule: 'union' }));
  assert.equal(union.directed, false);
  assert.equal(union.edges.count, 18);
  const recip = build(S.recombinedDataset(res, { mergeRule: 'intersection' }));
  assert.equal(recip.edges.count, 12);
  const asRep = build(S.recombinedDataset(res, { mergeRule: 'respondent' }));
  assert.equal(asRep.edges.count, 30);
  const m = computeNetworkMetrics(asRep);
  assert.ok(Math.abs(m.reciprocity - 0.8) < 1e-9);
});

test('C1: the 1 to 5 closeness rating is the tie weight by default and goes out with the ties', () => {
  const res = S.recombine(load('a4-roster'));
  const ds = S.recombinedDataset(res, { mergeRule: 'union' });
  const net = build(ds);
  const w = Array.from(net.edges.w);
  assert.ok(w.some(x => x > 1), 'not every tie weighs 1');
  assert.ok(w.every(x => x >= 1 && x <= 5));
  // The weight is the larger of the two ratings: check every tie against the responses.
  const label = id => res.survey.people.find(p => p.id === id).label;
  const rel = res.survey.relations[0];
  const best = new Map();
  for (const r of res.accepted) {
    for (const [pid, ans] of Object.entries(r.answers[rel.id] || {})) {
      const k = [r._who.label, label(pid)].sort().join('|');
      best.set(k, Math.max(best.get(k) || 0, ans.fields?.strength || 1));
    }
  }
  for (let e = 0; e < net.edges.count; e++) {
    const k = [ds.nodes.labels[net.nodeIds[net.edges.src[e]]], ds.nodes.labels[net.nodeIds[net.edges.dst[e]]]].sort().join('|');
    assert.equal(net.edges.w[e], best.get(k), k);
  }
  // The rating rides on the ties' events, so exports that carry tie fields have it.
  const { fields } = edgeTieAttributes(ds, net);
  assert.ok(fields.some(f => f.key === 'strength'));
  assert.ok(ds.meta.sources[0].warnings.some(w => w.code === 'roster-tie-weight'));
});

test('C5: a one-sided nomination is credited to the person who made it', () => {
  const res = S.recombine(load('a4-roster'));
  const ds = S.recombinedDataset(res, { mergeRule: 'union' });
  const named = new Set();
  for (let e = 0; e < ds.events.count; e++) named.add(`${ds.nodes.labels[ds.events.actor[e]]}>${ds.nodes.labels[ds.events.tgt[ds.events.tOff[e]]]}`);
  const rel = res.survey.relations[0];
  const label = id => res.survey.people.find(p => p.id === id).label;
  const reported = new Set();
  for (const r of res.accepted) for (const pid of Object.keys(r.answers[rel.id] || {})) reported.add(`${r._who.label}>${label(pid)}`);
  assert.deepEqual([...named].sort(), [...reported].sort());
});

test('C2: the ego version leaves out guesses about who knows whom by default', () => {
  const res = S.recombine(load('a4-ego'));
  assert.equal(res.accepted.length, 9);
  const ds = S.recombinedDataset(res);
  const net = build(ds);
  // Own nominations only: the 30 directed ties and reciprocity 0.80 of the roster survey.
  assert.equal(net.directed, true);
  assert.equal(net.edges.count, 30);
  assert.ok(Math.abs(computeNetworkMetrics(net).reciprocity - 0.8) < 1e-9);
  // Including the perceived relation is one construction setting away.
  const all = buildNetwork(ds, { ...defaultSettings(ds), tieFields: { weight: null, filters: [] } });
  assert.ok(all.edges.count > 30);
  assert.ok(ds.meta.sources.some(s => s.perceived && s.warnings.some(w => w.code === 'survey-perceived')));
});

test('C17, C11: a pasted response starts with the answers in words and still reads back; misspelled names are suggested', async () => {
  const res = S.recombine(load('a4-roster'));
  const r = res.accepted.find(x => x._who.label === 'Aisha Bello');
  const { _who, _file, ...plain } = r;
  const text = S.responseToText(plain);
  assert.match(text, /^My answers to "SOC 101 Networks: class friendship survey \(A4\)":\n  Friendship: /);
  assert.ok(text.split('-----BEGIN')[0].includes('Strength'), 'field values in words');
  const back = S.parseResponses(`Hi Prof,\n\n${text}\nThanks, Aisha`);
  assert.equal(back.responses.length, 1);
  assert.equal(back.responses[0].ok, true);
  const { matchNames } = await import('../../src/builders/names.js');
  const people = res.survey.people;
  assert.deepEqual(matchNames('Deigo Morales', people).map(p => p.label), ['Diego Morales']);
  assert.deepEqual(matchNames('Priyanak', people).map(p => p.label), ['Priyanka Rao']);
  assert.deepEqual(matchNames('Zed', people), []);
});
