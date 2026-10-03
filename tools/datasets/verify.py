#!/usr/bin/env python3
"""Independent check of the classic datasets with networkx: reads the RAW
files (not the converted ones) and prints the counts and known values that
test/datasets/*.test.js asserts against the app's own analysis.
Usage: python3 verify.py <raw-dir>
"""
import sys, json, re
import networkx as nx
from networkx.algorithms import bipartite
from networkx.algorithms.community import modularity
raw = sys.argv[1]
out = {}
r6 = lambda x: round(x, 6)
def top(d, k=3): return [(n, r6(v)) for n, v in sorted(d.items(), key=lambda x: (-x[1], str(x[0])))[:k]]

# karate (networkx)
G = nx.karate_club_graph()
club = [{i for i in G if G.nodes[i]['club'] == c} for c in ('Mr. Hi', 'Officer')]
out['karate'] = {'n': G.number_of_nodes(), 'm': G.number_of_edges(), 'density': r6(nx.density(G)),
  'betweenness_top': top(nx.betweenness_centrality(G)), 'faction_modularity': r6(modularity(G, club, weight=None)),
  'transitivity': r6(nx.transitivity(G)), 'total_weight': sum(d['weight'] for *_, d in G.edges(data=True))}

# florentine marriage + Pucci
F = nx.florentine_families_graph(); F.add_node('Pucci')
b = nx.betweenness_centrality(F)
out['florentine'] = {'n': F.number_of_nodes(), 'm': F.number_of_edges(), 'betweenness_top': top(b), 'degree_medici': F.degree('Medici'),
  'degree': {k: F.degree(k) for k in ('Medici', 'Strozzi', 'Guadagni')}}

# davis
D = nx.davis_southern_women_graph(); W = D.graph['top']; E = D.graph['bottom']
P = bipartite.weighted_projected_graph(D, W)
out['davis'] = {'women': len(W), 'events': len(E), 'm': D.number_of_edges(), 'density': r6(bipartite.density(D, W)),
  'most_events': top({w: D.degree(w) for w in W}), 'largest_event': top({e: D.degree(e) for e in E}),
  'projection_edges': P.number_of_edges(), 'deg_centrality_top': top({k: v for k, v in bipartite.degree_centrality(D, W).items() if k in W}),
  'betweenness_top_women': top({k: v for k, v in bipartite.betweenness_centrality(D, W).items() if k in W})}

# les mis
L = nx.read_gml(f'{raw}/mejn_lesmis/lesmis.gml')
out['lesmis'] = {'n': L.number_of_nodes(), 'm': L.number_of_edges(), 'total_weight': sum(d['value'] for *_, d in L.edges(data=True)),
  'degree_top': top(dict(L.degree())), 'strength_top': top(dict(L.degree(weight='value'))), 'betweenness_top': top(nx.betweenness_centrality(L))}

# dolphins
Do = nx.read_gml(f'{raw}/mejn_dolphins/dolphins.gml')
split = json.load(open(f'{raw}/dolphins_gn_split.json'))
out['dolphins'] = {'n': Do.number_of_nodes(), 'm': Do.number_of_edges(), 'density': r6(nx.density(Do)), 'transitivity': r6(nx.transitivity(Do)),
  'betweenness_top': top(nx.betweenness_centrality(Do)), 'split_modularity': r6(modularity(Do, [set(split['smaller']), set(split['larger'])]))}

# UCINET files
def dl(path):
    t = open(path).read().replace('\r', '').split('\n'); i = 1; head = {}; block = None; rl = []; lv = []
    while i < len(t):
        l = t[i].strip(); i += 1
        if not l: continue
        if l.upper().startswith('DATA:'): break
        m = re.match(r'^(ROW LABELS|COLUMN LABELS|LEVEL LABELS|LABELS):?$', l, re.I)
        if m: block = m.group(1).upper(); continue
        if '=' in l:
            for k, v in re.findall(r'(\w+)\s*=\s*([\w ]+?)(?=\s+\w+\s*=|$)', l): head[k.upper()] = v.strip()
            block = None; continue
        if block in ('ROW LABELS', 'LABELS'): rl.append(l)
        elif block == 'LEVEL LABELS': lv.append(l)
    nums = list(map(float, ' '.join(t[i:]).split()))
    n = int(head.get('N', 0)); nr = int(head.get('NR', n)); nc = int(head.get('NC', n)); nm = int(head.get('NM', 1))
    return rl, lv, [[nums[k*nr*nc + r*nc:k*nr*nc + (r+1)*nc] for r in range(nr)] for k in range(nm)]
def graph(M, directed):
    g = nx.DiGraph() if directed else nx.Graph(); g.add_nodes_from(range(len(M)))
    g.add_edges_from((i, j) for i in range(len(M)) for j in range(len(M)) if i != j and M[i][j]); return g

rl, lv, Ms = dl(f'{raw}/padgett.dat')
FM = graph(Ms[lv.index('PADGM')], False); FB = graph(Ms[lv.index('PADGB')], False)
out['florentine_full'] = {'marriage': FM.number_of_edges(), 'business': FB.number_of_edges(),
  'marriage_betweenness_top': [(rl[i], v) for i, v in top(nx.betweenness_centrality(FM))],
  'same_marriage_as_networkx': sorted(tuple(sorted((rl[a], rl[b]))) for a, b in FM.edges()) == sorted(tuple(sorted((x.upper()[:9], y.upper()[:9]))) for x, y in nx.florentine_families_graph().edges())}

_, _, AD = dl(f'{raw}/krackad.dat'); _, _, FR = dl(f'{raw}/krackfr.dat')
adv = nx.DiGraph(); adv.add_nodes_from(range(21)); adv.add_edges_from((i, j) for i in range(21) for j in range(21) if i != j and AD[i][i][j])
fr = nx.DiGraph(); fr.add_nodes_from(range(21)); fr.add_edges_from((i, j) for i in range(21) for j in range(21) if i != j and FR[i][i][j])
K = json.load(open(f'{raw}/kracknets.json'))
out['krackhardt'] = {'advice': adv.number_of_edges(), 'friendship': fr.number_of_edges(), 'reports_to': len(K['reportsTo']),
  'advice_in_top': top({f'Manager {i+1}': d for i, d in adv.in_degree()}), 'advice_reciprocity': r6(nx.reciprocity(adv)), 'friendship_reciprocity': r6(nx.reciprocity(fr)),
  'advice_density': r6(nx.density(adv))}

pj = open(f'{raw}/Sampson.paj').read()
rl, lv, Ms = dl(f'{raw}/sampson.dat')
out['sampson'] = {'ucinet_like_T2_T3_T4': [graph(Ms[k], True).number_of_edges() for k in range(3)], 'ucinet_labels': rl}

rl, lv, Ms = dl(f'{raw}/kaptail.dat')
gs = {l: graph(Ms[k], l.startswith('KAPFTI')) for k, l in enumerate(lv)}
out['kapferer'] = {l: g.number_of_edges() for l, g in gs.items()}
out['kapferer']['density'] = {l: r6(nx.density(g)) for l, g in gs.items()}
out['kapferer']['TS2_degree_top'] = [(rl[i], v) for i, v in top(dict(gs['KAPFTS2'].degree()))]

rl, lv, Ms = dl(f'{raw}/newfrat.dat')
top3 = {l: nx.DiGraph([(i, j) for i in range(17) for j in range(17) if i != j and Ms[k][i][j] <= 3]) for k, l in enumerate(lv)}
out['newcomb'] = {'weeks': lv, 'arcs_per_week': len(Ms[0]) * 16, 'top3_reciprocity': {l: r6(nx.reciprocity(g)) for l, g in top3.items()}}

rl, lv, Ms = dl(f'{raw}/wiring.dat')
gw = {l: graph(Ms[k], l in ('RDHLP', 'RDJOB')) for k, l in enumerate(lv)}
out['wiring'] = {l: g.number_of_edges() for l, g in gw.items()}
GF = nx.Graph(); GF.add_nodes_from(range(14)); GF.add_edges_from(gw['RDGAM'].edges()); GF.add_edges_from(gw['RDPOS'].edges())
CL = {'W1': 'A', 'W3': 'A', 'W4': 'A', 'S1': 'A', 'I1': 'A', 'W7': 'B', 'W8': 'B', 'W9': 'B', 'S4': 'B'}
grp = [CL.get(rl[i], 'Neither') for i in range(14)]
ext = sum(1 for a, b in GF.edges() if grp[a] != grp[b]); inn = GF.number_of_edges() - ext
out['wiring']['games_or_friendship'] = {'ties': GF.number_of_edges(), 'within': inn, 'between': ext, 'ei': r6((ext - inn) / GF.number_of_edges())}
print(json.dumps(out, indent=1))
