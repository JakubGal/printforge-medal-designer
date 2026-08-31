import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LocalAiManager, LocalAiSetupError } from './local-ai-manager.js';
import { LocalMedalPlanError, createLocalMedalPlanService } from './local-medal-planner.js';
import {
  OpenAiMedalServiceError,
  requestOpenAiMedalPlan,
  resolveOpenAiMedalConfig,
  validateOpenAiMedalInput,
} from './openai-medal-service.js';

const DEFAULT_PORT = 4173;
const DEFAULT_SD_URL = 'http://127.0.0.1:1234';
const JSON_REQUEST_LIMIT = 16 * 1024;
const STATUS_RESPONSE_LIMIT = 256 * 1024;
const GENERATION_RESPONSE_LIMIT = 64 * 1024 * 1024;
const STATUS_TIMEOUT_MS = 3_000;
const UPSTREAM_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_JOB_TIMEOUT_MS = 10 * 60_000;
const MIN_JOB_TIMEOUT_MS = 60_000;
const MAX_JOB_TIMEOUT_MS = 15 * 60_000;
const POLL_INTERVAL_MS = 1_000;
const JOB_TTL_MS = 15 * 60_000;
const MAX_PENDING_JOBS = 4;
const MAX_RETAINED_JOBS = 8;
const MAX_IMAGE_BASE64_LENGTH = 8 * 1024 * 1024;
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const OPENAI_IMAGE_MODEL = 'gpt-image-2';
const OPENAI_IMAGE_TIMEOUT_MS = 3 * 60_000;
const OPENAI_IMAGE_RESPONSE_LIMIT = 64 * 1024 * 1024;
const MAX_OPENAI_IMAGE_BASE64_LENGTH = 16 * 1024 * 1024;
const MAX_CONCURRENT_OPENAI_GENERATIONS = 2;
const MAX_CONCURRENT_OPENAI_MEDAL_PLANS = 2;
const OPENAI_IMAGE_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024']);
const OPENAI_IMAGE_QUALITIES = new Set(['low', 'medium', 'high']);
const CLOUD_IMAGE_FIELDS = new Set(['prompt', 'count', 'n', 'size', 'quality']);
const LOCAL_IMAGE_FIELDS = new Set(['prompt', 'brief', 'style', 'colors', 'nozzleMm', 'palette', 'seed', 'size', 'quality', 'count', 'mode']);
const LOCAL_IMAGE_STEPS = Object.freeze({ low: 4, medium: 6, high: 8 });
const LOCAL_IMAGE_SIZE_DIMENSIONS = Object.freeze({
  '1024x1024': [1024, 1024],
  '1024x1536': [1024, 1536],
  '1536x1024': [1536, 1024],
});
const LOCAL_CONCEPT_NEGATIVE_PROMPT = 'watermark, signature, logo overlay, gibberish text, accidental lettering, cropped subject, out of frame, low resolution, pixelated, blocky, jagged edges, malformed anatomy, duplicate subject, compression artifacts';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.vtt': 'text/vtt; charset=utf-8',
  '.wasm': 'application/wasm',
};

const commonHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
};

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

// OpenCascade's generated Embind layer compiles tiny argument marshalling
// functions at runtime. Grant that capability only to the isolated STEP
// worker; the editor document itself keeps the stricter policy above.
const stepWorkerContentSecurityPolicy = contentSecurityPolicy.replace(
  "script-src 'self' 'wasm-unsafe-eval'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
);

const STYLE_PROMPTS = {
  emblem: 'a centered professional vector emblem with smooth Bézier-like contours, bold readable masses, and intentional negative space',
  silhouette: 'a centered connected silhouette with smooth anatomical contours, a strong outer profile, and only purposeful internal cutouts',
  'line-art': 'centered thick monoline vector artwork made from closed continuous contours, with no hairlines or loose fragments',
  relief: 'a centered layered relief illustration using a few clearly separated flat height regions and smooth closed boundaries',
};

const FIXED_NEGATIVE_PROMPT = [
  'text', 'letters', 'words', 'numbers', 'date', 'caption', 'typography',
  'watermark', 'signature', 'QR code', 'barcode', 'photorealistic', 'photo',
  'gradient', 'shading', 'shadow', 'glow', 'transparent blur', 'dithering',
  'halftone', 'noise', 'texture', 'hairline', 'thin disconnected details',
  'floating fragments', 'open contours', 'low polygon', 'pixelated', 'jagged edges',
  'mockup', 'medal rim', 'ribbon', 'background scene',
].join(', ');

class HttpError extends Error {
  constructor(status, code, message, options = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.hint = options.hint;
  }
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function normalizeBrief(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_BRIEF', 'Describe the artwork you want to generate.');
  const brief = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (brief.length < 3) throw new HttpError(400, 'INVALID_BRIEF', 'The artwork description is too short.');
  if (brief.length > 800) throw new HttpError(400, 'BRIEF_TOO_LONG', 'Keep the artwork description under 800 characters.');
  return brief;
}

function artworkSubjectFromBrief(brief) {
  const lower = brief.toLocaleLowerCase('en-US');
  const motifs = [];
  if (/\b(?:trail|mountain|hike|ultra)\w*/u.test(lower)) motifs.push('a dynamic trail runner, mountain ridgeline, and flowing route contour');
  else if (/\b(?:run|runner|running|race|marathon|10k|5k)\w*/u.test(lower)) motifs.push('a dynamic anatomically clean runner in mid-stride, a sweeping course line, and finish-line energy');
  if (/\b(?:cycl|bike|bicycle)\w*/u.test(lower)) motifs.push('a streamlined cyclist and a sweeping road curve');
  if (/\b(?:swim|triathlon)\w*/u.test(lower)) motifs.push('a swimmer, rhythmic water lines, and balanced endurance-sport motion');
  if (/\b(?:night|moon|evening)\w*/u.test(lower)) motifs.push('a crescent moon and a compact night-sky motif');
  if (/\b(?:city|urban|prague|praha|bratislava|castle|skyline)\w*/u.test(lower)) motifs.push('a simplified architectural skyline');
  if (/\b(?:forest|tree|nature)\w*/u.test(lower)) motifs.push('bold leaf and forest silhouettes');

  let cleaned = brief
    .replace(/["'`“”„]/gu, ' ')
    .replace(/\b(?:please\s+)?(?:make|create|design|generate)(?:\s+me|\s+us)?\s+(?:an?\s+)?(?:3d[- ]printable\s+)?medal(?:\s+design)?(?:\s+for)?\b/giu, ' ')
    .replace(/\bthis\s+(?:event\s+)?(?:will\s+)?(?:be|happen|take\s+place)(?:\s+on|\s+at)?\b[^.!?]*/giu, ' ')
    .replace(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/gu, ' ')
    .replace(/\b(?:19|20)\d{2}\b/gu, ' ')
    .replace(/\b(?:write|spell|caption|typography|text|lettering|words?|saying|reading)\b[^,.!?;]*/giu, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\b(?!\s*(?:km|kilomet(?:er|re)s?|mile)s?\b)/giu, ' ')
    .replace(/[<>\[\]{}|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '')
    .trim();

  if (!cleaned || /^(?:my\s+)?(?:run|race|event|competition)$/iu.test(cleaned)) cleaned = 'an energetic community sporting event';
  if (cleaned.length > 220) cleaned = `${cleaned.slice(0, 217).trim()}…`;
  const uniqueMotifs = [...new Set(motifs)];
  return uniqueMotifs.length ? `${cleaned}; visualize ${uniqueMotifs.join('; ')}` : cleaned;
}

function normalizePalette(value, colors) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter(color => typeof color === 'string' && /^#[0-9a-f]{6}$/iu.test(color.trim()))
    .map(color => color.trim().toUpperCase()))]
    .slice(0, colors);
}

export function compileArtworkPrompt(input = {}) {
  const brief = normalizeBrief(input.brief);
  const style = Object.hasOwn(STYLE_PROMPTS, input.style) ? input.style : 'emblem';
  const colors = clampInteger(input.colors, 1, 8, 4);
  const requestedNozzle = Number(input.nozzleMm);
  const nozzleMm = [.2, .4, .6, .8].includes(requestedNozzle) ? requestedNozzle : .4;
  const oneLineMm = Number((nozzleMm * 1.125).toFixed(3));
  const robustMm = Number((oneLineMm * 2).toFixed(3));
  const palette = normalizePalette(input.palette, colors);
  const subject = artworkSubjectFromBrief(brief);
  const paletteRule = palette.length
    ? `Use only these ${palette.length} flat color regions: ${palette.join(', ')}.`
    : `Use at most ${colors} flat, clearly separated color regions.`;

  return {
    prompt: [
      `Create ${STYLE_PROMPTS[style]} for conversion into editable multicolor 3D-printable medal relief geometry.`,
      `Visual subject only: ${subject}.`,
      'Express the event entirely through imagery. Do not draw, quote, spell, or typeset any part of the request; include no letters, words, numbers, dates, captions, signatures, or watermarks.',
      `${paletteRule} Use solid fills only: no gradients, shading, transparency, texture, dithering, or photographic detail.`,
      `Every important line or gap must be at least ${robustMm} mm in the intended medal; never go below the ${oneLineMm} mm single-extrusion limit for a ${nozzleMm} mm nozzle.`,
      'Use smooth high-resolution closed contours, strong connected shapes, clean negative space, and a plain white background. Return one isolated artwork mark, front view, square composition, with no medal rim, ribbon, mockup, or scenery outside the mark.',
    ].join(' '),
    negativePrompt: FIXED_NEGATIVE_PROMPT,
    policy: {
      artworkOnly: true,
      allowsRenderedText: false,
      style,
      colors,
      nozzleMm,
      oneLineMm,
      robustMm,
      palette,
    },
  };
}

export function resolveLocalAiConfig(env = process.env) {
  const raw = String(env.MEDALFORGE_SD_URL || DEFAULT_SD_URL).trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(503, 'LOCAL_AI_CONFIG_INVALID', 'The local image generator address is invalid.', {
      hint: 'Set MEDALFORGE_SD_URL to a loopback origin such as http://127.0.0.1:1234.',
    });
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', '::1'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new HttpError(503, 'LOCAL_AI_CONFIG_INVALID', 'The image generator must use a plain HTTP loopback origin.', {
      hint: 'Use MEDALFORGE_SD_URL=http://127.0.0.1:1234. Remote hosts and URL paths are intentionally rejected.',
    });
  }
  const jobTimeoutMs = Math.min(MAX_JOB_TIMEOUT_MS, Math.max(MIN_JOB_TIMEOUT_MS, Number(env.MEDALFORGE_SD_TIMEOUT_MS) || DEFAULT_JOB_TIMEOUT_MS));
  return { origin: url.origin, jobTimeoutMs };
}

export function resolveCloudImageConfig(env = process.env) {
  const apiKey = typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : '';
  return {
    apiKey,
    configured: apiKey.length > 0,
    model: OPENAI_IMAGE_MODEL,
    timeoutMs: OPENAI_IMAGE_TIMEOUT_MS,
  };
}

function normalizeCloudPrompt(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_PROMPT', 'Describe the image you want to generate.');
  const prompt = value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (prompt.length < 3) throw new HttpError(400, 'INVALID_PROMPT', 'The image description is too short.');
  if (prompt.length > 8_000) throw new HttpError(400, 'PROMPT_TOO_LONG', 'Keep the image description under 8,000 characters.');
  return prompt;
}

export function validateCloudImageInput(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') {
    throw new HttpError(400, 'INVALID_JSON', 'The generation settings must be a JSON object.');
  }
  const unknownFields = Object.keys(input).filter(key => !CLOUD_IMAGE_FIELDS.has(key));
  if (unknownFields.length) {
    throw new HttpError(400, 'UNKNOWN_FIELD', `Unsupported generation setting: ${unknownFields[0]}.`);
  }

  const hasCount = Object.hasOwn(input, 'count');
  const hasN = Object.hasOwn(input, 'n');
  if (hasCount && hasN && input.count !== input.n) {
    throw new HttpError(400, 'COUNT_CONFLICT', 'Use either count or n, or give both the same value.');
  }
  const count = hasCount ? input.count : hasN ? input.n : 1;
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new HttpError(400, 'INVALID_COUNT', 'Image count must be a whole number from 1 to 4.');
  }

  const size = input.size === undefined ? '1024x1024' : input.size;
  if (typeof size !== 'string' || !OPENAI_IMAGE_SIZES.has(size)) {
    throw new HttpError(400, 'INVALID_SIZE', 'Choose 1024x1024, 1024x1536, or 1536x1024.');
  }
  const quality = input.quality === undefined ? 'medium' : input.quality;
  if (typeof quality !== 'string' || !OPENAI_IMAGE_QUALITIES.has(quality)) {
    throw new HttpError(400, 'INVALID_QUALITY', 'Image quality must be low, medium, or high.');
  }

  return {
    prompt: normalizeCloudPrompt(input.prompt),
    count,
    size,
    quality,
  };
}

function optionalNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function nativeImageLimits(capabilities = {}) {
  const supportedModes = Array.isArray(capabilities?.supported_modes)
    ? capabilities.supported_modes.map(mode => String(mode).trim().toLocaleLowerCase('en-US')).filter(Boolean)
    : null;
  if (supportedModes && !supportedModes.includes('img_gen')) {
    throw new HttpError(503, 'LOCAL_AI_IMAGE_MODE_UNSUPPORTED', 'The connected local model does not support image generation.', {
      hint: 'Restart sd-server with an image-generation model, then check the connection again.',
    });
  }

  const upstream = capabilities?.limits && typeof capabilities.limits === 'object' ? capabilities.limits : {};
  const maxWidth = optionalNonNegativeInteger(upstream.max_width);
  const maxHeight = optionalNonNegativeInteger(upstream.max_height);
  const maxBatchCount = optionalNonNegativeInteger(upstream.max_batch_count);
  const sizes = [...OPENAI_IMAGE_SIZES].filter(size => {
    const [width, height] = LOCAL_IMAGE_SIZE_DIMENSIONS[size];
    return (maxWidth === null || width <= maxWidth) && (maxHeight === null || height <= maxHeight);
  });
  // MedalForge creates requested variants sequentially, so the native server only
  // needs to support one image per request. This keeps peak memory bounded while
  // still allowing the app to offer up to four alternatives.
  const maxCount = maxBatchCount === null || maxBatchCount >= 1 ? 4 : 0;
  if (!sizes.length || maxCount < 1) {
    throw new HttpError(503, 'LOCAL_AI_LIMITS_UNSUPPORTED', 'The connected local generator cannot produce the image sizes offered by MedalForge.', {
      hint: 'Use an sd-server image model that supports at least 1024 x 1024 output and one image per job.',
    });
  }
  return {
    sizes,
    qualities: [...OPENAI_IMAGE_QUALITIES],
    minCount: 1,
    maxCount,
    maxQueuedJobs: MAX_PENDING_JOBS,
    upstream: { maxWidth, maxHeight, maxBatchCount },
  };
}

export function validateLocalImageInput(input, limits = null) {
  if (!input || Array.isArray(input) || typeof input !== 'object') {
    throw new HttpError(400, 'INVALID_JSON', 'The local generation settings must be a JSON object.');
  }
  const unknownFields = Object.keys(input).filter(key => !LOCAL_IMAGE_FIELDS.has(key));
  if (unknownFields.length) throw new HttpError(400, 'UNKNOWN_FIELD', `Unsupported local generation setting: ${unknownFields[0]}.`);

  const allowedSizes = new Set(Array.isArray(limits?.sizes) ? limits.sizes : OPENAI_IMAGE_SIZES);
  const size = input.size === undefined ? '1024x1024' : input.size;
  if (typeof size !== 'string' || !OPENAI_IMAGE_SIZES.has(size) || !allowedSizes.has(size)) {
    const choices = [...allowedSizes].join(', ');
    throw new HttpError(400, 'INVALID_SIZE', choices ? `Choose ${choices}.` : 'The local generator does not support an available image size.');
  }
  const quality = input.quality === undefined ? 'high' : input.quality;
  if (typeof quality !== 'string' || !OPENAI_IMAGE_QUALITIES.has(quality)) {
    throw new HttpError(400, 'INVALID_QUALITY', 'Image quality must be low, medium, or high.');
  }
  const maxCount = Number.isInteger(limits?.maxCount) ? Math.min(4, Math.max(1, limits.maxCount)) : 4;
  const count = input.count === undefined ? 1 : input.count;
  if (!Number.isInteger(count) || count < 1 || count > maxCount) {
    throw new HttpError(400, 'INVALID_COUNT', `Image count must be a whole number from 1 to ${maxCount}.`);
  }
  const [width, height] = size.split('x').map(Number);
  const conceptMode = typeof input.prompt === 'string' || input.mode === 'concept';
  const compiled = conceptMode
    ? {
        prompt: normalizeCloudPrompt(input.prompt ?? input.brief),
        negativePrompt: LOCAL_CONCEPT_NEGATIVE_PROMPT,
        policy: { artworkOnly: false, allowsRenderedText: true, style: 'concept', colors: null, nozzleMm: null, palette: [] },
      }
    : compileArtworkPrompt(input);
  return {
    compiled,
    seed: clampInteger(input.seed, -1, 2_147_483_647, -1),
    size,
    width,
    height,
    quality,
    sampleSteps: LOCAL_IMAGE_STEPS[quality],
    count,
  };
}

function apiErrorPayload(error) {
  const known = error instanceof HttpError;
  return {
    ok: false,
    error: {
      code: known ? error.code : 'INTERNAL_ERROR',
      message: known ? error.message : 'The local service could not complete the request.',
      retryable: known ? error.retryable : false,
      ...(known && error.hint ? { hint: error.hint } : {}),
    },
  };
}

function writeJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...commonHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function localHostname(value) {
  return value === '127.0.0.1' || value === 'localhost' || value === '[::1]' || value === '::1';
}

function assertTrustedApiRequest(req) {
  let host;
  try {
    host = new URL(`http://${req.headers.host || ''}`);
  } catch {
    throw new HttpError(403, 'UNTRUSTED_REQUEST', 'The local API only accepts requests from this app.');
  }
  if (!localHostname(host.hostname)) throw new HttpError(403, 'UNTRUSTED_REQUEST', 'The local API only accepts loopback requests.');
  const origin = req.headers.origin;
  if (origin) {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new HttpError(403, 'UNTRUSTED_REQUEST', 'The request origin is invalid.');
    }
    if (parsedOrigin.protocol !== 'http:' || !localHostname(parsedOrigin.hostname) || parsedOrigin.host !== host.host) {
      throw new HttpError(403, 'UNTRUSTED_REQUEST', 'Cross-origin access to the local generator is blocked.');
    }
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'UNTRUSTED_REQUEST', 'Cross-site access to the local generator is blocked.');
}

function assertSameOriginApiRequest(req) {
  const host = String(req.headers.host || '').trim().toLocaleLowerCase('en-US');
  if (!host) throw new HttpError(403, 'UNTRUSTED_REQUEST', 'This API only accepts requests from the app.');
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLocaleLowerCase('en-US');
  if (fetchSite === 'cross-site') throw new HttpError(403, 'UNTRUSTED_REQUEST', 'Cross-site access to image generation is blocked.');

  const origin = String(req.headers.origin || '').trim();
  if (!origin) {
    if (!['GET', 'HEAD'].includes(req.method || '') && fetchSite !== 'same-origin') {
      throw new HttpError(403, 'UNTRUSTED_REQUEST', 'Image generation requires a same-origin browser request.');
    }
    return;
  }

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new HttpError(403, 'UNTRUSTED_REQUEST', 'The request origin is invalid.');
  }
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.host.toLocaleLowerCase('en-US') !== host) {
    throw new HttpError(403, 'UNTRUSTED_REQUEST', 'Cross-origin access to image generation is blocked.');
  }
}

async function readJsonBody(req) {
  const contentType = String(req.headers['content-type'] || '').toLocaleLowerCase('en-US');
  if (!contentType.startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'Send generation settings as application/json.');
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > JSON_REQUEST_LIMIT) throw new HttpError(413, 'REQUEST_TOO_LARGE', 'The generation request is too large.');
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > JSON_REQUEST_LIMIT) throw new HttpError(413, 'REQUEST_TOO_LARGE', 'The generation request is too large.');
    chunks.push(chunk);
  }
  if (!length) throw new HttpError(400, 'JSON_REQUIRED', 'Generation settings are required.');
  try {
    const value = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Expected an object');
    return value;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'The generation settings are not valid JSON.');
  }
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new HttpError(504, 'LOCAL_AI_TIMEOUT', 'The local image generator did not respond in time.', { retryable: true });
    throw new HttpError(503, 'LOCAL_AI_OFFLINE', 'The local image generator is not reachable.', {
      retryable: true,
      hint: 'Start stable-diffusion.cpp sd-server on 127.0.0.1:1234, then try again.',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedJson(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new HttpError(502, 'LOCAL_AI_RESPONSE_TOO_LARGE', 'The local generator returned more data than this app accepts.');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body || []) {
    length += chunk.length;
    if (length > maxBytes) throw new HttpError(502, 'LOCAL_AI_RESPONSE_TOO_LARGE', 'The local generator returned more data than this app accepts.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks, length).toString('utf8');
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(502, 'LOCAL_AI_INVALID_RESPONSE', 'The local generator returned an unreadable response.');
  }
  if (!response.ok) {
    const upstreamMessage = typeof body?.error?.message === 'string' ? body.error.message : typeof body?.message === 'string' ? body.message : '';
    throw new HttpError(response.status >= 500 ? 503 : 502, 'LOCAL_AI_REJECTED', upstreamMessage.slice(0, 240) || 'The local generator rejected the request.', { retryable: response.status >= 500 });
  }
  return body;
}

async function readOpenAiJson(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > OPENAI_IMAGE_RESPONSE_LIMIT) {
    throw new HttpError(502, 'OPENAI_RESPONSE_TOO_LARGE', 'The image service returned more data than this app accepts.');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body || []) {
    length += chunk.length;
    if (length > OPENAI_IMAGE_RESPONSE_LIMIT) {
      throw new HttpError(502, 'OPENAI_RESPONSE_TOO_LARGE', 'The image service returned more data than this app accepts.');
    }
    chunks.push(chunk);
  }
  try {
    return length ? JSON.parse(Buffer.concat(chunks, length).toString('utf8')) : {};
  } catch {
    throw new HttpError(502, 'OPENAI_INVALID_RESPONSE', 'The image service returned an unreadable response.');
  }
}

function throwOpenAiResponseError(response, body) {
  if (response.status === 401 || response.status === 403) {
    throw new HttpError(503, 'OPENAI_AUTH_ERROR', 'The cloud image service is not configured correctly.');
  }
  if (response.status === 429) {
    throw new HttpError(429, 'OPENAI_RATE_LIMITED', 'The image service is busy or its usage limit has been reached. Try again later.', { retryable: true });
  }
  if (response.status >= 500) {
    throw new HttpError(503, 'OPENAI_UNAVAILABLE', 'The cloud image service is temporarily unavailable.', { retryable: true });
  }
  const upstreamCode = typeof body?.error?.code === 'string' ? body.error.code.toLocaleLowerCase('en-US') : '';
  if (upstreamCode.includes('content_policy') || upstreamCode.includes('safety')) {
    throw new HttpError(400, 'IMAGE_REQUEST_BLOCKED', 'This image request could not be generated. Try a different description.');
  }
  throw new HttpError(502, 'OPENAI_REQUEST_REJECTED', 'The image service rejected this generation request.');
}

function normalizeOpenAiPng(value) {
  const base64 = typeof value?.b64_json === 'string' ? value.b64_json.replace(/\s+/gu, '') : '';
  if (
    !base64
    || base64.length > MAX_OPENAI_IMAGE_BASE64_LENGTH
    || base64.length % 4 !== 0
    || !/^[a-z0-9+/]+={0,2}$/iu.test(base64)
    || !base64.startsWith('iVBORw0KGgo')
  ) return null;
  return { b64_json: base64, mime_type: 'image/png' };
}

async function requestOpenAiImages(fetchImpl, config, input, externalSignal = null) {
  const controller = new AbortController();
  const abortFromClient = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromClient();
  else externalSignal?.addEventListener?.('abort', abortFromClient, { once: true });
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(OPENAI_IMAGES_URL, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        prompt: input.prompt,
        n: input.count,
        size: input.size,
        quality: input.quality,
        output_format: 'png',
      }),
    });
    const body = await readOpenAiJson(response);
    if (!response.ok) throwOpenAiResponseError(response, body);
    const images = Array.isArray(body?.data) ? body.data.map(normalizeOpenAiPng).filter(Boolean) : [];
    if (images.length !== input.count) {
      throw new HttpError(502, 'OPENAI_INVALID_RESPONSE', 'The image service did not return the requested PNG images.');
    }
    return images;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.name === 'AbortError' && externalSignal?.aborted) {
      throw new HttpError(499, 'CLIENT_CANCELLED', 'Image generation was cancelled.');
    }
    if (error?.name === 'AbortError') {
      throw new HttpError(504, 'OPENAI_TIMEOUT', 'Image generation took too long. Try again with fewer images.', { retryable: true });
    }
    throw new HttpError(503, 'OPENAI_UNAVAILABLE', 'The cloud image service could not be reached.', { retryable: true });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', abortFromClient);
  }
}

function findPollUrl(body) {
  for (const candidate of [body?.poll_url, body?.status_url, body?.task?.poll_url, body?.job?.poll_url]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

function safePollUrl(candidate, configuredOrigin) {
  let url;
  try {
    url = new URL(candidate, `${configuredOrigin}/`);
  } catch {
    throw new HttpError(502, 'LOCAL_AI_INVALID_RESPONSE', 'The local generator returned an invalid job address.');
  }
  if (url.origin !== configuredOrigin || url.username || url.password || url.protocol !== 'http:') {
    throw new HttpError(502, 'LOCAL_AI_UNSAFE_POLL_URL', 'The local generator returned a non-local job address.');
  }
  return url;
}

function normalizeImage(value) {
  const source = typeof value === 'string' ? value : value?.b64_json || value?.data || value?.image;
  if (typeof source !== 'string') return null;
  const match = source.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/isu);
  const mimeType = match ? `image/${match[1].toLocaleLowerCase('en-US')}` : 'image/png';
  const base64 = (match ? match[2] : source).replace(/\s+/g, '');
  if (!base64 || base64.length > MAX_IMAGE_BASE64_LENGTH || base64.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/iu.test(base64)) return null;
  return { b64_json: base64, mime_type: mimeType };
}

function extractImages(body) {
  const candidates = [body?.images, body?.result?.images, body?.data, body?.result?.data]
    .find(value => Array.isArray(value));
  return (candidates || []).map(normalizeImage).filter(Boolean).slice(0, 4);
}

function upstreamFailed(body) {
  const status = String(body?.status || body?.state || body?.task?.status || '').toLocaleLowerCase('en-US');
  return ['failed', 'error', 'cancelled', 'canceled'].includes(status);
}

function upstreamProgress(body) {
  const value = Number(body?.progress ?? body?.task?.progress ?? body?.job?.progress);
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function requestCapabilities(fetchImpl, config) {
  const response = await fetchWithTimeout(fetchImpl, `${config.origin}/sdcpp/v1/capabilities`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, STATUS_TIMEOUT_MS);
  return readLimitedJson(response, STATUS_RESPONSE_LIMIT);
}

function createJobManager(fetchImpl, config) {
  const jobs = new Map();
  const queue = [];
  let active = false;

  async function cancelUpstream(job) {
    if (!job.upstreamPollUrl || job.upstreamCancelRequested) return;
    job.upstreamCancelRequested = true;
    try {
      await fetchWithTimeout(fetchImpl, `${job.upstreamPollUrl.replace(/\/$/u, '')}/cancel`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      }, UPSTREAM_REQUEST_TIMEOUT_MS);
    } catch { /* Cancellation is best effort; the local queue still stops exposing the job. */ }
  }

  function prune() {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of jobs) {
      if (job.updatedAt < cutoff && ['completed', 'failed', 'cancelled'].includes(job.status)) jobs.delete(id);
    }
    if (jobs.size > MAX_RETAINED_JOBS) {
      const removable = [...jobs.values()]
        .filter(job => ['completed', 'failed', 'cancelled'].includes(job.status))
        .sort((a, b) => a.updatedAt - b.updatedAt);
      while (jobs.size > MAX_RETAINED_JOBS && removable.length) jobs.delete(removable.shift().id);
    }
  }

  async function runJob(job) {
    if (job.cancelRequested) return;
    job.status = 'running';
    job.updatedAt = Date.now();
    const deadline = Date.now() + config.jobTimeoutMs;
    const completedImages = [];

    for (let variantIndex = 0; variantIndex < job.count; variantIndex += 1) {
      if (job.cancelRequested) {
        await cancelUpstream(job);
        throw new HttpError(499, 'LOCAL_AI_CANCELLED', 'Local image generation was cancelled.');
      }
      if (Date.now() >= deadline) {
        await cancelUpstream(job);
        throw new HttpError(504, 'LOCAL_AI_JOB_TIMEOUT', 'Image generation exceeded the local job time limit.', { retryable: true });
      }
      // A fixed seed still yields deterministic alternatives when requests are
      // split: match the usual batch behavior by advancing it per variant.
      const variantSeed = job.seed < 0 ? -1 : (job.seed + variantIndex) % 2_147_483_648;
      job.upstreamPollUrl = null;
      job.upstreamCancelRequested = false;
      job.updatedAt = Date.now();

      const response = await fetchWithTimeout(fetchImpl, `${config.origin}/sdcpp/v1/img_gen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          prompt: job.compiled.prompt,
          negative_prompt: job.compiled.negativePrompt,
          width: job.width,
          height: job.height,
          seed: variantSeed,
          batch_count: 1,
          output_format: 'png',
          sample_params: { sample_steps: job.sampleSteps },
        }),
      }, Math.min(UPSTREAM_REQUEST_TIMEOUT_MS, Math.max(1, deadline - Date.now())));
      let body = await readLimitedJson(response, GENERATION_RESPONSE_LIMIT);
      let images = extractImages(body);
      const pollCandidate = findPollUrl(body);
      if (!images.length && !pollCandidate) throw new HttpError(502, 'LOCAL_AI_INVALID_RESPONSE', 'The local generator returned neither images nor a job address.');
      let pollUrl = pollCandidate ? safePollUrl(pollCandidate, config.origin) : null;
      job.upstreamPollUrl = pollUrl?.href || null;

      if (job.cancelRequested) {
        await cancelUpstream(job);
        throw new HttpError(499, 'LOCAL_AI_CANCELLED', 'Local image generation was cancelled.');
      }

      while (!images.length && pollUrl) {
        if (job.cancelRequested) {
          await cancelUpstream(job);
          throw new HttpError(499, 'LOCAL_AI_CANCELLED', 'Local image generation was cancelled.');
        }
        if (Date.now() >= deadline) {
          await cancelUpstream(job);
          throw new HttpError(504, 'LOCAL_AI_JOB_TIMEOUT', 'Image generation exceeded the local job time limit.', { retryable: true });
        }
        if (upstreamFailed(body)) {
          const message = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 240) : 'The local image generation job failed.';
          throw new HttpError(502, 'LOCAL_AI_JOB_FAILED', message, { retryable: true });
        }
        const progress = upstreamProgress(body);
        if (progress !== undefined) job.progress = (variantIndex + progress) / job.count;
        job.updatedAt = Date.now();
        await delay(POLL_INTERVAL_MS);
        if (job.cancelRequested) continue;
        const pollResponse = await fetchWithTimeout(fetchImpl, pollUrl, { method: 'GET', headers: { Accept: 'application/json' } }, Math.min(UPSTREAM_REQUEST_TIMEOUT_MS, Math.max(1, deadline - Date.now())));
        body = await readLimitedJson(pollResponse, GENERATION_RESPONSE_LIMIT);
        images = extractImages(body);
        const nextPoll = findPollUrl(body);
        if (nextPoll) {
          pollUrl = safePollUrl(nextPoll, config.origin);
          job.upstreamPollUrl = pollUrl.href;
        }
      }
      if (!images.length) throw new HttpError(502, 'LOCAL_AI_NO_IMAGES', 'The local generator completed without a usable PNG image.');
      completedImages.push(images[0]);
      job.upstreamPollUrl = null;
      job.progress = completedImages.length / job.count;
      job.updatedAt = Date.now();
    }

    job.images = completedImages;
    job.progress = 1;
    job.status = 'completed';
    job.updatedAt = Date.now();
  }

  async function drain() {
    if (active) return;
    const id = queue.shift();
    if (!id) return;
    const job = jobs.get(id);
    if (!job || job.status === 'cancelled') return drain();
    active = true;
    try {
      await runJob(job);
    } catch (error) {
      if (['LOCAL_AI_TIMEOUT', 'LOCAL_AI_JOB_TIMEOUT'].includes(error?.code)) await cancelUpstream(job);
      if (job.cancelRequested || error?.code === 'LOCAL_AI_CANCELLED') job.status = 'cancelled';
      else {
        job.status = 'failed';
        job.error = apiErrorPayload(error).error;
      }
      job.updatedAt = Date.now();
    } finally {
      active = false;
      void drain();
    }
  }

  return {
    create(input, limits = null) {
      prune();
      const outstanding = [...jobs.values()].filter(job => ['queued', 'running'].includes(job.status)).length;
      if (outstanding >= MAX_PENDING_JOBS) throw new HttpError(429, 'LOCAL_AI_BUSY', 'The local generator queue is full. Try again after a current job finishes.', { retryable: true });
      const normalized = validateLocalImageInput(input, limits);
      const id = randomUUID();
      const now = Date.now();
      const job = {
        id,
        status: 'queued',
        progress: 0,
        createdAt: now,
        updatedAt: now,
        seed: normalized.seed,
        compiled: normalized.compiled,
        size: normalized.size,
        width: normalized.width,
        height: normalized.height,
        quality: normalized.quality,
        sampleSteps: normalized.sampleSteps,
        count: normalized.count,
        cancelRequested: false,
        upstreamCancelRequested: false,
      };
      jobs.set(id, job);
      queue.push(id);
      void drain();
      return job;
    },
    get(id) {
      prune();
      return jobs.get(id);
    },
    cancel(id) {
      prune();
      const job = jobs.get(id);
      if (!job) return null;
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
      job.cancelRequested = true;
      if (job.status === 'queued') job.status = 'cancelled';
      job.updatedAt = Date.now();
      return job;
    },
  };
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    statusUrl: `/api/local-ai/jobs/${job.id}`,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    size: job.size,
    quality: job.quality,
    count: job.count,
    ...(['queued', 'running'].includes(job.status) ? { cancelUrl: `/api/local-ai/jobs/${job.id}/cancel` } : {}),
    ...(job.status === 'completed' ? { images: job.images } : {}),
    ...(job.status === 'failed' ? { error: job.error } : {}),
  };
}

function staticCacheControl(file) {
  const extension = extname(file).toLocaleLowerCase('en-US');
  if (extension === '.html') return 'no-cache';
  if (extension === '.wasm') return 'public, max-age=86400, must-revalidate';
  if (['.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.mp4', '.webm', '.vtt'].includes(extension)) return 'public, max-age=3600';
  return 'no-store';
}

async function serveStatic(req, res, root) {
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.writeHead(405, { ...commonHeaders, 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    res.end('Method not allowed');
    return;
  }
  try {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(requestUrl.pathname);
    const routePath = pathname.replace(/^\/+/, '');
    if (pathname !== '/' && !pathname.endsWith('/') && !extname(routePath)) {
      const directoryIndex = resolve(root, routePath, 'index.html');
      const fromRoot = relative(root, directoryIndex);
      if (!fromRoot.startsWith('..') && !isAbsolute(fromRoot)) {
        try {
          await stat(directoryIndex);
          res.writeHead(308, { ...commonHeaders, Location: `${pathname}/${requestUrl.search}` });
          res.end();
          return;
        } catch {
          // Continue to the normal file/404 path.
        }
      }
    }
    const requestedFile = pathname === '/' || pathname === '/index.html'
      ? 'index.html'
      : pathname.endsWith('/')
        ? `${routePath}index.html`
        : routePath;
    const file = resolve(root, requestedFile);
    const fromRoot = relative(root, file);
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error('Invalid path');
    await stat(file);
    const body = await readFile(file);
    res.writeHead(200, {
      ...commonHeaders,
      'Cache-Control': staticCacheControl(file),
      'Content-Type': types[extname(file).toLocaleLowerCase('en-US')] || 'application/octet-stream',
      'Content-Security-Policy': requestedFile === 'assets/medals/cad-step-worker.js'
        ? stepWorkerContentSecurityPolicy
        : contentSecurityPolicy,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    try {
      const body = await readFile(resolve(root, '404.html'));
      res.writeHead(404, { ...commonHeaders, 'Cache-Control': 'no-cache', 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': contentSecurityPolicy });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { ...commonHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  }
}

export function createMedalForgeServer({ root = resolve(process.cwd(), 'public'), env = process.env, fetchImpl = globalThis.fetch, localAiManager = null, localMedalPlanner = null } = {}) {
  const cloudImageConfig = resolveCloudImageConfig(env);
  const cloudImageState = { active: 0 };
  const openAiMedalConfig = resolveOpenAiMedalConfig(env);
  const openAiMedalState = { active: 0 };
  let config;
  let configError;
  try {
    config = resolveLocalAiConfig(env);
  } catch (error) {
    configError = error;
  }
  const jobs = config ? createJobManager(fetchImpl, config) : null;
  const setupManager = localAiManager || new LocalAiManager({ env, fetchImpl, origin: config?.origin });
  const medalPlanner = localMedalPlanner || createLocalMedalPlanService({ env, fetchImpl });

  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    if (!pathname.startsWith('/api/local-ai/') && !pathname.startsWith('/api/cloud-image/') && !pathname.startsWith('/api/openai-medal/')) {
      await serveStatic(req, res, root);
      return;
    }

    if (pathname.startsWith('/api/openai-medal/')) {
      try {
        assertSameOriginApiRequest(req);

        if (pathname === '/api/openai-medal/status' && req.method === 'GET') {
          writeJson(res, 200, {
            ok: true,
            available: openAiMedalConfig.configured,
            configured: openAiMedalConfig.configured,
            provider: 'openai',
            model: openAiMedalConfig.model,
            capabilities: {
              textToMedal: true,
              structuredPlans: true,
              planSchema: 'MedalDesignPlan',
              planVersion: 1,
              variants: 4,
              serverManagedCredentials: true,
              acceptsBrowserApiKey: false,
              chatGptLoginIsApiAuth: false,
            },
            authentication: {
              mode: 'server-api-key',
              chatGptSubscriptionSupported: false,
              apiBillingRequired: true,
            },
            limits: {
              maxBriefLength: 2_000,
              maxConcurrent: MAX_CONCURRENT_OPENAI_MEDAL_PLANS,
            },
            message: openAiMedalConfig.configured
              ? 'Ready. The API credential stays on the MedalForge server and is never sent to the browser.'
              : 'Not configured. The site operator must add an OpenAI API key to the server. A ChatGPT login or subscription cannot authenticate API requests.',
          });
          return;
        }

        if (pathname === '/api/openai-medal/generate' && req.method === 'POST') {
          if (!openAiMedalConfig.configured) {
            throw new HttpError(503, 'OPENAI_MEDAL_NOT_CONFIGURED', 'AI text-to-medal is not configured on this server.', {
              hint: 'The site operator must set OPENAI_API_KEY as a protected server environment variable. ChatGPT subscriptions do not authenticate API requests.',
            });
          }
          const input = validateOpenAiMedalInput(await readJsonBody(req));
          if (openAiMedalState.active >= MAX_CONCURRENT_OPENAI_MEDAL_PLANS) {
            throw new HttpError(429, 'OPENAI_MEDAL_BUSY', 'Two medals are already being planned. Try again shortly.', { retryable: true });
          }
          openAiMedalState.active += 1;
          const clientController = new AbortController();
          const abortClientRequest = () => clientController.abort();
          req.once('aborted', abortClientRequest);
          const abortClosedResponse = () => { if (!res.writableEnded) abortClientRequest(); };
          res.once('close', abortClosedResponse);
          try {
            const result = await requestOpenAiMedalPlan(fetchImpl, openAiMedalConfig, input, { signal: clientController.signal });
            writeJson(res, 200, {
              ok: true,
              provider: 'openai',
              model: openAiMedalConfig.model,
              plan: result.plan,
              usage: result.usage,
            });
          } finally {
            req.off('aborted', abortClientRequest);
            res.off('close', abortClosedResponse);
            openAiMedalState.active -= 1;
          }
          return;
        }

        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This AI medal route or method is not supported.');
      } catch (error) {
        const normalized = error instanceof OpenAiMedalServiceError
          ? new HttpError(error.status, error.code, error.message, { retryable: error.retryable, hint: error.hint })
          : error;
        const status = normalized instanceof HttpError ? normalized.status : 500;
        writeJson(res, status, apiErrorPayload(normalized));
      }
      return;
    }

    if (pathname.startsWith('/api/cloud-image/')) {
      try {
        assertSameOriginApiRequest(req);

        if (pathname === '/api/cloud-image/status' && req.method === 'GET') {
          writeJson(res, 200, {
            ok: true,
            available: cloudImageConfig.configured,
            configured: cloudImageConfig.configured,
            provider: 'openai',
            model: cloudImageConfig.model,
            defaults: { size: '1024x1024', quality: 'medium', count: 1 },
            limits: {
              sizes: [...OPENAI_IMAGE_SIZES],
              qualities: [...OPENAI_IMAGE_QUALITIES],
              minCount: 1,
              maxCount: 4,
              maxConcurrent: MAX_CONCURRENT_OPENAI_GENERATIONS,
            },
          });
          return;
        }

        if (pathname === '/api/cloud-image/generate' && req.method === 'POST') {
          if (!cloudImageConfig.configured) {
            throw new HttpError(503, 'OPENAI_NOT_CONFIGURED', 'Cloud image generation is not configured.', {
              hint: 'For local use, copy .env.example to .env and set OPENAI_API_KEY. For deployment, add it as a protected hosting secret, then restart the app.',
            });
          }
          const input = validateCloudImageInput(await readJsonBody(req));
          if (cloudImageState.active >= MAX_CONCURRENT_OPENAI_GENERATIONS) {
            throw new HttpError(429, 'OPENAI_BUSY', 'Too many images are being generated at once. Try again shortly.', { retryable: true });
          }
          cloudImageState.active += 1;
          const clientController = new AbortController();
          const abortClientRequest = () => clientController.abort();
          req.once('aborted', abortClientRequest);
          const abortClosedResponse = () => { if (!res.writableEnded) abortClientRequest(); };
          res.once('close', abortClosedResponse);
          try {
            const images = await requestOpenAiImages(fetchImpl, cloudImageConfig, input, clientController.signal);
            writeJson(res, 200, {
              ok: true,
              provider: 'openai',
              model: cloudImageConfig.model,
              size: input.size,
              quality: input.quality,
              count: images.length,
              images,
            });
          } finally {
            req.off('aborted', abortClientRequest);
            res.off('close', abortClosedResponse);
            cloudImageState.active -= 1;
          }
          return;
        }

        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This cloud image route or method is not supported.');
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        writeJson(res, status, apiErrorPayload(error));
      }
      return;
    }

    try {
      assertTrustedApiRequest(req);

      if (pathname === '/api/local-ai/medal-plan/status' && req.method === 'GET') {
        writeJson(res, 200, { ok: true, ...medalPlanner.status() });
        return;
      }

      if (pathname === '/api/local-ai/medal-plan' && req.method === 'POST') {
        const clientController = new AbortController();
        const abortClientRequest = () => clientController.abort();
        req.once('aborted', abortClientRequest);
        const abortClosedResponse = () => { if (!res.writableEnded) abortClientRequest(); };
        res.once('close', abortClosedResponse);
        try {
          const result = await medalPlanner.generate(await readJsonBody(req), { signal: clientController.signal });
          writeJson(res, 200, { ok: true, ...result });
        } finally {
          req.off('aborted', abortClientRequest);
          res.off('close', abortClosedResponse);
        }
        return;
      }

      if (configError) throw configError;

      if (pathname === '/api/local-ai/setup/status' && req.method === 'GET') {
        writeJson(res, 200, { ok: true, setup: await setupManager.getStatus() });
        return;
      }

      if (pathname === '/api/local-ai/setup' && req.method === 'POST') {
        writeJson(res, 202, { ok: true, setup: await setupManager.startSetup() }, { 'Retry-After': '1' });
        return;
      }

      if (pathname === '/api/local-ai/setup/cancel' && req.method === 'POST') {
        writeJson(res, 200, { ok: true, setup: setupManager.cancelSetup() });
        return;
      }

      if (pathname === '/api/local-ai/status' && req.method === 'GET') {
        try {
          const capabilities = await requestCapabilities(fetchImpl, config);
          const limits = nativeImageLimits(capabilities);
          setupManager.noteAvailable();
          writeJson(res, 200, {
            ok: true,
            available: true,
            provider: 'stable-diffusion.cpp',
            api: 'sdcpp-native-async',
            capabilities,
            defaults: { size: '1024x1024', quality: 'high', count: 1 },
            limits,
            setup: await setupManager.getStatus(),
          });
        } catch (error) {
          const unsupported = ['LOCAL_AI_IMAGE_MODE_UNSUPPORTED', 'LOCAL_AI_LIMITS_UNSUPPORTED'].includes(error?.code);
          const setup = await setupManager.getStatus();
          writeJson(res, 200, {
            ok: true,
            available: false,
            provider: 'stable-diffusion.cpp',
            defaults: { size: '1024x1024', quality: 'high', count: 1 },
            limits: unsupported
              ? { sizes: [], qualities: [], minCount: 0, maxCount: 0, maxQueuedJobs: MAX_PENDING_JOBS }
              : { sizes: [...OPENAI_IMAGE_SIZES], qualities: [...OPENAI_IMAGE_QUALITIES], minCount: 1, maxCount: 4, maxQueuedJobs: MAX_PENDING_JOBS },
            setup,
            error: setup.error || (unsupported
              ? apiErrorPayload(error).error
              : setup.supported
                ? { code: 'LOCAL_AI_SETUP_REQUIRED', message: setup.message, retryable: true }
                : apiErrorPayload(error).error),
          });
        }
        return;
      }

      if (pathname === '/api/local-ai/generate' && req.method === 'POST') {
        const input = await readJsonBody(req);
        const capabilities = await requestCapabilities(fetchImpl, config);
        const limits = nativeImageLimits(capabilities);
        const job = jobs.create(input, limits);
        writeJson(res, 202, {
          ok: true,
          provider: 'stable-diffusion.cpp',
          size: job.size,
          quality: job.quality,
          count: job.count,
          job: publicJob(job),
          compiled: {
            prompt: job.compiled.prompt,
            negativePrompt: job.compiled.negativePrompt,
            policy: job.compiled.policy,
          },
        }, { Location: `/api/local-ai/jobs/${job.id}`, 'Retry-After': '1' });
        return;
      }

      const jobMatch = pathname.match(/^\/api\/local-ai\/jobs\/([0-9a-f-]{36})$/iu);
      if (jobMatch && req.method === 'GET') {
        const job = jobs.get(jobMatch[1]);
        if (!job) throw new HttpError(404, 'LOCAL_AI_JOB_NOT_FOUND', 'This local generation job was not found or has expired.');
        writeJson(res, 200, { ok: true, job: publicJob(job) }, job.status === 'completed' ? {} : { 'Retry-After': '1' });
        return;
      }

      const cancelMatch = pathname.match(/^\/api\/local-ai\/jobs\/([0-9a-f-]{36})\/cancel$/iu);
      if (cancelMatch && req.method === 'POST') {
        const job = jobs.cancel(cancelMatch[1]);
        if (!job) throw new HttpError(404, 'LOCAL_AI_JOB_NOT_FOUND', 'This local generation job was not found or has expired.');
        writeJson(res, 200, { ok: true, job: publicJob(job) });
        return;
      }

      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This local AI route or method is not supported.');
    } catch (error) {
      const normalized = error instanceof LocalAiSetupError || error instanceof LocalMedalPlanError
        ? new HttpError(error.status, error.code, error.message, { retryable: error.retryable, hint: error.hint })
        : error;
      const status = normalized instanceof HttpError ? normalized.status : 500;
      writeJson(res, status, apiErrorPayload(normalized));
    }
  });
  server.once('close', () => { void setupManager.shutdown(); });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const server = createMedalForgeServer();
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const activePort = typeof address === 'object' && address ? address.port : port;
    console.log(`Local URL: http://127.0.0.1:${activePort}`);
  });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
