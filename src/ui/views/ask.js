// Ask view: the optional LLM layer (src/llm). Provider, model and key
// settings; the analyst chat with streaming, tool-call transparency and
// unverified numbers highlighted; on-demand written reports; LLM content
// coding with a codebook editor and a cost estimate before anything runs.
//
// Keys live only in src/llm/keys.js createKeyStore() (memory by default,
// localStorage on explicit opt-in). The shared store keeps provider, model,
// the remember flag and the names-to-codes choice, never the key.
//
// What leaves the computer is stated in full and open by default, and must
// match what src/llm sends (analyst.js datasetContext, tools.js results with
// strings cut at 240 characters, reports.js fixed plans, coding.js text cut at
// 1,000 characters). "Replace names with codes" swaps names for codes at the
// services boundary (services/llm.js pseudonymize) and decodes answers here.

import { html, useState, useEffect, useRef, useMemo } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { ViewHead, Loading, ErrorLine, Select, Flag, download, Icon, Unavailable } from '../components/common.js';
import { BarList } from '../components/charts.js';
import { useProviderKey, ProviderSettings, NoKey } from '../components/asksetup.js';
import { renderMarkdown, markUnverified, markdownToHTMLDocument } from '../lib/markdown.js';
import { getKey, redact, writeReport, codingModule, estimateModule, llmModules, pseudonymize, decodeNames } from '../services/llm.js';
import { groupableAttributes, hasText, label as nodeLabel } from '../lib/dsutil.js';
import { fmtInt, fmtNum, fmtPct, humanize } from '../lib/format.js';
import { tokens } from '../lib/palette.js';

export function AskView() {
  const { providers, provider, keyState, refreshKey } = useProviderKey();
  const ds = useStore(s => s.dataset);
  return html`<div class="view view--col">
    <${ViewHead} title="Reports" intro="Reports are written by a language model, with a user-supplied Anthropic, OpenAI, or Gemini API key, from a fixed set of computed results for the whole network, a group attribute, or one person. Numerical claims are checked against those results. To ask questions about the network, use Ask, the button at the bottom right of the Network, People, Groups, Content and Time views. Content coding is in the Content view." />
    ${providers === null ? html`<${Loading}>Loading providers</${Loading}>` : !providers.length ? html`<${Unavailable}>The LLM layer (src/llm) is not available in this build. Everything else in Org Signal works without it.</${Unavailable}>` : html`
      <${ProviderSettings} providers=${providers} provider=${provider} keyState=${keyState} onKeyChange=${() => refreshKey()} />
      ${!keyState.has ? html`<${NoKey} />` : !ds ? html`<p class="text2" style="margin-top:1rem">Load data first; reports are written about the loaded network.</p>` : html`
        <section class="section" aria-labelledby="rep-h"><h2 id="rep-h" class="section__title">Write a report</h2>
          <${Reports} provider=${provider} ds=${ds} />
        </section>`}
    `}
  </div>`;
}

// Download and confirm (D17).
function saveFile(text, filename, mime) {
  download(text, filename, mime);
  store.actions.notify('info', `Downloaded ${filename}.`);
}

function fmtUSD(x) { if (x == null) return 'unknown'; if (x < 0.01) return 'under $0.01'; return `$${x.toFixed(x < 1 ? 3 : 2)}`; }

// ---- reports ----------------------------------------------------------------------------

function Reports({ provider, ds }) {
  const llm = useStore(s => s.llm);
  const attrs = groupableAttributes(ds);
  const sel = useStore(s => s.selection);
  const [scope, setScope] = useState('network');
  const [target, setTarget] = useState(attrs[0]?.key || '');
  const [node, setNode] = useState(sel[0] != null ? String(sel[0]) : '');
  const codes = llm.codes !== false;
  const dec = t => (codes ? decodeNames(t, ds) : t);
  const [est, setEst] = useState(null);
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const ctrl = useRef(null);
  const model = llm.model || provider.defaultModel;
  useEffect(() => {
    (async () => {
      const m = await llmModules();
      const sections = m.reports?.REPORT_SECTIONS?.[scope]?.length || 6;
      setEst(m.estimate?.estimateReport ? m.estimate.estimateReport({ provider: provider.id, model, systemPrompt: m.reports?.REPORT_SYSTEM_PROMPT || '', resultsText: 'x'.repeat(14000), sections }) : null);
    })();
  }, [scope, provider.id, model]);
  const run = async () => {
    setBusy(true); setErr(null); setOut({ markdown: '', streaming: true });
    ctrl.current = new AbortController();
    try {
      const key = await getKey(provider.id);
      const r = await writeReport({ scope, target: scope === 'group' ? target : scope === 'node' ? Number(node) : undefined, provider, key, model, dataset: ds, codes, signal: ctrl.current.signal, onText: d => setOut(o => ({ ...o, markdown: (o?.markdown || '') + d })) });
      // Decode once, after the citation check (which ran on what was sent).
      setOut({ ...r, markdown: dec(markUnverified(r.markdown, r.unverifiedNumbers)), marked: true, title: dec(r.title), streaming: false });
      store.actions.focus('#report-out');
    } catch (e) { setErr(await redact(e.message)); setOut(null); } finally { setBusy(false); }
  };
  const nodeOptions = useMemo(() => {
    const ids = [...new Set([...sel, ...Array.from({ length: Math.min(ds.nodes.count, 400) }, (_, i) => i)])];
    return ids.map(i => ({ value: String(i), label: nodeLabel(ds, i) }));
  }, [ds, sel]);
  return html`<div class="stack">
    <p class="small text2">A report is written from a fixed plan of computed results (listed at the end of the report), section by section. Numbers are checked against those results.</p>
    <div class="grid-2">
      <${Select} label="Report on" value=${scope} onChange=${setScope} options=${[{ value: 'network', label: 'The whole network' }, { value: 'group', label: 'A group attribute' }, { value: 'node', label: 'One person' }]} />
      ${scope === 'group' && html`<${Select} label="Attribute" value=${target} onChange=${setTarget} options=${attrs.length ? attrs.map(a => ({ value: a.key, label: a.label })) : [{ value: '', label: 'No attributes in this data' }]} />`}
      ${scope === 'node' && html`<${Select} label="Person" value=${node} onChange=${setNode} options=${nodeOptions} />`}
    </div>
    ${est && html`<p class="small text2">Estimated cost ${fmtUSD(est.usd)} to ${fmtUSD(est.usdHigh)}. <span class="basis">${est.note}</span></p>`}
    <div class="row"><button type="button" class="btn btn--primary" onClick=${run} disabled=${busy || (scope === 'group' && !target) || (scope === 'node' && !node)}>Write report</button>${busy && html`<button type="button" class="tlink tlink--quiet" onClick=${() => ctrl.current?.abort()}>Stop</button>`}</div>
    <${ErrorLine} error=${err} />
    ${out && html`<div class="section" id="report-out" tabindex="-1">
      ${out.streaming ? html`<div class="msg__text">${dec(out.markdown)}</div>` : renderMarkdown(out.markdown)}
      ${!out.streaming && html`
        ${out.unverifiedNumbers?.length > 0 ? html`<p class="small" style="color:var(--warn)"><${Flag} level="caution" /> ${out.unverifiedNumbers.length} number(s) (underlined) are not in the computed results.</p>` : html`<p class="basis">Every number matches a computed result.</p>`}
        ${out.missingSections?.length > 0 && html`<p class="small text2">Sections the model left out were added as placeholders: ${out.missingSections.join(', ')}.</p>`}
        <div class="tlinks" style="margin-top:.8rem">
          <button type="button" class="tlink tlink--down" onClick=${() => saveFile(out.markdown.replace(/[\u0001\u0002]/g, ''), 'report.md', 'text/markdown')}>Markdown</button>
          <button type="button" class="tlink tlink--down" onClick=${() => saveFile(markdownToHTMLDocument(out.markdown, out.title), 'report.html', 'text/html')}>HTML (prints to PDF)</button>
        </div>`}
    </div>`}
  </div>`;
}

// ---- content coding -----------------------------------------------------------------------

const DEFAULT_CODEBOOK = {
  name: 'Coordination talk', multiLabel: false, instructions: '',
  codes: [
    { id: 'request', label: 'Request', definition: 'Asks someone to do something or for information.' },
    { id: 'inform', label: 'Inform', definition: 'Shares information, status or an update without asking for anything.' },
    { id: 'social', label: 'Social', definition: 'Greeting, thanks, praise or other relationship talk.' },
  ],
};

export function Coding({ provider, ds }) {
  const llm = useStore(s => s.llm);
  const [cb, setCb] = useState(DEFAULT_CODEBOOK);
  const [size, setSize] = useState(200);
  const [strata, setStrata] = useState('context');
  const [doubleCode, setDouble] = useState(false);
  const [sample, setSample] = useState(null);
  const [est, setEst] = useState(null);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [mod, setMod] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const model = llm.model || provider.defaultModel;
  // With codes on, the coder reads message text with the data's names replaced.
  const sendDs = llm.codes !== false ? pseudonymize(ds).ds : ds;
  useEffect(() => { codingModule().then(setMod); }, []);
  useEffect(() => { if (sample && mod?.estimateCoding) setEst(mod.estimateCoding({ provider: provider.id, model, ds, sample, codebook: cb, batchSize: 20, doubleCode })); }, [doubleCode, model, cb]);
  const errors = mod?.validateCodebook ? mod.validateCodebook(cb) : [];
  if (mod === undefined) return html`<${Loading} />`;
  if (!mod) return html`<${Unavailable}>Content coding (src/llm/coding.js) is not available in this build.</${Unavailable}>`;
  if (!hasText(ds)) return html`<p class="text2">This data has no message text to code.</p>`;
  const draw = () => {
    setErr(null); setRes(null);
    try {
      const s = mod.sampleMessages(ds, { size, strata: strata || null, seed: 1 });
      setSample(s);
      setEst(mod.estimateCoding({ provider: provider.id, model, ds, sample: s, codebook: cb, batchSize: 20, doubleCode }));
    } catch (e) { setErr(e); }
  };
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const key = await getKey(provider.id);
      const r = await store.actions.runJob('Coding messages', (signal, progress) => mod.codeMessages({ provider, key, model, ds: sendDs, sample, codebook: cb, batchSize: 20, doubleCode, signal, onProgress: p => progress(((p.pass - 1) + p.done / p.total) / (doubleCode ? 2 : 1), `pass ${p.pass}: ${p.done} of ${p.total}`) }));
      setRes(r);
      store.actions.focus('#cres-h');
    } catch (e) { if (e.name !== 'AbortError') setErr(await redact(e.message)); } finally { setBusy(false); }
  };
  const setCode = (i, patch) => setCb(c => ({ ...c, codes: c.codes.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const counts = res ? cb.codes.map(c => ({ label: c.label || c.id, value: res.results.filter(r => r.codes?.includes(c.id)).length })) : [];
  const t = tokens();
  const exportCSV = () => {
    const rows = [['event', 'codes', ...(doubleCode ? ['codes_second'] : []), 'text']];
    for (const r of res.results) rows.push([r.event, (r.codes || []).join('|'), ...(doubleCode ? [(r.codesB || []).join('|')] : []), String(ds.events.text[r.event] || '').replace(/\s+/g, ' ')]);
    saveFile(rows.map(r => r.map(x => { const s = String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n'), 'coded-messages.csv', 'text/csv');
  };
  return html`<div class="stack">
    <p class="small text2">Codes are defined, a stratified sample is drawn, and the cost is estimated before the run. Only message text is sent, with no names, ids, channels, or times attached. Double-coding runs the sample twice in a different order and reports agreement as an estimate of coding reliability.</p>
    <section aria-labelledby="cb-h">
      <h3 id="cb-h" class="label">Codebook</h3>
      <div class="grid-2">
        <label class="field"><span>Name</span><input class="input" value=${cb.name} onInput=${e => setCb(c => ({ ...c, name: e.currentTarget.value }))} /></label>
        <label class="check" style="align-self:end"><input type="checkbox" checked=${cb.multiLabel} onChange=${e => setCb(c => ({ ...c, multiLabel: e.currentTarget.checked }))} />A message may get several codes</label>
      </div>
      <label class="field" style="margin-top:.6rem"><span>Instructions for the coder (optional)</span><textarea class="input" rows="2" value=${cb.instructions} onInput=${e => setCb(c => ({ ...c, instructions: e.currentTarget.value }))}></textarea></label>
      <div style="margin-top:.6rem">
        ${cb.codes.map((c, i) => html`<div class="grid-3" style="padding:.6rem 0;border-top:1px solid var(--rule);gap:.5rem 1rem">
          <label class="field"><span>Id</span><input class="input" value=${c.id} onInput=${e => setCode(i, { id: e.currentTarget.value })} /></label>
          <label class="field"><span>Label</span><input class="input" value=${c.label} onInput=${e => setCode(i, { label: e.currentTarget.value })} /></label>
          <label class="field" style="grid-column:1/-1"><span>Definition</span><input class="input" value=${c.definition} onInput=${e => setCode(i, { definition: e.currentTarget.value })} /></label>
          <label class="field" style="grid-column:1/-1"><span>Examples (one per line, optional)</span><textarea class="input" rows="2" value=${(c.examples || []).join('\n')} onInput=${e => setCode(i, { examples: e.currentTarget.value.split('\n').filter(Boolean) })}></textarea></label>
          <div><button type="button" class="tlink tlink--quiet" onClick=${() => { setCb(x => ({ ...x, codes: x.codes.filter((_, j) => j !== i) })); store.actions.focus('#cb-add'); }}>Remove code</button></div>
        </div>`)}
        <button type="button" id="cb-add" class="tlink" onClick=${() => setCb(x => ({ ...x, codes: [...x.codes, { id: `code${x.codes.length + 1}`, label: '', definition: '' }] }))}>Add a code</button>
      </div>
      ${errors.length > 0 && html`<ul class="can-list" style="margin-top:.6rem">${errors.map(e => html`<li style="color:var(--warn)">${e}</li>`)}</ul>`}
    </section>
    <section class="section" aria-labelledby="smp-h">
      <h3 id="smp-h" class="label">Sample</h3>
      <div class="grid-3">
        <label class="field"><span>Messages</span><input class="input tnum" type="number" min="10" max="5000" value=${size} onInput=${e => setSize(Math.max(10, Number(e.currentTarget.value) || 200))} /></label>
        <${Select} label="Spread across" value=${strata} onChange=${setStrata} options=${[{ value: 'context', label: 'Channels and threads' }, { value: 'actor', label: 'People' }, { value: 'month', label: 'Months' }, { value: 'source', label: 'Sources' }, { value: '', label: 'No strata (simple random)' }]} />
        <label class="check" style="align-self:end"><input type="checkbox" checked=${doubleCode} onChange=${e => setDouble(e.currentTarget.checked)} />Double-code for agreement</label>
      </div>
      <div class="row" style="margin-top:.6rem"><button type="button" class="tlink" onClick=${draw} disabled=${errors.length > 0}>Draw sample and estimate</button></div>
      ${sample && html`<p class="small text2" style="margin-top:.5rem">${fmtInt(sample.size ?? sample.events.length)} messages drawn from ${fmtInt(sample.population)} eligible, across ${fmtInt(Object.keys(sample.strata || {}).length)} strata (seed ${sample.seed}).</p>`}
      ${est && html`<p class="small text2">${fmtInt(est.calls)} requests. Estimated cost ${fmtUSD(est.usd)} to ${fmtUSD(est.usdHigh)}. <span class="basis">${est.note}</span></p>`}
      ${sample && html`<div class="row" style="margin-top:.4rem"><button type="button" class="btn btn--primary" onClick=${run} disabled=${busy || errors.length > 0}>Run coding</button></div>`}
    </section>
    <${ErrorLine} error=${err} />
    ${res && html`<section class="section" aria-labelledby="cres-h">
      <h3 id="cres-h" class="section__title" tabindex="-1">Results</h3>
      <div style="max-width:40rem"><${BarList} title="Messages per code" color=${t.cat[0]} rows=${counts} format=${fmtInt} /></div>
      <dl class="kv" style="max-width:30rem;margin-top:.8rem">
        <dt>Coded</dt><dd>${fmtInt(res.results.length - res.uncoded)}</dd>
        <dt>Not coded (failed or empty)</dt><dd>${fmtInt(res.uncoded)}</dd>
        <dt>Codes outside the codebook, dropped</dt><dd>${fmtInt(res.droppedCodes)}</dd>
        ${res.agreement && Object.entries(res.agreement).filter(([, v]) => typeof v === 'number').map(([k, v]) => html`<dt>${humanize(k)}</dt><dd>${fmtNum(v, { digits: 3 })}</dd>`)}
      </dl>
      ${res.agreement && html`<p class="basis">Agreement between two independent passes. Kappa below about 0.6 means the codes are not applied consistently; refine the definitions before using the counts.</p>`}
      ${res.errors?.length > 0 && html`<p class="small" style="color:var(--warn)"><${Flag} level="caution" /> ${res.errors.length} batch(es) failed: ${res.errors.slice(0, 3).map(e => e.message).join('; ')}</p>`}
      <div class="tlinks" style="margin-top:.6rem"><button type="button" class="tlink tlink--down" onClick=${exportCSV}>Coded messages (CSV)</button></div>
    </section>`}
  </div>`;
}
