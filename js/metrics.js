'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// OrgSignal — Network Metric Computation
// Pure functions. No DOM access, no API calls. All metric computation for
// betweenness centrality, eigenvector centrality, reciprocity, HAI, visibility
// lift, bridging bias, core score, and derived org-level aggregates.
// ═══════════════════════════════════════════════════════════════════════════════

function computeAllMetrics(messages, people) {
  const ids = new Set(people.map(p => p.id));
  const byId = new Map(people.map(p => [p.id, p]));
  const partitions = ['full', 'public', 'private', 'direct'];

  const adj = {}, radj = {};
  for (const pt of partitions) {
    adj[pt] = {};
    radj[pt] = {};
    for (const p of people) { adj[pt][p.id] = new Set(); radj[pt][p.id] = new Set(); }
  }

  const partnerCount = {};
  for (const p of people) partnerCount[p.id] = {};

  const threadInitiators = {}, threadParticipants = {};
  for (const p of people) { threadInitiators[p.id] = 0; threadParticipants[p.id] = 0; }

  const msgCountByPart = {};
  for (const p of people) msgCountByPart[p.id] = { public: 0, private: 0, direct: 0, total: 0 };

  const threadsSeen = new Set();
  for (const m of messages) {
    const uid = m.user;
    if (!ids.has(uid)) continue;
    const pt = m.channelType;
    if (!['public', 'private', 'direct'].includes(pt)) continue;

    msgCountByPart[uid][pt]++;
    msgCountByPart[uid].total++;

    const targets = new Set();
    if (m.parentUser && m.parentUser !== uid && ids.has(m.parentUser)) targets.add(m.parentUser);
    const mentions = (m.text || '').match(/<@([A-Z0-9]+)>/g) || [];
    for (const mn of mentions) {
      const tid = mn.replace(/<@|>/g, '');
      if (tid !== uid && ids.has(tid)) targets.add(tid);
    }

    for (const tid of targets) {
      adj['full'][uid].add(tid);  radj['full'][tid].add(uid);
      adj[pt][uid].add(tid);     radj[pt][tid].add(uid);
      partnerCount[uid][tid] = (partnerCount[uid][tid] || 0) + 1;
      partnerCount[tid][uid] = (partnerCount[tid][uid] || 0) + 1;
    }

    const threadKey = `${m.channel}-${m.threadTs || m.ts}`;
    if (!threadsSeen.has(threadKey)) {
      threadsSeen.add(threadKey);
      threadInitiators[uid]++;
    } else {
      threadParticipants[uid] = (threadParticipants[uid] || 0) + 1;
    }
  }

  const metrics = {};
  for (const p of people) {
    const uid = p.id;
    metrics[uid] = {};
    for (const pt of partitions) {
      const out = adj[pt][uid];
      const inn = radj[pt][uid];
      const degree = out.size;
      const mutual = [...out].filter(t => inn.has(t)).length;
      const reciprocity = degree > 0 ? mutual / degree : 0;
      metrics[uid][pt] = { degree, reciprocity, betweenness: 0, closeness: 0, eigenvector: 0 };
    }

    const mc = msgCountByPart[uid];
    const total = mc.total || 1;
    metrics[uid].hai = (mc.private + mc.direct) / total;
    metrics[uid].pei = mc.public / total;

    metrics[uid].topPartners = Object.entries(partnerCount[uid])
      .sort((a, b) => b[1] - a[1]).slice(0, 7)
      .map(([tid, cnt]) => ({ id: tid, name: byId.get(tid)?.name || tid, count: cnt }));

    const totalThreads = threadInitiators[uid] + (threadParticipants[uid] || 0);
    metrics[uid].initiationRatio = totalThreads > 0 ? threadInitiators[uid] / (totalThreads || 1) : 0;

    const managerId = p.managerId;
    if (managerId && ids.has(managerId)) {
      const managerPartnerCount = partnerCount[uid][managerId] || 0;
      const maxPartnerCount = Math.max(...Object.values(partnerCount[uid]), 1);
      metrics[uid].managerProximity = managerPartnerCount / maxPartnerCount;
    } else {
      metrics[uid].managerProximity = null;
    }

    if (managerId) {
      const totalPartnerCount = Object.values(partnerCount[uid]).reduce((a, b) => a + b, 0) || 1;
      const managerCount = partnerCount[uid][managerId] || 0;
      metrics[uid].peerReliance = 1 - (managerCount / totalPartnerCount);
    } else {
      metrics[uid].peerReliance = 1.0;
    }
  }

  // ── Betweenness centrality (Brandes algorithm) ────────────────────────────
  function computeBetweenness(adjMap, nodeList) {
    const bc = {};
    for (const n of nodeList) bc[n] = 0;
    for (const s of nodeList) {
      const stack = [], pred = {}, sigma = {}, dist = {};
      for (const n of nodeList) { pred[n] = []; sigma[n] = 0; dist[n] = -1; }
      sigma[s] = 1; dist[s] = 0;
      const Q = [s];
      while (Q.length) {
        const v = Q.shift(); stack.push(v);
        for (const w of (adjMap[v] || new Set())) {
          if (dist[w] < 0) { Q.push(w); dist[w] = dist[v] + 1; }
          if (dist[w] === dist[v] + 1) { sigma[w] += sigma[v]; pred[w].push(v); }
        }
      }
      const delta = {};
      for (const n of nodeList) delta[n] = 0;
      while (stack.length) {
        const w = stack.pop();
        for (const v of pred[w]) {
          if (sigma[w] > 0) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
        }
        if (w !== s) bc[w] += delta[w];
      }
    }
    return bc;
  }

  const nodeList = people.map(p => p.id);
  const undirAdj = {};
  for (const uid of nodeList) {
    undirAdj[uid] = new Set([...adj['full'][uid], ...radj['full'][uid]]);
  }

  const bc = computeBetweenness(undirAdj, nodeList);
  const maxBC = Math.max(...Object.values(bc), 1);
  for (const uid of nodeList) metrics[uid]['full'].betweenness = bc[uid] / maxBC;

  for (const pt of ['public', 'private', 'direct']) {
    const undirPt = {};
    for (const uid of nodeList) undirPt[uid] = new Set([...adj[pt][uid], ...radj[pt][uid]]);
    const bcPt = computeBetweenness(undirPt, nodeList);
    const maxBCPt = Math.max(...Object.values(bcPt), 1);
    for (const uid of nodeList) metrics[uid][pt].betweenness = bcPt[uid] / maxBCPt;
  }

  // ── Eigenvector centrality (power iteration) ──────────────────────────────
  function computeEigenvector(adjMap, nodeList, iter = 50) {
    let ev = {};
    for (const n of nodeList) ev[n] = 1 / nodeList.length;
    for (let i = 0; i < iter; i++) {
      const next = {};
      for (const n of nodeList) {
        next[n] = [...(adjMap[n] || new Set())].reduce((s, nb) => s + (ev[nb] || 0), 0);
      }
      const norm = Math.sqrt(Object.values(next).reduce((s, v) => s + v * v, 0)) || 1;
      for (const n of nodeList) ev[n] = next[n] / norm;
    }
    return ev;
  }

  for (const pt of partitions) {
    const pta = pt === 'full' ? undirAdj : {};
    if (pt !== 'full') {
      for (const uid of nodeList) pta[uid] = new Set([...adj[pt][uid], ...radj[pt][uid]]);
    }
    const ev = computeEigenvector(pta, nodeList);
    const maxEV = Math.max(...Object.values(ev), 1e-10);
    for (const uid of nodeList) metrics[uid][pt].eigenvector = ev[uid] / maxEV;
  }

  // ── Derived cross-partition metrics ───────────────────────────────────────
  for (const pt of partitions) {
    const sorted = [...nodeList].sort((a, b) => metrics[b][pt].eigenvector - metrics[a][pt].eigenvector);
    for (let i = 0; i < sorted.length; i++) {
      metrics[sorted[i]][pt].evPercentile = 1 - i / (sorted.length - 1 || 1);
    }
  }
  for (const uid of nodeList) {
    metrics[uid].influenceStability = partitions.reduce((s, pt) => s + (metrics[uid][pt].evPercentile || 0), 0) / partitions.length;
  }

  for (const uid of nodeList) {
    const pubEV = metrics[uid]['public'].eigenvector;
    const hidEV = Math.max(metrics[uid]['private'].eigenvector, metrics[uid]['direct'].eigenvector);
    metrics[uid].visibilityLift = pubEV - hidEV;
  }

  for (const uid of nodeList) {
    metrics[uid].bridgingBias = metrics[uid]['direct'].betweenness - metrics[uid]['public'].betweenness;
  }

  const degSorted = [...nodeList].sort((a, b) => metrics[b]['full'].degree - metrics[a]['full'].degree);
  for (let i = 0; i < degSorted.length; i++) {
    metrics[degSorted[i]].degPercentile = 1 - i / (degSorted.length - 1 || 1);
  }
  for (const uid of nodeList) {
    metrics[uid].coreScore = (metrics[uid].degPercentile + (metrics[uid]['full'].evPercentile || 0)) / 2;
  }

  // ── Org-level aggregates ──────────────────────────────────────────────────
  function gini(vals) {
    const s = [...vals].sort((a, b) => a - b);
    const n = s.length; if (n === 0) return 0;
    const mean = s.reduce((a, b) => a + b, 0) / n || 1;
    let num = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) num += Math.abs(s[i] - s[j]);
    return num / (2 * n * n * mean);
  }

  const orgMetrics = {};
  for (const pt of partitions) {
    const degrees = nodeList.map(u => metrics[u][pt].degree);
    const recips  = nodeList.map(u => metrics[u][pt].reciprocity);
    const meanDeg = degrees.reduce((a, b) => a + b, 0) / nodeList.length;
    const meanRec = recips.reduce((a, b) => a + b, 0) / nodeList.length;
    const top10   = [...degrees].sort((a, b) => b - a).slice(0, Math.max(1, Math.floor(nodeList.length * 0.1)));
    orgMetrics[pt] = {
      meanDegree:      meanDeg,
      medianDegree:    degrees.sort((a, b) => a - b)[Math.floor(degrees.length / 2)],
      maxDegree:       Math.max(...degrees),
      giniDegree:      gini(degrees),
      top10share:      (top10.reduce((a, b) => a + b, 0)) / (degrees.reduce((a, b) => a + b, 0) || 1),
      meanReciprocity: meanRec,
      nodeCount:       nodeList.filter(u => metrics[u][pt].degree > 0).length,
      edgeCount:       Math.round(degrees.reduce((a, b) => a + b, 0) / 2),
    };
  }

  const depts = [...new Set(people.map(p => p.dept).filter(Boolean))];
  const deptMetrics = {};
  for (const dept of depts) {
    const deptIds = people.filter(p => p.dept === dept).map(p => p.id);
    deptMetrics[dept] = {
      count:           deptIds.length,
      meanCoreScore:   deptIds.reduce((s, u) => s + (metrics[u].coreScore || 0), 0) / (deptIds.length || 1),
      meanReciprocity: deptIds.reduce((s, u) => s + metrics[u]['full'].reciprocity, 0) / (deptIds.length || 1),
      meanHAI:         deptIds.reduce((s, u) => s + (metrics[u].hai || 0), 0) / (deptIds.length || 1),
    };
  }

  // ── Expose derived metrics under .derived ────────────────────────────────
  const DERIVED_KEYS = ['influenceStability', 'visibilityLift', 'bridgingBias', 'coreScore',
    'degPercentile', 'hai', 'pei', 'managerProximity', 'peerReliance', 'initiationRatio', 'topPartners'];
  for (const uid of nodeList) {
    const m = metrics[uid];
    m.derived = {};
    for (const k of DERIVED_KEYS) {
      if (m[k] !== undefined) m.derived[k] = m[k];
    }
    m.derived.hai = m.hai;
    m.derived.influenceStability = m.influenceStability;
    m.derived.coreScore = m.coreScore != null ? Math.round(m.coreScore * 100) : null;
    m.derived.managerProximity = m.managerProximity;
    m.derived.visibilityLift = m.visibilityLift;
    m.derived.conversationInitiationRatio = m.initiationRatio;
  }

  return { metrics, orgMetrics, deptMetrics };
}

// ── Rule-based findings ───────────────────────────────────────────────────────
function generateFindings(people, metrics) {
  const findings = [];
  const byId = new Map(people.map(p => [p.id, p]));
  const ids = people.map(p => p.id);

  const byBet = [...ids].sort((a, b) => (metrics[b]?.['full']?.betweenness || 0) - (metrics[a]?.['full']?.betweenness || 0));

  // 1. Top bridge node
  const bridge = byBet[0];
  if (bridge) {
    const p = byId.get(bridge);
    findings.push({
      type: 'BRIDGE', color: '#6b9fd4', icon: '🔗',
      title: `${p?.name} is the primary network bridge`,
      body: `Highest betweenness centrality in the full network — information flow between departments routes through this person disproportionately. Their departure would fragment cross-functional coordination.`,
      uids: [bridge],
    });
  }

  // 2. Flight risk flags
  const flightRisks = people.filter(p => p.flightRisk === true || p.flightRisk === 'Yes' || p.flightRisk === 'yes');
  for (const p of flightRisks) {
    const uid = p.id;
    const m = metrics[uid];
    const signals = [];
    if (m?.managerProximity != null && m.managerProximity < 0.15) signals.push('minimal direct communication with manager');
    if ((m?.['full']?.reciprocity || 0) < 0.5) signals.push('declining reciprocity');
    if ((m?.hai || 0) < 0.2) signals.push('withdrawing from private channels');
    const corroborated = signals.length > 0;
    findings.push({
      type: 'FLIGHT_RISK', color: '#e05c5c', icon: '⚠',
      title: `${p.name} — HR flight risk flag${corroborated ? ' (network-corroborated)' : ''}`,
      body: corroborated
        ? `HR flag active. Network signals consistent: ${signals.join('; ')}.`
        : `HR flag active. Network metrics do not surface additional structural signals at this time.`,
      uids: [uid],
    });
  }

  // 3. Hidden influencers
  const hiddenInfluencers = [...ids]
    .filter(u => (metrics[u]?.visibilityLift || 0) < CONFIG.HIDDEN_INFLUENCER_VISIBILITY_THRESHOLD
               && (metrics[u]?.['direct']?.degree || 0) > CONFIG.HIDDEN_INFLUENCER_MIN_DIRECT_DEGREE)
    .sort((a, b) => (metrics[a]?.visibilityLift || 0) - (metrics[b]?.visibilityLift || 0))
    .slice(0, CONFIG.MAX_HIDDEN_INFLUENCER_FINDINGS);
  if (hiddenInfluencers.length) {
    const names = hiddenInfluencers.map(u => byId.get(u)?.name).filter(Boolean).join(' and ');
    findings.push({
      type: 'HIDDEN_INFLUENCER', color: '#9e7ec9', icon: '👁',
      title: `Hidden influencer${hiddenInfluencers.length > 1 ? 's' : ''} detected`,
      body: `${names} show${hiddenInfluencers.length === 1 ? 's' : ''} significantly higher eigenvector centrality in private/DM networks than in public channels. Their influence is largely invisible in open forums but structurally significant.`,
      uids: hiddenInfluencers,
    });
  }

  // 4. Asymmetric communicators
  const asymmetric = [...ids]
    .filter(u => (metrics[u]?.['full']?.degree || 0) > CONFIG.ASYMMETRIC_MIN_DEGREE
               && (metrics[u]?.['full']?.reciprocity || 0) < CONFIG.ASYMMETRIC_MAX_RECIPROCITY)
    .sort((a, b) => (metrics[a]?.['full']?.reciprocity || 0) - (metrics[b]?.['full']?.reciprocity || 0))
    .slice(0, CONFIG.MAX_ASYMMETRIC_FINDINGS);
  if (asymmetric.length) {
    const entries = asymmetric.map(u => `${byId.get(u)?.name} (${Math.round((metrics[u]?.['full']?.reciprocity || 0) * 100)}% reciprocity)`).join(', ');
    findings.push({
      type: 'ASYMMETRIC', color: '#c8a97e', icon: '📢',
      title: 'Asymmetric communication pattern',
      body: `${entries} — high connection volume but lower reciprocity than expected. Messages are sent more than they are returned.`,
      uids: asymmetric,
    });
  }

  for (const f of findings) {
    if (f.uids && f.uids.length > 0) f.uid = f.uids[0];
  }
  return findings;
}

// ── Graph data builder ────────────────────────────────────────────────────────
function buildGraphData(messages, people, metrics) {
  const ids = new Set(people.map(p => p.id));
  const linkMap = {};

  for (const m of messages) {
    if (!ids.has(m.user)) continue;
    const pt = m.channelType;
    const targets = new Set();
    if (m.parentUser && m.parentUser !== m.user && ids.has(m.parentUser)) targets.add(m.parentUser);
    const mentions = (m.text || '').match(/<@([A-Z0-9]+)>/g) || [];
    for (const mn of mentions) {
      const tid = mn.replace(/<@|>/g, '');
      if (tid !== m.user && ids.has(tid)) targets.add(tid);
    }
    for (const tid of targets) {
      const key = [m.user, tid].sort().join('-') + '-' + pt;
      linkMap[key] = (linkMap[key] || 0) + 1;
    }
  }

  const links = Object.entries(linkMap).map(([key, weight]) => {
    const parts = key.split('-');
    const type = parts.pop();
    const [source, target] = parts;
    return { source, target, type, weight };
  });

  const nodes = people.map(p => ({
    id: p.id, name: p.name, dept: p.dept, role: p.role,
    degree:      metrics[p.id]?.full?.degree || 0,
    betweenness: metrics[p.id]?.full?.betweenness || 0,
    eigenvector: metrics[p.id]?.full?.eigenvector || 0,
    reciprocity: metrics[p.id]?.full?.reciprocity || 0,
    coreScore:   metrics[p.id]?.coreScore || 0,
    flightRisk:  p.flightRisk,
  }));

  return { nodes, links };
}
