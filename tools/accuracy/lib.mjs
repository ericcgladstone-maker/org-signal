// Shared pieces of the accuracy campaign (tools/accuracy/campaign.mjs) and the
// fast regression suite (test/accuracy/*.test.js): seeded graph generators that
// hit the edge cases on purpose, tolerant comparison, rank statistics and a
// bridge to the python reference (tools/accuracy/reference.py).
//
// Every generator draws from createRng(seed), so a failing case is fully
// described by { family, n, directed, weights, seed } and can be replayed with
// makeCase(spec).

import { execFileSync, execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng } from '../../src/analysis/rng.js';
import { networkFromEdges } from '../../src/analysis/construct.js';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const APP = join(HERE, '..', '..');

// ---- graph families -----------------------------------------------------------------

// Each returns a list of [a, b] pairs over 0..n-1 (possibly with duplicates
// and self-loops when asked for; networkFromEdges drops loops and sums
// duplicates, as buildNetwork does with repeated evidence).
const FAMILIES = {
  empty: (n) => [],
  single: () => [],
  isolates: (n, rng, o) => { const k = Math.min(n, Math.max(2, Math.floor(n * 0.6))); return gnp(k, o.p ?? 0.3, rng, o.directed); },
  twoComponents: (n, rng, o) => { const h = Math.floor(n / 2); return [...gnp(h, 0.4, rng, o.directed), ...gnp(n - h, 0.4, rng, o.directed).map(([a, b]) => [a + h, b + h])]; },
  star: (n) => Array.from({ length: Math.max(0, n - 1) }, (_, i) => [0, i + 1]),
  path: (n) => Array.from({ length: Math.max(0, n - 1) }, (_, i) => [i, i + 1]),
  ring: (n) => (n < 3 ? FAMILIES.path(n) : Array.from({ length: n }, (_, i) => [i, (i + 1) % n])),
  complete: (n, rng, o) => { const e = []; for (let a = 0; a < n; a++) for (let b = o.directed ? 0 : a + 1; b < n; b++) if (a !== b) e.push([a, b]); return e; },
  bipartite: (n, rng, o) => { const h = Math.max(1, Math.floor(n / 3)); const e = []; for (let a = 0; a < h; a++) for (let b = h; b < n; b++) if (rng() < (o.p ?? 0.35)) e.push(rng() < 0.5 || !o.directed ? [a, b] : [b, a]); return e; },
  tree: (n, rng) => Array.from({ length: Math.max(0, n - 1) }, (_, i) => [rng.int(i + 1), i + 1]),
  er: (n, rng, o) => gnp(n, o.p ?? Math.min(1, 3 / Math.max(1, n)), rng, o.directed),
  ba: (n, rng, o) => {
    const m = o.m ?? 2, e = [], ends = [];
    for (let v = 0; v < n; v++) {
      const k = Math.min(m, v), chosen = new Set();
      while (chosen.size < k) chosen.add(ends.length && rng() < 0.9 ? ends[rng.int(ends.length)] : rng.int(v));
      for (const u of chosen) { e.push(o.directed && rng() < 0.5 ? [u, v] : [v, u]); ends.push(u, v); }
    }
    return e;
  },
  sbm: (n, rng, o) => {
    const g = o.groups ?? 3, e = [];
    for (let a = 0; a < n; a++) for (let b = o.directed ? 0 : a + 1; b < n; b++) {
      if (a === b) continue;
      if (rng() < (a % g === b % g ? (o.pIn ?? 0.3) : (o.pOut ?? 0.02))) e.push([a, b]);
    }
    return e;
  },
  smallWorld: (n, rng, o) => {
    const k = Math.min(o.k ?? 4, n - 1 - ((n - 1) % 2)), e = [];
    for (let a = 0; a < n; a++) for (let j = 1; j <= k / 2; j++) {
      let b = (a + j) % n;
      if (rng() < (o.beta ?? 0.1)) b = rng.int(n);
      e.push([a, b]);
    }
    return e;
  },
  // Construction-layer leftovers: repeated evidence and self-ties.
  multi: (n, rng, o) => {
    const e = gnp(n, o.p ?? Math.min(1, 4 / Math.max(1, n)), rng, o.directed);
    const extra = [];
    for (const p of e) if (rng() < 0.5) extra.push(p, rng() < 0.5 ? p : [p[1], p[0]]);
    for (let v = 0; v < n; v++) if (rng() < 0.2) extra.push([v, v]);
    return [...e, ...extra];
  },
};
export const FAMILY_NAMES = Object.keys(FAMILIES);

function gnp(n, p, rng, directed) {
  const e = [];
  for (let a = 0; a < n; a++) for (let b = directed ? 0 : a + 1; b < n; b++) if (a !== b && rng() < p) e.push([a, b]);
  return e;
}

// Weight schemes. 'int' and 'tied' keep 1/w rational with small
// denominators so tied shortest paths really exist; 'float' and 'skewed' are
// continuous (ties have probability zero); 'skewed' spans six orders of
// magnitude.
export const WEIGHT_SCHEMES = {
  unit: () => 1,
  int: (rng) => 1 + rng.int(5),
  tied: (rng) => [0.5, 1, 2, 4][rng.int(4)],
  float: (rng) => 0.1 + rng() * 9.9,
  skewed: (rng) => Math.exp((rng() * 2 - 1) * 7),
};

// spec: { family, n, directed, weights, seed, ...family options }
// -> { spec, n, directed, edges: [[a, b, w]] (raw, before loops and duplicates are folded) }
export function makeCase(spec) {
  const rng = createRng(`${spec.family}|${spec.n}|${spec.directed}|${spec.weights}|${spec.seed}`);
  const n = spec.family === 'single' ? 1 : spec.family === 'empty' ? spec.n ?? 0 : spec.n;
  const pairs = FAMILIES[spec.family](n, rng, spec);
  const wf = WEIGHT_SCHEMES[spec.weights || 'unit'];
  const edges = pairs.map(([a, b]) => [a, b, wf(rng)]);
  return { spec, n, directed: !!spec.directed, edges };
}

// The graph the engine sees: self-loops dropped, duplicate ties summed
// (a-b and b-a are one tie when undirected). Used for the python reference so
// both sides start from the same simple weighted graph.
export function canonicalEdges(c) {
  const m = new Map();
  for (const [a0, b0, w] of c.edges) {
    if (a0 === b0) continue;
    const a = c.directed ? a0 : Math.min(a0, b0), b = c.directed ? b0 : Math.max(a0, b0);
    const k = a + ',' + b;
    m.set(k, (m.get(k) || 0) + w);
  }
  return [...m].map(([k, w]) => { const [a, b] = k.split(',').map(Number); return [a, b, w]; }).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

export const toNet = (c, opts = {}) => networkFromEdges(c.n, c.edges, { directed: c.directed, ...opts });

// A balanced mix of specs for the reference campaign: every family, both
// directions, every weight scheme, sizes 1..maxN (a few large ones).
export function caseMix(count, seed, { maxN = 120, largeShare = 0.04, largeN = 600 } = {}) {
  const rng = createRng(`mix|${seed}`);
  const fams = FAMILY_NAMES;
  const ws = Object.keys(WEIGHT_SCHEMES);
  const out = [];
  for (let i = 0; i < count; i++) {
    const family = fams[i % fams.length];
    const large = rng() < largeShare;
    let n = large ? 200 + rng.int(largeN - 199) : 1 + rng.int(maxN);
    if (family === 'empty') n = rng.int(6);
    const spec = { family, n, directed: rng() < 0.5, weights: ws[rng.int(ws.length)], seed: seed * 100000 + i };
    if (family === 'er') spec.p = [0.02, 0.05, 0.1, 0.3, 0.7][rng.int(5)];
    if (family === 'sbm') { spec.groups = 2 + rng.int(4); spec.pIn = 0.2 + rng() * 0.5; spec.pOut = rng() * 0.05; }
    if (family === 'ba') spec.m = 1 + rng.int(3);
    if (large && (family === 'complete' || (family === 'er' && spec.p > 0.1) || family === 'sbm')) { spec.n = 60 + rng.int(60); }
    out.push(spec);
  }
  return out;
}

// Attribute values for group measures: categorical with 1..5 levels (some
// missing) and an integer numeric attribute.
export function caseAttrs(c) {
  const rng = createRng(`attrs|${c.spec.seed}`);
  const levels = 1 + rng.int(5);
  const cat = [], num = [];
  for (let v = 0; v < c.n; v++) {
    cat.push(rng() < 0.1 ? null : 'g' + rng.int(levels));
    num.push(rng() < 0.1 ? null : 1 + rng.int(6));
  }
  return { cat, num };
}

export function fakeDs(attrs) {
  return {
    nodes: { count: attrs.cat.length, attrs: attrs.cat.map((g, i) => ({ ...(g == null ? {} : { grp: g }), ...(attrs.num[i] == null ? {} : { num: attrs.num[i] }) })), labels: attrs.cat.map((_, i) => 'N' + i), isBot: new Uint8Array(attrs.cat.length) },
    attributeSchema: [{ key: 'grp', type: 'categorical' }, { key: 'num', type: 'numeric' }],
  };
}

// ---- comparison ---------------------------------------------------------------------

// Relative-or-absolute closeness: |a - b| <= tol * max(1, |b|). null/NaN only
// match null/NaN.
export function close(a, b, tol) {
  const na = a == null || Number.isNaN(a), nb = b == null || Number.isNaN(b);
  if (na || nb) return na && nb;
  if (a === b) return true;
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
}
export const relErr = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));

// Spearman correlation with average ranks for ties.
export function spearman(x, y) {
  const rx = avgRanks(x), ry = avgRanks(y);
  return pearsonArr(rx, ry);
}
export function avgRanks(x) {
  const n = x.length, idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => x[a] - x[b]);
  const r = new Float64Array(n);
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && x[idx[j + 1]] === x[idx[i]]) j++;
    for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
export function pearsonArr(x, y) {
  const n = x.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}
export function topKOverlap(x, y, k) {
  const top = (a) => new Set(Array.from(a, (v, i) => i).sort((p, q) => a[q] - a[p] || p - q).slice(0, k));
  const A = top(x), B = top(y);
  let c = 0;
  for (const i of A) if (B.has(i)) c++;
  return c / Math.max(1, Math.min(k, x.length));
}
export function quantiles(arr, qs = [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1]) {
  const s = Array.from(arr).filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const at = (q) => { const p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return s[lo] + (s[hi] - s[lo]) * (p - lo); };
  return Object.fromEntries(qs.map(q => [`q${Math.round(q * 100)}`, at(q)]));
}
export const mean = (a) => { let s = 0, k = 0; for (const x of a) if (Number.isFinite(x)) { s += x; k++; } return k ? s / k : NaN; };

// ---- result bookkeeping -------------------------------------------------------------

// A check module collects cases and failures through one of these.
export function tally(name) {
  const t = { name, cases: 0, comparisons: 0, failures: [], stats: {}, notes: [] };
  t.case = () => { t.cases++; };
  t.cmp = (ok, info) => { t.comparisons++; if (!ok && t.failures.length < 200) t.failures.push(info); else if (!ok) t.failures.overflow = (t.failures.overflow || 0) + 1; return ok; };
  t.result = () => ({ name: t.name, cases: t.cases, comparisons: t.comparisons, failed: t.failures.length + (t.failures.overflow || 0), failures: t.failures.slice(0, 50), stats: t.stats, notes: t.notes });
  return t;
}

// ---- python reference -----------------------------------------------------------------

let pyOk = null;
export function pythonAvailable() {
  if (pyOk === null) {
    try { execFileSync('python3', ['-c', 'import networkx, numpy'], { stdio: 'ignore' }); pyOk = true; } catch { pyOk = false; }
  }
  return pyOk;
}

// Run tools/accuracy/reference.py on a batch of jobs; returns its JSON output.
export function pythonReference(jobs, { script = 'reference.py', timeout = 3600000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'os-acc-'));
  const inp = join(dir, 'in.json'), out = join(dir, 'out.json');
  writeFileSync(inp, JSON.stringify(jobs));
  execFileSync('python3', [join(HERE, script), inp, out], { stdio: ['ignore', 'ignore', 'inherit'], timeout, maxBuffer: 1 << 30 });
  return JSON.parse(readFileSync(out, 'utf8'));
}

// The same, split over worker processes (jobs are independent). Large jobs
// are dealt round-robin so the chunks take similar time.
export async function pythonReferenceParallel(jobs, { script = 'reference.py', procs = Math.max(1, Math.min(8, availableParallelism() - 1)) } = {}) {
  if (jobs.length < 40 || procs === 1) return pythonReference(jobs, { script });
  const order = jobs.map((j, i) => i).sort((a, b) => (jobs[b].edges?.length ?? 0) - (jobs[a].edges?.length ?? 0));
  const chunks = Array.from({ length: procs }, () => []);
  order.forEach((i, k) => chunks[k % procs].push(jobs[i]));
  const dir = mkdtempSync(join(tmpdir(), 'os-acc-'));
  const parts = await Promise.all(chunks.map((chunk, k) => new Promise((resolve, reject) => {
    const inp = join(dir, `in${k}.json`), out = join(dir, `out${k}.json`);
    writeFileSync(inp, JSON.stringify(chunk));
    execFile('python3', [join(HERE, script), inp, out], { maxBuffer: 1 << 30 }, (err, so, se) => (err ? reject(new Error(se || err.message)) : resolve(JSON.parse(readFileSync(out, 'utf8')))));
  })));
  return Object.assign({}, ...parts);
}

// NaN-safe JSON (NaN/Infinity -> null).
export const toJSON = (x) => JSON.stringify(x, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : ArrayBuffer.isView(v) ? Array.from(v) : v), 1);
