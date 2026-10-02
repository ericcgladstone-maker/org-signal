// Roster entry: paste or import names (with optional attribute columns), then
// edit them as a table. Shared by the roster and perceived-network builders.

import { html, useState } from '../../../../vendor/preact.js';
import { parseRosterText } from '../../../builders/roster.js';
import { uid, normName } from '../../../builders/common.js';
import { pickFile, readFileText } from '../shared.js';

export function PeopleEditor({ people, attrColumns = [], onChange, withAttrs = true, idPrefix = 'ob-people' }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState(null);
  const [newName, setNewName] = useState('');

  const apply = (src, replace) => {
    const r = parseRosterText(src);
    if (!r.people.length) { setMsg({ err: true, text: 'No names found.' }); return; }
    const existing = new Set(people.map(p => normName(p.label)));
    const incoming = replace ? r.people : r.people.filter(p => !existing.has(normName(p.label)));
    const cols = [...attrColumns];
    for (const c of r.attrColumns) if (!cols.some(x => x.key === c.key)) cols.push(c);
    onChange(replace ? incoming : [...people, ...incoming], cols);
    const skipped = r.duplicates.length + (replace ? 0 : r.people.length - incoming.length);
    setMsg({ text: `${incoming.length} ${incoming.length === 1 ? 'person' : 'people'} added${skipped ? `; ${skipped} repeated name(s) skipped` : ''}.` });
    setText('');
  };
  const importFile = async () => {
    const f = await pickFile('.csv,.tsv,.txt,text/csv,text/plain');
    if (f) apply(await readFileText(f), people.length === 0);
  };
  const update = (id, patch) => onChange(people.map(p => (p.id === id ? { ...p, ...patch } : p)), attrColumns);
  const remove = id => onChange(people.filter(p => p.id !== id), attrColumns);
  const addOne = e => {
    e.preventDefault();
    const label = newName.trim();
    if (!label) return;
    if (people.some(p => normName(p.label) === normName(label))) { setMsg({ err: true, text: `${label} is already on the roster.` }); return; }
    onChange([...people, { id: uid('p'), label, attrs: {} }], attrColumns);
    setNewName('');
  };
  const [newCol, setNewCol] = useState('');
  const addColumn = e => {
    e.preventDefault();
    const key = newCol.trim();
    if (!key || attrColumns.some(c => c.key === key)) return;
    onChange(people, [...attrColumns, { key, type: 'text' }]);
    setNewCol('');
  };

  return html`<div class="ob-stack">
    <div class="ob-field">
      <label for=${idPrefix + '-paste'}>Paste names</label>
      <textarea id=${idPrefix + '-paste'} class="ob-textarea" rows="5" placeholder=${'One name per line, or a CSV with a "name" column and attribute columns'}
        value=${text} onInput=${e => setText(e.currentTarget.value)}></textarea>
    </div>
    <div class="ob-row">
      <button type="button" class="ob-btn primary" disabled=${!text.trim()} onClick=${() => apply(text, false)}>Add to roster</button>
      <button type="button" class="ob-btn" disabled=${!text.trim() || !people.length} onClick=${() => apply(text, true)}>Replace roster</button>
      <button type="button" class="ob-btn" onClick=${importFile}>Import CSV</button>
      ${msg ? html`<span class=${msg.err ? 'ob-note ob-err' : 'ob-note'} role="status">${msg.text}</span>` : null}
    </div>
    <form class="ob-row" onSubmit=${addOne}>
      <label class="visually-hidden" for=${idPrefix + '-one'}>Add one person</label>
      <input id=${idPrefix + '-one'} class="ob-input" style="max-width:16rem" placeholder="Add one person" value=${newName} onInput=${e => setNewName(e.currentTarget.value)} />
      <button type="submit" class="ob-btn" disabled=${!newName.trim()}>Add</button>
      <span class="ob-spacer"></span>
      <span class="ob-meta">${people.length} on roster</span>
    </form>
    ${withAttrs ? html`<form class="ob-row" onSubmit=${addColumn}>
      <label class="visually-hidden" for=${idPrefix + '-col'}>New attribute column</label>
      <input id=${idPrefix + '-col'} class="ob-input" style="max-width:16rem" placeholder="New attribute, e.g. department" value=${newCol} onInput=${e => setNewCol(e.currentTarget.value)} />
      <button type="submit" class="ob-btn quiet" disabled=${!newCol.trim()}>Add attribute column</button>
    </form>` : null}
    ${people.length ? html`<div class="ob-tablewrap" style="max-height:22rem">
      <table class="ob-table">
        <thead><tr><th>#</th><th>Name</th>${withAttrs ? attrColumns.map(c => html`<th>${c.key}</th>`) : null}<th><span class="visually-hidden">Remove</span></th></tr></thead>
        <tbody>${people.map((p, i) => html`<tr>
          <td class="num ob-meta">${i + 1}</td>
          <td><input class="ob-input" aria-label=${`Name ${i + 1}`} value=${p.label} onChange=${e => update(p.id, { label: e.currentTarget.value.trim() || p.label })} /></td>
          ${withAttrs ? attrColumns.map(c => html`<td><input class="ob-input" aria-label=${`${c.key} for ${p.label}`} value=${p.attrs?.[c.key] ?? ''}
            onChange=${e => update(p.id, { attrs: { ...p.attrs, [c.key]: e.currentTarget.value } })} /></td>`) : null}
          <td><button type="button" class="ob-btn quiet sm" aria-label=${`Remove ${p.label}`} onClick=${() => remove(p.id)}>Remove</button></td>
        </tr>`)}</tbody>
      </table></div>` : null}
  </div>`;
}
