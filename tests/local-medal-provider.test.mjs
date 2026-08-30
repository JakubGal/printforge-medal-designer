import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalMedalPlanProvider } from '../local-medal-provider.js';
import { parseMedalBrief, validateMedalDesignPlan } from '../concept-engine.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

test('browser provider sends one bounded request and accepts a structured plan', async () => {
  const plan = parseMedalBrief('A premium 21 km night race in Prague on 5 May 2027');
  const calls = [];
  const provider = new LocalMedalPlanProvider({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return json({ ok: true, plan, generation: { provider: 'local-openai-compatible', model: 'Qwen3', enhanced: true, fallback: false } });
    },
  });
  const progress = [];
  const result = await provider.generate({
    brief: 'A premium 21 km night race in Prague on 5 May 2027',
    manufacturing: { nozzle: .4 },
    onProgress: update => progress.push(update),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/local-ai/medal-plan');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    brief: 'A premium 21 km night race in Prague on 5 May 2027', manufacturing: { nozzle: .4 }, preferModel: true,
  });
  assert.equal(result.metadata.enhanced, true);
  assert.equal(validateMedalDesignPlan(result.plan).valid, true);
  assert.equal(progress.at(-1).progress, 1);
});

test('browser provider degrades to deterministic generation when endpoint is unavailable or unsafe', async () => {
  const offline = new LocalMedalPlanProvider({ fetchImpl: async () => { throw new TypeError('offline'); } });
  const result = await offline.generate({ brief: 'A 10 km night run in Brno on 3 June 2028' });
  assert.equal(result.metadata.provider, 'deterministic-local');
  assert.equal(result.metadata.fallback, true);
  assert.equal(validateMedalDesignPlan(result.plan).valid, true);
  assert.equal(result.plan.event.location, 'Brno');

  const invalid = new LocalMedalPlanProvider({ fetchImpl: async () => json({ ok: true, plan: { arbitrary: 'mesh' } }) });
  const safe = await invalid.generate({ brief: 'A trail race near Tatry' });
  assert.equal(safe.metadata.fallback, true);
  assert.equal(validateMedalDesignPlan(safe.plan).valid, true);
});

test('browser provider validates before fetching and honors cancellation', async () => {
  let calls = 0;
  const provider = new LocalMedalPlanProvider({ fetchImpl: async () => { calls += 1; return json({}); } });
  await assert.rejects(provider.generate({ brief: 'x' }), error => error.code === 'INVALID_BRIEF');
  await assert.rejects(provider.generate({ brief: 'A valid race medal', manufacturing: { command: 'run' } }), error => error.code === 'UNKNOWN_FIELD');
  assert.equal(calls, 0);

  const controller = new AbortController();
  controller.abort('stop');
  await assert.rejects(provider.generate({ brief: 'A valid race medal', signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(calls, 0);
});
