// Regression tests for importer fixes found by feeding generated native exports
// through the pipeline (test/integration/digestion.test.js). Inline synthetic inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import whatsapp from '../../src/importers/whatsapp.js';
import linkedin from '../../src/importers/linkedin.js';
import { VISIBILITY } from '../../src/core/model.js';
import { fsFromMemory, runImport, events } from './helpers.js';

test('whatsapp: in a group, an isolate-delimited @mention links a member who never wrote', async () => {
  const chat = [
    '[04/03/2025, 09:00:00] Hikers: ‎Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.',
    '[04/03/2025, 09:00:10] Hikers: ‎Ana Ruiz created group "Hikers"',
    '[04/03/2025, 09:01:00] Ana Ruiz: @⁨Chen Li⁩ are you coming?',
    '[04/03/2025, 09:02:00] Ben Okafor: yes',
  ].join('\n') + '\n';
  const { ds } = await runImport(whatsapp, await fsFromMemory({ 'WhatsApp Chat - Hikers/_chat.txt': chat }), { dateOrder: 'day-first' });
  const msg = events(ds).find(e => e.type === 'message' && e.actor === 'whatsapp:ana ruiz');
  assert.deepEqual(msg.targets, [['whatsapp:chen li', 'mention']]);
  assert.equal(VISIBILITY[ds.contexts.visibility[0]], 'group', 'group chat (create notice), even with two speakers');
});

test('whatsapp: in a 1:1 chat a mention of a third person stays unlinked (it would become a recipient)', async () => {
  const chat = [
    '[04/03/2025, 09:01:00] Ana Ruiz: ask @⁨Chen Li⁩ maybe',
    '[04/03/2025, 09:02:00] Ben Okafor: ok',
  ].join('\n') + '\n';
  const { ds } = await runImport(whatsapp, await fsFromMemory({ 'WhatsApp Chat - Ana Ruiz/_chat.txt': chat }), { dateOrder: 'day-first' });
  assert.ok(!ds.nodes.keys.includes('whatsapp:chen li'));
  const msg = events(ds).find(e => e.actor === 'whatsapp:ana ruiz');
  assert.deepEqual(msg.targets, [['whatsapp:ben okafor', 'dm']]);
});

test('linkedin: one conversation in which only the other person wrote still identifies the owner by elimination', async () => {
  const fs = await fsFromMemory({
    'Profile.csv': 'First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers\nAna,Ruiz,,,,Engineer,,Software,,Madrid,,,\n',
    'messages.csv': 'CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER,ATTACHMENTS,IS MESSAGE DRAFT,IS CONVERSATION DRAFT\n'
      + '2-abc,,Ben Okafor,https://www.linkedin.com/in/ben-okafor,Ana Ruiz,https://www.linkedin.com/in/ana-ruiz-1a2b3c,2025-03-04 10:00:00 UTC,,hello,INBOX,,No,No\n',
    'Connections.csv': 'First Name,Last Name,URL,Email Address,Company,Position,Connected On\nBen,Okafor,https://www.linkedin.com/in/ben-okafor,,Acme,Engineer,04 Mar 2025\n',
  });
  const { ds } = await runImport(linkedin, fs);
  assert.equal(ds.meta.sources[0].egoKey, 'linkedin:ana-ruiz-1a2b3c');
  assert.ok(!ds.nodes.keys.includes('linkedin:me'));
  const conn = events(ds).find(e => e.type === 'declared');
  assert.equal(conn.actor, 'linkedin:ana-ruiz-1a2b3c');
});
