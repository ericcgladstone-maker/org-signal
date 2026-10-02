import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSet, lines } from '../../src/core/fileset.js';

const dir = mkdtempSync(join(tmpdir(), 'os-zip-'));
const py = `
import zipfile, sys
d = sys.argv[1]
with zipfile.ZipFile(d + '/plain.zip', 'w') as z:
    z.writestr(zipfile.ZipInfo('export/channels.json'), '[{"name":"general"}]')
    z.writestr('export/général/2024-01-01.json', '[{"text":"héllo"}]', compress_type=zipfile.ZIP_DEFLATED)
    z.writestr('export/__MACOSX/._junk', 'x')
    z.writestr('export/big.txt', ('line\\r\\n' * 50000), compress_type=zipfile.ZIP_DEFLATED)
with zipfile.ZipFile(d + '/z64.zip', 'w', compression=zipfile.ZIP_DEFLATED) as z:
    with z.open('a.txt', 'w', force_zip64=True) as f: f.write(b'zip64 body')
`;
execFileSync('python3', ['-c', py, dir]);

test('reads stored and deflated entries, strips common root and junk', async () => {
  const fs = await FileSet.fromPaths([join(dir, 'plain.zip')]);
  assert.deepEqual(fs.entries.map(e => e.rel).sort(), ['big.txt', 'channels.json', 'général/2024-01-01.json']);
  assert.equal(await fs.get('CHANNELS.json').text(), '[{"name":"general"}]');
  assert.deepEqual(JSON.parse(await fs.get('général/2024-01-01.json').text()), [{ text: 'héllo' }]);
});

test('streams lines from a deflated entry', async () => {
  const fs = await FileSet.fromPaths([join(dir, 'plain.zip')]);
  let n = 0;
  for await (const l of lines(fs.get('big.txt').stream())) { assert.equal(l, 'line'); n++; }
  assert.equal(n, 50000);
});

test('reads zip64 entries', async () => {
  const fs = await FileSet.fromPaths([join(dir, 'z64.zip')]);
  assert.equal(await fs.get('a.txt').text(), 'zip64 body');
});
