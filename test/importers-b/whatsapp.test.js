import { test } from 'node:test';
import assert from 'node:assert/strict';
import whatsapp, { analyzeChat } from '../../src/importers/whatsapp.js';
import {
  splitMessages, parseHeaders, inferDaysFirst, wallClock, checkAbove12, checkDecreasing, changeFrequencyAnalysis,
  classifyBody, parseAuthor, extractMentions, matchSystem, titleFromName, orderDateComponents, parseTime,
} from '../../src/importers/lib/whatsapp-grammar.js';
import { fsFromFixtures, fsFromMemory, runImport, events, node, context, source, warningCodes, countBy } from './helpers.js';

const NNBSP = ' ', NBSP = ' ', LRM = '‎';

// Parse one line on its own (like the reference tests, which call parseMessages
// on single-message arrays) and return its wall clock as a UTC ms value.
function lineMs(line, dateOrder = 'auto') {
  const a = analyzeChat(line, { dateOrder });
  assert.equal(a.msgs.length, 1, `one message from ${JSON.stringify(line)}`);
  const w = a.msgs[0].wall;
  return { ms: Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s), author: a.msgs[0].author?.name, text: a.msgs[0].cls?.text };
}

// whatsapp-chat-parser tests/parser.test.ts 'formats': the 12 lines and their
// expected times ('2018-06-03T13:55:00Z' and '2018-06-13T21:25:15Z' in a UTC run).
test('the 12 reference formats of whatsapp-chat-parser parse to the same instants', () => {
  const e1 = Date.UTC(2018, 5, 3, 13, 55, 0);
  const e2 = Date.UTC(2018, 5, 13, 21, 25, 15);
  const cases = [
    ['3/6/18, 1:55 p.m. - a: m', e1],
    ['03-06-2018, 01.55 PM - a: m', e1],
    ['13.06.18 21.25.15: a: m', e2],
    ['[06.13.18 21:25:15] a: m', e2],
    ['13.6.2018 klo 21.25.15 - a: m', e2],
    ['13. 6. 2018. 21:25:15 a: m', e2],
    ['[3/6/18 1:55:00 p. m.] a: m', e1],
    [LRM + '[3/6/18 1:55:00 p. m.] a: m', e1],
    ['[2018/06/13, 21:25:15] a: m', e2],
    ['[06/2018/13, 21:25:15] a: m', e2],
    ['3/6/2018 1:55 p.' + NBSP + 'm. - a: m', e1],
    ['3/6/18, 1:55' + NNBSP + 'PM - a: m', e1],
  ];
  for (const [line, ms] of cases) {
    const r = lineMs(line);
    assert.equal(r.ms, ms, line);
    assert.equal(r.author, 'a', line);
    assert.equal(r.text, 'm', line);
  }
});

test('reference date-order tests (tests/date.test.ts)', () => {
  assert.equal(checkAbove12([[3, 6, 2017], [13, 11, 2017], [26, 12, 2017]]), true);
  assert.equal(checkAbove12([[4, 2, 2017], [6, 11, 2017], [12, 13, 2017]]), false);
  assert.equal(checkAbove12([[4, 6, 2017], [11, 10, 2017], [12, 12, 2017]]), null);
  assert.equal(checkDecreasing([[8, 3, 2017], [10, 5, 2017], [6, 9, 2017]]), true);
  assert.equal(checkDecreasing([[6, 3, 2017], [8, 5, 2017], [9, 4, 2017]]), false);
  assert.equal(checkDecreasing([[1, 1, 2017], [3, 3, 2017], [6, 6, 2017]]), null);
  assert.equal(checkDecreasing([[8, 3, 2017], [7, 5, 2017], [6, 9, 2018]]), true);
  assert.equal(checkDecreasing([[8, 3, 2017], [10, 2, 2017], [6, 9, 2018]]), false);
  assert.equal(checkDecreasing([[8, 3, 2017], [10, 5, 2017], [6, 9, 2018]]), null);
  assert.equal(changeFrequencyAnalysis([[3, 4, 2017], [7, 5, 2017], [11, 6, 2017]]), true);
  assert.equal(changeFrequencyAnalysis([[1, 1, 2017], [1, 3, 2017], [2, 7, 2017]]), false);
  assert.equal(changeFrequencyAnalysis([[6, 3, 2017], [8, 5, 2017], [9, 4, 2017]]), null);
  assert.deepEqual(orderDateComponents('2018/06/13'), ['06', '13', '2018']);
  assert.deepEqual(orderDateComponents('06/2018/13'), ['06', '13', '2018']);
});

test('day/month order is inferred over the whole file, with override', () => {
  // Alone, 3/6/18 is ambiguous (days first by default); a later 3/13/18 proves months come first.
  const text = '3/6/18, 10:00 - a: x\n3/13/18, 10:00 - b: y\n';
  const a = analyzeChat(text);
  assert.equal(a.daysFirst, false);
  assert.equal(a.ambiguous, false);
  assert.deepEqual(a.msgs[0].wall, { y: 2018, mo: 3, d: 6, h: 10, mi: 0, s: 0 });
  const amb = analyzeChat('3/6/18, 10:00 - a: x\n');
  assert.equal(amb.ambiguous, true);
  assert.equal(amb.msgs[0].wall.mo, 6);
  assert.equal(lineMs('3/6/18, 1:55 p.m. - a: m', 'month-first').ms, Date.UTC(2018, 2, 6, 13, 55));
  // Decreasing first component within a year => days.
  assert.equal(analyzeChat('8/3/17, 10:00 - a: x\n10/5/17, 10:00 - a: x\n6/9/17, 10:00 - a: x\n').daysFirst, true);
});

test('12h conversion edge cases and German day periods', () => {
  assert.deepEqual(parseTime('12:05', 'AM'), [0, 5, 0]);
  assert.deepEqual(parseTime('12:05', 'p. m.'), [12, 5, 0]);
  assert.deepEqual(parseTime('1:05', 'p.m.'), [13, 5, 0]);
  assert.deepEqual(parseTime('9.15.30', 'abends'), [21, 15, 30]);
  assert.deepEqual(parseTime('9:15', 'vorm.'), [9, 15, 0]);
  assert.equal(lineMs('21.03.18, 9:15 abends - Klaus: Hallo').ms, Date.UTC(2018, 2, 21, 21, 15));
});

test('spec variants A-R parse (header, author, body)', () => {
  const v = (line) => analyzeChat(line + '\n').msgs[0];
  // A iOS d/m/y 24h
  let m = v('[04/03/25, 14:05:09] Priya Nandakumar: Draft is in the shared folder');
  assert.equal(m.author.name, 'Priya Nandakumar');
  assert.deepEqual(m.wall, { y: 2025, mo: 3, d: 4, h: 14, mi: 5, s: 9 });
  // B iOS m/d/y 12h U+202F
  m = analyzeChat(`[3/4/25, 2:05:09${NNBSP}PM] Priya Nandakumar: Draft\n`, { dateOrder: 'month-first' }).msgs[0];
  assert.deepEqual(m.wall, { y: 2025, mo: 3, d: 4, h: 14, mi: 5, s: 9 });
  // C dotted
  assert.equal(v('[04.03.25, 14:05:09] Priya Nandakumar: Draft ist im Ordner').cls.text, 'Draft ist im Ordner');
  // D Android d/m/yyyy 24h
  assert.deepEqual(v('04/03/2025, 14:05 - Priya Nandakumar: Draft').wall, { y: 2025, mo: 3, d: 4, h: 14, mi: 5, s: 0 });
  // G year first, both styles
  assert.deepEqual(v('[2025/03/04, 14:05:09] Priya Nandakumar: x').wall, { y: 2025, mo: 3, d: 4, h: 14, mi: 5, s: 9 });
  assert.deepEqual(v('2025-03-04, 14:05 - Priya Nandakumar: x').wall, { y: 2025, mo: 3, d: 4, h: 14, mi: 5, s: 0 });
  // H Finnish, I Croatian, J old dash
  assert.deepEqual(v('4.3.2025 klo 14.05 - Priya Nandakumar: x').wall, { y: 2025, mo: 3, d: 4, h: 14, mi: 5, s: 0 });
  assert.deepEqual(v('4. 3. 2025. 14:05:09 Priya Nandakumar: x').wall, { y: 2025, mo: 3, d: 4, h: 14, mi: 5, s: 9 });
  assert.deepEqual(v('[04-03-25 14:05:09] Priya Nandakumar: x').wall, { y: 2025, mo: 3, d: 4, h: 14, mi: 5, s: 9 });
  // stray BOM and zero-width space at a line start
  assert.equal(v('﻿​[04/03/25, 14:05:09] Priya Nandakumar: x').author.name, 'Priya Nandakumar');
  // author takes everything up to the first ': '
  assert.equal(v('[04/03/25, 14:05:09] Priya: note: body: more').cls.text, 'note: body: more');
});

test('body classification: media, attachments, deleted, edited, calls, polls, locations', () => {
  const k = b => classifyBody(b);
  for (const b of ['<Media omitted>', '<media omitted>', '<Video message omitted>', '<Video note omitted>', 'image omitted', LRM + 'Image omitted',
    LRM + 'Sticker omitted', 'GIF omitted', 'Contact card omitted', 'report.pdf • 3 pages document omitted', '<Medien ausgeschlossen>']) {
    assert.equal(k(b).kind, 'media', b);
  }
  // Reference parseAttachments cases.
  assert.equal(k('< attached: 00000042-PHOTO-2020-06-07-15-13-20.jpg >').attachment, '00000042-PHOTO-2020-06-07-15-13-20.jpg');
  assert.equal(k('IMG-20210428-WA0001.jpg (file attached)').attachment, 'IMG-20210428-WA0001.jpg');
  assert.equal(k('2015-08-04-PHOTO-00004762.jpg <‎attached>').attachment, '2015-08-04-PHOTO-00004762.jpg');
  const de = k('‎4f2680f1db95a8454775cc2eefc95bfc.jpg (Datei angehängt)\nDir auch frohe Ostern.');
  assert.equal(de.attachment, '4f2680f1db95a8454775cc2eefc95bfc.jpg');
  assert.equal(de.text, 'Dir auch frohe Ostern.');
  assert.equal(k('m').attachment, null);
  for (const b of ['This message was deleted', 'This message was deleted.', 'You deleted this message', 'You deleted this message.', LRM + 'Message deleted']) {
    assert.equal(k(b).kind, 'deleted', b);
    assert.equal(k(b).text, null);
  }
  const ed = k('Moved to 3pm ' + LRM + '<This message was edited.>');
  assert.deepEqual([ed.kind, ed.text, ed.edited], ['message', 'Moved to 3pm', true]);
  assert.equal(k('ok <This message was edited>').edited, true);
  assert.equal(k('Missed voice call. Tap to call back').kind, 'call');
  assert.equal(k('Video call. No answer').kind, 'call');
  assert.equal(k('POLL:\nLunch?\nOPTION: Pizza (2 votes)').kind, 'poll');
  assert.equal(k('location: https://maps.google.com/?q=1,2').kind, 'location');
  assert.equal(k('live location shared').kind, 'location');
  assert.equal(k(':.').kind, 'empty');
  assert.equal(k('').kind, 'empty');
});

test('authors, mentions and system wording', () => {
  assert.deepEqual(parseAuthor(`~${NNBSP}Dana`), { name: 'Dana', nonContact: true, phone: null });
  assert.deepEqual(parseAuthor('~ Dana'), { name: 'Dana', nonContact: true, phone: null });
  assert.deepEqual(parseAuthor(`${LRM}+44${NNBSP}7700 900123`), { name: '+44 7700 900123', nonContact: false, phone: '+447700900123' });
  assert.deepEqual(extractMentions('@⁨Priya Nandakumar⁩ and @⁨+1 555 010 0199⁩ and @447700900123 not a@b.c'),
    [{ name: 'Priya Nandakumar' }, { phone: '+15550100199', name: '+1 555 010 0199' }, { phone: '447700900123', name: '447700900123' }]);
  assert.equal(matchSystem('Priya left').type, 'leave');
  assert.deepEqual(matchSystem('Alex added Sara, Tom and Ines').people, ['Sara', 'Tom', 'Ines']);
  assert.deepEqual(matchSystem('Priya, Sam were added').people, ['Priya', 'Sam']);
  assert.deepEqual(matchSystem('You removed Priya').people, ['Priya']);
  assert.equal(matchSystem(LRM + 'You created the group "X".').type, 'create');
  assert.equal(matchSystem('Boris created group "My Group Name"').type, 'create');
  assert.equal(matchSystem('You changed the group name from "A" to "B"').type, 'rename');
  assert.equal(matchSystem("You're now an admin").type, 'admin');
  assert.equal(matchSystem('Your security code with Priya changed. Tap to learn more.').type, 'security');
  assert.equal(matchSystem('Priya changed their phone number to a new number. Tap to message or add the new number.').type, 'number');
  assert.equal(matchSystem('see you tomorrow'), null);
  assert.equal(titleFromName('WhatsApp Chat - Project Falcon.zip'), 'Project Falcon');
  assert.equal(titleFromName('WhatsApp Chat with Marcus Oyelaran.txt'), 'Marcus Oyelaran');
});

test('continuation lines, including datetime-looking ones, join the previous message (reference makeArrayOfMessages)', () => {
  const { raw } = splitMessages('23/06/2018, 01:55 p.m. - Loris: one\ntwo\n2016-04-29 10:30:00\n06/03/2017, 00:45 - You created group "Test"\nThis is another line');
  assert.equal(raw.length, 2);
  assert.equal(raw[0].msg, '23/06/2018, 01:55 p.m. - Loris: one\ntwo\n2016-04-29 10:30:00');
  assert.equal(raw[0].system, false);
  assert.equal(raw[1].system, true);
  const p = parseHeaders(splitMessages('03/02/17, 18:42 - Luke: ').raw);
  assert.equal(p[0].author, 'Luke'); // empty message is still a user message
});

test('iOS 2024+ group export in a zip', async () => {
  const fs = await fsFromFixtures('whatsapp/WhatsApp Chat - Project Falcon.zip');
  const { det, ds } = await runImport(whatsapp, fs);
  assert.ok(det.score >= 0.9, det.reason);
  const src = source(ds);
  assert.equal(src.view, 'chat');
  assert.equal(src.tz, 'unknown');
  assert.equal(src.egoKey, null);
  assert.deepEqual(src.fileNames, ['_chat.txt']);
  // The group name never becomes a person. ~ Ghost Person never wrote but is
  // @-mentioned between isolates, which names a member exactly.
  assert.deepEqual(ds.nodes.keys.slice().sort(), ['whatsapp:dana', 'whatsapp:ghost person', 'whatsapp:marcus oyelaran', 'whatsapp:priya nandakumar']);
  assert.equal(node(ds, 'whatsapp:dana').attrs.is_saved_contact, false);
  assert.equal(node(ds, 'whatsapp:dana').label, 'Dana');
  assert.equal(node(ds, 'whatsapp:priya nandakumar').attrs.is_saved_contact, true);
  const evs = events(ds);
  assert.deepEqual(countBy(evs, e => e.type), { message: 9, join: 1, leave: 1 });
  const ctx = context(ds, evs[0].context);
  assert.equal(ctx.kind, 'group_dm');
  assert.equal(ctx.visibility, 'group');
  assert.equal(ctx.name, 'Project Falcon');
  assert.equal(ctx.members.length, 4);
  assert.ok(evs.every(e => e.context === evs[0].context));
  // File order and exact wall-clock-as-UTC times.
  assert.deepEqual(evs.map(e => [e.type, e.actor, e.t]), [
    ['join', 'whatsapp:priya nandakumar', Date.UTC(2025, 2, 4, 14, 0, 2)],
    ['message', 'whatsapp:priya nandakumar', Date.UTC(2025, 2, 4, 14, 5, 9)],
    ['message', 'whatsapp:marcus oyelaran', Date.UTC(2025, 2, 4, 14, 6, 11)],
    ['message', 'whatsapp:priya nandakumar', Date.UTC(2025, 2, 4, 14, 6, 12)],
    ['message', 'whatsapp:marcus oyelaran', Date.UTC(2025, 2, 4, 14, 7, 30)],
    ['message', 'whatsapp:marcus oyelaran', Date.UTC(2025, 2, 4, 14, 8, 0)],
    ['message', 'whatsapp:marcus oyelaran', Date.UTC(2025, 2, 4, 14, 9, 0)],
    ['message', 'whatsapp:dana', Date.UTC(2025, 2, 4, 14, 10, 0)],
    ['message', 'whatsapp:priya nandakumar', Date.UTC(2025, 2, 5, 9, 0, 0)],
    ['leave', 'whatsapp:dana', Date.UTC(2025, 2, 13, 18, 30, 45)],
    ['message', 'whatsapp:marcus oyelaran', Date.UTC(2025, 2, 13, 18, 31, 0)],
  ]);
  // No broadcast targets in a group; mentions only.
  assert.deepEqual(evs.filter(e => e.targets.length).map(e => e.targets), [[['whatsapp:priya nandakumar', 'mention']], [['whatsapp:ghost person', 'mention']]]);
  assert.equal(evs[4].text, 'Agenda:\n1. budget\n2. hiring: next week');
  assert.equal(evs[5].text, 'Moved to 3pm');
  assert.equal(evs[2].text, null); // omitted image
  assert.equal(evs[8].text, null); // deleted
  assert.equal(src.counts.messages, 9);
  assert.equal(src.counts.edited, 1);
  assert.equal(src.counts['kind:media'], 2);
  assert.equal(src.counts['kind:deleted'], 1);
  assert.equal(src.counts['kind:call'], 1);
  assert.equal(src.counts.systemMessages, 4);
  const w = Object.fromEntries(src.warnings.map(x => [x.code, x.count]));
  assert.equal(w['system-by-heuristic'], 4);
  assert.ok(!('mention-unmatched' in w)); // ~ Ghost Person never wrote, but the mention is linked
  assert.equal(w['system-you-unresolved'], 1); // 'You created the group'
  for (const c of ['identity-by-name', 'timezone-unknown']) assert.ok(c in w, c);
  assert.ok(!('date-order-ambiguous' in w));
});

test('egoName resolves "You" in system notices and sets egoKey', async () => {
  const fs = await fsFromFixtures('whatsapp/WhatsApp Chat - Project Falcon.zip');
  const { ds } = await runImport(whatsapp, fs, { egoName: 'Marcus Oyelaran' });
  assert.equal(source(ds).egoKey, 'whatsapp:marcus oyelaran');
  assert.ok(!warningCodes(ds).includes('system-you-unresolved'));
});

test('Android one-to-one, 12h with U+202F, CRLF, month-first, captions and time zone option', async () => {
  const fs = await fsFromFixtures('whatsapp/WhatsApp Chat with Marcus Oyelaran.txt');
  const { det, ds } = await runImport(whatsapp, fs);
  assert.ok(det.score >= 0.9, det.reason);
  const evs = events(ds);
  assert.equal(evs.length, 6);
  const ctx = context(ds, evs[0].context);
  assert.equal(ctx.kind, 'dm');
  assert.equal(ctx.visibility, 'direct');
  assert.equal(ctx.name, 'Marcus Oyelaran');
  assert.deepEqual(evs.map(e => [e.actor, e.t, e.targets]), [
    ['whatsapp:leo brandt', Date.UTC(2025, 2, 14, 9, 1), [['whatsapp:marcus oyelaran', 'dm']]],
    ['whatsapp:marcus oyelaran', Date.UTC(2025, 2, 14, 12, 15), [['whatsapp:leo brandt', 'dm']]],
    ['whatsapp:marcus oyelaran', Date.UTC(2025, 2, 14, 12, 16), [['whatsapp:leo brandt', 'dm']]],
    ['whatsapp:leo brandt', Date.UTC(2025, 2, 14, 0, 30), [['whatsapp:marcus oyelaran', 'dm']]],
    ['whatsapp:leo brandt', Date.UTC(2025, 2, 15, 13, 5), [['whatsapp:marcus oyelaran', 'dm']]],
    ['whatsapp:leo brandt', Date.UTC(2025, 2, 15, 13, 6), [['whatsapp:marcus oyelaran', 'dm']]],
  ]);
  assert.equal(evs[2].text, 'caption for the photo');
  assert.equal(evs[3].text, 'late one\nsecond line\n2016-04-29 10:30:00');
  const w = Object.fromEntries(source(ds).warnings.map(x => [x.code, x.count]));
  assert.equal(w['time-backwards'], 1);
  assert.equal(source(ds).counts.systemMessages, 1);
  assert.equal(source(ds).counts['kind:media'], 3);

  // America/New_York on 2025-03-14 is EDT (UTC-4; DST began 2025-03-09).
  const r = await runImport(whatsapp, await fsFromFixtures('whatsapp/WhatsApp Chat with Marcus Oyelaran.txt'), { timezone: 'America/New_York' });
  assert.equal(source(r.ds).tz, 'America/New_York');
  assert.equal(events(r.ds)[0].t, Date.UTC(2025, 2, 14, 13, 1));
  assert.ok(!warningCodes(r.ds).includes('timezone-unknown'));
  const bad = await runImport(whatsapp, await fsFromFixtures('whatsapp/WhatsApp Chat with Marcus Oyelaran.txt'), { timezone: 'Mars/Olympus' });
  assert.ok(warningCodes(bad.ds).includes('timezone-invalid'));
  assert.equal(source(bad.ds).tz, 'unknown');
});

test('Android Spanish group: p. m. with NBSP, authorless system lines, joins/leaves, phone authors and mentions', async () => {
  const fs = await fsFromFixtures('whatsapp/WhatsApp Chat with Equipo.txt');
  const { ds } = await runImport(whatsapp, fs);
  const evs = events(ds);
  assert.deepEqual(ds.nodes.keys.slice().sort(), ['whatsapp:+447700900123', 'whatsapp:alex ruiz', 'whatsapp:ines mora', 'whatsapp:pablo ortiz', 'whatsapp:sara gil', 'whatsapp:tomás vidal']);
  assert.equal(node(ds, 'whatsapp:+447700900123').attrs.is_phone_number, true);
  assert.equal(node(ds, 'whatsapp:+447700900123').platformIds.whatsapp_phone, '+447700900123');
  const ctx = context(ds, evs[0].context);
  assert.equal(ctx.kind, 'group_dm');
  assert.equal(ctx.members.length, 6);
  assert.deepEqual(evs.map(e => [e.type, e.actor, e.t]), [
    ['join', 'whatsapp:sara gil', Date.UTC(2025, 2, 4, 14, 5)],
    ['join', 'whatsapp:tomás vidal', Date.UTC(2025, 2, 4, 14, 5)],
    ['join', 'whatsapp:ines mora', Date.UTC(2025, 2, 4, 14, 5)],
    ['message', 'whatsapp:alex ruiz', Date.UTC(2025, 2, 4, 14, 6)],
    ['message', 'whatsapp:sara gil', Date.UTC(2025, 2, 4, 14, 7)],
    ['message', 'whatsapp:tomás vidal', Date.UTC(2025, 2, 5, 0, 30)],
    ['leave', 'whatsapp:ines mora', Date.UTC(2025, 2, 20, 11, 0)],
    ['leave', 'whatsapp:sara gil', Date.UTC(2025, 2, 20, 11, 1)],
    ['join', 'whatsapp:pablo ortiz', Date.UTC(2025, 2, 20, 11, 2)],
    ['message', 'whatsapp:+447700900123', Date.UTC(2025, 2, 20, 11, 3)],
    ['message', 'whatsapp:alex ruiz', Date.UTC(2025, 2, 20, 11, 4)],
  ]);
  assert.deepEqual(evs[10].targets, [['whatsapp:+447700900123', 'mention']]);
  assert.ok(evs.slice(3, 6).every(e => e.targets.length === 0));
  // The Spanish 'creó el grupo' wording is not in the catalogue: counted as an unknown system line.
  assert.equal(source(ds).counts.systemMessages, 5);
});

test('several chats dropped together become separate sources; detection rejects other text', async () => {
  const fs = await fsFromFixtures('whatsapp');
  const b = await runImport(whatsapp, fs);
  assert.equal(b.ds.meta.sources.length, 3);
  assert.ok(b.ds.meta.sources.every(s => s.view === 'chat' && s.format === 'whatsapp'));
  const other = await fsFromMemory({ 'notes.txt': 'just some notes\nnothing here\n' });
  assert.equal((await whatsapp.detect(other)).score, 0);
  const loose = await fsFromMemory({ 'export.txt': '[04/03/25, 14:05:09] A: x\n[04/03/25, 14:05:10] B: y\n' });
  assert.ok((await whatsapp.detect(loose)).score >= 0.5);
  const r = await runImport(whatsapp, loose);
  assert.equal(r.ds.events.count, 2);
  assert.equal(context(r.ds, r.ds.contexts.keys[0]).kind, 'dm');
});

test('one-sided direct chat takes the partner from the file name', async () => {
  const fs = await fsFromMemory({ 'WhatsApp Chat with Bo Park.txt': '04/03/2025, 14:05 - Ann Lee: hello?\n04/03/2025, 14:06 - Ann Lee: anyone\n' });
  const { ds } = await runImport(whatsapp, fs);
  assert.deepEqual(events(ds).map(e => e.targets), [[['whatsapp:bo park', 'dm']], [['whatsapp:bo park', 'dm']]]);
});

test('authorless system notices containing ": " are not read as authored messages', () => {
  const text = [
    '04/03/2025, 14:00 - Messages and calls are end-to-end encrypted. Note: no one outside of this chat can read them.',
    '04/03/2025, 14:01 - Alex Ruiz changed the subject to: Plan B',
    '04/03/2025, 14:02 - Alex Ruiz changed the group name from "Q1: plan" to "Q2"',
    '04/03/2025, 14:03 - Bob Tran: everyone left',
    '04/03/2025, 14:04 - Bob Tran: I changed the subject to: lunch',
  ].join('\n');
  const a = analyzeChat(text);
  assert.deepEqual(a.msgs.map(m => [m.author?.name ?? null, m.system?.type ?? null]), [
    [null, 'e2e'], [null, 'rename'], [null, 'rename'], ['Bob Tran', null], ['Bob Tran', null],
  ]);
  assert.equal(a.msgs[3].cls.text, 'everyone left');
});

test('rename notice with a colon makes the chat a group and adds no fake author node', async () => {
  const fs = await fsFromMemory({ 'WhatsApp Chat with Q2.txt': '04/03/2025, 14:01 - Alex Ruiz changed the subject to: Plan B\n04/03/2025, 14:02 - Alex Ruiz: hi\n04/03/2025, 14:03 - Bob Tran: yo\n' });
  const { ds } = await runImport(whatsapp, fs);
  assert.deepEqual(ds.nodes.keys.slice().sort(), ['whatsapp:alex ruiz', 'whatsapp:bob tran']);
  assert.equal(context(ds, ds.contexts.keys[0]).kind, 'group_dm');
  assert.equal(source(ds).counts.systemMessages, 1);
  assert.equal(source(ds).counts.messages, 2);
});

test('a one-to-one chat names its owner: the participant the chat is not named after', async () => {
  const fs = await fsFromFixtures('whatsapp/WhatsApp Chat with Marcus Oyelaran.txt');
  const { ds } = await runImport(whatsapp, fs);
  assert.equal(source(ds).egoKey, 'whatsapp:leo brandt');
  assert.equal(source(ds).egoInferredFrom, 'chat-title');
  assert.equal(source(ds).title, 'Marcus Oyelaran');
  // An explicit name wins over the inference.
  const r = await runImport(whatsapp, await fsFromFixtures('whatsapp/WhatsApp Chat with Marcus Oyelaran.txt'), { egoName: 'Marcus Oyelaran' });
  assert.equal(source(r.ds).egoKey, 'whatsapp:marcus oyelaran');
  // Groups name no owner.
  const g = await runImport(whatsapp, await fsFromFixtures('whatsapp/WhatsApp Chat - Project Falcon.zip'));
  assert.equal(source(g.ds).egoKey, null);
});
