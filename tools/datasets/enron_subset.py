#!/usr/bin/env python3
"""Stage 2 of the Enron conversion: the core-employee, header-only subset.

Input:  the TSV from enron_headers.py, and EnronData.org's custodian table
        (edo_enron-custodians-data.html, CC BY 3.0 US: mailbox, name, title).
Output: enron-core.json, a compact intermediate read by build.mjs:
        { custodians: [{ id, name, title, addresses[] }],
          messages: [[message_id, t, sender, [[custodian, role], ...], thread, all_recipients]],
          stats: {...} }

Who is "core". The 150 CMU mailboxes belong to 148 people (EnronData.org:
phanis-s duplicates panus-s, whalley-l duplicates whalley-g; crandell-s and
rodrique-r are misspellings). Each person's addresses are found in their own
mailbox: the From addresses of their sent folders, and the @enron.com
addresses that receive their mail, kept only when the address matches the
person's surname and first name (or first initial) and accounts for at least
5% of that mailbox. Messages sent from a mailbox by an assistant under the
assistant's own address are the assistant's, so they are left out.

Which messages. A message is kept when its sender is core and at least one
To/Cc/Bcc recipient other than the sender is core; only the core recipients
are kept (all_recipients records how many addresses it went to in all). The
same message is filed in several mailboxes (sender's sent folder, each
recipient's inbox, other folders) under different Message-IDs, so copies are
merged on (sender, time, subject digest, body digest, recipients); the first
Message-ID seen is kept. Dates outside 1998-2002 are corrupt and dropped.

Bcc. In this corpus the Bcc header repeats the Cc list (an artifact of the
conversion from Lotus Notes / Outlook). A Bcc address that is also in Cc is
dropped as a duplicate; a Bcc address not in Cc is kept as bcc.

Threads. The headers carry no In-Reply-To or References, so a thread is the
messages that share a normalized subject (Re:/Fw: stripped) with no gap of
more than 30 days; an empty subject starts no thread. Thread ids are short
digests, never subjects.
"""
import sys, json, re, html, hashlib
from collections import Counter, defaultdict

DUP = {'phanis-s': 'panus-s', 'whalley-l': 'whalley-g', 'crandell-s': 'crandall-s', 'rodrique-r': 'rodrigue-r'}
T0, T1 = 883612800000, 1041379200000  # 1998-01-01 .. 2003-01-01 UTC

def custodians(path):
    t = html.unescape(re.sub(r'<[^>]+>', '|', open(path, encoding='utf-8').read()))
    t = re.sub(r'\|+', '|', t)
    out = {}
    cells = [x.strip() for x in t.split('|')]
    i = 0
    while i < len(cells) - 3:
        if cells[i].isdigit() and re.fullmatch(r'[a-z][a-z0-9-]*-[a-z0-9]+', cells[i + 1] or ''):
            cid, name, status = cells[i + 1], cells[i + 2], cells[i + 3]
            j = i + 4
            title = cells[j] if j < len(cells) and cells[j] and not cells[j].isdigit() else ''
            if status == 'N/A': status = ''
            out[cid] = {'id': cid, 'name': name, 'status': status, 'title': title}
            i = j
        else:
            i += 1
    return out

def tokens(s):
    return [x for x in re.split(r"[^a-z]+", s.lower().replace("'", '')) if x]

# First names and the short forms the addresses use.
NICK = {'michael': 'mike', 'lawrence': 'larry', 'william': 'bill', 'matthew': 'matt', 'bradley': 'brad',
        'jeffery': 'jeff', 'jeffrey': 'jeff', 'kenneth': 'ken', 'douglas': 'doug', 'geoffery': 'geoff', 'harpreet': 'harry',
        'daron': 'darron', 'phillip': 'phil', 'philip': 'phillip', 'andrew': 'andy', 'thomas': 'tom', 'james': 'jim'}

def first_ok(head, f):
    for g in (f, NICK.get(f, f)):
        if g.startswith(head[:3]) or head.startswith(g[:3]): return True
    return False

def matches(addr, first, last_tokens, strict_first):
    local, _, dom = addr.partition('@')
    # '.taylor@enron.com' and the like are names the conversion mangled; they
    # cannot be told apart from other people with the same surname.
    if not dom.endswith('enron.com') or local.startswith('.'): return False
    lt = tokens(local)
    flat = ''.join(lt)
    if not any(len(x) >= 3 and x[:6] in flat for x in last_tokens): return False
    f = first.lower()
    if len(lt) >= 2:
        head = lt[0]
        if len(head) == 1:  # a middle initial: k..allen
            return not strict_first
        return first_ok(head, f)
    # one token: klay, pallen, lcampbel, or a bare surname
    one = lt[0]
    if one in last_tokens: return not strict_first
    return one[0] in (f[0], NICK.get(f, f)[0]) and any(one[1:].startswith(x[:min(len(x), 5)]) or x.startswith(one[1:]) for x in last_tokens)

def main(tsv, custfile, out):
    cust = custodians(custfile)
    assert len(cust) == 148, len(cust)
    sent = defaultdict(Counter); recv = defaultdict(Counter); total = Counter()
    rows = []
    for line in open(tsv, encoding='utf-8'):
        f = line.rstrip('\n').split('\t')
        if len(f) != 10: continue
        owner = DUP.get(f[0], f[0]); f[0] = owner
        rows.append(f)
        total[owner] += 1
        if 'sent' in f[1].lower(): sent[owner][f[4]] += 1
        else:
            for a in set(filter(None, (f[5] + ',' + f[6]).split(','))): recv[owner][a] += 1
    addr2c = {}
    for cid, c in cust.items():
        parts = c['name'].replace('.', ' ').split()
        # "Lawrence Greg Whalley" goes by his middle name.
        fi = 1 if parts[0].lower() == 'lawrence' and len(parts) >= 3 else 0
        first = parts[fi]
        last = [x for x in tokens(' '.join(parts[fi + 1:])) if x not in ('iii', 'jr', 'p')]
        if cid == 'gilbertsmith-d': last = ['gilbert', 'smith']
        if cid == 'griffith-j': last = ['griffith']
        # Any other first name in the same mailbox for this surname means
        # initials are ambiguous (hodge-j holds John and Jeffrey T. Hodge).
        others = {tokens(a.split('@')[0])[0] for a in sent[cid] if len(tokens(a.split('@')[0])) >= 2 and any(x[:6] in a for x in last if len(x) >= 3)}
        strict = any(len(o) > 1 and not first_ok(o, first.lower()) for o in others)
        st, rt = sum(sent[cid].values()) or 1, max(recv[cid].values() or [1])
        found = []
        for a, n in sent[cid].items():
            if n / st >= 0.05 and matches(a, first, last, strict): found.append(a)
        for a, n in recv[cid].items():
            if n / rt >= 0.05 and matches(a, first, last, strict) and a not in found: found.append(a)
        c['addresses'] = found
        for a in found:
            if a in addr2c and addr2c[a] != cid: print('collision', a, addr2c[a], cid, file=sys.stderr)
            addr2c.setdefault(a, cid)
    ids = sorted(cust)
    idx = {c: i for i, c in enumerate(ids)}
    seen = {}
    msgs = []
    drop = Counter()
    for f in rows:
        owner, folder, mid, t, fr, to, cc, bcc, subj, body = f
        s = addr2c.get(fr)
        if s is None: continue
        if not t or not (T0 <= int(t) < T1): drop['date'] += 1; continue
        t = int(t)
        to_l = [a for a in to.split(',') if a]; cc_l = [a for a in cc.split(',') if a]
        bcc_l = [a for a in bcc.split(',') if a and a not in set(cc_l)]
        allr = len(set(to_l) | set(cc_l) | set(bcc_l))
        tg, roles = [], {}
        for role, lst in (('to', to_l), ('cc', cc_l), ('bcc', bcc_l)):
            for a in lst:
                c = addr2c.get(a)
                if c is None or c == s or c in roles: continue
                roles[c] = role
        if not roles: continue
        tg = sorted((idx[c], r) for c, r in roles.items())
        k = (s, t, subj, body, tuple(tg))
        if k in seen: drop['duplicate'] += 1; continue
        seen[k] = True
        msgs.append([mid, t, idx[s], tg, subj, allr])
    msgs.sort(key=lambda m: (m[1], m[0]))
    # threads: same subject digest, gaps of at most 30 days
    EMPTY = hashlib.sha1(b'').hexdigest()[:12]
    last_t, cur, nthreads = {}, {}, 0
    for m in msgs:
        sk = m[4]
        if sk == EMPTY: m[4] = None; continue
        if sk not in last_t or m[1] - last_t[sk] > 30 * 86400000:
            nthreads += 1
            cur[sk] = hashlib.sha1(f'{sk}:{m[1]}'.encode()).hexdigest()[:10]
        last_t[sk] = m[1]
        m[4] = cur[sk]
    used = Counter(m[2] for m in msgs) + Counter(c for m in msgs for c, _ in m[3])
    stats = {'mailboxes': len(set(r[0] for r in rows)), 'custodians': len(ids), 'files': len(rows),
             'kept': len(msgs), 'dropped': dict(drop), 'threads': nthreads,
             'people_with_messages': len(used), 'first': min(m[1] for m in msgs), 'last': max(m[1] for m in msgs),
             'roles': dict(Counter(r for m in msgs for _, r in m[3]))}
    json.dump({'custodians': [{**cust[c], 'index': idx[c]} for c in ids], 'messages': msgs, 'stats': stats}, open(out, 'w'), separators=(',', ':'))
    print(json.dumps(stats, indent=1), file=sys.stderr)
    for c in ids:
        if not cust[c]['addresses']: print('NO ADDRESS', c, file=sys.stderr)

if __name__ == '__main__':
    main(*sys.argv[1:4])
