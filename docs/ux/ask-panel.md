# The docked Ask panel

Decided 2026-11-19, revised the same day after first use. Implemented in `src/ui/components/askpanel.js`, `src/ui/components/asksetup.js`, `src/ui/components/chat.js` and `src/ui/services/conversation.js`.

## What it is for

Before this change the analyst lived only on the Ask page, away from the views it answers about. A claim such as "Manager 18 ranks first on betweenness" could be checked against its computed record, but not read against the network map or the People ranking at the same time. The panel puts the same conversation beside the Network, People, Groups, Content and Time views, so a reader can move between the claim, the record behind it and the structure on screen.

The engine and the analyst are unchanged. Questions go to `src/llm/analyst.js` through `createAnalystSession` exactly as before, the tools are the same, and `src/llm/citations.js` checks every number in an answer against the tool results.

## Rules

1. **Ask lives in the views.** A floating "Ask" button sits at the bottom right of Network, People, Groups, Content and Time whenever data is loaded, with or without a key. It opens a panel beside the view (a bottom sheet on a phone). There is no Ask item in the top menu. The first version showed the panel only after a key had been set on a separate Ask page; in use, the panel was undiscoverable, "Ask" in the menu led away from the visualizations, and a key held only in memory made the panel vanish after a reload. That version was replaced the same day.
2. **Setup inside the panel.** Without a key, the panel opens on setup: provider, model, key, the remember choice and its warning, the names-to-codes switch, and the full statement of what is sent. With a key, setup folds into one summary line (provider, model, names coded or not, where the key is held) that reopens on request. The app stays complete without a model (`docs/api/llm.md`): someone who never uses one sees one button and nothing else, and "Ask about this" links appear only once a key is set.
3. **Reports and coding.** Reports, a document to download, have their own page, labeled Reports in the menu next to Methods & Export (the route stays `#ask` so earlier links work). Content coding is a tab in the Content view. Both use the key entered in the panel, and both pages offer the same setup when no key is set.
4. **Evidence layers travel with it.** [T2] markers open the computed record behind a sentence, unverified numbers are underlined and counted, general knowledge is labeled as not computed, and "Computed values used" lists every record as sent.
5. **Context is words, never values.** "Ask about this" attaches the view, the object and the measure ("People view, about person Manager 18"). The context is appended to the question as one line and shown as a chip on the question. It carries no numbers, because the citation check accepts numbers that appear in the question, and a value put there by the app would pass as verified without a tool call. With names replaced by codes, the context line is encoded like the rest of the question.
6. **Nothing is sent on click.** "Ask about this" opens the panel with the context attached and the cursor in the question box. Suggested questions are offered, but each question costs money and sends data, so the person chooses to ask.
7. **Disclosure at the point of asking.** The panel states what the next question sends (the question, the context line if any, and the computed results the model requests), to which provider, and whether names are replaced with codes, with a link that opens the full statement in the panel's settings.
8. **Rebuilds mark, not erase.** A provider, model or names-to-codes change starts a new conversation, as before. A network rebuild no longer clears it: the model's context restarts on the next question (its earlier results describe the old network), a divider marks the point, and earlier answers carry a caution that they were computed under earlier construction settings. "Show in" actions are withheld on those answers.
9. **Show in, not proof.** A computed record that names people offers "Select these in the network map" and "Open in People". The people are read from the record, never from the model's prose. This is a second reading of the same computation and is labeled as such, not as a separate check.

## Where "Ask about this" appears

- People: the selected person's profile, and the ranking when the table is sorted by a measure.
- Network: the selected person in the selection panel.

## Not done yet

- A cross-check of engine values against a second implementation (graphology) for measures both compute.
- Tracing a result back to the ties and records that produced it, inside the panel.
- "Ask about this" in Groups, Content and Time.
