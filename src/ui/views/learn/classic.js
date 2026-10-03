// Classic datasets in the UI: the compact library list (Data start page and
// Learn) and the card a loaded classic dataset carries (description, what the
// study found, known answer, assignment, citation, licence, ethics).
//
// Loading goes through src/core/classic.js and store.actions.loadDataset, then
// opens Network, whose "Who stands out" block shows ds.meta.example (title and
// lookFor) like a worked example. Datasets whose redistribution terms are not
// settled are listed as not included; the address flag ?classic=pending (or
// #...?classic=pending) loads them from data/classic-pending/ on a development
// server, where those files exist. The deployed build never has them.

import { html, useState, useEffect } from '../../../../vendor/preact.js';
import { store } from '../../store.js';
import { listClassic, loadClassic, loadClassicPerceived, classicSize } from '../../../core/classic.js';
import { fmtInt } from '../../lib/format.js';

export function pendingAllowed() {
  if (typeof location === 'undefined') return false;
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.split('?')[1] || '');
  return q.get('classic') === 'pending' || h.get('classic') === 'pending';
}

let listPromise = null;
function useClassicList() {
  const [state, setState] = useState({ list: null, error: null });
  useEffect(() => {
    let live = true;
    listPromise ||= listClassic({ pending: pendingAllowed() });
    listPromise.then(list => live && setState({ list, error: null }), error => { listPromise = null; if (live) setState({ list: null, error }); });
    return () => { live = false; };
  }, []);
  return state;
}

const modeWords = e => (e.mode === 'two' ? `Two-mode (${Object.keys(e.modes || {}).join(' and ').toLowerCase() || 'two kinds of node'})` : 'One-mode');
const nodeWord = e => (e.id === 'dolphins' ? 'dolphins' : e.id === 'lesmis' ? 'characters' : e.id === 'florentine' ? 'families' : e.mode === 'two' ? 'nodes' : 'people');

function sizeLine(e) {
  // Ties counted over every relation and time point the file holds.
  const over = [e.relations?.length > 1 && 'relations', e.timePoints?.length > 1 || /week/.test(e.timePoints?.[0] || '') ? 'time points' : null].filter(Boolean);
  const ties = e.id === 'enron' ? `${fmtInt(e.ties)} messages` : `${fmtInt(e.ties)} ${e.ties === 1 ? 'tie' : 'ties'}${over.length ? ` (all ${over.join(' and ')})` : ''}`;
  return `${e.year} · ${fmtInt(e.nodes)} ${nodeWord(e)} · ${ties} · ${modeWords(e)} · ${classicSize(e.bytes)}`;
}

export async function openClassic(entry) {
  const cur = store.get().dataset;
  if (cur && !confirm(`Load ${entry.title}? It replaces the data now loaded (${cur.meta?.name || 'current data'}), which is not kept.`)) return false;
  try {
    const ds = await store.actions.runJob(`Loading ${entry.title}`, async (signal, progress) => {
      progress(0.1, 'Reading the file');
      const d = await loadClassic(entry.id, { pending: pendingAllowed() });
      progress(0.4, 'Analyzing');
      return d;
    });
    await store.actions.loadDataset(ds, { mode: 'replace' });
    store.set({ datasets: [ds] });
    store.actions.notify('info', `Loaded ${entry.title}. What to look for is under "Who stands out".`);
    store.actions.setView('network');
    return true;
  } catch (e) {
    if (e?.name !== 'AbortError') store.actions.notify('error', `Could not load ${entry.title}: ${e.message}`);
    return false;
  }
}

// Krackhardt's managers' perceptions into Build > Perceived. The builder keeps
// its study in localStorage under its own key and reads it when Build opens,
// so this writes that key (asking first when a study is there) and opens the
// Perceived tab. A Build address parameter for this would be cleaner: see the
// report in docs/datasets.md ("Perceived builder").
const CSS_KEY = 'orgsignal.build.perceived', TAB_KEY = 'orgsignal.build.tab';
export async function openPerceived(entry, relation = 'advice') {
  try {
    const css = await loadClassicPerceived(entry.id, relation, { pending: pendingAllowed() });
    let old = null;
    try { old = JSON.parse(localStorage.getItem(CSS_KEY) || 'null'); } catch { /* storage unavailable */ }
    if (old?.people?.length && old.classic !== entry.id && !confirm('Open the managers\' perceptions in Build > Perceived? The perceived-network study there now is replaced.')) return;
    try { localStorage.setItem(CSS_KEY, JSON.stringify(css)); localStorage.setItem(TAB_KEY, JSON.stringify('perceived')); } catch {
      store.actions.notify('error', 'This browser does not allow saving the study for Build (site data is blocked).');
      return;
    }
    store.actions.setView('build');
    store.actions.notify('info', `Opened ${css.people.length} managers and their ${css.informants.length} reports (${relation}) in Build > Perceived. Go to Compare for consensus and accuracy.`);
  } catch (e) { store.actions.notify('error', `Could not open the perceptions: ${e.message}`); }
}

function Item({ e }) {
  const [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); try { await openClassic(e); } finally { setBusy(false); } };
  return html`<li class="example classic" aria-labelledby=${`classic-${e.id}`}>
    <h3 class="example__title" id=${`classic-${e.id}`}>${e.title}</h3>
    <p class="meta classic__meta">${sizeLine(e)}</p>
    <p class="example__what">${e.description}</p>
    ${e.loadable
      ? html`<p class="tlinks"><button type="button" class="tlink tlink--arrow" onClick=${load} disabled=${busy} aria-label=${`Load ${e.title}`}>${busy ? 'Loading' : 'Load'}</button>
          ${e.perceived && html`<button type="button" class="tlink" onClick=${() => openPerceived(e, 'advice')}>Perceptions in Build</button>`}</p>`
      : html`<p class="small text2">Not included yet: its redistribution terms are not settled. <a class="linkish" href=${e.sourceUrls[0]} target="_blank" rel="noopener">Public source</a></p>`}
  </li>`;
}

// The library list. `heading`: the section heading level and text are the
// caller's (h2 in Learn, h3 on the Data start page).
export function ClassicList({ headingId = 'classic-h', level = 2, intro = true } = {}) {
  const { list, error } = useClassicList();
  const H = level === 2 ? 'h2' : 'h3';
  return html`<section class="section classic-lib" aria-labelledby=${headingId}>
    <${H} id=${headingId} class=${level === 2 ? '' : 'dv-h3'}>Classic datasets</${H}>
    ${intro && html`<p class="prose small text2">Published networks that textbooks use, each with what the original study found and a known answer to check your analysis against. Load one and Network shows what to look for.</p>`}
    ${error ? html`<p class="small text2">The classic datasets could not be listed (${error.message}).</p>`
      : !list ? html`<p class="small text2">Loading the list.</p>`
      : html`<ul class="examples classic__list">${list.map(e => html`<${Item} e=${e} key=${e.id} />`)}</ul>`}
  </section>`;
}

// The card of a loaded classic dataset (ds.meta.example from loadClassic).
export function ClassicCard({ example: x, title = 'About this dataset' }) {
  if (!x?.classic) return null;
  const pending = x.distribution === 'pending';
  return html`<section class="section classic-card" aria-labelledby="classic-card-h">
    <h2 class="section__title" id="classic-card-h">${title}: ${x.title}</h2>
    <p class="prose">${x.description}</p>
    <dl class="concept__dl">
      <dt>What the study found</dt><dd>${x.findings}</dd>
      ${x.knownAnswers?.length > 0 && html`<dt>Known answer</dt><dd>${x.knownAnswers.map(k => html`<p>${k.key ? html`<span class="concept__k">${k.key}</span>: ` : ''}${k.meaning}</p>`)}</dd>`}
      ${x.lookFor?.length > 0 && html`<dt>What to look for</dt><dd><ul class="classic-card__list" style="margin:0;padding-left:1.1rem">${x.lookFor.map(l => html`<li>${l}</li>`)}</ul></dd>`}
      ${x.assignment && html`<dt>Suggested assignment</dt><dd>${x.assignment.text}${x.assignment.a?.length ? html` <span class="small text2">(Networks 101: ${x.assignment.a.join(', ')}; <a class="linkish" href="#learn" onClick=${ev => { ev.preventDefault(); store.actions.setView('learn'); requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('learn-tasks')?.scrollIntoView({ block: 'start' }))); }}>Find it in the app</a>)</span>` : ''}</dd>`}
      <dt>Citation</dt><dd>${x.citation} ${x.sourceUrls?.map((u, i) => html`${i ? ' · ' : ''}<a class="linkish" href=${u} target="_blank" rel="noopener">${i ? `Source ${i + 1}` : 'Source'}</a>`)}</dd>
      <dt>License</dt><dd>${x.license}${pending ? ' Loaded here from the development server only.' : ''}</dd>
      ${x.ethics && html`<dt>Ethics</dt><dd>${x.ethics}</dd>`}
    </dl>
  </section>`;
}
