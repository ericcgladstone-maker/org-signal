// Ego builder steps 1 and 2: choose name generators and name interpreters.

import { html } from '../../../../vendor/preact.js';
import * as E from '../../../builders/ego.js';
import { TieFieldsEditor } from '../tiefields.js';

const TYPES = [
  ['text', 'Text'], ['number', 'Number'], ['ordinal', 'Ordered choice'], ['categorical', 'Choice'], ['boolean', 'Yes / no'], ['date', 'Date'],
];

export function GeneratorsStep({ s, update, survey = false }) {
  const has = id => s.generators.some(g => g.id === id);
  const togglePreset = (p, on) => update(x => (on ? E.addGenerator(x, { preset: p.id }) : E.removeGenerator(x, p.id)));
  return html`<div class="ob-stack">
    ${survey ? null : html`<fieldset class="ob-fieldset">
      <legend>Respondent</legend>
      <div class="ob-grid-form">
        <div class="field"><label class="field__label" for="ego-label">Name or pseudonym</label>
          <input id="ego-label" class="input" value=${s.egoLabel} onInput=${e => update(x => ({ ...x, egoLabel: e.target.value }))} /></div>
        <div class="field"><label class="field__label" for="ego-case">Case id</label>
          <input id="ego-case" class="input" value=${s.caseId} placeholder="for example P014" onInput=${e => update(x => ({ ...x, caseId: e.target.value }))} /></div>
      </div>
    </fieldset>`}
    <fieldset class="ob-fieldset">
      <legend>Questions that elicit names</legend>
      <p class="ob-note">Pick one or more. Each question has a cap on how many names it accepts; caps shape network size, so record them in your methods.</p>
      <div class="ob-stack" style="gap:.35rem">
        ${E.GENERATOR_PRESETS.map(p => html`<label class="check ego-preset">
          <input type="checkbox" checked=${has(p.id)} onChange=${e => togglePreset(p, e.target.checked)} />
          <span><strong>${p.name}</strong> <span class="ob-note">${p.prompt}</span></span></label>`)}
      </div>
      <div class="ob-row"><button type="button" class="btn" onClick=${() => update(x => E.addGenerator(x, { name: 'Custom question', prompt: '' }))}>Add a custom question</button></div>
    </fieldset>
    ${s.generators.length ? html`<fieldset class="ob-fieldset">
      <legend>In this interview, in order</legend>
      ${s.generators.map((g, i) => html`<div class="ego-item" key=${g.id}>
        <div class="ego-item-head">
          <span class="meta">Question ${i + 1}</span>
          <button type="button" class="btn btn--sm btn--quiet" onClick=${() => update(x => E.removeGenerator(x, g.id))} aria-label=${'Remove ' + g.name}>Remove</button>
        </div>
        <div class="ego-gen-grid">
          <div class="field"><label class="field__label" for=${'gn-' + g.id}>Short name</label>
            <input id=${'gn-' + g.id} class="input" value=${g.name} onInput=${e => update(x => E.updateGenerator(x, g.id, { name: e.target.value }))} /></div>
          <div class="field"><label class="field__label" for=${'gc-' + g.id}>Most names</label>
            <input id=${'gc-' + g.id} class="input" type="number" min="1" max="100" value=${g.cap}
              onInput=${e => update(x => E.updateGenerator(x, g.id, { cap: Math.max(1, Math.floor(Number(e.target.value) || 1)) }))} /></div>
        </div>
        <div class="field"><label class="field__label" for=${'gp-' + g.id}>Prompt read to the respondent</label>
          <textarea id=${'gp-' + g.id} class="input ego-prompt" rows="2" value=${g.prompt}
            onInput=${e => update(x => E.updateGenerator(x, g.id, { prompt: e.target.value }))}></textarea></div>
      </div>`)}
    </fieldset>` : html`<p class="ob-empty">No questions yet. Pick at least one above.</p>`}
  </div>`;
}

// Options are edited as lines: "value = Label" or just "Label" (value derived).
function optionsToText(options = []) { return options.map(o => (o.value === o.label ? o.label : `${o.value} = ${o.label}`)).join('\n'); }
function textToOptions(t) {
  return t.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = /^(.+?)\s*=\s*(.+)$/.exec(l);
    return m ? { value: E.varName(m[1]), label: m[2] } : { value: E.varName(l), label: l };
  });
}

export function InterpretersStep({ s, update }) {
  const has = id => s.interpreters.some(i => i.id === id);
  const togglePreset = (p, on) => update(x => (on ? E.addInterpreter(x, { preset: p.id }) : E.removeInterpreter(x, p.id)));
  const weighable = s.interpreters.filter(i => i.type === 'number' || i.type === 'ordinal');
  return html`<div class="ob-stack">
    <fieldset class="ob-fieldset">
      <legend>Questions about each person named</legend>
      <div class="ob-stack" style="gap:.35rem">
        ${E.INTERPRETER_PRESETS.map(p => html`<label class="check">
          <input type="checkbox" checked=${has(p.id)} onChange=${e => togglePreset(p, e.target.checked)} />
          <span><strong>${p.label}</strong> <span class="ob-note">${p.options ? p.options.map(o => o.label).join(', ') : 'a number'}</span></span></label>`)}
      </div>
      <div class="ob-row"><button type="button" class="btn" onClick=${() => update(x => E.addInterpreter(x, { label: 'Custom question', type: 'text' }))}>Add a custom question</button></div>
    </fieldset>
    ${s.interpreters.length ? html`<fieldset class="ob-fieldset">
      <legend>Asked about every person</legend>
      ${s.interpreters.map(it => html`<div class="ego-item" key=${it.id}>
        <div class="ego-item-head">
          <span class="meta">${it.name}</span>
          <button type="button" class="btn btn--sm btn--quiet" onClick=${() => update(x => E.removeInterpreter(x, it.id))} aria-label=${'Remove ' + it.label}>Remove</button>
        </div>
        <div class="ego-int-grid">
          <div class="field"><label class="field__label" for=${'il-' + it.id}>Question</label>
            <input id=${'il-' + it.id} class="input" value=${it.label} onInput=${e => update(x => E.updateInterpreter(x, it.id, { label: e.target.value }))} /></div>
          <div class="field"><label class="field__label" for=${'iv-' + it.id}>Variable</label>
            <input id=${'iv-' + it.id} class="input" value=${it.name} onChange=${e => update(x => E.updateInterpreter(x, it.id, { name: e.target.value }))} /></div>
          <div class="field"><label class="field__label" for=${'it-' + it.id}>Answer type</label>
            <select id=${'it-' + it.id} class="select" value=${it.type}
              onChange=${e => update(x => E.updateInterpreter(x, it.id, { type: e.target.value, options: it.options || [] }))}>
              ${TYPES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
            </select></div>
        </div>
        ${it.type === 'categorical' || it.type === 'ordinal' ? html`<div class="field">
          <label class="field__label" for=${'io-' + it.id}>Options, one per line (value = label${it.type === 'ordinal' ? '; values in order' : ''})</label>
          <textarea id=${'io-' + it.id} class="input ego-opts" rows="4" value=${optionsToText(it.options)}
            onChange=${e => update(x => E.updateInterpreter(x, it.id, { options: textToOptions(e.target.value) }))}></textarea></div>` : null}
      </div>`)}
    </fieldset>` : html`<p class="ob-empty">No questions about alters yet. You can still collect names and ties without them.</p>`}
    <fieldset class="ob-fieldset">
      <legend>Questions about each tie</legend>
      <${TieFieldsEditor} fields=${s.tieFields || []} idPrefix="ego-tf" taken=${s.interpreters.map(i => i.name)}
        intro="Details of the respondent's tie to each person (type, strength, how often), recorded on the tie rather than on the person. All optional."
        onChange=${fields => update(x => {
          // Answers to a removed field go with it.
          const keys = new Set(fields.map(f => f.key));
          return { ...x, tieFields: fields, alters: x.alters.map(a => (a.tie ? { ...a, tie: Object.fromEntries(Object.entries(a.tie).filter(([k]) => keys.has(k))) } : a)) };
        })} />
    </fieldset>
    ${weighable.length ? html`<div class="field" style="max-width:22rem"><label class="field__label" for="ego-weight">Weight ego's ties by</label>
      <select id="ego-weight" class="select" value=${s.weightBy || ''} onChange=${e => update(x => ({ ...x, weightBy: e.target.value || null }))}>
        <option value="">Nothing (every tie counts 1)</option>
        ${weighable.map(i => html`<option value=${i.name}>${i.label}</option>`)}
      </select></div>` : null}
  </div>`;
}
