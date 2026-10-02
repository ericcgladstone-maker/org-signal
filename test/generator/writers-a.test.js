// Conformance, determinism and round-trip tests for the generator's
// email (Takeout mbox), calendar (.ics), network (GraphML) and survey
// (Network Canvas CSV/GraphML, Google Forms roster) writers, plus a Slack
// round trip. Conformance checks are small independent parsers written
// against docs/formats, so a writer bug cannot hide behind the importer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../../src/generator/index.js';
import { unzipSync, strFromU8 } from '../../vendor/fflate.js';
import { PostalMime } from '../../vendor/postal-mime.js';
import ICAL from '../../vendor/ical.js';
import Papa from '../../vendor/papaparse.js';
import { parseXml, descend } from '../../src/importers/xml.js';
import { FileSet } from '../../src/core/fileset.js';
import { DatasetBuilder } from '../../src/core/model.js';

const SPECS = {
  email: { context: 'workplace', medium: 'email', size: 40, seed: 11, output: 'native' },
  calendar: { context: 'workplace', medium: 'calendar', size: 40, seed: 11, output: 'native' },
  network: { context: 'personal', medium: 'network', size: 30, seed: 11, output: 'native' },
  networkDirected: { context: 'online', medium: 'network', size: 60, seed: 11, output: 'native' },
  interviews: { context: 'survey', medium: 'survey', structure: 'team-interviews', seed: 11, output: 'native' },
  perceived: { context: 'survey', medium: 'survey', structure: 'perceived-network', seed: 11, output: 'native' },
  roster: { context: 'survey', medium: 'survey', structure: 'classroom', seed: 11, output: 'native' },
  slack: { context: 'workplace', medium: 'slack', size: 30, seed: 11, output: 'native', timespan: { start: '2025-01-06', days: 21 } },
};
const cache = new Map();
const gen = k => { if (!cache.has(k)) cache.set(k, generate(SPECS[k])); return cache.get(k); };
const unz = f => unzipSync(f.bytes);
const countType = (ds, type) => { const ti = ['message', 'copresence', 'declared', 'reaction', 'repost', 'like', 'follow', 'join', 'leave'].indexOf(type); let c = 0; for (let i = 0; i < ds.events.count; i++) if (ds.events.type[i] === ti) c++; return c; };

// ---- email ------------------------------------------------------------------

// Split per the spec's recommended rule: a From_ line at BOF or after a blank line.
const FROM_RE = /^From \S+ +\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d/;
function splitMbox(text) {
  const lines = text.split('\n');
  const msgs = [];
  let cur = null;
  lines.forEach((line, i) => {
    if (FROM_RE.test(line) && (i === 0 || lines[i - 1] === '')) { cur = []; msgs.push(cur); }
    if (cur) cur.push(line);
  });
  return msgs.map(m => m.join('\n'));
}
function headersOf(msg) {
  const head = msg.slice(0, msg.indexOf('\n\n')).replace(/\n[ \t]+/g, ' ');
  const h = {};
  for (const line of head.split('\n').slice(1)) { const i = line.indexOf(':'); h[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim(); }
  return h;
}

test('email: Takeout layout, mbox splits per spec, required headers present', () => {
  const { files, dataset, groundTruth } = gen('email');
  assert.equal(files.length, 1);
  assert.match(files[0].path, /^takeout-\d{8}T\d{6}Z-001\.zip$/);
  const z = unz(files[0]);
  const mbox = strFromU8(z['Takeout/Mail/All mail Including Spam and Trash.mbox']);
  assert.ok(!mbox.includes('\r'), 'LF line endings');
  const msgs = splitMbox(mbox);
  assert.ok(msgs.length > 50);
  const egoAddr = groundTruth.people.platformIds[groundTruth.observation.ego].email;
  let listFromOthers = 0;
  const ids = new Set();
  for (const m of msgs) {
    assert.match(m.split('\n')[0], /^From \d+@xxx \w{3} \w{3} \d\d \d\d:\d\d:\d\d \+0000 \d{4}$/);
    const h = headersOf(m);
    for (const k of ['x-gm-thrid', 'x-gmail-labels', 'delivered-to', 'date', 'from', 'subject', 'message-id', 'content-type']) assert.ok(k in h, `missing ${k}`);
    assert.match(h['x-gm-thrid'], /^\d{19}$/);
    assert.match(h.date, /^\w{3}, \d{1,2} \w{3} \d{4} \d\d:\d\d:\d\d [+-]\d{4}$/);
    assert.equal(h['delivered-to'], egoAddr);
    assert.ok(!ids.has(h['message-id'])); ids.add(h['message-id']);
    const fromEgo = h.from.includes(`<${egoAddr}>`);
    if (h.bcc) assert.ok(fromEgo, 'Bcc only on the ego\'s sent copy');
    if (fromEgo) assert.match(h['x-gmail-labels'], /^Sent/);
    if (h['list-id'] && !fromEgo) listFromOthers++;
    // no unescaped From_ line inside a body
    const body = m.slice(m.indexOf('\n\n') + 2).split('\n');
    for (const line of body) assert.ok(!/^From /.test(line), 'body From line must be escaped');
  }
  // The dataset (ego view) holds exactly the mailbox, including list mail the
  // ego received only as a list member.
  assert.ok(listFromOthers > 0);
  assert.equal(msgs.length, countType(dataset, 'message'));
  assert.ok(/\n>From the notes:/.test(mbox), 'mboxrd escaping exercised');
});

test('email: threading headers and RFC 2047 names decode back', async () => {
  const { files, groundTruth } = gen('email');
  const msgs = splitMbox(strFromU8(unz(files[0])['Takeout/Mail/All mail Including Spam and Trash.mbox']));
  const replies = msgs.filter(m => /\nIn-Reply-To: /.test(m));
  assert.ok(replies.length > 5);
  const allIds = new Set(msgs.map(m => headersOf(m)['message-id']));
  for (const m of replies) {
    const h = headersOf(m);
    const refs = h.references.split(/\s+/);
    assert.equal(refs[refs.length - 1], h['in-reply-to']);
  }
  // Parent is usually in the mailbox too (ego is on the thread).
  assert.ok(replies.some(m => allIds.has(headersOf(m)['in-reply-to'])));
  const labels = new Set(groundTruth.people.labels);
  const encoded = msgs.filter(m => /=\?UTF-8\?B\?/.test(m.slice(0, m.indexOf('\n\n'))));
  const sample = (encoded.length ? encoded : msgs).slice(0, 8);
  for (const m of sample) {
    const p = await PostalMime.parse(m.slice(m.indexOf('\n') + 1));
    assert.ok(labels.has(p.from.name), `decoded name ${p.from.name}`);
    for (const t of p.to || []) assert.ok(labels.has(t.name) || /list/.test(t.address) || !t.name || t.address.includes('@'));
  }
});

test('email: RFC 2047 encoder round-trips non-ASCII names', async () => {
  const { mailbox } = await import('../../src/generator/writers/email.js');
  const raw = `From: ${mailbox('Grete Grünewald-Iwasaki', 'g@x.example')}\nTo: ${mailbox('Eun-ji Søndergaard Ålvik Øvergård Ærø', 'e@x.example')}\nSubject: x\n\nhi\n`;
  const p = await PostalMime.parse(raw);
  assert.equal(p.from.name, 'Grete Grünewald-Iwasaki');
  assert.equal(p.to[0].name, 'Eun-ji Søndergaard Ålvik Øvergård Ærø');
  for (const line of raw.split('\n')) for (const w of line.match(/=\?[^?]+\?B\?[^?]*\?=/g) || []) assert.ok(w.length <= 75);
});

// ---- calendar -----------------------------------------------------------------

test('calendar: folded CRLF .ics that ical.js parses and expands to the dataset occurrences', () => {
  const { files, dataset, groundTruth } = gen('calendar');
  const egoAddr = groundTruth.people.platformIds[groundTruth.observation.ego].email;
  assert.equal(files[0].path, `${egoAddr}.ical.zip`);
  const bytes = unz(files[0])[`${egoAddr}.ics`];
  const text = strFromU8(bytes);
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n'));
  const physical = text.split('\r\n');
  assert.ok(!text.replace(/\r\n/g, '').includes('\n'), 'only CRLF line breaks');
  const enc = new TextEncoder();
  for (const l of physical) assert.ok(enc.encode(l).length <= 75, `line too long: ${l}`);
  assert.ok(physical.some(l => l.startsWith(' ')), 'some lines are folded');
  const comp = new ICAL.Component(ICAL.parse(text));
  for (const tz of comp.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);
  const vevents = comp.getAllSubcomponents('vevent');
  const masters = new Map(), exceptions = [];
  for (const v of vevents) (v.hasProperty('recurrence-id') ? exceptions.push(v) : masters.set(v.getFirstPropertyValue('uid'), new ICAL.Event(v)));
  assert.ok(exceptions.length > 0 || [...masters.values()].every(e => !e.isRecurring()), 'fixture should exercise overrides');
  for (const ex of exceptions) masters.get(ex.getFirstPropertyValue('uid')).relateException(ex);
  assert.ok(vevents.some(v => v.hasProperty('exdate')), 'fixture should exercise EXDATE');
  const occ = [];
  for (const ev of masters.values()) {
    if (!ev.isRecurring()) { occ.push(ev.startDate.toJSDate().getTime()); continue; }
    const it = ev.iterator();
    for (let next = it.next(), k = 0; next && k < 500; next = it.next(), k++) occ.push(ev.getOccurrenceDetails(next).startDate.toJSDate().getTime());
  }
  const dsTimes = [];
  const cop = 1;
  for (let i = 0; i < dataset.events.count; i++) if (dataset.events.type[i] === cop) dsTimes.push(dataset.events.t[i]);
  occ.sort((a, b) => a - b); dsTimes.sort((a, b) => a - b);
  assert.deepEqual(occ, dsTimes);
  // attendee parameters
  const att = vevents.flatMap(v => v.getAllProperties('attendee'));
  assert.ok(att.every(a => ['ACCEPTED', 'DECLINED', 'TENTATIVE', 'NEEDS-ACTION'].includes(a.getParameter('partstat'))));
  assert.ok(att.some(a => a.getParameter('cutype') === 'RESOURCE'));
});

// ---- GraphML ------------------------------------------------------------------

function checkGraphml(text) {
  const root = parseXml(text);
  assert.equal(root.local, 'graphml');
  const keys = new Map();
  for (const k of descend(root, 'key')) { assert.ok(k.attrs['attr.name'], 'every key has attr.name'); assert.equal(k.attrs.id, k.attrs['attr.name']); keys.set(k.attrs.id, k.attrs.for); }
  for (const d of descend(root, 'data')) assert.ok(keys.has(d.attrs.key), `undeclared key ${d.attrs.key}`);
  const nodes = [...descend(root, 'node')], edges = [...descend(root, 'edge')];
  const ids = new Set(nodes.map(n => n.attrs.id));
  for (const e of edges) assert.ok(ids.has(e.attrs.source) && ids.has(e.attrs.target));
  const graph = [...descend(root, 'graph')][0];
  return { nodes, edges, graph };
}

test('graphml: well-formed, keys declared, counts match ground truth', () => {
  for (const k of ['network', 'networkDirected']) {
    const { files, dataset, groundTruth } = gen(k);
    assert.match(files[0].path, /-network\.graphml$/);
    const { nodes, edges, graph } = checkGraphml(strFromU8(files[0].bytes));
    assert.equal(nodes.length, groundTruth.people.count);
    assert.equal(edges.length, countType(dataset, 'declared'));
    assert.equal(graph.attrs.edgedefault, groundTruth.ties.directed ? 'directed' : 'undirected');
  }
});

// ---- survey -------------------------------------------------------------------

const EGO_FIXED = ['networkCanvasEgoUUID', 'networkCanvasCaseID', 'networkCanvasSessionID', 'networkCanvasProtocolName', 'sessionStart', 'sessionFinish', 'sessionExported', 'APP_VERSION', 'COMMIT_HASH'];
const EDGE_FIXED = ['edgeID', 'from', 'to', 'networkCanvasEgoUUID', 'networkCanvasUUID', 'networkCanvasSourceUUID', 'networkCanvasTargetUUID'];

function checkNc(files) {
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'networkCanvasExport.zip');
  const z = unz(files[0]);
  const prefixes = new Set(Object.keys(z).map(p => p.replace(/(_ego\.csv|_attributeList_Person\.csv|_edgeList_knows\.csv|\.graphml)$/, '')));
  let sessions = 0, edges = 0;
  for (const pre of prefixes) {
    sessions++;
    assert.match(pre, /^R\d{3}_[0-9a-f-]{36}$/);
    const parse = p => Papa.parse(strFromU8(z[p]).trim(), { skipEmptyLines: true }).data;
    const ego = parse(`${pre}_ego.csv`), alters = parse(`${pre}_attributeList_Person.csv`), ed = parse(`${pre}_edgeList_knows.csv`);
    assert.deepEqual(ego[0].slice(0, EGO_FIXED.length), EGO_FIXED);
    assert.equal(ego.length, 2);
    assert.deepEqual(alters[0].slice(0, 3), ['nodeID', 'networkCanvasEgoUUID', 'networkCanvasUUID']);
    assert.deepEqual(ed[0], EDGE_FIXED);
    const egoUuid = ego[1][0];
    const uuidOf = new Map(alters.slice(1).map((r, k) => { assert.equal(r[0], String(k + 1)); assert.equal(r[1], egoUuid); return [r[0], r[2]]; }));
    for (const e of ed.slice(1)) {
      assert.ok(uuidOf.has(e[1]) && uuidOf.has(e[2]));
      assert.equal(e[5], uuidOf.get(e[1])); assert.equal(e[6], uuidOf.get(e[2]));
      assert.equal(e[3], egoUuid);
      edges++;
    }
    const g = parseXml(strFromU8(z[`${pre}.graphml`]));
    const graph = [...descend(g, 'graph')][0];
    assert.equal(graph.attrs.edgedefault, 'undirected');
    assert.equal([...descend(g, 'node')].length, alters.length - 1);
    assert.equal([...descend(g, 'edge')].length, ed.length - 1);
    const declared = new Set([...descend(g, 'key')].map(k => k.attrs.id));
    for (const d of descend(g, 'data')) assert.ok(declared.has(d.attrs.key));
  }
  return { sessions, edges };
}

test('survey: Network Canvas export for ego interviews matches the simulated answers', () => {
  const { files, groundTruth } = gen('interviews');
  const { sessions, edges } = checkNc(files);
  const resp = groundTruth.recall.respondents.filter(r => r.responded);
  assert.equal(sessions, resp.length);
  assert.equal(edges, resp.reduce((s, r) => s + (r.alterTies?.length || 0), 0));
});

test('survey: perceived-network sessions, one per informant', () => {
  const { files, groundTruth } = gen('perceived');
  const { sessions } = checkNc(files);
  assert.equal(sessions, groundTruth.recall.perceived.reports.length);
});

test('survey: roster matrix as a Google Forms response sheet', () => {
  const { files, groundTruth } = gen('roster');
  assert.equal(files[0].path, 'Friendship survey (Responses).csv');
  const rows = Papa.parse(strFromU8(files[0].bytes).trim()).data;
  const N = groundTruth.spec.size ?? 30;
  assert.deepEqual(rows[0].slice(0, 2), ['Timestamp', 'Your name']);
  for (const h of rows[0].slice(2)) assert.match(h, /^Who do you spend free time with\? \[.+\]$/);
  const resp = groundTruth.recall.respondents.filter(r => r.responded);
  assert.equal(rows.length - 1, resp.length);
  for (const r of rows.slice(1)) assert.match(r[0], /^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d\d:\d\d$/);
  const yes = rows.slice(1).reduce((s, r) => s + r.filter(c => c === 'Yes').length, 0);
  assert.equal(yes, resp.reduce((s, r) => s + r.named.length, 0));
  assert.ok(rows[0].length - 2 <= Math.max(N, groundTruth.people.count));
});

// ---- determinism ----------------------------------------------------------------

test('writers are deterministic: same spec and seed give identical bytes', () => {
  for (const k of ['email', 'calendar', 'network', 'interviews', 'perceived', 'roster']) {
    const a = generate(SPECS[k]).files, b = generate(SPECS[k]).files;
    assert.equal(a.length, b.length);
    a.forEach((f, i) => { assert.equal(f.path, b[i].path); assert.deepEqual(f.bytes, b[i].bytes, `${k} ${f.path}`); });
  }
});

// ---- round trips through the real importers -------------------------------------

let registry = null, registryError = null;
try { registry = await import('../../src/importers/registry.js'); } catch (e) { registryError = e; }

async function roundTrip(files, expectId) {
  const fs = await FileSet.from(files.map(f => ({ blob: new Blob([f.bytes]), path: f.path })));
  const ranked = await registry.detectAll(fs);
  assert.ok(ranked.length, 'some importer claims the files');
  assert.equal(ranked[0].importer.id, expectId, `best match was ${ranked[0].importer.id}: ${ranked[0].reason}`);
  const builder = new DatasetBuilder();
  await ranked[0].importer.import(fs, { builder, options: {}, progress: () => {}, signal: new AbortController().signal });
  return builder.build();
}

function rt(name, k, id, check) {
  const imp = registry?.IMPORTERS?.find(i => i.id === id);
  if (!imp) return test.skip(`round trip ${name}: importer "${id}" not available (${registryError?.message || 'not registered'})`, () => {});
  test(`round trip ${name}: generator native -> ${id} importer`, async () => {
    const res = gen(k);
    const ds = await roundTrip(res.files, id);
    check(ds, res);
  });
}

const humans = ds => { let c = 0; for (let i = 0; i < ds.nodes.count; i++) if (!ds.nodes.isBot[i]) c++; return c; };

rt('slack', 'slack', 'slack', (ds, { dataset }) => {
  // Same people and the same messages. Bots differ legitimately: the importer
  // keeps the bot's users.json entry and a separate bot:<bot_id> sender node
  // (spec section 4), the generator one bot node, so only humans are compared.
  assert.equal(humans(ds), humans(dataset));
  assert.equal(countType(ds, 'message'), countType(dataset, 'message'));
  assert.equal(countType(ds, 'reaction'), countType(dataset, 'reaction'));
});

rt('email', 'email', 'email', (ds, { dataset }) => {
  // Every mailbox message, list mail included, on both sides.
  assert.equal(countType(ds, 'message'), countType(dataset, 'message'));
});

rt('calendar', 'calendar', 'calendar', (ds, { dataset }) => {
  // Expanded occurrences match one-for-one, except occurrences where every
  // invitee declined: the spec makes co-presence require a non-declined
  // participant, so the importer drops them while the generator keeps an
  // empty copresence event.
  let withTargets = 0;
  for (let i = 0; i < dataset.events.count; i++) if (dataset.events.type[i] === 1 && dataset.events.tOff[i + 1] > dataset.events.tOff[i]) withTargets++;
  assert.equal(countType(ds, 'copresence'), withTargets);
});

rt('graphml', 'network', 'network-files', (ds, { groundTruth }) => {
  assert.equal(ds.nodes.count, groundTruth.people.count);
  assert.equal(countType(ds, 'declared'), groundTruth.ties.count);
});

// Network Canvas: the export zip carries each session twice (CSV set and
// GraphML). Each format alone must reproduce the answers exactly: one declared
// ego->alter tie per named alter plus the perceived alter-alter ties.
function ncSubset(k, re) {
  return { ...gen(k), files: Object.entries(unzipSync(gen(k).files[0].bytes)).filter(([p]) => re.test(p)).map(([path, bytes]) => ({ path, bytes })) };
}
for (const [label, re] of [['CSV', /\.csv$/], ['GraphML', /\.graphml$/]]) {
  const imp = registry?.IMPORTERS?.find(i => i.id === 'network-canvas');
  if (!imp) { test.skip(`round trip network canvas ${label}: importer not available`, () => {}); continue; }
  test(`round trip network canvas interviews (${label} only) -> network-canvas importer`, async () => {
    const res = ncSubset('interviews', re);
    const ds = await roundTrip(res.files, 'network-canvas');
    const resp = res.groundTruth.recall.respondents.filter(r => r.responded);
    assert.equal(countType(ds, 'declared'), resp.reduce((s, r) => s + r.named.length + (r.alterTies?.length || 0), 0));
  });
}

rt('google forms roster', 'roster', 'survey', (ds, { groundTruth }) => {
  const resp = groundTruth.recall.respondents.filter(r => r.responded);
  assert.equal(countType(ds, 'declared'), resp.reduce((s, r) => s + r.named.length, 0));
});
