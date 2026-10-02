// Data view: bring sources in, see what each can and cannot show, review
// identity matches, join HR/attribute tables, and map unknown CSVs.
//
// Flow: drop or pick inputs -> each input is detected separately and the user
// may override the importer and its options -> import (worker, with progress
// and cancel) -> review: import report + suggested identity merges -> load
// into analysis (replace the current data, or add to it).

import { html, useState, useEffect, useRef } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { ViewHead, Flag, Loading, ErrorLine, Select, Tip, download } from '../components/common.js';
import { detectInput, listImporters, importInput, importReport, suggestMatches, applyMerges, mergeDatasets, suggestMapping, joinProfiles, peekCSV, readCSV, pipelineMode, filesForRels } from '../services/pipeline.js';
import { fmtInt, fmtRange, fmtBytes, plural, humanize } from '../lib/format.js';
import { VIEW_TEXT } from '../lib/dsutil.js';

// ---- reading what the user dropped -----------------------------------------

async function readEntry(entry, prefix = '') {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    return [{ blob: file, path: prefix + entry.name }];
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const out = [];
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) out.push(...await readEntry(e, `${prefix}${entry.name}/`));
    }
    return out;
  }
  return [];
}

function makeInput(name, files, kind) {
  const size = files.reduce((s, f) => s + ((f.blob || f).size || 0), 0);
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, files, kind, size, detections: null, detecting: true, error: null, importerId: 'auto', options: {} };
}

async function inputsFromDrop(dt) {
  const items = [...(dt.items || [])].filter(i => i.kind === 'file');
  const entries = items.map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  if (entries.length && entries.every(Boolean)) {
    const out = [];
    for (const e of entries) {
      const files = await readEntry(e);
      if (!files.length) continue;
      out.push(makeInput(e.name, files, e.isDirectory ? 'folder' : /\.zip$/i.test(e.name) ? 'zip' : 'file'));
    }
    return out;
  }
  return [...dt.files].map(f => makeInput(f.name, [f], /\.zip$/i.test(f.name) ? 'zip' : 'file'));
}

function inputsFromPicker(fileList, folder) {
  const files = [...fileList];
  if (!files.length) return [];
  if (folder) {
    const top = (files[0].webkitRelativePath || files[0].name).split('/')[0];
    return [makeInput(top, files, 'folder')];
  }
  return files.map(f => makeInput(f.name, [f], /\.zip$/i.test(f.name) ? 'zip' : 'file'));
}

const isCSV = f => /\.(csv|tsv|txt)$/i.test((f.path || f.webkitRelativePath || f.name || ''));
const blobOf = f => f.blob || f;

// ---- view ---------------------------------------------------------------------

export function DataView() {
  const dataset = useStore(s => s.dataset);
  const report = useStore(s => s.report);
  const [inputs, setInputs] = useState([]);
  const [pending, setPending] = useState(null); // { dataset, report, matches, mode }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('replace');
  const hasData = !!dataset;

  const addInputs = async (list) => {
    if (!list.length) return;
    setError(null);
    setInputs(prev => [...prev, ...list]);
    for (const inp of list) {
      detectInput(inp).then(
        det => setInputs(prev => prev.map(x => (x.id === inp.id ? { ...x, detections: det, detecting: false } : x))),
        err => setInputs(prev => prev.map(x => (x.id === inp.id ? { ...x, detections: [], detecting: false, error: err.message } : x))),
      );
    }
  };
  const update = (id, patch) => setInputs(prev => prev.map(x => (x.id === id ? { ...x, ...patch } : x)));
  const remove = id => setInputs(prev => prev.filter(x => x.id !== id));

  const runImports = async () => {
    setError(null); setBusy(true);
    try {
      const results = await store.actions.runJob(inputs.length > 1 ? `Importing ${inputs.length} inputs` : `Importing ${inputs[0].name}`, async (signal, progress) => {
        const out = [];
        for (let k = 0; k < inputs.length; k++) {
          const inp = inputs[k];
          const r = await importInput(inp, { signal, onProgress: (f, msg) => progress((k + (f || 0)) / inputs.length, msg) });
          out.push(r);
        }
        return out;
      });
      let ds = results[0].dataset;
      if (results.length > 1) ds = await mergeDatasets(results.map(r => r.dataset), { name: inputs.map(i => i.name).join(' + ') });
      const rep = await importReport(ds);
      const unclaimed = results.flatMap(r => r.unclaimed || r.report?.unclaimed || []);
      if (rep) rep.unclaimed = unclaimed;
      const matches = await suggestMatches(ds).catch(() => null);
      // Files no importer claimed (an HR table next to an export) are offered
      // to the profile join once the data is loaded.
      const unclaimedFiles = (await filesForRels(inputs.flatMap(i => i.files), unclaimed.filter(r => /\.(csv|tsv|txt)$/i.test(r))).catch(() => [])).filter(isCSV);
      setPending({ dataset: ds, report: rep, matches, mode: hasData ? mode : 'replace', unclaimedFiles });
      setInputs([]);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e); else store.actions.notify('info', 'Import cancelled.');
    } finally { setBusy(false); }
  };

  const loadPending = async (accepted, joinFile) => {
    setBusy(true); setError(null);
    try {
      let ds = pending.dataset;
      if (accepted.length) ds = await applyMerges(ds, accepted);
      await store.actions.loadDataset(ds, { mode: pending.mode });
      if (joinFile) store.set({ ui: { ...store.get().ui, profileFile: blobOf(joinFile) } });
      store.actions.notify('info', `Loaded ${ds.meta.name}: ${plural(ds.nodes.count, 'person', 'people')}, ${plural(ds.events.count, 'event')}.`);
      setPending(null);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return html`<div class="view view--col">
    <${ViewHead} title="Data" intro=${hasData ? 'What is loaded, what each source can and cannot show, and the steps that shape who is who.' : null}
      actions=${hasData && html`<button class="btn" onClick=${() => store.actions.setView('network')}>Open network</button>`} />
    ${!hasData && !inputs.length && !pending && html`<${EmptyState} onFiles=${addInputs} />`}
    ${(hasData || inputs.length > 0) && !pending && html`<section class="section" aria-labelledby="add-h">
      <h2 id="add-h" class="section__title">${hasData ? 'Add or replace sources' : 'Sources to import'}</h2>
      <${DropZone} onFiles=${addInputs} compact=${inputs.length > 0} />
    </section>`}
    ${inputs.length > 0 && !pending && html`<section class="section" aria-labelledby="det-h">
      <h2 id="det-h" class="section__title">Detected formats</h2>
      <p class="small text2" style="margin-bottom:.75rem">Each input is read by the importer that recognised it. Change the importer if the guess is wrong; options apply to that input only.</p>
      ${inputs.map(inp => html`<${InputRow} key=${inp.id} input=${inp} onChange=${p => update(inp.id, p)} onRemove=${() => remove(inp.id)} />`)}
      <div class="row" style="margin-top:1rem">
        ${hasData && html`<${Select} label="When the import finishes" value=${mode} onChange=${setMode} options=${[{ value: 'replace', label: 'Replace the current data' }, { value: 'add', label: 'Add to the current data (merge)' }]} />`}
        <div class="grow"></div>
        <button class="btn" onClick=${() => setInputs([])} disabled=${busy}>Clear</button>
        <button class="btn btn--primary" onClick=${runImports} disabled=${busy || inputs.some(i => i.detecting) || !inputs.length}>Import ${inputs.length > 1 ? `${inputs.length} inputs` : ''}</button>
      </div>
    </section>`}
    <${ErrorLine} error=${error} />
    ${pending && html`<${PendingReview} pending=${pending} busy=${busy} onLoad=${loadPending} onDiscard=${() => setPending(null)} />`}
    ${hasData && !pending && html`<${CurrentData} dataset=${dataset} report=${report} />`}
  </div>`;
}

async function loadDemo() {
  try {
    const { mockDataset } = await import('../services/mock.js');
    await store.actions.loadDataset(mockDataset({}), { mode: 'replace' });
    store.actions.notify('info', 'Loaded the synthetic demo organisation (fake names, generated messages).');
  } catch (e) { store.actions.notify('error', `Could not load the demo: ${e.message}`); }
}

function EmptyState({ onFiles }) {
  return html`<div class="empty" style="padding-top:.5rem">
    <h2>Start with relational traces</h2>
    <p class="lead">Org Signal turns exports, surveys and hand-drawn networks into a network you can defend, then measures it. Everything runs in this browser; nothing is uploaded.</p>
    <div style="margin-top:1.75rem"><${DropZone} onFiles=${onFiles} /></div>
    <p class="small text2" style="margin-top:.8rem">No data at hand? <button class="tlink" onClick=${loadDemo}>Load a small synthetic organisation</button> to try every view.</p>
    <div class="ways">
      <div><h3>Import</h3><p>Workplace exports (Slack, Teams, email, calendars), personal and social archives, network files (GraphML, GEXF, Pajek, UCINET) and any CSV of who-to-whom.</p></div>
      <div><h3>Build by hand</h3><p>Draw a network, run an ego-network interview, record a roster, or collect perceived networks from several informants.</p><button class="tlink tlink--arrow" onClick=${() => store.actions.setView('build')}>Build a network</button></div>
      <div><h3>Generate</h3><p>Create a synthetic organisation or community with planted structure, to learn the tool or to test what the measures recover.</p><button class="tlink tlink--arrow" onClick=${() => store.actions.setView('generate')}>Generate a network</button></div>
    </div>
  </div>`;
}

function DropZone({ onFiles, compact = false }) {
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);
  const dirRef = useRef(null);
  useEffect(() => { if (dirRef.current) { dirRef.current.setAttribute('webkitdirectory', ''); dirRef.current.setAttribute('directory', ''); } }, []);
  return html`<div class="drop" data-over=${String(over)}
      onDragOver=${e => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
      onDrop=${async e => { e.preventDefault(); setOver(false); onFiles(await inputsFromDrop(e.dataTransfer)); }}>
    <p class="drop__title">${compact ? 'Drop more files, zips or folders' : 'Drop files, zips or folders here'}</p>
    ${!compact && html`<p class="drop__hint">An export zip as downloaded, a folder of exports, single files, or several at once. Each is detected separately.</p>`}
    <div class="row">
      <button class="btn btn--primary" onClick=${() => fileRef.current.click()}>Choose files</button>
      <button class="btn" onClick=${() => dirRef.current.click()}>Choose a folder</button>
      <span class="meta">${pipelineMode() === 'mock' ? 'Demo mode: any file shows the demo import' : 'Processed locally'}</span>
    </div>
    <input type="file" multiple hidden ref=${fileRef} onChange=${e => { onFiles(inputsFromPicker(e.currentTarget.files, false)); e.currentTarget.value = ''; }} />
    <input type="file" multiple hidden ref=${dirRef} onChange=${e => { onFiles(inputsFromPicker(e.currentTarget.files, true)); e.currentTarget.value = ''; }} />
  </div>`;
}

function InputRow({ input, onChange, onRemove }) {
  const [all, setAll] = useState([]);
  useEffect(() => { listImporters().then(setAll); }, []);
  const det = input.detections || [];
  const chosenId = input.importerId;
  const chosen = chosenId === 'auto' ? null : det.find(d => d.id === chosenId) || all.find(i => i.id === chosenId);
  const best = det[0];
  const autoLabel = best ? `Automatic: ${det.filter(d => d.score >= 0.5).map(d => d.label).join(' + ') || best.label}` : 'Automatic';
  const detIds = new Set(det.map(d => d.id));
  const options = [
    { value: 'auto', label: autoLabel },
    ...(det.length ? [{ group: 'Recognised', options: det.map(d => ({ value: d.id, label: `${d.label} (${Math.round(d.score * 100)}%)` })) }] : []),
    ...(all.filter(i => !detIds.has(i.id)).length ? [{ group: 'Other importers', options: all.filter(i => !detIds.has(i.id)).map(i => ({ value: i.id, label: i.label })) }] : []),
  ];
  const opts = (chosen?.options || (chosenId === 'auto' && det.length === 1 ? det[0].options : []) || []).filter(o => o.type !== 'mapping');
  const effective = chosen || (chosenId === 'auto' ? best : null);
  const needsMapping = effective && (effective.options || []).some(o => o.type === 'mapping') && input.files.some(isCSV);
  const importerKey = effective?.id;
  const optVals = input.options[importerKey] || {};
  const setOpt = (k, v) => onChange({ options: { ...input.options, [importerKey]: { ...optVals, [k]: v } } });
  const nFiles = input.files.length;
  return html`<div class="src">
    <div class="src__head">
      <div>
        <span class="src__title">${input.name}</span>
        <span class="meta" style="margin-left:.6rem">${input.kind}${nFiles > 1 ? ` · ${fmtInt(nFiles)} files` : ''} · ${fmtBytes(input.size)}</span>
      </div>
      <button class="btn btn--quiet btn--sm" onClick=${onRemove} aria-label=${`Remove ${input.name}`}>Remove</button>
    </div>
    ${input.detecting ? html`<${Loading}>Detecting format</${Loading}>` : html`
      ${input.error && html`<${ErrorLine} error=${`Detection failed: ${input.error}`} />`}
      ${!det.length && !input.error && html`<p class="small" style="margin-top:.5rem"><${Flag} level="caution">Not recognised</${Flag}> <span class="text2">No importer recognised this input. If it is a table of who-to-whom, choose the spreadsheet importer and map the columns.</span></p>`}
      ${best && html`<p class="small text2" style="margin-top:.4rem">${best.reason}</p>`}
      <div class="grid-2" style="margin-top:.75rem">
        <${Select} label="Importer" value=${chosenId} onChange=${v => onChange({ importerId: v })} options=${options} />
        ${opts.map(o => html`<${OptionField} key=${o.key} opt=${o} value=${optVals[o.key] ?? o.default} onChange=${v => setOpt(o.key, v)} />`)}
      </div>
      ${needsMapping && html`<${ColumnMapper} file=${blobOf(input.files.find(isCSV))} value=${optVals} onChange=${v => onChange({ options: { ...input.options, [importerKey]: { ...optVals, ...v } } })} />`}
    `}
  </div>`;
}

function OptionField({ opt, value, onChange }) {
  if (opt.type === 'boolean') return html`<label class="check" style="align-self:end"><input type="checkbox" checked=${!!value} onChange=${e => onChange(e.currentTarget.checked)} />${opt.label}</label>`;
  if (opt.choices) return html`<${Select} label=${opt.label} value=${value ?? ''} onChange=${onChange} options=${[...(value == null ? [{ value: '', label: 'Automatic' }] : []), ...opt.choices.map(c => (typeof c === 'object' ? { value: c.value, label: c.label } : { value: c, label: humanize(c) }))]} />`;
  return html`<label class="field"><span>${opt.label}</span><input class="input" type=${opt.type === 'number' ? 'number' : 'text'} value=${value ?? ''} onInput=${e => onChange(opt.type === 'number' ? Number(e.currentTarget.value) : e.currentTarget.value)} /></label>`;
}

// ---- tabular column mapper -------------------------------------------------------

const ROLE_SETS = {
  events: [['actor', 'Who acted (sender)'], ['targets', 'Directed at (recipients)'], ['timestamp', 'When'], ['context', 'Where (channel, thread)'], ['text', 'Message text'], ['weight', 'Weight'], ['type', 'Kind of event'], ['ignore', 'Ignore']],
  edges: [['actor', 'Source'], ['targets', 'Target'], ['weight', 'Weight'], ['type', 'Tie type'], ['directed', 'Directed flag'], ['ignore', 'Ignore']],
  nodes: [['id', 'Person id'], ['label', 'Name'], ['attr', 'Attribute'], ['ignore', 'Ignore']],
};

function ColumnMapper({ file, value, onChange }) {
  const [state, setState] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { headers, rows } = await peekCSV(file, 50);
        const s = await suggestMapping(headers, rows);
        const kind = value.kind || s.kind || 'events';
        const roles = {};
        for (const h of headers) roles[h] = 'ignore';
        for (const [role, col] of Object.entries(s.mapping || {})) if (typeof col === 'string' && headers.includes(col)) roles[col] = role;
        for (const a of s.mapping?.attrs || []) roles[a] = 'attr';
        if (live) { setState({ headers, rows, kind, roles, notes: s.notes || [], extra: { timeFormat: s.mapping?.timeFormat, timezone: s.mapping?.timezone, targetSeparator: s.mapping?.targetSeparator } }); }
      } catch (e) { if (live) setErr(e); }
    })();
    return () => { live = false; };
  }, [file]);
  useEffect(() => { if (state) onChange({ kind: state.kind, mapping: toMapping(state) }); }, [state]);
  if (err) return html`<${ErrorLine} error=${`Could not read the table: ${err.message}`} />`;
  if (!state) return html`<${Loading}>Reading columns</${Loading}>`;
  const roles = ROLE_SETS[state.kind];
  const setRole = (h, r) => setState(s => ({ ...s, roles: { ...s.roles, [h]: r } }));
  return html`<div style="margin-top:1rem">
    <p class="label">Column mapping</p>
    <div class="row" style="margin-bottom:.6rem">
      <${Select} label="Each row is" value=${state.kind} onChange=${k => setState(s => ({ ...s, kind: k }))} options=${[{ value: 'events', label: 'An event (message, meeting...)' }, { value: 'edges', label: 'A tie between two people' }, { value: 'nodes', label: 'A person (attributes)' }]} />
      ${state.kind === 'events' && html`<${Select} label="Time format" value=${state.extra.timeFormat || 'iso'} onChange=${v => setState(s => ({ ...s, extra: { ...s.extra, timeFormat: v } }))} options=${['iso', 'epoch_s', 'epoch_ms', 'mdy', 'dmy', 'ymd'].map(v => ({ value: v, label: v }))} />`}
      ${state.kind === 'events' && html`<label class="field"><span>Time zone</span><input class="input" value=${state.extra.timezone || 'UTC'} onInput=${e => setState(s => ({ ...s, extra: { ...s.extra, timezone: e.currentTarget.value } }))} /></label>`}
    </div>
    ${state.notes.map(n => html`<p class="small text2">${n}</p>`)}
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr>${state.headers.map(h => html`<th scope="col" style="min-width:9rem">
          <div style="margin-bottom:.3rem;text-transform:none;letter-spacing:0;font-family:var(--sans);font-size:.8rem;color:var(--text)">${h}</div>
          <select class="select" aria-label=${`Role of column ${h}`} value=${state.roles[h]} onChange=${e => setRole(h, e.currentTarget.value)}>
            ${roles.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
          </select></th>`)}</tr></thead>
        <tbody>${state.rows.slice(0, 5).map(r => html`<tr>${state.headers.map((h, j) => html`<td style=${state.roles[h] === 'ignore' ? 'opacity:.5' : ''}>${String(r[j] ?? '').slice(0, 60)}</td>`)}</tr>`)}</tbody>
      </table>
    </div>
    <p class="basis">First rows of ${file.name || 'the table'}. Unmapped columns are ignored.</p>
  </div>`;
}

function toMapping(state) {
  const m = { namespace: 'csv' };
  const attrs = [];
  for (const [h, r] of Object.entries(state.roles)) {
    if (r === 'ignore') continue;
    if (r === 'attr') attrs.push(h); else m[r] = h;
  }
  if (state.kind === 'nodes') m.attrs = attrs;
  if (state.kind === 'events') { m.timeFormat = state.extra.timeFormat || 'iso'; m.timezone = state.extra.timezone || 'UTC'; m.role = 'to'; m.eventType = 'message'; }
  if (state.kind === 'edges') { m.role = 'declared'; m.eventType = 'declared'; }
  if (state.extra.targetSeparator) m.targetSeparator = state.extra.targetSeparator;
  return m;
}

// ---- review after import -----------------------------------------------------------

function PendingReview({ pending, busy, onLoad, onDiscard }) {
  const matches = pending.matches || [];
  const [joinFile, setJoinFile] = useState(pending.unclaimedFiles?.[0] || null);
  const [accepted, setAccepted] = useState(() => new Set(matches.map((m, i) => (m.confidence === 'high' ? i : -1)).filter(i => i >= 0)));
  const toggle = (i, v) => setAccepted(prev => { const s = new Set(prev); if (v) s.add(i); else s.delete(i); return s; });
  return html`<section class="section" aria-labelledby="rev-h">
    <div class="row row--between">
      <h2 id="rev-h" class="section__title">Review before analysis</h2>
      <span class="meta">${pending.mode === 'add' ? 'Will be added to the current data' : 'Will replace the current data'}</span>
    </div>
    <${ReportView} report=${pending.report} ds=${pending.dataset} />
    <div class="section">
      <h2 class="section__title">Who is who</h2>
      <${MatchList} matches=${matches} accepted=${accepted} onToggle=${toggle} onAll=${v => setAccepted(new Set(v ? matches.map((_, i) => i) : []))} />
    </div>
    ${pending.unclaimedFiles?.length > 0 && html`<div class="section">
      <h2 class="section__title">Tables no importer read</h2>
      <p class="small text2" style="margin-bottom:.5rem">If one of these is a table of people (an HR export or a roster), its columns can be joined to the people in this data as attributes.</p>
      ${pending.unclaimedFiles.map(f => html`<label class="check" style="display:flex"><input type="radio" name="joinfile" checked=${joinFile === f} onChange=${() => setJoinFile(f)} />${(f.path || f.webkitRelativePath || f.name)}</label>`)}
      <label class="check" style="display:flex"><input type="radio" name="joinfile" checked=${!joinFile} onChange=${() => setJoinFile(null)} />Do not join a table</label>
    </div>`}
    <div class="row" style="padding-top:.5rem">
      <button class="btn" onClick=${onDiscard} disabled=${busy}>Discard</button>
      <div class="grow"></div>
      <button class="btn btn--primary" onClick=${() => onLoad(matches.filter((_, i) => accepted.has(i)), joinFile)} disabled=${busy}>
        ${accepted.size ? `Merge ${accepted.size} and load into analysis` : 'Load into analysis'}
      </button>
    </div>
  </section>`;
}

function MatchList({ matches, accepted, onToggle, onAll }) {
  if (matches == null) return html`<p class="small text2">Identity matching is not available in this build.</p>`;
  if (!matches.length) return html`<p class="small text2">No likely duplicates were found: no two people share an email address, platform id or full name across sources.</p>`;
  return html`<div>
    <p class="small text2" style="margin-bottom:.6rem">The same person can appear once per source (a Slack account and an email address). These pairs look like one person. High-confidence pairs are pre-selected; nothing is merged until you load.</p>
    <div class="row" style="margin-bottom:.4rem"><button class="btn btn--sm" onClick=${() => onAll(true)}>Select all</button><button class="btn btn--sm" onClick=${() => onAll(false)}>Select none</button><span class="meta">${accepted.size} of ${matches.length} selected</span></div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th scope="col">Merge</th><th scope="col">Person A</th><th scope="col">Person B</th><th scope="col">Confidence</th><th scope="col">Evidence</th></tr></thead>
      <tbody>${matches.slice(0, 300).map((m, i) => html`<tr class=${accepted.has(i) ? 'is-selected' : ''}>
        <td><input type="checkbox" aria-label=${`Merge ${m.labelA ?? m.a} and ${m.labelB ?? m.b}`} checked=${accepted.has(i)} onChange=${e => onToggle(i, e.currentTarget.checked)} style="accent-color:var(--accent)" /></td>
        <td class="name">${m.labelA ?? m.a}<div class="meta">${m.keyA ?? ''}</div></td>
        <td class="name">${m.labelB ?? m.b}<div class="meta">${m.keyB ?? ''}</div></td>
        <td>${m.confidence === 'high' ? html`<${Flag} level="ok">High</${Flag}>` : m.confidence === 'medium' ? html`<${Flag} level="info">Medium</${Flag}>` : m.confidence === 'low' ? html`<${Flag} level="caution">Low</${Flag}>` : (m.score != null ? `${Math.round(m.score * 100)}%` : '')}</td>
        <td class="small">${(m.evidence || []).join('; ')}</td>
      </tr>`)}</tbody>
    </table></div>
    ${matches.length > 300 && html`<p class="basis">Showing the first 300 of ${fmtInt(matches.length)} pairs.</p>`}
  </div>`;
}

// ---- import report -------------------------------------------------------------------

function sevFlag(s) {
  return s === 'error' ? html`<${Flag} level="error">Error</${Flag}>` : s === 'info' ? html`<${Flag} level="info">Info</${Flag}>` : html`<${Flag} level="caution">Warning</${Flag}>`;
}

export function ReportView({ report, ds }) {
  if (!report) return html`<p class="small text2">No import report is available for this data.</p>`;
  const t = report.totals;
  return html`<div>
    <dl class="grid-3" style="margin:.5rem 0 1rem">
      ${[['People', fmtInt(t.nodes)], ['Events', fmtInt(t.events)], ['Conversations and contexts', fmtInt(t.contexts)], ['Sources', fmtInt(t.sources)], ['Time range', t.timeRange ? fmtRange(t.timeRange.start, t.timeRange.end) : 'no timestamps'], ['Accounts marked as bots', fmtInt(t.bots)]].map(([k, v]) => html`<div><dt class="label" style="margin:0">${k}</dt><dd class="tnum" style="margin:.1rem 0 0;font-size:1.05rem;color:var(--text)">${v}</dd></div>`)}
    </dl>
    ${(report.notes || []).map(n => html`<p class="small text2" style="margin-bottom:.3rem"><${Flag} level="info" /> ${n}</p>`)}
    ${report.unclaimed?.length > 0 && html`<p class="small text2"><${Flag} level="caution">Unread</${Flag}> ${plural(report.unclaimed.length, 'file')} matched no importer: ${report.unclaimed.slice(0, 6).join(', ')}${report.unclaimed.length > 6 ? ', ...' : ''}</p>`}
    ${report.sources.map(s => html`<${SourceReport} key=${s.id} s=${s} />`)}
  </div>`;
}

function SourceReport({ s }) {
  const v = VIEW_TEXT[s.view] || { name: s.view || 'Unknown view' };
  const counts = s.counts || {};
  const byType = Object.entries(counts.eventsByType || {}).map(([k, n]) => `${fmtInt(n)} ${k}${n === 1 ? '' : 's'}`).join(', ');
  return html`<article class="src" aria-label=${`Source ${s.format}`}>
    <div class="src__head">
      <h3 class="src__title">${humanize(s.format || 'source')} <span class="muted" style="font-weight:400">· ${v.name}</span></h3>
      <span class="meta">${s.timeRange ? fmtRange(s.timeRange.start, s.timeRange.end) : 'no timestamps'}${s.tz?.status === 'assumed' ? ' · time zone assumed' : ''}</span>
    </div>
    <p class="small text2" style="margin-top:.25rem">${(s.fileNames || []).slice(0, 3).join(', ')}${(s.fileNames || []).length > 3 ? ` and ${s.fileNames.length - 3} more files` : ''}${s.ego ? html` · ego: <span style="color:var(--text)">${s.ego.label}</span>` : ''}</p>
    <dl class="kv" style="max-width:34rem;margin-top:.6rem">
      <dt>People</dt><dd>${fmtInt(counts.nodes)}</dd>
      <dt>Events</dt><dd>${fmtInt(counts.events)}</dd>
      ${byType && html`<dt class="small">by type</dt><dd class="small text2" style="white-space:normal">${byType}</dd>`}
      <dt>Contexts</dt><dd>${fmtInt(counts.contexts)}</dd>
      <dt>Messages with text</dt><dd>${fmtInt(counts.messagesWithText)}</dd>
      ${counts.undatedEvents > 0 && html`<dt>Events without a time</dt><dd>${fmtInt(counts.undatedEvents)}</dd>`}
      ${s.bots?.nodes > 0 && html`<dt>Bot accounts</dt><dd>${fmtInt(s.bots.nodes)}</dd>`}
    </dl>
    <div class="src__cols">
      <div><p class="label">This data can show</p><ul class="can-list">${(s.canShow || []).map(x => html`<li>${x}</li>`)}</ul></div>
      <div><p class="label">It cannot show</p><ul class="can-list">${(s.cannotShow || []).map(x => html`<li>${x}</li>`)}</ul></div>
    </div>
    ${s.warnings?.length > 0 && html`<div style="margin-top:.9rem"><p class="label">Problems found while reading</p>
      <ul class="warn-list">${s.warnings.map(w => html`<li><span class="sev">${sevFlag(w.severity)}</span><span>${w.message}<span class="meta" style="margin-left:.5rem">${w.code}</span></span><span class="tnum">${fmtInt(w.count)}</span></li>`)}</ul></div>`}
  </article>`;
}

// ---- current data --------------------------------------------------------------------

function CurrentData({ dataset, report }) {
  const [tab, setTab] = useState(() => (store.get().ui?.profileFile ? 'profile' : 'report'));
  return html`<section class="section" aria-labelledby="cur-h">
    <div class="row row--between"><h2 id="cur-h" class="section__title">${dataset.meta.name}</h2><span class="meta">loaded</span></div>
    <div class="tabs" role="tablist" aria-label="Current data">
      ${[['report', 'Import report'], ['identity', 'Who is who'], ['profile', 'Join attributes']].map(([id, l]) => html`<button role="tab" aria-selected=${String(tab === id)} onClick=${() => setTab(id)}>${l}</button>`)}
    </div>
    <div role="tabpanel">
      ${tab === 'report' && html`<${ReportView} report=${report} ds=${dataset} />`}
      ${tab === 'identity' && html`<${IdentityPanel} ds=${dataset} />`}
      ${tab === 'profile' && html`<${ProfileJoin} ds=${dataset} />`}
    </div>
  </section>`;
}

function IdentityPanel({ ds }) {
  const [matches, setMatches] = useState(undefined);
  const [accepted, setAccepted] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    suggestMatches(ds).then(m => { if (live) { setMatches(m); setAccepted(new Set((m || []).map((x, i) => (x.confidence === 'high' ? i : -1)).filter(i => i >= 0))); } }, e => live && setErr(e));
    return () => { live = false; };
  }, [ds]);
  const apply = async () => {
    setBusy(true); setErr(null);
    try {
      const ds2 = await applyMerges(ds, matches.filter((_, i) => accepted.has(i)));
      await store.actions.replaceDataset(ds2);
      store.actions.notify('info', `Merged ${accepted.size} identities. ${plural(ds2.nodes.count, 'person', 'people')} remain.`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  if (err) return html`<${ErrorLine} error=${err} />`;
  if (matches === undefined) return html`<${Loading}>Looking for duplicate identities</${Loading}>`;
  return html`<div>
    ${ds.meta.merges?.length > 0 && html`<p class="small text2" style="margin-bottom:.6rem">${ds.meta.merges.length} merge step(s) already applied to this data.</p>`}
    <${MatchList} matches=${matches} accepted=${accepted} onToggle=${(i, v) => setAccepted(p => { const s = new Set(p); if (v) s.add(i); else s.delete(i); return s; })} onAll=${v => setAccepted(new Set(v ? (matches || []).map((_, i) => i) : []))} />
    ${matches?.length > 0 && html`<div class="row" style="margin-top:.8rem"><div class="grow"></div><button class="btn btn--primary" disabled=${busy || !accepted.size} onClick=${apply}>Merge ${accepted.size} and rebuild</button></div>`}
  </div>`;
}

function ProfileJoin({ ds }) {
  const [file, setFile] = useState(null);
  const [table, setTable] = useState(null);
  const [keyColumn, setKeyColumn] = useState('');
  const [matchOn, setMatchOn] = useState('email');
  const [cols, setCols] = useState(new Set());
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const f = store.get().ui?.profileFile;
    if (f) { store.set({ ui: { ...store.get().ui, profileFile: null } }); pick(f); }
  }, []);
  const pick = async (f) => {
    setErr(null); setResult(null); setFile(f);
    try {
      const t = await readCSV(f);
      setTable(t);
      const guess = t.headers.find(h => /e-?mail/i.test(h)) || t.headers.find(h => /^(id|employee_?id|key)$/i.test(h)) || t.headers.find(h => /name/i.test(h)) || t.headers[0];
      setKeyColumn(guess);
      setMatchOn(/e-?mail/i.test(guess) ? 'email' : /name/i.test(guess) ? 'name' : 'platformId');
      setCols(new Set(t.headers.filter(h => h !== guess)));
    } catch (e) { setErr(e); }
  };
  const preview = async () => {
    setBusy(true); setErr(null);
    try { setResult(await joinProfiles(ds, table, { keyColumn, matchOn, columns: [...cols] })); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true);
    try { await store.actions.replaceDataset(result.dataset); store.actions.notify('info', `Joined ${[...cols].length} attribute columns.`); setResult(null); setTable(null); setFile(null); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const r = result?.report;
  return html`<div class="stack">
    <p class="small text2">Add attributes such as department, role or tenure from an HR export or any table with one row per person. Rows are matched to people by email, platform id, name or node key; nothing is guessed when a row matches several people.</p>
    <div class="row"><button class="btn" onClick=${() => ref.current.click()}>Choose a CSV</button>${file && html`<span class="meta">${file.name} · ${table ? `${fmtInt(table.records.length)} rows` : ''}</span>`}</div>
    <input type="file" accept=".csv,.tsv,.txt" hidden ref=${ref} onChange=${e => { const f = e.currentTarget.files[0]; if (f) pick(f); e.currentTarget.value = ''; }} />
    <${ErrorLine} error=${err} />
    ${table && html`<div class="stack">
      <div class="grid-2">
        <${Select} label="Column that identifies the person" value=${keyColumn} onChange=${v => { setKeyColumn(v); setCols(c => { const s = new Set(c); s.delete(v); return s; }); }} options=${table.headers.map(h => ({ value: h, label: h }))} />
        <${Select} label="Match it against" value=${matchOn} onChange=${setMatchOn} options=${[{ value: 'email', label: 'Email address' }, { value: 'name', label: 'Display name' }, { value: 'platformId', label: 'Platform id (Slack, Teams...)' }, { value: 'key', label: 'Node key' }]} />
      </div>
      <fieldset style="border:0;padding:0;margin:0"><legend class="label">Columns to add</legend>
        <div class="row">${table.headers.filter(h => h !== keyColumn).map(h => html`<label class="check"><input type="checkbox" checked=${cols.has(h)} onChange=${e => setCols(c => { const s = new Set(c); if (e.currentTarget.checked) s.add(h); else s.delete(h); return s; })} />${h}</label>`)}</div>
      </fieldset>
      <div class="row"><button class="btn" onClick=${preview} disabled=${busy || !cols.size}>Preview the join</button></div>
    </div>`}
    ${r && html`<div class="section">
      <p class="label">Join report</p>
      <p class="text2 small" style="margin-bottom:.6rem">${r.summary || `${fmtInt(r.matched?.length ?? r.matched)} rows matched.`}</p>
      <dl class="kv" style="max-width:30rem">
        <dt>Rows matched to one person</dt><dd>${fmtInt(Array.isArray(r.matched) ? r.matched.length : r.matched)}</dd>
        <dt>Rows that matched nobody</dt><dd>${fmtInt(Array.isArray(r.unmatchedRows) ? r.unmatchedRows.length : r.unmatched)}</dd>
        <dt>Ambiguous (left unjoined)</dt><dd>${fmtInt(Array.isArray(r.ambiguous) ? r.ambiguous.length : r.ambiguous)}</dd>
        <dt>People with no row</dt><dd>${fmtInt(Array.isArray(r.unmatchedNodes) ? r.unmatchedNodes.length : r.nodesWithoutRow)}</dd>
        ${r.overwritten > 0 && html`<dt>Existing values overwritten</dt><dd>${fmtInt(r.overwritten)}</dd>`}
      </dl>
      ${Array.isArray(r.unmatchedRows) && r.unmatchedRows.length > 0 && html`<details class="disclose"><summary>Unmatched rows (${fmtInt(r.unmatchedRows.length)})</summary><p class="small text2">${r.unmatchedRows.slice(0, 30).map(u => u.key || '(empty)').join(', ')}${r.unmatchedRows.length > 30 ? ', ...' : ''}</p></details>`}
      ${Array.isArray(r.ambiguous) && r.ambiguous.length > 0 && html`<details class="disclose"><summary>Ambiguous rows (${fmtInt(r.ambiguous.length)})</summary><ul class="can-list">${r.ambiguous.slice(0, 20).map(a => html`<li>${a.key || a.node?.label}: ${a.reason}</li>`)}</ul></details>`}
      ${r.columnTypes && html`<p class="basis">Column types: ${Object.entries(r.columnTypes).map(([k, v]) => `${k} (${v})`).join(', ')}</p>`}
      <div class="row" style="margin-top:.8rem"><button class="btn" onClick=${() => setResult(null)}>Cancel</button><button class="btn btn--primary" onClick=${apply} disabled=${busy}>Apply and rebuild</button></div>
    </div>`}
  </div>`;
}
