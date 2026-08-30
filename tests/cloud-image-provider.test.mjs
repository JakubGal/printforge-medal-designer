import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUD_IMAGE_DEFAULTS,
  CLOUD_IMAGE_ENDPOINTS,
  CloudImageError,
  CloudImageProvider,
} from '../cloud-image-provider.js';

function jsonResponse(payload, options = {}) {
  return new Response(JSON.stringify(payload), {
    status: options.status || 200,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
}

function tinyPngBase64(byte = 1) {
  return btoa(String.fromCharCode(137, 80, 78, 71, byte));
}

test('status uses the same-origin endpoint and normalizes capabilities', async () => {
  const calls = [];
  const provider = new CloudImageProvider({
    fetchImpl: async (...args) => {
      calls.push(args);
      return jsonResponse({
        configured: true,
        provider: 'openai',
        model: 'gpt-image-1.5',
        defaults: { size: '1024x1024', quality: 'medium', count: 1 },
        limits: {
          sizes: ['1024x1024', '1536x1024'],
          qualities: ['medium', 'high'],
          maxCount: 4,
        },
      });
    },
  });
  const status = await provider.checkStatus();
  assert.equal(calls[0][0], CLOUD_IMAGE_ENDPOINTS.status);
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.deepEqual(calls[0][1].headers, { Accept: 'application/json' });
  assert.equal(status.available, true);
  assert.equal(status.provider, 'openai');
  assert.equal(status.model, 'gpt-image-1.5');
  assert.deepEqual(status.sizes, ['1024x1024', '1536x1024']);
  assert.deepEqual(status.qualities, ['medium', 'high']);
  assert.equal(status.defaults.quality, 'medium');
  assert.equal(status.maxCount, 4);
});

test('generation posts only public options and returns base64 images in index order', async () => {
  const calls = [];
  const progress = [];
  const provider = new CloudImageProvider({
    fetchImpl: async (...args) => {
      calls.push(args);
      return jsonResponse({
        provider: 'openai',
        model: 'gpt-image-1.5',
        images: [
          { index: 1, b64_json: tinyPngBase64(2), revised_prompt: 'second' },
          { index: 0, base64: tinyPngBase64(1), revisedPrompt: 'first' },
        ],
        metadata: { requestId: 'image-request-1' },
      });
    },
  });

  const result = await provider.generate({
    prompt: '  a night running event  ',
    count: 2,
    apiKey: 'must-not-leave-the-browser',
    onProgress: event => progress.push(event),
  });
  assert.equal(calls[0][0], CLOUD_IMAGE_ENDPOINTS.generate);
  const request = calls[0][1];
  assert.equal(request.credentials, 'same-origin');
  assert.equal(request.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(request.body), {
    prompt: 'a night running event',
    size: CLOUD_IMAGE_DEFAULTS.size,
    quality: CLOUD_IMAGE_DEFAULTS.quality,
    count: 2,
  });
  assert.equal(result.images.length, 2);
  assert.ok(result.images.every(image => image instanceof Blob && image.type === 'image/png'));
  assert.equal(new Uint8Array(await result.images[0].arrayBuffer()).at(-1), 1);
  assert.equal(new Uint8Array(await result.images[1].arrayBuffer()).at(-1), 2);
  assert.equal(result.metadata.provider, 'openai');
  assert.equal(result.metadata.requestId, 'image-request-1');
  assert.deepEqual(result.metadata.revisedPrompts, ['first', 'second']);
  assert.deepEqual(progress.map(event => event.phase), ['request', 'image', 'image']);
  assert.equal(progress.at(-1).progress, 1);
});

test('generation accepts a direct PNG response', async () => {
  const provider = new CloudImageProvider({
    fetchImpl: async () => new Response(Uint8Array.of(137, 80, 78, 71), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'x-image-provider': 'test-provider',
        'x-image-model': 'test-model',
      },
    }),
  });
  const result = await provider.generate({ prompt: 'runner', count: 1, size: '1536x1024', quality: 'medium' });
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].type, 'image/png');
  assert.equal(result.metadata.provider, 'test-provider');
  assert.equal(result.metadata.size, '1536x1024');
});

test('generation supports data URLs and downloaded image URLs', async () => {
  const provider = new CloudImageProvider({
    fetchImpl: async (url, options) => {
      if (url === CLOUD_IMAGE_ENDPOINTS.generate) {
        return jsonResponse({ data: [
          { data_url: `data:image/png;base64,${tinyPngBase64(3)}` },
          { url: 'https://images.example.test/result.png' },
        ] });
      }
      assert.equal(url, 'https://images.example.test/result.png');
      assert.equal(options.credentials, 'omit');
      return new Response(Uint8Array.of(137, 80, 78, 71, 4), { headers: { 'content-type': 'image/png' } });
    },
  });
  const result = await provider.generate({ prompt: 'runner', count: 2 });
  assert.equal(result.images.length, 2);
  assert.equal(new Uint8Array(await result.images[0].arrayBuffer()).at(-1), 3);
  assert.equal(new Uint8Array(await result.images[1].arrayBuffer()).at(-1), 4);
});

test('AbortSignal cancels before and during a generation request', async () => {
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort('No longer needed');
  const unused = new CloudImageProvider({ fetchImpl: async () => assert.fail('fetch should not run') });
  await assert.rejects(unused.generate({ prompt: 'runner', signal: alreadyCancelled.signal }), error => {
    assert.equal(error.name, 'AbortError');
    return true;
  });

  let observedSignal;
  const controller = new AbortController();
  const waiting = new CloudImageProvider({
    fetchImpl: async (_url, options) => {
      observedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    },
  });
  const pending = waiting.generate({ prompt: 'runner', signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(observedSignal, controller.signal);
});

test('HTTP and malformed responses produce actionable typed errors', async () => {
  const denied = new CloudImageProvider({
    fetchImpl: async () => jsonResponse({ error: { message: 'Cloud images are not configured.', code: 'NOT_CONFIGURED' } }, { status: 503 }),
  });
  await assert.rejects(denied.generate({ prompt: 'runner' }), error => {
    assert.ok(error instanceof CloudImageError);
    assert.equal(error.status, 503);
    assert.equal(error.code, 'NOT_CONFIGURED');
    assert.equal(error.message, 'Cloud images are not configured.');
    return true;
  });

  const invalid = new CloudImageProvider({
    fetchImpl: async () => new Response('<html>not json</html>', { headers: { 'content-type': 'text/html' } }),
  });
  await assert.rejects(invalid.checkStatus(), error => {
    assert.equal(error.code, 'CLOUD_IMAGE_INVALID_RESPONSE');
    assert.match(error.message, /invalid JSON/i);
    return true;
  });
});

test('generation validates prompt, resolution, quality, and image count locally', async () => {
  const provider = new CloudImageProvider({ fetchImpl: async () => assert.fail('invalid input should not fetch') });
  await assert.rejects(provider.generate({ prompt: '   ' }), error => error.code === 'CLOUD_IMAGE_PROMPT_REQUIRED');
  await assert.rejects(provider.generate({ prompt: 'runner', size: '300x300' }), error => error.code === 'CLOUD_IMAGE_INVALID_SIZE');
  await assert.rejects(provider.generate({ prompt: 'runner', size: 'not-a-size' }), error => error.code === 'CLOUD_IMAGE_INVALID_SIZE');
  await assert.rejects(provider.generate({ prompt: 'runner', quality: '../../secret' }), error => error.code === 'CLOUD_IMAGE_INVALID_QUALITY');
  await assert.rejects(provider.generate({ prompt: 'runner', count: 5 }), error => error.code === 'CLOUD_IMAGE_INVALID_COUNT');
});
