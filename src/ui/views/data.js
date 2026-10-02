// Data view: bring sources in, see what each can and cannot show, review
// who is who, join tables of people, and map unknown CSVs.
//
// Flow: drop or pick inputs -> each input is detected separately (with
// progress) and the user may override the importer and its options; a table
// with one row per person defaults to joining its columns to the people in
// the other data -> import (worker, with progress and cancel) -> review: the
// import report, "Are these all you?" when several personal exports name
// owners, merge suggestions plus manual merges, the table join -> load. When
// data is already loaded, new imports are added to it unless the user
// explicitly chooses to replace it.
//
// Pieces live in ./data/: io.js (reading, detecting, importing, naming),
// inputs.js (the input list and column mapper), report.js (import report),
// identity.js (who is who), join.js (table joins).

import { html, useState, useEffect, useRef } from '../../../vendor/preact.js';
import { store, useStore } from '../store.js';
import { ViewHead, Flag, ErrorLine, Seg } from '../components/common.js';
import { importReport, suggestMatches, applyMerges, mergeDatasets, joinProfiles, pipelineMode, filesForRels } from '../services/pipeline.js';
import { fmtInt, plural } from '../lib/format.js';
import { inputsFromDrop, inputsFromPicker, detect, importOne, tableKindOf, shortName, browserZone, isCSV, blobOf, pathOf } from './data/io.js';
import { InputList, effectiveImporters, isRecognized, inputUse } from './data/inputs.js';
import { ReportView } from './data/report.js';
import { ownersOf, ownerPairs, Owners, MatchList, ManualMerge, IdentityPanel } from './data/identity.js';
import { JoinSetup, ProfileJoin } from './data/join.js';

export { ReportView };

// The note every data state carries: nothing persists (S19).
export const NOT_STORED = 'Loaded data is not kept: reloading or closing this tab erases it. To keep it, save a project under Methods & Export.';
// Suggested text for the shell's leave-page warning (beforeunload).
export const LEAVE_WARNING = 'Leave Org Signal? The loaded data is not stored anywhere, so leaving or reloading erases it.';

// ---- view ---------------------------------------------------------------------

export function DataView() {
  const dataset = useStore(s => s.dataset);
  const report = useStore(s => s.report);
  const hasData = !!dataset;
  const [inputs, setInputs] = useState([]);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Nothing silently replaces data: with data loaded, imports are added.
  const [mode, setMode] = useState('add');
  const [tab, setTab] = useState(null);

  const update = (id, patch) => setInputs(prev => prev.map(x => (x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)));
  const updateMany = (ids, fn) => { const set = new Set(ids); setInputs(prev => prev.map(x => (set.has(x.id) ? { ...x, ...fn(x) } : x))); };
  const remove = id => setInputs(prev => prev.filter(x => x.id !== id));

  const addInputs = async (list) => {
    if (!list.length) return;
    setError(null);
    setInputs(prev => [...prev, ...list]);
    for (const inp of list) {
      detect(inp, { onProgress: (f, msg) => update(inp.id, { progress: msg }) }).then(async ({ detections, files }) => {
        const tableKind = await tableKindOf(inp, detections);
        // Time zones the export does not record start as this computer's zone,
        // shown in the options, rather than as an unexplained UTC.
        const options = { ...inp.options };
        for (const d of effectiveImporters({ ...inp, detections, importerId: 'auto' })) {
          for (const o of d.options || []) if ((o.type === 'timezone') && o.default === 'unknown') options[d.id] = { ...(options[d.id] || {}), [o.key]: browserZone() };
        }
        update(inp.id, { detections, detecting: false, progress: null, fileCount: files, tableKind, options });
      }, err => update(inp.id, { detections: [], detecting: false, progress: null, error: err.message }));
    }
  };

  const uses = new Map(inputs.map(i => [i.id, inputUse(i, inputs, hasData)]));
  const toImport = inputs.filter(i => uses.get(i.id) === 'import' && isRecognized(i));
  const toJoin = inputs.filter(i => uses.get(i.id) === 'join');
  const skipped = inputs.filter(i => !i.detecting && uses.get(i.id) === 'import' && !isRecognized(i));
  const detecting = inputs.some(i => i.detecting);

  const runImports = async () => {
    setError(null);
    // Only a table of people with data already loaded: straight to the join.
    if (!toImport.length && toJoin.length && hasData) {
      store.set({ ui: { ...store.get().ui, profileFile: blobOf(toJoin[0].files[0]) } });
      setInputs([]); setTab('profile');
      return;
    }
    setBusy(true);
    try {
      const results = await store.actions.runJob(toImport.length > 1 ? `Importing ${toImport.length} inputs` : `Importing ${toImport[0].name}`, async (signal, progress) => {
        const out = [];
        for (let k = 0; k < toImport.length; k++) {
          const inp = toImport[k];
          out.push(await importOne(inp, { signal, onProgress: (f, msg) => progress((k + (f || 0)) / toImport.length, msg) }));
        }
        return out;
      });
      const fresh = results.length > 1 ? await mergeDatasets(results.map(r => r.dataset)) : results[0].dataset;
      const freshReport = await importReport(fresh);
      const add = hasData && mode === 'add';
      const newName = shortName(freshReport?.sources, toImport);
      const name = add ? `${dataset.meta.name} + ${newName}` : newName;
      const ds = add ? await mergeDatasets([dataset, fresh], { name }) : fresh;
      const rep = add ? await importReport(ds) : freshReport;
      const unclaimed = results.flatMap(r => r.unclaimed || r.report?.unclaimed || []);
      if (rep) rep.unclaimed = unclaimed.filter(r => !isCSV({ path: r }));
      const matches = await suggestMatches(ds).catch(() => null);
      // Tables no importer claimed (an HR export inside the Slack zip) and
      // tables marked "add details to people" are offered for joining.
      const inner = (await filesForRels(toImport.flatMap(i => i.files), unclaimed.filter(r => /\.(csv|tsv|txt)$/i.test(r))).catch(() => [])).filter(isCSV);
      const joinFiles = [...toJoin.map(i => i.files[0]), ...inner];
      setPending({ dataset: ds, fresh, report: rep, matches, mode: hasData ? mode : 'replace', joinFiles, owners: rep ? ownersOf(ds, rep) : [], name });
      setInputs([]);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e); else store.actions.notify('info', 'Import cancelled.');
    } finally { setBusy(false); }
  };

  const loadPending = async ({ pairs, join, name }) => {
    setBusy(true); setError(null);
    try {
      let ds = pending.dataset;
      if (pairs.length) ds = await applyMerges(ds, pairs);
      if (join) ds = (await joinProfiles(ds, join.table, join.opts)).dataset;
      ds = { ...ds, meta: { ...ds.meta, name: name || ds.meta.name } };
      const before = store.get().datasets || [];
      await store.actions.loadDataset(ds, { mode: 'replace' });
      store.set({ datasets: pending.mode === 'add' ? [...before, pending.fresh] : [pending.fresh] });
      store.actions.notify('info', `Loaded: ${plural(ds.nodes.count, 'person', 'people')}, ${plural(ds.events.count, 'event')}.`);
      setPending(null);
      // Same as Build and Generate: loading takes you to the network.
      store.actions.setView('network');
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const showInputs = inputs.length > 0 && !pending;
  return html`<div class="view view--col dv">
    <${ViewHead} title="Data" intro=${hasData && !pending ? 'What is loaded, what each source can and cannot show, and who is who.' : null}
      actions=${hasData && !pending && !showInputs && html`<button type="button" class="btn btn--primary" onClick=${() => store.actions.setView('network')}>Open network</button>`} />
    <p class="visually-hidden" role="status" aria-live="polite">${detectionSummary(inputs)}</p>
    ${!hasData && !inputs.length && !pending && html`<${EmptyState} onFiles=${addInputs} />`}
    ${hasData && !pending && !showInputs && html`<${CurrentData} dataset=${dataset} report=${report} tab=${tab} onTab=${setTab} />`}
    ${hasData && !pending && !showInputs && html`<section class="section dv-more" aria-label="Add data">
      <${DropLine} onFiles=${addInputs} />
      <p class="small text2 dv-stored">${NOT_STORED} <button type="button" class="tlink tlink--arrow" onClick=${() => store.actions.setView('methods')}>Methods & Export</button></p>
    </section>`}
    ${showInputs && html`<section class="section" aria-labelledby="det-h">
      <h2 id="det-h" class="section__title">${hasData ? 'Data to add' : 'Data to import'}</h2>
      <${DropZone} onFiles=${addInputs} compact />
      <${InputList} inputs=${inputs} uses=${uses} onChange=${update} onChangeMany=${updateMany} onRemove=${remove} />
      <div class="dv-actions" role="group" aria-label="Import">
        ${hasData && html`<${Seg} label="With the loaded data" value=${mode} onChange=${setMode} options=${[{ value: 'add', label: 'Add to it' }, { value: 'replace', label: 'Replace it' }]} />`}
        <p class="small text2 dv-actions__note">${actionNote({ detecting, toImport, toJoin, skipped, hasData, mode })}</p>
        <div class="dv-actions__btns">
          <button type="button" class="tlink" onClick=${() => setInputs([])} disabled=${busy}>Clear</button>
          <button type="button" class="btn btn--primary" onClick=${runImports} disabled=${busy || detecting || (!toImport.length && !(toJoin.length && hasData))}>${importLabel(toImport, toJoin, hasData)}</button>
        </div>
      </div>
    </section>`}
    <${ErrorLine} error=${error} />
    ${pending && html`<${PendingReview} pending=${pending} busy=${busy} hasData=${hasData} onLoad=${loadPending} onDiscard=${() => setPending(null)} />`}
  </div>`;
}

function detectionSummary(inputs) {
  if (!inputs.length) return '';
  const done = inputs.filter(i => !i.detecting);
  if (done.length < inputs.length) return `Detecting ${fmtInt(inputs.length - done.length)} of ${fmtInt(inputs.length)} inputs.`;
  const bad = done.filter(i => !isRecognized(i));
  return bad.length ? `${fmtInt(done.length - bad.length)} recognized; not recognized: ${bad.map(i => i.name).join(', ')}.` : `${plural(done.length, 'input')} recognized.`;
}

function importLabel(toImport, toJoin, hasData) {
  if (!toImport.length && toJoin.length && hasData) return 'Join the table';
  return toImport.length > 1 ? `Import ${fmtInt(toImport.length)} inputs` : 'Import';
}

function actionNote({ detecting, toImport, toJoin, skipped, hasData, mode }) {
  if (detecting) return 'Detecting formats...';
  const parts = [];
  if (hasData) parts.push(mode === 'add' ? 'The new data is added to what is loaded.' : 'The loaded data will be replaced once you confirm.');
  if (toJoin.length) parts.push(`${plural(toJoin.length, 'table')} of people will be joined as details.`);
  if (skipped.length) parts.push(`${plural(skipped.length, 'input')} not recognized ${skipped.length === 1 ? 'is' : 'are'} left out.`);
  if (!toImport.length && !(toJoin.length && hasData)) parts.push('Nothing here can be imported yet.');
  return parts.join(' ');
}

async function loadDemo() {
  try {
    const { demoDataset } = await import('../app.js');
    await store.actions.loadDataset(await demoDataset(), { mode: 'replace' });
    store.actions.notify('info', 'Loaded the synthetic demo organization (fake names, generated messages).');
  } catch (e) { store.actions.notify('error', `Could not load the demo: ${e.message}`); }
}

const HOWTO = [
  ['Slack', 'Workspace owners and admins: Settings & administration > Workspace settings > Import/Export Data > Export. Download the zip.'],
  ['Gmail', 'takeout.google.com: deselect all, select Mail, export. Download the zip.'],
  ['WhatsApp', 'Open a chat > More (or the chat name) > Export chat > Without media. One zip or .txt per chat; drop them all at once.'],
  ['LinkedIn', 'Settings > Data privacy > Get a copy of your data > the larger archive. Download the zip.'],
  ['X', 'Settings > Your account > Download an archive of your data. Download the zip when it is ready.'],
  ['Microsoft Teams, Outlook, Telegram, Discord, Instagram', 'Each app\'s own "download your data" export works; drop the zip or folder as downloaded.'],
];

function EmptyState({ onFiles }) {
  return html`<div class="empty dv-empty">
    <h2>Map who talks to whom</h2>
    <p class="lead">Drop the exports you already have and see the network inside them: who connects to whom, who bridges groups, and how that changes over time. Measures come with how sure you can be.</p>
    <p class="dv-privacy"><${Flag} level="ok">Private</${Flag}> Everything runs in this browser and nothing is uploaded. Loaded data is not kept: closing the tab erases it. Only drafts you make in Build, and an API key if you choose to remember it, are saved in this browser.</p>
    <div class="dv-empty__drop"><${DropZone} onFiles=${onFiles} /></div>
    <p class="small text2 dv-sources">Reads Slack, Microsoft Teams, Gmail and other email, Google and Outlook calendars, WhatsApp, LinkedIn, X, Telegram, iMessage, Messenger and Instagram, Discord, Reddit, Bluesky, Mastodon and Threads exports; survey responses (Google Forms, Qualtrics, Network Canvas); network files (GraphML, GEXF, Pajek, UCINET); and any spreadsheet of who-to-whom.</p>
    <details class="disclose dv-howto"><summary>How to get your export</summary>
      <dl class="dv-howto__list">${HOWTO.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
    </details>
    <p class="small text2 dv-demo">No data at hand? <button type="button" class="tlink" onClick=${loadDemo}>Load a small synthetic organization</button> to try every view.</p>
    <div class="ways">
      <div><h3>Build by hand</h3><p>Draw a network, run an ego-network interview, record a roster, or collect perceived networks from several informants.</p><button type="button" class="tlink tlink--arrow" onClick=${() => store.actions.setView('build')}>Build a network</button></div>
      <div><h3>Generate</h3><p>Create a synthetic organization or community with planted structure, to learn the tool or to test what the measures recover.</p><button type="button" class="tlink tlink--arrow" onClick=${() => store.actions.setView('generate')}>Generate a network</button></div>
    </div>
  </div>`;
}

function useDrop(onFiles) {
  const [over, setOver] = useState(false);
  return [over, {
    onDragOver: e => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: async e => { e.preventDefault(); setOver(false); onFiles(await inputsFromDrop(e.dataTransfer)); },
  }];
}

function Pickers({ onFiles, primary }) {
  const fileRef = useRef(null);
  const dirRef = useRef(null);
  useEffect(() => { if (dirRef.current) { dirRef.current.setAttribute('webkitdirectory', ''); dirRef.current.setAttribute('directory', ''); } }, []);
  return html`<button type="button" class=${primary ? 'btn btn--primary' : 'tlink'} onClick=${() => fileRef.current.click()}>Choose files</button>
    <button type="button" class="tlink" onClick=${() => dirRef.current.click()}>Choose a folder</button>
    <input type="file" multiple hidden ref=${fileRef} onChange=${e => { onFiles(inputsFromPicker(e.currentTarget.files, false)); e.currentTarget.value = ''; }} />
    <input type="file" multiple hidden ref=${dirRef} onChange=${e => { onFiles(inputsFromPicker(e.currentTarget.files, true)); e.currentTarget.value = ''; }} />`;
}

function DropZone({ onFiles, compact = false }) {
  const [over, drop] = useDrop(onFiles);
  return html`<div class=${`drop dv-drop${compact ? ' dv-drop--compact' : ''}`} data-over=${String(over)} ...${drop}>
    <p class="drop__title">${compact ? 'Drop more files, zips or folders' : 'Drop files, zips or folders here'}</p>
    ${!compact && html`<p class="drop__hint">An export zip as downloaded, a folder of exports, single files, or many at once (all your WhatsApp chats). Each is recognized separately.</p>`}
    <div class="row dv-drop__row">
      <${Pickers} onFiles=${onFiles} primary=${!compact} />
      ${pipelineMode() === 'mock' && html`<span class="meta">Demo mode: any file shows the demo import</span>`}
    </div>
  </div>`;
}

// Loaded data: adding more is one line, not a second landing page.
function DropLine({ onFiles }) {
  const [over, drop] = useDrop(onFiles);
  return html`<div class="dv-dropline" data-over=${String(over)} ...${drop}>
    <span class="dv-dropline__text">Add more data: drop files here, or</span>
    <${Pickers} onFiles=${onFiles} />
  </div>`;
}

// ---- review after import -----------------------------------------------------------

function PendingReview({ pending, busy, hasData, onLoad, onDiscard }) {
  const ds = pending.dataset;
  const matches = pending.matches || [];
  const [name, setName] = useState(pending.name || ds.meta.name);
  const [accepted, setAccepted] = useState(() => new Set(matches.map((m, i) => (m.confidence === 'high' ? i : -1)).filter(i => i >= 0)));
  const [manual, setManual] = useState([]);
  const [owners, setOwners] = useState(() => new Set(pending.owners.map(o => o.key)));
  const [joinFile, setJoinFile] = useState(pending.joinFiles?.[0] || null);
  const [join, setJoin] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const toggle = (i, v) => setAccepted(prev => { const s = new Set(prev); if (v) s.add(i); else s.delete(i); return s; });
  const pairs = [...(pending.owners.length >= 2 ? ownerPairs(pending.owners, owners) : []), ...matches.filter((_, i) => accepted.has(i)), ...manual];
  const empty = ds.events.count === 0;
  const replacing = hasData && pending.mode === 'replace';
  const load = () => {
    if (replacing && !confirm) { setConfirm(true); return; }
    onLoad({ pairs, join: joinFile && join?.opts?.columns?.length ? { table: join.table, opts: join.opts } : null, name: name.trim() });
  };
  return html`<section class="section dv-review" aria-labelledby="rev-h">
    <h2 id="rev-h" class="section__title">Review before analysis</h2>
    <label class="field dv-name"><span>Name for this data</span><input class="input" value=${name} maxlength="120" onInput=${e => setName(e.currentTarget.value)} /></label>
    ${empty && html`<div class="notice-line" role="alert"><${Flag} level="error">Nothing to analyze</${Flag}><span class="grow">These files produced no messages, ties or other events, so there is no network to build. Check the problems listed below, or choose another importer.</span></div>`}
    ${pending.owners.length >= 2 && html`<${Owners} owners=${pending.owners} checked=${owners} onToggle=${(k, v) => setOwners(prev => { const s = new Set(prev); if (v) s.add(k); else s.delete(k); return s; })} />`}
    <${ReportView} report=${pending.report} pending />
    <div class="section">
      <h3 class="dv-h3">Who is who</h3>
      <${MatchList} matches=${matches} accepted=${accepted} onToggle=${toggle} onAll=${v => setAccepted(new Set(v ? matches.map((_, i) => i) : []))} />
      ${!empty && html`<${ManualMerge} ds=${ds} pairs=${manual} onAdd=${p => setManual(m => [...m, p])} onRemove=${k => setManual(m => m.filter((_, j) => j !== k))} />`}
    </div>
    ${pending.joinFiles?.length > 0 && !empty && html`<div class="section">
      <h3 class="dv-h3">Add details from a table of people</h3>
      <p class="small text2 dv-p">Columns such as department or role are joined to the matching people. The match below is before merging duplicates; it is redone on load.</p>
      ${pending.joinFiles.map(f => html`<label class="check dv-radio"><input type="radio" name="joinfile" checked=${joinFile === f} onChange=${() => { setJoinFile(f); setJoin(null); }} />${pathOf(f)}</label>`)}
      <label class="check dv-radio"><input type="radio" name="joinfile" checked=${!joinFile} onChange=${() => setJoinFile(null)} />Do not join a table</label>
      ${joinFile && html`<${JoinSetup} key=${pathOf(joinFile)} ds=${ds} file=${joinFile} onChange=${setJoin} />`}
    </div>`}
    <div class="dv-actions" role="group" aria-label="Load">
      <p class="small text2 dv-actions__note">${confirm ? html`<${Flag} level="caution">Replace</${Flag}> This removes the loaded data from the analysis. Load anyway?` : summary(pairs, joinFile && join, replacing, pending.mode === 'add')}</p>
      <div class="dv-actions__btns">
        <button type="button" class="tlink" onClick=${confirm ? () => setConfirm(false) : onDiscard} disabled=${busy}>${confirm ? 'Keep the loaded data' : 'Discard'}</button>
        <button type="button" class="btn btn--primary" onClick=${load} disabled=${busy || empty}>${confirm ? 'Replace and load' : pairs.length ? `Merge ${fmtInt(pairs.length)} and load into analysis` : 'Load into analysis'}</button>
      </div>
    </div>
  </section>`;
}

function summary(pairs, join, replacing, adding) {
  const parts = [];
  parts.push(pairs.length ? `${plural(pairs.length, 'merge')} will be applied.` : 'No merges.');
  if (join) parts.push(`${plural(join.opts.columns.length, 'column')} will be joined.`);
  if (adding) parts.push('Added to the loaded data.');
  if (replacing) parts.push('Replaces the loaded data.');
  return parts.join(' ');
}

// ---- current data --------------------------------------------------------------------

const TABS = [['report', 'Import report'], ['identity', 'Who is who'], ['profile', 'Join attributes']];

function CurrentData({ dataset, report, tab: forced, onTab }) {
  const [tab, setTab] = useState(() => forced || (store.get().ui?.profileFile ? 'profile' : 'report'));
  useEffect(() => { if (forced) { setTab(forced); onTab(null); } }, [forced]);
  const refs = useRef({});
  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const onKey = e => {
    const k = TABS.findIndex(([id]) => id === tab);
    const next = e.key === 'ArrowRight' ? (k + 1) % TABS.length : e.key === 'ArrowLeft' ? (k + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next][0]);
    refs.current[TABS[next][0]]?.focus();
  };
  return html`<section class="section dv-current" aria-labelledby="cur-h">
    <h2 id="cur-h" class="section__title dv-current__name">${dataset.meta.name}</h2>
    <div class="tabs" role="tablist" aria-label="Loaded data" onKeyDown=${onKey}>
      ${TABS.map(([id, l]) => html`<button type="button" role="tab" id=${`dv-tab-${id}`} aria-controls="dv-panel" aria-selected=${String(tab === id)} tabindex=${tab === id ? 0 : -1} ref=${el => { refs.current[id] = el; }} onClick=${() => setTab(id)}>${l}</button>`)}
    </div>
    <div role="tabpanel" id="dv-panel" aria-labelledby=${`dv-tab-${tab}`}>
      ${tab === 'report' && html`<${ReportView} report=${report} />`}
      ${tab === 'identity' && html`<${IdentityPanel} ds=${dataset} />`}
      ${tab === 'profile' && html`<${ProfileJoin} ds=${dataset} />`}
    </div>
  </section>`;
}
