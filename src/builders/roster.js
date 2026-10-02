// Bounded (roster) network builder.
//
// A roster design fixes the population first: every member is asked about
// every other member, so the result is a full network of the group (view
// 'full'), not a set of ego networks. Two ways to collect:
//   single informant  one person (often the researcher) fills a who-to-whom grid
//   multi respondent  each member answers for themselves through a survey form;
//                     their self-reports are merged by a rule the user picks.
//
// Model (plain JSON, autosaved by the UI):
//   { version, name,
//     people:      [{ id, label, attrs{} }],
//     attrColumns: [{ key, type }],
//     relations:   [{ id, name, question, scale: 'binary'|'valued', max }],
//     mode:        'single' | 'multi',
//     ties:        { [relationId]: { 'from|to': value } }       single informant
//     responses:   { respondents: [{ personId, label, ties: { [relationId]: {'from|to': v} } }],
//                    file, unmatchedNames[], unmatchedQuestions[], warnings[] } | null
//     mergeRule:   'union' | 'intersection' | 'respondent' }

import { DatasetBuilder } from '../core/model.js';
import { parseCSV, rowsToObjects } from '../importers/tabular.js';
import { uid, slug, normName, toCSV, coerce } from './common.js';
import { pairKey, splitKey, cellValue, nameIndex } from './matrix.js';

export const RELATION_PRESETS = [
  { key: 'knows', name: 'Knows', question: 'Which of these people do you know?', scale: 'binary' },
  { key: 'works_with', name: 'Works with', question: 'Who do you work with regularly?', scale: 'binary' },
  { key: 'advice', name: 'Advice', question: 'Who do you go to for advice about work?', scale: 'binary' },
  { key: 'trust', name: 'Trust', question: 'Whom would you trust with a sensitive work matter?', scale: 'binary' },
  { key: 'friendship', name: 'Friendship', question: 'Whom do you consider a personal friend?', scale: 'binary' },
];

export const MERGE_RULES = [
  { id: 'union', label: 'Union', help: 'A tie exists if either person reports it. Ties are treated as undirected; a valued tie takes the larger of the two answers.' },
  { id: 'intersection', label: 'Reciprocated only', help: 'A tie exists only if both people report it (intersection). Undirected; a valued tie takes the smaller answer.' },
  { id: 'respondent', label: 'As reported', help: 'Each tie is directed from the respondent to the person they named, exactly as answered. Non-respondents send no ties.' },
];

export function newRoster() {
  return { version: 1, name: 'Roster network', people: [], attrColumns: [], relations: [], mode: 'single', ties: {}, responses: null, mergeRule: 'union' };
}

export function makeRelation(preset = {}) {
  return { id: uid('r'), name: preset.name || 'Relation', question: preset.question || '', scale: preset.scale || 'binary', max: preset.max || 5 };
}

// Roster text -> people. Either one name per line, or a CSV/TSV whose header
// has a name column (name, full name, label, person, member) plus attribute
// columns. Two shapes are not rosters and say so instead of turning every
// line into a "person":
//   survey: true       a survey responses export (grid columns "Question [Name]"
//                      or a Qualtrics export); use rosterFromResponses
//   needsColumn: true  a table with no recognisable name column; `headers`
//                      lists its columns, and parseRosterText(text, { nameColumn })
//                      reads it with the one the user picks
// options.nameColumn: a header to read names from, or '' for "each whole line
// is one name".
const NAME_HEADER = /^(name|full name|full_name|label|person|member|student|participant|your name)$/i;

export function parseRosterText(text, { nameColumn } = {}) {
  const t = String(text ?? '').replace(/^\ufeff/, '').trim();
  const empty = { people: [], attrColumns: [], duplicates: [] };
  if (!t) return empty;
  const lines = t.split(/\r?\n/);
  const first = lines[0];
  const delimited = /[,\t;]/.test(first);
  let people = [], attrColumns = [];
  if (delimited && nameColumn !== '') {
    const rows = parseCSV(t).rows;
    if (looksLikeResponses(rows)) return { ...empty, survey: true };
    const head = (rows[0] || []).map(h => String(h).trim());
    const nameCol = nameColumn ? head.find(h => h === nameColumn) : head.find(h => NAME_HEADER.test(h));
    // A table: most rows have the header's column count.
    const tabular = head.length >= 2 && rows.slice(1).filter(r => r.length === head.length).length >= Math.max(1, (rows.length - 1) * 0.8);
    if (!nameCol && tabular) return { ...empty, needsColumn: true, headers: head.filter(Boolean), sample: rows.slice(1, 4) };
    if (nameCol) {
      const { headers, records } = rowsToObjects(rows);
      const attrKeys = headers.filter(h => h !== nameCol && h);
      for (const r of records) {
        const label = String(r[nameCol] ?? '').trim();
        if (!label) continue;
        const attrs = {};
        for (const k of attrKeys) if (r[k] !== '') attrs[k] = r[k];
        people.push({ id: uid('p'), label, attrs });
      }
      attrColumns = attrKeys.map(key => ({ key, type: people.every(p => p.attrs[key] === undefined || Number.isFinite(Number(p.attrs[key]))) ? 'number' : 'text' }));
    }
  }
  if (!people.length && !attrColumns.length) {
    people = lines.map(x => x.trim()).filter(Boolean).map(label => ({ id: uid('p'), label, attrs: {} }));
  }
  // Duplicate names make the matrix ambiguous; keep the first and report the rest.
  const seen = new Set(), duplicates = [];
  people = people.filter(p => { const k = normName(p.label); if (seen.has(k)) { duplicates.push(p.label); return false; } seen.add(k); return true; });
  return { people, attrColumns, duplicates };
}

// A survey export: Google Forms grid columns `Question [Row]` (at least two),
// or Qualtrics' third header row of {"ImportId":...}.
function looksLikeResponses(rows) {
  if (rows.length >= 3 && (rows[2] || []).some(c => /^\{"ImportId":/.test(String(c).trim()))) return true;
  return (rows[0] || []).filter(h => /^.*\S\s*\[.+\]\s*$/.test(String(h))).length >= 2;
}

// A survey responses export -> a whole roster model, so the file can be the
// starting point: people from the grid's row labels (in form order) plus any
// respondent the grid does not list, one relation per question, survey mode,
// the responses read, and the default combine rule. Returns null when the
// text is not a responses export.
export function rosterFromResponses(text, { file = null, name = null } = {}) {
  const { rows } = parseCSV(String(text ?? '').replace(/^\ufeff/, ''));
  if (!looksLikeResponses(rows)) return null;
  const qualtrics = rows.length >= 3 && rows[2].some(c => /^\{"ImportId":/.test(String(c).trim()));
  const header = qualtrics ? rows[1] : rows[0];
  const ids = qualtrics ? rows[0] : null;
  const stems = [], labels = [];
  header.forEach((h, j) => {
    let m = String(h).match(/^(.*\S)\s*\[(.+)\]\s*$/);
    if (!m && qualtrics && /^Q\d+_\d+$/i.test(String(ids[j]).trim())) m = String(h).match(/^(.*\S)\s+-\s+(.+)$/);
    if (!m) return;
    if (!stems.includes(m[1].trim())) stems.push(m[1].trim());
    labels.push(m[2].trim());
  });
  const model = newRoster();
  model.name = name || (file ? file.replace(/\.[^.]+$/, '') : 'Survey roster');
  const seen = new Set();
  const addPerson = label => { const k = normName(label); if (!k || seen.has(k)) return; seen.add(k); model.people.push({ id: uid('p'), label, attrs: {} }); };
  for (const l of labels) addPerson(l);
  model.relations = stems.map(q => makeRelation({ name: relationName(q), question: q }));
  model.mode = 'multi';
  // Respondents the grid does not list still belong on the roster.
  const data = rows.slice(qualtrics ? 3 : 1);
  const respCol = header.findIndex(h => /^(your name|name|what is your name\??|who are you\??|respondent|respondent name)$/i.test(String(h).trim()));
  if (respCol >= 0) for (const r of data) addPerson(String(r[respCol] ?? '').trim());
  model.responses = { ...parseRosterResponses(text, model), file };
  return model;
}

// "Who do you spend free time with?" -> "Spend free time with", short enough
// to label a relation; the full question stays as the relation's question.
function relationName(q) {
  const t = String(q).replace(/[?:.]+\s*$/, '').replace(/^(who|whom)\s+(do|would|did)\s+you\s+/i, '').trim();
  const out = t.charAt(0).toUpperCase() + t.slice(1);
  return out.length > 40 ? out.slice(0, 38).replace(/\s+\S*$/, '') + '...' : out || 'Relation';
}

// ---- survey form template (multi-respondent) ---------------------------------

// Column shapes follow docs/formats/network-canvas-and-surveys.md
// ("Survey-tool roster/matrix layouts"):
//   Google Forms -> one header row; grid questions as `Question text [Row label]`
//   Qualtrics    -> 3 header rows: ids (Q2_1 ...), text, {"ImportId":...}
export const RESPONDENT_QUESTION = 'Your name';

export function formTemplate(model) {
  const { people, relations } = model;
  if (!people.length || !relations.length) throw new Error('Add the roster and at least one relation first.');
  // Google Forms layout; one blank row per member so it doubles as a
  // data-entry sheet for paper questionnaires.
  const gHeader = ['Timestamp', RESPONDENT_QUESTION];
  for (const r of relations) for (const p of people) gHeader.push(`${r.question || r.name} [${p.label}]`);
  const gRows = [gHeader, ...people.map(p => ['', p.label, ...relations.flatMap(() => people.map(() => ''))])];
  // Qualtrics layout. Row 2 "Question - Row label" and the ImportId row are the
  // usual export shape; the exact choice-text joiner is UNVERIFIED in the spec,
  // so the parser accepts any " - " suffix.
  const ids = ['StartDate', 'EndDate', 'ResponseId', 'Q1'];
  const text = ['Start Date', 'End Date', 'Response ID', 'What is your name?'];
  const imp = ['{"ImportId":"startDate"}', '{"ImportId":"endDate"}', '{"ImportId":"_recordId"}', '{"ImportId":"QID1"}'];
  relations.forEach((r, qi) => people.forEach((p, i) => {
    ids.push(`Q${qi + 2}_${i + 1}`);
    text.push(`${r.question || r.name} - ${p.label}`);
    imp.push(`{"ImportId":"QID${qi + 2}_${i + 1}"}`);
  }));
  return {
    googleCsv: toCSV(gRows),
    qualtricsCsv: toCSV([ids, text, imp]),
    instructions: formInstructions(model),
  };
}

export function formInstructions({ people, relations }) {
  const names = people.map(p => p.label);
  const rel = relations.map((r, i) => `  ${i + 1}. ${r.question || r.name} (${r.scale === 'valued' ? `rate 1 to ${r.max || 5}, blank for none` : 'tick everyone who applies'})`).join('\n');
  return `ROSTER SURVEY: HOW TO BUILD THE FORM

The roster has ${names.length} people. Every respondent answers the same grid question(s):
${rel}

Ask each respondent to identify themselves first, by choosing their own name from the
roster, so their answers can be matched to the grid.

GOOGLE FORMS
1. Add a "Dropdown" question titled exactly "${RESPONDENT_QUESTION}" and paste the roster
   (one name per line) as its options. Make it required.
2. For each relation add a grid question:
   - binary relation: "Checkbox grid" with rows = the roster names and a single
     column such as "Yes";
   - valued relation: "Multiple choice grid" with rows = the roster names and
     columns 1 to the top of the scale.
   Use the question text shown above as the title.
3. Optional: "Require a response in each row" off, so people can leave rows blank.
4. Responses > Link to Sheets, then File > Download > Comma-separated values.
   The export has a "Timestamp" column, the "${RESPONDENT_QUESTION}" column, and one column
   per roster member named "Question text [Name]". Import that file here.

QUALTRICS
1. Add a multiple-choice question "What is your name?" (dropdown) with the roster as
   choices.
2. For each relation add a "Matrix table" question: statements (rows) = the roster
   names; for a binary relation use a single "Yes" scale point with "Allow multiple
   answers" or a Likert "Yes / No"; for a valued relation use scale points 1 to the
   top of the scale. Keep the roster order.
3. Data & Analysis > Export & Import > Export data > CSV, "Use choice text".
   The file has three header rows: internal ids (Q2_1, Q2_2, ...), the question text
   ending in " - Name", and {"ImportId":...}. Import that file here unchanged.

Names in the export are matched to the roster ignoring case, spacing and accents.
A respondent who skips the grid simply sends no ties.

Roster (paste into the dropdown options):
${names.join('\n')}
`;
}

// ---- parsing responses ---------------------------------------------------------

// Responses CSV (Google Forms or Qualtrics shape) -> respondents with their
// reported ties. options.labels: Map(normName(answer) -> number) for valued scales.
export function parseRosterResponses(text, model, { labels = null } = {}) {
  const { rows } = parseCSV(String(text ?? ''));
  const warnings = [];
  if (rows.length < 2) return { respondents: [], unmatchedNames: [], unmatchedQuestions: [], warnings: ['The file has no response rows.'] };
  const qualtrics = rows.length >= 3 && rows[2].some(c => /^\{"ImportId":/.test(String(c).trim()));
  const header = qualtrics ? rows[1] : rows[0];
  const ids = qualtrics ? rows[0] : null;
  const data = rows.slice(qualtrics ? 3 : 1);
  const people = model.people;
  const idx = nameIndex(people);

  // Respondent column: the self-identification question.
  let respCol = header.findIndex(h => /^(your name|name|what is your name\??|who are you\??|respondent|respondent name)$/i.test(String(h).trim()));
  if (respCol < 0) respCol = header.findIndex(h => /\bname\b/i.test(h) && !/\[.+\]\s*$/.test(h) && !/ - /.test(h));

  // Grid columns -> (question stem, row label).
  const cols = [];
  header.forEach((h, j) => {
    if (j === respCol) return;
    let m = String(h).match(/^(.*\S)\s*\[(.+)\]\s*$/); // Google Forms
    if (!m && qualtrics && /^Q\d+_\d+$/i.test(String(ids[j]).trim())) m = String(h).match(/^(.*\S)\s+-\s+(.+)$/); // Qualtrics
    if (!m) return;
    cols.push({ j, stem: m[1].trim(), row: m[2].trim() });
  });
  const stems = [...new Set(cols.map(c => c.stem))];
  // Stems -> relations: by question text or name, else by order when the counts agree.
  const relOf = new Map();
  const unmatchedQuestions = [];
  stems.forEach((s, i) => {
    const r = model.relations.find(r => normName(r.question) === normName(s) || normName(r.name) === normName(s));
    if (r) relOf.set(s, r.id);
    else if (stems.length === model.relations.length) relOf.set(s, model.relations[i].id);
    else if (model.relations.length === 1 && stems.length === 1) relOf.set(s, model.relations[0].id);
    else unmatchedQuestions.push(s);
  });
  if (stems.length === model.relations.length && stems.some(s => !model.relations.some(r => normName(r.question) === normName(s) || normName(r.name) === normName(s)))) {
    warnings.push('Some question texts did not match a relation exactly; they were matched by order.');
  }

  const unmatchedNames = new Set();
  for (const c of cols) { c.to = idx.get(normName(c.row)) ?? null; if (!c.to) unmatchedNames.add(c.row); }
  if (respCol < 0) warnings.push('No "Your name" column was found, so answers cannot be attributed to respondents.');

  const byPerson = new Map();
  let anonymous = 0;
  for (const r of data) {
    if (!r.some(c => String(c).trim())) continue;
    const who = respCol >= 0 ? String(r[respCol] ?? '').trim() : '';
    const from = idx.get(normName(who));
    if (!from) { if (who) unmatchedNames.add(who); else anonymous++; continue; }
    // A later submission by the same person replaces the earlier one.
    const ties = {};
    for (const rel of model.relations) ties[rel.id] = {};
    for (const c of cols) {
      const rel = relOf.get(c.stem);
      if (!rel || !c.to || c.to === from) continue;
      const v = cellValue(r[c.j], labels);
      if (v) ties[rel][pairKey(from, c.to)] = v;
    }
    if (byPerson.has(from)) warnings.push(`${who} answered more than once; the last answer is used.`);
    byPerson.set(from, { personId: from, label: people.find(p => p.id === from).label, ties });
  }
  if (anonymous) warnings.push(`${anonymous} response(s) without a name were skipped.`);
  return { respondents: [...byPerson.values()], unmatchedNames: [...unmatchedNames], unmatchedQuestions, warnings, format: qualtrics ? 'qualtrics' : 'google-forms' };
}

// A Dataset from the survey importer -> respondents, so the same merge rules
// apply whichever parser read the file. Declared events actor -> target.
export function responsesFromDataset(ds, model) {
  const idx = nameIndex(model.people);
  const byPerson = new Map();
  const unmatchedNames = new Set();
  const { tOff, tgt, actor, type, context, weight } = ds.events;
  const DECLARED = 2; // EVENT_TYPES index of 'declared'
  for (let e = 0; e < ds.events.count; e++) {
    if (type[e] !== DECLARED) continue;
    const fromLabel = ds.nodes.labels[actor[e]];
    const from = idx.get(normName(fromLabel));
    if (!from) { unmatchedNames.add(fromLabel); continue; }
    const cname = context[e] >= 0 ? ds.contexts.names[context[e]] : '';
    const rel = model.relations.find(r => normName(r.question) === normName(cname) || normName(r.name) === normName(cname)) || (model.relations.length === 1 ? model.relations[0] : null);
    if (!rel) continue;
    if (!byPerson.has(from)) byPerson.set(from, { personId: from, label: model.people.find(p => p.id === from).label, ties: Object.fromEntries(model.relations.map(r => [r.id, {}])) });
    for (let j = tOff[e]; j < tOff[e + 1]; j++) {
      const toLabel = ds.nodes.labels[tgt[j]];
      const to = idx.get(normName(toLabel));
      if (!to) { unmatchedNames.add(toLabel); continue; }
      if (to !== from) byPerson.get(from).ties[rel.id][pairKey(from, to)] = weight[e] || 1;
    }
  }
  return { respondents: [...byPerson.values()], unmatchedNames: [...unmatchedNames], unmatchedQuestions: [], warnings: [], format: ds.meta.sources[0]?.format || 'survey' };
}

// ---- merging self-reports --------------------------------------------------------

// respondents -> one tie map for a relation under a rule.
//   union         {i,j} if i->j or j->i reported; value max; undirected
//   intersection  {i,j} if i->j and j->i reported; value min; undirected
//   respondent    i->j as reported; directed
// Undirected results are stored once per pair with from < to in roster order.
export function mergeResponses(respondents, relationId, rule, people) {
  const reported = {};
  for (const r of respondents) Object.assign(reported, r.ties[relationId] || {});
  if (rule === 'respondent') return { ties: { ...reported }, directed: true, stats: { reported: Object.keys(reported).length, ties: Object.keys(reported).length } };
  const order = new Map(people.map((p, i) => [p.id, i]));
  const canon = new Set();
  for (const k of Object.keys(reported)) {
    const [a, b] = splitKey(k);
    canon.add((order.get(a) ?? 0) <= (order.get(b) ?? 0) ? pairKey(a, b) : pairKey(b, a));
  }
  const ties = {};
  let reciprocated = 0, oneSided = 0;
  for (const k of canon) {
    const [a, b] = splitKey(k);
    const f = reported[k] || 0, g = reported[pairKey(b, a)] || 0;
    if (f && g) reciprocated++; else oneSided++;
    if (rule === 'union') ties[k] = Math.max(f, g);
    else if (f && g) ties[k] = Math.min(f, g);
  }
  return { ties, directed: false, stats: { reported: Object.keys(reported).length, reciprocated, oneSided, ties: Object.keys(ties).length } };
}

export function coverage(model) {
  const r = model.responses?.respondents || [];
  return { respondents: r.length, of: model.people.length, missing: model.people.filter(p => !r.some(x => x.personId === p.id)).map(p => p.label) };
}

// ---- dataset ----------------------------------------------------------------------

export function tiesFor(model, relationId) {
  if (model.mode === 'multi') {
    const m = mergeResponses(model.responses?.respondents || [], relationId, model.mergeRule, model.people);
    return m;
  }
  const t = model.ties[relationId] || {};
  return { ties: t, directed: true, stats: { ties: Object.keys(t).length } };
}

export function toDataset(model, { relationIds = null } = {}) {
  if (!model.people.length) throw new Error('The roster is empty.');
  const rels = model.relations.filter(r => !relationIds || relationIds.includes(r.id));
  if (!rels.length) throw new Error('Choose at least one relation.');
  const merged = rels.map(r => ({ r, ...tiesFor(model, r.id) }));
  const b = new DatasetBuilder({ name: model.name || 'Roster network' });
  b.beginSource({
    format: 'roster', family: 'survey', medium: 'survey', view: 'full', context: 'survey',
    directed: merged.some(m => m.directed), fileNames: model.responses?.file ? [model.responses.file] : [],
    mode: model.mode, mergeRule: model.mode === 'multi' ? model.mergeRule : null,
  });
  const types = Object.fromEntries((model.attrColumns || []).map(c => [c.key, c.type]));
  const keyOf = new Map();
  const used = new Set();
  for (const p of model.people) {
    let k = 'roster:' + slug(p.label);
    while (used.has(k)) k += '_';
    used.add(k); keyOf.set(p.id, k);
    const attrs = {};
    for (const [a, v] of Object.entries(p.attrs || {})) attrs[a] = coerce(v, types[a] || 'text');
    if (model.mode === 'multi') attrs.responded = (model.responses?.respondents || []).some(x => x.personId === p.id);
    b.node(k, { label: p.label, attrs });
  }
  const members = model.people.map(p => b.nodeIndex(keyOf.get(p.id)));
  for (const { r, ties } of merged) {
    const ctx = b.context('roster:rel:' + slug(r.name), { name: r.name, kind: 'survey', visibility: 'private', medium: 'survey', members });
    for (const [k, v] of Object.entries(ties)) {
      const [from, to] = splitKey(k);
      if (!keyOf.has(from) || !keyOf.has(to)) continue;
      // Undirected merged ties are one event each; the analysis symmetrises
      // them when the network is built undirected (source.directed = false).
      b.event({ type: 'declared', actor: b.nodeIndex(keyOf.get(from)), targets: [[b.nodeIndex(keyOf.get(to)), 'declared']], context: ctx, weight: Number(v) || 1 });
      b.stat('ties');
    }
  }
  if (model.mode === 'multi') {
    const c = coverage(model);
    if (c.missing.length) b.warn('roster-nonrespondents', 'Roster members who did not respond (they can still receive ties)', c.missing.length);
  }
  return b.build();
}
