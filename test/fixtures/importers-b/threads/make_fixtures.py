# Synthetic Threads export (Instagram-bundled JSON) following docs/formats/threads.md.
# Strings are written the way Meta writes them: each UTF-8 byte as its own \u00XX
# escape (m() + ensure_ascii). Run: python3 make_fixtures.py
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'instagram-otter.lab-2025-08-24-AbCdEfGh')
T = os.path.join(ROOT, 'your_instagram_activity', 'threads')
def m(s): return s.encode('utf-8').decode('latin-1')
def mj(v):
    if isinstance(v, str): return m(v)
    if isinstance(v, list): return [mj(x) for x in v]
    if isinstance(v, dict): return {m(k): mj(x) for k, x in v.items()}
    return v
def w(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f: json.dump(mj(obj), f, indent=2, ensure_ascii=True)

w(os.path.join(T, 'threads_and_replies.json'), {'text_post_app_text_posts': [
  {'media': [{'uri': '', 'creation_timestamp': 1754466859, 'title': "agreed \u2014 let's sync tomorrow with @pine.marten.",
              'media_metadata': {'camera_metadata': {'has_camera_metadata': False}}, 'cross_post_source': {'source_app': 'FB'},
              'text_app_post': {'reply_control': 'everyone', 'geo_gated_country_list': '', 'is_reply': True}}]},
  {'title': 'caf\u00e9 day \U0001F44D email me at a@b.com @River_Otter', 'creation_timestamp': 1754500000,
   'media': [{'uri': 'media/posts/202508/x.jpg', 'creation_timestamp': 1754500000, 'title': '',
              'text_app_post': {'reply_control': 'everyone', 'is_reply': False}}]},
  {'media': [{'uri': '', 'creation_timestamp': 1754600000, 'title': '@otter.lab note to self',
              'text_app_post': {'is_reply': False}}]},
]})
w(os.path.join(T, 'liked_threads.json'), {'text_post_app_media_likes': [
  {'title': 'river.otter', 'media_list_data': [], 'string_list_data': [{'href': 'https://www.threads.com/@river.otter/post/DAbCdEfGhIj', 'value': '\U0001F44D', 'timestamp': 1760912834}]},
  {'title': '', 'media_list_data': [], 'string_list_data': [{'href': 'https://www.threads.net/@badger.x/post/DZZZ', 'value': '\u2764', 'timestamp': 1760912900}]},
]})
w(os.path.join(T, 'followers_1.json'), {'text_post_app_text_post_app_followers': [
  {'title': 'Pine Marten \u00e9cole', 'string_list_data': [{'href': 'https://www.threads.com/pine.marten', 'value': 'pine.marten', 'timestamp': 1730000000}]},
  {'title': 'heron.bird', 'string_list_data': [{'href': 'https://www.threads.net/heron.bird', 'timestamp': 1730000500}]},
]})
w(os.path.join(T, 'following.json'), {'text_post_app_text_post_app_following': [
  {'title': '', 'string_list_data': [{'href': 'https://www.threads.com/river.otter', 'value': 'River.Otter', 'timestamp': 1731000000}]},
]})
w(os.path.join(T, 'personal_information.json'), {'text_post_app_text_post_app_profile': [
  {'media_map_data': {}, 'string_map_data': {'Username': {'href': '', 'value': 'otter.lab', 'timestamp': 0},
   'Name': {'href': '', 'value': 'Otter Lab \u00e9', 'timestamp': 0}, 'Email': {'href': '', 'value': 'x@example.com', 'timestamp': 0},
   'Private Account': {'href': '', 'value': 'False', 'timestamp': 0}}}]})
# Localized labels (Chinese), as one parser matches after decoding.
w(os.path.join(T, 'saved_threads.json'), {'text_post_app_text_post_app_saved_posts': [
  {'string_map_data': {'\u4f5c\u8005': {'value': 'river.otter'}, '\u7db2\u5740': {'href': 'https://www.threads.com/@river.otter/post/X1'}, '\u6642\u9593': {'timestamp': 1760000000}}}]})
w(os.path.join(T, 'blocked_profiles.json'), {'text_post_app_text_post_app_blocked_users': [{'title': 'troll', 'string_list_data': [{'value': 'troll', 'timestamp': 1}]}]})
# Instagram's own follower file (different key, outside threads/): must be ignored.
w(os.path.join(ROOT, 'connections', 'followers_and_following', 'followers_1.json'), [{'title': '', 'string_list_data': [{'href': 'https://www.instagram.com/someone', 'value': 'someone', 'timestamp': 1}]}])
# HTML-format export (must be rejected with a re-export hint).
H = os.path.join(HERE, 'html-export', 'your_instagram_activity', 'threads')
os.makedirs(H, exist_ok=True)
with open(os.path.join(H, 'threads_and_replies.html'), 'w') as f: f.write('<html><body>posts</body></html>')
