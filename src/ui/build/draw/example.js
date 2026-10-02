// Starter drawing: a small two-team workplace with a broker between them.
// Fake names. Exists so a first-time user can see snapping, hulls, layouts
// and the hand-off working before drawing anything themselves.

import { validateDoc } from '../../../builders/draw.js';

const people = [
  ['ava', 'Ava Lind', 'eng', 'lead', 6, -160, -60], ['ben', 'Ben Ortiz', 'eng', 'engineer', 2, -260, 20],
  ['cai', 'Cai Mora', 'eng', 'engineer', 3, -180, 90], ['dee', 'Dee Patel', 'eng', 'engineer', 1, -300, -90],
  ['eli', 'Eli Brandt', 'prod', 'manager', 8, 170, -50], ['fay', 'Fay Kim', 'prod', 'designer', 4, 280, 30],
  ['gus', 'Gus Romero', 'prod', 'analyst', 2, 190, 100], ['hal', 'Hal Novak', null, 'architect', 10, 0, 0],
];
const ties = [
  ['ava', 'ben'], ['ava', 'cai'], ['ava', 'dee'], ['ben', 'cai'], ['ben', 'dee'],
  ['eli', 'fay'], ['eli', 'gus'], ['fay', 'gus'],
  ['hal', 'ava', 'advice', 2, true], ['hal', 'eli', 'advice', 2, true], ['cai', 'gus', 'tie', 1],
];

export function exampleDoc() {
  return validateDoc({
    version: 1,
    name: 'Example: two teams and a broker',
    groups: [{ id: 'eng', name: 'Engineering' }, { id: 'prod', name: 'Product' }],
    attrColumns: [{ key: 'role', type: 'categorical' }, { key: 'tenure', type: 'number' }],
    edgeTypes: ['tie', 'advice'],
    nodes: people.map(([id, label, group, role, tenure, x, y]) => ({ id, label, group, x, y, attrs: { role, tenure: String(tenure) } })),
    edges: ties.map(([s, t, type = 'tie', weight = 1, directed = false], i) => ({ id: 'x' + i, source: s, target: t, type, weight, directed })),
  }).doc;
}
