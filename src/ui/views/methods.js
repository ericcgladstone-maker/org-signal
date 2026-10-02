// Methods and Export view: the deterministic methods appendix (no LLM),
// network files for other tools, figures, a print-friendly summary report,
// and saving or opening an Org Signal project file. Everything is produced
// on this device.

import { html, useState, useEffect, useRef } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { toJSON, fromJSON, MODEL_VERSION } from '../../core/model.js';
import { FORMATS, available, exportAs } from '../services/exporters.js';
import { methodsAppendix } from '../services/llm.js';
import { gloss, NODE_METRICS } from '../services/glossary.js';
import { ViewHead, Loading, ErrorLine, Flag, download, Unavailable, applicabilityReason } from '../components/common.js';
import { renderMarkdown, markdownToHTMLDocument } from '../lib/markdown.js';
import { categoricalScale, tokens } from '../lib/palette.js';
import { cachedRender, getRender } from '../lib/render-cache.js';
import { groupableAttributes, label as nodeLabel } from '../lib/dsutil.js';
import { fmtNum, fmtInt, fmtRange } from '../lib/format.js';

export function MethodsView() {
  const ds = useStore(s => s.dataset);
  return html`<div class="view view--col">
    <${ViewHead} title="Methods & Export" intro="A methods appendix written from the choices actually made, files for other network tools, figures, a printable summary, and a project file to pick up where you left off." />
    ${ds ? html`<${Loaded} ds=${ds} />` : html`<div class="section" style="border-top:0"><p class="text2">Nothing to describe or export yet. Load data, or open a saved project below.</p></div>`}
    <${Project} />
  </div>`;
}

function appendixInput(state) {
  const { dataset, settings, network, metrics, communities } = state;
  const approx = {};
  for (const [k, m] of Object.entries(metrics?.meta || {})) if (m?.approximate) approx[k] = m.method || 'approximate (sampled)';
  return {
    dataset, settings,
    network: network ? { n: network.n, directed: network.directed, edges: { count: network.edgeCount }, summary: network.summary } : null,
    metrics: Object.keys(metrics?.node || {}),
    networkStats: Object.keys(metrics?.network || {}).filter(k => typeof metrics.network[k] === 'number'),
    approx,
    communities: communities ? { resolution: communities.resolution ?? 1, seed: communities.seed ?? 1, runs: 1 } : undefined,
    groups: groupableAttributes(dataset).map(a => a.key),
    nullModel: { stats: ['reciprocity', 'transitivity', 'avgClustering', 'modularity', 'attrAssortativity', 'eiIndex'], reps: 100, seed: 1 },
    resampling: { metric: 'betweenness', reps: 50, top: 10, seed: 1, scheme: 'events resampled with replacement' },
    software: { name: 'Org Signal', version: '2' },
  };
}

function Loaded({ ds }) {
  const state = useStore(s => s);
  const [md, setMd] = useState(null);
  const [err, setErr] = useState(null);
  const [avail, setAvail] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    let live = true;
    setMd(null);
    methodsAppendix(appendixInput(state)).then(m => live && setMd(m ?? false), e => live && setErr(e));
    return () => { live = false; };
  }, [state.network?.version]);
  useEffect(() => { available().then(setAvail); }, []);

  const doExport = async (id) => {
    setBusy(id);
    try {
      const r = await exportAs(id, { ds, settings: state.settings, nodeMetrics: state.metrics?.node, communities: state.communities });
      download(r.text, r.filename, r.mime);
    } catch (e) { store.actions.notify('error', e.message); } finally { setBusy(null); }
  };
  const figure = async () => {
    const data = cachedRender(state.network.version) || await getRender(state.network.version);
    download(staticNetworkSVG(ds, data, state.communities, state.metrics), 'network-figure.svg', 'image/svg+xml');
  };
  const summary = () => {
    const doc = markdownToHTMLDocument(summaryMarkdown(state, md || ''), `${ds.meta.name}: network summary`);
    download(doc, 'org-signal-summary.html', 'text/html');
  };

  return html`
    <section class="section" style="border-top:0" aria-labelledby="exp-h">
      <h2 id="exp-h" class="section__title">Network files</h2>
      <p class="small text2" style="margin-bottom:.6rem">The network as currently constructed, with attributes, measures and communities. Ids are the dataset's node keys, so files can be joined back.</p>
      <div class="table-wrap"><table class="tbl">
        <tbody>${FORMATS.map(f => html`<tr>
          <td class="name" style="width:9rem">${f.label}</td>
          <td class="small">${f.note}</td>
          <td style="text-align:right">${avail && !avail[f.id] ? html`<${Flag} level="na">Not available yet</${Flag}>` : html`<button class="btn btn--sm" onClick=${() => doExport(f.id)} disabled=${busy === f.id || !avail}>${busy === f.id ? 'Preparing' : `Download .${f.ext}`}</button>`}</td>
        </tr>`)}</tbody>
      </table></div>
    </section>
    <section class="section" aria-labelledby="fig-h">
      <h2 id="fig-h" class="section__title">Figures and summary</h2>
      <div class="row">
        <button class="btn" onClick=${figure}>Network figure (SVG, coloured by community)</button>
        <button class="btn" onClick=${() => store.actions.setView('network')}>Current view as SVG or PNG</button>
        <button class="btn" onClick=${summary} disabled=${md === null}>Summary report (HTML, prints to PDF)</button>
      </div>
      <p class="basis">The summary report contains the data description, whole-network measures with their meanings, the most central people with applicability notes, and the methods appendix. No language model is involved.</p>
    </section>
    <section class="section" aria-labelledby="meth-h">
      <div class="row row--between">
        <h2 id="meth-h" class="section__title" style="margin:0">Methods appendix</h2>
        ${md && html`<div class="row"><button class="btn btn--sm" onClick=${() => download(md, 'methods-appendix.md', 'text/markdown')}>Markdown</button><button class="btn btn--sm" onClick=${() => download(markdownToHTMLDocument(md, 'Methods appendix'), 'methods-appendix.html', 'text/html')}>HTML</button></div>`}
      </div>
      <p class="small text2" style="margin:.4rem 0 1rem">Written deterministically from the sources, construction settings and measures in use. Copy it into a paper or report and edit as needed.</p>
      <${ErrorLine} error=${err} />
      ${md === null && !err && html`<${Loading}>Writing the appendix</${Loading}>`}
      ${md === false && html`<${Unavailable}>The methods appendix (src/llm/methods.js) is not available in this build.</${Unavailable}>`}
      ${md && renderMarkdown(md, { shift: 1 })}
    </section>`;
}

function topBy(state, metric, k = 10) {
  const arr = state.metrics?.node?.[metric];
  if (!arr) return [];
  const ids = state.network.nodeIds;
  return Array.from(arr.keys()).filter(v => Number.isFinite(arr[v])).sort((a, b) => arr[b] - arr[a]).slice(0, k).map(v => ({ i: ids[v], value: arr[v] }));
}

function summaryMarkdown(state, appendix) {
  const { dataset: ds, network, metrics, communities, applicability: ap = {}, report } = state;
  const L = [];
  L.push(`# ${ds.meta.name}`, '');
  const t = report?.totals;
  L.push(`${fmtInt(ds.nodes.count)} people and ${fmtInt(ds.events.count)} events from ${ds.meta.sources.length} source(s)${t?.timeRange ? `, ${fmtRange(t.timeRange.start, t.timeRange.end)}` : ''}. The network has ${fmtInt(network.n)} people and ${fmtInt(network.edgeCount)} ${network.directed ? 'directed' : 'undirected'} ties.`, '');
  L.push('## Sources', '');
  for (const s of report?.sources || []) {
    L.push(`- **${s.format}** (${s.view} view): ${fmtInt(s.counts?.events)} events, ${fmtInt(s.counts?.nodes)} people. Cannot show: ${(s.cannotShow || []).join(' ')}`);
  }
  L.push('', '## Whole network', '');
  for (const [k, v] of Object.entries(metrics?.network || {})) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const g = gloss(k);
    if (g.meaning === 'No description available.') continue;
    L.push(`- **${g.label}: ${fmtNum(v)}.** ${g.meaning} ${g.reliability ? `Reliability: ${g.reliability}` : ''}`);
  }
  if (communities) L.push(`- **Communities: ${communities.count}** (modularity ${fmtNum(communities.modularity)}). ${gloss('community').reliability}`);
  L.push('', '## Most central people', '', 'Ranks are descriptive. Check rank intervals (People view) before treating a ranking as a finding.', '');
  for (const m of ['degree', 'betweenness']) {
    if (ap[m]?.level === 'na') { L.push(`- ${gloss(m).label}: not applicable here. ${applicabilityReason(ap[m])}`); continue; }
    const top = topBy(state, m, 8);
    if (!top.length) continue;
    L.push(`- **${gloss(m).label}** (${gloss(m).meaning}) ${top.map(x => `${nodeLabel(ds, x.i)} (${fmtNum(x.value)})`).join(', ')}.${ap[m]?.level === 'caution' ? ` Caution: ${applicabilityReason(ap[m])}` : ''}`);
  }
  L.push('');
  if (appendix) L.push(appendix.replace(/^# /m, '## '));
  return L.join('\n');
}

export function staticNetworkSVG(ds, data, communities, metrics) {
  const t = tokens();
  const W = 1200, H = 900, pad = 40;
  const n = data.x.length;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let v = 0; v < n; v++) { x0 = Math.min(x0, data.x[v]); x1 = Math.max(x1, data.x[v]); y0 = Math.min(y0, data.y[v]); y1 = Math.max(y1, data.y[v]); }
  const s = Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad) / (y1 - y0 || 1));
  const X = v => pad + (data.x[v] - x0) * s + ((W - 2 * pad) - (x1 - x0) * s) / 2;
  const Y = v => pad + (data.y[v] - y0) * s + ((H - 2 * pad) - (y1 - y0) * s) / 2;
  const k = communities?.count || 0;
  const sc = categoricalScale(Array.from({ length: k }, (_, i) => String(i)));
  const deg = metrics?.node?.degree;
  const mx = deg ? Math.max(1, ...Array.from(deg).filter(Number.isFinite)) : 1;
  const ni = data.netIndex;
  const r = v => (n > 2000 ? 1.5 : 2.5) + (n > 2000 ? 4 : 7) * Math.sqrt((deg?.[ni[v]] || 0) / mx);
  const edgeA = data.src.length > 20000 ? 0.06 : data.src.length > 3000 ? 0.12 : 0.25;
  const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const lines = [];
  for (let e = 0; e < data.src.length; e++) lines.push(`<line x1="${X(data.src[e]).toFixed(1)}" y1="${Y(data.src[e]).toFixed(1)}" x2="${X(data.dst[e]).toFixed(1)}" y2="${Y(data.dst[e]).toFixed(1)}"/>`);
  const circles = [];
  for (let v = 0; v < n; v++) circles.push(`<circle cx="${X(v).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${r(v).toFixed(2)}" fill="${k ? sc.color(String(communities.membership[ni[v]])) : t.node}"/>`);
  const legend = k ? sc.entries.map((e, i) => `<g transform="translate(${pad},${H - pad + 18 - (sc.entries.length - i) * 16})"><circle r="5" cx="5" cy="-4" fill="${e.color}"/><text x="16" y="0">Community ${Number(e.value) + 1}</text></g>`).join('') : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Geist, system-ui, sans-serif" font-size="11">
<rect width="100%" height="100%" fill="${t.bgDeep}"/>
<g stroke="${t.edge}" stroke-opacity="${edgeA}" stroke-width="0.6">${lines.join('')}</g>
<g>${circles.join('')}</g>
<g fill="${t.text2}">${legend}</g>
<text x="${W - pad}" y="${H - 14}" text-anchor="end" fill="${t.muted}">${esc(ds.meta.name)} · ${fmtInt(n)} people, ${fmtInt(data.src.length)} ties · size: degree · Org Signal</text>
</svg>`;
}

function Project() {
  const state = useStore(s => s);
  const ref = useRef(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = () => {
    const ds = state.dataset;
    const head = JSON.stringify({ format: 'org-signal-project', version: 1, modelVersion: MODEL_VERSION, savedAt: new Date().toISOString(), name: ds.meta.name, settings: state.settings });
    const body = `${head.slice(0, -1)},"dataset":${toJSON(ds)}}`;
    const name = (ds.meta.name || 'project').replace(/[^\w.-]+/g, '-').toLowerCase();
    download(body, `${name}.orgsignal.json`, 'application/json');
  };
  const open = async (file) => {
    setErr(null); setBusy(true);
    try {
      const obj = fromJSON(await file.text());
      if (obj?.format !== 'org-signal-project' || !obj.dataset?.nodes) throw new Error('This is not an Org Signal project file.');
      if (obj.modelVersion > MODEL_VERSION) throw new Error(`This project was saved by a newer version of Org Signal (data model ${obj.modelVersion}).`);
      await store.actions.loadDataset(obj.dataset, { mode: 'replace' });
      if (obj.settings) await store.actions.rebuild({ ...store.get().settings, ...obj.settings });
      store.actions.notify('info', `Opened ${obj.name || 'project'}.`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return html`<section class="section" aria-labelledby="proj-h">
    <h2 id="proj-h" class="section__title">Project file</h2>
    <p class="small text2" style="margin-bottom:.6rem">Saves the combined data (after identity merges and joins) and the construction settings to one file on your computer. Opening it restores the same network and measures. The file contains everything imported, including message text; store it as carefully as the original exports.</p>
    <div class="row">
      <button class="btn btn--primary" onClick=${save} disabled=${!state.dataset}>Save project</button>
      <button class="btn" onClick=${() => ref.current.click()} disabled=${busy}>Open a project</button>
      <input type="file" accept=".json,application/json" hidden ref=${ref} onChange=${e => { const f = e.currentTarget.files[0]; if (f) open(f); e.currentTarget.value = ''; }} />
    </div>
    <${ErrorLine} error=${err} />
  </section>`;
}
