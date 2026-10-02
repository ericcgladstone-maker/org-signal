#!/usr/bin/env python3
"""Reference values from networkx for the analysis engine's tests.

Builds a fixed set of small reference graphs, computes every metric networkx
implements with the definitions the engine uses (see docs/api/analysis.md),
and writes one JSON fixture per graph to test/fixtures/analysis/.

Run from app/:  python3 tools/analysis/make-references.py
Requires networkx 3.2 (numpy/scipy optional). Output is deterministic.

Conventions mirrored here so the comparison is exact:
  - Weighted path measures use distance = 1 / weight, as exact fractions.
  - Betweenness: normalized=True (raw / ((n-1)(n-2)) for both directed and
    undirected graphs in networkx's own scaling).
  - Harmonic closeness is divided by (n - 1); networkx does not normalise it.
  - Eigenvector, clustering, k-core, transitivity and modularity are computed
    on the symmetrised graph U: an undirected tie wherever either direction
    exists, weight = w(a,b) + w(b,a).
  - Constraint and effective size use networkx directly on G with weight=.
"""
import json
import math
import os
import random
from fractions import Fraction

import networkx as nx

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'test', 'fixtures', 'analysis')


def symmetrise(G):
    U = nx.Graph()
    U.add_nodes_from(G.nodes())
    for a, b, d in G.edges(data=True):
        w = d.get('weight', 1)
        if U.has_edge(a, b):
            U[a][b]['weight'] += w
        else:
            U.add_edge(a, b, weight=w)
    return U


def binary(G):
    H = G.__class__()
    H.add_nodes_from(G.nodes(data=True))
    H.add_edges_from((a, b, {'weight': 1}) for a, b in G.edges())
    return H


def clean(x):
    if x is None:
        return None
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    return x


def vec(G, d):
    return [clean(d.get(v)) for v in sorted(G.nodes())]


def with_dist(G):
    # Exact rational distances: with floats, 1/3 + 1/6 != 1/2 and networkx's
    # exact-equality tie test silently drops equal-length paths (karate club
    # node 0 differs by 1e-3). The engine detects ties with a relative
    # tolerance, which agrees with exact arithmetic.
    H = G.copy()
    for a, b, d in H.edges(data=True):
        d['dist'] = Fraction(1, int(d.get('weight', 1)))
    return H


def node_metrics(G, prefix=''):
    n = G.number_of_nodes()
    U = symmetrise(G)
    H = with_dist(G)
    m = {}
    if G.is_directed():
        m['inDegree'] = vec(G, dict(G.in_degree()))
        m['outDegree'] = vec(G, dict(G.out_degree()))
        m['inStrength'] = vec(G, dict(G.in_degree(weight='weight')))
        m['outStrength'] = vec(G, dict(G.out_degree(weight='weight')))
    m['degree'] = vec(G, dict(G.degree()))
    m['strength'] = vec(G, dict(G.degree(weight='weight')))
    m['betweenness'] = vec(G, nx.betweenness_centrality(G, normalized=True))
    m['betweennessWeighted'] = vec(G, {k: float(v) for k, v in nx.betweenness_centrality(H, normalized=True, weight='dist').items()})
    scale = 1.0 / (n - 1) if n > 1 else 0
    m['closeness'] = vec(G, {k: v * scale for k, v in nx.harmonic_centrality(G).items()})
    m['closenessWeighted'] = vec(G, {k: float(v) * scale for k, v in nx.harmonic_centrality(H, distance='dist').items()})
    if U.number_of_edges():
        m['eigenvector'] = vec(G, nx.eigenvector_centrality(U, weight='weight', max_iter=100000, tol=1e-14))
    m['pagerank'] = vec(G, nx.pagerank(G, weight='weight', tol=1e-14, max_iter=100000))
    m['clustering'] = vec(G, nx.clustering(nx.Graph(U)))
    m['coreNumber'] = vec(G, nx.core_number(nx.Graph(U)))
    if G.is_directed():
        m['reciprocity'] = vec(G, dict(nx.reciprocity(G, list(G.nodes()))))
    m['constraint'] = vec(G, nx.constraint(G, weight='weight'))
    m['effectiveSize'] = vec(G, nx.effective_size(G, weight='weight'))
    return m


def network_metrics(G, membership=None, attr=None, numattr=None):
    U = symmetrise(G)
    r = {
        'density': nx.density(G),
        'transitivity': nx.transitivity(U),
        'avgClustering': nx.average_clustering(U),
        'components': nx.number_connected_components(U),
    }
    if G.is_directed():
        r['reciprocity'] = nx.overall_reciprocity(G)
    if G.number_of_edges():
        r['degreeAssortativity'] = clean(nx.degree_assortativity_coefficient(G))
    if nx.is_connected(U) and not G.is_directed():
        r['avgPathLength'] = nx.average_shortest_path_length(G)
    if G.is_directed() and nx.is_strongly_connected(G):
        r['avgPathLength'] = nx.average_shortest_path_length(G)
    if membership is not None and U.number_of_edges():
        parts = {}
        for v, c in enumerate(membership):
            parts.setdefault(c, set()).add(v)
        r['modularity'] = nx.community.modularity(U, list(parts.values()), weight='weight')
    if attr is not None and G.number_of_edges():
        r['attrAssortativity'] = clean(nx.attribute_assortativity_coefficient(G, 'grp'))
    if numattr is not None and G.number_of_edges():
        r['numericAssortativity'] = clean(nx.numeric_assortativity_coefficient(G, 'num'))
    return r


def write(name, G, note, membership=None, attr_seed=0, groups=3):
    n = G.number_of_nodes()
    assert sorted(G.nodes()) == list(range(n))
    rnd = random.Random(attr_seed)
    attr = [G.nodes[v].get('grp', 'g%d' % rnd.randrange(groups)) for v in range(n)]
    numattr = [G.nodes[v].get('num', rnd.randrange(1, 6)) for v in range(n)]
    for v in range(n):
        G.nodes[v]['grp'] = attr[v]
        G.nodes[v]['num'] = numattr[v]
    if membership is None:
        U = symmetrise(G)
        comms = nx.community.greedy_modularity_communities(U, weight='weight') if U.number_of_edges() else [{v} for v in range(n)]
        membership = [0] * n
        for c, members in enumerate(sorted(comms, key=lambda s: min(s))):
            for v in members:
                membership[v] = c
    B = binary(G)
    fx = {
        'name': name,
        'note': note,
        'networkx': nx.__version__,
        'directed': G.is_directed(),
        'n': n,
        'edges': [[a, b, G[a][b].get('weight', 1)] for a, b in sorted(G.edges())],
        'attr': attr,
        'numattr': numattr,
        'membership': membership,
        'weighted': {'node': node_metrics(G), 'network': network_metrics(G, membership, attr, numattr)},
        'binary': {'node': node_metrics(B), 'network': network_metrics(B, membership, attr, numattr)},
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name + '.json'), 'w') as f:
        json.dump(fx, f, indent=1, sort_keys=True)
    print('wrote', name, n, 'nodes', G.number_of_edges(), 'edges')


def main():
    # 1. Zachary karate club with networkx's interaction counts as weights.
    K = nx.karate_club_graph()
    for v in K.nodes():
        K.nodes[v]['grp'] = K.nodes[v]['club']
    write('karate', K, "Zachary's karate club; weights are networkx's interaction counts; grp = club")

    # 2. Directed weighted random graph (some reciprocity, some dangling nodes).
    rnd = random.Random(7)
    D = nx.gnp_random_graph(30, 0.12, seed=7, directed=True)
    for a, b in D.edges():
        D[a][b]['weight'] = rnd.randint(1, 5)
    write('directed-weighted', D, 'G(n=30, p=0.12) directed, integer weights 1..5', attr_seed=1)

    # 3. Disconnected: two dense groups and a path, no edges between them.
    X = nx.disjoint_union_all([nx.complete_graph(5), nx.cycle_graph(6), nx.path_graph(4)])
    rnd = random.Random(3)
    for a, b in X.edges():
        X[a][b]['weight'] = rnd.randint(1, 3)
    write('disconnected', X, 'K5 + C6 + P4, three components, weights 1..3', attr_seed=2)

    # 4. Isolates: small connected graph plus three isolated nodes.
    Iso = nx.Graph()
    Iso.add_nodes_from(range(10))
    Iso.add_weighted_edges_from([(0, 1, 2), (1, 2, 1), (2, 0, 1), (2, 3, 3), (3, 4, 1), (4, 5, 2), (5, 6, 1), (6, 3, 1)])
    write('isolates', Iso, 'seven connected nodes and isolates 7, 8, 9', attr_seed=3)

    # 5. Bipartite-ish: random bipartite graph plus one within-side edge.
    Bp = nx.bipartite.random_graph(6, 8, 0.4, seed=11)
    Bp = nx.convert_node_labels_to_integers(Bp)
    Bp.add_edge(0, 1)
    rnd = random.Random(5)
    for a, b in Bp.edges():
        Bp[a][b]['weight'] = rnd.randint(1, 4)
    for v in Bp.nodes():
        Bp.nodes[v]['grp'] = 'left' if v < 6 else 'right'
    write('bipartite', Bp, 'random bipartite 6 x 8, p=0.4, plus edge 0-1 within the left side', attr_seed=4)

    # 6. Star with 8 leaves (pure bipartite: exercises eigenvector on A + I).
    S = nx.star_graph(8)
    write('star', S, 'star, centre 0, 8 leaves, unweighted', attr_seed=5)

    # 7. Small directed ego network: ego 0, 8 alters, some alter-alter ties.
    E = nx.DiGraph()
    E.add_nodes_from(range(9))
    for a in range(1, 9):
        E.add_edge(0, a, weight=1 + (a % 3))
        if a % 2 == 0:
            E.add_edge(a, 0, weight=2)
    E.add_weighted_edges_from([(1, 2, 1), (2, 1, 1), (3, 4, 2), (5, 6, 1), (6, 7, 1), (7, 5, 3), (8, 1, 1)])
    write('ego', E, 'directed ego network, ego = 0', attr_seed=6)


if __name__ == '__main__':
    main()
