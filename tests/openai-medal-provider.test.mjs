import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiMedalProvider } from '../openai-medal-provider.js';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

test('browser provider reports capabilities without accepting a browser API key', async () => {
  const provider = new OpenAiMedalProvider({ fetchImpl: async (url, init) => {
    assert.equal(url, '/api/openai-medal/status');
    assert.equal(init.credentials, 'same-origin');
    return json({
      ok: true,
      available: true,
      configured: true,
      provider: 'openai',
      model: 'gpt-test',
      capabilities: { structuredPlans: true, acceptsBrowserApiKey: false },
    });
  } });
  const status = await provider.checkStatus();
  assert.equal(status.available, true);
  assert.equal(status.supportsStructuredPlans, true);
  assert.equal(status.supportsChatGptLogin, false);
});

test('browser provider sends only the brief and public printer settings', async () => {
  let request;
  const plan = { schema: 'MedalDesignPlan', version: 1 };
  const provider = new OpenAiMedalProvider({ fetchImpl: async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return json({ ok: true, provider: 'openai', model: 'gpt-test', plan, usage: { totalTokens: 10 } });
  } });
  const result = await provider.generate({ brief: 'Night city run', nozzle: 0.4 });
  assert.equal(request.url, '/api/openai-medal/generate');
  assert.deepEqual(request.body, { brief: 'Night city run', nozzle: 0.4 });
  assert.equal(request.init.credentials, 'same-origin');
  assert.deepEqual(result.plan, plan);
  assert.equal(result.metadata.usage.totalTokens, 10);
  await assert.rejects(
    provider.generate({ brief: 'Night city run', apiKey: 'must-not-be-sent' }),
    error => error.code === 'BROWSER_API_KEY_FORBIDDEN',
  );
});

test('browser provider surfaces safe endpoint errors', async () => {
  const provider = new OpenAiMedalProvider({ fetchImpl: async () => json({
    ok: false,
    error: { code: 'OPENAI_MEDAL_NOT_CONFIGURED', message: 'Not configured.', hint: 'Ask the operator.' },
  }, 503) });
  await assert.rejects(provider.generate({ brief: 'City run' }), error => {
    assert.equal(error.code, 'OPENAI_MEDAL_NOT_CONFIGURED');
    assert.equal(error.status, 503);
    assert.equal(error.hint, 'Ask the operator.');
    return true;
  });
});
