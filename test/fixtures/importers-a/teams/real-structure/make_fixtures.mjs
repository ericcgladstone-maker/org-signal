// Writes the Microsoft Teams real-structure fixtures (see README.md next to
// this file). Every value is fictional; the structure follows Microsoft Graph
// v1.0 example responses, the output layouts of open-source exporters, the
// Teams Free / Skype export schema and the Purview items report fields.
//
//   node test/fixtures/importers-a/teams/real-structure/make_fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const write = (rel, data) => {
  const p = path.join(HERE, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof data === 'string' || data instanceof Uint8Array ? data : JSON.stringify(data, null, 4) + '\n');
};

const G = 'https://graph.microsoft.com/v1.0';
const TENANT = 'f0e1d2c3-b4a5-4697-8899-aabbccddeeff';
const OTHER_TENANT = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const P = {
  ana: { id: '3c9f1a2e-5b7d-4e8a-9c1f-2d3e4f5a6b7c', name: 'Ana Ruiz', email: 'ana.ruiz@contoso.example' },
  ben: { id: '7d2e4f6a-8b1c-4d3e-a5f7-9b0c1d2e3f4a', name: 'Ben Okafor', email: 'ben.okafor@contoso.example' },
  chen: { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', name: 'Chen Li', email: 'chen.li@contoso.example' },
  dana: { id: 'e9f8a7b6-c5d4-4e3f-a2b1-c0d9e8f7a6b5', name: 'Dana Park', email: 'dana.park@fabrikam.example', tenant: OTHER_TENANT, type: 'federatedUser' },
};
const GUEST = { id: '5f4e3d2c1b0a99887766554433221100', name: 'Alex (Guest)', type: 'anonymousGuest' };
const BOT = { id: '28b7c6d5-e4f3-4a2b-9c1d-0e9f8a7b6c5d', name: 'Workflows', type: 'bot' };

// identitySet as Graph returns it. `odata` adds the newer @odata.type/tenantId fields.
const ident = (p, { odata = false, name = true } = {}) => ({
  application: null, device: null,
  user: { ...(odata ? { '@odata.type': '#microsoft.graph.teamworkUserIdentity' } : {}), id: p.id, displayName: name ? p.name : null, userIdentityType: p.type || 'aadUser', ...(odata ? { tenantId: p.tenant || TENANT } : {}) },
});
const appIdent = a => ({ application: { '@odata.type': '#microsoft.graph.teamworkApplicationIdentity', id: a.id, displayName: a.name, applicationIdentityType: a.type }, device: null, user: null });

const GROUP = '19:5a1c9e7b3d2f4a6c8e0b1d3f5a7c9e1b@thread.v2';
const ONE = `19:${P.ana.id}_${P.ben.id}@unq.gbl.spaces`;
const MEET = '19:meeting_ZmljdGlvbmFsLW1lZXRpbmctMDAwMS1hYmNkZWY0NTY3ODk@thread.v2';
const TEAM = 'c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f';
const GENERAL = '19:0f1e2d3c4b5a69788796a5b4c3d2e1f0@thread.tacv2';
const LEADS = '19:9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b@thread.tacv2';
const enc = s => encodeURIComponent(s).replace(/%3A/gi, '%3A').replace(/%40/gi, '%40');

// chatMessage with every v1.0 key present, as list responses return them.
function msg(o) {
  const t = o.t;
  return {
    id: o.id, replyToId: o.replyToId ?? null, etag: o.etag ?? o.id, messageType: o.type ?? 'message',
    createdDateTime: t, lastModifiedDateTime: o.modified ?? t, lastEditedDateTime: o.edited ?? null, deletedDateTime: o.deleted ?? null,
    subject: o.subject ?? null, summary: null, chatId: o.chatId ?? null, importance: 'normal', locale: 'en-us', webUrl: o.webUrl ?? null,
    channelIdentity: o.channel ? { teamId: TEAM, channelId: o.channel } : null, policyViolation: null, eventDetail: o.eventDetail ?? null,
    from: o.from === undefined ? null : o.from,
    body: o.body ?? { contentType: 'text', content: '' },
    attachments: o.attachments ?? [], mentions: o.mentions ?? [], reactions: o.reactions ?? [], messageHistory: o.history ?? [],
  };
}
const mentionUser = (id, p) => ({ id, mentionText: p.name, mentioned: { application: null, device: null, conversation: null, tag: null, user: { '@odata.type': '#microsoft.graph.teamworkUserIdentity', id: p.id, displayName: p.name, userIdentityType: p.type || 'aadUser', tenantId: p.tenant || TENANT } } });
const mentionConv = (id, text, convId, kind) => ({ id, mentionText: text, mentioned: { application: null, device: null, user: null, tag: null, conversation: { id: convId, displayName: text, conversationIdentityType: kind } } });
const reaction = (type, name, t, p) => ({ reactionType: type, displayName: name, reactionContentUrl: null, createdDateTime: t, user: { application: null, device: null, user: { '@odata.type': '#microsoft.graph.teamworkUserIdentity', id: p.id, displayName: null, userIdentityType: 'aadUser' } } });
const member = (p, chatId, roles = ['owner'], hist = '0001-01-01T00:00:00Z') => ({
  '@odata.type': '#microsoft.graph.aadUserConversationMember',
  id: Buffer.from(`0#${TENANT}#${chatId}#${p.id}`).toString('base64'),
  roles, displayName: p.name, visibleHistoryStartDateTime: hist, userId: p.id, email: p.email, tenantId: p.tenant || TENANT,
});

// ============ A. delegated dump: /me/chats?$expand=members + /chats/{id}/messages pages ============
{
  const D = 'graph-me/';
  write(D + 'chats.json', {
    '@odata.context': `${G}/$metadata#chats(members())`,
    '@odata.count': 3,
    value: [
      { id: GROUP, topic: 'Launch crew', createdDateTime: '2024-03-02T09:00:00.120Z', lastUpdatedDateTime: '2024-03-04T16:02:11.48Z', chatType: 'group', webUrl: `https://teams.microsoft.com/l/chat/${enc(GROUP)}/0?tenantId=${TENANT}`, tenantId: TENANT, onlineMeetingInfo: null, viewpoint: { isHidden: false, lastMessageReadDateTime: '2024-03-04T16:02:11.48Z' }, isHiddenForAllMembers: false,
        members: [member(P.ana, GROUP), member(P.ben, GROUP), member(P.chen, GROUP), member(P.dana, GROUP, ['guest'], '2024-03-03T10:00:00Z')] },
      { id: ONE, topic: null, createdDateTime: '2024-02-11T08:00:00Z', lastUpdatedDateTime: '2024-03-05T12:00:00.3Z', chatType: 'oneOnOne', webUrl: `https://teams.microsoft.com/l/chat/${enc(ONE)}/0?tenantId=${TENANT}`, tenantId: TENANT, onlineMeetingInfo: null, viewpoint: { isHidden: false, lastMessageReadDateTime: '0001-01-01T00:00:00Z' }, isHiddenForAllMembers: false,
        members: [member(P.ana, ONE), member(P.ben, ONE)] },
      { id: MEET, topic: 'Weekly sync', createdDateTime: '2024-03-06T13:55:00Z', lastUpdatedDateTime: '2024-03-06T15:01:00Z', chatType: 'meeting', webUrl: `https://teams.microsoft.com/l/chat/${enc(MEET)}/0?tenantId=${TENANT}`, tenantId: TENANT,
        onlineMeetingInfo: { calendarEventId: 'AAMkAGZpY3Rpb25hbA=', joinWebUrl: 'https://teams.microsoft.com/l/meetup-join/fictional', organizer: { id: P.ana.id, displayName: null, userIdentityType: 'aadUser' } }, viewpoint: { isHidden: false, lastMessageReadDateTime: '2024-03-06T15:01:00Z' }, isHiddenForAllMembers: false,
        members: [member(P.ana, MEET), member(P.ben, MEET), member(P.chen, MEET)] },
    ],
  });

  // Group chat: two pages, newest first (default order is lastModifiedDateTime desc).
  const page1 = {
    '@odata.context': `${G}/$metadata#chats('${enc(GROUP)}')/messages`,
    '@odata.count': 4,
    '@odata.nextLink': `${G}/chats/${GROUP}/messages?$top=4&$skiptoken=ZmljdGlvbmFsLXNraXB0b2tlbg%3d%3d`,
    value: [
      // Deleted: deletedDateTime set, body emptied.
      msg({ id: '1709568000000', t: '2024-03-04T16:00:00Z', modified: '2024-03-04T16:02:11.48Z', deleted: '2024-03-04T16:02:11.48Z', chatId: GROUP, from: ident(P.chen), body: { contentType: 'text', content: '' } }),
      // Reply with quote: messageReference attachment whose content is a JSON string.
      msg({ id: '1709560800000', t: '2024-03-04T14:00:00Z', chatId: GROUP, from: ident(P.ben, { odata: true }),
        body: { contentType: 'html', content: '<p></p>\n<attachment id="1709551234567"></attachment>\n<p>Agreed, shipping Friday.</p>\n<p></p>' },
        attachments: [{ id: '1709551234567', contentType: 'messageReference', contentUrl: null, content: JSON.stringify({ messageId: '1709551234567', messagePreview: 'Thanks Ben Okafor, merging now', messageSender: { application: null, device: null, user: { userIdentityType: 'aadUser', tenantId: TENANT, id: P.ana.id, displayName: P.ana.name } } }), name: null, thumbnailUrl: null, teamsAppId: null }] }),
      // Dana (external, federated) writes after being added.
      msg({ id: '1709557200000', t: '2024-03-04T13:00:00Z', chatId: GROUP, from: ident(P.dana, { odata: true }), body: { contentType: 'html', content: '<p>Hi all &#8212; glad to help&nbsp;from Fabrikam.</p>' } }),
      // membersAdded system event, as returned with Prefer: include-unknown-enum-members.
      msg({ id: '1709553600000', t: '2024-03-04T12:00:00Z', type: 'systemEventMessage', chatId: GROUP, from: null, body: { contentType: 'html', content: '<systemEventMessage/>' },
        eventDetail: { '@odata.type': '#microsoft.graph.membersAddedEventMessageDetail', visibleHistoryStartDateTime: '2024-03-03T10:00:00Z', members: [{ id: P.dana.id, displayName: null, userIdentityType: 'federatedUser', tenantId: OTHER_TENANT }], initiator: ident(P.ana, { name: false }) } }),
    ],
  };
  const page2 = {
    '@odata.context': `${G}/$metadata#chats('${enc(GROUP)}')/messages`,
    value: [
      // Edited html message with a person mention, an "everyone" (chat) mention,
      // an emoji tag, a file and two reactions (Unicode and legacy).
      msg({ id: '1709551234567', t: '2024-03-04T11:20:34.567Z', modified: '2024-03-04T11:25:02.1Z', edited: '2024-03-04T11:21:00.9Z', etag: '1709551502100', chatId: GROUP, from: ident(P.ana, { odata: true }),
        body: { contentType: 'html', content: '<div><div>Thanks <at id="0">Ben Okafor</at>, merging now &amp; <at id="1">Launch crew</at> please review <emoji id="1f440_eyes" alt="👀" title="Eyes"></emoji></div><attachment id="9F1C2B3A-4D5E-4F60-8A7B-1C2D3E4F5A6B"></attachment></div>' },
        mentions: [mentionUser(0, P.ben), mentionConv(1, 'Launch crew', GROUP, 'chat')],
        attachments: [{ id: '9F1C2B3A-4D5E-4F60-8A7B-1C2D3E4F5A6B', contentType: 'reference', contentUrl: 'https://contoso.sharepoint.com/sites/launch/Shared%20Documents/plan.docx', content: null, name: 'plan.docx', thumbnailUrl: null, teamsAppId: null }],
        reactions: [reaction('💯', 'Hundred points', '2024-03-04T11:25:02.1Z', P.ben), reaction('like', 'Like', '2024-03-04T11:24:00Z', P.chen)],
        history: [{ modifiedDateTime: '2024-03-04T11:25:02.1Z', actions: 'reactionAdded', reaction: reaction('💯', 'Hundred points', '2024-03-04T11:25:02.1Z', P.ben) }] }),
      // A Power Automate bot posts an adaptive card.
      msg({ id: '1709550000000', t: '2024-03-04T11:00:00Z', chatId: GROUP, from: appIdent(BOT), body: { contentType: 'html', content: '<attachment id="b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5"></attachment>' },
        attachments: [{ id: 'b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5', contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: JSON.stringify({ type: 'AdaptiveCard', body: [{ type: 'TextBlock', text: 'Build 412 passed' }], version: '1.4' }), name: null, thumbnailUrl: null, teamsAppId: 'c3a1996d-db0f-4857-a6ea-7aabf0266b00' }] }),
      msg({ id: '1709546400000', t: '2024-03-04T10:00:00Z', chatId: GROUP, from: ident(P.chen), body: { contentType: 'text', content: 'Morning! Starting the release checklist.' } }),
      // chatRenamed as returned without the Prefer header: messageType unknownFutureValue.
      msg({ id: '1709370000000', t: '2024-03-02T09:00:00Z', type: 'unknownFutureValue', chatId: GROUP, from: null, body: { contentType: 'html', content: '<systemEventMessage/>' },
        eventDetail: { '@odata.type': '#microsoft.graph.chatRenamedEventMessageDetail', chatId: GROUP, chatDisplayName: 'Launch crew', initiator: ident(P.ana, { name: false }) } }),
    ],
  };
  write(D + `messages/${GROUP.replace(/[:@]/g, '_')}.json`, [page1, page2]);

  // 1:1 chat: one page, including a forwarded message.
  write(D + `messages/${ONE.replace(/[:@]/g, '_')}.json`, {
    '@odata.context': `${G}/$metadata#chats('${enc(ONE)}')/messages`,
    '@odata.count': 2,
    value: [
      msg({ id: '1709640000000', t: '2024-03-05T12:00:00Z', chatId: ONE, from: ident(P.ben), body: { contentType: 'html', content: '<p>Sure, 2pm.</p>' } }),
      msg({ id: '1709636400000', t: '2024-03-05T11:00:00.3Z', chatId: ONE, from: ident(P.ana), body: { contentType: 'html', content: '<p>Can we talk about the launch? See below.</p><attachment id="1709635000000"></attachment>' },
        attachments: [{ id: '1709635000000', contentType: 'forwardedMessageReference', contentUrl: null, content: JSON.stringify({ originalMessageId: '1709546400000', originalMessageContent: '\n<p>Morning! Starting the release checklist.</p>\n', originalConversationId: GROUP, originalSentDateTime: '2024-03-04T10:00:00+00:00', originalMessageSender: { application: null, device: null, user: { userIdentityType: 'aadUser', id: P.chen.id, displayName: P.chen.name } } }), name: null, thumbnailUrl: null, teamsAppId: null }] }),
    ],
  });

  // Meeting chat as a delta page: call events, a guest, then a message.
  write(D + `messages/${MEET.replace(/[:@]/g, '_')}.json`, {
    '@odata.context': `${G}/$metadata#Collection(microsoft.graph.chatMessage)`,
    '@odata.deltaLink': `${G}/chats/${MEET}/messages/delta?$deltatoken=ZmljdGlvbmFsLWRlbHRh`,
    value: [
      msg({ id: '1709733300000', t: '2024-03-06T13:55:00Z', type: 'systemEventMessage', chatId: MEET, from: null, body: { contentType: 'html', content: '<systemEventMessage/>' },
        eventDetail: { '@odata.type': '#microsoft.graph.callStartedEventMessageDetail', callId: 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b', callEventType: 'meeting', initiator: ident(P.ana, { name: false }) } }),
      msg({ id: '1709733600000', t: '2024-03-06T14:00:00Z', chatId: MEET, from: { application: null, device: null, user: { id: GUEST.id, displayName: GUEST.name, userIdentityType: GUEST.type } }, body: { contentType: 'text', content: 'Hello from the lobby' } }),
      msg({ id: '1709733900000', t: '2024-03-06T14:05:00Z', chatId: MEET, from: ident(P.ben), body: { contentType: 'html', content: '<p>Notes: <a href="https://contoso.sharepoint.com/notes">here</a></p>' } }),
      msg({ id: '1709737260000', t: '2024-03-06T15:01:00Z', type: 'systemEventMessage', chatId: MEET, from: null, body: { contentType: 'html', content: '<systemEventMessage/>' },
        eventDetail: { '@odata.type': '#microsoft.graph.callEndedEventMessageDetail', callId: 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b', callDuration: 'PT1H6M', callEventType: 'meeting',
          callParticipants: [{ participant: ident(P.ana, { name: false }) }, { participant: ident(P.ben, { name: false }) }, { participant: { application: null, device: null, user: { id: GUEST.id, displayName: GUEST.name, userIdentityType: GUEST.type } } }], initiator: ident(P.ana, { name: false }) } }),
    ],
  });
}

// ============ B. channel messages with $expand=replies, plus a /replies page ============
{
  const D = 'graph-channel/';
  // channel-list example has no @odata.context.
  write(D + 'channels.json', { value: [
    { id: GENERAL, createdDateTime: '2025-11-01T08:00:00.51Z', displayName: 'General', description: 'Team-wide', membershipType: 'standard', layoutType: 'post', isArchived: false, email: '', webUrl: `https://teams.microsoft.com/l/channel/${enc(GENERAL)}/General?groupId=${TEAM}&tenantId=${TENANT}` },
    { id: LEADS, createdDateTime: '2025-11-02T08:00:00Z', displayName: 'Leads', description: null, membershipType: 'private', layoutType: 'post', isArchived: false, email: '', webUrl: `https://teams.microsoft.com/l/channel/${enc(LEADS)}/Leads?groupId=${TEAM}&tenantId=${TENANT}` },
  ] });
  const web = (ch, id, root) => `https://teams.microsoft.com/l/message/${enc(ch)}/${id}?groupId=${TEAM}&tenantId=${TENANT}&createdTime=${id}&parentMessageId=${root}`;
  const cm = (o) => msg({ ...o, webUrl: web(o.channel, o.id, o.replyToId || o.id) });
  const r1 = cm({ id: '1709800000000', t: '2024-03-07T08:26:40Z', channel: GENERAL, subject: '', from: ident(P.ana), body: { contentType: 'html', content: '<div><at id="0">General</at> release notes are up.</div>' }, mentions: [mentionConv(0, 'General', GENERAL, 'channel')] });
  r1['replies@odata.count'] = 2;
  r1.replies = [
    cm({ id: '1709800100000', replyToId: '1709800000000', t: '2024-03-07T08:28:20Z', channel: GENERAL, from: ident(P.ben), body: { contentType: 'text', content: 'Thanks!' }, reactions: [reaction('heart', 'Heart', '2024-03-07T08:30:00Z', P.ana)] }),
    cm({ id: '1709800200000', replyToId: '1709800000000', t: '2024-03-07T08:30:00Z', channel: GENERAL, from: ident(P.chen), body: { contentType: 'html', content: '<p><at id="0">Ana Ruiz</at> one typo in section 2</p>' }, mentions: [mentionUser(0, P.ana)] }),
  ];
  const r2 = cm({ id: '1709810000000', t: '2024-03-07T11:13:20Z', channel: GENERAL, subject: 'Offsite', from: ident(P.ben), body: { contentType: 'html', content: '<p><at id="0">Contoso Launch</at> offsite is booked.</p>' }, mentions: [mentionConv(0, 'Contoso Launch', TEAM, 'team')] });
  r2['replies@odata.count'] = 0; r2.replies = [];
  const r3 = cm({ id: '1709820000000', t: '2024-03-07T14:00:00Z', type: 'systemEventMessage', channel: GENERAL, from: null, body: { contentType: 'html', content: '<systemEventMessage/>' },
    eventDetail: { '@odata.type': '#microsoft.graph.channelDescriptionUpdatedEventMessageDetail', channelId: GENERAL, channelDescription: 'Team-wide', initiator: ident(P.ana, { name: false }) } });
  r3['replies@odata.count'] = 0; r3.replies = [];
  write(D + 'general-messages.json', {
    '@odata.context': `${G}/$metadata#teams('${TEAM}')/channels('${enc(GENERAL)}')/messages(replies())`,
    '@odata.count': 3,
    value: [r1, r2, r3],
  });
  // Private channel: root list without $expand, and the root's /replies page in its own file.
  write(D + 'leads-messages.json', {
    '@odata.context': `${G}/$metadata#teams('${TEAM}')/channels('${enc(LEADS)}')/messages`,
    value: [cm({ id: '1709900000000', t: '2024-03-08T12:26:40Z', channel: LEADS, subject: 'Hiring', from: ident(P.chen), body: { contentType: 'text', content: 'Two offers out.' } })],
  });
  write(D + 'leads-replies-1709900000000.json', {
    '@odata.context': `${G}/$metadata#teams('${TEAM}')/channels('${enc(LEADS)}')/messages('1709900000000')/replies`,
    '@odata.count': 1,
    value: [cm({ id: '1709900300000', replyToId: '1709900000000', t: '2024-03-08T12:31:40Z', channel: LEADS, from: ident(P.ana), body: { contentType: 'text', content: 'Great news' } })],
  });
}

// ============ C. Export API: /users/{id}/chats/getAllMessages, one file per custodian ============
{
  const D = 'graph-getall/';
  const ONE2 = `19:${P.ben.id}_${P.chen.id}@unq.gbl.spaces`;
  const typed = m => ({ '@odata.type': '#microsoft.graph.chatMessage', ...m });
  const shared = [
    typed(msg({ id: '1710000000000', t: '2024-03-09T16:00:00Z', chatId: ONE, from: ident(P.ana), body: { contentType: 'text', content: 'Draft is ready' } })),
    typed(msg({ id: '1710000060000', t: '2024-03-09T16:01:00Z', chatId: ONE, from: ident(P.ben), body: { contentType: 'text', content: 'Reading now' } })),
  ];
  write(D + `users_${P.ana.id}_chats_getAllMessages.json`, {
    '@odata.context': `${G}/$metadata#Collection(chatMessage)`,
    '@odata.count': 2,
    value: shared,
  });
  write(D + `users_${P.ben.id}_chats_getAllMessages.json`, {
    '@odata.context': `${G}/$metadata#Collection(chatMessage)`,
    '@odata.nextLink': `${G}/users/${P.ben.id}/chats/getAllMessages?$top=250&$skiptoken=ZmljdGlvbmFs`,
    '@odata.count': 3,
    value: [...shared, typed(msg({ id: '1710003600000', t: '2024-03-09T17:00:00Z', chatId: ONE2, from: ident(P.chen), body: { contentType: 'text', content: 'Lunch?' } }))],
  });
}

// ============ D. A trimmed page as in a public exporter sample: only id, createdDateTime, from, body ============
write('graph-minimal/sample_teams_messages.json', {
  '@odata.context': `${G}/$metadata#chats('${enc(MEET)}')/messages`,
  value: [
    { id: '1709733900000', createdDateTime: '2024-03-06T14:05:00Z', from: { user: { id: P.ben.id, displayName: P.ben.name } }, body: { contentType: 'html', content: '<p>Hello team, just checking in!</p>' } },
    { id: '1709734500000', createdDateTime: '2024-03-06T14:15:00Z', from: { user: { id: P.ana.id, displayName: P.ana.name } }, body: { contentType: 'html', content: '<p>Meeting at 3 PM today.</p>' } },
  ],
});

// ============ E. One file per message (teams-chats-export layout) ============
{
  const D = 'graph-per-message/archive/';
  const safe = GROUP.replace(/[:@]/g, '_');
  const chat = { id: GROUP, topic: 'Launch crew', createdDateTime: '2024-03-02T09:00:00.120Z', lastUpdatedDateTime: '2024-03-04T11:20:34.567Z', chatType: 'group', webUrl: null, tenantId: TENANT, onlineMeetingInfo: null, viewpoint: { isHidden: false, lastMessageReadDateTime: '2024-03-04T11:20:34.567Z' }, isHiddenForAllMembers: false,
    members: [member(P.ana, GROUP), member(P.ben, GROUP), member(P.chen, GROUP)],
    lastMessagePreview: { id: '1709551234567', createdDateTime: '2024-03-04T11:20:34.567Z', isDeleted: false, messageType: 'message', eventDetail: null, body: { contentType: 'text', content: 'Thanks Ben' }, from: ident(P.ana) } };
  write(D + `data/${safe}.json`, chat);
  const list = [
    msg({ id: '1709546400000', t: '2024-03-04T10:00:00Z', chatId: GROUP, from: ident(P.chen), body: { contentType: 'text', content: 'Morning!' } }),
    msg({ id: '1709550000000', t: '2024-03-04T11:00:00Z', chatId: GROUP, from: ident(P.ben), body: { contentType: 'html', content: '<p><img src="https://graph.microsoft.com/v1.0/chats/' + GROUP + '/messages/1709550000000/hostedContents/aWQ9ZmljdGlvbmFs/$value"></p>' } }),
    msg({ id: '1709551234567', t: '2024-03-04T11:20:34.567Z', chatId: GROUP, from: ident(P.ana), body: { contentType: 'text', content: 'Thanks Ben' } }),
  ];
  for (const m of list) write(D + `data/${safe}/msg_${m.id}.json`, m);
  write(D + `data/${safe}/aWQ9ZmljdGlvbmFs.png`, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  write(D + `html/${safe}.html`, '<html><body><h1>Launch crew</h1></body></html>\n');
}

// ============ F. Microsoft Graph PowerShell (Get-MgBetaChat / Get-MgBetaChatMessage | ConvertTo-Json -Depth 100) ============
// PowerShell 7 serialisation of the SDK's objects: PascalCase properties,
// derived-type fields in AdditionalProperties, enum-like values as strings, UTC
// dates as ISO 'Z'. (Windows PowerShell 5.1 writes UTF-16 and "/Date(ms)/";
// covered by an in-memory test.) Shape inferred from the SDK, not from a real dump.
{
  const iso = s => s;
  const psUser = p => ({ Application: null, Device: null, User: { DisplayName: p.name, Id: p.id, UserIdentityType: 'aadUser', AdditionalProperties: { tenantId: TENANT } }, AdditionalProperties: {} });
  const psMsg = (id, t, chatId, p, html) => ({
    Attachments: [], Body: { Content: html, ContentType: 'html', AdditionalProperties: {} }, ChannelIdentity: null, ChatId: chatId,
    CreatedDateTime: iso(t), DeletedDateTime: null, Etag: id, EventDetail: { AdditionalProperties: {} }, From: psUser(p), HostedContents: null, Id: id,
    Importance: 'normal', LastEditedDateTime: null, LastModifiedDateTime: iso(t), Locale: 'en-us', Mentions: [], MessageHistory: [], MessageType: 'message',
    OnBehalfOf: null, PolicyViolation: null, Reactions: [], Replies: null, ReplyToId: null, Subject: null, Summary: null, WebUrl: null, AdditionalProperties: {},
  });
  const chats = [{ ChatType: 'group', CreatedDateTime: '2024-03-02T09:00:00.12Z', Id: GROUP, InstalledApps: null, LastMessagePreview: null, LastUpdatedDateTime: '2024-03-04T11:20:34.567Z',
    Members: [P.ana, P.ben, P.chen].map(p => ({ DisplayName: p.name, Id: Buffer.from(p.id).toString('base64'), Roles: ['owner'], VisibleHistoryStartDateTime: '0001-01-01T00:00:00Z', AdditionalProperties: { '@odata.type': '#microsoft.graph.aadUserConversationMember', userId: p.id, email: p.email, tenantId: TENANT } })),
    Messages: null, OnlineMeetingInfo: null, Topic: 'Launch crew', Viewpoint: { IsHidden: false, LastMessageReadDateTime: '2024-03-04T11:20:34.567Z', AdditionalProperties: {} }, WebUrl: null, AdditionalProperties: {} }];
  const sysEvent = { ...psMsg('1709370000000', '2024-03-02T09:00:00Z', GROUP, P.ana, '<systemEventMessage/>'), From: null, MessageType: 'systemEventMessage', EventDetail: { AdditionalProperties: { '@odata.type': '#microsoft.graph.chatRenamedEventMessageDetail', chatDisplayName: 'Launch crew' } } };
  const messages = [
    psMsg('1709551234567', '2024-03-04T11:20:34.567Z', GROUP, P.ana, '<p>Thanks <at id="0">Ben Okafor</at></p>'),
    psMsg('1709550000000', '2024-03-04T11:00:00Z', GROUP, P.ben, '<p>Merged</p>'),
    psMsg('1709546400000', '2024-03-04T10:00:00Z', GROUP, P.chen, '<p>Morning!</p>'),
    sysEvent,
  ];
  messages[0].Mentions = [{ Id: 0, MentionText: P.ben.name, Mentioned: { Application: null, Conversation: null, Device: null, Tag: null, User: { DisplayName: P.ben.name, Id: P.ben.id, UserIdentityType: 'aadUser', AdditionalProperties: {} }, AdditionalProperties: {} }, AdditionalProperties: {} }];
  messages[0].Reactions = [{ CreatedDateTime: '2024-03-04T11:25:02.1Z', DisplayName: 'Like', ReactionContentUrl: null, ReactionType: 'like', User: { Application: null, Device: null, User: { DisplayName: null, Id: P.chen.id, UserIdentityType: 'aadUser', AdditionalProperties: {} }, AdditionalProperties: {} }, AdditionalProperties: {} }];
  write('graph-powershell/teamschats20240305.json', JSON.stringify(chats, null, 2) + '\n');
  write('graph-powershell/mychats20240305.json', JSON.stringify(messages, null, 2) + '\n');
}

// ============ G. Teams Free (personal) export: messages.json (Skype export schema) ============
{
  const OWNER = '8:live:.cid.0123456789abcdef';
  const BEA = '8:live:.cid.b0b1b2b3b4b5b6b7';
  const CAL = '8:live:cal.morgan';
  const DEV = '8:live:.cid.d0d1d2d3d4d5d6d7';
  const BOOK = '19:3c1f0e2d4a5b6c7d8e9f0a1b2c3d4e5f@thread.skype';
  const TEAMS = '19:7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d@thread.v2';
  const BOT28 = '28:0d5d6cea-3e5f-4c7b-8a2e-1f2e3d4c5b6a';
  const m = (conv, id, t, from, name, type, content, props = null, ams = null) => ({ id, conversationid: conv, displayName: name, messagetype: type, content, from, originalarrivaltime: new Date(Number(id)).toISOString(), version: Number(id), properties: props, amsreferences: ams });
  const doc = {
    userId: OWNER,
    exportDate: '2026-07-06T20:55',
    conversations: [
      { id: BEA, displayName: 'Bea Stone', version: 1783000000000, properties: { conversationblocked: false, lastimreceivedtime: '2026-07-01T11:16:16.634Z', consumptionhorizon: '1783000000000;1783000000001;2130221778977763996', conversationstatus: null }, threadProperties: null, messages: null,
        MessageList: [
          m(BEA, '1782900000000', '2026-06-30T09:20:00.000Z', BEA, 'Bea Stone', 'RichText', 'Are we still on for <b>Saturday</b>? <ss type="smile">:)</ss>'),
          m(BEA, '1782900060000', '2026-06-30T09:21:00.000Z', 'https://azwcus1-client-s.gateway.messenger.live.com/v1/users/ME/contacts/' + OWNER, null, 'RichText', 'Yes! <quote author="' + BEA + '" authorname="Bea Stone" timestamp="1782900000" conversation="' + BEA + '" messageid="1782900000000"><legacyquote>[30/06/2026 09:20] Bea Stone: </legacyquote>Are we still on for Saturday?<legacyquote>\n\n&lt;&lt;&lt; </legacyquote></quote>Of course', { edittime: '1782900120000' }),
          m(BEA, '1782900180000', '2026-06-30T09:23:00.000Z', OWNER, '', 'RichText', '', { deletetime: '1782900200000' }),
          m(BEA, '1782900300000', '2026-06-30T09:25:00.000Z', BEA, 'Bea Stone', 'RichText/Media_GenericFile', '<URIObject uri="https://api.asm.skype.com/v1/objects/0-weu-d3-fictional" url_thumbnail="https://api.asm.skype.com/v1/objects/0-weu-d3-fictional/views/thumbnail" type="File.1" doc_id="0-weu-d3-fictional">To view this file, go to: <a href="https://login.skype.com/login/sso?go=webclient.xmm&amp;docid=0-weu-d3-fictional">https://login.skype.com/login/sso?go=webclient.xmm&amp;docid=0-weu-d3-fictional</a><OriginalName v="menu.pdf"></OriginalName><FileSize v="44712"></FileSize></URIObject>', null, ['0-weu-d3-fictional']),
          m(BEA, '1782900400000', '2026-06-30T09:26:40.000Z', OWNER, null, 'Event/Call', '<partlist type="ended" alt="" callId="1782900400000"><part identity="' + OWNER + '"><name>Sam Vale</name><duration>84.82</duration></part><part identity="' + BEA + '"><name>Bea Stone</name><duration>84.82</duration></part></partlist>'),
          m(BEA, '1782900500000', '2026-06-30T09:28:20.000Z', BEA, 'Bea Stone', 'RichText/Html', '<p>See you <i>then</i></p>', { emotions: [{ key: 'heart', users: [{ mri: OWNER, time: 1782900510000, value: '1782900510000' }] }] }),
        ] },
      { id: BOOK, displayName: 'Book club', version: 1783100000000, properties: { conversationblocked: false, lastimreceivedtime: '2026-07-02T18:00:00.000Z', consumptionhorizon: null, conversationstatus: null },
        threadProperties: { membercount: 4, topic: 'Book club', members: JSON.stringify([OWNER, BEA, CAL, DEV]), picture: null, description: null }, messages: null,
        MessageList: [
          m(BOOK, '1783000000000', '2026-07-02T08:00:00.000Z', OWNER, null, 'ThreadActivity/AddMember', '<addmember><eventtime>1783000000000</eventtime><initiator>' + OWNER + '</initiator><target>' + DEV + '</target></addmember>'),
          m(BOOK, '1783000060000', '2026-07-02T08:01:00.000Z', CAL, 'Cal Morgan', 'RichText', 'Chapter 3 by Friday? <at id="' + DEV + '">Dev Rao</at> you in?'),
          m(BOOK, '1783000120000', '2026-07-02T08:02:00.000Z', DEV, 'Dev Rao', 'Text', 'I am in', { emotions: JSON.stringify([{ key: 'like', users: [{ mri: CAL, time: 1783000130000, value: '1783000130000' }, { mri: OWNER, time: 1783000140000, value: '1783000140000' }] }]) }),
          m(BOOK, '1783000180000', '2026-07-02T08:03:00.000Z', OWNER, '', 'ThreadActivity/TopicUpdate', '<topicupdate><eventtime>1783000180000</eventtime><initiator>' + OWNER + '</initiator><value>Book club</value></topicupdate>'),
          m(BOOK, '1783000240000', '2026-07-02T08:04:00.000Z', OWNER, '', 'Poll', '<URIObject type="Poll" optionsEncoded="Fri|Sat"></URIObject>'),
        ] },
      { id: TEAMS, displayName: 'Trip planning', version: 1783200000000, properties: { conversationblocked: false, lastimreceivedtime: '2026-07-03T10:00:00.000Z', consumptionhorizon: null, conversationstatus: null },
        threadProperties: { membercount: 3, topic: 'Trip planning', members: [{ MemberMri: OWNER }, { MemberMri: BEA }, { MemberMri: CAL }] }, messages: null,
        MessageList: [
          m(TEAMS, '1783100000000', '2026-07-03T10:00:00.000Z', CAL, 'Cal Morgan', 'RichText', 'Flights booked'),
          m(TEAMS, '1783100060000', '2026-07-03T10:01:00.000Z', TEAMS, null, 'ThreadActivity/MemberJoined', JSON.stringify({ initiator: OWNER, members: [{ id: BEA }] })),
        ] },
      { id: BOT28, displayName: 'Copilot', version: 1783300000000, properties: { conversationblocked: false, lastimreceivedtime: null, consumptionhorizon: null, conversationstatus: null }, threadProperties: null, messages: null,
        MessageList: [
          m(BOT28, '1783200000000', '2026-07-04T07:00:00.000Z', OWNER, '', 'RichText', 'What is on my calendar?'),
          m(BOT28, '1783200005000', '2026-07-04T07:00:05.000Z', BOT28, 'Copilot', 'RichText/Html', '<p>You have nothing scheduled.</p>'),
        ] },
      { id: '48:calllogs', displayName: null, version: 1783400000000, properties: { conversationblocked: false, lastimreceivedtime: null, consumptionhorizon: null, conversationstatus: null }, threadProperties: null, messages: null,
        MessageList: [m('48:calllogs', '1782900400001', '2026-06-30T09:26:40.000Z', BEA, null, 'Text', '{"callId":"1782900400000","callDirection":"incoming","callState":"accepted","originatorParticipant":{"id":"' + BEA + '"},"targetParticipant":{"id":"' + OWNER + '"}}')] },
      { id: '48:notes', displayName: null, version: 1783400000001, properties: null, threadProperties: null, messages: null,
        MessageList: [m('48:notes', '1783250000000', '2026-07-05T07:00:00.000Z', OWNER, null, 'RichText', 'remember passport')] },
    ],
  };
  write('free/messages.json', JSON.stringify(doc, null, 1) + '\n');
}

// ============ H. Purview eDiscovery (new experience): process report items CSV ============
{
  const D = 'purview-new/Reports-ContosoCase-Export-ReviewSetExport-2024-03-10T101500/';
  const H = ['Compound path', 'Subject/Title', 'Date', 'Sender', 'Participants', 'To', 'Conversation name', 'Conversation type', 'Conversation ID', 'Channel Name', 'Team name', 'Contains deleted message', 'Contains edited message', 'Item class', 'Message kind', 'File class', 'Family ID', 'Status'];
  const q = v => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  const row = r => H.map(h => q(r[h] ?? '')).join(',');
  const ana = 'Ana Ruiz <ana.ruiz@contoso.example>', ben = 'Ben Okafor <ben.okafor@contoso.example>', chen = 'Chen Li <chen.li@contoso.example>';
  const rows = [
    { 'Compound path': 'ana.ruiz@contoso.example/TeamsMessagesData', 'Subject/Title': '', Date: '2024-03-05T11:00:00Z', Sender: ana, Participants: [ana, ben].join(','), To: ben, 'Conversation name': [ana, ben].join(','), 'Conversation type': 'Group', 'Conversation ID': 'a3c4e5f6-0b1c-4d2e-9f3a-5b6c7d8e9f00', 'Contains deleted message': 'False', 'Contains edited message': 'False', 'Item class': 'IPM.SkypeTeams.Message', 'Message kind': 'microsoftteams , im', 'File class': 'Conversation', 'Family ID': 'fam-0001', Status: 'Success' },
    // The same transcript from the other custodian's mailbox.
    { 'Compound path': 'ben.okafor@contoso.example/TeamsMessagesData', 'Subject/Title': '', Date: '2024-03-05T11:00:00Z', Sender: ana, Participants: [ana, ben].join(','), To: ben, 'Conversation name': [ana, ben].join(','), 'Conversation type': 'Group', 'Conversation ID': 'a3c4e5f6-0b1c-4d2e-9f3a-5b6c7d8e9f00', 'Contains deleted message': 'False', 'Contains edited message': 'False', 'Item class': 'IPM.SkypeTeams.Message', 'Message kind': 'microsoftteams , im', 'File class': 'Conversation', 'Family ID': 'fam-0002', Status: 'Success' },
    { 'Compound path': 'Launch team/TeamsMessagesData', 'Subject/Title': 'Offsite', Date: '2024-03-07T11:13:20Z', Sender: ben, Participants: [ben, ana, chen].join(','), To: '', 'Conversation name': 'Contoso Launch,General', 'Conversation type': 'Channel', 'Conversation ID': 'b4d5f6a7-1c2d-4e3f-8a4b-6c7d8e9f0a11', 'Channel Name': 'General', 'Team name': 'Contoso Launch', 'Contains deleted message': 'False', 'Contains edited message': 'True', 'Item class': 'IPM.SkypeTeams.Message', 'Message kind': 'microsoftteams , im', 'File class': 'Conversation', 'Family ID': 'fam-0003', Status: 'Success' },
    { 'Compound path': 'ana.ruiz@contoso.example/Inbox', 'Subject/Title': 'Budget', Date: '2024-03-06T09:00:00Z', Sender: chen, Participants: '', To: ana, 'Conversation name': '', 'Conversation type': '', 'Conversation ID': '', 'Item class': 'IPM.Note', 'Message kind': 'email', 'File class': 'Email', 'Family ID': 'fam-0004', Status: 'Success' },
  ];
  write(D + 'Items_2024-03-10T101500.csv', [H.join(','), ...rows.map(row)].join('\r\n') + '\r\n');
  write(D + 'Summary_2024-03-10T101500.csv', 'Location,Item count,Size\r\nana.ruiz@contoso.example,2,40960\r\n');
}
console.log('Teams real-structure fixtures written to', HERE);
