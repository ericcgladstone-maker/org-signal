// Import report wording (Networks 101 round, C3, L16, N18): many personal
// chats read as one person's slice with distinct people counted once; bots
// counted for the "left out of the network" note; empty joined columns
// reported, not added.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder } from '../../src/core/model.js';
import { importReport } from '../../src/core/report.js';
import { joinProfiles } from '../../src/importers/profile.js';

// Five WhatsApp chats from one phone: the owner in every chat, one group chat.
function chats() {
  const b = new DatasetBuilder({ name: 'chats' });
  const people = ['Me', 'Ann', 'Bo', 'Cy', 'Di', 'Ed'];
  for (let c = 0; c < 5; c++) {
    b.beginSource({ format: 'whatsapp', family: 'personal', medium: 'whatsapp', view: 'chat', context: 'personal', fileNames: [`chat${c}.txt`], egoKey: 'wa:me' });
    const ix = people.map(p => b.node(`wa:${p.toLowerCase()}`, { label: p }));
    const ctx = b.context(`c${c}`, { name: `chat ${c}` });
    const other = c === 4 ? [1, 2, 3] : [c + 1];
    for (const o of other) {
      b.event({ type: 'message', t: Date.UTC(2025, 0, 1 + c), actor: ix[0], targets: other.map(x => [ix[x], 'dm']), context: ctx, text: 'hi' });
      b.event({ type: 'message', t: Date.UTC(2025, 0, 2 + c), actor: ix[o], targets: [[ix[0], 'dm']], context: ctx, text: 'hey' });
    }
  }
  return b.build();
}

test('many personal chats: one person\'s slice, the owner bridges by construction, people counted once (C3)', () => {
  const r = importReport(chats());
  assert.match(r.notes.join(' '), /5 WhatsApp chats are personal exports: one person's slice\..*the owner is tied to everyone and bridges them by construction/);
  const g = r.groups.find(x => x.key === 'WhatsApp|chat');
  assert.ok(g);
  // Me, Ann, Bo, Cy, Di: five distinct people, though the chats list 2+2+2+2+4.
  assert.equal(g.people, 5);
  assert.equal(r.sources.reduce((a, s) => a + s.counts.nodes, 0), 12);
  assert.match(g.canShow.join(' '), /across these 5 chats/);
  assert.match(g.canShow.join(' '), /1 group chat/);
  assert.match(g.cannotShow.join(' '), /one person's slice\. Me is in every chat, so connects everyone by construction; betweenness, closeness, constraint and effective size describe the export, not the person/);
  assert.doesNotMatch([...g.canShow, ...g.cannotShow].join(' '), /this one conversation/);
});

test('bots in events are counted, so the Data view can say they are left out of the network (L16)', () => {
  const b = new DatasetBuilder({ name: 'bots' });
  b.beginSource({ format: 'slack', view: 'full' });
  const a = b.node('slack:a', { label: 'A' }), c = b.node('slack:b', { label: 'B' }), bot = b.node('slack:bot', { label: 'Deploybot', isBot: true });
  b.event({ type: 'message', t: 1, actor: a, targets: [[c, 'reply']] });
  b.event({ type: 'message', t: 2, actor: bot, targets: [[a, 'mention']] });
  const r = importReport(b.build());
  assert.equal(r.totals.nodesInEvents, 3);
  assert.equal(r.totals.botsInEvents, 1);
  assert.deepEqual(r.totals.botNames, ['Deploybot']);
});

test('a joined column with no value in any matched row is reported, not added (N18)', () => {
  const b = new DatasetBuilder({ name: 'hr' });
  b.beginSource({ format: 'slack', view: 'full' });
  b.node('slack:a', { label: 'Ann', attrs: { email: 'ann@x.org' } });
  b.node('slack:b', { label: 'Bo', attrs: { email: 'bo@x.org' } });
  const ds = b.build();
  const { dataset, report } = joinProfiles(ds, 'Work Email,Dept,Manager Name\nann@x.org,Design,\nbo@x.org,Sales,\n', { keyColumn: 'Work Email', matchOn: 'email' });
  assert.deepEqual(report.emptyColumns, ['Manager Name']);
  const j = dataset.meta.profileJoins[0];
  assert.deepEqual(j.columns, ['Dept']);
  assert.deepEqual(j.emptyColumns, ['Manager Name']);
  assert.ok(!dataset.attributeSchema.some(x => x.key === 'Manager Name'));
});

test('survey weight notes from the builders are informational', async () => {
  const { warningSeverity } = await import('../../src/core/report.js');
  assert.equal(warningSeverity({ code: 'roster-tie-weight' }), 'info');
  assert.equal(warningSeverity({ code: 'css-consensus-weight' }), 'info');
});

// Eric's copy pass (2026-10-04): what a full or single-conversation export
// supports is the structure of communication, not "who talks to whom".
test('full and single-conversation views describe the structure of communication', () => {
  for (const view of ['full', 'chat']) {
    const b = new DatasetBuilder({ name: view });
    b.beginSource({ format: 'slack', family: 'workplace', medium: 'chat', view, context: 'workplace', fileNames: ['x.json'] });
    const a = b.node('s:a', { label: 'A' }), c = b.node('s:c', { label: 'C' });
    b.event({ type: 'message', t: Date.UTC(2025, 0, 1), actor: a, targets: [[c, 'mention']], text: 'hi' });
    const src = importReport(b.build()).sources[0];
    const can = src.canShow.join(' ');
    assert.match(can, /structure of communication/);
    assert.doesNotMatch(can, /who talks to whom/i);
  }
});
