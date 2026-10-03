#!/bin/bash
# fetch.sh <raw-dir>: download every raw file the classic datasets are built
# from, then prepare the derived inputs, then build.
#
#   tools/datasets/fetch.sh /tmp/classic-raw && node tools/datasets/build.mjs --raw /tmp/classic-raw
#
# Needs curl, python3 with networkx (3.2.1 was used) and the `rdata` package
# (pip install rdata), and about 2 GB of disk for the Enron tarball and its
# header table. The vlado.fmf.uni-lj.si server (UCINET IV and Pajek ESNA
# collections) was unreachable on 2026-10-03, so its files come from the
# Internet Archive's copies; Mark Newman's page is behind a browser check,
# so its zips come from the archive too. See docs/datasets.md.

set -euo pipefail
RAW="${1:?usage: fetch.sh <raw-dir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$RAW" && cd "$RAW"
WB=http://web.archive.org/web/2023id_
UCI=http://vlado.fmf.uni-lj.si/pub/networks/data/ucinet

for f in davis kaptail krackad krackfr newfrat padgett padgw wiring sampson zachary; do
  curl -sSLf -o "$f.dat" "$WB/$UCI/$f.dat"
done
curl -sSLf -o ucidata.htm "$WB/$UCI/ucidata.htm"
curl -sSLf -o esna_Sampson.zip "$WB/http://vlado.fmf.uni-lj.si/pub/networks/data/esna/Sampson.zip"
unzip -o -q esna_Sampson.zip -d esna_sampson && cp esna_sampson/Sampson.paj .
for f in dolphins lesmis karate; do
  curl -sSLf -o "$f.zip" "http://web.archive.org/web/2024id_/http://www-personal.umich.edu/~mejn/netdata/$f.zip"
  unzip -o -q "$f.zip" -d "mejn_$f"
done
curl -sSLf -o jean.dat https://raw.githubusercontent.com/ascherer/sgb/master/jean.dat
curl -sSLf -o NetData_0.3.tar.gz https://cran.r-project.org/src/contrib/Archive/NetData/NetData_0.3.tar.gz
tar xzf NetData_0.3.tar.gz
curl -sSLf -o edo_enron-custodians-data.html https://raw.githubusercontent.com/enrondata/enrondata/master/data/misc/edo_enron-custodians-data.html
[ -f enron_mail_20150507.tar.gz ] || curl -sSLf -o enron_mail_20150507.tar.gz https://www.cs.cmu.edu/~enron/enron_mail_20150507.tar.gz

python3 "$HERE/export_networkx.py" "$RAW"
python3 "$HERE/export_extra.py" "$RAW"
[ -f enron_headers.tsv ] || python3 "$HERE/enron_headers.py" enron_mail_20150507.tar.gz enron_headers.tsv
python3 "$HERE/enron_subset.py" enron_headers.tsv edo_enron-custodians-data.html enron-core.json
echo "raw files ready in $RAW"
