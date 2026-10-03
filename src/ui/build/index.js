// Build view: the ways to make a network by hand.
//
//   Draw        free-hand editor with snapping and layouts (draw/)
//   Ego         name generators, interpreters, alter-alter ties (ego/)
//   Roster      bounded network from a roster, single informant or many (roster/)
//   Perceived   cognitive social structures from several informants (perceived/)
//   Paste       a list of ties typed or pasted as text (paste/)
//
// Every builder ends in store.actions.loadDataset via service.handOff.
// ui-core mounts <BuildView/>; it takes no required props. `tab` may be
// passed to open a given builder.
//
// Worked examples (src/builders/examples.js) open from a link:
//   #build?example=<id>      works with the shell's router as it is
//   #build/example/<id>      the same, for a router that passes #build/... here
// The Draw or Ego tab opens with the example loaded (asking first when it
// would replace work), and the address goes back to #build.

import { html, useState, useEffect } from '../../../vendor/preact.js';
import { ensureBuildCss, Tabs, storage, ViewHeader } from './shared.js';
import { DrawEditor } from './draw/index.js';
import { EgoBuilder } from './ego/index.js';
import { RosterBuilder } from './roster/index.js';
import { PerceivedBuilder } from './perceived/index.js';
import { PasteTies } from './paste/index.js';
import { exampleById } from '../../builders/examples.js';
import { exampleFromHash } from './hash.js';

export { exampleFromHash };

const TABS = [
  { id: 'draw', label: 'Draw', title: 'Draw a network', lede: 'Place people and ties on a canvas. Snap to a grid or to each other, apply a layout to all or part of the drawing, then analyze it like any other network.', C: DrawEditor },
  { id: 'ego', label: 'Ego network', title: 'Ego network interview', lede: 'One respondent names the people around them, describes each, then says which of those people know each other. The result is a personal network from one point of view.', C: EgoBuilder },
  { id: 'roster', label: 'Roster', title: 'Bounded network from a roster', lede: 'List everyone in the group, then record who is tied to whom: by one informant in a grid, or by collecting each member\'s own answers with a survey form.', C: RosterBuilder },
  { id: 'perceived', label: 'Perceived', title: 'Perceived networks', lede: 'Several people (informants) each report the whole network of their group as they see it, including ties between other people (Krackhardt\'s cognitive social structures). Compare their views, combine them into a consensus (the ties most informants agree on), and see who perceives the network most accurately.', C: PerceivedBuilder },
  { id: 'paste', label: 'Paste ties', title: 'Paste a list of ties', lede: 'Type or paste one tie per line. The preview shows how each line is read and flags the ones that are not.', C: PasteTies },
];

const TAB_KEY = 'orgsignal.build.tab';

export function BuildView({ tab: initialTab } = {}) {
  ensureBuildCss();
  const linked = () => (typeof location === 'undefined' ? null : exampleFromHash(location.hash));
  const [tab, setTab] = useState(() => { const id = linked(); return id ? (exampleById(id).kind === 'ego' ? 'ego' : 'draw') : initialTab || storage.get(TAB_KEY, 'draw'); });
  const [example, setExample] = useState(null); // { id, nonce } for the Draw or Ego tab
  useEffect(() => { storage.set(TAB_KEY, tab); }, [tab]);
  useEffect(() => {
    const take = () => {
      const id = linked();
      if (!id) return;
      setTab(exampleById(id).kind === 'ego' ? 'ego' : 'draw');
      setExample({ id, nonce: Date.now() + Math.random() });
      try { history.replaceState(null, '', `${location.pathname}${location.search}#build`); } catch { /* address bar left as is */ }
    };
    take();
    window.addEventListener('hashchange', take);
    return () => window.removeEventListener('hashchange', take);
  }, []);
  const cur = TABS.find(t => t.id === tab) || TABS[0];
  const C = cur.C;
  return html`<section class="ob ob-view">
    <${ViewHeader} title="Build" intro="Make a network by hand: draw it, interview one person about the people around them, record a roster, collect perceived networks, or paste a list of ties." />
    <${Tabs} tabs=${TABS} value=${cur.id} onChange=${setTab} label="Ways to build a network" />
    <div role="tabpanel" class="ob-stack" id=${'obpanel-' + cur.id} aria-labelledby=${'obtab-' + cur.id}>
      <div class="ob-subhead">
        <h2 class="ob-h">${cur.title}</h2>
        <p class="ob-text">${cur.lede}</p>
      </div>
      <${C} example=${example && (exampleById(example.id).kind === 'ego') === (cur.id === 'ego') ? example : null} />
    </div>
  </section>`;
}

export default BuildView;
