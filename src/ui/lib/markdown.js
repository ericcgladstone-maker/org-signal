// A small Markdown renderer to Preact nodes (never innerHTML), enough for the
// methods appendix, LLM reports and analyst answers: headings, paragraphs,
// bullet and numbered lists, pipe tables, bold, italics, inline code, links, and two
// app-specific inline marks:
//   [T12]            citation of a tool result -> onCite(id) button
//   \u0001...\u0002  a span to highlight as an unverified number
// Text from a model is data: it is rendered as text nodes, so markup inside
// it cannot run.

import { html } from '../../../vendor/preact.js';

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[(T\d+)\]|\[[^\]]+\]\((https?:[^)\s]+)\)|\u0001[^\u0002]*\u0002|\*[^*\s][^*]*\*)/g;

function inline(text, opts) {
  const out = [];
  let last = 0;
  let m;
  // A fresh regex per call: inline() recurses for bold text, and a shared
  // global regex would have its lastIndex reset under the outer loop.
  const re = new RegExp(INLINE.source, 'g');
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(html`<strong>${inline(tok.slice(2, -2), opts)}</strong>`);
    else if (tok.startsWith('`')) out.push(html`<code>${tok.slice(1, -1)}</code>`);
    // Copy the id now: m is reassigned by the loop and is null by click time.
    else if (m[2]) { const cid = m[2]; out.push(opts.onCite ? html`<button type="button" class="tlink" style="font-size:.8em;font-weight:500" onClick=${() => opts.onCite(cid)} aria-label=${`Show computed result ${cid}`}>[${cid}]</button>` : tok); }
    else if (m[3]) out.push(html`<a href=${m[3]} target="_blank" rel="noopener noreferrer">${tok.slice(1, tok.indexOf(']('))}</a>`);
    else if (tok.startsWith('\u0001')) out.push(html`<mark class="unverified" title="This number does not appear in any computed result for this answer">${tok.slice(1, -1)}</mark>`);
    else if (tok.startsWith('*')) out.push(html`<em>${tok.slice(1, -1)}</em>`);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Pipe tables ("| a | b |" rows, the second a "|---|---|" divider). Models
// write them unprompted; unrendered, the divider is one unbreakable string
// that pushed the Ask panel wider than the screen.
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*(:?-{2,}:?\s*)?\|?\s*$/;
function cellsOf(row) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}
// -> { head: [cells] | null, body: [[cells]] } or null when the rows are not a table.
export function parseTable(rows) {
  if (rows.length < 2 || !TABLE_DIVIDER.test(rows[1])) return null;
  const head = cellsOf(rows[0]);
  const body = rows.slice(2).filter(r => !TABLE_DIVIDER.test(r)).map(cellsOf).map(r => head.map((_, i) => r[i] ?? ''));
  return { head, body };
}

export function renderMarkdown(src, opts = {}) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { blocks.push(html`<p>${inline(para.join(' '), opts)}</p>`); para = []; } };
  const flushList = () => { if (list) { const items = list.items.map(it => html`<li>${inline(it, opts)}</li>`); blocks.push(list.ordered ? html`<ol>${items}</ol>` : html`<ul>${items}</ul>`); list = null; } };
  let rows = [];
  const flushTable = () => {
    if (!rows.length) return;
    const t = parseTable(rows);
    if (t) blocks.push(html`<div class="md-table-wrap"><table class="md-table">
      <thead><tr>${t.head.map(c => html`<th scope="col">${inline(c, opts)}</th>`)}</tr></thead>
      <tbody>${t.body.map(r => html`<tr>${r.map(c => html`<td>${inline(c, opts)}</td>`)}</tr>`)}</tbody></table></div>`);
    else para.push(...rows.map(r => r.trim()));
    rows = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (TABLE_ROW.test(line)) { flushPara(); flushList(); rows.push(line); continue; }
    flushTable();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    const oli = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (h) { flushPara(); flushList(); const lvl = Math.min(4, h[1].length + (opts.shift || 0)); const T = `h${lvl}`; blocks.push(html`<${T}>${inline(h[2], opts)}</${T}>`); continue; }
    if (li || oli) {
      flushPara();
      const ordered = !!oli;
      if (list && list.ordered !== ordered) flushList();
      list ||= { ordered, items: [] };
      list.items.push((li || oli)[1]);
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
    flushList();
    para.push(line.trim());
  }
  flushTable(); flushPara(); flushList();
  return html`<div class="md">${blocks}</div>`;
}

// Wrap unverified number spans (from citations.js: { index, text }) in markers.
export function markUnverified(text, list = []) {
  const spans = list.filter(u => Number.isInteger(u.index) && u.text).sort((a, b) => b.index - a.index);
  let s = String(text || '');
  for (const u of spans) {
    if (s.slice(u.index, u.index + u.text.length) !== u.text) continue;
    s = `${s.slice(0, u.index)}\u0001${u.text}\u0002${s.slice(u.index + u.text.length)}`;
  }
  return s;
}

// Markdown -> standalone, print-friendly HTML (for saving reports and the
// methods appendix as files that print cleanly to PDF).
export function markdownToHTMLDocument(md, title = 'Org Signal report') {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const inl = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>').replace(/\u0001|\u0002/g, '');
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<${list.t}>${list.items.map(i => `<li>${inl(i)}</li>`).join('')}</${list.t}>`); list = null; } };
  let para = [];
  const flushP = () => { if (para.length) { out.push(`<p>${inl(para.join(' '))}</p>`); para = []; } };
  let rows = [];
  const flushT = () => {
    if (!rows.length) return;
    const t = parseTable(rows);
    if (t) out.push(`<table><thead><tr>${t.head.map(c => `<th>${inl(c)}</th>`).join('')}</tr></thead><tbody>${t.body.map(r => `<tr>${r.map(c => `<td>${inl(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    else para.push(...rows.map(r => r.trim()));
    rows = [];
  };
  for (const line of String(md).split('\n')) {
    if (TABLE_ROW.test(line)) { flushP(); flush(); rows.push(line); continue; }
    flushT();
    const h = line.match(/^(#{1,4})\s+(.*)$/), li = line.match(/^\s*[-*]\s+(.*)$/), ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (h) { flushP(); flush(); out.push(`<h${h[1].length}>${inl(h[2])}</h${h[1].length}>`); }
    else if (li || ol) { flushP(); const t = ol ? 'ol' : 'ul'; if (list && list.t !== t) flush(); list ||= { t, items: [] }; list.items.push((li || ol)[1]); }
    else if (!line.trim()) { flushP(); flush(); }
    else { flush(); para.push(line.trim()); }
  }
  flushT(); flushP(); flush();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:'Geist',system-ui,-apple-system,sans-serif;max-width:46rem;margin:2.5rem auto;padding:0 1.25rem;color:#0b1620;line-height:1.6;font-size:15px}
h1{font-weight:500;font-size:1.8rem;letter-spacing:-.02em;margin:0 0 1rem}h2{font-size:1.15rem;margin:2rem 0 .6rem;padding-top:.8rem;border-top:1px solid #d5dde3}h3{font-size:1rem;margin:1.2rem 0 .4rem}
code{font-family:ui-monospace,Menlo,monospace;font-size:.85em}a{color:#0b6b57}ul,ol{padding-left:1.25rem}table{border-collapse:collapse;margin:1rem 0;font-size:.9em}th,td{border-bottom:1px solid #d5dde3;padding:.35rem .6rem;text-align:left;vertical-align:top}th{font-weight:600}.foot{margin-top:3rem;font-size:.8rem;color:#5a6b78;border-top:1px solid #d5dde3;padding-top:.6rem}
@media print{body{margin:0;max-width:none}h2{break-after:avoid}}</style></head><body>
${out.join('\n')}
<p class="foot">Generated by Org Signal on ${new Date().toISOString().slice(0, 10)}. Computed locally.</p>
</body></html>`;
}
