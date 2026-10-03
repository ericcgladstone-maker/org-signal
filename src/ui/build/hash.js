// Worked-example links into Build (pure; tested in Node):
//   #build?example=<id>      what the Learn view emits; works with the shell's router
//   #build/example/<id>      the same, for a router that passes #build/... here
// Ids and aliases are those of src/builders/examples.js.

import { exampleById } from '../../builders/examples.js';

// The example id in a Build address, or null.
export function exampleFromHash(hash) {
  const h = String(hash || '');
  let id = null;
  if (/^#build\?/.test(h)) id = new URLSearchParams(h.slice(h.indexOf('?') + 1)).get('example');
  else { const m = /^#build\/example\/([\w-]+)/.exec(h); if (m) id = m[1]; }
  return id && exampleById(id) ? id : null;
}
