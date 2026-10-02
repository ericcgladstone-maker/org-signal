# Generates the synthetic Discord fixtures (spec: docs/formats/discord.md).
# Run: python3 make_fixtures.py   (rewrites pkg-2025/, pkg-2021/, dce/)
import json, os, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
def w(rel, content):
    p = os.path.join(HERE, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(content)
for d in ['pkg-2025', 'pkg-2021', 'dce']:
    shutil.rmtree(os.path.join(HERE, d), ignore_errors=True)

EGO = '900000000000000001'
NOVA = '900000000000000002'
RIO = '900000000000000003'
KAI = '900000000000000004'

# ---- 2025-style package: capitalised folders, c-prefix, messages.json, string types
user = {"id": EGO, "username": "otter_ego", "discriminator": "0", "global_name": "Otter",
        "email": "otter@example.invalid", "ip": "203.0.113.9", "payments": [{"amount": 1}],
        "relationships": [
            {"id": NOVA, "type": 1, "user": {"id": NOVA, "username": "nova_fox", "discriminator": "0", "avatar": None}},
            {"id": KAI, "type": 1, "user": {"id": KAI, "username": "kai", "discriminator": "1234", "avatar": None}},
            {"id": RIO, "type": 2, "user": {"id": RIO, "username": "rio.m", "discriminator": "0", "avatar": None}}],
        "notes": {}}
w('pkg-2025/Account/user.json', json.dumps(user))
w('pkg-2025/README.txt', 'synthetic package\n')
# Activity must never be read: make it invalid JSON.
w('pkg-2025/Activity/reporting/events-2025-00000-of-00001.json', '{not json at all\n')
w('pkg-2025/Servers/index.json', json.dumps({"1000000000000000009": "Synthwave Club"}))
index = {
    "1100000000000000001": "Direct Message with nova_fox#0",
    "1100000000000000002": "general in Synthwave Club",
    "1100000000000000003": None,
    "1100000000000000004": "Direct Message with kai#1234",
    "1100000000000000005": "Unknown channel in Synthwave Club",
}
w('pkg-2025/Messages/index.json', json.dumps(index))
def chan(cid, obj, msgs_raw):
    w(f'pkg-2025/Messages/c{cid}/channel.json', json.dumps(obj))
    w(f'pkg-2025/Messages/c{cid}/messages.json', msgs_raw)
# DM with recipients; message IDs as bare JSON numbers (19 digits > 2^53)
chan('1100000000000000001', {"id": "1100000000000000001", "type": "DM", "recipients": [EGO, NOVA]},
     '[{"ID":1180000000000000001,"Timestamp":"2023-12-11 02:01:09","Contents":"hey nova","Attachments":""},'
     '{"ID":1180000000000000003,"Timestamp":"2023-12-11 02:05:00","Contents":"also <@!900000000000000003> says hi","Attachments":""}]')
# guild text channel, mentions via <@id>, role and channel mentions ignored
chan('1100000000000000002', {"id": "1100000000000000002", "type": "GUILD_TEXT", "name": "general", "guild": {"id": "1000000000000000009", "name": "Synthwave Club"}},
     '[{"ID":1180000000000000010,"Timestamp":"2024-01-02 10:00:00","Contents":"thanks <@900000000000000003>! cc <@&777000000000000001> in <#1100000000000000002>","Attachments":""},'
     '{"ID":1180000000000000011,"Timestamp":"","Contents":"no timestamp","Attachments":""}]')
# group DM without recipients
chan('1100000000000000003', {"id": "1100000000000000003", "type": "GROUP_DM"},
     '[{"ID":1180000000000000020,"Timestamp":"2024-02-01 08:30:00","Contents":"group hello","Attachments":""}]')
# DM without recipients: partner resolved via index label + relationships (kai#1234)
chan('1100000000000000004', {"id": "1100000000000000004", "type": "DM"},
     '[{"ID":1180000000000000030,"Timestamp":"2024-03-01 12:00:00","Contents":"yo kai","Attachments":""}]')
# private thread, empty message list
chan('1100000000000000005', {"id": "1100000000000000005", "type": "PRIVATE_THREAD", "name": "secret"}, '[]')

# ---- 2021-style package: wrapping folder, lowercase, no c-prefix, messages.csv,
# numeric types, localised account folder ("Compte"), CRLF + multi-line quoted field
user21 = {"id": EGO, "username": "otter_ego", "discriminator": "4321", "relationships": []}
w('pkg-2021/package/Compte/user.json', json.dumps(user21))
w('pkg-2021/package/messages/index.json', json.dumps({"1100000000000000101": "Direct Message with nova_fox#0", "1100000000000000102": "general in Synthwave Club"}))
w('pkg-2021/package/messages/1100000000000000101/channel.json', json.dumps({"id": "1100000000000000101", "type": 1, "recipients": [NOVA, EGO, "Deleted User"]}))
w('pkg-2021/package/messages/1100000000000000101/messages.csv',
  'ID,Timestamp,Contents,Attachments\r\n'
  '950000000000000001,2022-03-01 18:22:10.120000+00:00,"multi-line\r\nmessage","https://cdn.discordapp.com/attachments/1/2/a.png"\r\n'
  '950000000000000002,2022-03-01 19:00:00.000000+02:00,plain,\r\n')
w('pkg-2021/package/messages/1100000000000000102/channel.json', json.dumps({"id": "1100000000000000102", "type": 0, "name": "general", "guild": {"id": "1000000000000000009", "name": "Synthwave Club"}}))
w('pkg-2021/package/messages/1100000000000000102/messages.csv', 'ID,Timestamp,Contents,Attachments\r\n950000000000000010,2022-04-01 00:00:00.000000+00:00,hi <@900000000000000004>,\r\n')

# ---- DiscordChatExporter JSON: guild channel
def author(uid, name, nick=None, bot=False, roles=()):
    return {"id": uid, "name": name, "discriminator": "0000", "nickname": nick or name, "color": None,
            "isBot": bot, "roles": [{"id": "1", "name": r, "color": None, "position": 1} for r in roles], "avatarUrl": "x"}
A = author(NOVA, 'nova_fox', 'Nova', roles=['Mods'])
R = author(RIO, 'rio.m', 'Rio')
B = author('900000000000000099', 'helperbot', 'Helper', bot=True)
msgs = [
    {"id": "1200000000000000001", "type": "Default", "timestamp": "2026-09-01T14:00:00.000+02:00", "timestampEdited": None, "callEndedTimestamp": None,
     "isPinned": False, "content": "morning all", "author": A, "attachments": [], "embeds": [], "stickers": [],
     "reactions": [{"emoji": {"id": "", "name": "\U0001F44D", "code": "thumbsup", "isAnimated": False, "imageUrl": "x"}, "count": 2, "users": [R]}],
     "mentions": [], "inlineEmojis": []},
    {"id": "1200000000000000002", "type": "Reply", "timestamp": "2026-09-01T14:02:11.512+02:00", "timestampEdited": None, "callEndedTimestamp": None,
     "isPinned": False, "content": "agreed, @Nova", "author": R, "attachments": [], "embeds": [], "stickers": [], "reactions": [],
     "mentions": [A], "reference": {"type": "Default", "messageId": "1200000000000000001", "channelId": "1100000000000000002", "guildId": "1000000000000000009"}, "inlineEmojis": []},
    {"id": "1200000000000000003", "type": "Reply", "timestamp": "2026-09-01T14:03:00.000+02:00", "content": "replying to something old", "author": A,
     "reactions": [], "mentions": [], "reference": {"type": "Default", "messageId": "1199999999999999999", "channelId": "1100000000000000002", "guildId": "1000000000000000009"}},
    {"id": "1200000000000000004", "type": "GuildMemberJoin", "timestamp": "2026-09-01T14:04:00.000+02:00", "content": "", "author": author(KAI, 'kai'), "reactions": [], "mentions": []},
    {"id": "1200000000000000005", "type": "ChannelPinnedMessage", "timestamp": "2026-09-01T14:05:00.000+02:00", "content": "", "author": A, "reactions": [], "mentions": [],
     "reference": {"type": "Default", "messageId": "1200000000000000001"}},
    {"id": "1200000000000000006", "type": "Default", "timestamp": "2026-09-01T14:06:00.000+02:00", "content": "pong", "author": B, "reactions": [], "mentions": [],
     "interaction": {"id": "5", "name": "ping", "user": R}},
    {"id": "1200000000000000007", "type": "Default", "timestamp": "2026-09-01T14:07:00.000+02:00", "content": "fwd", "author": R, "reactions": [], "mentions": [],
     "reference": {"type": "Forward", "messageId": "1200000000000000001"}},
    {"id": "1200000000000000008", "type": "Default", "timestamp": "2026-09-01T14:08:00.000+02:00", "content": "été", "author": A,
     "reactions": [{"emoji": {"id": "", "name": "\U0001F389", "code": "tada"}, "count": 3}], "mentions": []},
]
dce = {"guild": {"id": "1000000000000000009", "name": "Synthwave Club", "iconUrl": "x"},
       "channel": {"id": "1100000000000000002", "type": "GuildTextChat", "categoryId": "1100000000000000000", "category": "Text Channels", "name": "general", "topic": None},
       "dateRange": {"after": None, "before": None}, "exportedAt": "2026-09-30T12:00:00.000+00:00", "messages": msgs, "messageCount": len(msgs)}
w('dce/Synthwave Club - Text Channels - general [1100000000000000002].json', json.dumps(dce, indent=2, ensure_ascii=True))
# DCE DM (guild id "0"), UTC
dm = {"guild": {"id": "0", "name": "Direct Messages", "iconUrl": "x"},
      "channel": {"id": "1100000000000000050", "type": "DirectTextChat", "categoryId": None, "category": "Private", "name": "rio.m", "topic": None},
      "dateRange": {"after": None, "before": None}, "exportedAt": "2026-09-30T12:00:00.000+00:00",
      "messages": [
          {"id": "1200000000000000101", "type": "Default", "timestamp": "2026-09-02T09:00:00.000+00:00", "content": "hi", "author": A, "reactions": [], "mentions": []},
          {"id": "1200000000000000102", "type": "Default", "timestamp": "2026-09-02T09:01:00.000+00:00", "content": "hey", "author": R, "reactions": [], "mentions": []}],
      "messageCount": 2}
w('dce/Direct Messages - Private - rio.m [1100000000000000050].json', json.dumps(dm, indent=2))
w('dce/Synthwave Club - Text Channels - random [1100000000000000060].csv',
  '"AuthorID","Author","Date","Content","Attachments","Reactions"\r\n'
  '"900000000000000002","nova_fox","2026-09-03T10:00:00.1234567+02:00","line one\r\nline two","",""\r\n'
  '"900000000000000004","kai#1234","2026-09-03T10:05:00.0000000+02:00","ok","","partyblob (2)"\r\n')
w('dce-html/chan.html', '<html><body><div class="chatlog__message-container" data-message-id="1"></div></body></html>\n')
