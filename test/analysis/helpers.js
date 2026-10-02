// Shared generators for analysis tests (not a test file itself).

import { networkFromEdges } from '../../src/analysis/construct.js';
import { createRng } from '../../src/analysis/rng.js';
import { DatasetBuilder, VIEWS } from '../../src/core/model.js';

export function erdosRenyi(n, p, { directed = false, seed = 1 } = {}) {
  const rng = createRng(seed);
  const edges = [];
  for (let a = 0; a < n; a++) for (let b = directed ? 0 : a + 1; b < n; b++) if (a !== b && rng() < p) edges.push([a, b, 1]);
  return networkFromEdges(n, edges, { directed });
}

// Two (or more) planted groups: p_in inside, p_out between. Node i is in group i % groups.
export function planted(n, pIn, pOut, { groups = 2, directed = false, seed = 1 } = {}) {
  const rng = createRng(seed);
  const edges = [];
  for (let a = 0; a < n; a++) for (let b = directed ? 0 : a + 1; b < n; b++) {
    if (a === b) continue;
    if (rng() < (a % groups === b % groups ? pIn : pOut)) edges.push([a, b, 1]);
  }
  const net = networkFromEdges(n, edges, { directed });
  const ds = {
    nodes: { count: n, attrs: Array.from({ length: n }, (_, i) => ({ team: 'T' + (i % groups) })), labels: Array.from({ length: n }, (_, i) => 'N' + i), isBot: new Uint8Array(n) },
    attributeSchema: [{ key: 'team', type: 'categorical' }],
  };
  return { net, ds };
}

// A message dataset: n people, events between random pairs.
export function messageDataset(n, events, { seed = 1, directed = true, view = VIEWS.FULL, t0 = Date.UTC(2026, 0, 5), span = 90 * 86400000, text = null, attrs = null } = {}) {
  const rng = createRng(seed);
  const b = new DatasetBuilder({ name: 'gen', source: { format: 'test', view } });
  const ps = Array.from({ length: n }, (_, i) => b.node('g:' + i, { label: 'P' + i, attrs: attrs ? attrs(i) : { team: 'T' + (i % 4) } }));
  const ch = b.context('g:dm', { kind: 'dm', visibility: 'direct' });
  for (let k = 0; k < events; k++) {
    const a = rng.int(n);
    let c = rng.int(n - 1);
    if (c >= a) c++;
    b.event({ actor: ps[a], t: t0 + Math.floor(rng() * span), context: ch, targets: [[ps[c], 'dm']], text: text ? text(a, c, rng) : null });
  }
  return b.build();
}
