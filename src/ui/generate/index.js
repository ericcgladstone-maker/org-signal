// Generate view: choose a synthetic world, then analyze it or download it as
// the native export files a real platform would give you.
//
// The form is driven entirely by the generator's listContexts(); only valid
// combinations are selectable (invalid ones stay visible, disabled, with the
// reason). Generation runs in a module worker with progress and cancel.
// After "Generate and analyze", a recovery check compares what the analysis
// finds with the structure that was planted.

import { html, useState, useEffect } from '../../../vendor/preact.js';
import { options, defaultForm, applyChange, toSpec, describe, sizeNote } from '../../builders/generate-spec.js';
import { ensureBuildCss, Unavailable, downloadBlob, storage } from '../build/shared.js';
import { handOff, notify } from '../build/service.js';
import { loadContexts, startGenerate, startRecovery } from './service.js';

const FORM_KEY = 'orgsignal.generate.form';

export function GenerateView() {
  ensureBuildCss();
  const [state, setState] = useState(null); // { contexts, devFallback, error, recoveryAvailable }
  const [form, setForm] = useState(null);
  const [notes, setNotes] = useState([]);
  const [job, setJob] = useState(null); // { output, fraction, message, cancel }
  const [err, setErr] = useState(null);
  const [last, setLast] = useState(null); // { spec, summary, fileList? }
  const [recovery, setRecovery] = useState(null); // { busy } | { report } | { missing } | { error }

  useEffect(() => {
    let live = true;
    loadContexts().then(s => {
      if (!live) return;
      setState(s);
      const saved = storage.get(FORM_KEY, null);
      const base = saved && s.contexts.some(c => c.id === saved.context) ? applyChange(s.contexts, saved, {}).form : defaultForm(s.contexts);
      setForm(base);
    });
    return () => { live = false; };
  }, []);
  useEffect(() => { if (form) storage.set(FORM_KEY, form); }, [form]);

  if (!state || !form) return html`<section class="ob ob-view"><p class="ob-note" role="status">Loading the generator...</p></section>`;
  const { contexts, devFallback } = state;
  const opt = options(contexts, form);
  const desc = describe(contexts, form);
  const ctx = contexts.find(c => c.id === form.context);
  const change = patch => { const r = applyChange(contexts, form, patch); setForm(r.form); setNotes(r.notes); };
  const busy = !!job;

  const run = async output => {
    setErr(null); setRecovery(null);
    const spec = toSpec(form, { output });
    const { promise, cancel } = startGenerate(spec, { onProgress: (fraction, message) => setJob(j => (j ? { ...j, fraction, message } : j)) });
    setJob({ output, fraction: 0, message: 'Starting', cancel });
    try {
      const res = await promise;
      if (output === 'native') {
        const name = `synthetic-${form.context}-${form.medium}-seed${form.seed}.zip`;
        downloadBlob(name, new Blob([res.zip], { type: 'application/zip' }));
        setLast({ spec, output, fileList: res.fileList, name });
        notify('info', `Downloaded ${name} (${res.fileList.length} files).`);
      } else {
        const ok = await handOff(res.dataset, { mode: 'replace' });
        setLast({ spec, output, nodes: res.dataset.nodes.count, events: res.dataset.events.count, loaded: ok, name: res.dataset.meta.name });
      }
    } catch (e) {
      if (!e.cancelled) setErr(e.message);
    } finally {
      setJob(null);
    }
  };

  const recover = async () => {
    setRecovery({ busy: true });
    try { setRecovery(await startRecovery({ seed: Number(form.seed) || 1 })); }
    catch (e) { setRecovery({ error: e.message }); }
  };

  const sn = sizeNote(form.size);
  const nativeOk = desc.nativeAvailable;

  return html`<section class="ob ob-view ob-gen" aria-labelledby="ob-gen-title">
    <header class="ob-head">
      <span class="ob-meta">Generate</span>
      <h2 id="ob-gen-title">Synthetic network</h2>
      <p class="ob-lede">Build a realistic world with known structure, then see whether the analysis finds it. Choose a setting, the medium people use, a scenario and what an export would show.</p>
    </header>

    ${devFallback ? html`<${Unavailable} title="The generator is not available yet">
      The form below uses a small built-in outline of the settings for development only, so nothing can be generated. (${state.error})
    </${Unavailable}>` : null}

    <div class="ob-cols side">
      <form class="ob-stack" onSubmit=${e => e.preventDefault()} aria-describedby="ob-gen-summary">
        <${Choices} legend="1. Setting" name="context" items=${opt.contexts} value=${form.context} onChange=${v => change({ context: v })}
          help=${ctx?.description} />
        <${Choices} legend="2. Medium" name="medium" items=${opt.media} value=${form.medium} onChange=${v => change({ medium: v })} />
        ${opt.structures.length ? html`<fieldset class="ob-fieldset">
          <legend>3. Scenario</legend>
          <div class="ob-stack" style="gap:.35rem">
            ${opt.structures.map(s => html`<label class="ob-check ob-radioline">
              <input type="radio" name="ob-gen-structure" checked=${form.structure === s.id} onChange=${() => change({ structure: s.id })} />
              <span>${s.label}</span></label>`)}
          </div>
        </fieldset>` : null}
        <fieldset class="ob-fieldset">
          <legend>4. Size</legend>
          <div class="ob-row">
            <label class="visually-hidden" for="ob-gen-size">${opt.size.label}</label>
            <input id="ob-gen-size" class="ob-input" type="number" style="width:8rem" min=${opt.size.min} max=${opt.size.max} step="1" value=${form.size}
              aria-describedby="ob-gen-sizenote" onChange=${e => change({ size: Number(e.currentTarget.value) })} />
            <span class="ob-note">${opt.size.label.toLowerCase()}</span>
            <input class="ob-range" type="range" aria-label=${`${opt.size.label} (logarithmic slider)`}
              min="0" max="1000" value=${Math.round(1000 * Math.log(form.size / opt.size.min) / Math.log(opt.size.max / opt.size.min))}
              onInput=${e => change({ size: Math.round(opt.size.min * Math.pow(opt.size.max / opt.size.min, Number(e.currentTarget.value) / 1000)) })} />
          </div>
          <p id="ob-gen-sizenote" class=${sn.level === 'warn' ? 'ob-note ob-warn' : 'ob-note'}>${sn.text}</p>
        </fieldset>
        <${Choices} legend="5. Message text" name="content" items=${opt.content} value=${form.content} onChange=${v => change({ content: v })}
          help=${opt.content.find(c => c.id === form.content)?.help} />
        <${Choices} legend="6. What the export shows" name="observation" items=${opt.observations} value=${form.observation} onChange=${v => change({ observation: v })}
          help=${opt.observations.find(o => o.id === form.observation)?.help} />
        <fieldset class="ob-fieldset">
          <legend>7. Time and seed</legend>
          <div class="ob-row">
            <div class="ob-field" style="width:8rem"><label for="ob-gen-days">Days</label>
              <input id="ob-gen-days" class="ob-input" type="number" min="1" max="3650" value=${form.days} onChange=${e => change({ days: Math.max(1, Number(e.currentTarget.value) || 1) })} /></div>
            <div class="ob-field" style="width:10rem"><label for="ob-gen-start">Start</label>
              <input id="ob-gen-start" class="ob-input" type="date" value=${form.start || ''} onChange=${e => change({ start: e.currentTarget.value || null })} /></div>
            <div class="ob-field" style="width:8rem"><label for="ob-gen-seed">Seed</label>
              <input id="ob-gen-seed" class="ob-input" type="number" min="1" value=${form.seed} onChange=${e => change({ seed: Math.max(1, Number(e.currentTarget.value) || 1) })} /></div>
            <button type="button" class="ob-btn" style="align-self:flex-end" onClick=${() => change({ seed: 1 + Math.floor(Math.random() * 99999) })}>New seed</button>
          </div>
        </fieldset>
        ${opt.params.length ? html`<details class="ob-fieldset ob-advanced">
          <summary class="ob-linkbtn">Advanced parameters for ${ctx?.label.toLowerCase()}</summary>
          <p class="ob-note">Blank means the scenario's or the generator's default.</p>
          <div class="ob-grid-form">${opt.params.map(p => html`<${Param} p=${p} value=${form.params?.[p.key]}
            preset=${ctx?.presets.find(x => x.id === form.structure)?.params?.[p.key]}
            onChange=${v => change({ params: { ...form.params, [p.key]: v } })} />`)}</div>
          <button type="button" class="ob-btn quiet sm" onClick=${() => change({ params: {} })}>Reset to defaults</button>
        </details>` : null}
      </form>

      <aside class="ob-stack ob-gen-aside" aria-label="Summary and actions">
        <div class="ob-stack" id="ob-gen-summary" style="gap:.5rem">
          <span class="ob-label">What will be generated</span>
          <p class="ob-note" style="color:var(--text-2)">${desc.what}</p>
          <p class="ob-note">${desc.export}</p>
        </div>
        ${notes.length ? html`<p class="ob-note ob-warn" role="status">${notes.join('. ')}.</p>` : null}
        <div class="ob-stack" style="gap:.5rem">
          <button type="button" class="ob-btn primary" disabled=${busy || devFallback} onClick=${() => run('dataset')}>Generate and analyze</button>
          <button type="button" class="ob-btn" disabled=${busy || devFallback || !nativeOk} onClick=${() => run('native')}
            aria-describedby="ob-gen-native">Download as native export files</button>
          <p id="ob-gen-native" class="ob-note">${nativeOk ? desc.native : 'This medium has no native export writer yet; use Generate and analyze.'}</p>
        </div>
        ${job ? html`<div class="ob-stack" style="gap:.35rem" role="status" aria-live="polite">
          <div class="ob-progress" role="progressbar" aria-label="Generation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(job.fraction * 100)}>
            <span style=${`width:${Math.max(2, job.fraction * 100)}%`}></span></div>
          <div class="ob-row"><span class="ob-note">${job.message}</span><span class="ob-spacer"></span>
            <button type="button" class="ob-btn sm" onClick=${() => job.cancel()}>Cancel</button></div>
        </div>` : null}
        ${err ? html`<p class="ob-err" role="alert">${err}</p>` : null}
        ${last ? html`<${LastRun} last=${last} />` : null}
      </aside>
    </div>

    ${last && last.output === 'dataset' ? html`<${Recovery} state=${recovery} onRun=${recover} available=${state.recoveryAvailable} />` : null}
  </section>`;
}

function Choices({ legend, name, items, value, onChange, help }) {
  const hid = `ob-gen-${name}-help`;
  return html`<fieldset class="ob-fieldset">
    <legend>${legend}</legend>
    <div class="ob-choices" role="radiogroup">
      ${items.map(it => html`<label class="ob-choice" title=${it.enabled ? '' : it.reason}>
        <input type="radio" name=${'ob-gen-' + name} value=${it.id} checked=${value === it.id} disabled=${!it.enabled}
          aria-describedby=${!it.enabled ? `${hid}-${it.id}` : help ? hid : undefined} onChange=${() => onChange(it.id)} />
        <span>${it.label}</span>
        ${!it.enabled ? html`<span id=${`${hid}-${it.id}`} class="visually-hidden">Not available: ${it.reason}</span>` : null}
      </label>`)}
    </div>
    ${help ? html`<p id=${hid} class="ob-note">${help}</p>` : null}
  </fieldset>`;
}

function Param({ p, value, preset, onChange }) {
  const id = 'ob-gen-p-' + p.key;
  const shown = value ?? '';
  const ph = preset !== undefined ? `scenario: ${preset}` : p.default !== undefined ? `default: ${p.default}` : '';
  let input;
  if (p.choices) {
    input = html`<select id=${id} class="ob-select" value=${shown} onChange=${e => onChange(e.currentTarget.value || undefined)}>
      <option value="">${ph || 'default'}</option>${p.choices.map(c => html`<option value=${c.id}>${c.label}</option>`)}</select>`;
  } else if (p.type === 'boolean') {
    input = html`<select id=${id} class="ob-select" value=${shown === '' ? '' : String(shown)} onChange=${e => onChange(e.currentTarget.value === '' ? undefined : e.currentTarget.value === 'true')}>
      <option value="">${ph || 'default'}</option><option value="true">yes</option><option value="false">no</option></select>`;
  } else if (p.type === 'int' || p.type === 'number') {
    input = html`<input id=${id} class="ob-input" type="number" min=${p.min} max=${p.max} step=${p.step ?? (p.type === 'int' ? 1 : 'any')} placeholder=${ph} value=${shown}
      onChange=${e => { const v = e.currentTarget.value; if (v === '') return onChange(undefined); let n = Number(v); if (p.min != null) n = Math.max(p.min, n); if (p.max != null) n = Math.min(p.max, n); if (p.type === 'int') n = Math.round(n); onChange(n); }} />`;
  } else {
    input = html`<input id=${id} class="ob-input" placeholder=${ph} value=${shown} onChange=${e => onChange(e.currentTarget.value || undefined)} />`;
  }
  return html`<div class="ob-field"><label for=${id}>${p.label}</label>${input}${p.help ? html`<span class="ob-help">${p.help}</span>` : null}</div>`;
}

function LastRun({ last }) {
  if (last.output === 'native') return html`<div class="ob-stack ob-section" style="gap:.4rem">
    <span class="ob-label">Downloaded</span>
    <p class="ob-note">${last.name}: ${last.fileList.length} files. Open it in Data, Import to read it back through the importer.</p>
    <ul class="ob-inline ob-mono" style="font-size:.75rem">${last.fileList.slice(0, 12).map(f => html`<li>${f.path}</li>`)}${last.fileList.length > 12 ? html`<li>and ${last.fileList.length - 12} more</li>` : null}</ul>
  </div>`;
  return html`<div class="ob-stack ob-section" style="gap:.4rem">
    <span class="ob-label">Generated</span>
    <p class="ob-note">${last.name}: ${last.nodes.toLocaleString('en-US')} people, ${last.events.toLocaleString('en-US')} events. ${last.loaded ? 'Loaded for analysis.' : 'Not loaded: the analysis views are not connected here.'}</p>
  </div>`;
}

// Recovery report renderer. The generator owns the report's shape; this
// shows checks as a table when they look like rows, and anything else as
// key-value pairs, so a new field never breaks the view.
function Recovery({ state, onRun, available }) {
  return html`<section class="ob-section" aria-labelledby="ob-rec-title">
    <h3 id="ob-rec-title">Recovery check</h3>
    <p class="ob-note">Compares what the analysis finds (communities, brokers, central people, network measures) with the structure planted in the generated world. The network is built here with the default construction settings.</p>
    <div class="ob-row"><button type="button" class="ob-btn" disabled=${state?.busy || !available} onClick=${onRun}>${state?.busy ? 'Checking...' : 'Run recovery check'}</button>
      ${!available ? html`<span class="ob-note">The generator has no recoveryCheck yet.</span>` : null}</div>
    ${state?.error ? html`<p class="ob-err" role="alert">${state.error}</p>` : null}
    ${state?.missing ? html`<${Unavailable} title="The recovery check needs parts that are not in this build yet">
      Missing: ${state.missing.join('; ')}.
    </${Unavailable}>` : null}
    ${state?.report ? html`<${Report} report=${state.report} />` : null}
  </section>`;
}

const fmt = v => (v === null || v === undefined ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(3)) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : Array.isArray(v) ? (v.length > 8 ? `${v.length} items` : v.map(fmt).join(', ')) : typeof v === 'object' ? '' : String(v));

function Report({ report }) {
  const rows = Array.isArray(report) ? report : Array.isArray(report.checks) ? report.checks : null;
  if (rows && rows.length && typeof rows[0] === 'object') {
    const cols = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => rows.some(r => typeof r[k] !== 'object' || r[k] === null || Array.isArray(r[k])));
    return html`<div class="ob-tablewrap"><table class="ob-table">
      <thead><tr>${cols.map(c => html`<th>${c}</th>`)}</tr></thead>
      <tbody>${rows.map(r => html`<tr>${cols.map(c => html`<td class=${typeof r[c] === 'number' ? 'num' : ''}>${fmt(r[c])}</td>`)}</tr>`)}</tbody>
    </table></div>
    ${report.summary ? html`<p class="ob-note">${typeof report.summary === 'string' ? report.summary : fmt(report.summary)}</p>` : null}`;
  }
  return html`<${KV} obj=${report} depth=${0} />`;
}

function KV({ obj, depth }) {
  const entries = Object.entries(obj || {});
  return html`<dl class="ob-kv" style=${depth ? 'margin-left:1rem' : ''}>
    ${entries.map(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && depth < 2
      ? html`<dt>${k}</dt><dd><${KV} obj=${v} depth=${depth + 1} /></dd>`
      : html`<dt>${k}</dt><dd>${fmt(v)}</dd>`)}
  </dl>`;
}

export default GenerateView;
