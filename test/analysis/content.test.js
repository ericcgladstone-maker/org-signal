import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder, VIEWS } from '../../src/core/model.js';
import { tokenize, affect, keywords, topics, diffusion, likelyNonEnglish } from '../../src/analysis/content/index.js';
import { cleanText, nameStopwords, corpus } from '../../src/analysis/content/corpus.js';
import { buildNetwork, defaultSettings, networkFromEdges } from '../../src/analysis/construct.js';
import { createRng } from '../../src/analysis/rng.js';

const T0 = Date.UTC(2026, 0, 5);
const OPS_WORDS = new Set(['invoice', 'vendor', 'shipment', 'warehouse', 'payroll', 'forecast', 'love', 'wonderful', 'work']);
const ENG_WORDS = new Set(['kubernetes', 'deploy', 'latency', 'compiler', 'refactor', 'endpoint', 'awful', 'broken', 'hate']);
const H = 3600000;

test('tokenizer strips URLs, mentions, emails, markup and emoji; drops stopwords', () => {
  const t = tokenize("Hey <@U012AB> check https://x.org/a?b=1 and www.foo.com, mail ann@x.org :tada: \u{1F389} the Q3 Budget-review isn't DONE!! #launch @bob café");
  assert.deepEqual(t, ['check', 'mail', 'q3', 'budget-review', 'done', 'launch', 'café']);
  assert.deepEqual(tokenize('la reunión de mañana und der Plan'), ['reunión', 'mañana', 'plan']);
  assert.deepEqual(tokenize("Ann's report", { stopwords: false }), ['ann', 'report']);
  assert.deepEqual(tokenize('\u{1F389} ok', { keepEmoji: true, stopwords: false }), ['ok', '\u{1F389}']);
  assert.ok(likelyNonEnglish('Привет, как дела у тебя сегодня'));
  assert.ok(!likelyNonEnglish('Hello, how are you today'));
});

function contentDataset() {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL } });
  const ps = Array.from({ length: 8 }, (_, i) => b.node('t:' + i, { label: 'P' + i, attrs: { team: i < 4 ? 'Ops' : 'Eng' } }));
  const ch = b.context('c', { name: 'general', kind: 'channel', visibility: 'public' });
  const dm = b.context('d', { name: 'dm', kind: 'dm', visibility: 'direct' });
  const rng = createRng(3);
  const ops = ['invoice', 'vendor', 'shipment', 'warehouse', 'payroll', 'forecast'];
  const eng = ['kubernetes', 'deploy', 'latency', 'compiler', 'refactor', 'endpoint'];
  for (let k = 0; k < 400; k++) {
    const a = rng.int(8), vocab = a < 4 ? ops : eng;
    const words = Array.from({ length: 6 }, () => vocab[rng.int(6)]);
    const mood = a < 4 ? 'this is great, I love it, wonderful work' : 'this is awful and broken, I hate it';
    b.event({ actor: ps[a], t: T0 + k * H, context: k % 5 ? ch : dm, text: `${words.join(' ')} ${mood}` });
  }
  b.event({ actor: ps[0], t: T0, context: ch, text: null });
  return b.build();
}

test('affect: VADER by group, context, visibility and window, with coverage', () => {
  const ds = contentDataset();
  const r = affect(ds, { by: ['group', 'visibility', 'node', 'window', 'overall'], attr: 'team', window: 'week' });
  assert.equal(r.coverage.messages, 401);
  assert.equal(r.coverage.withText, 400);
  assert.equal(r.coverage.scored, 400);
  assert.match(r.note, /approximate/);
  const ops = r.by.group.find(g => g.key === 'Ops'), eng = r.by.group.find(g => g.key === 'Eng');
  assert.ok(ops.mean > 0.5 && eng.mean < -0.5, `${ops.mean} ${eng.mean}`);
  assert.equal(ops.posShare, 1);
  assert.equal(ops.n + eng.n, 400);
  assert.deepEqual(r.by.visibility.map(v => v.key).sort(), ['direct', 'public']);
  assert.equal(r.by.node.length, 8);
  assert.ok(r.by.window.length >= 3);
  assert.ok(r.by.window[0].key < r.by.window[1].key, 'windows in time order');
  assert.equal(r.by.overall[0].n, 400);
  const single = affect(ds, { by: 'context' });
  assert.equal(single.groups.length, 2);
});

test('keywords: TF-IDF surfaces each unit\'s own vocabulary', () => {
  const ds = contentDataset();
  const r = keywords(ds, { by: 'group', attr: 'team', k: 6 });
  const ops = r.units.find(u => u.key === 'Ops'), eng = r.units.find(u => u.key === 'Eng');
  // Each team's own words (topic vocabulary and mood words) outrank anything shared.
  assert.ok(ops.terms.every(t => OPS_WORDS.has(t.term)), JSON.stringify(ops.terms));
  assert.ok(eng.terms.every(t => ENG_WORDS.has(t.term)), JSON.stringify(eng.terms));
  const byNode = keywords(ds, { by: 'node', k: 3 });
  assert.equal(byNode.units.length, 8);
  assert.ok(r.overall.length > 0);
});

test('topics: LDA separates two planted vocabularies, reproducibly', () => {
  const ds = contentDataset();
  const a = topics(ds, { k: 2, seed: 4, iterations: 60, maxDfShare: 0.6, attr: 'team' });
  const b = topics(ds, { k: 2, seed: 4, iterations: 60, maxDfShare: 0.6, attr: 'team' });
  assert.deepEqual(a.topics, b.topics);
  const sides = a.topics.map(t => t.terms.slice(0, 5).filter(x => OPS_WORDS.has(x.term)).length);
  assert.ok((sides[0] === 5 && sides[1] === 0) || (sides[0] === 0 && sides[1] === 5), JSON.stringify(a.topics.map(t => t.terms.map(x => x.term))));
  const opsTopic = sides[0] === 5 ? 0 : 1;
  const g = a.byGroup.find(x => x.key === 'Ops');
  assert.ok(g.shares[opsTopic] > 0.6, JSON.stringify(g));
  assert.equal(a.byNode.length, 8);
  assert.ok(Math.abs(a.byNode[0].shares.reduce((s, x) => s + x, 0) - 1) < 1e-6);
  assert.equal(a.meta.seed, 4);
});

// Diffusion: a word spreads along a chain 0-1-2-...-9 one step a day.
function diffusionDataset({ alongTies }) {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL } });
  const ps = Array.from({ length: 30 }, (_, i) => b.node('t:' + i, { label: 'P' + i }));
  const ch = b.context('c', { kind: 'channel', visibility: 'public' });
  const rng = createRng(9);
  // Ties: a ring plus a few chords, from DMs.
  for (let i = 0; i < 30; i++) for (let k = 0; k < 3; k++) b.event({ actor: ps[i], t: T0 + k, targets: [[ps[(i + 1) % 30], 'dm']] });
  for (let d = 0; d < 60; d++) b.event({ actor: ps[rng.int(30)], t: T0 + d * 24 * H, context: ch, text: 'regular status update about the project' });
  const order = alongTies ? Array.from({ length: 20 }, (_, i) => i) : rng.shuffle(Array.from({ length: 30 }, (_, i) => i)).slice(0, 20);
  order.forEach((p, k) => b.event({ actor: ps[p], t: T0 + (20 + k) * 24 * H, context: ch, text: 'have you tried the zorblax dashboard' }));
  return b.build();
}

test('diffusion: spread along ties beats the time-shuffle null; random adoption does not', () => {
  const ds = diffusionDataset({ alongTies: true });
  const s = defaultSettings(ds);
  s.rules.adjacency.on = false;
  const net = buildNetwork(ds, s);
  const r = diffusion(ds, net, { terms: ['zorblax'], reps: 300, seed: 2 });
  const z = r.terms[0];
  assert.equal(z.adopters, 20);
  assert.equal(z.exposedShare, 1);
  assert.ok(z.null.z > 3, `z ${z.null.z}`);
  assert.ok(z.null.pUpper < 0.01);
  assert.equal(z.cascade.roots, 1);
  assert.equal(z.cascade.maxDepth, 19);
  assert.equal(z.adoptions[1].from, z.adoptions[0].node);

  const rnd = diffusionDataset({ alongTies: false });
  const s2 = defaultSettings(rnd);
  s2.rules.adjacency.on = false;
  const r2 = diffusion(rnd, buildNetwork(rnd, s2), { terms: ['zorblax'], reps: 300, seed: 2 });
  assert.ok(r2.terms[0].null.z < 2.5, `z ${r2.terms[0].null.z}`);

  // Automatic term choice finds the new word, not the everyday one.
  const auto = diffusion(ds, net, { reps: 50, seed: 2 });
  assert.ok(auto.terms.some(t => t.term === 'zorblax'), JSON.stringify(auto.terms.map(t => t.term)));
  assert.ok(!auto.terms.some(t => t.term === 'status'));
  assert.ok(networkFromEdges);
});

test('quoted replies, forwarded headers and signatures are stripped before counting words', () => {
  const reply = 'Makes sense to me. Ran the migration again.\n\nOn Wed, Mar 19, 2025 at 19:18, Yolanda Grunewald <yolanda@brightwellvale.example> wrote:\n> Really appreciate the help here.\n> Thanks\n\n--\nFelipe Ferreira\nBrightwell Vale';
  const c = cleanText(reply);
  assert.equal(c.text.trim(), 'Makes sense to me. Ran the migration again.');
  assert.ok(c.quoted);
  assert.equal(cleanText('Short answer\nOn Tue, 4 Feb 2025 at 10:12, Ann Lee <ann@x.org>\nwrote:\n> earlier').text.trim(), 'Short answer');
  assert.equal(cleanText('See below\n\n-----Original Message-----\nFrom: Bo\nSent: Monday\nquoted').text.trim(), 'See below');
  assert.equal(cleanText('Agreed\n________________\nFrom: Bo Chen\nSent: Tuesday').text.trim(), 'Agreed');
  assert.equal(cleanText('Ok will do\n\nSent from my iPhone').text.trim(), 'Ok will do');
  const plain = cleanText('one line, nothing quoted');
  assert.equal(plain.text, 'one line, nothing quoted');
  assert.ok(!plain.quoted && !plain.signature);
});

test('names in the data, weekdays and months are not keywords or topic words', () => {
  const b = new DatasetBuilder({ source: { format: 'email', view: VIEWS.EGO } });
  const me = b.node('email:felipe.ferreira@brightwellvale.example', { label: 'Felipe Ferreira' });
  const yo = b.node('email:yolanda@brightwellvale.example', { label: 'Yolanda Grunewald' });
  for (let k = 0; k < 60; k++) {
    b.event({ actor: k % 2 ? me : yo, t: T0 + k * H, targets: [[k % 2 ? yo : me, 'to']],
      text: k < 40
        ? `Deploy schema migration review ${k % 3 ? 'staging' : 'rollback'}\n\nOn Tue, Feb 4, 2025 at 10:12, Felipe Ferreira <felipe.ferreira@brightwellvale.example> wrote:\n> Yolanda, Monday works\n\n--\nFelipe Ferreira, Brightwellvale`
        : `Schema migration on staging, Yolanda\n-- \nFelipe Ferreira\nBrightwellvale, Thursday office hours` });
  }
  const ds = b.build();
  const stop = nameStopwords(ds);
  for (const w of ['felipe', 'ferreira', 'yolanda', 'grunewald', 'brightwellvale']) assert.ok(stop.has(w), w);
  assert.ok(!stop.has('example') && !stop.has('com'));
  const C = corpus(ds);
  assert.equal(C.cleaning.quoted, 40);
  assert.equal(C.cleaning.signatures, 20);
  const words = new Set(C.terms);
  for (const w of ['felipe', 'ferreira', 'yolanda', 'brightwellvale', 'wrote', 'tue', 'feb', 'monday', 'thursday']) assert.ok(!words.has(w), w);
  assert.ok(words.has('migration') && words.has('schema'));
  const kw = keywords(ds, { by: 'node', k: 5 });
  assert.equal(kw.meta.cleaning.quoted, 40);
  assert.ok(kw.units.every(u => u.terms.every(t => !['felipe', 'ferreira', 'wrote'].includes(t.term))));
  // Sentiment scores only the sender's own words.
  const a = affect(ds, { by: 'source' });
  assert.equal(a.coverage.quotedRemoved, 40);
  assert.deepEqual(a.groups.map(g => g.label), ['Email']);
});
