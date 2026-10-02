// Tokenizer and a cached, integer-coded corpus of message texts.
//
// Keywords, topics and diffusion all read the same tokens, so the corpus is
// built once per dataset (WeakMap cache) and stored as flat typed arrays.

import { STOPWORDS } from './stopwords.js';
import { floorTo } from '../time.js';

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/giu;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gu;
// Slack-style <@U123>, <#C123|name>, <!channel>, <https://...|label>
const ANGLE_RE = /<[@#!][^>]*>|<https?:[^>]*>/gu;
const MENTION_RE = /(^|[^\w])@[\p{L}\p{N}_.-]+/gu;
const EMOJI_CODE_RE = /:[a-z0-9_+-]{2,40}:/gu;
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}‍️]/gu;
const WORD_RE = /[\p{L}\p{M}][\p{L}\p{M}\p{N}'’_-]*/gu;

// opts: { stopwords: true, minLength: 2, keepEmoji: false }
export function tokenize(text, opts = {}) {
  if (!text) return [];
  let s = String(text).normalize('NFKC');
  s = s.replace(ANGLE_RE, ' ').replace(URL_RE, ' ').replace(EMAIL_RE, ' ').replace(MENTION_RE, '$1 ').replace(EMOJI_CODE_RE, ' ');
  const emoji = opts.keepEmoji ? s.match(EMOJI_RE) || [] : [];
  s = s.replace(EMOJI_RE, ' ').toLowerCase();
  const minLen = opts.minLength ?? 2;
  const stop = opts.stopwords === false ? null : STOPWORDS;
  const out = [];
  for (const m of s.matchAll(WORD_RE)) {
    let w = m[0].replace(/[’]/g, "'").replace(/^['_-]+|['_-]+$/g, '');
    if (w.endsWith("'s")) w = w.slice(0, -2);
    if ([...w].length < minLen) continue;
    if (stop && (stop.has(w) || stop.has(w.replace(/'/g, '')))) continue;
    out.push(w);
  }
  return opts.keepEmoji ? out.concat(emoji) : out;
}

const cache = new WeakMap();

// { docs Int32Array (event index per doc), off Int32Array, tok Int32Array,
//   terms string[], df Int32Array, termIndex Map }. Messages with text only.
export function corpus(ds) {
  let c = cache.get(ds);
  if (c) return c;
  const ev = ds.events;
  const termIndex = new Map(), terms = [];
  const docs = [], off = [0], tok = [];
  const dfArr = [];
  for (let i = 0; i < ev.count; i++) {
    const text = ev.text?.[i];
    if (!text || ev.type[i] !== 0) continue;
    const words = tokenize(text);
    const seen = new Set();
    for (const w of words) {
      let id = termIndex.get(w);
      if (id === undefined) { id = terms.length; termIndex.set(w, id); terms.push(w); dfArr.push(0); }
      tok.push(id);
      if (!seen.has(id)) { seen.add(id); dfArr[id]++; }
    }
    docs.push(i); off.push(tok.length);
  }
  c = { docs: Int32Array.from(docs), off: Int32Array.from(off), tok: Int32Array.from(tok), terms, df: Int32Array.from(dfArr), termIndex };
  cache.set(ds, c);
  return c;
}

// Unit (grouping) of each document: node / context / visibility / attr / window / overall.
// Returns { unitOf(docIndex) -> key|null, label(key) }.
export function unitResolver(ds, by, opts = {}) {
  const ev = ds.events;
  const VIS = ['public', 'private', 'direct', 'group', 'unknown'];
  if (by === 'node') return { of: (i) => ev.actor[i], label: (k) => ds.nodes.labels[k] };
  if (by === 'context') return { of: (i) => (ev.context[i] >= 0 ? ev.context[i] : null), label: (k) => ds.contexts.names[k] };
  if (by === 'visibility') return { of: (i) => (ev.context[i] >= 0 ? VIS[ds.contexts.visibility[ev.context[i]]] : 'unknown'), label: (k) => k };
  if (by === 'group' || by === 'attr') {
    const attr = opts.attr;
    if (!attr) throw new Error('by: group needs opts.attr');
    return { of: (i) => { const v = ds.nodes.attrs[ev.actor[i]]?.[attr]; return v == null || v === '' ? null : String(v); }, label: (k) => `${k}` };
  }
  if (by === 'window') {
    const unit = opts.window ?? 'week';
    if (typeof unit === 'number') return { of: (i) => (Number.isFinite(ev.t[i]) ? Math.floor(ev.t[i] / unit) * unit : null), label: (k) => new Date(k).toISOString().slice(0, 16).replace('T', ' ') };
    return { of: (i) => (Number.isFinite(ev.t[i]) ? floorTo(ev.t[i], unit) : null), label: (k) => new Date(k).toISOString().slice(0, unit === 'month' ? 7 : 10) };
  }
  return { of: () => 'all', label: () => 'All messages' };
}
