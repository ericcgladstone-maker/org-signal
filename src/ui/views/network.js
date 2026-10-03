// Network view: sigma.js (WebGL) over positions from the engine.
//
// Color by community, any categorical attribute, or a metric (sequential);
// size by a metric; filter ties by construction rule and visibility layer;
// search; hover and click to select with neighborhood highlight; click a tie
// (or pick one from the selected person's list) to see the events that
// created it; export the current view as SVG or PNG (drawn from positions,
// not a screenshot of the canvas).
//
// Figure style (design rules): solid mint-family ties, a ring of the canvas
// ground around every person so dense clusters stay separable, 12px labels
// with a halo, placed by our own pass that skips any label that would collide
// with another or run off the canvas, and community numbers or group names
// at each cluster so groups never rely on color alone.
//
// Groups (communities or an attribute) take the eight hues in fixed order.
// Past eight the map is in highlight mode (lib/grouping.js): the rest share
// "Other groups", the legend lists every group, and choosing one lights it
// up in the accent.

import { html, useState, useEffect, useRef, useMemo, useCallback } from '../../../vendor/preact.js';
import { Sigma, NodeCircleProgram } from '../../../vendor/sigma.js';
import { Graph } from '../../../vendor/graphology.js';
import { store, useStore } from '../store.js';
import { engine } from '../services/engine.js';
import { gloss } from '../services/glossary.js';
import { ViewHead, NeedsData, Loading, ErrorLine, Select, MetricName, Flag, Swatch, ConstructionButton, useEngine, download, Icon } from '../components/common.js';
import { RampLegend } from '../components/charts.js';
import { sequentialScale, tokens, dim, mixTo } from '../lib/palette.js';
import { preferredAttributes, isBookkeeping, orderedValues, defaultGroupAttr, label as nodeLabel, RULE_LABEL, VISIBILITY_LABEL } from '../lib/dsutil.js';
import { groupColoring, groupLabelMin, OTHER, MISSING } from '../lib/grouping.js';
import { fmtNum, fmtInt, fmtDateTime, fmtP, fmtAttr, humanize, plural } from '../lib/format.js';
import { withContacts, metricLabel, displayKey, isDeactivated } from '../lib/measures.js';
import { communityScale } from '../lib/communities.js';
import { orientLayout, labelBudget, overlaps, groupAnchors } from '../lib/labels.js';
import { VISIBILITY } from '../../core/model.js';
import { cachedRender, getRender, clearRender, tiesOf } from '../lib/render-cache.js';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const dur = ms => (reducedMotion() ? 0 : ms);
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const narrow = () => typeof innerWidth === 'number' && innerWidth <= 1060;

// Display choices survive switching views (not reloads); reset per dataset.
let prefs = { ds: null };

// Open Generate at its recovery panel rather than at the top of the form.
function openRecovery() {
  store.actions.setView('generate');
  let tries = 0;
  const go = () => {
    const el = document.getElementById('ob-rec-title');
    if (el) { el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
    else if (++tries < 40) setTimeout(go, 50);
  };
  setTimeout(go, 0);
}

export function NetworkView() {
  const ds = useStore(s => s.dataset);
  const net = useStore(s => s.network);
  if (!ds || !net) return html`<${NeedsData} title="Network" />`;
  return html`<${NetworkInner} ds=${ds} net=${net} />`;
}

function useRender(net) {
  const [state, setState] = useState(() => { const d = cachedRender(net.version); return d ? { data: d } : { loading: true }; });
  useEffect(() => {
    const d = cachedRender(net.version);
    if (d) { setState({ data: d }); return; }
    let live = true;
    setState({ loading: true });
    getRender(net.version).then(data => { if (live) setState({ data }); },
      error => { if (live) setState({ error: error.name === 'AbortError' ? new Error('Layout cancelled.') : error }); });
    return () => { live = false; };
  }, [net.version]);
  return state;
}

// The hand layout a drawn network carries (ds.meta.positions, by dataset
// index), when it still matches the dataset.
function drawnPositions(ds) {
  const p = ds.meta?.positions;
  return Array.isArray(p) && p.length === ds.nodes.count ? p : null;
}

// The same default as People and Groups (defaultGroupAttr): a coarse
// department-like attribute, else the communities.
function defaultColor(ds, communities, attrs) {
  const key = defaultGroupAttr(ds, { communities });
  if (key && attrs.some(a => a.key === key)) return `attr:${key}`;
  if (communities) return 'community';
  const plain = attrs.filter(x => !isBookkeeping(x));
  const a = plain.find(x => (x.values?.length ?? 0) <= 8) || plain[0];
  return a ? `attr:${a.key}` : 'none';
}

function NetworkInner({ ds, net }) {
  const r = useRender(net);
  const rawMetrics = useStore(s => s.metrics);
  const communities = useStore(s => s.communities);
  const applicability = useStore(s => s.applicability);
  const selection = useStore(s => s.selection);
  const attrs = useMemo(() => preferredAttributes(ds), [ds]);
  const nodeMetrics = useMemo(() => withContacts(rawMetrics?.node, net.directed), [rawMetrics, net.directed]);
  const positions = drawnPositions(ds);
  if (prefs.ds !== ds) prefs = { ds, colorBy: defaultColor(ds, communities, attrs), sizeBy: 'contacts', layout: positions ? 'drawn' : 'force' };
  const [colorBy, setColorBy0] = useState(prefs.colorBy);
  const [sizeBy, setSizeBy0] = useState(prefs.sizeBy);
  const [layout, setLayout0] = useState(prefs.layout);
  const setColorBy = v => { prefs.colorBy = v; setColorBy0(v); };
  const setSizeBy = v => { prefs.sizeBy = v; setSizeBy0(v); };
  const setLayout = v => { prefs.layout = v; setLayout0(v); };
  const [rulesOff, setRulesOff] = useState(new Set());
  const [visOff, setVisOff] = useState(new Set());
  // The legend row chosen (click or Enter) and the one under the pointer or
  // keyboard focus; the second previews over the first.
  const [pinCat, setPinCat] = useState(null);
  const [hoverCat, setHoverCat] = useState(null);
  const focusCat = hoverCat ?? pinCat;
  const [edgeSel, setEdgeSel] = useState(null); // { a, b } dataset indices
  const sigmaRef = useRef(null);
  const sideRef = useRef(null);

  const nodeMetricKeys = Object.keys(nodeMetrics || {}).filter(k => applicability?.[k]?.level !== 'na');
  const mlabel = k => metricLabel(k, net.directed);

  // Color assignment, decided over the whole network so filters never repaint.
  const coloring = useMemo(() => {
    const t = tokens();
    if (!r.data) return null;
    const ids = r.data.nodeIds;
    const ni = r.data.netIndex;
    if (colorBy === 'community' && communities?.membership) {
      const k = communities.count ?? 0;
      const sizes = communities.sizes || Array.from({ length: k }, (_, i) => communities.membership.filter(m => m === i).length);
      const key = v => String(communities.membership[ni[v]]);
      const gc = groupColoring(Array.from({ length: k }, (_, c) => ({ value: String(c), label: `Community ${c + 1}`, count: sizes[c] })));
      return { kind: 'cat', community: true, gc, of: v => gc.color(key(v)), key, title: 'Community (found by Louvain)' };
    }
    if (colorBy.startsWith('attr:')) {
      const key = colorBy.slice(5);
      const ov = orderedValues(ds, key);
      const a = attrs.find(x => x.key === key);
      // Color order comes from the whole dataset (so colors never shift); the
      // counts shown are the people actually in this network, so an excluded
      // bot or filtered-out person is not listed as "Not recorded".
      const members = net.nodeIds || ids;
      const inNet = new Map();
      let missing = 0;
      for (const d of members) {
        const x = ds.nodes.attrs[d]?.[key];
        if (x == null || x === '') missing++; else inNet.set(String(x), (inNet.get(String(x)) || 0) + 1);
      }
      const gc = groupColoring(ov.map(o => ({ value: o.value, label: fmtAttr(key, o.value), count: inNet.get(String(o.value)) || 0 })), { missing });
      const keyOf = v => { const x = ds.nodes.attrs[ids[v]][key]; return x == null || x === '' ? '' : String(x); };
      return { kind: 'cat', gc, of: v => gc.color(keyOf(v)), key: keyOf, title: a?.label || humanize(key) };
    }
    if (colorBy.startsWith('metric:')) {
      const m = colorBy.slice(7);
      const arr = nodeMetrics?.[m];
      if (!arr) return null;
      const fin = Array.from(arr).filter(Number.isFinite);
      const sc = sequentialScale(Math.min(...fin), Math.max(...fin));
      return { kind: 'seq', of: v => sc(arr[ni[v]]), scale: sc, title: mlabel(m), metric: m };
    }
    return { kind: 'none', of: () => t.node, title: null };
  }, [r.data, colorBy, communities, nodeMetrics, ds]);

  const sizes = useMemo(() => {
    if (!r.data) return null;
    const n = r.data.x.length;
    const arr = sizeBy !== 'none' ? nodeMetrics?.[sizeBy] : null;
    const base = n > 2000 ? 1.6 : n > 500 ? 2.4 : 3.5;
    const span = n > 2000 ? 5 : n > 500 ? 7 : 9;
    const out = new Float32Array(n).fill(base + span * 0.25);
    if (arr) {
      const ni = r.data.netIndex;
      let mx = 0; for (let i = 0; i < n; i++) { const x = arr[ni[i]]; if (Number.isFinite(x) && x > mx) mx = x; }
      for (let i = 0; i < n; i++) { const x = arr[ni[i]]; out[i] = base + span * Math.sqrt(Math.max(0, Number.isFinite(x) ? x : 0) / (mx || 1)); }
    }
    return out;
  }, [r.data, sizeBy, nodeMetrics]);

  const rulesPresent = useMemo(() => (r.data ? Object.keys(r.data.byRule || {}).filter(k => r.data.byRule[k]?.some?.(x => x > 0)) : []), [r.data]);
  const visPresent = useMemo(() => {
    if (!r.data?.layerMask) return [];
    let any = 0; for (const m of r.data.layerMask) any |= m;
    return VISIBILITY.filter((_, i) => any & (1 << i));
  }, [r.data]);

  const selectNode = useCallback((dsIdx, additive = false) => {
    setEdgeSel(null);
    if (dsIdx == null) { store.actions.select([]); return; }
    const cur = store.get().selection;
    store.actions.select(additive ? (cur.includes(dsIdx) ? cur.filter(x => x !== dsIdx) : [...cur, dsIdx]) : [dsIdx]);
  }, []);
  const showDetails = () => sideRef.current?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });

  if (r.error) return html`<div class="view"><${ViewHead} title="Network" /><${ErrorLine} error=${r.error} onRetry=${() => { clearRender(); store.set({ network: { ...net, version: Date.now() } }); }} /></div>`;

  const plainAttrs = attrs.filter(a => !isBookkeeping(a));
  const bookAttrs = attrs.filter(a => isBookkeeping(a));
  const colorOptions = [
    { value: 'none', label: 'Single color' },
    ...(communities ? [{ value: 'community', label: `Community (${communities.count})` }] : []),
    ...(plainAttrs.length ? [{ group: 'Attributes', options: plainAttrs.map(a => ({ value: `attr:${a.key}`, label: `${a.label} (${a.values.length})` })) }] : []),
    { group: 'Measure (low to high)', options: nodeMetricKeys.map(k => ({ value: `metric:${k}`, label: mlabel(k) })) },
    ...(bookAttrs.length ? [{ group: 'Data-collection fields', options: bookAttrs.map(a => ({ value: `attr:${a.key}`, label: `${a.label} (${a.values.length})` })) }] : []),
  ];
  const sizeOptions = [{ value: 'none', label: 'Same size' }, ...nodeMetricKeys.map(k => ({ value: k, label: mlabel(k) }))];
  const sel = selection[selection.length - 1];
  const touch = coarse();

  return html`<div class="view">
    <${ViewHead} title="Network" intro=${`${fmtInt(net.n)} people and ${fmtInt(net.edgeCount)} ties${net.directed ? ' (directed: a two-way tie counts as two)' : ''}. ${touch ? 'Tap' : 'Click'} a person to see their neighborhood, or a tie to see the events behind it.`}
      actions=${html`<div class="tlinks"><${ConstructionButton} /><${ExportMenu} sigmaRef=${sigmaRef} data=${r.data} coloring=${coloring} ds=${ds} /></div>`} />
    <${RecoveryBanner} ds=${ds} />
    <div class="toolbar" role="group" aria-label="Network display">
      <${Select} label="Color by" value=${colorBy} onChange=${v => { setColorBy(v); setPinCat(null); setHoverCat(null); }} options=${colorOptions} />
      <${Select} label="Size by" value=${sizeBy} onChange=${setSizeBy} options=${sizeOptions} />
      ${positions && html`<${Select} label="Layout" value=${layout} onChange=${setLayout} options=${[{ value: 'drawn', label: 'As drawn' }, { value: 'force', label: 'Force-directed' }]} />`}
      <${Search} ds=${ds} ids=${r.data?.nodeIds} onPick=${(i) => { selectNode(i); sigmaRef.current?.focusNode(i); }} />
    </div>
    <div class="split">
      <div class="split__main">
        ${r.loading || !r.data ? html`<div class="net"><div class="net__empty"><${Loading}>Computing layout</${Loading}></div></div>`
          : html`<${SigmaCanvas} ref_=${sigmaRef} data=${r.data} ds=${ds} coloring=${coloring} sizes=${sizes} selection=${selection} focusCat=${focusCat}
              rulesOff=${rulesOff} visOff=${visOff} edgeSel=${edgeSel} onNode=${selectNode} onEdge=${setEdgeSel}
              positions=${layout === 'drawn' ? positions : null} />`}
        ${selection.length > 0 && html`<div class="net-selbar" aria-live="polite">
          <span class="grow"><strong>${nodeLabel(ds, sel)}</strong>${selection.length > 1 ? html` <span class="muted">and ${selection.length - 1} more</span>` : ''}</span>
          <button type="button" class="tlink tlink--down" onClick=${showDetails}>Details</button>
          <button type="button" class="tlink tlink--quiet" onClick=${() => store.actions.select([])}>Clear</button>
        </div>`}
        ${r.data?.truncated && (r.data.truncated.nodes || r.data.truncated.edges) ? html`<p class="small" style="margin-top:.5rem"><${Flag} level="info">Drawing simplified</${Flag}> <span class="text2">${r.data.truncated.nodes ? `${fmtInt(r.data.truncated.nodes)} least connected people` : ''}${r.data.truncated.nodes && r.data.truncated.edges ? ' and ' : ''}${r.data.truncated.edges ? `${fmtInt(r.data.truncated.edges)} weakest ties` : ''} are not drawn. Every measure still uses the full network.</span></p>` : ''}
        <p class="basis" style="margin-top:.5rem">${layout === 'drawn' && positions ? 'Positions: as drawn in Build.' : 'Positions: force-directed layout from the engine. Distance on screen is approximate; read structure from the measures, not the picture.'}
          ${touch ? ' Tap a person to select them, tap empty space to clear. Move or zoom the map with two fingers; one finger scrolls the page.'
            : ' Click a person to select them; Shift-click adds people. Keys on the map: arrows move it, plus and minus zoom, 0 fits, Escape clears the selection.'}</p>
      </div>
      <aside class="split__side" aria-label="Details" ref=${sideRef}>
        <div class="section net-legend">
          <${Legend} coloring=${coloring} pinCat=${pinCat} setPinCat=${setPinCat} setHoverCat=${setHoverCat} sizeBy=${sizeBy} directed=${net.directed} />
        </div>
        <div class="section">
          ${edgeSel ? html`<${Evidence} ds=${ds} a=${edgeSel.a} b=${edgeSel.b} onClose=${() => setEdgeSel(null)} />`
            : selection.length ? html`<${SelectionPanel} ds=${ds} selection=${selection} data=${r.data} metrics=${nodeMetrics} onEdge=${setEdgeSel} />`
            : html`<${NetworkSummary} />`}
        </div>
        ${(rulesPresent.length > 1 || visPresent.length > 1) && html`<div class="section stack">
          <h2 class="label" style="margin:0">Show ties</h2>
          ${rulesPresent.length > 1 && html`<${Filter} label="From these rules" items=${rulesPresent} names=${RULE_LABEL} off=${rulesOff} setOff=${setRulesOff} />`}
          ${visPresent.length > 1 && html`<${Filter} label="In these layers" items=${visPresent} names=${VISIBILITY_LABEL} off=${visOff} setOff=${setVisOff} />`}
          <p class="basis">Hides ties on the map only. To change what counts as a tie in the measures, use the construction settings.</p>
        </div>`}
      </aside>
    </div>
  </div>`;
}

// Decision 6: whenever the loaded data is the generated world, say so and
// point to the recovery check, which lives in Generate.
function RecoveryBanner({ ds }) {
  const gen = useStore(s => s.generated);
  if (!gen || !(gen.dataset === ds || (gen.datasetName && gen.datasetName === ds.meta?.name))) return null;
  const rec = gen.recovery;
  return html`<div class="net-banner" role="note">
    <${Flag} level="info">Generated</${Flag}>
    <span class="grow">${rec?.summary ? `Recovery check: ${rec.summary}` : 'This network was generated with planted structure. The recovery check compares what the analysis finds with what was planted.'}</span>
    <button type="button" class="tlink tlink--arrow" onClick=${openRecovery}>${rec ? 'Full recovery check' : 'Run the recovery check'}</button>
  </div>`;
}

function Filter({ label, items, names = {}, off, setOff }) {
  return html`<fieldset class="field" style="border:0;padding:0;margin:0;min-width:0">
    <legend class="field__label" style="padding:0;margin-bottom:.3rem">${label}</legend>
    <div class="row" style="gap:.15rem .8rem">
      ${items.map(it => html`<label class="check"><input type="checkbox" checked=${!off.has(it)} onChange=${e => { const n = new Set(off); if (e.currentTarget.checked) n.delete(it); else n.add(it); setOff(n); }} />${names[it] || humanize(it)}</label>`)}
    </div>
  </fieldset>`;
}

function Search({ ds, ids, onPick }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => {
    if (!q.trim() || !ids) return [];
    const s = q.trim().toLowerCase();
    const out = [];
    for (let v = 0; v < ids.length && out.length < 8; v++) {
      const i = ids[v];
      if ((ds.nodes.labels[i] || '').toLowerCase().includes(s) || ds.nodes.keys[i].toLowerCase().includes(s)) out.push(i);
    }
    return out;
  }, [q, ids]);
  const pick = (i) => { onPick(i); setQ(ds.nodes.labels[i]); setOpen(false); };
  return html`<div class="field field--grow" style="position:relative">
    <label for="net-search" class="field__label">Find a person</label>
    <input id="net-search" class="input" type="search" role="combobox" aria-expanded=${String(open && results.length > 0)} aria-controls="net-search-list" aria-autocomplete="list"
      aria-activedescendant=${open && results[active] != null ? `ns-${results[active]}` : undefined}
      placeholder="Name or id" value=${q} onInput=${e => { setQ(e.currentTarget.value); setOpen(true); setActive(0); }}
      onKeyDown=${e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
        else if (e.key === 'Enter' && results[active] != null) { e.preventDefault(); pick(results[active]); }
        else if (e.key === 'Escape') setOpen(false);
      }} onBlur=${() => setTimeout(() => setOpen(false), 150)} />
    ${open && results.length > 0 && html`<ul id="net-search-list" role="listbox" class="net-search__list">
      ${results.map((i, k) => { const key = displayKey(ds.nodes.keys[i]); return html`<li id=${`ns-${i}`} role="option" aria-selected=${String(k === active)} class=${k === active ? 'is-active' : ''} onMouseDown=${e => { e.preventDefault(); pick(i); }}>${ds.nodes.labels[i]}${key ? html` <span class="meta">${key}</span>` : ''}</li>`; })}
    </ul>`}
  </div>`;
}

// ---- sigma canvas -----------------------------------------------------------------

// Node discs with a thin ring of the canvas ground, so touching people in a
// dense cluster stay separate shapes (sigma's own circle program has no
// border). The triangle that carries each disc is grown by 2px so the ring
// sits outside the disc and the visible size of a node is unchanged.
function borderedNodeProgram(ringHex) {
  const c = ringHex.replace('#', '');
  const rgb = [0, 2, 4].map(i => (parseInt(c.slice(i, i + 2), 16) / 255).toFixed(4));
  const FRAG = `
precision highp float;
varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
uniform float u_correctionRatio;
const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);
const vec4 ring = vec4(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 1.0);
void main(void) {
  float px = u_correctionRatio * 2.0;
  float dist = length(v_diffVector) - v_radius;
  #ifdef PICKING_MODE
  if (dist > 0.0) gl_FragColor = transparent; else gl_FragColor = v_color;
  #else
  vec4 c = mix(v_color, ring, smoothstep(-0.5 * px, 0.5 * px, dist));
  float outer = 1.5 * px;
  gl_FragColor = mix(c, transparent, smoothstep(outer - 0.5 * px, outer + 0.5 * px, dist));
  #endif
}
`;
  return class BorderedNodeProgram extends NodeCircleProgram {
    getDefinition() {
      const d = super.getDefinition();
      const sizeLine = 'float size = a_size * u_correctionRatio / u_sizeRatio * 4.0;';
      const radiusLine = 'v_radius = size / 2.0;';
      // Fall back to plain discs if a sigma update changes the shader text.
      if (!d.VERTEX_SHADER_SOURCE.includes(sizeLine) || !d.VERTEX_SHADER_SOURCE.includes(radiusLine)) return d;
      return {
        ...d,
        VERTEX_SHADER_SOURCE: d.VERTEX_SHADER_SOURCE
          .replace(sizeLine, 'float size = (a_size / u_sizeRatio + 2.0) * u_correctionRatio * 4.0;')
          .replace(radiusLine, 'v_radius = a_size / u_sizeRatio * u_correctionRatio * 2.0;'),
        FRAGMENT_SHADER_SOURCE: FRAG,
      };
    }
  };
}

const LABEL_FONT = 'Geist Variable, Geist, system-ui, sans-serif';

function drawHover(ctx, data, settings) {
  // Dark label box for hover, in place of sigma's default white one; flips
  // to the left of the node near the right edge so it never leaves the map.
  const size = settings.labelSize;
  ctx.font = `600 ${size}px ${LABEL_FONT}`;
  const label = data.label || '';
  const w = ctx.measureText(label).width + 12;
  const W = ctx.canvas.clientWidth || ctx.canvas.width;
  let x = data.x + data.size + 4;
  if (x + w > W - 4) x = Math.max(4, data.x - data.size - 4 - w);
  const y = data.y - size / 2 - 5;
  ctx.fillStyle = 'rgba(5,21,33,0.94)';
  ctx.strokeStyle = 'rgba(255,255,255,0.26)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.rect(x, y, w, size + 10); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(data.x, data.y, data.size + 2, 0, Math.PI * 2); ctx.strokeStyle = '#F6FAFD'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#F6FAFD';
  ctx.fillText(label, x + 6, data.y + size / 3);
}

function SigmaCanvas({ ref_, data, ds, coloring, sizes, selection, focusCat, rulesOff, visOff, edgeSel, onNode, onEdge, positions }) {
  const box = useRef(null);
  const outer = useRef(null);
  const sig = useRef(null);
  const graph = useRef(null);
  const state = useRef({});
  state.current = { coloring, sizes, selection, focusCat, rulesOff, visOff, edgeSel };
  const focus = useRef({ set: null, core: null });
  const [hovered, setHovered] = useState(null);
  const hoverRef = useRef(null);
  hoverRef.current = hovered;

  // Build the graph once per layout.
  useEffect(() => {
    const t = tokens();
    const g = new Graph({ type: data.directed ? 'directed' : 'undirected', multi: false, allowSelfLoops: false });
    const n = data.x.length;
    let X = data.x, Y = data.y;
    if (positions) {
      X = Float32Array.from(data.nodeIds, i => positions[i]?.[0] ?? 0);
      Y = Float32Array.from(data.nodeIds, i => positions[i]?.[1] ?? 0);
    } else {
      const rect = box.current.getBoundingClientRect();
      ({ x: X, y: Y } = orientLayout(data.x, data.y, rect.width >= rect.height));
    }
    for (let v = 0; v < n; v++) {
      const i = data.nodeIds[v];
      g.addNode(String(v), { x: X[v], y: -Y[v], size: 3, color: t.node, label: ds.nodes.labels[i] || ds.nodes.keys[i], ds: i });
    }
    const m = data.src.length;
    const maxW = Math.max(1e-9, ...Array.from(data.w || []).slice(0, 200000));
    for (let k = 0; k < m; k++) {
      const a = String(data.src[k]), b = String(data.dst[k]);
      if (a === b || g.hasEdge(a, b)) continue;
      const w = data.w ? data.w[k] : 1;
      g.addEdgeWithKey(String(k), a, b, { size: 0.4 + 1.6 * Math.sqrt(w / maxW), k });
    }
    graph.current = g;
    // Solid colors mixed toward the canvas ground instead of alpha: WebGL
    // blending of thousands of translucent lines washes out to near-white.
    // Up to a few thousand ties the lines stay in the mint family.
    const edgeMix = m > 20000 ? 0.86 : m > 3000 ? 0.78 : 0.55;
    const edgeBase = mixTo(t.edge, t.bgDeep, edgeMix);
    const edgeHi = mixTo('#A8E4D2', t.bgDeep, 0.15);
    const renderer = new Sigma(g, box.current, {
      // Labels are placed by drawLabels() below (halo, collision culling,
      // canvas edges); sigma draws only the hover box.
      renderLabels: false,
      labelFont: LABEL_FONT,
      labelSize: 12,
      labelWeight: '500',
      defaultEdgeType: 'line',
      defaultEdgeColor: edgeBase,
      defaultNodeType: 'circle',
      nodeProgramClasses: { circle: borderedNodeProgram(t.bgDeep) },
      enableEdgeEvents: m < 60000,
      hideEdgesOnMove: m > 30000,
      zIndex: true,
      minCameraRatio: 0.03,
      maxCameraRatio: 8,
      stagePadding: 28,
      // The container can be momentarily zero-width while views switch; the
      // ResizeObserver below refits it once it has a size.
      allowInvalidContainer: true,
      defaultDrawNodeHover: drawHover,
      nodeReducer: (key, attr) => {
        const s = state.current;
        const v = +key;
        const res = { ...attr };
        res.color = s.coloring ? s.coloring.of(v) : attr.color;
        res.size = s.sizes ? s.sizes[v] : attr.size;
        const sel = s.selection;
        const hv = hoverRef.current;
        const focusSet = focus.current.set;
        if (focusSet) {
          if (!focusSet.has(v)) { res.color = dim(res.color, 0.82); res.dimmed = true; res.zIndex = 0; }
          else { res.zIndex = 2; if (sel.includes(attr.ds)) { res.highlighted = true; res.forceLabel = true; } }
        } else if (s.focusCat != null && s.coloring?.gc) {
          // Highlight mode lights the chosen group in the accent (it may be
          // one of the gray "Other groups"); otherwise it keeps its own hue.
          const many = s.coloring.gc.many;
          if (!s.coloring.gc.matches(s.coloring.key(v), s.focusCat)) { res.color = dim(res.color, many ? 0.88 : 0.8); res.dimmed = true; res.zIndex = 0; }
          else { res.zIndex = 2; if (many) res.color = t.accent; }
        }
        if (hv === key) res.highlighted = true;
        return res;
      },
      edgeReducer: (key, attr) => {
        const s = state.current;
        const k = attr.k;
        const res = { ...attr, color: edgeBase };
        if (s.rulesOff.size && data.byRule) {
          let any = false;
          for (const r in data.byRule) if (!s.rulesOff.has(r) && data.byRule[r][k] > 0) { any = true; break; }
          if (!any) { res.hidden = true; return res; }
        }
        if (s.visOff.size && data.layerMask) {
          let mask = 0; VISIBILITY.forEach((v, i) => { if (!s.visOff.has(v)) mask |= 1 << i; });
          if (!(data.layerMask[k] & mask)) { res.hidden = true; return res; }
        }
        const focusSet = focus.current.set;
        if (focusSet) {
          const [a, b] = g.extremities(key);
          const sel = focus.current.core;
          if (sel.has(+a) || sel.has(+b)) { res.color = edgeHi; res.size = Math.max(1, attr.size); res.zIndex = 2; }
          else { res.hidden = true; }
        } else if (s.focusCat != null && s.coloring?.gc) {
          const [a, b] = g.extremities(key);
          const gc = s.coloring.gc;
          if (!gc.matches(s.coloring.key(+a), s.focusCat) && !gc.matches(s.coloring.key(+b), s.focusCat)) res.hidden = true;
        }
        if (s.edgeSel) {
          const [a, b] = g.extremities(key);
          const da = data.nodeIds[+a], db = data.nodeIds[+b];
          if ((da === s.edgeSel.a && db === s.edgeSel.b) || (da === s.edgeSel.b && db === s.edgeSel.a)) { res.color = '#F6FAFD'; res.size = 2.5; res.hidden = false; res.zIndex = 3; }
        }
        return res;
      },
    });
    sig.current = renderer;

    // Our label layer sits above sigma's node and label layers and below the
    // hover box.
    renderer.createCanvasContext('f2labels', { afterLayer: 'labels' });
    const placed = { labels: [], badges: [], groups: [] };
    const centres = groupCentres(g, state);
    renderer.on('afterRender', () => {
      try { drawLabels(renderer, g, data, state.current, focus.current, hoverRef.current, centres, placed); } catch { /* killed mid-frame */ }
    });
    renderer.refresh();

    renderer.on('enterNode', ({ node }) => { setHovered(node); box.current.style.cursor = 'pointer'; });
    renderer.on('leaveNode', () => { setHovered(null); box.current.style.cursor = ''; });
    renderer.on('clickNode', ({ node, event }) => onNode(data.nodeIds[+node], event?.original?.shiftKey));
    renderer.on('clickStage', () => { onNode(null); });
    renderer.on('clickEdge', ({ edge }) => { const [a, b] = g.extremities(edge); onEdge({ a: data.nodeIds[+a], b: data.nodeIds[+b] }); });
    renderer.on('enterEdge', () => { box.current.style.cursor = 'pointer'; });
    renderer.on('leaveEdge', () => { box.current.style.cursor = ''; });

    // Phones: one finger scrolls the page (the map took 60% of the screen
    // and swallowed every swipe), a tap still selects through the mouse
    // events the browser synthesises, and two fingers move or zoom the map.
    const wrap = outer.current;
    let multi = false;
    const onTouch = (e) => {
      if (e.type === 'touchstart') multi = e.touches.length > 1;
      if (!multi && e.touches.length <= 1) e.stopPropagation();
    };
    if (coarse()) {
      const mouse = renderer.getContainer().querySelector('.sigma-mouse');
      if (mouse) mouse.style.touchAction = 'pan-y';
      for (const ev of ['touchstart', 'touchmove', 'touchend']) wrap.addEventListener(ev, onTouch, { capture: true });
    }

    ref_.current = {
      sigma: renderer,
      graph: g,
      placed,
      focusNode(dsIdx) {
        const v = data.nodeIds.indexOf(dsIdx);
        if (v < 0) return;
        const p = renderer.getNodeDisplayData(String(v));
        if (p) renderer.getCamera().animate({ x: p.x, y: p.y, ratio: 0.35 }, { duration: dur(400) });
      },
    };
    // The canvas height follows the viewport and the status bar; keep sigma's
    // idea of its size in step so the graph stays fitted.
    const ro = new ResizeObserver(() => { try { renderer.resize(); renderer.refresh(); } catch { /* killed */ } });
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      for (const ev of ['touchstart', 'touchmove', 'touchend']) wrap.removeEventListener(ev, onTouch, { capture: true });
      renderer.kill(); sig.current = null; ref_.current = null;
    };
  }, [data, positions]);

  // Recompute highlight sets and refresh when display state changes.
  useEffect(() => {
    const g = graph.current;
    if (!g || !sig.current) return;
    const s = state.current;
    const core = new Set();
    const toNet = new Map();
    for (let v = 0; v < data.nodeIds.length; v++) toNet.set(data.nodeIds[v], v);
    for (const i of s.selection) { const v = toNet.get(i); if (v != null) core.add(v); }
    if (hovered != null && !core.size) core.add(+hovered);
    if (core.size) {
      const set = new Set(core);
      for (const v of core) g.forEachNeighbor(String(v), u => set.add(+u));
      focus.current = { set, core };
    } else focus.current = { set: null, core: null };
    sig.current.refresh({ skipIndexation: false });
  }, [coloring, sizes, selection, focusCat, rulesOff, visOff, edgeSel, hovered]);

  const onKey = (e) => {
    const r = sig.current; if (!r) return;
    const cam = r.getCamera();
    const st = cam.getState();
    const step = 0.12 * st.ratio;
    const pan = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (pan) { e.preventDefault(); cam.animate({ x: st.x + pan[0], y: st.y + pan[1] }, { duration: dur(120) }); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); cam.animatedZoom({ duration: dur(200) }); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); cam.animatedUnzoom({ duration: dur(200) }); }
    else if (e.key === '0') { e.preventDefault(); cam.animatedReset({ duration: dur(300) }); }
    else if (e.key === 'Escape') { onNode(null); onEdge(null); }
  };

  return html`<div class="net" ref=${outer} tabindex="0" role="application" aria-label="Network map. Arrow keys move the map, plus and minus zoom, 0 fits. Select people with the search box; their ties are listed beside the map." onKeyDown=${onKey}>
    <div class="net__canvas" ref=${box}></div>
    <div class="net__zoom">
      <button type="button" class="btn" aria-label="Zoom in" onClick=${() => sig.current?.getCamera().animatedZoom({ duration: dur(200) })}>+</button>
      <button type="button" class="btn" aria-label="Zoom out" onClick=${() => sig.current?.getCamera().animatedUnzoom({ duration: dur(200) })}>−</button>
      <button type="button" class="btn" aria-label="Fit the whole network" onClick=${() => sig.current?.getCamera().animatedReset({ duration: dur(300) })} style="font-size:.7rem">Fit</button>
    </div>
  </div>`;
}

// Where each group sits on the map (lib/labels.js groupAnchors), for the
// community numbers and the group names. Read lazily so a new coloring needs
// no graph rebuild.
function groupCentres(g, state) {
  let cacheFor = null, cache = null;
  return () => {
    const c = state.current.coloring;
    if (!c?.gc) return null;
    if (cacheFor === c) return cache;
    const n = g.order;
    const x = new Float64Array(n), y = new Float64Array(n);
    g.forEachNode((key, a) => { x[+key] = a.x; y[+key] = a.y; });
    cache = groupAnchors(x, y, v => c.key(v));
    cacheFor = c;
    return cache;
  };
}

// Label placement over the current frame. Candidates in priority order:
// selected people, the hovered person, their neighbors, then everyone by
// size. Each label goes right of its node, or left near the right edge, and
// is skipped if it would overlap a label or badge already placed or leave
// the canvas. Small networks label everyone who fits.
function drawLabels(renderer, g, data, s, focus, hovered, centres, placed) {
  const ctx = renderer.canvasContexts?.f2labels;
  if (!ctx) return;
  const { width: W, height: H } = renderer.getDimensions();
  // Sigma does not resize layers added after it starts; keep ours in step.
  const pr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const cv = ctx.canvas;
  if (cv.width !== Math.round(W * pr) || cv.height !== Math.round(H * pr)) {
    cv.width = Math.round(W * pr); cv.height = Math.round(H * pr);
    cv.style.width = `${W}px`; cv.style.height = `${H}px`;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(pr, 0, 0, pr, 0, 0);
  const t = tokens();
  const rects = [];
  placed.labels = []; placed.badges = []; placed.groups = [];
  const ratio = renderer.getCamera().getState().ratio;
  const gc = s.coloring?.gc;
  const shownKey = k => s.focusCat == null || gc.matches(k, s.focusCat);
  const inside = b => b.x >= 2 && b.y >= 2 && b.x + b.w <= W - 2 && b.y + b.h <= H - 2;

  // Community numbers first: they are the non-color cue for communities.
  const cs = centres();
  if (cs && !focus.set && s.coloring.community) {
    ctx.font = `600 11px ${LABEL_FONT}`;
    for (const c of cs) {
      if (c.n < 3 || !shownKey(c.key)) continue;
      const p = renderer.graphToViewport({ x: c.x, y: c.y });
      const text = String(Number(c.key) + 1);
      const rad = 9;
      const box = { x: p.x - rad, y: p.y - rad, w: rad * 2, h: rad * 2 };
      if (!inside(box) || overlaps(box, rects)) continue;
      const color = gc.many && s.focusCat != null ? t.accent : gc.color(c.key);
      ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = t.bgDeep; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
      ctx.fillStyle = t.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, p.x, p.y + 0.5);
      rects.push(box);
      placed.badges.push({ x: p.x, y: p.y, r: rad, text, color });
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  } else if (cs && !focus.set) {
    // Attribute groups above the size threshold are named where most of
    // each sits, so no group relies on color alone (a dot in its color, the
    // name in ink with a halo),
    // largest first, skipping any name that would collide or leave the map.
    const min = groupLabelMin(g.order);
    const byKey = new Map(gc.entries.map(e => [e.value, e]));
    ctx.font = `600 13px ${LABEL_FONT}`;
    ctx.lineJoin = 'round';
    for (const c of cs) {
      const e = byKey.get(c.key);
      if (!e || !shownKey(c.key) || (c.n < min && s.focusCat == null)) continue;
      const p = renderer.graphToViewport({ x: c.x, y: c.y });
      const w = ctx.measureText(e.label).width + 12, h = 17;
      const box = { x: p.x - w / 2, y: p.y - h / 2, w, h };
      if (!inside(box) || overlaps(box, rects)) continue;
      const color = s.focusCat != null && gc.many ? t.accent : e.color;
      ctx.beginPath(); ctx.arc(box.x + 4, p.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = t.bgDeep; ctx.stroke();
      ctx.lineWidth = 4; ctx.strokeStyle = t.bgDeep;
      ctx.strokeText(e.label, box.x + 12, p.y + 4);
      ctx.fillStyle = t.text;
      ctx.fillText(e.label, box.x + 12, p.y + 4);
      rects.push(box);
      placed.groups.push({ x: box.x, y: p.y, text: e.label, color });
    }
  }

  const n = g.order;
  const cand = [];
  g.forEachNode((key, attr) => {
    const d = renderer.getNodeDisplayData(key);
    if (!d || d.hidden || d.dimmed || !attr.label) return;
    const p = renderer.framedGraphToViewport({ x: d.x, y: d.y });
    if (p.x < -10 || p.y < -10 || p.x > W + 10 || p.y > H + 10) return;
    const v = +key;
    const forced = d.forceLabel || (focus.core && focus.core.has(v));
    const pri = forced ? 0 : key === hovered ? 1 : focus.set?.has(v) ? 2 : 3;
    cand.push({ key, label: attr.label, x: p.x, y: p.y, r: renderer.scaleSize(d.size), pri, size: d.size });
  });
  cand.sort((a, b) => a.pri - b.pri || b.size - a.size || a.key - b.key);
  const budget = labelBudget({ n, width: W, ratio, focus: !!focus.set });
  ctx.lineJoin = 'round';
  let count = 0;
  for (const c of cand) {
    if (count >= budget && c.pri > 1) break;
    const strong = c.pri === 0;
    ctx.font = `${strong ? 600 : 500} 12px ${LABEL_FONT}`;
    const w = ctx.measureText(c.label).width, h = 14;
    const y = c.y - h / 2;
    let box = { x: c.x + c.r + 4, y, w, h };
    if (box.x + w > W - 4 || overlaps(box, rects)) {
      const left = { x: c.x - c.r - 4 - w, y, w, h };
      if (left.x >= 4 && !overlaps(left, rects)) box = left;
      else if (strong) box = { x: Math.max(4, Math.min(box.x, W - 4 - w)), y, w, h };
      else continue;
    }
    if (box.y < 2 || box.y + h > H - 2) { if (!strong) continue; box.y = Math.max(2, Math.min(box.y, H - h - 2)); }
    // Halo in the canvas ground, then the text.
    ctx.lineWidth = 4; ctx.strokeStyle = t.bgDeep;
    ctx.strokeText(c.label, box.x, box.y + 11);
    ctx.fillStyle = strong ? t.text : t.text2;
    ctx.fillText(c.label, box.x, box.y + 11);
    rects.push(box);
    placed.labels.push({ x: box.x, y: box.y + 11, text: c.label, strong });
    count++;
  }
}

// ---- side panel -----------------------------------------------------------------

// Legend rows are buttons: hover or keyboard focus previews a group, click or
// Enter pins it (again to unpin), arrow keys move between rows. In highlight
// mode every group is listed (the list scrolls) under the eight colored ones
// and the "Other groups" row; "Not recorded" always has its own row.
const LEGEND_MAX = 200;

function Legend({ coloring, pinCat, setPinCat, setHoverCat, sizeBy, directed }) {
  if (!coloring) return null;
  const gc = coloring.gc;
  const row = (value, color, label, count, { sub = false, missing = false, title } = {}) => html`<button type="button" class=${`legend__item${sub ? ' legend__item--sub' : ''}`} aria-pressed=${String(pinCat === value)} title=${title}
      onClick=${() => setPinCat(pinCat === value ? null : value)} onMouseEnter=${() => setHoverCat(value)} onMouseLeave=${() => setHoverCat(null)}
      onFocus=${() => setHoverCat(value)} onBlur=${() => setHoverCat(null)}>
    <span class=${`swatch${missing ? ' swatch--missing' : ''}`} style=${`background:${color}`} aria-hidden="true"></span><span class="grow">${label}</span><span class="legend__count">${fmtInt(count)}</span></button>`;
  const onKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...e.currentTarget.querySelectorAll('.legend__item')];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
  };
  const listed = gc ? gc.others.slice(0, LEGEND_MAX) : [];
  const unlisted = gc ? gc.others.slice(LEGEND_MAX) : [];
  return html`<div>
    ${coloring.kind === 'cat' && html`<h2 class="label">Color: ${coloring.title}</h2>
      ${gc.many && html`<p class="small text2 net-legend__lead">${fmtInt(gc.entries.length)} groups: the eight largest in color, the rest gray. Choose any group to light it up.</p>`}
      <div class=${`legend${gc.many ? ' legend--scroll' : ''}`} onKeyDown=${onKey} role="group" aria-label=${`Groups by ${coloring.title}`}>
        ${gc.colored.map(e => row(e.value, e.color, e.label, e.count))}
        ${gc.many && row(OTHER, gc.otherColor, gc.otherLabel, gc.otherPeople, { title: 'All groups after the eight largest; they share gray' })}
        ${listed.map(e => row(e.value, e.color, e.label, e.count, { sub: true }))}
        ${unlisted.length > 0 && html`<p class="legend__more small muted">and ${plural(unlisted.length, coloring.community ? 'smaller community' : 'smaller group', coloring.community ? 'smaller communities' : 'smaller groups')} (${plural(unlisted.reduce((a, e) => a + e.count, 0), 'person', 'people')})</p>`}
        ${gc.missing > 0 && row(MISSING, gc.missingColor, gc.missingLabel, gc.missing, { missing: true, title: `No ${coloring.title.toLowerCase()} in the data` })}
      </div>
      <p class="basis">${coloring.community
        ? `Numbers on the map mark each community of three or more people.${gc.many ? ' Communities after the eighth share gray; choose one to light it up.' : ' Hover or select a community to pick it out.'}`
        : `Groups of 1% of the people or more are named on the map where most of their members sit.${gc.many ? '' : ' Hover or select a group to pick it out.'}`}${gc.missing > 0 ? ` Not recorded: people with no ${coloring.title.toLowerCase()} in the data, not a group.` : ''} Colors stay fixed while you filter.</p>`}
    ${coloring.kind === 'seq' && html`<${RampLegend} scale=${coloring.scale} label=${`Color: ${coloring.title}`} />`}
    ${sizeBy !== 'none' && html`<h2 class="label" style="margin-top:1rem">Size: ${metricLabel(sizeBy, directed)}</h2><p class="basis" style="margin-top:0">Area grows with the value (square-root scale).</p>`}
  </div>`;
}

const SUMMARY_KEYS = ['density', 'reciprocity', 'transitivity', 'avgClustering', 'components', 'largestComponentShare', 'avgPathLength', 'degreeCentralization', 'strengthGini'];

function NetworkSummary() {
  const m = useStore(s => s.metrics?.network);
  const communities = useStore(s => s.communities);
  const [nm, setNm] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!m) return null;
  const keys = SUMMARY_KEYS.filter(k => Number.isFinite(m[k]));
  const runNull = async () => {
    setBusy(true);
    try {
      const r = await store.actions.runJob('Comparing with random networks', (signal, progress) => engine.nullModel({ stats: ['reciprocity', 'transitivity', 'avgClustering', 'modularity'], reps: 100, seed: 1, membership: communities?.membership, signal, onProgress: progress }));
      setNm(r);
    } catch (e) { if (e.name !== 'AbortError') store.actions.notify('error', e.message); } finally { setBusy(false); }
  };
  const nullLine = (x) => {
    const above = x.observed > x.mean;
    const clear = x.p < 0.05;
    return `${clear ? (above ? 'Higher than' : 'Lower than') : 'Not clearly different from'} random networks with the same degrees (random ${fmtNum(x.mean)}, sd ${fmtNum(x.sd)}; z ${fmtNum(x.z, { digits: 2 })}, ${fmtP(x.p)}).`;
  };
  return html`<details class="net-summary" open=${!narrow()}>
    <summary><h2 class="label" style="display:inline;margin:0">Whole network</h2></summary>
    ${communities && html`<div class="metric-row"><span><${MetricName} metric="modularity" gloss=${true} /></span><span class="metric-row__val">${fmtNum(communities.modularity)}</span>
      <span class="metric-row__sub">${plural(communities.count, 'community', 'communities')}${communities.nontrivial != null ? `, ${fmtInt(communities.nontrivial)} with more than one person` : ''}.${nm?.modularity ? ` ${nullLine(nm.modularity)}` : ''}</span></div>`}
    ${keys.map(k => html`<div class="metric-row"><span><${MetricName} metric=${k === 'reciprocity' ? 'reciprocityNetwork' : k} gloss=${true} /></span><span class="metric-row__val">${k === 'largestComponentShare' ? `${Math.round(m[k] * 100)}%` : fmtNum(m[k])}</span>
      ${nm?.[k] && html`<span class="metric-row__sub">${nullLine(nm[k])}</span>`}</div>`)}
    ${!nm ? html`<div style="margin-top:.8rem"><button type="button" class="tlink" onClick=${runNull} disabled=${busy}>${busy ? 'Comparing' : 'Compare with random networks'}</button>
      <p class="basis">Clustering, reciprocity and modularity are only notable if they exceed what random networks with the same degrees produce.</p></div>`
      : html`<p class="basis">Null model: ${nm.meta?.model || 'degree-preserving rewiring'}, ${nm.meta?.reps ?? 100} replicates, seed ${nm.meta?.seed ?? 1}. Two-sided empirical p.</p>`}
  </details>`;
}

const PANEL_METRICS = ['contacts', 'degree', 'strength', 'betweenness', 'closeness', 'pagerank', 'clustering', 'constraint'];

function SelectionPanel({ ds, selection, data, metrics, onEdge }) {
  const net = useStore(s => s.network);
  const communities = useStore(s => s.communities);
  const ap = useStore(s => s.applicability);
  const [allTies, setAllTies] = useState(false);
  const i = selection[selection.length - 1];
  const v = net.nodeIds ? Array.prototype.indexOf.call(net.nodeIds, i) : -1;
  const show = PANEL_METRICS.filter(k => metrics?.[k] && ap?.[k]?.level !== 'na' && !(k === 'degree' && !net.directed));
  const ties = useMemo(() => tiesOf(data, i, net.directed), [data, i]);
  const shownTies = allTies ? ties : ties.slice(0, 8);
  const sc = communities ? communityScale(communities) : null;
  const key = displayKey(ds.nodes.keys[i]);
  const attrs = Object.entries(ds.nodes.attrs[i]).filter(([k]) => k !== 'deactivated');
  return html`<div>
    <h2 class="label">${selection.length > 1 ? `${selection.length} selected` : 'Selected'}</h2>
    <p class="net-sel__name">${nodeLabel(ds, i)}</p>
    <p class="meta" style="margin:.2rem 0 .6rem">${key || ''}${ds.nodes.isBot[i] ? `${key ? ' · ' : ''}bot` : ''}${isDeactivated(ds, i) ? html` <${Flag} level="caution">Deactivated account</${Flag}>` : ''}</p>
    ${v < 0 ? html`<p class="small text2">Not in the current network (filtered out or without ties).</p>` : html`
      ${communities && html`<div class="metric-row"><span>Community</span><span class="metric-row__val"><${Swatch} color=${sc.color(String(communities.membership[v]))} /> ${communities.membership[v] + 1}</span></div>`}
      ${show.map(k => html`<div class="metric-row"><span><${MetricName} metric=${k} label=${metricLabel(k, net.directed)} gloss=${true} /></span><span class="metric-row__val">${fmtNum(metrics[k][v])}</span></div>`)}
    `}
    ${v >= 0 && html`<h3 class="label" style="margin-top:1.1rem">Ties (${fmtInt(ties.length)})</h3>
      ${ties.length ? html`<ul class="net-ties">
        ${shownTies.map(tie => html`<li><button type="button" class="linkish net-ties__btn" onClick=${() => onEdge({ a: i, b: tie.other })} aria-label=${`Evidence for the tie with ${nodeLabel(ds, tie.other)}`}>
          <span class="grow">${nodeLabel(ds, tie.other)}</span><span class="tnum">${fmtNum(tie.w)}</span></button>
          <span class="metric-row__sub">${tie.dir}${tie.rules.length ? ` · ${tie.rules.map(r => (RULE_LABEL[r] || r).toLowerCase()).join(', ')}` : ''}</span></li>`)}
      </ul>
      ${ties.length > 8 && html`<button type="button" class="tlink" onClick=${() => setAllTies(x => !x)}>${allTies ? 'Show the strongest 8' : `Show all ${fmtInt(ties.length)} ties`}</button>`}
      <p class="basis">Weight under the current construction rules. Select a tie to see the events behind it.${data?.truncated?.edges ? ' The weakest ties are not drawn and not listed.' : ''}</p>`
      : html`<p class="small text2">No ties drawn.</p>`}`}
    ${attrs.length > 0 && html`<dl class="kv" style="margin-top:.8rem">${attrs.slice(0, 8).map(([k, x]) => html`<dt>${humanize(k)}</dt><dd>${fmtAttr(k, x)}</dd>`)}</dl>`}
    <div class="tlinks" style="margin-top:.9rem">
      <button type="button" class="btn btn--sm btn--primary" onClick=${() => { store.set({ ui: { ...store.get().ui, profile: i } }); store.actions.setView('people'); }}>Full profile</button>
      <button type="button" class="tlink tlink--quiet" onClick=${() => store.actions.select([])}>Clear selection</button>
    </div>
  </div>`;
}

const EVIDENCE_PAGE = 60;

// Tie fields recorded with an event (survey answers such as type of tie or
// strength), labeled from the dataset's tie-field schema: "Type of tie: Advice; Strength: 4".
function tieFields(ds, attrs) {
  if (!attrs) return '';
  const schema = new Map((ds.eventAttributeSchema || []).map(f => [f.key, f.label || f.key]));
  return Object.entries(attrs).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${schema.get(k) || k}: ${v}`).join('; ');
}

export function Evidence({ ds, a, b, onClose }) {
  const [limit, setLimit] = useState(EVIDENCE_PAGE);
  // Ask for one more than shown, to know whether there is more.
  const q = useEngine('evidence', () => engine.edgeEvidence(a, b, { limit: limit + 1, bothDirections: true }), [a, b, limit]);
  const head = useRef(null);
  useEffect(() => { head.current?.focus({ preventScroll: true }); }, [a, b]);
  const events = q.data ? q.data.events.slice(0, limit) : [];
  const more = q.data ? q.data.events.length > limit : false;
  const exportCSV = async () => {
    try {
      const all = await engine.edgeEvidence(a, b, { limit: 1e7, bothDirections: true });
      const esc = x => { const s = x == null ? '' : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const lines = ['time_utc,actor,rule,type,context,visibility,weight,tie_fields,text'];
      for (const e of all.events) lines.push([Number.isFinite(e.t) ? new Date(e.t).toISOString() : '', e.actorLabel || nodeLabel(ds, e.actor), e.rule, e.type, e.context, e.visibility, e.amount, tieFields(ds, e.attrs) || '', e.text].map(esc).join(','));
      download(lines.join('\n'), 'tie-evidence.csv', 'text/csv');
    } catch (e) { store.actions.notify('error', e.message); }
  };
  const parentText = (e) => {
    const p = ds.events.parent?.[e.event];
    if (!(p >= 0) || !['reaction', 'like', 'repost'].includes(e.type)) return null;
    const tx = ds.events.text?.[p];
    return tx ? (tx.length > 160 ? `${tx.slice(0, 157)}...` : tx) : null;
  };
  return html`<div>
    <div class="row row--between"><h2 class="label" style="margin:0" tabindex="-1" ref=${head}>Evidence for this tie</h2><button type="button" class="btn btn--quiet btn--sm" onClick=${onClose} aria-label="Close evidence">${Icon.close}</button></div>
    <p class="net-sel__name" style="margin-top:.3rem">${nodeLabel(ds, a)} <span class="muted" style="font-weight:400">and</span> ${nodeLabel(ds, b)}</p>
    ${q.loading && html`<${Loading}>Finding the events</${Loading}>`}
    <${ErrorLine} error=${q.error} />
    ${q.data && html`<p class="small text2" style="margin:.4rem 0 .6rem">${more ? `The first ${fmtInt(events.length)} pieces of evidence` : events.length === 1 ? 'One piece of evidence' : `${fmtInt(events.length)} pieces of evidence`} under the current construction rules, oldest first.</p>
      <ol class="net-evidence">
        ${events.map(e => { const pt = parentText(e); return html`<li>
          <div class="row row--between" style="gap:.2rem .6rem"><span style="color:var(--text)">${e.actorLabel || nodeLabel(ds, e.actor)} <span class="muted">· ${RULE_LABEL[e.rule] || e.rule}</span></span><span class="meta">${fmtDateTime(e.t)}</span></div>
          <div class="meta" style="margin-top:.15rem">${humanize(e.type)}${e.context ? ` in ${e.context}` : ''}${e.visibility && e.visibility !== 'unknown' ? ` · ${(VISIBILITY_LABEL[e.visibility] || e.visibility).toLowerCase()}` : ''}${e.amount != null ? ` · weight ${fmtNum(e.amount)}` : ''}</div>
          ${pt && html`<p class="text2" style="margin-top:.25rem"><span class="muted">On:</span> ${pt}</p>`}
          ${tieFields(ds, e.attrs) && html`<p class="small text2" style="margin-top:.25rem">${tieFields(ds, e.attrs)}</p>`}
          ${e.text && html`<p class="text2" style="margin-top:.25rem">${e.text}</p>`}
        </li>`; })}
      </ol>
      <div class="tlinks" style="margin-top:.6rem">
        ${more && html`<button type="button" class="tlink" onClick=${() => setLimit(1e6)}>Show all</button>`}
        <button type="button" class="tlink tlink--down" onClick=${exportCSV}>Download as CSV</button>
      </div>`}
  </div>`;
}

// ---- export ------------------------------------------------------------------------

function ExportMenu({ sigmaRef, data, coloring, ds }) {
  const svg = () => buildSVG(sigmaRef.current, coloring, ds);
  const doSVG = () => { const s = svg(); if (s) download(s, 'network.svg', 'image/svg+xml'); };
  const doPNG = async () => {
    const s = svg(); if (!s) return;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }));
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const scale = 2;
    const c = document.createElement('canvas'); c.width = img.width * scale; c.height = img.height * scale;
    const ctx = c.getContext('2d'); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    c.toBlob(b => download(b, 'network.png', 'image/png'), 'image/png');
  };
  return html`<span class="net-export"><span class="muted small">Export figure:</span> <button type="button" class="tlink tlink--down" onClick=${doSVG} disabled=${!data}>SVG</button> <button type="button" class="tlink tlink--down" onClick=${doPNG} disabled=${!data}>PNG</button></span>`;
}

// Redraw the current viewport as SVG from node positions, the reducers'
// output and the labels and badges placed on screen.
function buildSVG(ref, coloring, ds) {
  if (!ref?.sigma) return null;
  const r = ref.sigma, g = ref.graph;
  const t = tokens();
  const { width, height } = r.getDimensions();
  const nodes = [];
  const pos = new Map();
  g.forEachNode((key) => {
    const d = r.getNodeDisplayData(key);
    if (!d || d.hidden) return;
    const p = r.framedGraphToViewport({ x: d.x, y: d.y });
    const rad = r.scaleSize(d.size);
    pos.set(key, p);
    if (p.x < -20 || p.y < -20 || p.x > width + 20 || p.y > height + 20) return;
    nodes.push({ key, x: p.x, y: p.y, r: Math.max(1, rad), color: d.color, z: d.zIndex || 0 });
  });
  nodes.sort((a, b) => a.z - b.z);
  const edges = [];
  g.forEachEdge((key, attr, a, b) => {
    const d = r.getEdgeDisplayData(key);
    if (!d || d.hidden) return;
    const pa = pos.get(a), pb = pos.get(b);
    if (!pa || !pb) return;
    edges.push(`<line x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}" stroke="${d.color}" stroke-width="${Math.max(0.3, r.scaleSize(d.size) * 0.5).toFixed(2)}"/>`);
  });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const placed = ref.placed || { labels: [], badges: [] };
  const gc = coloring?.kind === 'cat' ? coloring.gc : null;
  const items = gc ? [...gc.colored.map(e => ({ color: e.color, label: e.label })),
    ...(gc.many ? [{ color: gc.otherColor, label: coloring.community ? `${gc.otherLabel}, numbered on the map` : gc.otherLabel }] : []),
    ...(gc.missing > 0 ? [{ color: gc.missingColor, label: `${gc.missingLabel} (${plural(gc.missing, 'person', 'people')})`, missing: true }] : [])] : [];
  const legend = items.map((e, i) => `<g transform="translate(16,${height - 16 - (items.length - i) * 16})"><circle r="5" cx="5" cy="-4" fill="${e.color}"${e.missing ? ` stroke="${t.muted}" stroke-width="1.2"` : ''}/><text x="16" y="0" fill="${t.text2}" font-size="11">${esc(e.label)}</text></g>`).join('');
  const groupNames = (placed.groups || []).map(l => `<circle cx="${(l.x + 4).toFixed(1)}" cy="${l.y.toFixed(1)}" r="4.5" fill="${l.color}" stroke="${t.bgDeep}" stroke-width="1.5"/><text x="${(l.x + 12).toFixed(1)}" y="${(l.y + 4).toFixed(1)}" fill="${t.text}" font-weight="600" stroke="${t.bgDeep}" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${esc(l.text)}</text>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Geist, system-ui, sans-serif">
<rect width="100%" height="100%" fill="${t.bgDeep}"/>
<g>${edges.join('')}</g>
<g stroke="${t.bgDeep}" stroke-width="1.5">${nodes.map(n => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(n.r + 0.75).toFixed(2)}" fill="${n.color}"/>`).join('')}</g>
<g font-size="11" font-weight="600">${placed.badges.map(b => `<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="${b.r}" fill="${t.bgDeep}" stroke="${b.color}" stroke-width="2"/><text x="${b.x.toFixed(1)}" y="${(b.y + 4).toFixed(1)}" text-anchor="middle" fill="${t.text}">${esc(b.text)}</text>`).join('')}</g>
<g font-size="13">${groupNames}</g>
<g font-size="12" stroke="${t.bgDeep}" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${placed.labels.map(l => `<text x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" fill="${l.strong ? t.text : t.text2}"${l.strong ? ' font-weight="600"' : ''}>${esc(l.text)}</text>`).join('')}</g>
${legend}
<text x="${width - 12}" y="${height - 10}" text-anchor="end" font-size="10" fill="${t.muted}">${esc(ds.meta.name)} · Org Signal</text>
</svg>`;
}
