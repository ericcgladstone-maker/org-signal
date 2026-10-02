// Content view: what people wrote, measured without an LLM. Affect by group,
// layer or month (lexicon-based, marked approximate, with coverage),
// distinctive keywords by group, topics with their top terms and shares, and
// a diffusion explorer for terms: adoption over time and the cascade along
// ties, compared with a null in which adoption times are shuffled.

import { html, useState, useMemo } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { engine } from '../services/engine.js';
import { ViewHead, NeedsData, Loading, ErrorLine, Select, ConstructionButton, useEngine, Flag, applicabilityReason } from '../components/common.js';
import { BarList, LineChart } from '../components/charts.js';
import { tokens } from '../lib/palette.js';
import { groupableAttributes, hasText, textCoverage, label as nodeLabel } from '../lib/dsutil.js';
import { fmtNum, fmtInt, fmtPct, fmtP, fmtDate, humanize } from '../lib/format.js';

export function ContentView() {
  const ds = useStore(s => s.dataset);
  const net = useStore(s => s.network);
  if (!ds || !net) return html`<${NeedsData} title="Content" />`;
  if (!hasText(ds)) {
    return html`<div class="view view--col"><${ViewHead} title="Content" />
      <div class="empty"><h2>This data has no message text</h2>
      <p class="lead">Content measures need the words people wrote. The sources loaded here record who interacted with whom but not what was said (surveys, calendars, network files, or exports without message bodies).</p></div></div>`;
  }
  return html`<${ContentInner} ds=${ds} />`;
}

function ContentInner({ ds }) {
  const [tab, setTab] = useState('affect');
  const coverage = useMemo(() => textCoverage(ds), [ds]);
  return html`<div class="view">
    <${ViewHead} title="Content" intro=${`Measured from message text on this device; nothing is sent anywhere. ${fmtPct(coverage)} of messages carry text.`} actions=${html`<${ConstructionButton} />`} />
    <div class="tabs" role="tablist" aria-label="Content measures">
      ${[['affect', 'Affect'], ['keywords', 'Keywords'], ['topics', 'Topics'], ['diffusion', 'Diffusion']].map(([id, l]) => html`<button role="tab" aria-selected=${String(tab === id)} onClick=${() => setTab(id)}>${l}</button>`)}
    </div>
    <div role="tabpanel">
      ${tab === 'affect' && html`<${Affect} ds=${ds} />`}
      ${tab === 'keywords' && html`<${Keywords} ds=${ds} />`}
      ${tab === 'topics' && html`<${Topics} />`}
      ${tab === 'diffusion' && html`<${Diffusion} ds=${ds} />`}
    </div>
  </div>`;
}

function byOptions(ds) {
  return [
    ...groupableAttributes(ds).map(a => ({ value: `attr:${a.key}`, label: a.label })),
    { value: 'window', label: 'Month' },
    { value: 'visibility', label: 'Visibility layer' },
    { value: 'overall', label: 'Everyone together' },
  ];
}

// UI choice -> engine options ({ by: 'group', attr } | { by: 'window', window } | { by }).
function byOpts(choice) {
  if (choice.startsWith('attr:')) return { by: 'group', attr: choice.slice(5) };
  if (choice === 'window') return { by: 'window', window: 'month' };
  return { by: choice };
}
const rowLabel = (g) => String(g.label ?? g.value ?? g.key);
const byLabel = (choice) => (choice.startsWith('attr:') ? humanize(choice.slice(5)) : choice === 'window' ? 'month' : choice === 'visibility' ? 'visibility layer' : 'everyone');

function Affect({ ds }) {
  const attrs = groupableAttributes(ds);
  const [by, setBy] = useState(attrs[0] ? `attr:${attrs[0].key}` : 'window');
  const ap = useStore(s => s.applicability?.affect);
  const q = useEngine('affect', (ctl) => engine.affect({ ...byOpts(by), ...ctl }), [by], { label: 'Scoring message tone' });
  const t = tokens();
  const r = q.data;
  const groups = r?.groups || (r?.by ? Object.values(r.by)[0] : []) || [];
  const cov = r?.coverage;
  const covShare = typeof cov === 'number' ? cov : cov?.withText ? cov.scored / cov.withText : null;
  return html`<div>
    <div class="toolbar"><${Select} label="Compare by" value=${by} onChange=${setBy} options=${byOptions(ds)} /></div>
    <p class="small text2" style="max-width:66ch;margin-bottom:.8rem"><${Flag} level="caution">Approximate</${Flag}> ${r?.note || 'VADER sentiment (Hutto and Gilbert 2014): each message gets a compound score from -1 (negative) to +1 (positive) from a word list with rules for negation and emphasis. It misses sarcasm, jargon and non-English text. Compare averages over many messages; do not read single messages.'}${covShare != null ? ` ${fmtPct(covShare)} of messages with text were scored` : ''}${cov?.likelyNonEnglish ? `; ${fmtInt(cov.likelyNonEnglish)} look non-English` : ''}${covShare != null ? '.' : ''}${ap?.level === 'na' ? ` ${applicabilityReason(ap)}` : ''}</p>
    ${q.loading && html`<${Loading}>Scoring messages</${Loading}>`}<${ErrorLine} error=${q.error} onRetry=${q.retry} />
    ${r && (by === 'window'
      ? html`<${LineChart} title="Mean tone by month" sub="Mean compound score of scored messages; the shaded band is not a confidence interval" series=${[{ id: 'a', label: 'Tone', color: t.cat[0], values: groups.map(g => ({ x: typeof g.key === 'number' ? g.key : Date.parse(`${g.label}-01T00:00:00Z`), y: g.mean })) }]} height=${220} />`
      : html`<div style="max-width:46rem"><${BarList} diverging=${true} title=${`Mean tone by ${byLabel(by)}`} sub="Bars right of the line lean positive, left lean negative."
          rows=${groups.map(g => ({ label: rowLabel(g), value: g.mean, color: g.mean >= 0 ? 'var(--div-neg-1)' : 'var(--div-pos-1)' }))} max=${Math.max(0.05, ...groups.map(g => Math.abs(g.mean)).filter(Number.isFinite))} format=${x => fmtNum(x, { digits: 2 })} /></div>`)}
    ${r && html`<div class="table-wrap" style="margin-top:1rem;max-width:46rem"><table class="tbl">
      <thead><tr><th scope="col">${humanize(byLabel(by))}</th><th scope="col" class="num">Mean</th><th scope="col" class="num">Std. error</th><th scope="col" class="num">Messages scored</th><th scope="col" class="num">Positive</th><th scope="col" class="num">Negative</th></tr></thead>
      <tbody>${groups.map(g => html`<tr><td class="name">${rowLabel(g)}</td><td class="num">${fmtNum(g.mean, { digits: 2 })}</td><td class="num">${fmtNum(g.se, { digits: 2 })}</td><td class="num">${fmtInt(g.n)}</td><td class="num">${fmtPct(g.posShare)}</td><td class="num">${fmtPct(g.negShare)}</td></tr>`)}</tbody>
    </table></div>`}
  </div>`;
}

function Keywords({ ds }) {
  const attrs = groupableAttributes(ds);
  const [by, setBy] = useState(attrs[0] ? `attr:${attrs[0].key}` : 'visibility');
  const q = useEngine('keywords', (ctl) => engine.keywords({ ...byOpts(by), k: 10, ...ctl }), [by], { label: 'Finding distinctive words' });
  const units = q.data?.units || q.data?.groups || [];
  return html`<div>
    <div class="toolbar"><${Select} label="Distinctive words by" value=${by} onChange=${setBy} options=${byOptions(ds)} /></div>
    <p class="small text2" style="max-width:66ch;margin-bottom:.8rem">Words used more in one group than in the others (${q.data?.meta?.method || q.data?.method || 'TF-IDF across groups'}). Frequent words that every group uses are down-weighted.</p>
    ${q.loading && html`<${Loading}>Counting words</${Loading}>`}<${ErrorLine} error=${q.error} onRetry=${q.retry} />
    ${q.data && !units.length && html`<p class="small text2">Not enough text per group to find distinctive words.</p>`}
    ${q.data && html`<div class="grid-3">${units.slice(0, 30).map(g => html`<div>
      <p class="label">${rowLabel(g)}</p>
      <ol style="margin:0;padding-left:1.2rem;color:var(--text-2);font-size:.875rem">${(g.terms || []).map(t => html`<li><span style="color:var(--text)">${t.term}</span> <span class="meta">${fmtInt(t.count)}</span></li>`)}</ol>
    </div>`)}</div>`}
  </div>`;
}

function Topics() {
  const [k, setK] = useState(6);
  const q = useEngine('topics', (ctl) => engine.topics({ k, seed: 1, ...ctl }), [k], { label: 'Fitting topics' });
  const t = tokens();
  const r = q.data;
  return html`<div>
    <div class="toolbar"><${Select} label="Number of topics" value=${String(k)} onChange=${v => setK(Number(v))} options=${[4, 6, 8, 10, 12].map(n => ({ value: String(n), label: String(n) }))} /></div>
    <p class="small text2" style="max-width:66ch;margin-bottom:.8rem">${r?.meta?.method || r?.method || 'Latent Dirichlet allocation (collapsed Gibbs sampling)'}${r?.meta?.documents ?? r?.documents ? ` over ${fmtInt(r.meta?.documents ?? r.documents)} documents` : ''}, seed ${r?.meta?.seed ?? r?.seed ?? 1}. Topics are word clusters, not themes someone named; read the terms before naming one. A different number of topics or seed gives a different split.</p>
    ${q.loading && html`<${Loading}>Fitting topics</${Loading}>`}<${ErrorLine} error=${q.error} onRetry=${q.retry} />
    ${r && html`<div style="max-width:52rem"><${BarList} title="Share of messages by topic" color=${t.cat[0]}
      rows=${(r.topics || []).map((tp, i) => ({ label: `${i + 1}. ${(tp.terms || []).slice(0, 4).map(x => (typeof x === 'string' ? x : x.term)).join(', ')}`, value: tp.share }))} format=${x => fmtPct(x)} max=${1} /></div>
      <div class="grid-3" style="margin-top:1.25rem">${(r.topics || []).map((tp, i) => html`<div><p class="label">Topic ${i + 1} · ${fmtPct(tp.share)}</p><p class="small text2">${(tp.terms || []).map(x => (typeof x === 'string' ? x : x.term)).join(', ')}</p></div>`)}</div>`}
  </div>`;
}

function Diffusion({ ds }) {
  const [input, setInput] = useState('');
  const [terms, setTerms] = useState(null);
  const [auto, setAuto] = useState(false);
  const q = useEngine('diffusion', (ctl) => engine.diffusion({ ...(auto ? { auto: 8 } : { terms }), reps: 200, seed: 1, ...ctl }), [terms, auto], { enabled: auto || !!terms?.length, label: 'Tracing diffusion' });
  const t = tokens();
  const list = Array.isArray(q.data) ? q.data : q.data?.terms || [];
  return html`<div>
    <form class="toolbar" onSubmit=${e => { e.preventDefault(); const ts = input.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 4); if (ts.length) setTerms(ts); }}>
      <label class="field field--grow"><span>Terms to trace (comma separated)</span><input class="input" value=${input} onInput=${e => setInput(e.currentTarget.value)} placeholder="for example: roadmap, offsite" /></label>
      <button class="btn btn--primary" type="submit" onClick=${() => setAuto(false)}>Trace</button>
      <button class="btn" type="button" onClick=${() => { setTerms(null); setAuto(true); }}>Find new words automatically</button>
    </form>
    <p class="small text2" style="max-width:66ch;margin-bottom:.8rem">When a term spreads along ties, new adopters will often have a contact who used it first. The null model shuffles adoption times among the same adopters; only a share of exposed adopters clearly above that null suggests spread through the network rather than a shared outside cause.</p>
    ${q.loading && html`<${Loading}>Tracing adoption</${Loading}>`}<${ErrorLine} error=${q.error} onRetry=${q.retry} />
    ${list.map(d => { const ex = d.exposure || (d.null ? { observed: d.exposedShare, mean: d.null.mean, sd: d.null.sd, z: d.null.z, p: d.null.pUpper, reps: d.null.reps, null: 'adoption times shuffled among the same adopters' } : null);
      const timeline = d.timeline || (d.adoptions || []).map((a, i) => ({ t: a.t, cumulative: i + 1 }));
      const cascade = d.cascade && Array.isArray(d.cascade) ? d.cascade : (d.adoptions || []).filter(a => a.from != null).map(a => ({ from: a.from, to: a.node, t: a.t }));
      return html`<section class="section" aria-label=${`Diffusion of ${d.term}`}>
      <h2 class="section__title">"${d.term}"</h2>
      ${!d.adopters ? html`<p class="small text2">Nobody in the data used this term.</p>` : html`
      <div class="grid-2">
        <${LineChart} title="Adopters over time" sub="Cumulative number of people who have used the term" series=${[{ id: d.term, label: d.term, color: t.cat[0], values: timeline.map(p => ({ x: p.t, y: p.cumulative })) }]} height=${180} area=${true} />
        <div>
          <p class="label">Exposure compared with the null</p>
          <dl class="kv">
            <dt>Adopters</dt><dd>${fmtInt(d.adopters)}</dd>
            <dt>Adopters with an earlier adopter among their contacts</dt><dd>${fmtPct(ex?.observed)}</dd>
            <dt>Same, with adoption times shuffled</dt><dd>${fmtPct(ex?.mean)}</dd>
            <dt>z</dt><dd>${fmtNum(ex?.z, { digits: 2 })}</dd>
            <dt>p (one-sided)</dt><dd>${fmtP(ex?.p)}</dd>
          </dl>
          <div class="reading" style="margin-top:.8rem"><p>${ex && ex.p < 0.05 && ex.observed > ex.mean
            ? `Adopters had an earlier adopter among their contacts more often than chance timing would give. That fits spread along ties, though shared channels or outside events can produce the same pattern.`
            : `Exposure to earlier adopters is not clearly above the shuffled null, so the data do not show this term spreading along ties.`}</p></div>
          <p class="basis">Null: ${ex?.null || 'adoption times shuffled across adopters'}, ${ex?.reps ?? 200} replicates.</p>
        </div>
      </div>
      ${cascade.length > 0 && html`<details class="disclose"><summary>Cascade along ties (${fmtInt(cascade.length)} adoptions after a contact${d.cascade?.maxDepth ? `, longest chain ${d.cascade.maxDepth} steps` : ''})</summary>
        <ol class="can-list">${cascade.slice(0, 40).map(c => html`<li>${nodeLabel(ds, c.to)} after ${nodeLabel(ds, c.from)}, ${fmtDate(c.t)}</li>`)}</ol></details>`}`}
    </section>`; })}
  </div>`;
}
