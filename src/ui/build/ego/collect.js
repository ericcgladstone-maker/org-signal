// Ego builder steps 3 and 4: collect names per question, then describe each
// person in a fast-entry table.

import { html, useState, useRef } from '../../../../vendor/preact.js';
import * as E from '../../../builders/ego.js';

function GeneratorBox({ s, g, update }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState(null);
  const named = s.alters.filter(a => a.generators.includes(g.id));
  const add = e => {
    e.preventDefault();
    // Several names may be pasted at once, separated by commas, semicolons or lines.
    const names = text.split(/[\n;,]+/).map(x => x.trim()).filter(Boolean);
    if (!names.length) return;
    let cur = s, notes = [];
    for (const n of names) {
      const r = E.addAlter(cur, n, g.id);
      cur = r.session;
      if (r.status === 'duplicate-other') {
        const others = r.alter.generators.filter(x => x !== g.id).map(id => cur.generators.find(q => q.id === id)?.name).filter(Boolean);
        notes.push({ level: 'info', text: `${r.alter.label} was already named under ${others.join(', ')}; added to this question too.` });
      } else if (r.status === 'duplicate-same') notes.push({ level: 'warn', text: `${r.alter.label} is already on this list.` });
      else if (r.status === 'cap') { notes.push({ level: 'warn', text: `This question takes at most ${g.cap} names. ${n} was not added.` }); }
    }
    update(() => cur);
    setMsg(notes.length ? notes : null);
    setText('');
  };
  const full = named.length >= g.cap;
  return html`<section class="ego-gen" aria-labelledby=${'gq-' + g.id}>
    <div class="ego-item-head">
      <h3 id=${'gq-' + g.id}>${g.name}</h3>
      <span class="ob-meta">${named.length} of ${g.cap}</span>
    </div>
    ${g.prompt ? html`<p class="ego-prompt-text">${g.prompt}</p>` : null}
    <form class="ob-row ego-addname" onSubmit=${add}>
      <label class="visually-hidden" for=${'an-' + g.id}>Add a name for ${g.name}</label>
      <input id=${'an-' + g.id} class="ob-input" value=${text} autocomplete="off" disabled=${full}
        placeholder=${full ? 'This question is full' : 'Type a name and press Enter'} onInput=${e => setText(e.target.value)} />
      <button type="submit" class="ob-btn" disabled=${full || !text.trim()}>Add</button>
    </form>
    <div aria-live="polite">${msg ? msg.map(m => html`<p class=${'ob-note ' + (m.level === 'warn' ? 'ob-warn' : '')}>${m.text}</p>`) : null}</div>
    ${named.length ? html`<ul class="ego-names">
      ${named.map(a => html`<li key=${a.id}>
        <span>${a.label}</span>
        ${a.generators.length > 1 ? html`<span class="ob-note">also ${a.generators.filter(x => x !== g.id).map(id => s.generators.find(q => q.id === id)?.name).join(', ')}</span>` : null}
        <button type="button" class="ob-btn quiet sm" aria-label=${`Remove ${a.label} from ${g.name}`} onClick=${() => update(x => E.removeAlter(x, a.id, g.id))}>Remove</button>
      </li>`)}
    </ul>` : null}
  </section>`;
}

export function NamesStep({ s, update }) {
  if (!s.generators.length) return html`<p class="ob-empty">Choose at least one name generator first.</p>`;
  return html`<div class="ob-stack">
    ${s.generators.map(g => html`<${GeneratorBox} key=${g.id} s=${s} g=${g} update=${update} />`)}
    ${s.alters.length ? html`<div class="ob-section">
      <h3>Everyone named <span class="ob-meta">${s.alters.length}</span></h3>
      <div class="ob-tablewrap"><table class="ob-table">
        <thead><tr><th scope="col">Name</th>${s.generators.map(g => html`<th scope="col">${g.name}</th>`)}</tr></thead>
        <tbody>${s.alters.map(a => html`<tr key=${a.id}>
          <th scope="row"><label class="visually-hidden" for=${'rn-' + a.id}>Name</label>
            <input id=${'rn-' + a.id} class="ob-input" value=${a.label} onChange=${e => update(x => E.renameAlter(x, a.id, e.target.value))} /></th>
          ${s.generators.map(g => html`<td>${a.generators.includes(g.id) ? 'named' : ''}</td>`)}
        </tr>`)}</tbody>
      </table></div>
    </div>` : null}
  </div>`;
}

function Cell({ it, a, update, r, c }) {
  const id = `cell-${r}-${c}`;
  const v = a.attrs[it.name] ?? '';
  const set = val => update(x => E.setInterpreter(x, a.id, it.name, val));
  const label = `${it.label} for ${a.label}`;
  if (it.type === 'categorical' || it.type === 'ordinal' || it.type === 'boolean') {
    const options = it.type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : it.options || [];
    return html`<select id=${id} class="ob-select" aria-label=${label} data-r=${r} data-c=${c} value=${String(v)} onChange=${e => set(e.target.value)}>
      <option value="">-</option>
      ${options.map(o => html`<option value=${o.value}>${o.label}</option>`)}
    </select>`;
  }
  return html`<input id=${id} class="ob-input" aria-label=${label} data-r=${r} data-c=${c}
    type=${it.type === 'number' ? 'number' : it.type === 'date' ? 'date' : 'text'} value=${v} onChange=${e => set(e.target.value)} />`;
}

export function DescribeStep({ s, update }) {
  const ref = useRef(null);
  if (!s.alters.length) return html`<p class="ob-empty">Collect some names first.</p>`;
  if (!s.interpreters.length) return html`<p class="ob-empty">No questions about alters were chosen. Go back to Name interpreters to add some, or continue.</p>`;
  // Enter moves down a column (the usual way to key a survey form fast);
  // Shift+Enter moves up. Tab moves across as normal.
  const onKey = e => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (!t.dataset?.r) return;
    e.preventDefault();
    t.dispatchEvent(new Event('change', { bubbles: true }));
    const r = Number(t.dataset.r) + (e.shiftKey ? -1 : 1);
    ref.current?.querySelector(`[data-r="${r}"][data-c="${t.dataset.c}"]`)?.focus();
  };
  const p = E.progress(s);
  return html`<div class="ob-stack">
    <p class="ob-note">${p.answered} of ${p.cells} answers filled. Enter moves down a column, Tab moves across.</p>
    <div class="ob-tablewrap" ref=${ref} onKeyDown=${onKey}><table class="ob-table ego-describe">
      <thead><tr><th scope="col">Name</th>${s.interpreters.map(it => html`<th scope="col">${it.label}</th>`)}</tr></thead>
      <tbody>${s.alters.map((a, r) => html`<tr key=${a.id}>
        <th scope="row">${a.label}</th>
        ${s.interpreters.map((it, c) => html`<td><${Cell} it=${it} a=${a} update=${update} r=${r} c=${c} /></td>`)}
      </tr>`)}</tbody>
    </table></div>
  </div>`;
}
