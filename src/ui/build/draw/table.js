// Table editor: the same drawing as two tables (nodes, ties), for anyone who
// would rather not use the canvas, including screen-reader users. Every edit
// is the same command the canvas uses, so undo/redo and autosave cover both.

import { html, useState } from '../../../../vendor/preact.js';
import * as D from '../../../builders/draw.js';
import { uid } from '../../../builders/common.js';

export function TableEditor({ doc, apply, edgeDefaults }) {
  const [newTie, setNewTie] = useState({ source: '', target: '' });
  const label = id => D.nodeById(doc, id)?.label ?? id;
  const addNode = () => {
    // New rows go below the drawing's lowest node so the canvas stays tidy.
    const b = D.bounds(doc.nodes);
    apply(d => D.addNode(d, { id: uid('n'), x: b ? b.x + (doc.nodes.length % 6) * 60 : 0, y: b ? b.y + b.h + 80 : 0 }), 'Add node');
  };
  const addTie = () => {
    if (!newTie.source || !newTie.target || newTie.source === newTie.target) return;
    apply(d => D.addEdge(d, { source: newTie.source, target: newTie.target, type: edgeDefaults.type, directed: edgeDefaults.directed }), 'Add tie');
    setNewTie({ source: newTie.source, target: '' });
  };
  const nodeOptions = html`<option value=""></option>${doc.nodes.map(n => html`<option value=${n.id}>${n.label}</option>`)}`;
  return html`<div class="ob-stack ob-drawtable">
    <section class="ob-stack" aria-labelledby="ob-tbl-nodes">
      <div class="ob-row"><h3 id="ob-tbl-nodes">Nodes</h3><span class="ob-note">${doc.nodes.length}</span><span class="ob-spacer"></span>
        <button type="button" class="ob-btn sm" onClick=${addNode}>Add node</button></div>
      <div class="ob-tablewrap"><table class="ob-table">
        <thead><tr><th scope="col">Label</th><th scope="col">Group</th>${doc.attrColumns.map(c => html`<th scope="col">${c.key}</th>`)}<th scope="col"><span class="visually-hidden">Remove</span></th></tr></thead>
        <tbody>${doc.nodes.map((n, i) => html`<tr key=${n.id}>
          <td><input class="ob-input" aria-label=${`Label, row ${i + 1}`} value=${n.label} onChange=${e => apply(d => D.updateNode(d, n.id, { label: e.currentTarget.value.trim() || n.label }), 'Rename')} /></td>
          <td><select class="ob-select" aria-label=${`Group of ${n.label}`} value=${n.group || ''} onChange=${e => apply(d => D.setGroup(d, [n.id], e.currentTarget.value || null), 'Set group')}>
            <option value="">None</option>${doc.groups.map(g => html`<option value=${g.id}>${g.name}</option>`)}</select></td>
          ${doc.attrColumns.map(c => html`<td><input class="ob-input" aria-label=${`${c.key} of ${n.label}`} type=${c.type === 'number' || c.type === 'ordinal' ? 'number' : 'text'} step="any"
            value=${n.attrs[c.key] ?? ''} onChange=${e => apply(d => D.setNodeAttr(d, n.id, c.key, e.currentTarget.value), 'Edit attribute')} /></td>`)}
          <td><button type="button" class="ob-btn sm quiet" aria-label=${`Remove ${n.label}`} onClick=${() => apply(d => D.removeNodes(d, [n.id]), 'Delete node')}>Remove</button></td>
        </tr>`)}</tbody>
      </table></div>
      ${doc.nodes.length ? null : html`<p class="ob-empty">No nodes yet. Add one with the button above.</p>`}
    </section>

    <section class="ob-stack" aria-labelledby="ob-tbl-ties">
      <div class="ob-row"><h3 id="ob-tbl-ties">Ties</h3><span class="ob-note">${doc.edges.length}</span></div>
      <div class="ob-tablewrap"><table class="ob-table">
        <thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Type</th><th scope="col" class="num">Weight</th><th scope="col">Directed</th><th scope="col"><span class="visually-hidden">Remove</span></th></tr></thead>
        <tbody>${doc.edges.map(e => html`<tr key=${e.id}>
          <td>${label(e.source)}</td><td>${label(e.target)}</td>
          <td><select class="ob-select" aria-label=${`Type of tie ${label(e.source)} to ${label(e.target)}`} value=${e.type} onChange=${ev => apply(d => D.updateEdge(d, e.id, { type: ev.currentTarget.value }), 'Tie type')}>
            ${doc.edgeTypes.map(t => html`<option value=${t}>${t}</option>`)}</select></td>
          <td class="num"><input class="ob-input" style="width:5rem" type="number" min="0" step="any" aria-label=${`Weight of tie ${label(e.source)} to ${label(e.target)}`} value=${e.weight}
            onChange=${ev => apply(d => D.updateEdge(d, e.id, { weight: ev.currentTarget.value }), 'Tie weight')} /></td>
          <td><input type="checkbox" aria-label=${`Directed, ${label(e.source)} to ${label(e.target)}`} checked=${e.directed} onChange=${ev => apply(d => D.updateEdge(d, e.id, { directed: ev.currentTarget.checked }), 'Tie direction')} /></td>
          <td><button type="button" class="ob-btn sm quiet" aria-label=${`Remove tie ${label(e.source)} to ${label(e.target)}`} onClick=${() => apply(d => D.removeEdges(d, [e.id]), 'Delete tie')}>Remove</button></td>
        </tr>`)}</tbody>
      </table></div>
      <fieldset class="ob-fieldset"><legend>Add a tie</legend>
        <div class="ob-row">
          <select class="ob-select" style="width:auto;max-width:12rem" aria-label="From" value=${newTie.source} onChange=${e => setNewTie({ ...newTie, source: e.currentTarget.value })}>${nodeOptions}</select>
          <span class="ob-note">to</span>
          <select class="ob-select" style="width:auto;max-width:12rem" aria-label="To" value=${newTie.target} onChange=${e => setNewTie({ ...newTie, target: e.currentTarget.value })}>${nodeOptions}</select>
          <button type="button" class="ob-btn sm" disabled=${!newTie.source || !newTie.target || newTie.source === newTie.target} onClick=${addTie}>Add tie</button>
        </div>
        <p class="ob-note">New ties use the type "${edgeDefaults.type}"${edgeDefaults.directed ? ' and are directed' : ''}; change either in the panel with nothing selected, or per row above.</p>
      </fieldset>
    </section>
  </div>`;
}
