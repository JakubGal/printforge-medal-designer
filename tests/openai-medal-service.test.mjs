import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENAI_MEDAL_PLAN_OUTPUT_SCHEMA,
  OPENAI_MEDAL_RESPONSES_URL,
  buildOpenAiMedalRequest,
  requestOpenAiMedalPlan,
  resolveOpenAiMedalConfig,
  validateOpenAiMedalInput,
} from '../openai-medal-service.js';
import { validateMedalDesignPlan } from '../concept-engine.js';
import { createMedalForgeServer } from '../server.mjs';

const TEST_KEY = 'sk-test-server-only-medal-key';

function rawPlan() {
  const variants = [
    ['Moonlit round', 'Large crescent framing an energetic runner and clear event hierarchy.', 'circle', 68, 68, 'double', 'double'],
    ['Urban shield', 'A strong city axis and compact runner lockup with a practical eyelet.', 'shield', 64, 72, 'faceted', 'eyelet'],
    ['Laurel edition', 'Centered premium event identity framed by open printable laurel arcs.', 'rounded', 66, 68, 'laurel', 'slit'],
    ['Panorama finish', 'A wide skyline, course sweep, and side-weighted victory composition.', 'oval', 74, 62, 'wings', 'open-slit'],
  ].map(([label, description, shape, width, height, rimStyle, attachment]) => ({
    label, description, shape, width, height, rimStyle, attachment,
    rimWidth: 2.4, rimHeight: 0.6, cornerRadius: 8,
  }));
  return {
    schema: 'MedalDesignPlan',
    version: 1,
    event: {
      title: 'PRAGUE MIDNIGHT RUN', subtitle: 'CITY SERIES', location: 'Prague', distance: '10K', date: '2027-05-05', year: 2027, edition: '11',
    },
    creative: { discipline: 'running', motif: 'night', mood: 'premium' },
    manufacturing: { nozzle: 0.4, layerHeight: 0.2, baseThickness: 2.4, reliefHeight: 0.6, flatBack: true, maxElements: 64 },
    palette: {
      ids: ['midnight-black', 'silk-gold', 'natural-white', 'graphite-gray'],
      roles: { body: 'midnight-black', rim: 'silk-gold', primary: 'natural-white', accent: 'silk-gold', support: 'graphite-gray' },
    },
    variants,
  };
}

function responseWithPlan(plan = rawPlan()) {
  return new Response(JSON.stringify({
    id: 'resp_test',
    output_text: JSON.stringify(plan),
    usage: { input_tokens: 150, output_tokens: 700, total_tokens: 850, private: TEST_KEY },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('input validation is narrow and preserves explicit manufacturing requirements', () => {
  assert.deepEqual(validateOpenAiMedalInput({ brief: ' Prague night run ', nozzle: 0.6, layerHeight: 0.25 }), {
    brief: 'Prague night run',
    manufacturing: { nozzle: 0.6, layerHeight: 0.25, baseThickness: undefined, reliefHeight: undefined },
  });
  assert.throws(() => validateOpenAiMedalInput({ brief: 'run', apiKey: TEST_KEY }), error => error.code === 'UNKNOWN_FIELD');
  assert.throws(() => validateOpenAiMedalInput({ brief: 'run', nozzle: 0.5 }), error => error.code === 'INVALID_NOZZLE');
});

test('Responses request uses strict MedalDesignPlan structured output', () => {
  const config = resolveOpenAiMedalConfig({ OPENAI_API_KEY: TEST_KEY, OPENAI_MEDAL_MODEL: 'gpt-test-medal' });
  const input = validateOpenAiMedalInput({ brief: 'Premium Prague night race', nozzle: 0.4 });
  const request = buildOpenAiMedalRequest(config, input);
  assert.equal(request.model, 'gpt-test-medal');
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema, OPENAI_MEDAL_PLAN_OUTPUT_SCHEMA);
  assert.equal(request.text.format.schema.properties.schema.const, 'MedalDesignPlan');
  assert.equal(request.text.format.schema.properties.variants.minItems, 4);
  assert.match(request.input, /nozzle: 0\.4/);
  assert.doesNotMatch(JSON.stringify(request), new RegExp(TEST_KEY));
});

test('server-side request keeps the key in Authorization and returns only a normalized valid plan', async () => {
  let upstream;
  const config = resolveOpenAiMedalConfig({ OPENAI_API_KEY: TEST_KEY, OPENAI_MEDAL_MODEL: 'gpt-test-medal' });
  const input = validateOpenAiMedalInput({ brief: 'Prague night race', nozzle: 0.8, reliefHeight: 1.2 });
  const result = await requestOpenAiMedalPlan(async (url, init) => {
    upstream = { url, init, body: JSON.parse(init.body) };
    return responseWithPlan();
  }, config, input);

  assert.equal(upstream.url, OPENAI_MEDAL_RESPONSES_URL);
  assert.equal(upstream.init.headers.Authorization, `Bearer ${TEST_KEY}`);
  assert.equal(upstream.body.text.format.type, 'json_schema');
  assert.equal(validateMedalDesignPlan(result.plan).valid, true);
  assert.equal(result.plan.manufacturing.nozzle, 0.8);
  assert.equal(result.plan.manufacturing.reliefHeight, 1.2);
  assert.equal(result.plan.manufacturing.flatBack, true);
  assert.deepEqual(result.plan.variants.map(variant => variant.id), ['signature-round', 'kinetic-shield', 'laurel-crest', 'panorama-oval']);
  assert.deepEqual(result.usage, { inputTokens: 150, outputTokens: 700, totalTokens: 850 });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TEST_KEY));
});

test('status is UX-ready and explicitly distinguishes ChatGPT subscriptions from API auth', async t => {
  let calls = 0;
  const server = createMedalForgeServer({
    env: { OPENAI_API_KEY: TEST_KEY, OPENAI_MEDAL_MODEL: 'gpt-test-medal' },
    fetchImpl: async () => { calls += 1; throw new Error('status must not call upstream'); },
  });
  const origin = await listen(server);
  t.after(() => close(server));
  const response = await fetch(`${origin}/api/openai-medal/status`, { headers: { Origin: origin } });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, new RegExp(TEST_KEY));
  const status = JSON.parse(text);
  assert.equal(status.available, true);
  assert.equal(status.capabilities.structuredPlans, true);
  assert.equal(status.capabilities.acceptsBrowserApiKey, false);
  assert.equal(status.authentication.chatGptSubscriptionSupported, false);
  assert.equal(status.authentication.apiBillingRequired, true);
  assert.equal(calls, 0);
});

test('generation endpoint returns a normalized plan and never exposes server credentials', async t => {
  let authorization = '';
  const server = createMedalForgeServer({
    env: { OPENAI_API_KEY: TEST_KEY, OPENAI_MEDAL_MODEL: 'gpt-test-medal' },
    fetchImpl: async (_url, init) => {
      authorization = init.headers.Authorization;
      return responseWithPlan();
    },
  });
  const origin = await listen(server);
  t.after(() => close(server));
  const response = await fetch(`${origin}/api/openai-medal/generate`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ brief: 'Prague night run', nozzle: 0.6 }),
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, new RegExp(TEST_KEY));
  const payload = JSON.parse(text);
  assert.equal(payload.ok, true);
  assert.equal(payload.plan.manufacturing.nozzle, 0.6);
  assert.equal(validateMedalDesignPlan(payload.plan).valid, true);
  assert.equal(authorization, `Bearer ${TEST_KEY}`);
});

test('missing configuration and cross-origin requests fail before paid upstream work', async t => {
  let calls = 0;
  const server = createMedalForgeServer({ env: {}, fetchImpl: async () => { calls += 1; return responseWithPlan(); } });
  const origin = await listen(server);
  t.after(() => close(server));

  const missing = await fetch(`${origin}/api/openai-medal/generate`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ brief: 'A city run' }),
  });
  assert.equal(missing.status, 503);
  const missingText = await missing.text();
  assert.equal(JSON.parse(missingText).error.code, 'OPENAI_MEDAL_NOT_CONFIGURED');
  assert.match(missingText, /ChatGPT subscriptions do not authenticate API requests/);

  const crossOrigin = await fetch(`${origin}/api/openai-medal/generate`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ brief: 'A city run' }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(calls, 0);
});

test('upstream authentication errors are sanitized', async () => {
  const config = resolveOpenAiMedalConfig({ OPENAI_API_KEY: TEST_KEY });
  const input = validateOpenAiMedalInput({ brief: 'Night run' });
  await assert.rejects(
    requestOpenAiMedalPlan(async () => new Response(JSON.stringify({ error: { message: `leaked ${TEST_KEY}` } }), { status: 401 }), config, input),
    error => error.code === 'OPENAI_AUTH_ERROR' && !error.message.includes(TEST_KEY),
  );
});

test('an incomplete structured payload is rejected instead of silently becoming a generic medal', async () => {
  const config = resolveOpenAiMedalConfig({ OPENAI_API_KEY: TEST_KEY });
  const input = validateOpenAiMedalInput({ brief: 'Night run' });
  await assert.rejects(
    requestOpenAiMedalPlan(async () => responseWithPlan({ schema: 'MedalDesignPlan', version: 1 }), config, input),
    error => error.code === 'OPENAI_INVALID_PLAN',
  );
});
