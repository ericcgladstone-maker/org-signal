#!/usr/bin/env python3
"""Stage 1 of the Enron conversion: read headers from the CMU tarball.

Streams enron_mail_20150507.tar.gz (CMU, William Cohen's May 7 2015 release)
without unpacking it and writes one TSV line per message file:

  owner  folder  message_id  date_ms  from  to  cc  bcc  subject_key  body_key

Message text and subjects are NOT written: subject_key is the first 12 hex
characters of SHA-1 over the normalized subject (Re:/Fw: prefixes stripped,
lower case, whitespace collapsed), kept only to group messages into threads
and to recognise the same message filed in several mailboxes; body_key is the
same digest over the body, used only to recognise duplicates. Neither can be
turned back into text except by guessing it.

Usage: python3 enron_headers.py <tarball> <out.tsv>
"""
import sys, tarfile, hashlib, re
from email.parser import BytesHeaderParser
from email.utils import parsedate_to_datetime, getaddresses
from email import policy

def norm_subject(s):
    s = (s or '').strip().lower()
    while True:
        t = re.sub(r'^\s*(re|fw|fwd)\s*(\[\d+\])?\s*:\s*', '', s)
        if t == s: break
        s = t
    return re.sub(r'\s+', ' ', s).strip()

def key(s):
    return hashlib.sha1(s.encode('utf-8', 'replace')).hexdigest()[:12]

def addrs(v):
    if not v: return ''
    # Enron headers fold long lists over several lines; getaddresses copes.
    out = []
    for _, a in getaddresses([str(v).replace('\n', ' ').replace('\t', ' ')]):
        a = a.strip().lower().strip("'\"<>")
        if '@' in a: out.append(a)
    return ','.join(dict.fromkeys(out))

def main(src, dst):
    parser = BytesHeaderParser(policy=policy.compat32)
    n = 0
    with tarfile.open(src, 'r|gz') as tar, open(dst, 'w') as out:
        for m in tar:
            if not m.isfile(): continue
            parts = m.name.split('/')
            # maildir/<owner>/<folder...>/<file>
            if len(parts) < 4 or parts[0] != 'maildir': continue
            owner, folder = parts[1], '/'.join(parts[2:-1])
            raw = tar.extractfile(m).read()
            head, _, body = raw.partition(b'\r\n\r\n') if b'\r\n\r\n' in raw[:20000] else raw.partition(b'\n\n')
            h = parser.parsebytes(head + b'\n\n')
            try:
                t = int(parsedate_to_datetime(h.get('Date')).timestamp() * 1000)
            except Exception:
                t = ''
            row = [owner, folder, (h.get('Message-ID') or '').strip(), str(t), addrs(h.get('From')),
                   addrs(h.get('To')), addrs(h.get('Cc')), addrs(h.get('Bcc')),
                   key(norm_subject(h.get('Subject'))), key(body.decode('latin-1').strip())]
            out.write('\t'.join(x.replace('\t', ' ') for x in row) + '\n')
            n += 1
            if n % 50000 == 0: print(n, file=sys.stderr, flush=True)
    print('messages', n, file=sys.stderr)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
