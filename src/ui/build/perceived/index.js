// Perceived networks (cognitive social structures) UI:
// people -> informants -> each informant's report -> results.

import { html, useState, useMemo } from '../../../../vendor/preact.js';
import { newCSS, addInformant, perInformantAccuracy, disagreement, referenceFromDataset, viewTies, viewLabel, toDataset, las } from '../../../builders/perceived.js';
import { setTie, parseAdjacencyCSV, adjacencyCSV, splitKey } from '../../../builders/matrix.js';
import { Steps, HandOffBar, usePersistentState, pickFile, readFileText, downloadText } from '../shared.js';
import { currentDataset } from '../service.js';
import { useStore } from '../../store.js';
import { Matrix } from '../roster/Matrix.js';
import { PeopleEditor } from '../roster/People.js';

const KEY = 'orgsignal.build.perceived';
const STEPS = [
  { id: 'people', label: 'People' },
  { id: 'informants', label: 'Informants' },
  { id: 'reports', label: 'Reports' },
  { id: 'results', label: 'Compare' },
];

export function PerceivedBuilder() {
  const [css, setCss] = usePersistentState(KEY, newCSS);
  const [step, setStep] = useState(css.people.length ? (css.informants.length ? 'reports' : 'informants') : 'people');
  const patch = p => setCss(c => ({ ...c, ...(typeof p === 'function' ? p(c) : p) }));
  const idx = STEPS.findIndex(s => s.id === step);
  const done = [css.people.length > 1 && 'people', css.informants.length > 1 && 'informants',
    css.informants.length && css.informants.every(i => Object.keys(i.ties).length) && 'reports'].filter(Boolean);
  return html`<div class="ob-stack">
    <div class="ob-row">
      <${Steps} steps=${STEPS} value=${step} onChange=${setStep} done=${done} />
      <span class="ob-spacer"></span>
      <button type="button" class="tlink tlink--quiet" onClick=${() => { if (confirm('Start over? Reports entered so far will be cleared.')) { setCss(newCSS()); setStep('people'); } }}>Start over</button>
    </div>
    ${step === 'people' ? html`<${PeopleEditor} people=${css.people} withAttrs=${false} idPrefix="ob-css"
        onChange=${people => patch(c => ({ people, informants: c.informants.filter(i => !i.personId || people.some(p => p.id === i.personId)) }))} />`
    : step === 'informants' ? html`<${Informants} css=${css} patch=${patch} />`
    : step === 'reports' ? html`<${Reports} css=${css} patch=${patch} />`
    : html`<${Results} css=${css} />`}
    <div class="ob-navrow">
      ${idx > 0 ? html`<button type="button" class="tlink tlink--quiet" onClick=${() => setStep(STEPS[idx - 1].id)}>Back: ${STEPS[idx - 1].label}</button>` : html`<span></span>`}
      <span class="ob-spacer"></span>
      ${idx < STEPS.length - 1 ? html`<button type="button" class="btn btn--primary" onClick=${() => setStep(STEPS[idx + 1].id)}>Next: ${STEPS[idx + 1].label}</button>` : null}
    </div>
  </div>`;
}

function Informants({ css, patch }) {
  const isInf = id => css.informants.some(i => i.personId === id);
  const toggle = id => patch(c => (isInf(id) ? { informants: c.informants.filter(i => i.personId !== id) } : addInformant(c, id)));
  return html`<div class="ob-stack">
    <div class="ob-grid-form">
      <div class="field"><label class="field__label" for="ob-css-rel">Relation</label>
        <input id="ob-css-rel" class="input" value=${css.relation.name} onInput=${e => patch(c => ({ relation: { ...c.relation, name: e.currentTarget.value } }))} /></div>
      <div class="field" style="grid-column:span 2"><label class="field__label" for="ob-css-q">Question each informant answers about every pair</label>
        <input id="ob-css-q" class="input" value=${css.relation.question} onInput=${e => patch(c => ({ relation: { ...c.relation, question: e.currentTarget.value } }))} /></div>
    </div>
    <p class="ob-note">Informants are usually the roster members themselves, which is what the locally aggregated structures need: the tie from i to j is judged by i and j. Outside observers can be added too; they count toward the consensus only.</p>
    <fieldset class="ob-fieldset">
      <legend>Roster members who report</legend>
      <div class="ob-row">
        <button type="button" class="btn btn--sm" onClick=${() => patch(c => css.people.reduce((acc, p) => (acc.informants.some(i => i.personId === p.id) ? acc : addInformant(acc, p.id)), c))}>Everyone</button>
        <button type="button" class="btn btn--sm" onClick=${() => patch(c => ({ informants: c.informants.filter(i => !i.personId) }))}>No one</button>
      </div>
      <div class="ob-row">${css.people.map(p => html`<label class="check"><input type="checkbox" checked=${isInf(p.id)} onChange=${() => toggle(p.id)} />${p.label}</label>`)}</div>
    </fieldset>
    <div class="ob-row">
      <button type="button" class="btn" onClick=${() => patch(c => addInformant(c, null))}>Add an outside observer</button>
      <span class="meta">${css.informants.length} informants</span>
    </div>
    ${css.informants.filter(i => !i.personId).map(i => html`<div class="ob-row">
      <label class="visually-hidden" for=${'ob-obs-' + i.id}>Observer name</label>
      <input id=${'ob-obs-' + i.id} class="input" style="max-width:16rem" value=${i.label}
        onInput=${e => patch(c => ({ informants: c.informants.map(x => (x.id === i.id ? { ...x, label: e.currentTarget.value } : x)) }))} />
      <button type="button" class="btn btn--sm btn--quiet" onClick=${() => patch(c => ({ informants: c.informants.filter(x => x.id !== i.id) }))}>Remove</button>
    </div>`)}
  </div>`;
}

function Reports({ css, patch }) {
  const [cur, setCur] = useState(css.informants[0]?.id);
  const [msg, setMsg] = useState(null);
  const inf = css.informants.find(i => i.id === cur) || css.informants[0];
  if (!inf) return html`<p class="ob-empty">Choose informants first.</p>`;
  const setInf = ties => patch(c => ({ informants: c.informants.map(x => (x.id === inf.id ? { ...x, ties } : x)) }));
  const onSet = (from, to, v) => setInf(setTie(inf.ties, from, to, v));
  const importCsv = async () => {
    const f = await pickFile('.csv,.tsv,text/csv');
    if (!f) return;
    const r = parseAdjacencyCSV(await readFileText(f), css.people);
    if (r.error) { setMsg({ err: true, text: r.error }); return; }
    setInf(r.ties);
    setMsg({ text: `${Object.keys(r.ties).length} ties read from ${f.name}${r.unknown.length ? `; not on the roster: ${r.unknown.join(', ')}` : ''}.` });
  };
  return html`<div class="ob-stack">
    <div class="ob-row">
      <div class="field"><label class="field__label" for="ob-css-inf">Informant</label>
        <select id="ob-css-inf" class="select" value=${inf.id} onChange=${e => { setCur(e.currentTarget.value); setMsg(null); }}>
          ${css.informants.map(i => html`<option value=${i.id}>${i.label} (${Object.keys(i.ties).length} ties)</option>`)}</select></div>
      <span class="ob-spacer"></span>
      <button type="button" class="btn btn--sm" onClick=${importCsv}>Import matrix CSV</button>
      <button type="button" class="btn btn--sm" onClick=${() => downloadText(`perceived-${inf.label}.csv`, adjacencyCSV(css.people, inf.ties), 'text/csv')}>Download as CSV</button>
      <button type="button" class="btn btn--sm btn--quiet" disabled=${!Object.keys(inf.ties).length} onClick=${() => setInf({})}>Clear</button>
    </div>
    ${msg ? html`<p class=${msg.err ? 'ob-note ob-err' : 'ob-note'} role="status">${msg.text}</p>` : null}
    <p class="ob-note">${css.relation.question || css.relation.name}: the network as ${inf.label} sees it. A row is the person who ${css.relation.name ? `has the ${css.relation.name.toLowerCase()} tie` : 'sends the tie'}, a column the person it goes to.</p>
    <${Matrix} people=${css.people} values=${inf.ties} onSet=${onSet} caption=${`${inf.label}'s view`} />
  </div>`;
}

const pct = x => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—');
const num = x => (Number.isFinite(x) ? x.toFixed(2) : '—');

function Results({ css }) {
  const [threshold, setThreshold] = useState(0.5);
  const [view, setView] = useState('consensus');
  const ds = useStore(s => s.dataset) ?? currentDataset();
  const ref = useMemo(() => (ds ? referenceFromDataset(ds, css.people) : null), [ds, css]);
  const refTies = ref && ref.matched >= 2 ? ref.ties : null;
  const acc = useMemo(() => perInformantAccuracy(css, { threshold, reference: refTies }), [css, threshold, refTies]);
  const dis = useMemo(() => disagreement(css, { limit: 15 }), [css]);
  const ties = useMemo(() => viewTies(css, view, { threshold }), [css, view, threshold]);
  const missing = useMemo(() => las(css, 'union').missing, [css]);
  if (css.informants.length < 2) return html`<p class="ob-empty">Comparing perceptions needs at least two informants.</p>`;
  const views = [
    { id: 'consensus', label: 'Consensus' }, { id: 'las-union', label: 'LAS, union' }, { id: 'las-intersection', label: 'LAS, intersection' },
    ...css.informants.map(i => ({ id: i.id, label: i.label })),
  ];
  return html`<div class="ob-stack">
    <div class="field">
      <label class="field__label" for="ob-css-th">Consensus threshold: ${Math.round(threshold * 100)}% of informants</label>
      <input id="ob-css-th" class="ob-range" type="range" min="0.1" max="1" step="0.05" value=${threshold} onInput=${e => setThreshold(Number(e.currentTarget.value))} />
      <span class="ob-help">A tie is in the consensus structure when at least this share of informants report it.</span>
    </div>

    <div class="ob-section">
      <h3>How each informant compares</h3>
      <p class="ob-note">Hits are ties the informant reported that are also in the ${refTies ? 'criterion' : 'consensus'}; false alarms are ties they reported that are not. Jaccard is hits divided by the ties in either. ${refTies ? `The reference is the loaded network (${ref.matched} roster members matched by name).` : 'Load an observed network for this group to also score against it.'}</p>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Informant</th><th class="num">Ties reported</th><th class="num">Hits</th><th class="num">False alarms</th><th class="num">Hit rate</th><th>Jaccard vs consensus</th>
          ${refTies ? html`<th class="num">Hits vs reference</th><th class="num">False alarms vs reference</th><th class="num">Jaccard vs reference</th>` : null}</tr></thead>
        <tbody>${acc.map(a => html`<tr>
          <td>${a.label}</td><td class="num">${a.reported}</td><td class="num">${a.vsConsensus.hits}</td><td class="num">${a.vsConsensus.falseAlarms}</td>
          <td class="num">${pct(a.vsConsensus.hitRate)}</td>
          <td style="white-space:nowrap"><span class="ob-mono">${num(a.vsConsensus.jaccard)}</span><span class="ob-bartrack" aria-hidden="true"><span class="ob-bar" style=${`width:${(Number.isFinite(a.vsConsensus.jaccard) ? a.vsConsensus.jaccard : 0) * 100}%`}></span></span></td>
          ${refTies ? html`<td class="num">${a.vsReference.hits}</td><td class="num">${a.vsReference.falseAlarms}</td><td class="num">${num(a.vsReference.jaccard)}</td>` : null}
        </tr>`)}</tbody></table></div>
    </div>

    <div class="ob-section">
      <h3>Ties informants disagree about most</h3>
      ${dis.length ? html`<div class="table-wrap"><table class="tbl">
        <thead><tr><th>Tie</th><th class="num">Share reporting it</th><th>Disagreement</th></tr></thead>
        <tbody>${dis.map(d => html`<tr><td>${d.fromLabel} → ${d.toLabel}</td><td class="num">${pct(d.share)}</td>
          <td style="white-space:nowrap"><span class="ob-mono">${num(d.score)}</span><span class="ob-bartrack" aria-hidden="true"><span class="ob-bar" style=${`width:${d.score * 100}%`}></span></span></td></tr>`)}
        </tbody></table></div>
        <p class="ob-note">Disagreement is 4p(1 − p) for the share p of informants reporting the tie: 1 at an even split, 0 when everyone agrees.</p>`
      : html`<p class="ob-note">All informants agree on every tie.</p>`}
    </div>

    <div class="ob-section">
      <h3>Network to analyze</h3>
      <div class="ob-cols">
        <div class="ob-stack">
          <div class="field"><label class="field__label" for="ob-css-view">View</label>
            <select id="ob-css-view" class="select" value=${view} onChange=${e => setView(e.currentTarget.value)}>
              ${views.map(v => html`<option value=${v.id}>${v.label}</option>`)}</select></div>
          <p class="ob-note">${viewLabel(css, view, threshold)}: ${Object.keys(ties).length} ${Object.keys(ties).length === 1 ? "tie" : "ties"}.
            ${view.startsWith('las') && missing.length ? html` <span class="ob-warn">Without their own report: ${missing.join(', ')}.</span>` : null}</p>
          <${HandOffBar} build=${() => toDataset(css, { view, threshold })} />
        </div>
        <${Preview} people=${css.people} ties=${ties} label=${viewLabel(css, view, threshold)} />
      </div>
    </div>
  </div>`;
}

// Small circle-layout drawing of one view. Arrows show direction.
function Preview({ people, ties, label }) {
  const n = people.length, R = 120, C = 160;
  const pos = new Map(people.map((p, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    return [p.id, { x: C + R * Math.cos(a), y: C + R * Math.sin(a), a }];
  }));
  return html`<svg class="ob-preview" viewBox="0 0 320 320" role="img" aria-label=${`${label}: ${Object.keys(ties).length} ties among ${n} people`}>
    <defs><marker id="ob-css-arrow" viewBox="0 0 8 8" refX="12" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L8,4 L0,8 z" fill="var(--edge)" /></marker></defs>
    ${Object.keys(ties).map(k => { const [i, j] = splitKey(k); const a = pos.get(i), b = pos.get(j); return a && b ? html`<line x1=${a.x} y1=${a.y} x2=${b.x} y2=${b.y} marker-end="url(#ob-css-arrow)" />` : null; })}
    ${people.map(p => { const q = pos.get(p.id); const right = Math.cos(q.a) >= 0; return html`<g>
      <circle cx=${q.x} cy=${q.y} r="5" />
      <text x=${q.x + (right ? 9 : -9)} y=${q.y + 3.5} text-anchor=${right ? 'start' : 'end'}>${p.label.length > 14 ? p.label.slice(0, 13) + '…' : p.label}</text></g>`; })}
  </svg>`;
}
