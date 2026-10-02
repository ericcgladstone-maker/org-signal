I could not write `SCRATCH/ux/findings-priya.md`: the harness blocked writing a report file from this agent. The full findings are below instead, ready to save to that path. Screenshots (124) are in `SCRATCH/ux/priya/shots/`, downloads in `SCRATCH/ux/priya/dl/`, console capture in `SCRATCH/ux/priya/console.log`. SCRATCH is `/private/tmp/claude-501/-Users-ericgladstone-My-Drive--eric-c-gladstone-gmail-com--Projects-Software-Org-Signal/28c7544b-bf65-4ca4-99cc-4f4f74736ee5/scratchpad`. No app code was changed.

## Top 10 findings
1. **P1 (blocker):** the recovery check never appears. "Generate and analyze" jumps to Network and the Generate page forgets the run, so the panel is never shown (`src/ui/generate/index.js`).
2. **P2 (blocker):** the app's own Slack download (a zip inside a zip) shows as "NOT RECOGNISED" when loaded back in Data, even though the screen says to do exactly that. The inner zip loads fine.
3. **P3 (major):** Online public defaults to a "One person" export, so "Polarized" produces a 68-node star with no camps.
4. **P4 (major):** the planted groups and the detected groups are both called "Community", and nothing scores how well they agree.
5. **P5 (major):** Roster "Import CSV" turns the Google Form file into 28 "people" named after raw CSV lines, and says "28 people added."
6. **P6 (major):** the real survey import is five steps deep and makes her paste the roster again. The easy route (drop the file on Data) isn't mentioned in Build.
7. **P7 (major):** the same responses file gives different networks: 76 undirected ties via Roster, 118 directed ties via Data.
8. **P8 (major):** Groups opens on the "Responded" true/false field instead of the friendship communities.
9. **P9 (major):** the ego network is treated as directed (Reciprocity 0, CAUTION), the caveat says "Only messages the owner sent or received are present.", and that tooltip runs off the right edge of the screen.
10. **P10/P11/P12 (major):** at 1440x900 the canvas and "Analyze this network" are below the fold. Analysis views never say which dataset is loaded, and there's no single "start over". Network drops the drawn layout and leaves the bridge person (Eli) unlabelled.

---

# Org Signal v2 usability test: "Priya" (sociology methods instructor)

Tested 2026-10-02 against `app/` at http://localhost:8823/. Headless Chrome for Testing 153, 1440x900, puppeteer using visible controls only: clicks, drags, typing, keys the UI documents, file choosers. No app functions, app state, `?mock` or `?demo` were used. I read the source only afterwards, to tie findings to components.

## Summary

Drawing and the ego interview are the strongest parts. Priya can sketch a 10-person, two-clique network with a bridge, group it, lay it out and find the bridge. The ego interview runs cleanly end to end and exports Network Canvas-shaped CSVs. Live in class, it would still be awkward: the canvas and Analyze button sit below the fold, and Network drops the drawn layout and the bridge's label.

Three of her goals broke down:

1. **Task 5 can't be finished.** The promised recovery check never appears. The Online public default (one-person export) erases the polarization she asked for. Planted and detected groups share the name "Community".
2. **Task 4 works only by a hidden route, and the two routes disagree.** Roster "Import CSV" mangles the Google Form file. The real survey import is five steps deep. Dropping the file on Data works but gives a different network.
3. **Task 6 fails as instructed.** The Slack download is a zip inside a zip that Data reports as "NOT RECOGNISED".

There is also no lasting "what's loaded" indicator and no global start-over (task 7).

## Task results

| # | Task | Outcome | Key findings |
|---|------|---------|--------------|
| 1 | Draw a 10-person, two-group network with a bridge; snap, layout, group, analyze, find the bridge | Done, with friction | P10, P12, P21 |
| 2 | Undo a mistake, shortcuts, table editor | Done, with friction | P13 to P16 |
| 3 | Ego interview end to end, analyze, export NC files | Done, with friction | P9, P17 to P20 |
| 4 | Google Form responses as a roster survey; class network and groups | Done only via a hidden route; the two routes disagree | P5 to P8, P23 |
| 5 | Generate an online polarized network; read the recovery check | **Failed** | P1, P3, P4 |
| 6 | Download Slack native files and load them back | **Failed as instructed**; works only if she unzips first | P2, P37 |
| 7 | Know what is loaded; start over | Confusing | P11, P25 |

## Findings

Severity: **blocker** means she can't finish the goal; **major** means she needs outside help, gets a misleading result, or would stall in class; **minor** is friction she can work around; **polish** is cosmetic or wording.

### Blockers

**P1 · blocker · Generate/Network: the recovery check can't be reached**
- What happened: Generate promises a "recovery check". "Generate and analyze" then goes straight to Network. No view contains a recovery check, and going back to Generate shows only the form, with no "Run recovery check" button.
- Shots: 64, 66, 80.
- Cause: `src/ui/generate/index.js` keeps the last run in component state and shows the Recovery panel only while that state exists. Leaving the page wipes it.
- Fix: store the last run and recovery state with the app or dataset. Show a recovery banner or panel on Network whenever the loaded data has ground truth.

**P2 · blocker · Generate download → Data: the app's own export is not recognised**
- What happened: the panel says "synthetic-workplace-slack-seed1.zip: 1 files. Open it in Data, Import…". Data answers "⚠ NOT RECOGNISED No importer recognised this input…".
- The download wraps "Yarrowford Software Slack export Jan 6 2025 - Apr 5 2025.zip". That inner zip imports correctly.
- Shots: 72, 73b, 74, 75.
- Fix: download the Slack zip itself, and/or have Data unwrap a zip that contains a single zip.

### Major

**P3 · major · Generate: Online public defaults to a "One person" export**
- What happened: Polarized produced "68 people and 80 ties", a star around Mina Bergstrom, with modularity 0 and "1 communities".
- Shots: 62, 64.
- Fix: default to Everyone, and warn when the chosen export can't show the planted structure.

**P4 · major · Network/Groups: planted and detected groups share a name**
- What happened: the Colour by list reads "Community (5) | Community (4)…". "Community (4)" is the planted ground truth (Greenline supporters, Stonebridge supporters, Games, Science); "Community (5)" is the detected one. Nothing measures how well they agree, and the counts differ between views (Greenline 152 vs 151).
- Shots: 68b, 69, 70.
- Fix: rename it "Planted community (ground truth)", and add a detected-vs-planted cross-tab with an NMI score.

**P5 · major · Build > Roster: "Import CSV" mangles a Google Form file**
- What happened: the status said "28 people added.", and the rows were raw CSV lines, starting with the header.
- Shot: 45b.
- Cause: `src/ui/build/roster/People.js` `importFile` → `parseRosterText` falls back to one name per line.
- Fix: offer a column picker, and detect survey-shaped files and route them to the survey import.

**P6 · major · Build > Roster: survey import is buried and asks for the roster again**
- What happened: the path is Roster → paste 30 names → Relations → Collect ties → "Each member answers a survey" → Import responses CSV, even though her file already lists everyone. Dropping the file on Data works directly, but nothing in Build mentions it.
- Shots: 43, 44, 49, 57b.
- Fix: add "Import survey responses" on Roster step 1 and build the roster from the file's columns.

**P7 · major · Two routes give two class networks**
- What happened:
  - Roster route: 76 undirected ties, modularity 0.493, communities 12/10/8.
  - Data route: "118 declareds", directed, modularity 0.511, communities 11/10/9.
  - The Data route never offers or states the combine rule.
- Shots: 51, 52, 58b, 60.
- Fix: offer the same combine options, with the same default, on the Data route, and say which rule was used.

**P8 · major · Groups: defaults to "Responded (2)" (true/false)**
- What happened: the reading opens "Assortativity by responded is -0.0704…".
- Shots: 53, then 54b after switching.
- Cause: `src/ui/views/groups.js:32` picks the first attribute.
- Fix: default to detected communities or user-drawn groups, and hide bookkeeping fields.

**P9 · major · Network (ego data): wrong caveats**
- What happened: the header says "7 people and 8 ties, directed". Reciprocity "0 ⚠", average path length "1 ⚠". The tooltip says "Only messages the owner sent or received are present." and is cut off past the right edge.
- Shots: 40, 42.
- Cause: the caveat comes from `src/analysis/applicability.js:47`.
- Fix: write ego-specific caveats, treat alter-alter ties as undirected, and keep tooltips inside the screen.

**P10 · major · Build > Draw: key controls below the fold**
- What happened: at 1440x900 the canvas runs off the bottom of the screen, along with the zoom/Fit buttons and "Analyze this network". Fit and the 0 key fit the drawing to that over-tall canvas, so Jo stays cut off.
- Shots: 02, 12b, 20b.
- Fix: size the canvas to the viewport, and put Analyze in the toolbar.

**P11 · major · No lasting "what's loaded" indicator and no global start-over**
- What happened: the dataset name appears only in a dismissible toast. Build still shows the drawing while the analysis shows Slack data. Each builder has its own "New"; nothing clears everything.
- Shots: 77, 78b, 56b.
- Fix: a header chip such as "Analysing: X", a "Start over" control, and a "Not loaded" note on Build tabs.

**P12 · major · Network (drawn data): drawing not carried over**
- What happened: Network re-lays out the drawing, the default labels skip Eli (the bridge), and the default colours are detected communities rather than her drawn groups.
- Shots: 11 vs 13, 14.
- Fix: offer a "Drawn layout" option, colour by drawn group by default, and label every node in small networks.

### Minor

- **P13 · Table view:** no Undo/Redo buttons, and Cmd+Z after "Remove" does nothing. The canvas Undo does restore the node. Shots 24, 24b, 25b.
- **P14 · Build > Draw:** undo history and zoom reset after visiting another view. Shot 19.
- **P15 · Build > Draw:** pressing N drops the new node exactly on top of Eli, hiding his label. Shots 22, 22b.
- **P16 · Build > Draw:** new nodes don't start in rename mode, so every name needs an extra Enter. Shots 04, 05.
- **P17 · Ego progress:** "33% COMPLETE" on steps 1 to 3, then "81%" at Review with "18 of 18" answers and no explanation. Shots 26b, 28, 29, 38.
- **P18 · Ego, who knows whom:** "Add School" doesn't pre-tick the people whose How-met is School. The word "Remove" sits above the checkbox column and reads like "tick to remove". Shots 33, 34, 36.
- **P19 · Ego hull labels overlap:** "NEIGHBOURHOOD" is drawn over "WORK". Shots 36b, 37c.
- **P20 · Network tie counts disagree:** the header and the toast give different counts with no explanation (8 vs 9 ties; 392/7,758 vs 400/28876). Shots 40, 68.
- **P21 · People table:** 5 measure columns hidden off the right edge with no scrollbar. Shot 16.
- **P22 · People profile:** ranks don't show ties ("Closeness rank 1 of 10" when 4 people share the value). Shot 18.
- **P23 · Groups:** no member list per community, and clicking a row does nothing. Shots 54b, 55.
- **P24 · Labels overlap:** in Network, "Desmond Adeyemi" is drawn over "Guerrero"; in Draw, tie lines cross labels. Shots 68, 07.
- **P25 · Data:** "Load into analysis" stays on Data, while Build and Generate jump to Network. Shot 59.
- **P26 · Data import report:** workplace wording for a survey ("Events", "Messages with text", "Accounts marked as bots", "ties between alters…"). Shots 56b, 58b.
- **P27 · Roster review:** "RECIPROCATED 42" has no unit. Shot 51.
- **P28 · Shortcuts dialog:** title and Close button clipped under the sticky header. Shot 03.
- **P29 · Console error:** `[pageerror] Sigma: Container has no width…` while switching views. Logged in console.log at 19:04:31.
- **P37 · Native export:** no README or ground-truth file in the download, and the panel says "1 files". Shot 72, folder `dl/sl/`.

### Polish

- **P30 · Wording slips:** "76 declareds", "1 files", "1 communities", "read as UTC.tz-assumed".
- **P31 · Internal ids:** "draw:n987846954f" shown in the Network and People profiles. Shots 15b, 18.
- **P32 · Ungrouped and colours:** ungrouped shows as "No value" or a blank cell, and the drawn group colours (blue/orange) don't match the analysis colours (gold/teal). Shots 14, 16.
- **P33 · Mixing matrix:** column labels truncated to "CommunCommunCommun". Shot 54b.
- **P34 · Generate:** "One person's posts" is struck through with no reason given. Shot 61b.
- **P35 · Ego NC export:** the CSVs leave out the ego's name and the settings, and `sessionFinish` is blank. Files in `dl/nc/`.
- **P36 · Tooltips:** measure tooltip text is right-aligned. Shot 17b.

## What worked well

- **Landing page:** a clear Import / Build / Generate choice.
- **Drawing:** double-click to add, drag to connect, marquee select, snapping, and named group outlines that read well on a projector (shot 11). The shortcuts are documented in one dialog and work.
- **Table view:** a solid second way to edit the same drawing.
- **Ego interview:** names given under two questions merge, the setting-based who-knows-whom step works, and exceptions are labelled "added/removed by hand" (shot 37c). The Network Canvas export has the right files.
- **Survey import, once found:** it detects Google Forms, reports "27 of 30" and names who didn't respond, and explains the Union / Reciprocated / As reported choice clearly.
- **Explanations:** measure tooltips carry reliability notes, and the Groups "Reading" gives plain-prose comparisons against random rewiring.
- **Generate form:** the "What will be generated" summary updates as she chooses.
- **Methods & Export:** a wide range of formats.

## Harness notes

- Twice, a file chooser didn't open on the first click right after the automation reconnected. Both worked on retry, so I treated this as a harness race, not a finding.
- I did not test "Add to current data" or the Ask view (it needs an API key).