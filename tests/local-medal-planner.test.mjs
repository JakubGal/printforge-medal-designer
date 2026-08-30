import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLocalMedalPlanService,
  resolveLocalMedalPlannerConfig,
  validateMedalPlanRequest,
} from '../local-medal-planner.js';
import { validateMedalDesignPlan } from '../concept-engine.js';
import { createMedalForgeServer } from '../server.mjs';

const GIB = 1024 ** 3;
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen(`http://127.0.0.1:${server.address().port}`));
  });
}

function close(server) {
  return new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
}

test('local plan configuration accepts only a loopback chat-completions endpoint', () => {
  assert.equal(resolveLocalMedalPlannerConfig({}).configured, false);
  const config = resolveLocalMedalPlannerConfig({
    MEDALFORGE_LLM_URL: 'http://127.0.0.1:8080/v1/chat/completions',
    MEDALFORGE_LLM_MODEL: 'Qwen3 4B',
    MEDALFORGE_LLM_TIMEOUT_MS: '999999',
  });
  assert.equal(config.configured, true);
  assert.equal(config.url.href, 'http://127.0.0.1:8080/v1/chat/completions');
  assert.equal(config.timeoutMs, 30_000);
  assert.throws(
    () => resolveLocalMedalPlannerConfig({ MEDALFORGE_LLM_URL: 'https://example.com/v1/chat/completions' }),
    error => error.code === 'LOCAL_MEDAL_PLANNER_CONFIG_INVALID',
  );
  assert.throws(
    () => resolveLocalMedalPlannerConfig({ MEDALFORGE_LLM_URL: 'http://127.0.0.1:8080/admin' }),
    error => error.code === 'LOCAL_MEDAL_PLANNER_CONFIG_INVALID',
  );
});

test('deterministic mode always returns a constrained structured plan without loading a model', async () => {
  let fetches = 0;
  const service = createLocalMedalPlanService({
    env: {},
    fetchImpl: async () => { fetches += 1; throw new Error('must not fetch'); },
  });
  const result = await service.generate({
    brief: 'Prague night half marathon, 21 km, 5 May 2027, premium moon and city skyline',
    manufacturing: { nozzle: .6, layerHeight: .3, maxElements: 40 },
  });
  assert.equal(fetches, 0);
  assert.equal(result.generation.provider, 'deterministic-local');
  assert.equal(result.generation.enhanced, false);
  assert.equal(validateMedalDesignPlan(result.plan).valid, true);
  assert.equal(result.plan.event.location, 'Prague');
  assert.equal(result.plan.event.date, '2027-05-05');
  assert.equal(result.plan.manufacturing.nozzle, .6);
  assert.equal(result.plan.manufacturing.flatBack, true);
  assert.equal(result.plan.variants.length, 4);
});

test('local model output enhances metadata but cannot override locked print settings or inject fields', async () => {
  let requestBody;
  const service = createLocalMedalPlanService({
    config: {
      configured: true,
      url: new URL('http://127.0.0.1:8080/v1/chat/completions'),
      model: 'Qwen3 local',
      timeoutMs: 5_000,
    },
    freeMemoryImpl: () => 8 * GIB,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({
        schema: 'HostileSchema', version: 999,
        event: { title: 'LUDANICKA NIGHT CHALLENGE', location: 'Ludanice', year: 2028 },
        creative: { discipline: 'running', motif: 'night', mood: 'premium' },
        manufacturing: { nozzle: .2, layerHeight: .05, baseThickness: 99, reliefHeight: 20, flatBack: false, maxElements: 999 },
        palette: { ids: ['midnight-black', 'silk-gold', 'natural-white', 'https://evil.example'], roles: { body: 'midnight-black', rim: 'silk-gold', primary: 'natural-white', accent: 'silk-gold', support: 'midnight-black' } },
        variants: [{ id: 'night-round', label: 'Night round', description: '<script>alert(1)</script>', shape: 'circle', width: 70, height: 70, rimStyle: 'double', attachment: 'double', rimWidth: 2.4, rimHeight: .6, cornerRadius: 8 }],
        executable: 'do bad things',
      }) } }] });
    },
  });
  const result = await service.generate({
    brief: 'A premium night running challenge in Ludanice on 7 June 2028',
    manufacturing: { nozzle: .8, layerHeight: .4, baseThickness: 3, reliefHeight: .8, maxElements: 36 },
  });
  assert.equal(result.generation.provider, 'local-openai-compatible');
  assert.equal(result.generation.enhanced, true);
  assert.equal(validateMedalDesignPlan(result.plan).valid, true);
  assert.equal(result.plan.schema, 'MedalDesignPlan');
  assert.equal(result.plan.version, 1);
  assert.equal(result.plan.event.title, 'LUDANICKA NIGHT CHALLENGE');
  assert.equal(result.plan.manufacturing.nozzle, .8);
  assert.equal(result.plan.manufacturing.layerHeight, .4);
  assert.equal(result.plan.manufacturing.flatBack, true);
  assert.equal(result.plan.manufacturing.maxElements, 36);
  assert.equal(result.plan.variants.length, 4);
  assert.doesNotMatch(JSON.stringify(result.plan), /<script|evil|executable/i);
  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.max_tokens, 1_200);
  assert.equal(requestBody.response_format.type, 'json_schema');
  assert.equal(requestBody.response_format.json_schema.strict, true);
});

test('bad model responses, memory pressure, and concurrent work fall back safely', async () => {
  const malformed = createLocalMedalPlanService({
    config: { configured: true, url: new URL('http://127.0.0.1:8080/v1/chat/completions'), model: 'local', timeoutMs: 2_000 },
    freeMemoryImpl: () => 8 * GIB,
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: 'not json' } }] }),
  });
  const bad = await malformed.generate({ brief: 'A 10 km night run in Brno in 2027' });
  assert.equal(bad.generation.fallback, true);
  assert.equal(bad.generation.reason, 'LOCAL_MEDAL_PLANNER_INVALID_PLAN');
  assert.equal(validateMedalDesignPlan(bad.plan).valid, true);

  let lowMemoryFetches = 0;
  const lowMemory = createLocalMedalPlanService({
    config: { configured: true, url: new URL('http://127.0.0.1:8080/v1/chat/completions'), model: 'local', timeoutMs: 2_000 },
    freeMemoryImpl: () => 256 * 1024 ** 2,
    fetchImpl: async () => { lowMemoryFetches += 1; return jsonResponse({}); },
  });
  const guarded = await lowMemory.generate({ brief: 'A city race in Prague' });
  assert.equal(lowMemoryFetches, 0);
  assert.equal(guarded.generation.reason, 'LOCAL_MEDAL_PLANNER_LOW_MEMORY');

  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const busy = createLocalMedalPlanService({
    config: { configured: true, url: new URL('http://127.0.0.1:8080/v1/chat/completions'), model: 'local', timeoutMs: 5_000 },
    freeMemoryImpl: () => 8 * GIB,
    fetchImpl: async () => pending,
  });
  const first = busy.generate({ brief: 'A first city race in Prague' });
  const second = await busy.generate({ brief: 'A second city race in Prague' });
  assert.equal(second.generation.reason, 'LOCAL_MEDAL_PLANNER_BUSY');
  release(jsonResponse({ choices: [{ message: { content: '{}' } }] }));
  await first;
});

test('same-origin medal-plan endpoints expose one-click deterministic structured generation', async t => {
  let shutdowns = 0;
  const setupManager = {
    async getStatus() { return { supported: true, phase: 'idle' }; },
    async startSetup() { return this.getStatus(); }, cancelSetup() { return {}; }, noteAvailable() {},
    async shutdown() { shutdowns += 1; },
  };
  const app = createMedalForgeServer({ env: {}, localAiManager: setupManager });
  const origin = await listen(app);
  t.after(async () => { await close(app); assert.equal(shutdowns, 1); });

  const statusResponse = await fetch(`${origin}/api/local-ai/medal-plan/status`, { headers: { Origin: origin } });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.available, true);
  assert.equal(status.structured, true);
  assert.equal(status.fallbackAlwaysAvailable, true);

  const generated = await fetch(`${origin}/api/local-ai/medal-plan`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ brief: 'A premium 12 km night race in Vienna on 8 August 2029' }),
  });
  assert.equal(generated.status, 200);
  const payload = await generated.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.generation.provider, 'deterministic-local');
  assert.equal(validateMedalDesignPlan(payload.plan).valid, true);

  const rejected = await fetch(`${origin}/api/local-ai/medal-plan`, {
    method: 'POST',
    headers: { Origin: 'http://attacker.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ brief: 'A race medal' }),
  });
  assert.equal(rejected.status, 403);
});

test('request validation rejects oversized, unknown, and malformed settings', () => {
  assert.throws(() => validateMedalPlanRequest({ brief: 'x' }), error => error.code === 'INVALID_BRIEF');
  assert.throws(() => validateMedalPlanRequest({ brief: 'valid medal', surprise: true }), error => error.code === 'UNKNOWN_FIELD');
  assert.throws(() => validateMedalPlanRequest({ brief: 'valid medal', manufacturing: { shell: 'command' } }), error => error.code === 'UNKNOWN_FIELD');
  assert.throws(() => validateMedalPlanRequest({ brief: 'a'.repeat(2_001) }), error => error.code === 'BRIEF_TOO_LONG');
});
