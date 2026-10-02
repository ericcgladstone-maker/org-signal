// One layout per network build, shared by the Network view (drawing) and the
// People profile (a person's ties and weights), so the layout is computed once.

import { store } from '../store.js';
import { engine } from '../services/engine.js';

let cache = { version: null, promise: null, data: null };

export function cachedRender(version) {
  return cache.version === version ? cache.data : null;
}

export function getRender(version) {
  if (cache.version === version && cache.promise) return cache.promise;
  const p = store.actions.runJob('Laying out the network', (signal, progress) => engine.render({ signal, onProgress: progress }))
    .then(data => { if (cache.promise === p) cache.data = data; return data; }, e => { if (cache.promise === p) cache = { version: null, promise: null, data: null }; throw e; });
  cache = { version, promise: p, data: null };
  return p;
}

export function clearRender() { cache = { version: null, promise: null, data: null }; }
