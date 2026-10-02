// Mounts for the views owned by ui-build: BuildView (src/ui/build/index.js)
// and GenerateView (src/ui/generate/index.js). They are imported lazily so a
// missing or broken module only affects its own view, and they hand results
// back through store.actions.loadDataset.

import { html, useState, useEffect } from '../../../vendor/preact.js';
import { ViewHead, Loading, Unavailable } from '../components/common.js';

function Mount({ title, intro, load }) {
  const [state, setState] = useState({ C: null, error: null });
  useEffect(() => {
    let live = true;
    load().then(C => { if (live) setState({ C, error: C ? null : new Error('missing export') }); },
      error => { console.info('[org-signal] view not loaded:', error.message); if (live) setState({ C: null, error }); });
    return () => { live = false; };
  }, []);
  if (state.error) {
    return html`<div class="view view--col">
      <${ViewHead} title=${title} intro=${intro} />
      <${Unavailable}>${title} is not available in this build yet. Everything else works; import data from the Data view in the meantime.</${Unavailable}>
    </div>`;
  }
  if (!state.C) return html`<div class="view"><${ViewHead} title=${title} hiddenTitle=${true} /><${Loading}>Opening ${title.toLowerCase()}</${Loading}></div>`;
  const C = state.C;
  // The mounted view carries its own visible heading; ours is for focus and
  // screen readers only, so the page still has one h1.
  return html`<div class="view view--bare"><${ViewHead} title=${title} hiddenTitle=${true} /><${C} /></div>`;
}

export function BuildMount() {
  return html`<${Mount} title="Build" intro="Draw a network, run an ego-network interview, record a roster or collect perceived networks."
    load=${() => import('../build/index.js').then(m => m.BuildView || m.default)} />`;
}

export function GenerateMount() {
  return html`<${Mount} title="Generate" intro="Generate a synthetic organization or community with planted structure, then analyze it or download it as native export files."
    load=${() => import('../generate/index.js').then(m => m.GenerateView || m.default)} />`;
}
