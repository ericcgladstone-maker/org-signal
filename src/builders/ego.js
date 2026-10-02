// Ego network interview: the session model behind the Ego builder.
//
// A session is one respondent (ego) answering:
//   name generators   questions that elicit names ("who do you discuss important matters with?")
//   name interpreters questions about each named person (alter): closeness, relationship ...
//   alter-alter ties  which of the named people know each other, as ego perceives it
//
// Alter-alter ties are collected in two passes because asking k(k-1)/2 pair
// questions is the slowest part of any ego interview: ego first sorts alters
// into the settings they come from (work, family ...), everyone sharing a
// setting is assumed to know each other, and ego then fixes the exceptions.
// The session stores only those exceptions (ties: 'a|b' -> true|false), so
// moving someone between contexts updates the implied ties without losing
// the explicit corrections.
//
// Pure functions; sessions are plain JSON. Every mutating function returns a
// new session (shallow copies) so the UI can use it directly as state.

import { DatasetBuilder } from '../core/model.js';
import { parseCSV, rowsToObjects } from '../importers/tabular.js';
import { uid, uuid, slug, normName, toCSV, coerce } from './common.js';

export const SESSION_VERSION = 1;

// ---- presets ---------------------------------------------------------------

// The GSS 1985 "important matters" item (Burt 1984), the most used name
// generator in the literature. The GSS recorded up to five names, so 5 is the
// default cap; it can be raised, and caps are known to truncate network size.
export const GENERATOR_PRESETS = [
  { id: 'discuss', name: 'Important matters', cap: 5,
    prompt: 'From time to time, most people discuss important matters with other people. Looking back over the last six months, who are the people with whom you discussed matters important to you?' },
  { id: 'advice', name: 'Advice', cap: 10,
    prompt: 'Who do you go to for advice when you have a problem or a decision to make?' },
  { id: 'social', name: 'Socializing', cap: 10,
    prompt: 'Who do you spend free time with, for example getting together for a meal, going out, or visiting each other?' },
  { id: 'support', name: 'Support', cap: 10,
    prompt: 'If you needed help, such as a loan, a ride, or care when you were ill, who would you ask?' },
  { id: 'work', name: 'Work', cap: 15,
    prompt: 'Who do you work with most closely, inside or outside your organisation?' },
];

const opts = list => list.map(([value, label]) => ({ value, label }));

export const INTERPRETER_PRESETS = [
  { id: 'relationship', name: 'relationship', label: 'Relationship type', type: 'categorical',
    options: opts([['partner', 'Partner or spouse'], ['family', 'Family'], ['friend', 'Friend'], ['coworker', 'Coworker'],
      ['neighbour', 'Neighbour'], ['group', 'Group member'], ['adviser', 'Adviser'], ['other', 'Other']]) },
  { id: 'closeness', name: 'closeness', label: 'Closeness (1 to 5)', type: 'ordinal',
    options: opts([['1', '1 Distant'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5 Very close']]) },
  { id: 'contact_freq', name: 'contact_freq', label: 'Contact frequency', type: 'ordinal',
    options: opts([['5', 'Daily'], ['4', 'Weekly'], ['3', 'Monthly'], ['2', 'Less than monthly'], ['1', 'Yearly or less']]) },
  { id: 'how_met', name: 'how_met', label: 'How met', type: 'categorical',
    options: opts([['family', 'Family'], ['school', 'School'], ['work', 'Work'], ['neighbourhood', 'Neighbourhood'],
      ['organisation', 'Club or organisation'], ['online', 'Online'], ['friend', 'Through a friend'], ['other', 'Other']]) },
  { id: 'years_known', name: 'years_known', label: 'Years known', type: 'number' },
  { id: 'age_band', name: 'age_band', label: 'Age band', type: 'ordinal',
    options: opts([['1', 'Under 18'], ['2', '18 to 29'], ['3', '30 to 44'], ['4', '45 to 64'], ['5', '65 or older']]) },
  { id: 'location', name: 'location', label: 'Location', type: 'categorical',
    options: opts([['household', 'Same household'], ['walking', 'Walking distance'], ['city', 'Same city'],
      ['region', 'Same region'], ['farther', 'Farther']]) },
];

export const CONTEXT_PRESETS = ['Work', 'Family', 'School', 'Neighbourhood', 'Other'];

export const STEPS = [
  { id: 'generators', label: 'Name generators' },
  { id: 'interpreters', label: 'Name interpreters' },
  { id: 'names', label: 'Collect names' },
  { id: 'describe', label: 'Describe' },
  { id: 'ties', label: 'Who knows whom' },
  { id: 'review', label: 'Review and export' },
];

// ---- session ---------------------------------------------------------------

export function newSession({ caseId = '', egoLabel = 'Respondent', protocolName = 'Org Signal ego interview', now = Date.now() } = {}) {
  return {
    version: SESSION_VERSION,
    id: uuid(),
    egoId: uuid(),
    caseId,
    protocolName,
    egoLabel,
    egoAttrs: {},
    startedAt: new Date(now).toISOString(),
    finishedAt: null,
    generators: [],
    interpreters: [],
    alters: [],
    contexts: [],
    ties: {},
    weightBy: null, // interpreter name whose value weights ego->alter ties; null = 1
    step: 'generators',
  };
}

const set = (s, patch) => ({ ...s, ...patch });

export function addGenerator(s, g) {
  const preset = GENERATOR_PRESETS.find(p => p.id === g.preset);
  const base = preset ? { ...preset } : { name: 'Custom question', prompt: '', cap: 10 };
  const gen = { ...base, ...g, id: g.id || (preset && !s.generators.some(x => x.id === preset.id) ? preset.id : uid('g')) };
  delete gen.preset;
  gen.cap = Math.max(1, Math.floor(Number(gen.cap) || 10));
  return set(s, { generators: [...s.generators, gen] });
}

export function updateGenerator(s, id, patch) {
  return set(s, { generators: s.generators.map(g => (g.id === id ? { ...g, ...patch } : g)) });
}

// Removing a generator drops it from every alter; alters elicited by no
// remaining generator are removed too (they were never named under any question).
export function removeGenerator(s, id) {
  const alters = s.alters.map(a => ({ ...a, generators: a.generators.filter(g => g !== id) }));
  const keep = alters.filter(a => a.generators.length);
  const gone = new Set(alters.filter(a => !a.generators.length).map(a => a.id));
  let t = set(s, { generators: s.generators.filter(g => g.id !== id), alters: keep });
  for (const a of gone) t = scrubAlter(t, a);
  return t;
}

// Variable names follow Network Canvas: word characters only, so they work as
// CSV column names and R/Stata variable names.
export function varName(s) {
  const v = String(s || '').trim().replace(/\W+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return /^\d/.test(v) ? 'v_' + v : v || 'var';
}

export function addInterpreter(s, it) {
  const preset = INTERPRETER_PRESETS.find(p => p.id === it.preset);
  const base = preset ? structuredClone(preset) : { label: 'Custom question', type: 'text' };
  const out = { ...base, ...it };
  delete out.preset;
  const taken = new Set(s.interpreters.map(x => x.name));
  let name = varName(out.name || out.label);
  for (let i = 2; taken.has(name); i++) name = `${varName(out.name || out.label)}_${i}`;
  out.name = name;
  out.id = it.id || (preset && !s.interpreters.some(x => x.id === preset.id) ? preset.id : uid('i'));
  if ((out.type === 'categorical' || out.type === 'ordinal') && !out.options) out.options = [];
  return set(s, { interpreters: [...s.interpreters, out] });
}

export function updateInterpreter(s, id, patch) {
  const p = { ...patch };
  if (p.name !== undefined) p.name = varName(p.name);
  return set(s, { interpreters: s.interpreters.map(i => (i.id === id ? { ...i, ...p } : i)) });
}

export function removeInterpreter(s, id) {
  const it = s.interpreters.find(i => i.id === id);
  if (!it) return s;
  const alters = s.alters.map(a => { const attrs = { ...a.attrs }; delete attrs[it.name]; return { ...a, attrs }; });
  return set(s, { interpreters: s.interpreters.filter(i => i.id !== id), alters });
}

export function generatorCount(s, genId) {
  return s.alters.filter(a => a.generators.includes(genId)).length;
}

// Add a name under a generator. Names are deduplicated across generators by
// normalised spelling: naming "Ana Ruiz" under Advice after naming her under
// Important matters records Advice on the same alter rather than creating a
// second person. Returns { session, alter, status } where status is
//   'added' | 'duplicate-other' (existing alter, generator recorded)
//   | 'duplicate-same' (already named here) | 'cap' (generator full) | 'empty'
export function addAlter(s, name, genId) {
  const label = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!label) return { session: s, alter: null, status: 'empty' };
  const gen = s.generators.find(g => g.id === genId);
  if (!gen) throw new Error(`Unknown name generator: ${genId}`);
  const key = normName(label);
  const existing = s.alters.find(a => normName(a.label) === key);
  if (existing?.generators.includes(genId)) return { session: s, alter: existing, status: 'duplicate-same' };
  if (generatorCount(s, genId) >= gen.cap) return { session: s, alter: existing ?? null, status: 'cap' };
  if (existing) {
    const alter = { ...existing, generators: [...existing.generators, genId] };
    return { session: set(s, { alters: s.alters.map(a => (a.id === existing.id ? alter : a)) }), alter, status: 'duplicate-other' };
  }
  const alter = { id: uid('a'), uuid: uuid(), label, generators: [genId], attrs: {} };
  return { session: set(s, { alters: [...s.alters, alter] }), alter, status: 'added' };
}

// Drop the alter from one generator only (or entirely when genId is omitted
// or it was its last generator).
export function removeAlter(s, alterId, genId) {
  const a = s.alters.find(x => x.id === alterId);
  if (!a) return s;
  if (genId && a.generators.length > 1) {
    return set(s, { alters: s.alters.map(x => (x.id === alterId ? { ...x, generators: x.generators.filter(g => g !== genId) } : x)) });
  }
  return scrubAlter(set(s, { alters: s.alters.filter(x => x.id !== alterId) }), alterId);
}

function scrubAlter(s, alterId) {
  const contexts = s.contexts.map(c => ({ ...c, members: c.members.filter(m => m !== alterId) }));
  const ties = {};
  for (const [k, v] of Object.entries(s.ties)) if (!k.split('|').includes(alterId)) ties[k] = v;
  return set(s, { contexts, ties });
}

export function renameAlter(s, alterId, label) {
  return set(s, { alters: s.alters.map(a => (a.id === alterId ? { ...a, label: String(label).trim() || a.label } : a)) });
}

// Store an interpreter answer as typed by the user (string); typing is applied
// on export so a half-typed number is not lost.
export function setInterpreter(s, alterId, name, value) {
  return set(s, {
    alters: s.alters.map(a => {
      if (a.id !== alterId) return a;
      const attrs = { ...a.attrs };
      if (value === '' || value === null || value === undefined) delete attrs[name]; else attrs[name] = value;
      return { ...a, attrs };
    }),
  });
}

// ---- contexts and alter-alter ties -----------------------------------------

export function addContext(s, name) {
  const n = String(name || '').trim() || `Context ${s.contexts.length + 1}`;
  return set(s, { contexts: [...s.contexts, { id: uid('c'), name: n, members: [] }] });
}

export function renameContext(s, id, name) {
  return set(s, { contexts: s.contexts.map(c => (c.id === id ? { ...c, name } : c)) });
}

export function removeContext(s, id) {
  return set(s, { contexts: s.contexts.filter(c => c.id !== id) });
}

// An alter may belong to several contexts (a coworker who is also a neighbour).
export function assignContext(s, alterId, contextId, on = true) {
  return set(s, {
    contexts: s.contexts.map(c => {
      if (c.id !== contextId) return c;
      const has = c.members.includes(alterId);
      if (on && !has) return { ...c, members: [...c.members, alterId] };
      if (!on && has) return { ...c, members: c.members.filter(m => m !== alterId) };
      return c;
    }),
  });
}

export function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

// Pairs assumed to know each other because they share a context.
export function impliedTies(s) {
  const out = new Set();
  for (const c of s.contexts) {
    const m = c.members;
    for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) out.add(pairKey(m[i], m[j]));
  }
  return out;
}

export function tie(s, a, b, implied = impliedTies(s)) {
  const k = pairKey(a, b);
  return k in s.ties ? s.ties[k] : implied.has(k);
}

// Flip a pair. If the result equals what the contexts imply, the override is
// dropped so the session holds only real exceptions.
export function toggleTie(s, a, b) {
  if (a === b) return s;
  const implied = impliedTies(s);
  const k = pairKey(a, b);
  const next = !tie(s, a, b, implied);
  const ties = { ...s.ties };
  if (next === implied.has(k)) delete ties[k]; else ties[k] = next;
  return set(s, { ties });
}

export function setTie(s, a, b, value) {
  return tie(s, a, b) === !!value ? s : toggleTie(s, a, b);
}

// Every unordered pair of alters with its state and why.
// source: 'context' (implied), 'added' (override true), 'removed' (override false), 'none'
export function tieList(s) {
  const implied = impliedTies(s);
  const out = [];
  const A = s.alters;
  for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
    const k = pairKey(A[i].id, A[j].id);
    const imp = implied.has(k);
    const ov = k in s.ties ? s.ties[k] : undefined;
    const on = ov ?? imp;
    out.push({ a: A[i].id, b: A[j].id, key: k, on, implied: imp, source: ov === undefined ? (imp ? 'context' : 'none') : (ov ? 'added' : 'removed') });
  }
  return out;
}

// ---- progress --------------------------------------------------------------

// Completeness per step (0..1) and overall. Describe counts answered cells;
// who-knows-whom counts alters placed in at least one context, since ego has
// at least considered them (pairs are never "unanswered": absent means no tie).
export function progress(s) {
  const nA = s.alters.length, nI = s.interpreters.length;
  let answered = 0;
  for (const a of s.alters) for (const it of s.interpreters) if (a.attrs[it.name] !== undefined && a.attrs[it.name] !== '') answered++;
  const placed = new Set(s.contexts.flatMap(c => c.members));
  const steps = {
    generators: s.generators.length ? 1 : 0,
    interpreters: s.interpreters.length ? 1 : 0,
    names: s.generators.length ? s.generators.filter(g => generatorCount(s, g.id) > 0).length / s.generators.length : 0,
    describe: nA && nI ? answered / (nA * nI) : (nA && !nI ? 1 : 0),
    ties: nA < 2 ? (nA ? 1 : 0) : s.alters.filter(a => placed.has(a.id)).length / nA,
    review: s.finishedAt ? 1 : 0,
  };
  const vals = Object.values(steps);
  return { steps, fraction: vals.reduce((x, y) => x + y, 0) / vals.length, answered, cells: nA * nI };
}

// ---- Dataset ---------------------------------------------------------------

function typedValue(it, raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (it.type === 'ordinal') { const n = Number(raw); return Number.isFinite(n) ? n : String(raw); }
  if (it.type === 'number') return coerce(raw, 'number');
  if (it.type === 'boolean') return coerce(raw, 'boolean');
  return String(raw);
}

export function toDataset(s, { name } = {}) {
  if (!s.alters.length) throw new Error('Name at least one person before analyzing.');
  const t = Date.parse(s.startedAt);
  const egoKey = `ego:${s.egoId}`;
  const b = new DatasetBuilder({ name: name || `Ego network: ${s.egoLabel || s.caseId || 'respondent'}` });
  b.beginSource({ format: 'ego-interview', family: 'survey', medium: 'survey', view: 'ego', context: 'survey', egoKey, tz: 'UTC',
    fileNames: [], directed: true, sessionId: s.id, protocolName: s.protocolName });
  const ego = b.node(egoKey, { label: s.egoLabel || 'Ego', attrs: { kind: 'ego', caseId: s.caseId || undefined, ...s.egoAttrs } });
  const genCtx = new Map();
  const usedSlugs = new Set();
  for (const g of s.generators) {
    let sl = slug(g.name);
    for (let i = 2; usedSlugs.has(sl); i++) sl = `${slug(g.name)}-${i}`;
    usedSlugs.add(sl);
    genCtx.set(g.id, b.context(`ego:${s.egoId}:gen:${sl}`, { name: g.name, kind: 'survey', visibility: 'direct', medium: 'survey' }));
  }
  const aaCtx = b.context(`ego:${s.egoId}:alter-ties`, { name: 'perceived ties', kind: 'survey', visibility: 'direct', medium: 'survey' });
  const idx = new Map();
  const weightIt = s.weightBy ? s.interpreters.find(i => i.name === s.weightBy) : null;
  for (const a of s.alters) {
    const attrs = { kind: 'alter', generators: a.generators.map(g => s.generators.find(x => x.id === g)?.name).filter(Boolean).join(';') };
    for (const it of s.interpreters) { const v = typedValue(it, a.attrs[it.name]); if (v !== undefined) attrs[it.name] = v; }
    const i = b.node(`alter:${s.egoId}:${a.uuid}`, { label: a.label, attrs });
    idx.set(a.id, i);
    b.stat('alters');
    const w = weightIt ? Number(typedValue(weightIt, a.attrs[weightIt.name])) : 1;
    for (const g of a.generators) {
      if (!genCtx.has(g)) continue;
      b.event({ type: 'declared', t, actor: ego, targets: [[i, 'declared']], context: genCtx.get(g), weight: Number.isFinite(w) && w > 0 ? w : 1 });
      b.stat('ego-alter ties');
    }
  }
  // Alter-alter ties: one event per unordered pair, written in alter order.
  // They are undirected (ego reports that two people know each other) and
  // perceived by ego, not observed; the context name says so.
  for (const p of tieList(s)) {
    if (!p.on) continue;
    b.event({ type: 'declared', t, actor: idx.get(p.a), targets: [[idx.get(p.b), 'declared']], context: aaCtx, weight: 1 });
    b.stat('alter-alter ties');
  }
  return b.build();
}

// ---- JSON save / resume ----------------------------------------------------

export function sessionToJSON(s) { return JSON.stringify({ kind: 'orgsignal-ego-session', ...s }, null, 2); }

export function sessionFromJSON(text) {
  let o;
  try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('This file is not valid JSON.'); }
  if (!o || typeof o !== 'object') throw new Error('This file is not an ego session.');
  if (o.kind && o.kind !== 'orgsignal-ego-session') throw new Error('This file is not an ego session.');
  for (const k of ['generators', 'interpreters', 'alters']) if (!Array.isArray(o[k])) throw new Error(`Session file is missing "${k}".`);
  if ((o.version ?? 1) > SESSION_VERSION) throw new Error('This session was saved by a newer version of Org Signal.');
  const base = newSession();
  const s = { ...base, ...o };
  delete s.kind;
  s.contexts = Array.isArray(o.contexts) ? o.contexts : [];
  s.ties = o.ties && typeof o.ties === 'object' ? o.ties : {};
  const ids = new Set(s.alters.map(a => a.id));
  s.alters = s.alters.map(a => ({ id: a.id || uid('a'), uuid: a.uuid || uuid(), label: String(a.label ?? ''), generators: a.generators || [], attrs: a.attrs || {} }));
  s.contexts = s.contexts.map(c => ({ ...c, members: (c.members || []).filter(m => ids.has(m)) }));
  if (!STEPS.some(x => x.id === s.step)) s.step = 'generators';
  return s;
}

// ---- Network Canvas CSV export / import --------------------------------------
//
// Column names follow the Network Canvas exporter source as recorded in
// docs/formats/network-canvas-and-surveys.md. Categorical variables are
// written the way NC writes them, one `<name>_<optionValue>` true/false
// column per option, even though our interpreters are single-choice. One
// extra boolean column per generator (`gen_<slug>`) keeps which question
// elicited each alter, which NC would keep as separate name-generator stages.

export const NC = {
  egoFixed: ['networkCanvasEgoUUID', 'networkCanvasCaseID', 'networkCanvasSessionID', 'networkCanvasProtocolName',
    'sessionStart', 'sessionFinish', 'sessionExported', 'APP_VERSION', 'COMMIT_HASH'],
  alterFixed: ['nodeID', 'networkCanvasEgoUUID', 'networkCanvasUUID', 'name'],
  edgeFixed: ['edgeID', 'from', 'to', 'networkCanvasEgoUUID', 'networkCanvasUUID', 'networkCanvasSourceUUID', 'networkCanvasTargetUUID'],
};

export const APP_VERSION = 'org-signal-2';

export function ncPrefix(s) {
  // NC sanitises caseId_sessionId for file names; we keep word chars and dashes.
  return `${s.caseId || 'case'}_${s.id}`.replace(/[^\w-]+/g, '_');
}

export function generatorColumn(g) { return 'gen_' + varName(g.name); }

export function toNetworkCanvasCSV(s, { exportedAt = new Date().toISOString() } = {}) {
  const prefix = ncPrefix(s);
  const egoVars = Object.keys(s.egoAttrs || {});
  const egoRows = [[...NC.egoFixed, ...egoVars],
    [s.egoId, s.caseId || '', s.id, s.protocolName || '', s.startedAt || '', s.finishedAt || '', exportedAt, APP_VERSION, '', ...egoVars.map(k => s.egoAttrs[k])]];

  const attrCols = [];
  for (const it of s.interpreters) {
    if (it.type === 'categorical') for (const o of it.options || []) attrCols.push({ col: `${it.name}_${o.value}`, it, opt: o.value });
    else attrCols.push({ col: it.name, it });
  }
  const genCols = s.generators.map(g => ({ col: generatorColumn(g), g }));
  const alterRows = [[...NC.alterFixed, ...attrCols.map(c => c.col), ...genCols.map(c => c.col)]];
  const nodeID = new Map();
  s.alters.forEach((a, i) => {
    nodeID.set(a.id, i + 1);
    alterRows.push([i + 1, s.egoId, a.uuid, a.label,
      ...attrCols.map(c => {
        const raw = a.attrs[c.it.name];
        if (c.opt !== undefined) return raw === undefined ? false : String(raw) === String(c.opt);
        if (raw === undefined) return '';
        return c.it.type === 'boolean' ? coerce(raw, 'boolean') : raw;
      }),
      ...genCols.map(c => a.generators.includes(c.g.id))]);
  });
  const byId = new Map(s.alters.map(a => [a.id, a]));
  const edgeRows = [[...NC.edgeFixed]];
  let e = 0;
  for (const p of tieList(s)) {
    if (!p.on) continue;
    e++;
    edgeRows.push([e, nodeID.get(p.a), nodeID.get(p.b), s.egoId, uuid(), byId.get(p.a).uuid, byId.get(p.b).uuid]);
  }
  return [
    { name: `${prefix}_ego.csv`, text: toCSV(egoRows) },
    { name: `${prefix}_attributeList_Person.csv`, text: toCSV(alterRows) },
    { name: `${prefix}_edgeList_knows.csv`, text: toCSV(edgeRows) },
  ];
}

// NC guards cells starting = + - @ tab with a leading quote; strip it.
const unguard = v => (typeof v === 'string' && /^'[=+\-@\t]/.test(v) ? v.slice(1) : v);

// Rebuild a session from Network Canvas CSVs: files [{ name, text }]. The ego
// and attribute-list files are required; the edge list is optional. Only the
// first ego in the files is read (one session per interview). Interpreter
// definitions are recovered from the columns: `<name>_<value>` groups become
// categorical, `gen_*` booleans become generators, numeric columns numbers.
// Pass `template` (a session) to reuse its question wording and option labels.
export function fromNetworkCanvasCSV(files, { template } = {}) {
  const read = re => {
    const f = files.find(x => re.test(x.name)) || files.find(x => re.test(firstLine(x.text)));
    return f ? rowsToObjects(parseCSV(f.text).rows) : null;
  };
  const egoT = read(/_ego\.csv$|networkCanvasCaseID/);
  const altT = read(/_attributeList_[^/]*\.csv$|^nodeID,|nodeID.*networkCanvasUUID/);
  const edgeT = read(/_edgeList_[^/]*\.csv$|^edgeID,/);
  if (!altT) throw new Error('No Network Canvas attribute list (alters) file found.');
  const egoRow = egoT?.records[0];
  const egoId = egoRow?.networkCanvasEgoUUID || altT.records[0]?.networkCanvasEgoUUID;
  const s = newSession();
  s.egoId = egoId || s.egoId;
  if (egoRow) {
    s.caseId = unguard(egoRow.networkCanvasCaseID) || '';
    s.id = egoRow.networkCanvasSessionID || s.id;
    s.protocolName = unguard(egoRow.networkCanvasProtocolName) || s.protocolName;
    s.startedAt = egoRow.sessionStart || s.startedAt;
    s.finishedAt = egoRow.sessionFinish || null;
    for (const k of egoT.headers) if (!NC.egoFixed.includes(k) && egoRow[k] !== '') s.egoAttrs[k] = unguard(egoRow[k]);
  }
  s.egoLabel = s.caseId || 'Respondent';
  const records = altT.records.filter(r => !r.networkCanvasEgoUUID || r.networkCanvasEgoUUID === s.egoId);
  const extra = altT.headers.filter(h => !NC.alterFixed.includes(h));

  const tGen = new Map((template?.generators || []).map(g => [generatorColumn(g), g]));
  const tInt = new Map((template?.interpreters || []).map(i => [i.name, i]));
  const genCols = extra.filter(h => /^gen_/.test(h));
  for (const col of genCols) {
    const t = tGen.get(col);
    s.generators.push(t ? { ...t } : { id: uid('g'), name: col.slice(4).replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()), prompt: '', cap: Math.max(10, records.length) });
  }
  if (!s.generators.length) s.generators.push({ id: uid('g'), name: 'Named', prompt: '', cap: Math.max(10, records.length) });
  const genByCol = new Map(genCols.map((c, i) => [c, s.generators[i]]));

  // Categorical groups: a template interpreter claims its own columns; other
  // columns whose values are all true/false and share a stem form a group.
  const rest = extra.filter(h => !genByCol.has(h));
  const claimed = new Set();
  for (const it of template?.interpreters || []) {
    if (it.type === 'categorical') {
      const cols = (it.options || []).map(o => `${it.name}_${o.value}`).filter(c => rest.includes(c));
      if (cols.length) { s.interpreters.push(structuredClone(it)); cols.forEach(c => claimed.add(c)); }
    } else if (rest.includes(it.name)) { s.interpreters.push(structuredClone(it)); claimed.add(it.name); }
  }
  const isBool = h => records.every(r => r[h] === '' || /^(true|false)$/i.test(r[h]));
  const groups = new Map();
  for (const h of rest) {
    if (claimed.has(h) || /_(x|y|screenSpaceX|screenSpaceY)$/.test(h)) continue;
    const m = /^(.+)_([^_]+)$/.exec(h);
    if (m && isBool(h)) { if (!groups.has(m[1])) groups.set(m[1], []); groups.get(m[1]).push({ col: h, value: m[2] }); }
  }
  for (const [stem, cols] of groups) {
    if (cols.length < 2) continue;
    cols.forEach(c => claimed.add(c.col));
    s.interpreters.push({ id: uid('i'), name: stem, label: stem.replace(/_/g, ' '), type: 'categorical', options: cols.map(c => ({ value: c.value, label: c.value })) });
  }
  for (const h of rest) {
    if (claimed.has(h) || /_(x|y|screenSpaceX|screenSpaceY)$/.test(h)) continue;
    const vals = records.map(r => r[h]).filter(v => v !== '');
    const type = vals.length && vals.every(v => /^(true|false)$/i.test(v)) ? 'boolean' : vals.length && vals.every(v => Number.isFinite(Number(v))) ? 'number' : 'text';
    s.interpreters.push({ id: uid('i'), name: h, label: h.replace(/_/g, ' '), type });
  }

  const byNodeID = new Map();
  for (const r of records) {
    const a = { id: uid('a'), uuid: r.networkCanvasUUID || uuid(), label: unguard(r.name) || `Alter ${r.nodeID}`, generators: [], attrs: {} };
    for (const [col, g] of genByCol) if (/^true$/i.test(r[col])) a.generators.push(g.id);
    if (!a.generators.length) a.generators.push(s.generators[0].id);
    for (const it of s.interpreters) {
      if (it.type === 'categorical') {
        const hit = (it.options || []).find(o => /^true$/i.test(r[`${it.name}_${o.value}`] ?? ''));
        if (hit) a.attrs[it.name] = hit.value;
      } else if (r[it.name] !== undefined && r[it.name] !== '') a.attrs[it.name] = unguard(r[it.name]);
    }
    byNodeID.set(String(r.nodeID), a);
    s.alters.push(a);
  }
  const byUUID = new Map(s.alters.map(a => [a.uuid, a]));
  if (edgeT) for (const r of edgeT.records) {
    if (r.networkCanvasEgoUUID && r.networkCanvasEgoUUID !== s.egoId) continue;
    const a = byUUID.get(r.networkCanvasSourceUUID) || byNodeID.get(String(r.from));
    const b = byUUID.get(r.networkCanvasTargetUUID) || byNodeID.get(String(r.to));
    if (a && b && a !== b) s.ties[pairKey(a.id, b.id)] = true;
  }
  s.step = 'review';
  return s;
}

function firstLine(t) { const i = t.indexOf('\n'); return i < 0 ? t : t.slice(0, i); }
