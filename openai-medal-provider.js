export const OPENAI_MEDAL_ENDPOINTS = Object.freeze({
  status: '/api/openai-medal/status',
  generate: '/api/openai-medal/generate',
});

const MAX_BRIEF_LENGTH = 2_000;
const REQUEST_FIELDS = ['nozzle', 'layerHeight', 'baseThickness', 'reliefHeight'];

export class OpenAiMedalProviderError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OpenAiMedalProviderError';
    this.code = options.code || 'OPENAI_MEDAL_ERROR';
    this.status = Number(options.status) || 0;
    this.retryable = Boolean(options.retryable);
    this.hint = options.hint || '';
  }
}

function normalizedRequest(options = {}) {
  if (Object.hasOwn(options, 'apiKey')) {
    throw new OpenAiMedalProviderError('API keys are accepted only by the MedalForge server, never by browser code.', {
      code: 'BROWSER_API_KEY_FORBIDDEN',
    });
  }
  const brief = String(options.brief || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (brief.length < 3) throw new OpenAiMedalProviderError('Describe the event and medal first.', { code: 'INVALID_BRIEF' });
  if (brief.length > MAX_BRIEF_LENGTH) {
    throw new OpenAiMedalProviderError(`Keep the medal description under ${MAX_BRIEF_LENGTH.toLocaleString('en-US')} characters.`, { code: 'BRIEF_TOO_LONG' });
  }
  const request = { brief };
  for (const field of REQUEST_FIELDS) {
    if (options[field] !== undefined && options[field] !== null && options[field] !== '') request[field] = options[field];
  }
  return request;
}

async function jsonResponse(response, label) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new OpenAiMedalProviderError(`${label} returned unreadable data.`, {
      code: 'OPENAI_MEDAL_INVALID_RESPONSE',
      status: response.status,
    });
  }
  if (!response.ok || payload?.ok === false) {
    throw new OpenAiMedalProviderError(payload?.error?.message || `${label} failed.`, {
      code: payload?.error?.code || 'OPENAI_MEDAL_REQUEST_FAILED',
      status: response.status,
      retryable: payload?.error?.retryable,
      hint: payload?.error?.hint,
    });
  }
  return payload;
}

async function request(fetchImpl, url, options, label) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    if (options.signal?.aborted || error?.name === 'AbortError') throw error;
    throw new OpenAiMedalProviderError(`${label} could not be reached.`, {
      code: 'OPENAI_MEDAL_UNREACHABLE',
      retryable: true,
      cause: error,
    });
  }
  return jsonResponse(response, label);
}

/** Browser adapter for the server-owned OpenAI provider. It never accepts, reads,
 * stores, or transmits an API key from browser code. */
export class OpenAiMedalProvider {
  constructor(options = {}) {
    if (typeof options.fetchImpl !== 'function' && typeof globalThis.fetch !== 'function') {
      throw new OpenAiMedalProviderError('This browser does not provide Fetch.', { code: 'OPENAI_MEDAL_FETCH_UNAVAILABLE' });
    }
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
  }

  async checkStatus(options = {}) {
    const payload = await request(this.fetchImpl, OPENAI_MEDAL_ENDPOINTS.status, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal: options.signal,
    }, 'AI medal planner status');
    return {
      ...payload,
      available: Boolean(payload.available && payload.configured),
      configured: Boolean(payload.configured),
      supportsStructuredPlans: Boolean(payload.capabilities?.structuredPlans),
      supportsChatGptLogin: false,
    };
  }

  async generate(options = {}) {
    const payload = await request(this.fetchImpl, OPENAI_MEDAL_ENDPOINTS.generate, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      signal: options.signal,
      body: JSON.stringify(normalizedRequest(options)),
    }, 'AI medal generation');
    if (!payload.plan || typeof payload.plan !== 'object' || Array.isArray(payload.plan)) {
      throw new OpenAiMedalProviderError('AI medal generation returned no editable plan.', { code: 'OPENAI_MEDAL_INVALID_RESPONSE' });
    }
    return {
      plan: payload.plan,
      metadata: {
        provider: payload.provider || 'openai',
        model: payload.model || null,
        usage: payload.usage || null,
      },
    };
  }
}
