import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalImageProvider } from '../local-image-provider.js';

const jobUrl = '/api/local-ai/jobs/12345678-1234-1234-1234-123456789abc';
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

test('local provider reports a missing optional generator without throwing', async () => {
  const provider = new LocalImageProvider({
    fetchImpl: async url => {
      assert.equal(url, '/api/local-ai/status');
      return json({ ok: true, available: false, provider: 'stable-diffusion.cpp', error: { message: 'not running' } });
    },
  });
  const status = await provider.checkStatus();
  assert.equal(status.available, false);
  assert.equal(status.message, 'not running');
  assert.equal(status.defaults.count, 1);
});

test('local provider normalizes native model metadata and enforces advertised limits', async () => {
  let calls = 0;
  const provider = new LocalImageProvider({
    fetchImpl: async url => {
      calls += 1;
      assert.equal(url, '/api/local-ai/status');
      return json({
        ok: true,
        available: true,
        provider: 'stable-diffusion.cpp',
        capabilities: { model: { name: 'Z-Image Turbo', stem: 'z-image-turbo' } },
        defaults: { size: '1024x1024', quality: 'high', count: 1 },
        limits: { sizes: ['1024x1024'], qualities: ['low', 'medium', 'high'], maxCount: 1 },
      });
    },
  });
  const status = await provider.checkStatus();
  assert.equal(status.model, 'Z-Image Turbo');
  assert.deepEqual(status.sizes, ['1024x1024']);
  assert.equal(status.maxCount, 1);
  await assert.rejects(
    provider.generate({ prompt: 'valid local image', size: '1536x1024' }),
    error => error.code === 'LOCAL_IMAGE_INVALID_SIZE',
  );
  await assert.rejects(
    provider.generate({ prompt: 'valid local image', count: 2 }),
    error => error.code === 'LOCAL_IMAGE_INVALID_COUNT',
  );
  assert.equal(calls, 1);
});

test('local provider starts automatic setup, reports determinate progress, and waits until ready', async () => {
  const calls = [];
  let polls = 0;
  const provider = new LocalImageProvider({
    pollIntervalMs: 50,
    setupTimeoutMs: 2_000,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' });
      if (url === '/api/local-ai/setup') {
        return json({ ok: true, setup: { supported: true, busy: true, phase: 'preparing', progress: 0, totalBytes: 6_000, message: 'Checking this computer…' } }, 202);
      }
      assert.equal(url, '/api/local-ai/setup/status');
      polls += 1;
      return polls === 1
        ? json({ ok: true, setup: { supported: true, busy: true, phase: 'downloading', progress: .5, downloadedBytes: 3_000, totalBytes: 6_000, message: 'Downloading image model…' } })
        : json({ ok: true, setup: { supported: true, installed: true, ready: true, phase: 'ready', progress: 1, downloadedBytes: 6_000, totalBytes: 6_000, message: 'Ready.' } });
    },
  });
  const progress = [];
  const setup = await provider.ensureSetup({ onProgress: update => progress.push(update) });
  assert.equal(setup.ready, true);
  assert.deepEqual(calls.map(call => call.url), ['/api/local-ai/setup', '/api/local-ai/setup/status', '/api/local-ai/setup/status']);
  assert.ok(progress.some(update => update.progress === .5));
  assert.equal(progress.at(-1).progress, 1);
});

test('local provider submits public settings, polls, and returns ordered image blobs', async () => {
  const calls = [];
  let polls = 0;
  const provider = new LocalImageProvider({
    pollIntervalMs: 1,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === '/api/local-ai/generate') {
        return json({ ok: true, provider: 'stable-diffusion.cpp', job: { status: 'queued', progress: 0, statusUrl: jobUrl } }, 202);
      }
      assert.equal(url, jobUrl);
      polls += 1;
      return polls === 1
        ? json({ ok: true, job: { status: 'running', progress: .5, statusUrl: jobUrl } })
        : json({ ok: true, job: { status: 'completed', progress: 1, statusUrl: jobUrl, images: [
          { mime_type: 'image/png', b64_json: 'iVBORw0KGgo=' },
          { mime_type: 'image/webp', b64_json: 'UklGRg==' },
        ] } });
    },
  });
  const progress = [];
  const result = await provider.generate({
    prompt: 'A photorealistic night-running medal',
    size: '1536x1024',
    quality: 'high',
    count: 2,
    onProgress: update => progress.push(update),
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    prompt: 'A photorealistic night-running medal', size: '1536x1024', quality: 'high', count: 2,
  });
  assert.equal(result.images.length, 2);
  assert.equal(result.images[0].type, 'image/png');
  assert.equal(result.images[1].type, 'image/webp');
  assert.equal(result.metadata.size, '1536x1024');
  assert.equal(progress.at(-1).progress, 1);
});

test('local provider rejects unsafe job URLs', async () => {
  const provider = new LocalImageProvider({
    fetchImpl: async () => json({ ok: true, job: { status: 'queued', statusUrl: 'http://attacker.example/job' } }, 202),
  });
  await assert.rejects(
    provider.generate({ prompt: 'safe local image', count: 1 }),
    error => error.code === 'LOCAL_IMAGE_UNSAFE_JOB_URL',
  );
});

test('local provider aborts promptly while waiting for a job', async () => {
  const controller = new AbortController();
  const urls = [];
  const provider = new LocalImageProvider({
    pollIntervalMs: 100,
    fetchImpl: async url => {
      urls.push(url);
      return json({ ok: true, job: { status: 'queued', progress: 0, statusUrl: jobUrl } }, 202);
    },
  });
  const pending = provider.generate({ prompt: 'cancel this local image', signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, error => error.name === 'AbortError');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(urls.includes(`${jobUrl}/cancel`));
});

test('local provider best-effort cancels the remote job when its deadline expires', async () => {
  const urls = [];
  const provider = new LocalImageProvider({
    pollIntervalMs: 50,
    timeoutMs: 1_000,
    fetchImpl: async url => {
      urls.push(url);
      if (url === '/api/local-ai/generate') {
        return json({ ok: true, provider: 'stable-diffusion.cpp', job: { status: 'queued', progress: 0, statusUrl: jobUrl } }, 202);
      }
      if (url === `${jobUrl}/cancel`) return json({ ok: true, job: { status: 'cancelled' } });
      return json({ ok: true, job: { status: 'running', progress: .5, statusUrl: jobUrl } });
    },
  });
  await assert.rejects(
    provider.generate({ prompt: 'time out this local image' }),
    error => error.code === 'LOCAL_IMAGE_TIMEOUT',
  );
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(urls.includes(`${jobUrl}/cancel`));
});

test('local provider validates resolution, quality, count, and prompt before fetching', async () => {
  let calls = 0;
  const provider = new LocalImageProvider({ fetchImpl: async () => { calls += 1; return json({}); } });
  await assert.rejects(provider.generate({ prompt: 'x' }), /Describe/);
  await assert.rejects(provider.generate({ prompt: 'valid prompt', size: '512x512' }), /Choose 1024/);
  await assert.rejects(provider.generate({ prompt: 'valid prompt', quality: 'ultra' }), /low, medium, or high/);
  await assert.rejects(provider.generate({ prompt: 'valid prompt', count: 8 }), /between 1 and 4/);
  assert.equal(calls, 0);
});
