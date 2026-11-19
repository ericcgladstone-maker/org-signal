# The docked Ask panel

Decided 2026-11-19. Implemented in `src/ui/components/askpanel.js`, `src/ui/components/chat.js` and `src/ui/services/conversation.js`.

## What it is for

Before this change the analyst lived only on the Ask page, away from the views it answers about. A claim such as "Manager 18 ranks first on betweenness" could be checked against its computed record, but not read against the network map or the People ranking at the same time. The panel puts the same conversation beside the Network, People, Groups, Content and Time views, so a reader can move between the claim, the record behind it and the structure on screen.

The engine and the analyst are unchanged. Questions go to `src/llm/analyst.js` through `createAnalystSession` exactly as before, the tools are the same, and `src/llm/citations.js` checks every number in an answer against the tool results.

## Rules

1. **Optional layer.** Without a key there is no panel and no "Ask about this" action anywhere. The app is complete without a language model (`docs/api/llm.md`). With a key, the panel is collapsed by default behind a tab on the right edge. Its module loads only when a view that can show it opens.
2. **One conversation.** The Ask page and the panel show the same conversation. The Ask page remains the place for setup (provider, model, key, the full statement of what is sent, the names-to-codes switch) and for Reports and Content coding.
3. **Evidence layers travel with it.** [T2] markers open the computed record behind a sentence, unverified numbers are underlined and counted, general knowledge is labeled as not computed, and "Computed values used" lists every record as sent.
4. **Context is words, never values.** "Ask about this" attaches the view, the object and the measure ("People view, about person Manager 18"). The context is appended to the question as one line and shown as a chip on the question. It carries no numbers, because the citation check accepts numbers that appear in the question, and a value put there by the app would pass as verified without a tool call. With names replaced by codes, the context line is encoded like the rest of the question.
5. **Nothing is sent on click.** "Ask about this" opens the panel with the context attached and the cursor in the question box. Suggested questions are offered, but each question costs money and sends data, so the person chooses to ask.
6. **Disclosure at the point of asking.** The panel states what the next question sends (the question, the context line if any, and the computed results the model requests), to which provider, and whether names are replaced with codes, with a link to the full statement on the Ask page.
7. **Rebuilds mark, not erase.** A provider, model or names-to-codes change starts a new conversation, as before. A network rebuild no longer clears it: the model's context restarts on the next question (its earlier results describe the old network), a divider marks the point, and earlier answers carry a caution that they were computed under earlier construction settings. "Show in" actions are withheld on those answers.
8. **Show in, not proof.** A computed record that names people offers "Select these in the network map" and "Open in People". The people are read from the record, never from the model's prose. This is a second reading of the same computation and is labeled as such, not as a separate check.

## Where "Ask about this" appears

- People: the selected person's profile, and the ranking when the table is sorted by a measure.
- Network: the selected person in the selection panel.

## Not done yet

- A cross-check of engine values against a second implementation (graphology) for measures both compute.
- Tracing a result back to the ties and records that produced it, inside the panel.
- "Ask about this" in Groups, Content and Time.
