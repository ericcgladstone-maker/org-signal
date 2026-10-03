I finished A8, A9 and A12 using only the interface. Every network number I could recompute matched networkx 3.2 exactly, so the problems are not in the computations. They are in labelling, in how one null model is set up, and in what the methods appendix leaves out.

One possible serious problem I could not reproduce. In the first session, clicking "Compare with random networks" froze the tab for more than 5 minutes. The renderer stopped responding with 0% CPU and no console errors. This happened right after I replaced the online dataset with the Slack import. I tried twice more, in a fresh browser and with the same sequence of steps, and both times it finished in under 10 s. It may have been caused by my automation rather than the app.

No console errors or warnings were logged in either browser. All screenshots are in `SCRATCH/ux/students/ana/shots/` and all exports in `SCRATCH/ux/students/ana/dl/` (`c1_replies`, `c2_replies_mentions`, `c3_all`, `c4_no_dm`, `a9_online`, `a12_main`, `a12_post`, `a12_final`, `w_before`, `w_after`).

## A8 – Construction choices
Dataset: generated workplace, Slack, distributed, 120 people, seed 1. All values below are confirmed in networkx.

| Construction | Ties | Top 5 betweenness | Top 5 strength | Modularity |
|---|---|---|---|---|
| Replies only | 1,047 | Dana .296, Rhys .260, Leena .230, Ilse .225, Elif A. .217 | Kofi 258, Dana 240, Fatima 237, Noor 221, Folake 214 | .781 |
| Replies + mentions | 1,064 | same five people (.296/.259/.230/.223/.216) | Kofi 447, Dana 425, Fatima 409, Folake 378, Noor 370 | .781 |
| Replies + mentions + reactions (no DMs), extra check | 1,081 | Dana .229, Leena .178, Rhys .177, Ilse .171, Elif .148 | – | – |
| Everything (the default; includes DMs) | 1,498 | Leena .067, Ines Z. .052, Ugo .048, Kofi .047, Fatima .041 | Fatima 1592, Kofi 1418, Jovana 1273, Leena 1234, Dana 1222 | .604 |

- **What Ana concludes:** mentions and reactions barely change the ranking. DMs (19.5k pieces of evidence) change it completely: density goes from .074 to .105, reciprocity becomes 1, and betweenness flattens. She defends **replies + mentions** as "public conversational engagement".
- **Confidence:** high on the numbers, medium on the choice. The recovery check always uses the default construction, so she cannot test which construction finds the planted brokers better (it found 1 of 4 in the top 4).
- The construction drawer and the rebuild summary ("Rebuilt: 120 people, 1,047 ties (was 1,498)…") worked well.

## A9 – Diffusion
Dataset: generated online network, X, interest communities, 400 accounts (392 after the app excluded 8 accounts flagged as bots).

- **"glimmerboard" follows ties:** 99% of adopters had an earlier-adopting contact, against 94% when adoption times are shuffled (z 2.5, p = .005). The other four auto-found terms are "not along ties".
- **Independent recomputation:** I took adoption times from the saved project file and edges from the CSV and ran 200 shuffles. Exposed shares matched exactly (159/161, 120/123, 114/119, 112/115, 51/54); my z and p agree within random-shuffle noise (glimmerboard z 2.41, p .010).
- **Confidence: medium.** The shuffled baseline is already 94%, so the test has little room to show anything, and the app gives no warning about this. The recovery check also contradicts this view (finding N8).

## A12 – Final project
Data: Halcyoncrest Slack zip plus HR roster. All 150 roster rows matched by Work Email.
Construction: replies + mentions + DMs, directed, weights are counts of evidence, broadcast cutoff 25, bots excluded.

## Cross-checks (app value vs networkx)

| Check | App | networkx |
|---|---|---|
| Ties, density, reciprocity, transitivity, avg clustering, avg path length, components (all 4 constructions plus A12) | e.g. A12: 1,814 / .0812 / 1 / .374 / .508 / 2.58 / 1 | identical |
| Degree, strength, betweenness (directed, normalized), closeness (harmonic/(n-1), directed), clustering, core number | per person | max difference 0 to 1e-16 |
| PageRank (weighted) | | max difference 2e-5 |
| Eigenvector | | matches only on the undirected graph with weights summed in both directions (max difference 2e-11); the appendix does not say this |
| Constraint, effective size | | match Burt's measures with weights (difference 1e-16) |
| Modularity of the app's partition | .658 | .658 |
| Degree centralization / strength Gini | .197 / .257 | .197 / .257 |
| Diameter / degree assortativity (shown only in the summary report) | 5 / −.11 | 5 / −.110 |
| Dept assortativity / E-I index | .751 / −.568 | .751 / −.568 |
| Null for assortativity / E-I (200 rewirings) | −.0092 (z 86) / .75 | −.0082 (z 91) / .748 |
| Before/after windows (mean degree, strength, betweenness, ties), rebuilt by hand | 24.1→23, 239→233, .0107→.0112, 1,810/1,728 | 24.13→23.04, 239.1→233.0, .01066→.01123, 1,810/1,728 |
| Modularity null | random −.0072 | re-optimized Louvain on rewired graphs gives .236 (sd .005), see N2 |

## Export fidelity
- GEXF, GraphML and GML all open in networkx as a DiGraph with 150 nodes and 1,814 edges, attributes intact. Pajek opens as a MultiDiGraph.
- Problems:
  - Community ids are off by one (N1).
  - There is no `contacts` column (N10).
  - Edge attribute names differ between formats (N11).
  - Emails and handles are included by default (N19).

## Findings

| ID | Sev | View | What happened vs expected | Screenshot |
|---|---|---|---|---|
| N1 | Med | People/Network vs all exports | Community numbers are 1-based in the app and 0-based in exports. Kofi is community 1 in the UI and 0 in the CSV; Idris is "Community 1" in the UI and `community 0` in the GEXF. Fix: use one base everywhere. | 05, 12, 28 |
| N2 | Med | Network, Groups | The modularity null keeps the observed partition fixed on rewired graphs, so "random −0.00722… z 92" is a straw man. Re-optimized Louvain gives about .236, so the real z is about 80. The conclusion still holds, but the number is not defensible. Source: `src/analysis/uncertainty.js:47`. Fix: re-run Louvain on each replicate. | 45, 34 |
| N3 | Med | Network vs Groups vs appendix | The same statistic gets two different results. Network panel: −0.00722, sd .00715, z 92, p = 0.010 (100 replicates). Groups: −0.00774, z 90, p = 0.005 (200 replicates). The appendix lists both runs and gives values for neither. | 45, 34 |
| N4 | Med–High | Appendix, summary report | They say which tests were run but give no null means, z, p or intervals. The summary report has no null-model or group-mixing results at all, so Ana has to copy numbers from the views by hand. | – |
| N5 | High (A9/A12) | Appendix | It leaves out analyses that were actually run: the diffusion test (terms, 200 shuffles), the before/after test (2,000 permutations, dates) and shift detection (robust z, 8 preceding windows, thresholds 3.5/5). The A9 appendix mentions only VADER. | – |
| N6 | Low–Med | Time | The test is described two ways on the same panel: "paired sign-flip permutation test" and "each event… relabelled before or after at random… 2,000 permutations". | 49 |
| N7 | Low–Med | Several | Window end dates disagree. Appendix: "monthly windows from 1 Jan 2025 to 1 May 2025" while the profile says partial months are left out (data runs 6 Jan–5 Apr), and the sparkline shows 3 unlabelled points. Weekly windows "to 7 Apr 2025". Recovery check says "to 6 Apr" where Data and the appendix say "5 Apr"; for the online data, "2 May" vs "1 May". | 38 |
| N8 | Med | Content (Diffusion) vs Recovery check | For the same terms the two views disagree. zestgrid: "NOT ALONG TIES z 1.2, p = 0.174" vs "RECOVERED". glimmerboard: "FOLLOWS TIES" vs "PARTLY". The recovery check uses true ties (only 67% are visible in the data) and the page never explains this. There is also no ceiling warning when the shuffled baseline is 94%. | 20, 21 |
| N9 | Low | Profile | "Messages with text" is larger than "Message": Idris 1,060 messages + 29 reactions, "Messages with text 1,089"; Saoirse 597 vs 616. Reactions appear to be counted as messages with text. | 37, 48 |
| N10 | Low–Med | People vs exports and summary | The default "Contacts" column (Kofi 29) appears in no export; exported `degree` is in + out (58). The summary report's "Degree" gives Idris 82 while the People table shows Contacts 41. | 05 |
| N11 | Low | Exports | Edge attributes are `evidence_reply` in GEXF but `w_reply` in GraphML and CSV. | – |
| N12 | Low | Appendix | An internal key leaks into the text: "Groups were defined by each of `__community` and `Dept`." | – |
| N13 | Low | Summary report | Network-level reciprocity uses the per-person wording "Share of this person's ties…". Largest component shows "1" where the panel shows "100%". | – |
| N14 | Low–Med | Rank stability | Every top-10 betweenness interval is exactly one rank ("rank 1-1"). Resampling events almost never deletes a tie, and betweenness ignores weights, so this looks like certainty that was never tested. The appendix still cites Borgatti 2006 on missing data. | 36, 47 |
| N15 | Low | Recovery check (online) | "67% of true ties…" next to "0.68"; "8,157 seen; 8,463 observed pairs, 8,463 of them true ties" while the network has 8,230 ties. Typos: "interest communitys", "1 of the 4 planted brokers are", "People writes more positively". | 21, 14 |
| N16 | Low | Rebuild toast | "Removed ties from reactions" when ties stayed at 1,814 (only weights changed). "Time range: open to open". | 44 |
| N17 | Low | Rebuild | A deactivated person left as an isolate is counted as a community: "9 communities (was 8)". | 42 |
| N18 | Low | Data join | Manager Name is empty in all 150 roster rows but is joined silently and listed in the appendix as an added column. | 26 |
| N19 | Low–Med | Exports | email, handle and team_id are in GEXF, GraphML and nodes CSV by default, with no option to strip them before handing in. | – |
| N20 | Possibly High (not reproduced) | Network | The tab froze after "Compare with random networks" (described at the top). | 31 attempt; 50 = a later try where it finished normally |
| N21 | Low | People vs Network | The same hues mean different groups: the People table colours dots by community while the map was coloured by department (Sales is gold on the map, pink in the table). | 03, 12 |
| N22 | Low | Network | A person selected in People stays selected on Network, which hides the Whole-network panel and the "Compare" button. Ana had to click an empty part of the map and press Escape to get it back. | 45a |
| N23 | Low | Appendix | It does not say that eigenvector centrality is computed on the undirected graph with weights summed in both directions, or which PageRank damping is used. | – |
| N24 | Low–Med | Recovery check | It always uses the default construction, so A8 cannot test which construction recovers the planted brokers. | 14 |

## What worked well
- All measures agree with networkx to floating-point precision.
- The construction drawer gives evidence counts per rule.
- The appendix tracks the current construction and drops analyses that a rebuild made stale.
- The deactivated-account cautions show up everywhere they matter.
- The Groups reading compares E-I with its expectation rather than with zero.
- The before/after numbers reproduce exactly.
- The project file was enough to recompute diffusion independently.

## Ana's 1-page report (as submitted)

**Departmental silos and brokerage in Halcyoncrest Energy's Slack, Jan 6 – Apr 5 2025**

*Question.* Does communication stay inside departments? Who carries the cross-department traffic, and what happens when one of them leaves?

*Data and construction.* I used the admin Slack export (151 accounts, 49,233 events) joined to the HR roster by work email (150 of 150 rows matched; the Manager column was empty). A directed tie A→B counts replies, mentions and direct messages, weighted by the number of events. I excluded reactions, which are low-effort signals, broadcasts to more than 25 recipients, and the deploy bot. The result is 150 people and 1,814 directed ties. Every tie is reciprocated, so the network is effectively 907 undirected ties. Density is .081 and average path length 2.58 (diameter 5). The methods appendix and GEXF are attached.

*Measures.* (1) Betweenness, normalized, on unweighted shortest paths. (2) Burt's constraint and effective size, weighted. (3) Louvain communities and modularity, seed 1. (4) Department assortativity and the E-I index.

*Results.* Communication is strongly organized by department. Department assortativity is .751, against −.009 in 200 degree-preserving rewired networks (z ≈ 86, p = .005; the smallest p possible with 200 replicates). The overall E-I index is −.568, against .75 expected under rewiring. Design is the most inward-looking department (E-I −.63). People is the most outward-looking apart from the one-person Executive group (E-I −.09).

Louvain finds 8 communities (modularity .658). The app's own comparison (random about −.007) is too weak a baseline. When I re-ran Louvain on 20 rewired graphs in networkx, modularity averaged .236 (sd .005), so the structure is still far above chance (z ≈ 80). Transitivity (.374 vs .201) and average clustering (.508 vs .211) are also well above the rewired baselines.

Brokerage is concentrated in a few people. Idris Dimitriou (Design) has betweenness .234, and the next highest is .142. He also has the lowest constraint (.054) and the largest effective size (38.6 of 41 contacts). After him come Saoirse Zhou (People, .142), Sabine Tanaka (.092) and Elif Hakimi (.089, both Product), and Nils Xu (Sales, .080). These ranks did not move in 50 event resamples, but that stability only reflects resampling of message volume, not uncertainty about whether ties exist.

*Departure.* Saoirse Zhou's account was deactivated; her last activity was 24 Feb. The app's shift detector flags a drop in the week of 24 Feb, both for her and for People-department activity. I compared 14 Jan–24 Feb with 24 Feb–5 Apr. Mean degree fell from 24.1 to 23.0 (d_z −.18, p < .001; 2,000 permutations). Her 75 lost ties account for most of that fall. Mean betweenness rose slightly (.0107 → .0112, p = .005). In the network after 24 Feb, Idris stays first (.218). Brokerage spreads to Tanaka (.105), Hakimi (.103), Xu (.089) and two People-department staff, Nikhil Engel (.080) and Basil Sato (.078).

*Conclusion.* Halcyoncrest's Slack is departmentally siloed well beyond what degree alone predicts, and cross-department flow depends on a handful of people, above all one Design lead. The loss of a People-department broker was absorbed by several others rather than by one person. I recomputed every number above in networkx 3.2 from the exported files.

*Limitations.* Slack traces are not relationships, and meetings and email are missing. Louvain partitions depend on the seed. The rank-stability intervals overstate certainty. The app's export numbers communities from 0 while the interface numbers them from 1.