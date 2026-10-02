import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import tabular, { suggestMapping, importTabular, parseCSV, csvRecords, parseTimestamp, detectTimeFormat, localToUtc, sniffDelimiter } from '../../src/importers/tabular.js';
import { FileSet } from '../../src/core/fileset.js';
import { runImporter, fixture, events, node, ctx, warning } from './helpers.js';

const py = (code, ...args) => execFileSync('python3', ['-c', code, ...args], { encoding: 'utf8' });

test('parseCSV agrees with python csv on quoted commas, quotes and newlines', async () => {
  const path = fixture('tabular', 'messages.csv');
  const ours = parseCSV(await (await FileSet.fromPaths([path])).entries[0].text()).rows;
  const theirs = JSON.parse(py('import csv,json,sys; print(json.dumps(list(csv.reader(open(sys.argv[1], newline="")))))', path));
  assert.deepEqual(ours, theirs);
  assert.equal(ours[2][4], 'On it, "quoted" text\nspanning two lines');
});

test('csvRecords streams the same records as a whole-text parse, across batch boundaries', async () => {
  const text = 'a,b\n' + Array.from({ length: 23 }, (_, i) => `${i},"x\n${i}, y"`).join('\r\n') + '\n';
  const stream = Readable.toWeb(Readable.from([Buffer.from(text.slice(0, 50)), Buffer.from(text.slice(50))]));
  const rows = [];
  for await (const r of csvRecords(stream, { batchLines: 4 })) rows.push(r);
  assert.deepEqual(rows, parseCSV(text).rows);
  assert.equal(rows.length, 24);
  assert.equal(rows[5][1], 'x\n4, y');
});

test('sniffDelimiter ignores delimiters inside quotes', () => {
  assert.equal(sniffDelimiter('"a,b,c";d;e'), ';');
  assert.equal(sniffDelimiter('a\tb\tc'), '\t');
  assert.equal(sniffDelimiter('single'), ',');
});

test('timestamps match python datetime/zoneinfo', () => {
  const cases = [
    ['2024-03-04T11:20:34Z', 'iso', 'UTC'],
    ['2024-03-04T12:00:00+01:00', 'iso', 'UTC'],
    ['2024-03-04T12:00:00.250-0530', 'iso', 'UTC'],
    ['2024-03-05 09:15:00', 'iso', 'UTC'],
    ['2024-03-10 01:30', 'iso', 'America/New_York'],
    ['2024-03-10 03:30', 'iso', 'America/New_York'],   // just after spring-forward
    ['2024-11-03 00:30', 'iso', 'America/New_York'],
    ['2024-07-01', 'iso', 'Europe/Berlin'],
  ];
  const expect = JSON.parse(py(String.raw`
import json, sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
out = []
for v, fmt, tz in json.loads(sys.argv[1]):
    import re
    s = v.replace(' ', 'T').replace('Z', '+00:00')
    s = re.sub(r'([+-]\d\d)(\d\d)$', r'\1:\2', s)
    s = re.sub(r'\.(\d{1,3})(?=[+-]|$)', lambda m: '.' + m.group(1).ljust(6, '0'), s)
    if len(s) == 10: s += 'T00:00'
    d = datetime.fromisoformat(s)
    if d.tzinfo is None: d = d.replace(tzinfo=ZoneInfo(tz))
    out.append(round(d.timestamp() * 1000))
print(json.dumps(out))`, JSON.stringify(cases)));
  cases.forEach(([v, f, tz], i) => assert.equal(parseTimestamp(v, f, tz), expect[i], v + ' ' + tz));
  assert.equal(parseTimestamp('13/03/2024 14:05', 'dmy'), Date.UTC(2024, 2, 13, 14, 5));
  assert.equal(parseTimestamp('3/13/2024 2:05 PM', 'mdy'), Date.UTC(2024, 2, 13, 14, 5));
  assert.equal(parseTimestamp('12/1/24 12:00 AM', 'mdy'), Date.UTC(2024, 11, 1, 0, 0));
  assert.equal(parseTimestamp('1709551234', 'epoch-s'), 1709551234000);
  assert.equal(parseTimestamp('45000.5', 'excel'), Date.UTC(2023, 2, 15, 12)); // Excel 45000 = 2023-03-15
  assert.ok(Number.isNaN(parseTimestamp('2024-13-01', 'iso')));
  assert.ok(Number.isNaN(parseTimestamp('yesterday', 'iso')));
  assert.equal(localToUtc(2024, 1, 15, 9, 0, 0, 0, 'Asia/Kolkata'), Date.UTC(2024, 0, 15, 3, 30));
});

test('detectTimeFormat', () => {
  assert.equal(detectTimeFormat(['13/03/2024', '01/04/2024']).format, 'dmy');
  assert.equal(detectTimeFormat(['03/13/2024', '04/01/2024']).format, 'mdy');
  const amb = detectTimeFormat(['03/04/2024']);
  assert.equal(amb.format, 'mdy'); assert.ok(amb.confidence < 0.5); assert.ok(amb.note);
  assert.deepEqual(detectTimeFormat(['1709551234', '1709551299']).format, 'epoch-s');
  assert.deepEqual(detectTimeFormat(['1709551234000']).format, 'epoch-ms');
  assert.equal(detectTimeFormat(['2024-03-04T11:20:34Z']).zoned, true);
  assert.equal(detectTimeFormat(['2024-03-04 11:20']).zoned, false);
});

test('suggestMapping proposes event roles with confidence', () => {
  const { rows } = parseCSV('sender,recipients,sent_at,channel,message,weight\na@x.org,b@x.org;c@x.org,2024-03-04T11:20:34Z,apollo,"A long enough message body to look like text",1\n');
  const s = suggestMapping(rows[0], rows.slice(1));
  assert.equal(s.kind, 'events');
  assert.equal(s.mapping.actor, 'sender');
  assert.equal(s.mapping.targets, 'recipients');
  assert.equal(s.mapping.targetSeparator, ';');
  assert.equal(s.mapping.timestamp, 'sent_at');
  assert.equal(s.mapping.timeFormat, 'iso');
  assert.equal(s.mapping.context, 'channel');
  assert.equal(s.mapping.text, 'message');
  assert.equal(s.mapping.weight, 'weight');
  for (const c of s.columns.filter(c => c.role !== 'ignore')) assert.ok(c.confidence >= 0.3 && c.confidence <= 1);
});

test('suggestMapping: Gephi edge table and node table', () => {
  const e = suggestMapping(['Source', 'Target', 'Type', 'Weight'], [['A', 'B', 'Undirected', '2']]);
  assert.equal(e.kind, 'edges');
  assert.equal(e.mapping.directed, 'Type');
  assert.equal(e.mapping.type, undefined);
  const n = suggestMapping(['employee_id', 'name', 'department'], [['E1', 'Ana', 'Design'], ['E2', 'Ben', 'Eng']]);
  assert.equal(n.kind, 'nodes');
  assert.equal(n.mapping.id, 'employee_id');
  assert.equal(n.mapping.label, 'name');
  assert.deepEqual(n.mapping.attrs, ['department']);
});

test('importTabular events: list targets, time zones, text, skipped rows, self rows', async () => {
  const fs = await FileSet.fromPaths([fixture('tabular', 'messages.csv')]);
  const mapping = { actor: 'sender', targets: 'recipients', targetSeparator: ';', timestamp: 'sent_at', timeFormat: 'iso', timezone: 'Europe/Berlin', context: 'channel', text: 'message', weight: 'weight', namespace: 'csv' };
  const ds = await importTabular(fs, { mapping, kind: 'events' });
  const ev = events(ds);
  assert.equal(ev.length, 4);
  assert.deepEqual(ev[0].targets, [['csv:ben.okafor@example.org', 'to'], ['csv:chen.li@example.org', 'to']]);
  assert.equal(ev[0].t, Date.UTC(2024, 2, 4, 11, 20, 34));
  assert.equal(ev[1].t, Date.UTC(2024, 2, 4, 11, 0, 0));
  assert.equal(ev[2].t, Date.UTC(2024, 2, 5, 8, 15, 0)); // 09:15 Berlin (CET, +01:00)
  assert.equal(ev[1].weight, 2);
  assert.equal(ev[2].weight, 1);
  assert.equal(ev[1].text, 'On it, "quoted" text\nspanning two lines');
  assert.equal(ev[0].context, 'csv:ctx:apollo');
  assert.deepEqual(ev[3].targets, []); // note to self: the builder drops self targets
  const s = ds.meta.sources[0];
  assert.equal(s.tz, 'Europe/Berlin');
  assert.equal(warning(s, 'rows-skipped').count, 1);
  assert.equal(s.counts['self-loops'], 1);
  assert.equal(node(ds, 'csv:ana.ruiz@example.org').attrs.email, 'ana.ruiz@example.org');
});

test('importTabular edges from TSV: undirected source, zero weight skipped', async () => {
  const fs = await FileSet.fromPaths([fixture('tabular', 'edges.tsv')]);
  const ds = await importTabular(fs, { mapping: { actor: 'Source', targets: 'Target', weight: 'Weight', directed: 'Type', namespace: 'g' }, kind: 'edges' });
  const ev = events(ds);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].type, 'declared');
  assert.deepEqual(ev[0].targets, [['g:B', 'declared']]);
  assert.equal(ev[0].weight, 2.5);
  assert.equal(ds.meta.sources[0].directed, false);
  assert.equal(ds.meta.sources[0].counts['zero-weight-rows'], 1);
});

test('importTabular nodes: typed attributes', async () => {
  const fs = await FileSet.fromPaths([fixture('tabular', 'people.csv')]);
  const ds = await importTabular(fs, { mapping: { id: 'employee_id', label: 'name', attrs: ['department', 'level', 'start_date'], namespace: 'hr' }, kind: 'nodes' });
  assert.equal(ds.nodes.count, 3);
  const j = node(ds, 'hr:E1');
  assert.equal(j.label, 'José Pérez');
  assert.deepEqual(j.attrs, { department: 'Engineering', level: 3, start_date: '2019-04-01' });
  assert.equal(ds.attributeSchema.find(a => a.key === 'level').type, 'numeric');
});

test('importer: low detect score, auto mapping warning, dmy dates', async () => {
  const { ds, source, detect } = await runImporter(tabular, [fixture('tabular', 'dates_dmy.csv')]);
  assert.equal(detect.score, 0.2);
  assert.deepEqual(detect.files, ['dates_dmy.csv']);
  assert.ok(warning(source, 'auto-mapping'));
  const ev = events(ds);
  assert.equal(ev[0].t, Date.UTC(2024, 2, 13, 14, 5));
  assert.equal(ev[1].t, Date.UTC(2024, 3, 1, 9, 0));
  assert.equal(source.tz, 'assumed UTC');
});

test('importer: xlsx is detected and explained, not parsed', async () => {
  const { ds, source, detect } = await runImporter(tabular, [fixture('tabular', 'xlsx', 'roster.xlsx')]);
  assert.equal(detect.score, 0.5);
  assert.match(detect.reason, /save each sheet as CSV/);
  assert.ok(warning(source, 'spreadsheet-unsupported'));
  assert.equal(ds.events.count, 0);
});

test('mapping that names a missing column fails clearly', async () => {
  const fs = await FileSet.fromPaths([fixture('tabular', 'edges.tsv')]);
  await assert.rejects(importTabular(fs, { mapping: { actor: 'From', targets: 'Target' }, kind: 'edges' }), /Column "From"/);
});
