// The docked Ask panel (docs/ux/ask-panel.md): the analyst conversation beside
// the analysis views, so an answer can be read against the network it is
// about, without leaving the view. A floating "Ask" button opens it on every
// analysis view once data is loaded. Without a key the panel opens on setup:
// provider, model, key, the remember choice and the full statement of what is
// sent. With a key, setup folds into one summary line above the conversation
// and opens again on request. Reports live on their own page and content
// coding in the Content view; both use the key entered here.

import { html, useEffect } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { Icon, Loading, Unavailable } from './common.js';
import { ChatThread } from './chat.js';
import { useProviderKey, ProviderSettings, NoKey } from './asksetup.js';
import { useAskReady, askAbout } from '../services/conversation.js';

export const PANEL_VIEWS = new Set(['network', 'people', 'groups', 'content', 'time']);

// The panel can open here: an analysis view with data loaded.
export function useAskAvailable() {
  const view = useStore(s => s.view);
  const ds = useStore(s => s.dataset);
  const { provider, hasKey } = useAskReady();
  return { ok: !!(ds && PANEL_VIEWS.has(view)), hasKey, provider, ds };
}

const setUi = patch => store.set({ ui: { ...(store.get().ui || {}), ...patch } });

function SetupSummary({ provider, keyState, open, onToggle }) {
  const llm = useStore(s => s.llm);
  const codes = llm.codes !== false;
  const model = llm.model || provider.defaultModel;
  return html`<div class="askp__summary">
    <p class="small" style="margin:0"><strong>${provider.label}</strong><span class="text2"> · ${model} · names ${codes ? 'replaced with codes' : 'sent as they are'} · key ${keyState.remembered ? 'remembered in this browser' : 'held for this tab only'}</span></p>
    <button type="button" class="tlink tlink--quiet" aria-expanded=${String(open)} aria-controls="askpSetup" onClick=${onToggle}>${open ? 'Hide settings' : 'Settings and what is sent'}</button>
  </div>`;
}

function PanelBody({ ds }) {
  const { providers, provider, keyState, refreshKey } = useProviderKey();
  const showSetup = useStore(s => !!s.ui?.askSetup);
  if (providers === null) return html`<${Loading}>Loading providers</${Loading}>`;
  if (!providers.length) return html`<${Unavailable}>The language-model layer is not available in this build. Everything else in Org Signal works without it.</${Unavailable}>`;
  if (!keyState.has) {
    return html`<div class="askp__setup">
      <p class="small text2" style="margin:0 0 .4rem">Ask questions about this network in ordinary language, with your own API key. The answers cite computed results from the analysis engine, and nothing is sent until you ask.</p>
      <${ProviderSettings} providers=${providers} provider=${provider} keyState=${keyState} onKeyChange=${() => refreshKey()} />
      <${NoKey} />
    </div>`;
  }
  return html`<div>
    <${SetupSummary} provider=${provider} keyState=${keyState} open=${showSetup} onToggle=${() => setUi({ askSetup: !showSetup })} />
    ${showSetup && html`<div id="askpSetup" class="askp__setup"><${ProviderSettings} providers=${providers} provider=${provider} keyState=${keyState} onKeyChange=${() => refreshKey()} /></div>`}
    <${ChatThread} provider=${provider} ds=${ds} compact=${true} />
  </div>`;
}

export function AskPanel() {
  const { ok, ds } = useAskAvailable();
  const open = useStore(s => !!s.ui?.askPanel);
  useEffect(() => {
    document.documentElement.dataset.askpanel = ok ? (open ? 'open' : 'closed') : 'none';
    return () => { document.documentElement.dataset.askpanel = 'none'; };
  }, [ok, open]);
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape' && e.target.closest?.('.askp')) { setUi({ askPanel: false }); setTimeout(() => document.querySelector('.askp-fab')?.focus(), 0); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!ok) return null;
  if (!open) return html`<button type="button" class="askp-fab" aria-expanded="false" aria-controls="askPanel" onClick=${() => setUi({ askPanel: true })}>Ask</button>`;
  return html`<aside class="askp" id="askPanel" aria-label="Ask about this network">
    <div class="askp__head">
      <h2 class="label" style="margin:0">Ask</h2>
      <button type="button" class="btn btn--quiet btn--sm" aria-label="Close the Ask panel" onClick=${() => setUi({ askPanel: false })}>${Icon.close}</button>
    </div>
    <div class="askp__body"><${PanelBody} ds=${ds} /></div>
  </aside>`;
}

// "Ask about this": shown next to a person, measure or result once a key is
// set. ctx = { view, kind, label, note } (words, no values).
export function AskAbout({ ctx, label = 'Ask about this' }) {
  const { ok, hasKey } = useAskAvailable();
  if (!ok || !hasKey) return null;
  return html`<div class="tlinks ask-about"><button type="button" class="tlink tlink--arrow" onClick=${() => askAbout(ctx)}>${label}</button></div>`;
}
