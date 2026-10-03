#!/usr/bin/env python3
"""Two-mode reference values for the accuracy campaign (checks/twomode.mjs).

Usage: python3 tools/accuracy/twomode.py in.json out.json

in.json is a list of jobs { id, n, mode: [0|1 per node], edges: [[a, b]]
(simple, each between the modes), membership: [int] | null }, or
{ id, davis: true } for networkx's Davis Southern Women graph (the job's
result then also carries the graph as nodes / mode / edges so the engine
builds exactly the same thing). out.json maps id -> results.

Everything comes from networkx 3.2 networkx.algorithms.bipartite, except
Barber's bipartite modularity, which networkx does not have; it is written out
from Barber (2007) here, independently of src/analysis/twomode.js.
"""
import json
import sys

import networkx as nx
from networkx.algorithms import bipartite as bp


def none_on_error(f):
    try:
        return f()
    except (ZeroDivisionError, nx.NetworkXError, nx.NetworkXAlgorithmError):
        return None


def edges_out(G):
    return sorted([min(a, b), max(a, b), float(d.get('weight', 1))] for a, b, d in G.edges(data=True))


def barber(G, top, membership):
    W = G.number_of_edges()
    if W == 0:
        return None
    q = 0.0
    for c in set(membership):
        inside = sum(1 for a, b in G.edges() if membership[a] == c and membership[b] == c)
        K = sum(G.degree(v) for v in G if v in top and membership[v] == c)
        D = sum(G.degree(v) for v in G if v not in top and membership[v] == c)
        q += inside / W - (K / W) * (D / W)
    return q


def run(job):
    out = {}
    if job.get('davis'):
        D = nx.davis_southern_women_graph()
        names = list(D.nodes())
        idx = {v: i for i, v in enumerate(names)}
        G = nx.Graph()
        G.add_nodes_from(range(len(names)))
        G.add_edges_from((idx[a], idx[b]) for a, b in D.edges())
        mode = [D.nodes[v]['bipartite'] for v in names]
        out['names'] = names
        out['mode'] = mode
        out['edges'] = sorted([min(idx[a], idx[b]), max(idx[a], idx[b])] for a, b in D.edges())
        n = len(names)
    else:
        n, mode = job['n'], job['mode']
        G = nx.Graph()
        G.add_nodes_from(range(n))
        G.add_edges_from((a, b) for a, b in job['edges'])
    top = {v for v in range(n) if mode[v] == 0}
    bottom = set(range(n)) - top
    node = {}
    deg = none_on_error(lambda: bp.degree_centrality(G, top)) if top and bottom else None
    node['twoModeDegree'] = [deg[v] for v in range(n)] if deg else None
    bet = none_on_error(lambda: bp.betweenness_centrality(G, top)) if top and bottom else None
    if bet:
        node['twoModeBetweenness'] = [bet[v] for v in range(n)]
    elif top and bottom:
        # networkx divides by a zero maximum for one mode (e.g. a single
        # actor with a single event) and fails for both. Use its own
        # per-mode maxima, as written in bipartite.betweenness_centrality,
        # with None for the mode whose maximum is 0.
        raw = nx.betweenness_centrality(G, normalized=False, weight=None)
        def bmax(a, b):
            s, t = divmod(a - 1, b)
            return ((b**2) * ((s + 1) ** 2) + b * (s + 1) * (2 * t - s - 1) - t * ((2 * s) - t + 3)) / 2.0
        mx = {0: bmax(len(top), len(bottom)), 1: bmax(len(bottom), len(top))}
        node['twoModeBetweenness'] = [raw[v] / mx[mode[v]] if mx[mode[v]] > 0 else None for v in range(n)]
        out['betweennessPartial'] = True
    else:
        node['twoModeBetweenness'] = None
    clo = none_on_error(lambda: bp.closeness_centrality(G, top)) if top and bottom else None
    node['twoModeCloseness'] = [clo[v] for v in range(n)] if clo else None
    cl = bp.clustering(G) if n else {}
    node['twoModeClustering'] = [cl[v] for v in range(n)]
    out['node'] = node
    net = {}
    net['twoModeDensity'] = bp.density(G, top) if top and bottom else None
    net['robinsAlexander'] = bp.robins_alexander_clustering(G)
    net['twoModeAvgClustering'] = bp.average_clustering(G) if n else 0.0
    out['network'] = net
    proj = {}
    for k, nodes in (('mode0', top), ('mode1', bottom)):
        if not nodes or not (set(range(n)) - nodes):
            continue
        proj[k] = {
            'count': edges_out(bp.weighted_projected_graph(G, nodes)),
            'newman': edges_out(bp.collaboration_weighted_projected_graph(G, nodes)),
            'binary': sorted([min(a, b), max(a, b), 1.0] for a, b in bp.projected_graph(G, nodes).edges()),
        }
    out['projections'] = proj
    if job.get('membership') is not None:
        out['barber'] = barber(G, top, job['membership'])
    return out


def main():
    jobs = json.load(open(sys.argv[1]))
    res = {}
    for job in jobs:
        try:
            res[str(job['id'])] = run(job)
        except Exception as e:  # recorded as a failed case, never silently skipped
            res[str(job['id'])] = {'error': repr(e)}
    json.dump(res, open(sys.argv[2], 'w'))


if __name__ == '__main__':
    main()
