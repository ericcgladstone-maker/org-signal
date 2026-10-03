#!/usr/bin/env node
// Accuracy campaign: runs every check in tools/accuracy/checks at scale and
// writes a JSON and a markdown summary. See docs/accuracy.md.
//
//   node tools/accuracy/campaign.mjs --out /tmp/acc/run1            (full: ~25 min)
//   node tools/accuracy/campaign.mjs --out /tmp/acc/q --scale 0.1   (quick)
//   node tools/accuracy/campaign.mjs --out /tmp/acc/r --only reference,stats --seed 7
//   node tools/accuracy/campaign.mjs --out /tmp/acc/r --only reference --count reference=5000
//
// --out PATH     writes PATH.json and PATH.md (required)
// --seed N       base seed (default 1); every case seed derives from it
// --scale X      multiplies every check's case count (default 1)
// --only a,b     run only these checks; --skip a,b leaves some out
// --count k=N    exact count for one check (repeatable)
// Exit code 1 if any check has failures.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { toJSON } from './lib.mjs';

const CHECKS = {
  // name: [module, full-scale count, extra options]
  reference: ['./checks/reference.mjs', 3000],
  closedforms: ['./checks/closedforms.mjs', 60],
  invariance: ['./checks/invariance.mjs', 1500],
  consistency: ['./checks/consistency.mjs', 20],
  approx: ['./checks/approx.mjs', 40],
  stats: ['./checks/stats.mjs', 600],
  construction: ['./checks/construction.mjs', 2000],
  roundtrip: ['./checks/roundtrip.mjs', 500],
  content: ['./checks/content.mjs', 300],
  recovery: ['./checks/recovery.mjs', 10, (scale) => ({ shiftSeeds: Math.max(10, Math.round(200 * scale)) })],
};

function args(argv) {
  const a = { seed: 1, scale: 1, only: null, skip: [], count: {}, out: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--out') { a.out = v; i++; } else if (k === '--seed') { a.seed = Number(v); i++; } else if (k === '--scale') { a.scale = Number(v); i++; } else if (k === '--only') { a.only = v.split(','); i++; } else if (k === '--skip') { a.skip = v.split(','); i++; } else if (k === '--count') { const [n, c] = v.split('='); a.count[n] = Number(c); i++; } else throw new Error(`Unknown argument ${k}`);
  }
  if (!a.out) throw new Error('--out PATH is required (writes PATH.json and PATH.md)');
  return a;
}

const fmt = (x) => (typeof x === 'number' ? (Number.isInteger(x) ? String(x) : Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(4)) : String(x));

function markdown(run) {
  const L = [`# Accuracy campaign`, '', `Started ${run.started}, ${run.seconds.toFixed(0)} s, seed ${run.seed}, scale ${run.scale}, node ${process.version}.`, '',
    '| Check | Cases | Comparisons | Failed | Seconds |', '|---|---|---|---|---|'];
  for (const r of run.results) L.push(`| ${r.name} | ${r.cases} | ${r.comparisons} | ${r.failed} | ${r.seconds.toFixed(1)} |`);
  L.push('', `Total: ${run.results.reduce((s, r) => s + r.cases, 0)} cases, ${run.results.reduce((s, r) => s + r.comparisons, 0)} comparisons, ${run.results.reduce((s, r) => s + r.failed, 0)} failures.`, '');
  for (const r of run.results) {
    L.push(`## ${r.title || r.name}`, '');
    if (r.error) L.push('```', r.error, '```', '');
    for (const n of r.notes || []) L.push(`- ${n}`);
    if (r.notes?.length) L.push('');
    const stats = { ...r.stats };
    delete stats.rows;
    L.push('```json', JSON.stringify(stats, (k, v) => (typeof v === 'number' ? Number(fmt(v)) : v), 1).slice(0, 12000), '```', '');
    if (r.failures?.length) {
      L.push(`First failures (${r.failed} in total):`, '');
      for (const f of r.failures.slice(0, 10)) L.push('- `' + JSON.stringify(f).slice(0, 400) + '`');
      L.push('');
    }
  }
  return L.join('\n');
}

async function main() {
  const a = args(process.argv.slice(2));
  const names = (a.only || Object.keys(CHECKS)).filter(n => !a.skip.includes(n));
  const run = { started: new Date().toISOString(), seed: a.seed, scale: a.scale, results: [] };
  const t0 = Date.now();
  for (const name of names) {
    const [path, full, extra] = CHECKS[name] || [];
    if (!path) throw new Error(`Unknown check ${name}; known: ${Object.keys(CHECKS).join(', ')}`);
    const mod = await import(path);
    const count = a.count[name] ?? Math.max(1, Math.round(full * a.scale));
    const t1 = Date.now();
    process.stderr.write(`[${name}] count ${count} ...\n`);
    let r;
    try {
      r = await mod.run({ count, seed: a.seed, log: (m) => process.stderr.write(`  ${m}\n`), ...(extra ? extra(a.scale) : {}) });
    } catch (err) {
      r = { name, cases: 0, comparisons: 0, failed: 1, failures: [], stats: {}, notes: [], error: String(err?.stack || err) };
    }
    r.title = mod.title;
    r.count = count;
    r.seconds = (Date.now() - t1) / 1000;
    run.results.push(r);
    process.stderr.write(`[${name}] ${r.cases} cases, ${r.comparisons} comparisons, ${r.failed} failed, ${r.seconds.toFixed(1)} s\n`);
  }
  run.seconds = (Date.now() - t0) / 1000;
  mkdirSync(dirname(a.out), { recursive: true });
  writeFileSync(a.out + '.json', toJSON(run));
  writeFileSync(a.out + '.md', markdown(run));
  process.stderr.write(`wrote ${a.out}.json and ${a.out}.md\n`);
  process.exitCode = run.results.some(r => r.failed) ? 1 : 0;
}

main().catch(err => { console.error(err); process.exitCode = 2; });
