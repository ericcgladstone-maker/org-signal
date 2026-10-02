// Keyboard shortcuts for the draw editor, and the overlay that lists them.
// The list is the single source: the editor's key handler and this overlay
// both read SHORTCUTS' wording, so the help never drifts from behaviour.

import { html, useEffect, useRef } from '../../../../vendor/preact.js';

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? 'Cmd' : 'Ctrl';

export const SHORTCUTS = [
  ['Canvas', [
    ['V', 'Select mode'], ['B', 'Add-person mode (click to place)'], ['C', 'Connect mode (drag from one person to another, or click two people)'], ['H', 'Pan mode'],
    ['Space + drag', 'Pan in any mode'], ['Wheel or pinch', 'Zoom around the pointer'], ['+ / -', 'Zoom in / out'], ['0', 'Fit the drawing to the view'],
  ]],
  ['People and ties', [
    ['N', 'New person near the center of the view, ready to name'], ['Tab / Shift+Tab', 'Move to the next / previous person and select them (leaves the canvas after the last)'],
    ['Space', 'Keep the selection while moving with Tab; again to add or remove the focused person'], ['Enter or F2', 'Rename the focused or selected person'],
    ['E', 'Connect the selected people in the order selected (or the selected person to the focused one)'],
    ['Arrow keys', 'Nudge the selection by one grid step (Shift: five); with nothing selected, pan'],
    ['Delete / Backspace', 'Delete the selection'], [`${mod}+A`, 'Select everyone'], ['Esc', 'Clear selection, cancel, close'],
  ]],
  ['Edit', [
    [`${mod}+Z`, 'Undo'], [`${mod}+Shift+Z or ${mod}+Y`, 'Redo'], [`${mod}+C / ${mod}+V`, 'Copy / paste the selection'], [`${mod}+D`, 'Duplicate the selection'],
    ['G', 'Snap to grid on or off'], ['L', 'Go to the layout menu'], ['T', 'Switch between the canvas and the table'], ['?', 'This help'],
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
  return html`<div class="dialog-backdrop" onClick=${e => e.target === e.currentTarget && onClose()}>
    <div class="dialog ob ob-draw-help" role="dialog" aria-modal="true" aria-labelledby="ob-draw-help-title">
      <div class="dialog__head"><h2 id="ob-draw-help-title">Keyboard shortcuts</h2>
        <button type="button" class="btn btn--sm" ref=${btn} onClick=${onClose}>Close</button></div>
      <p class="ob-note">Every action is also a button in the toolbar or the panel beside the canvas, and the table edits the same drawing as rows. Double-click the canvas to add a person.</p>
      ${SHORTCUTS.map(([title, rows]) => html`<section class="ob-stack" style="gap:.4rem">
        <h4 class="label">${title}</h4>
        <dl class="ob-keys">${rows.map(([k, d]) => html`<dt><kbd>${k}</kbd></dt><dd>${d}</dd>`)}</dl>
      </section>`)}
    </div>
  </div>`;
}
