# Interface copy audit — Eric Gladstone, 2026-10-04

Eric's audit of the app's explanatory copy, saved verbatim as he supplied it. It is the reference for the copy pass of the same date: apply his wording exactly; where a statement in it is not true of the app, the discrepancy is recorded at the end of `docs/ux/copy-audit-2026-10-04-applied.md` rather than his wording silently changed.

---

I went through the app structure and the source-backed copy for all of the primary views, plus the important internal tabs: Build’s five construction modes, Content’s four analyses, Ask’s three language-model functions, and Learn/About. The main navigation currently runs from Data, Build, and Generate through Network, People, Groups, Content, Time, Methods & Export, Ask, and Learn.  Build contains Draw, Ego network, Roster, Perceived, and Paste ties.  Content contains Tone, Keywords, Topics, and Diffusion.  Ask contains Analyst, Reports, and Content coding. 
The underlying methodological content is already much closer to the Graystone prose than some of the interface language suggests. The largest tonal drift comes from the explanatory layer: rhetorical questions, classroom formulations such as “Common mistake,” phrases such as “real structure,” and occasional teacher-to-student instructions. The shared “How to read this” component propagates that voice throughout the app, so changing it once would do a surprising amount of the work. 
I would leave terse operational copy alone when it is doing interface work: Import, Cancel, Export table, Run recovery check, status messages, error messages, and so forth. The prose below is the explanatory layer I would use.


App shell
Masthead
Org Signal
Social network analysis in the browser
Navigation descriptions
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
Interpretive notes
I would change the global “How to read this” language throughout the app to:
Interpretation
Definition.
[Current “What it means” text]
Scale.
[Current “Big or small” text]
In this network.
[Current “Here” text]
Caution.
[Current “Common mistake” text]
I would also change the masthead control from “Explanations: on/off” to “Interpretive notes: on/off.”
For small networks, I would replace the current general warning with:
Small network. Individual ties have substantial leverage on many measures. Comparisons across networks should therefore be interpreted cautiously.

Data
Data
Import and review empirical data, open a saved project, or begin with a network constructed in Org Signal. The import review records what each source contains, the ties its records can support, and the limits of the resulting network.
Build a network
Draw people and ties, conduct an ego-network interview or roster survey, collect perceived networks, or paste a tie list.
Open Build
Explore a synthetic organization
Open a 96-person workplace with planted departments, a broker, and Slack-style communication. The underlying structure is retained for comparison with the reconstructed network.
Load the sample
Import empirical data
Load workplace communication, messaging, social-platform, survey, calendar, or standard network files. Files are read locally in the browser.
Choose files to import
Import review
For each source, I would change:
This data can show
to
What these records support
and:
It cannot show
to
Limits of these records
The section currently called “Ties these records can build” could become:
Records available for tie construction
These records support tie construction from [reply / mention / recipient / co-presence / declared tie / etc.]. Each rule can be enabled, disabled, or weighted under Construction settings. The network is rebuilt from the selected rules.
This keeps the same methodological content while sounding like a methods interface rather than instruction to a novice. The current import report already preserves source-specific evidence and limits, so this is primarily a change in register.
Build
Build
Construct a network directly from a drawing, ego-network interview, roster, perceived-network reports, or pasted tie list.
Draw
Draw a network
Place people and ties directly on the canvas. You can preserve the hand-drawn positions or apply a layout before analyzing the network.
Ego network
Ego-network interview
Conduct an ego-network interview by eliciting the people around a respondent, recording attributes of those people and relationships, and asking about ties among them. The resulting personal network can be analyzed using ego-network measures such as size, density, effective size, and constraint.
Roster
Bounded network from a roster
Define a bounded population from a roster and record ties among its members. Ties can be entered by one informant or collected from multiple respondents through a survey.
Perceived
Perceived networks
Collect whole-network reports from multiple informants. Each perceived network is retained separately, allowing reports to be compared, combined into a consensus network, and evaluated for perceptual accuracy. This supports cognitive social structure designs such as Krackhardt’s.
Paste ties
Paste a list of ties
Enter or paste one tie per line. The preview shows how each line is parsed and flags lines that remain unparsed.
Generate
Generate
Generate a synthetic social system with known structure and observe it through a selected communication medium. The resulting records can be analyzed directly in Org Signal or downloaded in the platform’s native export format.
The settings specify the social context, communication medium, structural scenario, population size, observation period, message content, and portion of the system visible in the resulting export.
Generated world
[Dynamic description of the selected world.]
Random seed
The random seed makes generation reproducible. Identical settings and seed reproduce the same generated world.
Recovery check
The recovery check compares the network reconstructed from the generated records with the ground-truth structure used to create them. It evaluates recovery of communities, brokers, content patterns, and change over time using the construction settings shown here.
Changing the construction settings and running the check again provides a direct way to examine how measurement choices affect recovery.
I would keep the existing Recovered / Partly / Missed labels. They are concise and analytically meaningful. The current recovery machinery already compares reconstructed communities, brokers, content, and temporal change with planted ground truth.
Network
Network
[Dynamic count] people and [dynamic count] ties.
This view shows the constructed network, whole-network measures, and comparisons with degree-preserving random networks. Select a person to inspect their neighborhood or a tie to inspect the observations that produced it.
Keep the current display controls: Color by, Size by, Layout, and Search. The map already supports inspection of individual ties and their underlying events.
Whole network
Retain the measure names and values. I would change the surrounding interpretive prose to a more methods-like register.
Comparison with random networks
Definition. Each comparison preserves every person’s number of ties while rewiring the endpoints. The resulting distribution shows what the network measures would look like under that constraint.
Scale. Interpret the observed value relative to the simulated distribution. The distance from the random-network mean describes the size of the departure. The empirical p value describes how unusual that departure is under the null model.
In this network. [Dynamic comparison using the observed and random-network values.]
Caution. Measures such as clustering and modularity can take positive values in randomized networks. Their magnitude is interpretable relative to the relevant comparison distribution.
That replaces the current language about values indicating “real structure,” which overstates what the comparison establishes.
Dependence on highly central people
If the current fragility analysis remains under Network, I would describe it as:
Definition. Betweenness identifies people who frequently lie on shortest paths between others. Removing highly ranked people provides a sensitivity analysis of the observed network.
Scale. Changes in cross-group ties, component size, and path length show how strongly observed connectivity depends on those people.
In this network. [Dynamic before-and-after result.]
Caution. This is a static sensitivity analysis. An actual departure can be followed by new ties, role substitution, or other organizational change.
That last point retains the current substantive caveat while stating the inferential boundary directly.
People
People
This view reports person-level network measures, ranks, attributes, and profiles. Sort a measure to compare positions across the network. Select a person to inspect their measures, ties, attributes, activity, and the observations underlying their relationships.
The current implementation includes sortable person-level measures, profiles, rank uncertainty, strongest ties and evidence, ego measures, activity, content, and position over time.
Interpretation of a ranking
Definition. [Measure-specific definition.]
Scale. Compare values and ranks within the same network and measure. Close values provide weak evidence for a precise ordering even when the displayed ranks differ.
In this network. [Dynamic top-ranked people and values.]
Caution. Each measure describes a particular form of network position. A high rank on one measure should be interpreted in terms of that measure rather than as general importance.
This replaces the current “Calling the person at the top the most important...” formulation with the same substantive point stated affirmatively.
Rank stability
Definition. Org Signal repeatedly resamples the observed events, rebuilds the network using the same construction settings, and recalculates the ranking. The resulting intervals show how much a person’s rank changes under this form of sampling variation.
Scale. Narrow intervals indicate that the ordering is stable across resamples. Wider intervals indicate that several rank positions are consistent with the observed events.
In this network. [Dynamic result for the selected ranking.]
Caution. These intervals address variation in the observed events. Missing actors, unobserved ties, measurement error in the source, and structural change during the observation period remain outside the resampling procedure.
That is the same statistical content as the current explanation, but it reads much more like a methods note.
Groups
Groups
Compare within- and between-group structure using an observed attribute or communities detected from the network. The view reports group size, internal density, within- and between-group ties, E-I index, assortativity, and comparisons with degree-preserving random networks.
When the data contain no usable grouping attribute:
Detected communities are currently the available grouping. Join an attribute table in Data to compare departments, teams, roles, or other observed groups.

Group structure
Definition. E-I index summarizes the balance between ties within a group and ties crossing its boundary. Assortativity summarizes the tendency for ties to connect people with the same group value.
Scale. E-I ranges from -1 for entirely within-group ties to +1 for entirely between-group ties. The random-network comparison accounts for group sizes and each person’s number of ties.
In this network. [Dynamic group result.]
Caution. Group size affects the number of possible within-group ties. Interpret E-I and assortativity relative to the random-network comparison, particularly when groups differ substantially in size.
The current view already runs these comparisons against rewired networks and reports within-group density, cross-group ties, E-I, assortativity, and the mixing matrix.
Content
Content
This view analyzes message text locally using lexicon, term-frequency, topic, and diffusion methods. It reports tone, distinctive words, recurring topics, and the spread of terms along observed ties. [Dynamic percentage] of messages contain text.
The existing Content view already separates these into Tone, Keywords, Topics, and Diffusion.
Tone
Tone is estimated with VADER (Hutto & Gilbert, 2014), which assigns each message a score from -1 to +1 using a lexicon and rules for negation and emphasis. Estimates are most informative in aggregate. Sarcasm, domain-specific language, and non-English text can reduce validity.
Quoted replies and signatures are removed where they can be identified. Words corresponding to people in the dataset are also excluded from the text used for these analyses.
I would retain the Approximate flag. It conveys a genuine measurement limitation.
Keywords
Distinctive words are identified with TF-IDF. A term receives a higher score when it is common within one group and comparatively uncommon across the others.
The comparison can be made across sources, groups, people, time periods, or visibility layers where the data support those distinctions.
Topics
Topic analysis identifies recurring patterns of terms in the message corpus. Each topic is represented by its most strongly associated terms and by its share of the analyzed text. The number of topics can be changed to examine broader or finer partitions of the corpus.
Diffusion
Diffusion analysis traces when a term first appears for each person and asks how often adoption follows earlier use by one of that person’s contacts. Adoption times are shuffled to provide a comparison distribution while holding the observed network and set of adopters fixed.
The resulting comparison reports the observed share of adopters with prior exposure through a contact alongside the corresponding share under shuffled adoption times.
For generated data:
The recovery check evaluates diffusion against the underlying generated ties. This view uses ties reconstructed from the observed records, so the two analyses can differ when the observation process omits ties.

Time
Time
The network is rebuilt separately for each time window using the current construction settings. This keeps the definition of a tie constant while allowing activity, network measures, tie turnover, and group structure to be compared over time.
The view can be organized by day, week, or month depending on the data. It also supports detected shifts and before-and-after comparisons around a selected date. The current implementation rebuilds each temporal network using the same construction settings.
When timestamps are unavailable
These records contain no event timestamps, so the network cannot be reconstructed by time window. Surveys and standard network files commonly record ties without dates.
Detected shifts
Shift detection compares adjacent periods and identifies changes that are large relative to the variability estimated from the series. Sparse periods reduce sensitivity, so the absence of a detected shift provides limited evidence of stability.
Before and after
The before-and-after analysis compares the same measure on either side of a selected date. The paired permutation test evaluates whether the observed change is larger than expected under reassignment of the paired values.
Methods & Export
Methods & Export
This view records how the current network was constructed and analyzed, and exports the resulting network, measures, figures, reports, and project state.
Network files
Export the network as currently constructed, including node attributes, computed measures, communities, and tie-level evidence for each construction rule. Contact details are omitted by default.
Figures and summary
Export a network figure or a summary report containing the data description, whole-network measures, analyses already run in Org Signal, and the methods appendix.
The summary is generated deterministically from computed results and can be saved as HTML or printed to PDF.
Project file
Save the current project to preserve the data, construction settings, and analysis state for later work in Org Signal.
Methods appendix
The methods appendix is generated from the sources, construction settings, measures, and analyses used for the current network. Analyses appear after they have been run in the relevant view.
The exported text provides a reproducible record of the analytical sequence and can be edited for a paper or report.
This is already very close to what the current Methods & Export view actually does. The main change is register.
Ask
Ask
Ask uses a user-supplied Anthropic, OpenAI, or Gemini API key to query the loaded network, draft reports, and code message content. Numerical claims are checked against results returned by the analysis engine. The provider receives the information required for the requested operation, as described below.
Language-model functions
An API key enables three language-model functions. Network calculations continue to come from the Org Signal analysis engine.
Analyst
Ask questions about the loaded network in ordinary language. The model can request computed results from the analysis engine and must cite numerical claims to those results. Unsupported numerical claims are flagged.
Reports
Generate a written report for the whole network, a group attribute, or a selected person from a fixed set of computed results.
Content coding
Apply a user-defined codebook to a sample of messages. Double-coding can be used to estimate agreement.
Provider and API key
Keep the existing provider, model, API-key, and remember-key controls.
For the disclosure section:
What is sent to the model provider
When a language-model function is run, the browser sends the request directly to the selected provider. The information sent depends on the operation and is listed below. Original files remain in the browser.
Analyst. The request can include the conversation, a description of the dataset and construction settings, computed results requested by the model, and short excerpts from underlying records when the question requires evidence for a tie.
Reports. Reports use a fixed set of computed network, person, group, temporal, and content results. Message text is excluded except for the aggregate word results used by the report.
Content coding. The provider receives the codebook and the sampled message text used for coding.
API key. The key is sent directly to the selected provider with each request.
Keep Replace names with codes before sending and its detailed explanation. That is useful methodological and privacy information.
The current Ask implementation already separates Analyst, Reports, and Content coding, checks numerical claims against computed results, exposes what information leaves the browser, and supports pseudonymization before transmission.
Learn
Learn
Definitions, interpretation, worked examples, and limitations for the measures used throughout Org Signal.
Find it in the app
Common network-analysis questions, with links to the views and measures used to address them.
Worked examples
Small networks with known structure that can be opened in Build, modified, and analyzed.
Classic datasets
Published networks with source citations, substantive context, and reference results that can be reproduced in Org Signal.
Concepts
Definitions, formulas, interpretation, and reliability notes for the measures used throughout the analysis.
For each concept, I would use:
Where it appears
Interpretation
Caution
Formula and reliability
The current Learn system already draws the definitions from the same glossary used by the application and links each concept back to the relevant views.
I would also change several section labels:
Basics
Nodes, ties, direction, weight, paths, and communities.
Person-level centrality
Measures of position for individual actors. Each represents a different structural property.
Personal networks
Measures defined for an ego and the alters surrounding that ego.
Whole network
Measures that summarize structure at the network level.
Groups
Measures of within- and between-group structure.
Random-network comparisons and uncertainty
Null-model comparisons, resampling, and uncertainty in ranks and other estimates.
Two-mode networks
Networks containing two kinds of nodes, such as people and events, with ties defined across modes.
Surveys
Network construction from roster-based or respondent-reported ties.
Time and content
Temporal change, message content, and diffusion.
About Org Signal and its limits
Org Signal is a browser-based environment for teaching and conducting social network analysis. It supports directly constructed networks, ego networks, surveys, synthetic systems with known structure, published datasets, and empirical records. The same analysis engine is used across these sources, allowing measures and construction choices to be examined first in transparent settings and then applied to more complex data.
I built Org Signal as part of my work on network measurement and computational research systems.
Your data
Files are read and analyzed locally in the browser.
Ask sends information to a model provider only when a user supplies an API key and runs a language-model function. The Ask panel lists the information sent for each operation and supports replacement of names with codes before transmission.
Exported network files omit contact details by default.
How the numbers are checked
The numerical implementation is tested against NetworkX, exact linear-algebra calculations, and closed-form reference cases across approximately 21 million comparisons, with no unexplained failures in the current validation campaign.
Statistical procedures are calibrated through simulation. Tests based on degree-preserving randomization produce approximately the expected false-positive rate under the null, and rank intervals have been evaluated against known ranks across repeated simulations.
Generated worlds are written to native export formats, read back through the production importers, and compared with their source structure. The included classic datasets reproduce published counts and reference values.
These procedures evaluate implementation and numerical accuracy. Substantive validity depends on the relationship between the source data, the rules used to construct the network, and the theoretical quantity being studied.
Known limitations
Testing and browser coverage
Automated browser testing currently centers on Chrome. Safari and Firefox have received less systematic testing, including the WebGL network map.
Usability testing to date has used simulated student and instructor workflows through the Networks 101 assignments. Live classroom use has not yet been evaluated systematically.
Ask has been tested end to end with an offline provider stand-in. Coverage against the live services of each supported model provider remains more limited.
Some importers were developed from published platform specifications and public sample files. Microsoft Teams and LinkedIn are among the sources with the least testing against real user exports. Platform export formats can also change over time.
Measurement
Above approximately 3,000 people, betweenness and closeness are estimated by sampling. These approximations perform best when structural differences are large. Rankings become less stable when scores are close together or when the network is sparse, directed, or strongly tree-like.
Resampling addresses variation in observed events and cannot recover ties absent from the source data. Rank intervals for contacts therefore have narrower-than-nominal coverage in the current simulations, approximately 88 percent rather than 95 percent.
Shift detection has limited power when few events occur within each time window. The current calibration favors a low false-positive rate, so an undetected shift provides limited evidence of temporal stability.
Personal platform exports represent the portion of a network visible from one account. Whole-network measures calculated from those records describe that observed export. Ego-network measures are generally more appropriate when the source is explicitly personal.
Synthetic data
Recovery varies across generated contexts and media. Workplace and online-community structures are generally recovered well. Recovery is weaker in some professional-network, Discord, calendar, and bot-campaign scenarios.
Generated people, messages, and organizational records are fictional. Their structure is generated to support known-ground-truth analysis and recovery tests.
Data and ethics
The included Enron subset contains workplace communication records from identifiable people. The dataset is provided for methodological use, and the included version excludes message text and subjects. Published forensic work has also raised questions about the authenticity of some records in the larger Enron corpus.
Several classic datasets distributed through UCINET and Pajek collections carry no explicit license statement in their source collections. Org Signal includes them with citations to the published studies from which they derive.
Practical limits
PST, OST, and MSG files can be identified but are not currently parsed directly in the browser. Mbox provides the supported path for Outlook mail archives.
Very large exports are constrained by available browser memory. Imports run in the background and can be cancelled.
Loaded projects have no server backup. Build drafts are retained in local browser storage, and project files can be downloaded for durable storage.
Source, citation, and issue reporting
Problems and undocumented limitations can be reported through the project’s GitHub issue tracker. A useful report identifies the type of data loaded, the expected behavior, the observed behavior, and the browser, without including the underlying data.
Citation
Gladstone, E. (2026). Org Signal: Browser-based network analysis for teaching and research (Version 2.0) [Software].
The source code, documentation, accuracy report, supported formats, classic datasets, and Networks 101 materials are available in the project repository.



Two changes matter more than all the little sentence edits combined.
First, I would make Interpretation / Definition / Scale / In this network / Caution the shared explanatory grammar everywhere. Right now the common component literally generates “How to read this,” “Big or small,” “Here,” and “Common mistake,” so the student-instruction tone is systemic rather than local. 
Second, I would change “Network measurement from relational traces” in the masthead. The phrase is accurate enough, but it makes the system sound more abstract than it is. The actual application lets someone draw networks, conduct ego and roster studies, collect perceived networks, import empirical records, generate known-ground-truth systems, and run a substantial network analysis stack.  “Social network analysis in the browser” says exactly what it is and then lets the rest of the application establish the sophistication.
