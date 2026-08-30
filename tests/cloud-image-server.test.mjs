import test from 'node:test';
import assert from 'node:assert/strict';
import { createMedalForgeServer, validateCloudImageInput } from '../server.mjs';

const TEST_KEY = 'sk-test-this-secret-must-never-reach-the-browser';
const PNG_BASE64 = 'iVBORw0KGgo=';

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolveListen(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
}

async function openApp(t, options = {}) {
  const app = createMedalForgeServer(options);
  const origin = await listen(app);
  t.after(() => close(app));
  return origin;
}

function post(origin, body, headers = {}) {
  return fetch(`${origin}/api/cloud-image/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('cloud image input has strict defaults, fields, count aliases, and current API sizes', () => {
  assert.deepEqual(validateCloudImageInput({ prompt: 'A runner at night' }), {
    prompt: 'A runner at night',
    count: 1,
    size: '1024x1024',
    quality: 'medium',
  });
  assert.equal(validateCloudImageInput({ prompt: 'A runner', n: 4 }).count, 4);
  assert.equal(validateCloudImageInput({ prompt: 'A runner', n: 2, count: 2 }).count, 2);
  assert.throws(() => validateCloudImageInput({ prompt: 'A runner', count: 1.5 }), error => error.code === 'INVALID_COUNT');
  assert.throws(() => validateCloudImageInput({ prompt: 'A runner', count: 1, n: 2 }), error => error.code === 'COUNT_CONFLICT');
  assert.throws(() => validateCloudImageInput({ prompt: 'A runner', size: '2048x2048' }), error => error.code === 'INVALID_SIZE');
  assert.throws(() => validateCloudImageInput({ prompt: 'A runner', model: 'other-model' }), error => error.code === 'UNKNOWN_FIELD');
});

test('status reports configuration and capabilities without exposing the API key', async t => {
  let fetchCalls = 0;
  const origin = await openApp(t, {
    env: { OPENAI_API_KEY: TEST_KEY },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('Status must not call the paid upstream');
    },
  });
  const response = await fetch(`${origin}/api/cloud-image/status`, { headers: { Origin: origin } });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, new RegExp(TEST_KEY));
  const body = JSON.parse(text);
  assert.equal(body.ok, true);
  assert.equal(body.available, true);
  assert.equal(body.configured, true);
  assert.equal(body.model, 'gpt-image-2');
  assert.deepEqual(body.defaults, { size: '1024x1024', quality: 'medium', count: 1 });
  assert.deepEqual(body.limits.sizes, ['1024x1024', '1024x1536', '1536x1024']);
  assert.equal(fetchCalls, 0);
});

test('generation sends a server-only key and returns only sanitized PNG data', async t => {
  let upstreamRequest;
  const origin = await openApp(t, {
    env: { OPENAI_API_KEY: TEST_KEY },
    fetchImpl: async (url, init) => {
      upstreamRequest = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        created: 123,
        data: [{ b64_json: PNG_BASE64 }, { b64_json: PNG_BASE64 }],
        internal: TEST_KEY,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const response = await post(origin, {
    prompt: 'Photorealistic night running event in Prague',
    count: 2,
    n: 2,
    size: '1536x1024',
    quality: 'high',
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, new RegExp(TEST_KEY));
  const body = JSON.parse(text);
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.equal(body.images.length, 2);
  assert.deepEqual(body.images[0], { b64_json: PNG_BASE64, mime_type: 'image/png' });

  assert.equal(upstreamRequest.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(upstreamRequest.init.method, 'POST');
  assert.equal(upstreamRequest.init.redirect, 'error');
  assert.equal(upstreamRequest.init.headers.Authorization, `Bearer ${TEST_KEY}`);
  assert.deepEqual(upstreamRequest.body, {
    model: 'gpt-image-2',
    prompt: 'Photorealistic night running event in Prague',
    n: 2,
    size: '1536x1024',
    quality: 'high',
    output_format: 'png',
  });
});

test('generation rejects missing configuration, cross-origin calls, and invalid bodies before upstream', async t => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    throw new Error('Upstream should not be called');
  };
  const configuredOrigin = await openApp(t, { env: { OPENAI_API_KEY: TEST_KEY }, fetchImpl });
  const crossOrigin = await fetch(`${configuredOrigin}/api/cloud-image/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify({ prompt: 'A runner' }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error.code, 'UNTRUSTED_REQUEST');

  const invalid = await post(configuredOrigin, { prompt: 'A runner', quality: 'ultra' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_QUALITY');
  assert.equal(fetchCalls, 0);

  const unconfiguredOrigin = await openApp(t, { env: {}, fetchImpl });
  const unavailable = await post(unconfiguredOrigin, { prompt: 'A runner' });
  assert.equal(unavailable.status, 503);
  const unavailableText = await unavailable.text();
  assert.equal(JSON.parse(unavailableText).error.code, 'OPENAI_NOT_CONFIGURED');
  assert.doesNotMatch(unavailableText, /Bearer|sk-/i);
  assert.equal(fetchCalls, 0);
});

test('upstream authentication, timeout, and malformed-image failures are sanitized', async t => {
  const cases = [
    {
      name: 'authentication',
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: `invalid ${TEST_KEY}` } }), { status: 401 }),
      status: 503,
      code: 'OPENAI_AUTH_ERROR',
    },
    {
      name: 'timeout',
      fetchImpl: async () => { throw new DOMException('aborted with private details', 'AbortError'); },
      status: 504,
      code: 'OPENAI_TIMEOUT',
    },
    {
      name: 'malformed image',
      fetchImpl: async () => new Response(JSON.stringify({ data: [{ b64_json: 'not-a-png=' }] }), { status: 200 }),
      status: 502,
      code: 'OPENAI_INVALID_RESPONSE',
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async inner => {
      const origin = await openApp(inner, { env: { OPENAI_API_KEY: TEST_KEY }, fetchImpl: scenario.fetchImpl });
      const response = await post(origin, { prompt: 'A runner' });
      assert.equal(response.status, scenario.status);
      const text = await response.text();
      assert.equal(JSON.parse(text).error.code, scenario.code);
      assert.doesNotMatch(text, new RegExp(TEST_KEY));
      assert.doesNotMatch(text, /private details/i);
    });
  }
});

test('request bodies larger than the JSON limit are rejected before upstream', async t => {
  let fetchCalls = 0;
  const origin = await openApp(t, {
    env: { OPENAI_API_KEY: TEST_KEY },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('Upstream should not be called');
    },
  });
  const response = await post(origin, JSON.stringify({ prompt: 'x'.repeat(17_000) }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'REQUEST_TOO_LARGE');
  assert.equal(fetchCalls, 0);
});
