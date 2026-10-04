// A step with a transition window (C2): the first flagged window is halfway
// down, the series then settles lower. The shift's stated new value is the
// level after the step, and the first window is reported as the first window.

import test from 'node:test';
import assert from 'node:assert/strict';
import { robustShifts } from '../../src/analysis/time.js';
import { levelAfter, withLevelsAfter } from '../../src/ui/lib/shifts.js';
import { changeWords, persistWords } from '../../src/ui/views/time.js';

const before = [0.18, 0.185, 0.183, 0.181, 0.184, 0.182, 0.186, 0.183, 0.18, 0.185];
const after = [0.05, 0.048, 0.052, 0.047, 0.049, 0.051, 0.05, 0.046, 0.053, 0.048];
const x = [...before, 0.113, ...after];
const DAY = 86400000;
const t0 = Date.UTC(2025, 0, 6);

test('step series: first window and level after are reported separately', () => {
  const shifts = robustShifts(x, { threshold: 3.5, baseline: 8 });
  assert.ok(shifts.length >= 1);
  const sh = shifts[0];
  assert.equal(sh.window, 10);
  assert.equal(sh.direction, 'down');
  assert.equal(sh.value, 0.113); // the detector's value is the transition window, unchanged
  const r = levelAfter(x, sh);
  assert.equal(r.afterWindows, 10);
  assert.ok(Math.abs(r.after - 0.0495) < 1e-12, `median after ${r.after}`);
});

test('level after stops at the next shift in the same series and skips thin windows', () => {
  const y = [...x, 0.2, 0.21, 0.2];
  assert.equal(levelAfter(y, { window: 10 }, 21).afterWindows, 10);
  const cov = y.map((_, i) => (i === 11 ? 0.3 : 1));
  assert.equal(levelAfter(y, { window: 10 }, 21, cov).afterWindows, 9);
  assert.ok(Number.isNaN(levelAfter([1, 2], { window: 1 }).after));
});

test('withLevelsAfter reads the right series and changeWords states both values', () => {
  const s = { windows: x.map((_, i) => ({ start: t0 + i * 7 * DAY, end: t0 + (i + 1) * 7 * DAY, coverage: 1 })), network: { crossGroupShare: x } };
  const sh = { ...robustShifts(x)[0], target: 'network', id: null, metric: 'crossGroupShare', start: s.windows[10].start };
  const [e] = withLevelsAfter(s, [sh]);
  assert.ok(Math.abs(e.after - 0.0495) < 1e-12);
  const words = changeWords(e, 'week');
  assert.match(words, /^to 0\.113 in the week of 17 Mar 2025, and to a median of 0\.0495 over the 10 weeks that followed$/);
  assert.match(persistWords(e, 'week'), /did not return toward the earlier level: all 11 weeks/);
});
