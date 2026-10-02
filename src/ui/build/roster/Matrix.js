// Who-to-whom grid used by the roster and perceived-network builders.
//
// Rows are senders (the person answering, or "from"), columns receivers.
// One cell is in the tab order at a time (roving tabindex): arrow keys move,
// Home/End jump within a row, PageUp/PageDown move 10 rows, Space or Enter
// toggles a binary tie, digits 0..max set a valued tie, Delete/Backspace clear.
// Headers stay put while the grid scrolls inside its own wrapper, so a 50+
// person roster never makes the page itself scroll sideways.

import { html, useState, useRef, useEffect, useMemo } from '../../../../vendor/preact.js';
import { pairKey } from '../../../builders/matrix.js';

export function Matrix({ people, values, onSet, scale = 'binary', max = 5, caption = 'Ties', rowHeading = 'From', colHeading = 'To' }) {
  const [focus, setFocus] = useState({ r: 0, c: people.length > 1 ? 1 : 0 });
  const [hl, setHl] = useState(null);
  const tableRef = useRef(null);
  const n = people.length;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  useEffect(() => { if (focus.r >= n || focus.c >= n) setFocus({ r: 0, c: n > 1 ? 1 : 0 }); }, [n]);

  const moveTo = (r, c) => {
    r = clamp(r, 0, n - 1); c = clamp(c, 0, n - 1);
    setFocus({ r, c }); setHl({ r, c });
    const td = tableRef.current?.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
    if (td) { td.focus({ preventScroll: false }); td.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
  };

  const valueAt = (r, c) => values[pairKey(people[r].id, people[c].id)] || 0;
  const set = (r, c, v) => { if (r !== c) onSet(people[r].id, people[c].id, v); };
  const toggle = (r, c) => {
    const cur = valueAt(r, c);
    if (scale === 'binary') set(r, c, cur ? 0 : 1);
    else set(r, c, cur >= max ? 0 : cur + 1); // click cycles 0..max
  };

  const onKey = e => {
    const td = e.target.closest('td[data-r]');
    if (!td) return;
    const r = Number(td.dataset.r), c = Number(td.dataset.c);
    const k = e.key;
    if (k === 'ArrowRight') moveTo(r, c + 1);
    else if (k === 'ArrowLeft') moveTo(r, c - 1);
    else if (k === 'ArrowDown') moveTo(r + 1, c);
    else if (k === 'ArrowUp') moveTo(r - 1, c);
    else if (k === 'Home') moveTo(e.ctrlKey ? 0 : r, 0);
    else if (k === 'End') moveTo(e.ctrlKey ? n - 1 : r, n - 1);
    else if (k === 'PageDown') moveTo(r + 10, c);
    else if (k === 'PageUp') moveTo(r - 10, c);
    else if (k === ' ' || k === 'Enter') toggle(r, c);
    else if (k === 'Delete' || k === 'Backspace') set(r, c, 0);
    else if (/^[0-9]$/.test(k)) {
      const v = Number(k);
      if (scale === 'binary') set(r, c, v ? 1 : 0); else if (v <= max) set(r, c, v);
    } else return;
    e.preventDefault();
  };

  const help = scale === 'binary'
    ? 'Arrow keys move. Space or Enter toggles a tie. 1 sets, 0 clears.'
    : `Arrow keys move. Type 0 to ${max} to set a value; Space steps it up.`;
  const counts = useMemo(() => Object.keys(values).length, [values]);

  if (!n) return html`<p class="ob-empty">Add people to the roster first.</p>`;
  return html`<div class="ob-stack" style="gap:.4rem">
    <p class="ob-note" id="ob-matrix-help">${help} Rows are ${rowHeading.toLowerCase()}, columns are ${colHeading.toLowerCase()}. ${counts} ${counts === 1 ? 'tie' : 'ties'} entered.</p>
    <div class="ob-matrixwrap">
      <table class="ob-matrix" role="grid" aria-label=${caption} aria-describedby="ob-matrix-help" ref=${tableRef}
        onKeyDown=${onKey} onFocusOut=${e => { if (!tableRef.current?.contains(e.relatedTarget)) setHl(null); }}>
        <thead><tr>
          <th scope="col" class="corner"><div class="ob-meta">${rowHeading} ↓<br />${colHeading} →</div></th>
          ${people.map((p, c) => html`<th scope="col" class=${hl && hl.c === c ? 'hl' : ''} title=${p.label}><span>${p.label}</span></th>`)}
        </tr></thead>
        <tbody>
          ${people.map((p, r) => html`<tr class=${hl && hl.r === r ? 'hl' : ''}>
            <th scope="row" title=${p.label}>${p.label}</th>
            ${people.map((q, c) => {
              if (r === c) return html`<td class="self" aria-disabled="true" data-r=${r} data-c=${c} tabindex=${focus.r === r && focus.c === c ? 0 : -1}
                aria-label=${`${p.label} (self)`}></td>`;
              const v = values[pairKey(p.id, q.id)] || 0;
              const cls = v ? (scale === 'binary' ? 'on' : `v${Math.min(5, Math.max(1, Math.round((v / max) * 5)))}`) : '';
              return html`<td role="gridcell" class=${cls} data-r=${r} data-c=${c}
                tabindex=${focus.r === r && focus.c === c ? 0 : -1}
                aria-label=${`${p.label} to ${q.label}: ${v ? (scale === 'binary' ? 'tie' : v) : 'no tie'}`}
                onClick=${() => { setFocus({ r, c }); setHl({ r, c }); toggle(r, c); }}
                onFocus=${() => { setHl({ r, c }); }}>${v ? (scale === 'binary' ? '●' : v) : ''}</td>`;
            })}
          </tr>`)}
        </tbody>
      </table>
    </div>
  </div>`;
}

// Pair-at-a-time entry: the same ties as a form and a list. Better on a phone
// and with a screen reader than a large grid.
export function PairEntry({ people, values, onSet, scale = 'binary', max = 5 }) {
  const [from, setFrom] = useState(people[0]?.id || '');
  const [to, setTo] = useState(people[1]?.id || '');
  const [val, setVal] = useState(scale === 'binary' ? 1 : max);
  const label = new Map(people.map(p => [p.id, p.label]));
  const list = Object.entries(values).map(([k, v]) => { const i = k.indexOf('|'); return { from: k.slice(0, i), to: k.slice(i + 1), v }; })
    .filter(t => label.has(t.from) && label.has(t.to))
    .sort((a, b) => label.get(a.from).localeCompare(label.get(b.from)) || label.get(a.to).localeCompare(label.get(b.to)));
  const add = e => { e.preventDefault(); if (from && to && from !== to) onSet(from, to, scale === 'binary' ? 1 : Number(val)); };
  return html`<div class="ob-stack">
    <form class="ob-row" onSubmit=${add} aria-label="Add a tie">
      <div class="ob-field"><label for="ob-pe-from">From</label>
        <select id="ob-pe-from" class="ob-select" value=${from} onChange=${e => setFrom(e.currentTarget.value)}>
          ${people.map(p => html`<option value=${p.id}>${p.label}</option>`)}</select></div>
      <div class="ob-field"><label for="ob-pe-to">To</label>
        <select id="ob-pe-to" class="ob-select" value=${to} onChange=${e => setTo(e.currentTarget.value)}>
          ${people.map(p => html`<option value=${p.id}>${p.label}</option>`)}</select></div>
      ${scale === 'valued' ? html`<div class="ob-field" style="width:5rem"><label for="ob-pe-val">Value</label>
        <input id="ob-pe-val" class="ob-input" type="number" min="1" max=${max} value=${val} onInput=${e => setVal(e.currentTarget.value)} /></div>` : null}
      <button class="ob-btn" type="submit" style="align-self:flex-end" disabled=${!from || from === to}>Add tie</button>
    </form>
    ${list.length ? html`<div class="ob-tablewrap"><table class="ob-table">
      <thead><tr><th>From</th><th>To</th>${scale === 'valued' ? html`<th class="num">Value</th>` : null}<th><span class="visually-hidden">Remove</span></th></tr></thead>
      <tbody>${list.map(t => html`<tr><td>${label.get(t.from)}</td><td>${label.get(t.to)}</td>
        ${scale === 'valued' ? html`<td class="num">${t.v}</td>` : null}
        <td><button type="button" class="ob-btn quiet sm" onClick=${() => onSet(t.from, t.to, 0)} aria-label=${`Remove ${label.get(t.from)} to ${label.get(t.to)}`}>Remove</button></td></tr>`)}
      </tbody></table></div>` : html`<p class="ob-note">No ties yet.</p>`}
  </div>`;
}
