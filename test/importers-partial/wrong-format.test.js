// The wrong export variant: the app reads what it can and names what is
// missing, or says why it cannot read the upload and which option to choose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FileSet } from '../../src/core/fileset.js';
import { runImport } from '../../src/core/pipeline.js';
import { zipSync, unzipSync } from '../../vendor/fflate.js';
import { upload, refused, plain, P } from './helpers.js';

test('Facebook and Instagram exports in HTML: refused with the JSON option named', async () => {
  const fb = await refused('meta-html-format', 'meta-html/facebook-adaexample-2026-10-04-Html01.zip');
  assert.match(fb.message, /This Facebook export is in HTML format \(2 message_N\.html files\)/);
  assert.match(fb.message, /Format: JSON/);
  plain(fb.message);
  const ig = await refused('meta-html-format', 'meta-html/instagram-ada.example-2026-10-04-Html02.zip');
  assert.match(ig.message, /This Instagram export/);
});

test('a JSON and an HTML Meta export together: the JSON one is read, the HTML one is named', async () => {
  const r = await upload('meta-mixed/facebook-adaexample-2026-10-04-Js01.zip', 'meta-mixed/facebook-adaexample-2025-01-10-Html03.zip');
  const read = r.sources.find(s => s.counts.events > 0);
  const failed = r.sources.find(s => s.counts.events === 0);
  assert.ok(read && failed);
  const w = failed.warnings.find(x => x.code === 'meta-html-format');
  assert.equal(w.severity, 'error');
  plain(w.message);
  // The empty failed source has no view to combine with the JSON one.
  assert.ok(!r.report.notes.some(n => /different views/.test(n)));
});

test('HTML conversation files inside a JSON export are named, the rest is read', async () => {
  // One zip holding both: the HTML threads of an older export copied in.
  const a = unzipSync(new Uint8Array(fs.readFileSync(P('meta-mixed', 'facebook-adaexample-2026-10-04-Js01.zip'))));
  const b = unzipSync(new Uint8Array(fs.readFileSync(P('meta-mixed', 'facebook-adaexample-2025-01-10-Html03.zip'))));
  const one = new Blob([zipSync({ ...a, ...b })]);
  const r = await runImport(await FileSet.from([{ blob: one, path: 'facebook-adaexample-2026-10-04-Mx01.zip' }]));
  const w = r.report.sources[0].warnings.find(x => x.code === 'meta-html-skipped');
  assert.equal(w.count, 1);
  assert.match(w.message, /1 conversation file is in HTML/);
  assert.ok(r.report.totals.events > 0);
});

test('Telegram HTML export (single chat and full): refused, with the JSON steps', async () => {
  for (const dir of ['telegram-html/ChatExport_2026-10-04', 'telegram-html/DataExport_2026-10-04']) {
    const e = await refused('telegram-html-format', dir);
    assert.match(e.message, /Machine-readable JSON/);
    plain(e.message);
  }
});

test('WhatsApp: with media, without media, and per-chat zips', async () => {
  const media = await upload('whatsapp-variants/with-media/WhatsApp Chat - Project Falcon.zip');
  assert.equal(media.plan[0].id, 'whatsapp');
  assert.deepEqual(media.unclaimed.filter(f => !/\.jpg$/i.test(f)), [], 'only the media is left unread');
  assert.ok(media.report.totals.events > 0);
  const text = await upload('whatsapp-variants/without-media/WhatsApp Chat with Marcus Oyelaran.txt');
  assert.equal(text.sources[0].label, 'WhatsApp');
  const chats = await upload(...['Ines Duarte', 'Kofi Mensah', 'Rosa Lind'].map(n => `whatsapp-variants/per-chat/WhatsApp Chat - ${n}.zip`));
  assert.equal(chats.sources.length, 3, 'three chats, reported separately');
  assert.deepEqual(chats.sources.map(s => s.title).sort(), ['Ines Duarte', 'Kofi Mensah', 'Rosa Lind']);
  assert.equal(chats.report.totals.events, 9);
});

test('iMessage chat.db copied without its Attachments folder imports in full', async () => {
  const r = await upload('imessage-no-attachments/chat.db');
  assert.equal(r.plan[0].id, 'imessage');
  assert.ok(r.report.totals.events > 0);
  assert.ok(!r.codes().some(c => /attach/.test(c)));
});

test('Slack free-plan export: public channels only, and what that means for the network', async () => {
  const r = await upload('slack-free/Acme Slack export Mar 4 2024.zip');
  const w = r.warn('slack-public-only');
  assert.match(w.message, /people who talk mostly in private appear peripheral or isolated/);
  assert.match(w.message, /Business\+/);
  plain(w.message);
  assert.equal(r.warn('slack-unknown-conversation'), null);
  assert.ok(r.sources[0].cannotShow.some(l => /Private channels and direct messages/.test(l)));
});

test('Teams partial uploads: chat list without messages, eDiscovery summary without Items.csv', async () => {
  const a = await refused('teams-no-messages', 'teams-partial/graph-chats-only');
  assert.match(a.message, /chats\.json lists chats/);
  plain(a.message);
  const b = await refused('purview-no-items', 'teams-partial/purview-summary-only');
  assert.match(b.message, /Items\.csv/);
  plain(b.message);
});

test('an Outlook calendar exported as CSV is not read as a spreadsheet; the .ics route is given', async () => {
  const e = await refused('calendar-csv-unsupported', 'calendar-csv/Calendar.CSV');
  assert.match(e.message, /File > Save Calendar/);
  assert.match(e.message, /Google Calendar, Settings > Import & export > Export/);
  plain(e.message);
});

test('a bare mbox and an unzipped Takeout folder are both read as email', async () => {
  const mbox = await upload('email-variants/mbox/Inbox.mbox');
  const takeout = await upload('email-variants/Takeout');
  assert.equal(mbox.sources[0].label, 'Email');
  assert.equal(takeout.sources[0].label, 'Gmail');
  assert.equal(mbox.report.totals.events, takeout.report.totals.events);
});

test('network files with variants that cannot be kept say what was done', async () => {
  const hyper = await upload('network-variants/hyperedges.graphml');
  const h = hyper.warn('hyperedges-ignored');
  assert.equal(h.count, 2);
  assert.match(h.message, /two-mode network/);
  plain(h.message);

  for (const f of ['network-variants/two-networks.paj', 'network-variants/two-networks.net']) {
    const r = await upload(f);
    const w = r.warn('pajek-multiple-networks');
    assert.match(w.message, /holds 2 networks \(friendship, advice\)/);
    plain(w.message);
    assert.equal(r.report.totals.events, 3);
    assert.equal(r.report.totals.nodes, 3, 'vertices joined by label across the networks');
    // Each tie keeps its network as a tie field.
    const schema = r.dataset.eventAttributeSchema.find(s => s.key === 'network');
    assert.ok(schema, 'network tie field');
    assert.deepEqual([...schema.values].sort(), ['advice', 'friendship']);
  }

  const dyn = await upload('network-variants/dynamic-spells.gexf');
  assert.ok(dyn.warn('interval-end-dropped'));
  assert.equal(dyn.report.totals.events, 3, 'one tie per spell');
});
