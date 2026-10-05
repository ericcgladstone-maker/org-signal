// Damaged files, browser renames, mixed drops, repeated files and odd encodings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FileSet } from '../../src/core/fileset.js';
import { runImport, importInWorker } from '../../src/core/pipeline.js';
import { handle } from '../../src/workers/import.worker.js';
import { upload, refused, plain, P } from './helpers.js';

const SLACK = 'two-platforms/Acme Slack export.zip';

test('a zip cut off mid-download is refused as incomplete', async () => {
  const e = await refused('zip-truncated', 'damaged/truncated/Acme Slack export.zip');
  assert.match(e.message, /Acme Slack export\.zip is incomplete/);
  assert.match(e.message, /Download the export again/);
  plain(e.message);
});

test('browser renames: .zip.zip, "(1).zip" and ".zip (1)" all open as the zip they are', async () => {
  const base = await upload(SLACK);
  for (const f of ['damaged/renamed/Acme Slack export.zip.zip', 'damaged/renamed/Acme Slack export (1).zip', 'damaged/renamed/Acme Slack export.zip (1)']) {
    const r = await upload(f);
    assert.deepEqual(r.plan.map(p => p.id), ['slack'], f);
    assert.equal(r.report.totals.events, base.report.totals.events, f);
  }
  const odd = await upload('damaged/renamed/Acme Slack export.zip (1)');
  assert.equal(odd.warn('zip-renamed').severity, 'info');
});

test('an unfinished .crdownload is refused as an unfinished download', async () => {
  const e = await refused('download-unfinished', 'damaged/crdownload/Acme Slack export.zip.crdownload');
  assert.match(e.message, /unfinished browser download/);
  plain(e.message);
});

test('a web page saved as .zip, and a .tgz Takeout, are refused with what they are', async () => {
  const html = await refused('not-a-zip', 'damaged/not-a-zip/takeout-20261004T101500Z-001.zip');
  assert.match(html.message, /holds a web page/);
  plain(html.message);
  const tgz = await refused('archive-unsupported', 'damaged/tgz/takeout-20261004T101500Z-001.tgz');
  assert.match(tgz.message, /File type: \.zip/);
  plain(tgz.message);
});

test('a password-protected zip (eDiscovery package) is refused with how to unzip it', async () => {
  const e = await refused('zip-encrypted', 'damaged/encrypted/Reports-ContosoCase-Export.zip');
  assert.match(e.message, /password-protected \(all 2 files are encrypted\)/);
  plain(e.message);
});

test('one damaged zip beside a good one: the good one is read, the damaged one is named on it', async () => {
  const r = await upload(SLACK, 'damaged/truncated/Acme Slack export.zip');
  assert.equal(r.sources.length, 1);
  assert.ok(r.report.totals.events > 0);
  const w = r.warn('zip-truncated');
  assert.equal(w.severity, 'error');
});

test('an export folder with unrelated files: the export is read, the rest listed as not read', async () => {
  const r = await upload('junk-folder/Acme Slack export');
  assert.deepEqual(r.plan.map(p => p.id), ['slack']);
  assert.deepEqual([...r.unclaimed].sort(), ['Onboarding.pdf', 'notes.docx', 'team-photo.jpg']);
  const base = await upload(SLACK);
  assert.equal(r.report.totals.events, base.report.totals.events);
});

test('two platforms dropped together: both read, reported separately', async () => {
  const r = await upload(SLACK, 'two-platforms/WhatsApp Chat with Marcus Oyelaran.txt');
  assert.deepEqual(r.sources.map(s => s.label).sort(), ['Slack', 'WhatsApp']);
  const slack = await upload(SLACK);
  const wa = await upload('two-platforms/WhatsApp Chat with Marcus Oyelaran.txt');
  assert.equal(r.report.totals.events, slack.report.totals.events + wa.report.totals.events);
});

test('the same export dropped twice is read once', async () => {
  const once = await upload(SLACK);
  const zips = await upload('duplicate/Acme Slack export.zip', 'duplicate/Acme Slack export (1).zip');
  assert.equal(zips.sources.length, 1);
  assert.equal(zips.report.totals.events, once.report.totals.events);
  // The browser's copy is the one dropped, whichever order they came in.
  assert.match(zips.warn('duplicate-upload').message, /^Acme Slack export \(1\)\.zip is the same as Acme Slack export\.zip/);
  const txts = await upload('duplicate/WhatsApp Chat with Marcus Oyelaran.txt', 'duplicate/WhatsApp Chat with Marcus Oyelaran (1).txt');
  assert.equal(txts.sources.length, 1);
  assert.equal(txts.report.totals.events, 6);
});

test('a zip dropped beside the folder it was unzipped into counts once, with or without extra files', async () => {
  const once = await upload(SLACK);
  for (const dir of ['same', 'extra']) {
    const r = await upload(`zip-and-folder/${dir}/Acme Slack export.zip`, `zip-and-folder/${dir}/Acme Slack export`);
    assert.equal(r.sources.length, 1, dir);
    assert.equal(r.report.totals.events, once.report.totals.events, dir);
    const w = r.warn('duplicate-upload');
    assert.ok(w, dir);
    plain(w.message);
  }
});

test('a different file of the same size is not taken for a duplicate', async () => {
  const fs = await FileSet.from([
    { blob: new Blob(['[{"type":"message","user":"U1","text":"x","ts":"1700000000.000001"}]']), path: 'a/2023-11-14.json' },
    { blob: new Blob(['[{"type":"message","user":"U1","text":"y","ts":"1700000000.000001"}]']), path: 'b/2023-11-14.json' },
  ]);
  assert.equal(fs.entries.length, 2);
  assert.deepEqual(fs.problems, []);
});

test('odd encodings: UTF-16 from Excel, BOM with CRLF', async () => {
  for (const f of ['encodings/edges-utf16.txt', 'encodings/edges-bom-crlf.csv']) {
    const r = await upload(f);
    assert.equal(r.report.totals.events, 3, f);
    assert.deepEqual([...r.dataset.nodes.labels].sort(), ['Ana Ruiz', 'José Pérez', 'Zoë Brandt'], f);
  }
  const wa = await upload('encodings/WhatsApp Chat with Leo Brandt.txt');
  const plainWa = await upload('two-platforms/WhatsApp Chat with Marcus Oyelaran.txt');
  assert.equal(wa.report.totals.events, plainWa.report.totals.events);
  assert.ok(!wa.dataset.nodes.labels.some(l => /﻿|\r/.test(l)));
});

test('Outlook .pst: refused with the conversion route, in plain terms', async () => {
  const r = await upload('pst/archive.pst');
  const w = r.warn('pst-unsupported');
  assert.equal(w.severity, 'error');
  assert.match(w.message, /readpst/);
  assert.doesNotMatch(w.message, /yet/);
  plain(w.message);
});

test('the import worker passes the error code through, and refuses unreadable inputs at detection', async () => {
  const fs = await import('node:fs');
  const blob = await fs.openAsBlob(P('damaged', 'truncated', 'Acme Slack export.zip'));
  const posts = [];
  await handle({ type: 'detect', files: [{ blob, path: 'Acme Slack export.zip' }] }, m => posts.push(m));
  assert.equal(posts.at(-1).type, 'error');
  assert.equal(posts.at(-1).code, 'zip-truncated');
  assert.equal(typeof importInWorker, 'function');
});

test('every new code has a severity in the report', async () => {
  const { warningSeverity } = await import('../../src/core/report.js');
  const expect = {
    'zip-truncated': 'error', 'zip-encrypted': 'error', 'not-a-zip': 'error', 'download-unfinished': 'error', 'archive-unsupported': 'error',
    'empty-upload': 'error', 'meta-html-format': 'error', 'meta-no-messages': 'error', 'telegram-html-format': 'error', 'teams-no-messages': 'error',
    'purview-no-items': 'error', 'calendar-csv-unsupported': 'error', 'x-archive-no-data': 'error',
    'parts-combined': 'info', 'duplicate-upload': 'info', 'zip-renamed': 'info', 'export-part-one': 'info',
    'export-parts-missing': 'warn', 'missing-part': 'warn', 'meta-thread-part-missing': 'warn', 'slack-no-users': 'warn', 'discord-no-messages': 'warn',
  };
  for (const [code, sev] of Object.entries(expect)) assert.equal(warningSeverity({ code }), sev, code);
  void runImport;
});
