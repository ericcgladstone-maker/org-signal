import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anthropic, openai, gemini, getProvider, providerList } from '../../src/llm/providers/index.js';
import { readSSE, streamFromString } from '../../src/llm/sse.js';
import { LLMError } from '../../src/llm/errors.js';
import { fixture, fakeFetch } from './helpers.js';

const KEY_A = 'sk-ant-api03-FAKEKEYFAKEKEYFAKEKEY';
const KEY_O = 'sk-proj-FAKEKEYFAKEKEYFAKEKEY1234';
const KEY_G = 'AIzaFAKEKEYFAKEKEYFAKEKEYFAKEKEY1234567';

const TOOLS = [{ name: 'top_nodes', description: 'Top nodes', parameters: { type: 'object', properties: { metric: { type: 'string' }, k: { type: 'integer' } }, required: ['metric'] } }];

test('registry exposes the shared interface', () => {
  for (const p of providerList) {
    for (const f of ['id', 'label', 'defaultModel']) assert.equal(typeof p[f], 'string', `${p.id}.${f}`);
    assert.equal(typeof p.listModels, 'function');
    assert.equal(typeof p.chat, 'function');
  }
  assert.equal(getProvider('anthropic'), anthropic);
  assert.throws(() => getProvider('nope'));
});

test('SSE reader handles CRLF, comments, multi-line data and chunk splits', async () => {
  const text = ': comment\r\nevent: a\r\ndata: one\r\ndata: two\r\n\r\ndata: {"x":1}\n\ndata: tail';
  const out = [];
  for await (const ev of readSSE(streamFromString(text, 3))) out.push(ev);
  assert.deepEqual(out, [{ event: 'a', data: 'one\ntwo' }, { event: 'message', data: '{"x":1}' }, { event: 'message', data: 'tail' }]);
});

// ---- Anthropic -----------------------------------------------------------------

test('anthropic: streams text, keeps thinking blocks for replay, sends browser header', async () => {
  const fetch = fakeFetch([{ sse: true, body: fixture('anthropic-text.sse') }]);
  const deltas = [];
  const r = await anthropic.chat({ key: KEY_A, model: 'claude-opus-5-5', system: 'S', messages: [{ role: 'user', content: 'hi' }], onText: d => deltas.push(d), fetch });
  assert.equal(r.text, 'Hello there!');
  assert.deepEqual(deltas, ['Hello', ' there!']);
  assert.equal(r.stopReason, 'end');
  assert.deepEqual(r.usage, { inputTokens: 35, outputTokens: 15, cacheReadTokens: 10 });
  assert.equal(r.message.raw.content[0].type, 'thinking');
  assert.equal(r.message.raw.content[0].signature, 'EqQBCgIYAhIMfakesig');
  const req = fetch.calls[0];
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(req.headers['x-api-key'], KEY_A);
  assert.equal(req.headers['anthropic-version'], '2023-06-01');
  assert.equal(req.body.stream, true);
  assert.equal(req.body.system[0].text, 'S');
  // Refusal fallback opt-in for Opus 5.5.
  assert.equal(req.body.fallbacks, 'default');
  assert.equal(req.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
});

test('anthropic: tool-use round trip, thinking/tool blocks echoed, results grouped', async () => {
  const fetch = fakeFetch([{ sse: true, body: fixture('anthropic-tool.sse') }, { sse: true, body: fixture('anthropic-text.sse') }]);
  const first = await anthropic.chat({ key: KEY_A, model: 'claude-haiku-4-5', messages: [{ role: 'user', content: 'who brokers?' }], tools: TOOLS, fetch });
  assert.equal(first.stopReason, 'tool_use');
  assert.deepEqual(first.toolCalls, [{ id: 'toolu_01FAKE', name: 'top_nodes', arguments: { metric: 'betweenness', k: 3 } }]);
  assert.equal(fetch.calls[0].body.tools[0].input_schema.type, 'object');
  assert.equal(fetch.calls[0].body.tools[0].eager_input_streaming, true);
  // No fallbacks for models outside the classifier set.
  assert.equal(fetch.calls[0].body.fallbacks, undefined);
  const history = [
    { role: 'user', content: 'who brokers?' },
    first.message,
    { role: 'tool', toolCallId: 'toolu_01FAKE', name: 'top_nodes', content: '{"result_id":"T1"}' },
  ];
  await anthropic.chat({ key: KEY_A, model: 'claude-haiku-4-5', messages: history, tools: TOOLS, fetch });
  const sent = fetch.calls[1].body.messages;
  assert.equal(sent.length, 3);
  assert.deepEqual(sent[1].content.map(b => b.type), ['text', 'tool_use']);
  assert.deepEqual(sent[1].content[1].input, { metric: 'betweenness', k: 3 });
  assert.equal(sent[1].content[1]._json, undefined);
  assert.deepEqual(sent[2], { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01FAKE', content: '{"result_id":"T1"}' }] });
});

test('anthropic: history from another provider is rebuilt with safe ids', async () => {
  const fetch = fakeFetch([{ sse: true, body: fixture('anthropic-text.sse') }]);
  await anthropic.chat({ key: KEY_A, model: 'claude-haiku-4-5', fetch, messages: [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call.1/x', name: 'top_nodes', arguments: { metric: 'degree' } }], raw: { provider: 'openai', output: [] } },
    { role: 'tool', toolCallId: 'call.1/x', name: 'top_nodes', content: { ok: 1 }, isError: true },
  ] });
  const m = fetch.calls[0].body.messages;
  assert.equal(m[1].content[0].id, 'call_1_x');
  assert.equal(m[2].content[0].tool_use_id, 'call_1_x');
  assert.equal(m[2].content[0].is_error, true);
});

test('anthropic: mid-output fallback blocks are trimmed on echo', async () => {
  const { echoContent } = await import('../../src/llm/providers/anthropic.js');
  const out = echoContent([
    { type: 'thinking', thinking: '', signature: 'a' }, { type: 'text', text: 'partial' }, { type: 'tool_use', id: 'x', name: 'n', input: {} },
    { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } }, { type: 'thinking', thinking: '', signature: 'b' }, { type: 'text', text: 'rest' }, { type: 'text', text: '' },
  ]);
  assert.deepEqual(out.map(b => b.type + (b.signature || b.text || '')), ['textpartial', 'thinkingb', 'textrest']);
});

test('anthropic: stream error event, refusal, 401 and network failure', async () => {
  await assert.rejects(
    anthropic.chat({ key: KEY_A, messages: [{ role: 'user', content: 'x' }], fetch: fakeFetch([{ sse: true, body: fixture('anthropic-overloaded.sse') }]) }),
    e => e instanceof LLMError && e.code === 'overloaded' && e.retryable,
  );
  const r = await anthropic.chat({ key: KEY_A, messages: [{ role: 'user', content: 'x' }], fetch: fakeFetch([{ sse: true, body: fixture('anthropic-refusal.sse') }]) });
  assert.equal(r.stopReason, 'refusal');
  await assert.rejects(
    anthropic.chat({ key: KEY_A, messages: [{ role: 'user', content: 'x' }], fetch: fakeFetch([{ status: 401, body: fixture('anthropic-401.json') }]) }),
    e => e.code === 'auth' && e.status === 401 && /rejected the API key/.test(e.message) && !e.message.includes(KEY_A),
  );
  await assert.rejects(
    anthropic.chat({ key: KEY_A, messages: [{ role: 'user', content: 'x' }], fetch: fakeFetch([{ throw: new TypeError('Failed to fetch') }]) }),
    e => e.code === 'network' && /CORS/.test(e.message),
  );
  await assert.rejects(
    anthropic.chat({ key: KEY_A, messages: [{ role: 'user', content: 'x' }], fetch: fakeFetch([{ status: 429, body: '{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}' }]) }),
    e => e.code === 'rate_limit' && e.retryable,
  );
  await assert.rejects(
    anthropic.chat({ key: KEY_A, messages: [{ role: 'user', content: 'x' }], fetch: fakeFetch([{ status: 529, body: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }]) }),
    e => e.code === 'overloaded',
  );
  await assert.rejects(
    anthropic.chat({ key: KEY_A, messages: [{ role: 'user', content: 'x' }], fetch: fakeFetch([{ status: 403, body: '{"type":"error","error":{"type":"permission_error","message":"no"}}' }]) }),
    e => e.code === 'permission',
  );
  const ac = new AbortController(); ac.abort();
  await assert.rejects(anthropic.chat({ key: KEY_A, messages: [{ role: 'user', content: 'x' }], signal: ac.signal, fetch: fakeFetch([{ sse: true, body: '' }]) }), e => e.code === 'aborted');
});

test('anthropic: listModels and structured output request', async () => {
  const fetch = fakeFetch([{ body: fixture('anthropic-models.json') }, { sse: true, body: fixture('anthropic-text.sse') }]);
  const models = await anthropic.listModels({ key: KEY_A, fetch });
  assert.deepEqual(models.map(m => m.id), ['claude-opus-5-5', 'claude-haiku-4-5']);
  assert.equal(models[0].contextWindow, 1000000);
  assert.match(fetch.calls[0].url, /\/v1\/models\?limit=1000$/);
  await anthropic.chat({ key: KEY_A, messages: [{ role: 'user', content: 'x' }], json: { schema: { type: 'object' } }, effort: 'low', fetch });
  assert.deepEqual(fetch.calls[1].body.output_config, { effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } });
});

// ---- OpenAI --------------------------------------------------------------------

test('openai: streams text from the Responses API, stateless with reasoning replay', async () => {
  const fetch = fakeFetch([{ sse: true, body: fixture('openai-text.sse') }]);
  const deltas = [];
  const r = await openai.chat({ key: KEY_O, system: 'S', messages: [{ role: 'user', content: 'hi' }], onText: d => deltas.push(d), fetch });
  assert.equal(r.text, 'Hello there!');
  assert.deepEqual(deltas, ['Hello', ' there!']);
  assert.equal(r.stopReason, 'end');
  assert.deepEqual(r.usage, { inputTokens: 30, outputTokens: 12, cacheReadTokens: 0 });
  assert.equal(r.message.raw.output[0].type, 'reasoning');
  const req = fetch.calls[0];
  assert.equal(req.url, 'https://api.openai.com/v1/responses');
  assert.equal(req.headers.authorization, `Bearer ${KEY_O}`);
  assert.equal(req.body.instructions, 'S');
  assert.equal(req.body.store, false);
  assert.deepEqual(req.body.include, ['reasoning.encrypted_content']);
  assert.equal(req.body.model, 'gpt-6.1-sol');
});

test('openai: function call round trip replays output items and sends function_call_output', async () => {
  const fetch = fakeFetch([{ sse: true, body: fixture('openai-tool.sse') }, { sse: true, body: fixture('openai-text.sse') }]);
  const first = await openai.chat({ key: KEY_O, messages: [{ role: 'user', content: 'q' }], tools: TOOLS, fetch });
  assert.equal(first.stopReason, 'tool_use');
  assert.deepEqual(first.toolCalls, [{ id: 'call_1234xyz', name: 'top_nodes', arguments: { metric: 'betweenness', k: 3 } }]);
  assert.deepEqual(fetch.calls[0].body.tools[0], { type: 'function', name: 'top_nodes', description: 'Top nodes', parameters: TOOLS[0].parameters, strict: false });
  await openai.chat({ key: KEY_O, fetch, tools: TOOLS, messages: [
    { role: 'user', content: 'q' }, first.message, { role: 'tool', toolCallId: 'call_1234xyz', name: 'top_nodes', content: '{"result_id":"T1"}' },
  ] });
  const input = fetch.calls[1].body.input;
  assert.equal(input[1].type, 'function_call');
  assert.equal(input[1].call_id, 'call_1234xyz');
  assert.deepEqual(input[2], { type: 'function_call_output', call_id: 'call_1234xyz', output: '{"result_id":"T1"}' });
});

test('openai: errors map to user-facing codes', async () => {
  await assert.rejects(
    openai.chat({ key: KEY_O, messages: [{ role: 'user', content: 'x' }], fetch: fakeFetch([{ status: 401, body: fixture('openai-401.json') }]) }),
    e => e.code === 'auth' && !e.message.includes(KEY_O),
  );
  await assert.rejects(
    openai.chat({ key: KEY_O, messages: [{ role: 'user', content: 'x' }], fetch: fakeFetch([{ status: 429, body: fixture('openai-429-quota.json') }]) }),
    e => e.code === 'billing' && !e.retryable,
  );
  await assert.rejects(
    openai.chat({ key: KEY_O, messages: [{ role: 'user', content: 'x' }], fetch: fakeFetch([{ status: 429, body: '{"error":{"message":"Rate limit reached","type":"requests","code":"rate_limit_exceeded"}}' }]) }),
    e => e.code === 'rate_limit',
  );
  await assert.rejects(
    openai.chat({ key: KEY_O, messages: [{ role: 'user', content: 'x' }], fetch: fakeFetch([{ status: 503, body: '{"error":{"message":"overloaded","type":"service_unavailable_error","code":"server_is_overloaded"}}' }]) }),
    e => e.code === 'overloaded',
  );
  await assert.rejects(
    openai.chat({ key: KEY_O, messages: [{ role: 'user', content: 'x' }], fetch: fakeFetch([{ sse: true, body: fixture('openai-failed.sse') }]) }),
    e => e.code === 'server',
  );
});

test('openai: listModels filters non-chat models and sorts newest first', async () => {
  const models = await openai.listModels({ key: KEY_O, fetch: fakeFetch([{ body: fixture('openai-models.json') }]) });
  assert.deepEqual(models.map(m => m.id), ['gpt-6.1-sol', 'gpt-6-luna']);
});

// ---- Gemini --------------------------------------------------------------------

test('gemini: streams text, keeps thought signatures, uses header auth', async () => {
  const fetch = fakeFetch([{ sse: true, body: fixture('gemini-text.sse') }]);
  const deltas = [];
  const r = await gemini.chat({ key: KEY_G, system: 'S', messages: [{ role: 'user', content: 'hi' }], onText: d => deltas.push(d), fetch });
  assert.equal(r.text, 'Hello there!');
  assert.deepEqual(deltas, ['Hello', ' there!']);
  assert.equal(r.stopReason, 'end');
  assert.deepEqual(r.usage, { inputTokens: 9, outputTokens: 23, cacheReadTokens: 0 });
  assert.equal(r.message.raw.parts.at(-1).thoughtSignature, 'CiQBFAKESIG');
  const req = fetch.calls[0];
  assert.equal(req.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
  assert.equal(req.headers['x-goog-api-key'], KEY_G);
  assert.ok(!req.url.includes(KEY_G));
  assert.deepEqual(req.body.systemInstruction, { parts: [{ text: 'S' }] });
});

test('gemini: function call round trip echoes signature and call id', async () => {
  const fetch = fakeFetch([{ sse: true, body: fixture('gemini-tool.sse') }, { sse: true, body: fixture('gemini-text.sse') }]);
  const first = await gemini.chat({ key: KEY_G, messages: [{ role: 'user', content: 'q' }], tools: TOOLS, fetch });
  assert.equal(first.stopReason, 'tool_use');
  assert.deepEqual(first.toolCalls, [{ id: 'fc_gem_1', name: 'top_nodes', arguments: { metric: 'betweenness', k: 3 } }]);
  assert.deepEqual(fetch.calls[0].body.tools, [{ functionDeclarations: [{ name: 'top_nodes', description: 'Top nodes', parametersJsonSchema: TOOLS[0].parameters }] }]);
  await gemini.chat({ key: KEY_G, fetch, tools: TOOLS, messages: [
    { role: 'user', content: 'q' }, first.message, { role: 'tool', toolCallId: 'fc_gem_1', name: 'top_nodes', content: '{"result_id":"T1","nodes":[]}' },
  ] });
  const c = fetch.calls[1].body.contents;
  assert.equal(c[1].role, 'model');
  assert.equal(c[1].parts[0].thoughtSignature, 'CiQBFAKESIG2');
  assert.deepEqual(c[2], { role: 'user', parts: [{ functionResponse: { id: 'fc_gem_1', name: 'top_nodes', response: { result_id: 'T1', nodes: [] } } }] });
});

test('gemini: injected history gets the documented dummy signature', async () => {
  const fetch = fakeFetch([{ sse: true, body: fixture('gemini-text.sse') }]);
  await gemini.chat({ key: KEY_G, fetch, messages: [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_1', name: 'a', arguments: {} }, { id: 'toolu_2', name: 'b', arguments: {} }] },
    { role: 'tool', toolCallId: 'toolu_1', name: 'a', content: 'plain text' },
    { role: 'tool', toolCallId: 'toolu_2', name: 'b', content: '{}' },
  ] });
  const c = fetch.calls[0].body.contents;
  assert.equal(c[1].parts[0].thoughtSignature, 'skip_thought_signature_validator');
  assert.equal(c[1].parts[1].thoughtSignature, undefined);
  assert.equal(c[2].parts.length, 2);
  assert.deepEqual(c[2].parts[0].functionResponse.response, { result: 'plain text' });
});

test('gemini: invalid key (HTTP 400), 429, listModels', async () => {
  await assert.rejects(
    gemini.chat({ key: KEY_G, messages: [{ role: 'user', content: 'x' }], fetch: fakeFetch([{ status: 400, body: fixture('gemini-400-key.json') }]) }),
    e => e.code === 'auth' && e.status === 400,
  );
  await assert.rejects(
    gemini.chat({ key: KEY_G, messages: [{ role: 'user', content: 'x' }], fetch: fakeFetch([{ status: 429, body: fixture('gemini-429.json') }]) }),
    e => e.code === 'rate_limit',
  );
  const models = await gemini.listModels({ key: KEY_G, fetch: fakeFetch([{ body: fixture('gemini-models.json') }]) });
  assert.deepEqual(models.map(m => m.id), ['gemini-3.8-flash']);
  assert.equal(models[0].maxOutput, 65536);
});

test('gemini: safety finish becomes refusal, structured output config', async () => {
  const body = 'data: {"candidates":[{"content":{"parts":[{"text":""}],"role":"model"},"finishReason":"SAFETY"}]}\n\n';
  const fetch = fakeFetch([{ sse: true, body }]);
  const r = await gemini.chat({ key: KEY_G, messages: [{ role: 'user', content: 'x' }], json: { schema: { type: 'object' } }, fetch });
  assert.equal(r.stopReason, 'refusal');
  // Verified live against generateContent on 2026-10-04 (responseFormat.text.mimeType: 'application/json' is a 400).
  assert.equal(fetch.calls[0].body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(fetch.calls[0].body.generationConfig.responseJsonSchema, { type: 'object' });
  assert.equal(fetch.calls[0].body.generationConfig.responseFormat, undefined);
});
