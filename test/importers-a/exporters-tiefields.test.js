// Exports carry tie fields as edge attributes, read back with networkx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatasetBuilder } from '../../src/core/model.js';
import { buildNetwork } from '../../src/analysis/construct.js';
import { exportGraphML } from '../../src/exporters/graphml.js';
import { exportGEXF } from '../../src/exporters/gexf.js';
import { exportEdgesCSV } from '../../src/exporters/csv.js';
import { parseCSV } from '../../src/importers/tabular.js';

const NX = `
import networkx as nx, json, sys, warnings
warnings.simplefilter('ignore')
kind, path = sys.argv[1], sys.argv[2]
G = {'graphml': nx.read_graphml, 'gexf': nx.read_gexf}[kind](path)
print(json.dumps({'edges': {f'{u}>{v}': {k: [type(x).__name__, x] for k, x in d.items() if k not in ('id',)} for u, v, d in G.edges(data=True)}}))
`;
const nx = (kind, text) => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-'));
  const p = join(dir, 'g.' + kind);
  writeFileSync(p, text);
  return JSON.parse(execFileSync('python3', ['-c', NX, kind, p], { encoding: 'utf8' }));
};

function sample() {
  const b = new DatasetBuilder({ name: 'tf' });
  b.beginSource({ format: 'roster', tieFields: [{ key: 'tie_type', label: 'Type of tie', type: 'choice', options: ['Advice', 'Friendship'], multiple: true },
    { key: 'strength', label: 'Strength', type: 'scale', max: 5 }, { key: 'notes', label: 'Notes', type: 'text' }] });
  const [a, c, d] = ['ann', 'bo', 'cy'].map(k => b.node('roster:' + k, { label: k }));
  b.event({ type: 'declared', actor: a, targets: [[c, 'declared']], attrs: { tie_type: ['Advice', 'Friendship'], strength: 4, notes: 'weekly 1:1 & "lunch" <ok>' } });
  b.event({ type: 'declared', actor: c, targets: [[d, 'declared']], attrs: { strength: 2 } });
  b.event({ type: 'declared', actor: d, targets: [[a, 'declared']] });
  return b.build();
}

test('GraphML edges carry tie fields (networkx)', () => {
  const ds = sample();
  const net = buildNetwork(ds, { directed: true });
  const g = nx('graphml', exportGraphML(ds, net));
  const e = g.edges['roster:ann>roster:bo'];
  assert.deepEqual(e.strength, ['float', 4]);
  assert.deepEqual(e.tie_type, ['str', 'Advice; Friendship']);
  assert.deepEqual(e.notes, ['str', 'weekly 1:1 & "lunch" <ok>']);
  assert.deepEqual(g.edges['roster:bo>roster:cy'].strength, ['float', 2]);
  assert.equal(g.edges['roster:cy>roster:ann'].strength, undefined);
});

test('GEXF edges carry tie fields (networkx)', () => {
  const ds = sample();
  const net = buildNetwork(ds, { directed: true });
  const g = nx('gexf', exportGEXF(ds, net));
  const e = g.edges['roster:ann>roster:bo'];
  assert.deepEqual(e.strength, ['float', 4]);
  assert.deepEqual(e.tie_type, ['str', 'Advice; Friendship']);
  assert.equal(e.notes[1], 'weekly 1:1 & "lunch" <ok>');
});

test('edges CSV has one column per tie field', () => {
  const ds = sample();
  const net = buildNetwork(ds, { directed: true });
  const { rows } = parseCSV(exportEdgesCSV(ds, net));
  assert.deepEqual(rows[0], ['Source', 'Target', 'Type', 'Weight', 'w_declared', 'tie_type', 'strength', 'notes']);
  const r = rows.find(x => x[0] === 'roster:ann');
  assert.deepEqual(r.slice(5), ['Advice; Friendship', '4', 'weekly 1:1 & "lunch" <ok>']);
  const blank = rows.find(x => x[0] === 'roster:cy');
  assert.deepEqual(blank.slice(5), ['', '', '']);
});

test('no tie fields: exports unchanged', () => {
  const b = new DatasetBuilder();
  b.beginSource({ format: 't' });
  b.event({ type: 'declared', actor: b.node('t:a'), targets: [[b.node('t:b'), 'declared']] });
  const ds = b.build();
  const net = buildNetwork(ds, {});
  assert.deepEqual(parseCSV(exportEdgesCSV(ds, net)).rows[0], ['Source', 'Target', 'Type', 'Weight', 'w_declared']);
  assert.ok(!/attr.name="strength"/.test(exportGraphML(ds, net)));
});
