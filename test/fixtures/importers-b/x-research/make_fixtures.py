# Synthetic X research-dataset fixtures following docs/formats/x-research-datasets.md.
# Run: python3 make_fixtures.py (from this folder).
import json, os, gzip, csv, shutil

for d in ["v2", "v2gz", "flat", "v11", "twarccsv", "json2csv", "ids", "idscsv", "gnip"]:
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d)

TW = "https://api.twitter.com/2/tweets/search/all?query=otters"
def page(data, users=(), tweets=(), errors=None):
    p = {"data": data, "includes": {"users": list(users), "tweets": list(tweets)},
         "meta": {"result_count": len(data), "next_token": "b26v89c19zqg8o3f"},
         "__twarc": {"url": TW, "version": "2.x", "retrieved_at": "2024-05-03T00:00:00+00:00"}}
    if errors: p["errors"] = errors
    return p

t201 = {"id": "1800000000000000201", "text": "@river_otter thanks! cc @pine_marten", "author_id": "100000001",
        "created_at": "2024-05-02T13:20:05.000Z", "conversation_id": "1800000000000000150", "in_reply_to_user_id": "100000002",
        "referenced_tweets": [{"type": "replied_to", "id": "1800000000000000190"}],
        "entities": {"mentions": [{"start": 0, "end": 12, "username": "river_otter", "id": "100000002"},
                                  {"start": 24, "end": 36, "username": "pine_marten", "id": "100000003"}]},
        "public_metrics": {"retweet_count": 0, "reply_count": 1, "like_count": 3, "quote_count": 0},
        "lang": "en", "edit_history_tweet_ids": ["1800000000000000201"]}
t202 = {"id": "1800000000000000202", "text": "RT @river_otter: the original text", "author_id": "100000003",
        "created_at": "2024-05-02T14:00:00.000Z", "conversation_id": "1800000000000000202",
        "referenced_tweets": [{"type": "retweeted", "id": "1800000000000000190"}], "edit_history_tweet_ids": ["1800000000000000202"]}
t203 = {"id": "1800000000000000203", "text": "worth reading", "author_id": "100000002", "created_at": "2024-05-03T09:00:00.000Z",
        "conversation_id": "1800000000000000203", "referenced_tweets": [{"type": "quoted", "id": "1800000000000000300"}],
        "edit_history_tweet_ids": ["1800000000000000203"]}
t204 = {"id": "1800000000000000204", "text": "typo versoin", "author_id": "100000001", "created_at": "2024-05-03T10:00:00.000Z",
        "conversation_id": "1800000000000000204", "edit_history_tweet_ids": ["1800000000000000204"]}
t205 = {"id": "1800000000000000205", "text": "fixed version", "author_id": "100000001", "created_at": "2024-05-03T10:01:00.000Z",
        "conversation_id": "1800000000000000204", "edit_history_tweet_ids": ["1800000000000000204", "1800000000000000205"]}
# Older-style mention with username only (no id): resolve via includes.users.
t206 = {"id": "1800000000000000206", "text": "hello @otter_lab", "author_id": "100000004", "created_at": "2024-05-03T11:00:00.000Z",
        "conversation_id": "1800000000000000206", "entities": {"mentions": [{"start": 6, "end": 16, "username": "otter_lab"}]}}
users1 = [{"id": "100000001", "username": "otter_lab", "name": "Otter Lab", "public_metrics": {"followers_count": 120, "following_count": 80}},
          {"id": "100000002", "username": "river_otter", "name": "River Otter"},
          {"id": "100000009", "username": "never_sampled", "name": "Never Sampled"}]
inc_tweets1 = [{"id": "1800000000000000190", "author_id": "100000002", "text": "...", "created_at": "2024-05-02T13:01:00.000Z"},
               {"id": "1800000000000000300", "author_id": "100000005", "text": "...", "created_at": "2024-05-01T00:00:00.000Z"}]
p1 = page([t201, t202], users1, inc_tweets1)
p2 = page([t201, t203, t204, t205, t206], [{"id": "100000003", "username": "pine_marten", "name": "Pine Marten"}], [],
          errors=[{"resource_id": "1800000000000000999", "title": "Not Found Error"}])
with open("v2/results.jsonl", "w") as f:
    for p in (p1, p2): f.write(json.dumps(p) + "\n")
with gzip.open("v2gz/results.jsonl.gz", "wt") as f:
    f.write(json.dumps(page([t201], users1, inc_tweets1)) + "\n")

# twarc2 flatten: one tweet per line, includes inlined.
flat = dict(t201)
flat["author"] = {"id": "100000001", "username": "otter_lab", "name": "Otter Lab", "public_metrics": {"followers_count": 120}}
flat["in_reply_to_user"] = {"id": "100000002", "username": "river_otter", "name": "River Otter"}
flat["entities"] = {"mentions": [dict(m, name=n) for m, n in zip(t201["entities"]["mentions"], ["River Otter", "Pine Marten"])]}
flat["referenced_tweets"] = [{"type": "replied_to", "id": "1800000000000000190", "author_id": "100000002",
                              "author": {"id": "100000002", "username": "river_otter", "name": "River Otter"}, "text": "..."}]
flat["__twarc"] = p1["__twarc"]
flat2 = dict(t202); flat2["author"] = {"id": "100000003", "username": "pine_marten", "name": "Pine Marten"}
flat2["referenced_tweets"] = [{"type": "retweeted", "id": "1800000000000000190", "author_id": "100000002", "author": {}}]
flat2["__twarc"] = p1["__twarc"]
with open("flat/results.flat.jsonl", "w") as f:
    for t in (flat, flat2): f.write(json.dumps(t) + "\n")

# API v1.1 (twarc v1). `id` is written as a bare 64-bit number, as the API does.
def u11(i, sn, name): return {"id": int(i), "id_str": i, "screen_name": sn, "name": name, "followers_count": 10, "friends_count": 5}
v1 = {"created_at": "Wed Oct 10 20:19:24 +0000 2018", "id": 1050118621198921728, "id_str": "1050118621198921728",
      "text": "To make room for more expression, we will now count all emojis as equal—including those with gender… https://t.co/x",
      "truncated": True, "user": u11("6253282", "otterapi", "Otter API"),
      "entities": {"user_mentions": []},
      "extended_tweet": {"full_text": "To make room for more expression, we will now count all emojis as equal—including those with gender and skin tone modifiers @river_otter",
                         "display_text_range": [0, 137],
                         "entities": {"user_mentions": [{"id": 2244994945, "id_str": "2244994945", "screen_name": "river_otter", "name": "River Otter", "indices": [125, 137]}]}}}
v2r = {"created_at": "Wed Oct 10 21:00:00 +0000 2018", "id": 1050118621198921729, "id_str": "1050118621198921729",
       "text": "@otterapi agreed &amp; more", "display_text_range": [10, 27], "truncated": False,
       "in_reply_to_status_id": 1050118621198921728, "in_reply_to_status_id_str": "1050118621198921728",
       "in_reply_to_user_id": 6253282, "in_reply_to_user_id_str": "6253282", "in_reply_to_screen_name": "otterapi",
       "user": u11("2244994945", "river_otter", "River Otter"),
       "entities": {"user_mentions": [{"id": 6253282, "id_str": "6253282", "screen_name": "otterapi", "name": "Otter API", "indices": [0, 9]}]}}
# reply to the reply -> same thread root as v1
v3r = {"created_at": "Wed Oct 10 21:05:00 +0000 2018", "id_str": "1050118621198921730", "text": "@river_otter yes", "display_text_range": [13, 16],
       "in_reply_to_status_id_str": "1050118621198921729", "in_reply_to_user_id_str": "2244994945", "in_reply_to_screen_name": "river_otter",
       "user": u11("6253282", "otterapi", "Otter API"), "entities": {"user_mentions": [{"id_str": "2244994945", "screen_name": "river_otter", "indices": [0, 12]}]}}
rt = {"created_at": "Thu Oct 11 08:00:00 +0000 2018", "id_str": "1050118621198921731", "text": "RT @otterapi: To make room for more expression, we will now count…",
      "user": u11("3333333", "pine_marten", "Pine Marten"), "entities": {"user_mentions": [{"id_str": "6253282", "screen_name": "otterapi", "indices": [3, 12]}]},
      "retweeted_status": dict(v1)}
qt = {"created_at": "Thu Oct 11 09:00:00 +0000 2018", "id_str": "1050118621198921732", "text": "this one", "is_quote_status": True,
      "quoted_status_id_str": "1050118621198921729", "quoted_status": v2r, "user": u11("3333333", "pine_marten", "Pine Marten"), "entities": {"user_mentions": []}}
gnip = {"verb": "post", "actor": {"id": "id:twitter.com:1"}, "object": {}, "postedTime": "2018-10-10T20:19:24.000Z"}
def dump_raw(o):
    # json.dumps writes Python ints as bare JSON numbers, so big ids stay unquoted.
    return json.dumps(o)
with open("v11/tweets.jsonl", "w") as f:
    for o in (v1, v2r, v3r, rt, qt): f.write(dump_raw(o) + "\n")
    f.write(json.dumps(gnip) + "\n")
    f.write("{not json\n")

# twarc-csv (v2) with JSON-encoded list columns.
cols = ["id", "conversation_id", "referenced_tweets.replied_to.id", "referenced_tweets.retweeted.id", "referenced_tweets.quoted.id",
        "author_id", "in_reply_to_user_id", "in_reply_to_username", "retweeted_user_id", "retweeted_username", "quoted_user_id",
        "quoted_username", "created_at", "text", "lang", "edit_history_tweet_ids", "entities.mentions", "author.id", "author.username",
        "author.name", "__twarc.retrieved_at", "__twarc.url", "__twarc.version"]
rows = [
    {"id": "1800000000000000201", "conversation_id": "1800000000000000150", "referenced_tweets.replied_to.id": "1800000000000000190",
     "author_id": "100000001", "in_reply_to_user_id": "100000002", "in_reply_to_username": "river_otter",
     "created_at": "2024-05-02T13:20:05.000Z", "text": "@river_otter thanks! cc @pine_marten\nsecond line",
     "edit_history_tweet_ids": "[\"1800000000000000201\"]",
     "entities.mentions": json.dumps(t201["entities"]["mentions"]), "author.id": "100000001", "author.username": "otter_lab", "author.name": "Otter Lab",
     "__twarc.url": TW, "__twarc.version": "2.10.4"},
    {"id": "1800000000000000202", "conversation_id": "1800000000000000202", "referenced_tweets.retweeted.id": "1800000000000000190",
     "author_id": "100000003", "retweeted_user_id": "100000002", "retweeted_username": "river_otter", "created_at": "2024-05-02T14:00:00.000Z",
     "text": "RT @river_otter: the original text", "author.username": "pine_marten", "__twarc.version": "2.10.4"},
    {"id": "1.8E+18", "author_id": "1.00000001E+8", "created_at": "2024-05-02T15:00:00.000Z", "text": "mangled", "__twarc.version": "2.10.4"},
]
with open("twarccsv/tweets.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)

# twarc v1 json2csv.
jcols = ["id", "tweet_url", "created_at", "parsed_created_at", "user_screen_name", "text", "tweet_type", "coordinates", "hashtags", "media", "urls",
         "favorite_count", "in_reply_to_screen_name", "in_reply_to_status_id", "in_reply_to_user_id", "lang", "place", "possibly_sensitive",
         "retweet_count", "retweet_or_quote_id", "retweet_or_quote_screen_name", "retweet_or_quote_user_id", "source", "user_id", "user_created_at"]
jrows = [
    {"id": "1050118621198921728", "tweet_url": "https://twitter.com/otterapi/status/1050118621198921728", "created_at": "Wed Oct 10 20:19:24 +0000 2018",
     "parsed_created_at": "2018-10-10 20:19:24+00:00", "user_screen_name": "otterapi", "text": "hello @river_otter and @unknown_one", "tweet_type": "original", "user_id": "6253282"},
    {"id": "1050118621198921729", "created_at": "Wed Oct 10 21:00:00 +0000 2018", "user_screen_name": "river_otter", "text": "@otterapi agreed",
     "tweet_type": "reply", "in_reply_to_screen_name": "otterapi", "in_reply_to_status_id": "1050118621198921728", "in_reply_to_user_id": "6253282", "user_id": "2244994945"},
    {"id": "1050118621198921731", "created_at": "Thu Oct 11 08:00:00 +0000 2018", "user_screen_name": "pine_marten", "text": "RT @otterapi: hello",
     "tweet_type": "retweet", "retweet_or_quote_id": "1050118621198921728", "retweet_or_quote_screen_name": "otterapi", "retweet_or_quote_user_id": "6253282", "user_id": "3333333"},
    {"id": "1050118621198921732", "created_at": "Thu Oct 11 09:00:00 +0000 2018", "user_screen_name": "pine_marten", "text": "quoting this",
     "tweet_type": "quote", "retweet_or_quote_id": "1050118621198921729", "retweet_or_quote_screen_name": "river_otter", "retweet_or_quote_user_id": "2244994945", "user_id": "3333333"},
]
with open("json2csv/tweets.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=jcols); w.writeheader(); w.writerows(jrows)

with open("ids/ids.txt", "w") as f: f.write("1800000000000000201\n1800000000000000202\n1050118621198921728\n")
with open("idscsv/dataset.csv", "w") as f: f.write("tweet_id\n1800000000000000201\n1800000000000000202\n")
with open("gnip/activities.jsonl", "w") as f: f.write(json.dumps(gnip) + "\n" + json.dumps(gnip) + "\n")
print("ok")
