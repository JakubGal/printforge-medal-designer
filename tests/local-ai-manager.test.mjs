import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { constants as osConstants, tmpdir } from 'node:os';
import { LOCAL_AI_MANIFEST, LocalAiManager, formatLocalAiBytes } from '../local-ai-manager.js';

test('automatic local AI manifest is pinned, HTTPS-only, and checksum-complete', () => {
  const assets = [LOCAL_AI_MANIFEST.engine.vulkan, LOCAL_AI_MANIFEST.engine.cpu, ...LOCAL_AI_MANIFEST.models];
  assert.match(LOCAL_AI_MANIFEST.id, /master-829/u);
  for (const asset of assets) {
    assert.match(asset.url, /^https:\/\//u);
    assert.doesNotMatch(asset.url, /\/latest(?:\/|$)/u);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(Number.isSafeInteger(asset.bytes) && asset.bytes > 1_000_000);
  }
  assert.equal(
    LOCAL_AI_MANIFEST.engine.vulkan.bytes + LOCAL_AI_MANIFEST.models.reduce((sum, asset) => sum + asset.bytes, 0),
    LOCAL_AI_MANIFEST.downloadBytes,
  );
  assert.match(formatLocalAiBytes(LOCAL_AI_MANIFEST.downloadBytes), /GB/u);
});

test('automatic setup refuses unsupported platforms and unsafe low-memory starts before downloading', async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => { fetchCalls += 1; throw new Error('must not download'); };
  const unsupported = new LocalAiManager({
    platform: 'darwin', arch: 'arm64', fetchImpl,
    installRoot: join(tmpdir(), 'medalforge-manager-test-unsupported'),
  });
  await assert.rejects(unsupported.startSetup(), error => error.code === 'LOCAL_AI_SETUP_UNSUPPORTED');

  const lowMemory = new LocalAiManager({
    platform: 'win32', arch: 'x64', totalMemoryBytes: 8 * 1024 ** 3, fetchImpl,
    installRoot: join(tmpdir(), 'medalforge-manager-test-low-memory'),
  });
  await assert.rejects(lowMemory.startSetup(), error => error.code === 'LOCAL_AI_MEMORY_UNSAFE');
  assert.equal(fetchCalls, 0);
});

test('engine launch permits the known-good 2 GB free case and lowers native process priority', async () => {
  const installRoot = join(tmpdir(), 'medalforge-manager-test-launch-safety');
  const child = new EventEmitter();
  child.pid = 42_424;
  child.kill = () => true;
  let priorityCall = null;
  const manager = new LocalAiManager({
    platform: 'win32',
    arch: 'x64',
    totalMemoryBytes: 32 * 1024 ** 3,
    freeMemoryImpl: () => 2 * 1024 ** 3,
    fetchImpl: async () => ({ ok: true }),
    spawnImpl: () => child,
    setPriorityImpl: (pid, priority) => { priorityCall = { pid, priority }; },
    installRoot,
  });
  manager.receipt = { executable: join(installRoot, 'engine-vulkan', 'sd-server.exe') };

  await manager.startEngine(new AbortController().signal);

  assert.equal(manager.publicStatus().ready, true);
  assert.deepEqual(priorityCall, {
    pid: child.pid,
    priority: osConstants.priority.PRIORITY_BELOW_NORMAL,
  });
  await manager.shutdown();
});

test('engine launch pauses during acute memory pressure before spawning', async () => {
  const installRoot = join(tmpdir(), 'medalforge-manager-test-memory-pressure');
  let spawnCalls = 0;
  const manager = new LocalAiManager({
    platform: 'win32',
    arch: 'x64',
    totalMemoryBytes: 32 * 1024 ** 3,
    freeMemoryImpl: () => 512 * 1024 ** 2,
    fetchImpl: async () => ({ ok: true }),
    spawnImpl: () => { spawnCalls += 1; throw new Error('must not spawn'); },
    installRoot,
  });
  manager.receipt = { executable: join(installRoot, 'engine-vulkan', 'sd-server.exe') };

  await assert.rejects(
    manager.startEngine(new AbortController().signal),
    error => error.code === 'LOCAL_AI_MEMORY_PRESSURE' && error.retryable === true,
  );
  assert.equal(spawnCalls, 0);
});

test('priority adjustment failure is non-fatal and remains diagnosable', () => {
  const manager = new LocalAiManager({
    platform: 'win32',
    arch: 'x64',
    fetchImpl: async () => ({ ok: true }),
    setPriorityImpl: () => { throw new Error('access denied'); },
    installRoot: join(tmpdir(), 'medalforge-manager-test-priority-fallback'),
  });

  assert.doesNotThrow(() => manager.lowerChildPriority({ pid: 4_242 }));
  assert.match(manager.logs.at(-1), /Could not lower local image process priority/u);
});
