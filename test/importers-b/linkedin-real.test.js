// LinkedIn exports as they really are, era by era (fixtures and their sources:
// test/fixtures/importers-b/linkedin/real-structure/README.md), run through the
// real import pipeline: detection, planning, importer, report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FileSet } from '../../src/core/fileset.js';
import { runImport } from '../../src/core/pipeline.js';
import { splitRecipientNames } from '../../src/importers/linkedin.js';
import { zipSync } from '../../vendor/fflate.js';
import { fixture, events, node, context } from './helpers.js';

const REAL = (...p) => fixture('linkedin', 'real-structure', ...p);
const MAYA = 'linkedin:maya-lindgren-4a1b2c';
const JORDAN = 'linkedin:jordanpike';

async function pipe(paths, opts = {}) {
  const r = await runImport(await FileSet.fromPaths([].concat(paths)), opts);
  const src = r.report.sources[0];
  return { ...r, src, ds: r.dataset, ev: events(r.dataset), warn: code => src.warnings.find(w => w.code === code) ?? null };
}
const msgs = ev => ev.filter(e => e.type === 'message');
const conns = ev => ev.filter(e => e.key?.startsWith('linkedin:connection:'));

test('2021 Basic export (no preamble, no URL column, 9-column messages, 5-column invitations)', async () => {
  const { detections, plan, unclaimed, ds, ev, src, warn } = await pipe(REAL('Basic_LinkedInDataExport_05-14-2021'));
  assert.equal(detections[0].id, 'linkedin');
  assert.match(detections[0].reason, /Connections\.csv, messages\.csv, Invitations\.csv/);
  assert.deepEqual(plan.map(p => p.id), ['linkedin']);
  assert.deepEqual(unclaimed, []);
  // The owner's URL comes from the message they sent under their Profile.csv name.
  assert.equal(ds.meta.sources[0].egoKey, MAYA);
  assert.ok(warn('ego-url-inferred'));
  assert.equal(node(ds, MAYA).label, 'Maya Lindgren');
  // Connections have no URL column: joined to the URL their messages carry, one node per person.
  assert.deepEqual(conns(ev).map(e => e.targets[0][0]).sort(), ['linkedin:lena-vogt', 'linkedin:priya-raman-77', 'linkedin:theogrant']);
  assert.equal(warn('connection-url-by-name').count, 3);
  assert.equal(warn('no-profile-url'), null);
  assert.equal(node(ds, 'linkedin:theogrant').platformIds.email, 'theo.grant@example.com');
  assert.equal(node(ds, 'linkedin:theogrant').attrs.company, 'Contoso, Ltd.');
  assert.ok(!ds.nodes.keys.some(k => k.startsWith('linkedin:name:') || k === 'linkedin:me'));
  assert.equal(ds.nodes.keys.length, 6); // Maya, 3 connections, a "LinkedIn Member", Jonas (invitation only)
  // 1:1 thread stays a dm with the owner on both sides.
  const dm = msgs(ev).filter(e => e.context === 'linkedin:dm:2-YWFhYWFhYWEtZmljdGlvbmFsLTAwMDE=');
  assert.deepEqual(dm.map(e => [e.actor, e.targets]), [['linkedin:priya-raman-77', [[MAYA, 'dm']]], [MAYA, [['linkedin:priya-raman-77', 'dm']]]]);
  // Group thread: TO "Maya Lindgren, Lena Vogt" split into known names.
  const g = context(ds, 'linkedin:group_dm:2-YmJiYmJiYmItZmljdGlvbmFsLTAwMDI=');
  assert.equal(g.name, 'Spring offsite');
  assert.deepEqual(g.members.map(i => ds.nodes.keys[i]).sort(), ['linkedin:lena-vogt', MAYA, 'linkedin:theogrant']);
  assert.equal(warn('ambiguous-recipients'), null);
  // Invitations without URL columns resolve by name; the unknown inviter is kept.
  const inv = ev.filter(e => e.key?.startsWith('linkedin:invitation:'));
  assert.deepEqual(inv.map(e => [e.actor, e.targets[0][0], e.t]), [
    [MAYA, 'linkedin:priya-raman-77', Date.UTC(2021, 2, 12, 16, 5)],
    ['linkedin:unknown:invitations:jonas berg', MAYA, Date.UTC(2021, 4, 10, 9, 41)],
  ]);
  assert.equal(src.counts.messages, 5);
  assert.equal(src.view, 'ego');
  assert.ok(src.canShow.some(l => /owner's contacts/.test(l)));
});

test('2022 Complete export (Notes preamble, no URL column, hidden rows, names with ", Ph.D.")', async () => {
  const { ds, ev, src, warn } = await pipe(REAL('Complete_LinkedInDataExport_09-18-2022'));
  assert.equal(ds.meta.sources[0].egoKey, MAYA);
  // Two date-only rows: counted and reported, not turned into people.
  assert.equal(src.importerCounts['hidden-connections'], 2);
  assert.equal(warn('hidden-connections').count, 2);
  assert.equal(conns(ev).length, 3);
  assert.ok(!ds.nodes.keys.some(k => /connection-\d/.test(k)));
  assert.equal(ds.nodes.keys.length, 4);
  // "Maya Lindgren, Jane Doe, Ph.D." is two people, not three and not one.
  const g = context(ds, 'linkedin:group_dm:2-ZGRkZGRkZGQtZmljdGlvbmFsLTAwMDQ=');
  assert.deepEqual(g.members.map(i => ds.nodes.keys[i]).sort(), ['linkedin:janedoe-phd', MAYA, 'linkedin:ravimenon']);
  assert.equal(node(ds, 'linkedin:janedoe-phd').label, 'Jane Doe, Ph.D.');
  // ARCHIVE folder messages are kept.
  assert.equal(src.counts.messages, 4);
  // Endorsement without a URL column joins the connection by name.
  const end = ev.find(e => e.key?.startsWith('linkedin:endorsement:'));
  assert.deepEqual([end.actor, end.targets[0][0], end.t, end.text], ['linkedin:priya-raman-77', MAYA, Date.UTC(2022, 5, 20, 13, 5, 2), 'User Research']);
});

test('Oct 2023 Basic export (URL column, 10-column messages, SPAM, sponsored, header-only guide_messages.csv)', async () => {
  const { ds, ev, src, warn, unclaimed } = await pipe(REAL('Basic_LinkedInDataExport_10-21-2023'));
  assert.deepEqual(unclaimed, []);
  assert.equal(ds.meta.sources[0].egoKey, JORDAN); // from Invitations.csv URLs
  assert.equal(warn('ego-url-inferred'), null);
  assert.equal(src.importerCounts['hidden-connections'], 1);
  // SPAM left out and reported; guide_messages.csv is not messages.csv.
  assert.equal(warn('spam-excluded').count, 1);
  assert.ok(!ds.nodes.keys.includes('linkedin:rex-dorn-crypto'));
  assert.equal(src.counts.messages, 6);
  // The campaign-editor (spinmail) row is flagged as sponsored; its HTML is stripped.
  assert.equal(warn('possible-sponsored').count, 1);
  const spon = msgs(ev).find(e => e.context === 'linkedin:dm:2-aGhoaGhoaGgtZmljdGlvbmFsLTAwMDg=');
  assert.equal(spon.text, 'Hi %FIRSTNAME%,\nOur webinar is free & online.');
  // Endorser Public Url has no scheme.
  assert.equal(ev.find(e => e.key?.startsWith('linkedin:endorsement:')).actor, 'linkedin:tomasreyes');
  // RECIPIENT PROFILE URLS: comma-separated, no space.
  const g = context(ds, 'linkedin:group_dm:2-Z2dnZ2dnZ2ctZmljdGlvbmFsLTAwMDc=');
  assert.equal(g.members.length, 3);

  const kept = await pipe(REAL('Basic_LinkedInDataExport_10-21-2023'), { options: { linkedin: { includeSpam: true } } });
  assert.equal(kept.src.counts.messages, 7);
  assert.equal(kept.warn('spam-excluded'), null);
});

test('Aug 2025 Basic export (ATTACHMENTS and IS MESSAGE DRAFT without IS CONVERSATION DRAFT)', async () => {
  const { ev, src, warn } = await pipe(REAL('Basic_LinkedInDataExport_08-15-2025'));
  assert.equal(warn('drafts-skipped').count, 1);
  assert.equal(src.counts.messages, 3);
  assert.ok(!msgs(ev).some(e => /half-written/.test(e.text)));
  assert.deepEqual(msgs(ev)[0].targets, [[JORDAN, 'dm']]);
});

test('Mar 2026 Complete export (every field quoted, line breaks inside CONTENT, numbered extra files)', async () => {
  const { ds, ev, src, warn, unclaimed } = await pipe(REAL('Complete_LinkedInDataExport_03-09-2026'));
  assert.deepEqual(unclaimed, []);
  assert.equal(ds.meta.sources[0].egoKey, JORDAN);
  assert.equal(src.counts.messages, 5);
  const zoe = 'linkedin:zoë-brandt'; // percent-encoded slug decoded
  assert.equal(node(ds, zoe).label, 'Zoë Brandt');
  assert.equal(node(ds, zoe).attrs.position, '"Chief" of Staff');
  const dm = msgs(ev).filter(e => e.context === 'linkedin:dm:2-bW1tbW1tbW0tZmljdGlvbmFsLTAwMTM=');
  assert.equal(dm[0].text, 'Hi Jordan,\nthanks for the call.\n\nNotes below:\n- hiring plan\n- budget');
  assert.equal(dm[1].text, 'Great, "next steps" agreed.\nTalk soon'); // CRLF inside the field
  assert.deepEqual(dm[1].targets, [[zoe, 'dm']]);
  const g = context(ds, 'linkedin:group_dm:2-bm5ubm5ubm4tZmljdGlvbmFsLTAwMTQ=');
  assert.equal(g.members.length, 4);
  assert.equal(warn('possible-sponsored').count, 1);
  assert.equal(warn('hidden-connections').count, 1);
});

test('a 2026 messages.csv on its own is LinkedIn, not an edge list', async () => {
  const { detections, plan, ds, src } = await pipe(REAL('Complete_LinkedInDataExport_03-09-2026', 'messages.csv'));
  assert.equal(detections[0].id, 'linkedin');
  assert.deepEqual(plan.map(p => p.id), ['linkedin']);
  assert.equal(ds.meta.sources[0].egoKey, JORDAN);
  assert.equal(node(ds, JORDAN).label, 'Jordan Pike'); // no Profile.csv: the name it sends under
  assert.equal(src.counts.messages, 5);
});

test('a 2021 Connections.csv or Invitations.csv on its own is detected', async () => {
  for (const f of ['Connections.csv', 'Invitations.csv']) {
    const { detections } = await pipe(REAL('Basic_LinkedInDataExport_05-14-2021', f));
    assert.equal(detections[0].id, 'linkedin', f);
  }
});

test('the zip as downloaded (files at the root, archive-named) imports the same', async () => {
  const dir = REAL('Basic_LinkedInDataExport_10-21-2023');
  const files = {};
  for (const n of fs.readdirSync(dir)) files[n] = new Uint8Array(fs.readFileSync(path.join(dir, n)));
  const blob = new Blob([zipSync(files)]);
  const r = await runImport(await FileSet.from([{ blob, path: 'Basic_LinkedInDataExport_10-21-2023.zip' }]));
  const plain = await pipe(dir);
  assert.equal(r.detections[0].id, 'linkedin');
  assert.deepEqual(r.report.sources[0].counts, plain.src.counts);
  assert.deepEqual(r.dataset.nodes.keys, plain.ds.nodes.keys);
});

test('TO name splitting keeps credentials with their name', () => {
  const known = new Set(['maya lindgren', 'jane doe, ph.d.', 'lena vogt']);
  const isKnown = n => known.has(n.toLowerCase());
  assert.deepEqual(splitRecipientNames('Maya Lindgren, Jane Doe, Ph.D.', isKnown), { names: ['Maya Lindgren', 'Jane Doe, Ph.D.'], unmatched: 0 });
  assert.deepEqual(splitRecipientNames('Lena Vogt, Sam Roe, MBA, Maya Lindgren', isKnown), { names: ['Lena Vogt', 'Sam Roe, MBA', 'Maya Lindgren'], unmatched: 1 });
  assert.deepEqual(splitRecipientNames('Sam Roe, Kim Lee', isKnown), { names: ['Sam Roe', 'Kim Lee'], unmatched: 2 });
});
