import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder, eventTargets, toJSON, fromJSON } from '../../src/core/model.js';
import { suggestMatches, nameTokens, normalizeText } from '../../src/core/identity.js';
import { mergeDatasets, applyMerges } from '../../src/core/merge.js';
import { joinProfiles } from '../../src/importers/profile.js';
import { importReport, warningSeverity } from '../../src/core/report.js';

// Two small sources about the same people: a Slack-like export and a mailbox.
function slackDs() {
  const b = new DatasetBuilder({ name: 'slack' });
  b.beginSource({ format: 'slack', family: 'workplace', medium: 'slack', view: 'full', context: 'workplace', tz: 'UTC' });
  const ana = b.node('slack:U01', { label: 'Ana Ruiz', attrs: { email: 'Ana.Ruiz@example.org', title: 'Lead' }, platformIds: { slack: 'U01' } });
  const ben = b.node('slack:U02', { label: 'Ben Okafor', platformIds: { slack: 'U02' } });
  const jose = b.node('slack:U03', { label: 'José Pérez', platformIds: { slack: 'U03' } });
  const bot = b.node('slack:bot:B1', { label: 'deploybot', isBot: true });
  const c = b.context('slack:C1', { name: 'general', kind: 'channel', visibility: 'public', members: [ana, ben] });
  b.event({ type: 'message', t: Date.UTC(2024, 2, 4), actor: ana, targets: [[ben, 'mention']], context: c, key: 'slack:C1:1', text: 'hi' });
  b.event({ type: 'message', t: Date.UTC(2024, 2, 5), actor: ben, targets: [[ana, 'reply']], context: c, key: 'slack:C1:2', parentKey: 'slack:C1:1' });
  b.event({ type: 'message', t: Date.UTC(2024, 2, 6), actor: bot, context: c, text: 'deployed' });
  b.event({ type: 'message', t: Date.UTC(2024, 2, 7), actor: jose, targets: [[ana, 'reply']], context: c, parentKey: 'slack:C1:missing' });
  return b.build();
}

function mailDs() {
  const b = new DatasetBuilder({ name: 'mail' });
  b.beginSource({ format: 'email', family: 'workplace', medium: 'email', view: 'ego', context: 'workplace', tz: 'UTC', egoKey: 'email:ana.ruiz@example.org' });
  const ana = b.node('email:ana.ruiz@example.org', { label: 'Ana Ruiz', attrs: { email: 'ana.ruiz@example.org' }, platformIds: { email: 'ana.ruiz@example.org' } });
  const ben = b.node('email:ben.okafor@example.org', { label: 'Okafor, Ben', attrs: { email: 'ben.okafor@example.org' } });
  const jp = b.node('email:jperez@example.com', { label: 'jperez@example.com', attrs: { email: 'jperez@example.com' } });
  const ben2 = b.node('email:bokafor@personal.net', { label: 'bokafor@personal.net', attrs: { email: 'bokafor@personal.net' } });
  const c = b.context('email:thread:1', { name: 'Apollo', kind: 'email_thread', visibility: 'group' });
  b.event({ type: 'message', t: Date.UTC(2024, 2, 8), actor: ana, targets: [[ben, 'to'], [jp, 'cc']], context: c, key: 'email:m1' });
  b.event({ type: 'message', t: Date.UTC(2024, 2, 9), actor: ben, targets: [[ana, 'to'], [ben2, 'cc']], context: c, key: 'email:m2', parentKey: 'email:m1' });
  b.warn('date-fallback', 'One date came from the From_ line', 1);
  return b.build();
}

test('nameTokens and normalizeText', () => {
  assert.equal(normalizeText('  José   PÉREZ '), 'jose perez');
  assert.deepEqual(nameTokens('Okafor, Ben'), ['ben', 'okafor']);
  assert.deepEqual(nameTokens("Mary-Kate O'Neil"), ['marykate', 'oneil']);
  assert.deepEqual(nameTokens('ana@example.org'), []);
});

test('mergeDatasets remaps indices and keeps sources', () => {
  const a = slackDs(), m = mailDs();
  const ds = mergeDatasets([a, m]);
  assert.equal(ds.nodes.count, a.nodes.count + m.nodes.count);
  assert.equal(ds.events.count, 6);
  assert.equal(ds.meta.sources.length, 2);
  assert.deepEqual([...ds.events.source], [0, 0, 0, 0, 1, 1]);
  // Event 5 (mail reply) points at event 4 (its parent in the mail dataset).
  assert.equal(ds.events.parent[5], 4);
  assert.equal(ds.events.parent[1], 0);
  const t5 = eventTargets(ds, 5).map(([n, r]) => [ds.nodes.keys[n], r]);
  assert.deepEqual(t5, [['email:ana.ruiz@example.org', 'to'], ['email:bokafor@personal.net', 'cc']]);
  assert.equal(ds.meta.sources[1].egoKey, 'email:ana.ruiz@example.org');
  // Survives the project-file round trip.
  const back = fromJSON(toJSON(ds));
  assert.deepEqual([...back.events.parent], [...ds.events.parent]);
});

test('mergeDatasets: same key is one node', () => {
  const m1 = mailDs(), m2 = mailDs();
  const ds = mergeDatasets([m1, m2]);
  assert.equal(ds.nodes.count, m1.nodes.count);
  assert.equal(ds.events.count, 4);
  assert.equal(ds.events.parent[3], 2);
});

test('suggestMatches: email high, names medium, alias low, bots never', () => {
  const ds = mergeDatasets([slackDs(), mailDs()]);
  const s = suggestMatches(ds);
  const find = (x, y) => s.find(p => (p.keyA === x && p.keyB === y) || (p.keyA === y && p.keyB === x));
  const ana = find('slack:U01', 'email:ana.ruiz@example.org');
  assert.equal(ana.confidence, 'high');
  assert.ok(ana.evidence.some(e => /same email/.test(e)));
  const ben = find('slack:U02', 'email:ben.okafor@example.org');
  assert.equal(ben.confidence, 'medium'); // "Ben Okafor" vs "Okafor, Ben" plus local part ben.okafor
  assert.ok(ben.evidence.some(e => /same name/.test(e)));
  const jose = find('slack:U03', 'email:jperez@example.com');
  assert.equal(jose.confidence, 'low'); // initial + surname only
  const ben2 = find('slack:U02', 'email:bokafor@personal.net');
  assert.equal(ben2.confidence, 'low');
  assert.ok(!s.some(p => p.keyA.includes('bot') || p.keyB.includes('bot')));
  // Sorted strongest first.
  const rank = { high: 3, medium: 2, low: 1 };
  for (let i = 1; i < s.length; i++) assert.ok(rank[s[i - 1].confidence] >= rank[s[i].confidence]);
});

test('suggestMatches: shared names and interview alters are only low', () => {
  const b = new DatasetBuilder();
  b.beginSource({ format: 'x' });
  b.node('slack:U1', { label: 'Sam Lee' });
  b.node('slack:U2', { label: 'Sam Lee' });
  b.node('email:sam@x.org', { label: 'Sam Lee', attrs: { email: 'sam@x.org' } });
  b.node('nc:e1:a1', { label: 'Avery Lin', attrs: { kind: 'alter' } });
  b.node('nc:e2:a9', { label: 'Avery Lin', attrs: { kind: 'alter' } });
  b.node('net:p1', { label: 'Pat Doe', platformIds: { net: 'n0' } });
  b.node('net2:p1', { label: 'Pat Q', platformIds: { net: 'n0' } });
  const s = suggestMatches(b.build());
  for (const p of s.filter(p => /Sam Lee/.test(p.labelA))) assert.equal(p.confidence, 'low');
  const av = s.find(p => p.labelA === 'Avery Lin');
  assert.equal(av.confidence, 'low');
  assert.ok(!s.some(p => p.labelA === 'Pat Doe' || p.labelB === 'Pat Doe'), 'file-local ids are not identity evidence');
});

test('applyMerges collapses, unions attrs, records ids, logs, drops self targets', () => {
  const ds = mergeDatasets([slackDs(), mailDs()]);
  const pairs = [
    { keyA: 'slack:U01', keyB: 'email:ana.ruiz@example.org', confidence: 'high' },
    { keyA: 'slack:U02', keyB: 'email:ben.okafor@example.org' },
    ['email:ben.okafor@example.org', 'email:bokafor@personal.net'],
  ];
  const out = applyMerges(ds, pairs, { note: 'test' });
  assert.equal(out.nodes.count, ds.nodes.count - 3);
  const ana = out.nodes.keys.indexOf('slack:U01');
  assert.ok(ana >= 0);
  assert.equal(out.nodes.attrs[ana].title, 'Lead');
  assert.equal(out.nodes.platformIds[ana].slack, 'U01');
  assert.equal(out.nodes.platformIds[ana].email, 'ana.ruiz@example.org');
  assert.match(out.nodes.attrs[ana].merged_keys, /email:ana.ruiz@example.org/);
  // Ben: Slack key and both addresses become one node; Ben's cc to his own alias is gone.
  const benKey = out.nodes.keys.find(k => k === 'slack:U02' || k.startsWith('email:ben'));
  const ben = out.nodes.keys.indexOf(benKey);
  assert.equal(out.nodes.keys.filter(k => /okafor|U02/.test(k)).length, 1);
  const lastTargets = eventTargets(out, 5);
  assert.deepEqual(lastTargets, [[ana, 'to']]);
  assert.equal(out.events.actor[5], ben);
  assert.equal(out.meta.droppedSelfTargets, 1);
  assert.equal(out.meta.merges.length, 1);
  assert.equal(out.meta.merges[0].groups.length, 2);
  assert.equal(out.meta.sources[1].egoKey, 'slack:U01'); // ego key follows the merge
  // Context members remapped and deduplicated.
  assert.deepEqual(out.contexts.members[0], [ana, ben].sort((x, y) => x - y).filter(x => out.contexts.members[0].includes(x)));
  // Original untouched.
  assert.equal(ds.nodes.count, 8);
});

test('applyMerges rejects unknown nodes', () => {
  assert.throws(() => applyMerges(mailDs(), [['email:nobody@x', 'email:ana.ruiz@example.org']]), /unknown node/);
});

test('joinProfiles: exact and normalised matches, ambiguity reported, types inferred', () => {
  const b = new DatasetBuilder();
  b.beginSource({ format: 'x' });
  b.node('slack:U1', { label: 'José Pérez', attrs: { email: 'jose@x.org' } });
  b.node('slack:U2', { label: 'Ana Ruiz' });
  b.node('slack:U3', { label: 'Sam Lee' });
  b.node('email:sam.lee@x.org', { label: 'Sam  Lee' });
  b.node('slack:U5', { label: 'Kim Wu' });
  const ds = b.build();
  const csv = 'name,department,level,remote,start\njose perez,Eng,3,yes,2019-04-01\nAna Ruiz,Design,2,no,2021-09-15\nsam lee,Ops,1,no,2020-01-01\nKim Wu,Eng,2,no,2022-02-02\nkim wu,Eng,5,no,2022-02-02\nNobody Here,Eng,1,no,2020-01-01\n';
  const { dataset, report } = joinProfiles(ds, csv, { keyColumn: 'name', matchOn: 'name' });
  assert.equal(report.matched.length, 2);
  assert.deepEqual(report.matched.map(m => [m.key, m.how]).sort(), [['slack:U1', 'normalized'], ['slack:U2', 'exact']]);
  assert.equal(report.ambiguous.length, 2); // sam lee -> two nodes; Kim Wu <- two rows
  assert.ok(report.ambiguous.some(a => a.reason === 'row matches several people' && a.nodes.length === 2));
  assert.ok(report.ambiguous.some(a => a.reason === 'several rows match this person' && a.rows.length === 2));
  assert.deepEqual(report.unmatchedRows.map(r => r.key), ['Nobody Here']);
  assert.equal(report.columnTypes.level, 'numeric');
  assert.equal(report.columnTypes.remote, 'boolean');
  assert.equal(report.columnTypes.start, 'date');
  const u1 = dataset.nodes.keys.indexOf('slack:U1');
  assert.deepEqual(dataset.nodes.attrs[u1], { email: 'jose@x.org', department: 'Eng', level: 3, remote: true, start: '2019-04-01' });
  assert.equal(dataset.nodes.attrs[dataset.nodes.keys.indexOf('slack:U5')].level, undefined);
  assert.equal(ds.nodes.attrs[0].department, undefined, 'input dataset unchanged');
  assert.equal(dataset.attributeSchema.find(a => a.key === 'level').type, 'numeric');
});

test('joinProfiles by email is case-insensitive via normalisation; by key exact', () => {
  const ds = mailDs();
  const rows = [{ mail: 'ANA.RUIZ@EXAMPLE.ORG', team: 'Design' }, { mail: 'email:ben.okafor@example.org', team: 'Eng' }];
  const r1 = joinProfiles(ds, rows, { keyColumn: 'mail', matchOn: 'email' });
  assert.equal(r1.report.matched.length, 1);
  assert.equal(r1.report.matched[0].how, 'normalized');
  const r2 = joinProfiles(ds, rows, { keyColumn: 'mail', matchOn: 'key' });
  assert.equal(r2.report.matched.length, 1);
  assert.equal(r2.report.matched[0].key, 'email:ben.okafor@example.org');
  assert.throws(() => joinProfiles(ds, rows, { keyColumn: 'nope' }), /Key column/);
});

test('importReport: per-source counts, time range, views, warnings by severity', () => {
  const ds = mergeDatasets([slackDs(), mailDs()]);
  const r = importReport(ds);
  assert.equal(r.totals.sources, 2);
  assert.equal(r.totals.events, 6);
  assert.equal(r.totals.bots, 1);
  const [s, m] = r.sources;
  assert.equal(s.counts.events, 4);
  assert.deepEqual(s.counts.eventsByType, { message: 4 });
  assert.deepEqual(s.counts.targetsByRole, { mention: 1, reply: 2 });
  assert.deepEqual(s.counts.contextsByVisibility, { public: 1 });
  assert.equal(s.counts.messagesWithText, 2);
  assert.deepEqual(s.timeRange, { start: Date.UTC(2024, 2, 4), end: Date.UTC(2024, 2, 7) });
  assert.deepEqual(s.bots, { nodes: 1, events: 1, names: ['deploybot'] });
  assert.equal(s.label, 'Slack');
  assert.equal(m.label, 'Email');
  assert.equal(s.unresolvedParents, 1);
  assert.ok(s.cannotShow.some(l => /public-channels-only/.test(l)));
  assert.equal(s.tz.status, 'exact');
  assert.equal(m.view, 'ego');
  assert.deepEqual(m.ego, { key: 'email:ana.ruiz@example.org', label: 'Ana Ruiz', inferredFrom: null });
  assert.ok(m.cannotShow.some(l => /Ties among the owner's contacts/.test(l)));
  assert.ok(m.cannotShow.some(l => /Bcc/.test(l)));
  assert.ok(r.notes.some(n => /different views/.test(n)));
  assert.equal(warningSeverity({ code: 'pst-unsupported' }), 'error');
  assert.equal(warningSeverity({ code: 'auto-mapping' }), 'info');
  assert.equal(warningSeverity({ code: 'something-new' }), 'warn');
  assert.equal(warningSeverity({ code: 'x', severity: 'info' }), 'info');
});

test('suggestMatches: an address owner who carries the name is not "several people" (D5)', () => {
  // A Slack account with its own email, and an HR row with the same name: the
  // email spells exactly one other person's name, so the pair is medium.
  const b = new DatasetBuilder();
  b.beginSource({ format: 'slack' });
  b.node('slack:U1', { label: 'Ana Ruiz', attrs: { email: 'ana.ruiz@example.org' } });
  b.node('slack:U2', { label: 'Ben Okafor', attrs: { email: 'ben.okafor@example.org' } });
  b.beginSource({ format: 'tabular' });
  b.node('csv:Ana Ruiz', { label: 'Ana Ruiz' });
  b.node('csv:Ben Okafor', { label: 'Ben Okafor' });
  const m = suggestMatches(b.build());
  const ana = m.find(x => x.keyA === 'slack:U1' && x.keyB === 'csv:Ana Ruiz');
  assert.ok(ana);
  assert.equal(ana.confidence, 'medium');
  assert.ok(ana.evidence.every(e => !/several people/.test(e)), ana.evidence.join('; '));
  // Two other people with the name is ambiguous, and says so.
  const c = new DatasetBuilder();
  c.beginSource({ format: 'email' });
  c.node('email:ana.ruiz@example.org', { label: 'ana.ruiz@example.org', attrs: { email: 'ana.ruiz@example.org' } });
  c.beginSource({ format: 'tabular' });
  c.node('csv:1', { label: 'Ana Ruiz' });
  c.node('csv:2', { label: 'Ana Ruiz' });
  const m2 = suggestMatches(c.build()).filter(x => x.keyA === 'email:ana.ruiz@example.org' || x.keyB === 'email:ana.ruiz@example.org');
  assert.equal(m2.length, 2);
  assert.ok(m2.every(x => x.confidence === 'low' && x.evidence.some(e => /several people/.test(e))));
});

test('importReport: deactivated accounts, text on messages only, empty sources, survey self-reports', () => {
  const b = new DatasetBuilder();
  b.beginSource({ format: 'slack', family: 'workplace', medium: 'slack', view: 'full' });
  const a = b.node('slack:U1', { label: 'Saoirse Zhou', attrs: { deactivated: true } });
  const z = b.node('slack:U2', { label: 'Idris Dimitriou' });
  b.node('slack:U3', { label: 'Never Active', attrs: { deactivated: true } });
  const c = b.context('slack:C1', { name: 'general', kind: 'channel', visibility: 'public' });
  b.event({ type: 'message', t: 1, actor: a, targets: [[z, 'mention']], context: c, text: 'hello' });
  b.event({ type: 'reaction', t: 2, actor: z, targets: [[a, 'subject']], context: c, text: ':tada:' });
  b.beginSource({ format: 'tabular', family: 'tabular', fileNames: ['empty.csv'] });
  b.beginSource({ format: 'google-forms', family: 'survey', view: 'full' });
  const r1 = b.node('survey:ana', { label: 'Ana' }), r2 = b.node('survey:ben', { label: 'Ben' });
  b.event({ type: 'declared', t: 3, actor: r1, targets: [[r2, 'declared']] });
  const r = importReport(b.build());
  const [slack, empty, survey] = r.sources;
  assert.equal(slack.counts.messages, 1);
  assert.equal(slack.counts.messagesWithText, 1); // the reaction's text is not a message
  assert.deepEqual(slack.deactivated, { nodes: 1, names: ['Saoirse Zhou'], keys: ['slack:U1'] });
  assert.equal(r.totals.deactivated, 2);
  assert.equal(r.totals.deactivatedInEvents, 1);
  assert.deepEqual(r.totals.deactivatedNames, ['Saoirse Zhou']);
  assert.ok(r.notes.some(n => /deactivated/.test(n) && /Saoirse Zhou/.test(n)));
  assert.deepEqual(empty.canShow, []);
  assert.ok(r.notes.some(n => /Nothing was read from one source: empty\.csv/.test(n)));
  assert.equal(survey.reported, true);
  assert.equal(slack.reported, false);
  assert.equal(survey.label, 'Google Forms survey');
});

test('importReport: personal exports are named, and merges are counted in people', () => {
  const b = new DatasetBuilder();
  b.beginSource({ format: 'email', family: 'workplace', view: 'ego', variant: 'takeout' });
  b.event({ type: 'message', t: 1, actor: b.node('email:a@x.org'), targets: [[b.node('email:b@x.org'), 'to']] });
  for (let k = 0; k < 3; k++) {
    b.beginSource({ format: 'whatsapp', family: 'personal', view: 'chat' });
    b.event({ type: 'message', t: 1, actor: b.node('whatsapp:me'), targets: [[b.node(`whatsapp:p${k}`), 'dm']] });
  }
  let ds = b.build();
  let r = importReport(ds);
  assert.ok(r.notes.some(n => /^Gmail and 3 WhatsApp chats are personal exports/.test(n)), r.notes.join(' | '));
  ds = applyMerges(ds, [{ keyA: 'email:a@x.org', keyB: 'whatsapp:me' }]);
  r = importReport(ds);
  assert.ok(r.notes.some(n => /1 record was folded into 1 person after review/.test(n)), r.notes.join(' | '));
});

test('suggestMatches normalises phones and emails from platformIds (iMessage, Telegram, WhatsApp, LinkedIn)', () => {
  const b = new DatasetBuilder();
  b.beginSource({ format: 'x' });
  b.node('imessage:+14155550123', { label: '+1 (415) 555-0123', platformIds: { phone: '+1 (415) 555-0123' } });
  b.node('telegram:user42', { label: 'Ana R', platformIds: { telegram: 'user42', phone: '14155550123' } });
  b.node('whatsapp:4155550123', { label: '(415) 555-0123', platformIds: { whatsapp_phone: '(415) 555-0123' } });
  b.node('whatsapp:+447700900123', { label: 'Ben', platformIds: { whatsapp_phone: '+44 7700 900123' } });
  b.node('imessage:+12025550123', { label: 'Other', platformIds: { phone: '+1 202 555 0123' } }); // different number, same last 4
  b.node('imessage:Ana.Ruiz@Example.org', { label: 'Ana.Ruiz@Example.org', platformIds: { email: 'Ana.Ruiz@Example.org' } });
  b.node('linkedin:ana-ruiz', { label: 'Ana Ruiz', platformIds: { linkedin: 'ana-ruiz', email: 'ana.ruiz@example.org' } });
  b.node('x:handle:sam', { label: '@sam', platformIds: { handle: 'sam' } });
  b.node('discord:99', { label: 'sam', platformIds: { discord: '99', username: 'Sam' } });
  b.node('x:123', { label: 'Sam X', platformIds: { x: '123', handle: 'sam' } });
  const s = suggestMatches(b.build());
  const get = (x, y) => s.find(p => (p.keyA === x && p.keyB === y) || (p.keyA === y && p.keyB === x));
  // '+1 (415)...' vs '14155550123' (no plus): national digits agree, country code unknown on one side.
  assert.equal(get('imessage:+14155550123', 'telegram:user42').confidence, 'medium');
  assert.equal(get('imessage:+14155550123', 'whatsapp:4155550123').confidence, 'medium');
  assert.equal(get('telegram:user42', 'whatsapp:4155550123').confidence, 'medium');
  assert.equal(get('imessage:+14155550123', 'imessage:+12025550123'), undefined);
  assert.equal(get('imessage:Ana.Ruiz@Example.org', 'linkedin:ana-ruiz').confidence, 'high');
  assert.equal(get('x:handle:sam', 'x:123').confidence, 'high');      // same handle, same service
  assert.equal(get('x:handle:sam', 'discord:99').confidence, 'low');   // same name, different services
});

test('normalizePhone', async () => {
  const { normalizePhone } = await import('../../src/core/identity.js');
  assert.deepEqual(normalizePhone('+1 (415) 555-0123'), { full: '+14155550123', digits: '14155550123' });
  assert.deepEqual(normalizePhone('00 44 7700 900123'), { full: '+447700900123', digits: '447700900123' });
  assert.deepEqual(normalizePhone('07700 900123'), { full: null, digits: '7700900123' });
  assert.deepEqual(normalizePhone('tel:+14155550123;ext=2'), { full: '+14155550123', digits: '14155550123' });
  assert.equal(normalizePhone('123'), null);
  assert.equal(normalizePhone('a@b.co'), null);
});
