#!/usr/bin/env python3
"""Independent reference values for the accuracy campaign.

Usage: python3 tools/accuracy/reference.py in.json out.json

in.json is a list of jobs { id, n, directed, edges: [[a, b, w]] (simple:
no loops, duplicates already summed), exact: bool, cat: [str|null],
num: [int|null], membership: [int] | null, resolution }. out.json maps id ->
{ node: {...}, network: {...}, groups: {...} }.

Sources, per measure (see docs/accuracy.md for why each one):
  networkx 3.2: betweenness (normalized=True), harmonic closeness (divided by
    n - 1 here), clustering, core number, node and overall reciprocity,
    constraint and effective size (weight=, mutual weights), density,
    transitivity, average clustering, components, degree assortativity,
    modularity, attribute and numeric assortativity (on the subgraph of people
    with a value: the engine leaves out people without one, networkx would
    raise).
  numpy, exact linear algebra instead of iteration: eigenvector (projection of
    the uniform start vector on the leading eigenspace of the symmetrised
    weighted adjacency, which is the limit of power iteration on A + I) and
    PageRank (solve (I - alpha P^T) x = (1 - alpha) / n).
  hand-written: ego density, contacts, average path length and diameter over
    reachable ordered pairs, Freeman degree centralization, strength Gini,
    E-I index, weighted attribute assortativity, per-group tables, ego
    diversity and homophily.

Weighted path measures use distance 1 / w. With exact=true the distances are
Fractions, so equal-length paths are recognised as equal (networkx compares
floats exactly and would drop them; the engine uses a 1e-10 relative
tolerance, which agrees with exact arithmetic).
"""
import json
import math
import sys
from collections import deque
from fractions import Fraction

import networkx as nx
import numpy as np


def nan_to_none(x):
    if x is None:
        return None
    if isinstance(x, (float, np.floating)) and (math.isnan(x) or math.isinf(x)):
        return None
    return float(x)


def vec(n, d):
    return [nan_to_none(d.get(v)) if d.get(v) is not None else None for v in range(n)]


def build(job):
    n, directed = job['n'], job['directed']
    G = nx.DiGraph() if directed else nx.Graph()
    G.add_nodes_from(range(n))
    for a, b, w in job['edges']:
        G.add_edge(a, b, weight=w)
    U = nx.Graph()
    U.add_nodes_from(range(n))
    for a, b, w in job['edges']:
        if U.has_edge(a, b):
            U[a][b]['weight'] += w
        else:
            U.add_edge(a, b, weight=w)
    return G, U


def with_dist(G, exact):
    H = G.copy()
    for a, b, d in H.edges(data=True):
        d['dist'] = (Fraction(1) / Fraction(d['weight'])) if exact else 1.0 / d['weight']
    return H


def eigen_ref(U, n):
    if U.number_of_edges() == 0:
        return [0.0] * n, None
    A = nx.to_numpy_array(U, nodelist=range(n), weight='weight')
    vals, vecs = np.linalg.eigh(A)
    top = vals[-1]
    tol = 1e-10 * max(1.0, abs(top))
    sel = vals >= top - tol
    V = vecs[:, sel]
    x = V @ (V.T @ np.ones(n))
    x = x / np.linalg.norm(x)
    # Gap to the next eigenvalue of A + I in magnitude: power iteration
    # converges like ratio^k, so a ratio near 1 means slow convergence.
    rest = [abs(v + 1) for v in vals[~sel]]
    ratio = (max(rest) / (top + 1)) if rest else 0.0
    return [float(abs(v)) for v in x], float(ratio)


def burt_matrix(U, n):
    # Burt (1992) with mutual weights M = symmetrised weights:
    #   p_ij = M_ij / sum_k M_ik,  constraint_i = sum_{j in N(i)} (p_ij + (P P)_ij)^2
    #   m_jq = M_jq / max_k M_jk, effective size_i = sum_{j in N(i)} (1 - (P M^T)_ij)
    # Diagonals are zero, so the matrix products only run over third parties.
    if n == 0:
        return [], []
    M = nx.to_numpy_array(U, nodelist=range(n), weight='weight')
    tot = M.sum(axis=1)
    mx = M.max(axis=1)
    with np.errstate(divide='ignore', invalid='ignore'):
        P = np.where(tot[:, None] > 0, M / tot[:, None], 0.0)
        Mx = np.where(mx[:, None] > 0, M / mx[:, None], 0.0)
    L = P + P @ P
    R = P @ Mx.T
    con, es = [], []
    for i in range(n):
        nb = np.nonzero(M[i] > 0)[0]
        if not len(nb):
            con.append(None)
            es.append(None)
            continue
        con.append(float((L[i, nb] ** 2).sum()))
        es.append(float((1 - R[i, nb]).sum()))
    return con, es


def pagerank_ref(G, n, alpha=0.85):
    if n == 0:
        return []
    P = np.zeros((n, n))
    for v in range(n):
        if G.is_directed():
            nb = [(u, d['weight']) for u, d in G[v].items()]
        else:
            nb = [(u, d['weight']) for u, d in G[v].items()]
        tot = sum(w for _, w in nb)
        if tot == 0:
            P[v, :] = 1.0 / n
        else:
            for u, w in nb:
                P[v, u] += w / tot
    M = np.eye(n) - alpha * P.T
    x = np.linalg.solve(M, np.full(n, (1 - alpha) / n))
    return [float(v) for v in x]


def bfs_paths(G, n):
    total = 0
    pairs = 0
    diam = 0
    for s in range(n):
        dist = {s: 0}
        q = deque([s])
        while q:
            v = q.popleft()
            for u in (G.successors(v) if G.is_directed() else G.neighbors(v)):
                if u not in dist:
                    dist[u] = dist[v] + 1
                    q.append(u)
        for u, d in dist.items():
            if u != s:
                total += d
                pairs += 1
                diam = max(diam, d)
    return (total / pairs if pairs else None), diam


def gini(xs):
    n = len(xs)
    s = sum(xs)
    if not n or not s:
        return 0.0
    acc = 0.0
    for a in xs:
        for b in xs:
            acc += abs(a - b)
    return acc / (2 * n * n * (s / n))


def node_ref(job, G, U):
    n, directed, exact = job['n'], job['directed'], job.get('exact', True)
    m = {}
    if directed:
        m['inDegree'] = vec(n, dict(G.in_degree()))
        m['outDegree'] = vec(n, dict(G.out_degree()))
        m['inStrength'] = vec(n, dict(G.in_degree(weight='weight')))
        m['outStrength'] = vec(n, dict(G.out_degree(weight='weight')))
    m['degree'] = vec(n, dict(G.degree()))
    m['strength'] = vec(n, dict(G.degree(weight='weight')))
    m['contacts'] = [float(U.degree(v)) for v in range(n)]
    m['betweenness'] = vec(n, nx.betweenness_centrality(G, normalized=True)) if n > 2 else [0.0] * n
    H = with_dist(G, exact)
    m['betweennessWeighted'] = vec(n, {k: float(v) for k, v in nx.betweenness_centrality(H, normalized=True, weight='dist').items()}) if n > 2 else [0.0] * n
    scale = 1.0 / (n - 1) if n > 1 else 0.0
    m['closeness'] = vec(n, {k: float(v) * scale for k, v in nx.harmonic_centrality(G).items()})
    m['closenessWeighted'] = vec(n, {k: float(v) * scale for k, v in nx.harmonic_centrality(H, distance='dist').items()})
    m['eigenvector'], m['_eigenRatio'] = eigen_ref(U, n)
    m['pagerank'] = pagerank_ref(G, n)
    m['clustering'] = vec(n, nx.clustering(U))
    m['coreNumber'] = vec(n, nx.core_number(U)) if n else []
    if directed:
        m['reciprocity'] = vec(n, dict(nx.reciprocity(G, list(G.nodes())))) if n else []
    else:
        m['reciprocity'] = [None] * n
    con, es = burt_matrix(U, n)
    # networkx loops over neighbours of neighbours with repeated scans (cubic
    # in degree); on dense graphs the matrix form is used, and wherever
    # networkx is affordable both are computed and must agree.
    if sum(U.degree(v) ** 3 for v in range(n)) <= 3e5:
        cn, en = vec(n, nx.constraint(G, weight='weight')), vec(n, nx.effective_size(G, weight='weight'))
        for v in range(n):
            for a, b in ((cn[v], con[v]), (en[v], es[v])):
                # networkx 3.2 tests isolation with len(G[v]), the successors
                # only, so a directed node with only incoming ties gets NaN.
                # The engine (and Burt) treat it as having contacts.
                if a is None and b is not None and G.is_directed() and G.out_degree(v) == 0:
                    m['_nxSinkNaN'] = m.get('_nxSinkNaN', 0) + 1
                    continue
                if (a is None) != (b is None) or (a is not None and abs(a - b) > 1e-9 * max(1, abs(a))):
                    raise AssertionError('Burt matrix form disagrees with networkx: %r vs %r' % (a, b))
        m['_burtCrossChecked'] = True
    m['constraint'], m['effectiveSize'] = con, es
    ego = []
    for v in range(n):
        al = list(U.neighbors(v))
        k = len(al)
        if k < 2:
            ego.append(None)
            continue
        s = set(al)
        if directed:
            t = sum(1 for a in al for b in G.successors(a) if b in s)
            ego.append(t / (k * (k - 1)))
        else:
            t = sum(1 for a in al for b in U.neighbors(a) if b in s) / 2
            ego.append(t / (k * (k - 1) / 2))
    m['egoDensity'] = ego
    return m


def network_ref(job, G, U):
    n, directed = job['n'], job['directed']
    r = {'nodes': n, 'ties': G.number_of_edges()}
    r['density'] = nx.density(G) if n > 1 else 0.0
    r['reciprocity'] = nx.overall_reciprocity(G) if directed and G.number_of_edges() else None
    r['transitivity'] = nx.transitivity(U)
    r['avgClustering'] = nx.average_clustering(U) if n else 0.0
    r['isolates'] = sum(1 for v in range(n) if U.degree(v) == 0)
    r['components'] = nx.number_connected_components(U) if n else 0
    if directed:
        r['strongComponents'] = nx.number_strongly_connected_components(G) if n else 0
    r['largestComponentShare'] = (max(len(c) for c in nx.connected_components(U)) / n) if n else 0.0
    r['avgPathLength'], r['diameter'] = bfs_paths(G, n)
    deg = [U.degree(v) for v in range(n)]
    mx = max(deg) if deg else 0
    r['degreeCentralization'] = (sum(mx - d for d in deg) / ((n - 1) * (n - 2))) if n > 2 else 0.0
    r['strengthGini'] = gini([G.degree(v, weight='weight') for v in range(n)])
    r['meanDegree'] = (G.number_of_edges() / n if directed else 2 * G.number_of_edges() / n) if n else 0.0
    # A correlation is undefined when either end has one value only (every
    # target of a directed tree has in-degree 1). networkx then returns
    # rounding noise (~1e-8) from its mixing matrix, so constancy is tested
    # exactly here first.
    if G.number_of_edges():
        ends = [(G.out_degree(a), G.in_degree(b)) if directed else None for a, b in G.edges()]
        if directed:
            xs, ys = [e[0] for e in ends], [e[1] for e in ends]
        else:
            xs = [U.degree(a) for a, b in G.edges()] + [U.degree(b) for a, b in G.edges()]
            ys = xs
        if len(set(xs)) < 2 or len(set(ys)) < 2:
            r['degreeAssortativity'] = None
        else:
            with np.errstate(all='ignore'):
                r['degreeAssortativity'] = nan_to_none(nx.degree_assortativity_coefficient(G))
    else:
        r['degreeAssortativity'] = None
    mem = job.get('membership')
    if mem is not None:
        W = U.size(weight='weight')
        parts = {}
        for v, c in enumerate(mem):
            parts.setdefault(c, set()).add(v)
        r['modularity'] = nx.community.modularity(U, list(parts.values()), weight='weight', resolution=job.get('resolution', 1)) if W else None
    return r


def assort(G, nodes, attr):
    S = G.subgraph(nodes)
    if S.number_of_edges() == 0:
        return None
    with np.errstate(all='ignore'):
        try:
            if attr == 'num':
                xs = [S.nodes[a][attr] for a, b in S.edges()]
                ys = [S.nodes[b][attr] for a, b in S.edges()]
                if not S.is_directed():
                    xs = ys = xs + ys
                if len(set(xs)) < 2 or len(set(ys)) < 2:
                    return None
                return nan_to_none(nx.numeric_assortativity_coefficient(S, attr))
            return nan_to_none(nx.attribute_assortativity_coefficient(S, attr))
        except (ZeroDivisionError, ValueError, IndexError):
            return None


def mixing_assort(M):
    tot = M.sum()
    if not tot:
        return None
    e = M / tot
    a, b = e.sum(axis=1), e.sum(axis=0)
    ab = float((a * b).sum())
    if abs(ab - 1) < 1e-15:
        return None
    return (float(np.trace(e)) - ab) / (1 - ab)


def group_ref(job, G, U):
    n, directed = job['n'], job['directed']
    cat, num = job['cat'], job['num']
    for v in range(n):
        if cat[v] is not None:
            G.nodes[v]['grp'] = cat[v]
        if num[v] is not None:
            G.nodes[v]['num'] = num[v]
    coded = [v for v in range(n) if cat[v] is not None]
    values = sorted(set(cat[v] for v in coded))
    k = len(values)
    idx = {x: i for i, x in enumerate(values)}
    out = {'values': values, 'coverage': (len(coded) / n) if n else 0.0}
    out['assortativity'] = assort(G, coded, 'grp') if k else None
    out['numericAssortativity'] = assort(G, [v for v in range(n) if num[v] is not None], 'num')
    if not k:
        return out
    # Tie-end mixing (undirected ties both ways), counts and weights.
    Mc, Mw = np.zeros((k, k)), np.zeros((k, k))
    I = E = 0
    Iw = Ew = 0.0
    counts = np.zeros((k, k))
    for a, b, d in G.edges(data=True):
        if cat[a] is None or cat[b] is None:
            continue
        ia, ib, w = idx[cat[a]], idx[cat[b]], d['weight']
        Mc[ia, ib] += 1
        Mw[ia, ib] += w
        counts[ia, ib] += 1
        if not directed:
            Mc[ib, ia] += 1
            Mw[ib, ia] += w
            if ia != ib:
                counts[ib, ia] += 1
        if ia == ib:
            I += 1
            Iw += w
        else:
            E += 1
            Ew += w
    out['assortativityWeighted'] = mixing_assort(Mw)
    out['assortativityCountCheck'] = mixing_assort(Mc)
    out['eiIndex'] = (E - I) / (E + I) if E + I else None
    out['eiIndexWeighted'] = (Ew - Iw) / (Ew + Iw) if Ew + Iw else None
    out['withinTies'], out['betweenTies'] = I, E
    size = [sum(1 for v in coded if cat[v] == x) for x in values]
    groups = []
    for g in range(k):
        internal = counts[g, g]
        ext = sum(counts[g, h] + (counts[h, g] if directed else 0) for h in range(k) if h != g)
        poss_in = size[g] * (size[g] - 1) / (1 if directed else 2)
        outside = sum(size[h] for h in range(k) if h != g)
        poss_ext = size[g] * outside * (2 if directed else 1)
        groups.append({'value': values[g], 'size': size[g], 'internalTies': float(internal), 'externalTies': float(ext),
                       'density': (internal / poss_in) if poss_in else None,
                       'externalDensity': (ext / poss_ext) if poss_ext else None,
                       'eiIndex': ((ext - internal) / (ext + internal)) if ext + internal else None})
    out['groups'] = groups
    # Ego composition per node (symmetrised neighbours).
    ego = []
    for v in range(n):
        al = list(U.neighbors(v))
        vals = [cat[a] for a in al if cat[a] is not None]
        known = len(vals)
        blau = 1 - sum((vals.count(x) / known) ** 2 for x in set(vals)) if known else None
        same = sum(1 for x in vals if x == cat[v]) if cat[v] is not None else 0
        totW = sum(U[v][a]['weight'] for a in al if cat[a] is not None)
        sameW = sum(U[v][a]['weight'] for a in al if cat[a] is not None and cat[a] == cat[v])
        ego.append({'known': known, 'diversity': blau,
                    'diversityNormalized': (blau / (1 - 1 / k)) if known and k > 1 else None,
                    'homophily': (same / known) if cat[v] is not None and known else None,
                    'homophilyWeighted': (sameW / totW) if cat[v] is not None and totW else None,
                    'egoEI': ((known - 2 * same) / known) if cat[v] is not None and known else None})
    out['ego'] = ego
    return out


def main():
    jobs = json.load(open(sys.argv[1]))
    res = {}
    for job in jobs:
        G, U = build(job)
        try:
            r = {'node': node_ref(job, G, U), 'network': network_ref(job, G, U)}
            if job.get('cat') is not None:
                r['groups'] = group_ref(job, G, U)
        except Exception as e:  # recorded, never silently skipped
            r = {'error': '%s: %s' % (type(e).__name__, e)}
        res[str(job['id'])] = r
    with open(sys.argv[2], 'w') as f:
        json.dump(res, f, allow_nan=False, default=lambda o: None)


if __name__ == '__main__':
    main()
