"""Build synthetic iMessage fixtures following docs/formats/imessage.md.

Writes:
  chat.db       rollback-journal DB covering the spec's quirks
  wal/chat.db   same schema, WAL journal mode (header bytes 18/19 == 2)
All names, numbers and addresses are fictional.
"""
import os, sqlite3, struct
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
APPLE = 978307200  # seconds between 1970-01-01 and 2001-01-01

def apple_ns(y, mo, d, h=0, mi=0, s=0):
    return (int(datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc).timestamp()) - APPLE) * 1_000_000_000

def apple_s(y, mo, d, h=0, mi=0, s=0):
    return int(datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc).timestamp()) - APPLE

def typedstream(text):
    """attributedBody as the spec describes it: streamtyped header, NSString class
    marker, a few bytes, '+', then a length (1 byte if < 0x81, 0x81 + uint16 LE,
    0x82 + uint32 LE) and the UTF-8 body."""
    body = text.encode('utf-8')
    n = len(body)
    if n < 0x81:
        ln = bytes([n])
    elif n <= 0xFFFF:
        ln = b'\x81' + struct.pack('<H', n)
    else:
        ln = b'\x82' + struct.pack('<I', n)
    head = (b'\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00'
            b'\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+')
    tail = b'\x86\x84\x02iI\x01' + bytes([min(n, 0x7f)]) + b'\x92\x84\x84\x84\x0cNSDictionary\x00\x94\x84\x01i\x00\x86\x86'
    return head + ln + body + tail

SCHEMA = """
CREATE TABLE handle (ROWID INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, id TEXT NOT NULL, country TEXT,
  service TEXT NOT NULL, uncanonicalized_id TEXT, person_centric_id TEXT);
CREATE TABLE chat (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, style INTEGER,
  chat_identifier TEXT, service_name TEXT, room_name TEXT, display_name TEXT, group_id TEXT, is_archived INTEGER DEFAULT 0);
CREATE TABLE message (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, text TEXT,
  attributedBody BLOB, handle_id INTEGER DEFAULT 0, other_handle INTEGER DEFAULT 0, service TEXT,
  date INTEGER, date_read INTEGER, date_delivered INTEGER, date_edited INTEGER DEFAULT 0, date_retracted INTEGER DEFAULT 0,
  is_from_me INTEGER DEFAULT 0, is_read INTEGER DEFAULT 0, is_sent INTEGER DEFAULT 0, is_delivered INTEGER DEFAULT 0,
  is_system_message INTEGER DEFAULT 0, is_service_message INTEGER DEFAULT 0,
  item_type INTEGER DEFAULT 0, group_action_type INTEGER DEFAULT 0, group_title TEXT, cache_has_attachments INTEGER DEFAULT 0,
  associated_message_guid TEXT, associated_message_type INTEGER DEFAULT 0, associated_message_emoji TEXT,
  reply_to_guid TEXT, thread_originator_guid TEXT, thread_originator_part TEXT,
  balloon_bundle_id TEXT, destination_caller_id TEXT);
CREATE TABLE chat_handle_join (chat_id INTEGER REFERENCES chat (ROWID) ON DELETE CASCADE,
  handle_id INTEGER REFERENCES handle (ROWID) ON DELETE CASCADE, UNIQUE(chat_id, handle_id));
CREATE TABLE chat_message_join (chat_id INTEGER REFERENCES chat (ROWID) ON DELETE CASCADE,
  message_id INTEGER REFERENCES message (ROWID) ON DELETE CASCADE, message_date INTEGER DEFAULT 0,
  PRIMARY KEY (chat_id, message_id));
CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, filename TEXT, mime_type TEXT);
CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER, UNIQUE(message_id, attachment_id));
CREATE TABLE chat_recoverable_message_join (chat_id INTEGER, message_id INTEGER, delete_date INTEGER, PRIMARY KEY (chat_id, message_id));
"""

LONG = 'Long note ' + 'x' * 190  # 200 bytes -> 0x81 length prefix

def build(path, wal=False):
    if os.path.exists(path):
        os.remove(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    db = sqlite3.connect(path)
    if wal:
        db.execute('PRAGMA journal_mode=WAL')
    db.executescript(SCHEMA)
    db.executemany('INSERT INTO handle (ROWID, id, service, person_centric_id) VALUES (?,?,?,?)', [
        (1, '+15555550123', 'iMessage', 'PC-1'),
        (2, 'Ann.Example@Example.com', 'iMessage', None),
        (3, '+1 (555) 555-0199', 'SMS', None),
        (4, '+15555550123', 'SMS', 'PC-1'),
    ])
    db.executemany('INSERT INTO chat (ROWID, guid, style, chat_identifier, service_name, display_name) VALUES (?,?,?,?,?,?)', [
        (1, 'iMessage;-;+15555550123', 45, '+15555550123', 'iMessage', ''),
        (2, 'SMS;-;+15555550123', 45, '+15555550123', 'SMS', ''),
        (3, 'iMessage;+;chat123456789', 43, 'chat123456789', 'iMessage', 'Trail Crew'),
    ])
    db.executemany('INSERT INTO chat_handle_join VALUES (?,?)', [(1, 1), (2, 4), (3, 1), (3, 2), (3, 3)])
    M = []
    def m(rowid, chat, **kw):
        kw.setdefault('guid', 'M%d' % rowid)
        M.append((rowid, chat, kw))
    # chat 1 (1:1 iMessage)
    m(1, 1, is_from_me=1, handle_id=1, date=apple_ns(2023, 1, 1, 12, 0, 0), text='hi there', destination_caller_id='me@example.com', service='iMessage')
    m(2, 1, handle_id=1, date=apple_ns(2023, 1, 1, 12, 1, 30), text=None, attributedBody=typedstream('hello back'), service='iMessage')
    m(3, 1, handle_id=1, date=apple_ns(2023, 1, 1, 12, 2, 0), text='Loved “hi there”', associated_message_type=2000, associated_message_guid='p:0/M1')
    m(12, 1, handle_id=1, date=0, text='no date')
    # chat 2 (1:1 SMS, same person) with an old seconds-based date
    m(4, 2, is_from_me=1, handle_id=4, date=apple_s(2015, 6, 1, 8, 0, 0), text='old sms', service='SMS')
    # chat 3 (group)
    m(5, 3, handle_id=2, date=apple_ns(2023, 2, 1, 9, 0, 0), text='group hello ￼', cache_has_attachments=1)
    m(6, 3, is_from_me=1, handle_id=0, date=apple_ns(2023, 2, 1, 9, 5, 0), text='reply in thread', thread_originator_guid='M5', destination_caller_id='me@example.com')
    m(7, 3, handle_id=3, date=apple_ns(2023, 2, 1, 9, 6, 0), text='Liked “reply in thread”', associated_message_type=2001, associated_message_guid='bp:M6')
    m(8, 3, handle_id=3, date=apple_ns(2023, 2, 1, 9, 7, 0), text='Removed a like', associated_message_type=3001, associated_message_guid='bp:M6')
    m(9, 3, handle_id=1, other_handle=3, date=apple_ns(2023, 2, 1, 8, 0, 0), item_type=1, group_action_type=0)
    m(10, 3, handle_id=3, date=apple_ns(2023, 2, 2, 10, 0, 0), item_type=3, group_action_type=0)
    m(11, 3, handle_id=2, date=apple_ns(2023, 2, 2, 11, 0, 0), item_type=2, group_title='Trail Crew 2')
    m(14, 3, handle_id=2, date=apple_ns(2023, 2, 3, 10, 0, 0), text=None, attributedBody=typedstream(LONG))
    m(15, 3, handle_id=1, date=apple_ns(2023, 2, 3, 10, 1, 0), text=None, attributedBody=typedstream('café \u2603 \U0001F44D'))
    m(16, 3, handle_id=1, date=apple_ns(2023, 2, 3, 10, 2, 0), text='Laughed at an image', associated_message_type=2003, associated_message_guid='p:0/M5')
    m(17, 3, handle_id=1, other_handle=3, date=apple_ns(2023, 2, 3, 11, 0, 0), item_type=1, group_action_type=1)
    # orphan: no chat_message_join row
    m(13, None, handle_id=2, date=apple_ns(2023, 3, 1), text='orphaned')
    for rowid, chat, kw in M:
        cols = ['ROWID'] + list(kw.keys())
        db.execute('INSERT INTO message (%s) VALUES (%s)' % (','.join(cols), ','.join('?' * len(cols))), [rowid] + list(kw.values()))
        if chat is not None:
            db.execute('INSERT INTO chat_message_join VALUES (?,?,?)', (chat, rowid, kw.get('date') or 0))
    db.execute("INSERT INTO attachment VALUES (1, 'A1', '~/Library/Messages/Attachments/aa/01/IMG_0001.HEIC', 'image/heic')")
    db.execute('INSERT INTO message_attachment_join VALUES (5, 1)')
    db.commit()
    if wal:
        db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    for ext in ('-wal', '-shm'):
        if os.path.exists(path + ext):
            os.remove(path + ext)

build(os.path.join(HERE, 'chat.db'))
build(os.path.join(HERE, 'wal', 'chat.db'), wal=True)
with open(os.path.join(HERE, 'wal', 'chat.db'), 'rb') as f:
    h = f.read(20)
assert h[18] == 2 and h[19] == 2, 'expected WAL header'
print('ok')
