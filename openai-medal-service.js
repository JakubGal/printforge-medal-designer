import {
  MEDAL_DESIGN_PLAN_SCHEMA,
  MEDAL_DESIGN_PLAN_VERSION,
  normalizeMedalDesignPlan,
  validateMedalDesignPlan,
} from './concept-engine.js';

export const OPENAI_MEDAL_RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const DEFAULT_OPENAI_MEDAL_MODEL = 'gpt-5-mini';
export const DEFAULT_OPENAI_MEDAL_TIMEOUT_MS = 90_000;

const MIN_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 180_000;
const MAX_BRIEF_LENGTH = 2_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_OUTPUT_TOKENS = 5_000;
const REQUEST_FIELDS = new Set(['brief', 'nozzle', 'layerHeight', 'baseThickness', 'reliefHeight']);
const FILAMENT_IDS = [
  'midnight-black',
  'electric-blue',
  'natural-white',
  'signal-lime',
  'signal-red',
  'glow-green',
  'galaxy-purple',
  'thermo-red',
  'silk-gold',
  'graphite-gray',
];
const SHAPES = ['circle', 'oval', 'rounded', 'hexagon', 'shield'];
const RIM_STYLES = ['classic', 'double', 'scalloped', 'faceted', 'laurel', 'wings'];
const ATTACHMENTS = ['none', 'single', 'double', 'eyelet', 'slit', 'open-slit'];

/**
 * Strict Structured Outputs schema for the creative portion of MedalDesignPlan
 * v1. Stable fields such as sourceFingerprint and variant IDs are assigned by
 * the trusted normalizer instead of asking a model to invent identifiers.
 */
export const OPENAI_MEDAL_PLAN_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'version', 'event', 'creative', 'manufacturing', 'palette', 'variants'],
  properties: {
    schema: { type: 'string', const: MEDAL_DESIGN_PLAN_SCHEMA },
    version: { type: 'integer', const: MEDAL_DESIGN_PLAN_VERSION },
    event: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'subtitle', 'location', 'distance', 'date', 'year', 'edition'],
      properties: {
        title: { type: 'string', maxLength: 34 },
        subtitle: { type: 'string', maxLength: 34 },
        location: { type: 'string', maxLength: 30 },
        distance: { type: 'string', maxLength: 10 },
        date: { type: 'string', maxLength: 10 },
        year: { type: 'integer', minimum: 2000, maximum: 2100 },
        edition: { type: 'string', maxLength: 4 },
      },
    },
    creative: {
      type: 'object',
      additionalProperties: false,
      required: ['discipline', 'motif', 'mood'],
      properties: {
        discipline: { type: 'string', enum: ['running', 'trail', 'cycling', 'general'] },
        motif: { type: 'string', enum: ['runner', 'night', 'city', 'trail', 'cycling', 'general'] },
        mood: { type: 'string', enum: ['bold', 'premium', 'playful', 'technical'] },
      },
    },
    manufacturing: {
      type: 'object',
      additionalProperties: false,
      required: ['nozzle', 'layerHeight', 'baseThickness', 'reliefHeight', 'flatBack', 'maxElements'],
      properties: {
        nozzle: { type: 'number', enum: [0.2, 0.4, 0.6, 0.8] },
        layerHeight: { type: 'number', minimum: 0.05, maximum: 0.5 },
        baseThickness: { type: 'number', minimum: 1.2, maximum: 12 },
        reliefHeight: { type: 'number', minimum: 0.2, maximum: 2 },
        flatBack: { type: 'boolean', const: true },
        maxElements: { type: 'integer', minimum: 12, maximum: 72 },
      },
    },
    palette: {
      type: 'object',
      additionalProperties: false,
      required: ['ids', 'roles'],
      properties: {
        ids: {
          type: 'array',
          minItems: 3,
          maxItems: 6,
          uniqueItems: true,
          items: { type: 'string', enum: FILAMENT_IDS },
        },
        roles: {
          type: 'object',
          additionalProperties: false,
          required: ['body', 'rim', 'primary', 'accent', 'support'],
          properties: Object.fromEntries(
            ['body', 'rim', 'primary', 'accent', 'support'].map(role => [role, { type: 'string', enum: FILAMENT_IDS }]),
          ),
        },
      },
    },
    variants: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'description', 'shape', 'width', 'height', 'rimStyle', 'attachment', 'rimWidth', 'rimHeight', 'cornerRadius'],
        properties: {
          label: { type: 'string', maxLength: 36 },
          description: { type: 'string', maxLength: 100 },
          shape: { type: 'string', enum: SHAPES },
          width: { type: 'number', minimum: 30, maximum: 120 },
          height: { type: 'number', minimum: 30, maximum: 120 },
          rimStyle: { type: 'string', enum: RIM_STYLES },
          attachment: { type: 'string', enum: ATTACHMENTS },
          rimWidth: { type: 'number', minimum: 0.6, maximum: 8 },
          rimHeight: { type: 'number', minimum: 0.2, maximum: 4 },
          cornerRadius: { type: 'number', minimum: 2, maximum: 30 },
        },
      },
    },
  },
});

export class OpenAiMedalServiceError extends Error {
  constructor(status, code, message, options = {}) {
    super(message);
    this.name = 'OpenAiMedalServiceError';
    this.status = status;
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.hint = options.hint;
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeModel(value) {
  const model = String(value || DEFAULT_OPENAI_MEDAL_MODEL).trim();
  return /^[a-z0-9][a-z0-9._-]{1,80}$/iu.test(model) ? model : DEFAULT_OPENAI_MEDAL_MODEL;
}

export function resolveOpenAiMedalConfig(env = process.env) {
  const apiKey = typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : '';
  return {
    apiKey,
    configured: apiKey.length > 0,
    model: normalizeModel(env.OPENAI_MEDAL_MODEL),
    timeoutMs: Math.round(clampNumber(env.OPENAI_MEDAL_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, DEFAULT_OPENAI_MEDAL_TIMEOUT_MS)),
  };
}

function normalizeBrief(value) {
  if (typeof value !== 'string') {
    throw new OpenAiMedalServiceError(400, 'INVALID_BRIEF', 'Describe the event and the medal you want.');
  }
  const brief = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (brief.length < 3) throw new OpenAiMedalServiceError(400, 'INVALID_BRIEF', 'Describe the event in a few words first.');
  if (brief.length > MAX_BRIEF_LENGTH) {
    throw new OpenAiMedalServiceError(400, 'BRIEF_TOO_LONG', `Keep the medal description under ${MAX_BRIEF_LENGTH.toLocaleString('en-US')} characters.`);
  }
  return brief;
}

function optionalNumber(source, key, allowedOrRange) {
  if (!Object.hasOwn(source, key) || source[key] === '' || source[key] === null) return undefined;
  const value = Number(source[key]);
  const valid = Array.isArray(allowedOrRange)
    ? allowedOrRange.includes(value)
    : Number.isFinite(value) && value >= allowedOrRange.min && value <= allowedOrRange.max;
  if (!valid) throw new OpenAiMedalServiceError(400, `INVALID_${key.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}`, `Choose a valid ${key}.`);
  return value;
}

export function validateOpenAiMedalInput(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') {
    throw new OpenAiMedalServiceError(400, 'INVALID_JSON', 'The medal request must be a JSON object.');
  }
  const unknown = Object.keys(input).filter(key => !REQUEST_FIELDS.has(key));
  if (unknown.length) throw new OpenAiMedalServiceError(400, 'UNKNOWN_FIELD', `Unsupported medal setting: ${unknown[0]}.`);
  return {
    brief: normalizeBrief(input.brief),
    manufacturing: {
      nozzle: optionalNumber(input, 'nozzle', [0.2, 0.4, 0.6, 0.8]),
      layerHeight: optionalNumber(input, 'layerHeight', { min: 0.05, max: 0.5 }),
      baseThickness: optionalNumber(input, 'baseThickness', { min: 1.2, max: 12 }),
      reliefHeight: optionalNumber(input, 'reliefHeight', { min: 0.2, max: 2 }),
    },
  };
}

function medalInstructions() {
  return [
    'You are MedalForge\u2019s senior medal art director and manufacturing planner.',
    'Convert the user\u2019s event brief into exactly four polished, materially different, professional medal directions.',
    'Return only the supplied MedalDesignPlan v1 JSON schema.',
    'Prefer concise, correctly spelled event text and intentional visual hierarchy.',
    'Use a maximum of six available filament IDs. Role colors must be included in palette.ids.',
    'Every direction must be printable with the specified nozzle: use bold connected motifs, adequate negative space, no hairlines, no gradients, and no unsupported floating details.',
    'Keep the back flat. Choose practical sizes, ribbon attachments, rim treatments, and relief dimensions.',
    'Descriptions must explain the distinctive composition, not make uncheckable quality claims.',
  ].join(' ');
}

function inputText(input) {
  const overrides = Object.entries(input.manufacturing)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');
  return overrides
    ? `Event and design brief:\n${input.brief}\n\nRequired manufacturing settings (copy these exactly): ${overrides}.`
    : `Event and design brief:\n${input.brief}`;
}

export function buildOpenAiMedalRequest(config, input) {
  return {
    model: config.model,
    store: false,
    instructions: medalInstructions(),
    input: inputText(input),
    max_output_tokens: MAX_OUTPUT_TOKENS,
    text: {
      format: {
        type: 'json_schema',
        name: 'medal_design_plan_v1',
        strict: true,
        schema: OPENAI_MEDAL_PLAN_OUTPUT_SCHEMA,
      },
    },
  };
}

async function readLimitedJson(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new OpenAiMedalServiceError(502, 'OPENAI_RESPONSE_TOO_LARGE', 'The medal planner returned more data than this app accepts.');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body || []) {
    length += chunk.length;
    if (length > MAX_RESPONSE_BYTES) {
      throw new OpenAiMedalServiceError(502, 'OPENAI_RESPONSE_TOO_LARGE', 'The medal planner returned more data than this app accepts.');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8') || '{}');
  } catch {
    throw new OpenAiMedalServiceError(502, 'OPENAI_INVALID_RESPONSE', 'The medal planner returned unreadable data.');
  }
}

function outputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) return content.text;
    }
  }
  return '';
}

function sanitizedUpstreamError(response, payload) {
  if (response.status === 401 || response.status === 403) {
    return new OpenAiMedalServiceError(503, 'OPENAI_AUTH_ERROR', 'The server\u2019s OpenAI API credentials were rejected.', {
      hint: 'Ask the site operator to check OPENAI_API_KEY and API project access.',
    });
  }
  if (response.status === 429) {
    return new OpenAiMedalServiceError(429, 'OPENAI_RATE_LIMITED', 'The AI medal planner is busy or has reached its API limit. Try again shortly.', { retryable: true });
  }
  if (response.status >= 500) {
    return new OpenAiMedalServiceError(503, 'OPENAI_UNAVAILABLE', 'The AI medal planner is temporarily unavailable.', { retryable: true });
  }
  const code = typeof payload?.error?.code === 'string' ? payload.error.code.slice(0, 64) : '';
  return new OpenAiMedalServiceError(502, 'OPENAI_REJECTED', code ? `The AI medal planner rejected this request (${code}).` : 'The AI medal planner rejected this request.');
}

function normalizeUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const safe = key => Number.isInteger(value[key]) && value[key] >= 0 ? value[key] : 0;
  return {
    inputTokens: safe('input_tokens'),
    outputTokens: safe('output_tokens'),
    totalTokens: safe('total_tokens'),
  };
}

function trustedPlan(raw, input) {
  const complete = raw
    && typeof raw === 'object'
    && !Array.isArray(raw)
    && raw.schema === MEDAL_DESIGN_PLAN_SCHEMA
    && raw.version === MEDAL_DESIGN_PLAN_VERSION
    && raw.event && typeof raw.event === 'object' && !Array.isArray(raw.event)
    && raw.creative && typeof raw.creative === 'object' && !Array.isArray(raw.creative)
    && raw.manufacturing && typeof raw.manufacturing === 'object' && !Array.isArray(raw.manufacturing)
    && raw.palette && typeof raw.palette === 'object' && !Array.isArray(raw.palette)
    && Array.isArray(raw.palette.ids)
    && Array.isArray(raw.variants) && raw.variants.length === 4;
  if (!complete) {
    throw new OpenAiMedalServiceError(502, 'OPENAI_INVALID_PLAN', 'The AI returned an incomplete medal plan.');
  }
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? structuredClone(raw) : {};
  source.manufacturing = { ...(source.manufacturing || {}) };
  for (const [key, value] of Object.entries(input.manufacturing)) {
    if (value !== undefined) source.manufacturing[key] = value;
  }
  source.manufacturing.flatBack = true;
  // Stable local IDs are intentionally not model-generated.
  if (Array.isArray(source.variants)) source.variants = source.variants.map(variant => ({ ...variant, id: undefined }));
  const plan = normalizeMedalDesignPlan(source);
  const validation = validateMedalDesignPlan(plan);
  if (!validation.valid) {
    throw new OpenAiMedalServiceError(502, 'OPENAI_INVALID_PLAN', 'The AI returned a medal plan that could not be made safely.');
  }
  return plan;
}

export async function requestOpenAiMedalPlan(fetchImpl, config, input, options = {}) {
  if (!config?.configured || !config.apiKey) {
    throw new OpenAiMedalServiceError(503, 'OPENAI_MEDAL_NOT_CONFIGURED', 'AI text-to-medal is not configured on this server.', {
      hint: 'The site operator must set OPENAI_API_KEY as a protected server environment variable. ChatGPT subscriptions do not authenticate API requests.',
    });
  }
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), config.timeoutMs);
  const signals = [timeoutController.signal, options.signal].filter(Boolean);
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  let response;
  try {
    response = await fetchImpl(OPENAI_MEDAL_RESPONSES_URL, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildOpenAiMedalRequest(config, input)),
    });
  } catch (error) {
    if (options.signal?.aborted) throw new OpenAiMedalServiceError(499, 'REQUEST_CANCELLED', 'Medal generation was cancelled.');
    if (timeoutController.signal.aborted || error?.name === 'AbortError') {
      throw new OpenAiMedalServiceError(504, 'OPENAI_TIMEOUT', 'The AI medal planner did not respond in time.', { retryable: true });
    }
    throw new OpenAiMedalServiceError(503, 'OPENAI_UNREACHABLE', 'The AI medal planner could not be reached.', { retryable: true });
  } finally {
    clearTimeout(timeout);
  }

  const payload = await readLimitedJson(response);
  if (!response.ok) throw sanitizedUpstreamError(response, payload);
  const text = outputText(payload);
  if (!text) throw new OpenAiMedalServiceError(502, 'OPENAI_EMPTY_PLAN', 'The AI completed without returning a medal plan.');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new OpenAiMedalServiceError(502, 'OPENAI_INVALID_PLAN', 'The AI returned a medal plan that could not be read.');
  }
  return {
    plan: trustedPlan(raw, input),
    usage: normalizeUsage(payload.usage),
  };
}
