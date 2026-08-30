import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const output = join(root, 'public');

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function assertInsideOutput(target, message) {
  const fromOutput = relative(output, target);
  assert.ok(fromOutput === '' || (!fromOutput.startsWith('..') && !isAbsolute(fromOutput)), message);
}

async function assertLocalReferences(htmlFile) {
  const html = await readFile(htmlFile, 'utf8');
  const references = [...html.matchAll(/(?:href|src)="([^"#]+)"/gu)].map(match => match[1]);
  for (const reference of references) {
    if (/^(?:https?:|mailto:|data:)/u.test(reference)) continue;
    const clean = reference.split(/[?#]/u)[0];
    const target = resolve(dirname(htmlFile), clean || '.');
    assertInsideOutput(target, `${reference} from ${htmlFile} must not escape public/`);
    assert.equal(await exists(target), true, `${reference} from ${htmlFile} must resolve inside the static release`);
  }
}

const visitedModules = new Set();
async function assertModuleGraph(moduleFile) {
  const normalized = resolve(moduleFile);
  if (visitedModules.has(normalized)) return;
  visitedModules.add(normalized);
  assert.equal(await exists(normalized), true, `module ${normalized} must exist`);
  const source = await readFile(normalized, 'utf8');
  const references = new Set([
    ...[...source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/gu)].map(match => match[1]),
    ...[...source.matchAll(/new\s+URL\(\s*['"](\.[^'"]+)['"]\s*,\s*(?:import\.meta\.url|self\.location\.href)/gu)].map(match => match[1]),
  ]);
  for (const reference of references) {
    const target = resolve(dirname(normalized), reference.split(/[?#]/u)[0]);
    assertInsideOutput(target, `${reference} from ${normalized} must not escape public/`);
    assert.equal(await exists(target), true, `${reference} from ${normalized} must exist`);
    if (target.endsWith('.js')) await assertModuleGraph(target);
  }
}

const hub = join(output, 'index.html');
const medal = join(output, 'workspaces', 'medals', 'index.html');
const notFound = join(output, '404.html');
const wasm = join(output, 'assets', 'medals', 'cad-kernel', 'replicad_single.wasm');

assert.equal(await exists(hub), true, 'workspace hub must be emitted');
assert.equal(await exists(medal), true, 'medal workspace must be emitted');
assert.equal(await exists(notFound), true, 'a physical 404 page must disable Cloudflare SPA fallback');
assert.match(await readFile(hub, 'utf8'), /PrintForge/u);
assert.match(await readFile(medal, 'utf8'), /MedalForge/u);
assert.match(await readFile(notFound, 'utf8'), /PrintForge · 404/u);
await assertLocalReferences(hub);
await assertLocalReferences(medal);
await assertModuleGraph(join(output, 'workspace-hub.js'));
await assertModuleGraph(join(output, 'assets', 'medals', 'app.js'));
const registryUrl = `${pathToFileURL(join(output, 'workspace-registry.js')).href}?release=${Date.now()}`;
const { WORKSPACES } = await import(registryUrl);
for (const workspace of WORKSPACES.filter(item => item.status === 'ready')) {
  assert.equal(typeof workspace.href, 'string', `ready workspace ${workspace.id} must declare a route`);
  const route = resolve(output, workspace.href.split(/[?#]/u)[0]);
  assertInsideOutput(route, `ready workspace ${workspace.id} route must stay inside public/`);
  const entry = workspace.href.endsWith('/') ? join(route, 'index.html') : route;
  assert.equal(await exists(entry), true, `ready workspace ${workspace.id} must emit ${entry}`);
}
const wasmBytes = (await stat(wasm)).size;
assert.ok(wasmBytes > 20_000_000, 'full local OpenCascade kernel must be present');
assert.ok(wasmBytes < 25 * 1024 * 1024, 'OpenCascade kernel must remain below Cloudflare Pages\' 25 MiB file limit');
assert.equal(await exists(join(output, '.nojekyll')), true, 'GitHub Pages must bypass Jekyll processing');
assert.equal(await exists(join(output, '.env')), false, 'local secrets must never enter the static artifact');
assert.equal(await exists(join(output, 'package.json')), false, 'repository metadata must never enter the static artifact');
assert.equal(await exists(join(output, '.git')), false, 'Git metadata must never enter the static artifact');
const headers = await readFile(join(output, '_headers'), 'utf8');
assert.match(headers, /Referrer-Policy:\s*no-referrer/u);
assert.match(headers, /X-Content-Type-Options:\s*nosniff/u);
assert.match(headers, /X-Frame-Options:\s*SAMEORIGIN/u);
assert.match(headers, /^\/\s*[\s\S]*?Content-Security-Policy:/mu);
assert.match(headers, /^\/workspaces\/medals\/\*\s*[\s\S]*?Content-Security-Policy:/mu);
assert.match(headers, /cad-step-worker\.js[\s\S]*unsafe-eval/u);
assert.doesNotMatch(headers.split(/\r?\n\r?\n/u)[0], /Content-Security-Policy/u, 'the broad Cloudflare rule must not add a second CSP to the STEP worker');

console.log('Static release verified: hub, medal workspace, assets, worker policy, and repository boundary are intact.');
