import { createHash } from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import {
  constants as osConstants,
  freemem,
  setPriority,
  tmpdir,
  totalmem,
} from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const GIB = 1024 ** 3;
const START_TIMEOUT_MS = 5 * 60_000;
const READY_POLL_MS = 1_000;
const READY_REQUEST_TIMEOUT_MS = 2_000;
const INSTALL_MARGIN_BYTES = 2 * GIB;
// Windows can successfully load the model with only a few GB reported free by
// using its page file. Only stop a cold launch during acute memory pressure;
// larger guesses based on model size would reject known-good computers.
const MIN_FREE_MEMORY_BEFORE_START_BYTES = 1 * GIB;
const MAX_LOG_LINES = 24;

export const LOCAL_AI_MANIFEST = Object.freeze({
  id: 'stable-diffusion.cpp-master-829-z-image-turbo-q3',
  displayName: 'Z-Image Turbo',
  backendName: 'stable-diffusion.cpp',
  downloadBytes: 6_014_930_467,
  installedBytes: 6_014_930_467,
  recommendedRamBytes: 12 * GIB,
  engine: Object.freeze({
    vulkan: Object.freeze({
      id: 'engine-vulkan',
      label: 'Local image engine',
      filename: 'sd-master-0a565f2-bin-win-vulkan-x64.zip',
      url: 'https://github.com/leejet/stable-diffusion.cpp/releases/download/master-829-0a565f2/sd-master-0a565f2-bin-win-vulkan-x64.zip',
      bytes: 38_785_855,
      sha256: 'ab62418299ff8943364803c8bf2d78bc6875caa94d4e4190996fd59052e709fb',
      archive: true,
    }),
    cpu: Object.freeze({
      id: 'engine-cpu',
      label: 'Local image engine',
      filename: 'sd-master-0a565f2-bin-win-cpu-x64.zip',
      url: 'https://github.com/leejet/stable-diffusion.cpp/releases/download/master-829-0a565f2/sd-master-0a565f2-bin-win-cpu-x64.zip',
      bytes: 24_055_874,
      sha256: '49720614204a0e7dcd54be6eaba4d1742f5ed1e244326a54ec9f4d7d3a8011af',
      archive: true,
    }),
  }),
  models: Object.freeze([
    Object.freeze({
      id: 'diffusion',
      label: 'Image model',
      filename: 'z_image_turbo-Q3_K.gguf',
      url: 'https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/c61c0e422dc8b541b7548cf33a4ef8302b0f8085/z_image_turbo-Q3_K.gguf?download=true',
      bytes: 3_143_559_104,
      sha256: '4b44bdaa7814f20d7cf144e3939bd93aa32f50660204dd0c2aea5c5376232980',
    }),
    Object.freeze({
      id: 'text-encoder',
      label: 'Text understanding model',
      filename: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
      url: 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf?download=true',
      bytes: 2_497_281_120,
      sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597',
    }),
    Object.freeze({
      id: 'vae',
      label: 'Image decoder',
      filename: 'ae.safetensors',
      url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/08d04455279082882deaabc8d0d09fc914c071e1/split_files/vae/ae.safetensors?download=true',
      bytes: 335_304_388,
      sha256: 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38',
    }),
  ]),
  licenses: Object.freeze([
    Object.freeze({ name: 'stable-diffusion.cpp · MIT', url: 'https://github.com/leejet/stable-diffusion.cpp/blob/master/LICENSE' }),
    Object.freeze({ name: 'Z-Image Turbo · Apache 2.0', url: 'https://huggingface.co/leejet/Z-Image-Turbo-GGUF' }),
    Object.freeze({ name: 'Qwen3 · Apache 2.0', url: 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF' }),
  ]),
});

export class LocalAiSetupError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'LocalAiSetupError';
    this.code = code;
    this.status = Number(options.status) || 500;
    this.retryable = Boolean(options.retryable);
    this.hint = options.hint;
  }
}

export function formatLocalAiBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(bytes >= 10 * GIB ? 0 : 1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

function defaultInstallRoot(env, platform) {
  const configured = String(env.MEDALFORGE_AI_HOME || '').trim();
  if (configured) return resolve(configured);
  if (platform === 'win32') {
    const localData = String(env.LOCALAPPDATA || env.APPDATA || '').trim();
    if (localData) return resolve(localData, 'MedalForge', 'local-ai');
  }
  const dataHome = String(env.XDG_DATA_HOME || '').trim();
  if (dataHome) return resolve(dataHome, 'medalforge', 'local-ai');
  return resolve(tmpdir(), 'MedalForge', 'local-ai');
}

function safeOwnedPath(root, ...parts) {
  const base = resolve(root);
  const target = resolve(base, ...parts);
  const fromBase = relative(base, target);
  if (!fromBase || fromBase.startsWith('..') || isAbsolute(fromBase)) {
    throw new LocalAiSetupError('LOCAL_AI_UNSAFE_PATH', 'The local image setup path is unsafe.');
  }
  return target;
}

function publicError(error) {
  return {
    code: error?.code || 'LOCAL_AI_SETUP_FAILED',
    message: error?.message || 'The local image maker could not be set up.',
    retryable: error?.retryable !== false,
  };
}

function abortSetupError() {
  return new LocalAiSetupError('LOCAL_AI_SETUP_CANCELLED', 'Local image setup was paused.', { status: 499, retryable: true });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortSetupError();
}

function wait(milliseconds, signal) {
  return new Promise((resolveWait, reject) => {
    throwIfAborted(signal);
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal?.removeEventListener?.('abort', cancelled);
      resolveWait();
    }
    function cancelled() {
      clearTimeout(timer);
      reject(abortSetupError());
    }
    signal?.addEventListener?.('abort', cancelled, { once: true });
  });
}

async function fileMatchesSize(path, bytes) {
  try { return (await stat(path)).size === bytes; } catch { return false; }
}

async function sha256File(path, signal) {
  const hash = createHash('sha256');
  const input = createReadStream(path, { highWaterMark: 4 * 1024 * 1024 });
  try {
    for await (const chunk of input) {
      throwIfAborted(signal);
      hash.update(chunk);
    }
    return hash.digest('hex');
  } catch (error) {
    input.destroy();
    throw error;
  }
}

function fixedPowerShellScript() {
  return `
$ErrorActionPreference = 'Stop'
$archivePath = [Environment]::GetEnvironmentVariable('MEDALFORGE_ARCHIVE_PATH')
$destinationPath = [Environment]::GetEnvironmentVariable('MEDALFORGE_DESTINATION_PATH')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [System.IO.Path]::GetFullPath($destinationPath + [System.IO.Path]::DirectorySeparatorChar)
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  foreach ($entry in $archive.Entries) {
    $target = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($destinationPath, $entry.FullName))
    if (-not $target.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw 'The archive contains an unsafe path.'
    }
  }
} finally {
  $archive.Dispose()
}
Expand-Archive -LiteralPath $archivePath -DestinationPath $destinationPath -Force
`;
}

async function runPowerShellExtraction(spawnImpl, archivePath, destinationPath, signal) {
  const encoded = Buffer.from(fixedPowerShellScript(), 'utf16le').toString('base64');
  await new Promise((resolveRun, reject) => {
    throwIfAborted(signal);
    const child = spawnImpl('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        MEDALFORGE_ARCHIVE_PATH: archivePath,
        MEDALFORGE_DESTINATION_PATH: destinationPath,
      },
    });
    let errorText = '';
    child.stderr?.on('data', chunk => { errorText = `${errorText}${chunk}`.slice(-4_000); });
    const cancel = () => child.kill();
    signal?.addEventListener?.('abort', cancel, { once: true });
    child.once('error', error => {
      signal?.removeEventListener?.('abort', cancel);
      reject(new LocalAiSetupError('LOCAL_AI_EXTRACT_FAILED', 'The local image engine could not be unpacked.', { cause: error, retryable: true }));
    });
    child.once('exit', code => {
      signal?.removeEventListener?.('abort', cancel);
      if (signal?.aborted) reject(abortSetupError());
      else if (code === 0) resolveRun();
      else reject(new LocalAiSetupError('LOCAL_AI_EXTRACT_FAILED', errorText.trim().split(/\r?\n/u).at(-1) || 'The local image engine could not be unpacked.', { retryable: true }));
    });
  });
}

async function findNamedFile(root, filename) {
  const queue = [root];
  while (queue.length) {
    const directory = queue.shift();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = join(directory, entry.name);
      if (entry.isFile() && entry.name.toLocaleLowerCase('en-US') === filename.toLocaleLowerCase('en-US')) return candidate;
      if (entry.isDirectory()) queue.push(candidate);
    }
  }
  return null;
}

function cleanLogLine(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 300);
}

export class LocalAiManager {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
    this.spawnImpl = options.spawnImpl || nodeSpawn;
    this.platform = options.platform || process.platform;
    this.arch = options.arch || process.arch;
    this.installRoot = resolve(options.installRoot || defaultInstallRoot(this.env, this.platform));
    this.origin = String(options.origin || this.env.MEDALFORGE_SD_URL || 'http://127.0.0.1:1234');
    this.backend = String(this.env.MEDALFORGE_AI_BACKEND || 'vulkan').toLocaleLowerCase('en-US') === 'cpu' ? 'cpu' : 'vulkan';
    this.totalMemoryBytes = Number(options.totalMemoryBytes) || totalmem();
    this.freeMemoryImpl = options.freeMemoryImpl || freemem;
    this.setPriorityImpl = options.setPriorityImpl || setPriority;
    this.supported = this.platform === 'win32' && this.arch === 'x64' && typeof this.fetchImpl === 'function';
    this.installed = null;
    this.receipt = null;
    this.child = null;
    this.childExited = null;
    this.abortController = null;
    this.setupPromise = null;
    this.logs = [];
    this.state = {
      phase: 'idle',
      progress: null,
      downloadedBytes: 0,
      totalBytes: this.totalDownloadBytes(),
      currentFile: null,
      message: this.supported ? 'Ready for automatic setup.' : 'Automatic local setup is available on 64-bit Windows.',
      error: null,
    };
  }

  engineAsset() {
    return LOCAL_AI_MANIFEST.engine[this.backend];
  }

  assets() {
    return [this.engineAsset(), ...LOCAL_AI_MANIFEST.models];
  }

  totalDownloadBytes() {
    const engine = LOCAL_AI_MANIFEST.engine[this.backend] || LOCAL_AI_MANIFEST.engine.vulkan;
    return engine.bytes + LOCAL_AI_MANIFEST.models.reduce((sum, asset) => sum + asset.bytes, 0);
  }

  receiptPath() { return safeOwnedPath(this.installRoot, 'install.json'); }
  downloadsRoot() { return safeOwnedPath(this.installRoot, 'downloads'); }
  modelsRoot() { return safeOwnedPath(this.installRoot, 'models'); }
  engineRoot() { return safeOwnedPath(this.installRoot, `engine-${this.backend}`); }

  async inspectInstallation() {
    if (this.installed !== null) return this.installed;
    try {
      const receipt = JSON.parse(await readFile(this.receiptPath(), 'utf8'));
      if (receipt.manifestId !== LOCAL_AI_MANIFEST.id || receipt.backend !== this.backend || typeof receipt.executable !== 'string') throw new Error('stale receipt');
      const executable = safeOwnedPath(this.installRoot, receipt.executable);
      await access(executable);
      for (const asset of LOCAL_AI_MANIFEST.models) {
        if (!await fileMatchesSize(safeOwnedPath(this.modelsRoot(), asset.filename), asset.bytes)) throw new Error(`missing ${asset.id}`);
      }
      this.receipt = { ...receipt, executable };
      this.installed = true;
    } catch {
      this.receipt = null;
      this.installed = false;
    }
    return this.installed;
  }

  publicStatus() {
    const busy = ['preparing', 'downloading', 'verifying', 'extracting', 'starting'].includes(this.state.phase);
    return {
      supported: this.supported,
      managed: true,
      installed: this.installed === true,
      ready: this.state.phase === 'ready',
      busy,
      phase: this.state.phase,
      progress: Number.isFinite(this.state.progress) ? Math.max(0, Math.min(1, this.state.progress)) : null,
      downloadedBytes: this.state.downloadedBytes,
      totalBytes: this.state.totalBytes,
      downloadSize: formatLocalAiBytes(this.state.totalBytes),
      installedSize: formatLocalAiBytes(LOCAL_AI_MANIFEST.installedBytes),
      recommendedRam: formatLocalAiBytes(LOCAL_AI_MANIFEST.recommendedRamBytes),
      currentFile: this.state.currentFile,
      message: this.state.message,
      model: LOCAL_AI_MANIFEST.displayName,
      backend: this.backend === 'vulkan' ? 'GPU / Vulkan' : 'CPU',
      canCancel: busy,
      resumable: true,
      licenses: LOCAL_AI_MANIFEST.licenses,
      ...(this.state.error ? { error: this.state.error } : {}),
    };
  }

  async getStatus() {
    await this.inspectInstallation();
    if (this.state.phase === 'idle' && this.installed) {
      this.state.phase = 'stopped';
      this.state.message = 'The local image maker is installed and ready to start.';
    }
    if (this.state.phase === 'idle' && !this.installed) {
      this.state.message = `First use downloads ${formatLocalAiBytes(this.totalDownloadBytes())}; setup is automatic and resumable.`;
    }
    return this.publicStatus();
  }

  noteAvailable() {
    this.installed = this.installed ?? false;
    if (this.child) {
      this.state.phase = 'ready';
      this.state.progress = 1;
      this.state.message = 'Local image maker is ready.';
      this.state.error = null;
    }
  }

  async startSetup() {
    await this.inspectInstallation();
    if (!this.supported) {
      throw new LocalAiSetupError('LOCAL_AI_SETUP_UNSUPPORTED', 'Automatic local image setup currently requires 64-bit Windows.', { status: 400 });
    }
    if (this.totalMemoryBytes < LOCAL_AI_MANIFEST.recommendedRamBytes) {
      throw new LocalAiSetupError('LOCAL_AI_MEMORY_UNSAFE', `This computer needs at least ${formatLocalAiBytes(LOCAL_AI_MANIFEST.recommendedRamBytes)} of memory for safe local image creation.`, { status: 409 });
    }
    if (this.setupPromise) return this.publicStatus();
    if (this.child && this.state.phase === 'ready') return this.publicStatus();
    this.abortController = new AbortController();
    this.state = {
      phase: 'preparing',
      progress: this.installed ? 1 : 0,
      downloadedBytes: this.installed ? this.totalDownloadBytes() : 0,
      totalBytes: this.totalDownloadBytes(),
      currentFile: null,
      message: this.installed ? 'Starting the local image maker…' : 'Checking this computer…',
      error: null,
    };
    this.setupPromise = this.runSetup(this.abortController.signal)
      .catch(error => {
        const cancelled = error?.code === 'LOCAL_AI_SETUP_CANCELLED';
        this.state.phase = cancelled ? 'cancelled' : 'error';
        this.state.message = cancelled ? 'Setup paused. Click create to resume.' : error?.message || 'The local image maker could not be set up.';
        this.state.error = cancelled ? null : publicError(error);
      })
      .finally(() => {
        this.setupPromise = null;
        this.abortController = null;
      });
    return this.publicStatus();
  }

  cancelSetup() {
    this.abortController?.abort();
    return this.publicStatus();
  }

  async runSetup(signal) {
    await mkdir(this.installRoot, { recursive: true });
    await mkdir(this.downloadsRoot(), { recursive: true });
    await mkdir(this.modelsRoot(), { recursive: true });
    if (!this.installed) {
      await this.assertDiskSpace();
      let completedBytes = 0;
      for (const asset of this.assets()) {
        throwIfAborted(signal);
        const destination = asset.archive
          ? safeOwnedPath(this.downloadsRoot(), asset.filename)
          : safeOwnedPath(this.modelsRoot(), asset.filename);
        await this.ensureAsset(asset, destination, completedBytes, signal);
        completedBytes += asset.bytes;
        this.state.downloadedBytes = completedBytes;
        this.state.progress = completedBytes / this.state.totalBytes;
      }
      await this.installEngine(signal);
      await this.writeReceipt();
      this.installed = true;
    }
    throwIfAborted(signal);
    await this.startEngine(signal);
  }

  async assertDiskSpace() {
    let available;
    try {
      const info = await statfs(this.installRoot, { bigint: true });
      available = Number(info.bavail * info.bsize);
    } catch { return; }
    const existing = await Promise.all(this.assets().map(async asset => {
      const finalPath = asset.archive
        ? safeOwnedPath(this.downloadsRoot(), asset.filename)
        : safeOwnedPath(this.modelsRoot(), asset.filename);
      const partialPath = `${finalPath}.part`;
      try { return Math.min(asset.bytes, (await stat(finalPath)).size); } catch {
        try { return Math.min(asset.bytes, (await stat(partialPath)).size); } catch { return 0; }
      }
    }));
    const remaining = Math.max(0, this.totalDownloadBytes() - existing.reduce((sum, bytes) => sum + bytes, 0));
    const required = remaining + INSTALL_MARGIN_BYTES;
    if (available < required) {
      throw new LocalAiSetupError(
        'LOCAL_AI_DISK_SPACE',
        `Free ${formatLocalAiBytes(required - available)} more disk space, then try again.`,
        { status: 507, retryable: true },
      );
    }
  }

  async ensureAsset(asset, destination, completedBytes, signal) {
    if (await fileMatchesSize(destination, asset.bytes)) {
      this.state.phase = 'verifying';
      this.state.currentFile = asset.label;
      this.state.message = `Checking ${asset.label.toLocaleLowerCase('en-US')}…`;
      if (await sha256File(destination, signal) === asset.sha256) return;
      await rm(destination, { force: true });
    }

    const partial = `${destination}.part`;
    let existing = 0;
    try { existing = Math.min(asset.bytes, (await stat(partial)).size); } catch { existing = 0; }
    this.state.phase = 'downloading';
    this.state.currentFile = asset.label;
    this.state.downloadedBytes = completedBytes + existing;
    this.state.progress = this.state.downloadedBytes / this.state.totalBytes;
    this.state.message = `Downloading ${asset.label.toLocaleLowerCase('en-US')} · ${formatLocalAiBytes(existing)} of ${formatLocalAiBytes(asset.bytes)}`;

    const headers = existing ? { Range: `bytes=${existing}-` } : {};
    let response;
    try {
      response = await this.fetchImpl(asset.url, { headers, redirect: 'follow', signal });
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') throw abortSetupError();
      throw new LocalAiSetupError('LOCAL_AI_DOWNLOAD_OFFLINE', 'Download paused. Reconnect to the internet and try again.', { cause: error, retryable: true });
    }
    if (!response.ok || (existing && response.status !== 206 && response.status !== 200)) {
      throw new LocalAiSetupError('LOCAL_AI_DOWNLOAD_FAILED', `Could not download ${asset.label.toLocaleLowerCase('en-US')}. Try again.`, { status: 502, retryable: true });
    }
    if (existing && response.status === 200) {
      existing = 0;
      await rm(partial, { force: true });
    }
    const file = await open(partial, existing ? 'a' : 'w');
    let received = existing;
    try {
      for await (const chunk of response.body || []) {
        throwIfAborted(signal);
        await file.write(chunk);
        received += chunk.length;
        if (received > asset.bytes) throw new LocalAiSetupError('LOCAL_AI_DOWNLOAD_INVALID', `The ${asset.label.toLocaleLowerCase('en-US')} download was larger than expected.`, { retryable: true });
        this.state.downloadedBytes = completedBytes + received;
        this.state.progress = this.state.downloadedBytes / this.state.totalBytes;
        this.state.message = `Downloading ${asset.label.toLocaleLowerCase('en-US')} · ${formatLocalAiBytes(received)} of ${formatLocalAiBytes(asset.bytes)}`;
      }
    } finally {
      await file.close();
    }
    if (received !== asset.bytes) {
      throw new LocalAiSetupError('LOCAL_AI_DOWNLOAD_INCOMPLETE', `Download paused before ${asset.label.toLocaleLowerCase('en-US')} finished. Try again to resume.`, { retryable: true });
    }
    this.state.phase = 'verifying';
    this.state.message = `Checking ${asset.label.toLocaleLowerCase('en-US')}…`;
    if (await sha256File(partial, signal) !== asset.sha256) {
      await rm(partial, { force: true });
      throw new LocalAiSetupError('LOCAL_AI_CHECKSUM_FAILED', `The ${asset.label.toLocaleLowerCase('en-US')} download did not pass its safety check. Please try again.`, { retryable: true });
    }
    await rm(destination, { force: true });
    await rename(partial, destination);
  }

  async removeOwned(path) {
    safeOwnedPath(this.installRoot, relative(this.installRoot, resolve(path)));
    await rm(path, { recursive: true, force: true });
  }

  async installEngine(signal) {
    this.state.phase = 'extracting';
    this.state.currentFile = 'Local image engine';
    this.state.message = 'Installing the local image maker…';
    const stage = safeOwnedPath(this.installRoot, `engine-${this.backend}-stage`);
    await this.removeOwned(stage);
    await mkdir(stage, { recursive: true });
    const archive = safeOwnedPath(this.downloadsRoot(), this.engineAsset().filename);
    try {
      await runPowerShellExtraction(this.spawnImpl, archive, stage, signal);
      const executable = await findNamedFile(stage, 'sd-server.exe');
      if (!executable) throw new LocalAiSetupError('LOCAL_AI_ENGINE_MISSING', 'The downloaded image engine did not contain its server program.', { retryable: true });
      const engineRoot = this.engineRoot();
      await this.removeOwned(engineRoot);
      await rename(stage, engineRoot);
      const installedExecutable = safeOwnedPath(engineRoot, relative(stage, executable));
      this.receipt = { executable: installedExecutable };
    } catch (error) {
      await this.removeOwned(stage);
      throw error;
    }
  }

  async writeReceipt() {
    const executable = this.receipt?.executable;
    if (!executable) throw new LocalAiSetupError('LOCAL_AI_ENGINE_MISSING', 'The local image engine was not installed correctly.', { retryable: true });
    const fromRoot = relative(this.installRoot, executable);
    if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new LocalAiSetupError('LOCAL_AI_UNSAFE_PATH', 'The local image engine path is unsafe.');
    const receipt = {
      manifestId: LOCAL_AI_MANIFEST.id,
      backend: this.backend,
      executable: fromRoot,
      installedAt: new Date().toISOString(),
      files: LOCAL_AI_MANIFEST.models.map(asset => ({ id: asset.id, filename: asset.filename, bytes: asset.bytes, sha256: asset.sha256 })),
    };
    const temporary = `${this.receiptPath()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    await rm(this.receiptPath(), { force: true });
    await rename(temporary, this.receiptPath());
    this.receipt = { ...receipt, executable };
  }

  recordLog(chunk) {
    const lines = String(chunk || '').split(/\r?\n/gu).map(cleanLogLine).filter(Boolean);
    this.logs.push(...lines);
    if (this.logs.length > MAX_LOG_LINES) this.logs.splice(0, this.logs.length - MAX_LOG_LINES);
  }

  assertSafeToStartEngine() {
    let availableMemory;
    try {
      availableMemory = Number(this.freeMemoryImpl());
    } catch {
      // Memory telemetry is advisory. A platform/runtime reporting failure
      // must not turn into a permanent setup failure for the user.
      return;
    }
    if (!Number.isFinite(availableMemory) || availableMemory < 0) return;
    if (availableMemory < MIN_FREE_MEMORY_BEFORE_START_BYTES) {
      throw new LocalAiSetupError(
        'LOCAL_AI_MEMORY_PRESSURE',
        'This computer is very busy right now. Close a game or another heavy app, then try again.',
        { status: 409, retryable: true },
      );
    }
  }

  lowerChildPriority(child) {
    const pid = Number(child?.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) return;
    try {
      this.setPriorityImpl(pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
    } catch (error) {
      // Priority adjustment is best-effort (for example, endpoint security
      // may deny it). Image creation must still work when it is unavailable.
      this.recordLog(`Could not lower local image process priority: ${error?.message || 'permission denied'}`);
    }
  }

  async startEngine(signal) {
    if (!this.receipt?.executable) await this.inspectInstallation();
    const executable = this.receipt?.executable;
    if (!executable) throw new LocalAiSetupError('LOCAL_AI_ENGINE_MISSING', 'The local image engine must be installed again.', { retryable: true });
    throwIfAborted(signal);
    this.assertSafeToStartEngine();
    this.state.phase = 'starting';
    this.state.progress = 1;
    this.state.currentFile = null;
    this.state.message = 'Starting the local image maker…';
    this.state.error = null;
    this.logs = [];
    const diffusion = safeOwnedPath(this.modelsRoot(), LOCAL_AI_MANIFEST.models.find(asset => asset.id === 'diffusion').filename);
    const textEncoder = safeOwnedPath(this.modelsRoot(), LOCAL_AI_MANIFEST.models.find(asset => asset.id === 'text-encoder').filename);
    const vae = safeOwnedPath(this.modelsRoot(), LOCAL_AI_MANIFEST.models.find(asset => asset.id === 'vae').filename);
    const parsedOrigin = new URL(this.origin);
    const args = [
      '--diffusion-model', diffusion,
      '--vae', vae,
      '--llm', textEncoder,
      '--diffusion-fa',
      '--offload-to-cpu',
      '--vae-tiling',
      '--cfg-scale', '1.0',
      '--listen-ip', '127.0.0.1',
      '--listen-port', parsedOrigin.port || '1234',
    ];
    let child;
    try {
      child = this.spawnImpl(executable, args, {
        cwd: dirname(executable),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } catch (error) {
      throw new LocalAiSetupError('LOCAL_AI_START_FAILED', 'The local image maker did not start. Try again.', { cause: error, retryable: true });
    }
    this.child = child;
    this.childExited = null;
    this.lowerChildPriority(child);
    child.stdout?.on('data', chunk => this.recordLog(chunk));
    child.stderr?.on('data', chunk => this.recordLog(chunk));
    child.once('error', error => { this.childExited = { error }; });
    child.once('exit', (code, exitSignal) => {
      this.childExited = { code, signal: exitSignal };
      if (this.child === child) this.child = null;
      if (this.state.phase === 'ready') {
        this.state.phase = 'error';
        this.state.message = 'The local image maker stopped. Click create to restart it.';
        this.state.error = publicError(new LocalAiSetupError('LOCAL_AI_STOPPED', 'The local image maker stopped unexpectedly.', { retryable: true }));
      }
    });
    const cancel = () => child.kill();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      await this.waitUntilReady(signal);
    } catch (error) {
      child.kill();
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
    this.state.phase = 'ready';
    this.state.progress = 1;
    this.state.message = 'Local image maker is ready.';
    this.state.error = null;
  }

  async waitUntilReady(signal) {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      if (this.childExited) {
        const detail = this.logs.at(-1);
        throw new LocalAiSetupError('LOCAL_AI_START_FAILED', detail || 'The local image maker did not start. Try again.', { retryable: true, cause: this.childExited.error });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), READY_REQUEST_TIMEOUT_MS);
      try {
        const response = await this.fetchImpl(`${this.origin}/sdcpp/v1/capabilities`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: controller.signal,
        });
        if (response.ok) return;
      } catch { /* Model loading and connection refusal are expected while starting. */ }
      finally { clearTimeout(timer); }
      await wait(READY_POLL_MS, signal);
    }
    throw new LocalAiSetupError('LOCAL_AI_START_TIMEOUT', 'The local image maker took too long to start. Close other heavy apps and try again.', { status: 504, retryable: true });
  }

  async shutdown() {
    this.abortController?.abort();
    const child = this.child;
    this.child = null;
    if (child) child.kill();
  }
}
