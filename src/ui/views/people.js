// People view: every person in the network with their measures and
// attributes, sortable and filterable (virtualised for 5,000+ rows), a
// column chooser, rank stability for a whole ranking (resampling intervals
// and top-10 share as columns, plus a top-10 panel), and a profile for the
// selected person: measures with rank, intervals and a plain gloss, strongest
// ties with their evidence, attributes, ego measures, activity and content,
// and position over time.

import { html, useState, useMemo, useEffect, useRef } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { engine } from '../services/engine.js';
import { gloss, NODE_METRICS } from '../services/glossary.js';
import { ViewHead, NeedsData, Loading, ErrorLine, Select, MetricName, MetricInfo, Flag, Swatch, ConstructionButton, useEngine, download, applicabilityReason } from '../components/common.js';
import { VirtualTable } from '../components/vtable.js';
import { Spark } from '../components/charts.js';
import { Evidence } from './network.js';
import { tokens } from '../lib/palette.js';
import { preferredAttributes, isBookkeeping, numericAttributes, label as nodeLabel, RULE_LABEL } from '../lib/dsutil.js';
import { cachedRender, getRender, tiesOf } from '../lib/render-cache.js';
import { fmtNum, fmtInt, fmtDate, fmtPct, fmtAttr, columnFormat, humanize, plural } from '../lib/format.js';
import { withContacts, metricLabel, rankInfo, fmtRank, RESAMPLABLE, displayKey, isDeactivated, sparkSeries } from '../lib/measures.js';
import { communityScale } from '../lib/communities.js';
import { EVENT_TYPES } from '../../core/model.js';

const DEFAULT_METRICS = ['contacts', 'strength', 'betweenness', 'closeness', 'pagerank'];
const ORDER = ['contacts', ...NODE_METRICS];
const TOP = 10;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Sort and columns survive switching views (not reloads); reset per dataset.
let prefs = { ds: null };

export function PeopleView() {
  const ds = useStore(s => s.dataset);
  const net = useStore(s => s.network);
  if (!ds || !net) return html`<${NeedsData} title="People" />`;
  return html`<${PeopleInner} ds=${ds} net=${net} />`;
}

// Rank-stability results for the current network, shared by the table and
// the profile and kept in the store so a report can cite them:
// store.stability = { version, byMetric: { [metric]: { reps, top, map: Map(dsIndex -> row) } } }.
function useStability(net) {
  const st = useStore(s => s.stability);
  return st && st.version === net.version ? st.byMetric : {};
}

async function checkStability(net, metric) {
  const r = await store.actions.runJob(`Rank stability: ${metricLabel(metric, net.directed)}`, (signal, progress) => engine.resampleRanks({ metric, reps: 50, top: TOP, seed: 1, signal, onProgress: progress }));
  const list = Array.isArray(r) ? r : r?.nodes || [];
  const cur = store.get().stability;
  const byMetric = cur && cur.version === net.version ? cur.byMetric : {};
  store.set({ stability: { version: net.version, byMetric: { ...byMetric, [metric]: { reps: r?.meta?.reps ?? 50, top: TOP, map: new Map(list.map(x => [x.node, x])) } } } });
}

function PeopleInner({ ds, net }) {
  const metrics = useStore(s => s.metrics);
  const ap = useStore(s => s.applicability) || {};
  const communities = useStore(s => s.communities);
  const selection = useStore(s => s.selection);
  const profile = useStore(s => s.ui?.profile ?? null);
  const stability = useStability(net);
  const node = useMemo(() => withContacts(metrics?.node, net.directed), [metrics, net.directed]);
  const attrs = useMemo(() => preferredAttributes(ds), [ds]);
  // Ordinal attributes are both groupable and numeric; show each one once.
  const numAttrs = useMemo(() => numericAttributes(ds).filter(a => !attrs.some(g => g.key === a.key)), [ds, attrs]);
  if (prefs.ds !== ds) {
    const visibleAttrs = attrs.filter(a => !isBookkeeping(a)).slice(0, 2).map(a => `attr:${a.key}`);
    prefs = { ds, sort: { key: 'm:contacts', dir: 'desc' }, cols: new Set(['community', ...visibleAttrs, ...DEFAULT_METRICS.map(k => `m:${k}`)]), q: '' };
  }
  const [q, setQ0] = useState(prefs.q);
  const [sort, setSort0] = useState(prefs.sort);
  const [cols, setCols0] = useState(prefs.cols);
  const setQ = v => { prefs.q = v; setQ0(v); };
  const setSort = f => setSort0(s => { const n = typeof f === 'function' ? f(s) : f; prefs.sort = n; return n; });
  const setCols = c => { prefs.cols = c; setCols0(c); };
  const [filterAttr, setFilterAttr] = useState('');
  const [filterVal, setFilterVal] = useState('');
  const [stabBusy, setStabBusy] = useState(false);
  const ids = net.nodeIds;
  const comm = useMemo(() => communityScale(communities), [communities]);

  const metricKeys = ORDER.filter(k => node?.[k]);
  const naKeys = metricKeys.filter(k => ap[k]?.level === 'na');
  const mlabel = k => metricLabel(k, net.directed);
  const formats = useMemo(() => Object.fromEntries(Object.keys(node || {}).map(k => [k, columnFormat(node[k])])), [node]);
  const sortMetric = sort.key.startsWith('m:') ? sort.key.slice(2) : null;

  // Every column that can be shown; `cols` decides which are.
  const allColumns = [
    ...(communities ? [{ key: 'community', title: 'Community', width: 'minmax(5.5rem,.7fr)', min: 96, group: 'People' }] : []),
    ...attrs.map(a => ({ key: `attr:${a.key}`, title: a.label, width: 'minmax(7rem,1fr)', min: 110, group: isBookkeeping(a) ? 'Data-collection fields' : 'Attributes' })),
    ...numAttrs.map(a => ({ key: `num:${a.key}`, title: a.label, num: true, width: 'minmax(5.5rem,.8fr)', min: 90, group: 'Attributes' })),
    ...metricKeys.map(k => ({ key: `m:${k}`, title: mlabel(k), header: k === 'degree' ? mlabel(k) : mlabel(k).split(' (')[0], info: html`<${MetricInfo} metric=${k} label=${mlabel(k)} />`, num: true, width: 'minmax(7.5rem,.9fr)', min: 124, group: ap[k]?.level === 'na' ? 'Measures that do not apply to this data' : 'Measures' })),
  ];
  const stabCols = Object.keys(stability).filter(m => cols.has(`m:${m}`)).flatMap(m => [
    { key: `iv:${m}`, title: `${mlabel(m).split(' (')[0]} rank interval`, num: true, sortable: false, width: 'minmax(7rem,.9fr)', min: 112, after: `m:${m}` },
    { key: `top:${m}`, title: `In top ${TOP}`, num: true, width: 'minmax(5.5rem,.7fr)', min: 90, after: `m:${m}` },
  ]);
  const columns = [{ key: 'name', title: 'Name', width: 'minmax(11rem,1.6fr)', min: 170, name: true }];
  for (const c of allColumns) {
    if (!cols.has(c.key)) continue;
    columns.push(c);
    for (const s of stabCols) if (s.after === c.key) columns.push(s);
  }

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
      if (key.startsWith('top:')) { const x = stability[key.slice(4)]?.map.get(i)?.topShare; return Number.isFinite(x) ? x : -Infinity; }
      const x = node?.[key.slice(2)]?.[v];
      return Number.isFinite(x) ? x : -Infinity;
    };
    const dir = sort.dir === 'asc' ? 1 : -1;
    const cache = new Map(out.map(v => [v, val(v)]));
    out.sort((a, b) => { const x = cache.get(a), y = cache.get(b); return x < y ? -dir : x > y ? dir : a - b; });
    return out;
  }, [ids, q, sort, filterAttr, filterVal, node, communities, stability]);

  const onSort = (k) => setSort(s => (s.key === k ? { key: s.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'name' || k.startsWith('attr:') ? 'asc' : 'desc' }));
  const selSet = new Set(selection.map(i => net.nodeIds.indexOf(i)).filter(v => v >= 0));
  const open = (v, e) => {
    const i = ids[v];
    store.set({ ui: { ...store.get().ui, profile: i } });
    if (e?.shiftKey) store.actions.select(selection.includes(i) ? selection.filter(x => x !== i) : [...selection, i]);
    else store.actions.select([i]);
    // On narrow screens the profile sits below the table; bring its heading
    // into view (the page's scroll padding keeps it clear of the header).
    if (window.innerWidth <= 1060) setTimeout(() => document.querySelector('.split__side')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }), 50);
  };
  const cell = (v, c) => {
    const i = ids[v];
    if (c.key === 'name') return html`${comm ? html`<${Swatch} color=${comm.color(String(communities.membership[v]))} />` : ''}${nodeLabel(ds, i)}${ds.nodes.isBot[i] ? html` <span class="meta">bot</span>` : ''}${isDeactivated(ds, i) ? html` <${Flag} level="caution">left</${Flag}>` : ''}`;
    if (c.key === 'community') return String(communities.membership[v] + 1);
    if (c.key.startsWith('attr:')) { const x = ds.nodes.attrs[i][c.key.slice(5)]; return x == null || x === '' ? html`<span class="muted">–</span>` : fmtAttr(c.key.slice(5), x); }
    if (c.key.startsWith('num:')) { const k = c.key.slice(4); const x = ds.nodes.attrs[i][k]; return x == null || x === '' ? html`<span class="muted">–</span>` : fmtAttr(k, Number.isFinite(Number(x)) && !/offset/i.test(k) ? fmtNum(Number(x)) : x); }
    if (c.key.startsWith('iv:')) { const r = stability[c.key.slice(3)]?.map.get(i); return r ? (r.lo === r.hi ? fmtInt(r.lo) : `${fmtInt(r.lo)} to ${fmtInt(r.hi)}`) : '–'; }
    if (c.key.startsWith('top:')) { const r = stability[c.key.slice(4)]?.map.get(i); return r ? fmtPct(r.topShare) : '–'; }
    const m = c.key.slice(2);
    return formats[m](node[m][v]);
  };
  const exportCSV = () => {
    const head = columns.map(c => c.title);
    const lines = [['key', ...head].join(',')];
    for (const v of rows) {
      const i = ids[v];
      lines.push([ds.nodes.keys[i], ...columns.map(c => {
        let x;
        if (c.key === 'name') x = nodeLabel(ds, i);
        else if (c.key === 'community') x = communities.membership[v] + 1;
        else if (c.key.startsWith('m:')) x = node[c.key.slice(2)][v];
        else if (c.key.startsWith('attr:')) x = ds.nodes.attrs[i][c.key.slice(5)];
        else if (c.key.startsWith('num:')) x = ds.nodes.attrs[i][c.key.slice(4)];
        else if (c.key.startsWith('iv:')) { const r = stability[c.key.slice(3)]?.map.get(i); x = r ? `${r.lo}-${r.hi}` : ''; }
        else if (c.key.startsWith('top:')) x = stability[c.key.slice(4)]?.map.get(i)?.topShare;
        const s = x == null || (typeof x === 'number' && !Number.isFinite(x)) ? '' : String(x);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })].join(','));
    }
    download(lines.join('\n'), 'people.csv', 'text/csv');
  };
  const runStability = async () => {
    if (!sortMetric) return;
    setStabBusy(true);
    try { await checkStability(net, sortMetric); } catch (e) { if (e.name !== 'AbortError') store.actions.notify('error', e.message); } finally { setStabBusy(false); }
  };
  const filterValues = filterAttr ? (attrs.find(a => a.key === filterAttr)?.values || []) : [];
  const canStab = sortMetric && RESAMPLABLE.includes(sortMetric) && ap[sortMetric]?.level !== 'na';
  const profileHidden = profile != null && !rows.some(v => ids[v] === profile);

  return html`<div class="view">
    <${ViewHead} title="People" intro="Each person's position in the network. Select a measure's name for what it means and how far to trust it; select a person for their profile."
      actions=${html`<div class="tlinks"><${ConstructionButton} /><button type="button" class="tlink tlink--down" onClick=${exportCSV}>Export table</button></div>`} />
    <div class="toolbar">
      <label class="field field--grow"><span>Search</span><input class="input" type="search" placeholder="Name or id" value=${q} onInput=${e => setQ(e.currentTarget.value)} /></label>
      ${attrs.length > 0 && html`<${Select} label="Filter by" value=${filterAttr} onChange=${v => { setFilterAttr(v); setFilterVal(''); }} options=${[{ value: '', label: 'Everyone' }, ...attrs.map(a => ({ value: a.key, label: a.label }))]} />`}
      ${filterAttr && html`<${Select} label="Value" value=${filterVal} onChange=${setFilterVal} options=${[{ value: '', label: 'Any' }, ...filterValues.map(v => ({ value: v, label: fmtAttr(filterAttr, v) }))]} />`}
    </div>
    <div class="split">
      <div class="split__main">
        <div class="row row--between" style="margin-bottom:.4rem;gap:.5rem 1.5rem">
          <p class="meta" style="margin:0">${fmtInt(rows.length)} of ${fmtInt(ids.length)} people</p>
          <div class="tlinks">
            ${canStab && !stability[sortMetric] && html`<button type="button" class="tlink" onClick=${runStability} disabled=${stabBusy}>${stabBusy ? 'Resampling' : `Check how stable the ${mlabel(sortMetric).toLowerCase()} ranking is`}</button>`}
            <${ColumnChooser} columns=${allColumns} cols=${cols} setCols=${setCols} />
          </div>
        </div>
        ${sortMetric && stability[sortMetric] && html`<${TopStability} ds=${ds} metric=${sortMetric} label=${mlabel(sortMetric)} result=${stability[sortMetric]} n=${ids.length} />`}
        <${VirtualTable} label="People and their measures" columns=${columns} rows=${rows} rowKey=${v => v} cell=${cell} onActivate=${open}
          selected=${selSet} sort=${sort} onSort=${onSort} empty="Nobody matches the search or filter." />
        ${naKeys.some(k => !cols.has(`m:${k}`)) && html`<p class="basis">Hidden because they do not apply to this data (add them under Columns): ${naKeys.map(k => mlabel(k)).join(', ')}. ${applicabilityReason(ap[naKeys[0]])}</p>`}
      </div>
      <aside class="split__side" aria-label="Profile">
        ${profile != null ? html`<${Profile} key=${profile} ds=${ds} net=${net} i=${profile} hidden=${profileHidden} />` : html`<h2 class="label">Profile</h2><p class="small text2">Select a person in the table (click, or focus the table and press Enter) to see their profile.</p>`}
      </aside>
    </div>
  </div>`;
}

function ColumnChooser({ columns, cols, setCols }) {
  const groups = [...new Set(columns.map(c => c.group))];
  const toggle = (k, on) => { const n = new Set(cols); if (on) n.add(k); else n.delete(k); setCols(n); };
  return html`<details class="people-cols">
    <summary>Columns (${columns.filter(c => cols.has(c.key)).length} of ${columns.length})</summary>
    <div class="people-cols__panel">
      ${groups.map(g => html`<fieldset><legend class="field__label">${g}</legend>
        ${columns.filter(c => c.group === g).map(c => html`<label class="check"><input type="checkbox" checked=${cols.has(c.key)} onChange=${e => toggle(c.key, e.currentTarget.checked)} />${c.title}</label>`)}
      </fieldset>`)}
    </div>
  </details>`;
}

// The top of a ranking with each person's 95% resampling interval of rank:
// a dot at the observed rank and a line across the interval, on one shared
// rank axis, so a reader sees at once which of the top places are settled.
function TopStability({ ds, metric, label, result, n }) {
  const rows = [...result.map.values()].sort((a, b) => a.rank - b.rank || a.node - b.node).slice(0, TOP);
  const maxRank = Math.max(TOP, ...rows.map(r => r.hi));
  const x = r => `${((r - 1) / Math.max(1, maxRank - 1)) * 100}%`;
  const settled = rows.filter(r => r.hi <= TOP).length;
  return html`<details class="stab" open>
    <summary><h2 class="label" style="margin:0;display:inline">Top ${TOP} by ${label}: how stable</h2></summary>
    <p class="small text2" style="margin:.3rem 0 0">${settled === rows.length ? `All ${rows.length} stay in the top ${TOP} across resamples' 95% range.` : `${settled} of ${rows.length} stay in the top ${TOP} across the resamples' 95% range; the rest could fall out, so their place is not a finding.`}</p>
    <ol class="stab__list">
      ${rows.map(r => html`<li class="stab__row">
        <span class="name">${r.rank}. ${nodeLabel(ds, r.node)}</span>
        <span class="stab__bar" role="img" aria-label=${`rank ${r.rank}, interval ${r.lo} to ${r.hi}`}>
          <span class="axis"></span><span class="span" style=${`left:${x(r.lo)};width:calc(${x(r.hi)} - ${x(r.lo)})`}></span><span class="dot" style=${`left:${x(r.rank)}`}></span>
        </span>
        <span class="tnum">${r.lo === r.hi ? fmtInt(r.lo) : `${fmtInt(r.lo)}–${fmtInt(r.hi)}`}</span>
      </li>`)}
    </ol>
    <p class="basis">Rank 1 at the left, ${fmtInt(maxRank)} at the right. Events resampled with replacement and the network rebuilt ${result.reps} times with the same settings, out of ${plural(n, 'person', 'people')}. The interval and "In top ${TOP}" columns are in the table.</p>
  </details>`;
}

// ---- profile -------------------------------------------------------------------------

function Profile({ ds, net, i, hidden }) {
  const metrics = useStore(s => s.metrics);
  const ap = useStore(s => s.applicability) || {};
  const communities = useStore(s => s.communities);
  const stability = useStability(net);
  const node = useMemo(() => withContacts(metrics?.node, net.directed), [metrics, net.directed]);
  const v = Array.prototype.indexOf.call(net.nodeIds, i);
  const [busy, setBusy] = useState(false);
  const [edge, setEdge] = useState(null);
  const head = useRef(null);
  const egoAttr = useMemo(() => preferredAttributes(ds).find(a => !isBookkeeping(a) && ds.nodes.attrs[i][a.key] != null)?.key, [ds, i]);
  const ego = useEngine('ego', () => engine.ego(i, { attr: egoAttr }), [i, egoAttr], { enabled: v >= 0 });
  const series = useEngine('ts-month', () => engine.timeSeries({ window: 'month', metrics: ['degree', 'strength', 'betweenness'] }), []);
  const ties = useTies(net, i, v);
  const activity = useMemo(() => activityOf(ds, i), [ds, i]);
  const shown = ORDER.filter(k => node?.[k] && ap[k]?.level !== 'na' && !(k === 'degree' && !net.directed));
  const comm = communityScale(communities);
  const key = displayKey(ds.nodes.keys[i]);
  const toCheck = ['degree', 'betweenness', 'closeness', 'strength'].filter(k => shown.includes(k) && ap[k]?.level !== 'na' && !stability[k]);

  const resampleAll = async () => {
    setBusy(true);
    try { for (const m of toCheck) await checkStability(net, m); } catch (e) { if (e.name !== 'AbortError') store.actions.notify('error', e.message); } finally { setBusy(false); }
  };
  const jump = id => { const el = document.getElementById(id); el?.focus({ preventScroll: true }); el?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }); };

  if (edge) return html`<${Evidence} ds=${ds} a=${edge.a} b=${edge.b} onClose=${() => setEdge(null)} />`;
  const t = tokens();
  const attrs = Object.entries(ds.nodes.attrs[i]).filter(([k]) => k !== 'deactivated');
  const sv = series.data ? sparkSeries(series.data, i) : null;
  return html`<div>
    <h2 class="label">Profile</h2>
    <p class="profile-head" tabindex="-1" ref=${head}>${nodeLabel(ds, i)}</p>
    <p class="meta" style="margin:.2rem 0 .6rem">${[key, ds.nodes.isBot[i] ? 'bot' : null].filter(Boolean).join(' · ')}${communities && v >= 0 ? html`${key || ds.nodes.isBot[i] ? ' · ' : ''}<${Swatch} color=${comm.color(String(communities.membership[v]))} /> Community ${communities.membership[v] + 1}` : ''}</p>
    ${isDeactivated(ds, i) && html`<p class="small"><${Flag} level="caution">Deactivated account</${Flag}> <span class="text2">This account was deactivated in the source; its ties end when the person left.</span></p>`}
    ${hidden && html`<p class="small text2"><${Flag} level="info">Not in the table</${Flag}> The current search or filter hides this person.</p>`}
    ${v < 0 && html`<p class="small text2">This person is in the data but not in the current network (filtered out by the construction settings, or without ties).</p>`}
    ${v >= 0 && html`<nav class="profile-skip" aria-label="Profile sections">
      <button type="button" class="tlink tlink--quiet tlink--down" onClick=${() => jump('pf-ties')}>Strongest ties</button>
      <button type="button" class="tlink tlink--quiet tlink--down" onClick=${() => jump('pf-measures')}>Measures</button>
      <button type="button" class="tlink tlink--quiet tlink--down" onClick=${() => jump('pf-activity')}>Activity</button>
    </nav>`}

    ${v >= 0 && html`<div class="section" style="border-top:0;padding-top:0">
      <h3 class="label" id="pf-ties" tabindex="-1">Strongest ties</h3>
      ${ties === null ? html`<${Loading}>Reading ties</${Loading}>` : !ties.length ? html`<p class="small text2">No ties.</p>` : html`<ol style="list-style:none;margin:0;padding:0">
        ${ties.slice(0, 8).map(tie => html`<li class="metric-row">
          <button type="button" class="linkish" onClick=${() => setEdge({ a: i, b: tie.other })} aria-label=${`Evidence for the tie with ${nodeLabel(ds, tie.other)}`}>${nodeLabel(ds, tie.other)}</button>
          <span class="metric-row__val">${fmtNum(tie.w)}</span>
          <span class="metric-row__sub">${tie.dir}${tie.rules.length ? ` · ${tie.rules.map(r => (RULE_LABEL[r] || r).toLowerCase()).join(', ')}` : ''}</span>
        </li>`)}
      </ol><p class="basis">Weight under the current construction rules. Select a name to see the events behind the tie.</p>`}
    </div>`}

    ${v >= 0 && html`<div class="section">
      <div class="row row--between" style="gap:.3rem 1rem"><h3 class="label" id="pf-measures" tabindex="-1" style="margin:0">Measures</h3>
        ${toCheck.length > 0 && html`<button type="button" class="tlink" onClick=${resampleAll} disabled=${busy}>${busy ? 'Resampling' : 'Check rank stability'}</button>`}</div>
      ${shown.map(k => {
        const arr = node[k];
        const rk = rankInfo(arr, v);
        const iv = stability[k]?.map.get(i);
        const level = ap[k]?.level;
        return html`<div class="metric-row">
          <span><${MetricName} metric=${k} label=${metricLabel(k, net.directed)} gloss=${true} /></span>
          <span class="metric-row__val">${fmtNum(arr[v])}</span>
          <span class="metric-row__sub">
            ${fmtRank(rk)}
            ${iv && html` · <span style="color:var(--text-2)">95% resampling interval ${iv.lo === iv.hi ? `rank ${fmtInt(iv.lo)}` : `ranks ${fmtInt(iv.lo)} to ${fmtInt(iv.hi)}`}; in the top ${TOP} in ${fmtPct(iv.topShare)} of resamples</span>`}
            ${level === 'caution' && html`<br/><${Flag} level="caution" /> ${applicabilityReason(ap[k])}`}
          </span>
        </div>`;
      })}
      <p class="basis">${Object.keys(stability).length ? `Intervals: events resampled with replacement and the network rebuilt ${Object.values(stability)[0].reps} times with the same settings. A rank whose interval is wide is not a finding.` : 'Rank stability resamples the events and rebuilds the network to show how far each rank could move.'}</p>
    </div>`}

    ${attrs.length > 0 && html`<div class="section">
      <h3 class="label">Attributes</h3>
      <dl class="kv">${attrs.map(([k, x]) => html`<dt>${humanize(k)}</dt><dd>${fmtAttr(k, x)}</dd>`)}</dl>
    </div>`}

    ${v >= 0 && html`<div class="section">
      <h3 class="label">Ego network</h3>
      ${ego.loading && html`<${Loading} />`}<${ErrorLine} error=${ego.error} />
      ${ego.data && html`<dl class="kv">
        <dt>Contacts</dt><dd>${fmtInt(ego.data.size)}</dd>
        <dt>Ties among contacts</dt><dd>${fmtInt(ego.data.tiesAmongAlters)}</dd>
        <dt><${MetricName} metric="egoDensity" showFlag=${false} /></dt><dd>${fmtNum(ego.data.density)}</dd>
        <dt><${MetricName} metric="effectiveSize" showFlag=${false} /></dt><dd>${fmtNum(ego.data.effectiveSize)}</dd>
        <dt><${MetricName} metric="constraint" showFlag=${false} /></dt><dd>${fmtNum(ego.data.constraint)}</dd>
        ${ego.data.diversity != null && Number.isFinite(ego.data.diversity) && html`<dt>Diversity of contacts (${humanize(ego.data.attr)})</dt><dd>${fmtNum(ego.data.diversity)}</dd>`}
        ${ego.data.homophily != null && Number.isFinite(ego.data.homophily) && html`<dt>Contacts with the same ${humanize(ego.data.attr).toLowerCase()}</dt><dd>${fmtPct(ego.data.homophily)}</dd>`}
      </dl>`}
    </div>`}

    <div class="section">
      <h3 class="label" id="pf-activity" tabindex="-1">Activity and content</h3>
      <dl class="kv">
        <dt>Events by this person</dt><dd>${fmtInt(activity.total)}</dd>
        ${Object.entries(activity.byType).map(([k, n]) => html`<dt class="small">${humanize(k)}</dt><dd class="small">${fmtInt(n)}</dd>`)}
        <dt>Messages with text</dt><dd>${fmtInt(activity.withText)}</dd>
        <dt>First and last seen</dt><dd>${fmtDate(activity.first)} – ${fmtDate(activity.last)}</dd>
      </dl>
      ${activity.contexts.length > 0 && html`<p class="small text2" style="margin-top:.5rem">Most active in ${activity.contexts.map(([c, n]) => `${c} (${fmtInt(n)})`).join(', ')}.</p>`}
      ${activity.terms.length > 0 && html`<p class="small text2" style="margin-top:.3rem">Frequent words: ${activity.terms.join(', ')}.</p>`}
    </div>

    ${v >= 0 && html`<div class="section">
      <h3 class="label">Position over time</h3>
      ${series.loading && html`<${Loading} />`}<${ErrorLine} error=${series.error} />
      ${sv && sv.windows.length > 1 && html`<div class="sm-grid">
        ${sv.metrics.map(m => html`<${Spark} values=${m.values} label=${metricLabel(m.key, net.directed)} color=${t.cat[0]} valueLabel=${m.last ? `${fmtDate(m.last.x).replace(/^\d+ /, '')}: ${fmtNum(m.last.y)}` : '–'} />`)}
      </div><p class="basis">One point per month, each month's network built with the same settings; months the data only partly covers are left out. Values are not comparable across people with very different activity.</p>`}
      ${series.data && !(sv && sv.windows.length > 1) && html`<p class="small text2">Not enough dated activity for a time series.</p>`}
    </div>`}
  </div>`;
}

function useTies(net, i, v) {
  const [ties, setTies] = useState(null);
  useEffect(() => {
    if (v < 0) { setTies([]); return; }
    let live = true;
    const d = cachedRender(net.version);
    if (d) setTies(tiesOf(d, i, net.directed));
    else getRender(net.version).then(x => live && setTies(tiesOf(x, i, net.directed)), () => live && setTies([]));
    return () => { live = false; };
  }, [net.version, i, v]);
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
