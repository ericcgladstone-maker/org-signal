// Ego network builder: a six-step interview (name generators, interpreters,
// names, descriptions, who knows whom, review). The session autosaves to
// localStorage when it can and can be saved or resumed as JSON.

import { html, useState, useEffect } from '../../../../vendor/preact.js';
import * as E from '../../../builders/ego.js';
import { Steps, storage } from '../shared.js';
import { GeneratorsStep, InterpretersStep } from './setup.js';
import { NamesStep, DescribeStep } from './collect.js';
import { TiesStep } from './ties.js';
import { ReviewStep } from './review.js';

const KEY = 'orgsignal.build.ego.session';

function load() {
  const saved = storage.get(KEY, null);
  if (saved) { try { return E.sessionFromJSON(saved); } catch { /* corrupt draft: start fresh */ } }
  let s = E.newSession();
  s = E.addGenerator(s, { preset: 'discuss' });
  s = E.addInterpreter(s, { preset: 'relationship' });
  s = E.addInterpreter(s, { preset: 'closeness' });
  return s;
}

const VIEWS = { generators: GeneratorsStep, interpreters: InterpretersStep, names: NamesStep, describe: DescribeStep, ties: TiesStep, review: ReviewStep };

export function EgoBuilder() {
  const [s, setS] = useState(load);
  useEffect(() => { storage.set(KEY, s); }, [s]);
  const update = fn => setS(prev => fn(prev));
  const go = step => {
    setS(prev => ({ ...prev, step }));
    // Move focus to the step heading so keyboard and screen-reader users land in the new step.
    requestAnimationFrame(() => document.getElementById('ego-step-title')?.focus());
  };
  const p = E.progress(s);
  const i = Math.max(0, E.STEPS.findIndex(x => x.id === s.step));
  const done = E.STEPS.filter(x => p.steps[x.id] >= 1).map(x => x.id);
  const V = VIEWS[s.step] || GeneratorsStep;
  const reset = () => {
    if (!confirm('Start a new interview? The current one is discarded unless you saved it.')) return;
    storage.remove(KEY);
    setS(load());
  };
  return html`<div class="ob-stack ego">
    <div class="ob-row">
      <span class="meta">Step ${i + 1} of ${E.STEPS.length}</span>
      <span class="ob-spacer"></span>
      <button type="button" class="tlink tlink--quiet" onClick=${reset}>New interview</button>
    </div>
    <${Steps} steps=${E.STEPS} value=${s.step} onChange=${go} done=${done} />
    <h3 id="ego-step-title" tabindex="-1" class="ob-h ego-step-title">${i + 1}. ${E.STEPS[i]?.label}</h3>
    <${V} s=${s} update=${update} replace=${next => setS(next)} />
    <div class="ob-navrow">
      ${i > 0 ? html`<button type="button" class="tlink tlink--quiet" onClick=${() => go(E.STEPS[i - 1].id)}>Back: ${E.STEPS[i - 1].label}</button>` : html`<span></span>`}
      ${i < E.STEPS.length - 1 ? html`<button type="button" class="btn btn--primary" onClick=${() => go(E.STEPS[i + 1].id)}>Next: ${E.STEPS[i + 1].label}</button>` : null}
    </div>
  </div>`;
}

export default EgoBuilder;
