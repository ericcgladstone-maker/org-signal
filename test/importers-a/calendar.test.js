import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import ICAL from '../../vendor/ical.js';
import calendar, { unfoldBytes } from '../../src/importers/calendar.js';
import { FileSet } from '../../src/core/fileset.js';
import { runImporter, zipFolder, fixture, events, node, ctx, warning } from './helpers.js';

const py = code => JSON.parse(execFileSync('python3', ['-c', code]).toString());
const MAIN = [fixture('calendar', 'google'), fixture('calendar', 'outlook')];

// Independent expansion with python dateutil.rrule + zoneinfo (not ical.js).
const REF = py(`
import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from dateutil.rrule import rrule, WEEKLY, MONTHLY, MO
B = ZoneInfo('Europe/Berlin'); NY = ZoneInfo('America/New_York')
ms = lambda d: round(d.timestamp() * 1000)
until = datetime(2024, 6, 24, 8, 0, tzinfo=timezone.utc)
weekly = []
for d in rrule(WEEKLY, byweekday=MO, dtstart=datetime(2024, 3, 4, 10, 0)):
    loc = d.replace(tzinfo=B)
    if loc > until: break
    if d == datetime(2024, 4, 1, 10, 0): continue            # EXDATE
    if d == datetime(2024, 3, 11, 10, 0): loc = datetime(2024, 3, 11, 11, 0, tzinfo=B)  # override
    weekly.append(ms(loc))
export_end = datetime(2024, 9, 1, 12, 0, tzinfo=timezone.utc)  # latest DTSTAMP
monthly = [ms(d.replace(tzinfo=B)) for d in rrule(MONTHLY, dtstart=datetime(2024, 7, 1, 10, 0), count=6) if d.replace(tzinfo=B) <= export_end]
print(json.dumps({
  'weekly': weekly, 'monthly': monthly,
  'nyc': [ms(datetime(2024, 3, 6, 9, 0, tzinfo=NY)), ms(datetime(2024, 3, 13, 9, 0, tzinfo=NY))],
  'windows': ms(datetime(2024, 3, 7, 15, 0, tzinfo=B)),
  'floating': ms(datetime(2024, 3, 6, 14, 0, tzinfo=B)),
  'allday': ms(datetime(2024, 3, 8, 0, 0, tzinfo=B)),
}))`);

const times = (evs, c) => evs.filter(e => e.context === c).map(e => e.t);

test('detect: .ics files with BEGIN:VCALENDAR; Takeout layout', async () => {
  const d = await calendar.detect(await FileSet.fromPaths(MAIN));
  assert.equal(d.score, 0.9);
  assert.deepEqual(d.files.sort(), ['google/ana.ruiz@example.org.ics', 'outlook/Calendar.ics']);
  const z = await calendar.detect(await FileSet.fromPaths([zipFolder(fixture('calendar', 'takeout'), 'takeout-001.zip')]));
  assert.equal(z.reason, 'Google Takeout calendar (.ics)');
  assert.deepEqual(z.files, ['Calendar/Team rota.ics']);
  assert.equal((await calendar.detect(await FileSet.fromPaths([fixture('email', 'eml')]))).score, 0);
});

test('recurrence, overrides, exclusions and time zones match an independent expansion', async () => {
  const had = ICAL.TimezoneService.has('Europe/Berlin');
  const { ds, source } = await runImporter(calendar, MAIN);
  const evs = events(ds);
  assert.equal(source.view, 'ego');
  assert.equal(source.egoKey, 'email:ana.ruiz@example.org');
  assert.equal(source.egoInferredFrom, 'calendar-name');
  assert.equal(node(ds, 'email:ana.ruiz@example.org').attrs.is_ego, true);
  assert.ok(evs.every(e => e.type === 'copresence'));

  // Weekly series: EXDATE removed, the override (listed before its master) moved
  // to 11:00, DST change on 31 March handled in local time, UNTIL inclusive.
  assert.deepEqual(times(evs, 'cal:7kq2p1example@google.com'), REF.weekly);
  assert.equal(REF.weekly.length, 16);
  const weekly = evs.filter(e => e.context === 'cal:7kq2p1example@google.com');
  const moved = weekly.find(e => e.text === 'Apollo weekly sync (moved)');
  assert.equal(moved.t, Date.UTC(2024, 2, 11, 10, 0));
  assert.deepEqual(moved.targets, [['email:ben.okafor@example.org', 'attendee']]);
  // Declined Chen, NON-PARTICIPANT Erin and the room never become targets.
  const regular = weekly.find(e => e.text === 'Apollo weekly sync');
  assert.equal(regular.actor, 'email:ana.ruiz@example.org');
  assert.deepEqual(regular.targets, [['email:ben.okafor@example.org', 'attendee'], ['email:dana.park@example.org', 'attendee']]);
  assert.equal(node(ds, 'email:erin.fox@example.org'), null);
  assert.equal(node(ds, 'email:c_1882example@resource.calendar.google.com'), null);
  assert.equal(source.counts.declined, 15);
  assert.equal(source.counts['rooms-resources'], 15);
  assert.equal(source.counts['non-participants'], 15);
  assert.equal(ctx(ds, 'cal:7kq2p1example@google.com').visibility, 'group');
  assert.equal(ctx(ds, 'cal:7kq2p1example@google.com').kind, 'meeting');

  // COUNT=3 standup in two files: deduped, the higher SEQUENCE copy wins.
  const standup = evs.filter(e => e.context === 'cal:standup-001@google.com');
  assert.deepEqual(standup.map(e => e.t), [5, 6, 7].map(d => Date.UTC(2024, 2, d, 9, 0)));
  assert.ok(standup.every(e => e.text === 'Daily standup (v2)'));
  assert.equal(source.counts['duplicate-occurrences'], 3);
  assert.equal(standup[0].actor, 'email:ben.okafor@example.org'); // MAILTO:Ben.Okafor@Example.org
  assert.equal(node(ds, 'email:ben.okafor@example.org').label, 'Okafor, Ben'); // quoted CN with comma

  // TZID without VTIMEZONE: IANA name via Intl, across the US DST change.
  assert.deepEqual(times(evs, 'cal:nyc-001@google.com'), REF.nyc);
  // Windows zone name without VTIMEZONE; CLASS:PRIVATE; fold inside a UTF-8 character.
  const win = evs.find(e => e.context === 'cal:040000008200E00074C5B7101A82E008000000001');
  assert.equal(win.t, REF.windows);
  assert.equal(win.text, 'Résumé review');
  assert.equal(ctx(ds, win.context).visibility, 'private');
  // Floating time read in X-WR-TIMEZONE, flagged; no organizer -> the ego acts.
  const fl = evs.find(e => e.context === 'cal:floating-001@google.com');
  assert.equal(fl.t, REF.floating);
  assert.equal(fl.actor, 'email:ana.ruiz@example.org');
  assert.equal(ctx(ds, fl.context).visibility, 'direct');
  assert.equal(warning(source, 'floating-time').count, 1);
  assert.equal(source.counts['no-organizer-used-ego'], 1);
  // Unbounded monthly series stops at the export date (latest DTSTAMP).
  assert.deepEqual(times(evs, 'cal:monthly-001@google.com'), REF.monthly);
  assert.equal(REF.monthly.length, 3);
  assert.equal(source.window.end, Date.UTC(2024, 8, 1, 12, 0));
  assert.ok(warning(source, 'group-attendee'));
  // Cancelled and all-day events are left out.
  assert.equal(source.counts.cancelled, 1);
  assert.equal(source.counts['all-day-skipped'], 1);
  assert.equal(evs.length, 16 + 3 + 2 + 1 + 1 + 3);
  // Zones registered for the import are removed afterwards (the service is global).
  assert.equal(ICAL.TimezoneService.has('Europe/Berlin'), had);
});

test('options: weights, window, occurrence cap, all-day, owner', async () => {
  const dur = events((await runImporter(calendar, MAIN, { weightBy: 'duration' })).ds);
  assert.equal(dur.find(e => e.context === 'cal:standup-001@google.com').weight, 15);
  assert.equal(dur.find(e => e.context === 'cal:nyc-001@google.com').weight, 60);
  assert.ok(dur.filter(e => e.context === 'cal:7kq2p1example@google.com').every(e => e.weight === 30));

  const win = events((await runImporter(calendar, MAIN, { windowEnd: '2024-03-31' })).ds);
  assert.deepEqual(times(win, 'cal:7kq2p1example@google.com'), REF.weekly.slice(0, 4));
  assert.equal(times(win, 'cal:monthly-001@google.com').length, 0);

  const cap = await runImporter(calendar, MAIN, { maxOccurrences: 2 });
  assert.equal(times(events(cap.ds), 'cal:7kq2p1example@google.com').length, 2);
  assert.ok(warning(cap.source, 'occurrence-cap'));

  const ad = events((await runImporter(calendar, MAIN, { includeAllDay: true })).ds);
  assert.equal(ad.find(e => e.context === 'cal:allday-001@google.com').t, REF.allday); // midnight in X-WR-TIMEZONE

  const own = await runImporter(calendar, MAIN, { egoAddress: 'Dana.Park@example.org' });
  assert.equal(own.source.egoKey, 'email:dana.park@example.org');
});

test('Takeout zip; owner guessed from participants when the calendar name is not an address', async () => {
  const { ds, source } = await runImporter(calendar, zipFolder(fixture('calendar', 'takeout'), 'takeout-001.zip'));
  const evs = events(ds);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].t, Date.UTC(2024, 3, 2, 8, 0));
  assert.deepEqual(evs[0].targets, [['email:chen.li@example.org', 'attendee']]);
  assert.equal(source.egoKey, 'email:ana.ruiz@example.org');
  assert.ok(warning(source, 'ego-guessed'));
});

test('unfold happens before UTF-8 decoding', () => {
  const b = Uint8Array.from([...Buffer.from('SUMMARY:R'), 0xc3, 13, 10, 32, 0xa9, ...Buffer.from('sum'), 10, 9, ...Buffer.from('x')]);
  assert.equal(unfoldBytes(b), 'SUMMARY:Résumx');
});
