'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// OrgSignal — Test Suite
// Plain Node.js, zero dependencies. Run: node test.js
// ═══════════════════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;

function assert(name, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function assertEquals(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(name, ok, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function section(label) {
  console.log(`\n${label}`);
}

// ── Inline implementations for Node.js (mirrors js/helpers.js exactly) ─────

function stripCitations(text) {
  if (!text) return text;
  let out = text.replace(/<cite\s+index="[^"]*">([^<]*)<\/cite>/gi, '$1');
  out = out.replace(/<cite\s+index="[^"]*"\s*\/>/gi, '');
  out = out.replace(/<cite[^>]*>/gi, '').replace(/<\/cite>/gi, '');
  return out;
}

function repairJson(text) {
  if (!text) return null;
  const clean = stripCitations(text);
  const stripped = clean.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(stripped); } catch (_) {}
  const objMatch = stripped.match(/(\{[\s\S]*\})/);
  if (objMatch) { try { return JSON.parse(objMatch[1]); } catch (_) {} }
  const arrMatch = stripped.match(/(\[[\s\S]*\])/);
  if (arrMatch) { try { return JSON.parse(arrMatch[1]); } catch (_) {} }
  return null;
}

function safeMarkdown(text) {
  if (!text) return '';
  const clean = stripCitations(text);
  const escaped = clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const bolded = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return bolded.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
}

// Inline HR CSV fast-path parser (mirrors normalizeHRWithClaude fast path)
function parseHRCsv(rawText) {
  const lines = rawText.trim().split(/\r?\n/);
  const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
  const uidCol = headers.findIndex(h => ['userid', 'user_id', 'slack_id', 'id'].includes(h));
  if (uidCol < 0) return null;

  const nameCol    = headers.indexOf('fullname') >= 0 ? headers.indexOf('fullname') : headers.indexOf('name');
  const deptCol    = headers.indexOf('dept') >= 0 ? headers.indexOf('dept') : headers.indexOf('department');
  const roleCol    = headers.indexOf('role') >= 0 ? headers.indexOf('role') : headers.indexOf('title');
  const tenureCol  = headers.indexOf('tenure');
  const perfCol    = headers.indexOf('perf_rating') >= 0 ? headers.indexOf('perf_rating') : headers.indexOf('perf');
  const managerCol = headers.indexOf('manager_id') >= 0 ? headers.indexOf('manager_id') : headers.indexOf('managerid');
  const riskCol    = headers.indexOf('flight_risk_flag') >= 0 ? headers.indexOf('flight_risk_flag') : headers.indexOf('flightrisk');

  const parseVal  = (row, col) => col >= 0 && row[col] ? row[col].replace(/"/g, '').trim() : null;
  const parseBool = v => v ? ['yes', 'true', '1'].includes(v.toLowerCase()) : null;

  return lines.slice(1).filter(l => l.trim()).map(line => {
    const row = line.split(',');
    const risk = parseVal(row, riskCol);
    return {
      id:         parseVal(row, uidCol),
      name:       parseVal(row, nameCol),
      dept:       parseVal(row, deptCol),
      role:       parseVal(row, roleCol),
      tenure:     parseVal(row, tenureCol),
      perf:       parseVal(row, perfCol),
      managerId:  parseVal(row, managerCol),
      flightRisk: parseBool(risk),
    };
  }).filter(p => p.id);
}

// ── Inline synthetic data helpers (mirrors js/generate.js) ──────────────────
function gRand(arr)         { return arr[Math.floor(Math.random() * arr.length)]; }
function gRandInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function gFill(tmpl, vars)  { return tmpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] || k); }


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — stripCitations
// ═══════════════════════════════════════════════════════════════════════════════
section('stripCitations');

assert('passthrough plain text',
  stripCitations('hello world') === 'hello world');

assert('null input returns null',
  stripCitations(null) === null);

assert('empty string returns empty string',
  stripCitations('') === '');

assert('removes paired cite tag, keeps inner text',
  stripCitations('text <cite index="1">source</cite> more') === 'text source more');

assert('removes self-closing cite tag',
  stripCitations('text <cite index="2"/> more') === 'text  more');

assert('removes self-closing cite with space before slash',
  stripCitations('text <cite index="3" /> more') === 'text  more');

assert('removes multiple cite tags',
  stripCitations('<cite index="1">A</cite> and <cite index="2">B</cite>') === 'A and B');

assert('removes uppercase CITE (case-insensitive)',
  stripCitations('<CITE index="1">x</CITE>') === 'x');

assert('does not alter bold markdown',
  stripCitations('**bold**') === '**bold**');

assert('handles cite tags within sentence without mangling surrounding text',
  stripCitations('Before <cite index="0">ref</cite> after') === 'Before ref after');

assert('removes orphaned open cite tag',
  stripCitations('text <cite index="5"> leftover') === 'text  leftover');

assert('removes orphaned close cite tag',
  stripCitations('text </cite> leftover') === 'text  leftover');


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — repairJson
// ═══════════════════════════════════════════════════════════════════════════════
section('repairJson');

assert('null input returns null',
  repairJson(null) === null);

assert('empty string returns null',
  repairJson('') === null);

assert('parses clean JSON object',
  repairJson('{"a":1}').a === 1);

assert('parses clean JSON array',
  Array.isArray(repairJson('[1,2,3]')));

assert('strips markdown fence before parse',
  repairJson('```json\n{"x":2}\n```').x === 2);

assert('strips plain fence before parse',
  repairJson('```\n{"y":3}\n```').y === 3);

assert('extracts object from prose',
  repairJson('Here is the result: {"score":9} end').score === 9);

assert('extracts plain array from prose',
  Array.isArray(repairJson('Result: [1,2,3] done')));

assert('strips citation tags before parsing JSON',
  repairJson('<cite index="1">ref</cite>{"z":7}').z === 7);

assert('returns null for totally invalid input',
  repairJson('not json at all') === null);

assert('returns parsed number for bare number (valid JSON)',
  repairJson('42') === 42);

assert('handles nested objects',
  repairJson('{"a":{"b":{"c":1}}}').a.b.c === 1);

assert('handles array of objects',
  repairJson('[{"id":"U001"},{"id":"U002"}]').length === 2);

assert('fence stripping is case-insensitive',
  repairJson('```JSON\n{"k":5}\n```').k === 5);


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — safeMarkdown
// ═══════════════════════════════════════════════════════════════════════════════
section('safeMarkdown');

assert('returns empty string for null',
  safeMarkdown(null) === '');

assert('returns empty string for empty string',
  safeMarkdown('') === '');

assert('escapes < and >',
  safeMarkdown('<b>hello</b>').includes('&lt;b&gt;'));

assert('escapes ampersand',
  safeMarkdown('a & b').includes('&amp;'));

assert('escapes double quote',
  safeMarkdown('"hello"').includes('&quot;'));

assert('converts **bold** to <strong>',
  safeMarkdown('**bold**') === '<strong>bold</strong>');

assert('converts double newline to <br><br>',
  safeMarkdown('a\n\nb').includes('<br><br>'));

assert('converts single newline to <br>',
  safeMarkdown('a\nb').includes('<br>'));

assert('strips cite tags before HTML escaping',
  !safeMarkdown('<cite index="1">text</cite>').includes('cite'));

assert('does not double-escape already-converted bold',
  safeMarkdown('**a** and **b**') === '<strong>a</strong> and <strong>b</strong>');

assert('XSS: script tag is neutralized',
  !safeMarkdown('<script>alert(1)</script>').includes('<script>'));

assert('XSS: onerror attribute is neutralized',
  !safeMarkdown('<img onerror="alert(1)">').includes('<img'));


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — HR CSV fast-path parser
// ═══════════════════════════════════════════════════════════════════════════════
section('HR CSV fast-path parser');

const STANDARD_CSV = `userid,name,dept,role,tenure,perf,manager_id,flight_risk_flag
U001,Alice Chen,Engineering,Engineer,1-3,High,U010,No
U002,Bob Okafor,Product,PM,3-5,Medium,U010,Yes
U003,Carol Kim,Design,Designer,<1,High,,No`;

const parsed = parseHRCsv(STANDARD_CSV);

assert('parses expected number of rows',
  parsed.length === 3);

assert('reads userid column',
  parsed[0].id === 'U001');

assert('reads name column',
  parsed[0].name === 'Alice Chen');

assert('reads dept column',
  parsed[0].dept === 'Engineering');

assert('reads role column',
  parsed[0].role === 'Engineer');

assert('reads tenure column',
  parsed[0].tenure === '1-3');

assert('reads perf column',
  parsed[0].perf === 'High');

assert('reads manager_id column',
  parsed[0].managerId === 'U010');

assert('parses flight_risk_flag No as false',
  parsed[0].flightRisk === false);

assert('parses flight_risk_flag Yes as true',
  parsed[1].flightRisk === true);

assert('handles empty manager_id',
  parsed[2].managerId === null);

assert('supports user_id column alias',
  parseHRCsv('user_id,name\nU001,Alice')[0].id === 'U001');

assert('supports slack_id column alias',
  parseHRCsv('slack_id,name\nU001,Alice')[0].id === 'U001');

assert('returns null when no userid column present',
  parseHRCsv('foo,bar\n1,2') === null);

assert('ignores blank lines',
  parseHRCsv('userid,name\nU001,Alice\n\n\nU002,Bob').length === 2);

assert('handles CRLF line endings',
  parseHRCsv('userid,name\r\nU001,Alice\r\nU002,Bob').length === 2);


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — gFill template engine
// ═══════════════════════════════════════════════════════════════════════════════
section('gFill template engine');

assert('substitutes a single variable',
  gFill('Hello {name}', { name: 'Alex' }) === 'Hello Alex');

assert('substitutes multiple variables',
  gFill('{a} and {b}', { a: 'X', b: 'Y' }) === 'X and Y');

assert('leaves unknown key as the key name',
  gFill('Hello {name}', {}) === 'Hello name');

assert('does not mutate surrounding text',
  gFill('prefix {v} suffix', { v: 'mid' }) === 'prefix mid suffix');


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — gRandInt range
// ═══════════════════════════════════════════════════════════════════════════════
section('gRandInt range');

assert('gRandInt(0,0) always returns 0',
  gRandInt(0, 0) === 0);

let allInRange = true;
for (let i = 0; i < 200; i++) {
  const v = gRandInt(5, 10);
  if (v < 5 || v > 10) { allInRange = false; break; }
}
assert('gRandInt(5,10) always stays in [5,10] over 200 runs', allInRange);

assert('gRandInt produces integer',
  Number.isInteger(gRandInt(1, 100)));


// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(50)}`);
const total = passed + failed;
console.log(`${passed}/${total} tests passed${failed > 0 ? ` — ${failed} FAILED` : ''}`);
if (failed > 0) process.exit(1);
