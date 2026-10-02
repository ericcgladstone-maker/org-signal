// Module worker for the synthetic generator. Keeps the last generated dataset
// and ground truth so the recovery check can run here too, off the UI thread.
//
// in:  { type: 'generate', id, spec }  |  { type: 'recovery', id, seed }
// out: { type: 'progress', id, fraction, message }
//      { type: 'done', id, result }     (result.zip transferred when present)
//      { type: 'recovery', id, result } |  { type: 'error', id, message }

import { runGenerate, runRecovery } from './run.js';

let last = null;

self.onmessage = async ({ data }) => {
  const { type, id } = data;
  try {
    if (type === 'generate') {
      const res = await runGenerate(data.spec, (fraction, message) => self.postMessage({ type: 'progress', id, fraction, message }));
      last = { groundTruth: res.groundTruth, dataset: res.dataset };
      // The dataset is copied rather than transferred so the worker keeps its
      // own copy for the recovery check.
      self.postMessage({ type: 'done', id, result: res }, res.zip ? [res.zip.buffer] : []);
    } else if (type === 'recovery') {
      if (!last) throw new Error('Generate a dataset first.');
      self.postMessage({ type: 'recovery', id, result: await runRecovery(last.groundTruth, last.dataset, { seed: data.seed }) });
    }
  } catch (e) {
    self.postMessage({ type: 'error', id, message: e?.message || String(e) });
  }
};
