I reviewed every view and sub-view at 1440×900 and 390×844, with nothing loaded, with the sample organization, with the Draw example, with pasted ties (a path, a short chain, and lines with errors), and with an unreadable import. I also walked the ego interview through all 6 steps. I did not change any app code.

Screenshots are in `S = /private/tmp/claude-501/-Users-ericgladstone-My-Drive--eric-c-gladstone-gmail-com--Projects-Software-Org-Signal/28c7544b-bf65-4ca4-99cc-4f4f74736ee5/scratchpad/ux/learnability/shots/` (scripts `s1`–`s9.mjs` are in the folder above it). The server is still running on port 8885.

## (a) Findings, most important first

**L1 · blocker (teaching) · Build > Draw example.** "Example: two teams and a broker" teaches the wrong lesson.
- The broker, Hal Novak, scores betweenness 0.000 and closeness 0.000. His two "advice" ties point outward, so no shortest route passes through him.
- The real bridge is the plain tie between Cai Mora (0.429) and Gus Romero (0.381).
- Because two ties are directed, the whole network becomes directed. Build says "11 ties"; Network says "8 people and 20 ties (directed…)". That breaks A1(c), "how many ties".
- Shots: `S/23-draw-example-d.png`, `S/25-draw-analyzed-d.png`, `S/26c-tooltip-click-d.png`.
- Proposal: make the example undirected, with Hal as the only route between the two teams, and check its values in a test. Warn in Draw when mixing directed and undirected ties will double the count.

**L2 · major · first screen (Data, nothing loaded).** The page starts with "drop your exports". Build and Generate, where weeks 1–6 begin, are around y≈900 at 1440 and about 2,000px down on a phone. "Load a sample organization" is a link inside a sentence, and there is no "Start here".
- Shots: `S/01-landing-d.png`, `S/01-landing-full-d.png`, `S/01-landing-m.png`.
- Proposal: see the start page in (b).

**L3 · major · navigation.** There are 10 flat labels in the order Data, analysis views, then Generate and Build. So two of the three ways to get a network come after the views that need one. The phone menu has no grouping and no descriptions, and Content and Time stay live links for data with no text or no dates.
- Shots: `S/32-menu-m.png`, `S/01-landing-d.png`.

**L4 · major · empty states (Network, People, Groups, Content, Time).** All five show the same "No network yet" with no intro, so a student can't tell what Groups or Time is *for*. Ask and Methods do have intros.
- Shots: `S/02-empty-{network,people,groups,content,time}-d.png`.
- Source: `NeedsData` in `src/ui/components/common.js`.

**L5 · major · Network map, drawn layout.** On an 8-person map, the group names "Engineering" and "Product" sit on a member's node and replace that person's name: Dee Patel and Eli Brandt are unlabeled.
- Shot: `S/25-draw-analyzed-d.png`.
- Source: `groupAnchors` in `src/ui/lib/labels.js`.
- Proposal: when the layout is as drawn, or there are 30 people or fewer, put group names on the hull edge and always keep person names.

**L6 · major · colors change meaning between views.** Network colors by Department (Sales is ochre). People swatches color by Community, so Odile Moreau and Fatima Gallagher (both Sales) are indigo and Ines Chaudhry (Sales) is ochre. People has no legend saying which.
- Shots: `S/03-sample-network-d.png` vs `S/03-sample-people-full-d.png`.
- Proposal: People swatches follow Network's "Color by" choice, with a one-line key ("Swatch: department").

**L7 · major · People on a phone.** At 390 only Name and Community are visible. No measure is on screen and nothing hints that the table scrolls sideways, so "who has the most ties?" can't be answered.
- Shot: `S/03-sample-people-m.png`.
- Proposal: below 600px, a "Measure: [select]" control plus a ranked two-column list (name, value).

**L8 · major · no direct answers.** "Who is most central" means choosing among 18 measures. Network has no "who stands out" block, and People sorts by Contacts without saying so.
- Shots: `S/03-sample-network-full-d.png`, `S/03-sample-people-full-d.png`.
- Proposal: a "Who stands out" block (in (b) item 7).

**L9 · major · statistical readings put numbers before the verdict, without a plain reading.**
- Groups: "assortativity is 0.697 … Rewired networks with the same degrees give -0.0153 (z 55, p = 0.005)… degree sequence".
- Groups E-I: "random expectation 0.659" for an observed -0.505, with no "far more inward than chance".
- Network: "(random 0.19, sd 0.0162; z 50, p = 0.010)".
- p = 0.005 with 200 replicates and p = 0.010 with 100 are the smallest p each test can give, and nothing says so. The two views also use different replicate counts.
- Shots: `S/03-sample-groups-full-d.png`, `S/04-net-random-full.png`.

**L10 · major · rank stability.** "rank 1 to 2 of 96 (shared by 2 people) · 95% resampling interval rank 1; in the top 10 in 100% of resamples" looks contradictory to a novice, and "rank stability" is never explained in plain words.
- Shot: `S/05-people-stability-full.png`.
- Source: `src/ui/views/people.js:240, 323`.

**L11 · major · recovery check jargon.** NMI, ARI, precision@k, Spearman rho, "compound", "share of true ties seen 1". It also has leftover copy slips: "2025-02-24", "within 1 days", "randomisation".
- Shot: `S/09-generate-loaded-full.png`.

**L12 · major · ego interview.**
- Step 2, "Name interpreters", shows a student the instrument editor: Variable, Answer type, "value = label" text boxes, "Weight ego's ties by".
- The step names are the jargon itself ("Name generators", "Name interpreters"), and "ego" is never explained.
- Review doesn't show effective size or constraint, which A3 asks for. The student has to Analyze, then find themselves in People.
- The default "Important matters" cap of 5 conflicts with "8–15 people".
- Shots: `S/40-ego-step1.png`, `S/40-ego-step2.png`, `S/40-ego-step6.png`.

**L13 · minor · Generate after a run.** The form resets to Distributed and 120 people, while the recovery check below describes the loaded bridge-dependent world of 96. It reads as if the form describes what is loaded.
- Shot: `S/09-generate-loaded-full.png`.

**L14 · minor · "seed" has two meanings.** It is the random seed in Generate and in every "Basis: … seed 1" line, and also the first adopter in diffusion ("The seed is the first user", "adopters from seed Fatima Gallagher").

**L15 · minor · "Start over" has two meanings.** In the masthead it clears the loaded data. In Perceived and in the respondent form it clears a draft. Other builders say "New drawing", "New interview", "New roster".
- Shot: `S/27-build-Perceived-d.png`.

**L16 · minor · the same thing has several names.**
- People says "Contacts" (37 for the top person) and "Total ties (in + out)". Time's shifts and before/after say "Degree" (a mean of 22.5).
- The tab is "Affect", the chart is "Mean tone", the glossary says "Sentiment (compound)".
- The sample's department named "People" collides with the People view: "People 22", "People writes more positively than Sales".
- The import report says 97 people; Network says 96 (the bot is left out) with no note.
- Shots: `S/03-sample-content-full-d.png`, `S/03-sample-data-full-d.png`.

**L17 · minor · explanations ignore context and need hover.**
- Table-header tips are hover or focus only, on a 12px (i).
- On a 6-person pasted network they talk about the "broadcast cutoff" and "Approximate above 3,000 people… Spearman 0.90–0.99".
- Shot: `S/26c-tooltip-click-d.png`.

**L18 · minor · view intros state caveats, not purpose.**
- Time: "Each window's network is built from that window's events with the current construction settings…".
- Content: "Measured from message text on this device…".
- Groups' question intro is the model to copy.

**L19 · minor · construction settings (needed for A8).** "Count of evidence / Log of count / Present or absent", "Broadcast cutoff (recipients)", "isolates", "Until (exclusive)". The weight boxes have only a hidden (screen-reader) label.
- Shot: `S/06-drawer.png`.

**L20 · minor · Draw help.** "?" opens only keyboard shortcuts; there is no 4-line "how to draw". "Load example" sits inside the File menu (the empty-canvas hint does point to it).
- Shots: `S/21-draw-help-d.png`, `S/20-draw-empty-m.png`.

**L21 · minor · Content and Time jargon.**
- Content: "TF-IDF", "latent Dirichlet allocation", "The null shuffles adoption times…". Diffusion opens on an empty box, and the beginner path ("Find new words automatically") is the secondary link.
- Time: "robust z … median and MAD … |z| ≥ 3.5", a "Z" column, "paired sign-flip permutation test", "SIZE (DZ)".
- Shots: `S/07-content-Diffusion-full.png`, `S/03-sample-time-full-d.png`, `S/08-time-compare-full.png`.

**L22 · polish · reading level and density.**
- Intros and basis lines often run 30–45 words a sentence; the Ask intro and Methods "Project file" are long.
- On phones the main action often sits far below the fold (Generate's at about 2,400px).
- The profile leads with a raw id, "SLACK:U03GZ3360JH".
- Shots: `S/02-empty-generate-m.png`, `S/05-people-profile-full.png`.

## (b) A beginner-support system

**1. Navigation (`src/ui/actions.js` VIEWS, `src/ui/app.js` masthead and mobile menu, `assets/app.css`).**
- Reorder into the workflow, keeping the existing thin separators: **Get a network:** Data · Build · Generate | **Explore:** Network · People · Groups · Content · Time | **Report:** Methods & Export · Ask | **Learn**.
- Keep the labels. Add a `desc` to each VIEWS entry, shown in the phone menu (under small mono section labels) and as the `title` on desktop. For example, Network "The map and whole-network numbers"; Groups "Do ties stay inside groups?"; Time "How the network changed".
- When a view can't apply to the loaded data (`applicability`), keep the link but add muted "no text" or "no dates" text.

**2. Start page (`src/ui/views/data.js`, empty state).** Lead with three equal choices before the drop zone:
- "Draw or type a small network" → Build
- "Explore a sample organization" → loads it
- "Analyze your own exports" → scrolls to import

Then one line: "New to network analysis? Learn the ideas →".

**3. Learn view, a new `#learn` (`src/ui/views/learn.js`, new; data from `src/analysis/glossary.js`, the same source the API docs are generated from).**
- **Concepts:** every glossary entry, plus missing terms (tie, directed, weight, ego, alter, name generator, roster, community vs planted group, null model, z, p, rank interval, seed). Each gets its meaning, "where you see it", how to read it, and a tiny static diagram for 5 core ideas (degree, betweenness, closeness, clustering, constraint). Each has an anchor, `#learn/betweenness`.
- **Find it in the app:** a task index ("Most ties → People, sort by Contacts"; "Who bridges groups → People, Betweenness"; "Do groups mix? → Groups, Reading").
- **Worked examples:** loadable networks (next item).

**4. Worked examples (`src/ui/build/draw/example.js` becomes a small library; the File menu becomes "Start from an example").**
- Two cliques and a broker (undirected; fixes L1).
- Path and star (A2).
- Ring vs ring with shortcuts.
- Class friendships with majors (homophily).
- A 10-person ego network (A3).

Each carries a one-line "What to look for".

**5. Terms (new `Term` component in `src/ui/components/common.js`).** `<Term k="betweenness">` gives a dotted underline that opens on **click or tap** (not only hover), showing the meaning plus "More in Learn →". `metricTip` filters the reliability notes by `applicability` and network size (fixes L17).

**6. Explanations switch (`src/ui/store.js` `ui.explain`; `localStorage` holds this one preference, wrapped in try/catch).**
- A quiet masthead link, "Explanations: on / off", on by default for first visits.
- On: shows the "How to read this" blocks, the gloss row under People's column headers, and term-first glosses.
- The row glosses already required by decision 3 stay on regardless.

**7. "How to read this" and answer blocks.** These would use a new `HowToRead` disclosure styled with `.reading` (a `.reading` rule exists already).
- Each one says what the number means, what counts as big or small, one example sentence from the live data, and one common mistake.
- Where they go:
  - `network.js`: whole network vs random
  - `people.js`: ranking table, rank stability
  - `groups.js`: Reading, mixing matrix
  - `time.js`: shifts, before/after
  - `content.js`: tone, topics, diffusion
  - `src/ui/generate/index.js`: recovery check
- Add a **"Who stands out"** block on Network: "Most contacts: Yosef Westergaard (37) · Most often on the route between others: Yolanda Achterberg · Closest to everyone: …", each linking to People sorted by that measure.
- Every statistic follows the same pattern: verdict, then a plain-language number, then the details in the Basis line.
- When p is at its smallest possible value, say "none of the 200 random networks came this close".

**8. Purposeful empty states.** `NeedsData({ title, purpose, shows })` in `common.js` states the view's question and 2–3 things it will show, and adds "or explore the sample" with its loader.

**9. Ego for students (`src/ui/build/ego/setup.js`, `review.js`).**
- Steps become "Who comes to mind (name generators)" and "About each person (name interpreters)".
- Step 2 collapses to "Use the standard questions" with an "Edit questions" disclosure.
- Review shows size, density, effective size and constraint, each with a gloss and a reading such as "low constraint: your contacts mostly don't know each other (brokering)".

**10. Wording fixes.**
- Masthead "Start over" → "Clear loaded data"; builders use "New …".
- The diffusion "seed" → "first user".
- One measure name everywhere: "Contacts" or "Total ties", never bare "Degree".
- The tab "Affect" → "Tone".
- Rename the sample's "People" department (generator vocabulary in `src/generator/**`).
- Data's report line: "97 people (1 bot left out of the network)".

**Before → after copy (real on-screen text):**

1. **Time intro.**
   - Before: "Each window's network is built from that window's events with the current construction settings, so a tie in one week means the same as a tie in the whole network."
   - After: "How did the network change? Each week (or day, or month) gets its own network, built with the same rules as the whole one."
2. **Content intro.**
   - Before: "Measured from message text on this device; nothing is sent anywhere."
   - After: "What did people write about, and in what tone? Measured from message text on this device; nothing is sent anywhere."
3. **Groups Reading.**
   - Before: "People tie mostly within their department: assortativity is 0.697 … Rewired networks with the same degrees give -0.0153 (z 55, p = 0.005)…"
   - After: "People mostly tie within their own department, far more than chance would give. Assortativity 0.70 (0 = no preference, 1 = only within); random networks with the same number of ties per person give about 0. None of 200 random networks came close (p < 0.01)."
4. **Network vs random.**
   - Before: "Higher than random networks with the same degrees (random 0.19, sd 0.0162; z 50, p = 0.010)."
   - After: "Much higher than chance: random networks where everyone keeps their number of ties average 0.19; none of 100 reached 1."
5. **Rank stability.**
   - Before: "95% resampling interval rank 1; in the top 10 in 100% of resamples"
   - After: "Settled: re-sampling the messages 100 times, this person stays at rank 1 and is always in the top 10."
6. **Recovery check.**
   - Before: "Detected communities match the planted departments with NMI 0.946 and ARI 0.944 (1 = identical, 0 = unrelated)."
   - After: "The communities found almost exactly match the planted departments (agreement 0.95 out of 1; NMI 0.946, ARI 0.944)."
7. **Ego step titles.**
   - Before: "1. Name generators", "2. Name interpreters"
   - After: "1. Who comes to mind (name generators)", "2. About each person (name interpreters)"
8. **Empty state (Groups).**
   - Before: "No network yet. Import data, build a network by hand, or generate a synthetic one."
   - After: "Groups answers: do ties stay inside departments, teams or communities, or cross them? Load a network first: draw one, try the sample, or import data."
9. **Diffusion.**
   - Before: "The null shuffles adoption times among the same adopters (200 replicates)…"
   - After: "To check it isn't coincidence, we shuffle who started using the word when (200 times) and compare."
10. **Detected shifts basis.**
    - Before: "Basis: robust z of each window against the median and MAD of the 8 preceding windows, flagged at |z| ≥ 3.5…"
    - After: "Flagged when a week is far outside the previous 8 weeks (robust z ≥ 3.5; median and MAD)."

## (c) Keep exactly as it is

- **Groups' question intro:** "Do ties stay inside groups or cross them?"
- **Glosses always shown** under whole-network measures and profile measures.
- **The verdict sentences** in Detected shifts ("Odile Moreau shows the largest change…") and Before/after ("…a moderate change but more than chance would give").
- **Paste ties:** live preview with per-line errors that tell you what to fix.
- **Data:** the "can / cannot show" lists, and the unrecognized-file message that names the next step.
- **Empty states** for "This data has no message text" and "No timestamps".
- **Generate:** the "What will be generated" summary and its described choices.
- **The privacy line**, the "Analyzing:" chip with Start over, and Ask's "What leaves this computer".
- **The map note:** "read structure from the measures, not the picture".
- **Draw:** text-labeled modes, the empty-canvas hint, and legends with counts.
- **The calm tone:** no gamification.

Not covered: the full Roster and Perceived flows (only their first steps) and Ask with a key. Simulated students are doing the assignment tasks separately, so I only checked those flows' entry points.