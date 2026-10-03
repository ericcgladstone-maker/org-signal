I ran all three assignments with the professor and ten simulated students, using only the visible interface. The app's maths is right in every check I ran against networkx. The trouble is around it: some default settings, labels and how evidence is shown can lead students and the professor to wrong answers.

The four most important problems:
- **The 1–5 closeness ratings are collected and then dropped.** All 18 ties in the class network export with weight 1.
- **The ego-network survey version of A4 mixes in guesses by default.** Students' guesses about which classmates know each other become friendship ties. One skimming student invented three friendships and pushed reciprocity from 0.80 to 0.923.
- **A3 numbers don't match the textbook.** Effective size and constraint come out weighted even though the interview said "every tie counts 1". A careful student checking by hand gets a different answer.
- **A7's quotable "can show / cannot show" text is wrong for 56 chats.** It says "within this one conversation", and the betweenness warning gives the wrong reason.

No app code was modified and no console errors were captured. Midway, an outside process killed the shared Chrome; I relaunched it and rebuilt the professor's state. That accident usefully tested the professor recombining responses on a different computer (it works).

Screenshots are in `SCRATCH/ux/students/survey/shots/` (numbered 001–124). Python checks are in `SCRATCH/ux/students/survey/py/a3.py` and `a4.py`.

## A3 – ego network on yourself

**Leo (phone, skims): completed.** The values are right for the app's weighting, but not the textbook values.
- He reached Build through the Menu. On the phone the "Paste ties" tab is cut off.
- He used the default cap of 5 names, so "Important matters" filled and showed "This question is full". He didn't notice.
- He typed "Ben Carter" after already naming "Ben". The app asked "may be someone already named: Same person: Ben". He kept typing other names first, so the prompt sat waiting until he resolved it. "jess" was merged with "Jess" automatically. (shots 077–078)
- On the result map, the "Loaded…" notice covered the nodes for him, Coach Dan and Marcus (087). He had to use Find a person, then Full profile.
- The quick panel for the selected person shows constraint but not density or effective size. Those are only in the Full profile.

**Priyanka (laptop, careful): completed, and the numbers don't match her hand calculation.** She used three questions and raised the caps to 10. The "settings" grouping (Family, College, High school, then fix the exceptions) was the best part of the app (098).

| | App (what the students report) | networkx, unweighted (textbook) | networkx, weighted 2 for people named twice |
|---|---|---|---|
| Leo: size / density | 9 / 0.278 | 9 / 0.278 | |
| Leo: effective size / constraint | 6.91 / 0.309 | 6.78 / 0.304 | 6.91 / 0.309 |
| Priyanka: size / density | 12 / 0.333 | 12 / 0.333 | |
| Priyanka: effective size / constraint | 8.84 / 0.269 | **8.33** / 0.267 | 8.84 / 0.269 |

Burt's binary formula gives 12 − 2·22/12 = 8.33, so Priyanka would find a 0.5 gap. Both students would read the result correctly as "brokering" (constraint about 0.3, ranked lowest).

## A4 – class friendship survey (roster link)

**Professor Okafor's setup:** about 8 minutes.
- Pasting a name,major CSV worked. He had to switch major from Text to Choice himself.
- Friendship relation plus the Strength field renamed to Closeness (1–5), then a share link (870 characters, with Copy link).
- He would post the link in a Canvas announcement and ask for files in a Canvas dropbox. The app's own wording assumes "email or chat".

**Students:** all nine responders finished in 1–2 minutes each.
- Diego typed "Deigo Morales": no suggestions and no "no match" message, only "Choose your name to continue." He retried with his surname.
- Ben reopened the link later. His draft came back, he added Gabe and downloaded a second file.
- Sam, privacy-conscious, used "Copy it as text instead" and emailed it. The professor pasted the whole email, greeting and signature included, and it parsed.
- Gabe never responded.

**Collecting:** handled well.
- Importing 9 files plus the pasted email gave "9 of 10 people responded… No response from Gabe Turner… Ben Carter sent 2 responses; the latest … is used." (038)
- Rebuilding on a different computer by dropping the files on Data → Import also works. Majors then have to be re-joined from a roster CSV, because the link doesn't carry attributes.

**Correctness against networkx (from the simulated answers):**

| | Expected | App |
|---|---|---|
| Nominations / union ties / reciprocated ties / one-sided | 30 / 18 / 12 / 6 | 30 / 18 / 12 / 6 |
| Union: density / modularity / assortativity by major / E-I | 0.400 / 0.315 / 0.486 / −0.333 | same |
| Reciprocated: density / modularity / assortativity / E-I | 0.267 / 0.413 / 0.623 / −0.5; Gabe isolated | same, 4 communities |
| As reported (directed): reciprocity / density / assortativity / E-I | 0.80 / 0.333 / 0.545 / −0.4 | same |

The communities match Louvain: CS, Economics and Sociology, with Gabe on his own in the reciprocated version. The random-network comparison is worded so first-years can read it ("people tie within their major more than the degree sequence alone explains").

**Where students get stuck:**
- They have no clear way to get both versions.
  - A union project file loses who named whom.
  - Switching it to Directed shows **Reciprocity 1 ⚠ CAUTION** with no explanation (057–059). The true value is 0.8.
  - Dropping the project file on Data says "not recognized" (050).
- What works: the professor posts the response files plus a roster CSV. Students import them, choose Union / Reciprocated / As reported, and join majors (060–065). That is about 6 steps, and it hands every student the raw record of who named whom. The app gives no privacy warning about that.

**Ego-network survey version against the roster, stitched:**
- It works mechanically (101–117).
- The default network has 39 directed ties instead of 30, and reciprocity 0.923. Students' guesses about who knows whom (Leo tapped "Add School" and ticked everyone) become friendship ties.
- Unticking "perceived" under Construction settings → "Keep ties whose reported as is" gives back exactly 30 (119).
- There is no union/reciprocated choice in this version.

## A7 – sample export (Sam)

**Completed, but the text he is asked to quote is wrong.** He dropped all 56 WhatsApp sample zips.
- The import report says "THIS DATA CAN SHOW: Who talks to whom **within this one conversation**", even though there are 56 chats (121).
- The header says "PEOPLE 56" while the chat-level summary says "People 138".
- Betweenness is 0.952 with the warning "A single conversation: everyone hears everyone…" That is the wrong reason; the real one is that the export owner sits on every path by construction.
- Constraint 0.067 and effective size 53.4 show with no warning (124).

A careful student can still say "one person's slice" from the NOTE text. Who connects different parts of life would be read from communities 2–5 (Eun-ji Falk, Tove Vance and others).

## Findings

| ID | Sev | View | What happened vs expected | Shot | Fix |
|---|---|---|---|---|---|
| C1 | High | Roster tie fields → network and exports | Closeness 1–5 is collected but every tie has weight 1 and closeness is missing from the GraphML and CSVs. The combine text promises "a valued tie takes the larger/smaller answer". | 043, `dl/okafor/*edges.csv` | Use a 1–N tie field as the tie value by default, or warn; export the field. |
| C2 | High | Stitched ego survey | Guesses about who knows whom become directed friendship ties by default (39 vs 30, reciprocity 0.923 vs 0.80). | 117, 119 | Exclude guessed ties by default, or show them as a separate relation. |
| C3 | High | A7 import report | "Within this one conversation" shown for 56 chats; the betweenness warning gives the single-conversation reason. | 121, 124 | Separate wording for many personal exports ("one person's slice; the owner bridges by construction"). Add warnings to constraint and effective size. |
| C4 | Medium | Ego interview → measures | People named under two questions get weight 2, despite "Weight ego's ties by: Nothing (every tie counts 1)". Effective size and constraint come out weighted (8.84 vs textbook 8.33). | 100 | Respect the setting, or show both values and say which one is used. |
| C5 | Medium | Union tie evidence | The Aisha→Leo nomination shows as "Leo Park · Named ties… StrengthCloseness: 2" (Aisha's rating credited to Leo). Mutual ties show only one person's evidence. | 044 | Show each person's nomination with the correct name. |
| C6 | Medium | Rename a tie field | The label reads "StrengthCloseness (1 to 5)" to every respondent. | 021, 023 | Show the custom name only. |
| C7 | Medium | Survey title field | Clearing the field brings the default straight back, so typing produces "Roster networSOC 101…" / "Org Signal ego interviewSOC 101…". Respondents saw it. | 014, 106 | Allow an empty field while typing; restore the default only when focus leaves it. |
| C8 | Medium | Reciprocity card | "⚠ CAUTION" has no explanation on hover or click; on a project switched to directed it shows 1. | 057–059 | Show the reason and block meaningless directed rebuilds. |
| C9 | Medium | Sharing with students | A project file dropped on Data says "not recognized"; a union project can't produce the reciprocated network. | 050, 056 | Recognise project files on Data; keep who-named-whom in the project file. |
| C10 | Medium | Methods appendix | "1 file read", "Communication traces record observable interaction", broadcast-cutoff and bot text in a friendship-survey appendix; the union/reciprocated choice is not recorded. | 041 | Use survey-specific wording and include the combine rule. |
| C11 | Low | Survey name step | Misspelled name: no suggestions and no "no match" message. | 032–033 | Fuzzy matching and a "No one called X — try your first name" hint. |
| C12 | Low | People table | The note says Betweenness and Closeness are "Hidden because they do not apply", but both columns are shown. | 099 | Make the note and the columns agree. |
| C13 | Low | Header and export names | "(union)" / "(reciprocated)" is dropped from "Analyzing:" and from file names, so two saves look the same. | 052 | Keep the full name. |
| C14 | Low | Mobile | Notice covers map nodes; "Paste ties" tab cut off; "Enter moves down a column, Tab moves across" shown on a phone; no feedback after Download. | 087, 071, 025 | Move the notice; mobile-specific hints; show "Saved to Downloads". |
| C15 | Low | Ego profile | "Diversity of contacts (Kind) 0 / same kind 0%"; "First and last seen" and "Strength … interaction volume" shown for survey data. | 100 | Hide these for surveys. |
| C16 | Low | Responses | Times shown in UTC only; the step count changes from "of 4" to "of 5"; "10 exceptions to the settings" shown when there are no settings. | 038, 109, 083 | Use local time; fixed step count; reword. |
| C17 | Low | Privacy | Pasted response text is unreadable encoded text, so Sam can't see what he is sending; nothing warns the professor before he shares raw nominations with the class. | 029 | Readable summary next to the code; a "sharing with participants" warning. |

**Unfamiliar terms and whether the app explained them:**
- **Explained:** density, modularity, transitivity, constraint, effective size, assortativity (with the 1/0 meaning), E-I index, union / reciprocated / as reported.
- **Not explained for first-years:** z, p, "double edge swaps", Louvain, "harmonic", "core number", the "name generators / name interpreters" step names, "Declared ties", "Tie amount from", "Visibility layers", "Kind", and the CAUTION markers that have no text.

## What worked well
- Clear share-link privacy explanation; the survey draft survives a reopen.
- Duplicate submission and non-response are reported plainly.
- Pasted email bodies with greetings and signatures parse.
- Dropping response files on Data with a combine-rule choice reproduces the network on another machine.
- Joining a roster CSV matched 10 of 10 names.
- The Groups view reads homophily correctly, with the random-network baseline.
- The "settings then fix the exceptions" way to record who knows whom, and the "Same person: Ben" merge prompt.
- Every whole-network and group statistic matched networkx exactly.