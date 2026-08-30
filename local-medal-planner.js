import { freemem } from 'node:os';
import {
  MEDAL_DESIGN_PLAN_SCHEMA,
  MEDAL_DESIGN_PLAN_VERSION,
  normalizeMedalDesignPlan,
  parseMedalBrief,
  validateMedalDesignPlan,
} from './concept-engine.js';

const DEFAULT_TIMEOUT_MS = 12_000;
const MIN_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 30_000;
const RESPONSE_LIMIT_BYTES = 256 * 1024;
const MIN_FREE_MEMORY_BYTES = 768 * 1024 ** 2;
const MAX_BRIEF_LENGTH = 2_000;
const MAX_MODEL_TOKENS = 1_200;
const REQUEST_FIELDS = new Set(['brief', 'manufacturing', 'preferModel']);
const MANUFACTURING_FIELDS = new Set(['nozzle', 'layerHeight', 'baseThickness', 'reliefHeight', 'maxElements']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', '::1', 'localhost']);

const PLAN_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'version', 'event', 'creative', 'manufacturing', 'palette', 'variants'],
  properties: {
    schema: { const: MEDAL_DESIGN_PLAN_SCHEMA },
    version: { const: MEDAL_DESIGN_PLAN_VERSION },
    event: {
      type: 'object', additionalProperties: false,
      required: ['title', 'subtitle', 'location', 'distance', 'date', 'year', 'edition'],
      properties: {
        title: { type: 'string', maxLength: 34 }, subtitle: { type: 'string', maxLength: 34 },
        location: { type: 'string', maxLength: 30 }, distance: { type: 'string', maxLength: 10 },
        date: { type: 'string', maxLength: 10 }, year: { type: 'integer', minimum: 2000, maximum: 2100 },
        edition: { type: 'string', maxLength: 4 },
      },
    },
    creative: {
      type: 'object', additionalProperties: false, required: ['discipline', 'motif', 'mood'],
      properties: {
        discipline: { enum: ['running', 'trail', 'cycling', 'general'] },
        motif: { enum: ['runner', 'night', 'city', 'trail', 'cycling', 'general'] },
        mood: { enum: ['bold', 'premium', 'playful', 'technical'] },
      },
    },
    manufacturing: {
      type: 'object', additionalProperties: false,
      required: ['nozzle', 'layerHeight', 'baseThickness', 'reliefHeight', 'flatBack', 'maxElements'],
      properties: {
        nozzle: { enum: [.2, .4, .6, .8] }, layerHeight: { type: 'number', minimum: .05, maximum: .5 },
        baseThickness: { type: 'number', minimum: 1.2, maximum: 8 }, reliefHeight: { type: 'number', minimum: .2, maximum: 2 },
        flatBack: { const: true }, maxElements: { type: 'integer', minimum: 12, maximum: 72 },
      },
    },
    palette: {
      type: 'object', additionalProperties: false, required: ['ids', 'roles'],
      properties: {
        ids: { type: 'array', minItems: 3, maxItems: 6, uniqueItems: true, items: { enum: ['midnight-black', 'electric-blue', 'natural-white', 'signal-lime', 'signal-red', 'glow-green', 'galaxy-purple', 'thermo-red', 'silk-gold', 'graphite-gray'] } },
        roles: {
          type: 'object', additionalProperties: false, required: ['body', 'rim', 'primary', 'accent', 'support'],
          properties: Object.fromEntries(['body', 'rim', 'primary', 'accent', 'support'].map(key => [key, { type: 'string' }])),
        },
      },
    },
    variants: {
      type: 'array', minItems: 4, maxItems: 4,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'label', 'description', 'shape', 'width', 'height', 'rimStyle', 'attachment', 'rimWidth', 'rimHeight', 'cornerRadius'],
        properties: {
          id: { type: 'string', maxLength: 32 }, label: { type: 'string', maxLength: 36 }, description: { type: 'string', maxLength: 100 },
          shape: { enum: ['circle', 'oval', 'rounded', 'hexagon', 'shield'] }, width: { type: 'number', minimum: 30, maximum: 160 }, height: { type: 'number', minimum: 30, maximum: 160 },
          rimStyle: { enum: ['classic', 'double', 'scalloped', 'faceted', 'laurel', 'wings'] },
          attachment: { enum: ['single', 'double', 'eyelet', 'slit', 'open-slit', 'none'] },
          rimWidth: { type: 'number', minimum: .6, maximum: 8 }, rimHeight: { type: 'number', minimum: .2, maximum: 4 }, cornerRadius: { type: 'number', minimum: 2, maximum: 30 },
        },
      },
    },
  },
});

export class LocalMedalPlanError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'LocalMedalPlanError';
    this.code = code;
    this.status = Number(options.status) || 500;
    this.retryable = Boolean(options.retryable);
    this.hint = options.hint;
  }
}

function cleanBrief(value) {
  if (typeof value !== 'string') throw new LocalMedalPlanError('INVALID_BRIEF', 'Describe the medal you want to create.', { status: 400 });
  const brief = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (brief.length < 3) throw new LocalMedalPlanError('INVALID_BRIEF', 'Describe the medal in a few words.', { status: 400 });
  if (brief.length > MAX_BRIEF_LENGTH) throw new LocalMedalPlanError('BRIEF_TOO_LONG', `Keep the medal description under ${MAX_BRIEF_LENGTH} characters.`, { status: 400 });
  return brief;
}

function normalizeManufacturing(value) {
  if (value === undefined) return undefined;
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new LocalMedalPlanError('INVALID_MANUFACTURING', 'Manufacturing settings must be an object.', { status: 400 });
  }
  const unknown = Object.keys(value).find(key => !MANUFACTURING_FIELDS.has(key));
  if (unknown) throw new LocalMedalPlanError('UNKNOWN_FIELD', `Unsupported manufacturing setting: ${unknown}.`, { status: 400 });
  return { ...value };
}

export function validateMedalPlanRequest(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') {
    throw new LocalMedalPlanError('INVALID_JSON', 'Medal generation settings must be a JSON object.', { status: 400 });
  }
  const unknown = Object.keys(input).find(key => !REQUEST_FIELDS.has(key));
  if (unknown) throw new LocalMedalPlanError('UNKNOWN_FIELD', `Unsupported medal generation setting: ${unknown}.`, { status: 400 });
  if (input.preferModel !== undefined && typeof input.preferModel !== 'boolean') {
    throw new LocalMedalPlanError('INVALID_PREFERENCE', 'preferModel must be true or false.', { status: 400 });
  }
  return {
    brief: cleanBrief(input.brief),
    manufacturing: normalizeManufacturing(input.manufacturing),
    preferModel: input.preferModel !== false,
  };
}

export function resolveLocalMedalPlannerConfig(env = process.env) {
  const raw = String(env.MEDALFORGE_LLM_URL || '').trim();
  const model = String(env.MEDALFORGE_LLM_MODEL || 'Qwen3 local planner').trim().replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 120) || 'Local medal planner';
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Number(env.MEDALFORGE_LLM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS));
  if (!raw) return { configured: false, url: null, model, timeoutMs };
  let url;
  try { url = new URL(raw); } catch {
    throw new LocalMedalPlanError('LOCAL_MEDAL_PLANNER_CONFIG_INVALID', 'The local medal-planner address is invalid.', { status: 503 });
  }
  if (
    url.protocol !== 'http:'
    || !LOOPBACK_HOSTS.has(url.hostname)
    || url.username
    || url.password
    || url.search
    || url.hash
    || !/^\/(?:v1\/)?chat\/completions$/u.test(url.pathname)
  ) {
    throw new LocalMedalPlanError('LOCAL_MEDAL_PLANNER_CONFIG_INVALID', 'The medal planner must use a loopback OpenAI-compatible chat endpoint.', {
      status: 503,
      hint: 'Use a local address such as http://127.0.0.1:8080/v1/chat/completions.',
    });
  }
  return { configured: true, url, model, timeoutMs };
}

function deterministicResult(request, reason = null) {
  const plan = parseMedalBrief(request.brief, { manufacturing: request.manufacturing });
  return {
    plan,
    generation: {
      provider: 'deterministic-local',
      enhanced: false,
      fallback: Boolean(reason),
      ...(reason ? { reason } : {}),
    },
  };
}

function modelSystemPrompt() {
  return [
    'You are the private local planning stage of a 3D-printable medal editor.',
    'Return only one MedalDesignPlan JSON object matching the supplied JSON schema.',
    'Extract concise event identity, choose a visually coherent motif, palette, body, rim and ribbon attachment.',
    'Do not return images, prose, Markdown, coordinates, mesh data, URLs, scripts, or the user request verbatim.',
    'Every variant must be practical for FDM printing. The back is always flat and multicolor inlay only.',
    'Prefer strong visual hierarchy, limited colors, broad negative space and intentional relief levels.',
  ].join(' ');
}

function modelRequestBody(config, request, baseline) {
  return {
    model: config.model,
    temperature: .25,
    max_tokens: MAX_MODEL_TOKENS,
    stream: false,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'medal_design_plan', strict: true, schema: PLAN_JSON_SCHEMA },
    },
    messages: [
      { role: 'system', content: modelSystemPrompt() },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Plan four polished editable medal directions.',
          brief: request.brief,
          lockedManufacturing: baseline.manufacturing,
          deterministicExtraction: baseline.event,
        }),
      },
    ],
  };
}

async function limitedJson(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > RESPONSE_LIMIT_BYTES) {
    throw new LocalMedalPlanError('LOCAL_MEDAL_PLANNER_RESPONSE_TOO_LARGE', 'The local planner returned too much data.');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body || []) {
    length += chunk.length;
    if (length > RESPONSE_LIMIT_BYTES) throw new LocalMedalPlanError('LOCAL_MEDAL_PLANNER_RESPONSE_TOO_LARGE', 'The local planner returned too much data.');
    chunks.push(chunk);
  }
  try { return length ? JSON.parse(Buffer.concat(chunks, length).toString('utf8')) : {}; } catch {
    throw new LocalMedalPlanError('LOCAL_MEDAL_PLANNER_INVALID_RESPONSE', 'The local planner returned unreadable data.');
  }
}

function contentFromResponse(body) {
  if (body?.plan && typeof body.plan === 'object' && !Array.isArray(body.plan)) return body.plan;
  const message = body?.choices?.[0]?.message;
  const toolArguments = message?.tool_calls?.[0]?.function?.arguments;
  let content = toolArguments ?? message?.content ?? body?.choices?.[0]?.text ?? body?.response;
  if (Array.isArray(content)) content = content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
  if (typeof content !== 'string' || content.length > RESPONSE_LIMIT_BYTES) {
    throw new LocalMedalPlanError('LOCAL_MEDAL_PLANNER_INVALID_RESPONSE', 'The local planner did not return a medal plan.');
  }
  const cleaned = content.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  try { return JSON.parse(cleaned); } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { /* handled below */ }
    }
    throw new LocalMedalPlanError('LOCAL_MEDAL_PLANNER_INVALID_PLAN', 'The local planner returned an invalid medal plan.');
  }
}

function safeEnhancedPlan(raw, baseline) {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') {
    throw new LocalMedalPlanError('LOCAL_MEDAL_PLANNER_INVALID_PLAN', 'The local planner returned an invalid medal plan.');
  }
  const plan = normalizeMedalDesignPlan({
    ...raw,
    schema: MEDAL_DESIGN_PLAN_SCHEMA,
    version: MEDAL_DESIGN_PLAN_VERSION,
    sourceFingerprint: baseline.sourceFingerprint,
    event: { ...baseline.event, ...(raw.event && typeof raw.event === 'object' ? raw.event : {}) },
    creative: { ...baseline.creative, ...(raw.creative && typeof raw.creative === 'object' ? raw.creative : {}) },
    manufacturing: baseline.manufacturing,
    palette: raw.palette && typeof raw.palette === 'object' ? raw.palette : baseline.palette,
    variants: Array.isArray(raw.variants) ? raw.variants : baseline.variants,
  });
  const validation = validateMedalDesignPlan(plan);
  if (!validation.valid) throw new LocalMedalPlanError('LOCAL_MEDAL_PLANNER_INVALID_PLAN', validation.errors[0] || 'The local planner returned an invalid medal plan.');
  return plan;
}

async function requestModelPlan(fetchImpl, config, request, baseline, externalSignal) {
  const controller = new AbortController();
  const abortExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortExternal();
  else externalSignal?.addEventListener?.('abort', abortExternal, { once: true });
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(modelRequestBody(config, request, baseline)),
    });
    const body = await limitedJson(response);
    if (!response.ok) throw new LocalMedalPlanError('LOCAL_MEDAL_PLANNER_REJECTED', 'The local planner could not enhance this medal.', { retryable: response.status >= 500 });
    return safeEnhancedPlan(contentFromResponse(body), baseline);
  } catch (error) {
    if (externalSignal?.aborted) throw new LocalMedalPlanError('CLIENT_CANCELLED', 'Medal generation was cancelled.', { status: 499 });
    if (error instanceof LocalMedalPlanError) throw error;
    if (error?.name === 'AbortError') throw new LocalMedalPlanError('LOCAL_MEDAL_PLANNER_TIMEOUT', 'The local planner took too long.', { retryable: true });
    throw new LocalMedalPlanError('LOCAL_MEDAL_PLANNER_OFFLINE', 'The local planner is not reachable.', { cause: error, retryable: true });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', abortExternal);
  }
}

function fallbackReason(error) {
  const allowed = new Set([
    'LOCAL_MEDAL_PLANNER_BUSY', 'LOCAL_MEDAL_PLANNER_LOW_MEMORY', 'LOCAL_MEDAL_PLANNER_TIMEOUT',
    'LOCAL_MEDAL_PLANNER_OFFLINE', 'LOCAL_MEDAL_PLANNER_REJECTED', 'LOCAL_MEDAL_PLANNER_INVALID_RESPONSE',
    'LOCAL_MEDAL_PLANNER_INVALID_PLAN', 'LOCAL_MEDAL_PLANNER_RESPONSE_TOO_LARGE', 'LOCAL_MEDAL_PLANNER_CONFIG_INVALID',
  ]);
  return allowed.has(error?.code) ? error.code : 'LOCAL_MEDAL_PLANNER_UNAVAILABLE';
}

export function createLocalMedalPlanService(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  const freeMemoryImpl = options.freeMemoryImpl || freemem;
  let config;
  let configError = null;
  try { config = options.config || resolveLocalMedalPlannerConfig(options.env || process.env); } catch (error) {
    config = { configured: false, url: null, model: 'Local medal planner', timeoutMs: DEFAULT_TIMEOUT_MS };
    configError = error;
  }
  let active = 0;

  return {
    status() {
      return {
        available: true,
        structured: true,
        modelConfigured: Boolean(config.configured && !configError),
        provider: config.configured && !configError ? 'local-openai-compatible' : 'deterministic-local',
        model: config.configured && !configError ? config.model : null,
        fallbackAlwaysAvailable: true,
        limits: { maxBriefLength: MAX_BRIEF_LENGTH, maxConcurrentModelPlans: 1, timeoutMs: config.timeoutMs },
        ...(configError ? { warning: { code: configError.code, message: configError.message } } : {}),
      };
    },

    async generate(input, optionsGenerate = {}) {
      const request = validateMedalPlanRequest(input);
      const baseline = deterministicResult(request);
      if (!request.preferModel) return baseline;
      if (configError) return deterministicResult(request, fallbackReason(configError));
      if (!config.configured || typeof fetchImpl !== 'function') return baseline;
      if (active >= 1) return deterministicResult(request, 'LOCAL_MEDAL_PLANNER_BUSY');
      if (Number(freeMemoryImpl()) < MIN_FREE_MEMORY_BYTES) return deterministicResult(request, 'LOCAL_MEDAL_PLANNER_LOW_MEMORY');
      active += 1;
      try {
        const plan = await requestModelPlan(fetchImpl, config, request, baseline.plan, optionsGenerate.signal);
        return {
          plan,
          generation: { provider: 'local-openai-compatible', model: config.model, enhanced: true, fallback: false },
        };
      } catch (error) {
        if (error?.code === 'CLIENT_CANCELLED') throw error;
        return deterministicResult(request, fallbackReason(error));
      } finally {
        active -= 1;
      }
    },
  };
}
