// ui-core unit tests: formatting, Markdown marks, dataset readers, and the
// contract check that keeps services/mock.js faithful to the real analysis
// engine (same result shapes on the same dataset), so the UI developed
// against ?mock renders real results the same way.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtNum, fmtP, fmtPct, humanize, isoDay } from '../../src/ui/lib/format.js';
import { markUnverified } from '../../src/ui/lib/markdown.js';
import { ruleEvidence, timeExtent, orderedValues, hasText, activityHistogram } from '../../src/ui/lib/dsutil.js';
import { categoricalScale } from '../../src/ui/lib/palette.js';
import * as mock from '../../src/ui/services/mock.js';
import * as real from '../../src/analysis/index.js';
import { normaliseRender } from '../../src/ui/services/engine.js';

const ds = mock.mockDataset({ n: 60, seed: 3 });

test('number formatting keeps meaningful digits and never uses exponents for ordinary values', () => {
  assert.equal(fmtNum(0.00094), '0.00094');
  assert.equal(fmtNum(12345), '12,345');
  assert.equal(fmtNum(0.123456), '0.123');
  assert.equal(fmtNum(NaN), '–');
  assert.equal(fmtP(0.0004), 'p < 0.001');
  assert.equal(fmtPct(0.256), '26%');
  assert.equal(humanize('largestComponentShare'), 'Largest component share');
  assert.equal(isoDay(Date.UTC(2026, 0, 5)), '2026-01-05');
});

test('unverified numbers are wrapped by index, and mismatched spans are left alone', () => {
  const text = 'Density is 0.16 and 42% cross.';
  const out = markUnverified(text, [{ text: '42%', index: 20 }, { text: '9', index: 3 }]);
  assert.equal(out, 'Density is 0.16 and \u000142%\u0002 cross.');
});

test('categorical colours follow the given order and fold the tail into Other', () => {
  const sc = categoricalScale(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
  assert.equal(sc.entries.length, 8);
  assert.equal(sc.folded, true);
  assert.notEqual(sc.color('h'), sc.otherColor);
  assert.equal(sc.color('i'), sc.otherColor);
  assert.notEqual(sc.color('a'), sc.color('b'));
});

test('dataset readers', () => {
  const ev = ruleEvidence(ds);
  assert.ok(ev.mention > 0 && ev.copresence > 0 && ev.follow === 0);
  const [lo, hi] = timeExtent(ds);
  assert.ok(hi > lo);
  assert.equal(orderedValues(ds, 'department').length, 5);
  assert.ok(hasText(ds));
  const h = activityHistogram(ds, 20);
  assert.equal(h.bins.reduce((a, b) => a + b, 0), Array.from(ds.events.t).filter(Number.isFinite).length);
});

// ---- the mock speaks the real engine's shapes ------------------------------------

function keysOf(o) { return Object.keys(o || {}).filter(k => k !== 'meta').sort(); }

function mustContain(realObj, mockObj, label) {
  const missing = keysOf(realObj).filter(k => !(k in (mockObj || {})));
  // The mock may omit extras the UI never reads; these are the ones it reads.
  return missing.length ? `${label}: mock lacks ${missing.join(', ')}` : null;
}

test('mock engine results have the fields the UI reads from the real engine', () => {
  const sm = mock.defaultSettings(ds);
  const sr = real.defaultSettings(ds);
  const nm = mock.buildNetwork(ds, sm);
  const nr = real.buildNetwork(ds, sr);
  const problems = [];

  // groups
  const gm = mock.groupMetrics(nm, ds, 'department');
  const gr = real.groupMetrics(nr, ds, 'department');
  for (const k of ['groups', 'mixing', 'assortativity', 'eiIndex', 'coverage', 'values']) if (!(k in gm)) problems.push(`groupMetrics.${k}`);
  for (const k of ['value', 'size', 'internalTies', 'externalTies', 'density', 'eiIndex']) { if (!(k in gr.groups[0])) problems.push(`real groups[].${k}`); if (!(k in gm.groups[0])) problems.push(`mock groups[].${k}`); }
  assert.equal(typeof gr.assortativity, typeof gm.assortativity);

  // null model
  const nullR = real.nullModel(nr, { stats: ['transitivity', 'attrAssortativity', 'eiIndex'], reps: 5, ds, attr: 'department' });
  const nullM = mock.nullModel(nm, { stats: ['transitivity', 'attrAssortativity', 'eiIndex'], reps: 5, ds, attr: 'department' });
  for (const s of ['transitivity', 'attrAssortativity', 'eiIndex']) for (const k of ['observed', 'mean', 'sd', 'z', 'p']) { if (!(k in nullR[s])) problems.push(`real nullModel.${s}.${k}`); if (!(k in nullM[s])) problems.push(`mock nullModel.${s}.${k}`); }

  // resampling: arrays of { node, rank, lo, hi, topShare }
  const rr = real.resampleRanks(ds, sr, { metric: 'degree', reps: 3 });
  const rm = mock.resampleRanks(ds, sm, { metric: 'degree', reps: 3 });
  assert.ok(Array.isArray(rr) && Array.isArray(rm));
  for (const k of ['node', 'rank', 'lo', 'hi', 'topShare']) { if (!(k in rr[0])) problems.push(`real resample.${k}`); if (!(k in rm[0])) problems.push(`mock resample.${k}`); }

  // ego, evidence (dataset indices)
  const a = nr.nodeIds[0];
  const er = real.egoMetrics(nr, a, { ds, attr: 'department' });
  const em = mock.egoMetrics(nm, a, { ds, attr: 'department' });
  for (const k of ['size', 'tiesAmongAlters', 'density', 'effectiveSize', 'constraint', 'alters', 'homophily']) { if (!(k in er)) problems.push(`real ego.${k}`); if (!(k in em)) problems.push(`mock ego.${k}`); }
  const b = nr.nodeIds[nr.edges.dst[0]], a0 = nr.nodeIds[nr.edges.src[0]];
  const evr = real.edgeEvidence(ds, nr, a0, b, { limit: 5, bothDirections: true });
  const evm = mock.edgeEvidence(ds, nm, a0, b, { limit: 5 });
  assert.ok(Array.isArray(evr) && Array.isArray(evm));
  for (const k of ['event', 't', 'type', 'rule', 'actor', 'context', 'text']) { if (evr[0] && !(k in evr[0])) problems.push(`real evidence.${k}`); if (evm[0] && !(k in evm[0])) problems.push(`mock evidence.${k}`); }

  // time
  const tr = real.timeSeries(ds, sr, { window: 'month', metrics: ['degree'] });
  const tm = mock.timeSeries(ds, sm, { window: 'month', metrics: ['degree'] });
  for (const k of ['windows', 'node', 'network', 'ties', 'activity']) if (!(k in tm)) problems.push(`mock timeSeries.${k}`);
  for (const k of ['start', 'end', 'label', 'events', 'nodes', 'ties']) if (!(k in tm.windows[0])) problems.push(`mock windows[].${k}`);
  assert.equal(tr.windows.length, tm.windows.length);
  const shr = real.detectShifts(tr, {});
  const shm = mock.detectShifts(tm, {});
  assert.ok(Array.isArray(shr.shifts) && Array.isArray(shm.shifts));
  const mid = (tr.windows[1].start + tr.windows[2].start) / 2;
  const bar = real.compareBeforeAfter(ds, sr, mid, { reps: 20, metrics: ['degree'] });
  const bam = mock.compareBeforeAfter(ds, sm, mid, { reps: 20, metrics: ['degree'] });
  const pb = mustContain(bar, bam, 'compareBeforeAfter'); if (pb) problems.push(pb);
  for (const k of ['n', 'meanBefore', 'meanAfter', 'dz', 'p']) if (!(k in bam.node.degree)) problems.push(`mock beforeAfter.node.degree.${k}`);

  // content
  const afr = real.affect(ds, { by: 'group', attr: 'department' });
  const afm = mock.affect(ds, { by: 'group', attr: 'department' });
  for (const k of ['key', 'label', 'n', 'mean']) { if (!(k in afr.groups[0])) problems.push(`real affect row.${k}`); if (!(k in afm.groups[0])) problems.push(`mock affect row.${k}`); }
  assert.ok('coverage' in afr && 'coverage' in afm);
  const kwr = real.keywords(ds, { by: 'group', attr: 'department', k: 5 });
  const kwm = mock.keywords(ds, { by: 'group', attr: 'department', k: 5 });
  for (const k of ['key', 'label', 'terms']) { if (!(k in kwr.units[0])) problems.push(`real keywords.${k}`); if (!(k in kwm.units[0])) problems.push(`mock keywords.${k}`); }
  const tpr = real.topics(ds, { k: 3, iterations: 10 });
  const tpm = mock.topics(ds, { k: 3 });
  for (const k of ['id', 'share', 'terms']) { if (!(k in tpr.topics[0])) problems.push(`real topics.${k}`); if (!(k in tpm.topics[0])) problems.push(`mock topics.${k}`); }
  const dfr = real.diffusion(ds, nr, { terms: ['roadmap'], reps: 5 });
  const dfm = mock.diffusion(ds, nm, { terms: ['roadmap'], reps: 5 });
  for (const k of ['term', 'adopters', 'exposedShare', 'null', 'adoptions']) { if (!(k in dfr.terms[0])) problems.push(`real diffusion.${k}`); if (!(k in dfm.terms[0])) problems.push(`mock diffusion.${k}`); }

  // render
  const rendR = normaliseRender(real.graphForRender(nr, { iterations: 5 }));
  for (const k of ['nodeIds', 'netIndex', 'x', 'y', 'src', 'dst', 'w', 'byRule', 'layerMask']) if (!rendR[k]) problems.push(`render.${k}`);
  assert.equal(rendR.x.length, rendR.nodeIds.length);

  assert.deepEqual(problems, []);
});
