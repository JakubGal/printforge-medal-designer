import { parseMedalBrief, validateMedalDesignPlan } from './concept-engine.js';

export const LOCAL_MEDAL_PLAN_ENDPOINTS = Object.freeze({
  status: '/api/local-ai/medal-plan/status',
  generate: '/api/local-ai/medal-plan',
});

const MAX_BRIEF_LENGTH = 2_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MANUFACTURING_FIELDS = new Set(['nozzle', 'layerHeight', 'baseThickness', 'reliefHeight', 'maxElements']);

export class LocalMedalProviderError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'LocalMedalProviderError';
    this.code = options.code || 'LOCAL_MEDAL_PROVIDER_ERROR';
    this.details = options.details;
  }
}

function cleanRequest(options) {
  const brief = typeof options?.brief === 'string' ? options.brief.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim() : '';
  if (brief.length < 3) throw new LocalMedalProviderError('Describe the medal in a few words.', { code: 'INVALID_BRIEF' });
  if (brief.length > MAX_BRIEF_LENGTH) throw new LocalMedalProviderError(`Keep the medal description under ${MAX_BRIEF_LENGTH} characters.`, { code: 'BRIEF_TOO_LONG' });
  let manufacturing;
  if (options.manufacturing !== undefined) {
    if (!options.manufacturing || Array.isArray(options.manufacturing) || typeof options.manufacturing !== 'object') {
      throw new LocalMedalProviderError('Manufacturing settings must be an object.', { code: 'INVALID_MANUFACTURING' });
    }
    const unknown = Object.keys(options.manufacturing).find(key => !MANUFACTURING_FIELDS.has(key));
    if (unknown) throw new LocalMedalProviderError(`Unsupported manufacturing setting: ${unknown}.`, { code: 'UNKNOWN_FIELD' });
    manufacturing = Object.fromEntries(Object.entries(options.manufacturing).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)));
  }
  return {
    brief,
    ...(manufacturing ? { manufacturing } : {}),
    preferModel: options.preferModel !== false,
  };
}

function deterministic(request, reason) {
  return {
    plan: parseMedalBrief(request.brief, { manufacturing: request.manufacturing }),
    metadata: { provider: 'deterministic-local', enhanced: false, fallback: Boolean(reason), ...(reason ? { reason } : {}) },
  };
}

function abortError(reason) {
  const error = new DOMException(typeof reason === 'string' ? reason : 'Medal generation was cancelled.', 'AbortError');
  return error;
}

async function boundedJson(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new LocalMedalProviderError('The medal planner returned too much data.', { code: 'RESPONSE_TOO_LARGE' });
  let text = '';
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new LocalMedalProviderError('The medal planner returned too much data.', { code: 'RESPONSE_TOO_LARGE' });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } else {
    text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new LocalMedalProviderError('The medal planner returned too much data.', { code: 'RESPONSE_TOO_LARGE' });
  }
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { throw new LocalMedalProviderError('The medal planner returned unreadable data.', { code: 'INVALID_RESPONSE' }); }
  if (!response.ok) {
    throw new LocalMedalProviderError(body?.error?.message || 'The medal planner could not complete the request.', {
      code: body?.error?.code || 'REQUEST_FAILED', details: body,
    });
  }
  return body;
}

export class LocalMedalPlanProvider {
  constructor(options = {}) {
    if (typeof options.fetchImpl !== 'function' && typeof globalThis.fetch !== 'function') {
      throw new LocalMedalProviderError('This browser does not provide Fetch.', { code: 'FETCH_UNAVAILABLE' });
    }
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
    this.timeoutMs = Math.max(2_000, Number(options.timeoutMs) || 20_000);
  }

  async checkStatus(options = {}) {
    const response = await this.fetchImpl(LOCAL_MEDAL_PLAN_ENDPOINTS.status, {
      method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: options.signal,
    });
    return boundedJson(response);
  }

  async generate(options = {}) {
    const request = cleanRequest(options);
    if (options.signal?.aborted) throw abortError(options.signal.reason);
    options.onProgress?.({ phase: 'plan', progress: 0, message: 'Planning a polished printable medal…' });
    const controller = new AbortController();
    const abortExternal = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener?.('abort', abortExternal, { once: true });
    const timer = setTimeout(() => controller.abort('deadline'), this.timeoutMs);
    try {
      const response = await this.fetchImpl(LOCAL_MEDAL_PLAN_ENDPOINTS.generate, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify(request),
      });
      const payload = await boundedJson(response);
      const validation = validateMedalDesignPlan(payload.plan);
      if (!validation.valid) throw new LocalMedalProviderError('The medal planner returned an unsafe design.', { code: 'INVALID_PLAN', details: validation });
      const result = { plan: payload.plan, metadata: payload.generation || { provider: 'deterministic-local', enhanced: false } };
      options.onProgress?.({ phase: 'plan', progress: 1, message: result.metadata.enhanced ? 'Locally enhanced medal plan ready.' : 'Printable medal plan ready.' });
      return result;
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal.reason);
      const fallback = deterministic(request, error?.code || (controller.signal.aborted ? 'LOCAL_MEDAL_PLANNER_TIMEOUT' : 'LOCAL_MEDAL_PLANNER_UNREACHABLE'));
      options.onProgress?.({ phase: 'plan', progress: 1, message: 'Printable offline medal plan ready.' });
      return fallback;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener?.('abort', abortExternal);
    }
  }
}
