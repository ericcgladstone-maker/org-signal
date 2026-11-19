// The docked Ask panel (docs/ux/ask-panel.md): the analyst conversation beside
// the analysis views, so an answer can be read against the network it is
// about. It exists only once a key is set on the Ask page and data is loaded;
// without a key the app shows no panel and no "Ask about this" actions.
// Collapsed by default. Setup (provider, key, the full statement of what is
// sent) stays on the Ask page, as do Reports and Content coding.

import { html, useEffect } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { Icon } from './common.js';
import { ChatThread } from './chat.js';
import { useAskReady, askAbout } from '../services/conversation.js';

export const PANEL_VIEWS = new Set(['network', 'people', 'groups', 'content', 'time']);

export function useAskAvailable() {
  const view = useStore(s => s.view);
  const ds = useStore(s => s.dataset);
  const { provider, hasKey } = useAskReady();
  return { ok: !!(hasKey && ds && provider && PANEL_VIEWS.has(view)), provider, ds };
}

export function AskPanel() {
  const { ok, provider, ds } = useAskAvailable();
  const open = useStore(s => !!s.ui?.askPanel);
  const setOpen = v => store.set({ ui: { ...(store.get().ui || {}), askPanel: v } });
  useEffect(() => {
    document.documentElement.dataset.askpanel = ok ? (open ? 'open' : 'closed') : 'none';
    return () => { document.documentElement.dataset.askpanel = 'none'; };
  }, [ok, open]);
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape' && e.target.closest?.('.askp')) { setOpen(false); document.querySelector('.askp-tab')?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!ok) return null;
  if (!open) return html`<button type="button" class="askp-tab" aria-expanded="false" aria-controls="askPanel" onClick=${() => setOpen(true)}>Ask</button>`;
  return html`<aside class="askp" id="askPanel" aria-label="Ask about this network">
    <div class="askp__head">
      <h2 class="label" style="margin:0">Ask · ${provider.label}</h2>
      <button type="button" class="btn btn--quiet btn--sm" aria-label="Close the Ask panel" onClick=${() => { setOpen(false); }}>${Icon.close}</button>
    </div>
    <div class="askp__body"><${ChatThread} provider=${provider} ds=${ds} compact=${true} /></div>
  </aside>`;
}

// "Ask about this": shown next to a person, measure or result only when the
// panel is available. ctx = { view, kind, label, note } (words, no values).
export function AskAbout({ ctx, label = 'Ask about this' }) {
  const { ok } = useAskAvailable();
  if (!ok) return null;
  return html`<div class="tlinks ask-about"><button type="button" class="tlink tlink--arrow" onClick=${() => askAbout(ctx)}>${label}</button></div>`;
}
