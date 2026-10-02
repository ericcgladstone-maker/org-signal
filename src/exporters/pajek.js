// Pajek .net export. Spec: docs/formats/network-files.md section 4.
//
// Every vertex line is written (networkx expects exactly N of them) with a
// quoted, unique label, because networkx keys nodes by label. Quotes and
// backslashes are backslash-escaped, which networkx's shlex split undoes;
// Pajek itself may show the backslash [UNVERIFIED]. Newlines and control
// characters are removed. UTF-8, as networkx reads it; classic Pajek expects
// an ANSI code page [UNVERIFIED]. Attributes are not exported (Pajek has no
// general attribute syntax); use GraphML, GEXF or CSV for those.

import { nodeLabel, uniqueLabels } from './graphml.js';

const CTRL = /[\u0000-\u001F\u007F]/g;

export function pajekQuote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function exportPajek(ds, net, opts = {}) {
  const labels = uniqueLabels(Array.from({ length: net.n }, (_, i) => nodeLabel(ds, net, i)), s => s.replace(CTRL, ' ').replace(/\s+/g, ' ').trim());
  const out = [`*Vertices ${net.n}`];
  for (let i = 0; i < net.n; i++) out.push(`${i + 1} ${pajekQuote(labels[i])}`);
  out.push(net.directed ? '*Arcs' : '*Edges');
  const E = net.edges;
  for (let e = 0; e < E.count; e++) out.push(`${E.src[e] + 1} ${E.dst[e] + 1} ${E.w[e]}`);
  return out.join('\n') + '\n';
}

export default exportPajek;
