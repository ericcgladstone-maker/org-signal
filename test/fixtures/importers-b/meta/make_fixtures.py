# Generates synthetic Meta (Messenger / Instagram) exports following
# docs/formats/meta-messenger-instagram.md. Run: python3 make_fixtures.py
#
# Standard exports reproduce Meta's mojibake: every UTF-8 byte written as its
# own \u00XX escape. The E2EE backup is written as correct UTF-8.
import json, os, re

def escape_emoji(s):
    # Keep letters such as c-caron as raw UTF-8 (realistic, exercises multi-byte
    # decoding) but write emoji as JSON escapes (project rule: no emoji in files).
    def esc(m):
        b = m.group(0).encode('utf-16-be')
        return ''.join('\\u%04x' % int.from_bytes(b[i:i+2], 'big') for i in range(0, len(b), 2))
    return re.sub('[\U00010000-\U0010FFFF\u2600-\u27BF]', esc, s)

def moji(v):
    if isinstance(v, str):
        return v.encode('utf-8').decode('latin-1')
    if isinstance(v, list):
        return [moji(x) for x in v]
    if isinstance(v, dict):
        return {k: moji(x) for k, x in v.items()}
    return v

def write_std(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='ascii') as f:
        json.dump(moji(doc), f, indent=2, ensure_ascii=True)  # ensure_ascii -> Ä\u008d style

def write_e2ee(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(escape_emoji(json.dumps(doc, indent=2, ensure_ascii=False)))

ANA, JOR, SAM = 'Ana Kovač', 'Jordan Pike', 'Sam Rivera'
HEART, THUMBS = '\u2764', '\U0001F44D'
P = lambda *names: [{'name': n} for n in names]

# ---- Facebook 2024 layout (your_activity_across_facebook) ----
fb = 'fb2024/your_activity_across_facebook/messages/'
write_std(fb + 'inbox/jordanpike_ABC123/message_1.json', {
  'participants': P(ANA, JOR), 'title': JOR, 'is_still_participant': True,
  'thread_path': 'inbox/jordanpike_ABC123', 'magic_words': [],
  'messages': [  # newest first
    {'sender_name': JOR, 'timestamp_ms': 1717321402123, 'content': 'See you at 3', 'type': 'Generic',
     'reactions': [{'reaction': HEART, 'actor': ANA}], 'is_geoblocked_for_viewer': False},
    {'sender_name': ANA, 'timestamp_ms': 1717321300000, 'type': 'Generic',
     'photos': [{'uri': 'messages/inbox/jordanpike_ABC123/photos/123.jpg', 'creation_timestamp': 1717321300}]},
    {'sender_name': JOR, 'timestamp_ms': 1717320000000, 'type': 'Call', 'call_duration': 192},
  ]})
write_std(fb + 'inbox/jordanpike_ABC123/message_2.json', {
  'participants': P(ANA, JOR), 'title': JOR, 'is_still_participant': True, 'thread_path': 'inbox/jordanpike_ABC123',
  'messages': [
    {'sender_name': ANA, 'timestamp_ms': 1717310000000, 'type': 'Call', 'call_duration': 0, 'missed': True},
    {'sender_name': JOR, 'timestamp_ms': 1717300000000, 'type': 'Share', 'share': {'link': 'https://example.com/article', 'share_text': 'x'}},
    {'sender_name': ANA, 'timestamp_ms': 1717299000000, 'content': 'Zdravo, čau ' + THUMBS, 'type': 'Generic'},
  ]})
# Group whose leaver is no longer in participants (group by observed senders).
write_std(fb + 'e2ee_cutover/fieldops_XYZ/message_1.json', {
  'participants': P(ANA, JOR), 'title': 'Field Ops crew', 'is_still_participant': True, 'thread_path': 'e2ee_cutover/fieldops_XYZ',
  'messages': [
    {'sender_name': SAM, 'timestamp_ms': 1717200000000, 'content': 'Sam left the chat', 'type': 'Unsubscribe'},
    {'sender_name': JOR, 'timestamp_ms': 1717100000000, 'content': 'Plans?', 'type': 'Generic'},
    {'sender_name': ANA, 'timestamp_ms': 1717000000000, 'content': 'Ana added Sam to the group', 'type': 'Subscribe', 'users': [{'name': SAM}]},
  ]})
write_std(fb + 'archived_threads/samrivera_9/message_1.json', {
  'participants': P(SAM, ANA), 'title': SAM, 'is_still_participant': True, 'thread_path': 'archived_threads/samrivera_9',
  'messages': [{'sender_name': SAM, 'timestamp_ms': 1717400000000, 'content': 'hi', 'type': 'Generic'}]})
write_std(fb + 'message_requests/stranger_5/message_1.json', {
  'participants': P('Spam Person', ANA), 'title': 'Spam Person', 'thread_path': 'message_requests/stranger_5',
  'messages': [{'sender_name': 'Spam Person', 'timestamp_ms': 1717000000001, 'content': 'buy', 'type': 'Generic'}]})
write_std('fb2024/your_activity_across_facebook/messages/autofill_information.json', {'autofill_information_v2': {}})

# ---- Messenger E2EE backup (flat, camelCase, correct UTF-8, unsorted) ----
write_e2ee('e2ee/Jordan Pike_1.json', {
  'participants': [ANA, JOR], 'threadName': JOR,
  'messages': [
    {'senderName': ANA, 'text': 'new e2ee msg', 'timestamp': 1717500000000, 'type': 'Generic', 'isUnsent': False, 'media': [], 'reactions': []},
    {'senderName': JOR, 'text': 'See you at 3', 'timestamp': 1717321402123, 'type': 'Generic', 'isUnsent': False, 'media': [], 'reactions': []},
    {'senderName': JOR, 'text': '', 'timestamp': 1717450000000, 'type': 'Generic', 'isUnsent': False,
     'media': [{'uri': './media/photo.jpg'}], 'reactions': [{'actor': ANA, 'reaction': THUMBS}]},
  ]})

# ---- Instagram 2025 layout ----
ig = 'ig2025/your_instagram_activity/messages/inbox/'
write_std(ig + 'otterlab_17841/message_1.json', {
  'participants': P(ANA, 'otter lab'), 'title': 'otter lab', 'is_still_participant': True, 'thread_path': 'inbox/otterlab_17841',
  'messages': [
    {'sender_name': 'otter lab', 'timestamp_ms': 1720000002000, 'content': 'Reacted ' + HEART + ' to your message', 'type': 'Generic'},
    {'sender_name': ANA, 'timestamp_ms': 1720000001000, 'content': 'nice', 'type': 'Generic', 'reactions': [{'reaction': HEART, 'actor': 'otter lab'}]},
    {'sender_name': 'otter lab', 'timestamp_ms': 1720000000000, 'content': '', 'type': 'Generic', 'is_unsent': True},
  ]})
write_std(ig + 'instagramuser_2/message_1.json', {
  'participants': P(ANA, 'Instagram User'), 'title': 'Instagram User', 'thread_path': 'inbox/instagramuser_2',
  'messages': [{'sender_name': 'Instagram User', 'timestamp_ms': 1720000005000, 'content': 'who', 'type': 'Generic'}]})

# ---- old bare layout (ambiguous platform) ----
write_std('old/messages/inbox/janedoe_10158/message_1.json', {
  'participants': P(ANA, 'Jane Doe'), 'title': 'Jane Doe', 'thread_type': 'Regular', 'thread_path': 'inbox/janedoe_10158',
  'messages': [{'sender_name': 'Jane Doe', 'timestamp_ms': 1500000000000, 'content': 'old times', 'type': 'Generic'},
               {'sender_name': ANA, 'timestamp_ms': 1499999999000, 'content': 'café?', 'type': 'Generic'}]})
