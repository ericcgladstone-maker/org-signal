// Provider, model and key setup, and the statement of what is sent, shared by
// the docked Ask panel (components/askpanel.js), the Reports page
// (views/ask.js) and content coding in the Content view. Keys live only in
// src/llm/keys.js createKeyStore() (memory by default, localStorage on
// explicit opt-in). The shared store keeps provider, model, the remember flag
// and the names-to-codes choice, never the key.
//
// What leaves the computer is stated in full and must match what src/llm
// sends (analyst.js datasetContext, tools.js results with strings cut at 240
// characters, reports.js fixed plans, coding.js text cut at 1,000 characters).

import { html, useState, useEffect } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { Select, Flag } from './common.js';
import { getKey, setKey, forgetKey, isRemembered, canRemember, maskKey, redact } from '../services/llm.js';
import { providers as providerListOnce } from '../services/conversation.js';

// { providers, provider, keyState, refreshKey } for the provider chosen in the store.
export function useProviderKey() {
  const [providers, setProviders] = useState(null);
  const llm = useStore(s => s.llm);
  const [keyState, setKeyState] = useState({ has: false, masked: '', remembered: false });
  useEffect(() => { providerListOnce().then(setProviders, () => setProviders([])); }, []);
  const provider = providers?.find(p => p.id === llm.provider) || providers?.[0] || null;
  const refreshKey = async (p = provider) => {
    if (!p) return;
    const k = await getKey(p.id);
    setKeyState({ has: !!k, masked: k ? await maskKey(k) : '', remembered: await isRemembered(p.id) });
  };
  useEffect(() => { refreshKey(); }, [provider?.id, llm]);
  useEffect(() => { if (providers && provider && llm.provider !== provider.id) store.set({ llm: { ...llm, provider: provider.id, model: null, key: null } }); }, [providers]);
  return { providers, provider, keyState, refreshKey };
}

export function NoKey() {
  return html`<section class="section" aria-label="Language-model functions">
    <h2 class="section__title">Language-model functions</h2>
    <div class="prose small">
      <p>An API key enables three language-model functions. Network calculations continue to come from the Org Signal analysis engine.</p>
      <ul class="can-list" style="margin-top:.6rem">
        <li><strong>Ask.</strong> Ask questions about the loaded network in ordinary language, beside the view you are working in. The model can request computed results from the analysis engine and must cite numerical claims to those results. Unsupported numerical claims are flagged.</li>
        <li><strong>Reports.</strong> Generate a written report for the whole network, a group attribute, or a selected person from a fixed set of computed results.</li>
        <li><strong>Content coding.</strong> In the Content view, apply a user-defined codebook to a sample of messages. Double-coding can be used to estimate agreement.</li>
      </ul>
      <p style="margin-top:.8rem">Usage is billed by the provider. A cost estimate is shown before each question, report or coding run. One key serves all three.</p>
    </div>
  </section>`;
}

export function ProviderSettings({ providers, provider, keyState, onKeyChange }) {
  const llm = useStore(s => s.llm);
  const [draft, setDraft] = useState('');
  const [remember, setRemember] = useState(!!llm.remember);
  const [models, setModels] = useState(null);
  const [modelsErr, setModelsErr] = useState(null);
  const [canRem, setCanRem] = useState(false);
  useEffect(() => { canRemember().then(setCanRem); }, []);
  useEffect(() => { setRemember(keyState.remembered || !!llm.remember); }, [keyState.remembered]);
  useEffect(() => {
    setModels(null); setModelsErr(null);
    if (!provider || !keyState.has) return;
    let live = true;
    getKey(provider.id).then(key => provider.listModels({ key })).then(m => { if (live) setModels(m || []); }, async e => { if (live) setModelsErr(await redact(e.message)); });
    return () => { live = false; };
  }, [provider?.id, keyState.has]);
  const model = llm.model || provider?.defaultModel;
  const save = async () => {
    if (!draft.trim()) return;
    await setKey(provider.id, draft.trim(), remember);
    setDraft('');
    store.set({ llm: { ...llm, remember, key: null } });
    onKeyChange();
  };
  const forget = async () => { await forgetKey(provider.id); store.set({ llm: { ...llm, remember: false, key: null } }); onKeyChange(); };
  const modelOptions = models?.length ? models.map(m => ({ value: m.id, label: m.label || m.id })) : [{ value: model, label: model }];
  if (models?.length && !models.some(m => m.id === model)) modelOptions.unshift({ value: model, label: `${model} (default)` });
  return html`<section class="section" style="border-top:0" aria-labelledby="prov-h">
    <h2 id="prov-h" class="section__title">Provider and API key</h2>
    <div class="grid-2">
      <${Select} label="Provider" value=${provider?.id} onChange=${v => store.set({ llm: { ...llm, provider: v, model: null, key: null } })} options=${providers.map(p => ({ value: p.id, label: p.label }))} />
      <${Select} label="Model" value=${model} onChange=${v => store.set({ llm: { ...llm, model: v, key: null } })} options=${modelOptions} disabled=${!keyState.has} />
    </div>
    ${modelsErr && html`<p class="small text2" style="margin-top:.4rem"><${Flag} level="caution" /> Could not list models: ${modelsErr}</p>`}
    ${keyState.has ? html`<div class="row" style="margin-top:.9rem">
        <span class="small text2">Key ${keyState.masked} ${keyState.remembered ? 'is remembered in this browser (local storage) until you forget it' : 'is held in memory for this tab only and is gone when you close it'}.</span>
        <button type="button" class="tlink tlink--quiet" onClick=${forget}>Forget key</button>
      </div>`
      : html`<form class="stack" style="margin-top:.9rem" onSubmit=${e => { e.preventDefault(); save(); }}>
        <label class="field"><span>API key for ${provider?.label}${provider?.keyUrl ? html` · <a href=${provider.keyUrl} target="_blank" rel="noopener noreferrer">get one</a>` : ''}</span>
          <input class="input" type="password" autocomplete="off" spellcheck="false" placeholder=${provider?.keyPlaceholder || ''} value=${draft} onInput=${e => setDraft(e.currentTarget.value)} /></label>
        <label class="check"><input type="checkbox" checked=${remember} disabled=${!canRem} onChange=${e => setRemember(e.currentTarget.checked)} />Remember the key in this browser</label>
        <p class="basis">${remember ? html`<span style="color:var(--warn)"><${Flag} level="caution" /> The key will be kept in this browser's local storage, where anyone using this browser profile, and any extension allowed on this page, can read it. Leave this off on shared computers.</span>` : canRem ? 'Off: the key is held in memory for this tab only and is gone when you close it. On: it is kept in this browser\'s local storage until you forget it.' : 'This browser does not allow local storage here, so the key is held in memory for this tab only.'}</p>
        <div><button class="btn btn--primary" type="submit" disabled=${!draft.trim()}>Use this key</button></div>
      </form>`}
    <${WhatIsSent} provider=${provider} />
  </section>`;
}

// What leaves this computer. Open by default (D8, S5) and kept in step with
// src/llm: analyst.js sends the question, the dataset description and tool
// results; tools.js cuts strings at 240 characters and lists at 50; edge
// evidence returns 10 events by default; reports.js runs a fixed plan with no
// tie evidence; coding.js sends only sampled message text cut at 1,000.
export function WhatIsSent({ provider }) {
  const llm = useStore(s => s.llm);
  const codes = llm.codes !== false;
  const demo = provider?.id === 'demo';
  return html`<details class="disclose" open style="margin-top:1.25rem">
    <summary>What is sent to the model provider</summary>
    <div class="prose small" style="padding:.4rem 0 .6rem">
      <p>${demo ? 'The offline demo provider answers inside this tab, so nothing is sent while it is selected. With a real provider: ' : ''}When a language-model function is run, the browser sends the request directly to the selected provider. The information sent depends on the operation and is listed below. Original files remain in the browser.</p>
      <ul class="can-list" style="margin-top:.6rem">
        <li><strong>Ask.</strong> The request can include the conversation, a description of the dataset and construction settings, computed results requested by the model, and short excerpts from underlying records when the question requires evidence for a tie.</li>
        <li><strong>Reports.</strong> Reports use a fixed set of computed network, person, group, temporal, and content results. Message text is excluded except for the aggregate word results used by the report.</li>
        <li><strong>Content coding.</strong> The provider receives the codebook and the sampled message text used for coding.</li>
        <li><strong>API key.</strong> The key is sent directly to the selected provider with each request.</li>
      </ul>
      <label class="check" style="margin-top:.8rem;align-items:flex-start"><input type="checkbox" checked=${codes} onChange=${e => store.set({ llm: { ...store.get().llm, codes: e.currentTarget.checked } })} style="margin-top:.2rem" />
        <span>Replace names with codes before sending. People become P1, P2 and so on; their names in message excerpts, words and questions are replaced too, email addresses are removed, and name, email, phone and manager columns are left out. Answers are turned back into names on this computer. Nicknames, misspellings and people who are not in the data are not caught.</span></label>
      <p style="margin-top:.8rem">Sending this content to a provider may require consent, contractual permission, or ethics approval for the data concerned.</p>
    </div>
  </details>`;
}

