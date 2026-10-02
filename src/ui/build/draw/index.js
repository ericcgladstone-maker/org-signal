// Draw your own network: the editor shell.
//
// State lives here (document history, selection, view, snapping settings,
// transient drag/animation positions); canvas.js renders and turns pointer
// gestures into calls on `ctl`; inspector.js and table.js edit through
// apply(fn, label). The document model and all geometry are pure functions
// in src/builders/draw*.js, tested in Node.

import { html, useState, useEffect, useRef, useMemo } from '../../../../vendor/preact.js';
import * as D from '../../../builders/draw.js';
import { runLayout, LAYOUTS, concentricKeys } from '../../../builders/draw-layout.js';
import { snapPoint } from '../../../builders/draw-snap.js';
import { uid, slug } from '../../../builders/common.js';
import { HandOffBar, storage, downloadText, pickFile, readFileText, prefersReducedMotion } from '../shared.js';
import { notify } from '../service.js';
import { Canvas, clampK, NODE_R } from './canvas.js';
import { Inspector } from './inspector.js';
import { TableEditor } from './table.js';
import { HelpOverlay } from './help.js';
import { exampleDoc } from './example.js';

const DRAFT_KEY = 'orgsignal.build.draw.draft';
const SETTINGS_KEY = 'orgsignal.build.draw.settings';
const ANIM_MS = 400;
const MODES = [['select', 'Select', 'V'], ['node', 'Add node', 'B'], ['edge', 'Connect', 'C'], ['pan', 'Pan', 'H']];

function loadDraft() {
  const raw = storage.get(DRAFT_KEY, null);
  if (!raw) return null;
  const { doc } = D.validateDoc(raw);
  return doc;
}

export function DrawEditor() {
  const [hist, setHist] = useState(() => D.createHistory(loadDraft() || D.emptyDoc()));
  const doc = hist.present;
  const [sel, setSel] = useState({ nodes: [], edges: [] });
  const [focusId, setFocus] = useState(null);
  const [mode, setMode] = useState('select');
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [settings, setSettings] = useState(() => ({ grid: false, gridSize: 20, guides: true, showGrid: true, ...storage.get(SETTINGS_KEY, {}) }));
  const [live, setLive] = useState(null);
  const [guides, setGuides] = useState([]);
  const [marquee, setMarquee] = useState(null);
  const [rubber, setRubber] = useState(null);
  const [pending, setPending] = useState(null);
  const [editing, setEditing] = useState(null);
  const [table, setTable] = useState(false);
  const [help, setHelp] = useState(false);
  const [layout, setLayout] = useState({ id: 'force', root: '', key: 'degree', scope: 'auto' });
  const [edgeDefaults, setEdgeDefaults] = useState({ type: D.DEFAULT_EDGE_TYPE, directed: false });
  const [announce, setAnnounce] = useState('');
  const [saved, setSaved] = useState(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const wrapRef = useRef(null), canvasRef = useRef(null), layoutSel = useRef(null), clip = useRef(null), anim = useRef(0), pasteCount = useRef(0);
  // Keyboard multi-select: once Space is used, Tab moves focus without
  // replacing the selection, so Tab-Space-Tab-Space builds a selection.
  const pinned = useRef(false);

  // Latest state for gesture and key handlers (avoids stale closures).
  const st = useRef();
  st.current = { doc, sel, view, mode, settings, live, pending, focusId, spaceDown, size, edgeDefaults };

  const apply = (fn, label) => setHist(h => D.commit(h, fn(h.present), label));
  const say = t => setAnnounce(t);

  // ---- autosave ----
  useEffect(() => {
    const t = setTimeout(() => setSaved(storage.set(DRAFT_KEY, doc)), 300);
    return () => clearTimeout(t);
  }, [doc]);
  useEffect(() => { storage.set(SETTINGS_KEY, settings); }, [settings]);

  // Drop selection entries that no longer exist (after undo, delete, import).
  useEffect(() => {
    const nodeIds = new Set(doc.nodes.map(n => n.id)), edgeIds = new Set(doc.edges.map(e => e.id));
    if (sel.nodes.some(id => !nodeIds.has(id)) || sel.edges.some(id => !edgeIds.has(id))) {
      setSel({ nodes: sel.nodes.filter(id => nodeIds.has(id)), edges: sel.edges.filter(id => edgeIds.has(id)) });
    }
    if (focusId && !nodeIds.has(focusId)) setFocus(null);
    if (pending && !nodeIds.has(pending)) setPending(null);
    if (edgeDefaults.type && !doc.edgeTypes.includes(edgeDefaults.type)) setEdgeDefaults({ ...edgeDefaults, type: doc.edgeTypes[0] });
  }, [doc]);

  // ---- canvas size, initial fit ----
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize(s => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && size.w) { fitted.current = true; fit(); }
  }, [size.w]);

  function fit(d = st.current.doc) {
    const { w, h } = st.current.size.w ? st.current.size : size;
    if (!w) return;
    const b = D.bounds(d.nodes);
    if (!b) { setView({ x: w / 2, y: h / 2, k: 1 }); return; }
    const pad = w < 600 ? 36 : 60;
    const k = clampK(Math.min((w - 2 * pad) / Math.max(b.w, 1), (h - 2 * pad) / Math.max(b.h, 1), 1.5));
    setView({ k, x: w / 2 - (b.x + b.w / 2) * k, y: h / 2 - (b.y + b.h / 2) * k });
  }

  function zoomBy(f) {
    const { w, h } = size;
    setView(v => { const k = clampK(v.k * f); const cx = w / 2, cy = h / 2; return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k }; });
  }

  function viewCentre() {
    const { w, h } = st.current.size;
    const v = st.current.view;
    return { x: (w / 2 - v.x) / v.k, y: (h / 2 - v.y) / v.k };
  }

  // ---- commands ----
  function addNodeAt(p, { rename = false } = {}) {
    const s = st.current;
    let q = s.settings.grid || s.settings.guides
      ? snapPoint(p, s.doc.nodes, { grid: s.settings.grid, gridSize: s.settings.gridSize, guides: s.settings.guides, threshold: 6 / s.view.k }) : p;
    q = { x: q.x, y: q.y };
    // Never stack a new node exactly on another one.
    const step = s.settings.grid ? s.settings.gridSize * 2 : 40;
    while (s.doc.nodes.some(n => Math.abs(n.x - q.x) < NODE_R * 2 && Math.abs(n.y - q.y) < NODE_R * 2)) q.x += step;
    const id = uid('n');
    const label = D.nextLabel(s.doc);
    apply(d => D.addNode(d, { id, x: q.x, y: q.y, label }), 'Add node');
    setSel({ nodes: [id], edges: [] });
    setFocus(id);
    say(`Added ${label}.`);
    if (rename) setTimeout(() => startRename(id), 0);
    return id;
  }

  function addEdge(source, target) {
    const s = st.current;
    const before = s.doc.edges.length;
    const d2 = D.addEdge(s.doc, { source, target, type: s.edgeDefaults.type, directed: s.edgeDefaults.directed });
    if (d2.edges.length === before) { say('That tie already exists.'); return; }
    const e = d2.edges[d2.edges.length - 1];
    apply(d => D.addEdge(d, { id: e.id, source, target, type: e.type, directed: e.directed }), 'Add tie');
    setSel({ nodes: [], edges: [e.id] });
    say(`Connected ${D.nodeById(s.doc, source)?.label} ${e.directed ? 'to' : 'and'} ${D.nodeById(s.doc, target)?.label}.`);
  }

  function deleteSelection() {
    const s = st.current;
    const nodes = s.sel.nodes.length || s.sel.edges.length ? s.sel.nodes : s.focusId ? [s.focusId] : [];
    const edges = s.sel.edges;
    if (!nodes.length && !edges.length) return;
    apply(d => D.removeEdges(D.removeNodes(d, nodes), edges), 'Delete');
    setSel({ nodes: [], edges: [] });
    say(`Deleted ${nodes.length} node${nodes.length === 1 ? '' : 's'}${edges.length ? ` and ${edges.length} tie${edges.length === 1 ? '' : 's'}` : ''}.`);
  }

  function startRename(id) {
    const n = D.nodeById(st.current.doc, id);
    if (!n) return;
    if (table) return;
    setEditing({ id, value: n.label });
  }

  function commitRename(save) {
    if (editing && save) {
      const v = editing.value.trim();
      if (v) apply(d => D.updateNode(d, editing.id, { label: v }), 'Rename');
    }
    setEditing(null);
    canvasRef.current?.querySelector('svg')?.focus({ preventScroll: true });
  }

  function copy() {
    const s = st.current;
    if (!s.sel.nodes.length) return;
    clip.current = D.copySelection(s.doc, s.sel.nodes);
    pasteCount.current = 0;
    say(`Copied ${s.sel.nodes.length} node${s.sel.nodes.length === 1 ? '' : 's'}.`);
  }

  function pasteClip(c = clip.current) {
    if (!c?.nodes?.length) return;
    pasteCount.current += 1;
    const res = D.paste(st.current.doc, c, { offset: 30 * pasteCount.current });
    // Re-run paste inside apply on the same ids so history gets exactly this result.
    apply(() => res.doc, 'Paste');
    setSel({ nodes: res.ids, edges: [] });
    say(`Pasted ${res.ids.length} node${res.ids.length === 1 ? '' : 's'}.`);
  }

  function nudge(dx, dy) {
    const s = st.current;
    const ids = s.sel.nodes.length ? s.sel.nodes : s.focusId ? [s.focusId] : [];
    if (!ids.length) { setView(v => ({ ...v, x: v.x - dx * 2, y: v.y - dy * 2 })); return; }
    const m = new Map(ids.map(id => { const n = D.nodeById(s.doc, id); return [id, { x: n.x + dx, y: n.y + dy }]; }));
    apply(d => D.moveNodes(d, m), 'Nudge');
  }

  // Animate to target positions, then commit once (one undo step).
  function animateTo(target, label) {
    cancelAnimationFrame(anim.current);
    const d0 = st.current.doc;
    if (prefersReducedMotion()) { apply(d => D.moveNodes(d, target), label); return; }
    const from = new Map([...target.keys()].map(id => { const n = D.nodeById(d0, id); return [id, { x: n.x, y: n.y }]; }));
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / ANIM_MS);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const m = new Map();
      for (const [id, p] of target) { const f = from.get(id); m.set(id, { x: f.x + (p.x - f.x) * e, y: f.y + (p.y - f.y) * e }); }
      setLive(m);
      if (t < 1) anim.current = requestAnimationFrame(step);
      else { setLive(null); apply(d => D.moveNodes(d, target), label); }
    };
    anim.current = requestAnimationFrame(step);
  }

  const useSelection = layout.scope === 'all' ? false : sel.nodes.length >= 2;
  function applyLayout() {
    const s = st.current;
    const all = !useSelection;
    const ids = all ? s.doc.nodes.map(n => n.id) : s.sel.nodes;
    if (!ids.length) { say('Nothing to lay out yet.'); return; }
    const root = layout.root && ids.includes(layout.root) ? layout.root : (s.sel.nodes[0] && ids.includes(s.sel.nodes[0]) ? s.sel.nodes[0] : undefined);
    const target = runLayout(s.doc, layout.id, ids, { all, root, key: layout.key, seed: 7 });
    if (s.settings.grid) for (const [id, p] of target) target.set(id, { x: Math.round(p.x / s.settings.gridSize) * s.settings.gridSize, y: Math.round(p.y / s.settings.gridSize) * s.settings.gridSize });
    const name = LAYOUTS.find(l => l.id === layout.id).label;
    animateTo(target, `Layout: ${name}`);
    say(`${name} layout applied to ${all ? 'the whole drawing' : `${ids.length} selected nodes`}.`);
  }

  function doUndo() { setHist(h => { if (D.canUndo(h)) say(`Undid ${D.undoLabel(h)}.`); return D.undo(h); }); }
  function doRedo() { setHist(h => { if (D.canRedo(h)) say(`Redid ${D.redoLabel(h)}.`); return D.redo(h); }); }

  function loadDoc(d, label) {
    apply(() => d, label);
    setSel({ nodes: [], edges: [] });
    setFocus(null);
    setTimeout(() => fit(d), 0);
  }

  async function importFile() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    const { doc: d, errors, warnings } = D.importJSON(await readFileText(f));
    if (!d) { notify('error', `Could not import ${f.name}: ${errors.join(' ')}`); return; }
    loadDoc(d, 'Import drawing');
    const extra = [...errors, ...warnings];
    notify(extra.length ? 'warn' : 'info', `Imported ${f.name}: ${d.nodes.length} nodes, ${d.edges.length} ties.${extra.length ? ' ' + extra.slice(0, 3).join(' ') + (extra.length > 3 ? ` (+${extra.length - 3} more)` : '') : ''}`);
  }

  // ---- keyboard ----
  function onKeyDown(e) {
    const t = e.target;
    if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (help) return;
    const s = st.current;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;
    const onCanvas = t.closest?.('.ob-canvas');
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (mod) {
      const k = key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { handled(); doUndo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { handled(); doRedo(); }
      else if (k === 'c' && onCanvas) { handled(); copy(); }
      else if (k === 'v' && onCanvas) { handled(); pasteClip(); }
      else if (k === 'd' && onCanvas) { handled(); if (s.sel.nodes.length) { pasteCount.current = 0; pasteClip(D.copySelection(s.doc, s.sel.nodes)); } }
      else if (k === 'a' && onCanvas) { handled(); setSel({ nodes: s.doc.nodes.map(n => n.id), edges: [] }); say(`Selected all ${s.doc.nodes.length} nodes.`); }
      return;
    }
    if (key === '?') { handled(); setHelp(true); return; }
    if (key === 't' || key === 'T') { handled(); setTable(x => !x); return; }
    if (key === 'l' || key === 'L') { handled(); layoutSel.current?.focus(); return; }
    if (!onCanvas) return;
    switch (key) {
      case 'v': case 'V': handled(); setMode('select'); say('Select mode.'); break;
      case 'b': case 'B': handled(); setMode('node'); say('Add-node mode: click the canvas to place a node.'); break;
      case 'c': case 'C': handled(); setMode('edge'); say('Connect mode: drag from one node to another.'); break;
      case 'h': case 'H': handled(); setMode('pan'); say('Pan mode.'); break;
      case 'n': case 'N': handled(); addNodeAt(viewCentre()); break;
      case 'g': case 'G': handled(); setSettings(x => ({ ...x, grid: !x.grid })); say(`Snap to grid ${s.settings.grid ? 'off' : 'on'}.`); break;
      case '+': case '=': handled(); zoomBy(1.25); break;
      case '-': case '_': handled(); zoomBy(0.8); break;
      case '0': handled(); fit(); break;
      case 'Escape': handled(); pinned.current = false; setSel({ nodes: [], edges: [] }); setFocus(null); setPending(null); setMode('select'); break;
      case 'Delete': case 'Backspace': handled(); deleteSelection(); break;
      case 'Enter': case 'F2': { const id = s.focusId || s.sel.nodes[0]; if (id) { handled(); startRename(id); } break; }
      case 'e': case 'E': {
        handled();
        let ids = s.sel.nodes;
        if (ids.length === 1 && s.focusId && s.focusId !== ids[0]) ids = [ids[0], s.focusId];
        if (ids.length < 2) { say('Select two or more nodes to connect (Space adds the focused node).'); break; }
        if (ids.length === 2) addEdge(ids[0], ids[1]);
        else { apply(d => D.connectPath(d, ids, { type: s.edgeDefaults.type, directed: s.edgeDefaults.directed }), 'Connect'); say(`Connected ${ids.length} nodes in order.`); }
        break;
      }
      case ' ': {
        handled();
        if (!s.focusId) break;
        const has = s.sel.nodes.includes(s.focusId);
        const label = D.nodeById(s.doc, s.focusId).label;
        if (!pinned.current) {
          // First Space keeps what Tab selected and starts a multi-selection.
          pinned.current = true;
          if (!has) setSel({ nodes: [...s.sel.nodes, s.focusId], edges: [] });
          say(`${label} kept in the selection; Tab moves on, Space adds or removes.`);
          break;
        }
        setSel({ nodes: has ? s.sel.nodes.filter(x => x !== s.focusId) : [...s.sel.nodes, s.focusId], edges: [] });
        say(`${label} ${has ? 'removed from' : 'added to'} the selection.`);
        break;
      }
      case 'Tab': {
        const ns = s.doc.nodes;
        if (!ns.length) break;
        const i = ns.findIndex(n => n.id === s.focusId);
        const j = e.shiftKey ? (i < 0 ? ns.length - 1 : i - 1) : i + 1;
        if (j < 0 || j >= ns.length) { setFocus(null); break; } // let focus leave the canvas
        handled();
        const n = ns[j];
        setFocus(n.id);
        if (!pinned.current) setSel({ nodes: [n.id], edges: [] });
        ensureVisible(n);
        say(`${n.label}, node ${j + 1} of ${ns.length}${n.group ? ', group ' + (D.groupById(s.doc, n.group)?.name ?? '') : ''}, ${s.doc.edges.filter(x => x.source === n.id || x.target === n.id).length} ties.`);
        break;
      }
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        handled();
        const stepPx = (s.settings.grid ? s.settings.gridSize : 10) * (e.shiftKey ? 5 : 1);
        nudge(key === 'ArrowLeft' ? -stepPx : key === 'ArrowRight' ? stepPx : 0, key === 'ArrowUp' ? -stepPx : key === 'ArrowDown' ? stepPx : 0);
        break;
      }
      default:
    }
  }

  function ensureVisible(n) {
    const { w, h } = st.current.size;
    const v = st.current.view;
    const sx = n.x * v.k + v.x, sy = n.y * v.k + v.y;
    if (sx < 40 || sx > w - 40 || sy < 40 || sy > h - 40) setView({ ...v, x: w / 2 - n.x * v.k, y: h / 2 - n.y * v.k });
  }

  // Space held = temporary pan (like design tools). Tracked on the window so
  // releasing outside the canvas still clears it.
  useEffect(() => {
    const down = e => { if (e.key === ' ' && e.target.closest?.('.ob-canvas') && !st.current.focusId) setSpaceDown(true); };
    const up = e => { if (e.key === ' ') setSpaceDown(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); cancelAnimationFrame(anim.current); };
  }, []);

  const ctl = useMemo(() => ({}), []);
  Object.assign(ctl, {
    get: () => st.current,
    setView, setSel: v => { pinned.current = false; setSel(v); }, setLive, setGuides, setMarquee, setRubber, setPending, setFocus,
    commitMove: m => apply(d => D.moveNodes(d, m), 'Move'),
    addNodeAt, addEdge, startRename,
    onCanvasFocus: () => {},
  });

  // ---- render ----
  const nodeIds = doc.nodes.map(n => n.id);
  const keys = concentricKeys(doc);
  const editPos = editing && (() => { const n = D.nodeById(doc, editing.id); return n ? { left: n.x * view.k + view.x - 64, top: n.y * view.k + view.y + 12 } : null; })();
  const modeLabel = MODES.find(m => m[0] === mode)[1];

  return html`<div class="ob-stack ob-draw" ref=${wrapRef} onKeyDown=${onKeyDown}>
    <div class="ob-row ob-draw-file">
      <button type="button" class="ob-btn sm" onClick=${() => loadDoc(D.emptyDoc(), 'New drawing')}>New</button>
      <button type="button" class="ob-btn sm" onClick=${() => loadDoc(exampleDoc(), 'Load example')}>Load example</button>
      <button type="button" class="ob-btn sm" onClick=${importFile}>Import JSON</button>
      <button type="button" class="ob-btn sm" disabled=${!doc.nodes.length} onClick=${() => downloadText(`${slug(doc.name)}.drawing.json`, D.exportJSON(doc), 'application/json')}>Export JSON</button>
      <span class="ob-spacer"></span>
      <button type="button" class="ob-btn sm" aria-pressed=${table ? 'true' : 'false'} onClick=${() => setTable(x => !x)}>Table view</button>
      <button type="button" class="ob-btn sm" onClick=${() => setHelp(true)} aria-label="Keyboard shortcuts">Shortcuts ?</button>
    </div>

    ${table ? null : html`<div class="ob-toolbar" role="toolbar" aria-label="Drawing tools">
      <div class="ob-row" role="group" aria-label="Mode" style="gap:.3rem">
        ${MODES.map(([id, label, k]) => html`<button type="button" class="ob-btn sm" aria-pressed=${mode === id ? 'true' : 'false'} title=${`${label} (${k})`}
          onClick=${() => { setMode(id); setPending(null); }}>${label}</button>`)}
      </div>
      <span class="ob-sep" aria-hidden="true"></span>
      <button type="button" class="ob-btn sm" disabled=${!D.canUndo(hist)} onClick=${doUndo} title=${D.undoLabel(hist) ? 'Undo ' + D.undoLabel(hist) : 'Undo'}>Undo</button>
      <button type="button" class="ob-btn sm" disabled=${!D.canRedo(hist)} onClick=${doRedo} title=${D.redoLabel(hist) ? 'Redo ' + D.redoLabel(hist) : 'Redo'}>Redo</button>
      <button type="button" class="ob-btn sm" disabled=${!sel.nodes.length && !sel.edges.length} onClick=${deleteSelection}>Delete</button>
      <span class="ob-sep" aria-hidden="true"></span>
      <button type="button" class="ob-btn sm" aria-pressed=${settings.grid ? 'true' : 'false'} onClick=${() => setSettings(x => ({ ...x, grid: !x.grid }))} title="Snap to grid (G)">Snap to grid</button>
      <select class="ob-select sm" style="width:auto" aria-label="Grid size" value=${settings.gridSize} onChange=${e => setSettings(x => ({ ...x, gridSize: +e.currentTarget.value }))}>
        ${[10, 20, 25, 40, 50].map(v => html`<option value=${v}>${v} px</option>`)}</select>
      <button type="button" class="ob-btn sm" aria-pressed=${settings.guides ? 'true' : 'false'} onClick=${() => setSettings(x => ({ ...x, guides: !x.guides }))} title="Snap to other nodes">Guides</button>
      <span class="ob-sep" aria-hidden="true"></span>
      <div class="ob-row ob-draw-layout" role="group" aria-label="Layout" style="gap:.3rem">
        <select class="ob-select sm" style="width:auto" ref=${layoutSel} aria-label="Layout (L)" value=${layout.id} onChange=${e => setLayout({ ...layout, id: e.currentTarget.value })}>
          ${LAYOUTS.map(l => html`<option value=${l.id}>${l.label}</option>`)}</select>
        ${layout.id === 'tree' ? html`<select class="ob-select sm" style="width:auto;max-width:9rem" aria-label="Tree root" value=${layout.root} onChange=${e => setLayout({ ...layout, root: e.currentTarget.value })}>
          <option value="">Root: first selected</option>${doc.nodes.map(n => html`<option value=${n.id}>${n.label}</option>`)}</select>` : null}
        ${layout.id === 'concentric' ? html`<select class="ob-select sm" style="width:auto" aria-label="Rings by" value=${layout.key} onChange=${e => setLayout({ ...layout, key: e.currentTarget.value })}>
          ${keys.map(k => html`<option value=${k}>By ${k}</option>`)}</select>` : null}
        ${sel.nodes.length >= 2 ? html`<select class="ob-select sm" style="width:auto" aria-label="Apply layout to" value=${layout.scope === 'all' ? 'all' : 'auto'} onChange=${e => setLayout({ ...layout, scope: e.currentTarget.value })}>
          <option value="auto">Selection (${sel.nodes.length})</option><option value="all">Whole drawing</option></select>` : null}
        <button type="button" class="ob-btn sm" disabled=${!doc.nodes.length} onClick=${applyLayout}>Apply layout</button>
      </div>
      ${mode === 'edge' ? html`<span class="ob-sep" aria-hidden="true"></span>
        <div class="ob-row" style="gap:.4rem"><span class="ob-label">New ties</span>
          <select class="ob-select sm" style="width:auto" aria-label="Type of new ties" value=${edgeDefaults.type} onChange=${e => setEdgeDefaults({ ...edgeDefaults, type: e.currentTarget.value })}>
            ${doc.edgeTypes.map(t => html`<option value=${t}>${t}</option>`)}</select>
          <label class="ob-check"><input type="checkbox" checked=${edgeDefaults.directed} onChange=${e => setEdgeDefaults({ ...edgeDefaults, directed: e.currentTarget.checked })} /> Directed</label></div>` : null}
    </div>`}

    <div class="ob-editor">
      ${table
        ? html`<div class="ob-draw-tablecol"><${TableEditor} doc=${doc} apply=${apply} edgeDefaults=${edgeDefaults} /></div>`
        : html`<div class=${'ob-canvas mode-' + mode + (spaceDown ? ' panning' : '')} ref=${canvasRef}>
          <${Canvas} doc=${doc} live=${live} sel=${sel} focusId=${focusId} pending=${pending} view=${view} size=${size}
            settings=${settings} guides=${guides} marquee=${marquee} rubber=${rubber} ctl=${ctl} mode=${mode} />
          ${doc.nodes.length ? null : html`<div class="ob-hint"><p>Press N, double-click, or choose Add node and click here to place a node.<br />Or load the example above.</p></div>`}
          ${editPos ? html`<input class="ob-input ob-label-edit" style=${`left:${Math.max(4, editPos.left)}px;top:${editPos.top}px;width:8rem`} aria-label="Node label"
            value=${editing.value} ref=${el => el && document.activeElement !== el && (el.focus(), el.select())}
            onInput=${e => setEditing({ ...editing, value: e.currentTarget.value })}
            onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); commitRename(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commitRename(false); } }}
            onBlur=${() => commitRename(true)} />` : null}
          <div class="ob-status" aria-hidden="true">${modeLabel}${pending ? ' · from ' + (D.nodeById(doc, pending)?.label ?? '') : ''} · ${Math.round(view.k * 100)}%${settings.grid ? ' · grid ' + settings.gridSize : ''}</div>
          <div class="ob-zoom">
            <button type="button" class="ob-btn sm" aria-label="Zoom out" onClick=${() => zoomBy(0.8)}>−</button>
            <button type="button" class="ob-btn sm" aria-label="Zoom in" onClick=${() => zoomBy(1.25)}>+</button>
            <button type="button" class="ob-btn sm" onClick=${() => fit()}>Fit</button>
          </div>
        </div>`}
      <aside class="ob-inspector" aria-label="Selection details">
        <${Inspector} doc=${doc} sel=${sel} apply=${apply} setSel=${setSel} edgeDefaults=${edgeDefaults} setEdgeDefaults=${setEdgeDefaults} onRename=${startRename} />
      </aside>
    </div>

    <p id="ob-draw-live" class="visually-hidden" aria-live="polite">${announce}</p>
    <div class="ob-row">
      <span class="ob-note">${doc.nodes.length} nodes, ${doc.edges.length} ties. ${saved === false ? 'Autosave is not available in this browser; export the drawing to keep it.' : 'Draft saved in this browser.'}</span>
    </div>
    <${HandOffBar} disabled=${!nodeIds.length} build=${() => D.toDataset(doc, { name: doc.name })}
      note=${doc.nodes.length ? 'Becomes a full network of declared ties (context: custom).' : 'Add nodes first.'} />
    ${help ? html`<${HelpOverlay} onClose=${() => setHelp(false)} />` : null}
  </div>`;
}

export default DrawEditor;
