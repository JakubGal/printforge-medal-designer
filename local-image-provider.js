export const LOCAL_IMAGE_ENDPOINTS = Object.freeze({
  status: '/api/local-ai/status',
  generate: '/api/local-ai/generate',
  setupStatus: '/api/local-ai/setup/status',
  setup: '/api/local-ai/setup',
  setupCancel: '/api/local-ai/setup/cancel',
});

const LOCAL_IMAGE_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536']);
const LOCAL_IMAGE_QUALITIES = new Set(['low', 'medium', 'high']);
const MAX_PROMPT_LENGTH = 8_000;
const MAX_IMAGE_COUNT = 4;

export class LocalImageError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'LocalImageError';
    this.code = options.code || 'LOCAL_IMAGE_ERROR';
    this.status = Number(options.status) || 0;
    this.details = options.details ?? null;
  }
}

function abortError(reason) {
  const error = new Error(typeof reason === 'string' && reason.trim() ? reason : 'Local image generation was cancelled.');
  error.name = 'AbortError';
  error.code = 'LOCAL_IMAGE_CANCELLED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason);
}

function safeProgress(callback, value) {
  try { callback?.(value); } catch { /* A display callback must not lose generated work. */ }
}

async function jsonResponse(response, label) {
  const text = await response.text();
  if (!text.trim()) throw new LocalImageError(`${label} returned an empty response.`, { status: response.status, code: 'LOCAL_IMAGE_EMPTY_RESPONSE' });
  try { return JSON.parse(text); } catch {
    throw new LocalImageError(`${label} returned invalid JSON.`, { status: response.status, code: 'LOCAL_IMAGE_INVALID_RESPONSE' });
  }
}

function messageFrom(payload, fallback) {
  return String(payload?.error?.message || payload?.message || fallback).trim();
}

async function checkedJson(response, label) {
  const payload = await jsonResponse(response, label);
  if (!response.ok || payload?.ok === false) {
    throw new LocalImageError(messageFrom(payload, `${label} failed (${response.status}).`), {
      status: response.status,
      code: payload?.error?.code || payload?.code || 'LOCAL_IMAGE_REQUEST_FAILED',
      details: payload,
    });
  }
  return payload;
}

function normalizedStringList(value, allowed, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.map(item => String(item).toLowerCase()).filter(item => allowed.has(item)))];
}

function displayModelName(payload) {
  const model = payload?.model ?? payload?.capabilities?.model;
  if (typeof model === 'string' && model.trim()) return model.trim();
  if (model && typeof model === 'object') {
    for (const candidate of [model.name, model.stem, model.id]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }
  return 'Local model';
}

function normalizeSetupState(value) {
  if (!value || typeof value !== 'object') return null;
  const phase = String(value.phase || 'idle').toLocaleLowerCase('en-US');
  const progress = Number(value.progress);
  return {
    supported: Boolean(value.supported),
    managed: Boolean(value.managed),
    installed: Boolean(value.installed),
    ready: Boolean(value.ready),
    busy: Boolean(value.busy),
    phase,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : null,
    downloadedBytes: Math.max(0, Number(value.downloadedBytes) || 0),
    totalBytes: Math.max(0, Number(value.totalBytes) || 0),
    downloadSize: String(value.downloadSize || '').slice(0, 40),
    installedSize: String(value.installedSize || '').slice(0, 40),
    recommendedRam: String(value.recommendedRam || '').slice(0, 40),
    currentFile: String(value.currentFile || '').slice(0, 80),
    message: String(value.message || '').slice(0, 300),
    model: String(value.model || 'Local model').slice(0, 100),
    backend: String(value.backend || '').slice(0, 80),
    canCancel: Boolean(value.canCancel),
    resumable: Boolean(value.resumable),
    error: value.error && typeof value.error === 'object' ? {
      code: String(value.error.code || 'LOCAL_AI_SETUP_FAILED').slice(0, 80),
      message: String(value.error.message || 'Local image setup failed.').slice(0, 300),
      retryable: Boolean(value.error.retryable),
    } : null,
  };
}

function normalizeOptions(options = {}, capability = null) {
  const prompt = String(options.prompt || '').trim();
  if (prompt.length < 3) throw new LocalImageError('Describe the image you want to create.', { code: 'LOCAL_IMAGE_PROMPT_REQUIRED' });
  if (prompt.length > MAX_PROMPT_LENGTH) throw new LocalImageError(`Keep the image description under ${MAX_PROMPT_LENGTH.toLocaleString('en-US')} characters.`, { code: 'LOCAL_IMAGE_PROMPT_TOO_LONG' });
  const size = String(options.size || '1024x1024').toLowerCase();
  const allowedSizes = new Set(Array.isArray(capability?.sizes) ? capability.sizes : LOCAL_IMAGE_SIZES);
  if (!LOCAL_IMAGE_SIZES.has(size) || !allowedSizes.has(size)) {
    const choices = [...allowedSizes].join(', ');
    throw new LocalImageError(choices ? `Choose ${choices}.` : 'The connected local generator does not support an available image size.', { code: 'LOCAL_IMAGE_INVALID_SIZE' });
  }
  const quality = String(options.quality || 'high').toLowerCase();
  if (!LOCAL_IMAGE_QUALITIES.has(quality)) throw new LocalImageError('Choose low, medium, or high quality.', { code: 'LOCAL_IMAGE_INVALID_QUALITY' });
  const count = Number(options.count ?? 1);
  const maxCount = Number.isInteger(capability?.maxCount) ? Math.min(MAX_IMAGE_COUNT, Math.max(0, capability.maxCount)) : MAX_IMAGE_COUNT;
  if (!Number.isInteger(count) || count < 1 || count > maxCount) throw new LocalImageError(`Generate between 1 and ${maxCount} images.`, { code: 'LOCAL_IMAGE_INVALID_COUNT' });
  return { prompt, size, quality, count };
}

function safeStatusUrl(value) {
  const url = String(value || '');
  if (!/^\/api\/local-ai\/jobs\/[0-9a-f-]{36}$/iu.test(url)) {
    throw new LocalImageError('The local generator returned an unsafe job address.', { code: 'LOCAL_IMAGE_UNSAFE_JOB_URL' });
  }
  return url;
}

function decodeBase64(value) {
  const compact = String(value || '').replace(/\s+/gu, '');
  if (!compact || compact.length % 4 === 1 || !/^[a-z0-9+/]*={0,2}$/iu.test(compact)) {
    throw new LocalImageError('The local generator returned malformed image data.', { code: 'LOCAL_IMAGE_INVALID_IMAGE' });
  }
  try {
    const binary = globalThis.atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new LocalImageError('The local generator returned malformed image data.', { code: 'LOCAL_IMAGE_INVALID_IMAGE' });
  }
}

function imagesFromJob(job) {
  if (!Array.isArray(job?.images) || !job.images.length) {
    throw new LocalImageError('The local generator completed without returning an image.', { code: 'LOCAL_IMAGE_NO_IMAGES' });
  }
  return job.images.map(image => {
    const mime = String(image?.mime_type || image?.mimeType || 'image/png').toLowerCase();
    return new Blob([decodeBase64(image?.b64_json || image?.base64)], { type: mime.startsWith('image/') ? mime : 'image/png' });
  });
}

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal?.removeEventListener?.('abort', cancelled);
      resolve();
    }
    function cancelled() {
      clearTimeout(timer);
      reject(abortError(signal?.reason));
    }
    signal?.addEventListener?.('abort', cancelled, { once: true });
  });
}

export class LocalImageProvider {
  constructor(options = {}) {
    if (typeof options.fetchImpl !== 'function' && typeof globalThis.fetch !== 'function') {
      throw new LocalImageError('This browser does not provide Fetch.', { code: 'LOCAL_IMAGE_FETCH_UNAVAILABLE' });
    }
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
    this.pollIntervalMs = Math.max(50, Number(options.pollIntervalMs) || 750);
    this.timeoutMs = Math.max(1_000, Number(options.timeoutMs) || 15 * 60_000);
    this.setupTimeoutMs = Math.max(60_000, Number(options.setupTimeoutMs) || 90 * 60_000);
    this.capability = null;
    this.setup = null;
  }

  async request(url, options, label) {
    let response;
    try { response = await this.fetchImpl(url, options); } catch (error) {
      if (options.signal?.aborted || error?.name === 'AbortError') throw abortError(options.signal?.reason);
      throw new LocalImageError(`${label} could not be reached: ${error?.message || error}`, { code: 'LOCAL_IMAGE_UNREACHABLE', cause: error });
    }
    return checkedJson(response, label);
  }

  async checkStatus(options = {}) {
    throwIfAborted(options.signal);
    const payload = await this.request(LOCAL_IMAGE_ENDPOINTS.status, {
      method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: options.signal,
    }, 'Local image generator');
    const sizes = normalizedStringList(payload.limits?.sizes, LOCAL_IMAGE_SIZES, LOCAL_IMAGE_SIZES);
    const qualities = normalizedStringList(payload.limits?.qualities, LOCAL_IMAGE_QUALITIES, LOCAL_IMAGE_QUALITIES);
    const maxCount = Number.isInteger(payload.limits?.maxCount)
      ? Math.min(MAX_IMAGE_COUNT, Math.max(0, payload.limits.maxCount))
      : MAX_IMAGE_COUNT;
    const defaultSize = sizes.includes(payload.defaults?.size) ? payload.defaults.size : sizes[0] || '1024x1024';
    const defaultQuality = qualities.includes(payload.defaults?.quality) ? payload.defaults.quality : qualities[0] || 'high';
    const capability = {
      ...payload,
      available: Boolean(payload.available),
      model: displayModelName(payload),
      defaults: { size: defaultSize, quality: defaultQuality, count: 1 },
      sizes,
      qualities,
      maxCount,
      setup: normalizeSetupState(payload.setup),
      message: payload.available ? null : payload.setup?.message || payload.error?.message || 'Set up the free image maker on this computer.',
    };
    this.setup = capability.setup;
    this.capability = capability;
    return capability;
  }

  async getSetupStatus(options = {}) {
    throwIfAborted(options.signal);
    const payload = await this.request(LOCAL_IMAGE_ENDPOINTS.setupStatus, {
      method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: options.signal,
    }, 'Local image setup');
    this.setup = normalizeSetupState(payload.setup);
    return this.setup;
  }

  async startSetup(options = {}) {
    throwIfAborted(options.signal);
    const payload = await this.request(LOCAL_IMAGE_ENDPOINTS.setup, {
      method: 'POST', headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: options.signal,
    }, 'Local image setup');
    this.setup = normalizeSetupState(payload.setup);
    return this.setup;
  }

  async cancelSetup() {
    try {
      const payload = await this.request(LOCAL_IMAGE_ENDPOINTS.setupCancel, {
        method: 'POST', headers: { Accept: 'application/json' }, credentials: 'same-origin', keepalive: true,
      }, 'Local image setup');
      this.setup = normalizeSetupState(payload.setup);
      return this.setup;
    } catch { return this.setup; }
  }

  async ensureSetup(options = {}) {
    const signal = options.signal;
    throwIfAborted(signal);
    let setup = await this.startSetup({ signal });
    const deadline = Date.now() + this.setupTimeoutMs;
    while (!setup?.ready) {
      throwIfAborted(signal);
      if (setup?.phase === 'error') {
        throw new LocalImageError(setup.error?.message || setup.message || 'The local image maker could not be set up.', {
          code: setup.error?.code || 'LOCAL_IMAGE_SETUP_FAILED', details: setup,
        });
      }
      if (setup?.phase === 'cancelled') throw abortError('Local image setup was paused.');
      if (Date.now() >= deadline) {
        void this.cancelSetup();
        throw new LocalImageError('Local image setup took too long. Try again to resume.', { code: 'LOCAL_IMAGE_SETUP_TIMEOUT', details: setup });
      }
      safeProgress(options.onProgress, {
        phase: 'setup',
        progress: setup?.progress,
        downloadedBytes: setup?.downloadedBytes,
        totalBytes: setup?.totalBytes,
        message: setup?.message || 'Preparing the local image maker…',
      });
      await abortableDelay(this.pollIntervalMs, signal);
      setup = await this.getSetupStatus({ signal });
    }
    safeProgress(options.onProgress, { phase: 'setup', progress: 1, message: 'Local image maker is ready.' });
    return setup;
  }

  async generate(options = {}) {
    const request = normalizeOptions(options, this.capability);
    const signal = options.signal;
    throwIfAborted(signal);
    safeProgress(options.onProgress, { phase: 'request', progress: 0, completed: 0, count: request.count, message: 'Sending work to this computer…' });
    const queued = await this.request(LOCAL_IMAGE_ENDPOINTS.generate, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      signal,
      body: JSON.stringify(request),
    }, 'Local image generation');
    const statusUrl = safeStatusUrl(queued?.job?.statusUrl);
    const cancelUrl = `${statusUrl}/cancel`;
    let cancelPromise = null;
    const cancelRemote = () => {
      cancelPromise ||= this.fetchImpl(cancelUrl, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => {});
      return cancelPromise;
    };
    signal?.addEventListener?.('abort', cancelRemote, { once: true });
    const deadline = Date.now() + this.timeoutMs;
    let job = queued.job;
    try {
      while (!['completed', 'failed', 'cancelled'].includes(job?.status)) {
        if (Date.now() >= deadline) {
          void cancelRemote();
          throw new LocalImageError('Local image generation exceeded the 15-minute limit.', { code: 'LOCAL_IMAGE_TIMEOUT' });
        }
        safeProgress(options.onProgress, {
          phase: 'generate',
          progress: Math.max(0, Math.min(1, Number(job?.progress) || 0)),
          completed: 0,
          count: request.count,
          message: job?.status === 'queued' ? 'Waiting for the local generator…' : 'Generating on this computer…',
        });
        await abortableDelay(this.pollIntervalMs, signal);
        const payload = await this.request(statusUrl, {
          method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin', signal,
        }, 'Local image job');
        job = payload.job;
      }
    } finally {
      signal?.removeEventListener?.('abort', cancelRemote);
    }
    if (job.status === 'cancelled') throw abortError('Local image generation was cancelled.');
    if (job.status === 'failed') {
      throw new LocalImageError(messageFrom(job, 'Local image generation failed.'), { code: job.error?.code || 'LOCAL_IMAGE_JOB_FAILED', details: job });
    }
    const images = imagesFromJob(job);
    safeProgress(options.onProgress, { phase: 'image', progress: 1, completed: images.length, count: images.length, message: 'Local images are ready.' });
    return {
      images,
      metadata: {
        provider: queued.provider || 'stable-diffusion.cpp',
        model: queued.model || null,
        size: request.size,
        quality: request.quality,
        count: images.length,
        prompt: queued.compiled?.prompt || request.prompt,
      },
    };
  }
}
