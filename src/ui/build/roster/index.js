// Roster (bounded network) builder UI: roster -> relations -> collect -> review.

import { html, useState, useMemo } from '../../../../vendor/preact.js';
import { newRoster, makeRelation, RELATION_PRESETS, MERGE_RULES, formTemplate, parseRosterResponses, responsesFromDataset, tiesFor, toDataset, coverage } from '../../../builders/roster.js';
import { setTie } from '../../../builders/matrix.js';
import { Steps, HandOffBar, usePersistentState, downloadText, pickFile, readFileText } from '../shared.js';
import { importRosterResponses } from '../service.js';
import { Matrix, PairEntry } from './Matrix.js';
import { PeopleEditor } from './People.js';

const KEY = 'orgsignal.build.roster';
const STEPS = [
  { id: 'roster', label: 'Roster' },
  { id: 'relations', label: 'Relations' },
  { id: 'collect', label: 'Collect ties' },
  { id: 'review', label: 'Review' },
];

export function RosterBuilder() {
  const [model, setModel] = usePersistentState(KEY, newRoster);
  const [step, setStep] = useState(model.people.length ? (model.relations.length ? 'collect' : 'relations') : 'roster');
  const patch = p => setModel(m => ({ ...m, ...(typeof p === 'function' ? p(m) : p) }));
  const done = [model.people.length > 1 && 'roster', model.relations.length && 'relations',
    model.relations.some(r => Object.keys(tiesFor(model, r.id).ties).length) && 'collect'].filter(Boolean);
  const idx = STEPS.findIndex(s => s.id === step);

  return html`<div class="ob-stack">
    <div class="ob-row">
      <${Steps} steps=${STEPS} value=${step} onChange=${setStep} done=${done} />
      <span class="ob-spacer"></span>
      <button type="button" class="ob-btn quiet sm" onClick=${() => { if (confirm('Start a new roster? The current one will be cleared.')) { setModel(newRoster()); setStep('roster'); } }}>New roster</button>
    </div>
    ${step === 'roster' ? html`<${PeopleEditor} people=${model.people} attrColumns=${model.attrColumns} idPrefix="ob-roster"
        onChange=${(people, attrColumns) => patch({ people, attrColumns })} />`
    : step === 'relations' ? html`<${Relations} model=${model} patch=${patch} />`
    : step === 'collect' ? html`<${Collect} model=${model} patch=${patch} />`
    : html`<${Review} model=${model} patch=${patch} />`}
    <div class="ob-navrow">
      <button type="button" class="ob-btn" disabled=${idx === 0} onClick=${() => setStep(STEPS[idx - 1].id)}>Back</button>
      <span class="ob-spacer"></span>
      ${idx < STEPS.length - 1 ? html`<button type="button" class="ob-btn primary" onClick=${() => setStep(STEPS[idx + 1].id)}>Next: ${STEPS[idx + 1].label}</button>` : null}
    </div>
  </div>`;
}

function Relations({ model, patch }) {
  const [custom, setCustom] = useState('');
  const has = p => model.relations.some(r => r.name === p.name);
  const togglePreset = p => patch(m => ({ relations: has(p) ? m.relations.filter(r => r.name !== p.name) : [...m.relations, makeRelation(p)] }));
  const update = (id, q) => patch(m => ({ relations: m.relations.map(r => (r.id === id ? { ...r, ...q } : r)) }));
  const remove = id => patch(m => ({ relations: m.relations.filter(r => r.id !== id), ties: Object.fromEntries(Object.entries(m.ties).filter(([k]) => k !== id)) }));
  return html`<div class="ob-stack">
    <fieldset class="ob-fieldset">
      <legend>Common relations</legend>
      <div class="ob-row">${RELATION_PRESETS.map(p => html`<label class="ob-check"><input type="checkbox" checked=${has(p)} onChange=${() => togglePreset(p)} />${p.name}</label>`)}</div>
    </fieldset>
    <form class="ob-row" onSubmit=${e => { e.preventDefault(); if (custom.trim()) { patch(m => ({ relations: [...m.relations, makeRelation({ name: custom.trim(), question: '' })] })); setCustom(''); } }}>
      <label class="visually-hidden" for="ob-rel-custom">Custom relation</label>
      <input id="ob-rel-custom" class="ob-input" style="max-width:18rem" placeholder="Custom relation, e.g. Shares information" value=${custom} onInput=${e => setCustom(e.currentTarget.value)} />
      <button type="submit" class="ob-btn" disabled=${!custom.trim()}>Add relation</button>
    </form>
    ${model.relations.length ? html`<div class="ob-tablewrap"><table class="ob-table">
      <thead><tr><th>Relation</th><th>Question asked</th><th>Answer</th><th class="num">Top of scale</th><th><span class="visually-hidden">Remove</span></th></tr></thead>
      <tbody>${model.relations.map(r => html`<tr>
        <td><input class="ob-input" aria-label="Relation name" value=${r.name} onChange=${e => update(r.id, { name: e.currentTarget.value || r.name })} /></td>
        <td style="min-width:16rem"><input class="ob-input" aria-label=${`Question for ${r.name}`} value=${r.question} placeholder="Question text" onChange=${e => update(r.id, { question: e.currentTarget.value })} /></td>
        <td><select class="ob-select" aria-label=${`Answer type for ${r.name}`} value=${r.scale} onChange=${e => update(r.id, { scale: e.currentTarget.value })}>
          <option value="binary">Yes or no</option><option value="valued">Rating</option></select></td>
        <td class="num">${r.scale === 'valued' ? html`<input class="ob-input" type="number" min="2" max="10" style="width:4.5rem" aria-label=${`Top of scale for ${r.name}`} value=${r.max}
          onChange=${e => update(r.id, { max: Math.max(2, Math.min(10, Number(e.currentTarget.value) || 5)) })} />` : html`<span class="muted">—</span>`}</td>
        <td><button type="button" class="ob-btn quiet sm" aria-label=${`Remove ${r.name}`} onClick=${() => remove(r.id)}>Remove</button></td>
      </tr>`)}</tbody></table></div>` : html`<p class="ob-empty">Choose at least one relation.</p>`}
  </div>`;
}

function Collect({ model, patch }) {
  const [relId, setRelId] = useState(model.relations[0]?.id);
  const [entry, setEntry] = useState(model.people.length > 25 ? 'grid' : 'grid');
  const rel = model.relations.find(r => r.id === relId) || model.relations[0];
  if (!model.people.length || !rel) return html`<p class="ob-empty">Add the roster and at least one relation first.</p>`;
  const values = model.ties[rel.id] || {};
  const onSet = (from, to, v) => patch(m => ({ ties: { ...m.ties, [rel.id]: setTie(m.ties[rel.id] || {}, from, to, v) } }));
  return html`<div class="ob-stack">
    <fieldset class="ob-fieldset">
      <legend>Who answers</legend>
      <div class="ob-choices">
        <label class="ob-choice"><input type="radio" name="ob-roster-mode" checked=${model.mode === 'single'} onChange=${() => patch({ mode: 'single' })} /><span>One informant fills the grid</span></label>
        <label class="ob-choice"><input type="radio" name="ob-roster-mode" checked=${model.mode === 'multi'} onChange=${() => patch({ mode: 'multi' })} /><span>Each member answers a survey</span></label>
      </div>
    </fieldset>
    ${model.mode === 'single' ? html`
      <div class="ob-row">
        ${model.relations.length > 1 ? html`<div class="ob-field"><label for="ob-roster-rel">Relation</label>
          <select id="ob-roster-rel" class="ob-select" value=${rel.id} onChange=${e => setRelId(e.currentTarget.value)}>
            ${model.relations.map(r => html`<option value=${r.id}>${r.name}</option>`)}</select></div>` : html`<span class="ob-label">${rel.name}</span>`}
        <span class="ob-spacer"></span>
        <div class="ob-row" role="group" aria-label="Entry method">
          <button type="button" class="ob-btn sm" aria-pressed=${entry === 'grid'} onClick=${() => setEntry('grid')}>Grid</button>
          <button type="button" class="ob-btn sm" aria-pressed=${entry === 'pairs'} onClick=${() => setEntry('pairs')}>Pairs</button>
        </div>
      </div>
      ${rel.question ? html`<p class="ob-note">${rel.question}</p>` : null}
      ${entry === 'grid'
        ? html`<${Matrix} people=${model.people} values=${values} onSet=${onSet} scale=${rel.scale} max=${rel.max} caption=${`${rel.name} ties`} rowHeading="Who" colHeading="Names" />`
        : html`<${PairEntry} people=${model.people} values=${values} onSet=${onSet} scale=${rel.scale} max=${rel.max} />`}`
    : html`<${MultiCollect} model=${model} patch=${patch} />`}
  </div>`;
}

function MultiCollect({ model, patch }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  let tpl = null, tplErr = null;
  try { tpl = formTemplate(model); } catch (e) { tplErr = e.message; }
  const resp = model.responses;
  const cov = coverage(model);
  const importResponses = async () => {
    const f = await pickFile('.csv,.tsv,text/csv');
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      // The survey importer (importers-A) gets the first try; if it is not in
      // the build or does not recognise the file, the documented roster-matrix
      // shapes are parsed here.
      const ds = await importRosterResponses(f);
      let r = ds ? responsesFromDataset(ds, model) : null;
      if (!r || !r.respondents.length) r = parseRosterResponses(await readFileText(f), model);
      patch({ responses: { ...r, file: f.name } });
      if (!r.respondents.length) setErr('No responses could be matched to the roster. Check that the file has a "Your name" column and grid columns named "Question [Name]".');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  return html`<div class="ob-stack">
    <div class="ob-section">
      <h3>1. Build the form</h3>
      ${tplErr ? html`<p class="ob-err">${tplErr}</p>` : html`
        <p class="ob-note">Download a template and the written instructions. The template's columns are exactly what Google Forms or Qualtrics will export, so it also works for typing in paper questionnaires.</p>
        <div class="ob-row">
          <button type="button" class="ob-btn" onClick=${() => downloadText('roster-template-google-forms.csv', tpl.googleCsv, 'text/csv')}>Template, Google Forms shape</button>
          <button type="button" class="ob-btn" onClick=${() => downloadText('roster-template-qualtrics.csv', tpl.qualtricsCsv, 'text/csv')}>Template, Qualtrics shape</button>
          <button type="button" class="ob-btn" onClick=${() => downloadText('roster-form-instructions.txt', tpl.instructions)}>Instructions</button>
        </div>
        <details><summary class="ob-linkbtn">Read the instructions here</summary>
          <pre class="ob-instructions">${tpl.instructions}</pre></details>`}
    </div>
    <div class="ob-section">
      <h3>2. Import the responses</h3>
      <div class="ob-row">
        <button type="button" class="ob-btn primary" disabled=${busy || !!tplErr} onClick=${importResponses}>${busy ? 'Reading...' : 'Import responses CSV'}</button>
        ${resp?.file ? html`<span class="ob-note">${resp.file}${resp.format ? ` (${resp.format})` : ''}</span>` : null}
      </div>
      ${err ? html`<p class="ob-err" role="alert">${err}</p>` : null}
      ${resp ? html`<dl class="ob-kv">
        <dt>Responded</dt><dd>${cov.respondents} of ${cov.of}</dd>
        ${cov.missing.length ? html`<dt>No response</dt><dd>${cov.missing.slice(0, 12).join(', ')}${cov.missing.length > 12 ? ` and ${cov.missing.length - 12} more` : ''}</dd>` : null}
        ${resp.unmatchedNames?.length ? html`<dt>Not on roster</dt><dd class="ob-warn">${resp.unmatchedNames.join(', ')}</dd>` : null}
        ${resp.unmatchedQuestions?.length ? html`<dt>Unused questions</dt><dd class="ob-warn">${resp.unmatchedQuestions.join('; ')}</dd>` : null}
        ${(resp.warnings || []).map(w => html`<dt>Note</dt><dd>${w}</dd>`)}
      </dl>` : null}
    </div>
    <fieldset class="ob-fieldset">
      <legend>3. Combine the self-reports</legend>
      ${MERGE_RULES.map(r => html`<label class="ob-check" style="align-items:flex-start">
        <input type="radio" name="ob-merge" checked=${model.mergeRule === r.id} onChange=${() => patch({ mergeRule: r.id })} />
        <span><strong>${r.label}</strong>. <span class="muted">${r.help}</span></span></label>`)}
    </fieldset>
  </div>`;
}

function Review({ model, patch }) {
  const [sel, setSel] = useState(() => model.relations.map(r => r.id));
  const rows = useMemo(() => model.relations.map(r => ({ r, ...tiesFor(model, r.id) })), [model]);
  const nTies = rows.filter(x => sel.includes(x.r.id)).reduce((s, x) => s + Object.keys(x.ties).length, 0);
  return html`<div class="ob-stack">
    <div class="ob-field" style="max-width:24rem">
      <label for="ob-roster-name">Network name</label>
      <input id="ob-roster-name" class="ob-input" value=${model.name} onInput=${e => patch({ name: e.currentTarget.value })} />
    </div>
    <div class="ob-tablewrap"><table class="ob-table">
      <thead><tr><th>Include</th><th>Relation</th><th class="num">Ties</th><th>Direction</th>${model.mode === 'multi' ? html`<th class="num">Reciprocated</th>` : null}</tr></thead>
      <tbody>${rows.map(x => html`<tr>
        <td><input type="checkbox" aria-label=${`Include ${x.r.name}`} checked=${sel.includes(x.r.id)}
          onChange=${e => setSel(s => (e.currentTarget.checked ? [...s, x.r.id] : s.filter(i => i !== x.r.id)))} /></td>
        <td>${x.r.name}</td><td class="num">${Object.keys(x.ties).length}</td>
        <td>${x.directed ? 'directed' : 'undirected'}</td>
        ${model.mode === 'multi' ? html`<td class="num">${x.stats.reciprocated ?? '—'}</td>` : null}
      </tr>`)}</tbody></table></div>
    <dl class="ob-kv">
      <dt>People</dt><dd>${model.people.length}</dd>
      <dt>Collected by</dt><dd>${model.mode === 'multi' ? `survey of members, ${MERGE_RULES.find(r => r.id === model.mergeRule)?.label.toLowerCase()}` : 'one informant'}</dd>
      <dt>Kind of network</dt><dd>full (bounded roster), self-reported</dd>
    </dl>
    <${HandOffBar} disabled=${!model.people.length || !sel.length} build=${() => toDataset(model, { relationIds: sel })}
      note=${nTies ? null : 'No ties yet; the network will have isolates only.'} />
  </div>`;
}
