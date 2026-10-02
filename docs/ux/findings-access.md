I couldn't write `SCRATCH/ux/findings-access.md`: the harness blocks subagents from writing report files. The full findings are below instead, ready to save under that name. Everything else is in `SCRATCH/ux/access/`: screenshots in `shots/`, the test scripts (`*.mjs`), the error-test files in `errfiles/`, and raw data (`contrast.json`, `sr-summary.json`, `ax-*.json`, `perf-5k.json`, `perf-50k.json`). SCRATCH is `/private/tmp/claude-501/-Users-ericgladstone-My-Drive--eric-c-gladstone-gmail-com--Projects-Software-Org-Signal/28c7544b-bf65-4ca4-99cc-4f4f74736ee5/scratchpad`. No app code was changed.

# Org Signal v2: accessibility, mobile and performance findings

## Summary
The basics are strong:
- **Keyboard and focus:** there is a skip link, and focus moves to the heading when you switch views. The focus ring is visible everywhere (10.3:1). The settings drawer is a proper modal that holds focus and closes on Escape. The draw editor can be used fully from the keyboard and announces each action.
- **Contrast and layout:** no text fails AA contrast. No view scrolls sideways at 390, 820 or 640 px (640 px is 200% zoom at 1280).
- **Performance:** analysis runs off the main thread. A 5,000-person workplace is usable in about 8 s, with no main-thread task longer than 470 ms. Panning and table scrolling both run at 60 fps.

There are 0 blockers, 7 major, 13 minor and 6 polish findings.

## Findings

**A1 Major, Network: tie evidence can't be reached by keyboard.**
- The map only responds to + / − / 0 / Escape; arrow keys do nothing.
- After picking a person with the search box (that part works), the side panel lists no ties. 80 Tab presses never reached a tie or evidence control.
- The panel's instructions are mouse-only ("Shift-click…", "Click a highlighted tie").
- The only keyboard route to evidence is in the People view, through the profile.
- Evidence: `shots/kb-network-selected.png`.
- Fix: list the selected person's ties as buttons that open the evidence panel, and add arrow-key panning (WCAG 2.1.1).

**A2 Major, People: the keyboard row cursor is invisible.**
- The active row is marked only by a 2px bar on its left edge. The table's own 2px focus outline sits exactly on top of it.
- After two ArrowDowns, row 3 was active but looked like every other row.
- Evidence: `shots/kb-people-grid-focus-crop.png`.
- Fix: give the focused row a background tint (WCAG 2.4.7).

**A3 Major, People: buttons are nested inside buttons in the table header.**
- 16 header cells put the "what it means" button inside the sort button.
- Pressing Enter on "Strength: what it means" also sorted the table (top row changed from Noor Uchenna to Bodhi Sato).
- `aria-sort="desc"` is set on a button, where it isn't valid.
- Fix: make the two buttons siblings inside the header cell (WCAG 4.1.2).

**A4 Major, Network and People: communities can't be told apart by colour-blind users.**
- I simulated the palette for colour blindness. Under deuteranopia, Community 4 and Community 6 differ by ΔE 2.6, which looks identical. Community 3 and Community 7 differ by 4.8.
- Under protanopia, 3 and 7 differ by 7.8. Under tritanopia, 1 and 5 differ by 5.8.
- The palette was only checked for neighbouring pairs, and the map shows community by colour alone.
- Evidence: `shots/network-deuteranopia-sim.png`, script `cvd.py`.
- Fix: retune the colours and add a second cue such as outline or shape (WCAG 1.4.1).

**A5 Major, global: the progress announcement floods screen readers.**
- During the real Slack import, the polite status region changed about every 55 ms ("50 of 11864 day files", "150 of…"), more than 200 updates.
- That region is only created when a job starts, so its first message is often missed.
- Progress numbers are unformatted ("16916/1691607").
- Fix: keep the region on the page permanently, announce only phase changes or every 10–25%, and format the numbers (WCAG 4.1.3).

**A6 Major, Generate: 50,000 people ends in a raw memory error.**
- The size warning before running is good, and Cancel works.
- At about 28 s it fails with: "Failed to execute 'postMessage' on 'DedicatedWorkerGlobalScope': Data cannot be cloned, out of memory." The message appears in the side panel only, with no next step.
- The page did not freeze. Reproduced twice.
- Evidence: `shots/perf-50k-after.png`.
- Fix: replace it with a plain-language message that suggests a smaller size or downloading the native files.

**A7 Major, Time and Groups: charts have no text alternative.**
- The 7 Time charts are exposed only by a title ("Events", "Line chart" and so on).
- The Groups mixing matrix hides its 80 cell values from screen readers, and there is no table version.
- Fix: add a short summary and a show-as-table option, and render the matrix as a real table (WCAG 1.1.1, 1.3.1).

**A8 Minor: focus falls back to the page body after several actions.**
- This happens after loading the sample (the user also stays on the Data view), opening tie evidence, pressing T in the draw editor, and "Load into analysis".
- Fix: move focus to the relevant heading or button each time (WCAG 2.4.3).

**A9 Minor, Data: empty or garbage files load into analysis.**
- A CSV with only headers, and a CSV of binary junk, both reach "Load into analysis" with that button enabled. The review card still claims the data "can show structure of the whole group".
- After loading, the views report "0 people and 0 ties", "Nobody matches the filter", and "splits into 0 communities…not clearly above random".
- Evidence: `shots/err-import-garbage.csv.png`, `shots/err-empty-*.png`.
- Fix: block or warn when an input yields 0 events, and show proper empty states.

**A10 Minor, Data: messages for unsupported or empty files are generic.**
- 0-byte files and a PDF both get the same "No importer recognised…" text. It doesn't say the file is empty or that PDFs aren't supported.
- The "NOT RECOGNISED" status isn't announced to screen readers.
- Import stays enabled when nothing can be imported, and pressing it produces a near-duplicate error.
- Corrupt zip messages are clear, and Clear recovers.

**A11 Minor: notices auto-dismiss and can cover controls.**
- Errors disappear after 12 s, info after 5 s, warnings after 9 s, with no pause on hover or focus (`src/ui/actions.js:54`).
- The fixed notice stack covered Construction settings and Export SVG/PNG while they had focus, and covers the description at 200% zoom.
- Fix: keep errors until dismissed and pause timers on hover or focus (WCAG 2.2.1, 2.4.11).

**A12 Minor: touch targets are small on phone and tablet.**
- People sort headers are 27×14 px. "What it means" buttons are 14–22 px tall. Generate radios are 16×16. Build "Zoom out" is 24×28.
- 33 controls in People and 18 in Network are below the 24 px minimum (WCAG 2.5.8).
- People copy says "Hover a measure…", which doesn't work on touch.

**A13 Minor, Network on phone: the map captures swipes.**
- The map takes 62% of the screen height and blocks touch scrolling. A vertical swipe on it does not scroll the page.
- Tapping a node does select it.

**A14 Minor, Network: reduced-motion setting is ignored.**
- With reduced motion turned on, the select fly-to animates for about 400 ms and zoom for 200–300 ms (`network.js:347`, `:378–389`).
- The draw editor already respects the setting.

**A15 Minor, Content and Data: tabs ignore arrow keys.**
- They are marked up as tabs, but arrow keys do nothing and every tab is a separate Tab stop.

**A16 Minor:** the page title is "Org Signal" on every view (WCAG 2.4.2).

**A17 Minor, Network, People and Data: side-panel sections aren't headings.**
- "Whole network", "Colour", "Show ties", "Profile", "Measures" and "Evidence for this tie" are styled paragraphs. Network and People have only an `h1`.

**A18 Minor, 5,000 people: long waits with little feedback.**
- Groups took 27 s with only "Group null model" and no percentage; the view showed nothing meanwhile.
- Content took 44 s with raw counts as progress.
- No main-thread blocking; Cancel was available.
- Fix: show the descriptive table first, then fill in the statistics.

**A19 Minor, People:** it takes 62 Tab presses from the table to the first tie-evidence button in the profile.

**A20 Minor, CSV column mapper:** two different dropdowns are both named "Each row is".

**A21 Polish:** placeholders in Generate's advanced fields and the Build inspector are 3.52:1 contrast, and the Generate ones hold the default values.

**A22 Polish:** the draw canvas focus ring is 1px at 45% opacity (3.08:1). Every other control uses 2px solid.

**A23 Polish, Time:** the "Formed" and "Dissolved" end labels overlap, and the x-axis repeats month names ("Jan Jan Feb Feb…").

**A24 Polish, Network:** labels overlap ("Ines ChaNils Sandoval") and run off the right edge on phone.

**A25 Polish, Groups:** matrix values are 10 px text (contrast passes, minimum 4.97:1).

**A26 Polish:** buttons default to `type="submit"`.

## Performance at 5,000 people (Slack, light text)

| Measure | Result |
|---|---|
| Usable Network view | 8.1 s |
| Main-thread long tasks | 3, total 750 ms, longest 467 ms |
| Pan and zoom | 60 fps |
| People view open | 258 ms (virtualised) |
| People table scroll | 60 fps |
| Sort 5,000 rows | 74 ms |
| Time view | 2.3 s |
| Groups view | 27 s |
| Content view | 44 s |
| Memory after analysis | about 220 MB |
| Cancel | available on every long job |
| Real Slack zip | detection 10.3 s, import 18.2 s, load 1.8 s |

Frame rates come from headless Chrome, so treat them as relative.

## What worked well
- **Navigation:** skip link, focus to the heading on view change, and the current view marked in the nav.
- **Settings drawer:** holds focus, closes on Escape, returns focus, and every control is labelled.
- **Draw editor:** complete keyboard model with spoken feedback, and a well-labelled table editor.
- **Search box and tooltips:** the network search follows the standard combobox pattern. Tooltips open on focus and close on Escape.
- **No keyboard traps** in any view.
- **Contrast:** no text fails AA apart from the placeholders (A21) and disabled controls, which are exempt.
- **Small screens:** no sideways scrolling at any size tested. The phone menu and drawer work. Tapping a row on phone scrolls to the profile.
- **Large networks:** the app warns about size before generating, and draws a simplified map but says so.
- **Corrupt zips:** clear error messages, and Clear gets you back to the start.

## Top 10 findings
1. **A1 Major:** tie evidence can't be reached by keyboard from the Network view; the instructions are mouse-only.
2. **A2 Major:** the People table's keyboard row cursor is invisible, hidden under the table's own focus outline.
3. **A3 Major:** People header nests buttons inside buttons, so pressing "Strength: what it means" also sorts the table.
4. **A4 Major:** under deuteranopia Community 4 and Community 6 look identical (ΔE 2.6), and 3 and 7 nearly so (4.8); the map uses colour alone.
5. **A5 Major:** the progress announcement updates about every 55 ms during import (more than 200 updates), flooding screen readers.
6. **A6 Major:** 50,000 people fails after about 28 s with a raw "postMessage… out of memory" message and no next step (no freeze).
7. **A7 Major:** Time charts and the Groups mixing matrix give screen readers only a title; the 80 matrix values are hidden.
8. **A9 Minor:** header-only or garbage CSVs load into analysis and the views report "0 communities, not above random" as if it were a result.
9. **A11 Minor:** error notices vanish after 12 s and the notice stack can cover focused header buttons.
10. **A12 Minor:** touch targets as small as 27×14 px (sort headers) and 16×16 (radios); 33 controls in People are under 24 px.