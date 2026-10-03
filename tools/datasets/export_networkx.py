#!/usr/bin/env python3
"""Write the classic graphs that ship inside networkx (BSD-3) as plain JSON,
so build.mjs reads them without Python. Usage: python3 export_networkx.py <raw-dir>
"""
import sys, json, networkx as nx
out = sys.argv[1]
G = nx.karate_club_graph()
json.dump({'networkx': nx.__version__, 'nodes': [{'id': i, 'club': G.nodes[i]['club']} for i in G],
           'edges': [[u, v, d.get('weight', 1)] for u, v, d in G.edges(data=True)]}, open(f'{out}/nx_karate.json', 'w'))
F = nx.florentine_families_graph()
json.dump({'networkx': nx.__version__, 'nodes': sorted(F.nodes()), 'edges': [sorted(e) for e in F.edges()]}, open(f'{out}/nx_florentine.json', 'w'))
D = nx.davis_southern_women_graph()
json.dump({'networkx': nx.__version__, 'women': D.graph['top'], 'events': D.graph['bottom'],
           'edges': [[u, v] if u in D.graph['top'] else [v, u] for u, v in D.edges()]}, open(f'{out}/nx_davis.json', 'w'))
L = nx.les_miserables_graph()
json.dump({'networkx': nx.__version__, 'nodes': list(L.nodes()), 'edges': [[u, v, d['weight']] for u, v, d in L.edges(data=True)]}, open(f'{out}/nx_lesmis.json', 'w'))
print('ok', nx.__version__)
