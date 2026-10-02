# Network file formats (import + export)

All of these are **declared-tie** formats: they hold nodes, edges and attributes, not raw communication events. Import maps to `nodes + attributes` and `ties (source, target, weight, type, time)`. Observation scope is whatever the producer exported; we can't tell (record "unknown — user-supplied network").

Export rule of thumb for "opens cleanly everywhere": one directedness per file, string node ids that are also unique labels, numeric attributes typed as `double`/`long`, no list types, no nested graphs/hyperedges/ports, UTF-8, and time only in GEXF (or CSV columns for Gephi).

| Format | Gephi | networkx | igraph | Time | Typed attrs | Recommend export? |
|---|---|---|---|---|---|---|
| GraphML | yes (no sub-graphs/hyperedges) | yes (no mixed/hyper/nested/ports) | yes (basic, no nested/hyper) | no standard | yes (6 types) | **Yes** (default static) |
| GEXF 1.3 | native | reads 1.1draft/1.2draft/1.3; writes 1.2draft default | no | **yes** (spells, timestamps, dynamic attvalues) | yes (rich) | **Yes** (dynamic) |
| GML | partial | yes (strict) | yes | no | int/real/string | Optional |
| Pajek .net | labels only | yes | yes | no | weak | Optional (Pajek/UCINET users) |
| UCINET DL | fullmatrix + edgelist1 | no | yes | no | weight only | Optional |
| CSV (Gephi spreadsheet) | native | via pandas | via pandas | yes (Interval/Timestamp cols) | inferred | **Yes** (always offer) |

---

## 1. GraphML

**Producer:** Gephi, yEd, Cytoscape, networkx, igraph, NodeXL, Network Canvas, Visone.

### Grammar (GraphML Primer, graphml.ethz.ch)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">
  <key id="d0" for="node" attr.name="label" attr.type="string"/>
  <key id="d1" for="node" attr.name="team"  attr.type="string"><default>unknown</default></key>
  <key id="d2" for="edge" attr.name="weight" attr.type="double"/>
  <key id="d3" for="edge" attr.name="first_contact" attr.type="string"/>
  <graph id="G" edgedefault="directed">
    <node id="n0"><data key="d0">Avery Lin</data><data key="d1">Design</data></node>
    <node id="n1"><data key="d0">Jordan Pike</data></node>
    <edge id="e0" source="n0" target="n1"><data key="d2">4</data><data key="d3">2026-03-02T09:15:00Z</data></edge>
  </graph>
</graphml>
```
- `key@for`: `graph | node | edge | all` (also `graphml`, `hyperedge`, `port`, `endpoint` in schema). `attr.type`: `boolean, int, long, float, double, string`. Optional `<default>`.
- `graph@edgedefault`: `directed | undirected` (primer: required). `edge@directed="true|false"` overrides per edge (mixed graphs).
- `node@id` required, document-unique. `edge@id` optional. Self-loops allowed.
- Extensions to **ignore**: nested `<graph>` in nodes, `<hyperedge>`, `<port>`, `parse.*` attributes, and yEd data: keys with `yfiles.type="nodegraphics|edgegraphics|resources|..."` (no `attr.name`) whose `<data>` holds `y:ShapeNode`, `y:PolyLineEdge` etc. in namespace `http://www.yworks.com/xml/graphml`. networkx extracts only `y:NodeLabel` text → `label`, `y:Geometry` x/y; we should do the same.

### Tool expectations
- **networkx** `read_graphml`: missing `edgedefault` → undirected; raises on a `<data>` referencing an undeclared key, on a key with no `attr.name` (unless `yfiles.type`), on mixed directedness, on hyperedges. Accepts type `integer` ("for Gephi GraphML bug"). Booleans case-insensitive `true/false/0/1`.
- **Gephi**: "no sub-graphs and hyperedges"; yEd graphics "not supported at all". Its importer maps keys named `label`/`nodelabel`, `x`/`y`/`z`/`xpos`…, `size`, `r`/`g`/`b`, `color` (nodes) and `label`/`edgelabel`, `weight`/`Edge Weight`, `r/g/b`, `color` (edges) to built-in properties (ImporterGraphML.java; whether matched by key id or attr.name not verified — set both id and attr.name to the same word, e.g. `<key id="weight" attr.name="weight">`).
- **igraph**: "only the most basic import functionality": no nested graphs, no hyperedges.

### Time
No standard. Convention: string attribute in ISO-8601 (`first_contact`, `last_contact`) or numeric epoch. Gephi will not treat it as dynamic.

### Mapping
Node `id` → node key; `label`-like key → label; other `<data>` → typed attributes. Edge → tie (`weight` key if present else 1; `type` from directedness; any key named `type`/`relation`/`kind` → tie type). Parallel edges preserved as multiple ties.

### Auto-detection
XML root localName `graphml`, namespace `http://graphml.graphdrawing.org/xmlns` (some files omit namespace — match by localName).

### Browser
`DOMParser` (`application/xml`); use `getElementsByTagNameNS('*', 'node')` or localName to survive namespace variants; check for `<parsererror>`. Fine to ~100 MB; beyond, use a SAX parser (e.g. `saxes`) in a Worker. Export: build strings with XML escaping (`& < > " '`), strip XML-1.0-illegal control chars (U+0000–U+0008, U+000B, U+000C, U+000E–U+001F) — common in chat text.

---

## 2. GEXF 1.2draft / 1.3

**Producer:** Gephi (native), networkx (writes `1.2draft` by default), Gephi Lite, sigma.js tools.

### Namespaces
| Version | xmlns | viz |
|---|---|---|
| 1.2draft | `http://www.gexf.net/1.2draft` | `http://www.gexf.net/1.2draft/viz` |
| 1.3 | `http://gexf.net/1.3` (note: no `www.`) | `http://gexf.net/1.3/viz` |
`<gexf version="1.2">` / `version="1.3"`.

### Minimal static (1.3)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<gexf xmlns="http://gexf.net/1.3" xmlns:viz="http://gexf.net/1.3/viz" version="1.3">
  <meta lastmodifieddate="2026-10-02"><creator>Org Signal</creator></meta>
  <graph mode="static" defaultedgetype="directed">
    <attributes class="node">
      <attribute id="team" title="team" type="string"/>
      <attribute id="msgs" title="messages_sent" type="integer"><default>0</default></attribute>
    </attributes>
    <attributes class="edge">
      <attribute id="channel" title="channel" type="string"/>
    </attributes>
    <nodes>
      <node id="u1" label="Avery Lin">
        <attvalues><attvalue for="team" value="Design"/><attvalue for="msgs" value="42"/></attvalues>
        <viz:color r="70" g="90" b="200"/><viz:size value="8"/>
      </node>
      <node id="u2" label="Jordan Pike"/>
    </nodes>
    <edges>
      <edge id="e1" source="u1" target="u2" weight="4.0">
        <attvalues><attvalue for="channel" value="#launch"/></attvalues>
      </edge>
    </edges>
  </graph>
</gexf>
```

### Key rules (1.3 primer + changelog)
- `defaultedgetype`: `directed | undirected | mutual`; per-edge `type` overrides. `weight` is double, default 1.0. Edge `id` optional in 1.3, required in the 1.2draft XSD — always write it.
- Parallel edges: must differ by `kind` attribute (source–target–kind unique).
- `<attributes class="node|edge" mode="static|dynamic">`; `<attribute id title type>`; `<attvalue for="<attribute id>" value="…">`.
- Types 1.3: `integer, long, double, float, boolean, string, anyURI, bigdecimal, biginteger, byte, short, char, liststring, listboolean, listinteger, listlong, listfloat, listdouble, listbyte, listshort, listbigdecimal, listbiginteger, listchar`. 1.2: `integer, long, double, float, boolean, string, liststring, anyURI`.
- List syntax: 1.3 `[foo, bar]`; 1.2 liststring separated by `|`, `,` or `;` ("unsafe type"). Avoid lists on export.
- viz: `color r g b [a]` (1.3 also `hex`), `position x y [z]`, `size value`, `thickness value`, `shape value` (node: disc, square, triangle, diamond, image; edge: solid, dotted, dashed, double). 1.3 viz is not dynamic.

### Time (dynamics)
```xml
<graph mode="dynamic" defaultedgetype="directed" timeformat="dateTime" timerepresentation="timestamp" timezone="UTC">
  <attributes class="edge" mode="dynamic">
    <attribute id="weight" title="weight" type="double"/>
  </attributes>
  <nodes><node id="u1" label="Avery Lin"/><node id="u2" label="Jordan Pike"/></nodes>
  <edges>
    <edge id="e1" source="u1" target="u2">
      <spells><spell timestamp="2026-03-02T09:15:00Z"/><spell timestamp="2026-03-04T16:40:00Z"/></spells>
      <attvalues>
        <attvalue for="weight" value="1" timestamp="2026-03-02T09:15:00Z"/>
        <attvalue for="weight" value="2" timestamp="2026-03-04T16:40:00Z"/>
      </attvalues>
    </edge>
  </edges>
</graph>
```
- `mode`: `static | dynamic | slice` (1.3). `timeformat`: `integer | double` (default) `| date | dateTime`. `timerepresentation`: `interval` (default) `| timestamp` — **cannot mix**.
- Interval: `start`/`end` on node/edge/spell/attvalue; inclusive in 1.3 (1.2 had `startopen`/`endopen`, removed in 1.3); missing bound = ±infinity. Spells must not overlap. Edge time should lie within both endpoints' time.
- Compact alternatives (1.3): `timestamps="<[2019-03-20, 2019-03-21]>"`, `intervals="<[4.0, 14.0]; [21.0, 124.0]>"`.
- Dynamic weight: an edge attribute titled `weight` in `mode="dynamic"` overrides static `weight`.
- **Gephi caution:** primer says nodes must exist when their edges do. For events, simplest robust export: interval representation, node spells = [first activity, last activity], edge spells = per-day/week bins, or timestamp representation with one spell per event.

### Tool expectations
- networkx `read_gexf` tries the requested version namespace, then each of `1.1draft`, `1.2draft`, `1.3`; reads `timeformat="date"` as string. networkx type map has no `list*` (except `liststring`), no `bigdecimal` etc. → **export 1.2draft-compatible types** (`integer/long/double/float/boolean/string`) for widest compatibility while declaring 1.3 namespace for Gephi ≥0.9.3. Safer still: offer "GEXF 1.2 (compat)" and "GEXF 1.3".
- Gephi: full 1.3 support "guaranteed in 0.9.3" and above.
- igraph: no GEXF reader in C core (not verified for python-igraph extras).

### Auto-detection
Root localName `gexf`; namespace contains `gexf.net`; read `version`.

### Browser
DOMParser; namespaces vary (`www.gexf.net/1.2draft` vs `gexf.net/1.3`) → match by localName. Parse spells/attvalue time with `timeformat` awareness (double vs ISO).

---

## 3. GML

**Producer:** networkx, igraph, Cytoscape, yEd, Mark Newman's datasets, Gephi (partial).

### Grammar
Nested `key value` lists; keys `[A-Za-z][0-9A-Za-z_]*`; values int, real (incl. `INF`), `"string"` (no embedded `"`), or `[ … ]`. `#` starts a comment.
```
graph [
  directed 1
  node [ id 0 label "Avery Lin" team "Design" ]
  node [ id 1 label "Jordan Pike" ]
  edge [ source 0 target 1 weight 4.0 channel "&#35;launch" ]
]
```
- `directed 1` (default 0). networkx also uses `multigraph 1`.
- Encoding: networkx: "7-bit ASCII encoding with any extended ASCII characters (iso8859-1) appearing as HTML character entities" and its writer emits `&#N;`. igraph GML reader: "Only the quot, amp, apos, lt and gt character entities are supported" → numeric entities likely survive as literal text. Non-ASCII names are lossy in at least one tool whichever way we write them.

### Tool expectations
- networkx `read_gml(label='label')`: every node must have `id` and (by default) a **unique `label`** — duplicate labels or missing label raise; duplicate edges raise unless `multigraph 1`; refuses non-ASCII input.
- igraph: only simple-typed attributes; composite attributes ignored; comment fields treated as data; top-level attributes except `Version` and the first graph ignored.
- Gephi: "does not provide complete support".

### Export recipe
Integer ids 0..n-1, unique string `label` (dedupe by suffix), ASCII + `&#N;` escapes, attribute keys sanitised to `[A-Za-z][A-Za-z0-9]*` (igraph prefixes invalid names with `igraph`), NaN omitted, `multigraph 1` if parallel edges.

### Auto-detection
Text starting (after comments/whitespace, optional `Creator "…"`/`Version` lines) with `graph [` or `graph\n[`.

### Browser
Write a small tokenizer (regex set as networkx). Trivial.

---

## 4. Pajek .net

**Producer:** Pajek, networkx, igraph, UCINET export, many SNA datasets.

```
*Vertices 3
1 "Avery Lin" 0.1 0.2 0.5
2 "Jordan Pike"
3 "Sam Ortiz"
*Arcs
1 2 4
2 3 1
*Edges
1 3 2
```
- Header `*Vertices N` (case-insensitive); vertex lines `id "label" [x y z] [shape] [key value]…`, ids **1-based consecutive**. Two-mode: `*Vertices N N1` (first N1 are mode 1; igraph adds boolean `type`). Vertex lines may be omitted (Gephi: "the importer relies on the vertices count").
- `*Arcs` = directed, `*Edges` = undirected, `*Arcslist`/`*Edgeslist` = adjacency lists (`src t1 t2 …`), `*Matrix` = adjacency matrix. Third value on arc/edge line = weight. `%` comment lines. Optional `*Network name`.
- Attributes are Pajek drawing params (`ic`, `bc`, `x_fact`, `c`, `w`, `l`…), igraph renames (`c`→`color`, `x_fact`→`xfact`, `lr`→`labeldist`).

### Tool expectations
- networkx `read_pajek`: returns MultiDiGraph/MultiGraph; uses **label as node key**; splits with `shlex` (quotes, backslash escapes); expects exactly N vertex lines after `*Vertices`; mixed `*Arcs` + `*Edges` collapses to one directedness; `*Matrix` weights parsed as int.
- igraph: no temporal, no mixed directed/undirected, no multi-relational, no `&#dddd;` Unicode entities or `\n` escapes.
- Gephi: "typically only imports the label".

### Time
Pajek has its own time-interval notation in some files (`[1-5]`) — **not verified**, not supported by igraph; don't import/export time.

### Export recipe
`*Vertices N`, every vertex line present with quoted unique label (escape `"` and `\`), then one of `*Arcs` or `*Edges` with weight; UTF-8 (networkx default) — Pajek itself historically expects ANSI; unverified.

### Auto-detection
First non-comment line matches `/^\*vertices\s+\d+/i` (or `*network`).

---

## 5. UCINET DL

Official spec: UCINET help "DL LANGUAGE" (analytictech.com/ucinet/help/hs5000.htm).

```
DL N=4
FORMAT = FULLMATRIX
LABELS:
Avery,Jordan,Sam,Riley
DATA:
0 1 1 0
1 0 0 1
0 0 0 0
1 0 0 0
```
```
dl n=4 format=edgelist1
labels embedded
data:
Avery Jordan 4
Jordan Sam
Avery Sam 2
```
- Header keywords (case-insensitive): `DL` (first word, required), `N=`, `NR=`/`NC=`, `NM=` (number of matrices), `FORMAT=`, `LABELS:`, `ROW LABELS:`, `COLUMN LABELS:`, `MATRIX LABELS:`, `… EMBEDDED`, `DIAGONAL = PRESENT|ABSENT`, `DATA:` ends header.
- Formats: `FULLMATRIX|FM` (default), `UPPERHALF|UH`, `LOWERHALF|LH`, `NODELIST1|NL1`, `NODELIST1B|NL1B`, `NODELIST2|NL2`, `EDGELIST1|EL1` (1-mode pairs + optional value, default 1.0), `EDGELIST2|EL2` (2-mode), `BLOCKMATRIX|BM`, `PARTITION`.
- Labels: separated by spaces, CRs, `=` or commas; ≤18 chars (truncated); **converted to uppercase** by UCINET; quote labels with spaces. Edgelist1 without LABELS: nodes numbered in order of first appearance; labels in data not in LABELS become extra nodes.
- Multiple matrices (`NM=2`) are stacked; e.g. multiplex relations.
- No direction flag: matrices are directed (x_ij); symmetric matrix = undirected.

### Tool expectations
- Gephi: "fullmatrix and edgelist1 sub-formats" only.
- igraph: reads DL with vertex names and weights; exact sub-format coverage not verified.
- networkx: no DL reader.

### Export recipe
`edgelist1` + `labels embedded` for sparse graphs (labels sanitised to ≤18 chars, no spaces, unique); `fullmatrix` only for n ≲ 500. Note in UI that UCINET uppercases labels.

### Auto-detection
First token `/^\s*dl\b/i`.

---

## 6. CSV edge lists, adjacency matrices, Gephi spreadsheet

### Gephi spreadsheet conventions (Data Laboratory "Import Spreadsheet"; AbstractImporterSpreadsheet.java)
Auto-mode detection from the header row:
| First row | Mode |
|---|---|
| first cell empty | adjacency **matrix** |
| any cell `Source` or `Target` (case-insensitive) | **edges table** |
| any cell `Id`, `Label`, or `Timeset` | **nodes table** |
| otherwise | adjacency **list** (`node;neighbor1;neighbor2…`) |

Special columns (case-insensitive):
- Nodes: `Id` (string; auto id if missing/empty), `Label`, `Timeset`, any column containing `interval` → IntervalSet, containing `timestamp` → TimestampSet.
- Edges: `Source`, `Target` (mandatory; missing nodes auto-created), `Type` (`Undirected` → undirected; anything else/absent → **Directed**), `Kind` (parallel-edge kind), `Id`, `Label`, `Weight` (forced to double, or dynamic double map), plus `Interval`/`Timestamp`/`Timeset`.
- Other columns: type auto-detected (int/long/double/boolean/string, or dynamic maps); user can override.
- Dynamic cell syntax (graphstore AttributeUtils tests):
  - IntervalSet `<[1, 2]; [21.0, 124.0]>`; TimestampSet `<[1, 2, 21.0, 124.0]>` or `<[2015-01-01T00:00:00]>`
  - Interval map `<[2007, 2008, 25.5]; [2008, 2009, 42.5]>`; Timestamp map `<[2015-01-01, 3]; [2015-02-01, 5]>`
  - Dates accepted as `2014-01-01` or `2014-01-01T00:00:00Z`.
- Separator chosen in wizard (comma, semicolon, tab, space); matrix/adjacency lists conventionally `;`. Matrix weights parsed with `,`→`.` replacement; 0 = no edge.

Export (our "Gephi CSV" pair):
```csv
Id,Label,team,messages_sent,Timeset
u1,Avery Lin,Design,42,"<[2026-03-02T09:15:00Z, 2026-03-04T16:40:00Z]>"
u2,Jordan Pike,,0,"<[2026-03-02T09:15:00Z]>"
```
```csv
Source,Target,Type,Weight,channel,Timestamp
u1,u2,Directed,2,#launch,"<[2026-03-02T09:15:00Z, 2026-03-04T16:40:00Z]>"
```
Keep timestamp representation consistent across both files (Gephi can't mix).

### Plain edge list (generic)
Common headers we should recognise on import (case-insensitive, trim): source ∈ {`source, from, sender, ego, src, node1, actor, i, u`}, target ∈ {`target, to, receiver, recipient, alter, dst, node2, j, v`}, weight ∈ {`weight, value, count, n, strength`}, time ∈ {`time, timestamp, date, datetime, created_at`}, type ∈ {`type, relation, tie, kind`}. Headerless 2–3 column numeric files (networkx `write_edgelist`, igraph `ncol`: "two symbolic vertex names separated by whitespace", optional weight) → whitespace or comma split. (This alias list is our convention, not a standard.)

### Adjacency matrix CSV
Square table; first row = column labels with empty first cell; first column = row labels; cell = weight (blank/0 = none). Directed unless symmetric; diagonal = self-loops (usually ignore). Gephi matrix mode keys on the empty top-left cell.

### Browser
PapaParse (header + dynamicTyping off; type ourselves). Sniff delimiter on first line (`,`/`;`/`\t`). Strip BOM. Excel exports may be UTF-16LE or Windows-1252 — detect BOM/try `TextDecoder('windows-1252')` fallback.

---

## Internal-model mapping summary
| Element | Node | Tie |
|---|---|---|
| id | GraphML/GEXF `id`, GML `id`, Pajek index, DL label/index, CSV `Id` | — |
| label | `label` key / attr / quoted Pajek label | — |
| weight | — | GraphML `weight` key, GEXF `weight`, GML `weight`/`value`, Pajek 3rd col, DL value, CSV `Weight` |
| directed | — | `edgedefault`/`directed`, `defaultedgetype`/`type`, GML `directed`, `*Arcs` vs `*Edges`, CSV `Type` |
| time | GEXF spells/start/end/timestamp, CSV Timeset/Interval/Timestamp | same; GraphML/GML/Pajek/DL: none |
| tie type | — | GEXF `kind`, CSV `Kind`, attr `type/relation`, DL multiple matrices (`MATRIX LABELS`) |

## Sources
Official / specification
- http://graphml.ethz.ch/primer/graphml-primer.html (GraphML Primer; graphdrawing.org host had TLS mismatch)
- https://gexf.net/ and https://github.com/gephi/gexf (README changelog; `primer/1.3/gexf-13-primer.tex`; `primer/1.2draft/gexf-12draft-primer.tex`; `specs/1.3/gexf.xsd`, `dynamics.xsd`, `viz.xsd`)
- http://www.analytictech.com/ucinet/help/hs5000.htm (UCINET DL language — fetched via curl; TLS mismatch)
- https://github.com/gephi/gephi-documentation (`gephi-desktop/docs/User_Manual/Import/*.md`, `Import_Dynamic_Data.md`) = docs.gephi.org
- https://docs.gephi.org/desktop/User_Manual/Import/UCINET_DL_Format/
- https://igraph.org/c/doc/igraph-Foreign.html
Implementations (source read)
- https://github.com/networkx/networkx `networkx/readwrite/graphml.py`, `gexf.py`, `gml.py`, `pajek.py`
- https://github.com/gephi/gephi `modules/ImportPlugin/.../spreadsheet/AbstractImporterSpreadsheet.java`, `.../process/ImportEdgesProcess.java`, `ImportMatrixProcess.java`, `ImportAdjacencyListProcess.java`, `.../file/ImporterGraphML.java`
- https://github.com/gephi/graphstore `src/test/java/org/gephi/graph/api/AttributeUtilsTest.java`
