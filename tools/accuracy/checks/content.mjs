// Content measures against naive recomputations.
//
// Random message datasets with text built to hit the cleaning and tokenizing
// rules (sentiment words with negation and intensifiers, emoji, URLs,
// mentions, quoted email replies, signatures, non-English, texts over 5,000
// characters, blank and whitespace-only text, people's names, bots, undated
// messages, non-message events with text). Checked:
//   - affect(): per-message compound = vendor VADER polarity_scores().compound
//     on the documented input (cleanText, falling back to the raw text when
//     cleaning leaves nothing, first 5,000 characters), stored as Float32;
//     every aggregated row (n, mean, sd, se, pos, neg, neu, posShare,
//     negShare) for every `by` unit = a naive recomputation from those scores.
//   - keywords(): per-unit counts, token totals, df, tfidf = tf x (ln((1+U) /
//     (1+df)) + 1), the top-k order, and the overall counts = a naive recount
//     with tokenize(cleanText(text).text, { extraStop: nameStopwords(ds) }).
//   - tokenize(): the documented rules on targeted inputs (TOKENIZE_CASES).

import vaderModule from '../../../vendor/vader.js';
import { DatasetBuilder, VIEWS } from '../../../src/core/model.js';
import { affect } from '../../../src/analysis/content/affect.js';
import { keywords } from '../../../src/analysis/content/keywords.js';
import { tokenize, cleanText, nameStopwords } from '../../../src/analysis/content/corpus.js';
import { floorTo } from '../../../src/analysis/time.js';
import { createRng } from '../../../src/analysis/rng.js';
import { close, tally } from '../lib.mjs';

export const name = 'content';
export const title = 'Content measures: VADER per message and aggregated, keyword counts and TF-IDF, tokenizer rules';

const SIA = vaderModule.SentimentIntensityAnalyzer;
const T0 = Date.UTC(2026, 2, 2);
const DAY = 86400000;

const FIRST = ['Ann', 'Bob', 'Chen', 'Dana', 'Emeka', 'Fatima', 'Gus', 'Hana', 'Ivo', 'Jules', 'Kofi', 'Lena'];
const PHRASES = [
  'this is great', 'not good at all', 'absolutely TERRIBLE!!!', 'I love it :)', 'kind of nice', 'meh', 'the build is broken again',
  'thanks so much, really helpful', 'I am not happy with the latency', 'wonderful work team', 'awful, just awful', 'no problem',
  'deploy the endpoint', 'invoice for the vendor', 'payroll forecast review', 'kubernetes cluster upgrade', 'warehouse shipment delayed',
  'quarterly budget-review', "the team's roadmap", 'café meeting notes', 'but it was fine', 'very very bad', 'not bad', ':(', 'lol ok',
];
const EXTRAS = [
  ' \u{1F389}', ' \u{1F44D}\u{1F3FD}', ' :tada:', ' https://example.org/a?b=1', ' www.foo.com', ' mail ann@example.org', ' <@U012AB>', ' <!channel>',
  ' #launch', ' @bob', ' Ｆｕｌｌｗｉｄｔｈ', ' on Monday in March', ' Fwd:', ' 2026 q3',
];
const QUOTED = [
  '\n\nOn Mon, 3 Mar 2026 at 09:00, Ann Lee <ann@example.org> wrote:\n> this is terrible, I hate it\n> really awful',
  '\n> quoted complaint, horrible\n> more quoted text',
  '\n\n-----Original Message-----\nFrom: Bob\nSent: Monday\nTo: Ann\nSubject: re\nawful awful awful',
  '\n-- \nDana Kim\nHead of Things, ACME',
  '\nSent from my iPhone',
  '\n\nLe lun. 3 mars 2026, Chen a écrit :\n> c\'est terrible',
];
const FOREIGN = ['Привет, как дела у тебя сегодня', 'これはとても良いです', 'la reunión de mañana und der Plan', 'Ça va très bien, merci'];

function makeText(rng, labels) {
  const r = rng();
  if (r < 0.04) return null;
  if (r < 0.06) return '   \n ';
  if (r < 0.09) return FOREIGN[rng.int(FOREIGN.length)];
  if (r < 0.11) { // longer than 5,000 characters, with the tone at the end
    let s = '';
    while (s.length < 5200) s += PHRASES[rng.int(PHRASES.length)] + '. ';
    return s + 'awful terrible horrible';
  }
  if (r < 0.13) return QUOTED[rng.int(QUOTED.length)].trimStart(); // nothing but quoted text
  const parts = [];
  const k = 1 + rng.int(4);
  for (let i = 0; i < k; i++) parts.push(PHRASES[rng.int(PHRASES.length)]);
  let s = parts.join(rng() < 0.5 ? '. ' : ', ');
  if (rng() < 0.4) s += EXTRAS[rng.int(EXTRAS.length)];
  if (rng() < 0.2) s = `${labels[rng.int(labels.length)].split(' ')[0]}, ${s}`;
  if (rng() < 0.2) s += QUOTED[rng.int(QUOTED.length)];
  return s;
}

// -> Dataset with two sources, contexts of every visibility, bots, undated
// messages and a few non-message events carrying text.
export function contentDataset(seed, { people = 12, messages = 300 } = {}) {
  const rng = createRng(`content|${seed}`);
  const b = new DatasetBuilder({ name: 'content', source: { format: 'slack', view: VIEWS.FULL } });
  const labels = [];
  const ps = [];
  for (let i = 0; i < people; i++) {
    const label = `${FIRST[i % FIRST.length]} ${['Lee', 'Kim', 'Okafor', 'Silva'][i % 4]}`;
    labels.push(label);
    ps.push(b.node(`slack:U${i}`, { label, attrs: { team: rng() < 0.1 ? undefined : ['Ops', 'Eng', 'Sales'][i % 3] }, isBot: i === people - 1 }));
  }
  const ctx = [
    b.context('c:gen', { name: 'general', kind: 'channel', visibility: 'public' }),
    b.context('c:dm', { name: 'dm', kind: 'dm', visibility: 'direct' }),
    b.context('c:grp', { name: 'group', kind: 'group_dm', visibility: 'group' }),
    -1,
  ];
  const half = Math.floor(messages / 2);
  for (let k = 0; k < messages; k++) {
    if (k === half) {
      b.beginSource({ format: 'email', view: VIEWS.FULL });
      ctx[1] = b.context('e:thread', { name: 'thread', kind: 'email_thread', visibility: 'private' });
    }
    const a = ps[rng.int(people)];
    const t = rng() < 0.05 ? NaN : T0 + Math.floor(rng() * 60 * DAY);
    const type = rng() < 0.05 ? 'reaction' : 'message';
    b.event({ type, actor: a, t, context: ctx[rng.int(ctx.length)], text: makeText(rng, labels) });
  }
  return b.build();
}

// What affect() documents it scores for event i, or null when it scores nothing.
export function vaderInput(ds, i) {
  if (ds.events.type[i] !== 0) return null;
  const raw = ds.events.text?.[i];
  if (!raw || !String(raw).trim()) return null;
  const cl = cleanText(raw);
  const text = cl.text.trim() ? cl.text : String(raw);
  return text.length > 5000 ? text.slice(0, 5000) : text;
}

const VIS = ['public', 'private', 'direct', 'group', 'unknown'];
const SOURCE_NAMES = { email: 'Email', slack: 'Slack' };
function unitOf(ds, by, i, opts) {
  const ev = ds.events;
  if (by === 'overall') return 'all';
  if (by === 'node') return ev.actor[i];
  if (by === 'context') return ev.context[i] >= 0 ? ev.context[i] : null;
  if (by === 'visibility') return ev.context[i] >= 0 ? VIS[ds.contexts.visibility[ev.context[i]]] : 'unknown';
  if (by === 'source') return SOURCE_NAMES[ds.meta.sources[ev.source[i]].format];
  if (by === 'group') { const v = ds.nodes.attrs[ev.actor[i]]?.[opts.attr]; return v == null || v === '' ? null : String(v); }
  if (by === 'window') return Number.isFinite(ev.t[i]) ? floorTo(ev.t[i], opts.window) : null;
  throw new Error(by);
}

export const AFFECT_BYS = ['overall', 'node', 'group', 'context', 'visibility', 'source', 'window'];

export function checkAffect(ds, t, tag) {
  const opts = { by: AFFECT_BYS, attr: 'team', window: 'week', perMessage: true };
  const r = affect(ds, opts);
  const comp = new Float32Array(ds.events.count).fill(NaN), pos = new Float32Array(ds.events.count), neg = new Float32Array(ds.events.count), neu = new Float32Array(ds.events.count);
  let scored = 0;
  for (let i = 0; i < ds.events.count; i++) {
    const text = vaderInput(ds, i);
    if (text === null) { t.cmp(Number.isNaN(r.perMessage[i]), { tag, what: 'unscored message has a score', event: i, got: r.perMessage[i] }); continue; }
    const s = SIA.polarity_scores(text);
    comp[i] = s.compound; pos[i] = s.pos; neg[i] = s.neg; neu[i] = s.neu;
    scored++;
    t.cmp(r.perMessage[i] === Math.fround(s.compound), { tag, what: 'compound', event: i, text: text.slice(0, 80), got: r.perMessage[i], expected: s.compound });
  }
  t.cmp(r.coverage.scored === scored, { tag, what: 'coverage.scored', got: r.coverage.scored, expected: scored });
  for (const by of AFFECT_BYS) {
    const acc = new Map();
    for (let i = 0; i < ds.events.count; i++) {
      if (Number.isNaN(comp[i]) || ds.nodes.isBot[ds.events.actor[i]]) continue;
      const k = unitOf(ds, by, i, opts);
      if (k === null) continue;
      if (!acc.has(k)) acc.set(k, []);
      acc.get(k).push(i);
    }
    const rows = r.by[by];
    t.cmp(rows.length === acc.size, { tag, what: `affect ${by} row count`, got: rows.length, expected: acc.size });
    for (const row of rows) {
      const ids = acc.get(row.key);
      if (!t.cmp(!!ids, { tag, what: `affect ${by} unexpected key`, key: row.key })) continue;
      const n = ids.length;
      const xs = ids.map(i => comp[i]);
      const m = xs.reduce((s, x) => s + x, 0) / n;
      const sd = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : NaN;
      const exp = {
        n, mean: m, sd, se: n > 1 ? sd / Math.sqrt(n) : NaN,
        pos: ids.reduce((s, i) => s + pos[i], 0) / n, neg: ids.reduce((s, i) => s + neg[i], 0) / n, neu: ids.reduce((s, i) => s + neu[i], 0) / n,
        posShare: xs.filter(x => x >= 0.05).length / n, negShare: xs.filter(x => x <= -0.05).length / n,
      };
      for (const [k, v] of Object.entries(exp)) t.cmp(close(row[k], v, 1e-9), { tag, what: `affect ${by}[${row.key}].${k}`, got: row[k], expected: v });
    }
  }
}

export function checkKeywords(ds, t, tag, { by = 'node', k = 10, minCount = 2, minTokens = 20, attr = 'team' } = {}) {
  const r = keywords(ds, { by, attr, k, minCount, minTokens, window: 'week' });
  const names = nameStopwords(ds);
  const units = new Map(), totals = new Map(), overall = new Map(), messages = new Map();
  // overall and messages: non-bot messages that fall in a unit of `by`.
  for (let i = 0; i < ds.events.count; i++) {
    const text = ds.events.text?.[i];
    if (!text || ds.events.type[i] !== 0) continue;
    if (ds.nodes.isBot[ds.events.actor[i]]) continue;
    const toks = tokenize(cleanText(text).text, { extraStop: names });
    const key = unitOf(ds, by, i, { attr, window: 'week' });
    if (key === null) continue;
    for (const w of new Set(toks)) messages.set(w, (messages.get(w) || 0) + 1);
    if (!units.has(key)) { units.set(key, new Map()); totals.set(key, 0); }
    const m = units.get(key);
    for (const w of toks) { m.set(w, (m.get(w) || 0) + 1); overall.set(w, (overall.get(w) || 0) + 1); }
    totals.set(key, totals.get(key) + toks.length);
  }
  const keys = [...units.keys()].filter(x => totals.get(x) >= minTokens);
  const df = new Map();
  for (const key of keys) for (const w of units.get(key).keys()) df.set(w, (df.get(w) || 0) + 1);
  const U = keys.length;
  t.cmp(r.meta.units === U, { tag, what: `keywords ${by} qualifying units`, got: r.meta.units, expected: U });
  t.cmp(r.units.length === Math.min(U, 300), { tag, what: `keywords ${by} rows`, got: r.units.length, expected: U });
  for (const row of r.units) {
    const m = units.get(row.key);
    if (!t.cmp(!!m, { tag, what: `keywords ${by} unexpected unit`, key: row.key })) continue;
    t.cmp(row.tokens === totals.get(row.key), { tag, what: `keywords ${by}[${row.key}] tokens`, got: row.tokens, expected: totals.get(row.key) });
    const exp = [...m].filter(([, c]) => c >= minCount)
      .map(([w, c]) => ({ term: w, count: c, tfidf: (c / totals.get(row.key)) * (Math.log((1 + U) / (1 + df.get(w))) + 1) }))
      .sort((a, b) => b.tfidf - a.tfidf || b.count - a.count || (a.term < b.term ? -1 : 1)).slice(0, k);
    t.cmp(row.terms.length === exp.length, { tag, what: `keywords ${by}[${row.key}] term count`, got: row.terms.length, expected: exp.length });
    row.terms.forEach((x, j) => {
      const e = exp[j];
      t.cmp(e && x.term === e.term && x.count === e.count && close(x.tfidf, e.tfidf, 1e-12), { tag, what: `keywords ${by}[${row.key}] term ${j}`, got: x, expected: e });
    });
  }
  // Overall: counts from non-bot messages; `messages` = messages using the term.
  for (const x of r.overall) {
    t.cmp(x.count === (overall.get(x.term) || 0), { tag, what: `keywords overall count ${x.term}`, got: x.count, expected: overall.get(x.term) });
    t.cmp(x.messages === (messages.get(x.term) || 0), { tag, what: `keywords overall messages ${x.term}`, got: x.messages, expected: messages.get(x.term) });
  }
  const top = [...overall.values()].sort((a, b) => b - a).slice(0, r.overall.length);
  t.cmp(JSON.stringify(r.overall.map(x => x.count)) === JSON.stringify(top), { tag, what: 'keywords overall ranking', got: r.overall.map(x => x.count).slice(0, 10), expected: top.slice(0, 10) });
}

// Targeted tokenizer cases for each documented rule.
export const TOKENIZE_CASES = [
  ['NFKC and lower case', 'Ｆｕｌｌｗｉｄｔｈ CAFÉ', ['fullwidth', 'café']],
  ['Slack markup', 'check <@U012AB> budget <#C1|general> <!channel> <https://x.org|link> report', ['check', 'budget', 'report']],
  ['URLs', 'check https://example.org/a?b=1 and www.foo.com today', ['check', 'today']],
  ['emails', 'mail ann.lee+x@example.co.uk today', ['mail', 'today']],
  ['mentions', 'ping @bob.smith and @ann_lee about budget', ['ping', 'budget']],
  ['emoji codes and emoji', 'launch :tada: \u{1F389} \u{1F44D}\u{1F3FD} \u{1F1EB}\u{1F1F7} party', ['launch', 'party']],
  ['hashtags keep the word', '#Launch #q3_plan', ['launch', 'q3_plan']],
  ['possessive s', "Ann's team’s budget", ['ann', 'team', 'budget']],
  ['English stopwords incl. curly apostrophes', 'the report isn’t ready and they’re late', ['report', 'ready', 'late']],
  ['other-language function words', 'la reunión de mañana und der Plan', ['reunión', 'mañana', 'plan']],
  ['weekdays, months, mail furniture', 'Fwd: on Monday in March Ann wrote budget', ['ann', 'budget']],
  ['minimum length 2, words start with a letter', 'a b 2026 q3 x1', ['q3', 'x1']],
];

export function checkTokenize(t) {
  for (const [rule, input, expected] of TOKENIZE_CASES) {
    const got = tokenize(input);
    t.cmp(JSON.stringify(got) === JSON.stringify(expected), { what: `tokenize: ${rule}`, input, got, expected });
  }
  const extra = tokenize('ann budget lee', { extraStop: new Set(['ann', 'lee']) });
  t.cmp(JSON.stringify(extra) === '["budget"]', { what: 'tokenize: extraStop', got: extra });
}

export async function run({ count = 100, seed = 1, log = () => {} } = {}) {
  const t = tally(name);
  const t0 = Date.now();
  checkTokenize(t);
  for (let c = 0; c < count; c++) {
    const s = seed * 100000 + c;
    const ds = contentDataset(s, { people: 4 + (c % 12), messages: 60 + (c % 5) * 80 });
    t.case();
    checkAffect(ds, t, `seed ${s}`);
    for (const by of ['node', 'group', 'context', 'source', 'visibility', 'window', 'overall']) checkKeywords(ds, t, `seed ${s}`, { by, minTokens: by === 'node' ? 20 : 5 });
    if (c % 25 === 0) log(`content ${c}/${count}`);
  }
  t.stats.seconds = (Date.now() - t0) / 1000;
  t.notes.push('Per-message compound is stored as Float32 (affect.js scoreMessages), so it equals Math.fround(vendor compound) exactly; aggregates are compared at 1e-9 with a two-pass recomputation from those Float32 scores.');
  return t.result();
}
