# OrgSignal

**Organizational communication intelligence — browser-native, Claude-powered.**

OrgSignal ingests a Slack workspace export and an optional HR/people CSV, computes a full social-network-analysis graph on the data, and uses Claude to produce written intelligence reports on individual employees and the organization as a whole. Everything runs in the user's browser; no backend server is required.

---

## What it does

- **Network analysis** — betweenness centrality (Brandes), eigenvector centrality (power iteration), reciprocity, hidden activity index (HAI), visibility lift, bridging bias, core score, manager proximity
- **Five finding types** — BRIDGE, FLIGHT\_RISK, HIDDEN\_INFLUENCER, ASYMMETRIC, INAUTHENTICITY — detected by rule engine, then narrated by Claude
- **Per-person reports** — Claude writes a narrative archetype, topic summary, guidance note, and sentiment signal for every employee with sufficient data
- **Org synthesis** — Claude writes an executive-level network health summary citing specific metric values
- **Analyst chat** — live Q&A panel powered by Claude with web search enabled, giving comparative context ("how does this compare to typical orgs?")
- **Secondary insights** — six structured follow-up prompts that probe cross-finding relationships; each uses web search for academic/industry grounding
- **D3 network graph** — interactive force-directed visualization with color/size modes (betweenness, eigenvector, department, reciprocity), channel-layer filtering (public / private / DM), and SVG export
- **Downloads** — master metrics CSV, per-employee report text file, org-level report text file
- **Synthetic data generator** — in-browser Slack ZIP + HR CSV generation for demos; configurable org size, density, network structure, flight-risk prevalence, sentiment divergence

---

## Architecture

```
index.html              Entry point — HTML shell + script loader
css/main.css            All styles; CSS variables in :root for theming
js/config.js            CONFIG object — model ID, API version, all thresholds
js/orgdata.js           Static domain data — theory library, generator config, message templates
js/prompts.js           All Claude prompt builders — ALL-CAPS rule constants, confidence signals framework
js/helpers.js           Utilities — stripCitations, repairJson, safeMarkdown, callClaude, Slack ZIP parser, HR normalizer
js/metrics.js           Pure computation — network metrics, findings engine, graph data builder
js/generate.js          Synthetic data generator — people, messages, Slack ZIP, HR CSV
js/app.js               State, rendering, pipeline orchestration, event wiring
vendor/d3.min.js        D3 7.8.5 — vendored, no CDN dependency
vendor/jszip.min.js     JSZip 3.10.1 — vendored, no CDN dependency
test.js                 61-test plain Node.js test suite
```

No build tooling. No npm. No bundler. Load `index.html` in a browser.

---

## AI pipeline

### Model

`claude-sonnet-4-6` (configurable in `js/config.js` → `CONFIG.MODEL_ID`).

### Call sites

| Function | File | Web search | Purpose |
|---|---|---|---|
| `analyzePersonWithClaude()` | `app.js` | No | Per-person narrative, archetype, sentiment |
| `generateOrgSynthesis()` | `app.js` | No | Executive org health summary |
| `normalizeHRWithClaude()` | `helpers.js` | No | HR CSV normalization (fallback only) |
| `loadSecondaryInsights()` | `app.js` | **Yes** | Six structured cross-finding follow-ups |
| `sendAnalystMessage()` | `app.js` | **Yes** | Live analyst chat panel |

### Prompt rules (all in `js/prompts.js`)

All rules are named in ALL-CAPS so they read like a specification:

- `SHARED_HONESTY_RULE` — prohibits fabricating statistics, benchmarks, company names, salary figures
- `SHARED_THIN_SIGNAL_RULE` — requires acknowledging sparse search results rather than padding
- `SHARED_SPECIFICITY_RULE` — all claims must cite specific metric values from the data
- `SHARED_GROUNDING_RULE` — every claim must be traceable to a specific data point
- `SHARED_BANNED_PHRASES` — eliminates generic hedge phrases for unambiguous data claims

The analyst system prompt also includes a **CONFIDENCE SIGNALS FRAMEWORK** with four tiers: CONFIRMED (metric-backed), INFERRED (pattern-based), SPECULATIVE (hypothesis), INSUFFICIENT DATA.

### Citation handling

Web search injects `<cite index="N">text</cite>` tags into Claude responses.

- `stripCitations()` in `helpers.js` removes these before any JSON parse attempt and before any `innerHTML` render
- `safeMarkdown()` calls `stripCitations()` internally — it is the only safe path for rendering Claude text to HTML
- `repairJson()` calls `stripCitations()` before attempting JSON parse

---

## Output safety

| Risk | Mitigation |
|---|---|
| XSS from Claude response | All Claude text goes through `safeMarkdown()` before `innerHTML` — HTML-escapes `<`, `>`, `&`, `"`, then applies narrow markdown transforms |
| Malformed JSON from Claude | `repairJson()` tries three extraction strategies before returning null; callers degrade gracefully |
| Citation tag corruption of JSON | `stripCitations()` runs before every JSON parse attempt |
| Stale model | Model ID is in a single constant `CONFIG.MODEL_ID`; no inline strings |

---

## Data flow

```
User uploads Slack ZIP + optional HR CSV
        │
        ▼
parseSlackZip()         → messages[], userMap{}
normalizeHRWithClaude() → hrPeople[] (fast CSV path or Claude fallback)
mergePeople()           → people[] (Slack + HR joined by id/name)
        │
        ▼
computeAllMetrics()     → metrics{}, orgMetrics{}, deptMetrics{}
generateFindings()      → findings[]
buildGraphData()        → graphData{nodes, links}
        │
        ▼
analyzePersonWithClaude() × N   (sequential, rate-limit friendly)
generateOrgSynthesis()
        │
        ▼
renderBriefing() / renderPeopleList() / renderGraph()
loadSecondaryInsights()  (web search)
sendAnalystMessage()     (web search, interactive)
```

---

## Integration hooks

The architecture is designed for extension:

- **`CONFIG.DOMAIN`** (`js/config.js`) — currently `'slack'`; signals the intended extensibility point for other communication data sources (Teams, email, etc.)
- **`CONFIG` thresholds** — all scoring thresholds in one place; no magic numbers in business logic
- **`THEORY_LIBRARY`** (`js/orgdata.js`) — array of academic theory entries; extend with domain-specific frameworks
- **`SECONDARY_INSIGHT_PROMPTS`** (`js/orgdata.js`) — array of prompt functions; add follow-up question types without touching app logic
- **`generateFindings()`** (`js/metrics.js`) — rule-based finding engine; new finding types add one condition block
- **`callClaude()`** (`js/helpers.js`) — single wrapper for all Claude calls; swap model or headers in one place

---

## Running tests

```bash
node test.js
```

61 tests, zero dependencies, plain Node.js. Covers:

- `stripCitations` — 12 cases including edge cases and XSS vectors
- `repairJson` — 14 cases including fenced code, prose extraction, citation stripping
- `safeMarkdown` — 12 cases including XSS prevention
- HR CSV fast-path parser — 16 cases including column aliases, boolean parsing, edge cases
- `gFill` template engine — 4 cases
- `gRandInt` — 3 cases including range invariant over 200 runs

---

## Security posture

- **No server** — zero server-side attack surface
- **No persistence** — data exists only in browser memory during a session; cleared on page close
- **API key** — entered by the user, stored only in `State.apiKey` (memory), never written to localStorage or sent anywhere except the Anthropic API
- **Anthropic direct browser access** — uses `anthropic-dangerous-direct-browser-access: true` header; this is the documented browser-direct pattern and requires the user to supply their own API key
- **XSS** — all Claude responses rendered via `safeMarkdown()` (HTML-escape first)
- **No eval, no dynamic script loading** — all code is static; vendor libraries are local files

---

## Dependencies

| Library | Version | Source | Purpose |
|---|---|---|---|
| D3 | 7.8.5 | `vendor/d3.min.js` | Force-directed graph, SVG |
| JSZip | 3.10.1 | `vendor/jszip.min.js` | Slack ZIP parsing, synthetic ZIP generation |
| DM Sans / DM Serif Display / DM Mono | — | Google Fonts CDN | Typography |

No npm packages. No build step. No runtime framework (React was evaluated and excluded — the DOM surface is small enough that direct manipulation is cleaner and reduces acquisition risk from framework version drift).

---

## Configuration reference

All tunable parameters live in `js/config.js`:

```js
CONFIG.MODEL_ID                              // Claude model string
CONFIG.API_VERSION                           // Anthropic API version header
CONFIG.WEB_SEARCH_MAX_USES                   // Max web search calls per analyst turn
CONFIG.HIDDEN_INFLUENCER_VISIBILITY_THRESHOLD // visibilityLift cutoff for HIDDEN_INFLUENCER finding
CONFIG.FLIGHT_RISK_PRIVATE_RATIO_THRESHOLD   // private message ratio for FLIGHT_RISK
CONFIG.FLIGHT_RISK_DM_MANAGER_EXCLUSION      // DM-to-manager fraction for FLIGHT_RISK
CONFIG.BRIDGE_BETWEENNESS_THRESHOLD          // betweenness percentile for BRIDGE finding
CONFIG.ASYMMETRIC_RECIPROCITY_THRESHOLD      // reciprocity floor for ASYMMETRIC finding
CONFIG.INAUTHENTICITY_DELTA_THRESHOLD        // public/private sentiment delta for INAUTHENTICITY
CONFIG.HR_NORMALIZE_MAX_TOKENS               // token budget for HR normalization fallback
CONFIG.ORG_SYNTHESIS_MAX_TOKENS              // token budget for org synthesis
CONFIG.PERSON_ANALYSIS_MAX_TOKENS           // token budget per person analysis
CONFIG.MIN_MESSAGES_FOR_PERSON              // minimum messages to include a person in analysis
CONFIG.DOMAIN                               // data source domain ('slack')
```
