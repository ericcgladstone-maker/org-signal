// One analyst conversation per tab, shared by the Ask view and the docked Ask
// panel beside the analysis views (docs/ux/ask-panel.md). Nothing here
// computes: questions go to src/llm/analyst.js through createAnalystSession,
// exactly as the Ask view sent them before, and every number in an answer is
// still checked against the tool results by src/llm/citations.js.
//
// Rules this module keeps:
// - A provider, model or names-to-codes change starts a new conversation
//   (the earlier answers were produced under a different sending policy).
// - A network rebuild does not erase the conversation. The model's context is
//   restarted (its earlier results describe the old network), a divider marks
//   the point, and answers from before carry their network version so the
//   view can say they were computed under earlier construction settings.
// - View context ("Ask about this") is added to the question as words only:
//   the view, the object and the measure, never a value. Numbers still have
//   to come from a tool call.

import { useState, useEffect } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { getKey, redact, createAnalystSession, providerList } from './llm.js';

let state = { turns: [], busy: false };
let session = null;
let sessionNet = null;   // network version the current session was created on
let policy = null;       // provider|model|codes the conversation was started under
let ctrl = null;
const subs = new Set();

function set(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  for (const fn of subs) fn(state);
}

export function useConversation() {
  const [s, setS] = useState(state);
  useEffect(() => { subs.add(setS); setS(state); return () => subs.delete(setS); }, []);
  return s;
}

function policyOf(llm, provider) {
  return `${provider?.id}|${llm.model || provider?.defaultModel}|${llm.codes !== false}`;
}

// Clears the conversation if the sending policy changed since it started.
export function syncPolicy(provider) {
  const p = policyOf(store.get().llm, provider);
  if (policy && p !== policy && !state.busy) { reset(); }
  policy = p;
}

export function reset() {
  session?.reset?.();
  session = null; sessionNet = null;
  set({ turns: [], busy: false });
}

export function stop() { ctrl?.abort(); }

// The words added to the question for "Ask about this". No values.
export function contextLine(ctx) {
  if (!ctx) return '';
  const parts = [`The user is asking from the ${ctx.view} view`];
  if (ctx.note) parts.push(ctx.note);
  if (ctx.label) parts.push(`about ${ctx.kind ? `${ctx.kind} ` : ''}${ctx.label}`);
  return `(Context from Org Signal: ${parts.join(', ')}. Use tools for any numbers.)`;
}

export async function ask(question, { provider, ds, context = null } = {}) {
  if (!question.trim() || state.busy || !provider || !ds) return;
  const llm = store.get().llm;
  const codes = llm.codes !== false;
  const netVersion = store.get().network?.version ?? null;
  syncPolicy(provider);
  const key = await getKey(provider.id);
  const model = llm.model || provider.defaultModel;
  const rebuilt = session && sessionNet !== netVersion;
  if (rebuilt) { session.reset?.(); session = null; }
  const pre = rebuilt ? [{ role: 'divider', text: 'The network was rebuilt with new construction settings. Answers above describe the earlier network; the model starts fresh from here.' }] : [];
  const idx = state.turns.length + pre.length + 1;
  set(s => ({ busy: true, turns: [...s.turns, ...pre, { role: 'user', text: question, context }, { role: 'assistant', text: '', tools: [], streaming: true, netVersion, codes }] }));
  ctrl = new AbortController();
  const upd = fn => set(s => ({ turns: s.turns.map((x, i) => (i === idx ? fn(x) : x)) }));
  try {
    if (!session) { session = await createAnalystSession({ provider, key, model, dataset: ds, codes }); sessionNet = netVersion; }
    const sent = context ? `${question}\n\n${contextLine(context)}` : question;
    const r = await session.ask(sent, {
      signal: ctrl.signal,
      onText: d => upd(x => ({ ...x, text: x.text + d })),
      onToolCall: c => upd(x => ({ ...x, tools: [...x.tools, { name: c.name, args: c.arguments, pending: true }] })),
      onToolResult: rec => upd(x => ({ ...x, tools: x.tools.map(tl => (tl.pending && tl.name === rec.name ? { ...rec, pending: false } : tl)) })),
    });
    // Every result so far in this session: an answer may cite one computed
    // for an earlier question ([T2] while this turn made T5).
    upd(x => ({ ...x, streaming: false, result: r, sessionResults: [...(session?.toolResults || [])] }));
  } catch (e) {
    const msg = await redact(e?.message || String(e));
    upd(x => ({ ...x, streaming: false, error: e.name === 'AbortError' || e.code === 'aborted' ? 'Stopped.' : msg }));
  } finally { set({ busy: false }); }
}

// ---- key presence, for showing or hiding the panel and "Ask about this" ----

let providersP = null;
export function providers() { return (providersP ||= providerList()); }

// { provider, hasKey } for the provider chosen on the Ask page. Rechecked
// whenever the llm settings change (setting or forgetting a key writes them).
export function useAskReady() {
  const llm = useStore(s => s.llm);
  const [r, setR] = useState({ provider: null, hasKey: false });
  useEffect(() => {
    let live = true;
    (async () => {
      const list = await providers();
      const p = list?.find(x => x.id === llm.provider) || list?.[0] || null;
      const k = p ? await getKey(p.id) : null;
      if (live) setR({ provider: p, hasKey: !!k });
    })().catch(() => { if (live) setR({ provider: null, hasKey: false }); });
    return () => { live = false; };
  }, [llm]);
  return r;
}

// Opens the panel with a context attached and the cursor in the question box.
// Nothing is sent until the person asks.
export function askAbout(ctx) {
  store.set({ askContext: ctx, ui: { ...(store.get().ui || {}), askPanel: true } });
  setTimeout(() => document.getElementById('askp-q')?.focus(), 60);
}
