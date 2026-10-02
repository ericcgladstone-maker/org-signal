# Network Canvas and ego-network survey exports

Ego-network (personal network) data is **declared ties from one respondent's perspective**: ego → alters (via name generators), alter attributes as reported by ego, and alter–alter ties as **perceived by ego**. Every importer here must keep the `ego id` as a partition key: alters with the same name in different interviews are *not* the same person unless the study design says so.

Observation note for everything in this file: **ego view, self-report, per respondent**. Alter–alter edges are the respondent's perception, not observed interaction. Multiple egos = a sample of independent ego networks (unless sociocentric roster design).

---

## 1. Network Canvas (Complex Data Collective)

### How obtained
Interviewer (desktop/tablet), Interviewer Classic (≤6.x), or Fresco (web) export. Interviewer zips all files; Fresco exports from dashboard. Formats: **CSV** (egor-compatible multi-file) and **GraphML** (one file per session). "Merge sessions by protocol" existed only in Interviewer Classic ≤6.5 → one CSV set for all sessions, or a GraphML with **multiple `<graph>` elements**.

### File tree (per session; Interviewer zip)
```
networkCanvasExport.zip            (zip name not verified)
├── <caseId>_<sessionId>_ego.csv
├── <caseId>_<sessionId>_attributeList_<NodeTypeName>.csv    one per node type
├── <caseId>_<sessionId>_edgeList_<EdgeTypeName>.csv         one per edge type (created even if empty)
├── <caseId>_<sessionId>_adjacencyMatrix_<EdgeTypeName>.csv  if selected
└── <caseId>_<sessionId>.graphml
```
Source: `makeFilename`/`getFilePrefix` in `packages/network-exporters/src/utils/general.ts` — prefix is `sanitizeFilename(caseId_sessionId)`; type name has non-word chars stripped (`/\W/g`). Type name = codebook `name` of the node/edge type.

### CSV schemas (from exporter source; the official "Data Export" page shows illustrative `ego_id`/`alter_id` columns that do **not** match the code — trust the code and the "Export Data Dictionary" page)

Ego file — fixed columns first:

| Column | Meaning |
|---|---|
| `networkCanvasEgoUUID` | ego's `_uid` (join key) |
| `networkCanvasCaseID` | researcher-entered case id |
| `networkCanvasSessionID` | session UUID |
| `networkCanvasProtocolName` | protocol name |
| `sessionStart`, `sessionFinish`, `sessionExported` | ISO-8601 |
| `APP_VERSION`, `COMMIT_HASH` | app build |
| …ego variables by codebook **name** | |

Alter file (`attributeList_<Type>`):

| Column | Meaning |
|---|---|
| `nodeID` | integer 1..n, resequenced **per export file/session** |
| `networkCanvasEgoUUID` | join to ego |
| `networkCanvasUUID` | alter's permanent UUID |
| …node variables by name | includes ego→alter tie attributes (e.g. `closeness`, `contact_freq`) — NC stores ego–alter tie data **on the alter** |

Edge file (`edgeList_<Type>`):

| Column | Meaning |
|---|---|
| `edgeID` | integer 1..m |
| `from`, `to` | `nodeID`s of endpoints |
| `networkCanvasEgoUUID` | join to ego |
| `networkCanvasUUID` | edge UUID |
| `networkCanvasSourceUUID`, `networkCanvasTargetUUID` | endpoint alter UUIDs |
| …edge variables by name | |

Adjacency matrix: first row `,<uuid1>,<uuid2>,…`; rows `<uuid>,0,1,…`; **symmetrised** (both directions set), binary.

Variable encoding (Export Data Dictionary + `addVariableHeaders`):

| Type | CSV columns | Value |
|---|---|---|
| text, number, boolean (`true/false`), ordinal (option **value**), scalar (0–1), date (`1989-07-21`/`1989-07`/`1989`), location (area id or `outside-selectable-areas`) | `<name>` | as stated |
| categorical (multi-select) | `<name>_<optionValue>` per option | `true/false`; unanswered → all `false` (ambiguous) |
| layout (sociogram) | `<name>_x`, `<name>_y` (0–1, origin top-left); optional `<name>_screenSpaceX/Y` (pixels, Y from bottom) | |
| encrypted (anonymisation) | `<name>` | literal `ENCRYPTED` |
Missing = empty cell. Cells starting `= + - @ \t` are prefixed with `'` (formula-injection guard) — strip on import.

Synthetic example:
```csv
networkCanvasEgoUUID,networkCanvasCaseID,networkCanvasSessionID,networkCanvasProtocolName,sessionStart,sessionFinish,sessionExported,APP_VERSION,COMMIT_HASH,age
6f1c…,P014,9b2e…,Work Advice Study,2026-04-02T14:00:11.000Z,2026-04-02T14:41:52.000Z,2026-04-10T09:00:00.000Z,7.0.0,abc123,37
```
```csv
nodeID,networkCanvasEgoUUID,networkCanvasUUID,name,role,closeness,support_type_emotional,support_type_advice,layout_x,layout_y
1,6f1c…,a11…,Avery,manager,4,false,true,0.31,0.40
2,6f1c…,b22…,Jordan,peer,5,true,true,0.62,0.24
```
```csv
edgeID,from,to,networkCanvasEgoUUID,networkCanvasUUID,networkCanvasSourceUUID,networkCanvasTargetUUID,know_each_other_strength
1,1,2,6f1c…,e01…,a11…,b22…,2
```

### GraphML (createGraphML.ts / helpers.ts / generateDataElements.ts)
```xml
<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:nc="http://schema.networkcanvas.com/xmlns" …>
  <key id="label" for="all" attr.name="label" attr.type="string"/>
  <key id="networkCanvasType" for="all" attr.name="networkCanvasType" attr.type="string"/>
  <key id="networkCanvasUUID" for="all" attr.name="networkCanvasUUID" attr.type="string"/>
  <key id="networkCanvasSourceUUID" for="edge" …/> <key id="networkCanvasTargetUUID" for="edge" …/>
  <key id="<variableUUID>" for="graph|node|edge|all" attr.name="<variable name>" attr.type="string|int|double|boolean|float"/>
  <graph edgedefault="undirected" nc:caseId="P014" nc:sessionUUID="…" nc:protocolName="…" nc:protocolUID="…"
         nc:codebookHash="…" nc:sessionExportTime="…" nc:sessionStartTime="…" nc:sessionFinishTime="…">
    <data key="networkCanvasUUID">6f1c…</data>        <!-- ego -->
    <data key="<egoVarUUID>">37</data>                 <!-- ego attrs = graph-level data -->
    <node id="1"><data key="networkCanvasUUID">a11…</data><data key="networkCanvasType">Person</data><data key="label">Avery</data>…</node>
    <edge id="1" source="1" target="2"><data key="networkCanvasUUID">e01…</data><data key="networkCanvasType">knows</data>…</edge>
  </graph>
</graphml>
```
- **Key `id` is the codebook variable UUID; `attr.name` is the human variable name** — map via `attr.name`. Categorical keys: id = variable id + hash of option.
- Ego is **not** a node; no ego–alter edges. Ego attributes are graph-level `<data>` (`for="graph"`). Node `label` = the type's label variable (or type name).
- Always `edgedefault="undirected"`.

### Codebook / protocol
Protocol file `.netcanvas` (zip) holds `protocol.json` with `codebook = { ego: {variables}, node: {<typeId>: {name, color, variables}}, edge: {<typeId>: {name, variables}} }`, each variable `{name, type, options?, encrypted?}` (shape from exporter's codebook use; full schema in `@codaco/protocol-validation`, not reviewed). Exports already use names, so the codebook is optional for import (useful for option labels — exports carry option *values*, not labels).

### Mapping to internal model
- Node `ego:<networkCanvasEgoUUID>` (kind=ego) + ego attrs.
- Node per alter keyed `<egoUUID>:<networkCanvasUUID>` (kind=alter, type=node type). Never merge across egos by name by default.
- Declared tie ego→alter for every alter (type = node type / "named"; weight from a chosen alter variable like `closeness`; attributes from alter row).
- Declared tie alter–alter per edge row (type = edge type, undirected, `perceivedBy=ego`).
- Time: `sessionStart` as observation time for all ties.

### Auto-detection
CSV header containing `networkCanvasEgoUUID` (+ `nodeID`/`networkCanvasUUID` → alters; `edgeID`,`from`,`to`,`networkCanvasSourceUUID` → edges; `networkCanvasCaseID` → ego). Filename pattern `_attributeList_`, `_edgeList_`, `_ego.csv`. GraphML with `xmlns:nc="http://schema.networkcanvas.com/xmlns"` or key `networkCanvasUUID`.

### Quirks
Per-session files — join on `networkCanvasEgoUUID`, never on `nodeID` (restarts at 1 per session). Merged Classic GraphML has multiple `<graph>`s (networkx/Gephi will read only one). Empty edge files exist. Unanswered categorical = all-false.

---

## 2. Other ego-network survey shapes

### Long ("three files") — egor standard
Used by EgoWeb 2.0, openeddi, EgoNet-derived data and egor itself.
```
egos.csv    egoID, <ego vars…>
alters.csv  egoID, alterID, <alter vars…>
aaties.csv  egoID, Source, Target, [weight, …]
```
- egor's `read_egoweb()` defaults (after R `read.csv` name-mangling): alters `EgoID, Alter.Number`; edges `EgoID, Alter.1.Number, Alter.2.Number`. Raw EgoWeb headers probably contain spaces (`Alter 1 Number`) — **not verified**; match case/space/dot-insensitively.
- `read_openeddi()` defaults: ego `puid`, alter `nameid`, source `nameid`, target `targetid`.
- EgoNet (McCarty): `read_egonet()` expects an ego file plus a folder of per-ego alter CSVs and a folder of per-ego edge CSVs (egor example: `alters_32/1.csv` with `alterID;…`, `edges_32/1.csv` with `Source;Target;weight`; semicolon-separated, decimal comma `0,333…`). EgoNet's own native export layout beyond this is not verified.

### Wide ("one file") — classic GSS/ALLBUS style
One row per ego; alter attributes repeated per slot; alter–alter ties as pair columns:
```
egoID;sex;age;netsize;alter.sex.1;alter.age.1;…;alter.sex.8;alter.age.8;X1.to.2;X1.to.3;…;X7.to.8
1;w;66 - 100;8;w;66 - 100;…;m;18 - 25;2;3;…;3
```
(egor `one_file_8.csv`.) Pair columns cover the upper triangle (k·(k−1)/2 for k slots). `netsize` used to drop empty slots. egor's `onefile_to_egor(aa.regex=…)` expects named groups `attr`, `src`, `tgt` — we should accept a user-editable regex too.

### Survey-tool roster/matrix layouts
| Tool | Shape | Column naming |
|---|---|---|
| Qualtrics (CSV/TSV) | 3 header rows: (1) internal ids `Q5_1…`, (2) question/choice text, (3) `{"ImportId":"QID5_1"}` | matrix rows `Q#_<row>`; side-by-side `Q#<n>_<m>`; loop & merge prefix `<loop>_Q#`; carry-forward `Q#_x<k>`; values as labels by default or numeric recodes |
| Google Forms → Sheets/CSV | 1 header row | grid questions: `Question text [Row label]` per row |

Typical name-generator designs:
1. **Free-recall name slots**: `Q3_1 … Q3_10` hold alter names; follow-ups via loop & merge (`1_Q4 … 10_Q4`) → wide-by-slot. Reshape: one alter per non-empty slot; key `egoID:slot`.
2. **Roster (sociocentric) matrix**: rows = respondents, columns = fixed roster members (`Q5_1` = "Avery", … from header row 2, or `Who do you go to for advice? [Avery]`). Cell = selected/rating. → Directed declared ties respondent → roster member; **this one is a full network** (roster bounded), not ego views; merge nodes across respondents by roster id.
3. **Alter–alter grid**: columns `Q8_<i>_<j>` or `[Name i] [Name j]` — rarely cleanly exportable; treat as wide pair columns with user-supplied pattern.

Wide → long algorithm: detect column groups by regex (`^(?<q>Q\d+)_(?<slot>\d+)$`, `^(?<slot>\d+)_(?<q>Q\d+)$`, `^(?<q>.+) \[(?<row>.+)\]$`), pivot to `(respondent, slot/row, question, value)`, then spread by question.

### Mapping
Same as Network Canvas: ego nodes, alter nodes namespaced by ego (except roster designs), ego→alter declared ties, alter–alter perceived ties, survey `EndDate`/`Timestamp` as tie time.

### Auto-detection
- Qualtrics: row 3 cells match `^\{"ImportId":` ; first-row has `StartDate`, `ResponseId`.
- Google Forms: first column `Timestamp`; headers with ` [ … ]`.
- egor/EgoWeb long: headers include ego-id + alter-id columns (`egoID|EgoID|puid` + `alterID|Alter.Number|Alter Number|nameid`).
- Wide: ≥2 columns matching `\.\d+$` or `_\d+$` with shared stem, plus `X?\d+\.to\.\d+`.

### Browser feasibility
All CSV — PapaParse. Qualtrics: skip rows 2–3 after reading labels. Google Sheets exports UTF-8; Excel-saved CSVs may be Windows-1252/semicolon (egor's examples are `;` + decimal comma).

---

## Sources
Official (Complex Data Collective)
- https://documentation.networkcanvas.com/en/analyze-data/data-export (fetched; also repo source `apps/documentation/docs/analyze-data/data-export.en.mdx`)
- `apps/documentation/docs/analyze-data/data-dictionary.en.mdx` in https://github.com/complexdatacollective/network-canvas-monorepo
- Exporter source in the same repo: `packages/shared-consts/src/export-process.ts`, `network.ts`, `session.ts`; `packages/network-exporters/src/formatters/csv/{egoList,attributeList,edgeList,adjacencyMatrix}.ts`; `formatters/graphml/{createGraphML,helpers,generateDataElements,generateKeyElements}.ts`; `session/{resequenceIds,insertEgoIntoSessionNetworks,partitionByType,exportFile,generateOutputFiles}.ts`; `utils/general.ts`
- Legacy: https://github.com/complexdatacollective/network-exporters `src/utils/reservedAttributes.js` (same constants)
Community / other
- https://github.com/tilltnet/egor (`R/read.egonet.R`, `R/read.egonet.three.files.R`, `R/read.ego.folders.R`, `man-roxygen/aa.regex.R`, `inst/extdata/*`)
- https://www.qualtrics.com/support/survey-platform/data-and-analysis-module/data/download-data/understanding-your-dataset/ (official Qualtrics; content via fetch summary)
- Google Forms grid header convention: third-party guides only (e.g. https://spreadsheetpoint.com/multiple-choice-grid-google-forms/) — no official Google doc opened
- https://cran.r-project.org/web/packages/ideanet/vignettes/nc_read.html (opened; no format details)
