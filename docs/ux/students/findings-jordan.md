# Jordan (Networks 101) on Org Signal v2: A5, A6 and A10

**Bottom line:** the app's numbers are right. Every betweenness value matched my networkx recompute exactly, and every recovery-check verdict held up. The trouble is reading them. A rushed Jordan would submit something wrong or overstated on all three assignments, and the most serious case is A10. There, the app's own headline points to the wrong conclusion, and nothing on screen corrects it.

- **Session:** about 45 minutes of student time, nothing installed, no app code read.
- **No long waits:** generating took 1.3–2.5s, rank stability 0.3–0.5s, before/after Compare 2.7–3.2s, the Time view about 1.3s.
- **No console errors or warnings** were logged during the session.
- **Screenshots** are in `SCRATCH/ux/students/jordan/shots/`, where SCRATCH = `/private/tmp/claude-501/-Users-ericgladstone-My-Drive--eric-c-gladstone-gmail-com--Projects-Software-Org-Signal/28c7544b-bf65-4ca4-99cc-4f4f74736ee5/scratchpad`. Exported files are in `SCRATCH/ux/students/jordan/dl/`.

## A5: two generated workplaces, about 25 minutes

**Distributed org**
- **Jordan submits:** top 5 brokers are Leena Farouk, Ines Zapata, Ugo Ocampo, Kofi Abernathy and Fatima Gallagher. "Ranking stable: 9 of 10 stay in top 10." "Recovery: 7 of 8 recovered, brokers partly."
- **Correct answer:**
  - Only ranks 1–4 are findings. Rank 5 is a four-way tie: Fatima, Elif Abernathy, Jovana Yilmaz and Goran Kamara all show 0.041 and are 0.0002 apart. Their intervals are 5–7, 5–8, 6–8 and 5–8, so naming Fatima as #5 is not a finding.
  - The recovery check finds only 1 of the 4 planted brokers among the top 4, with a median rank of 7. Jordan's list therefore cannot be called "the brokers", and the app never names the planted brokers, so Jordan can't check.

**Bridge-dependent org**
- **Jordan submits:** Noor Uchenna, Bodhi Sato, Ines Chaudhry, Kofi Marchetti and Pia Zhou, "all stable". The recovery check finds 7 of 7 brokers. There is a departure shift in the week of 24 Feb (Noor). For fragility, Jordan would write either "it fell apart when Noor left" or, after reading Compare, "nothing much changed".
- **Correct answer:**
  - The list is right.
  - Noor, the #1 broker, leaves on 24 Feb. Her whole-period rank 1 mixes the time before and after she left, and the bootstrap can't show that.
  - The network never disconnects. Compare shows 1 component before and after, and density goes from 0.102 to 0.0966.
  - The real reason it is fragile: the 7 brokers carry 52% of all betweenness, against 26% in the distributed org. They also touch 134 of the 173 cross-department ties, against 85 of 245. Removing them cuts cross-department ties from 173 to 39 and stretches average path length from 2.41 to 3.16.
  - None of that fragility evidence is available in the UI. I had to compute it in networkx.

## A6: siloed workplace, about 10 minutes

- **Jordan submits:** "Departments are siloed: E-I −0.583 vs random 0.683 (p = 0.005). The silo formed the week of 10 Feb and lasted 2 weeks."
- **Correct answer:**
  - The silo was planted on 11 Feb and was detected within 1 day. That part is right.
  - The whole-period E-I does **not** show the silo. Rebuilding the network for the period before 10 Feb alone gives −0.582. After 10 Feb it is −0.72.
  - The −0.583 Jordan cites is normal department clustering. The silo is the change from −0.58 to −0.72, which the app never shows side by side.
  - The silo is permanent. The cross-department share drops from 0.176 to about 0.05 and stays there until the end of the data. "Lasted 2 weeks" is wrong.
  - Design (+0.12) and Operations (+0.21) have positive E-I, so "all departments are siloed" overclaims.

## A10: reorg at midpoint, about 10 minutes

- **Jordan submits:** "The reorg was the week of 24 Feb. After it, cross-department ties rose from 17% to 25%: people collaborated more across departments. 167 ties dissolved and 78 formed. Degree fell (p < 0.001)."
- **Correct answer:**
  - The planted date is **20 Feb** (the week of 17 Feb). The detected date is 4 days late.
  - The recovery check names what happened: 16 people in 3 teams moved department. One of the three, People / Noor Uchenna's team, moved to Engineering. Another, Finance / Pia Zhou's team, moved to Operations.
  - The department attribute is the **pre-reorg** department. In my split around 20 Feb, **all 55 newly formed ties count as "cross-department"** under the old labels.
  - So the "rise in cross-department share" is the moved teams tying into their *new* departments, not more cross-boundary collaboration. Jordan's interpretation is backwards, and nothing in the app warns about it.

## Findings

| ID | Sev | View | What happened vs expected | Suggested fix |
|---|---|---|---|---|
| J1 | High | Time / Groups | After the reorg, the cross-department share "rises" only because the attribute is the pre-move department. The app presents "Cross department share of ties... Rise 0.25 vs 0.171" as a behavior change (shot 30-reorg-row.png). | When the generator moved people, or when an attribute is a single snapshot, say so next to group-based time series ("department = value at export / before reorg"). Or provide time-varying attributes. |
| J2 | High | Groups | Whole-period E-I (−0.583) equals the pre-silo E-I (−0.582) and hides the silo (shots 21, 26, 27). Nothing links Groups to the detected shift. | When Time has detected a shift, show a banner on Groups ("a shift on 10 Feb: compare before/after") with one-click E-I before vs after. Add E-I / cross-group share to the before/after Compare table. |
| J3 | High | Time, detected shifts | Text says "fell to 0.0815 ... **for 2 windows**" and shades 2 weeks, yet the chart stays low to the end (shot 23-silo-row.png). Jordan writes "the silo lasted 2 weeks". | Say "from week of 10 Feb (flagged for 2 windows; level persists to end)". Or measure persistence against the pre-shift baseline. |
| J4 | High | Time, Window = Day | Switching to Day recomputes the charts (90 values), but the shifts table stays stale: same 0.25 / 317 / z 6.4 / "2 windows", relabeled "24 Feb 2025". It reads "a rise in the 24 Feb 2025" (shots 33, 35). This is a bug, and it misleads anyone trying to pin the date to the day. | Recompute shifts when the window changes, or show "computed with weekly windows". |
| J5 | Med | Recovery check | Planted brokers are counted but never named ("1 of the 4 planted brokers..."), so a student can't check their own list. | List the planted brokers with their measured ranks. |
| J6 | Med | People, stability | The summary is fixed at top 10 ("9 of 10 stay in the top 10") while the assignment asks for top 5. Rank 5 is a tie (0.041 ×4, intervals 5–8). Jordan copies "stable". | Let users pick k. Flag ties at shown precision ("ranks 5–8 indistinguishable"). Show 4 significant digits when values tie. |
| J7 | Med | People / Time | A person who left mid-period (Noor) is ranked #1 with interval "1", 100% top-10, and nothing notes the departure. | Mark people with a detected departure/drop in the People table and profile. Caveat that the bootstrap does not cover structural change. |
| J8 | Med | Time Compare | Fragility can't be shown: whole-network Compare after the broker leaves is nearly unchanged, and average betweenness *rises* (p = 0.005). A rushed reading gives "not fragile" or "p<0.001 so collapsed" (d_z −0.17, driven by Noor −83). | Add betweenness concentration (top-k share) or a "remove these people" what-if. In the summary, name the driver ("mostly Noor Uchenna −83"). |
| J9 | Med | Recovery check | Verdicts are inconsistent. Distributed org (median broker rank 7, 3 in top 8) is PARTLY, but the siloed org (median rank 13, 2 in top 8) is RECOVERED. "Chance alone: about 0.133" and "precision@k ... chance 0.03" are two chance numbers in different units. | Use one threshold rule and state it. Show a single chance metric with its unit. |
| J10 | Low | Compare summary | "a large change **but** more than chance would give". The "but" reads like hedging. | Change to "and"; e.g. "a large change, unlikely by chance (p<0.001)". |
| J11 | Low | Groups | "p = 0.005" is the floor for 200 replicates, reported as if exact. No per-group random expectation is shown, even though the text says to compare with the expectation. | Write "p ≤ 0.005 (smallest possible with 200 rewires)". Add an expected-E-I column. |
| J12 | Low | Compare | The intro says "paired sign-flip permutation test", but the footnote says "each event ... relabelled before or after at random". These are two different descriptions. | Make them consistent. |
| J13 | Low | Recovery / Network | The recovery check shows "121 people" while every other view shows 120 (a bot is excluded; explained only in the methods appendix). "Planted departments: 7 groups" while the Department legend has 8. Planted group, Department and Community all appear as color/filter options. | Say "121 accounts, 1 bot excluded". Rename to "Planted groups (7; CEO assigned to Engineering)". |
| J14 | Low | Header | "Analyzing: Synthetic workplace" never names the scenario (only a toast does), and seed 1 reuses the same names across scenarios. Easy to report a number from the wrong org. | Show the scenario and seed in the header. |
| J15 | Low | People | The view opens sorted by Contacts and the sort resets on each new dataset, so the top 5 rows aren't brokers. Row dots are colored by community, next to a Department column, with no legend. | Show a legend for dot color. Consider remembering the sort. |
| J16 | Low | Time Compare | The planted departure day (24 Feb) falls in the "after" period, so "People with ties" stays at 120 after Noor leaves. | Note how the boundary day is assigned. |
| J17 | Low | Construction | "Undo changes" does not clear an applied time range, and resetting means hand-deleting date fields. | Add a "clear range" or "All dates" button. |
| J18 | Low | Groups | The rebuild toast covers the E-I tooltip and part of the table (shot 37-tooltip-ei.png). | Move the toast or auto-dismiss it. |

## Terms Jordan would look up

- **Explained in the app:** betweenness, E-I, assortativity, NMI/ARI ("1 = identical"), density, modularity and constraint, all through ⓘ text or tooltips.
- **Not explained:** precision@k, robust z / MAD, d_z (given only as a formula), "two-sided empirical p", and "rewired networks".

## What worked well

- Generating, stability and Compare are all fast.
- Sorting by betweenness surfaces the "Check how stable" link exactly when it's needed.
- The stability chart and the "their place is not a finding" wording are good.
- The recovery check's planted-vs-found rows are excellent for grading.
- The Groups "Reading" paragraph says to compare with the random expectation, not with zero.
- The Compare date is pre-filled from the strongest shift.
- The shift warning ("138 series were scanned, so expect some flags by chance") is good.
- The construction time range lets a careful student do the right before/after analysis.
- Exports open cleanly in networkx and match the app's values exactly.

The Ask view needs an API key, so Jordan would stop there.