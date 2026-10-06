// Regressions for the generator and recovery-check fixes of 2026-10-06:
// department heads tied only by the leadership loop, LinkedIn conversations
// between two people, group-chat audiences not written as targets, a directed
// follow graph kept directed as a network file, reorg ties that restart, and
// recovery verdicts that can fail (a chance baseline for shifts, a direction
// test for survey recall).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, recoveryCheck } from '../../src/generator/index.js';
import { eventTargets, EVENT_TYPES } from '../../src/core/model.js';
import { defaultSettings } from '../../src/analysis/index.js';

const kindOf = (T, i) => T.kinds[T.kind[i]];

test('bridge-dependent: department heads are tied only by the leadership loop', () => {
  for (const seed of [1, 7]) {
    const { groundTruth: T } = generate({ context: 'workplace', medium: 'slack', structure: 'bridge-dependent', seed, content: 'none', output: 'dataset' });
    const mgr = T.hierarchy.manager;
    const heads = new Set();
    for (let i = 0; i < mgr.length; i++) if (mgr[i] === T.hierarchy.root) heads.add(i);
    let headPairs = 0, team = 0;
    for (let i = 0; i < T.ties.count; i++) {
      if (!heads.has(T.ties.a[i]) || !heads.has(T.ties.b[i])) continue;
      headPairs++;
      if (kindOf(T.ties, i) === 'team') team++;
    }
    const possible = (heads.size * (heads.size - 1)) / 2;
    assert.equal(team, 0, `seed ${seed}: no team ties among heads`);
    // pLead is 0.1 here: far fewer than the ~65% the teammate loop used to add
    assert.ok(headPairs <= Math.max(3, possible * 0.35), `seed ${seed}: ${headPairs} of ${possible} head pairs tied`);
  }
});

test('LinkedIn: every message goes to someone other than its sender', () => {
  const { dataset: ds } = generate({ context: 'professional', medium: 'linkedin', seed: 1, content: 'light', output: 'dataset' });
  const msg = EVENT_TYPES.indexOf('message');
  let messages = 0, untargeted = 0;
  for (let i = 0; i < ds.events.count; i++) {
    if (ds.events.type[i] !== msg) continue;
    messages++;
    if (!eventTargets(ds, i).length) untargeted++;
  }
  assert.ok(messages > 100);
  assert.equal(untargeted, 0);
});

test('chat media: group-chat audience is not written as member targets, so turn-taking is available', () => {
  for (const medium of ['whatsapp', 'telegram']) {
    const { dataset: ds } = generate({ context: 'personal', medium, seed: 1, content: 'light', output: 'dataset' });
    let member = 0;
    for (let i = 0; i < ds.events.count; i++) for (const [, role] of eventTargets(ds, i)) if (role === 'member') member++;
    assert.equal(member, 0, medium);
    assert.equal(defaultSettings(ds).rules.adjacency.on, true, `${medium}: turn-taking on by default`);
  }
});

test('online network file: the follow graph stays directed', () => {
  const { dataset: ds, groundTruth: T } = generate({ context: 'online', medium: 'network', seed: 1, output: 'dataset' });
  assert.equal(T.ties.directed, true);
  assert.notEqual(ds.meta.sources[0].directed, false);
  const wp = generate({ context: 'workplace', medium: 'network', seed: 1, output: 'dataset' });
  assert.equal(wp.dataset.meta.sources[0].directed, false, 'mutual true ties stay undirected');
});

test('reorg: a new tie to someone whose old tie ended at the reorg keeps the tie going', () => {
  // Over seeds 1-10, ties from moved people into their new department that end
  // at the reorg: 30 before the fix, when new ties asked for between a pair whose
  // old tie had just ended were dropped; 24 after (the rest are old ties the
  // reorg ends and no new tie asks for).
  let into = 0, ended = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const { groundTruth: T } = generate({ context: 'workplace', medium: 'slack', structure: 'reorg-midpoint', seed, content: 'none', output: 'dataset' });
    const ev = T.events.find(e => e.type === 'reorg');
    const moved = new Map(ev.moved.map(m => [m.person, m.to]));
    const grp = T.communities.membership;
    for (let i = 0; i < T.ties.count; i++) {
      const a = T.ties.a[i], b = T.ties.b[i];
      const toA = moved.get(a), toB = moved.get(b);
      if (!((toA !== undefined && grp[b] === toA && !moved.has(b)) || (toB !== undefined && grp[a] === toB && !moved.has(a)))) continue;
      into++;
      if (T.ties.until[i] === ev.t) ended++;
    }
  }
  assert.equal(into, 624);
  assert.equal(ended, 24);
});

test('shift check: a match does not count when detected shifts cover most of the period', () => {
  const { dataset: ds, groundTruth: T } = generate({ context: 'workplace', medium: 'slack', structure: 'siloed', seed: 1, content: 'none', output: 'dataset' });
  const silo = T.events.find(e => e.type === 'silo');
  const { start, end } = T.timespan;
  const one = recoveryCheck(T, ds, { shifts: [{ t: silo.t }] }).checks.find(c => c.id === 'shift-silo');
  assert.equal(one.verdict, 'recovered');
  assert.ok(one.baseline < 0.5);
  const every = [];
  for (let t = start; t < end; t += 7 * 86400000) every.push({ t });
  const many = recoveryCheck(T, ds, { shifts: every }).checks.find(c => c.id === 'shift-silo');
  assert.equal(many.baseline, 1);
  assert.equal(many.verdict, 'missed', many.says);
});

test('survey recall: the verdict follows the planted direction and can be missed', () => {
  const run = (params) => {
    const { dataset: ds, groundTruth: T } = generate({ context: 'survey', medium: 'survey', structure: 'classroom', seed: 1, content: 'none', output: 'dataset', ...params });
    return recoveryCheck(T, ds, {}).checks.find(c => c.id === 'survey-recall');
  };
  const planted = run({});
  assert.equal(planted.verdict, 'recovered', planted.says);
  // Strong ties forgotten more, with no cap on names: that direction is checked.
  const reversed = run({ forgetWeak: 0.05, forgetStrong: 0.5, maxNames: 0 });
  assert.equal(reversed.verdict, 'recovered', reversed.says);
  // With a cap the closest names win, which works against it: not checked.
  const capped = run({ forgetWeak: 0.05, forgetStrong: 0.5, maxNames: 3 });
  assert.equal(capped.verdict, 'not checked', capped.says);
  const none = run({ forgetWeak: 0.2, forgetStrong: 0.2 });
  assert.equal(none.verdict, 'not checked', none.says);
});
