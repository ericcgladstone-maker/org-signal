// Digestion: every native export the generator writes, fed through the real
// import pipeline with automatic detection, must give back the generator's
// own dataset for that export.
//
// With output 'native' the generator's `dataset` is what the written export
// contains (src/generator/native.js), so the comparison is strict: the
// expected importer wins, every file is claimed, the report raises no error,
// and nodes and events agree one for one (type, actor, targets with roles,
// context visibility, time to the precision the format carries). The only
// differences allowed are the documented ones (docs/api/importers-b.md and
// docs/api/generator.md, "Native round trips"), and each is computed from
// the export rather than hard-coded:
//   - LinkedIn: with no invitation and no message naming the owner's URL, the
//     owner is keyed `linkedin:me`;
//   - Telegram: people who only appear in service messages (joins) are keyed
//     by name, `telegram:name:<name>`, since service messages carry no ids;
//   - WhatsApp: a 1:1 chat in which only the other person wrote cannot name
//     the owner, so its messages have no dm target; day/month order is
//     inferred per chat file, and a chat whose dates all read either way may
//     come back with day and month swapped;
//   - WhatsApp: times are the phone's wall clock (read as UTC here); Android
//     exports keep minutes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listContexts, generate } from '../../src/generator/index.js';
import { runImport } from '../../src/core/pipeline.js';
import { EVENT_TYPES, ROLES, VISIBILITY } from '../../src/core/model.js';
import { nameKey } from '../../src/importers/lib/text.js';

const SPAN = { start: '2025-03-03', days: 30 };
// DIGEST_SEED shifts every seed, to sweep more worlds by hand:
//   for s in 0 10 20; do DIGEST_SEED=$s node --test test/integration/digestion.test.js; done
const S0 = Number(process.env.DIGEST_SEED || 0);
const SIZE = { workplace: 24, online: 30, professional: 30, personal: 24, community: 30, survey: 20 };

// Time resolution of each export, in ms.
const PRECISION = {
  slack: 1, // ts carries microseconds
  email: 1000, // Date header
  calendar: 1000, // DTSTART
  x: 1000, // created_at
  linkedin: 1000, // messages to the second; the dataset already holds connections at the date and invitations at the minute
  whatsapp: 1000, // iOS keeps seconds (Android: 60000, set per case)
  telegram: 1000, // date_unixtime
  discord: 1, // ISO with milliseconds
  reddit: 1000, // created_utc
  survey: 1000, // Google Forms timestamp
  network: 1, // ISO first_contact
};

function cases() {
  const out = [];
  for (const c of listContexts()) {
    for (const m of c.media) {
      if (!m.native) continue;
      const base = { context: c.id, medium: m.id, seed: S0 + 11, size: SIZE[c.id], timespan: SPAN, content: 'light', output: 'native', tzOffsetHours: 0 };
      const importer = m.id === 'survey' ? 'survey' : m.importer; // the survey default is the roster form
      out.push({ name: `${c.id}/${m.id}`, spec: base, importer, prec: PRECISION[m.id] });
      if (m.id === 'whatsapp') {
        out.push({ name: `${c.id}/${m.id} android en-GB`, spec: { ...base, seed: S0 + 12, platform: 'android', locale: 'en-GB' }, importer, prec: 60000 });
        out.push({ name: `${c.id}/${m.id} one chat`, spec: { ...base, seed: S0 + 13, observation: 'chat' }, importer, prec: 1000 });
      }
      if (m.id === 'telegram') out.push({ name: `${c.id}/${m.id} one chat`, spec: { ...base, seed: S0 + 13, observation: 'chat' }, importer, prec: 1000 });
      if (m.id === 'reddit') out.push({ name: `${c.id}/${m.id} sample`, spec: { ...base, seed: S0 + 13, observation: 'sample' }, importer, prec: 1000 });
    }
  }
  return out;
}

// The same instant with day and month exchanged (UTC wall clock), or null.
function swapDayMonth(t) {
  const d = new Date(t);
  const day = d.getUTCDate(), mon = d.getUTCMonth() + 1;
  if (day > 12) return null;
  const s = Date.UTC(d.getUTCFullYear(), day - 1, mon, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
  return s === t ? null : s;
}

// Map import node index -> the key the generator gave that person, using only
// the documented differences.
function alignKeys(imp, gen, medium) {
  const genKeys = new Set(gen.nodes.keys);
  const byLabel = new Map();
  for (let i = 0; i < gen.nodes.count; i++) byLabel.set(nameKey(gen.nodes.labels[i]), gen.nodes.keys[i]);
  const impEgo = imp.meta.sources[0]?.egoKey, genEgo = gen.meta.sources[0]?.egoKey;
  const renamed = [];
  const keys = imp.nodes.keys.map(k => {
    if (genKeys.has(k)) return k;
    if (medium === 'linkedin' && k === 'linkedin:me' && k === impEgo && genEgo) { renamed.push(k); return genEgo; }
    if (medium === 'telegram' && k.startsWith('telegram:name:') && byLabel.has(k.slice(14))) { renamed.push(k); return byLabel.get(k.slice(14)); }
    return k;
  });
  return { keys, renamed };
}

function signatures(ds, keys, prec, { whatsapp = false, dropDm = null } = {}) {
  const { events } = ds;
  const out = new Map();
  for (let i = 0; i < events.count; i++) {
    const type = EVENT_TYPES[events.type[i]];
    const c = events.context[i];
    const vis = c < 0 ? 'unknown' : VISIBILITY[ds.contexts.visibility[c]];
    let targets = [];
    for (let j = events.tOff[i]; j < events.tOff[i + 1]; j++) targets.push(keys[events.tgt[j]] + ':' + ROLES[events.role[j]]);
    if (dropDm && dropDm.has(c)) targets = targets.filter(x => !x.endsWith(':dm'));
    let t = events.t[i];
    if (whatsapp && Number.isFinite(t)) { const s = swapDayMonth(t); if (s !== null && s < t) t = s; } // order-free reading
    const tq = Number.isFinite(t) ? Math.floor(t / prec) : 'NaN';
    const sig = `${type}|${keys[events.actor[i]]}|${tq}|${targets.sort().join(',')}|${vis}`;
    out.set(sig, (out.get(sig) || 0) + 1);
  }
  return out;
}

function tally(ds, f) {
  const m = {};
  for (let i = 0; i < ds.events.count; i++) { const k = f(i); m[k] = (m[k] || 0) + 1; }
  return m;
}
const roleTally = ds => { const m = {}; for (const r of ds.events.role) m[ROLES[r]] = (m[ROLES[r]] || 0) + 1; return m; };
const visTally = ds => tally(ds, i => (ds.events.context[i] < 0 ? 'unknown' : VISIBILITY[ds.contexts.visibility[ds.events.context[i]]]));
const typeTally = ds => tally(ds, i => EVENT_TYPES[ds.events.type[i]]);

function diffSample(a, b) {
  const out = [];
  for (const [s, n] of a) if (n > (b.get(s) || 0)) out.push('generator: ' + s);
  for (const [s, n] of b) if (n > (a.get(s) || 0)) out.push('import:    ' + s);
  return out.slice(0, 8).join('\n');
}

// WhatsApp 1:1 chats in which only the other person wrote: the export never
// shows the owner's name, so the importer cannot address those messages (no
// dm target). When only the owner wrote, the chat title names the partner.
function oneSidedDirect(gen) {
  const ego = gen.nodes.keys.indexOf(gen.meta.sources[0].egoKey);
  const authors = new Map();
  for (let i = 0; i < gen.events.count; i++) {
    const c = gen.events.context[i];
    if (c < 0 || gen.events.type[i] !== 0 || VISIBILITY[gen.contexts.visibility[c]] !== 'direct') continue;
    if (!authors.has(c)) authors.set(c, new Set());
    authors.get(c).add(gen.events.actor[i]);
  }
  return new Set([...authors].filter(([, a]) => a.size === 1 && !a.has(ego)).map(([c]) => c));
}

for (const tc of cases()) {
  test(`digestion: ${tc.name}`, async () => {
    const { dataset: gen, files } = generate(tc.spec);
    assert.ok(files.length > 0, 'the writer produced files');
    const { dataset: imp, plan, unclaimed, report } = await runImport(files.map(f => ({ blob: new Blob([f.bytes]), path: f.path })));

    // Detection, claiming, report.
    assert.deepEqual([...new Set(plan.map(p => p.id))], [tc.importer], 'the expected importer is chosen for every file');
    assert.deepEqual(unclaimed, [], 'every file of the export is claimed');
    assert.equal(report.totals.warnings.error, 0, `no error-level warnings: ${report.sources.flatMap(s => s.warnings.filter(w => w.severity === 'error').map(w => w.code)).join(', ')}`);

    // Nodes: same people under the same keys, after the documented renames.
    const whatsapp = tc.spec.medium === 'whatsapp';
    const { keys, renamed } = alignKeys(imp, gen, tc.spec.medium);
    assert.equal(imp.nodes.count, gen.nodes.count, 'node count');
    assert.deepEqual([...keys].sort(), [...gen.nodes.keys].sort(), 'node keys');
    const bots = ds => ds.nodes.keys.filter((k, i) => ds.nodes.isBot[i]).sort();
    assert.deepEqual(keys.filter((k, i) => imp.nodes.isBot[i]).sort(), bots(gen), 'bots');
    if (tc.spec.medium === 'telegram') {
      // A name-keyed person never wrote in the export (else their id would be known).
      const actors = new Set(); for (let i = 0; i < imp.events.count; i++) if (imp.events.type[i] === 0) actors.add(imp.nodes.keys[imp.events.actor[i]]);
      for (const k of renamed) assert.ok(!actors.has(k), `${k} is name-keyed only because it never wrote`);
    } else if (tc.spec.medium === 'linkedin') {
      assert.ok(renamed.every(k => k === 'linkedin:me'));
    } else assert.deepEqual(renamed, [], 'no renamed nodes');

    // Events: counts and distributions, then one for one.
    assert.equal(imp.events.count, gen.events.count, 'event count');
    assert.deepEqual(typeTally(imp), typeTally(gen), 'event types');
    assert.deepEqual(visTally(imp), visTally(gen), 'visibility of event contexts');
    const genKeys = gen.nodes.keys;
    const dropDm = whatsapp ? oneSidedDirect(gen) : null;
    if (whatsapp) {
      // Roles agree except the dm targets the importer cannot know.
      let lost = 0;
      for (let i = 0; i < gen.events.count; i++) if (dropDm.has(gen.events.context[i])) for (let j = gen.events.tOff[i]; j < gen.events.tOff[i + 1]; j++) if (ROLES[gen.events.role[j]] === 'dm') lost++;
      const want = roleTally(gen);
      if (lost) want.dm -= lost;
      if (want.dm === 0) delete want.dm;
      assert.deepEqual(roleTally(imp), want, 'target roles (less dm targets of one-sided 1:1 chats)');
    } else assert.deepEqual(roleTally(imp), roleTally(gen), 'target roles');
    const a = signatures(gen, genKeys, tc.prec, { whatsapp, dropDm });
    const b = signatures(imp, keys, tc.prec, { whatsapp });
    assert.deepEqual(b, a, `events differ (type|actor|time/${tc.prec}ms|targets|visibility):\n${diffSample(a, b)}`);

    // Undated events stay undated, dated ones dated.
    const undated = ds => tally(ds, i => (Number.isFinite(ds.events.t[i]) ? 'dated' : 'undated'));
    assert.deepEqual(undated(imp), undated(gen), 'dated and undated events');
  });
}

// WhatsApp exports have no zone and no fixed date order. Both are documented
// limits; with the order and zone given, times come back exactly.
test('digestion: whatsapp en-US with the date order and zone given matches exactly', async () => {
  const spec = { context: 'personal', medium: 'whatsapp', seed: S0 + 14, size: SIZE.personal, timespan: SPAN, output: 'native', tzOffsetHours: -5, locale: 'en-US' };
  const { dataset: gen, files } = generate(spec);
  const items = files.map(f => ({ blob: new Blob([f.bytes]), path: f.path }));
  const { dataset: imp } = await runImport(items, { options: { whatsapp: { dateOrder: 'month-first', timezone: 'Etc/GMT+5' } } });
  const times = ds => Array.from(ds.events.t).filter(Number.isFinite).map(t => Math.floor(t / 1000)).sort((x, y) => x - y);
  assert.deepEqual(times(imp), times(gen));
  // Without the zone the wall clock is read as UTC: every time is off by the
  // phone's offset, and the source says the zone is unknown.
  const { dataset: raw } = await runImport(items, { options: { whatsapp: { dateOrder: 'month-first' } } });
  assert.deepEqual(times(raw), times(gen).map(s => s - 5 * 3600));
  assert.ok(raw.meta.sources.every(s => s.warnings.some(w => w.code === 'timezone-unknown')));
});

test('digestion: survey ego interviews keep alters per respondent (Network Canvas)', async () => {
  const spec = { context: 'survey', medium: 'survey', seed: S0 + 11, size: SIZE.survey, timespan: SPAN, output: 'native', variant: 'ego-interview' };
  const { dataset: gen, files, groundTruth } = generate(spec);
  const { dataset: imp, plan, unclaimed, report } = await runImport(files.map(f => ({ blob: new Blob([f.bytes]), path: f.path })));
  assert.deepEqual([...new Set(plan.map(p => p.id))], ['network-canvas']);
  assert.deepEqual(unclaimed, []);
  assert.equal(report.totals.warnings.error, 0);
  assert.equal(imp.events.count, gen.events.count, 'one declared tie per named alter and per perceived alter-alter tie');
  assert.deepEqual(typeTally(imp), typeTally(gen));
  assert.deepEqual(roleTally(imp), roleTally(gen));
  assert.deepEqual(visTally(imp), visTally(gen));
  const times = ds => Array.from(ds.events.t).sort((x, y) => x - y);
  assert.deepEqual(times(imp), times(gen), 'ties dated at the session start, to the millisecond');
  // Alters are namespaced by the interview (spec: the same name in two
  // interviews is not the same person), so nodes = respondents + their alters.
  const resp = groundTruth.recall.respondents.filter(r => r.responded);
  assert.equal(imp.nodes.count, resp.length + resp.reduce((s, r) => s + r.named.length, 0));
});
