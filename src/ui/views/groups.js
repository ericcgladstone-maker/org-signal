// Groups view: compare groups defined by an attribute or by detected
// communities. Group table (size, density within, ties within and across,
// E-I index, mean measures, members), mixing matrix, assortativity with its
// null-model z and p, and a plain-language reading that only claims what the
// null comparison supports.
//
// The view opens on the same grouping as Network and People (dsutil
// defaultGroupAttr: a department-like attribute with up to eight values, else
// the detected communities); bookkeeping flags
// (Responded, Is phone number) are not offered. The descriptive table shows
// as soon as it is counted; the null model fills in the reading after.

import { html, useState, useMemo } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { engine } from '../services/engine.js';
import { ViewHead, NeedsData, Loading, ErrorLine, Select, MetricName, Swatch, ConstructionButton, useEngine, Flag, Seg, applicabilityReason } from '../components/common.js';
import { tokens } from '../lib/palette.js';
import { groupColoring } from '../lib/grouping.js';
import * as d3 from '../../../vendor/d3.js';
import { preferredAttributes, isBookkeeping, orderedValues, defaultGroupAttr, label as nodeLabel } from '../lib/dsutil.js';
import { cachedRender } from '../lib/render-cache.js';
import { fmtNum, fmtInt, fmtP, fmtPct, humanize, columnFormat } from '../lib/format.js';
import { isBookkeepingAttr } from '../../analysis/groups.js';
import { cssVar } from './time.js';

const MEAN_METRICS = ['degree', 'strength', 'betweenness', 'constraint'];
const PLANTED = 'Planted group (ground truth)';

// Display name of an attribute. The generator's planted grouping is ground
// truth, never to be confused with detected communities (decision 6, P4).
export function attrLabel(ds, key) {
  if (key === '__community') return 'Detected communities';
  const gen = store.get().generated;
  if (key === 'planted_group' || (gen && gen.groundTruth?.communities?.attr === key)) return PLANTED;
  const a = (ds.attributeSchema || []).find(x => x.key === key);
  return ds.meta?.attrLabels?.[key] || a?.label || humanize(key);
}

// Attributes worth grouping by, department-like first, minus bookkeeping
// flags (either test: the shared one in dsutil and the analysis one behind
// defaultGrouping, so a field hidden here is never the default either).
export function groupingAttributes(ds) {
  return preferredAttributes(ds).filter(a => !isBookkeeping(a) && !isBookkeepingAttr(a));
}

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
  const attrs = useMemo(() => groupingAttributes(ds), [ds]);
  const [by, setBy] = useState(() => {
    const d = defaultGroupAttr(ds, { communities });
    if (d && attrs.some(a => a.key === d)) return d;
    return communities || !attrs.length ? '__community' : attrs[0].key;
  });
  const [cellMode, setCellMode] = useState('density');
  const [openGroup, setOpenGroup] = useState(null);
  const isComm = by === '__community';
  const reps = net.n > 2000 ? 100 : 200;

  const res = useEngine('groups', async () => {
    const r = await engine.groups(by, { membership: communities?.membership });
    if (isComm && !(r?.groups?.length)) return localGroups(net, communities, cachedRender(net.version));
    return r;
  }, [by], { label: 'Comparing groups' });
  // The null model is queued after the descriptive call and fills in later.
  const nul = useEngine('groups-null', () => engine.nullModel(isComm ? { stats: ['modularity'], reps, seed: 1, membership: communities?.membership } : { stats: ['attrAssortativity', 'eiIndex'], attr: by, reps, seed: 1 }), [by, reps], { label: 'Testing against rewired networks', enabled: !!res.data });

  const r = res.data;
  const name = attrLabel(ds, by);
  const labelOf = (v) => (isComm ? `Community ${Number(v) + 1}` : String(v));
  // Colors as on the Network view: communities by number, attribute values
  // by size over the whole dataset (not just the people in the network), the
  // eight largest in color and the rest in the "Other groups" gray.
  const scale = useMemo(() => {
    if (isComm) return groupColoring(Array.from({ length: communities?.count ?? 0 }, (_, c) => ({ value: String(c) })));
    return groupColoring(orderedValues(ds, by));
  }, [ds, by, isComm, communities]);
  const means = useMemo(() => groupMeans(ds, net, metrics, by, communities), [ds, net, metrics, by, communities]);
  const members = useMemo(() => groupMembers(ds, net, metrics, by, communities), [ds, net, metrics, by, communities]);
  const shownMeans = MEAN_METRICS.filter(m => metrics?.node?.[m] && ap[m]?.level !== 'na');

  const groupsSorted = r?.groups ? [...r.groups].sort((a, b) => b.size - a.size || String(a.value).localeCompare(String(b.value))) : [];
  const assort = typeof r?.assortativity === 'number' ? r.assortativity : r?.assortativity?.observed;
  const ei = typeof r?.eiIndex === 'number' ? r.eiIndex : r?.eiIndex?.observed;
  const nA = nul.data?.attrAssortativity, nE = nul.data?.eiIndex, nQ = nul.data?.modularity;
  const colFmt = useMemo(() => {
    const f = { density: columnFormat(groupsSorted.map(g => g.density)), ei: columnFormat(groupsSorted.map(g => g.eiIndex ?? g.ei)) };
    for (const m of shownMeans) f[m] = columnFormat(groupsSorted.map(g => means?.[String(g.value)]?.[m]));
    return f;
  }, [r, means, shownMeans.join()]);

  const mixing = r?.mixing;
  const idx = mixing ? mixing.values.map(String) : [];
  const shown = groupsSorted.slice(0, 16).map(g => String(g.value)).filter(v => idx.includes(v));
  const matrix = mixing ? shown.map(a => shown.map(b => { const i = idx.indexOf(a), j = idx.indexOf(b); const src = cellMode === 'density' ? mixing.density : mixing.counts; return src?.[i]?.[j] ?? NaN; })) : [];
  const groupAp = ap.groups;

  return html`<div class="view">
    <${ViewHead} title="Groups" intro="Do ties stay inside groups or cross them? Compare departments, roles or any attribute, or the communities found in the network."
      actions=${html`<${ConstructionButton} />`} />
    <div class="toolbar">
      <${Select} label="Groups from" value=${by} onChange=${v => { setBy(v); setOpenGroup(null); }} options=${[
        ...(communities ? [{ value: '__community', label: `Detected communities (${communities.count})` }] : []),
        ...(attrs.length ? [{ group: 'Attributes', options: attrs.map(a => ({ value: a.key, label: `${attrLabel(ds, a.key)} (${a.values.length})` })) }] : []),
      ]} />
    </div>
    ${!attrs.length && html`<p class="small text2">This data has no attribute that sorts people into a few groups. Join an HR or attribute table in the Data view to compare departments or teams; until then the groups are the communities detected in the network.</p>`}
    ${groupAp && groupAp.level !== 'ok' && html`<p class="small text2"><${Flag} level=${groupAp.level} /> ${applicabilityReason(groupAp)}</p>`}
    ${res.loading && html`<${Loading}>Comparing groups</${Loading}>`}
    <${ErrorLine} error=${res.error} onRetry=${res.retry} />
    ${r && html`
      ${r.note && html`<p class="small text2">${r.note}</p>`}
      ${r.coverage != null && r.coverage < 1 && html`<p class="small text2"><${Flag} level="caution" /> ${fmtPct(r.coverage)} of people in the network have a value for ${name}; the rest are left out of these comparisons.</p>`}
      <section class="section" style="border-top:0;padding-top:.25rem" aria-labelledby="reading-h">
        <h2 id="reading-h" class="section__title">Reading</h2>
        <${Reading} isComm=${isComm} name=${isComm ? 'community' : name.replace(/\s*\([^)]*\)$/, '').toLowerCase()} assort=${assort} ei=${ei} nA=${nA} nE=${nE} nQ=${nQ} communities=${communities} loadingNull=${nul.loading} nullError=${nul.error} meta=${nul.data?.meta} />
      </section>
      <section class="section" aria-labelledby="gt-h">
        <h2 id="gt-h" class="section__title">${isComm ? 'Communities' : name}</h2>
        <div class="table-wrap"><table class="tbl">
          <thead><tr>
            <th scope="col">Group</th><th scope="col" class="num">People</th>
            <th scope="col" class="num"><${MetricName} metric="density" short=${true} showFlag=${false} /> within</th>
            <th scope="col" class="num">Ties within</th><th scope="col" class="num">Ties across</th>
            <th scope="col" class="num"><${MetricName} metric="eiIndex" showFlag=${false} /></th>
            ${shownMeans.map(m => html`<th scope="col" class="num">Mean <${MetricName} metric=${m} short=${true} iconOnly=${true} /></th>`)}
          </tr></thead>
          <tbody>${groupsSorted.map(g => { const v = String(g.value); const open = openGroup === v; const mem = members[v] || []; return html`<tr>
            <td class="name"><button type="button" class="gview__rowbtn" aria-expanded=${String(open)} onClick=${() => setOpenGroup(open ? null : v)}><span class="gview__chev" aria-hidden="true"></span><span title=${scale.isOther(v) ? 'Past the eight largest groups: gray (Other groups) on the map' : undefined}><${Swatch} color=${scale.color(v)} /></span> ${labelOf(g.value)}</button></td>
            <td class="num">${fmtInt(g.size)}</td>
            <td class="num">${colFmt.density(g.density)}</td>
            <td class="num">${fmtInt(g.internalTies ?? g.internal)}</td>
            <td class="num">${fmtInt(g.externalTies ?? g.external)}</td>
            <td class="num">${colFmt.ei(g.eiIndex ?? g.ei)}</td>
            ${shownMeans.map(m => html`<td class="num">${colFmt[m](means?.[v]?.[m])}</td>`)}
          </tr>${open && html`<tr class="gview__detail"><td colspan=${6 + shownMeans.length}>
            <p class="gview__members">${mem.length ? html`${mem.slice(0, 40).map(i => nodeLabel(ds, i)).join(', ')}${mem.length > 40 ? `, and ${fmtInt(mem.length - 40)} more` : ''}.` : 'No members in the current network.'}${metrics?.node?.degree ? ' Most connected first.' : ''}</p>
            ${mem.length > 0 && html`<button type="button" class="tlink" onClick=${() => store.actions.select(mem)}>Select these ${fmtInt(mem.length)} people</button>
              <span class="small muted"> The selection carries to Network and People.</span>`}
          </td></tr>`}`; })}</tbody>
        </table></div>
        <p class="basis">Select a group to list its members. E-I index per group: ties leaving the group minus ties inside it, over all its ties (-1 entirely inward, +1 entirely outward). Density within: share of possible ties inside the group that exist.</p>
      </section>
      ${mixing && shown.length > 1 && html`<section class="section" aria-labelledby="mx-h">
        <div class="row row--between"><h2 id="mx-h" class="section__title" style="margin:0">Mixing matrix</h2>
          <${Seg} label="Cells show" value=${cellMode} onChange=${setCellMode} options=${[{ value: 'density', label: 'Density' }, { value: 'counts', label: 'Tie counts' }]} /></div>
        <p class="small text2" style="margin:.4rem 0 .75rem">Rows send, columns receive${net.directed ? '' : ' (undirected, so the matrix is symmetric)'}. ${cellMode === 'density' ? 'Each cell is the share of possible ties between the two groups that exist.' : 'Each cell is a number of ties.'} The darkest cells, without a number, have no ties.</p>
        <${MixTable} rows=${shown.map(labelOf)} values=${matrix} mode=${cellMode} caption=${`Mixing matrix by ${isComm ? 'community' : name}: ${cellMode === 'density' ? 'tie density' : 'tie counts'} from row group to column group`} />
        ${groupsSorted.length > shown.length && html`<p class="basis">The ${shown.length} largest groups are shown.</p>`}
      </section>`}
    `}
  </div>`;
}

// The mixing matrix as a real table: values readable by screen readers, full
// group names in the headers, color as a second channel. Zero cells stay
// empty so they recede; the diagonal (within-group) cells are outlined and,
// being usually much larger, do not set the color scale for the rest.
function MixTable({ rows, values, mode, caption }) {
  const off = [], diag = [];
  values.forEach((r, i) => r.forEach((v, j) => { if (Number.isFinite(v) && v > 0) (i === j ? diag : off).push(v); }));
  const hi = Math.max(1e-12, ...(off.length ? off : diag));
  const ramp = [cssVar('--seq-zero', '#0d2a35'), ...tokens().seq];
  const interp = d3.piecewise(d3.interpolateLab, ramp);
  const color = (v) => interp(Math.max(0, Math.min(1, v / hi)));
  const fmt = mode === 'density' ? columnFormat(values.flat()) : (v) => fmtInt(v);
  const narrow = rows.length > 10;
  // Ink by the fill's lightness, so every printed value keeps its contrast.
  const ink = (v) => (d3.lab(color(v)).l > 58 ? '#051521' : 'var(--text)');
  return html`<div class="table-wrap">
    <table class=${`mx${narrow ? ' mx--narrow' : ''}`}>
      <caption class="visually-hidden">${caption}</caption>
      <thead><tr><td></td>${rows.map(c => html`<th scope="col"><span>${c}</span></th>`)}</tr></thead>
      <tbody>${rows.map((rname, i) => html`<tr><th scope="row" title=${rname}>${rname}</th>${values[i].map((v, j) => {
        const empty = !Number.isFinite(v) || v === 0;
        return html`<td class=${`${empty ? 'mx__zero' : ''}${i === j ? ' mx__diag' : ''}`} style=${empty ? '' : `background:${color(v)};color:${ink(v)}`} title=${`${rname} to ${rows[j]}: ${Number.isFinite(v) ? fmt(v) : 'no possible ties'}`}>
          ${empty ? html`<span class="visually-hidden">${Number.isFinite(v) ? '0' : 'none'}</span>` : narrow && i !== j ? html`<span class="visually-hidden">${fmt(v)}</span>` : fmt(v)}
        </td>`;
      })}</tr>`)}</tbody>
    </table>
    <div class="mx-legend" aria-hidden="true">
      <div><div class="ramp" style=${`background:linear-gradient(90deg,${ramp.join(',')})`}></div><div class="ramp-labels" style="max-width:12rem"><span>${mode === 'density' ? '0' : '1'}</span><span>${fmt(hi)}${diag.some(v => v > hi) ? ' or more' : ''}</span></div></div>
      <span><span class="mx-legend__diag"></span>Within the group</span>
      ${narrow && html`<span>Values between groups are in the cell tooltips and read aloud.</span>`}
    </div>
  </div>`;
}

function Reading({ isComm, name, assort, ei, nA, nE, nQ, communities, loadingNull, nullError, meta }) {
  const sig = (x) => x && Number.isFinite(x.p) && x.p < 0.05;
  const usable = (x) => x && Number.isFinite(x.mean);
  const p = [];
  if (isComm) {
    if (communities) p.push(html`<p>The network splits into ${communities.count} communities with modularity ${fmtNum(communities.modularity)}. ${usable(nQ) ? (sig(nQ) && nQ.observed > nQ.mean
      ? html`That is well above what random networks with the same degrees produce (${fmtNum(nQ.mean)} on average; z ${fmtNum(nQ.z, { digits: 2 })}, ${fmtP(nQ.p)}), so the grouping reflects real structure.`
      : html`That is not clearly above random networks with the same degrees (${fmtNum(nQ.mean)} on average; ${fmtP(nQ.p)}); treat the communities as one of many similar partitions.`) : ''}</p>`);
  } else {
    if (Number.isFinite(assort)) {
      const plain = assort > 0.3 ? `People tie mostly within their ${name}` : assort > 0.05 ? `People tie somewhat more within their ${name} than across` : assort < -0.05 ? `People tie more across ${name} lines than within` : `Ties mostly ignore ${name}`;
      p.push(html`<p>${plain}: assortativity is ${fmtNum(assort)} (1 means every tie stays within a group, 0 means ties ignore it). ${nA ? (!usable(nA)
        ? html`There are too few ties between people with a value to compare with rewired networks, so no test is reported.`
        : sig(nA)
          ? html`Rewired networks with the same degrees give ${fmtNum(nA.mean)} (z ${fmtNum(nA.z, { digits: 2 })}, ${fmtP(nA.p)}): people tie ${nA.observed > nA.mean ? 'within' : 'across'} their ${name} more than the degree sequence alone explains.`
          : html`That is not distinguishable from rewired networks with the same degrees (${fmtNum(nA.mean)}; ${fmtP(nA.p)}), so ${name} does not explain who ties to whom here.`) : ''}</p>`);
    }
    if (Number.isFinite(ei)) p.push(html`<p>The overall E-I index is ${fmtNum(ei)}: ${ei < -0.2 ? 'most ties stay inside groups' : ei > 0.2 ? 'most ties cross groups' : 'ties are split between staying inside and crossing groups'}${usable(nE) ? html`; random expectation ${fmtNum(nE.mean)} (${fmtP(nE.p)}).` : '.'} Larger groups have more chances for internal ties, so compare with the expectation rather than with zero.</p>`);
  }
  return html`<div class="reading">
    ${p}
    ${loadingNull && html`<p class="small muted"><span class="spinner"></span> Testing against rewired networks; the figures above are final, the comparison fills in when it is done.</p>`}
    ${nullError && html`<p class="small"><${Flag} level="error" /> Null model failed: ${nullError.message}</p>`}
    ${(usable(nA) || usable(nE) || usable(nQ)) && html`<p class="basis">Basis: ${meta?.model || 'degree-preserving rewiring'}, ${meta?.reps ?? 200} replicates, seed ${meta?.seed ?? 1}; two-sided empirical p.</p>`}
  </div>`;
}

function groupOf(ds, net, by, communities, v) {
  const g = by === '__community' ? communities?.membership[v] : ds.nodes.attrs[net.nodeIds[v]]?.[by];
  return g == null || g === '' ? null : String(g);
}

function groupMeans(ds, net, metrics, by, communities) {
  if (!metrics?.node) return null;
  const out = {};
  for (let v = 0; v < net.nodeIds.length; v++) {
    const g = groupOf(ds, net, by, communities, v);
    if (g == null) continue;
    const o = out[g] ||= { __n: {} };
    for (const m of MEAN_METRICS) {
      const x = metrics.node[m]?.[v];
      if (!Number.isFinite(x)) continue;
      o[m] = (o[m] || 0) + x; o.__n[m] = (o.__n[m] || 0) + 1;
    }
  }
  for (const o of Object.values(out)) for (const m of MEAN_METRICS) if (o.__n[m]) o[m] /= o.__n[m];
  return out;
}

// Dataset node indices per group, most connected first.
function groupMembers(ds, net, metrics, by, communities) {
  const out = {};
  const deg = metrics?.node?.degree;
  for (let v = 0; v < net.nodeIds.length; v++) {
    const g = groupOf(ds, net, by, communities, v);
    if (g == null) continue;
    (out[g] ||= []).push(v);
  }
  for (const g of Object.keys(out)) {
    out[g].sort((a, b) => (deg ? deg[b] - deg[a] : 0) || String(nodeLabel(ds, net.nodeIds[a])).localeCompare(String(nodeLabel(ds, net.nodeIds[b]))));
    out[g] = out[g].map(v => net.nodeIds[v]);
  }
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
