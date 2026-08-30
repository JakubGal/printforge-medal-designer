import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { compileArtworkPrompt, createMedalForgeServer, resolveLocalAiConfig, validateLocalImageInput } from '../server.mjs';

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

function json(res, status, body) {
  const encoded = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) });
  res.end(encoded);
}

test('print prompt removes request prose and dates while enforcing manufacturing constraints', () => {
  const raw = 'Make me a medal for my run 11 12. This will be at 5.5.2027.';
  const compiled = compileArtworkPrompt({
    brief: raw,
    style: 'emblem',
    colors: 3,
    nozzleMm: .4,
    palette: ['#112233', '#ffffff', 'not-a-color'],
  });
  assert.equal(compiled.policy.artworkOnly, true);
  assert.equal(compiled.policy.allowsRenderedText, false);
  assert.equal(compiled.policy.oneLineMm, .45);
  assert.equal(compiled.policy.robustMm, .9);
  assert.deepEqual(compiled.policy.palette, ['#112233', '#FFFFFF']);
  assert.doesNotMatch(compiled.prompt, /Make me a medal/i);
  assert.doesNotMatch(compiled.prompt, /5\.5\.2027/);
  assert.match(compiled.prompt, /Do not draw, quote, spell, or typeset/i);
  assert.match(compiled.prompt, /anatomically clean runner/i);
  assert.match(compiled.negativePrompt, /text, letters, words, numbers/);
});

test('local AI configuration refuses non-loopback and path-bearing upstreams', () => {
  assert.equal(resolveLocalAiConfig({}).origin, 'http://127.0.0.1:1234');
  assert.throws(() => resolveLocalAiConfig({ MEDALFORGE_SD_URL: 'http://example.com:1234' }), error => error.code === 'LOCAL_AI_CONFIG_INVALID');
  assert.throws(() => resolveLocalAiConfig({ MEDALFORGE_SD_URL: 'http://127.0.0.1:1234/proxy' }), error => error.code === 'LOCAL_AI_CONFIG_INVALID');
  assert.throws(() => resolveLocalAiConfig({ MEDALFORGE_SD_URL: 'https://127.0.0.1:1234' }), error => error.code === 'LOCAL_AI_CONFIG_INVALID');
});

test('loopback setup endpoints expose automatic progress and never require a request body', async t => {
  let phase = 'idle';
  let shutdowns = 0;
  const setupManager = {
    async getStatus() { return { supported: true, managed: true, installed: false, ready: false, busy: phase === 'downloading', phase, progress: phase === 'downloading' ? .25 : 0, message: 'Automatic setup' }; },
    async startSetup() { phase = 'downloading'; return this.getStatus(); },
    cancelSetup() { phase = 'cancelled'; return { supported: true, managed: true, phase, busy: false, progress: .25, message: 'Setup paused' }; },
    noteAvailable() {},
    async shutdown() { shutdowns += 1; },
  };
  const app = createMedalForgeServer({ localAiManager: setupManager });
  const origin = await listen(app);
  t.after(async () => {
    await close(app);
    assert.equal(shutdowns, 1);
  });

  const started = await fetch(`${origin}/api/local-ai/setup`, { method: 'POST', headers: { Origin: origin } });
  assert.equal(started.status, 202);
  assert.equal((await started.json()).setup.phase, 'downloading');

  const status = await fetch(`${origin}/api/local-ai/setup/status`, { headers: { Origin: origin } });
  const progress = (await status.json()).setup;
  assert.equal(progress.progress, .25);
  assert.equal(progress.managed, true);

  const cancelled = await fetch(`${origin}/api/local-ai/setup/cancel`, { method: 'POST', headers: { Origin: origin } });
  assert.equal((await cancelled.json()).setup.phase, 'cancelled');

  const rejected = await fetch(`${origin}/api/local-ai/setup`, { method: 'POST', headers: { Origin: 'http://attacker.example' } });
  assert.equal(rejected.status, 403);
});

test('local concept requests keep photorealistic prompts and bound memory-sensitive settings', () => {
  const input = validateLocalImageInput({
    prompt: 'A premium photorealistic night-running medal on a studio background',
    size: '1024x1536',
    quality: 'high',
    count: 1,
  });
  assert.equal(input.width, 1024);
  assert.equal(input.height, 1536);
  assert.equal(input.count, 1);
  assert.equal(input.sampleSteps, 8);
  assert.match(input.compiled.prompt, /photorealistic/i);
  assert.doesNotMatch(input.compiled.negativePrompt, /photorealistic/i);
  assert.throws(() => validateLocalImageInput({ prompt: 'valid prompt', count: 5 }), error => error.code === 'INVALID_COUNT');
  assert.throws(() => validateLocalImageInput({ prompt: 'valid prompt', surprise: true }), error => error.code === 'UNKNOWN_FIELD');
});

test('same-origin API probes, queues, safely polls, and returns local PNG variants', async t => {
  const receivedGenerations = [];
  const upstream = createServer(async (req, res) => {
    if (req.url === '/sdcpp/v1/capabilities' && req.method === 'GET') {
      json(res, 200, { backend: 'stable-diffusion.cpp', async: true });
      return;
    }
    if (req.url === '/sdcpp/v1/img_gen' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      receivedGenerations.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      json(res, 202, { status: 'queued', poll_url: `/sdcpp/v1/jobs/test-job-${receivedGenerations.length}` });
      return;
    }
    const pollMatch = req.url?.match(/^\/sdcpp\/v1\/jobs\/test-job-(\d+)$/u);
    if (pollMatch && req.method === 'GET') {
      const variant = Number(pollMatch[1]);
      json(res, 200, { status: 'completed', progress: 100, images: [{ b64_json: Buffer.from(`variant-${variant}`).toString('base64') }] });
      return;
    }
    json(res, 404, { error: { message: 'not found' } });
  });
  const upstreamOrigin = await listen(upstream);
  const app = createMedalForgeServer({ env: { MEDALFORGE_SD_URL: upstreamOrigin, MEDALFORGE_SD_TIMEOUT_MS: '60000' } });
  const appOrigin = await listen(app);
  t.after(async () => {
    await close(app);
    await close(upstream);
  });

  const statusResponse = await fetch(`${appOrigin}/api/local-ai/status`, { headers: { Origin: appOrigin } });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.available, true);
  assert.equal(status.api, 'sdcpp-native-async');
  assert.deepEqual(status.limits.sizes, ['1024x1024', '1024x1536', '1536x1024']);
  assert.equal(status.limits.maxCount, 4);
  assert.deepEqual(status.limits.upstream, { maxWidth: null, maxHeight: null, maxBatchCount: null });

  const generationResponse = await fetch(`${appOrigin}/api/local-ai/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin },
    body: JSON.stringify({ brief: 'Create a medal for a Prague night run on 5.5.2027', style: 'silhouette', nozzleMm: .2, colors: 4, seed: 42 }),
  });
  assert.equal(generationResponse.status, 202);
  const queued = await generationResponse.json();
  assert.equal(queued.ok, true);
  assert.match(queued.job.statusUrl, /^\/api\/local-ai\/jobs\/[0-9a-f-]{36}$/);
  assert.equal(queued.compiled.policy.allowsRenderedText, false);

  let job;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const jobResponse = await fetch(`${appOrigin}${queued.job.statusUrl}`, { headers: { Origin: appOrigin } });
    assert.equal(jobResponse.status, 200);
    job = (await jobResponse.json()).job;
    if (job.status === 'completed') break;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 350));
  }
  assert.equal(job.status, 'completed');
  assert.equal(job.images[0].mime_type, 'image/png');
  assert.equal(job.images[0].b64_json, Buffer.from('variant-1').toString('base64'));
  assert.equal(receivedGenerations[0].width, 1024);
  assert.equal(receivedGenerations[0].height, 1024);
  assert.equal(receivedGenerations[0].batch_count, 1);
  assert.equal(receivedGenerations[0].sample_params.sample_steps, 8);
  assert.equal(receivedGenerations[0].output_format, 'png');
  assert.equal(receivedGenerations[0].seed, 42);
  assert.doesNotMatch(receivedGenerations[0].prompt, /Create a medal/i);
  assert.match(receivedGenerations[0].negative_prompt, /pixelated/);

  const conceptResponse = await fetch(`${appOrigin}/api/local-ai/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin },
    body: JSON.stringify({ prompt: 'A photorealistic Prague night-running medal', size: '1536x1024', quality: 'medium', count: 2, seed: 100 }),
  });
  assert.equal(conceptResponse.status, 202);
  const conceptQueued = await conceptResponse.json();
  let conceptJob;
  const observedProgress = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const jobResponse = await fetch(`${appOrigin}${conceptQueued.job.statusUrl}`, { headers: { Origin: appOrigin } });
    conceptJob = (await jobResponse.json()).job;
    observedProgress.push(conceptJob.progress);
    if (conceptJob.status === 'completed') break;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  assert.equal(conceptJob.status, 'completed');
  assert.equal(conceptJob.images.length, 2);
  assert.deepEqual(conceptJob.images.map(image => image.b64_json), [
    Buffer.from('variant-2').toString('base64'),
    Buffer.from('variant-3').toString('base64'),
  ]);
  assert.ok(observedProgress.some(progress => progress >= .5 && progress < 1));
  assert.equal(receivedGenerations.length, 3);
  for (const request of receivedGenerations.slice(1)) {
    assert.equal(request.width, 1536);
    assert.equal(request.height, 1024);
    assert.equal(request.batch_count, 1);
    assert.equal(request.sample_params.sample_steps, 6);
    assert.match(request.prompt, /photorealistic/i);
    assert.doesNotMatch(request.negative_prompt, /photorealistic/i);
  }
  assert.deepEqual(receivedGenerations.slice(1).map(request => request.seed), [100, 101]);
});

test('local jobs can be cancelled without leaving the upstream generator running', async t => {
  let upstreamCancelled = false;
  const upstream = createServer(async (req, res) => {
    if (req.url === '/sdcpp/v1/capabilities' && req.method === 'GET') {
      json(res, 200, { supported_modes: ['img_gen'] });
      return;
    }
    if (req.url === '/sdcpp/v1/img_gen' && req.method === 'POST') {
      for await (const chunk of req) { void chunk; }
      json(res, 202, { status: 'queued', poll_url: '/sdcpp/v1/jobs/cancel-me' });
      return;
    }
    if (req.url === '/sdcpp/v1/jobs/cancel-me/cancel' && req.method === 'POST') {
      upstreamCancelled = true;
      json(res, 200, { status: 'cancelled' });
      return;
    }
    if (req.url === '/sdcpp/v1/jobs/cancel-me' && req.method === 'GET') {
      json(res, 200, { status: 'running', progress: .25 });
      return;
    }
    json(res, 404, { error: { message: 'not found' } });
  });
  const upstreamOrigin = await listen(upstream);
  const app = createMedalForgeServer({ env: { MEDALFORGE_SD_URL: upstreamOrigin, MEDALFORGE_SD_TIMEOUT_MS: '60000' } });
  const appOrigin = await listen(app);
  t.after(async () => {
    await close(app);
    await close(upstream);
  });

  const generation = await fetch(`${appOrigin}/api/local-ai/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin },
    body: JSON.stringify({ prompt: 'A local image to cancel' }),
  });
  const queued = await generation.json();
  const cancelled = await fetch(`${appOrigin}${queued.job.cancelUrl}`, { method: 'POST', headers: { Origin: appOrigin } });
  assert.equal(cancelled.status, 200);
  await new Promise(resolveDelay => setTimeout(resolveDelay, 1_100));
  const status = await fetch(`${appOrigin}${queued.job.statusUrl}`, { headers: { Origin: appOrigin } });
  const job = (await status.json()).job;
  assert.equal(job.status, 'cancelled');
  assert.equal(upstreamCancelled, true);
});

test('local API intersects native dimensions, sequences variants, and requires img_gen support', async t => {
  let nativeCapabilities = {
    model: { name: 'Restricted image model' },
    supported_modes: ['img_gen'],
    limits: { max_width: 1024, max_height: 1024, max_batch_count: 1 },
  };
  const receivedGenerations = [];
  const upstream = createServer(async (req, res) => {
    if (req.url === '/sdcpp/v1/capabilities' && req.method === 'GET') {
      json(res, 200, nativeCapabilities);
      return;
    }
    if (req.url === '/sdcpp/v1/img_gen' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      receivedGenerations.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      json(res, 200, { status: 'completed', images: [{ b64_json: Buffer.from(`restricted-${receivedGenerations.length}`).toString('base64') }] });
      return;
    }
    json(res, 500, { error: { message: 'generation should not be reached' } });
  });
  const upstreamOrigin = await listen(upstream);
  const app = createMedalForgeServer({ env: { MEDALFORGE_SD_URL: upstreamOrigin } });
  const appOrigin = await listen(app);
  t.after(async () => {
    await close(app);
    await close(upstream);
  });

  const statusResponse = await fetch(`${appOrigin}/api/local-ai/status`, { headers: { Origin: appOrigin } });
  const status = await statusResponse.json();
  assert.equal(status.available, true);
  assert.deepEqual(status.limits.sizes, ['1024x1024']);
  assert.equal(status.limits.maxCount, 4);
  assert.deepEqual(status.limits.upstream, { maxWidth: 1024, maxHeight: 1024, maxBatchCount: 1 });

  const unsupportedSize = await fetch(`${appOrigin}/api/local-ai/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin },
    body: JSON.stringify({ prompt: 'valid image prompt', size: '1536x1024' }),
  });
  assert.equal(unsupportedSize.status, 400);
  assert.equal((await unsupportedSize.json()).error.code, 'INVALID_SIZE');

  const sequentialCount = await fetch(`${appOrigin}/api/local-ai/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin },
    body: JSON.stringify({ prompt: 'valid image prompt', count: 4 }),
  });
  assert.equal(sequentialCount.status, 202);
  const sequentialJob = (await sequentialCount.json()).job;
  let completed;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${appOrigin}${sequentialJob.statusUrl}`, { headers: { Origin: appOrigin } });
    completed = (await response.json()).job;
    if (completed.status === 'completed') break;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
  }
  assert.equal(completed.status, 'completed');
  assert.equal(completed.images.length, 4);
  assert.deepEqual(completed.images.map(image => image.b64_json), [1, 2, 3, 4].map(index => Buffer.from(`restricted-${index}`).toString('base64')));
  assert.equal(receivedGenerations.length, 4);
  assert.ok(receivedGenerations.every(request => request.batch_count === 1));

  nativeCapabilities = { model: { name: 'Video model' }, supported_modes: ['vid_gen'] };
  const videoStatus = await fetch(`${appOrigin}/api/local-ai/status`, { headers: { Origin: appOrigin } });
  const videoPayload = await videoStatus.json();
  assert.equal(videoPayload.available, false);
  assert.equal(videoPayload.error.code, 'LOCAL_AI_IMAGE_MODE_UNSUPPORTED');
  assert.deepEqual(videoPayload.limits.sizes, []);

  const videoGeneration = await fetch(`${appOrigin}/api/local-ai/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin },
    body: JSON.stringify({ prompt: 'valid image prompt' }),
  });
  assert.equal(videoGeneration.status, 503);
  assert.equal((await videoGeneration.json()).error.code, 'LOCAL_AI_IMAGE_MODE_UNSUPPORTED');
  assert.equal(receivedGenerations.length, 4);
});

test('local API best-effort cancels an upstream job after a polling timeout', async t => {
  let upstreamCancelled = false;
  const fetchImpl = async (url, options = {}) => {
    const address = String(url);
    if (address.endsWith('/sdcpp/v1/capabilities')) {
      return new Response(JSON.stringify({ supported_modes: ['img_gen'] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (address.endsWith('/sdcpp/v1/img_gen')) {
      return new Response(JSON.stringify({ status: 'queued', poll_url: '/sdcpp/v1/jobs/timeout-job' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    }
    if (address.endsWith('/sdcpp/v1/jobs/timeout-job/cancel') && options.method === 'POST') {
      upstreamCancelled = true;
      return new Response(JSON.stringify({ status: 'cancelled' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (address.endsWith('/sdcpp/v1/jobs/timeout-job')) {
      const error = new Error('poll timed out');
      error.name = 'AbortError';
      throw error;
    }
    throw new Error(`Unexpected local fetch: ${address}`);
  };
  const app = createMedalForgeServer({
    env: { MEDALFORGE_SD_URL: 'http://127.0.0.1:1234', MEDALFORGE_SD_TIMEOUT_MS: '60000' },
    fetchImpl,
  });
  const appOrigin = await listen(app);
  t.after(() => close(app));

  const generation = await fetch(`${appOrigin}/api/local-ai/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin },
    body: JSON.stringify({ prompt: 'A local image whose poll times out' }),
  });
  const queued = await generation.json();
  let job;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await fetch(`${appOrigin}${queued.job.statusUrl}`, { headers: { Origin: appOrigin } });
    job = (await status.json()).job;
    if (job.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(job.status, 'failed');
  assert.equal(job.error.code, 'LOCAL_AI_TIMEOUT');
  assert.equal(upstreamCancelled, true);
});

test('local API rejects cross-origin requests before generation', async t => {
  const app = createMedalForgeServer();
  const appOrigin = await listen(app);
  t.after(() => close(app));
  const response = await fetch(`${appOrigin}/api/local-ai/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://attacker.example' },
    body: JSON.stringify({ brief: 'running eagle' }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'UNTRUSTED_REQUEST');
});
