import { test } from 'node:test';
import assert from 'node:assert/strict';
import linkedin, { parseConnectedOn, parseUtcStamp, parseInvitationDate, profileSlug, parseConnections } from '../../src/importers/linkedin.js';
import { fsFromFixtures, fsFromMemory, runImport, events, node, context, source, warningCodes } from './helpers.js';

const DIR = 'linkedin/Complete_LinkedInDataExport_10-02-2026';

test('per-file date parsers follow the spec formats', () => {
  assert.equal(parseConnectedOn('08 Feb 2026'), Date.UTC(2026, 1, 8));
  assert.equal(parseConnectedOn('2021-03-05'), Date.UTC(2021, 2, 5));
  assert.equal(parseConnectedOn('11/14/2019'), Date.UTC(2019, 10, 14));
  assert.ok(Number.isNaN(parseConnectedOn('05 Okt 2020')));
  assert.equal(parseUtcStamp('2025-06-01 14:03:22 UTC'), Date.UTC(2025, 5, 1, 14, 3, 22));
  assert.equal(parseUtcStamp('2024/02/01 15:02:55 UTC'), Date.UTC(2024, 1, 1, 15, 2, 55));
  assert.equal(parseInvitationDate('1/29/26, 2:37 PM'), Date.UTC(2026, 0, 29, 14, 37));
  assert.equal(parseInvitationDate('12/3/25, 12:05 AM'), Date.UTC(2025, 11, 3, 0, 5));
  assert.equal(parseInvitationDate('12/3/25, 12:05 PM'), Date.UTC(2025, 11, 3, 12, 5));
  assert.equal(profileSlug('https://www.linkedin.com/in/TomasReyes/?trk=x'), 'tomasreyes');
  assert.equal(profileSlug('www.linkedin.com/in/ines-okafor-l-3b2a91'), 'ines-okafor-l-3b2a91');
});

test('Connections.csv header found with and without the Notes preamble', () => {
  const plain = parseConnections('First Name,Last Name,URL,Email Address,Company,Position,Connected On\nA,B,https://www.linkedin.com/in/ab,,X,Y,01 Jan 2020\n');
  assert.equal(plain.length, 1);
  assert.equal(plain[0]['connected on'], '01 Jan 2020');
  assert.equal(parseConnections('just,some,csv\n1,2,3\n'), null);
});

test('detects a LinkedIn export and not unrelated CSVs', async () => {
  const fs = await fsFromFixtures(DIR);
  const d = await linkedin.detect(fs);
  assert.ok(d.score >= 0.9, d.reason);
  const other = await fsFromMemory({ 'messages.csv': 'id,permalink,thread_id,date,ip,from,to,subject,body\n' });
  assert.equal((await linkedin.detect(other)).score, 0);
});

test('full archive import: connections, messages, invitations, ego attrs', async () => {
  const fs = await fsFromFixtures(DIR);
  const { ds } = await runImport(linkedin, fs);
  const src = source(ds);
  assert.equal(src.view, 'ego');
  assert.equal(src.medium, 'linkedin');
  // Ego identified from Invitations.csv (OUTGOING inviter / INCOMING invitee).
  assert.equal(src.egoKey, 'linkedin:jordanpike');
  const ego = node(ds, 'linkedin:jordanpike');
  assert.equal(ego.label, 'Jordan Pike');
  assert.equal(ego.attrs.headline, 'Engineering Manager');
  assert.equal(ego.attrs.company, 'Contoso');
  assert.equal(ego.attrs.position, 'Engineering Manager');
  assert.equal(ego.attrs.location, 'Lisbon, Portugal');
  assert.match(ego.attrs.positions, /Engineer @ Fabrikam \(Mar 2019 - Dec 2023\)/);
  assert.equal(ego.attrs.education, 'University of Somewhere, BSc Computer Science');

  const ev = events(ds);
  const decl = ev.filter(e => e.type === 'declared' && e.key.startsWith('linkedin:connection:'));
  assert.equal(decl.length, 4);
  assert.ok(decl.every(e => e.actor === 'linkedin:jordanpike' && e.targets[0][1] === 'declared'));
  const byTarget = Object.fromEntries(decl.map(e => [e.targets[0][0], e.t]));
  assert.equal(byTarget['linkedin:ines-okafor-l-3b2a91'], Date.UTC(2026, 1, 8));
  assert.equal(byTarget['linkedin:tomasreyes'], Date.UTC(2019, 10, 14));
  assert.equal(byTarget['linkedin:wren-hale'], Date.UTC(2021, 2, 5));
  assert.ok(Number.isNaN(byTarget['linkedin:odd-date']));

  const ines = node(ds, 'linkedin:ines-okafor-l-3b2a91');
  assert.equal(ines.label, 'Ines Okafor-Lindqvist');
  assert.equal(ines.attrs.company, 'Northwind Analytics, Inc.');
  assert.equal(ines.attrs.position, 'Director of People Ops');
  assert.equal(ines.attrs.connected_on, '2026-02-08');
  assert.equal(node(ds, 'linkedin:tomasreyes').platformIds.email, 'tomas.reyes@example.org');
  assert.equal(node(ds, 'linkedin:tomasreyes').attrs.position, 'Engineer, Platform');
  assert.equal(node(ds, 'linkedin:wren-hale').label, 'Wren Hale, PhD');
  assert.equal(node(ds, 'linkedin:wren-hale').attrs.position, 'Research\nLead');

  // Messages: draft dropped; direct thread sorted by time; group thread has no broadcast targets.
  const msgs = ev.filter(e => e.type === 'message');
  assert.equal(msgs.length, 5);
  const direct = msgs.filter(e => e.context === 'linkedin:dm:2-YmQ3ZTk4ZjAtZmFrZS1pZA==');
  assert.deepEqual(direct.map(e => e.t), [Date.UTC(2025, 5, 1, 13), Date.UTC(2025, 5, 1, 14, 3, 22)]);
  assert.equal(direct[0].actor, 'linkedin:jordanpike');
  assert.deepEqual(direct[0].targets, [['linkedin:ines-okafor-l-3b2a91', 'dm']]);
  assert.deepEqual(direct[1].targets, [['linkedin:jordanpike', 'dm']]);
  assert.equal(direct[0].text, 'Hi Ines,\nmeet Tomás.');
  assert.equal(direct[0].visibility, 'direct');
  const g = msgs.filter(e => e.context === 'linkedin:group_dm:2-Z3JvdXAtY29udg==');
  assert.equal(g.length, 2);
  assert.ok(g.every(e => e.targets.length === 0 && e.visibility === 'group'));
  const gc = context(ds, 'linkedin:group_dm:2-Z3JvdXAtY29udg==');
  assert.equal(gc.name, 'Platform guild');
  assert.equal(gc.members.length, 3);
  // URL-less sender: unknown node scoped to its conversation.
  const sp = msgs.find(e => e.context === 'linkedin:dm:2-c3BvbnNvcmVk');
  assert.equal(sp.actor, 'linkedin:unknown:2-c3BvbnNvcmVk:linkedin member');
  assert.deepEqual(sp.targets, [['linkedin:jordanpike', 'dm']]);

  // Invitations: direction preserved, US 12h date.
  const inv = ev.filter(e => e.key?.startsWith('linkedin:invitation:'));
  assert.equal(inv.length, 2);
  assert.equal(inv[0].actor, 'linkedin:jordanpike');
  assert.deepEqual(inv[0].targets, [['linkedin:ines-okafor-l-3b2a91', 'declared']]);
  assert.equal(inv[0].t, Date.UTC(2026, 0, 29, 14, 37));
  assert.equal(inv[1].actor, 'linkedin:samquill');
  assert.deepEqual(inv[1].targets, [['linkedin:jordanpike', 'declared']]);
  assert.equal(inv[1].text, 'Met at the summit');
  assert.equal(node(ds, 'linkedin:samquill').attrs.invitation, 'received');

  const end = ev.find(e => e.key === 'linkedin:endorsement:received:0');
  assert.equal(end.actor, 'linkedin:ines-okafor-l-3b2a91');
  assert.deepEqual(end.targets, [['linkedin:jordanpike', 'declared']]);
  assert.equal(end.t, Date.UTC(2024, 1, 1, 15, 2, 55));

  const codes = warningCodes(ds);
  for (const c of ['drafts-skipped', 'unknown-member', 'unparsed-date', 'possible-sponsored', 'connection-date-only', 'invitation-time-zone-unknown']) assert.ok(codes.includes(c), c);
  assert.equal(src.counts.connections, 4);
  assert.equal(src.counts.messages, 5);
  assert.equal(src.counts.conversations, 3);
});

test('old export: no preamble, no recipient URLs, ego inferred from messages', async () => {
  const fs = await fsFromMemory({
    'Connections.csv': 'First Name,Last Name,URL,Email Address,Company,Position,Connected On\nAnn,Lee,https://www.linkedin.com/in/annlee,,Acme,CTO,02 Mar 2017\nBo,Ng,https://www.linkedin.com/in/bong,,Acme,Dev,03 Mar 2017\n',
    'messages.csv': [
      'CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,DATE,SUBJECT,CONTENT,FOLDER',
      'c1,,Me Myself,https://www.linkedin.com/in/me-myself,Ann Lee,2016-01-01 10:00:00 UTC,,hello,INBOX',
      'c1,,Ann Lee,,Me Myself,2016-01-01 11:00:00 UTC,,hi back,INBOX',
      'c2,,Me Myself,https://www.linkedin.com/in/me-myself,"Bo Ng",2016-02-01 10:00:00 UTC,,yo,INBOX',
      'c3,,Me Myself,https://www.linkedin.com/in/me-myself,"Smith, PhD",2016-03-01 10:00:00 UTC,,re,INBOX',
    ].join('\n') + '\n',
    'Profile.csv': 'First Name,Last Name,Headline\nMe,Myself,Builder\n',
  });
  const { ds, det } = await runImport(linkedin, fs);
  assert.ok(det.score >= 0.9);
  assert.equal(source(ds).egoKey, 'linkedin:me-myself');
  const ev = events(ds).filter(e => e.type === 'message');
  assert.equal(ev.length, 4);
  // Ann has no URL in her own row: matched to the connection by unique full name.
  assert.equal(ev[1].actor, 'linkedin:annlee');
  assert.deepEqual(ev[1].targets, [['linkedin:me-myself', 'dm']]);
  assert.deepEqual(ev[2].targets, [['linkedin:bong', 'dm']]);
  // "Smith, PhD" is kept as one person, not split on the comma.
  assert.deepEqual(ev[3].targets, [['linkedin:unknown:c3:smith, phd', 'dm']]);
  const codes = warningCodes(ds);
  assert.ok(codes.includes('ego-url-inferred'));
  assert.ok(codes.includes('matched-by-name'));
  assert.ok(codes.includes('ambiguous-recipients'));
});
