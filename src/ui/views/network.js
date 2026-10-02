// Network view: sigma.js (WebGL) over positions from the engine.
//
// Colour by community, any categorical attribute, or a metric (sequential);
// size by a metric; filter ties by construction rule and visibility layer;
// search; hover and click to select with neighbourhood highlight; click a tie
// to see the events that created it; export the current view as SVG or PNG
// (drawn from positions, not a screenshot of the canvas).

import { html, useState, useEffect, useRef, useMemo, useCallback } from '../../../vendor/preact.js';
import { Sigma } from '../../../vendor/sigma.js';
import { Graph } from '../../../vendor/graphology.js';
import { store, useStore } from '../store.js';
import { engine } from '../services/engine.js';
import { gloss, NODE_METRICS } from '../services/glossary.js';
import { ViewHead, NeedsData, Loading, ErrorLine, Select, MetricName, Flag, Swatch, ConstructionButton, useEngine, download, Icon, applicabilityReason } from '../components/common.js';
import { RampLegend } from '../components/charts.js';
import { categoricalScale, sequentialScale, tokens, dim, mixTo } from '../lib/palette.js';
import { groupableAttributes, orderedValues, label as nodeLabel } from '../lib/dsutil.js';
import { fmtNum, fmtInt, fmtDateTime, fmtP, humanize } from '../lib/format.js';
import { VISIBILITY } from '../../core/model.js';
import { cachedRender, getRender, clearRender } from '../lib/render-cache.js';

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

function NetworkInner({ ds, net }) {
  const r = useRender(net);
  const metrics = useStore(s => s.metrics);
  const communities = useStore(s => s.communities);
  const applicability = useStore(s => s.applicability);
  const selection = useStore(s => s.selection);
  const attrs = useMemo(() => groupableAttributes(ds), [ds]);
  const [colorBy, setColorBy] = useState(() => (communities ? 'community' : attrs[0] ? `attr:${attrs[0].key}` : 'none'));
  const [sizeBy, setSizeBy] = useState('degree');
  const [rulesOff, setRulesOff] = useState(new Set());
  const [visOff, setVisOff] = useState(new Set());
  const [focusCat, setFocusCat] = useState(null);
  const [edgeSel, setEdgeSel] = useState(null); // { a, b } dataset indices
  const [hoverNode, setHoverNode] = useState(null);
  const sigmaRef = useRef(null);

  const nodeMetricKeys = Object.keys(metrics?.node || {}).filter(k => applicability?.[k]?.level !== 'na');

  // Colour assignment, decided over the whole network so filters never repaint.
  const colouring = useMemo(() => {
    const t = tokens();
    if (!r.data) return null;
    const ids = r.data.nodeIds;
    const ni = r.data.netIndex;
    if (colorBy === 'community' && communities?.membership) {
      const k = communities.count ?? Math.max(...communities.membership) + 1;
      const values = Array.from({ length: k }, (_, i) => String(i));
      const sc = categoricalScale(values);
      const sizes = communities.sizes || values.map((_, i) => communities.membership.filter(m => m === i).length);
      return { kind: 'cat', of: v => sc.color(String(communities.membership[ni[v]])), key: v => String(communities.membership[ni[v]]),
        legend: sc.entries.map(e => ({ ...e, label: `Community ${Number(e.value) + 1}`, count: sizes[Number(e.value)] })), folded: sc.folded, foldedCount: sizes.slice(sc.entries.length).reduce((a, b) => a + b, 0), other: sc.otherColor, title: 'Community (Louvain)' };
    }
    if (colorBy.startsWith('attr:')) {
      const key = colorBy.slice(5);
      const ov = orderedValues(ds, key);
      const sc = categoricalScale(ov.map(o => o.value));
      const shownCount = sc.entries.length;
      return { kind: 'cat', of: v => { const x = ds.nodes.attrs[ids[v]][key]; return x == null || x === '' ? t.other : sc.color(String(x)); }, key: v => String(ds.nodes.attrs[ids[v]][key] ?? ''),
        legend: sc.entries.map((e, i) => ({ ...e, label: e.value, count: ov[i].count })), folded: sc.folded, foldedCount: ov.slice(shownCount).reduce((a, b) => a + b.count, 0), other: sc.otherColor, title: humanize(key), missing: ds.nodes.count - ov.reduce((a, b) => a + b.count, 0) };
    }
    if (colorBy.startsWith('metric:')) {
      const m = colorBy.slice(7);
      const arr = metrics?.node?.[m];
      if (!arr) return null;
      const fin = Array.from(arr).filter(Number.isFinite);
      const sc = sequentialScale(Math.min(...fin), Math.max(...fin));
      return { kind: 'seq', of: v => sc(arr[ni[v]]), scale: sc, title: gloss(m).label, metric: m };
    }
    return { kind: 'none', of: () => t.node, title: null };
  }, [r.data, colorBy, communities, metrics, ds]);

  const sizes = useMemo(() => {
    if (!r.data) return null;
    const n = r.data.x.length;
    const arr = sizeBy !== 'none' ? metrics?.node?.[sizeBy] : null;
    const base = n > 2000 ? 1.6 : n > 500 ? 2.4 : 3.5;
    const span = n > 2000 ? 5 : n > 500 ? 7 : 9;
    const out = new Float32Array(n).fill(base + span * 0.25);
    if (arr) {
      const ni = r.data.netIndex;
      let mx = 0; for (let i = 0; i < n; i++) { const x = arr[ni[i]]; if (Number.isFinite(x) && x > mx) mx = x; }
      for (let i = 0; i < n; i++) { const x = arr[ni[i]]; out[i] = base + span * Math.sqrt(Math.max(0, Number.isFinite(x) ? x : 0) / (mx || 1)); }
    }
    return out;
  }, [r.data, sizeBy, metrics]);

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

  if (r.error) return html`<div class="view"><${ViewHead} title="Network" /><${ErrorLine} error=${r.error} onRetry=${() => { clearRender(); store.set({ network: { ...net, version: Date.now() } }); }} /></div>`;

  const colorOptions = [
    { value: 'none', label: 'Single colour' },
    ...(communities ? [{ value: 'community', label: `Community (${communities.count})` }] : []),
    ...(attrs.length ? [{ group: 'Attributes', options: attrs.map(a => ({ value: `attr:${a.key}`, label: `${a.label} (${a.values.length})` })) }] : []),
    { group: 'Metric (low to high)', options: nodeMetricKeys.map(k => ({ value: `metric:${k}`, label: gloss(k).label })) },
  ];
  const sizeOptions = [{ value: 'none', label: 'Same size' }, ...nodeMetricKeys.map(k => ({ value: k, label: gloss(k).label }))];

  return html`<div class="view">
    <${ViewHead} title="Network" intro=${`${fmtInt(net.n)} people and ${fmtInt(net.edgeCount)} ties, ${net.directed ? 'directed' : 'undirected'}. Click a person to see their neighbourhood, or a tie to see the events behind it.`}
      actions=${html`<${ConstructionButton} /><${ExportMenu} sigmaRef=${sigmaRef} data=${r.data} colouring=${colouring} sizes=${sizes} ds=${ds} />`} />
    <div class="toolbar" role="group" aria-label="Network display">
      <${Select} label="Colour by" value=${colorBy} onChange=${v => { setColorBy(v); setFocusCat(null); }} options=${colorOptions} />
      <${Select} label="Size by" value=${sizeBy} onChange=${setSizeBy} options=${sizeOptions} />
      <${Search} ds=${ds} ids=${r.data?.nodeIds} onPick=${(i) => { selectNode(i); sigmaRef.current?.focusNode(i); }} />
    </div>
    <div class="split">
      <div class="split__main">
        ${r.loading || !r.data ? html`<div class="net"><div class="net__empty"><${Loading}>Computing layout</${Loading}></div></div>`
          : html`<${SigmaCanvas} ref_=${sigmaRef} data=${r.data} ds=${ds} colouring=${colouring} sizes=${sizes} selection=${selection} focusCat=${focusCat}
              rulesOff=${rulesOff} visOff=${visOff} edgeSel=${edgeSel} onNode=${selectNode} onEdge=${setEdgeSel} onHover=${setHoverNode} />`}
        ${r.data?.truncated && (r.data.truncated.nodes || r.data.truncated.edges) ? html`<p class="small" style="margin-top:.5rem"><${Flag} level="info">Drawing simplified</${Flag}> <span class="text2">${r.data.truncated.nodes ? `${fmtInt(r.data.truncated.nodes)} least connected people` : ''}${r.data.truncated.nodes && r.data.truncated.edges ? ' and ' : ''}${r.data.truncated.edges ? `${fmtInt(r.data.truncated.edges)} weakest ties` : ''} are not drawn. Every measure still uses the full network.</span></p>` : ''}
        <p class="basis" style="margin-top:.5rem">Positions: force-directed layout from the engine. Distance on screen is approximate; read structure from the measures, not the picture. Keys: plus and minus zoom, 0 resets, Escape clears the selection.</p>
      </div>
      <aside class="split__side" aria-label="Details">
        ${edgeSel ? html`<${Evidence} ds=${ds} a=${edgeSel.a} b=${edgeSel.b} onClose=${() => setEdgeSel(null)} />`
          : selection.length ? html`<${SelectionPanel} ds=${ds} selection=${selection} />`
          : html`<${NetworkSummary} />`}
        <div class="section">
          <${Legend} colouring=${colouring} focusCat=${focusCat} setFocusCat=${setFocusCat} sizeBy=${sizeBy} />
        </div>
        ${(rulesPresent.length > 1 || visPresent.length > 1) && html`<div class="section stack">
          <p class="label" style="margin:0">Show ties</p>
          ${rulesPresent.length > 1 && html`<${Filter} label="From these rules" items=${rulesPresent} off=${rulesOff} setOff=${setRulesOff} />`}
          ${visPresent.length > 1 && html`<${Filter} label="In these layers" items=${visPresent} off=${visOff} setOff=${setVisOff} />`}
          <p class="basis">Hides ties on the map only. To change what counts as a tie in the measures, use the construction settings.</p>
        </div>`}
      </aside>
    </div>
  </div>`;
}

function Filter({ label, items, off, setOff }) {
  return html`<fieldset class="field" style="border:0;padding:0;margin:0;min-width:0">
    <legend class="field__label" style="padding:0;margin-bottom:.3rem">${label}</legend>
    <div class="row" style="gap:.15rem .8rem">
      ${items.map(it => html`<label class="check"><input type="checkbox" checked=${!off.has(it)} onChange=${e => { const n = new Set(off); if (e.currentTarget.checked) n.delete(it); else n.add(it); setOff(n); }} />${it}</label>`)}
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
    ${open && results.length > 0 && html`<ul id="net-search-list" role="listbox" style="position:absolute;top:100%;left:0;right:0;z-index:20;list-style:none;margin:0;padding:0;background:var(--bg-deep);border:1px solid var(--rule-strong)">
      ${results.map((i, k) => html`<li id=${`ns-${i}`} role="option" aria-selected=${String(k === active)} onMouseDown=${e => { e.preventDefault(); pick(i); }}
        style=${`padding:.45rem .6rem;cursor:pointer;font-size:.85rem;${k === active ? 'background:rgba(111,216,190,.08);color:var(--text)' : 'color:var(--text-2)'}`}>${ds.nodes.labels[i]} <span class="meta">${ds.nodes.keys[i]}</span></li>`)}
    </ul>`}
  </div>`;
}

// ---- sigma canvas -----------------------------------------------------------------

function drawHover(ctx, data, settings) {
  // Dark label box for hover, in place of sigma's default white one.
  const size = settings.labelSize, font = settings.labelFont;
  ctx.font = `600 ${size}px ${font}`;
  const label = data.label || '';
  const w = ctx.measureText(label).width + 12;
  const x = data.x + data.size + 4, y = data.y - size / 2 - 5;
  ctx.fillStyle = 'rgba(5,21,33,0.94)';
  ctx.strokeStyle = 'rgba(255,255,255,0.26)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.rect(x, y, w, size + 10); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(data.x, data.y, data.size + 2, 0, Math.PI * 2); ctx.strokeStyle = '#F6FAFD'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#F6FAFD';
  ctx.fillText(label, x + 6, data.y + size / 3);
}

function SigmaCanvas({ ref_, data, ds, colouring, sizes, selection, focusCat, rulesOff, visOff, edgeSel, onNode, onEdge, onHover }) {
  const box = useRef(null);
  const sig = useRef(null);
  const graph = useRef(null);
  const state = useRef({});
  state.current = { colouring, sizes, selection, focusCat, rulesOff, visOff, edgeSel };
  const focus = useRef({ set: null, core: null });
  const [hovered, setHovered] = useState(null);
  const hoverRef = useRef(null);
  hoverRef.current = hovered;

  // Build the graph once per layout.
  useEffect(() => {
    const t = tokens();
    const g = new Graph({ type: data.directed ? 'directed' : 'undirected', multi: false, allowSelfLoops: false });
    const n = data.x.length;
    for (let v = 0; v < n; v++) {
      const i = data.nodeIds[v];
      g.addNode(String(v), { x: data.x[v], y: -data.y[v], size: 3, color: t.node, label: ds.nodes.labels[i] || ds.nodes.keys[i], ds: i });
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
    // Solid colours mixed toward the canvas ground instead of alpha: WebGL
    // blending of thousands of translucent lines washes out to near-white.
    const edgeMix = m > 20000 ? 0.86 : m > 3000 ? 0.8 : m > 800 ? 0.72 : 0.6;
    const edgeBase = mixTo(t.edge, t.bgDeep, edgeMix);
    const edgeHi = mixTo('#A8E4D2', t.bgDeep, 0.15);
    const renderer = new Sigma(g, box.current, {
      renderLabels: true,
      labelFont: 'Geist Variable, system-ui, sans-serif',
      labelSize: 12,
      labelWeight: '500',
      labelColor: { color: '#C6D3DE' },
      // Sigma shows at most labelDensity labels per grid cell; names are wide,
      // so fewer, larger cells keep labels from running into each other.
      // Hovered and selected people are always labelled.
      labelDensity: 0.25,
      labelGridCellSize: 140,
      labelRenderedSizeThreshold: n > 1000 ? 8 : 7,
      defaultEdgeType: 'line',
      defaultEdgeColor: edgeBase,
      enableEdgeEvents: m < 60000,
      hideEdgesOnMove: m > 30000,
      zIndex: true,
      minCameraRatio: 0.03,
      maxCameraRatio: 8,
      stagePadding: 24,
      defaultDrawNodeHover: drawHover,
      nodeReducer: (key, attr) => {
        const s = state.current;
        const v = +key;
        const res = { ...attr };
        res.color = s.colouring ? s.colouring.of(v) : attr.color;
        res.size = s.sizes ? s.sizes[v] : attr.size;
        const sel = s.selection;
        const hv = hoverRef.current;
        const focusSet = focus.current.set;
        if (focusSet) {
          if (!focusSet.has(v)) { res.color = dim(res.color, 0.82); res.label = ''; res.zIndex = 0; }
          else { res.zIndex = 2; if (sel.includes(attr.ds)) { res.highlighted = true; res.forceLabel = true; } }
        } else if (s.focusCat != null && s.colouring?.key) {
          if (s.colouring.key(v) !== s.focusCat) { res.color = dim(res.color, 0.8); res.label = ''; res.zIndex = 0; } else res.zIndex = 2;
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
        } else if (s.focusCat != null && s.colouring?.key) {
          const [a, b] = g.extremities(key);
          if (s.colouring.key(+a) !== s.focusCat && s.colouring.key(+b) !== s.focusCat) res.hidden = true;
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
    renderer.on('enterNode', ({ node }) => { setHovered(node); onHover(+node); box.current.style.cursor = 'pointer'; });
    renderer.on('leaveNode', () => { setHovered(null); onHover(null); box.current.style.cursor = ''; });
    renderer.on('clickNode', ({ node, event }) => onNode(data.nodeIds[+node], event?.original?.shiftKey));
    renderer.on('clickStage', () => { onNode(null); });
    renderer.on('clickEdge', ({ edge }) => { const [a, b] = g.extremities(edge); onEdge({ a: data.nodeIds[+a], b: data.nodeIds[+b] }); });
    renderer.on('enterEdge', () => { box.current.style.cursor = 'pointer'; });
    renderer.on('leaveEdge', () => { box.current.style.cursor = ''; });
    ref_.current = {
      sigma: renderer,
      graph: g,
      focusNode(dsIdx) {
        const v = data.nodeIds.indexOf(dsIdx);
        if (v < 0) return;
        const p = renderer.getNodeDisplayData(String(v));
        if (p) renderer.getCamera().animate({ x: p.x, y: p.y, ratio: 0.35 }, { duration: 400 });
      },
    };
    // The canvas height follows the viewport and the status bar; keep sigma's
    // idea of its size in step so the graph stays fitted.
    const ro = new ResizeObserver(() => { try { renderer.resize(); renderer.refresh(); } catch { /* killed */ } });
    ro.observe(box.current);
    return () => { ro.disconnect(); renderer.kill(); sig.current = null; ref_.current = null; };
  }, [data]);

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
  }, [colouring, sizes, selection, focusCat, rulesOff, visOff, edgeSel, hovered]);

  const onKey = (e) => {
    const r = sig.current; if (!r) return;
    const cam = r.getCamera();
    if (e.key === '+' || e.key === '=') { e.preventDefault(); cam.animatedZoom({ duration: 200 }); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); cam.animatedUnzoom({ duration: 200 }); }
    else if (e.key === '0') { e.preventDefault(); cam.animatedReset({ duration: 300 }); }
    else if (e.key === 'Escape') { onNode(null); onEdge(null); }
  };

  return html`<div class="net" tabindex="0" role="application" aria-label="Network map. Use the search box or the People view to select people by keyboard." onKeyDown=${onKey}>
    <div class="net__canvas" ref=${box}></div>
    <div class="net__zoom">
      <button class="btn" aria-label="Zoom in" onClick=${() => sig.current?.getCamera().animatedZoom({ duration: 200 })}>+</button>
      <button class="btn" aria-label="Zoom out" onClick=${() => sig.current?.getCamera().animatedUnzoom({ duration: 200 })}>−</button>
      <button class="btn" aria-label="Reset view" onClick=${() => sig.current?.getCamera().animatedReset({ duration: 300 })} style="font-size:.7rem">Fit</button>
    </div>
  </div>`;
}

// ---- side panel -----------------------------------------------------------------

function Legend({ colouring, focusCat, setFocusCat, sizeBy }) {
  if (!colouring) return null;
  return html`<div>
    ${colouring.kind === 'cat' && html`<p class="label">Colour: ${colouring.title}</p>
      <div class="legend">
        ${colouring.legend.map(e => html`<button class="legend__item" aria-pressed=${String(focusCat === e.value)} onClick=${() => setFocusCat(focusCat === e.value ? null : e.value)}
            onMouseEnter=${() => setFocusCat(e.value)} onMouseLeave=${() => setFocusCat(null)}>
          <${Swatch} color=${e.color} /><span class="grow">${e.label}</span><span class="legend__count">${fmtInt(e.count)}</span></button>`)}
        ${colouring.folded && html`<div class="legend__item" style="cursor:default"><${Swatch} color=${colouring.other} /><span class="grow">Other (smaller groups)</span><span class="legend__count">${fmtInt(colouring.foldedCount)}</span></div>`}
        ${colouring.missing > 0 && html`<div class="legend__item" style="cursor:default"><${Swatch} color=${colouring.other} /><span class="grow">No value</span><span class="legend__count">${fmtInt(colouring.missing)}</span></div>`}
      </div>
      <p class="basis">Hover or click a group to pick it out. Colours are assigned by group size and stay fixed while you filter.</p>`}
    ${colouring.kind === 'seq' && html`<${RampLegend} scale=${colouring.scale} label=${`Colour: ${colouring.title}`} />`}
    ${sizeBy !== 'none' && html`<p class="label" style="margin-top:1rem">Size: ${gloss(sizeBy).label}</p><p class="basis" style="margin-top:0">Area grows with the value (square-root scale).</p>`}
  </div>`;
}

function NetworkSummary() {
  const m = useStore(s => s.metrics?.network);
  const communities = useStore(s => s.communities);
  const [nm, setNm] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!m) return null;
  const keys = ['density', 'reciprocity', 'transitivity', 'avgClustering', 'components', 'largestComponentShare', 'avgPathLength', 'degreeCentralization', 'strengthGini'].filter(k => Number.isFinite(m[k]));
  const runNull = async () => {
    setBusy(true);
    try {
      const r = await store.actions.runJob('Comparing with random networks', (signal, progress) => engine.nullModel({ stats: ['reciprocity', 'transitivity', 'avgClustering', 'modularity'], reps: 100, seed: 1, membership: communities?.membership, signal, onProgress: progress }));
      setNm(r);
    } catch (e) { if (e.name !== 'AbortError') store.actions.notify('error', e.message); } finally { setBusy(false); }
  };
  return html`<div class="section" style="border-top:0;padding-top:0">
    <p class="label">Whole network</p>
    ${keys.map(k => html`<div class="metric-row"><span><${MetricName} metric=${k === 'reciprocity' ? 'reciprocityNetwork' : k} /></span><span class="metric-row__val">${k === 'largestComponentShare' ? `${Math.round(m[k] * 100)}%` : fmtNum(m[k])}</span>
      ${nm?.[k] && html`<span class="metric-row__sub">Random networks with the same degrees: ${fmtNum(nm[k].mean)} (sd ${fmtNum(nm[k].sd)}), z ${fmtNum(nm[k].z, { digits: 2 })}, ${fmtP(nm[k].p)}</span>`}</div>`)}
    ${communities && html`<div class="metric-row"><span><${MetricName} metric="modularity" /></span><span class="metric-row__val">${fmtNum(communities.modularity)}</span>
      <span class="metric-row__sub">${communities.count} communities${communities.nontrivial != null ? `, ${communities.nontrivial} with more than one person` : ''}${nm?.modularity ? `. Random: ${fmtNum(nm.modularity.mean)}, z ${fmtNum(nm.modularity.z, { digits: 2 })}, ${fmtP(nm.modularity.p)}` : ''}</span></div>`}
    ${!nm ? html`<div style="margin-top:.8rem"><button class="btn btn--sm" onClick=${runNull} disabled=${busy}>Compare with random networks</button>
      <p class="basis">Clustering, reciprocity and modularity are only notable if they exceed what random networks with the same degrees produce.</p></div>`
      : html`<p class="basis">Null model: ${nm.meta?.model || 'degree-preserving rewiring'}, ${nm.meta?.reps ?? 100} replicates, seed ${nm.meta?.seed ?? 1}. Two-sided empirical p.</p>`}
  </div>`;
}

function SelectionPanel({ ds, selection }) {
  const metrics = useStore(s => s.metrics);
  const net = useStore(s => s.network);
  const communities = useStore(s => s.communities);
  const i = selection[selection.length - 1];
  const v = net.nodeIds ? Array.prototype.indexOf.call(net.nodeIds, i) : -1;
  const ap = useStore(s => s.applicability);
  const show = ['degree', 'strength', 'betweenness', 'closeness', 'pagerank', 'clustering', 'constraint'].filter(k => metrics?.node?.[k] && ap?.[k]?.level !== 'na');
  return html`<div class="section" style="border-top:0;padding-top:0">
    <p class="label">${selection.length > 1 ? `${selection.length} selected` : 'Selected'}</p>
    <h2 style="font-size:1.15rem;font-weight:600">${nodeLabel(ds, i)}</h2>
    <p class="meta" style="margin:.2rem 0 .6rem">${ds.nodes.keys[i]}${ds.nodes.isBot[i] ? ' · bot' : ''}</p>
    ${v < 0 ? html`<p class="small text2">Not in the current network (filtered out or without ties).</p>` : html`
      ${communities && html`<div class="metric-row"><span>Community</span><span class="metric-row__val">${communities.membership[v] + 1}</span></div>`}
      ${show.map(k => html`<div class="metric-row"><span><${MetricName} metric=${k} /></span><span class="metric-row__val">${fmtNum(metrics.node[k][v])}</span></div>`)}
    `}
    ${Object.keys(ds.nodes.attrs[i]).length > 0 && html`<dl class="kv" style="margin-top:.8rem">${Object.entries(ds.nodes.attrs[i]).slice(0, 8).map(([k, x]) => html`<dt>${humanize(k)}</dt><dd>${String(x)}</dd>`)}</dl>`}
    <div class="row" style="margin-top:.9rem">
      <button class="btn btn--sm btn--primary" onClick=${() => { store.set({ ui: { ...store.get().ui, profile: i } }); store.actions.setView('people'); }}>Full profile</button>
      <button class="btn btn--sm" onClick=${() => store.actions.select([])}>Clear</button>
    </div>
    <p class="basis">Shift-click to add people to the selection. Click a highlighted tie to see its evidence.</p>
  </div>`;
}

export function Evidence({ ds, a, b, onClose }) {
  const q = useEngine('evidence', () => engine.edgeEvidence(a, b, { limit: 60, bothDirections: true }), [a, b]);
  return html`<div class="section" style="border-top:0;padding-top:0">
    <div class="row row--between"><p class="label" style="margin:0">Evidence for this tie</p><button class="btn btn--quiet btn--sm" onClick=${onClose} aria-label="Close evidence">${Icon.close}</button></div>
    <h2 style="font-size:1.05rem;font-weight:600;margin-top:.3rem">${nodeLabel(ds, a)} <span class="muted" style="font-weight:400">and</span> ${nodeLabel(ds, b)}</h2>
    ${q.loading && html`<${Loading}>Finding the events</${Loading}>`}
    <${ErrorLine} error=${q.error} />
    ${q.data && html`<p class="small text2" style="margin:.4rem 0 .6rem">${q.data.capped ? `The first ${fmtInt(q.data.events.length)} pieces` : `${fmtInt(q.data.total)} piece${q.data.total === 1 ? '' : 's'}`} of evidence under the current construction rules, oldest first${q.data.total > q.data.events.length ? `; ${fmtInt(q.data.events.length)} shown` : ''}.</p>
      <ol style="list-style:none;margin:0;padding:0">
        ${q.data.events.map(e => html`<li style="padding:.5rem 0;border-bottom:1px solid var(--rule);font-size:.8125rem">
          <div class="row row--between" style="gap:.2rem .6rem"><span style="color:var(--text)">${e.actorLabel || nodeLabel(ds, e.actor)} <span class="muted">· ${e.rule}</span></span><span class="meta">${fmtDateTime(e.t)}</span></div>
          <div class="meta" style="margin-top:.15rem">${e.type}${e.context ? ` in ${e.context}` : ''}${e.visibility ? ` · ${e.visibility}` : ''}${e.amount != null ? ` · weight ${fmtNum(e.amount)}` : ''}</div>
          ${e.text && html`<p class="text2" style="margin-top:.25rem">${e.text}</p>`}
        </li>`)}
      </ol>`}
  </div>`;
}

// ---- export ------------------------------------------------------------------------

function ExportMenu({ sigmaRef, data, colouring, sizes, ds }) {
  const svg = () => buildSVG(sigmaRef.current, data, colouring, sizes, ds);
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
  return html`<button class="btn" onClick=${doSVG} disabled=${!data}>Export SVG</button><button class="btn" onClick=${doPNG} disabled=${!data}>Export PNG</button>`;
}

// Redraw the current viewport as SVG from node positions and the reducers' output.
function buildSVG(ref, data, colouring, sizes, ds) {
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
    nodes.push({ key, x: p.x, y: p.y, r: Math.max(1, rad), color: d.color, label: d.label, forceLabel: d.forceLabel || d.highlighted });
  });
  const edges = [];
  g.forEachEdge((key, attr, a, b) => {
    const d = r.getEdgeDisplayData(key);
    if (!d || d.hidden) return;
    const pa = pos.get(a), pb = pos.get(b);
    if (!pa || !pb) return;
    edges.push(`<line x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}" stroke="${d.color}" stroke-width="${Math.max(0.3, r.scaleSize(d.size) * 0.5).toFixed(2)}"/>`);
  });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const big = [...nodes].sort((a, b) => b.r - a.r).slice(0, 40).filter(n => n.label);
  const labelSet = new Set(big.map(n => n.key));
  const legend = colouring?.kind === 'cat' ? colouring.legend.map((e, i) => `<g transform="translate(16,${height - 16 - (colouring.legend.length - i) * 16})"><circle r="5" cx="5" cy="-4" fill="${e.color}"/><text x="16" y="0" fill="${t.text2}" font-size="11">${esc(e.label)}</text></g>`).join('') : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Geist, system-ui, sans-serif">
<rect width="100%" height="100%" fill="${t.bgDeep}"/>
<g>${edges.join('')}</g>
<g>${nodes.map(n => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(2)}" fill="${n.color}"/>`).join('')}</g>
<g font-size="11" fill="${t.text2}">${nodes.filter(n => n.label && (labelSet.has(n.key) || n.forceLabel)).map(n => `<text x="${(n.x + n.r + 3).toFixed(1)}" y="${(n.y + 4).toFixed(1)}">${esc(n.label)}</text>`).join('')}</g>
${legend}
<text x="${width - 12}" y="${height - 10}" text-anchor="end" font-size="10" fill="${t.muted}">${esc(ds.meta.name)} · Org Signal</text>
</svg>`;
}
