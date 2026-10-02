# Synthetic Mastodon archive following docs/formats/mastodon.md (BackupService layout,
# Create/Announce serializers, TagManager to/cc addressing). Run: python3 make_fixtures.py
import json, os
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'archive')
EGO = 'https://social.example/users/otter'
FOL = EGO + '/followers'
PUB = 'https://www.w3.org/ns/activitystreams#Public'
MARTEN = 'https://other.example/users/marten'
BADGER = 'https://social.example/users/badger'
HERON = 'https://birds.example/ap/users/116000000000000001'   # Mastodon 4.5+ numeric actor id
KITE = 'https://birds.example/users/kite'
CTX = ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1', {'Hashtag': 'as:Hashtag'}]

def st(n): return f'{EGO}/statuses/11300000000000000{n}'
def create(n, published, to, cc, content, tags=(), reply=None, extra=None):
    obj = {'id': st(n), 'type': 'Note', 'summary': None, 'inReplyTo': reply, 'published': published,
           'url': f'https://social.example/@otter/11300000000000000{n}', 'attributedTo': EGO,
           'to': to, 'cc': cc, 'sensitive': False,
           'conversation': f'tag:social.example,2025-01-05:objectId={4400+n}:objectType=Conversation',
           'content': content, 'contentMap': {'en': content}, 'attachment': [], 'tag': list(tags),
           'replies': {'id': st(n) + '/replies', 'type': 'Collection'}}
    if extra: obj.update(extra)
    return {'id': st(n) + '/activity', 'type': 'Create', 'actor': EGO, 'published': published, 'to': to, 'cc': cc, 'object': obj}
def mention(href, name): return {'type': 'Mention', 'href': href, 'name': name}

items = [
  # 1 public reply (spec example)
  create(1, '2025-01-05T09:30:00Z', [PUB], [FOL, MARTEN],
         '<p><span class="h-card"><a href="https://other.example/@marten" class="u-url mention">@<span>marten</span></a></span> agreed &amp; thanks!</p>',
         [mention(MARTEN, '@marten@other.example')], reply='https://other.example/users/marten/statuses/998877'),
  # 2 public, two mentions, one local mention serialized without a domain, newer `context` field
  create(2, '2025-01-06T10:00:00Z', [PUB], [FOL, BADGER, HERON], '<p>hello @badger and @heron</p>',
         [mention(BADGER, '@badger'), mention(HERON, '@heron@birds.example'), {'type': 'Hashtag', 'href': 'https://social.example/tags/x', 'name': '#x'}],
         extra={'context': 'https://social.example/contexts/1-77'}),
  # 3 unlisted
  create(3, '2025-01-07T11:00:00Z', [FOL], [PUB], '<p>quiet post</p>'),
  # 4 followers-only with a mention
  create(4, '2025-01-08T12:00:00Z', [FOL], [MARTEN], '<p>for followers @marten</p>', [mention(MARTEN, '@marten@other.example')]),
  # 5 direct to one (numeric 4.5+ actor id)
  create(5, '2025-01-09T13:00:00Z', [HERON], [], '<p>@heron private note</p>', [mention(HERON, '@heron@birds.example')]),
  # 6 direct to two -> group DM
  create(6, '2025-01-10T14:00:00Z', [HERON, KITE], [], '<p>@heron @kite plan</p>', [mention(HERON, '@heron@birds.example'), mention(KITE, '@kite@birds.example')]),
  # 7 reply to a deleted remote status, no mention -> author unknown
  create(7, '2025-01-11T15:00:00Z', [PUB], [FOL], '<p>replying into the void</p>', reply='https://gone.example/users/ghost/statuses/1'),
  # 8 quote post (4.4+) of marten, with content warning
  create(8, '2025-01-12T16:00:00Z', [PUB], [FOL], '<p>look at this</p>', [mention(MARTEN, '@marten@other.example')],
         extra={'quote': 'https://other.example/users/marten/statuses/555', 'summary': 'spoilers'}),
  # 9 boost; cc carries the boosted author
  {'id': EGO + '/statuses/113000000000000009/activity', 'type': 'Announce', 'actor': EGO, 'published': '2025-01-13T17:00:00Z',
   'to': [PUB], 'cc': [MARTEN, FOL], 'object': 'https://other.example/users/marten/statuses/556'},
  # 10 boost without author in cc -> URI-pattern heuristic
  {'id': EGO + '/statuses/113000000000000010/activity', 'type': 'Announce', 'actor': EGO, 'published': '2025-01-14T18:00:00Z',
   'to': [PUB], 'cc': [FOL], 'object': 'https://far.example/users/vole/statuses/55'},
  # 11 self-boost of own followers-only post: object inlined
  {'id': EGO + '/statuses/113000000000000011/activity', 'type': 'Announce', 'actor': EGO, 'published': '2025-01-15T19:00:00Z',
   'to': [FOL], 'cc': [EGO], 'object': {'id': st(4), 'type': 'Note', 'attributedTo': EGO}},
  # 12 self-reply to status 1
  create(12 - 10 + 10, '2025-01-16T20:00:00Z', [PUB], [FOL], '<p>and another thing</p>', reply=st(1)),
]
outbox = {'@context': CTX, 'id': 'outbox.json', 'type': 'OrderedCollection', 'totalItems': len(items), 'orderedItems': items}
actor = {'@context': CTX, 'id': EGO, 'type': 'Person', 'following': EGO + '/following', 'followers': FOL, 'inbox': EGO + '/inbox',
         'outbox': 'outbox.json', 'featured': EGO + '/collections/featured', 'preferredUsername': 'otter', 'name': 'Otter Lab',
         'summary': '<p>synthetic</p>', 'url': 'https://social.example/@otter', 'manuallyApprovesFollowers': False, 'discoverable': True,
         'published': '2024-01-01T00:00:00Z', 'likes': 'likes.json', 'bookmarks': 'bookmarks.json', 'icon': {'type': 'Image', 'url': 'avatar.png'}}
likes = {'@context': 'https://www.w3.org/ns/activitystreams', 'id': 'likes.json', 'type': 'OrderedCollection',
         'orderedItems': ['https://other.example/users/marten/statuses/998877', 'https://ap.example/ap/users/987/statuses/1', 'https://weird.example/notes/abc']}
bookmarks = {'@context': 'https://www.w3.org/ns/activitystreams', 'id': 'bookmarks.json', 'type': 'OrderedCollection',
             'orderedItems': ['https://birds.example/ap/users/116000000000000001/statuses/42']}
os.makedirs(D, exist_ok=True)
for name, doc in [('outbox.json', outbox), ('actor.json', actor), ('likes.json', likes), ('bookmarks.json', bookmarks)]:
    with open(os.path.join(D, name), 'w') as f: json.dump(doc, f, indent=2)
with open(os.path.join(D, 'following_accounts.csv'), 'w') as f:
    f.write('Account address,Show boosts,Notify on new posts,Languages\nmarten@other.example,true,false,\nheron@birds.example,false,true,en\nnewperson@x.example,true,false,\n')
with open(os.path.join(D, 'lists.csv'), 'w') as f:
    f.write('Mustelids,marten@other.example\nMustelids,badger@social.example\nBirds,heron@birds.example\n')
