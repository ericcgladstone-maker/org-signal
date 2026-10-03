// End to end over many generator seeds: does the analysis recover what the
// generator planted, typically, not just on one lucky seed?
//
// Three parts, with the budget split explicitly (all seeds are recorded in
// stats.seeds):
//   A. matrix   every context x medium x preset, `count` seeds each, content
//               'none' (structure, brokers, betweenness fidelity, time shifts).
//   B. content  every medium that carries text x preset, max(1, round(count/5))
//               seeds each, content 'light' (affect and diffusion checks; VADER
//               and diffusion make these about 20x slower than A).
//   C. shifts   shift detection with both methods (robust z and CUSUM):
//               false alarms on flat worlds (no planted departure, reorg, silo,
//               quiet, consolidation, layoff or bot campaign) and power /
//               days-to-detection on planted-shift presets. Workplace Slack gets
//               `shiftSeeds` (default 20 x count) flat seeds and shiftSeeds / 2
//               per planted preset; other flat worlds shiftSeeds / 4.
//
// The analysis is the one test/integration/representation.test.js runs:
// default construction, betweenness + degree, Louvain seed 1, affect by the
// planted group, weekly timeSeries + detectShifts, diffusion when there is
// text, judged by the generator's independent recoveryCheck.

import { generate, listContexts, recoveryCheck } from '../../../src/generator/index.js';
import * as A from '../../../src/analysis/index.js';
import { tally, quantiles, mean } from '../lib.mjs';

export const name = 'recovery';
export const title = 'Generator end to end: recovery of planted structure across seeds';

const DAY = 86400000;
const SHIFT_TYPES = ['departure', 'reorg', 'silo', 'quiet', 'consolidation', 'bot-campaign', 'layoff'];
// Betweenness fidelity reported as typical in docs/api/generator.md (2026-10-02).
// The survey value is the default roster variant (classroom); ego interviews
// and perceived networks measure something else by design.
const DOC_FIDELITY = { 'workplace/slack': 1.0, 'workplace/email': 0.93, 'online/x': 0.94, 'professional/linkedin': 0.88, 'survey/survey/classroom': 0.76, 'personal/whatsapp': 0.73, 'community/reddit': 0.53 };
// Flags that the docs already explain, so the report separates them from
// unexpected ones. Matched against "context/medium/preset reason".
const KNOWN = [
  [/^community\/.*communities missed/, 'docs/api/generator.md: community structure in forums is only weakly recoverable by design'],
  [/^community\/reddit\/.*fidelity/, 'docs/api/generator.md: Reddit fidelity 0.53 (replies to strangers are not ties)'],
  [/^personal\/(whatsapp|telegram|imessage)\/.*fidelity/, 'docs/api/generator.md: WhatsApp fidelity 0.73 (turn-taking in group chats over-connects)'],
  [/^survey\/[^/]+\/(team-interviews|perceived-network).*fidelity/, 'ego interviews and perceived networks report ties with recall error by design'],
  [/^[^/]+\/network\/.*shift-/, 'network files carry no time for ties present all span; shifts cannot show'],
  [/^workplace\/[^/]+\/distributed.*bridges missed/, 'distributed preset plants no dominant brokers'],
  [/^(workplace|personal|professional|community|survey)\/network\/.*fidelity/, 'generator bug: network-medium dataset source lacks directed: false, so undirected true ties are built one-way (undirected construction gives fidelity 1.0)'],
];
const TEXT_MEDIA = new Set(['slack', 'email', 'x', 'bluesky', 'mastodon', 'whatsapp', 'telegram', 'imessage', 'reddit', 'discord']);

export function analyse(ds, T, { methods = ['robust'] } = {}) {
  const net = A.buildNetwork(ds, A.defaultSettings(ds));
  const nodeMetrics = A.computeNodeMetrics(net, { which: ['betweenness', 'degree'] });
  const com = A.detectCommunities(net, { seed: 1 });
  const attr = T.communities?.attr || (ds.attributeSchema.find(a => a.type === 'categorical') || {}).key;
  const hasText = ds.events.text.some(t => t);
  const affect = attr && hasText ? A.affect(ds, { by: 'group', attr }) : null;
  const series = A.timeSeries(ds, net.settings, { window: 'week', attr });
  const shiftsBy = Object.fromEntries(methods.map(m => [m, A.detectShifts(series, { method: m })]));
  const diffusion = hasText ? A.diffusion(ds, net, {}) : null;
  const report = recoveryCheck(T, ds, net, { membership: com.membership, nodeMetrics, affect, shifts: shiftsBy.robust || Object.values(shiftsBy)[0], diffusion });
  return { report, net, series, shiftsBy };
}

// Collapse per-term / per-event ids so they aggregate across seeds.
const checkKey = (id) => (id.startsWith('diffusion-') ? 'diffusion' : id);

function newCombo() { return { runs: 0, errors: 0, verdicts: {}, fidelity: [], nmi: [], bridges: [], shiftDays: {}, seeds: [] }; }
function addReport(c, rep) {
  for (const ch of rep.checks) {
    const k = checkKey(ch.id);
    const v = (c.verdicts[k] ||= { recovered: 0, partly: 0, missed: 0, 'not checked': 0 });
    v[ch.verdict] = (v[ch.verdict] || 0) + 1;
    if (ch.id === 'betweenness-fidelity' && Number.isFinite(ch.value)) c.fidelity.push(ch.value);
    if (ch.id === 'communities' && Number.isFinite(ch.value)) c.nmi.push(ch.value);
    if (ch.id === 'bridges' && Number.isFinite(ch.value)) c.bridges.push(ch.value);
    if (ch.id.startsWith('shift-') && ch.verdict !== 'not checked') (c.shiftDays[ch.id] ||= []).push(ch.value == null ? Infinity : ch.value);
  }
}
function summariseCombo(c) {
  const q = (a) => (a.length ? quantiles(a, [0, 0.25, 0.5, 0.75, 1]) : null);
  const recShare = Object.fromEntries(Object.entries(c.verdicts).map(([k, v]) => {
    const done = v.recovered + v.partly + v.missed;
    return [k, { ...v, recoveredShare: done ? v.recovered / done : null, missedShare: done ? v.missed / done : null }];
  }));
  return { runs: c.runs, errors: c.errors, seeds: c.seeds, verdicts: recShare, fidelity: q(c.fidelity), nmi: q(c.nmi), bridgesPrecision: q(c.bridges),
    shiftDays: Object.fromEntries(Object.entries(c.shiftDays).map(([k, a]) => [k, { n: a.length, median: quantiles(a.map(x => (Number.isFinite(x) ? x : 1e9)), [0.5]).q50, detectedShare: a.filter(Number.isFinite).length / a.length }])) };
}

// Days from a planted event to the nearest detected shift start (Infinity if none).
function nearestDays(shifts, t) {
  let best = Infinity;
  for (const s of shifts) if (Number.isFinite(s.start)) best = Math.min(best, Math.abs(s.start - t) / DAY);
  return best;
}

export async function run({ count = 10, seed = 1, log = () => {}, shiftSeeds = null, parts = ['matrix', 'content', 'shifts'] } = {}) {
  const T0 = Date.now();
  const t = tally(name);
  const seeds = (k, salt) => Array.from({ length: k }, (_, i) => seed * 100000 + salt * 1000 + i);
  const combos = {};
  const ctxs = listContexts();
  let runs = 0;

  const one = (key, spec, methods) => {
    const c = (combos[key] ||= newCombo());
    t.case(); runs++;
    try {
      const g = generate({ ...spec, output: 'dataset' });
      const r = analyse(g.dataset, g.groundTruth, { methods });
      c.runs++; c.seeds.push(spec.seed);
      addReport(c, r.report);
      t.cmp(true);
      return { g, ...r };
    } catch (err) {
      c.errors++;
      t.cmp(false, { case: key, seed: spec.seed, what: 'generate or analyse threw', got: String(err?.stack || err).slice(0, 400) });
      return null;
    }
  };

  // ---- A. matrix ------------------------------------------------------------------
  if (parts.includes('matrix')) {
    for (const cx of ctxs) for (const m of cx.media) for (const p of cx.presets) {
      for (const s of seeds(count, 1)) one(`${cx.id}/${m.id}/${p.id}`, { context: cx.id, medium: m.id, structure: p.id, seed: s, content: 'none' });
      log(`matrix ${cx.id}/${m.id}: ${runs} runs, ${((Date.now() - T0) / 1000).toFixed(0)} s`);
    }
  }

  // ---- B. content (affect, diffusion) ---------------------------------------------------
  const contentCombos = {};
  if (parts.includes('content')) {
    const k = Math.max(1, Math.round(count / 5));
    for (const cx of ctxs) for (const m of cx.media) {
      if (!TEXT_MEDIA.has(m.id)) continue;
      for (const p of cx.presets) {
        const key = `${cx.id}/${m.id}/${p.id}`;
        for (const s of seeds(k, 2)) one(key + '#content', { context: cx.id, medium: m.id, structure: p.id, seed: s, content: 'light' });
        contentCombos[key] = combos[key + '#content'];
        delete combos[key + '#content'];
      }
      log(`content ${cx.id}/${m.id}: ${runs} runs, ${((Date.now() - T0) / 1000).toFixed(0)} s`);
    }
  }

  // ---- C. shift detection ---------------------------------------------------------------
  const shiftStats = { flat: {}, planted: {} };
  if (parts.includes('shifts')) {
    const S = shiftSeeds ?? 20 * count;
    const methods = ['robust', 'cusum'];
    const flatWorlds = [
      ['workplace', 'slack', 'distributed', S],
      ['workplace', 'email', 'distributed', Math.ceil(S / 4)],
      ['online', 'x', 'interest-communities', Math.ceil(S / 4)],
      ['personal', 'whatsapp', 'close-knit', Math.ceil(S / 4)],
      ['community', 'reddit', 'core-periphery', Math.ceil(S / 4)],
    ];
    flatWorlds.forEach(([cx, med, pre, k], wi) => {
      const key = `${cx}/${med}/${pre}`;
      const st = (shiftStats.flat[key] = { datasets: 0, skippedNotFlat: 0, seeds: [], windows: [], byMethod: {} });
      for (const s of seeds(k, 10 + wi)) {
        const r = one(`shifts:${key}`, { context: cx, medium: med, structure: pre, seed: s, content: 'none' }, methods);
        if (!r) continue;
        if ((r.g.groundTruth.events || []).some(e => SHIFT_TYPES.includes(e.type))) { st.skippedNotFlat++; continue; }
        st.datasets++; st.seeds.push(s); st.windows.push(r.series.windows.length);
        // Online and forum worlds plant one-day news bursts (groundTruth.rhythm):
        // an alarm in or just after a burst week reacts to a real burst.
        const bursts = (r.g.groundTruth.rhythm?.bursts || []).map(b => b.t);
        const W = r.series.windows;
        for (const m of methods) {
          const b = (st.byMethod[m] ||= { alarms: 0, withAny: 0, nearBurst: 0, byTarget: {}, byMetric: {} });
          const sh = r.shiftsBy[m].shifts;
          b.alarms += sh.length;
          for (const x of sh) { const w = W[x.window]; if (w && bursts.some(t => t >= w.start - 7 * DAY && t < w.end)) b.nearBurst++; }
          if (sh.length) b.withAny++;
          for (const x of sh) { b.byTarget[x.target] = (b.byTarget[x.target] || 0) + 1; b.byMetric[`${x.target}:${x.metric}`] = (b.byMetric[`${x.target}:${x.metric}`] || 0) + 1; }
        }
      }
      for (const m of methods) {
        const b = st.byMethod[m];
        if (!b) continue;
        b.perDataset = b.alarms / Math.max(1, st.datasets);
        b.perDatasetAwayFromBursts = (b.alarms - b.nearBurst) / Math.max(1, st.datasets);
        b.shareWithAny = b.withAny / Math.max(1, st.datasets);
        for (const k2 of Object.keys(b.byTarget)) b.byTarget[k2] = { total: b.byTarget[k2], perDataset: b.byTarget[k2] / Math.max(1, st.datasets) };
      }
      st.windows = quantiles(st.windows, [0, 0.5, 1]);
      log(`shifts flat ${key}: ${st.datasets} datasets, ${((Date.now() - T0) / 1000).toFixed(0)} s`);
    });

    const plantedWorlds = [
      ['workplace', 'slack', 'bridge-dependent'], ['workplace', 'slack', 'siloed'], ['workplace', 'slack', 'consolidating'],
      ['workplace', 'slack', 'declining'], ['workplace', 'slack', 'reorg-midpoint'],
      ['workplace', 'email', 'siloed'], ['workplace', 'email', 'reorg-midpoint'],
      ['online', 'x', 'influencer-hub'], ['online', 'x', 'bot-amplified'],
      ['personal', 'whatsapp', 'drifting-apart'], ['community', 'reddit', 'core-exodus'],
    ];
    plantedWorlds.forEach(([cx, med, pre], wi) => {
      const key = `${cx}/${med}/${pre}`;
      const k = cx === 'workplace' && med === 'slack' ? Math.ceil(S / 2) : Math.ceil(S / 8);
      const st = (shiftStats.planted[key] = { datasets: 0, seeds: [], byMethod: {} });
      for (const s of seeds(k, 30 + wi)) {
        const r = one(`shifts:${key}`, { context: cx, medium: med, structure: pre, seed: s, content: 'none' }, methods);
        if (!r) continue;
        const T = r.g.groundTruth;
        const ev = (T.events || []).filter(e => SHIFT_TYPES.includes(e.type) && e.t > T.timespan.start && e.t < T.timespan.end);
        if (!ev.length) continue;
        st.datasets++; st.seeds.push(s);
        const tol = Math.max(7 * DAY, 0.1 * (T.timespan.end - T.timespan.start)) / DAY;
        for (const m of methods) {
          const sh = r.shiftsBy[m].shifts;
          // One measurement per distinct planted event type and time.
          const uniq = [];
          for (const e of ev) if (!uniq.some(u => u.type === e.type && Math.abs(u.t - e.t) < DAY)) uniq.push(e);
          for (const e of uniq) {
            const b = ((st.byMethod[m] ||= {})[e.type] ||= { days: [], within4: 0, within7: 0, withinTol: 0, n: 0, alarmsPerDataset: 0 });
            const d = nearestDays(sh, e.t);
            b.n++; b.days.push(d);
            if (d <= 4) b.within4++;
            if (d <= 7) b.within7++;
            if (d <= tol) b.withinTol++;
          }
          for (const b of Object.values(st.byMethod[m])) b.alarmsPerDataset += sh.length;
        }
      }
      for (const m of methods) for (const b of Object.values(st.byMethod[m] || {})) {
        b.alarmsPerDataset /= Math.max(1, st.datasets);
        b.share4 = b.within4 / b.n; b.share7 = b.within7 / b.n; b.shareTol = b.withinTol / b.n;
        b.medianDays = quantiles(b.days.map(x => (Number.isFinite(x) ? x : 1e9)), [0.5]).q50;
        b.detectedAnywhere = b.days.filter(Number.isFinite).length / b.n;
        delete b.days;
      }
      log(`shifts planted ${key}: ${st.datasets} datasets, ${((Date.now() - T0) / 1000).toFixed(0)} s`);
    });
  }

  // ---- summaries, flags and documented-claim comparisons -----------------------------------
  const matrix = Object.fromEntries(Object.entries(combos).filter(([k]) => !k.startsWith('shifts:')).map(([k, c]) => [k, summariseCombo(c)]));
  const content = Object.fromEntries(Object.entries(contentCombos).filter(([, c]) => c).map(([k, c]) => [k, summariseCombo(c)]));
  const flags = [];
  const flag = (combo, reason) => { const kn = KNOWN.find(([re]) => re.test(`${combo} ${reason}`)); flags.push({ combo, reason, known: kn ? kn[1] : null }); };
  for (const [k, c] of Object.entries(matrix)) {
    const [cx, med] = k.split('/');
    const fid = c.fidelity?.q50;
    const doc = DOC_FIDELITY[`${cx}/${med}`] ?? DOC_FIDELITY[k];
    if (doc != null && fid != null) {
      const ok = fid >= doc - 0.1;
      t.cmp(ok, { case: k, what: 'median betweenness fidelity vs docs/api/generator.md typical value', got: fid, expected: `>= ${doc} - 0.1` });
    }
    if (fid != null && fid < 0.7) flag(k, `median betweenness fidelity ${fid.toFixed(3)} (< 0.7)`);
    const cv = c.verdicts.communities;
    if (cv && cv.recoveredShare != null && cv.recoveredShare < 0.5 && !(cv.missedShare >= 0.5)) flag(k, `communities recovered in only ${(100 * cv.recoveredShare).toFixed(0)}% of seeds (median NMI ${c.nmi?.q50?.toFixed(2)})`);
    for (const id of ['communities', 'bridges']) {
      const v = c.verdicts[id];
      if (v && v.missedShare != null && v.missedShare >= 0.5) flag(k, `${id} missed in ${(100 * v.missedShare).toFixed(0)}% of seeds`);
    }
    for (const [id, v] of Object.entries(c.verdicts)) if (id.startsWith('shift-') && v.missedShare != null && v.missedShare >= 0.5) flag(k, `${id} missed in ${(100 * v.missedShare).toFixed(0)}% of seeds`);
  }
  for (const [k, c] of Object.entries(content)) for (const [id, v] of Object.entries(c.verdicts)) {
    if ((id.startsWith('affect-') || id === 'diffusion') && v.missedShare != null && v.missedShare >= 0.5) flag(k + ' (content light)', `${id} missed in ${(100 * v.missedShare).toFixed(0)}% of runs`);
  }
  // docs/api/analysis.md: 0.1 false alarms per flat workplace dataset (robust).
  const flatWp = shiftStats.flat['workplace/slack/distributed']?.byMethod?.robust;
  if (flatWp) t.cmp(flatWp.perDataset <= 0.3, { case: 'workplace/slack/distributed', what: 'robust false alarms per flat dataset vs documented 0.1', got: flatWp.perDataset, expected: '<= 0.3 (3x the documented 0.1)' });

  t.stats = {
    split: { matrixSeedsPerCombo: parts.includes('matrix') ? count : 0, contentSeedsPerCombo: parts.includes('content') ? Math.max(1, Math.round(count / 5)) : 0, shiftSeeds: shiftSeeds ?? 20 * count },
    generatorRuns: runs, seconds: (Date.now() - T0) / 1000,
    fidelityAll: quantiles(Object.values(combos).flatMap(c => c.fidelity)),
    meanFidelityByMedium: Object.fromEntries([...new Set(Object.keys(matrix).map(k => k.split('/').slice(0, 2).join('/')))].map(cm => [cm, mean(Object.entries(combos).filter(([k]) => k.startsWith(cm + '/')).flatMap(([, c]) => c.fidelity))])),
    matrix, content, shifts: shiftStats, flags,
  };
  t.notes.push(`${runs} generator runs in ${((Date.now() - T0) / 1000).toFixed(0)} s; ${flags.length} flags, ${flags.filter(f => !f.known).length} not explained by the docs.`);
  return t.result();
}
