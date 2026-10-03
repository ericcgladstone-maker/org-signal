// Readers for the raw formats the classic datasets come in: UCINET DL
// (fullmatrix, as in the UCINET IV dataset collection), Pajek project files
// (.paj / .net with time intervals, as in the ESNA collection) and GML (Mark
// Newman's network data page). Only the variants those files use are read;
// anything else throws, so a changed source fails loudly at conversion time.

// UCINET DL, FORMAT = FULLMATRIX. Returns { n, nr, nc, rowLabels, colLabels,
// levels: [label], matrices: [[[number]]] } with one matrix per level.
export function parseDL(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0;
  const next = () => lines[i++];
  if (!/^\s*DL\b/i.test(next())) throw new Error('not a DL file');
  const head = {};
  // Header lines up to DATA:, with label blocks.
  let block = null;
  const rowLabels = [], colLabels = [], levels = [];
  for (; i < lines.length;) {
    const l = next().trim();
    if (!l) continue;
    if (/^DATA:/i.test(l)) break;
    const m = l.match(/^(ROW LABELS|COLUMN LABELS|LEVEL LABELS|LABELS):?$/i);
    if (m) { block = m[1].toUpperCase(); continue; }
    if (/=/.test(l)) {
      for (const [, k, v] of l.matchAll(/(\w+)\s*=\s*([\w ]+?)(?=\s+\w+\s*=|$)/g)) head[k.toUpperCase()] = v.trim();
      block = null;
      continue;
    }
    if (block === 'ROW LABELS' || block === 'LABELS') rowLabels.push(l);
    else if (block === 'COLUMN LABELS') colLabels.push(l);
    else if (block === 'LEVEL LABELS') levels.push(l);
    else throw new Error(`DL: unexpected line ${l}`);
  }
  if (head.FORMAT && !/FULLMATRIX/i.test(head.FORMAT)) throw new Error(`DL: format ${head.FORMAT} not supported`);
  const n = Number(head.N) || 0;
  const nr = Number(head.NR) || n, nc = Number(head.NC) || n, nm = Number(head.NM) || 1;
  const nums = lines.slice(i).join(' ').trim().split(/\s+/).filter(Boolean).map(Number);
  if (nums.length !== nr * nc * nm) throw new Error(`DL: expected ${nr * nc * nm} values, found ${nums.length}`);
  const matrices = [];
  for (let k = 0; k < nm; k++) {
    const M = [];
    for (let r = 0; r < nr; r++) M.push(nums.slice(k * nr * nc + r * nc, k * nr * nc + (r + 1) * nc));
    matrices.push(M);
  }
  return { n, nr, nc, rowLabels, colLabels: colLabels.length ? colLabels : rowLabels, levels, matrices };
}

// Pajek project (.paj) or network (.net). Returns { networks: [{ name,
// vertices: [{ id, label }], arcs: [{ from, to, value, times }], edges: [...] }],
// partitions: [{ name, values }] }. `times` is the list of time points from
// Pajek's [a-b,c,d-*] interval notation (null when absent; '*' is kept open
// as Infinity and resolved by the caller).
export function parsePajek(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const networks = [], partitions = [];
  let cur = null, part = null, mode = null;
  const times = s => {
    if (!s) return null;
    const out = [];
    for (const piece of s.split(',')) {
      const [a, b] = piece.split('-');
      const lo = Number(a), hi = b === undefined ? lo : b === '*' ? Infinity : Number(b);
      out.push([lo, hi]);
    }
    return out;
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || l.startsWith('%')) continue;
    let m;
    if ((m = l.match(/^\*Network\s*(.*)$/i))) { cur = { name: m[1].trim(), vertices: [], arcs: [], edges: [] }; networks.push(cur); mode = null; part = null; continue; }
    if ((m = l.match(/^\*Partition\s*(.*)$/i))) { part = { name: m[1].trim(), values: [] }; partitions.push(part); cur = null; mode = 'partition-head'; continue; }
    if ((m = l.match(/^\*Vertices\s+(\d+)/i))) {
      if (mode === 'partition-head') { mode = 'partition'; continue; }
      if (!cur) { cur = { name: '', vertices: [], arcs: [], edges: [] }; networks.push(cur); }
      mode = 'vertices'; continue;
    }
    if (/^\*Arcs\b/i.test(l)) { mode = 'arcs'; continue; }
    if (/^\*Edges\b/i.test(l)) { mode = 'edges'; continue; }
    if (/^\*/.test(l)) { mode = null; continue; }
    if (mode === 'partition') { part.values.push(Number(l)); continue; }
    if (mode === 'vertices') {
      m = l.match(/^(\d+)\s+"([^"]*)"(.*)$/);
      if (!m) throw new Error(`Pajek: bad vertex line ${l}`);
      const t = m[3].match(/\[([^\]]+)\]/);
      cur.vertices.push({ id: Number(m[1]), label: m[2], times: times(t?.[1]) });
      continue;
    }
    if (mode === 'arcs' || mode === 'edges') {
      const t = l.match(/\[([^\]]+)\]/);
      const parts = l.replace(/\[[^\]]*\]/, '').trim().split(/\s+/).map(Number);
      cur[mode].push({ from: parts[0], to: parts[1], value: parts.length > 2 ? parts[2] : 1, times: times(t?.[1]) });
    }
  }
  return { networks, partitions };
}

// GML as written by Mark Newman's network data page: one graph, nodes with
// id and label, edges with source, target and an optional value.
export function parseGML(text) {
  const tok = text.match(/"[^"]*"|\[|\]|[^\s[\]]+/g) || [];
  let i = 0;
  const value = () => {
    const t = tok[i++];
    if (t === '[') {
      const obj = [];
      while (tok[i] !== ']') { const k = tok[i++]; obj.push([k, value()]); }
      i++;
      return obj;
    }
    if (t.startsWith('"')) return t.slice(1, -1);
    return Number(t);
  };
  const top = [];
  while (i < tok.length) { const k = tok[i++]; top.push([k, value()]); }
  const graph = top.find(([k]) => k === 'graph')?.[1];
  if (!graph) throw new Error('GML: no graph');
  const get = (o, k) => o.find(([x]) => x === k)?.[1];
  return {
    directed: get(graph, 'directed') === 1,
    nodes: graph.filter(([k]) => k === 'node').map(([, o]) => ({ id: get(o, 'id'), label: get(o, 'label') })),
    edges: graph.filter(([k]) => k === 'edge').map(([, o]) => ({ source: get(o, 'source'), target: get(o, 'target'), value: get(o, 'value') })),
  };
}
