// Small UI helpers shared by the Build and Generate views.
// Browser-only (DOM); pure logic lives in src/builders/.

import { html, useState, useEffect, useRef } from '../../../vendor/preact.js';

// Load assets/build.css once. The shell owns index.html, so the views bring
// their own stylesheet. Resolved from this module's URL so it works wherever
// the app is served from.
let cssInjected = false;
export function ensureBuildCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const href = new URL('../../../assets/build.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.owner = 'ui-build';
  document.head.appendChild(link);
}

// ---- files ----

export function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(name, text, type = 'text/plain;charset=utf-8') {
  downloadBlob(name, new Blob([text], { type }));
}

export function readFileText(file) {
  return file.text ? file.text() : new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file);
  });
}

// Hidden file input opened from a button; resolves with the chosen File or null.
export function pickFile(accept = '') {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => { resolve(input.files?.[0] ?? null); input.remove(); };
    document.body.appendChild(input);
    input.click();
  });
}

// ---- storage: localStorage can throw (private mode, blocked site data) ----

export const storage = {
  get(key, fallback = null) {
    try { const s = localStorage.getItem(key); return s == null ? fallback : JSON.parse(s); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};

export function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// ---- components ----

// Accessible tab list: arrow keys move between tabs (roving tabindex).
export function Tabs({ tabs, value, onChange, label }) {
  const refs = useRef([]);
  const onKey = (e, i) => {
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabs.length - 1;
    if (j === null) return;
    e.preventDefault();
    onChange(tabs[j].id);
    refs.current[j]?.focus();
  };
  return html`<div class="ob-tabs" role="tablist" aria-label=${label}>
    ${tabs.map((t, i) => html`<button type="button" role="tab" class="ob-tab" id=${'obtab-' + t.id}
      aria-selected=${t.id === value ? 'true' : 'false'} aria-controls=${'obpanel-' + t.id}
      tabindex=${t.id === value ? 0 : -1} ref=${el => (refs.current[i] = el)}
      onClick=${() => onChange(t.id)} onKeyDown=${e => onKey(e, i)}>${t.label}</button>`)}
  </div>`;
}

// Numbered step list with a progress rule. steps: [{ id, label }]
export function Steps({ steps, value, onChange, done = [] }) {
  const idx = Math.max(0, steps.findIndex(s => s.id === value));
  return html`<nav aria-label="Steps" class="ob-stack" style="gap:.4rem">
    <ol class="ob-steps">
      ${steps.map(s => html`<li class=${done.includes(s.id) ? 'done' : ''} aria-current=${s.id === value ? 'step' : undefined}>
        <button type="button" onClick=${() => onChange(s.id)}>${s.label}</button></li>`)}
    </ol>
    <div class="ob-progress" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax=${steps.length} aria-valuenow=${idx + 1}>
      <span style=${`width:${((idx + 1) / steps.length) * 100}%`}></span>
    </div>
  </nav>`;
}

// Neutral placeholder for a dependency that is not in the build yet.
export function Unavailable({ title, children }) {
  return html`<div class="ob-unavailable" role="status">
    <span class="ob-meta">Not available yet</span>
    <strong>${title}</strong>
    ${children ? html`<p class="ob-note">${children}</p>` : null}
  </div>`;
}

// useState mirrored to localStorage (best effort).
export function usePersistentState(key, initial) {
  const [v, setV] = useState(() => storage.get(key, typeof initial === 'function' ? initial() : initial));
  useEffect(() => { storage.set(key, v); }, [key, v]);
  return [v, setV];
}

// Group colour by index: fixed order, never cycled (9th+ fold to neutral).
export function groupColor(i) {
  return i >= 0 && i < 8 ? `var(--grp-${i + 1})` : 'var(--grp-other)';
}

// The closing action of every builder: turn what was built into a Dataset and
// hand it to the analysis views. build() returns a Dataset or throws an Error
// whose message is shown to the user.
export function HandOffBar({ build, disabled, note, label = 'Analyze this network' }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async mode => {
    setErr(null); setBusy(true);
    try {
      const svc = await import('./service.js');
      const ds = await build();
      await svc.handOff(ds, { mode });
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };
  return html`<div class="ob-stack" style="gap:.4rem">
    <div class="ob-row">
      <button type="button" class="ob-btn primary" disabled=${disabled || busy} onClick=${() => run('replace')}>${label}</button>
      <button type="button" class="ob-btn" disabled=${disabled || busy} onClick=${() => run('add')}>Add to current data</button>
      ${note ? html`<span class="ob-note">${note}</span>` : null}
    </div>
    ${err ? html`<p class="ob-err" role="alert">${err}</p>` : null}
  </div>`;
}
