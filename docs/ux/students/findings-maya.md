I ran all three assignments as Maya through the visible interface only, and her app values matched networkx in every case. The real problems are explanation and data entry. In A2 she will report the right app numbers but can't explain why they differ from her hand values. In A11 the perceived-networks builder treats friendship as one-way, which can reverse the answer to "who perceives best" and makes the consensus network's centrality numbers misleading.

**Caveats on the run:**
- Another agent's session was sharing my Chrome debugging port, and both browsers were killed partway through A11. I moved to a dedicated browser (port 9471, profile2) and re-entered the A11 reports.
- The perceived-network ties lost in that kill are not an app bug. A normal page reload kept all 12 ties (`50-after-reload.png`).
- Drawing names came out as "Untitled drawingPath A-F" and "Untitled drawingStar". I traced that to my automated select-all, not the app, so it is not reported.
- No console errors were captured: the logger saw nothing during A1/A2, and a fresh-tab sweep of every view found none.
- I didn't fully emulate a phone (the mobile setting hung the browser), so the 390px checks used a plain 390px-wide window.

## A1: Your first network
**Completed, correct.** About 25 actions and no blockers. I drew 8 Romeo and Juliet characters with 11 ties: Romeo with Benvolio, Mercutio, Lady Montague and Juliet; Juliet with Nurse and Capulet; the rest within each family. Adding people by click-and-type and connecting by click-click was easy to pick up.

What Maya would submit:
- **(a) Most ties:** Romeo, with 4. The People table calls this "Contacts", while the assignment says "degree".
- **(b) Who connects the two groups:** Romeo, betweenness 0.595, with Juliet close behind at 0.571. My hand check agrees: 12.5/21 and 12/21.
- **(c) Number of ties:** 11, from the Network header "8 people and 11 ties".
- **Screenshot:** the PNG export, `dl/network.png`.

Where she hesitated:
- **Missing "Degree" column.** The table has no column named degree, and the footnote says "in and out are the same as degree" without showing it.
- **Warning icons.** Yellow CAUTION triangles on Betweenness, Closeness and PageRank alarmed her.
- **Number badges.** Badges "1" and "2" on Benvolio and Juliet looked like rankings.

## A2: Measures by hand vs. by machine
**Completed.** About 40 actions. Her app values are right, but her explanation would be partly wrong.

| | Hand (Maya) | App | networkx |
|---|---|---|---|
| Path, betweenness A/B/C | 0 / 4 / 6 | 0.000 / 0.400 / 0.600 | normalized 0 / 0.4 / 0.6 ✓ |
| Path, closeness A/B/C | textbook (n−1)/Σd: 0.333 / 0.455 / 0.556 | 0.457 / 0.617 / 0.667 | harmonic ÷ (n−1): 0.457 / 0.617 / 0.667 ✓ |
| Star, hub betweenness / closeness | 10 / 1.0 | 1 / 1.00 | 1.0 / 1.0 ✓ |
| Star, leaf betweenness / closeness | 0 / 0.556 | 0 / 0.60 | 0 / 0.6 ✓ |
| Degree | 1,2,2,2,2,1 and 5,1,… | "Contacts" (Degree only via Columns) | ✓ |

- **Betweenness:** she can probably work out "divided by 10" from the ratios. Nothing in the People view says the values are normalized.
- **Closeness:** she cannot reconcile 0.333 with 0.457. The column header just says "CLOSENESS", and the only formula ("mean of inverse shortest-path distances") is deep in the Methods & Export page. She would likely write "the app is different, maybe a rounding thing", which is wrong.

## A11: Perceived networks
**Completed, correct when all four reports are entered the same way.** About 15 actions plus 51 matrix clicks. I set up 10 people, 4 informants (Maya, Priya, Jordan, Sam) and realistic errors.

The app's numbers match my independent count exactly:
- **Consensus at 50%:** 13 ties, which is the intended network.
- **Jaccard / hit rate:** Maya 0.79 / 85%, Priya 0.93 / 100%, Jordan 0.87 / 100%, Sam 0.64 / 69%.
- **Answer:** Priya perceives best.

Two things break it:
- **Mixed entry flips the answer.** Priya ticks each friendship in both directions while the others tick one cell. Her score drops to 28 reported ties, 15 false alarms and Jaccard 0.46, the worst of the four, and Jordan "wins".
- **The analyzed consensus is directed.** It gives Maya closeness 0.000 and Reciprocity 0, and draws arrows between friends.

## Findings
- **M1 (major, Build › Perceived › Reports/Compare): the matrix is always directed.**
  - On screen: "A row is the person who has the friendship tie, a column the person it goes to."
  - There is no "mutual/undirected" option and no warning when one informant's matrix is symmetric and the others' aren't.
  - Effect: Priya goes from best (0.93) to worst (0.46).
  - Shots: `52-report-Priya.png`, `54-priya-symmetric.png`, `55-compare-priya-sym.png`, `53-compare.png`.
  - Fix: add an "undirected relation" toggle (default on for friendship) that mirrors ticks, or symmetrize before comparing, and flag informants whose matrices differ in symmetry.
- **M2 (major, Network/People after "Analyze this network" on the consensus): the consensus is analyzed as a directed network.**
  - Header: "10 people and 13 ties (directed: a two-way tie counts as two)".
  - Maya's closeness shows 0.000 and Reciprocity 0, and Fatima has the highest closeness (0.426). These are artifacts of which cell was ticked.
  - Shots: `57-compare-bottom.png`, `58-consensus-network.png`, `59-consensus-people.png`.
  - Fix: carry the relation's direction setting through, and warn when a directed network has 0 reciprocity.
- **M3 (major, People): closeness is harmonic, but the column says only "CLOSENESS".**
  - The tooltip, titled "Closeness (harmonic)", says only "How easily others can reach this person in few steps."
  - Hand values (0.333, 0.556) don't match the app (0.457, 0.60), so a careful student gets the explanation wrong.
  - Shots: `17-path-people.png`, `18-closeness-tip.png`, `29-star-people.png`.
  - Fix: name the column "Closeness (harmonic)" and put the formula in the tooltip, e.g. "average of 1/distance to everyone else; differs from the textbook 1/Σdistance".
- **M4 (major, People): betweenness normalization isn't stated anywhere a student looks.**
  - The tooltip says "How often this person sits on the shortest route…", then a paragraph about Spearman correlations and sampling.
  - Fix: add "share of the pairs of other people whose shortest paths pass through this person; divided by (n−1)(n−2)/2; raw count = …". Shot: `09-betweenness-warn.png`.
- **M5 (major for this course, People/Network): "Degree" vs "Contacts".**
  - The assignment and the Network view's "Color by" say Degree. The table shows Contacts, and Degree is hidden under Columns.
  - The Degree tooltip explains the difference only for directed networks.
  - Shots: `07-people.png`, `08-contacts-info.png`, `19-columns.png`, `23-degree-tip.png`.
  - Fix: for undirected data, label it "Contacts (degree)".
- **M6 (minor, People): decimal places change between datasets.**
  - The star shows betweenness "1"/"0" and closeness "1.00"/"0.60"; the path shows "0.400"/"0.617".
  - Shots: `29-star-people.png` vs `17-path-people.png`. Fix: always use 3 decimals.
- **M7 (minor, People and tooltips throughout): warnings and jargon that alarm a beginner.**
  - "⚠ CAUTION Very small network: single ties move these numbers a lot" appears on most measures, and appears on Strength for the path but not the 8-person drawing.
  - Unexplained terms: "broadcast cutoff", "construction rules", "Spearman 0.90-0.99", "rank interval from resampling", "sampled sources", "directional status", "Louvain", "Construction settings".
  - Shots: `09-betweenness-warn.png`, `24-strength-tip.png`.
  - Fix: one calm note for small networks, and a beginner-level first sentence before the technical caveats.
- **M8 (minor, Network map and PNG export): community number badges replace a node's dot.** They appear on Benvolio, Juliet, L5 (a star leaf), Eli and Jordan, and read as ranks. Shots: `06-after-analyze.png`, `dl/network.png`, `28-star-network.png`.
- **M9 (minor, People):** the subtitle says "Select a measure's name for what it means", but clicking the name sorts the column. The explanation sits only on the small icon. Shot: `10-betweenness-name.png`.
- **M10 (minor, People › Columns):** the popover doesn't close on an outside click or Escape. With 7 columns, PageRank is clipped at 1440px. Shots: `21-after-esc.png`, `21b-click-table-area.png`, `22-cols-closed.png`.
- **M11 (minor):** the added Degree column is dropped when the next network is analyzed. Shot: `29-star-people.png`.
- **M12 (minor, Build › Draw):** File › New drawing wipes the current drawing with no confirmation. Undo does restore it. Shots: `14-new-drawing.png`, `15-undo-after-new.png`.
- **M13 (minor, Perceived): more unexplained terms and choices.**
  - The default relation is "Advice".
  - Terms: "cognitive social structures", "informants", "locally aggregated structures… tie from i to j is judged by i and j", "LAS, union/intersection".
  - "Hit rate" is never defined.
  - No note that each informant is scored against a consensus that includes their own report.
  - Odd text: "Who is friends with whom?: the network…".
  - Shots: `42-informants.png`, `53-compare.png`, `56-compare-mid.png`.
- **M14 (minor, Compare):** Priya and Jordan tie on hit rate (100%), and nothing says which column answers "who perceives best". Fix: a one-line verdict ("Most accurate by Jaccard: Priya").
- **M15 (minor, phone 390px, People):** at first the numbers are off-screen to the right. After scrolling sideways, the Name column scrolls away, so it's easy to misread rows. Shots: `61-phone-people-table.png`, `62-phone-table-hscroll.png`. Fix: keep the Name column fixed.
- **M16 (polish, phone, Reports matrix):** cells are about 30px, and the keyboard instructions ("Arrow keys move…") show on the phone. Shot: `65-phone-matrix.png`.
- **M17 (polish):** community detection splits a 6-person path into 3 colored communities, which confuses a beginner. Shot: `17-path-people.png`.
- **M18 (polish):** consensus strengths like "3.50" are unexplained. Shot: `59-consensus-people.png`.

## Unfamiliar terms and where they were explained
- **Explained in plain words where she needed them:** Contacts, Degree (only via Columns), Strength, Betweenness, Density, Transitivity, Components, Modularity, Degree centralization ("1 = a star"), hits, false alarms, Jaccard, disagreement.
- **Name only, or unexplained:** harmonic, normalization, PageRank ("directional status"), Louvain, Construction settings, Weight, Directed, informant, cognitive social structures, consensus threshold, LAS union/intersection, hit rate, reciprocity, eigenvector, constraint, core number, effective size.

## What worked well for a beginner
- Drawing is quick to learn: click to place, type the name, Enter; Connect is click-click.
- The status line ("8 people, 11 ties. Draft saved…") is reassuring, and undo is reliable.
- "Analyze this network" goes straight to the map, with the layout kept as drawn.
- The Network header gives the tie count directly.
- The whole-network panel has one-line plain-English definitions.
- The degree centralization line ("1 = a star") confirmed her star drawing.
- PNG export is clean and submission-ready.
- The perceived-network wizard has clear steps (People → Informants → Reports → Compare), per-informant tie counts in the dropdown, and an accuracy table that is correct and easy to read.
- On phone, the matrix fits without horizontal scrolling.

Everything is in `/private/tmp/claude-501/-Users-ericgladstone-My-Drive--eric-c-gladstone-gmail-com--Projects-Software-Org-Signal/28c7544b-bf65-4ca4-99cc-4f4f74736ee5/scratchpad/ux/students/maya/`: screenshots in `shots/`, the A1 export at `dl/network.png`, and the A11 perception spec in `ties.mjs`.