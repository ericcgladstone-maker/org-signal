// Groups view: compare groups defined by an attribute or by detected
// communities. Group table (size, density within, ties within and across,
// E-I index, mean measures), mixing matrix, assortativity with its null-model
// z and p, and a plain-language reading that only claims what the null
// comparison supports.

import { html, useState, useMemo } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { engine } from '../services/engine.js';
import { gloss } from '../services/glossary.js';
import { ViewHead, NeedsData, Loading, ErrorLine, Select, MetricName, Swatch, ConstructionButton, useEngine, Flag, Seg } from '../components/common.js';
import { Heatmap } from '../components/charts.js';
import { categoricalScale, sequentialScale } from '../lib/palette.js';
import { groupableAttributes, orderedValues } from '../lib/dsutil.js';
import { cachedRender } from '../lib/render-cache.js';
import { fmtNum, fmtInt, fmtP, fmtPct, humanize } from '../lib/format.js';

const MEAN_METRICS = ['degree', 'strength', 'betweenness', 'constraint'];

export function GroupsView() {
  const ds = useStore(s => s.dataset);
  const net = useStore(s => s.network);
  if (!ds || !net) return html`<${NeedsData} title="Groups" />`;
  return html`<${GroupsInner} ds=${ds} net=${net} />`;
}

function GroupsInner({ ds, net }) {
  const communities = useStore(s => s.communities);
  const metrics = useStore(s => s.metrics);
  const ap = useStore(s => s.applicability) || {};
  const attrs = useMemo(() => groupableAttributes(ds), [ds]);
  const [by, setBy] = useState(() => (attrs[0] ? attrs[0].key : '__community'));
  const [cellMode, setCellMode] = useState('density');
  const isComm = by === '__community';

  const res = useEngine('groups', async () => {
    const r = await engine.groups(by, { membership: communities?.membership });
    if (isComm && !(r?.groups?.length)) return localGroups(net, communities, cachedRender(net.version));
    return r;
  }, [by]);
  const nul = useEngine('groups-null', () => engine.nullModel(isComm ? { stats: ['modularity'], reps: 200, seed: 1, membership: communities?.membership } : { stats: ['attrAssortativity', 'eiIndex'], attr: by, reps: 200, seed: 1 }), [by], { label: 'Group null model' });

  const r = res.data;
  const labelOf = (v) => (isComm ? `Community ${Number(v) + 1}` : String(v));
  const order = useMemo(() => {
    if (!r?.groups) return [];
    if (isComm) return r.groups.map(g => String(g.value));
    const ov = orderedValues(ds, by).map(o => o.value);
    return ov.filter(v => r.groups.some(g => String(g.value) === v));
  }, [r, by]);
  const scale = useMemo(() => categoricalScale(order), [order]);
  const means = useMemo(() => groupMeans(ds, net, metrics, by, communities), [ds, net, metrics, by, communities]);
  const shownMeans = MEAN_METRICS.filter(m => metrics?.node?.[m] && ap[m]?.level !== 'na');

  const groupsSorted = r?.groups ? [...r.groups].sort((a, b) => b.size - a.size || String(a.value).localeCompare(String(b.value))) : [];
  const assort = typeof r?.assortativity === 'number' ? r.assortativity : r?.assortativity?.observed;
  const ei = typeof r?.eiIndex === 'number' ? r.eiIndex : r?.eiIndex?.observed;
  const nA = nul.data?.attrAssortativity, nE = nul.data?.eiIndex, nQ = nul.data?.modularity;

  const mixing = r?.mixing;
  const idx = mixing ? mixing.values.map(String) : [];
  const shown = groupsSorted.slice(0, 16).map(g => String(g.value)).filter(v => idx.includes(v));
  const matrix = mixing ? shown.map(a => shown.map(b => { const i = idx.indexOf(a), j = idx.indexOf(b); const src = cellMode === 'density' ? mixing.density : mixing.counts; return src?.[i]?.[j] ?? NaN; })) : [];
  const flat = matrix.flat().filter(Number.isFinite);
  const seq = sequentialScale(0, Math.max(1e-9, ...flat));

  return html`<div class="view">
    <${ViewHead} title="Groups" intro="Do ties stay inside groups or cross them? Compare departments, roles or any attribute, or the communities found in the network."
      actions=${html`<${ConstructionButton} />`} />
    <div class="toolbar">
      <${Select} label="Groups from" value=${by} onChange=${setBy} options=${[
        ...(communities ? [{ value: '__community', label: `Detected communities (${communities.count})` }] : []),
        ...(attrs.length ? [{ group: 'Attributes', options: attrs.map(a => ({ value: a.key, label: `${a.label} (${a.values.length})` })) }] : []),
      ]} />
    </div>
    ${!attrs.length && !isComm && html`<p class="small text2">This data has no categorical attributes. Join an HR or attribute table in the Data view, or use the detected communities.</p>`}
    ${res.loading && html`<${Loading}>Comparing groups</${Loading}>`}
    <${ErrorLine} error=${res.error} onRetry=${res.retry} />
    ${r && html`
      ${r.note && html`<p class="small text2">${r.note}</p>`}
      ${r.coverage != null && r.coverage < 1 && html`<p class="small text2"><${Flag} level="caution" /> ${fmtPct(r.coverage)} of people in the network have a value for ${humanize(by)}; the rest are left out of these comparisons.</p>`}
      <section class="section" style="border-top:0;padding-top:.25rem" aria-labelledby="reading-h">
        <h2 id="reading-h" class="section__title">Reading</h2>
        <${Reading} isComm=${isComm} by=${by} assort=${assort} ei=${ei} nA=${nA} nE=${nE} nQ=${nQ} communities=${communities} loadingNull=${nul.loading} nullError=${nul.error} meta=${nul.data?.meta} />
      </section>
      <section class="section" aria-labelledby="gt-h">
        <h2 id="gt-h" class="section__title">${isComm ? 'Communities' : humanize(by)}</h2>
        <div class="table-wrap"><table class="tbl">
          <thead><tr>
            <th scope="col">Group</th><th scope="col" class="num">People</th>
            <th scope="col" class="num"><${MetricName} metric="density" short=${true} showFlag=${false} /> within</th>
            <th scope="col" class="num">Ties within</th><th scope="col" class="num">Ties across</th>
            <th scope="col" class="num"><${MetricName} metric="eiIndex" showFlag=${false} /></th>
            ${shownMeans.map(m => html`<th scope="col" class="num">Mean <${MetricName} metric=${m} short=${true} iconOnly=${true} /></th>`)}
          </tr></thead>
          <tbody>${groupsSorted.map(g => html`<tr>
            <td class="name"><${Swatch} color=${scale.color(String(g.value))} /> ${labelOf(g.value)}</td>
            <td class="num">${fmtInt(g.size)}</td>
            <td class="num">${fmtNum(g.density)}</td>
            <td class="num">${fmtInt(g.internalTies ?? g.internal)}</td>
            <td class="num">${fmtInt(g.externalTies ?? g.external)}</td>
            <td class="num">${fmtNum(g.eiIndex ?? g.ei)}</td>
            ${shownMeans.map(m => html`<td class="num">${fmtNum(means?.[String(g.value)]?.[m])}</td>`)}
          </tr>`)}</tbody>
        </table></div>
        <p class="basis">E-I index per group: ties leaving the group minus ties inside it, over all its ties (-1 entirely inward, +1 entirely outward). Density within: share of possible ties inside the group that exist.</p>
      </section>
      ${mixing && shown.length > 1 && html`<section class="section" aria-labelledby="mx-h">
        <div class="row row--between"><h2 id="mx-h" class="section__title" style="margin:0">Mixing matrix</h2>
          <${Seg} label="Cells show" value=${cellMode} onChange=${setCellMode} options=${[{ value: 'density', label: 'Density' }, { value: 'counts', label: 'Tie counts' }]} /></div>
        <div style="margin-top:.75rem;max-width:44rem">
          <${Heatmap} rows=${shown.map(labelOf)} cols=${shown.map(labelOf)} values=${matrix} color=${seq} format=${cellMode === 'density' ? (x => fmtNum(x, { digits: 2 })) : fmtInt}
            sub=${`Rows send, columns receive${net.directed ? '' : ' (undirected: symmetric)'}. ${cellMode === 'density' ? 'Ties per possible pair of people' : 'Number of ties'}.`} />
        </div>
        ${groupsSorted.length > shown.length && html`<p class="basis">The ${shown.length} largest groups are shown.</p>`}
      </section>`}
    `}
  </div>`;
}

function Reading({ isComm, by, assort, ei, nA, nE, nQ, communities, loadingNull, nullError, meta }) {
  const name = isComm ? 'community' : humanize(by).toLowerCase();
  const sig = (x) => x && Number.isFinite(x.p) && x.p < 0.05;
  const p = [];
  if (isComm) {
    if (communities) p.push(html`<p>The network splits into ${communities.count} communities with modularity ${fmtNum(communities.modularity)}. ${nQ ? (sig(nQ) && nQ.observed > nQ.mean
      ? html`That is well above what random networks with the same degrees produce (${fmtNum(nQ.mean)} on average; z ${fmtNum(nQ.z, { digits: 2 })}, ${fmtP(nQ.p)}), so the grouping reflects real structure.`
      : html`That is not clearly above random networks with the same degrees (${fmtNum(nQ.mean)} on average; ${fmtP(nQ.p)}); treat the communities as one of many similar partitions.`) : ''}</p>`);
  } else {
    if (Number.isFinite(assort)) p.push(html`<p>Assortativity by ${name} is ${fmtNum(assort)} (1 means every tie stays within a group, 0 means ties ignore it). ${nA ? (sig(nA)
      ? html`Rewired networks with the same degrees give ${fmtNum(nA.mean)} (z ${fmtNum(nA.z, { digits: 2 })}, ${fmtP(nA.p)}): people tie ${nA.observed > nA.mean ? 'within' : 'across'} their ${name} more than the degree sequence alone explains.`
      : html`That is not distinguishable from rewired networks with the same degrees (${fmtNum(nA.mean)}; ${fmtP(nA.p)}), so ${name} does not explain who ties to whom here.`) : ''}</p>`);
    if (Number.isFinite(ei)) p.push(html`<p>The overall E-I index is ${fmtNum(ei)}: ${ei < -0.2 ? 'most ties stay inside groups' : ei > 0.2 ? 'most ties cross groups' : 'ties are split between staying inside and crossing groups'}${nE ? html`; random expectation ${fmtNum(nE.mean)} (${fmtP(nE.p)}).` : '.'} Larger groups have more chances for internal ties, so compare with the expectation rather than with zero.</p>`);
  }
  return html`<div class="reading">
    ${p}
    ${loadingNull && html`<p class="small muted"><span class="spinner"></span> Running the null model</p>`}
    ${nullError && html`<p class="small"><${Flag} level="error" /> Null model failed: ${nullError.message}</p>`}
    ${(nA || nE || nQ) && html`<p class="basis">Basis: ${meta?.model || 'degree-preserving rewiring'}, ${meta?.reps ?? 200} replicates, seed ${meta?.seed ?? 1}; two-sided empirical p.</p>`}
  </div>`;
}

function groupMeans(ds, net, metrics, by, communities) {
  if (!metrics?.node) return null;
  const out = {};
  const ids = net.nodeIds;
  for (let v = 0; v < ids.length; v++) {
    const g = by === '__community' ? String(communities?.membership[v]) : ds.nodes.attrs[ids[v]][by];
    if (g == null || g === '') continue;
    const o = out[String(g)] ||= { __n: {} };
    for (const m of MEAN_METRICS) {
      const x = metrics.node[m]?.[v];
      if (!Number.isFinite(x)) continue;
      o[m] = (o[m] || 0) + x; o.__n[m] = (o.__n[m] || 0) + 1;
    }
  }
  for (const o of Object.values(out)) for (const m of MEAN_METRICS) if (o.__n[m]) o[m] /= o.__n[m];
  return out;
}

// Community table from tie counts when the engine has no grouping for
// communities. Counting only; no statistics are computed here.
function localGroups(net, communities, render) {
  if (!communities || !render) return { groups: [], mixing: null };
  const k = communities.count;
  const m = communities.membership;
  const size = new Array(k).fill(0); for (const c of m) if (c >= 0) size[c]++;
  const counts = Array.from({ length: k }, () => new Array(k).fill(0));
  let I = 0, E = 0;
  const ni = render.netIndex;
  for (let e = 0; e < render.src.length; e++) {
    const a = m[ni[render.src[e]]], b = m[ni[render.dst[e]]];
    counts[a][b]++; if (!net.directed && a !== b) counts[b][a]++;
    if (a === b) I++; else E++;
  }
  const possible = (a, b) => (a === b ? (net.directed ? size[a] * (size[a] - 1) : size[a] * (size[a] - 1) / 2) : size[a] * size[b]);
  const density = counts.map((row, a) => row.map((c, b) => (possible(a, b) ? c / possible(a, b) : NaN)));
  const groups = size.map((s, a) => { let ext = 0; for (let b = 0; b < k; b++) if (b !== a) ext += counts[a][b] + (net.directed ? counts[b][a] : 0); const int = counts[a][a]; return { value: String(a), size: s, internalTies: int, externalTies: ext, density: density[a][a], eiIndex: int + ext ? (ext - int) / (ext + int) : NaN }; });
  return { attr: '__community', groups, mixing: { values: groups.map(g => g.value), counts, density }, assortativity: NaN, eiIndex: I + E ? (E - I) / (E + I) : NaN };
}
