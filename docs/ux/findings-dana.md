I ran all 10 tasks as Dana, but `findings-dana.md` was not written: the harness blocks subagents from writing report files. The full report is below so you can save it to `SCRATCH/ux/findings-dana.md`.

**Overall:** Dana got everything she came for. The engine and its honesty features are strong. What would cost her credibility with a client is the data story and labelling: the roster was mis-mapped by default, a departed person ranks #2 broker with no warning, Degree is labelled two incompatible ways, and the Ask view's headline privacy claim is contradicted by its own disclosure. No console errors or failed requests all session. The browser and server are stopped.

**Where things are:**
- Screenshots: `SCRATCH/ux/dana/shots/`
- Downloads (GEXF, GraphML, nodes and metrics CSV, `methods-appendix.md`, `org-signal-summary.html`): `SCRATCH/ux/dana/downloads/`
- Step scripts: `SCRATCH/ux/dana/s*.js`

## Top 10 findings
1. **D1 (blocker):** Saoirse Zhou, #2 on degree and betweenness, is a deactivated Slack account (`deleted=true` in the export), last seen 24 Feb. Nothing flags this in People, Network, the summary report or the import report.
2. **D2 (major):** The roster mapper defaulted Manager Name to "Name" and Employee Name to "Person id", and allowed two Person id columns without a warning.
3. **D3 (major):** The purpose-built Data > "Join attributes" flow (auto email match, "150 of 150 rows matched") only appears after loading. At import, the roster is labelled "Full network… who talks to whom, brokers" with "1 source(s) produced no events".
4. **D4 (major):** Degree shows in+out (82) but is defined as "number of distinct contacts" in the tooltip, appendix and report. The same profile shows Contacts = 41.
5. **D5 (major):** All 150 identity pairs say "(several people have that name)". The bug is in `src/core/identity.js:226`: `list.length > 1` counts the pair itself.
6. **D6 (major):** In the import report, "Messages with text 49,229" is more than "46,659 messages" (reactions are counted). "301 listed" is pre-merge. The bot isn't named. There is no breakdown of public/private/DM/group-DM channels or deactivated accounts.
7. **D7 (major):** Rank stability runs one person × one measure per click. There is no interval column or top-10 stability panel, and the summary report points to intervals it doesn't contain.
8. **D8 (major):** Ask says "It only sees numbers the analysis engine computed". Its collapsed disclosure says names, attributes, up to 240 characters of message text, and coded message text are sent. It also shows raw "anthropic-dangerous-direct-browser-access header" jargon.
9. **D9 (major):** "Apply and rebuild" gives no summary of what changed. Community numbers and colours reshuffle (Saoirse went 4→3, red→purple). Nothing says betweenness ignores weights; it stayed at 0.142 under log weighting.
10. **D12 (minor each, major together):** Methods appendix errors:
    - It describes the HR roster as a "full… everyone's interactions are recorded" source.
    - It lists all attributes as grouping variables instead of only Dept.
    - It says 100 null replicates; the Groups view says 200.
    - It omits the join key and match rate, the time window, and path weighting.

## Full report

**Summary.** The tool answered all of Dana's questions:
- Dept assortativity 0.751 against a null of -0.009 (z 86); E-I -0.568 against an expected 0.75.
- Idris Dimitriou is the top broker, with a betweenness interval of 1–1 and 100% in the top 10.
- Saoirse Zhou dropped out in the week of 24 Feb.
- Tie evidence is fully traceable.
- GEXF and GraphML are valid (150 nodes, 1,814 edges, with HR attributes and metrics).

The friction is around the data: roster mapping and join discoverability, an import report that hides deactivated users and has inconsistent counts, contradictory labels, and an inaccurate privacy headline.

| # | Task | Outcome | Steps | Hesitation |
|---|---|---|---|---|
| 1 | Land cold | Success | 1 | None; clear in under 10 s |
| 2 | Import Slack, judge trust | Partial | 4 | 12 s "Detecting format" spinner; counts don't reconcile; no visibility or deactivated breakdown |
| 3 | Join roster by email | Success via detour | 7 | Wrong default mapping; two "Each row is" selects; 150 merge rows to scroll; found "Join attributes" only afterwards |
| 4 | Brokers and confidence | Partial | 6+ | Intervals per person only; #2 is a departed account; default columns are Title, Tz, Tz offset rather than Dept |
| 5 | Silos | Success | 2 | Default is Title (33 groups); p = 0.005 floor shown as exact; matrix labels truncated |
| 6 | Change over time | Success | 4 + 3 | Shift rows not clickable; compare date defaults to 20 Feb not 24 Feb; formed/dissolved axis reads "Jan Jan Feb Feb…" with overlapping end labels |
| 7 | Tie evidence | Success | 2 | Capped at "first 60" of 61, with no "show all" |
| 8 | Change a setting | Partial | 4 | No diff after rebuild; adjacency "not recorded" for Slack; weighting of path measures not stated |
| 9 | Gephi, CSV, methods | Success | 4 | No download confirmation; filenames like `…2025.zip-hr_roster_export.csv.gexf`; no copy button; appendix errors |
| 10 | Ask without key | Partial | 2 | Headline contradicts the disclosure; disclosure collapsed by default |

**Findings beyond the top 10** (D1–D9 and D12 are covered above):

- **D10 (minor), Construction settings:** "adjacency: … None of the imported sources records this" for a Slack export. The UI never says that plain channel posts create no ties, and the summary report warns "Inflated when turn-taking (adjacency) ties are on". Screenshot: `27-no-evidence-rules.png`. Fix: say "not derived for Slack; channel posts tie only via reply, mention or reaction", or implement adjacency.
- **D11 (minor), Groups / Content / profile:** default to Slack Title (33 groups) instead of Dept; profile "Diversity of contacts (Title)"; Title and Job Title duplicated. Screenshots: `17-groups-title-default.png`, `37-content.png`. Fix: default to an attribute with 3–15 levels named like dept or team, and remember the choice across views.
- **D13 (minor), Time view:**
  - Detected-shift rows aren't clickable, and the "Drop" doesn't explain the cause.
  - Compare date defaults to 20 Feb; the date input only accepted typing after clicking the month segment.
  - Formed/dissolved chart: axis "Jan Jan Feb…", end labels overprint, chart about 55% of the width.
  - "Largest component 1 / 1" isn't shown as a share.
  - Weekly reciprocity ~0.85 against 0.999 overall, unexplained.
  - Screenshots: `19-time-full.png`, `21-before-after-0224.png`.
- **D14 (minor):** format detection is a ~12 s spinner with no count. Screenshot: `03-import-5.png`.
- **D15 (minor):** evidence capped at 60 with no total, "show all" or export; a reaction shows only ":confused:" without the target message. Screenshot: `24-tie-evidence.png`.
- **D16 (polish), People table:**
  - TZ offset is shown in seconds.
  - No column chooser; Dept and Office hidden; Closeness cut off.
  - Sort resets to Degree on return.
  - The profile panel keeps showing a filtered-out person.
  - "Reciprocity 1, rank 1 of 150" for everyone.
- **D17 (polish), Exports:** no download confirmation, long filenames, no "Copy appendix", GEXF edges lack per-rule counts.
- **D18 (polish), wording:**
  - "150 identities were merged by hand; see the merge log": Dana accepted pre-selected pairs, and there's no merge-log link.
  - "Spreadsheet … (20%)" reads as low confidence for an ordinary CSV.
  - "roster survey" is easy to confuse with an HR roster.
  - The success toast covers a stat.
  - The betweenness tooltip text is right-aligned.

**Fixes for the top 10:**
- **D1:** count and list deactivated accounts in the import report; badge them in People, Network and the summary report; label a shift as "stopped appearing" when last-seen matches the shift week.
- **D2:** prefer a unique, email-shaped column as Person id; never map `*manager*` to Name; warn on duplicate Person id; offer manager as a reports-to tie.
- **D3:** classify one-row-per-person tables as "Attributes to join" at import and show the join report there.
- **D4:** show distinct-neighbour degree, or rename to "Total degree (in+out)" and correct `src/llm/methods.js:60`.
- **D5:** exclude the pair's own records when testing name ambiguity.
- **D6:** count text over messages only; reword to "151 people after merging"; name bots and deactivated users; add a visibility breakdown.
- **D7:** a "Check stability of this ranking" button that fills interval and "% in top 10" columns for every row and feeds the report.
- **D8:** make the headline accurate; open the disclosure by default; drop the header jargon; add a "replace names with codes" option.
- **D9:** a before/after toast after rebuild; overlap-matched community labels; state path weighting in tooltips and the appendix.
- **D12:** generate the source line from the source's role; list only the attributes analysed; one replicate count; add join key, match rate, window and weighting.

**What worked well:**
- Clear landing page, with useful links on the empty-state Network view.
- Slack import progress counter; about 10 s from Import to loaded.
- Who-is-who review with evidence per pair.
- "Join attributes" report, once found.
- Tooltips that give both meaning and reliability.
- Resampling intervals with "a rank whose interval is wide is not a finding".
- Groups view with a degree-preserving null and a plain-language reading.
- Tie evidence showing who, when, channel, visibility and text.
- Detected shifts found the real event; before/after reports d_z and permutation p.
- Valid GEXF and GraphML; CSVs keyed to node ids; appendix with real citations and Louvain caveats.
- Selection carries across views.