# Image generation

MedalForge supports two explicit source-image generators:

1. **On this computer** is the UI default. MedalForge automatically downloads,
   verifies, installs, and starts a pinned
   [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp)
   engine and Z-Image Turbo model after the first explicit Create click.
2. **GPT Image 2** is the optional paid, best-quality cloud mode. MedalForge's
   same-origin server proxy keeps the OpenAI API key out of browser code.

Neither mode downloads an AI model into the browser tab or uses browser WebGPU.
Every returned PNG opens in the same local printable-image editor as an upload:
crop, background removal, simplification, color separation, filament mapping,
minimum-feature repair, physical sizing, and placement as editable medal relief.

## Free local mode

The current local-app data path is:

```text
browser -> same-origin /api/local-ai/* -> MedalForge server
        -> http://127.0.0.1:1234 -> stable-diffusion.cpp + local model
```

There is no API charge and no hosting inference-compute fee. The user still
supplies the computer, model download, disk space, RAM/VRAM, GPU or CPU time,
and electricity. Performance and output quality depend on that hardware and the
installed model.

### One-click local setup

No customer-facing setup instructions are required. The first Create click:

1. Checks the operating system, memory, and free disk space.
2. Downloads a pinned Windows x64 Vulkan engine, Z-Image Turbo Q3 model, Qwen3
   text encoder, and VAE into `%LOCALAPPDATA%\MedalForge\local-ai`.
3. Resumes partial downloads and reports byte-accurate progress.
4. Verifies the expected size and SHA-256 digest of every downloaded file.
5. Safely extracts the engine, rejecting archive paths outside the staging
   directory.
6. Starts the native image process hidden on loopback and waits for its health
   endpoint.
7. Automatically continues the image request that initiated setup.

The managed setup currently supports 64-bit Windows and requires at least 12 GB
of system memory. Its download is about 5.6 GiB. Setup is never started on page
load, during build, or by tests; it requires the explicit Create action. The UI
supports cancellation and a later click resumes an interrupted download.
The native process is assigned below-normal OS priority when permitted. A cold
start is deferred with a friendly retryable message if the computer has less
than 1 GiB immediately available, rather than risking a machine-wide stall.

Setup routes are loopback-only:

- `GET /api/local-ai/setup/status`
- `POST /api/local-ai/setup`
- `POST /api/local-ai/setup/cancel`

`MEDALFORGE_SD_URL` can override the port, but the server accepts only a plain
HTTP loopback origin (`127.0.0.1` or `::1`) with no credentials, path, query, or
fragment. Remote generators and redirects are rejected. The optional
`MEDALFORGE_SD_TIMEOUT_MS` value is clamped to the server's allowed job-timeout
range.

Free local mode currently supports the local MedalForge app, where the app
server and `sd-server` run on the same computer. A future hosted website needs a
separately installed, signed, authenticated local companion and an explicit
user-approved connection. The existing loopback proxy must not simply be
exposed to remote origins.

### Local browser contract

`GET /api/local-ai/status` checks the native
`GET /sdcpp/v1/capabilities` endpoint. It returns HTTP 200 with
`available: false` and a structured setup error when the helper is stopped.
When ready, its defaults and limits include:

```json
{
  "ok": true,
  "available": true,
  "provider": "stable-diffusion.cpp",
  "api": "sdcpp-native-async",
  "defaults": { "size": "1024x1024", "quality": "high", "count": 1 },
  "limits": {
    "sizes": ["1024x1024", "1024x1536", "1536x1024"],
    "qualities": ["low", "medium", "high"],
    "minCount": 1,
    "maxCount": 4
  }
}
```

`POST /api/local-ai/generate` queues a same-origin JSON request:

```json
{
  "prompt": "A photorealistic night running medal concept in Prague",
  "count": 1,
  "size": "1024x1024",
  "quality": "high"
}
```

The UI offers photorealistic medal, photorealistic subject, illustration,
graphic, and silhouette prompt modes. Sizes are 1024 × 1024, 1024 × 1536, and
1536 × 1024; count is 1–4. Local quality maps directly to sampling work:

| Quality | Sample steps |
| --- | ---: |
| Low | 4 |
| Medium | 6 |
| High | 8 |

The route returns HTTP 202 with a job ID and safe same-origin status URL:

```json
{
  "ok": true,
  "provider": "stable-diffusion.cpp",
  "job": {
    "id": "00000000-0000-0000-0000-000000000000",
    "status": "queued",
    "progress": 0,
    "statusUrl": "/api/local-ai/jobs/00000000-0000-0000-0000-000000000000"
  }
}
```

The browser polls `GET /api/local-ai/jobs/:id` until `completed`, `failed`, or
`cancelled`. Cancelling in the editor sends
`POST /api/local-ai/jobs/:id/cancel`; MedalForge then makes a best-effort call
to the native helper's matching cancellation route so an abandoned job does
not keep consuming the user's GPU or CPU.
When 2–4 images are requested, MedalForge sends one native image at a time and
combines the ordered results. This keeps native `batch_count` at 1 and bounds
peak memory use while retaining the four-variant customer workflow.
Completed jobs contain up to four base64 PNG images. MedalForge accepts only
same-origin browser requests, bounds its local queue and response sizes, and
accepts upstream polling URLs only from the configured loopback origin.

## GPT Image 2 cloud mode

This is an operator feature, not customer setup. For local development, the app
owner can copy the example file and add a project-scoped key:

```powershell
Copy-Item .env.example .env
# Edit .env and set OPENAI_API_KEY. Never commit this file.
pnpm run dev
```

`pnpm run dev` and `pnpm start` load `.env` through Node's
`--env-file-if-exists` option. In a hosted deployment, set `OPENAI_API_KEY` as a
protected server/worker secret, not as a public build variable. A static file
host alone cannot securely provide this optional mode.

Customers are never asked for a key. A ChatGPT subscription or ChatGPT browser
session is not an API credential for an independent website, so MedalForge does
not present a misleading “Sign in with ChatGPT” shortcut. If the site owner
enables cloud generation, customers simply click Create and the owner accounts
for that service through MedalForge's own access or credit model.

The server calls `https://api.openai.com/v1/images/generations` with
`gpt-image-2`, rejects redirects, applies a three-minute timeout, limits request
and response sizes, and allows at most two concurrent upstream generations.

### Structured OpenAI text-to-medal contract

When the same protected `OPENAI_API_KEY` is present,
`GET /api/openai-medal/status` advertises whether structured planning is ready,
the configured model, and the authentication limitations. It deliberately
reports that browser API keys and ChatGPT-subscription login are unsupported.

`POST /api/openai-medal/generate` accepts only a brief and optional public print
settings:

```json
{
  "brief": "Prague midnight 10K, 5 May 2027, premium moon and runner",
  "nozzle": 0.4,
  "layerHeight": 0.2,
  "baseThickness": 2.4,
  "reliefHeight": 0.6
}
```

The server uses the Responses API with strict JSON-schema output, normalizes
the result through the trusted `MedalDesignPlan` v1 boundary, reapplies the
user's printer settings, and returns only the safe plan plus token counts. Raw
model output, API credentials, and upstream error bodies are never returned.

### Cloud browser contract

`GET /api/cloud-image/status` reports whether the server has a key without
revealing it. `POST /api/cloud-image/generate` accepts:

```json
{
  "prompt": "A photorealistic night runner in Prague, isolated against a clean background",
  "count": 1,
  "size": "1024x1024",
  "quality": "high"
}
```

`prompt` must contain 3–8,000 characters; count is 1–4. Accepted sizes are
`1024x1024`, `1024x1536`, and `1536x1024`; quality is `low`, `medium`, or `high`.
A successful response contains base64 PNG data plus provider, model, size,
quality, and count metadata. Both cloud endpoints reject cross-origin browser
requests. The proxy sends the key only in its server-to-OpenAI authorization
header and does not return credentials or raw provider errors.

## Removed browser-model path

The previous Janus/Transformers.js WebGPU implementation and its model bundle
have been removed from the project. Free local mode uses the separate native
`sd-server` process so image inference cannot exhaust and crash the browser tab.

## Structured local text-to-medal planning

Text-to-medal does not need to pass through a raster image. MedalForge exposes
a same-origin planning bridge that always returns a constrained
`MedalDesignPlan` v1 object:

- `GET /api/local-ai/medal-plan/status`
- `POST /api/local-ai/medal-plan`

The one-click request is deliberately small:

```json
{
  "brief": "Prague night half marathon, 21 km, 5 May 2027",
  "manufacturing": {
    "nozzle": 0.4,
    "layerHeight": 0.2,
    "baseThickness": 2.4,
    "reliefHeight": 0.6,
    "maxElements": 64
  },
  "preferModel": true
}
```

The response contains structured event identity, visual direction, filament
roles, locked manufacturing constraints, and four body/rim/attachment variants:

```json
{
  "ok": true,
  "plan": { "schema": "MedalDesignPlan", "version": 1 },
  "generation": {
    "provider": "deterministic-local",
    "enhanced": false,
    "fallback": false
  }
}
```

The browser integration is:

```js
import { LocalMedalPlanProvider } from './local-medal-provider.js';
import { generateMedalConcepts } from './concept-engine.js';

const provider = new LocalMedalPlanProvider();
const { plan } = await provider.generate({ brief, manufacturing });
const { concepts } = generateMedalConcepts(plan);
```

With no language model installed, this runs the deterministic local parser
immediately—no account, key, download, inference fee, or network request. An
optional already-running OpenAI-compatible local model can improve semantic
planning by setting `MEDALFORGE_LLM_URL` to a loopback chat-completions endpoint
such as `http://127.0.0.1:8080/v1/chat/completions`. `MEDALFORGE_LLM_MODEL` and
`MEDALFORGE_LLM_TIMEOUT_MS` select its model and bounded deadline.

Model output is never trusted as project data directly. It is size-limited,
parsed as strict JSON, stripped to the fixed plan schema, normalized, validated,
and forced to retain the user's nozzle/layer/base constraints and flat back.
Only one model plan runs at once. Less than 768 MiB free memory, a busy model,
timeout, offline server, malformed response, or invalid plan causes an immediate
deterministic fallback. Remote model hosts, credentials in URLs, redirects, and
cross-origin browser requests are rejected.
