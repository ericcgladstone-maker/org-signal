// Detection across owners: our detectors must not claim other owners' exports,
// and on our own fixtures the right importer must win against every importer
// in the registry (including importers-B's).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FileSet } from '../../src/core/fileset.js';
import { detectImports } from '../../src/core/pipeline.js';
import mine from '../../src/importers/index.workplace.js';
import { FIX } from './helpers.js';

const B = join(FIX, '..', 'importers-b');

function folders(base) {
  const out = [];
  if (!existsSync(base)) return out;
  for (const d of readdirSync(base)) {
    const p = join(base, d);
    if (!statSync(p).isDirectory()) continue;
    out.push(p);
    for (const s of readdirSync(p)) { const q = join(p, s); if (statSync(q).isDirectory()) out.push(q); }
  }
  return out;
}

test('no importers-A detector claims an importers-B fixture (score < 0.5)', async (t) => {
  const dirs = folders(B);
  if (!dirs.length) { t.skip('importers-B fixtures not present'); return; }
  const bad = [];
  for (const p of dirs) {
    const fs = await FileSet.fromPaths([p]);
    for (const imp of mine) {
      const r = await imp.detect(fs);
      if (r.score >= 0.5) bad.push(`${p.slice(B.length + 1)}: ${imp.id} ${r.score} (${r.reason})`);
    }
  }
  assert.deepEqual(bad, []);
});

const EXPECT = [
  ['slack/standard', 'slack'], ['slack/grid', 'slack'],
  ['teams/graph', 'teams'], ['teams/purview', 'teams'],
  ['email/takeout', 'email'], ['email/thunderbird', 'email'], ['email/apple', 'email'], ['email/eml', 'email'], ['email/pst', 'email'],
  ['calendar/google', 'calendar'], ['calendar/outlook', 'calendar'], ['calendar/takeout', 'calendar'],
  ['network-canvas/csv', 'network-canvas'], ['network-canvas/graphml-single', 'network-canvas'], ['network-canvas/graphml-merged', 'network-canvas'],
  ['network-files/nc.graphml', 'network-canvas'],
  ['survey/egoweb', 'survey'], ['survey/openeddi', 'survey'], ['survey/wide', 'survey'], ['survey/qualtrics', 'survey'], ['survey/forms', 'survey'],
  ['tabular/people.csv', 'tabular'],
];
for (const f of readdirSync(join(FIX, 'network-files'))) if (f !== 'nc.graphml' && !f.startsWith('gephi_nodes')) EXPECT.push([`network-files/${f}`, 'network-files']);

test('on our fixtures the expected importer wins against the whole registry', async () => {
  const wrong = [];
  for (const [rel, id] of EXPECT) {
    const p = join(FIX, rel);
    if (!existsSync(p)) { wrong.push(`${rel}: fixture missing`); continue; }
    const det = await detectImports(await FileSet.fromPaths([p]));
    const top = det[0];
    if (!top || top.id !== id) wrong.push(`${rel}: expected ${id}, got ${top ? `${top.id} ${top.score}` : 'nothing'}`);
    else if (id !== 'tabular' && top.score < 0.5) wrong.push(`${rel}: ${id} only scored ${top.score}`);
    const rival = det.find(d => d.id !== id && d.score >= 0.5 && !mine.some(m => m.id === d.id));
    if (rival) wrong.push(`${rel}: importers-B ${rival.id} also claims it (${rival.score})`);
  }
  assert.deepEqual(wrong, []);
});

import { runImport } from '../../src/core/pipeline.js';
import { VIEWS, VISIBILITY, toJSON, fromJSON } from '../../src/core/model.js';

test('every fixture imports through the pipeline with a consistent dataset and report', async () => {
  const problems = [];
  const views = new Set(Object.values(VIEWS));
  const lo = Date.UTC(1990, 0, 1), hi = Date.UTC(2031, 0, 1);
  for (const [rel] of EXPECT) {
    const p = join(FIX, rel);
    if (!existsSync(p)) continue;
    let res;
    try { res = await runImport(await FileSet.fromPaths([p]), {}); } catch (e) { problems.push(`${rel}: ${e.message}`); continue; }
    const { dataset: ds, report } = res;
    const say = m => problems.push(`${rel}: ${m}`);
    if (report.totals.events !== ds.events.count) say('report total events differ from dataset');
    if (report.sources.reduce((n, s) => n + s.counts.events, 0) !== ds.events.count) say('per-source events do not add up');
    for (const s of report.sources) {
      if (!views.has(s.view)) say(`source view "${s.view}" is not a VIEW`);
      const typed = Object.values(s.counts.eventsByType).reduce((a, b) => a + b, 0);
      if (typed !== s.counts.events) say('eventsByType does not add up');
      if (!s.canShow.length && !s.cannotShow.length) say('no can/cannot lines');
      if (s.ego && !ds.nodes.keys.includes(s.ego.key)) say(`egoKey ${s.ego.key} is not a node`);
      for (const w of s.warnings) if (!['error', 'warn', 'info'].includes(w.severity) || !w.message) say(`bad warning ${w.code}`);
    }
    for (let i = 0; i < ds.events.count; i++) {
      const t = ds.events.t[i];
      if (!Number.isNaN(t) && (t < lo || t > hi)) { say(`event ${i} time ${t} out of range`); break; }
      const a = ds.events.actor[i];
      if (!(a >= 0 && a < ds.nodes.count)) { say(`event ${i} bad actor`); break; }
      for (let j = ds.events.tOff[i]; j < ds.events.tOff[i + 1]; j++) {
        if (ds.events.tgt[j] === a) { say(`event ${i} targets its actor`); break; }
        if (!(ds.events.tgt[j] >= 0 && ds.events.tgt[j] < ds.nodes.count)) { say(`event ${i} bad target`); break; }
      }
      const c = ds.events.context[i];
      if (c >= ds.contexts.count) { say(`event ${i} bad context`); break; }
    }
    for (let c = 0; c < ds.contexts.count; c++) if (!(ds.contexts.visibility[c] < VISIBILITY.length)) say(`context ${c} bad visibility`);
    for (const k of ds.nodes.keys) if (!/^[a-z][a-z0-9-]*:./.test(k)) { say(`node key not namespaced: ${k}`); break; }
    // Project-file round trip keeps everything.
    const back = fromJSON(toJSON(ds));
    if (back.events.count !== ds.events.count || back.nodes.keys.join() !== ds.nodes.keys.join()) say('JSON round trip changed the dataset');
  }
  assert.deepEqual(problems, []);
});
