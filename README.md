# Org Signal

Network measurement from relational traces. Org Signal turns exports, surveys and hand-drawn networks into a network you can defend, measures it, and says how sure it is. It runs entirely in the browser: nothing is uploaded, and an LLM is used only if you add your own key.

Built by [Eric Gladstone](https://graystoneindustries.co).

## What it does

- **Imports** workplace exports (Slack, Teams, email, calendars), personal and social archives (X, Bluesky, Mastodon, Threads, LinkedIn, WhatsApp, iMessage, Telegram, Messenger, Instagram, Discord, Reddit), network files (GraphML, GEXF, GML, Pajek, UCINET, Gephi tables), Network Canvas and roster surveys, and any CSV of who-to-whom. Each import comes with a report of what was read, what was skipped, and what that kind of data can and cannot show.
- **Builds by hand**: a draw-your-own editor with snapping and layouts, an ego-network interview, roster and perceived-network collection, pasted tie lists.
- **Generates** synthetic worlds (workplace, online, professional, personal, community, survey) with planted structure, observed through a chosen medium and written out in that medium's real export format.
- **Measures**: explicit, adjustable tie rules; node, group, ego and whole-network measures; communities; null models and resampling; change over time; affect, keywords, topics and diffusion of terms. Every measure carries a plain-language meaning, a reliability note, and an applicability check against the kind of data loaded.
- **Interprets (optional)**: with an Anthropic, OpenAI or Gemini key, an analyst chat and on-demand reports that may only cite numbers the engine computed; uncited numbers are flagged.
- **Exports** metrics tables, network files that open in Gephi, networkx and igraph, figures, reports, and a methods appendix.

## Run it

```bash
python3 -m http.server 8787    # from this folder, then open http://localhost:8787
```

No build step and no dependencies to install; third-party libraries are vendored in `vendor/` (see `vendor/VERSIONS.txt` and `vendor/licenses/`).

## Tests

```bash
ORG_SIGNAL_SKIP_PERF=1 node --test 'test/**/*.test.js'
```

Measures are checked against networkx; importers against spec-faithful fixtures and Python's own parsers; and the whole pipeline end to end: generated exports are imported through automatic detection and compared event by event with what was generated (`test/integration/digestion.test.js`), and planted structure is checked for recovery (`test/integration/representation.test.js`). Browser QA: `node tools/serve.mjs . 8812` then `QA_URL=http://localhost:8812 node test/ui-core/qa.mjs`.

## Layout

| Path | Contents |
|---|---|
| `src/core` | Data model, zip reader, file sets, import pipeline, identity matching, import report |
| `src/importers`, `src/exporters` | One module per format |
| `src/analysis` | Network construction, measures, uncertainty, time, content; worker engine |
| `src/generator` | Synthetic worlds, media, observation, native writers, recovery check |
| `src/builders`, `src/ui` | Hand builders and the interface |
| `src/llm` | Provider adapters, analyst, reports, coding, methods appendix |
| `docs/CONTRACTS.md`, `docs/api/`, `docs/formats/` | Architecture, module APIs, and specs for every input format |

## Deploy

`tools/stage.sh` copies an allowlist of served files to `_deploy/` with security headers (including a Content Security Policy); `npx wrangler deploy` publishes it to Cloudflare Workers Static Assets.
