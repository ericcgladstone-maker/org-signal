// Time view: the network rebuilt per window with the same construction
// settings. Activity and network measures over time (one chart per measure,
// never two scales on one chart), tie formation and dissolution, detected
// shifts with their statistical basis, and a before/after comparison around
// a chosen date with a paired permutation test.

import { html, useState, useMemo } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { engine } from '../services/engine.js';
import { gloss } from '../services/glossary.js';
import { ViewHead, NeedsData, Loading, ErrorLine, Select, ConstructionButton, useEngine, Flag, MetricName, Seg } from '../components/common.js';
import { LineChart } from '../components/charts.js';
import { tokens } from '../lib/palette.js';
import { timeExtent, groupableAttributes, label as nodeLabel } from '../lib/dsutil.js';
import { fmtNum, fmtInt, fmtP, fmtDate, isoDay, humanize } from '../lib/format.js';

const NET_SERIES = [
  ['activity', 'Events', 'Events in the window (bots excluded when set)'],
  ['ties', 'Ties', 'Ties in that window’s network'],
  ['nodes', 'People with ties', 'People with at least one tie in the window'],
  ['density', 'Density', null],
  ['reciprocity', 'Reciprocity', null],
  ['transitivity', 'Transitivity', null],
];

export function TimeView() {
  const ds = useStore(s => s.dataset);
  const net = useStore(s => s.network);
  if (!ds || !net) return html`<${NeedsData} title="Time" />`;
  const [t0] = timeExtent(ds);
  if (!Number.isFinite(t0)) return html`<div class="view view--col"><${ViewHead} title="Time" /><div class="empty"><h2>No timestamps</h2><p class="lead">None of the events in this data has a time, so change over time cannot be measured. Surveys and network files usually record ties without dates.</p></div></div>`;
  return html`<${TimeInner} ds=${ds} />`;
}

function TimeInner({ ds }) {
  const [win, setWin] = useState('week');
  const attrs = groupableAttributes(ds);
  const series = useEngine('ts', () => engine.timeSeries({ window: win, metrics: ['degree', 'strength'], attr: attrs[0]?.key }), [win], { label: 'Building windowed networks' });
  const shifts = useEngine('shifts', () => engine.shifts(series.data, { labels: ds.nodes.labels }), [win, !!series.data], { enabled: !!series.data?.windows?.length });
  const t = tokens();
  const s = series.data;
  const xs = s?.windows?.map(w => w.start) || [];
  const valuesOf = (key) => {
    if (!s) return null;
    if (key === 'activity') return s.activity?.total;
    if (key === 'ties') return s.network?.ties || s.windows.map(w => w.ties);
    if (key === 'nodes') return s.network?.nodes || s.windows.map(w => w.nodes);
    return s.network?.[key];
  };
  const shiftList = (shifts.data?.shifts || (Array.isArray(shifts.data) ? shifts.data : []));
  const netShifts = shiftList.filter(x => x.target === 'network' || x.target == null);
  const markersFor = (key) => netShifts.filter(x => (x.metric === key || x.label === key) && Number.isFinite(x.start)).slice(0, 4).map(x => ({ x: x.start, label: x.direction === 'up' ? 'rise' : x.direction === 'down' ? 'drop' : 'shift' }));

  return html`<div class="view">
    <${ViewHead} title="Time" intro="Each window's network is built from that window's events with the current construction settings, so a tie in one week means the same as a tie in the whole network."
      actions=${html`<${ConstructionButton} />`} />
    <div class="toolbar"><${Seg} label="Window" value=${win} onChange=${setWin} options=${[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} /></div>
    ${series.loading && html`<${Loading}>Building one network per ${win}</${Loading}>`}
    <${ErrorLine} error=${series.error} onRetry=${series.retry} />
    ${s && !s.windows?.length && html`<p class="text2">No dated events fall in the current time range.</p>`}
    ${s?.windows?.length > 0 && html`
      <section class="section" style="border-top:0;padding-top:0" aria-labelledby="ts-h">
        <h2 id="ts-h" class="section__title">Activity and structure</h2>
        <div class="grid-2" style="margin-top:.5rem">
          ${NET_SERIES.map(([key, label, sub]) => {
            const v = valuesOf(key);
            if (!v || !v.some(Number.isFinite)) return null;
            const gk = key === 'reciprocity' ? 'reciprocityNetwork' : key;
            return html`<${LineChart} yLabel=${label} title=${key in { density: 1, reciprocity: 1, transitivity: 1 } ? html`<${MetricName} metric=${gk} />` : label} sub=${sub || gloss(gk).meaning}
              series=${[{ id: key, label, color: t.cat[0], values: xs.map((x, i) => ({ x, y: v[i] })) }]} height=${160} markers=${markersFor(key)} />`;
          })}
        </div>
      </section>
      <section class="section" aria-labelledby="turn-h">
        <h2 id="turn-h" class="section__title">Tie formation and dissolution</h2>
        <div style="max-width:52rem">
          <${LineChart} sub="New ties: present in a window but not the one before. Dissolved: present before, absent now. The first window counts every tie as new."
            series=${[{ id: 'f', label: 'Formed', color: t.cat[0], values: xs.map((x, i) => ({ x, y: s.ties?.formed?.[i] })).slice(1) }, { id: 'd', label: 'Dissolved', color: t.cat[1], values: xs.map((x, i) => ({ x, y: s.ties?.dissolved?.[i] })).slice(1) }]} height=${180} />
        </div>
      </section>
      <section class="section" aria-labelledby="sh-h">
        <h2 id="sh-h" class="section__title">Detected shifts</h2>
        ${shifts.loading && html`<${Loading}>Scanning for shifts</${Loading}>`}<${ErrorLine} error=${shifts.error} />
        ${shifts.data && (shiftList.length ? html`<div class="table-wrap"><table class="tbl">
          <thead><tr><th scope="col">What</th><th scope="col">Measure</th><th scope="col">From window</th><th scope="col">Direction</th><th scope="col" class="num">Value</th><th scope="col" class="num">Baseline</th><th scope="col" class="num">z</th></tr></thead>
          <tbody>${shiftList.slice(0, 30).map(x => html`<tr>
            <td class="name">${x.target === 'node' ? nodeLabel(ds, x.id) : x.target === 'group' ? x.label : 'Whole network'}</td>
            <td>${humanize(x.metric)}</td><td>${x.windowLabel || fmtDate(x.start)}${x.length > 1 ? ` (${x.length} windows)` : ''}</td>
            <td>${x.direction === 'up' ? 'Rise' : x.direction === 'down' ? 'Drop' : ''}</td>
            <td class="num">${fmtNum(x.value)}</td><td class="num">${fmtNum(x.baseline)}</td><td class="num">${fmtNum(x.z ?? x.statistic, { digits: 2 })}</td>
          </tr>`)}</tbody></table></div>
          <p class="basis">Basis: ${shifts.data.meta?.method === 'cusum' ? 'CUSUM' : 'robust z'} of each window against the median and MAD of the ${shifts.data.meta?.baseline ?? 8} preceding windows, flagged at |z| ≥ ${shifts.data.meta?.threshold ?? 3.5}. Many series are scanned, so expect some flags by chance; confirm with the before/after test below.</p>`
          : html`<p class="small text2">No window departs from its recent baseline by more than the threshold.</p>`)}
      </section>
      <${BeforeAfter} ds=${ds} />
    `}
  </div>`;
}

function BeforeAfter({ ds }) {
  const [t0, t1] = useMemo(() => timeExtent(ds), [ds]);
  const [date, setDate] = useState(() => isoDay(t0 + (t1 - t0) / 2));
  const [ran, setRan] = useState(null);
  const ms = Date.parse(`${date}T00:00:00Z`);
  const q = useEngine('ba', () => engine.beforeAfter(ran, { metrics: ['degree', 'strength', 'betweenness'] }), [ran], { enabled: ran != null, label: 'Comparing before and after' });
  const r = q.data;
  const netKeys = ['nodes', 'ties', 'density', 'reciprocity', 'transitivity', 'avgClustering', 'components', 'largestComponentShare'];
  return html`<section class="section" aria-labelledby="ba-h">
    <h2 id="ba-h" class="section__title">Before and after a date</h2>
    <p class="small text2" style="max-width:66ch;margin-bottom:.6rem">Compares two periods of equal length either side of the date, such as a reorganisation or a move to remote work. Person-level changes are tested with a paired sign-flip permutation test.</p>
    <form class="toolbar" onSubmit=${e => { e.preventDefault(); if (Number.isFinite(ms)) setRan(ms); }}>
      <label class="field"><span>Date</span><input class="input" type="date" value=${date} min=${isoDay(t0)} max=${isoDay(t1)} onInput=${e => setDate(e.currentTarget.value)} /></label>
      <button class="btn btn--primary" type="submit">Compare</button>
    </form>
    ${q.loading && html`<${Loading}>Building both networks</${Loading}>`}<${ErrorLine} error=${q.error} />
    ${r && html`<div class="grid-2">
      <div>
        <p class="label">${fmtDate(r.before?.start)} to ${fmtDate(r.date)} vs ${fmtDate(r.date)} to ${fmtDate(r.after?.end)}</p>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th scope="col">Whole network</th><th scope="col" class="num">Before</th><th scope="col" class="num">After</th></tr></thead>
          <tbody>${netKeys.filter(k => r.network?.[k]).map(k => html`<tr><td>${gloss(k).label === humanize(k) ? humanize(k) : html`<${MetricName} metric=${k} showFlag=${false} />`}</td><td class="num">${fmtNum(r.network[k].before)}</td><td class="num">${fmtNum(r.network[k].after)}</td></tr>`)}</tbody>
        </table></div>
        ${r.ties && html`<p class="small text2" style="margin-top:.5rem">${fmtInt(r.ties.persisted)} ties persisted, ${fmtInt(r.ties.formed)} formed and ${fmtInt(r.ties.dissolved)} dissolved (overlap ${fmtNum(r.ties.jaccard, { digits: 2 })}).</p>`}
        <p class="basis">Whole-network differences have no test attached; read them as description.</p>
      </div>
      <div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th scope="col">Per person</th><th scope="col" class="num">Mean before</th><th scope="col" class="num">Mean after</th><th scope="col" class="num">d<sub>z</sub></th><th scope="col" class="num">p</th></tr></thead>
          <tbody>${Object.entries(r.node || {}).filter(([, x]) => x?.n).map(([k, x]) => html`<tr><td><${MetricName} metric=${k} showFlag=${false} /></td><td class="num">${fmtNum(x.meanBefore)}</td><td class="num">${fmtNum(x.meanAfter)}</td><td class="num">${fmtNum(x.dz, { digits: 2 })}</td><td class="num">${fmtP(x.p).replace('p = ', '').replace('p ', '')}</td></tr>`)}</tbody>
        </table></div>
        <p class="basis">${r.meta?.test || 'Paired permutation test'}, ${fmtInt(r.meta?.reps)} permutations. ${r.meta?.effectSize || ''}</p>
        ${r.node?.degree?.topIncreases?.length > 0 && html`<p class="small text2" style="margin-top:.5rem">Largest degree increases: ${r.node.degree.topIncreases.slice(0, 5).map(p => `${p.label ?? nodeLabel(ds, p.node)} (+${fmtNum(p.diff)})`).join(', ')}.</p>`}
        ${r.node?.degree?.topDecreases?.length > 0 && html`<p class="small text2">Largest decreases: ${r.node.degree.topDecreases.slice(0, 5).map(p => `${p.label ?? nodeLabel(ds, p.node)} (${fmtNum(p.diff)})`).join(', ')}.</p>`}
      </div>
    </div>`}
  </section>`;
}
