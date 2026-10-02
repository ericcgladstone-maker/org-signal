// Generation and recovery work, shared by the module worker
// (generate.worker.js) and the main-thread fallback. No DOM here.
//
// Calls into other owners' modules are dynamic imports so a missing module
// becomes a clear message instead of a load failure:
//   ../../generator/index.js   generate(spec), recoveryCheck(...)
//   ../../analysis/index.js    defaultSettings, buildNetwork, computeNodeMetrics,
//                              computeNetworkMetrics, detectCommunities

import { zipSync, strToU8 } from '../../../vendor/fflate.js';

let genMod = null;
export async function generator() {
  if (!genMod) genMod = await import('../../generator/index.js');
  return genMod;
}

// result.files from the generator: [{ path, bytes }] (generator API), also
// tolerating { name, text } / { name, data }. Returns zip bytes.
export function zipFiles(files) {
  const entries = {};
  for (const f of files) {
    const name = f.path || f.name;
    if (!name) continue;
    const data = f.bytes ?? f.data ?? f.text ?? '';
    entries[name] = typeof data === 'string' ? strToU8(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  }
  return zipSync(entries, { level: 6 });
}

// Run one generation. progress(fraction, message) is called at coarse
// stages; if the generator accepts spec.onProgress it is passed through.
export async function runGenerate(spec, progress = () => {}) {
  progress(0.02, 'Loading the generator');
  const gen = await generator();
  progress(0.08, 'Building the world and simulating interactions');
  const res = await gen.generate({ ...spec, onProgress: (f, m) => progress(0.08 + 0.82 * Math.max(0, Math.min(1, f)), m || 'Simulating') });
  progress(0.92, spec.output === 'native' ? 'Packing export files' : 'Preparing the dataset');
  const out = { groundTruth: res.groundTruth, dataset: res.dataset };
  if (spec.output === 'native') {
    if (!res.files || !res.files.length) throw new Error('The generator returned no native files for this medium.');
    out.zip = zipFiles(res.files);
    out.fileList = res.files.map(f => ({ path: f.path || f.name, size: (f.bytes || f.data || f.text || '').length }));
  }
  progress(1, 'Done');
  return out;
}

// Recovery check: build the network from the generated dataset with the
// analysis defaults, compute what recoveryCheck compares against, and ask
// the generator for its report. Returns { report } or { missing: [...] }.
export async function runRecovery(groundTruth, ds, { seed = 1 } = {}) {
  const missing = [];
  let gen, an;
  try { gen = await generator(); } catch (e) { missing.push(`generator module (${e.message})`); }
  if (gen && typeof gen.recoveryCheck !== 'function') missing.push('recoveryCheck export in src/generator/index.js');
  try { an = await import('../../analysis/index.js'); } catch (e) { missing.push(`analysis module src/analysis/index.js (${e.message})`); }
  for (const fn of ['defaultSettings', 'buildNetwork', 'computeNodeMetrics', 'computeNetworkMetrics', 'detectCommunities']) {
    if (an && typeof an[fn] !== 'function') missing.push(`${fn} in src/analysis/index.js`);
  }
  if (missing.length) return { missing };
  const settings = await an.defaultSettings(ds);
  const net = await an.buildNetwork(ds, settings);
  const results = { settings };
  const tryStep = async (key, f) => { try { results[key] = await f(); } catch (e) { results[key + 'Error'] = e.message; } };
  await tryStep('metrics', () => an.computeNodeMetrics(net, { which: ['degree', 'strength', 'betweenness', 'pagerank', 'constraint', 'coreNumber'], approx: net.n > 3000 }));
  await tryStep('network', () => an.computeNetworkMetrics(net));
  await tryStep('communities', () => an.detectCommunities(net, { seed }));
  const report = await gen.recoveryCheck(groundTruth, ds, net, results);
  return { report, settings: { directed: settings?.directed, weighting: settings?.weighting } };
}
