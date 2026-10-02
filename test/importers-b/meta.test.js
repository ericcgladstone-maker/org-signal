import { test } from 'node:test';
import assert from 'node:assert/strict';
import meta from '../../src/importers/meta.js';
import { fsFromFixtures, fsFromMemory, runImport, events, node, context, source, warningCodes, countBy } from './helpers.js';

const ANA = 'messenger:ana kovač', JOR = 'messenger:jordan pike', SAM = 'messenger:sam rivera';

test('meta: detection of standard, E2EE and HTML exports', async () => {
  assert.ok((await meta.detect(await fsFromFixtures('meta/fb2024'))).score >= 0.9);
  assert.ok((await meta.detect(await fsFromFixtures('meta/ig2025'))).score >= 0.9);
  assert.ok((await meta.detect(await fsFromFixtures('meta/e2ee'))).score >= 0.9);
  assert.ok((await meta.detect(await fsFromFixtures('meta/old/messages'))).score >= 0.9);
  const html = await fsFromMemory({ 'messages/inbox/a_1/message_1.html': '<html></html>', 'messages/x.txt': 'x' });
  assert.equal((await meta.detect(html)).score, 0.6);
  await assert.rejects(runImport(meta, html), /HTML format.*JSON/);
  assert.equal((await meta.detect(await fsFromMemory({ 'foo_1.json': '{"a": 1}' }))).score, 0);
});

test('meta: Facebook 2024 layout, mojibake fixed, multi-file thread merged and sorted ascending', async () => {
  const { ds } = await runImport(meta, await fsFromFixtures('meta/fb2024'));
  const src = source(ds);
  assert.equal(src.medium, 'messenger');
  assert.equal(src.view, 'ego');
  assert.equal(src.egoKey, ANA);
  assert.equal(src.tz, 'UTC');
  assert.equal(node(ds, ANA).label, 'Ana Kovač');
  const evs = events(ds);
  assert.deepEqual(countBy(evs, e => e.type), { message: 6, copresence: 1, reaction: 1, join: 1, leave: 1 });

  const dm = evs.filter(e => e.context === 'messenger:dm:jordanpike_ABC123');
  assert.deepEqual(dm.map(e => [e.type, e.actor, e.t, e.targets, e.text]), [
    ['message', ANA, 1717299000000, [[JOR, 'dm']], 'Zdravo, čau \u{1F44D}'],
    ['message', JOR, 1717300000000, [[ANA, 'dm']], 'https://example.com/article'],
    ['copresence', JOR, 1717320000000, [[ANA, 'attendee']], null],
    ['message', ANA, 1717321300000, [[JOR, 'dm']], null],
    ['message', JOR, 1717321402123, [[ANA, 'dm']], 'See you at 3'],
    ['reaction', ANA, NaN, [[JOR, 'subject']], '\u2764'],
  ]);
  assert.equal(dm[5].parent, dm[4].i);
  assert.equal(context(ds, 'messenger:dm:jordanpike_ABC123').visibility, 'direct');
  assert.equal(src.counts['missed-calls'], 1);

  // Group detected from observed senders although Sam left participants.
  const g = context(ds, 'messenger:group_dm:fieldops_XYZ');
  assert.equal(g.visibility, 'group');
  assert.equal(g.name, 'Field Ops crew');
  assert.equal(g.members.length, 3);
  const ge = evs.filter(e => e.context === 'messenger:group_dm:fieldops_XYZ');
  assert.deepEqual(ge.map(e => [e.type, e.actor, e.targets, e.t]), [
    ['join', SAM, [[ANA, 'subject']], 1717000000000],
    ['message', JOR, [], 1717100000000],
    ['leave', SAM, [], 1717200000000],
  ]);
  // archived threads included; message requests skipped by default
  assert.ok(context(ds, 'messenger:dm:samrivera_9'));
  assert.equal(context(ds, 'messenger:dm:stranger_5'), null);
  const w = warningCodes(ds);
  for (const c of ['identity-by-name', 'requests-excluded', 'e2ee-missing', 'undated-reactions']) assert.ok(w.includes(c), c);
  assert.ok(!w.includes('platform-ambiguous'));
});

test('meta: includeRequests option imports message requests', async () => {
  const { ds } = await runImport(meta, await fsFromFixtures('meta/fb2024'), { includeRequests: true });
  assert.ok(context(ds, 'messenger:dm:stranger_5'));
});

test('meta: standard + E2EE backup together dedupe the overlap', async () => {
  const { ds } = await runImport(meta, await fsFromFixtures('meta/fb2024', 'meta/e2ee'));
  assert.equal(ds.meta.sources.length, 1);
  const src = source(ds);
  assert.equal(src.counts['duplicates-removed'], 1);
  assert.ok(!warningCodes(ds).includes('e2ee-missing'));
  const ee = events(ds).filter(e => e.context === 'messenger:dm:Jordan Pike_1');
  assert.deepEqual(ee.map(e => [e.type, e.actor, e.t, e.targets, e.text]), [
    ['message', JOR, 1717450000000, [[ANA, 'dm']], null],
    ['reaction', ANA, NaN, [[JOR, 'subject']], '\u{1F44D}'],
    ['message', ANA, 1717500000000, [[JOR, 'dm']], 'new e2ee msg'],
  ]);
});

test('meta: Instagram 2025 layout, reaction notices skipped, deactivated users kept apart', async () => {
  const { ds } = await runImport(meta, await fsFromFixtures('meta/ig2025'));
  const src = source(ds);
  assert.equal(src.medium, 'instagram');
  assert.equal(src.egoKey, 'instagram:ana kovač');
  const evs = events(ds);
  const ordered = [...evs.filter(e => e.context === 'instagram:dm:otterlab_17841'), ...evs.filter(e => e.context === 'instagram:dm:instagramuser_2')];
  assert.equal(ordered.length, evs.length);
  assert.deepEqual(ordered.map(e => [e.type, e.actor, e.targets, e.text]), [
    ['message', 'instagram:otter lab', [['instagram:ana kovač', 'dm']], null],
    ['message', 'instagram:ana kovač', [['instagram:otter lab', 'dm']], 'nice'],
    ['reaction', 'instagram:otter lab', [['instagram:ana kovač', 'subject']], '\u2764'],
    ['message', 'instagram:deactivated:instagramuser_2', [['instagram:ana kovač', 'dm']], 'who'],
  ]);
  assert.equal(src.counts['reaction-notices-skipped'], 1);
  assert.equal(src.counts.unsent, 1);
  assert.ok(warningCodes(ds).includes('deactivated-users'));
});

test('meta: Facebook and Instagram in one drop become two sources', async () => {
  const { ds } = await runImport(meta, await fsFromFixtures('meta/fb2024', 'meta/ig2025'));
  assert.deepEqual(ds.meta.sources.map(s => s.medium), ['messenger', 'instagram']);
});

test('meta: old bare layout is ambiguous; ego only from option; platform option', async () => {
  const fs = await fsFromFixtures('meta/old/messages');
  const a = await runImport(meta, fs);
  assert.equal(source(a.ds).egoKey, null);
  const w = warningCodes(a.ds);
  assert.ok(w.includes('ego-unknown'));
  assert.ok(w.includes('platform-ambiguous'));
  // genuine Latin-1 written through Meta's encoding comes back intact
  assert.equal(events(a.ds)[0].text, 'café?');
  // Without an ego a 1:1 thread still has a dm partner (the other participant).
  assert.deepEqual(events(a.ds)[0].targets, [['messenger:jane doe', 'dm']]);

  const b = await runImport(meta, fs, { egoName: 'Ana Kovač', platform: 'instagram' });
  assert.equal(source(b.ds).egoKey, 'instagram:ana kovač');
  assert.equal(source(b.ds).medium, 'instagram');
  assert.ok(!warningCodes(b.ds).includes('platform-ambiguous'));
  assert.deepEqual(events(b.ds).map(e => e.t), [1499999999000, 1500000000000]);
});
