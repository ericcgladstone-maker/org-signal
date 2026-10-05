// Exports missing their key file, and empty or header-only files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upload, refused, plain } from './helpers.js';

test('X archive without tweets.js: messages and follows are read, the missing tweets are named', async () => {
  const r = await upload('x-missing/twitter-2026-10-04-no-tweets.zip');
  assert.ok(r.report.totals.events > 0);
  const w = r.warn('missing-part');
  assert.match(w.message, /tweets\.js/);
  assert.match(w.message, /no tweets \(replies, mentions, quotes and retweets\)/);
  assert.match(w.message, /without removing files/);
  plain(w.message);
});

test('X archive without direct-messages.js: tweets are read, the missing messages are named', async () => {
  const r = await upload('x-missing/twitter-2026-10-04-no-dms.zip');
  assert.ok(r.report.totals.events > 0);
  assert.match(r.warn('missing-part').message, /one-to-one direct messages and group direct messages/);
});

test('X archive with account files only: an error that nothing was read, and why', async () => {
  const r = await upload('x-missing/twitter-2026-10-04-account-only.zip');
  assert.equal(r.report.totals.events, 0);
  const w = r.warn('x-archive-no-data');
  assert.equal(w.severity, 'error');
  plain(w.message);
  assert.ok(r.warn('missing-part'));
});

test('Slack export without users.json, and channel folders alone', async () => {
  const r = await upload('slack-no-users/Acme Slack export no users.zip');
  assert.deepEqual(r.plan.map(p => p.id), ['slack']);
  assert.ok(r.report.totals.events > 0, 'not an empty source any more');
  assert.equal(r.warn('slack-public-only'), null, 'groups.json is there: not public-only');
  plain(r.warn('slack-no-users').message);
  // People are named from the user_profile copied into messages where present.
  assert.ok(r.dataset.nodes.labels.includes('Ana Ruiz'));

  const c = await upload('slack-no-users/Acme Slack channels only.zip');
  assert.deepEqual(c.plan.map(p => p.id), ['slack']);
  assert.ok(c.warn('slack-no-channel-list'));
  assert.ok(c.warn('slack-no-users'));
  assert.equal(c.sources[0].variant, 'partial');
});

test('Instagram export requested without Messages: refused with the option to tick', async () => {
  const e = await refused('meta-no-messages', 'instagram-no-inbox/instagram-ada.example-2026-10-04-Q1w2E3.zip');
  assert.match(e.message, /This Instagram export has no messages folder/);
  assert.match(e.message, /Customize information: Messages; Format: JSON/);
  plain(e.message);
});

test('Network Canvas export without edge lists: ego-alter ties read, the missing alter ties named', async () => {
  const r = await upload('nc-no-edges/networkCanvasExport');
  assert.equal(r.plan[0].id, 'network-canvas');
  assert.ok(r.report.totals.events > 0);
  const w = r.warn('nc-no-alter-ties');
  assert.match(w.message, /a star around its ego/);
  plain(w.message);
});

test('empty and header-only files', async () => {
  // Zero bytes: refused before any importer looks at it.
  for (const f of ['empty/result.json', 'empty/messages.csv', 'empty/empty.zip', 'empty/WhatsApp Chat with Nobody.txt']) {
    const e = await refused('empty-upload', f);
    assert.match(e.message, /is empty \(0 bytes\)/);
    plain(e.message);
  }
  // A header and no rows: recognised, and said plainly.
  const edges = await upload('empty/edges-header-only.csv');
  assert.equal(edges.report.totals.events, 0);
  assert.match(edges.warn('no-edges').message, /no rows of data/);
  const li = await upload('empty/Connections.csv');
  assert.deepEqual(li.codes(), ['linkedin-no-rows']);
  plain(li.warn('linkedin-no-rows').message);
  const cal = await upload('empty/empty-calendar.ics');
  assert.deepEqual(cal.codes(), ['calendar-empty']);
  plain(cal.warn('calendar-empty').message);
});

test('an empty chat file inside a WhatsApp zip gets one plain notice, not a list of side effects', async () => {
  const { zipSync } = await import('../../vendor/fflate.js');
  const { FileSet } = await import('../../src/core/fileset.js');
  const { runImport } = await import('../../src/core/pipeline.js');
  const blob = new Blob([zipSync({ '_chat.txt': new Uint8Array(0), 'IMG-20250304-WA0001.jpg': new Uint8Array([0xff, 0xd8]) })]);
  const r = await runImport(await FileSet.from([{ blob, path: 'WhatsApp Chat - Nobody.zip' }]), { choices: ['whatsapp'] });
  const ws = r.report.sources[0].warnings;
  assert.deepEqual(ws.map(w => w.code), ['no-messages']);
  assert.match(ws[0].message, /_chat\.txt is empty/);
});
