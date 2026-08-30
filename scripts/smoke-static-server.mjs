import assert from 'node:assert/strict';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createMedalForgeServer } from '../server.mjs';

const server = createMedalForgeServer({ root: resolve(process.cwd(), 'public'), env: {} });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;

async function request(path, options = {}) {
  return fetch(`${origin}${path}`, { redirect: 'manual', ...options });
}

try {
  const hub = await request('/');
  assert.equal(hub.status, 200);
  assert.match(hub.headers.get('content-type') || '', /^text\/html/u);
  assert.match(await hub.text(), /PrintForge/u);

  const studio = await request('/workspaces/medals/');
  assert.equal(studio.status, 200);
  assert.match(studio.headers.get('content-security-policy') || '', /wasm-unsafe-eval/u);
  assert.doesNotMatch(studio.headers.get('content-security-policy') || '', /(?:^|\s)'unsafe-eval'(?:;|\s|$)/u);

  const canonical = await request('/workspaces/medals?qa=workflow&runtime=static');
  assert.equal(canonical.status, 308);
  assert.equal(canonical.headers.get('location'), '/workspaces/medals/?qa=workflow&runtime=static');

  const runtime = await request('/assets/medals/runtime-config.js', { method: 'HEAD' });
  assert.equal(runtime.status, 200);
  assert.match(runtime.headers.get('content-type') || '', /^text\/javascript/u);

  const wasm = await request('/assets/medals/cad-kernel/replicad_single.wasm', { method: 'HEAD' });
  assert.equal(wasm.status, 200);
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.equal(wasm.headers.get('cache-control'), 'public, max-age=86400, must-revalidate');

  const stepWorker = await request('/assets/medals/cad-step-worker.js', { method: 'HEAD' });
  assert.equal(stepWorker.status, 200);
  assert.match(stepWorker.headers.get('content-security-policy') || '', /(?:^|\s)'unsafe-eval'(?:;|\s|$)/u);

  for (const privatePath of ['/missing.js', '/.git/config', '/.env', '/package.json']) {
    const response = await request(privatePath);
    assert.equal(response.status, 404, `${privatePath} must return 404`);
    assert.match(response.headers.get('content-type') || '', /^text\/html/u);
  }

  const wrongMethod = await request('/', { method: 'POST' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET, HEAD');

  console.log('Live static server smoke passed: routes, redirect, MIME, cache, CSP, 404, and private-file boundaries.');
} finally {
  server.close();
  await once(server, 'close');
}
