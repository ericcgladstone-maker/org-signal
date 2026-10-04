# Org Signal

**Open it: <https://orgsignal.graystoneindustries.co>**. It runs in the browser, with nothing to install and no account.

Org Signal is a browser-based tool for teaching network analysis that is also built to support research-grade work.

Students can begin with networks they make themselves: drawing one by hand, interviewing themselves about their own ego network, or surveying a class through a shared link. From there, they can work with synthetic organizations and online communities where the underlying structure is known in advance. That matters pedagogically because there is something to recover. Students can see whether a measure actually finds the pattern planted in the data rather than simply learning how to interpret whatever number appears on the screen.

The same tool can then be used with empirical data, including exports from Slack, email, calendars, messaging and social platforms, standard network files, and survey data.

Org Signal explains measures where they appear: what they mean, whether they make sense for the data currently loaded, and how much of an observed result might be explained by chance or resampling. Tie construction is treated as a choice rather than a given. Users can change how ties are defined and trace any tie back to the events that produced it. The point is to make visible something network analysis often hides: a network is constructed from observations and decisions. It is not simply sitting in the data waiting to be found.

Built by [Eric Gladstone](https://graystoneindustries.co).

## Start here

| If you want to | Go to |
|---|---|
| Draw a small network and see what the measures say | **Build > Draw**, or a worked example in **Learn** |
| Map your own personal network | **Build > Ego network** (an interview: who you know, how, and who among them know each other) |
| Survey a class or team | **Build > Roster**: share a link, collect answers, combine them into one network |
| Work with a network where the right answer is known | **Generate**: a synthetic organization or community with planted structure, then its recovery check |
| Study a famous network | **Data** or **Learn > Classic datasets** (below) |
| Analyze your own exports | **Data**: drop files or a folder; the import review lists what these records support and the limits of these records |
| Look up a term | **Learn**, or any dotted-underlined word in the app |

### For instructors

- **Networks 101.** Twelve assignments for a first course, from drawing a first network to a final project ([`docs/ux/networks101-assignments.md`](docs/ux/networks101-assignments.md)). **Learn > Find it in the app** points students to where each answer is found.
- **Class surveys.** Roster surveys go out as links. Each student answers in their own browser, sends back a response file, and the instructor combines them. No server holds the responses.
- **Classic datasets.** Eleven published networks load with one click. Each has a card with what the original study found, a documented result and reference values, a suggested assignment, the citation and the license:
  - Zachary's karate club
  - Padgett's Florentine families
  - Krackhardt's high-tech managers, with all 21 managers' perceptions for the Perceived builder
  - Sampson's monastery
  - Kapferer's tailor shop
  - Newcomb's fraternity
  - the bank wiring room
  - Davis's Southern Women (two-mode)
  - the Les Misérables co-appearances
  - Lusseau's dolphins
  - Enron email, core employees, headers only

  Sources, conversions and checks are in [`docs/datasets.md`](docs/datasets.md).
- **Interpretive notes.** An "Interpretation" note (Definition, Scale, In this network, Caution) appears under numbers throughout. The "Interpretive notes: on/off" switch in the masthead turns them off once they are no longer needed.

## What it does

- **Builds by hand:**
  - a drawing editor with snapping and layouts
  - an ego-network interview
  - roster surveys, filled in by one informant or by each member
  - perceived networks (cognitive social structures), with consensus and informant accuracy
  - pasted tie lists
- **Generates** synthetic worlds with planted structure (brokers, silos, reorganizations, departures, communities, diffusion), each with people and records that fit its context:
  - **Contexts:** workplace, online, professional, personal, community, survey.
  - **Output:** each world is observed through a chosen medium and written out in that medium's real export format.
  - **Recovery check:** reports whether the analysis found what was planted.
- **Imports:**
  - **Workplace:** Slack, Microsoft Teams, email (mbox, eml, Gmail Takeout), calendars (ics).
  - **Personal and social archives:** X, Bluesky, Mastodon, Threads, LinkedIn, WhatsApp, iMessage, Telegram, Messenger, Instagram, Discord, Reddit.
  - **Network files:** GraphML, GEXF, GML, Pajek, UCINET DL, Gephi tables.
  - **Surveys:** Network Canvas and roster surveys.
  - **Anything else:** any CSV of who-to-whom.
  - Formats are documented in [`docs/formats/`](docs/formats/).
- **Measures:**
  - **Tie rules** you can see and change: replies, mentions, recipients, co-presence, declared ties, reactions, broadcast cutoffs, weights and filters on tie fields.
  - **Node and whole-network measures:** contacts (degree), betweenness, closeness, eigenvector, PageRank, constraint and effective size, plus whole-network and ego measures.
  - **Groups:** communities, E-I index and mixing.
  - **Two-mode networks:** measures and projections.
  - **Comparison with random networks** (degree-preserving rewiring).
  - **Rank intervals** by resampling.
  - **Change over time:** shift detection and before/after tests.
  - **Content:** tone, keywords, topics and the diffusion of terms.
- **Interprets (optional).** With your own Anthropic, OpenAI or Gemini key, Ask answers questions and writes reports. It may cite only numbers the engine computed, and any number it states without a source is flagged.
- **Exports:**
  - metric tables
  - network files that open in Gephi, networkx and igraph
  - figures (SVG, PNG)
  - a summary report
  - a methods appendix that records every analysis run and its settings

## Your data

- Everything runs in your browser. Files you load are read on your machine and are not uploaded anywhere.
- Ask is off unless you add an API key. When it is on, your browser sends requests directly to the provider you chose (Anthropic, OpenAI or Google), under that provider's terms. It never sends your files. It does send:
  - the results of the analyses it runs
  - names, unless "Replace names with codes" is on
  - short excerpts of messages when it looks up the evidence behind a tie

  Ask shows the full list before you use it. The key is kept only for the session unless you ask the browser to remember it.
- Work in Build is saved in this browser's storage only. Clearing site data, or switching browser or device, loses it. Download a project file or the network to keep it.
- Exports leave out contact details (email addresses, handles, platform ids) by default.
- Org Signal describes network structure and reported ties. It does not evaluate individuals.

## How the numbers are checked

- **Measures** are compared with networkx 3.2.1, exact linear algebra and textbook closed forms.
  - About 21 million comparisons were run over two seeds, with 0 unexplained failures.
  - These covered thousands of random and structured graphs, two-mode networks, the content measures, and round trips through every network export format.
- **Statistics are calibrated by simulation:**
  - The tests against random networks give about 5% false positives at p = 0.05.
  - Bootstrap rank intervals cover the true rank about 95% of the time for strength and 93% for betweenness.
- **The pipeline is checked end to end:** generated worlds are written in their native export formats, read back through the real importers, and compared event by event with what was generated.
- **The classic datasets** reproduce their published counts and known values.
- **What isn't covered:** this checks the software, not whether a dataset measures what you think it does. That part is the analyst's job, and the import report and tie rules are there to help.

Full report: [`docs/accuracy.md`](docs/accuracy.md).

## Known limitations

This is a new tool. These are the limits we know of. Please report others (see below).

**Not yet tested in real use**
- **Browsers.** Automated tests run in Chrome. Safari and Firefox have not yet been tested systematically, and the network map uses WebGL, where browsers differ most.
- **Real use.** Usability testing so far used simulated students and instructors working through the Networks 101 assignments. It has not yet been used in a real class.
- **Ask with real keys.** It has been tested end to end with an offline stand-in provider, not yet against each provider's live API.
- **Real exports.** Importers were built from each platform's published format documentation and public sample files. Microsoft Teams and LinkedIn exports have not yet been tested on real user exports. Platforms change their exports without notice, and the import report says when a file was not understood.

**Measurement**
- **Approximate measures above 3,000 people.** Betweenness and closeness are estimated by sampling and labelled approximate.
  - They work well when a few hubs dominate.
  - When values are close together, only 40-80% of the top 10 are the same people as with the exact method.
  - On sparse, directed, tree-like networks the estimates are unreliable.
- **Intervals for degree are too narrow.** Resampling cannot invent ties that were never observed, so rank intervals for contacts (degree) are too narrow. Read them as a lower bound on the uncertainty (about 88% coverage instead of 95%).
- **Shift detection at low counts.** With few events per time window, the shift detector misses small changes. Its thresholds are tuned to keep false alarms rare, so a "no shift found" is weak evidence.
- **Personal exports.** One person's export shows only that person's ties. The app says so and steers to ego measures, but whole-network measures computed on such data describe the export, not the person's social world.

**Synthetic data (Generate)**
- The recovery check works well for workplaces and online communities. It is weaker in some cases, and the check itself reports when recovery is poor:
  - **Professional (LinkedIn-style) worlds:** planted communities are not recovered.
  - **Discord and calendar worlds:** the observed network matches the true one less closely.
  - **Calendar worlds:** planted silos and reorganizations are missed in half or more of runs.
  - **Bot campaigns** on X, Bluesky and Mastodon are missed in about half of runs.
- Generated people, messages and HR records are fictional. They are realistic in structure, not in individual detail.

**Data and ethics**
- **Enron.** The Enron email subset contains real people's workplace communications, released without their consent. Only who wrote to whom and when is included, with no text or subjects. Forensic analyses published in 2026 question whether some mailboxes contain forged messages. Use it to learn methods, not to make claims about individuals.
- **Licenses.** The classic datasets from the UCINET and Pajek collections carry no stated license. They are included with citations as facts from the published studies. See [`docs/datasets.md`](docs/datasets.md).

**Practical**
- **Outlook files.** PST, OST and MSG files are recognized but cannot be read in the browser yet. Convert them to mbox first; the import report says how.
- **Large files.** Very large exports (several GB, or millions of messages) are limited by the browser's memory. Imports run in the background and can be cancelled.
- **No accounts or sync.** Nothing is stored on a server, which also means no backup.

## Reporting problems

Open an issue at <https://github.com/ericcgladstone-maker/org-signal/issues>, or write through [graystoneindustries.co](https://graystoneindustries.co). It helps to include:
- what you loaded (the kind of data, not the data itself)
- what you expected
- what you saw
- your browser

## Citing

> Gladstone, E. (2026). *Org Signal: Browser-based network analysis for teaching and research* (Version 2.0) [Software]. https://github.com/ericcgladstone-maker/org-signal

The methods appendix (**Methods & Export**) records the settings and analyses behind a result, for a paper's methods section.

## For developers

```bash
node tools/serve.mjs . 8787   # serves with the production security headers; open http://localhost:8787
```

There's no build step. Third-party libraries are vendored in `vendor/` (see `vendor/VERSIONS.txt` and `vendor/licenses/`).

```bash
ORG_SIGNAL_SKIP_PERF=1 node --test 'test/**/*.test.js'   # unit, integration and dataset tests
node --test 'test/accuracy/*.test.js'                     # accuracy regressions
QA_URL=http://localhost:8787 node test/ui-core/qa.mjs     # browser QA (needs Chromium and puppeteer-core)
node test/ui-build/qa.mjs --port=8787
node tools/accuracy/campaign.mjs                          # the full accuracy campaign (needs python3 with networkx)
```

| Path | Contents |
|---|---|
| `src/core` | Data model, zip reader, file sets, import pipeline, identity matching, import report, classic datasets |
| `src/importers`, `src/exporters` | One module per format |
| `src/analysis` | Network construction, measures, uncertainty, time, content, two-mode; worker engine |
| `src/generator` | Synthetic worlds, media, observation, native writers, recovery check |
| `src/builders`, `src/ui` | Hand builders and the interface |
| `src/llm` | Provider adapters, analyst, reports, methods appendix |
| `data/classic`, `tools/datasets` | Classic datasets and the scripts that build them from the public sources |
| `docs/` | Architecture (`CONTRACTS.md`), module APIs, format specs, accuracy, datasets, user-testing reports |

**Known console error, by decision (2026-10-04):** Cloudflare Web Analytics is enabled on the graystoneindustries.co zone, so Cloudflare injects its beacon (`static.cloudflareinsights.com/beacon.min.js`) into this app's pages. The Content Security Policy in `_headers` blocks it, which leaves one "violates the following Content Security Policy directive" error in the console and sends nothing. This is deliberate. Do not allow the script in `script-src` (or loosen `script-src` in a way that admits it) unless the owner decides to collect page views: it would contradict "nothing leaves the browser". Browser QA treats that one message as known.

To deploy, run `tools/stage.sh`. It copies an allowlist of served files to `_deploy/`, with security headers including a Content Security Policy. Then `npx wrangler deploy` publishes it to Cloudflare Workers Static Assets.
