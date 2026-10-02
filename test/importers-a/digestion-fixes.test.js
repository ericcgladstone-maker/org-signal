// Regression tests for importer fixes found by feeding generated native exports
// through the pipeline (test/integration/digestion.test.js). Inline synthetic
// inputs, small and independent of the generator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder } from '../../src/core/model.js';
import { FileSet } from '../../src/core/fileset.js';
import calendar from '../../src/importers/calendar.js';
import email from '../../src/importers/email.js';
import slack from '../../src/importers/slack.js';
import { events } from './helpers.js';

async function run(importer, files, options = {}) {
  const fs = await FileSet.from(files.map(([path, text]) => ({ path, blob: new Blob([text]) })));
  const detect = await importer.detect(fs);
  const builder = new DatasetBuilder({ name: 'test' });
  const opts = {};
  for (const o of importer.options || []) opts[o.key] = o.default;
  await importer.import(fs, { builder, options: { ...opts, ...options }, progress: () => {}, signal: new AbortController().signal });
  return { ds: builder.build(), detect };
}

const crlf = s => s.replace(/\n/g, '\r\n');
const tz = (id, off) => `BEGIN:VTIMEZONE\nTZID:${id}\nBEGIN:STANDARD\nTZOFFSETFROM:${off}\nTZOFFSETTO:${off}\nDTSTART:19700101T000000\nEND:STANDARD\nEND:VTIMEZONE`;
const att = (who, stat = 'ACCEPTED') => `ATTENDEE;CN=${who};PARTSTAT=${stat}:mailto:${who}@x.example`;

test('calendar: an override relates only to its own series (same wall time, other UID)', async () => {
  // Two weekly series at 11:00 local in different zones; each moves a
  // different week. ical.js would relate both overrides to both masters.
  const ics = crlf(`BEGIN:VCALENDAR\nVERSION:2.0\n${tz('America/New_York', '-0500')}\n${tz('Europe/London', '+0000')}
BEGIN:VEVENT\nUID:a\nDTSTART;TZID=America/New_York:20250304T110000\nDTEND;TZID=America/New_York:20250304T113000\nRRULE:FREQ=WEEKLY;COUNT=5\nORGANIZER:mailto:ann@x.example\n${att('ann')}\n${att('bob')}\nEND:VEVENT
BEGIN:VEVENT\nUID:a\nRECURRENCE-ID;TZID=America/New_York:20250325T110000\nDTSTART;TZID=America/New_York:20250326T120000\nDTEND;TZID=America/New_York:20250326T123000\nORGANIZER:mailto:ann@x.example\n${att('ann')}\n${att('bob')}\nEND:VEVENT
BEGIN:VEVENT\nUID:b\nDTSTART;TZID=Europe/London:20250304T110000\nDTEND;TZID=Europe/London:20250304T113000\nRRULE:FREQ=WEEKLY;COUNT=5\nORGANIZER:mailto:cy@x.example\n${att('cy')}\n${att('dee')}\nEND:VEVENT
BEGIN:VEVENT\nUID:b\nRECURRENCE-ID;TZID=Europe/London:20250318T110000\nDTSTART;TZID=Europe/London:20250319T120000\nDTEND;TZID=Europe/London:20250319T123000\nORGANIZER:mailto:cy@x.example\n${att('cy')}\n${att('dee')}\nEND:VEVENT
END:VCALENDAR\n`);
  const { ds } = await run(calendar, [['cal.ics', ics]], { egoAddress: 'ann@x.example', windowStart: '2025-03-01', windowEnd: '2025-04-30' });
  const iso = c => events(ds).filter(e => e.context === c).map(e => new Date(e.t).toISOString()).sort();
  assert.deepEqual(iso('cal:a'), ['2025-03-04T16:00:00.000Z', '2025-03-11T16:00:00.000Z', '2025-03-18T16:00:00.000Z', '2025-03-26T17:00:00.000Z', '2025-04-01T16:00:00.000Z']);
  assert.deepEqual(iso('cal:b'), ['2025-03-04T11:00:00.000Z', '2025-03-11T11:00:00.000Z', '2025-03-19T12:00:00.000Z', '2025-03-25T11:00:00.000Z', '2025-04-01T11:00:00.000Z']);
});

test('calendar: size class counts invitees, so a declined third person keeps a meeting "group"', async () => {
  const ics = crlf(`BEGIN:VCALENDAR\nVERSION:2.0
BEGIN:VEVENT\nUID:m1\nDTSTART:20250304T110000Z\nDTEND:20250304T113000Z\nORGANIZER:mailto:ann@x.example\n${att('ann')}\n${att('bob')}\n${att('cy', 'DECLINED')}\nEND:VEVENT
BEGIN:VEVENT\nUID:m2\nDTSTART:20250305T110000Z\nDTEND:20250305T113000Z\nORGANIZER:mailto:ann@x.example\n${att('ann')}\n${att('bob')}\nEND:VEVENT
END:VCALENDAR\n`);
  const { ds } = await run(calendar, [['cal.ics', ics]], { egoAddress: 'ann@x.example' });
  const ev = events(ds);
  const m1 = ev.find(e => e.context === 'cal:m1'), m2 = ev.find(e => e.context === 'cal:m2');
  assert.deepEqual(m1.targets, [['email:bob@x.example', 'attendee']], 'co-presence still needs a non-declined attendee');
  assert.equal(m1.visibility, 'group');
  assert.equal(m2.visibility, 'direct');
});

test('email: a reply targets its parent\'s sender when the parent is in the mailbox, in any order', async () => {
  const msg = (id, from, to, date, irt) => `From x@y Tue Mar  4 12:00:00 2025\nFrom: ${from}@x.example\nTo: ${to}@x.example\nDate: ${date}\nMessage-ID: <${id}@x.example>\n${irt ? `In-Reply-To: <${irt}@x.example>\n` : ''}Subject: s\n\nbody\n`;
  // The reply comes first in the file; the second reply's parent is absent.
  const mbox = [
    msg('r1', 'bob', 'ann', 'Tue, 4 Mar 2025 12:00:00 +0000', 'p1'),
    msg('p1', 'ann', 'bob', 'Tue, 4 Mar 2025 11:00:00 +0000'),
    msg('r2', 'cy', 'ann', 'Tue, 4 Mar 2025 13:00:00 +0000', 'gone'),
  ].join('\n');
  const { ds } = await run(email, [['mail.mbox', mbox]]);
  const byKey = Object.fromEntries(events(ds).map(e => [e.key, e]));
  assert.deepEqual(byKey['email:r1@x.example'].targets, [['email:ann@x.example', 'to'], ['email:ann@x.example', 'reply']]);
  assert.deepEqual(byKey['email:p1@x.example'].targets, [['email:bob@x.example', 'to']]);
  assert.deepEqual(byKey['email:r2@x.example'].targets, [['email:ann@x.example', 'to']], 'no reply tie when the parent is not in the mailbox');
});

test('slack: bot_message with only bot_id is the bot user from users.json; integration_logs.json is claimed', async () => {
  const files = [
    ['users.json', JSON.stringify([
      { id: 'U01ANN', name: 'ann', real_name: 'Ann', profile: { real_name: 'Ann' } },
      { id: 'U0BOT1', name: 'deploybot', real_name: 'Deploy Bot', is_bot: true, profile: { real_name: 'Deploy Bot', bot_id: 'B0BOT1' } },
    ])],
    ['channels.json', JSON.stringify([{ id: 'C01', name: 'general', members: ['U01ANN'] }])],
    ['integration_logs.json', '[]'],
    ['general/2025-03-04.json', JSON.stringify([
      { type: 'message', text: 'hi', user: 'U01ANN', ts: '1741086000.000100' },
      { type: 'message', subtype: 'bot_message', text: 'Deploy #1 ok', username: 'deploybot', bot_id: 'B0BOT1', ts: '1741086060.000200' },
    ])],
  ];
  const { ds, detect } = await run(slack, files);
  assert.ok(detect.files.includes('integration_logs.json'));
  assert.deepEqual([...ds.nodes.keys].sort(), ['slack:U01ANN', 'slack:U0BOT1']);
  const bot = events(ds).find(e => e.text === 'Deploy #1 ok');
  assert.equal(bot.actor, 'slack:U0BOT1');
  assert.equal(ds.nodes.isBot[ds.nodes.keys.indexOf('slack:U0BOT1')], 1);
});
