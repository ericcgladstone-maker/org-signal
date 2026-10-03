// A recombined roster survey keeps who named whom, so a saved project can be
// turned into the union, reciprocated and as-reported networks later (C9),
// with joined attributes carried over and the rule in the name (C13).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../src/builders/share.js';
import * as R from '../../src/builders/roster.js';
import { runImport } from '../../src/core/pipeline.js';
import { toJSON, fromJSON } from '../../src/core/model.js';
import { buildNetwork } from '../../src/analysis/construct.js';
import { joinProfiles } from '../../src/importers/profile.js';
import { rederiveSurvey, rederivableSource } from '../../src/importers/survey-response.js';

const NAMES = ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli'];
function def() {
  const m = R.newRoster();
  m.name = 'Class friendship';
  m.people = NAMES.map((l, i) => ({ id: 'p' + i, label: l, attrs: {} }));
  m.relations = [{ ...R.makeRelation({ name: 'Friend', question: 'Who are your friends?' }), id: 'rF' }];
  m.mode = 'multi';
  m.mergeRule = 'union';
  m.share = { id: 's-class', createdAt: '2026-09-01T00:00:00.000Z' };
  return S.surveyFromRoster(m);
}
const t0 = Date.parse('2026-09-02T10:00:00Z');
// Who named whom: Ana<->Ben, Ana<->Cleo mutual; Ben->Dev, Cleo->Dev, Dev->Eli one-sided. Eli did not respond.
const NOM = { 0: [1, 2], 1: [0, 3], 2: [0, 3], 3: [4] };
async function importClass() {
  const d = def();
  const files = Object.entries(NOM).map(([i, js]) => ({
    blob: new Blob([S.responseFileText(S.makeResponse(d, { personId: 'p' + i, label: NAMES[i] }, { rF: Object.fromEntries(js.map(j => ['p' + j, { value: 1 }])) }, { now: t0 + i * 1000 }))]),
    path: `r${i}.json`,
  }));
  return (await runImport(files)).dataset;
}
const ties = (ds, directed) => buildNetwork(ds, { directed, rules: { declared: { on: true, weight: 1 } } }).edges.count;

test('recombined responses keep who named whom, and survive a project round trip', async () => {
  const ds = await importClass();
  const src = rederivableSource(ds);
  assert.ok(src, 'the survey source can be recombined');
  assert.equal(src.nominations.respondents.length, 4);
  assert.equal(src.nominations.respondents.reduce((a, r) => a + Object.keys(r.ties.rF).length, 0), 7);
  const back = fromJSON(toJSON(ds));
  assert.ok(rederivableSource(back));
  assert.equal(ties(ds, false), 5); // union: Ana-Ben, Ana-Cleo, Ben-Dev, Cleo-Dev, Dev-Eli
});

test('the same project gives the reciprocated and as-reported networks, keeping joined attributes', async () => {
  const ds0 = await importClass();
  const { dataset: ds } = joinProfiles(ds0, 'name,major\nAna,CS\nBen,CS\nCleo,Econ\nDev,Econ\nEli,Soc\n', { keyColumn: 'name', matchOn: 'name' });
  const named = { ...ds, meta: { ...ds.meta, name: 'SOC101 friendship (union)' } };
  const rec = rederiveSurvey(fromJSON(toJSON(named)), 'intersection');
  assert.equal(rec.meta.name, 'SOC101 friendship (reciprocated)');
  assert.equal(ties(rec, false), 2);
  const asRep = rederiveSurvey(rec, 'respondent');
  assert.equal(asRep.meta.name, 'SOC101 friendship (as reported)');
  assert.equal(ties(asRep, true), 7);
  const union = rederiveSurvey(asRep, 'union');
  assert.equal(ties(union, false), 5);
  for (const d of [rec, asRep, union]) {
    const i = d.nodes.keys.findIndex((_, k) => d.nodes.labels[k] === 'Cleo');
    assert.equal(d.nodes.attrs[i].major, 'Econ');
    assert.equal(d.meta.profileJoins.length, 1);
    const rule = d.meta.sources[0].warnings.filter(w => w.code === 'combine-rule');
    assert.equal(rule.length, 1);
    assert.ok(d.meta.sources[0].warnings.some(w => w.code === 'survey-responded'));
  }
  assert.match(rec.meta.sources[0].warnings.find(w => w.code === 'combine-rule').message, /Reciprocated only/);
  assert.equal(rec.meta.sources[0].mergeRule, 'intersection');
});

test('data without nominations cannot be recombined, with a reason', () => {
  const ds = { meta: { name: 'x', sources: [{ format: 'roster' }] }, events: { count: 0, source: [] }, nodes: { keys: [], attrs: [] } };
  assert.equal(rederivableSource(ds), null);
  assert.throws(() => rederiveSurvey(ds, 'union'), /does not keep who named whom/);
});
