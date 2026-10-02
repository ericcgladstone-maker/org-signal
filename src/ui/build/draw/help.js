// Keyboard shortcuts for the draw editor, and the overlay that lists them.
// The list is the single source: the editor's key handler and this overlay
// both read SHORTCUTS' wording, so the help never drifts from behaviour.

import { html, useEffect, useRef } from '../../../../vendor/preact.js';

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? 'Cmd' : 'Ctrl';

export const SHORTCUTS = [
  ['Canvas', [
    ['V', 'Select mode'], ['B', 'Add-node mode (click to place)'], ['C', 'Connect mode (drag from one node to another, or click two nodes)'], ['H', 'Pan mode'],
    ['Space + drag', 'Pan in any mode'], ['Wheel or pinch', 'Zoom around the pointer'], ['+ / -', 'Zoom in / out'], ['0', 'Fit the drawing to the view'],
  ]],
  ['Nodes and ties', [
    ['N', 'New node at the centre of the view'], ['Tab / Shift+Tab', 'Move to the next / previous node and select it (leaves the canvas after the last)'],
    ['Space', 'Keep the selection while moving with Tab; again to add or remove the focused node'], ['Enter or F2', 'Rename the focused or selected node'],
    ['E', 'Connect the selected nodes in the order selected (or the selected node to the focused one)'],
    ['Arrow keys', 'Nudge the selection by one grid step (Shift: five); with nothing selected, pan'],
    ['Delete / Backspace', 'Delete the selection'], [`${mod}+A`, 'Select all nodes'], ['Esc', 'Clear selection, cancel, close'],
  ]],
  ['Edit', [
    [`${mod}+Z`, 'Undo'], [`${mod}+Shift+Z or ${mod}+Y`, 'Redo'], [`${mod}+C / ${mod}+V`, 'Copy / paste the selection'], [`${mod}+D`, 'Duplicate the selection'],
    ['G', 'Snap to grid on or off'], ['L', 'Go to the layout menu'], ['T', 'Switch between canvas and table view'], ['?', 'This help'],
  ]],
];

export function HelpOverlay({ onClose }) {
  const btn = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    btn.current?.focus();
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, []);
  return html`<div class="ob-overlay" onClick=${e => e.target === e.currentTarget && onClose()}>
    <div class="ob-dialog ob-draw-help" role="dialog" aria-modal="true" aria-labelledby="ob-draw-help-title">
      <div class="ob-row"><h3 id="ob-draw-help-title">Keyboard shortcuts</h3><span class="ob-spacer"></span>
        <button type="button" class="ob-btn sm" ref=${btn} onClick=${onClose}>Close</button></div>
      <p class="ob-note">Every action is also a button in the toolbar or the panel beside the canvas, and the table view edits the same drawing as rows.</p>
      ${SHORTCUTS.map(([title, rows]) => html`<section class="ob-stack" style="gap:.4rem">
        <span class="ob-meta">${title}</span>
        <dl class="ob-keys">${rows.map(([k, d]) => html`<dt><kbd>${k}</kbd></dt><dd>${d}</dd>`)}</dl>
      </section>`)}
    </div>
  </div>`;
}
