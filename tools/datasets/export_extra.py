#!/usr/bin/env python3
"""Prepare the remaining raw inputs for build.mjs (needs the `rdata` package):
  kracknets.json         attributes and reports-to ties from NetData's kracknets.rda
                         (CRAN archive NetData_0.3, GPL-2; ported from UCINET)
  dolphins_gn_split.json the first Girvan-Newman split of Newman's dolphins.gml
                         (networkx girvan_newman, the method of Newman & Girvan 2004)
Usage: python3 export_extra.py <raw-dir>
"""
import sys, json, warnings
warnings.filterwarnings('ignore')
import rdata, networkx as nx
from networkx.algorithms.community import girvan_newman
raw = sys.argv[1]
c = rdata.conversion.convert(rdata.parser.parse_file(f'{raw}/NetData/data/kracknets.rda'))
att = c['attributes']
full = c['krack_full_data_frame']
json.dump({'attributes': [{k: (float(r[k]) if k == 'TENURE' else int(r[k])) for k in ('AGE', 'TENURE', 'LEVEL', 'DEPT')} for _, r in att.iterrows()],
           'reportsTo': sorted([int(r.ego), int(r.alter)] for r in full.itertuples() if r.reports_to_tie == 1)},
          open(f'{raw}/kracknets.json', 'w'))
D = nx.read_gml(f'{raw}/mejn_dolphins/dolphins.gml', label='id')
names = nx.get_node_attributes(D, 'label')
a, b = next(girvan_newman(D))
small, large = sorted([a, b], key=len)
json.dump({'method': 'networkx %s girvan_newman, first split' % nx.__version__, 'smaller': sorted(names[i] for i in small), 'larger': sorted(names[i] for i in large)},
          open(f'{raw}/dolphins_gn_split.json', 'w'))
print('ok', len(small), len(large))
