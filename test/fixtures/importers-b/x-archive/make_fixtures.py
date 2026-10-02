# Generates synthetic X archive fixtures following docs/formats/x-archive.md.
# Run: python3 make_fixtures.py  (from this folder)
import json, os, shutil

EGO = "1400000000000000001"
def ytd(path, glob, items, same_line=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    body = json.dumps(items, indent=2, ensure_ascii=False)
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"window.{glob} = {body}")

def tw(id, created, text, mentions=(), reply=None, rng=None, urls=(), truncated=False, wrap=True):
    t = {"id_str": id, "id": id, "created_at": created, "full_text": text,
         "display_text_range": rng or ["0", str(len(text))],
         "entities": {"user_mentions": [dict(name=n, screen_name=s, id_str=i, id=i, indices=[str(a), str(b)]) for (n, s, i, a, b) in mentions],
                      "hashtags": [], "symbols": [], "urls": [dict(url="https://t.co/x1", expanded_url=u, display_url=u[8:30], indices=["0", "1"]) for u in urls]},
         "favorite_count": "0", "retweet_count": "0", "retweeted": False, "favorited": False,
         "truncated": truncated, "lang": "en"}
    if reply:
        uid, sid, sname = reply
        t["in_reply_to_status_id_str"] = sid; t["in_reply_to_status_id"] = sid
        t["in_reply_to_user_id_str"] = uid; t["in_reply_to_user_id"] = uid
        if sname: t["in_reply_to_screen_name"] = sname
    return {"tweet": t} if wrap else t

# ---------------------------------------------------------------- modern (2025)
root = "modern/twitter-2025-01-22-abc/"
shutil.rmtree("modern", ignore_errors=True)
d = root + "data/"
part0 = [
    # spec example: reply whose auto-prepended mention is visible (range starts at 0)
    tw("1700000000000000101", "Tue Mar 05 14:02:11 +0000 2024", "@river_otter agreed, let's sync with @pine_marten tomorrow",
       [("River Otter", "river_otter", "222000111", 0, 12), ("Pine Marten", "pine_marten", "333000222", 37, 49)],
       reply=("222000111", "1700000000000000055", "river_otter"), rng=["0", "57"]),
    # self-reply continuing the thread; the @example_org prefix is outside display_text_range
    tw("1700000000000000102", "Tue Mar 05 14:05:00 +0000 2024", "@example_org also: ping @pine_marten",
       [("Example Org", "example_org", EGO, 0, 12), ("Pine Marten", "pine_marten", "333000222", 24, 36)],
       reply=(EGO, "1700000000000000101", "example_org"), rng=["13", "36"]),
    tw("1700000000000000103", "Wed Mar 06 08:00:00 +0000 2024", "RT @pine_marten: big news &amp; more",
       [("Pine Marten", "pine_marten", "333000222", 3, 15)]),
    tw("1700000000000000104", "Wed Mar 06 09:00:00 +0000 2024", "RT @ghost_acct: hello there"),
    # reply to an account whose screen name is missing (deleted parent)
    tw("1700000000000000108", "Thu Mar 07 10:00:00 +0000 2024", "thanks!", reply=("777000666", "1700000000000000077", None)),
]
part1 = [
    tw("1700000000000000105", "Fri Mar 08 11:00:00 +0000 2024", "look at this https://t.co/x1",
       urls=["https://x.com/River_Otter/status/1700000000000000999"]),
    tw("1700000000000000106", "Fri Mar 08 12:00:00 +0000 2024", "hi @gone &lt;3", [("Gone", "gone", "-1", 3, 8)]),
    tw("1700000000000000107", "Sat Mar 09 13:14:15 +0000 2024", "This is the start of a long note that goes on… https://t.co/x2", truncated=True),
]
ytd(d + "tweets.js", "YTD.tweets.part0", part0)
ytd(d + "tweets-part1.js", "YTD.tweets.part1", part1)
# Not listed in the manifest: must be ignored.
ytd(d + "tweets-part9.js", "YTD.tweets.part9", [tw("1700000000000000900", "Sat Mar 09 13:14:15 +0000 2024", "stray")])
ytd(d + "account.js", "YTD.account.part0", [{"account": {"email": "owner@example.invalid", "createdVia": "web", "username": "example_org",
    "accountId": EGO, "createdAt": "2021-06-01T10:00:00.000Z", "accountDisplayName": "Example Org"}}])
ytd(d + "profile.js", "YTD.profile.part0", [{"profile": {"description": {"bio": "b", "website": "", "location": "Riverbank"}, "avatarMediaUrl": ""}}])
ytd(d + "note-tweet.js", "YTD.note_tweet.part0", [{"noteTweet": {"noteTweetId": "1700000000000000800", "createdAt": "2024-03-09T13:14:15.000Z",
    "updatedAt": "2024-03-09T13:14:15.000Z", "lifecycle": {"value": "1", "name": "Active"},
    "core": {"text": "This is the start of a long note that goes on and on well past the limit.", "mentions": [], "hashtags": [], "urls": [], "cashtags": [], "styletags": []}}}])
ytd(d + "like.js", "YTD.like.part0", [
    {"like": {"tweetId": "1600000000000000001", "fullText": "a liked tweet &amp; more", "expandedUrl": "https://twitter.com/i/web/status/1600000000000000001"}},
    {"like": {"tweetId": "1600000000000000002", "expandedUrl": "https://twitter.com/i/web/status/1600000000000000002"}}])
ytd(d + "follower.js", "YTD.follower.part0", [{"follower": {"accountId": "444000333", "userLink": "https://twitter.com/intent/user?user_id=444000333"}}])
ytd(d + "following.js", "YTD.following.part0", [
    {"following": {"accountId": "555000444", "userLink": "https://twitter.com/intent/user?user_id=555000444"}},
    {"following": {"accountId": "222000111", "userLink": "https://twitter.com/intent/user?user_id=222000111"}}])
ytd(d + "direct-messages.js", "YTD.direct_messages.part0", [{"dmConversation": {"conversationId": EGO + "-222000111", "messages": [
    {"messageCreate": {"id": "1486000000000000002", "senderId": EGO, "recipientId": "222000111", "text": "see you then", "createdAt": "2022-01-27T16:00:00.000Z", "mediaUrls": [], "urls": [], "reactions": []}},
    {"messageCreate": {"id": "1486000000000000001", "senderId": "222000111", "recipientId": EGO, "text": "meeting at 5?", "createdAt": "2022-01-27T15:58:52.744Z", "mediaUrls": [], "urls": [], "reactions": []}}]}}])
ytd(d + "direct-messages-group.js", "YTD.direct_messages_group.part0", [{"dmConversation": {"conversationId": "1612345678901234567", "messages": [
    {"messageCreate": {"id": "1712000000000000002", "senderId": "222000111", "text": "agenda attached", "createdAt": "2024-03-06T09:15:00.120Z", "mediaUrls": [], "urls": [], "reactions": []}},
    {"participantsLeave": {"userIds": ["333000222"], "createdAt": "2024-03-06T09:10:00.000Z"}},
    {"participantsJoin": {"initiatingUserId": EGO, "userIds": ["333000222"], "createdAt": "2024-03-06T09:00:00.000Z"}},
    {"conversationNameUpdate": {"initiatingUserId": EGO, "name": "Otter planning", "createdAt": "2024-03-06T08:59:00.000Z"}},
    {"joinConversation": {"initiatingUserId": "222000111", "participantsSnapshot": ["222000111", EGO], "createdAt": "2024-03-06T08:58:00.000Z"}}]}}])
with open(d + "README.txt", "w") as f: f.write("Synthetic README.\n")
os.makedirs(root + "assets/js", exist_ok=True)
with open(root + "assets/js/app.js", "w") as f: f.write("window.YTD.fake.part0 = []")

def entry(fn, glob, count): return {"fileName": fn, "globalName": glob, "count": str(count)}
manifest = {
    "userInfo": {"accountId": EGO, "userName": "example_org", "displayName": "Example Org"},
    "archiveInfo": {"sizeBytes": "4563235", "generationDate": "2025-01-22T05:46:38.082Z", "isPartialArchive": False, "maxPartSizeBytes": "53687091200"},
    "readmeInfo": {"fileName": "data/README.txt", "directory": "data/", "name": "README.txt"},
    "dataTypes": {
        "account": {"files": [entry("data/account.js", "YTD.account.part0", 1)]},
        "profile": {"files": [entry("data/profile.js", "YTD.profile.part0", 1)]},
        "tweets": {"mediaDirectory": "data/tweets_media", "files": [entry("data/tweets.js", "YTD.tweets.part0", 5), entry("data/tweets-part1.js", "YTD.tweets.part1", 3)]},
        "noteTweet": {"files": [entry("data/note-tweet.js", "YTD.note_tweet.part0", 1)]},
        "like": {"files": [entry("data/like.js", "YTD.like.part0", 2), entry("data/like-part1.js", "YTD.like.part1", 4)]},
        "follower": {"files": [entry("data/follower.js", "YTD.follower.part0", 1)]},
        "following": {"files": [entry("data/following.js", "YTD.following.part0", 2)]},
        "directMessages": {"mediaDirectory": "data/direct_messages_media", "files": [entry("data/direct-messages.js", "YTD.direct_messages.part0", 1)]},
        "directMessagesGroup": {"files": [entry("data/direct-messages-group.js", "YTD.direct_messages_group.part0", 1)]},
        "block": {"files": [entry("data/block.js", "YTD.block.part0", 0)]},
    }}
with open(d + "manifest.js", "w") as f: f.write("window.__THAR_CONFIG = " + json.dumps(manifest, indent=2))

# ---------------------------------------------------------------- legacy (2020)
shutil.rmtree("legacy", ignore_errors=True)
os.makedirs("legacy/data", exist_ok=True)
items = [tw("1250000000000000001", "Sun Mar 21 12:53:22 +0000 2021", "@river_otter hi",
            [("River Otter", "river_otter", "222000111", 0, 12)], reply=("222000111", "1250000000000000000", "river_otter"), rng=["13", "15"]),
         tw("1250000000000000002", "Mon Mar 22 08:00:00 +0000 2021", "no wrapper here", wrap=False)]
# Older archives start the array on the first line: "= [ {"
body = json.dumps(items, ensure_ascii=False)
with open("legacy/data/tweet.js", "w") as f: f.write("window.YTD.tweet.part0 = " + body)
with open("legacy/data/follower.js", "w") as f: f.write("window.YTD.follower.part0 = [ ]")
with open("legacy/data/account.js", "w") as f:
    f.write('window.YTD.account.part0 = [ {\n  "account" : {\n    "accountId" : "1100000000000000009",\n    "username" : "old_otter",\n    "accountDisplayName" : "Old Otter"\n  }\n} ]')
print("ok")
