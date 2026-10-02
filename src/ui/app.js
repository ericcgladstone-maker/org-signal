// Application shell: masthead with primary navigation, the active view, the
// construction drawer, notices and the job status bar. Mounted from
// index.html. Views are loaded lazily so a missing optional module (another
// owner's work still landing) only affects its own view.

import { html, render, useState, useEffect, useRef } from '../../vendor/preact.js';
import { store, useStore } from './store.js';
import { registerActions, VIEWS } from './actions.js';
import { initEngine, engineStatus } from './services/engine.js';
import { MOCK, mockSize } from './services/modules.js';
import { Icon, Loading, ErrorLine, ViewHead } from './components/common.js';
import { hasText } from './lib/dsutil.js';

const loaders = {
  data: () => import('./views/data.js').then(m => m.DataView),
  network: () => import('./views/network.js').then(m => m.NetworkView),
  people: () => import('./views/people.js').then(m => m.PeopleView),
  groups: () => import('./views/groups.js').then(m => m.GroupsView),
  content: () => import('./views/content.js').then(m => m.ContentView),
  time: () => import('./views/time.js').then(m => m.TimeView),
  ask: () => import('./views/ask.js').then(m => m.AskView),
  methods: () => import('./views/methods.js').then(m => m.MethodsView),
  build: () => import('./views/external.js').then(m => m.BuildMount),
  generate: () => import('./views/external.js').then(m => m.GenerateMount),
};
const loaded = {};

function Header() {
  const view = useStore(s => s.view);
  const ds = useStore(s => s.dataset);
  // Content is only offered when there is message text to measure.
  const noText = !!ds && !hasText(ds);
  const open = useStore(s => !!s.ui?.menuOpen);
  const btn = useRef(null);
  const nav = useRef(null);
  const setOpen = v => store.set({ ui: { ...(store.get().ui || {}), menuOpen: v } });
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const onClick = e => { if (!nav.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onClick); };
  }, [open]);
  const go = (e, id) => { e.preventDefault(); store.actions.setView(id); };
  return html`<header class="app-header">
    <div class="app-header__inner">
      <a class="brand" href="#data" onClick=${e => go(e, 'data')}>
        <span class="brand__name">Org Signal</span>
        <span class="brand__desc">Network measurement from relational traces</span>
      </a>
      <button class="menu-btn" ref=${btn} type="button" aria-label="Menu" aria-expanded=${String(open)} aria-controls="appNav" onClick=${() => setOpen(!open)}>
        <span class="menu-btn__bars" aria-hidden="true"></span>
      </button>
      <nav class="app-nav" id="appNav" ref=${nav} aria-label="Views" data-open=${String(open)}>
        <ul>
          ${VIEWS.map(v => html`${v.sep && html`<li class="sep" aria-hidden="true"></li>`}<li><a href=${`#${v.id}`} aria-current=${view === v.id ? 'page' : undefined} aria-disabled=${v.id === 'content' && noText ? 'true' : undefined} title=${v.id === 'content' && noText ? 'This data has no message text' : undefined} onClick=${e => go(e, v.id)}>${v.label}</a></li>`)}
        </ul>
      </nav>
    </div>
  </header>`;
}

function StatusBar() {
  const jobs = useStore(s => s.jobs);
  const ref = useRef(null);
  useEffect(() => {
    const h = jobs.length && ref.current ? ref.current.offsetHeight : 0;
    document.documentElement.style.setProperty('--status-h', `${h}px`);
  }, [jobs.length]);
  if (!jobs.length) return null;
  return html`<div class="status" ref=${ref} role="region" aria-label="Running jobs">
    ${jobs.map(j => {
      const indet = !(j.progress > 0);
      const pct = indet ? '' : `${Math.round(j.progress * 100)}%`;
      return html`<div class="status__job" key=${j.id}>
        <span class=${`status__bar${indet ? ' status__bar--indet' : ''}`} style=${indet ? '' : `width:${Math.max(2, j.progress * 100)}%`} aria-hidden="true"></span>
        <span class="spinner" aria-hidden="true"></span>
        <span class="status__label" role="status" aria-live="polite">${j.label}${j.message ? html`<span class="muted"> · ${j.message}</span>` : ''}</span>
        <span class="status__pct">${pct}</span>
        ${j.cancel && html`<button class="btn btn--sm" onClick=${() => j.cancel()}>Cancel</button>`}
      </div>`;
    })}
  </div>`;
}

function Notices() {
  const notices = useStore(s => s.notices || []);
  return html`<div class="notices" aria-live="polite" aria-relevant="additions">
    ${notices.map(n => html`<div class=${`notice notice--${n.level}`} key=${n.id} role=${n.level === 'error' ? 'alert' : 'status'}>
      <span class=${`flag flag--${n.level === 'warn' ? 'caution' : n.level === 'error' ? 'error' : 'ok'}`}>${n.level === 'warn' ? Icon.caution : n.level === 'error' ? Icon.error : Icon.info}</span>
      <span class="grow">${n.text}</span>
      <button class="btn btn--quiet btn--sm" aria-label="Dismiss notice" onClick=${() => store.actions.dismiss(n.id)}>${Icon.close}</button>
    </div>`)}
  </div>`;
}

function ViewHost() {
  const view = useStore(s => s.view);
  const [, force] = useState(0);
  const [error, setError] = useState(null);
  useEffect(() => {
    setError(null);
    if (loaded[view]) return;
    let live = true;
    loaders[view]().then(C => { loaded[view] = C; if (live) force(x => x + 1); }, e => { console.error(e); if (live) setError(e); });
    return () => { live = false; };
  }, [view]);
  const C = loaded[view];
  if (error) return html`<div class="view view--col"><${ViewHead} title=${VIEWS.find(v => v.id === view)?.label} /><${ErrorLine} error=${`This view could not be loaded: ${error.message}`} /></div>`;
  if (!C) return html`<div class="view"><${Loading}>Opening view</${Loading}></div>`;
  return html`<${C} key=${view} />`;
}

function Drawer() {
  const open = useStore(s => !!s.ui?.drawer);
  const [C, setC] = useState(null);
  useEffect(() => { if (open && !C) import('./views/drawer.js').then(m => setC(() => m.SettingsDrawer)); }, [open]);
  return open && C ? html`<${C} />` : null;
}

function EngineBanner() {
  const st = engineStatus();
  if (st.available) return MOCK ? html`<div class="notice-line" style="padding-inline:var(--pad-app);border-top:0"><span class="flag flag--info">${Icon.info}<span>Demo mode</span></span><span class="grow small">Synthetic data and a demo analysis engine (the <code>?mock</code> flag). Remove it from the address to use your own data.</span></div>` : null;
  return html`<div class="notice-line" style="padding-inline:var(--pad-app);border-top:0" role="alert"><span class="flag flag--caution">${Icon.caution}<span>Engine unavailable</span></span><span class="grow small">${st.reason} Import and building still work; analysis views will stay empty until it is present.</span></div>`;
}

function App() {
  return html`
    <${Header} />
    <${EngineBanner} />
    <main id="main" tabindex="-1"><${ViewHost} /></main>
    <${Drawer} />
    <${Notices} />
    <${StatusBar} />`;
}

async function boot() {
  registerActions();
  const fromHash = location.hash.slice(1).split('?')[0];
  store.set({ view: VIEWS.some(v => v.id === fromHash) ? fromHash : 'data', notices: [], ui: { drawer: false, menuOpen: false } });
  window.addEventListener('hashchange', () => {
    const v = location.hash.slice(1).split('?')[0];
    if (v && v !== store.get().view) store.actions.setView(v);
  });
  // Under ?mock the offline demo LLM provider is the default, so nothing is
  // ever sent to a real provider while developing or testing.
  if (MOCK) store.set({ llm: { ...store.get().llm, provider: 'demo', key: null } });
  await initEngine();
  render(html`<${App} />`, document.getElementById('app'));
  // ?mock: demo engine + synthetic data (UI development). ?demo: the real
  // engine with the same synthetic data, for trying the tool or QA.
  const params = new URLSearchParams(location.search);
  if ((MOCK || params.has('demo')) && engineStatus().available && !params.has('empty')) {
    try { await store.actions.loadDataset(MOCK ? (await import('./services/mock.js')).mockDataset({ n: mockSize() }) : await demoDataset(mockSize())); }
    catch (e) { store.actions.notify('error', `Demo data failed to load: ${e.message}`); }
  }
}

// The demo organisation comes from the real generator: a bridge-dependent
// workplace on Slack with light message text (fake names, generated messages).
export async function demoDataset(size) {
  const { generate } = await import('../generator/index.js');
  return generate({ context: 'workplace', medium: 'slack', structure: 'bridge-dependent', size: size || 120, seed: 1, content: 'light', output: 'dataset' }).dataset;
}

boot();
