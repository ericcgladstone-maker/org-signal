// The analyst conversation as shown on the Ask page and in the docked Ask
// panel (docs/ux/ask-panel.md). Both render the one conversation held by
// services/conversation.js. The evidence layers are the same in both places:
// [T2] markers open the computed record behind a sentence, numbers that do not
// come from a computed result are underlined and counted, general knowledge is
// labeled by the model as not computed, and every computed value used is
// listed as sent.

import { html, useState, useEffect, useRef } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { ErrorLine, Flag } from './common.js';
import { renderMarkdown, markUnverified } from '../lib/markdown.js';
import { llmModules, decodeNames } from '../services/llm.js';
import { useConversation, ask, stop, reset, syncPolicy } from '../services/conversation.js';

export function fmtUSD(x) { if (x == null) return 'unknown'; if (x < 0.01) return 'under $0.01'; return `$${x.toFixed(x < 1 ? 3 : 2)}`; }

function prettyJSON(s) {
  try { return JSON.stringify(typeof s === 'string' ? JSON.parse(s) : s, null, 2); } catch { return String(s); }
}

// People named in a computed record, as dataset node indices. Tools return
// people as objects with a `key` (the real key, or P<n> when names were sent
// as codes). Read from the record itself, never from the model's prose.
export function nodesInRecord(rec, ds, codes) {
  if (!rec || !ds) return [];
  let data;
  try { data = typeof rec.content === 'string' ? JSON.parse(rec.content) : rec.content; } catch { return []; }
  const byKey = new Map(ds.nodes.keys.map((k, i) => [String(k), i]));
  const out = [];
  const seen = new Set();
  const walk = (v, depth) => {
    if (out.length >= 50 || depth > 6 || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v.key === 'string') {
      let i = byKey.get(v.key);
      if (i == null && codes) { const m = /^P(\d{1,7})$/.exec(v.key); if (m && Number(m[1]) <= ds.nodes.count) i = Number(m[1]) - 1; }
      if (i != null && !seen.has(i)) { seen.add(i); out.push(i); }
    }
    for (const x of Object.values(v)) if (x && typeof x === 'object') walk(x, depth + 1);
  };
  walk(data, 0);
  return out;
}

function ShowIn({ nodes }) {
  if (!nodes.length) return null;
  const n = nodes.length;
  return html`<div class="tlinks" style="margin:.3rem 0 .2rem">
    <button type="button" class="tlink tlink--arrow" onClick=${() => { store.actions.select(nodes); store.actions.setView('network'); }}>Select ${n === 1 ? 'this person' : `these ${n}`} in the network map</button>
    <button type="button" class="tlink tlink--arrow" onClick=${() => { store.actions.select(nodes); store.set({ ui: { ...store.get().ui, profile: nodes[0] } }); store.actions.setView('people'); }}>Open in People</button>
  </div>
  <p class="basis" style="margin-top:0">Shows the same computed result in the app's own views. It is a second way to read the result, not a separate check of it.</p>`;
}

function Answer({ turn, ds, compact }) {
  const [open, setOpen] = useState(null);
  const net = useStore(s => s.network);
  const r = turn.result;
  const results = r?.toolResults || [];
  const dds = turn.codes ? ds : null;
  const dec = t => (dds ? decodeNames(t, dds) : t);
  const text = dec(r ? markUnverified(r.text, r.unverifiedNumbers) : turn.text);
  const onCite = (id) => setOpen(o => (o === id ? null : id));
  const pool = turn.sessionResults?.length ? turn.sessionResults : results;
  const sel = pool.find(x => x.id === open);
  const panel = useRef(null);
  useEffect(() => { if (open) panel.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [open]);
  const stale = turn.netVersion != null && net?.version != null && turn.netVersion !== net.version;
  return html`<div class="msg">
    <div class="msg__who">Analyst${turn.streaming ? html` <span class="spinner" aria-hidden="true"></span>` : ''}</div>
    ${stale && !turn.streaming && html`<p class="small" style="color:var(--warn);margin:.2rem 0 .4rem"><${Flag} level="caution" /> Computed under earlier construction settings. The network has been rebuilt since.</p>`}
    ${turn.tools?.length > 0 && turn.streaming && html`<p class="meta" style="margin-bottom:.4rem">${turn.tools.map(t => `${t.pending ? 'calling' : 'called'} ${t.name}`).join(' · ')}</p>`}
    <div aria-live="polite">${r ? renderMarkdown(text, { onCite }) : html`<div class="msg__text">${text}</div>`}</div>
    ${open && html`<div ref=${panel} class="cite-panel" style="margin-top:.6rem">${sel
      ? html`<p class="label">${sel.id}: ${sel.name}(${JSON.stringify(sel.args || {})})${results.includes(sel) ? '' : ' · computed for an earlier question'}</p>
        <pre class="code">${prettyJSON(sel.content)}</pre>
        ${!stale && html`<${ShowIn} nodes=${nodesInRecord(sel, ds, turn.codes)} />`}`
      : html`<p class="small" style="color:var(--warn)"><${Flag} level="caution" /> No computed result ${open} exists in this conversation. The model cited an id it was not given.</p>`}
      <button type="button" class="tlink tlink--quiet" onClick=${() => setOpen(null)}>Close</button></div>`}
    ${turn.error && html`<${ErrorLine} error=${turn.error} />`}
    ${r && html`
      ${r.unverifiedNumbers?.length > 0 ? html`<p class="small" style="margin-top:.6rem;color:var(--warn)"><${Flag} level="caution" /> ${r.unverifiedNumbers.length} number${r.unverifiedNumbers.length > 1 ? 's' : ''} in this answer (underlined) did not come from a computed result. Do not rely on ${r.unverifiedNumbers.length > 1 ? 'them' : 'it'}.</p>`
        : html`<p class="basis">Every number in this answer matches a computed result.</p>`}
      ${r.refused && html`<p class="small text2"><${Flag} level="info" /> The model declined part of this request.</p>`}
      ${results.length > 0 && html`<details class="disclose"><summary>Computed values used (${results.length}), as sent</summary>
        ${results.map(x => html`<div style="margin:.4rem 0"><p class="label" style="margin:0">${x.id} · ${x.name}(${JSON.stringify(x.args || {})})${x.error ? ' · error' : ''}</p><pre class="code">${prettyJSON(x.content)}</pre></div>`)}
      </details>`}`}
  </div>`;
}

function ContextChip({ ctx, onClear }) {
  if (!ctx) return null;
  return html`<p class="ask-ctx small"><span class="text2">About</span> <strong>${ctx.label || ctx.note}</strong><span class="text2"> · ${ctx.view}${ctx.label && ctx.note ? ` · ${ctx.note}` : ''}</span>
    ${onClear && html` <button type="button" class="tlink tlink--quiet" onClick=${onClear}>Remove</button>`}</p>`;
}

const SUGGEST = {
  person: l => [`Why does ${l} rank where they do?`, `How stable is ${l}'s position?`, `What doesn't ${l}'s position establish?`],
  measure: l => [`Who ranks highest on ${l}, and how sure can we be?`, `Does ${l} apply to this data?`],
};

// compact: the docked panel (shorter copy, its own textarea id).
export function ChatThread({ provider, ds, compact = false }) {
  const llm = useStore(s => s.llm);
  const ctx = useStore(s => (compact ? s.askContext : null));
  const conv = useConversation();
  const [q, setQ] = useState('');
  const [est, setEst] = useState(null);
  const end = useRef(null);
  const codes = llm.codes !== false;
  const id = compact ? 'askp-q' : 'ask-q';
  useEffect(() => { syncPolicy(provider); }, [provider.id, llm.model, codes]);
  useEffect(() => {
    (async () => {
      const m = await llmModules();
      if (!m.estimate?.estimateAsk) return setEst(null);
      setEst(m.estimate.estimateAsk({ provider: provider.id, model: llm.model || provider.defaultModel, systemPrompt: m.analyst?.ANALYST_SYSTEM_PROMPT || '', tools: m.tools?.TOOL_DEFINITIONS || [], steps: 4 }));
    })();
  }, [provider.id, llm.model]);
  useEffect(() => { if (compact) end.current?.scrollIntoView?.({ block: 'end' }); }, [conv.turns.length]);
  const send = (question) => {
    if (!question.trim() || conv.busy) return;
    setQ('');
    ask(question, { provider, ds, context: compact ? ctx : null });
  };
  const suggestions = compact && ctx
    ? (SUGGEST[ctx.kind === 'measure' ? 'measure' : 'person'] || SUGGEST.person)(ctx.label || ctx.note)
    : ['Who are the brokers between departments, and how sure can we be?', 'Is clustering here higher than in random networks with the same degrees?', 'How did activity change over time?'];
  return html`<div class=${`chat${compact ? ' chat--compact' : ''}`}>
    ${!conv.turns.length && html`<div class="prose small"><p>${compact
      ? 'Questions about the network beside this panel. The analyst answers only from computed results and cites each with a marker like [T2]; select a marker to see the record behind the sentence.'
      : 'Ask about structure, positions, groups, change over time or content. The analyst answers only from computed results, cites each with a marker like [T2], and says when a measure does not apply to this data.'}</p></div>`}
    ${conv.turns.map((t, i) => (t.role === 'user'
      ? html`<div class="msg msg--user" key=${i}><div class="msg__who">You</div><div class="msg__text">${t.text}</div>${t.context && html`<${ContextChip} ctx=${t.context} />`}</div>`
      : t.role === 'divider'
        ? html`<p class="ask-divider small" key=${i}><${Flag} level="info" /> ${t.text}</p>`
        : html`<${Answer} key=${i} turn=${t} ds=${ds} compact=${compact} />`))}
    <div ref=${end}></div>
    ${(!conv.turns.length || (compact && ctx && !conv.busy)) && html`<div class="prose small"><p class="label" style="margin-top:.6rem">Try</p>
      <ul class="ask-try">${suggestions.map(s => html`<li><button type="button" class="tlink tlink--quiet" onClick=${() => send(s)}>${s}</button></li>`)}</ul></div>`}
    <form class="stack" onSubmit=${e => { e.preventDefault(); send(q); }}>
      ${compact && html`<${ContextChip} ctx=${ctx} onClear=${() => store.set({ askContext: null })} />`}
      <label class="field"><span>Question</span><textarea id=${id} class="input" rows=${compact ? 2 : 3} value=${q} onInput=${e => setQ(e.currentTarget.value)} onKeyDown=${e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(q); } }} placeholder=${compact ? 'Ask about what you are looking at' : 'For example: which teams are most cut off from each other?'}></textarea></label>
      <div class="row">
        <button class="btn btn--primary" type="submit" disabled=${conv.busy || !q.trim()}>Ask</button>
        ${conv.busy && html`<button class="tlink tlink--quiet" type="button" onClick=${stop}>Stop</button>`}
        ${conv.turns.length > 0 && !conv.busy && html`<button class="tlink tlink--quiet" type="button" onClick=${() => { reset(); store.actions.focus(`#${id}`); }}>New conversation</button>`}
        <span class="meta grow" style="text-align:right">${est?.usd != null ? `About ${fmtUSD(est.usd)} to ${fmtUSD(est.usdHigh)} per question` : ''}</span>
      </div>
      ${!compact && est?.note && html`<p class="basis">${est.note}</p>`}
      ${compact && html`<p class="basis">${provider.id === 'demo' ? 'The offline demo answers inside this tab; nothing is sent.' : html`Sends your question${ctx ? ', the context line above (names and views, no values)' : ''} and the computed results the model requests to ${provider.label}. Names are ${codes ? 'replaced with codes' : 'sent as they are'}. Usage is billed by the provider.`} <button type="button" class="tlink tlink--quiet" onClick=${() => { store.set({ ui: { ...(store.get().ui || {}), askSetup: true } }); document.querySelector('.askp__body')?.scrollTo({ top: 0, behavior: 'smooth' }); }}>What is sent, in full</button></p>`}
    </form>
  </div>`;
}
