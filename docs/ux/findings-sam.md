I couldn't create `findings-sam.md`: the harness refused the write with "Subagents should return findings as text, not write report files". The full content is below for you to save at `SCRATCH/ux/findings-sam.md`.

The 98 screenshots (`.png`) are in `/private/tmp/claude-501/-Users-ericgladstone-My-Drive--eric-c-gladstone-gmail-com--Projects-Software-Org-Signal/28c7544b-bf65-4ca4-99cc-4f4f74736ee5/scratchpad/ux/sam/shots/`. Scripts and `console.log` are one level up in `ux/sam/`. I stopped my browser and the 8822 server; if another tester was sharing port 8822, it is down too.

**Top 10 findings**
1. **S1, blocker:** Sam's four accounts are never joined. Gmail, LinkedIn, X and WhatsApp each come in as a different owner (Felipe Ferreira, Jae Rasmussen, Elif Cuevas, Ximena Sato), so the network is four separate islands. "Who is who" says "No likely duplicates were found" and there is no manual merge anywhere, so "who connects my worlds" can't be answered.
2. **S2, major:** The Time view fails on its default setting with "914 windows requested; the limit is 520", and "Try again" repeats the same failure.
3. **S4, major:** Time's "Detected shifts" and the before/after comparison report when each export starts and ends as if behaviour changed. For example, "Largest decreases: Adaeze Rautio" only happens because the Gmail export ends on 5 Apr.
4. **S5, major:** The Ask intro says the model "only sees numbers the analysis engine computed". The disclosure, collapsed by default, says names and up to 240 characters of message text are sent, and it uses the alarming phrase "anthropic-dangerous-direct-browser-access header".
5. **S7, major:** WhatsApp warnings tell Sam to "set the time zone option", but the time zone, date order and "Your name" fields only appear after manually switching the importer away from Automatic, once per chat (56 times).
6. **S6, major:** The 56 WhatsApp chats become 56 identical cards titled "_chat.txt", repeating the same warnings. The review page is 30,600 px tall (50,478 px on a phone).
7. **S8, major:** Adding exports one at a time defaults to "Replace the current data", which would wipe what's already loaded.
8. **S9, major:** Jargon runs through every analysis view (betweenness, eigenvector "1.6e-106", E-I index, Cohen's d_z, VADER, TF-IDF, LDA, IANA, "43 declareds") with no plain-language layer.
9. **S11 and S12, major:** Topics are dominated by quoted email headers ("wrote, felipe, ferreira, feb…", 31%). The default tone comparison covers 47 of 2,701 messages without saying so, and the monthly tone line spikes on 1–2 messages.
10. **S10, major:** Groups runs whole-network statistics on one-person data with no caveat, and prints a broken sentence: "Rewired networks … give – (z –, p = 0.005)".

---

# Org Signal v2 usability test: persona "Sam" (curious journalist, personal exports)

Screenshots are in `sam/shots/` (relative to this file). Scripts and logs are in `sam/` (`console.log`). Tested `app/` via `node tools/serve.mjs . 8822` in headless Chromium at 1440x900 and 390x844 on 2026-10-02.

## Summary
Sam got all 59 personal exports (a Gmail Takeout, a LinkedIn export, an X archive and 56 WhatsApp chat zips) into the app in one go, and every one was detected correctly. The privacy promise holds: the page only ever contacted localhost.

The panels on each source saying what "this data can show" and what "it cannot show" are the best thing in the product for Sam.

Sam's central question, "what does *my* network look like and who connects my worlds?", cannot be answered. Each export's owner is treated as a different person (Felipe Ferreira, Jae Rasmussen, Elif Cuevas, Ximena Sato), so the network is four islands, and there is no way to merge them by hand. On top of that:
- The Time view errors out on its default setting.
- Once working, its charts are squashed onto a 2008–2025 axis by old LinkedIn connection dates.
- "Shifts" and before/after results mostly reflect when each export starts and ends.
- Topics are polluted by quoted email headers.
- The Ask intro understates what is sent.
- Most measures and statistics are in specialist language.

At phone width nothing scrolls sideways on the landing or network pages, but the review page is about 50k px tall, tooltips are clipped, and the selected-person panel sits about 1,100 px below the map.

## Task table
| # | Task | Outcome | Steps | Hesitation points |
|---|---|---|---|---|
| 1 | Landing | Partial. Privacy is clear; purpose is fuzzy. | 0 | "relational traces", "network you can defend", "ego-network interview"; Gmail, WhatsApp, LinkedIn and X are never named |
| 2 | Import all, together and one at a time | Both work. Together is smoother. One at a time defaults to Replace. | 3 clicks together (through a 10k px list and a 30k px review); 4 cycles one at a time | Owner address field; "Keep message text" vs "Headers only"; Import button at the bottom; 56 "_chat.txt" cards |
| 3 | What the data can and cannot show | Partial. Clear but buried, repeated 56 times, jargon. | Scroll the review | "Ego network", "centrality or brokerage", "Contexts", "declareds", warning codes |
| 4 | Identity merging | **Fail** | Who is who, People search, profile, Construction settings | "No likely duplicates were found…"; no manual merge |
| 5 | Find me, find the bridges, understand the warnings | Mostly fail. Sam appears 4 times; there are no bridges; the cautions read OK. | Find a person, select, open Betweenness explanation | Which dot is me? Why 4 islands? |
| 6 | Who I talk to most, and how it changed | Partial. "Strongest ties" works per identity; Time errors, is squashed, gives misleading shifts. | Profile; Time > Month; Before/after | "914 windows…", "z 155", "DZ", "Cohen's d_z" |
| 7 | Content and tone caveats | Partial. Caveats are readable; the default covers 2% of messages; topics polluted. | Affect, Keywords, Topics, Diffusion | VADER, TF-IDF, LDA; tone spikes on tiny months |
| 8 | Ask without a key | Partial. Disclosure is collapsed and contradicts the intro. | Expand "What leaves this computer" | names and 240-character snippets vs "only numbers" |
| 9 | Phone, tasks 1 and 5 | Landing and menu good; network awkward. | Menu > Network > search > select | Selection far below the map, clipped tooltip, Shift-click/keyboard help, 50k px review, title overflow |

## Findings
**S1, blocker (Data > Who is who / Network / People).** Each export's owner is a separate person ("ego: Felipe Ferreira", "ego: Jae Rasmussen", "ego: Elif Cuevas", WhatsApp "Ximena Sato"), giving "Components 4" and "Largest component 42%". The app says "No likely duplicates were found: no two people share an email address, platform id or full name across sources." There is no manual merge: the merge table in `src/ui/views/data.js` (around line 353) only renders when there are suggestions.
- Screens: `05-whoiswho.png`, `06-network.png`, `03-after-import.png`, `23-merge-review.png`
- Fix: an "Is this you?" step listing each source's owner, pre-checked as "These are all me"; a manual "Merge two people…" picker that is always available; "Same person as…" on the profile.

**S2, major (Time).** The default Week window shows "ERROR 914 windows requested; the limit is 520. Use a longer window." and "Try again" repeats it.
- Screen: `14-time.png`
- Fix: choose the window automatically, or make the button "Use monthly windows". Source: `src/analysis/time.js`.

**S3, major (Time / Content).** LinkedIn "Connected On" dates going back to 2008 squash all 2025 activity into a sliver. The Time page has no range control; the only one is a field inside Construction settings. The default before/after date is 31 Mar 2017.
- Screens: `14-time-month.png`, `18-construction-timerange-set.png`
- Fix: default to where the sources overlap and say so; add a range brush; put the default before/after date in the dense period.

**S4, major (Time shifts and before/after).** Rows such as "Activity 2025-01 Rise 155 baseline 0 z 155" mark the start of exports. "Largest decreases: Adaeze Rautio (-10)…" appear because Gmail ends on 5 Apr. There is no coverage caveat.
- Screens: `14-time-month.png`, `19-before-after.png`
- Fix: a coverage strip per source; suppress shifts near a source's start or end; a CAUTION when a source starts or ends inside a comparison period.

**S5, major (Ask).** The intro says "It only sees numbers the analysis engine computed", but the collapsed disclosure lists "people's names and keys … up to 240 characters of message text". It also includes "(Supported with the anthropic-dangerous-direct-browser-access header (sent automatically).)". "keys" is ambiguous on an API-key page, and "Remember on this device" is unexplained.
- Screens: `16-ask.png`, `16-ask-what-leaves.png`
- Fix: correct the intro; expand the disclosure (or show a 3-bullet summary); drop or footnote the header wording; change "keys" to "ids"; explain where the key is stored. Source: `src/ui/views/ask.js`, `src/llm/providers/anthropic.js`.

**S6, major (Data import and review).** The input list is 10,443 px with Import at the bottom. The review is 30,600 px (50,478 px on a phone). WhatsApp cards read "Whatsapp · Single conversation / _chat.txt", with no chat name and the same 3 warnings each time.
- Screens: `02-import-whatsapp.png`, `02-import-bottom.png`, `03-review-whatsapp.png`, `03-review-bottom.png`, `33-phone-review.png`
- Fix: group by format in an expandable table; use the chat title; show each warning once with "applies to 56 chats"; add a sticky action bar.

**S7, major (WhatsApp options hidden).** The warnings say "set the time zone option…" and "Set the date order option…". With the importer on Automatic there are no options. Only the explicit "WhatsApp chat export (95%)" choice reveals "Time zone of the exporting phone (IANA name…)", "Date order" and "Your name as it appears in the chat", once per file. The Gmail card shows its options on Automatic, so the behaviour is inconsistent.
- Screens: `25-wa-single-detected.png`, `25-wa-explicit-importer.png`
- Fix: show options on Automatic; one "apply to all WhatsApp chats" row; a time zone picker pre-filled from the browser; ask "Your name" once.

**S8, major (Data, adding sources).** After Gmail was loaded, adding LinkedIn defaulted to "When the import finishes: Replace the current data".
- Screen: `22-add-linkedin-detected.png`
- Fix: default to Add when data is loaded, or offer two explicit buttons and confirm before replacing.

**S9, major (jargon everywhere).** Suggested plain alternatives, keeping the technical term in the tooltip:

| On screen | Plain alternative |
|---|---|
| Ego / "Is ego: true" | "owner of this export" |
| Degree / In-degree / Out-degree | "contacts" / "contacts who reached out" / "contacts you reached out to" |
| Strength | "amount of contact" |
| Betweenness | "bridge score" |
| Closeness (harmonic) | "steps to everyone" |
| Eigenvector "1.6e-106" | "linked to well-linked people", shown as ≈0 (never scientific notation) |
| PageRank, Core number, Constraint, Effective size, Ego density | plain one-liners |
| Density, Reciprocity, Transitivity, Avg path length, Centralization, Gini, Modularity, Components | "interconnectedness", "goes both ways", "friends-of-friends", "steps apart", "one person dominates", "inequality", "cluster strength", "islands" |
| Louvain | "clusters found automatically" |
| Assortativity, E-I index, z/p, edge swaps | "Do people stay within their group?" plus a verdict sentence |
| DZ, P, sign-flip permutation, Cohen's d_z | "size of change", "could be chance?" |
| robust z / MAD | "unusual month" |
| VADER / compound | "word-list tone (−1 to +1)" |
| TF-IDF smooth idf | "words more typical of this group" |
| LDA / collapsed Gibbs | "word groups that co-occur" |
| IANA | a time zone picker |
| Events, Contexts, declareds, adjacency, layers | "messages/actions", "threads", "connections", "replied right after", "public/private/group" |

- Screens: `06-network.png`, `09-profile-felipe.png`, `13-groups.png`, `19-before-after.png`, `15-content-Topics.png`
- Fix: a plain-language mode (the default for personal data), with on-screen subtitles rather than hover-only explanations.

**S10, major (Groups).** The default is "Company (9)", which covers only 19% of people (all from LinkedIn). It shows "Rewired networks with the same degrees give – (z –, p = 0.005)", where the dashes stand in for missing values. There is no caveat about one-person data, and no "source/app" grouping; "Is phone number" and "Is saved contact" are offered instead.
- Screen: `13-groups.png`
- Fix: add the caveat, fix the placeholders, and add a Source grouping as the default. Source: `src/ui/views/groups.js`.

**S11, major (Content > Topics, profile).**
- Topic 2 (31%) is "wrote, felipe, ferreira, feb, mar, jan, tue, thu…".
- The profile's "Frequent words" are "felipe, ferreira, brightwellvale, example, wrote…".
- Screens: `15-content-Topics.png`, `09-profile-felipe.png`
- Fix: strip quoted replies, signatures and addresses; add names, weekdays and months to the stop-word list.

**S12, major (Content > Affect).**
- The default "Compare by: Company" covers 47 of 2,701 messages, and the line "100% of messages with text were scored" implies full coverage.
- The month chart has no year, and Aug (2 messages, 0.67) and Dec (1 message) are joined to months with about 600 messages.
- There is no person or source comparison.
- Screens: `15-content.png`, `15-content-Month.png`
- Fix: say "47 of 2,701"; default to Everyone or Source; fade months with fewer than 20 messages and show n; add the year; add Person and Source options. Source: `src/ui/views/content.js`.

**S13, minor (profile "Position over time").** It shows "Degree 0 / Strength 0 / Betweenness –" for active people. Likely a bug. Screen: `09-profile-scroll-1800.png`; source: `src/ui/views/people.js`.

**S14, minor (measure explanations clipped).** The text runs off the right edge ("between tw", "their ow") on both desktop and phone. Screens: `08-betweenness-click.png`, `38-phone-betweenness-pop.png`. Fix: wrap, clamp to the viewport, flip near the edge.

**S15, minor (dataset name).** The name is all 59 filenames joined with "+", about 20 lines. A huge toast repeats it. On a phone the heading overflows (scrollWidth 663 vs 390).
- Screens: `04-loaded.png`, `05-whoiswho.png`, `34-phone-loaded.png`, `34-phone-loaded-notoast.png`
- Fix: a short editable name such as "Gmail + LinkedIn + X + 56 WhatsApp chats"; a short toast.

**S16, minor (framing).** "3 sources are personal (ego) views" leaves out the 56 WhatsApp chats, and the text never says "you". Screen: `03-after-import.png`.

**S17, minor (Methods appendix).** Personal Gmail is labelled "email (workplace, email, workplace context)". Screen: `17-methods.png`.

**S18, minor (developer-speak in import evidence).** "X archive manifest.js (window.__THAR_CONFIG)", "_chat.txt: 86% of the first lines are WhatsApp message headers", and inline codes `identity-by-name`, `unresolved-parent`.
- Screens: `02-import-linkedin-x.png`, `03-review-x.png`
- Fix: "Recognised as X archive ✓" with a "Why?" disclosure.

**S19, minor (data lost on reload).** A reload erases everything silently. "Save project" exists only under Methods & Export.
- Screen: `20-network-after-reload.png`
- Fix: "Nothing is stored; closing this tab erases it", plus a prompt before leaving the page.

**S20, minor (landing).** "Start with relational traces" and "a network you can defend"; supported personal sources are not named; "Processed locally" is tiny.
- Screens: `01-landing.png`, `30-phone-landing.png`
- Fix: a plain promise sentence, named sources, "how to get your export" links, and a more prominent privacy line.

**S21, minor (network on phone).** The SELECTED panel is about 1,117 px below the map. The help says "Shift-click…" and "Keys: plus and minus zoom…", which don't apply on touch.
- Screens: `37-phone-selected.png`, `36-phone-network.png`
- Fix: a bottom sheet for the selection; touch-specific help text.

**S22, polish (wording).** "1 pieces of evidence"; "43 declareds"; "Linkedin" and "Whatsapp"; the "declared" rule described as survey data when it means LinkedIn connections. Screens: `10-construction.png`, `03-after-import.png`.

**S23, polish (odd attributes).** "Is phone number" and "Is saved contact" appear in every menu and column. The profile shows "Diversity of contacts (Is phone number) 0". Screens: `09-profile-felipe.png`, `12-profile-jae.png`. Fix: hide boolean technical attributes by default.

**S24, minor (name variants).** "Jae" (from the unsaved "~ Jae" chat) and "Jae Guerrero" are not suggested as a possible match. Screen: `12-profile-jae.png`. Fix: low-confidence suggestions, unchecked by default.

**S25, minor (console errors).** Both are in `sam/console.log`:
- `Sigma: Container has no width`, a page error during load.
- `<path> attribute d: Expected number, "MNaN,…"`, from a Time or Content chart.

No failed requests, and no requests to any host other than localhost.

**S26, polish.** "Mail/All mail Including Spam and Trash.mbox" is shown while "Include Gmail Spam and Trash" is unticked. Fix: add "(spam and trash left out)".

**S27, polish (email import options).** "Keep message text" vs "Headers only" reads as contradictory; "Mailbox owner address" has no explanation; bulk mail is included by default.
- Screen: `21-one-gmail-detected.png`
- Fix: one radio group; label the field "Your email address (helps us recognise you)".

## What worked well
- **Privacy:** only `localhost:8822` was contacted, and nothing persists after a reload.
- **Detection:** all 59 inputs were detected correctly. Importing everything at once and adding them one at a time with "Add to the current data (merge)" gave identical results (228 people, 3,062 events).
- **Can/cannot panels:** "This data can show / It cannot show" for each source is honest and exactly the right framing.
- **CAUTION badges:** they give a readable reason, for example "Some sources are one person's export; their owners look more central than they are."
- **"Strongest ties":** it directly answers "who do I talk to most" ("Yolanda Grünewald 104 · both ways · reply, to, cc").
- **Caveat text:** the sentiment and topic caveats are well written.
- **Ask disclosure:** once expanded, "What leaves this computer" is specific.
- **Phone:** no sideways scrolling on the landing or network pages, a clean hamburger menu, and network search works.