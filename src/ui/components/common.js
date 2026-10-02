// Small shared pieces: tooltips, metric names with their glossary,
// applicability flags, loading and error lines, downloads, and the hooks
// views use to ask the engine for results tied to the current network.

import { html, useState, useEffect, useRef, useCallback, useLayoutEffect } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { gloss } from '../services/glossary.js';

// ---- icons (simple strokes, no emoji) -------------------------------------
export const Icon = {
  caution: html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 L14.5 13.5 H1.5 Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.5 V9.5" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="11.6" r=".8" fill="currentColor"/></svg>`,
  na: html`<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.8 12.2 L12.2 3.8" stroke="currentColor" stroke-width="1.4"/></svg>`,
  error: html`<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 5.5 L10.5 10.5 M10.5 5.5 L5.5 10.5" stroke="currentColor" stroke-width="1.4"/></svg>`,
  ok: html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
  info: html`<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 7 V11.5" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="4.8" r=".8" fill="currentColor"/></svg>`,
  close: html`<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" stroke="currentColor" stroke-width="1.5"/></svg>`,
  sortAsc: html`<svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true"><path d="M1 7 L5 2.5 L9 7" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  sortDesc: html`<svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true"><path d="M1 3 L5 7.5 L9 3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
};

export function Flag({ level, children }) {
  const lvl = level === 'warn' ? 'caution' : level;
  const icon = Icon[lvl] || Icon.info;
  const text = children ?? ({ caution: 'Caution', na: 'Not applicable', error: 'Error', ok: 'OK', info: 'Note' })[lvl];
  return html`<span class=${`flag flag--${lvl}`}>${icon}<span>${text}</span></span>`;
}

// ---- tooltip --------------------------------------------------------------
// Shown on hover and on keyboard focus; positioned in the viewport so it
// never causes horizontal scroll.
export function Tip({ content, children, label, className = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const tipRef = useRef(null);
  const id = useRef(`tip-${Math.random().toString(36).slice(2, 9)}`).current;
  useLayoutEffect(() => {
    if (!open || !ref.current || !tipRef.current) return;
    const r = ref.current.getBoundingClientRect();
    const t = tipRef.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    let left = Math.min(Math.max(8, r.left), vw - t.width - 8);
    let top = r.bottom + 6;
    if (top + t.height > window.innerHeight - 8) top = Math.max(8, r.top - t.height - 6);
    if (!pos || pos.left !== left || pos.top !== top) setPos({ left, top });
  });
  useEffect(() => {
    if (!open) return;
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  return html`<span class=${`tip-wrap ${className}`} ref=${ref}
      onMouseEnter=${() => setOpen(true)} onMouseLeave=${() => { setOpen(false); setPos(null); }}>
    <button type="button" class="tip-trigger" aria-describedby=${open ? id : undefined} aria-label=${label}
      onFocus=${() => setOpen(true)} onBlur=${() => { setOpen(false); setPos(null); }}>${children}</button>
    ${open && html`<span role="tooltip" id=${id} class="tip" ref=${tipRef} style=${pos ? `left:${pos.left}px;top:${pos.top}px` : 'left:-9999px;top:0'}>${content}</span>`}
  </span>`;
}

export function applicabilityReason(a) {
  if (!a) return '';
  if (Array.isArray(a.reasons)) return a.reasons.join(' ');
  return a.reason || '';
}

// Metric name with its glossary meaning, reliability note and applicability.
export function MetricName({ metric, short = false, showFlag = true, iconOnly = false }) {
  const ap = useStore(s => s.applicability?.[metric]);
  const g = gloss(metric);
  const level = ap?.level || 'ok';
  const content = html`<strong>${g.label}</strong><p>${g.meaning}</p>${g.reliability && html`<p class="tip__rel">Reliability: ${g.reliability}</p>`}${level !== 'ok' && html`<p><${Flag} level=${level} /> ${applicabilityReason(ap)}</p>`}`;
  const flag = showFlag && level !== 'ok' && (iconOnly
    ? html` <span class=${`flag flag--${level}`} role="img" aria-label=${level === 'na' ? 'not applicable' : 'caution'}>${Icon[level] || Icon.info}</span>`
    : html` <${Flag} level=${level}>${level === 'na' ? 'n/a' : 'caution'}</${Flag}>`);
  return html`<span class=${iconOnly ? '' : 'nowrap'}><${Tip} content=${content} label=${`${g.label}: what it means`}>${short ? g.label.split(' (')[0] : g.label}</${Tip}>${flag}</span>`;
}

export function Loading({ children = 'Working' }) {
  return html`<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span><span>${children}</span></div>`;
}

export function ErrorLine({ error, onRetry }) {
  if (!error) return null;
  const msg = typeof error === 'string' ? error : error.message || String(error);
  return html`<div class="notice-line" role="alert"><${Flag} level="error" /><span class="grow">${msg}</span>${onRetry && html`<button class="btn btn--sm" onClick=${onRetry}>Try again</button>`}</div>`;
}

export function Unavailable({ what, children }) {
  return html`<div class="notice-line"><${Flag} level="na">Not available yet</${Flag}><span class="grow">${children || `${what} is not available in this build.`}</span></div>`;
}

export function Swatch({ color, square = false }) {
  return html`<span class=${`swatch${square ? ' swatch--sq' : ''}`} style=${`background:${color}`} aria-hidden="true"></span>`;
}

export function Select({ label, value, onChange, options, id, className = '', disabled = false }) {
  return html`<label class=${`field ${className}`}>
    <span>${label}</span>
    <select class="select" id=${id} value=${value} disabled=${disabled} onChange=${e => onChange(e.currentTarget.value)}>
      ${options.map(o => (o.group
        ? html`<optgroup label=${o.group}>${o.options.map(x => html`<option value=${x.value} disabled=${x.disabled}>${x.label}</option>`)}</optgroup>`
        : html`<option value=${o.value} disabled=${o.disabled}>${o.label}</option>`))}
    </select>
  </label>`;
}

export function Seg({ label, value, onChange, options }) {
  return html`<div class="field"><span id=${`seg-${label}`}>${label}</span>
    <div class="seg" role="group" aria-labelledby=${`seg-${label}`}>
      ${options.map(o => html`<button type="button" aria-pressed=${String(value === o.value)} onClick=${() => onChange(o.value)}>${o.label}</button>`)}
    </div></div>`;
}

// ---- downloads -------------------------------------------------------------
export function download(text, filename, mime = 'text/plain') {
  const blob = text instanceof Blob ? text : new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---- engine queries tied to the current network ---------------------------
// Results are cached per network version and key so switching views does not
// recompute, and are dropped when the network is rebuilt.
const cache = new Map();
let cacheVersion = null;

export function useEngine(key, fn, deps = [], { enabled = true, label = null } = {}) {
  const version = useStore(s => s.network?.version ?? null);
  const full = `${key}|${JSON.stringify(deps)}`;
  if (cacheVersion !== version) { cache.clear(); cacheVersion = version; }
  const [state, setState] = useState(() => (cache.has(full) ? { data: cache.get(full), loading: false, error: null } : { data: null, loading: enabled && version != null, error: null }));
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled || version == null) { setState({ data: null, loading: false, error: null }); return; }
    if (cache.has(full)) { setState({ data: cache.get(full), loading: false, error: null }); return; }
    let live = true;
    const ctrl = new AbortController();
    setState(s => ({ data: s.data, loading: true, error: null }));
    const run = label ? store.actions.runJob(label, (signal, progress) => fn({ signal, onProgress: progress })) : fn({ signal: ctrl.signal });
    Promise.resolve(run).then(
      data => { if (cacheVersion === version) cache.set(full, data); if (live) setState({ data, loading: false, error: null }); },
      error => { if (live) setState({ data: null, loading: false, error: error?.name === 'AbortError' ? null : error }); },
    );
    return () => { live = false; ctrl.abort(); };
  }, [version, full, enabled, nonce]);
  return { ...state, retry: useCallback(() => { cache.delete(full); setNonce(n => n + 1); }, [full]) };
}

export function invalidateEngineCache() { cache.clear(); }

// Focus the view heading when a view mounts, for keyboard and screen readers.
export function useFocusHeading(ref) {
  useEffect(() => {
    if (store.get().__focusOnView && ref.current) { ref.current.focus({ preventScroll: false }); store.set({ __focusOnView: false }); }
  }, []);
}

export function ViewHead({ title, intro, actions, hiddenTitle = false }) {
  const ref = useRef(null);
  useFocusHeading(ref);
  return html`<header class=${hiddenTitle ? 'visually-hidden' : 'view__head'}>
    <div class="grow">
      <h1 class="view__title" tabindex="-1" ref=${ref}>${title}</h1>
      ${intro && html`<p class="view__intro">${intro}</p>`}
    </div>
    ${actions && html`<div class="view__actions">${actions}</div>`}
  </header>`;
}

// Shown in analysis views when no dataset is loaded.
export function NeedsData({ title }) {
  return html`<div class="view view--col">
    <${ViewHead} title=${title} />
    <div class="empty">
      <h2>No network yet</h2>
      <p class="lead">Import data, build a network by hand, or generate a synthetic one. This view fills in once a network is loaded.</p>
      <div class="row" style="margin-top:1.25rem">
        <button class="btn btn--primary" onClick=${() => store.actions.setView('data')}>Import data</button>
        <button class="btn" onClick=${() => store.actions.setView('build')}>Build by hand</button>
        <button class="btn" onClick=${() => store.actions.setView('generate')}>Generate</button>
      </div>
    </div>
  </div>`;
}

export function ConstructionButton() {
  return html`<button class="btn" onClick=${() => store.actions.openDrawer()} aria-haspopup="dialog">Construction settings</button>`;
}
