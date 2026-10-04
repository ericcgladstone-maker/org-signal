// One value, one color in every view (M5): a community whose members are
// mostly one major takes that major's hue, so green never means CS in one
// view and Sociology in another. And the methods appendix's record counts
// use plural nouns (75,377 messages, not 75,377 message).

import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleDoc } from '../../src/builders/examples.js';
import * as D from '../../src/builders/draw.js';
import { defaultSettings, buildNetwork, detectCommunities } from '../../src/analysis/index.js';
import { nodeColoring, communityColoring } from '../../src/ui/lib/coloring.js';
import { countWords } from '../../src/llm/methods.js';

test('communities take the hue of the major most of their members share', () => {
  const ds = D.toDataset(exampleDoc('class-friendships'));
  const net = buildNetwork(ds, defaultSettings(ds));
  const communities = detectCommunities(net, { seed: 1 });
  const byComm = nodeColoring({ ds, net, communities, colorBy: 'community' });
  const byMajor = nodeColoring({ ds, net, communities, colorBy: 'attr:major' });
  assert.equal(byComm.gc.alignedTo, 'major');
  for (let v = 0; v < net.n; v++) {
    if (byComm.key(v) === '') continue; // Nora Quinn, no community
    assert.equal(byComm.of(v), byMajor.of(v), ds.nodes.labels[net.nodeIds[v]]);
  }
  // Groups uses the same function, so the same colors.
  const gc = communityColoring(ds, net, communities);
  for (const e of byComm.gc.entries) assert.equal(gc.color(e.value), e.color);
});

test('no attribute to match: communities keep the colors of their numbers', () => {
  const ds = D.toDataset(exampleDoc('path'));
  const net = buildNetwork(ds, defaultSettings(ds));
  const gc = communityColoring(ds, net, detectCommunities(net, { seed: 1 }));
  assert.equal(gc.alignedTo, null);
});

test('record counts are plural nouns unless the count is 1', () => {
  assert.equal(countWords('message', 75377), '75,377 messages');
  assert.equal(countWords('reaction', 3978), '3,978 reactions');
  assert.equal(countWords('leave', 4), '4 leaves');
  assert.equal(countWords('leave', 1), '1 leave');
  assert.equal(countWords('duplicates-skipped', 2), '2 duplicates skipped');
});
