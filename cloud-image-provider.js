export const CLOUD_IMAGE_ENDPOINTS = Object.freeze({
  status: '/api/cloud-image/status',
  generate: '/api/cloud-image/generate',
});

export const CLOUD_IMAGE_DEFAULTS = Object.freeze({
  size: '1024x1024',
  quality: 'high',
  count: 4,
});

const MAX_PROMPT_LENGTH = 8_000;
const MAX_IMAGE_COUNT = 4;
const IMAGE_SIZE_PATTERN = /^(\d{3,4})x(\d{3,4})$/;

function abortError(reason) {
  if (typeof DOMException === 'function' && reason instanceof DOMException && reason.name === 'AbortError') return reason;
  const message = typeof reason === 'string' && reason.trim()
    ? reason
    : 'Cloud image generation was cancelled.';
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'CLOUD_IMAGE_CANCELLED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason);
}

function safeProgress(callback, data) {
  if (typeof callback !== 'function') return;
  try { callback(data); } catch { /* Progress UI errors must not lose generated work. */ }
}

function contentTypeOf(response) {
  return String(response?.headers?.get?.('content-type') || '').split(';', 1)[0].trim().toLowerCase();
}

function errorMessage(payload, fallback) {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  const nested = payload?.error;
  return String(
    (typeof nested === 'string' ? nested : nested?.message)
      || payload?.message
      || payload?.detail
      || fallback,
  ).trim();
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  if (!text.trim()) {
    throw new CloudImageError(`${label} returned an empty response.`, {
      code: 'CLOUD_IMAGE_EMPTY_RESPONSE',
      status: response.status,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CloudImageError(`${label} returned invalid JSON.`, {
      code: 'CLOUD_IMAGE_INVALID_RESPONSE',
      status: response.status,
      details: text.slice(0, 500),
    });
  }
}

async function parseErrorResponse(response, label) {
  let payload = null;
  let body = '';
  try { body = await response.text(); } catch { /* The status is still useful. */ }
  if (body.trim()) {
    try { payload = JSON.parse(body); } catch { payload = body; }
  }
  const fallback = `${label} failed (${response.status || 'network error'}).`;
  return new CloudImageError(errorMessage(payload, fallback), {
    code: payload?.error?.code || payload?.code || 'CLOUD_IMAGE_REQUEST_FAILED',
    status: response.status,
    retryAfter: response.headers?.get?.('retry-after') || null,
    details: payload,
  });
}

function normalizeSize(value) {
  const size = String(value || CLOUD_IMAGE_DEFAULTS.size).trim().toLowerCase();
  const match = IMAGE_SIZE_PATTERN.exec(size);
  if (!match) throw new CloudImageError('Choose an image size such as 1024x1024.', { code: 'CLOUD_IMAGE_INVALID_SIZE' });
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 512 || height < 512 || width > 4096 || height > 4096) {
    throw new CloudImageError('Image width and height must be between 512 and 4096 pixels.', { code: 'CLOUD_IMAGE_INVALID_SIZE' });
  }
  return `${width}x${height}`;
}

function normalizeOptions(options = {}) {
  const prompt = String(options.prompt || '').trim();
  if (!prompt) throw new CloudImageError('Describe the image you want to create.', { code: 'CLOUD_IMAGE_PROMPT_REQUIRED' });
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new CloudImageError(`The image description must be ${MAX_PROMPT_LENGTH.toLocaleString('en-US')} characters or shorter.`, {
      code: 'CLOUD_IMAGE_PROMPT_TOO_LONG',
    });
  }
  const count = Math.round(Number(options.count ?? CLOUD_IMAGE_DEFAULTS.count));
  if (!Number.isFinite(count) || count < 1 || count > MAX_IMAGE_COUNT) {
    throw new CloudImageError(`Generate between 1 and ${MAX_IMAGE_COUNT} images at a time.`, { code: 'CLOUD_IMAGE_INVALID_COUNT' });
  }
  const quality = String(options.quality || CLOUD_IMAGE_DEFAULTS.quality).trim().toLowerCase();
  if (!quality || quality.length > 32 || !/^[a-z][a-z0-9_-]*$/.test(quality)) {
    throw new CloudImageError('Choose a valid image quality.', { code: 'CLOUD_IMAGE_INVALID_QUALITY' });
  }
  return { prompt, size: normalizeSize(options.size), quality, count };
}

function decodeBase64(value) {
  const compact = String(value || '').replace(/\s+/g, '');
  if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new CloudImageError('The image service returned malformed image data.', { code: 'CLOUD_IMAGE_INVALID_IMAGE' });
  }
  try {
    const binary = globalThis.atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new CloudImageError('The image service returned malformed image data.', { code: 'CLOUD_IMAGE_INVALID_IMAGE' });
  }
}

function blobFromDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?((?:;[^,]*)*),(.*)$/s.exec(String(dataUrl || ''));
  if (!match) throw new CloudImageError('The image service returned an invalid data URL.', { code: 'CLOUD_IMAGE_INVALID_IMAGE' });
  const mimeType = String(match[1] || 'image/png').toLowerCase();
  if (!mimeType.startsWith('image/')) throw new CloudImageError('The generated result was not an image.', { code: 'CLOUD_IMAGE_INVALID_IMAGE' });
  const parameters = match[2] || '';
  let bytes;
  try {
    bytes = parameters.toLowerCase().includes(';base64')
      ? decodeBase64(match[3])
      : new TextEncoder().encode(decodeURIComponent(match[3]));
  } catch (error) {
    if (error instanceof CloudImageError) throw error;
    throw new CloudImageError('The image service returned an invalid data URL.', { code: 'CLOUD_IMAGE_INVALID_IMAGE' });
  }
  return new Blob([bytes], { type: mimeType });
}

function imageEntries(payload) {
  const entries = Array.isArray(payload?.images)
    ? payload.images
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  return entries.map((entry, position) => ({ entry, position })).sort((a, b) => {
    const aIndex = Number(a.entry?.index);
    const bIndex = Number(b.entry?.index);
    const safeA = Number.isFinite(aIndex) ? aIndex : a.position;
    const safeB = Number.isFinite(bIndex) ? bIndex : b.position;
    return safeA - safeB || a.position - b.position;
  });
}

function mimeTypeFor(entry) {
  const mime = String(entry?.mimeType || entry?.mime_type || 'image/png').trim().toLowerCase();
  return mime.startsWith('image/') ? mime : 'image/png';
}

async function entryToBlob(entry, fetchImpl, signal) {
  throwIfAborted(signal);
  if (entry instanceof Blob) return entry;
  if (typeof entry === 'string') {
    return entry.startsWith('data:') ? blobFromDataUrl(entry) : new Blob([decodeBase64(entry)], { type: 'image/png' });
  }
  if (!entry || typeof entry !== 'object') {
    throw new CloudImageError('The image service returned an empty image.', { code: 'CLOUD_IMAGE_INVALID_IMAGE' });
  }
  const dataUrl = entry.dataUrl || entry.data_url;
  if (dataUrl) return blobFromDataUrl(dataUrl);
  const base64 = entry.base64 || entry.b64_json || entry.b64;
  if (base64) return new Blob([decodeBase64(base64)], { type: mimeTypeFor(entry) });
  if (entry.url) {
    let response;
    try {
      response = await fetchImpl(String(entry.url), { method: 'GET', signal, credentials: 'omit' });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw abortError(signal?.reason);
      throw new CloudImageError(`The generated image could not be downloaded: ${error?.message || error}`, {
        code: 'CLOUD_IMAGE_DOWNLOAD_FAILED',
        cause: error,
      });
    }
    if (!response.ok) throw await parseErrorResponse(response, 'Generated image download');
    const mime = contentTypeOf(response);
    if (mime && !mime.startsWith('image/')) {
      throw new CloudImageError('The generated image download returned a non-image file.', { code: 'CLOUD_IMAGE_INVALID_IMAGE' });
    }
    const blob = await response.blob();
    return blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: mimeTypeFor(entry) });
  }
  throw new CloudImageError('The image service response did not contain image data.', { code: 'CLOUD_IMAGE_INVALID_IMAGE' });
}

function responseMetadata(payload, request, images) {
  const source = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  return {
    ...source,
    provider: payload?.provider ?? source.provider ?? null,
    model: payload?.model ?? source.model ?? null,
    created: payload?.created ?? source.created ?? null,
    size: payload?.size ?? source.size ?? request.size,
    quality: payload?.quality ?? source.quality ?? request.quality,
    count: images.length,
    revisedPrompts: imageEntries(payload).map(({ entry }) => entry?.revisedPrompt || entry?.revised_prompt || null),
  };
}

export class CloudImageError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'CloudImageError';
    this.code = options.code || 'CLOUD_IMAGE_ERROR';
    this.status = Number(options.status) || 0;
    this.retryAfter = options.retryAfter || null;
    this.details = options.details ?? null;
  }
}

export class CloudImageProvider {
  constructor(options = {}) {
    if (typeof options.fetchImpl !== 'function' && typeof globalThis.fetch !== 'function') {
      throw new CloudImageError('This browser does not provide Fetch.', { code: 'CLOUD_IMAGE_FETCH_UNAVAILABLE' });
    }
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
  }

  async checkStatus(options = {}) {
    const signal = options.signal;
    throwIfAborted(signal);
    let response;
    try {
      response = await this.fetchImpl(CLOUD_IMAGE_ENDPOINTS.status, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        signal,
      });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw abortError(signal?.reason);
      throw new CloudImageError(`The image service could not be reached: ${error?.message || error}`, {
        code: 'CLOUD_IMAGE_UNREACHABLE',
        cause: error,
      });
    }
    if (!response.ok) throw await parseErrorResponse(response, 'Image service status');
    const payload = await parseJsonResponse(response, 'Image service status');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new CloudImageError('Image service status returned an invalid response.', { code: 'CLOUD_IMAGE_INVALID_RESPONSE' });
    }
    if (payload.ok === false) {
      throw new CloudImageError(errorMessage(payload, 'Image service status failed.'), {
        code: payload.error?.code || payload.code || 'CLOUD_IMAGE_REQUEST_FAILED',
        status: response.status,
        details: payload,
      });
    }
    const available = payload.available ?? payload.configured ?? payload.ready;
    const limits = payload.limits && typeof payload.limits === 'object' ? payload.limits : {};
    const defaults = payload.defaults && typeof payload.defaults === 'object' ? payload.defaults : {};
    return {
      ...payload,
      available: Boolean(available),
      provider: payload.provider || null,
      model: payload.model || null,
      defaults: {
        size: defaults.size || CLOUD_IMAGE_DEFAULTS.size,
        quality: defaults.quality || CLOUD_IMAGE_DEFAULTS.quality,
        count: Math.max(1, Number(defaults.count) || 1),
      },
      sizes: Array.isArray(payload.sizes) ? payload.sizes : Array.isArray(limits.sizes) ? limits.sizes : [],
      qualities: Array.isArray(payload.qualities) ? payload.qualities : Array.isArray(limits.qualities) ? limits.qualities : [],
      maxCount: Math.max(1, Number(payload.maxCount || payload.max_count || limits.maxCount || limits.max_count) || 1),
    };
  }

  async generate(options = {}) {
    const request = normalizeOptions(options);
    const signal = options.signal;
    const onProgress = options.onProgress;
    throwIfAborted(signal);
    safeProgress(onProgress, { phase: 'request', completed: 0, count: request.count, progress: 0 });

    let response;
    try {
      response = await this.fetchImpl(CLOUD_IMAGE_ENDPOINTS.generate, {
        method: 'POST',
        headers: {
          Accept: 'application/json, image/png',
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        signal,
        body: JSON.stringify(request),
      });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw abortError(signal?.reason);
      throw new CloudImageError(`The image service could not be reached: ${error?.message || error}`, {
        code: 'CLOUD_IMAGE_UNREACHABLE',
        cause: error,
      });
    }
    if (!response.ok) throw await parseErrorResponse(response, 'Image generation');
    throwIfAborted(signal);

    const contentType = contentTypeOf(response);
    if (contentType.startsWith('image/')) {
      const image = await response.blob();
      safeProgress(onProgress, { phase: 'image', completed: 1, count: 1, progress: 1 });
      return {
        images: [image],
        metadata: {
          provider: response.headers?.get?.('x-image-provider') || null,
          model: response.headers?.get?.('x-image-model') || null,
          created: null,
          size: request.size,
          quality: request.quality,
          count: 1,
          revisedPrompts: [null],
        },
      };
    }

    const payload = await parseJsonResponse(response, 'Image generation');
    if (payload?.ok === false) {
      throw new CloudImageError(errorMessage(payload, 'Image generation failed.'), {
        code: payload.error?.code || payload.code || 'CLOUD_IMAGE_REQUEST_FAILED',
        status: response.status,
        details: payload,
      });
    }
    const entries = imageEntries(payload);
    if (!entries.length) {
      throw new CloudImageError('The image service completed without returning an image.', {
        code: 'CLOUD_IMAGE_NO_IMAGES',
        details: payload,
      });
    }

    const images = [];
    for (const { entry } of entries) {
      throwIfAborted(signal);
      images.push(await entryToBlob(entry, this.fetchImpl, signal));
      safeProgress(onProgress, {
        phase: 'image',
        completed: images.length,
        count: entries.length,
        progress: images.length / entries.length,
      });
    }
    return { images, metadata: responseMetadata(payload, request, images) };
  }
}
