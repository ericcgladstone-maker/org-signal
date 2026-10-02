import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import email, { parseEmailDate, parseFromLineDate, mboxMessages } from '../../src/importers/email.js';
import { FileSet } from '../../src/core/fileset.js';
import { runImporter, zipFolder, fixture, events, node, ctx, warning } from './helpers.js';

const py = (code, ...args) => JSON.parse(execFileSync('python3', ['-c', code, ...args]).toString());
const takeoutZip = zipFolder(fixture('email', 'takeout'), 'takeout-20240310T000000Z-001.zip');
const byKey = (evs, k) => evs.find(e => e.key === k);

test('detect: claims mail files only, scores by kind', async () => {
  const all = await FileSet.fromPaths([fixture('email')]);
  const d = await email.detect(all);
  assert.equal(d.score, 0.9);
  assert.deepEqual(d.files.sort(), [
    'apple/Work.mbox/mbox', 'eml/budget.eml', 'eml/reply.eml', 'pst/archive.pst',
    'takeout/Takeout/Mail/All mail Including Spam and Trash.mbox', 'thunderbird/Inbox',
  ]);
  const z = await email.detect(await FileSet.fromPaths([takeoutZip]));
  assert.equal(z.reason, 'Gmail Takeout mailbox (mbox)');
  assert.deepEqual(z.files, ['Mail/All mail Including Spam and Trash.mbox']);
  const pst = await email.detect(await FileSet.fromPaths([fixture('email', 'pst')]));
  assert.equal(pst.score, 0.6);
  assert.deepEqual(pst.files, ['archive.pst']);
  const none = await email.detect(await FileSet.fromPaths([fixture('calendar', 'google')]));
  assert.equal(none.score, 0);
});

test('Gmail Takeout zip: messages, roles, threads, times, lists, ego', async () => {
  const { ds, source } = await runImporter(email, takeoutZip);
  const evs = events(ds);
  assert.equal(source.variant, 'takeout');
  assert.equal(source.view, 'ego');
  assert.equal(source.egoKey, 'email:ana.ruiz@example.org');
  assert.equal(source.egoInferredFrom, 'delivered-to');
  assert.equal(node(ds, 'email:ana.ruiz@example.org').attrs.is_ego, true);
  // 8 messages in the file; the Spam one is skipped by default.
  assert.equal(source.counts['messages-read'], 8);
  assert.equal(source.counts['spam-trash-skipped'], 1);
  assert.equal(warning(source, 'spam-trash-excluded').count, 1); // said, not silent (S26)
  assert.equal(evs.length, 7);
  assert.ok(evs.every(e => e.type === 'message'));

  const a = byKey(evs, 'email:root000@mail.example.org');
  assert.equal(a.t, Date.UTC(2024, 2, 4, 11, 20, 34)); // 12:20:34 +0100
  assert.equal(a.actor, 'email:ana.ruiz@example.org');
  assert.deepEqual(a.targets, [
    ['email:ben.okafor@example.org', 'to'], ['email:chen.li@example.org', 'to'],
    ['email:jose.perez@example.com', 'cc'], ['email:dana.park@example.org', 'bcc'],
  ]);
  // Body "From " lines that follow a non-blank line, or lack a date, do not split;
  // ">From " loses one '>'.
  assert.match(a.text, /^From the desk of Ana: this line follows/m);
  assert.match(a.text, /^From now on, use the new template\.$/m);
  assert.match(a.text, /^From here we go/m);
  // Thread id beyond 2^53 stays an exact string.
  assert.equal(a.context, 'email:thread:1790120000000000001');
  assert.equal(a.visibility, 'group');

  const b = byKey(evs, 'email:reply111@mail.example.org');
  assert.equal(b.actor, 'email:ben.okafor@example.org'); // Ben.Okafor@Example.org lowercased
  assert.equal(b.t, Date.UTC(2024, 2, 4, 13, 5, 0));
  assert.equal(b.parent, a.i);
  assert.equal(b.context, a.context);
  assert.equal(b.text, 'Looks good, merging.\n'); // text/plain part of multipart/alternative

  const list = byKey(evs, 'email:list222@mail.example.org');
  assert.deepEqual(list.targets, [['email:list:apollo-dev.lists.example.org', 'to']]);
  assert.equal(node(ds, 'email:list:apollo-dev.lists.example.org').attrs.is_list, true);
  assert.equal(node(ds, 'email:list:apollo-dev.lists.example.org').label, 'Apollo developers');
  assert.equal(node(ds, 'email:apollo-dev@lists.example.org'), null);
  assert.equal(source.counts['list-messages'], 1);
  assert.equal(source.counts.automated, 1); // Precedence: list

  const z = byKey(evs, 'email:e555@example.net');
  assert.equal(z.t, 1709738100000); // python parsedate_to_datetime('Wed, 6 Mar 24 10:15 EST')
  assert.equal(node(ds, 'email:zoe.ng@example.net').label, 'Zoë Ng'); // ISO-8859-1 Q-encoded
  assert.deepEqual(z.targets, [['email:ana.ruiz@example.org', 'to'], ['email:ben.okafor@example.org', 'to']]); // group syntax
  assert.equal(z.parent, -1);
  assert.equal(warning(source, 'unresolved-parent').count, 1);
  assert.match(ctx(ds, z.context).name, /client decided to fold onto a second line$/);

  assert.equal(byKey(evs, 'email:f666@example.org').t, 1709829000000); // -0700 with (PDT) comment
  const self = byKey(evs, 'email:g777@mail.example.org');
  assert.equal(self.t, Date.UTC(2024, 2, 8, 10, 0, 0)); // -0000 = unknown zone, read as UTC
  assert.deepEqual(self.targets, []);
  assert.equal(source.counts['self-messages'], 1);
  const undated = byKey(evs, 'email:h888@example.org');
  assert.equal(undated.t, Date.UTC(2024, 2, 9, 12, 0, 0)); // From_ line "Sat Mar 09 12:00:00 +0000 2024"
  assert.equal(source.counts['date-fallback'], 1);
  assert.equal(node(ds, 'email:jose.perez@example.com').label, 'José Pérez');
  assert.equal(node(ds, 'email:ben.okafor@example.org').label, 'Okafor, Ben');
  assert.deepEqual(node(ds, 'email:chen.li@example.org').platformIds, { email: 'chen.li@example.org' });
});

test('options: spam/trash, lists, headers only, broadcast flag', async () => {
  const spam = await runImporter(email, takeoutZip, { includeSpamTrash: true });
  assert.equal(spam.ds.events.count, 8);
  const nolist = await runImporter(email, takeoutZip, { excludeLists: true });
  assert.equal(nolist.ds.events.count, 6);
  assert.equal(nolist.source.counts['list-skipped'], 1);
  const auto = await runImporter(email, takeoutZip, { excludeAutomated: true });
  assert.equal(auto.ds.events.count, 6);
  const ho = await runImporter(email, takeoutZip, { headersOnly: true });
  assert.equal(ho.ds.events.count, 7);
  assert.ok(events(ho.ds).every(e => e.text === null));
  assert.equal(events(ho.ds).find(e => e.key === 'email:reply111@mail.example.org').parent, 0);
  const bc = await runImporter(email, takeoutZip, { maxRecipients: 1 });
  assert.equal(bc.source.counts['broadcast-messages'], 3); // 4, 2 and 2 recipients
  assert.ok(warning(bc.source, 'broadcast-messages'));
  const ego = await runImporter(email, takeoutZip, { egoAddress: 'Ben.Okafor@example.org' });
  assert.equal(ego.source.egoKey, 'email:ben.okafor@example.org');
});

test('Thunderbird folder (CRLF, mboxo, "From - " separators) and dedupe across files', async () => {
  const { ds, source } = await runImporter(email, [fixture('email', 'takeout'), fixture('email', 'thunderbird')]);
  assert.equal(source.counts.duplicates, 1); // reply111 also in Inbox
  const tb = events(ds).find(e => e.key === 'email:tb1@example.org');
  assert.equal(tb.t, Date.UTC(2024, 2, 11, 9, 0, 0));
  assert.equal(tb.text, 'From the archives: nothing new.\nSee you at noon.\n');
});

test('Apple Mail .mbox folder: From_ date fallback, adjacent B-encoded words, no Message-ID', async () => {
  const { ds, source } = await runImporter(email, fixture('email', 'apple'));
  const evs = events(ds);
  assert.equal(evs.length, 2);
  assert.equal(evs[0].t, Date.UTC(2024, 2, 5, 8, 0, 0)); // asctime "Tue Mar  5 08:00:00 2024", UTC
  assert.equal(node(ds, 'email:jose.perez@example.com').label, 'José Pérez');
  assert.match(evs[1].key, /^email:h:[0-9a-f]{16}$/);
  assert.equal(source.counts['no-message-id'], 1);
  assert.equal(evs[1].visibility, 'group');
  assert.equal(evs[0].visibility, 'direct');
  // No Delivered-To, no Sent label: ego is the most frequent recipient, flagged.
  assert.equal(source.egoKey, 'email:ana.ruiz@example.org');
  assert.ok(warning(source, 'ego-guessed'));
});

test('.eml files: 8-bit latin-1 body, Bcc on sent copy, Received date fallback, parent', async () => {
  const { ds, source } = await runImporter(email, fixture('email', 'eml'));
  const evs = events(ds);
  const a = evs.find(e => e.key === 'email:eml1@mail.example.org');
  const b = evs.find(e => e.key === 'email:eml2@example.org');
  assert.equal(a.text, 'Café at 3?\n');
  assert.deepEqual(a.targets, [['email:chen.li@example.org', 'to'], ['email:dana.park@example.org', 'bcc']]);
  assert.equal(b.t, Date.UTC(2024, 2, 13, 9, 0, 0));
  assert.equal(b.parent, a.i);
  assert.equal(source.variant, 'eml');
});

test('PST: detected, explained, nothing imported', async () => {
  const { ds, source } = await runImporter(email, fixture('email', 'pst'));
  assert.equal(ds.events.count, 0);
  const w = warning(source, 'pst-unsupported');
  assert.ok(w);
  assert.match(w.message, /readpst/);
  assert.match(w.message, /mbox/);
});

test('date parser agrees with python email.utils on RFC 5322 and obsolete forms', () => {
  const samples = [
    'Mon, 4 Mar 2024 12:20:34 +0100', 'Wed, 6 Mar 24 10:15 EST', 'Thu, 7 Mar 2024 09:30:00 -0700 (PDT)',
    'Fri, 8 Mar 2024 10:00:00 -0000', '4 Mar 1999 23:59:59 GMT', 'Tue, 31 Dec 2024 23:00 PST',
    'Sat, 1 Jun 85 08:00:00 +0530', 'Mon, 04 Mar 2024 08:05:00 -0500', 'Sun, 10 Mar 2024 01:59:59 CDT',
    '15 Aug 2023 07:00:00 UT',
  ];
  const ref = py(`
import json, sys
from email.utils import parsedate_to_datetime
from datetime import timezone
out = []
for s in json.loads(sys.argv[1]):
    d = parsedate_to_datetime(s)
    if d.tzinfo is None: d = d.replace(tzinfo=timezone.utc)
    out.append(round(d.timestamp() * 1000))
print(json.dumps(out))`, JSON.stringify(samples));
  assert.deepEqual(samples.map(parseEmailDate), ref);
  assert.equal(parseEmailDate('Mon, 4 Mar 2024 12:20:34 A'), Date.UTC(2024, 2, 4, 12, 20, 34)); // military: unknown zone
  assert.ok(Number.isNaN(parseEmailDate('sometime soon')));
  assert.ok(Number.isNaN(parseEmailDate('Mon, 31 Feb 2024 10:00:00 +0000')));
  assert.equal(parseFromLineDate('From 1790123456789012345@xxx Mon Mar 04 11:20:34 +0000 2024'), Date.UTC(2024, 2, 4, 11, 20, 34));
  assert.equal(parseFromLineDate('From MAILER-DAEMON Fri Jul  8 12:08:34 2011'), Date.UTC(2011, 6, 8, 12, 8, 34));
});

test('mbox split and headers agree with python mailbox on files without unescaped From lines', async () => {
  for (const f of [fixture('email', 'thunderbird', 'Inbox'), fixture('email', 'apple', 'Work.mbox', 'mbox')]) {
    const ref = py(`
import json, sys, mailbox
from email.utils import parseaddr
out = []
for m in mailbox.mbox(sys.argv[1]):
    out.append([parseaddr(m['From'])[1].lower(), m.get_from().rstrip(chr(13))])
print(json.dumps(out))`, f);
    const fs = await FileSet.fromPaths([f]);
    const ours = [];
    for await (const m of mboxMessages(fs.entries[0].stream())) ours.push(m);
    assert.equal(ours.length, ref.length);
    assert.deepEqual(ours.map(m => m.fromLine.slice(5)), ref.map(r => r[1]));
    const { ds } = await runImporter(email, f);
    assert.deepEqual(events(ds).map(e => e.actor.slice(6)), ref.map(r => r[0]));
  }
});
