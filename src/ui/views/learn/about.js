// About Org Signal, in Learn: what it is for, how the numbers are checked,
// what happens to your data, and the known limitations. The same content as
// README.md ("Your data", "How the numbers are checked", "Known
// limitations"); change both together.

import { html } from '../../../../vendor/preact.js';
import { store } from '../../store.js';

const REPO = 'https://github.com/ericcgladstone-maker/org-signal';

// Opens Learn at the About section (from the Data start page). Learn loads
// on demand, so this waits (up to 3 s) for the section to exist.
export function openAbout() {
  store.actions.setView('learn', { focus: false });
  const t0 = performance.now();
  const go = () => {
    const el = document.getElementById('learn-about');
    if (el) { el.scrollIntoView({ block: 'start' }); el.querySelector('h2')?.focus({ preventScroll: true }); }
    else if (performance.now() - t0 < 3000) requestAnimationFrame(go);
  };
  requestAnimationFrame(go);
}

const LIMITS = [
  ['Not yet tested in real use', [
    'Automated tests run in Chrome. Safari and Firefox have not yet been tested systematically, and the network map uses WebGL, where browsers differ most.',
    'Usability testing so far used simulated students and instructors working through the Networks 101 assignments. It has not yet been used in a real class.',
    'Ask has been tested end to end with an offline stand-in, not yet against each provider\'s live service.',
    'Importers were built from each platform\'s published format documentation and public sample files. Microsoft Teams and LinkedIn exports have not yet been tested on real user exports. Platforms change their exports without notice, and the import report says when a file was not understood.',
  ]],
  ['Measurement', [
    'Above 3,000 people, betweenness and closeness are estimated by sampling and labelled approximate. They work well when a few hubs dominate. When values are close together, only 40-80% of the top 10 are the same people as with the exact method, and on sparse, directed, tree-like networks the estimates are unreliable.',
    'Resampling cannot invent ties that were never observed, so rank intervals for contacts (degree) are too narrow: about 88% coverage instead of 95%. Read them as a lower bound on the uncertainty.',
    'With few events per time window, the shift detector misses small changes. Its thresholds are tuned to keep false alarms rare, so "no shift found" is weak evidence.',
    'One person\'s export shows only that person\'s ties. Whole-network measures on such data describe the export, not the person\'s social world; use the ego measures.',
  ]],
  ['Synthetic data (Generate)', [
    'The recovery check works well for workplaces and online communities. It is weaker for professional (LinkedIn-style) worlds, where planted communities are not recovered; for Discord and calendar worlds, where the observed network matches the true one less closely; for calendar worlds, where planted silos and reorganizations are missed in half or more of runs; and for bot campaigns on X, Bluesky and Mastodon, missed in about half of runs. The check itself says when recovery is poor.',
    'Generated people, messages and HR records are fictional: realistic in structure, not in individual detail.',
  ]],
  ['Data and ethics', [
    'The Enron email subset contains real people\'s workplace communications, released without their consent. Only who wrote to whom and when is included, with no text or subjects. Forensic analyses published in 2026 question whether some mailboxes contain forged messages. Use it to learn methods, not to make claims about individuals.',
    'The classic datasets from the UCINET and Pajek collections carry no stated license. They are included with citations as facts from the published studies.',
  ]],
  ['Practical', [
    'Outlook PST, OST and MSG files are recognized but cannot be read in the browser yet. Convert them to mbox first; the import report says how.',
    'Very large exports (several GB, or millions of messages) are limited by the browser\'s memory. Imports run in the background and can be cancelled.',
    'There are no accounts and nothing is stored on a server, which also means no backup. Work in Build is saved in this browser only; download a project file to keep it.',
  ]],
];

export function About() {
  return html`<section class="section learn__part learn-about" id="learn-about" aria-labelledby="learn-about-h">
    <h2 id="learn-about-h" tabindex="-1">About Org Signal and its limits</h2>
    <p class="prose">Org Signal is a browser-based tool for teaching network analysis that is also built to support research-grade work. Students begin with networks they make themselves, then work with synthetic organizations and communities whose structure is known in advance, so there is something to recover, and then with real data. Tie construction is treated as a choice: a network is built from observations and decisions, not found sitting in the data. Built by <a class="linkish" href="https://graystoneindustries.co" target="_blank" rel="noopener">Eric Gladstone</a>.</p>

    <h3 class="dv-h3">Your data</h3>
    <ul class="prose learn-about__list">
      <li>Everything runs in this browser. Files you load are read on your machine and are not uploaded anywhere.</li>
      <li>Ask is off unless you add an API key. Then your browser sends requests directly to the provider you chose. It never sends your files. It does send the results of the analyses it runs, names (unless "Replace names with codes" is on), and short excerpts of messages when it looks up the evidence behind a tie. Ask shows the full list before you use it.</li>
      <li>Exports leave out contact details (email addresses, handles, platform ids) by default.</li>
      <li>Org Signal describes network structure and reported ties. It does not evaluate individuals.</li>
    </ul>

    <h3 class="dv-h3">How the numbers are checked</h3>
    <ul class="prose learn-about__list">
      <li>Every measure is compared with networkx and exact calculations: about 21 million comparisons over thousands of graphs, with no unexplained failures.</li>
      <li>The tests against random networks give about 5% false positives at p = 0.05. Rank intervals cover the true rank about 95% of the time for strength and 93% for betweenness.</li>
      <li>Generated worlds are written in their real export formats, read back through the importers, and compared event by event with what was generated. The classic datasets reproduce their published values.</li>
      <li>This checks the software, not whether a dataset measures what you think it does. That part is the analyst's job; the import report and the tie rules are there to help.</li>
    </ul>

    <h3 class="dv-h3">Known limitations</h3>
    <p class="prose">This is a new tool. These are the limits known so far.</p>
    ${LIMITS.map(([title, items]) => html`<div class="learn-about__group">
      <p class="label">${title}</p>
      <ul class="prose learn-about__list">${items.map(t => html`<li>${t}</li>`)}</ul>
    </div>`)}

    <h3 class="dv-h3">Report a problem, cite, read the source</h3>
    <ul class="prose learn-about__list">
      <li>Report a problem or a limit not listed here: <a class="linkish" href=${REPO + '/issues'} target="_blank" rel="noopener">GitHub issues</a>. Say what you loaded (the kind of data, not the data itself), what you expected, what you saw, and your browser.</li>
      <li>Cite: Gladstone, E. (2026). <em>Org Signal: browser-based network analysis for teaching and research</em> (Version 2.0) [Software]. ${REPO}. The methods appendix (Methods & Export) records the settings behind a result.</li>
      <li>Source code, documentation and the full accuracy report: <a class="linkish" href=${REPO + '#readme'} target="_blank" rel="noopener">README on GitHub</a>.</li>
    </ul>
  </section>`;
}
