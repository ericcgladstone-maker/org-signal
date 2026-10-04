# Landing (Data view) copy — Eric Gladstone, 2026-10-04

Eric's text for the app's landing page (the Data view) and shell, saved verbatim. It supersedes the Data section and the shell section of `copy-audit-eric-2026-10-04.md` where they differ. Eric: "This is prose, and should have zero bearing on code... this is a research and learning tool. Not a product. So... things like 'who talks to who' is trivializing."

---

Masthead
Org Signal
Social network analysis in the browser
Navigation
Data
Import empirical records or open a saved project
Build
Draw, interview, survey, or paste a network
Generate
Synthetic networks with known structure
Network
Network map and whole-network measures
People
Person-level measures, ranks, and profiles
Groups
Within- and between-group structure
Content
Tone, words, topics, and diffusion
Time
Network structure over time
Methods & Export
Methods, network files, figures, and projects
Ask
Questions, reports, and content coding with an API key
Learn
Definitions, worked examples, and limitations
Interpretive notes: on
Data
Start with a network
I built Org Signal as a browser-based environment for teaching and conducting social network analysis. You can construct a network directly, generate one whose underlying structure is known, work with a published network, or import empirical records and define how those records become ties.
The same analysis environment then provides network visualization, person- and group-level measures, comparisons with random networks, uncertainty in rankings, change over time, content analysis, and export of networks, figures, tables, and methods documentation.
The analysis engine is built for research use. Its network measures have been checked against NetworkX, exact calculations, and closed-form reference cases across roughly 21 million comparisons. Statistical procedures are calibrated through simulation, and generated networks can be compared with the known structures from which they were produced.
Files are read locally in the browser.
Research context, validation, and current limits ↗
Choose a way in
Draw or construct a network
Draw people and ties directly, conduct an ego-network interview, collect a roster or perceived-network survey, or paste a tie list.
Open Build
Generate a network with known structure
Create a synthetic organization or online community with specified departments, brokers, silos, change over time, or diffusion processes, then compare the analysis with the structure used to generate it.
Open Generate
Analyze empirical data
Import communication, calendar, messaging, social-platform, survey, spreadsheet, or standard network files. Org Signal reviews what each source contains and how its records can be used to construct ties.
Choose files to import
Work with a published network
Load a classic network with a documented substantive result and reference values that can be reproduced within Org Signal.
Browse classic datasets
New to network analysis? Learn the ideas
Analyze empirical data
Files are read and analyzed in this browser. Loaded data remain in the current tab unless you save an Org Signal project. Build drafts can be retained in this browser, and an API key is stored only when you explicitly choose to remember it.
Drop files, zips, or folders here
You can load an export as downloaded, a folder containing several exports, individual files, or multiple related files at once.
Choose files
Choose a folder
Org Signal reads Slack, Microsoft Teams, email, Gmail Takeout, Google and Outlook calendars, WhatsApp, LinkedIn, X, Telegram, iMessage, Messenger, Instagram, Discord, Reddit, Bluesky, Mastodon, Threads, survey responses, Network Canvas data, GraphML, GEXF, GML, Pajek, UCINET DL, ordinary who-to-whom tables, and Org Signal project files.
How to get an export
[existing platform-specific instructions]
Classic datasets
Org Signal includes published networks that can be used to learn measures, reproduce documented results, and compare an analysis with a known reference case.
I would collapse this section by default, or show perhaps the first four and then a Show all 11 datasets control. The current uninterrupted run of eleven cards dominates the home page.
The individual descriptions are largely good already. I would tighten them slightly and make their function consistent.
Zachary’s karate club
1977 · 34 people · 78 ties · One-mode
Friendships among 34 members of a university karate club that later split into two groups following a conflict between the instructor and administrator.
Load
Padgett’s Florentine families
1993 · 16 families · 35 ties across two relations · One-mode
Marriage and business ties among leading families in fifteenth-century Florence, together with family wealth and representation on the city council. The network opens on marriage ties. Construction settings can switch to business ties or combine the two relations.
Load
Krackhardt’s high-tech managers
1987 · 21 people · advice, friendship, and reporting ties · One-mode
Twenty-one managers in a small technology firm, with advice, friendship, and reporting relations plus each manager’s perception of the network.
Load
Advice perceptions in Build
Friendship perceptions in Build
Sampson’s monastery
1968 · 25 people · five time points · One-mode
Interpersonal nominations among novices in a New England monastery, observed at five points before and during a conflict that ended with several members leaving.
Load
Kapferer’s tailor shop
1972 · 39 people · two time points · One-mode
Interaction among 39 workers in a tailor shop in Kabwe, Zambia, observed twice across a seven-month period that included a wage dispute.
Load
Newcomb’s fraternity
1961 · 17 people · repeated rankings · One-mode
Seventeen men who began as strangers lived together at the University of Michigan and ranked one another weekly from most to least liked.
Load
Bank wiring room
1939 · 14 people · multiple relations · One-mode
Fourteen workers in Western Electric’s bank wiring room, with observed friendship, antagonism, games, help, arguments, and job trading.
Load
Davis’s Southern Women
1941 · 18 women · 14 events · 89 affiliations · Two-mode
Attendance by 18 women at 14 informal social events over a nine-month period. The original data form a two-mode network of women and events.
Load
Les Misérables co-appearances
1993 · 77 characters · 254 ties · One-mode
Characters in Victor Hugo’s novel, tied when they appear in the same chapter. Tie weight records the number of chapters shared.
Load
Lusseau’s bottlenose dolphins
2003 · 62 dolphins · 159 ties · One-mode
Associations among 62 bottlenose dolphins in Doubtful Sound, New Zealand, based on repeated observations from 1994 to 2001.
Load
Enron email
148 people · 21,052 messages · One-mode
Email headers among the 148 Enron employees whose mailboxes were released, covering 1998 to 2002. The included data contain sender, recipients, time, message identifiers, and thread identifiers. Message text and subject lines are excluded.
Load
Synthetic networks
You can also generate organizations and online communities whose underlying structure is specified in advance. Generated worlds can include departments, brokers, silos, reorganizations, departures, communities, content patterns, and diffusion processes.
Org Signal writes these worlds into the kinds of records produced by the selected communication medium, then reconstructs the network through the same import and construction pipeline used for empirical data. The recovery check compares the resulting analysis with the structure used to generate the world.
Open Generate
About Org Signal
Org Signal is part of the Networks Lab at Graystone Industries. The Networks Lab page describes the research logic behind the system, validation procedures, current limitations, teaching materials, and source documentation.
Read about Org Signal in the Networks Lab ↗
Source and documentation ↗
A few specific judgments on the current version:
“Map who talks to whom” should go. It is catchy, but it understates what you built. Ego networks, affiliation networks, roster surveys, perceived networks, hand-drawn structures, and synthetic systems are all broader than “who talks to whom.”
I would also remove “Private” as a standalone badge. The sentence about local processing is more informative than the label.
I strongly prefer “Synthetic networks with known structure” to “Synthetic organizations with known answers.” “Known answers” sounds pedagogical in a way the generator no longer deserves. You know the data-generating structure, which permits recovery analysis. That is more precise.
Similarly, I would change “Classic datasets...known answer to check your analysis against” to “documented result and reference values.” Same reason. There usually is not one singular “answer.”
And I think the Graystone link should be considerably more prominent than the current “About Org Signal, your data and its known limits” link tucked after “New to network analysis?” That is really the route for someone asking, what did Eric build here and why? It deserves to appear in the opening orientation.
The architecture then makes sense even if someone never saw Graystone:
Org Signal tells me what I can do and gets me working.
Networks Lab tells me what the system is intellectually and how it was built/validated.
GitHub tells me exactly how it works.
That feels like the clean division.
