// Every call the Generate view makes into the generator and analysis goes
// through here. Generation runs in a module worker (generate.worker.js); if a
// worker cannot be created the same code runs on the main thread (run.js).
//
//   loadContexts()            -> { contexts (normalised), devFallback, error }
//   startGenerate(spec, { onProgress }) -> { promise, cancel }
//   startRecovery({ seed })   -> Promise<{ report } | { missing[] }>

import { normalizeContexts, FALLBACK_CONTEXTS } from '../../builders/generate-spec.js';

export async function loadContexts() {
  try {
    const gen = await import('../../generator/index.js');
    const contexts = normalizeContexts(await gen.listContexts());
    if (!contexts.length) throw new Error('listContexts() returned no contexts');
    return { contexts, devFallback: false, error: null, recoveryAvailable: typeof gen.recoveryCheck === 'function' };
  } catch (e) {
    // Dev-only: lets the form render while the generator is being written.
    return { contexts: normalizeContexts(FALLBACK_CONTEXTS), devFallback: true, error: e.message, recoveryAvailable: false };
  }
}

let worker = null;
let seq = 0;
let mainThreadLast = null; // groundTruth + dataset when running without a worker

function getWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./generate.worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  return worker;
}

function killWorker() {
  if (worker) { worker.terminate(); worker = null; }
}

export function startGenerate(spec, { onProgress = () => {} } = {}) {
  const id = ++seq;
  let cancel = () => {};
  const promise = new Promise((resolve, reject) => {
    const w = getWorker();
    if (!w) {
      // Main-thread fallback: no cancel mid-run, but the UI still gets the result.
      import('./run.js').then(({ runGenerate }) => runGenerate(spec, onProgress)).then(res => {
        mainThreadLast = { groundTruth: res.groundTruth, dataset: res.dataset };
        resolve(res);
      }, reject);
      return;
    }
    const onMsg = ({ data }) => {
      if (data.id !== id) return;
      if (data.type === 'progress') onProgress(data.fraction, data.message);
      else if (data.type === 'done') { cleanup(); resolve(data.result); }
      else if (data.type === 'error') { cleanup(); reject(new Error(data.message)); }
    };
    const onErr = e => { cleanup(); killWorker(); reject(new Error(e.message || 'The generator worker failed to start.')); };
    const cleanup = () => { w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage({ type: 'generate', id, spec });
    // Terminating is the only way to stop synchronous generator code; the
    // next run starts a fresh worker.
    cancel = () => { cleanup(); killWorker(); reject(Object.assign(new Error('Cancelled'), { cancelled: true })); };
  });
  return { promise, cancel: () => cancel() };
}

export function startRecovery({ seed = 1 } = {}) {
  const w = worker;
  if (!w) {
    if (!mainThreadLast) return Promise.resolve({ missing: ['a generated dataset in this session'] });
    return import('./run.js').then(({ runRecovery }) => runRecovery(mainThreadLast.groundTruth, mainThreadLast.dataset, { seed }));
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = ({ data }) => {
      if (data.id !== id) return;
      w.removeEventListener('message', onMsg);
      if (data.type === 'recovery') resolve(data.result); else reject(new Error(data.message));
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ type: 'recovery', id, seed });
  });
}
