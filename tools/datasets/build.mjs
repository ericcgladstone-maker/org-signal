#!/usr/bin/env node
// Build the classic datasets library from the raw files (fetch.sh downloads
// them; export_networkx.py and enron_*.py prepare the rest):
//
//   node tools/datasets/build.mjs --raw <raw-dir> [--bundle id,id,...]
//
// Writes, for each dataset, an Org Signal Dataset (toJSON from
// src/core/model.js; gzip when large) and the manifest data/classic/index.json.
// Datasets whose redistribution terms are clear go to data/classic/ (shipped
// by tools/stage.sh). The others go to data/classic-pending/ (never shipped):
// they stay out of the deployed app until the owner decides; --bundle id moves
// a decision into the build. docs/datasets.md has every source, licence and
// conversion choice.
//
// Every dataset is one or more sources of `declared` events: one event per tie
// (per relation and time point), its weight the tie's value, its tie fields
// the relation, time point and raw value, so construction settings and tie
// filters can pick relations, waves and thresholds. Enron is `message` events.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatasetBuilder, toJSON, declareTwoMode, addAffiliation } from '../../src/core/model.js';
import { parseDL, parsePajek, parseGML } from './parsers.mjs';
import { CARDS } from './cards.mjs';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));
const RAW = args.raw;
if (!RAW || !existsSync(RAW)) { console.error('usage: build.mjs --raw <raw-dir> [--bundle id,...]'); process.exit(1); }
const BUNDLE_EXTRA = new Set(String(args.bundle || '').split(',').filter(Boolean));
const raw = f => readFileSync(join(RAW, f), 'utf8');
const json = f => JSON.parse(raw(f));

const RELATION_FIELD = options => ({ key: 'relation', label: 'Relation', type: 'choice', options });

// A source for one classic dataset. directed=false: each tie stored once.
function begin(b, id, { directed, medium = 'survey', fileNames, tieFields = [], defaultTieFilters, title, ...rest }) {
  return b.beginSource({ format: 'classic', variant: id, family: 'classic', medium, view: 'full', context: 'custom', tz: 'UTC',
    fileNames, directed, title, tieFields, ...(defaultTieFilters ? { defaultTieFilters } : {}), ...rest });
}

function tie(b, from, to, { weight = 1, t = NaN, ctx = -1, attrs = null } = {}) {
  b.stat('ties');
  return b.event({ type: 'declared', actor: from, targets: [[to, 'declared']], weight, t, context: ctx, attrs });
}

// Ties of a square matrix. Symmetric relations once per pair (i < j).
function matrixTies(b, M, idx, { symmetric, ctx, attrs, t, weightOf = v => v }) {
  let n = 0;
  for (let i = 0; i < M.length; i++) for (let j = 0; j < M.length; j++) {
    if (i === j || !M[i][j]) continue;
    if (symmetric && j < i) continue;
    if (symmetric && M[i][j] !== M[j][i]) throw new Error('matrix is not symmetric');
    tie(b, idx[i], idx[j], { weight: weightOf(M[i][j]), ctx, t, attrs: typeof attrs === 'function' ? attrs(M[i][j]) : attrs });
    n++;
  }
  return n;
}

const title = s => s.toLowerCase().replace(/(^|[\s_-])\w/g, m => m.toUpperCase());

// ---- 1. Zachary's karate club ---------------------------------------------------

function karate() {
  const nx = json('nx_karate.json');
  const b = new DatasetBuilder({ name: CARDS.karate.title });
  begin(b, 'karate', { directed: false, medium: 'observation', fileNames: ['networkx karate_club_graph()'], title: CARDS.karate.title,
    tieFields: [{ key: 'contexts', label: 'Contexts in which the two interacted (Zachary\'s strength)', type: 'number' }] });
  const ctx = b.context('karate:club', { name: 'Interaction outside club meetings', kind: 'survey', visibility: 'private', medium: 'observation' });
  const idx = nx.nodes.map(({ id, club }) => {
    const num = id + 1;
    const role = num === 1 ? 'Instructor (Mr. Hi)' : num === 34 ? 'Administrator (John A.)' : 'Member';
    return b.node(`karate:${num}`, { label: num === 1 ? '1 Mr. Hi' : num === 34 ? '34 John A.' : `Member ${num}`, attrs: { number: num, faction: club, role } });
  });
  for (const [u, v, w] of nx.edges) tie(b, idx[u], idx[v], { weight: w, ctx, attrs: { contexts: w } });
  return b.build();
}

// ---- 2. Padgett's Florentine families ---------------------------------------------

// Bundled: the marriage network as networkx ships it (BSD-3), plus Pucci, the
// 16th family of the Breiger and Pattison subset, who has no marriage ties.
function florentineMarriage() {
  const nx = json('nx_florentine.json');
  const b = new DatasetBuilder({ name: CARDS.florentine.title });
  begin(b, 'florentine', { directed: false, medium: 'archival', fileNames: ['networkx florentine_families_graph()'], title: CARDS.florentine.title,
    tieFields: [RELATION_FIELD(['marriage'])] });
  const ctx = b.context('florentine:marriage', { name: 'Marriage', kind: 'survey', visibility: 'private', medium: 'archival' });
  const idx = new Map([...nx.nodes, 'Pucci'].sort().map(f => [f, b.node(`florentine:${f.toLowerCase()}`, { label: f })]));
  for (const [u, v] of nx.edges) tie(b, idx.get(u), idx.get(v), { ctx, attrs: { relation: 'marriage' } });
  return b.build();
}

// Pending: both relations and the family attributes from the UCINET IV files
// PADGETT.DAT (PADGM, PADGB) and PADGW.DAT (rows in a different order).
const FAMILY = { ACCIAIUOL: 'Acciaiuoli', ALBIZZI: 'Albizzi', BARBADORI: 'Barbadori', BISCHERI: 'Bischeri', CASTELLAN: 'Castellani', GINORI: 'Ginori', GUADAGNI: 'Guadagni', LAMBERTES: 'Lamberteschi', MEDICI: 'Medici', PAZZI: 'Pazzi', PERUZZI: 'Peruzzi', PUCCI: 'Pucci', RIDOLFI: 'Ridolfi', SALVIATI: 'Salviati', STROZZI: 'Strozzi', TORNABUON: 'Tornabuoni' };
function florentineFull() {
  const P = parseDL(raw('padgett.dat')), W = parseDL(raw('padgw.dat'));
  const b = new DatasetBuilder({ name: CARDS.florentine.title });
  begin(b, 'florentine', { directed: false, medium: 'archival', fileNames: ['padgett.dat', 'padgw.dat'], title: CARDS.florentine.title,
    tieFields: [RELATION_FIELD(['marriage', 'business'])], defaultTieFilters: [{ key: 'relation', values: ['marriage'] }] });
  const attrs = new Map(W.rowLabels.map((r, i) => [r, { wealth: W.matrices[0][i][0], priorates: W.matrices[0][i][1], ties_all_116: W.matrices[0][i][2] }]));
  const idx = P.rowLabels.map(r => {
    // PADGW's coding as is: six families have 0 priorates (docs/datasets.md).
    const a = { ...attrs.get(r) };
    return b.node(`florentine:${FAMILY[r].toLowerCase()}`, { label: FAMILY[r], attrs: a });
  });
  P.levels.forEach((lv, k) => {
    const rel = lv === 'PADGM' ? 'marriage' : 'business';
    const ctx = b.context(`florentine:${rel}`, { name: title(rel), kind: 'survey', visibility: 'private', medium: 'archival' });
    matrixTies(b, P.matrices[k], idx, { symmetric: true, ctx, attrs: { relation: rel } });
  });
  return b.build();
}

// ---- 3. Krackhardt's high-tech managers -------------------------------------------

function krackhardt() {
  const AD = parseDL(raw('krackad.dat')), FR = parseDL(raw('krackfr.dat'));
  const K = json('kracknets.json');
  const b = new DatasetBuilder({ name: CARDS.krackhardt.title });
  begin(b, 'krackhardt', { directed: true, medium: 'survey', fileNames: ['krackad.dat', 'krackfr.dat', 'NetData kracknets.rda'], title: CARDS.krackhardt.title,
    tieFields: [RELATION_FIELD(['advice', 'friendship', 'reports to'])], defaultTieFilters: [{ key: 'relation', values: ['advice'] }] });
  const LEVEL = { 1: 'CEO', 2: 'Vice president', 3: 'Manager' };
  const idx = K.attributes.map((a, i) => b.node(`krackhardt:${i + 1}`, { label: `Manager ${i + 1}`,
    attrs: { age: a.AGE, tenure: a.TENURE, level: LEVEL[a.LEVEL], department: a.DEPT === 0 ? 'None (CEO)' : `Department ${a.DEPT}` } }));
  // Each manager's own row of their own matrix: the ties they report having
  // (Krackhardt 1987's self-reports; equal to the NetData edge lists, checked).
  for (const [rel, D] of [['advice', AD], ['friendship', FR]]) {
    const ctx = b.context(`krackhardt:${rel}`, { name: title(rel), kind: 'survey', visibility: 'private', medium: 'survey' });
    for (let i = 0; i < 21; i++) for (let j = 0; j < 21; j++) if (i !== j && D.matrices[i][i][j]) tie(b, idx[i], idx[j], { ctx, attrs: { relation: rel } });
  }
  const ctx = b.context('krackhardt:reports-to', { name: 'Reports to', kind: 'survey', visibility: 'private', medium: 'survey' });
  for (const [i, j] of K.reportsTo) tie(b, idx[i - 1], idx[j - 1], { ctx, attrs: { relation: 'reports to' } });
  return b.build();
}

// The cognitive social structure for the Perceived builder: one study per
// relation in the model of src/builders/perceived.js ({ people, relation,
// informants: [{ id, personId, label, ties: { 'i|j': 1 } }] }).
function krackhardtCSS() {
  const out = {};
  for (const [rel, file, question] of [['advice', 'krackad.dat', 'Who goes to whom for advice and help with work?'], ['friendship', 'krackfr.dat', 'Who is a friend of whom?']]) {
    const D = parseDL(raw(file));
    const people = Array.from({ length: 21 }, (_, i) => ({ id: `m${i + 1}`, label: `Manager ${i + 1}` }));
    out[rel] = {
      version: 1, name: `Krackhardt high-tech managers: ${rel}`, classic: 'krackhardt', people,
      // Friendship is asked one way ("who is a friend of X") and the reports
      // are not symmetric, so neither relation is treated as mutual.
      relation: { name: title(rel), question, undirected: false },
      informants: people.map((p, k) => {
        const ties = {};
        for (let i = 0; i < 21; i++) for (let j = 0; j < 21; j++) if (i !== j && D.matrices[k][i][j]) ties[`m${i + 1}|m${j + 1}`] = 1;
        return { id: `i${k + 1}`, personId: p.id, label: p.label, ties };
      }),
    };
  }
  return out;
}

// ---- 4. Sampson's monastery --------------------------------------------------------

function sampson() {
  const pj = parsePajek(raw('Sampson.paj'));
  const net = pj.networks.find(n => n.name === 'Sampson');
  const t4 = pj.networks.find(n => n.name === 'Sampson_T4');
  const fac = pj.partitions.find(p => p.name === 'Sampson_factions_T4').values;
  const clo = pj.partitions.find(p => p.name === 'Sampson_cloisterville').values;
  const FACTION = { 1: 'Young Turks', 2: 'Loyal Opposition', 3: 'Outcasts', 4: 'Interstitial' };
  const faction = new Map(t4.vertices.map((v, i) => [v.label, FACTION[fac[i]]]));
  // UCINET's numbering (Sampson's): who was expelled, who left, who stayed.
  const OUTCOME = { 'Gregory': 'Expelled', 'Basil': 'Expelled', 'Elias': 'Expelled', 'Simplicius': 'Expelled',
    'Bonaventure': 'Stayed', 'Berthold': 'Stayed', 'Ambrose': 'Stayed', 'Louis': 'Stayed' };
  const b = new DatasetBuilder({ name: CARDS.sampson.title });
  begin(b, 'sampson', { directed: true, medium: 'survey', fileNames: ['Sampson.paj'], title: CARDS.sampson.title,
    tieFields: [RELATION_FIELD(['like', 'dislike']), { key: 'wave', label: 'Time point', type: 'choice', options: ['T1', 'T2', 'T3', 'T4', 'T5'], ordered: true },
      { key: 'choice', label: 'Choice (1 = first)', type: 'number' }],
    defaultTieFilters: [{ key: 'relation', values: ['like'] }, { key: 'wave', values: ['T4'] }] });
  const idx = new Map(net.vertices.map((v, i) => {
    const name = v.label === 'Ramuald' ? 'Romuald' : v.label;
    const a = { cloisterville: clo[i] === 1 ? 'yes' : 'no' };
    if (faction.has(v.label)) { a.faction = faction.get(v.label); a.outcome = OUTCOME[name] || 'Left'; a.at_T4 = 'yes'; } else a.at_T4 = 'no';
    return [v.id, b.node(`sampson:${name.toLowerCase().replace(/\s+/g, '-')}`, { label: name, attrs: a })];
  }));
  const ctx = { like: b.context('sampson:like', { name: 'Liking', kind: 'survey', visibility: 'private', medium: 'survey' }),
    dislike: b.context('sampson:dislike', { name: 'Disliking', kind: 'survey', visibility: 'private', medium: 'survey' }) };
  for (const a of net.arcs) {
    for (const [lo, hi] of a.times) for (let w = lo; w <= Math.min(hi, 5); w++) {
      const rel = a.value > 0 ? 'like' : 'dislike';
      const v = Math.abs(a.value);
      // 3 = first choice in the source; weight keeps that (3 strongest), the
      // choice field says it in words of rank (1 = first).
      tie(b, idx.get(a.from), idx.get(a.to), { weight: v, ctx: ctx[rel], attrs: { relation: rel, wave: `T${w}`, choice: 4 - v } });
    }
  }
  return b.build();
}

// ---- 5. Kapferer's tailor shop ------------------------------------------------------

// The two observation periods by month (the source gives "two times seven
// months apart"; ergm's documentation dates the first June-August 1965).
// The day is not recorded: the 15th is a placeholder.
const KAP_T = { 1: Date.UTC(1965, 5, 15), 2: Date.UTC(1966, 0, 15) };
function kapferer() {
  const D = parseDL(raw('kaptail.dat'));
  const b = new DatasetBuilder({ name: CARDS.kapferer.title });
  const fields = [RELATION_FIELD(['sociational', 'instrumental']), { key: 'time', label: 'Time point', type: 'choice', options: ['Time 1', 'Time 2'], ordered: true }];
  const filters = [{ key: 'relation', values: ['sociational'] }];
  begin(b, 'kapferer', { directed: false, medium: 'observation', fileNames: ['kaptail.dat'], title: `${CARDS.kapferer.title}: sociational ties`, tieFields: fields, defaultTieFilters: filters });
  const idx = D.rowLabels.map(r => b.node(`kapferer:${r.toLowerCase()}`, { label: title(r) }));
  const ctx = { sociational: b.context('kapferer:sociational', { name: 'Sociational', kind: 'survey', visibility: 'private', medium: 'observation' }),
    instrumental: b.context('kapferer:instrumental', { name: 'Instrumental', kind: 'survey', visibility: 'private', medium: 'observation' }) };
  const by = Object.fromEntries(D.levels.map((l, k) => [l, D.matrices[k]]));
  for (const k of [1, 2]) matrixTies(b, by[`KAPFTS${k}`], idx, { symmetric: true, ctx: ctx.sociational, t: KAP_T[k], attrs: { relation: 'sociational', time: `Time ${k}` } });
  // Instrumental ties are one-way (help, work requests): a second, directed source.
  begin(b, 'kapferer', { directed: true, medium: 'observation', fileNames: ['kaptail.dat'], title: `${CARDS.kapferer.title}: instrumental ties`, tieFields: fields, defaultTieFilters: filters });
  for (const k of [1, 2]) matrixTies(b, by[`KAPFTI${k}`], idx, { symmetric: false, ctx: ctx.instrumental, t: KAP_T[k], attrs: { relation: 'instrumental', time: `Time ${k}` } });
  return b.build();
}

// ---- 6. Newcomb's fraternity ---------------------------------------------------------

// Week numbers only in the source; the calendar is a placeholder anchored on
// Monday 24 Sep 1956 (fall 1956, as UCINET dates the cohort).
const NEWCOMB_WEEK0 = Date.UTC(1956, 8, 24);
function newcomb() {
  const D = parseDL(raw('newfrat.dat'));
  const b = new DatasetBuilder({ name: CARDS.newcomb.title });
  begin(b, 'newcomb', { directed: true, medium: 'survey', fileNames: ['newfrat.dat'], title: CARDS.newcomb.title,
    tieFields: [{ key: 'rank', label: 'Rank (1 = most liked)', type: 'number' }, { key: 'week', label: 'Week', type: 'number' }],
    defaultTieFilters: [{ key: 'rank', max: 3 }] });
  const idx = Array.from({ length: D.n }, (_, i) => b.node(`newcomb:${i + 1}`, { label: `Student ${i + 1}` }));
  const ctx = b.context('newcomb:preference', { name: 'Preference ranking', kind: 'survey', visibility: 'private', medium: 'survey' });
  D.levels.forEach((lv, k) => {
    const week = Number(lv.replace('NEWC', ''));
    // A full ranking of the 16 others: rank r becomes weight 17 - r, so the
    // first choice weighs 16 and the last 1; the rank stays as a tie field.
    matrixTies(b, D.matrices[k], idx, { symmetric: false, ctx, t: NEWCOMB_WEEK0 + week * 7 * 86400000,
      weightOf: r => 17 - r, attrs: r => ({ rank: r, week }) });
  });
  return b.build();
}

// ---- 7. Bank wiring room --------------------------------------------------------------

// Homans (1950) as summarized by Steiber (1981): clique A = W1, W3, W4, S1, I1;
// clique B = W7, W8, W9, S4; W2 had little to do with A, W6 was "in many ways
// an outsider" to B; W5, S2 and I3 belonged to neither.
const CLIQUE = { W1: 'A', W3: 'A', W4: 'A', S1: 'A', I1: 'A', W7: 'B', W8: 'B', W9: 'B', S4: 'B' };
const CLIQUE_NOTE = { W2: 'On the edge of A', W6: 'On the edge of B' };
const REL = { RDGAM: 'games', RDCON: 'window arguments', RDPOS: 'friendship', RDNEG: 'antagonism', RDHLP: 'helping', RDJOB: 'job trading' };
function wiring() {
  const D = parseDL(raw('wiring.dat'));
  const b = new DatasetBuilder({ name: CARDS.wiring.title });
  const fields = [RELATION_FIELD(Object.values(REL)), { key: 'times', label: 'Times jobs were traded', type: 'number' }];
  const filters = [{ key: 'relation', values: ['friendship'] }];
  begin(b, 'wiring', { directed: false, medium: 'observation', fileNames: ['wiring.dat'], title: `${CARDS.wiring.title}: mutual relations`, tieFields: fields, defaultTieFilters: filters });
  const ROLE = { I: 'Inspector', W: 'Wireman', S: 'Solderer' };
  const idx = D.rowLabels.map(r => b.node(`wiring:${r.toLowerCase()}`, { label: r,
    attrs: { role: ROLE[r[0]], clique: CLIQUE[r] || 'Neither', clique_note: CLIQUE_NOTE[r] || (CLIQUE[r] ? 'Member' : 'Outside both') } }));
  const by = Object.fromEntries(D.levels.map((l, k) => [l, D.matrices[k]]));
  const ctx = l => b.context(`wiring:${REL[l].replace(/\s+/g, '-')}`, { name: title(REL[l]), kind: 'survey', visibility: 'private', medium: 'observation' });
  for (const l of ['RDGAM', 'RDCON', 'RDPOS', 'RDNEG']) matrixTies(b, by[l], idx, { symmetric: true, ctx: ctx(l), attrs: { relation: REL[l] } });
  begin(b, 'wiring', { directed: true, medium: 'observation', fileNames: ['wiring.dat'], title: `${CARDS.wiring.title}: one-way relations`, tieFields: fields, defaultTieFilters: filters });
  matrixTies(b, by.RDHLP, idx, { symmetric: false, ctx: ctx('RDHLP'), attrs: { relation: 'helping' } });
  matrixTies(b, by.RDJOB, idx, { symmetric: false, ctx: ctx('RDJOB'), attrs: v => ({ relation: 'job trading', times: v }) });
  return b.build();
}

// ---- 8. Davis's Southern Women (two-mode) ---------------------------------------------

// Event dates as DGG's Figure 1 gives them (month/day); the year, 1936, from
// the manynet documentation ("as reported in the Old City Herald in 1936").
const DAVIS_DATES = { E1: [6, 27], E2: [3, 2], E3: [4, 12], E4: [9, 26], E5: [2, 25], E6: [5, 19], E7: [3, 15], E8: [9, 16], E9: [4, 8], E10: [6, 10], E11: [2, 23], E12: [4, 7], E13: [11, 21], E14: [8, 3] };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function davis() {
  const nx = json('nx_davis.json');
  const b = new DatasetBuilder({ name: CARDS.davis.title });
  begin(b, 'davis', { directed: false, medium: 'observation', fileNames: ['networkx davis_southern_women_graph()'], title: CARDS.davis.title });
  declareTwoMode(b, ['Women', 'Events']);
  const ctx = b.context('davis:attendance', { name: 'Attendance at social events', kind: 'meeting', visibility: 'group', medium: 'observation' });
  // Freeman (2003) on DGG's own reading: groups 1-9 and 9-18 (Ruth, 9, in
  // both); core 1-4 and 13-15, primary 5-7 and 11-12, secondary 8-9 and 9-10, 16-18.
  const pos = k => (k <= 4 || (k >= 13 && k <= 15) ? 'Core' : (k >= 5 && k <= 7) || k === 11 || k === 12 ? 'Primary' : 'Secondary');
  const women = new Map(nx.women.map((w, i) => {
    const k = i + 1;
    return [w, { label: w, attrs: { number: k, dgg_group: k === 9 ? 'Both' : k < 9 ? 'Group 1' : 'Group 2', dgg_position: pos(k), consensus_group: k <= 9 ? 'Women 1-9' : 'Women 10-18' } }];
  }));
  for (const [w, e] of nx.edges) {
    const [m, d] = DAVIS_DATES[e];
    const t = Date.UTC(1936, m - 1, d);
    const wk = women.get(w);
    addAffiliation(b, `davis:${w.toLowerCase().replace(/\s+/g, '-')}`, `davis:${e.toLowerCase()}`, { t, context: ctx,
      actorLabel: wk.label, actorAttrs: wk.attrs, eventLabel: `${e} (${d} ${MONTHS[m - 1]})`, eventAttrs: { event: e, date: `${m}/${d}` } });
    b.stat('ties');
  }
  return b.build();
}

// ---- 9. Les Miserables -------------------------------------------------------------------

function lesmis() {
  const g = parseGML(raw('mejn_lesmis/lesmis.gml'));
  // Character descriptions from Knuth's jean.dat (public domain), matched on the name.
  const desc = new Map();
  for (const l of raw('jean.dat').split('\n')) {
    const m = l.match(/^[A-Z0-9]{2} ([^,]+)(?:, (.*))?$/);
    if (m) desc.set(m[1].replace(/[^A-Za-z]/g, '').toLowerCase(), (m[2] || '').replace(/[`']/g, '"').replace(/\\'/g, ''));
  }
  const b = new DatasetBuilder({ name: CARDS.lesmis.title });
  begin(b, 'lesmis', { directed: false, medium: 'text', fileNames: ['lesmis.gml'], title: CARDS.lesmis.title,
    tieFields: [{ key: 'chapters', label: 'Chapters in which both appear', type: 'number' }] });
  const ctx = b.context('lesmis:chapters', { name: 'Chapters of the novel', kind: 'survey', visibility: 'public', medium: 'text' });
  const idx = new Map(g.nodes.map(n => {
    const d = desc.get(n.label.replace(/[^A-Za-z]/g, '').toLowerCase());
    // The description is kept as a platform id, not an attribute: one value
    // per character would be offered as a grouping.
    return [n.id, b.node(`lesmis:${n.id}`, { label: n.label.replace(/([a-z])([A-Z])/g, '$1 $2'), platformIds: d ? { knuth: d } : undefined })];
  }));
  for (const e of g.edges) tie(b, idx.get(e.source), idx.get(e.target), { weight: e.value, ctx, attrs: { chapters: e.value } });
  return b.build();
}

// ---- 10. Lusseau's dolphins -----------------------------------------------------------------

function dolphins() {
  const g = parseGML(raw('mejn_dolphins/dolphins.gml'));
  const split = json('dolphins_gn_split.json');
  const b = new DatasetBuilder({ name: CARDS.dolphins.title });
  begin(b, 'dolphins', { directed: false, medium: 'observation', fileNames: ['dolphins.gml'], title: CARDS.dolphins.title });
  const ctx = b.context('dolphins:association', { name: 'Frequent association', kind: 'survey', visibility: 'public', medium: 'observation' });
  const idx = new Map(g.nodes.map(n => [n.id, b.node(`dolphins:${n.label.toLowerCase()}`, { label: n.label, attrs: { split_2004: split.smaller.includes(n.label) ? 'Smaller group (21)' : 'Larger group (41)' } })]));
  for (const e of g.edges) tie(b, idx.get(e.source), idx.get(e.target), { ctx });
  return b.build();
}

// ---- 11. Enron (header-only core subset) ----------------------------------------------------

// EnronData.org gives a status (Employee, Vice President, ...) and sometimes a
// title. position: the status in a few groups, so Groups can use it; the
// title keeps the detail.
function position(c) {
  const s = (c.status || '').toLowerCase(), t = (c.title || '').toLowerCase();
  if (/ceo|president/.test(s) && !/vice/.test(s)) return 'CEO or President';
  if (/vice president/.test(s)) return 'Vice President';
  if (/managing director|director/.test(s)) return 'Director';
  if (/manager/.test(s)) return 'Manager';
  if (/trader/.test(s) || /trading/.test(t)) return 'Trader';
  if (/lawyer/.test(s)) return 'In-house lawyer';
  if (s === 'employee' || /specialist|analyst|assistant/.test(t)) return 'Employee';
  return 'Not recorded';
}

function enron() {
  const E = json('enron-core.json');
  const b = new DatasetBuilder({ name: CARDS.enron.title });
  b.beginSource({ format: 'email', variant: 'enron-core', family: 'classic', medium: 'email', view: 'full', context: 'workplace', tz: 'UTC', title: CARDS.enron.title,
    fileNames: ['enron_mail_20150507.tar.gz (CMU)', 'edo_enron-custodians-data.html (EnronData.org)'], directed: true,
    tieFields: [{ key: 'all_recipients', label: 'Addresses the message went to (all, not only core)', type: 'number' }] });
  const idx = E.custodians.map(c => b.node(`email:${c.addresses[0] || c.id + '@unknown'}`, { label: c.name,
    attrs: { mailbox: c.id, position: position(c), ...(c.title ? { title: c.title } : {}) }, platformIds: { email: c.addresses } }));
  const ctxOf = new Map();
  const groupThread = new Set();
  for (const m of E.messages) if (m[4] && m[5] > 1) groupThread.add(m[4]);
  for (const [mid, t, s, tg, thread, all] of E.messages) {
    let ctx = -1;
    if (thread) {
      if (!ctxOf.has(thread)) ctxOf.set(thread, b.context(`enron:${thread}`, { name: `Thread ${thread}`, kind: 'email_thread', visibility: groupThread.has(thread) ? 'group' : 'direct', medium: 'email' }));
      ctx = ctxOf.get(thread);
    }
    b.event({ type: 'message', t, actor: idx[s], targets: tg.map(([c, r]) => [idx[c], r]), context: ctx, key: mid, attrs: { all_recipients: all } });
    b.stat('messages');
  }
  return b.build();
}

// ---- write ------------------------------------------------------------------------------------

const BUILDERS = { karate, florentine: florentineMarriage, davis, lesmis, dolphins,
  // pending: redistribution terms unclear (docs/datasets.md, "Licences")
  'florentine@full': florentineFull, krackhardt, sampson, kapferer, newcomb, wiring, enron };
const BUNDLED = new Set(['karate', 'florentine', 'davis', 'lesmis', 'dolphins']);

const outDir = { bundled: join(APP, 'data', 'classic'), pending: join(APP, 'data', 'classic-pending') };
for (const d of Object.values(outDir)) mkdirSync(d, { recursive: true });

function write(id, ds, where) {
  ds.meta.createdAt = Date.UTC(2026, 9, 3); // fixed, so rebuilding is reproducible
  ds.meta.classic = id;
  const text = toJSON(ds);
  const gz = text.length > 512 * 1024;
  const name = `${id}${gz ? '.json.gz' : '.json'}`;
  const file = join(outDir[where], name);
  writeFileSync(file, gz ? gzipSync(text, { level: 9, mtime: 0 }) : text);
  return { file: where === 'bundled' ? name : `../classic-pending/${name}`, bytes: statSync(file).size, rawBytes: text.length };
}

const manifest = [];
for (const [key, fn] of Object.entries(BUILDERS)) {
  const [id, variant] = key.split('@');
  const pending = !(BUNDLED.has(key) || BUNDLE_EXTRA.has(id));
  if (variant && !pending) continue;
  const ds = fn();
  const w = write(id, ds, pending ? 'pending' : 'bundled');
  const card = CARDS[id];
  const entry = { id, ...card.manifest(ds), distribution: pending ? 'pending' : 'bundled', file: w.file, bytes: w.bytes };
  if (id === 'krackhardt') {
    const css = JSON.stringify(krackhardtCSS());
    const f = join(outDir[pending ? 'pending' : 'bundled'], 'krackhardt-css.json');
    writeFileSync(f, css);
    entry.perceived = { file: pending ? '../classic-pending/krackhardt-css.json' : 'krackhardt-css.json', relations: ['advice', 'friendship'] };
  }
  const i = manifest.findIndex(x => x.id === id);
  if (i >= 0) manifest[i] = { ...manifest[i], pendingVersion: entry };
  else manifest.push(entry);
  console.log(`${pending ? 'pending' : 'bundled'}  ${id.padEnd(11)} ${String(ds.nodes.count).padStart(4)} nodes ${String(ds.events.count).padStart(6)} events  ${(w.bytes / 1024).toFixed(1)} KB`);
}
const order = Object.keys(CARDS);
manifest.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
writeFileSync(join(outDir.bundled, 'index.json'), JSON.stringify({ version: 1, generated: '2026-10-03', datasets: manifest }, null, 1) + '\n');
console.log('manifest', join(outDir.bundled, 'index.json'));
