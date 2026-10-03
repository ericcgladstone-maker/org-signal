# Classic datasets

A library of published, teachable networks that load with one click from the Data start page and from Learn. Each one carries a card: what the data are, what the original study found, a known answer to check an analysis against, a suggested assignment (mapped to the Networks 101 set in `docs/ux/networks101-assignments.md`), the citation, the license and an ethics note where one is due. Network's "Who stands out" block shows the card's title and "what to look for" lines (`ds.meta.example`), as it does for worked examples.

Built 2026-10-03. Owner of this area: datasets (`data/**`, `tools/datasets/**`, `src/core/classic.js`, `test/datasets/**`, this file, and the library sections in `src/ui/views/data.js` and `src/ui/views/learn.js`, `src/ui/views/learn/classic.js`).

## Summary

| id | Dataset | Distribution | Nodes | Ties (published) | Ties (converted) | Mode | File |
|---|---|---|---|---|---|---|---|
| `karate` | Zachary's karate club (1977) | bundled | 34 | 78 | 78, valued 1-7 (sum 231) | one | 8 KB |
| `florentine` | Padgett's Florentine families | bundled: marriage; pending: + business, attributes | 16 | 20 marriage, 15 business | 20 (bundled); 20 + 15 (pending) | one | 3 KB / 5 KB |
| `krackhardt` | Krackhardt's high-tech managers (1987) | pending | 21 | 190 advice, 102 friendship, 20 reports-to; 21 perceived matrices each | same | one | 22 KB + 43 KB perceptions |
| `sampson` | Sampson's monastery (1968) | pending | 25 (18 at T4) | like T2-T4: 55, 57, 56 (UCINET) | like T1-T5: 39, 55, 57, 56, 21; dislike 37, 49, 48, 47, 21 | one | 39 KB |
| `kapferer` | Kapferer's tailor shop (1972) | pending | 39 | sociational 158 / 223, instrumental 109 / 147 | same | one (mixed direction) | 59 KB |
| `newcomb` | Newcomb's fraternity (1961) | pending | 17 | 15 weekly rankings of 16 | 15 x 272 = 4,080 valued arcs | one | 272 KB |
| `wiring` | Bank wiring room (1939) | pending | 14 | games 28, arguments 19, friendship 13, antagonism 19, helping 24 arcs, job trading 7 arcs | same | one (mixed direction) | 11 KB |
| `davis` | Davis's Southern Women (1941) | bundled | 18 women + 14 events | 89 attendances | 89 | two | 10 KB |
| `lesmis` | Les Miserables co-appearances | bundled | 77 | 254, weights sum 820 | same | one | 18 KB |
| `dolphins` | Lusseau's dolphins (2003) | bundled | 62 | 159 | 159 | one | 11 KB |
| `enron` | Enron email, core employees, headers only | pending | 148 | (see Enron) | 21,052 messages, 2,440 directed ties | one | 0.6 MB gzip |

"Published" means the count in the original publication or the standard distribution (UCINET IV, networkx, Newman's data page), checked independently with networkx on the raw files (`tools/datasets/verify.py`).

## Licenses: what is bundled and why

Most classic network datasets carry no license. They were printed in books and articles decades ago and have been passed around in software collections since. The rule applied here: **bundle only when a distributor or author clearly allows redistribution; otherwise build the file but do not ship it ("pending") until the owner decides.**

Bundled (clear terms):
- **karate, davis, florentine (marriage)**: shipped inside networkx 3.2.1 (BSD-3-Clause) as `karate_club_graph`, `davis_southern_women_graph`, `florentine_families_graph`; karate is also on Mark Newman's page ("free for scientific use ... the original authors have already made the data freely available").
- **lesmis**: Stanford GraphBase data, "public-domain sources for all programs and data" (Knuth, https://www-cs-faculty.stanford.edu/~knuth/sgb.html). The `jean.dat` header asks that the file itself not be changed; we ship a derived network (Newman's GML of it), not the file.
- **dolphins**: Mark Newman's page, posted "with David Lusseau's permission", "free for scientific use".

Pending (terms unclear; built into `data/classic-pending/`, never deployed):
- **florentine business ties and attributes, krackhardt, sampson, kapferer, newcomb, wiring**: from the UCINET IV dataset collection (Borgatti, Everett and Freeman; mirrored by Batagelj and Mrvar's Pajek site) and the Pajek ESNA collection. Neither states a license. The UCI Network Data Repository's copies say "If the source of the data set does not specified otherwise, this data set is protected by the Creative Commons License by-nc-nd/2.5" (checked on its kaptail, sampson and davis pages): a repository label, but one that would forbid our derived files. Several are also inside GPL-licensed R packages (NetData, ergm, networkdata), which does not settle the original rights either.
- **enron**: made public by FERC during its investigation; CMU distributes it "as a resource for researchers who are interested in improving current email tools" with no license. Redistribution of real people's communications also needs an ethics decision, not only a legal one (see Enron).

Alternatives for the owner, per pending dataset: (1) decide they may ship (facts printed in the original works, redistributed freely for decades) and run `node tools/datasets/build.mjs --raw <dir> --bundle id,id` (moves them into `data/classic/`); (2) keep them out and let users load the original file themselves: every UCINET / Pajek source file imports through Data as is (the network-files importer reads DL and Pajek), though without the card, attributes from other sources and tie fields; (3) ask the distributors (Analytic Technologies for UCINET; the Pajek authors) for permission. A load-on-demand fetch from the public source is not possible in the browser today: none of the sources sends CORS headers, and the Pajek server was unreachable on 2026-10-03.

**Do not commit `data/classic-pending/` to a public repository** until the decision is made; `tools/stage.sh` refuses to stage it.

## Files and API

```
data/classic/index.json             manifest (all 11 entries, bundled and pending)
data/classic/<id>.json              bundled datasets (toJSON from src/core/model.js)
data/classic-pending/<id>.json[.gz] pending datasets; krackhardt-css.json (perceptions)
tools/datasets/fetch.sh <raw>       download every raw file and prepare derived inputs
tools/datasets/build.mjs --raw <raw> [--bundle ids]   convert, write files and the manifest
tools/datasets/cards.mjs            card text (description, findings, lookFor, citation, license)
tools/datasets/parsers.mjs          UCINET DL, Pajek, GML readers
tools/datasets/export_networkx.py   networkx graphs to JSON
tools/datasets/export_extra.py      kracknets attributes, dolphins Girvan-Newman split
tools/datasets/enron_headers.py     stage 1: headers of every message in the CMU tarball
tools/datasets/enron_subset.py      stage 2: the core-employee subset
tools/datasets/verify.py <raw>      independent networkx checks on the raw files
test/datasets/classic.test.js       counts, attributes, known values, lookFor numbers
```

`src/core/classic.js` (runs in Node and the browser):

- `listClassic({ base, pending })` -> manifest entries, each with `loadable` (bundled, or pending allowed).
- `loadClassic(id, { base, pending })` -> a Dataset whose `meta.example` is the card: `{ classic, title, lookFor[], description, findings, knownAnswers[{ key, meaning }], assignment { a[], text }, citation, sourceUrls[], license, ethics, distribution }`. Network's "Who stands out" reads `title` and `lookFor`.
- `loadClassicPerceived(id, relation)` -> a perceived-network study in the model of `src/builders/perceived.js` (Krackhardt: `advice`, `friendship`).
- `classicExample(entry)`, `classicSize(bytes)`.

Manifest entry fields: `id, title, year, description, nodes, ties, tiesBy {relation (time): count}, mode ('one'|'two'), modes?, relations[], directed (true|false|'mixed'), valued, valuedNote?, timePoints[], knownAnswers[], findings, assignment, citation, sourceUrls[], license, ethics, lookFor[], distribution ('bundled'|'pending'), file, bytes, perceived?, pendingVersion?` (Florentine: the fuller pending build).

In the app, the address flag `?classic=pending` lists pending datasets as loadable and fetches them from `data/classic-pending/` (development server only; the deployed build does not have the files).

## Conversion conventions

- Every tie is one `declared` event (one per relation and time point), actor to target with role `declared`; Davis uses `addAffiliation` (role `member`); Enron uses `message` events with `to`/`cc`/`bcc` targets.
- Undirected relations are a source with `directed: false` and one event per pair; directed relations a source with `directed: true`. Kapferer and the bank wiring room have both, as two sources of the same dataset.
- The relation, time point and raw value are tie fields (`events.attrs`), declared in `source.tieFields`, so Settings can filter and weigh by them. Where combining relations or time points by default would mislead, the source sets `defaultTieFilters` (shown and removable in Settings): Florentine (pending) marriage; Krackhardt advice; Sampson like at T4; Kapferer sociational; Newcomb rank at most 3; bank wiring friendship.
- Sources are `format: 'classic'`, `family: 'classic'`, `view: 'full'`, `variant: <id>`; `meta.createdAt` is fixed so builds are reproducible.
- Dates: real where the source has them (Davis's events, Enron). Kapferer and Newcomb have placeholder calendars (below) because the Time view needs dates; the true time point is always also a tie field. Sampson has no dates (wave is a tie field only).

## Datasets

### Zachary's karate club (`karate`, bundled)

- Citation: Zachary, W. W. (1977). An information flow model for conflict and fission in small groups. Journal of Anthropological Research, 33(4), 452-473.
- Opened: networkx `karate_club_graph` documentation and source (networkx 3.2.1, installed); Netzschleuder `https://networks.skewed.de/api/net/karate` and `.../net/karate/files/78.csv.zip`; Newman's karate.zip (archived copy); UCINET `zachary.dat` (archived copy).
- Conversion: from networkx: 34 nodes, 78 edges with `weight` (Zachary's strength, the ZACHC matrix: number of contexts, 1-7, sum 231), `club` -> attribute `faction`. Labels: `1 Mr. Hi`, `34 John A.`, `Member k`; attributes `number`, `faction`, `role`.
- Verified: 34 / 78 equal UCINET ZACHE (78) and Newman's GML; density 0.139037, transitivity 0.255682, betweenness Mr. Hi 0.437635 and John A. 0.304075 (networkx and app agree to 1e-6); faction E-I index -0.718; Louvain (seed 1) gives 4 communities with one member in a community dominated by the other faction.
- Discrepancies: Netzschleuder has two versions, 77 and 78 edges, "due to an ambiguous typo in the original study"; we use 78 (networkx, UCINET, Newman). The `faction` here is the club each member joined (networkx `club`, 17 / 17); Netzschleuder's `groups` agree exactly. Zachary's own ideological faction assignment differs for member 9, the one his model mispredicted.

### Padgett's Florentine families (`florentine`, bundled marriage; pending full)

- Citation: Padgett, J. F., & Ansell, C. K. (1993). Robust action and the rise of the Medici, 1400-1434. AJS 98(6), 1259-1319. Subset of Breiger & Pattison (1986), Social Networks 8, 215-256.
- Opened: networkx `florentine_families_graph`; UCINET `padgett.dat`, `padgw.dat` and the UCINET IV dataset page (archived copies); Netzschleuder `florentine_families` metadata.
- Bundled conversion: networkx's 15 families and 20 marriage ties, plus Pucci (the 16th family of the standard subset, no marriage ties) as an isolate, so counts and normalization match UCINET and most textbooks.
- Pending conversion: PADGM (marriage, 20) and PADGB (business, 15) from UCINET; PADGW gives `wealth` (1427, thousands of lira), `priorates` (seats 1282-1344) and `ties_all_116` (ties in the full 116-family data). PADGW lists the families in a different order from PADGETT; rows are matched by name. PADGW gives 0 priorates for six families (Barbadori, Lamberteschi, Pazzi, Tornabuoni, Ginori, Pucci); whether some of these zeros mean "none" or "not recorded" is not stated, and we keep UCINET's coding.
- Verified: networkx's marriage edges equal UCINET's PADGM exactly; Medici betweenness 0.452381 (16 families; 0.521978 with networkx's 15), Guadagni 0.220635, Albizzi 0.184127; degrees Medici 6, Strozzi 4, Guadagni 4; Medici wealth 103, priorates 53, Strozzi 146, 74.

### Krackhardt's high-tech managers (`krackhardt`, pending)

- Citation: Krackhardt, D. (1987). Cognitive social structures. Social Networks, 9(2), 109-134. https://doi.org/10.1016/0378-8733(87)90009-8 (the UCINET page gives pages 104-134; the journal says 109-134).
- Opened: UCINET `krackad.dat`, `krackfr.dat` (21 matrices of 21 x 21 each); CRAN archive `NetData_0.3.tar.gz` (`kracknets.rda`: edge lists and attributes AGE, TENURE, LEVEL, DEPT; GPL-2, "ported from UCINet").
- Conversion: advice and friendship are each manager's own row of their own matrix (self-reports); reports-to (20) and the attributes from NetData. `level`: CEO / Vice president / Manager; `department`: 1-4, the CEO none. All relations directed, tie field `relation`, default filter advice.
- Perceptions: `krackhardt-css.json` holds both relations as perceived-network studies (21 people, 21 informants, each informant's full matrix as `ties`). Friendship is not marked mutual: the question was one-way ("Who is a friend of X?") and the informants' matrices are not symmetric.
- Verified: self-reports equal the NetData edge lists exactly (190 advice, 102 friendship); advice density 0.452381, reciprocity 0.473684; Manager 2 has the most advice in-ties (18); Manager 18 the highest advice betweenness (0.234). Perceptions: consensus (at least half of 21) 95 ties, LAS union 276, LAS intersection 129 (numpy on krackad.dat and the builder agree); scored against the consensus of the other 20, Manager 8 perceives advice best (Jaccard 0.58).
- Discrepancy: NetData's documentation describes a unionization campaign at "Silicon Systems"; that is Krackhardt's 1992 study of a different firm. The 21-manager data are the 1987 CSS study; the card says only that.

### Sampson's monastery (`sampson`, pending)

- Citation: Sampson, S. F. (1968). A novitiate in a period of change. PhD dissertation, Cornell. Coded by W. de Nooy for de Nooy, Mrvar & Batagelj, Exploratory Social Network Analysis with Pajek (2005), ch. 4.
- Opened: Pajek ESNA page `esna/sampson.htm` and `Sampson.zip` (archived copies; "Copyright: No living author traced. Main author has deceased."); UCINET `sampson.dat` and its description.
- Conversion: `Sampson.paj` has 25 novices and valued arcs with Pajek time intervals over five time points (T1-T5); +3..+1 = most / second / third liked, -3..-1 = least liked. Each arc and time point is one event: tie fields `relation` (like / dislike), `wave` (T1-T5, ordered), `choice` (1 = first choice); weight 3 for a first choice. Factions from `Sampson_factions_T4.clu` (Young Turks 7, Loyal Opposition 5, Outcasts 3, Interstitial 3), `cloisterville` (attended the minor seminary) from the 25-vertex partition, `outcome` from UCINET's description (expelled 2, 3, 17, 18; the rest left; 5, 6, 9, 11 stayed). "Ramuald" in the Pajek file is spelled Romuald (Sampson's and UCINET's ROMUL).
- Verified: liking ties T2, T3, T4 = 55, 57, 56, exactly UCINET's SAMPLK1-3 (which the UCINET page says are three of the time points; SAMPLK3 was collected with the other T4 relations); T1 39, T5 21; faction E-I index -0.357, assortativity 0.542; Gregory, Bonaventure and Winfrid each liked by 6 at T4.
- Discrepancy: UCINET's ten matrices cover 18 novices and relations other than liking (esteem, influence, praise); the ESNA file covers liking and disliking only, for 25 novices at five times. We use ESNA for liking over time; esteem, influence and praise are not included.

### Kapferer's tailor shop (`kapferer`, pending)

- Citation: Kapferer, B. (1972). Strategy and transaction in an African factory. Manchester University Press.
- Opened: UCINET `kaptail.dat` and description; UCI Network Data Repository kaptail page (license note); ergm's `kapferer` documentation.
- Conversion: KAPFTS1/2 (sociational, symmetric) as an undirected source, KAPFTI1/2 (instrumental, directed) as a directed source; tie fields `relation` and `time` (Time 1, Time 2); default filter sociational. Dates by month: Time 1 = 15 Jun 1965, Time 2 = 15 Jan 1966 (the 15th is a placeholder).
- Verified: 158, 223, 109, 147 ties as published; sociational density 0.213225 and 0.300945; most sociational ties: Chisokone (24) at Time 1, Mukubwa (25) at Time 2.
- Discrepancies: UCINET says the two periods were "seven months apart" and each "over a period of one month"; ergm dates the first collection June to August 1965 and the second September 1965 to January 1966. We date by month, seven months apart, starting June 1965, and say so on the card. ergm reports 43 workers in all, 39 present at both times; the UCINET matrices have the 39.

### Newcomb's fraternity (`newcomb`, pending)

- Citation: Newcomb, T. M. (1961). The acquaintance process. Nordlie, P. G. (1958), PhD dissertation, University of Michigan.
- Opened: UCINET `newfrat.dat` and description; visone wiki page (same source).
- Conversion: 15 matrices NEWC0-NEWC15 (week 9 missing), each a full ranking of the 16 others (1 = most liked). Each ranking is an arc with weight 17 - rank (first choice 16, last 1) and tie fields `rank`, `week`. Default filter: rank at most 3 (each man's top three), because the full rankings make a complete graph each week. Dates: week w is shown as 24 Sep 1956 + w weeks (placeholder; only week numbers are in the source).
- Verified: 15 x 272 arcs; top-three network over the term: 129 ties, reciprocity 0.558; top-three reciprocity in week 0 0.470588, in week 15 0.352941 (networkx agrees).
- Discrepancy: UCINET dates the cohort to fall 1956; Newcomb's project ran 1953-1956 with two cohorts. We follow UCINET.

### Bank wiring room (`wiring`, pending)

- Citation: Roethlisberger, F. J., & Dickson, W. J. (1939). Management and the worker. Homans, G. C. (1950). The human group.
- Opened: UCINET `wiring.dat` and description; Steiber (1981), Mid-American Review of Sociology 6(1), 17-40 (KU ScholarWorks PDF), for Homans's cliques.
- Conversion: RDGAM (games), RDCON (window arguments), RDPOS (friendship), RDNEG (antagonism) as an undirected source; RDHLP (helping) and RDJOB (job trading, valued: tie field `times`) as a directed source; default filter friendship. Attributes: `role` (inspector, wireman, solderer), `clique` (A, B, Neither), `clique_note` (W2 on the edge of A, W6 on the edge of B).
- Cliques: Homans as reported by Steiber: "two cliques of five and four members" plus five outsiders; clique A = W1, W3, W4, S1, I1, clique B = W7, W8, W9, S4; "W5, S2 and I3 as non-participants with either of the two larger cliques"; W2 "had little to do with" the first clique; W6 "in many ways an outsider" to the second.
- Verified: 28, 19, 13, 19, 24, 7 ties as published; friendship clique E-I index -0.846 (12 of 13 within a clique); antagonism +0.579.
- Discrepancy: UCINET's text names the solderers "S1, S2 and S3" but its labels are S1, S2, S4; we use the labels.

### Davis's Southern Women (`davis`, bundled, two-mode)

- Citation: Davis, A., Gardner, B. B., & Gardner, M. R. (1941). Deep South. Freeman, L. C. (2003). Finding social groups: A meta-analysis of the Southern Women data.
- Opened: networkx `davis_southern_women_graph`; UCINET `davis.dat`; Freeman (2003) PDF (archived `moreno.ss.uci.edu/85.pdf`); manynet's `ison_southern_women` (documentation and `SouthernWomen.paj`, which labels events with DGG's dates).
- Representation: the two-mode contract in `docs/CONTRACTS.md` (`declareTwoMode(b, ['Women', 'Events'])`, `addAffiliation`): women are mode 0, events mode 1, each attendance a `declared` event with a `member` target, dated.
- Event dates: DGG's Figure 1 gives month/day (E1 6/27 ... E14 8/3); the year 1936 is manynet's ("as reported in the Old City Herald in 1936"). Event labels: `E8 (16 Sep)`.
- Known answers (Freeman 2003, section 4.1, quoting DGG): groups 1-9 and 9-18 (Ruth, 9, "claimed by both") -> `dgg_group`; core 1-4 and 13-15, primary 5-7, 11-12, secondary 8-9 and 9-10, 16-18 -> `dgg_position`; the consensus of 21 analyses, 1-9 and 10-18 -> `consensus_group`.
- Verified: 18 x 14, 89 attendances; E8 drew 14 women; Evelyn, Theresa and Nora attended 8 each; the women projection has 139 pairs (networkx `weighted_projected_graph`); Louvain on the two-mode network finds 2 communities.
- Discrepancies: networkx spells "Myra Liddel" and "Katherina Rogers", manynet "Myra Liddell" and "Katherine Rogers"; UCINET (after Breiger) has "Myrna" (Freeman notes the renaming). We keep networkx's names.

### Les Miserables (`lesmis`, bundled)

- Citation: Knuth, D. E. (1993). The Stanford GraphBase. Network as in Newman & Girvan (2004), Phys. Rev. E 69, 026113.
- Opened: Newman's `lesmis.zip` (archived), Knuth's SGB page, `jean.dat` (ascherer/sgb on GitHub), networkx `les_miserables_graph`.
- Conversion: Newman's GML, 77 characters, 254 edges, `value` = chapters shared -> weight and tie field `chapters`. CamelCase names split for labels ("Mlle Baptistine"). Knuth's one-line descriptions are kept as `platformIds.knuth` (an attribute with one value per character would be offered as a grouping).
- Verified: 77 / 254 / weight sum 820 (networkx identical); Valjean degree 36, strength 158, betweenness 0.569989; Myriel betweenness 0.176842 with 10 contacts.

### Lusseau's dolphins (`dolphins`, bundled)

- Citation: Lusseau, D., et al. (2003). Behavioral Ecology and Sociobiology 54, 396-405.
- Opened: Newman's `dolphins.zip` (archived) and its `dolphins.txt`; Netzschleuder metadata; Newman & Girvan (2004), arXiv cond-mat/0308217; the community-graphs repository (vlivashkin, MIT) labels.
- Conversion: 62 dolphins, 159 ties. `split_2004`: the first split of the Girvan-Newman algorithm (networkx `girvan_newman`, the method of the paper), 41 and 21, which Newman and Girvan say "appears to correspond to a known division of the dolphin community". No published table lists the field split; Fig. 11 of the paper shows it.
- Verified: density 0.084082, transitivity 0.308776, SN100 betweenness 0.248237, Beescratch 0.213324; split E-I index -0.925 (6 ties cross).
- Discrepancy: community-graphs' "ground truth" labels (42 / 20) differ from the Girvan-Newman split in one dolphin, SN89; its source is not documented, so we use the reproducible split.

### Enron email, core employees, headers only (`enron`, pending)

- Sources: CMU Enron Email Dataset, May 7, 2015 version (`https://www.cs.cmu.edu/~enron/enron_mail_20150507.tar.gz`, 443 MB, 517,394 message files in 150 mailboxes); EnronData.org custodian list (`edo_enron-custodians-data.html`, CC BY 3.0 US: 148 people, names and positions). Paper: Klimt & Yang (2004).
- Which subset and why: the 150 CMU mailboxes are the "core employees" every study of the corpus starts from; EnronData.org shows they belong to 148 people (`phanis-s` duplicates `panus-s`, `whalley-l` duplicates `whalley-g`; `crandell-s`, `rodrique-r` are misspellings). Only messages from one of them to at least one other (to / cc / bcc) are kept, with only the core recipients. All of 1998-2002 fits (0.6 MB gzip), so no time window was needed.
- Addresses: each person's addresses are found in their own mailbox: From addresses of their sent folders and receiving @enron.com addresses, kept when the address matches the surname and the first name, a nickname (Mike for Michael, Larry for Lawrence, Bill for William, ...) or an initial, and accounts for at least 5% of that mailbox. Initials are not accepted when the mailbox also holds another first name with the same surname (`hodge-j` has John and Jeffrey T. Hodge). Addresses such as `.taylor@enron.com` (mangled by the conversion) are not used. Messages an assistant sent from an executive's mailbox under the assistant's own address (Ken Lay's, Jeff Skilling's) are the assistant's, so they are not in the subset. The mapping is printed by `enron_subset.py` and kept in each node's `platformIds.email`.
- Duplicates: the same message is filed in the sender's and each recipient's folders under different Message-IDs; copies are merged on sender, time, subject digest, body digest and recipients (29,180 copies removed). 810 messages with dates outside 1998-2002 are dropped as corrupt.
- Bcc: the corpus's Bcc header repeats the Cc list; a Bcc address that is also in Cc is dropped. None remained, so the subset has `to` and `cc` targets only.
- Threads: there are no In-Reply-To or References headers; a thread is messages with the same normalized subject (Re:/Fw: stripped) with gaps of at most 30 days (13,739 threads). Subjects and bodies are never written: only 12-character SHA-1 digests are used during conversion, and thread ids are 10-character digests.
- Kept per message: sender, core recipients with role, timestamp (UTC), Message-ID (event key), thread (context), `all_recipients` (how many addresses it went to in all, a tie field, so broadcast mail can be recognized). Node attributes: `mailbox`, `position` (grouped from EnronData.org: CEO or President, Vice President, Director, Manager, Trader, In-house lawyer, Employee, Not recorded), `title`.
- Verified: 148 people, 21,052 messages, 2,440 directed ties (2,292 with To only); most contacts Louise Kitchen and John Lavorato (61 each); John Lavorato receives mail from the most colleagues (48); busiest month October 2001 (1,813 messages). There is no single published count for this exact subset to compare with: studies differ in which mailboxes, addresses and duplicates they keep. The counts here are reproducible from the scripts.
- Ethics: real people's workplace email, released during a public investigation without their consent; many were not involved in the wrongdoing. Some messages were removed at employees' request. CMU's page (April 2026) links analyses questioning the authenticity of some mailboxes (possible forged messages). The subset keeps who wrote to whom and when, no text and no subjects, but a named person's contact pattern is still personal; the card says to use it for methods, not claims about individuals.

## UI

- Data start page: a "Classic datasets" list below the three start choices and the Learn link (`ClassicList` from `src/ui/views/learn/classic.js`): title, year, one line, size, mode in words, Load. Pending entries say "Not included yet" with a link to the public source.
- Learn: the same list as its own section ("Classic datasets" in the jump links), and the card of the loaded classic dataset ("Loaded now").
- After loading: Network opens; "Who stands out" shows the card's title and "what to look for" lines (`ds.meta.example`). The Data view shows the full card ("About this dataset") above the sources.
- Krackhardt: "Perceptions in Build" writes the advice study into the Perceived builder's saved draft (`localStorage` key `orgsignal.build.perceived`, asking first when another study is there) and opens Build on the Perceived tab.

## Requests to other owners

- ui-core (`src/ui/views/network.js`): "Who stands out" shows only `title` and `lookFor`. To show the citation, the known answer and the license where students look, render `ClassicCard` from `src/ui/views/learn/classic.js` (or a "More about this dataset" link to Data) when `ds.meta.example.classic` is set.
- ui-build (`src/ui/build/perceived/`): a supported way to open a study, e.g. `#build?perceived=classic:krackhardt:advice`, instead of writing the builder's storage key. Also: when a dataset is loaded, the builder's reference network (`referenceFromDataset`) takes every event, ignoring tie-field filters; with Krackhardt loaded, the reference is advice, friendship and reports-to together. It should use the built network (or the active filters).
- lead: decide the pending datasets (above). `data/classic-pending/` should not go to a public repository until then.
