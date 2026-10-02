# Generates synthetic Telegram Desktop JSON exports following docs/formats/telegram.md.
# Run: python3 make_fixtures.py
import json, re

def escape_emoji(s):
    # Keep letters such as c-caron as raw UTF-8 (realistic, exercises multi-byte
    # decoding) but write emoji as JSON escapes (project rule: no emoji in files).
    def esc(m):
        b = m.group(0).encode('utf-16-be')
        return ''.join('\\u%04x' % int.from_bytes(b[i:i+2], 'big') for i in range(0, len(b), 2))
    return re.sub('[\U00010000-\U0010FFFF\u2600-\u27BF]', esc, s)

def msg(id, ts, **kw):
    d = {"id": id, "type": "message", "date": "2024-11-14T09:12:44", "date_unixtime": str(ts)}
    d.update(kw)
    return d

def svc(id, ts, actor, actor_id, action, **kw):
    d = {"id": id, "type": "service", "date": "2024-11-14T09:12:44", "date_unixtime": str(ts),
         "actor": actor, "actor_id": actor_id, "action": action}
    d.update(kw)
    return d

ANA, BEN, CLEO = "user100000001", "user100000002", "user100000003"
T0 = 1731571964

full = {
 "about": "Here is the data you requested.",
 "personal_information": {"user_id": 100000001, "first_name": "Ana", "last_name": "Kovač",
                          "phone_number": "+386 40 000 000", "username": "@ana_k", "bio": "test"},
 "contacts": {"about": "x", "list": [
   {"user_id": 100000002, "first_name": "Ben", "last_name": "Ito", "phone_number": "+81 90 0000 0000",
    "date": "2024-01-03T10:00:00", "date_unixtime": "1704276000"},
   {"date": "2024-01-04T10:00:00", "date_unixtime": "1704362400"}]},
 "frequent_contacts": {"about": "x", "list": [
   {"id": 100000002, "category": "people", "type": "user", "name": "Ben Ito", "rating": 0.83},
   {"id": 100000003, "category": "calls", "type": "user", "name": "Cleo Park", "rating": 0.5},
   {"id": 100000077, "category": "inline_bots", "type": "user", "name": "Gif Bot", "rating": 0.2},
   {"id": 1234567890, "category": "people", "type": "private_supergroup", "name": "Field Ops", "rating": 0.4}]},
 "chats": {"about": "x", "list": [
  {"name": "Ben Ito", "type": "personal_chat", "id": 100000002, "messages": [
    msg(1, T0, **{"from": "Ana Kovač", "from_id": ANA, "text": ["Ping ", {"type": "mention", "text": "@ben_ito"}],
       "text_entities": [{"type": "plain", "text": "Ping "}, {"type": "mention", "text": "@ben_ito"}]}),
    msg(2, T0 + 60, **{"from": "Ben Ito", "from_id": BEN, "reply_to_message_id": 1, "text": "pong",
       "text_entities": [{"type": "plain", "text": "pong"}],
       "reactions": [{"type": "emoji", "count": 2, "emoji": "\U0001F44D",
                      "recent": [{"from": "Ana Kovač", "from_id": ANA, "date": "2024-11-14T09:13:00"}]}]}),
    svc(3, T0 + 120, "Ana Kovač", ANA, "phone_call", duration_seconds=60),
    {"id": 4, "type": "unsupported"},
  ]},
  {"name": "Field Ops", "type": "private_supergroup", "id": 1234567890, "messages": [
    svc(10, T0 + 1000, "Ana Kovač", ANA, "create_group", title="Field Ops", members=["Ana Kovač", "Cleo Park"]),
    msg(11, T0 + 1010, **{"from": "Cleo Park", "from_id": CLEO, "text": [{"type": "mention_name", "text": "Ben", "user_id": 100000002}, " come"],
       "text_entities": [{"type": "mention_name", "text": "Ben", "user_id": 100000002}, {"type": "plain", "text": " come"}]}),
    svc(12, T0 + 1020, "Cleo Park", CLEO, "invite_members", members=["Ben Ito", "Dmitri Volk"]),
    msg(13, T0 + 1030, **{"from": "Ben Ito", "from_id": BEN, "reply_to_message_id": 11, "text": "here",
       "text_entities": [{"type": "plain", "text": "here"}]}),
    svc(14, T0 + 1040, "Ben Ito", BEN, "remove_members", members=["Ben Ito"]),
    msg(15, T0 + 1050, **{"from": "Cleo Park", "from_id": CLEO, "rich_message": {"blocks": [{"type": "paragraph", "text": "rich hello"}]}}),
    msg(16, T0 + 1060, **{"from": "Cleo Park", "from_id": CLEO, "reply_to_message_id": 77, "reply_to_peer_id": "channel987",
       "text": "x", "text_entities": [{"type": "plain", "text": "x"}]}),
    msg(17, T0 + 1070, **{"from": None, "from_id": "user100000009", "text": "gone",
       "text_entities": [{"type": "plain", "text": "gone"}]}),
    msg(18, T0 + 1080, **{"from": "Cleo Park", "from_id": CLEO, "text": "",
       "text_entities": [{"type": "mention", "text": "@ana_k"}, {"type": "plain", "text": " and "}, {"type": "mention", "text": "@Some_One"}]}),
    svc(19, T0 + 1090, "Cleo Park", CLEO, "migrate_from_group", title="Field Ops"),
  ]},
  {"type": "saved_messages", "id": 100000001, "messages": [msg(1, T0, **{"from": "Ana Kovač", "from_id": ANA, "text": "note", "text_entities": [{"type": "plain", "text": "note"}]})]},
  {"name": "News", "type": "public_channel", "id": 4444, "messages": [msg(1, T0, **{"from": "News", "from_id": "channel4444", "text": "n", "text_entities": [{"type": "plain", "text": "n"}]})]},
  {"name": "Helper", "type": "bot_chat", "id": 5555, "messages": [msg(1, T0, **{"from": "Helper", "from_id": "user5555", "text": "hi", "text_entities": [{"type": "plain", "text": "hi"}]})]},
 ]},
 "left_chats": {"about": "x", "list": [
  {"name": "Old Club", "type": "public_supergroup", "id": 555, "messages": [
    msg(1, T0 - 1000, **{"from": "Ben Ito", "from_id": BEN, "text": "old", "text_entities": [{"type": "plain", "text": "old"}]})]}]},
}

single = {"name": "Cleo Park", "type": "personal_chat", "id": 100000003, "messages": [
  msg(1, T0, **{"from": "Cleo Park", "from_id": CLEO, "text": "first", "text_entities": [{"type": "plain", "text": "first"}]}),
  msg(2, T0 + 5, **{"from": "Ana", "from_id": ANA, "reply_to_message_id": 1, "text": "second", "text_entities": [{"type": "plain", "text": "second"}]}),
  msg(3, T0 + 9, **{"from": "Cleo Park", "from_id": CLEO, "text": "third", "text_entities": [{"type": "plain", "text": "third"}]}),
]}

# tdesktop pretty-prints with one space per level and writes UTF-8 directly.
for path, doc in [("DataExport_2026-10-02/result.json", full), ("ChatExport_2026-10-02/result.json", single)]:
    with open(path, "w", encoding="utf-8") as f:
        f.write(escape_emoji(json.dumps(doc, indent=1, ensure_ascii=False)))
