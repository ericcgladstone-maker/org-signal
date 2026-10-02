// People view: every person in the network with their measures and
// attributes, sortable and filterable (virtualised for 5,000+ rows), and a
// profile for the selected person: measures with rank and resampling
// intervals, attributes, strongest ties with their evidence, ego measures,
// activity and content, and position over time.

import { html, useState, useMemo, useEffect } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { engine } from '../services/engine.js';
import { gloss, NODE_METRICS } from '../services/glossary.js';
import { ViewHead, NeedsData, Loading, ErrorLine, Select, MetricName, Flag, Swatch, ConstructionButton, useEngine, download, applicabilityReason, Icon } from '../components/common.js';
import { VirtualTable } from '../components/vtable.js';
import { Spark } from '../components/charts.js';
import { Evidence } from './network.js';
import { categoricalScale, tokens } from '../lib/palette.js';
import { groupableAttributes, numericAttributes, label as nodeLabel } from '../lib/dsutil.js';
import { cachedRender, getRender } from '../lib/render-cache.js';
import { fmtNum, fmtInt, fmtDate, fmtPct, humanize } from '../lib/format.js';
import { EVENT_TYPES } from '../../core/model.js';

const DEFAULT_COLS = ['degree', 'strength', 'betweenness', 'closeness', 'pagerank', 'clustering', 'constraint'];

export function PeopleView() {
  const ds = useStore(s => s.dataset);
  const net = useStore(s => s.network);
  if (!ds || !net) return html`<${NeedsData} title="People" />`;
  return html`<${PeopleInner} ds=${ds} net=${net} />`;
}

function PeopleInner({ ds, net }) {
  const metrics = useStore(s => s.metrics);
  const ap = useStore(s => s.applicability) || {};
  const communities = useStore(s => s.communities);
  const selection = useStore(s => s.selection);
  const profile = useStore(s => s.ui?.profile ?? null);
  const [q, setQ] = useState('');
  const [showNA, setShowNA] = useState(false);
  const [sort, setSort] = useState({ key: 'm:degree', dir: 'desc' });
  const [filterAttr, setFilterAttr] = useState('');
  const [filterVal, setFilterVal] = useState('');
  const attrs = useMemo(() => groupableAttributes(ds), [ds]);
  // Ordinal attributes are both groupable and numeric; show each one once.
  const numAttrs = useMemo(() => numericAttributes(ds).filter(a => !attrs.some(g => g.key === a.key)).slice(0, 3), [ds, attrs]);
  const ids = net.nodeIds;
  const comm = useMemo(() => (communities ? categoricalScale(Array.from({ length: communities.count }, (_, i) => String(i))) : null), [communities]);

  const metricKeys = Object.keys(metrics?.node || {}).filter(k => showNA || ap[k]?.level !== 'na');
  metricKeys.sort((a, b) => (NODE_METRICS.indexOf(a) + 100 * !DEFAULT_COLS.includes(a)) - (NODE_METRICS.indexOf(b) + 100 * !DEFAULT_COLS.includes(b)));
  const hiddenNA = Object.keys(metrics?.node || {}).filter(k => ap[k]?.level === 'na');

  const columns = [
    { key: 'name', title: 'Name', width: 'minmax(11rem,1.6fr)', min: 170, name: true },
    ...(communities ? [{ key: 'community', title: 'Community', width: 'minmax(5.5rem,.7fr)', min: 90 }] : []),
    ...attrs.slice(0, 3).map(a => ({ key: `attr:${a.key}`, title: a.label, width: 'minmax(7rem,1fr)', min: 110 })),
    ...numAttrs.map(a => ({ key: `num:${a.key}`, title: a.label, num: true, width: 'minmax(5.5rem,.8fr)', min: 90 })),
    ...metricKeys.map(k => ({ key: `m:${k}`, title: gloss(k).label, header: html`<${MetricName} metric=${k} short=${true} iconOnly=${true} />`, num: true, width: 'minmax(6.5rem,.9fr)', min: 104 })),
  ];

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out = [];
    for (let v = 0; v < ids.length; v++) {
      const i = ids[v];
      if (s && !(ds.nodes.labels[i] || '').toLowerCase().includes(s) && !ds.nodes.keys[i].toLowerCase().includes(s)) continue;
      if (filterAttr && filterVal !== '' && String(ds.nodes.attrs[i][filterAttr] ?? '') !== filterVal) continue;
      out.push(v);
    }
    const key = sort.key;
    const val = (v) => {
      const i = ids[v];
      if (key === 'name') return (ds.nodes.labels[i] || '').toLowerCase();
      if (key === 'community') return communities?.membership[v] ?? Infinity;
      if (key.startsWith('attr:')) return String(ds.nodes.attrs[i][key.slice(5)] ?? '￿');
      if (key.startsWith('num:')) { const x = Number(ds.nodes.attrs[i][key.slice(4)]); return Number.isFinite(x) ? x : -Infinity; }
      const x = metrics.node[key.slice(2)]?.[v];
      return Number.isFinite(x) ? x : -Infinity;
    };
    const dir = sort.dir === 'asc' ? 1 : -1;
    const cache = new Map(out.map(v => [v, val(v)]));
    out.sort((a, b) => { const x = cache.get(a), y = cache.get(b); return x < y ? -dir : x > y ? dir : a - b; });
    return out;
  }, [ids, q, sort, filterAttr, filterVal, metrics, communities]);

  const onSort = (k) => setSort(s => (s.key === k ? { key: s.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'name' || k.startsWith('attr:') ? 'asc' : 'desc' }));
  const selSet = new Set(selection.map(i => net.nodeIds.indexOf(i)).filter(v => v >= 0));
  const open = (v, e) => {
    const i = ids[v];
    store.set({ ui: { ...store.get().ui, profile: i } });
    if (e?.shiftKey) store.actions.select(selection.includes(i) ? selection.filter(x => x !== i) : [...selection, i]);
    else store.actions.select([i]);
    // On narrow screens the profile sits below the table; bring it into view.
    if (window.innerWidth <= 1060) setTimeout(() => document.querySelector('.split__side')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const cell = (v, c) => {
    const i = ids[v];
    if (c.key === 'name') return html`${comm ? html`<${Swatch} color=${comm.color(String(communities.membership[v]))} />` : ''}${nodeLabel(ds, i)}${ds.nodes.isBot[i] ? html` <span class="meta">bot</span>` : ''}`;
    if (c.key === 'community') return String(communities.membership[v] + 1);
    if (c.key.startsWith('attr:')) return String(ds.nodes.attrs[i][c.key.slice(5)] ?? '');
    if (c.key.startsWith('num:')) return fmtNum(Number(ds.nodes.attrs[i][c.key.slice(4)]));
    return fmtNum(metrics.node[c.key.slice(2)][v]);
  };
  const exportCSV = () => {
    const head = columns.map(c => c.title);
    const lines = [['key', ...head].join(',')];
    for (const v of rows) lines.push([ds.nodes.keys[ids[v]], ...columns.map(c => { const x = c.key === 'name' ? nodeLabel(ds, ids[v]) : c.key.startsWith('m:') ? metrics.node[c.key.slice(2)][v] : c.key === 'community' ? communities.membership[v] + 1 : c.key.startsWith('attr:') ? ds.nodes.attrs[ids[v]][c.key.slice(5)] : ds.nodes.attrs[ids[v]][c.key.slice(4)]; const s = x == null || (typeof x === 'number' && !Number.isFinite(x)) ? '' : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; })].join(','));
    download(lines.join('\n'), 'people.csv', 'text/csv');
  };
  const filterValues = filterAttr ? (attrs.find(a => a.key === filterAttr)?.values || []) : [];

  return html`<div class="view">
    <${ViewHead} title="People" intro="Each person's position in the network. Hover a measure for what it means and how far to trust it; select a person for their profile."
      actions=${html`<${ConstructionButton} /><button class="btn" onClick=${exportCSV}>Export table</button>`} />
    <div class="toolbar">
      <label class="field field--grow"><span>Search</span><input class="input" type="search" placeholder="Name or id" value=${q} onInput=${e => setQ(e.currentTarget.value)} /></label>
      ${attrs.length > 0 && html`<${Select} label="Filter by" value=${filterAttr} onChange=${v => { setFilterAttr(v); setFilterVal(''); }} options=${[{ value: '', label: 'Everyone' }, ...attrs.map(a => ({ value: a.key, label: a.label }))]} />`}
      ${filterAttr && html`<${Select} label="Value" value=${filterVal} onChange=${setFilterVal} options=${[{ value: '', label: 'Any' }, ...filterValues.map(v => ({ value: v, label: v }))]} />`}
      ${hiddenNA.length > 0 && html`<label class="check" style="align-self:center"><input type="checkbox" checked=${showNA} onChange=${e => setShowNA(e.currentTarget.checked)} />Show ${hiddenNA.length} measure${hiddenNA.length > 1 ? 's' : ''} that do not apply here</label>`}
    </div>
    <div class="split">
      <div class="split__main">
        <p class="meta" style="margin-bottom:.4rem">${fmtInt(rows.length)} of ${fmtInt(ids.length)} people</p>
        <${VirtualTable} label="People and their measures" columns=${columns} rows=${rows} rowKey=${v => v} cell=${cell} onActivate=${open}
          selected=${selSet} sort=${sort} onSort=${onSort} empty="Nobody matches the filter." />
        ${hiddenNA.length > 0 && !showNA && html`<p class="basis">Hidden because they do not apply to this data: ${hiddenNA.map(k => gloss(k).label).join(', ')}. ${applicabilityReason(ap[hiddenNA[0]])}</p>`}
      </div>
      <aside class="split__side" aria-label="Profile">
        ${profile != null ? html`<${Profile} key=${profile} ds=${ds} net=${net} i=${profile} />` : html`<p class="label">Profile</p><p class="small text2">Select a person in the table (click, or focus the table and press Enter) to see their profile.</p>`}
      </aside>
    </div>
  </div>`;
}

// ---- profile -------------------------------------------------------------------------

function rankOf(arr, v) {
  const x = arr[v];
  if (!Number.isFinite(x)) return null;
  let r = 1, n = 0;
  for (let j = 0; j < arr.length; j++) { if (!Number.isFinite(arr[j])) continue; n++; if (arr[j] > x) r++; }
  return { rank: r, n };
}

function Profile({ ds, net, i }) {
  const metrics = useStore(s => s.metrics);
  const ap = useStore(s => s.applicability) || {};
  const communities = useStore(s => s.communities);
  const v = Array.prototype.indexOf.call(net.nodeIds, i);
  const [intervals, setIntervals] = useState({});
  const [busy, setBusy] = useState(null);
  const [edge, setEdge] = useState(null);
  const attrs = groupableAttributes(ds);
  const egoAttr = attrs.find(a => ds.nodes.attrs[i][a.key] != null)?.key;
  const ego = useEngine('ego', () => engine.ego(i, { attr: egoAttr }), [i, egoAttr], { enabled: v >= 0 });
  const series = useEngine('ts-month', () => engine.timeSeries({ window: 'month', metrics: ['degree', 'strength', 'betweenness'] }), []);
  const ties = useTies(net, v);
  const activity = useMemo(() => activityOf(ds, i), [ds, i]);
  const shown = Object.keys(metrics?.node || {}).filter(k => ap[k]?.level !== 'na');

  const resample = async (metric) => {
    setBusy(metric);
    try {
      const r = await store.actions.runJob(`Resampling ranks: ${gloss(metric).label}`, (signal, progress) => engine.resampleRanks({ metric, reps: 50, top: 10, seed: 1, signal, onProgress: progress }));
      const list = Array.isArray(r) ? r : r?.nodes || [];
      const map = new Map(list.map(x => [x.node, x]));
      setIntervals(s => ({ ...s, [metric]: { map, meta: r?.meta } }));
    } catch (e) { if (e.name !== 'AbortError') store.actions.notify('error', e.message); } finally { setBusy(null); }
  };

  if (edge) return html`<${Evidence} ds=${ds} a=${edge.a} b=${edge.b} onClose=${() => setEdge(null)} />`;
  const t = tokens();
  return html`<div>
    <p class="label">Profile</p>
    <h2 style="font-size:1.25rem;font-weight:600;letter-spacing:-.015em">${nodeLabel(ds, i)}</h2>
    <p class="meta" style="margin:.2rem 0 .8rem">${ds.nodes.keys[i]}${ds.nodes.isBot[i] ? ' · bot' : ''}${communities && v >= 0 ? ` · community ${communities.membership[v] + 1}` : ''}</p>
    ${v < 0 && html`<p class="small text2">This person is in the data but not in the current network (filtered out by the construction settings, or without ties).</p>`}

    ${v >= 0 && html`<div class="section" style="border-top:0;padding-top:0">
      <p class="label">Measures</p>
      ${shown.map(k => {
        const arr = metrics.node[k];
        const rk = rankOf(arr, v);
        const iv = intervals[k]?.map.get(i);
        const level = ap[k]?.level;
        return html`<div class="metric-row">
          <span><${MetricName} metric=${k} /></span>
          <span class="metric-row__val">${fmtNum(arr[v])}</span>
          <span class="metric-row__sub">
            ${rk ? `rank ${fmtInt(rk.rank)} of ${fmtInt(rk.n)}` : 'not defined for this person'}
            ${iv ? html` · <span style="color:var(--text-2)">95% resampling interval ${fmtInt(iv.lo)} to ${fmtInt(iv.hi)}; in the top 10 in ${fmtPct(iv.topShare)} of resamples</span>`
              : rk && ['betweenness', 'degree', 'strength', 'pagerank', 'closeness', 'eigenvector', 'constraint'].includes(k) && html` · <button class="tlink" style="font-size:.75rem" disabled=${busy === k} onClick=${() => resample(k)}>${busy === k ? 'Resampling' : 'How stable is this rank?'}</button>`}
            ${level === 'caution' && html`<br/><${Flag} level="caution" /> ${applicabilityReason(ap[k])}`}
          </span>
        </div>`;
      })}
      ${Object.keys(intervals).length > 0 && html`<p class="basis">Intervals: events resampled with replacement and the network rebuilt ${intervals[Object.keys(intervals)[0]]?.meta?.reps ?? 50} times with the same settings. A rank whose interval is wide is not a finding.</p>`}
    </div>`}

    ${Object.keys(ds.nodes.attrs[i]).length > 0 && html`<div class="section">
      <p class="label">Attributes</p>
      <dl class="kv">${Object.entries(ds.nodes.attrs[i]).map(([k, x]) => html`<dt>${humanize(k)}</dt><dd>${typeof x === 'object' ? JSON.stringify(x) : String(x)}</dd>`)}</dl>
    </div>`}

    ${v >= 0 && html`<div class="section">
      <p class="label">Strongest ties</p>
      ${ties === null ? html`<${Loading}>Reading ties</${Loading}>` : !ties.length ? html`<p class="small text2">No ties.</p>` : html`<ol style="list-style:none;margin:0;padding:0">
        ${ties.slice(0, 8).map(tie => html`<li class="metric-row">
          <button class="linkish" onClick=${() => setEdge({ a: i, b: tie.other })} aria-label=${`Evidence for the tie with ${nodeLabel(ds, tie.other)}`}>${nodeLabel(ds, tie.other)}</button>
          <span class="metric-row__val">${fmtNum(tie.w)}</span>
          <span class="metric-row__sub">${tie.dir}${tie.rules.length ? ` · ${tie.rules.join(', ')}` : ''}</span>
        </li>`)}
      </ol><p class="basis">Weight under the current construction rules. Select a name to see the events behind the tie.</p>`}
    </div>`}

    ${v >= 0 && html`<div class="section">
      <p class="label">Ego network</p>
      ${ego.loading && html`<${Loading} />`}<${ErrorLine} error=${ego.error} />
      ${ego.data && html`<dl class="kv">
        <dt>Contacts</dt><dd>${fmtInt(ego.data.size)}</dd>
        <dt>Ties among contacts</dt><dd>${fmtInt(ego.data.tiesAmongAlters)}</dd>
        <dt><${MetricName} metric="egoDensity" showFlag=${false} /></dt><dd>${fmtNum(ego.data.density)}</dd>
        <dt><${MetricName} metric="effectiveSize" showFlag=${false} /></dt><dd>${fmtNum(ego.data.effectiveSize)}</dd>
        <dt><${MetricName} metric="constraint" showFlag=${false} /></dt><dd>${fmtNum(ego.data.constraint)}</dd>
        ${ego.data.diversity != null && Number.isFinite(ego.data.diversity) && html`<dt>Diversity of contacts (${humanize(ego.data.attr)})</dt><dd>${fmtNum(ego.data.diversity)}</dd>`}
        ${ego.data.homophily != null && Number.isFinite(ego.data.homophily) && html`<dt>Contacts with the same ${humanize(ego.data.attr)}</dt><dd>${fmtPct(ego.data.homophily)}</dd>`}
      </dl>`}
    </div>`}

    <div class="section">
      <p class="label">Activity and content</p>
      <dl class="kv">
        <dt>Events by this person</dt><dd>${fmtInt(activity.total)}</dd>
        ${Object.entries(activity.byType).map(([k, n]) => html`<dt class="small">${k}</dt><dd class="small">${fmtInt(n)}</dd>`)}
        <dt>Messages with text</dt><dd>${fmtInt(activity.withText)}</dd>
        <dt>First and last seen</dt><dd>${fmtDate(activity.first)} – ${fmtDate(activity.last)}</dd>
      </dl>
      ${activity.contexts.length > 0 && html`<p class="small text2" style="margin-top:.5rem">Most active in ${activity.contexts.map(([c, n]) => `${c} (${fmtInt(n)})`).join(', ')}.</p>`}
      ${activity.terms.length > 0 && html`<p class="small text2" style="margin-top:.3rem">Frequent words: ${activity.terms.join(', ')}.</p>`}
    </div>

    ${v >= 0 && html`<div class="section">
      <p class="label">Position over time</p>
      ${series.loading && html`<${Loading} />`}<${ErrorLine} error=${series.error} />
      ${series.data?.windows?.length > 1 && html`<div class="sm-grid">
        ${['degree', 'strength', 'betweenness'].filter(m => series.data.node?.[m]).map(m => {
          const vals = series.data.windows.map((w, k) => ({ x: w.start, y: series.data.node[m][k]?.[i] ?? NaN }));
          return html`<${Spark} values=${vals} label=${gloss(m).label} color=${t.cat[0]} valueLabel=${fmtNum(vals[vals.length - 1]?.y)} />`;
        })}
      </div><p class="basis">One point per month, each month's network built with the same settings. Values are not comparable across people with very different activity.</p>`}
      ${series.data && !(series.data.windows?.length > 1) && html`<p class="small text2">Not enough dated activity for a time series.</p>`}
    </div>`}
  </div>`;
}

function useTies(net, v) {
  const [ties, setTies] = useState(null);
  useEffect(() => {
    if (v < 0) { setTies([]); return; }
    let live = true;
    const fromData = (d) => {
      const out = new Map();
      // Render indices differ from network indices; find this person's.
      const rv = Array.prototype.indexOf.call(d.nodeIds, net.nodeIds[v]);
      if (rv < 0) return [];
      for (let k = 0; k < d.src.length; k++) {
        const a = d.src[k], b = d.dst[k];
        if (a !== rv && b !== rv) continue;
        const o = a === rv ? b : a;
        const e = out.get(o) || { other: d.nodeIds[o], w: 0, out: false, in: false, rules: new Set() };
        e.w += d.w ? d.w[k] : 1;
        if (a === rv) e.out = true; else e.in = true;
        for (const r in d.byRule || {}) if (d.byRule[r][k] > 0) e.rules.add(r);
        out.set(o, e);
      }
      return [...out.values()].map(e => ({ ...e, rules: [...e.rules], dir: !net.directed ? 'undirected' : e.out && e.in ? 'both ways' : e.out ? 'outgoing' : 'incoming' })).sort((a, b) => b.w - a.w);
    };
    const d = cachedRender(net.version);
    if (d) setTies(fromData(d));
    else getRender(net.version).then(x => live && setTies(fromData(x)), () => live && setTies([]));
    return () => { live = false; };
  }, [net.version, v]);
  return ties;
}

const STOP = new Set('the a an and or of to in on for with at by from is are was were be been it this that i you we they he she me my our your their not no yes do does did have has had will would can could should just so if as but about up out into over than then there here what when where who how all any some more most very also only too its im ok okay thanks hi hello re fwd'.split(' '));

function activityOf(ds, i) {
  const e = ds.events;
  const byType = {}; const ctx = new Map(); const words = new Map();
  let total = 0, withText = 0, first = Infinity, last = -Infinity;
  for (let k = 0; k < e.count; k++) {
    if (e.actor[k] !== i) continue;
    total++;
    const ty = EVENT_TYPES[e.type[k]];
    byType[ty] = (byType[ty] || 0) + 1;
    const t = e.t[k];
    if (t === t) { if (t < first) first = t; if (t > last) last = t; }
    const c = e.context[k];
    if (c >= 0) ctx.set(ds.contexts.names[c], (ctx.get(ds.contexts.names[c]) || 0) + 1);
    const tx = e.text[k];
    if (tx) { withText++; for (const w of String(tx).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []) if (!STOP.has(w)) words.set(w, (words.get(w) || 0) + 1); }
  }
  return { total, byType, withText, first, last, contexts: [...ctx.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3), terms: [...words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0]) };
}
