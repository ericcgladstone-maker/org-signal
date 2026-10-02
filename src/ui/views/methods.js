// Methods and Export view: the deterministic methods appendix (no LLM),
// network files for other tools, figures, a print-friendly summary report,
// and saving or opening an Org Signal project file. Everything is produced
// on this device.

import { html, useState, useEffect, useRef } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { toJSON, fromJSON, MODEL_VERSION } from '../../core/model.js';
import { FORMATS, available, exportAs, fileBase } from '../services/exporters.js';
import { methodsAppendix } from '../services/llm.js';
import { gloss } from '../services/glossary.js';
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
    ${!ds && html`<${Project} />`}
  </div>`;
}

// Save a file and say so (D17): a download otherwise happens silently.
function save(text, filename, mime) {
  download(text, filename, mime);
  store.actions.notify('info', `Downloaded ${filename}.`);
}

// What the appendix describes: the construction actually used, the measures
// computed, and only the optional analyses that were run on this network
// (store.methodsLog, recorded by the engine adapter), with their own
// replicate counts.
export function appendixInput(state) {
  const { dataset, settings, network, metrics, communities } = state;
  const log = state.methodsLog || {};
  const approx = {};
  for (const [k, m] of Object.entries(metrics?.meta || {})) if (m?.approximate) approx[k] = m.method || 'approximate (sampled)';
  const attrs = groupableAttributes(dataset);
  const attributeLabels = Object.fromEntries(attrs.map(a => [a.key, a.label || a.key]));
  const groups = [...new Set([...(log.groups || []).map(g => g.attr), ...(log.nullModel || []).map(n => n.attr)].filter(a => a && a !== 'community'))];
  const content = {};
  if (log.affect?.length) content.affect = log.affect[log.affect.length - 1];
  if (log.keywords?.length) content.keywords = log.keywords[log.keywords.length - 1];
  if (log.topics?.length) content.topics = log.topics[log.topics.length - 1];
  return {
    dataset, settings,
    network: network ? { n: network.n, directed: network.directed, edges: { count: network.edgeCount }, summary: network.summary } : null,
    metrics: Object.keys(metrics?.node || {}),
    networkStats: Object.keys(metrics?.network || {}).filter(k => typeof metrics.network[k] === 'number'),
    approx,
    communities: communities ? { resolution: communities.resolution ?? 1, seed: communities.seed ?? 1, runs: 1 } : undefined,
    groups, attributeLabels,
    // The import report's short names, by source index (report.sources[i].id).
    sourceLabels: (dataset?.meta?.sources || []).map((_, i) => state.report?.sources?.find(x => x.id === i)?.label || null),
    nullModels: log.nullModel || [],
    resampling: (log.resampling || []).map(r => ({ ...r, scheme: 'events resampled with replacement' })),
    time: (log.time || []).map(t => ({ window: t.window, metrics: t.metrics })),
    content: Object.keys(content).length ? content : undefined,
    software: { name: 'Org Signal', version: '2' },
  };
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

function Loaded({ ds }) {
  const state = useStore(s => s);
  const [md, setMd] = useState(null);
  const [err, setErr] = useState(null);
  const [avail, setAvail] = useState(null);
  const [busy, setBusy] = useState(null);
  const logKey = JSON.stringify(state.methodsLog || {});
  useEffect(() => {
    let live = true;
    methodsAppendix(appendixInput(state)).then(m => live && setMd(m ?? false), e => live && setErr(e));
    return () => { live = false; };
  }, [state.network?.version, logKey]);
  useEffect(() => { available().then(setAvail); }, []);
  const base = fileBase(ds);

  const doExport = async (id) => {
    setBusy(id);
    try {
      const r = await exportAs(id, { ds, settings: state.settings, nodeMetrics: state.metrics?.node, communities: state.communities });
      save(r.text, r.filename, r.mime);
    } catch (e) { store.actions.notify('error', e.message); } finally { setBusy(null); }
  };
  const figure = async () => {
    const data = cachedRender(state.network.version) || await getRender(state.network.version);
    save(staticNetworkSVG(ds, data, state.communities, state.metrics), `${base}-figure.svg`, 'image/svg+xml');
  };
  const summary = () => {
    const doc = markdownToHTMLDocument(summaryMarkdown(state, md || ''), `${ds.meta.name}: network summary`);
    save(doc, `${base}-summary.html`, 'text/html');
  };
  const copy = async () => {
    const ok = await copyText(md);
    store.actions.notify(ok ? 'info' : 'warn', ok ? 'Methods appendix copied as Markdown.' : 'This browser did not allow copying. Download the Markdown instead.');
  };

  return html`
    <section class="section" style="border-top:0" aria-labelledby="exp-h">
      <h2 id="exp-h" class="section__title">Network files</h2>
      <p class="small text2" style="margin-bottom:.6rem">The network as currently constructed, with attributes, measures and communities. Ids are the dataset's person keys, so files can be joined back.</p>
      <div class="table-wrap"><table class="tbl tbl--files">
        <tbody>${FORMATS.map(f => html`<tr>
          <td class="name">${f.label}</td>
          <td class="small">${f.note}</td>
          <td class="num">${avail && !avail[f.id] ? html`<${Flag} level="na">Not available yet</${Flag}>` : html`<button type="button" class="tlink tlink--down" onClick=${() => doExport(f.id)} disabled=${busy === f.id || !avail} aria-label=${`Download ${f.label}`}>${busy === f.id ? 'Preparing' : `.${f.ext}`}</button>`}</td>
        </tr>`)}</tbody>
      </table></div>
    </section>
    <section class="section" aria-labelledby="fig-h">
      <h2 id="fig-h" class="section__title">Figures and summary</h2>
      <div class="tlinks">
        <button type="button" class="tlink tlink--down" onClick=${figure}>Network figure, colored by community (SVG)</button>
        <button type="button" class="tlink tlink--down" onClick=${summary} disabled=${md === null}>Summary report (HTML, prints to PDF)</button>
        <a class="tlink tlink--arrow" href="#network" onClick=${e => { e.preventDefault(); store.actions.setView('network'); }}>The current network view as SVG or PNG</a>
      </div>
      <p class="basis">The summary report contains the data description, whole-network measures with their meanings, the most central people with applicability notes, and the methods appendix. No language model is involved.</p>
    </section>
    <${Project} />
    <section class="section" aria-labelledby="meth-h">
      <h2 id="meth-h" class="section__title">Methods appendix</h2>
      <p class="small text2" style="margin-bottom:.7rem">Written deterministically from the sources, construction settings and measures in use, and from the analyses run on this network so far (open Groups, Time or Content first to include them). Copy it into a paper or report and edit as needed.</p>
      ${md && html`<div class="tlinks" style="margin-bottom:1.25rem">
        <button type="button" class="tlink" onClick=${copy}>Copy appendix</button>
        <button type="button" class="tlink tlink--down" onClick=${() => save(md, `${base}-methods.md`, 'text/markdown')}>Markdown</button>
        <button type="button" class="tlink tlink--down" onClick=${() => save(markdownToHTMLDocument(md, 'Methods appendix'), `${base}-methods.html`, 'text/html')}>HTML</button>
      </div>`}
      <${ErrorLine} error=${err} />
      ${md === null && !err && html`<${Loading}>Writing the appendix</${Loading}>`}
      ${md === false && html`<${Unavailable}>The methods appendix (src/llm/methods.js) is not available in this build.</${Unavailable}>`}
      ${md && renderMarkdown(md.replace(/^# [^\n]*\n+/, ''), { shift: 1 })}
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
  L.push(`${fmtInt(ds.nodes.count)} people and ${fmtInt(ds.events.count)} events from ${ds.meta.sources.length} ${ds.meta.sources.length === 1 ? 'source' : 'sources'}${t?.timeRange ? `, ${fmtRange(t.timeRange.start, t.timeRange.end)}` : ''}. The network has ${fmtInt(network.n)} people and ${fmtInt(network.edgeCount)} ${network.directed ? 'directed' : 'undirected'} ties.`, '');
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
  // Rank intervals from the People view's stability check, when it was run on this network.
  const stab = state.stability?.version === network.version ? state.stability.byMetric || {} : {};
  const anyStab = ['degree', 'betweenness'].some(m => stab[m]);
  L.push('', '## Most central people', '', anyStab ? 'Ranks are descriptive. Where shown, the rank interval comes from resampling events and rebuilding the network; a wide interval means the rank is not a finding.' : 'Ranks are descriptive. Check rank intervals (People view, "Check stability of this ranking") before treating a ranking as a finding.', '');
  for (const m of ['degree', 'betweenness']) {
    if (ap[m]?.level === 'na') { L.push(`- ${gloss(m).label}: not applicable here. ${applicabilityReason(ap[m])}`); continue; }
    const top = topBy(state, m, 8);
    if (!top.length) continue;
    const iv = x => { const r = stab[m]?.map?.get(x.i); return r && Number.isFinite(r.lo) ? `; rank ${r.lo}-${r.hi}${Number.isFinite(r.topShare) ? `, top ${stab[m].top} in ${Math.round(r.topShare * 100)}% of ${stab[m].reps} resamples` : ''}` : ''; };
    L.push(`- **${gloss(m).label}** (${gloss(m).meaning}) ${top.map(x => `${nodeLabel(ds, x.i)} (${fmtNum(x.value)}${iv(x)})`).join(', ')}.${ap[m]?.level === 'caution' ? ` Caution: ${applicabilityReason(ap[m])}` : ''}`);
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
  const saveProject = () => {
    const ds = state.dataset;
    const head = JSON.stringify({ format: 'org-signal-project', version: 1, modelVersion: MODEL_VERSION, savedAt: new Date().toISOString(), name: ds.meta.name, settings: state.settings });
    const body = `${head.slice(0, -1)},"dataset":${toJSON(ds)}}`;
    save(body, `${fileBase(ds, 'project')}.orgsignal.json`, 'application/json');
  };
  const open = async (file) => {
    setErr(null); setBusy(true);
    try {
      const obj = fromJSON(await file.text());
      if (obj?.format !== 'org-signal-project' || !obj.dataset?.nodes) throw new Error('This is not an Org Signal project file.');
      if (obj.modelVersion > MODEL_VERSION) throw new Error(`This project was saved by a newer version of Org Signal (data model ${obj.modelVersion}).`);
      await store.actions.loadDataset(obj.dataset, { mode: 'replace' });
      if (obj.settings) await store.actions.rebuild({ ...store.get().settings, ...obj.settings }, { quiet: true });
      store.actions.notify('info', `Opened ${obj.name || 'project'}.`);
      store.actions.focus('#proj-h');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return html`<section class="section" aria-labelledby="proj-h">
    <h2 id="proj-h" class="section__title" tabindex="-1">Project file</h2>
    <p class="small text2" style="margin-bottom:.9rem">Nothing is stored in the browser: closing this tab erases the loaded data and results. A project file saves the combined data (after identity merges and joins) and the construction settings to your computer, and opening it restores the same network and measures. It contains everything imported, including message text; store it as carefully as the original exports.</p>
    <div class="tlinks">
      ${state.dataset && html`<button type="button" class="btn btn--primary" onClick=${saveProject}>Save project</button>`}
      <button type="button" class="tlink" onClick=${() => ref.current.click()} disabled=${busy}>${busy ? 'Opening' : 'Open a project'}</button>
      <input type="file" accept=".json,application/json" hidden ref=${ref} onChange=${e => { const f = e.currentTarget.files[0]; if (f) open(f); e.currentTarget.value = ''; }} />
    </div>
    <${ErrorLine} error=${err} />
  </section>`;
}
