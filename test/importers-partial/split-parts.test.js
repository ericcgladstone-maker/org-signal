// Split and multi-part archives: one part alone says what is missing; all
// parts together are read as one export, with nothing counted twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upload, plain } from './helpers.js';

const T1 = 'takeout-split/takeout-20261004T101500Z-001.zip';
const T2 = 'takeout-split/takeout-20261004T101500Z-002.zip';

test('Takeout part 001 alone: mail is read; the numbered-part notice says more parts may exist', async () => {
  const r = await upload(T1);
  assert.deepEqual(r.plan.map(p => p.id), ['email']);
  assert.equal(r.sources.length, 1);
  assert.equal(r.sources[0].label, 'Gmail');
  assert.equal(r.report.totals.events, 7);
  const w = r.warn('export-part-one');
  assert.equal(w.severity, 'info');
  assert.match(w.message, /part 1 of a numbered export/);
  plain(w.message);
});

test('Takeout part 002 alone: calendars are read; part 1 is named as missing', async () => {
  const r = await upload(T2);
  assert.deepEqual(r.plan.map(p => p.id), ['calendar']);
  assert.equal(r.report.totals.events, 1);
  const w = r.warn('export-parts-missing');
  assert.equal(w.severity, 'warn');
  assert.match(w.message, /part 1 was not loaded/);
  plain(w.message);
});

test('Takeout parts together: mail and calendar, each once, no part notice', async () => {
  const r = await upload(T1, T2);
  assert.deepEqual(r.sources.map(s => s.label).sort(), ['Calendar', 'Gmail']);
  assert.equal(r.report.totals.events, 8);
  assert.equal(r.warn('export-part-one'), null);
  assert.equal(r.warn('export-parts-missing'), null);
});

test('Takeout part 001 given twice beside part 002: read once', async () => {
  const once = await upload(T1, T2);
  const r = await upload(T1, T2, T1);
  assert.equal(r.report.totals.events, once.report.totals.events);
  assert.equal(r.sources.find(s => s.label === 'Gmail').fileNames.length, 1);
  const w = r.warn('duplicate-upload');
  assert.match(w.message, /given twice; it was read once/);
});

test('LinkedIn: both parts together are one export; the first part does not ask for the second', async () => {
  const both = await upload('linkedin-parts/Basic_LinkedInDataExport_10-04-2026.zip', 'linkedin-parts/Complete_LinkedInDataExport_10-05-2026.zip');
  const second = await upload('linkedin-parts/Complete_LinkedInDataExport_10-05-2026.zip');
  assert.equal(both.sources.length, 1);
  assert.equal(both.warn('linkedin-profile-only'), null);
  assert.deepEqual(both.sources[0].counts, second.sources[0].counts);
  assert.equal(both.dataset.meta.sources[0].egoKey, 'linkedin:ada-example-9f');
  const w = both.warn('parts-combined');
  assert.match(w.message, /2 parts: Basic_LinkedInDataExport_10-04-2026, Complete_LinkedInDataExport_10-05-2026/);
  assert.match(w.message, /3 files that are in more than one part were read once/);
});

test('LinkedIn: the first part alone says the network is in the second', async () => {
  const r = await upload('linkedin-parts/Basic_LinkedInDataExport_10-04-2026.zip');
  assert.equal(r.report.totals.events, 0);
  plain(r.warn('linkedin-profile-only').message);
});

test('X archive in two parts: each alone names what the other holds; together one source, nothing twice', async () => {
  const p1 = await upload('x-parts/twitter-2026-10-04-5e1c0a-part1.zip');
  const p2 = await upload('x-parts/twitter-2026-10-04-5e1c0a-part2.zip');
  for (const r of [p1, p2]) {
    const w = r.warn('missing-part');
    assert.match(w.message, /delivered in several parts/);
    assert.match(w.message, /Load all the parts together/);
    plain(w.message);
    // The importer's notice is enough; the generic numbered-part one is not added.
    assert.equal(r.warn('export-part-one'), null);
  }
  assert.match(p1.warn('missing-part').message, /direct messages/);
  assert.match(p2.warn('missing-part').message, /the owner's account id/);

  const both = await upload('x-parts/twitter-2026-10-04-5e1c0a-part1.zip', 'x-parts/twitter-2026-10-04-5e1c0a-part2.zip');
  assert.equal(both.sources.length, 1);
  assert.equal(both.report.totals.events, p1.report.totals.events + p2.report.totals.events);
  assert.equal(both.warn('missing-part'), null);
  assert.equal(both.dataset.meta.sources[0].egoKey, 'x:1400000000000000001');
  assert.ok(both.warn('parts-combined'));
});

test('Facebook export in two zips: a thread cut across them is reported alone and whole together', async () => {
  const A = 'meta-parts/facebook-adaexample-2026-10-04-Ab12Cd.zip', B = 'meta-parts/facebook-adaexample-2026-10-04-Ef34Gh.zip';
  const b = await upload(B);
  const w = b.warn('meta-thread-part-missing');
  assert.equal(w.count, 1);
  assert.match(w.message, /Load all the zips of the export together/);
  plain(w.message);
  const a = await upload(A);
  const both = await upload(A, B);
  assert.equal(both.sources.length, 1);
  assert.equal(both.report.totals.events, a.report.totals.events + b.report.totals.events);
  assert.equal(both.warn('meta-thread-part-missing'), null);
  assert.ok(both.warn('parts-combined'));
  // One conversation, not two, for the thread split across the zips.
  assert.equal(both.dataset.contexts.keys.filter(k => /jordanpike_ABC123/.test(k)).length, 1);
});

test('Slack export split by hand: part 2 alone is read with its gaps named; both parts equal the whole export', async () => {
  const P1 = 'slack-split/Acme Slack export Mar 4 2024 - part 1.zip', P2 = 'slack-split/Acme Slack export Mar 4 2024 - part 2.zip';
  const p2 = await upload(P2);
  assert.deepEqual(p2.plan.map(p => p.id), ['slack']);
  for (const code of ['slack-no-users', 'slack-no-channel-list', 'export-parts-missing']) plain(p2.warn(code).message);
  assert.equal(p2.warn('slack-user-missing'), null, 'the no-users notice replaces the per-author one');

  const both = await upload(P1, P2);
  const whole = await upload('two-platforms/Acme Slack export.zip');
  assert.equal(both.sources.length, 1);
  assert.deepEqual(both.unclaimed, []);
  assert.equal(both.report.totals.events, whole.report.totals.events);
  assert.equal(both.report.totals.nodes, whole.report.totals.nodes);
  assert.equal(both.warn('slack-no-users'), null);
});

test('Discord package: whole, and without its Messages folder', async () => {
  const whole = await upload('discord-package/package.zip');
  assert.equal(whole.plan[0].id, 'discord');
  assert.ok(whole.report.totals.events > 0);
  const r = await upload('discord-package/package-no-messages.zip');
  assert.deepEqual(r.plan.map(p => p.id), ['discord'], 'not misread as an edge list');
  const w = r.warn('discord-no-messages');
  assert.equal(w.severity, 'warn');
  assert.match(w.message, /friend list \(2 friends/);
  plain(w.message);
  assert.equal(r.dataset.meta.sources[0].counts.friends, 2);
  assert.equal(r.warn('outgoing-only'), null);
});
