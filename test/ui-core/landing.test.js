// Landing copy (docs/ux/copy-landing-eric-2026-10-04.md): each classic
// dataset's line under its title, built from the manifest's counts, reads as
// Eric wrote it, so the copy and the data cannot drift apart.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cardLine } from '../../src/ui/views/learn/classic.js';

const manifest = JSON.parse(readFileSync(new URL('../../data/classic/index.json', import.meta.url), 'utf8'));

test('classic dataset lines match the landing copy', () => {
  const want = {
    karate: '1977 · 34 people · 78 ties · One-mode',
    florentine: '1993 · 16 families · 35 ties across two relations · One-mode',
    krackhardt: '1987 · 21 people · advice, friendship, and reporting ties · One-mode',
    sampson: '1968 · 25 people · five time points · One-mode',
    kapferer: '1972 · 39 people · two time points · One-mode',
    newcomb: '1961 · 17 people · repeated rankings · One-mode',
    wiring: '1939 · 14 people · multiple relations · One-mode',
    davis: '1941 · 18 women · 14 events · 89 affiliations · Two-mode',
    lesmis: '1993 · 77 characters · 254 ties · One-mode',
    dolphins: '2003 · 62 dolphins · 159 ties · One-mode',
    enron: '148 people · 21,052 messages · One-mode',
  };
  assert.deepEqual(Object.fromEntries(manifest.datasets.map(e => [e.id, cardLine(e)])), want);
});
