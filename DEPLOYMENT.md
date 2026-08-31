# PrintForge deployment plan

## Recommendation

Use **Cloudflare Pages** for the public product site. The present release is a
fully static, local-first application, so ordinary editing and export requests
do not consume server CPU. Cloudflare Pages supports custom domains, preview
deployments, response-header rules, and a 25 MiB maximum for one site asset. The
release validator keeps the lazy OpenCascade WebAssembly kernel under that
limit.

Keep the checked-in **GitHub Pages** workflow as a preview/demo option, not the
commercial production host. GitHub's published limits state that Pages is not
intended for online business or commercial SaaS. A Pages preview is still useful
for internal review or an open-source demonstration.

Official references:

- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Cloudflare Pages routing and 404 behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [Cloudflare Pages `_headers` rules](https://developers.cloudflare.com/pages/configuration/headers/)
- [Cloudflare Pages direct upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Cloudflare Workers free-plan limits](https://developers.cloudflare.com/workers/platform/limits/)
- [GitHub Pages limits and usage policy](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/github-pages-limits)
- [GitHub Pages and custom domains](https://docs.github.com/en/pages)

The public GitHub Pages preview is live at
[jakubgal.github.io/printforge-medal-designer](https://jakubgal.github.io/printforge-medal-designer/)
from the `main` branch of
[JakubGal/printforge-medal-designer](https://github.com/JakubGal/printforge-medal-designer).
It is the review/demo origin, not the eventual commercial production domain.
No custom DNS record or paid service is configured.

## What the static release includes

The generated `public/` directory contains:

- the PrintForge multi-workspace landing page;
- the complete Medal Studio at `/workspaces/medals/`;
- client-side 3D viewing and direct editing;
- image upload, cleanup, segmentation, color separation, and object placement;
- deterministic text-to-medal concepts generated in the browser;
- local IndexedDB projects, filament inventory, preferences, and pricing;
- printability checks and exact layer inspection;
- client-side PNG, SVG, PDF, JSON, 3MF, STL, and STEP generation;
- eight locally hosted, captioned Quick guide videos and WebP posters;
- the lazy-loaded OpenCascade kernel needed for exact B-Rep/STEP export.

The static release intentionally does **not** include:

- automatic installation or launching of the 5.6 GiB Windows local-AI
  companion from a remote website;
- GPT Image or managed OpenAI medal planning;
- user accounts, cloud project sync, orders, payments, or a maker marketplace;
- server-side slicing or production verification.

A remote browser cannot silently install and execute native software on a
customer's computer. Free image generation therefore remains a feature of the
local/desktop edition. The hosted Image panel explains this boundary and still
supports importing artwork created elsewhere. No API key is embedded in the
static files.

## Reproducible release gate

Use Node.js 22 and the pinned pnpm 11.19.0 package manager:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build:static
pnpm test:release
```

`pnpm build:static` recreates `public/` from an explicit allowlist and then
checks the full module/worker graph, ready-workspace routes, required HTML
files, security-header configuration, secret boundaries, and the Cloudflare
single-file size limit. `pnpm test:release` starts that exact artifact on an
ephemeral local port and verifies status codes, redirects, MIME types, cache
headers, CSP, 404s, and private-file boundaries. Neither command packages
`.env`, `.git`, `package.json`, or local AI model files.

Preview the exact artifact locally with:

```powershell
pnpm start
```

Then open `http://127.0.0.1:4173/`. The server returns a real 404 document for
unknown routes and redirects `/workspaces/medals` to the canonical trailing
slash route while preserving its query string.

## Cloudflare Pages setup

Create a Pages project connected to the future Git repository and use:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Production branch | `main` |
| Build command | `pnpm build:static` |
| Build output directory | `public` |
| Node version | `22.16.0` (tested; any future choice must remain >=22.13) |
| Environment variable | `NODE_VERSION=22.16.0` |
| Environment variable | `PNPM_VERSION=11.19.0` |
| Root directory | repository root |

Recommended rollout:

1. Push a reviewed `main` branch to a private or public Git host.
2. Connect it to Cloudflare Pages and create a preview deployment first.
3. Run the checklist in `QA_CHECKLIST.md` against the preview URL on desktop
   and mobile.
4. Add the supplied domain only after preview sign-off. Prefer one canonical
   hostname (for example `app.example.com`) and redirect the alternative host.
5. Let Cloudflare provision HTTPS, then verify the apex/`www` redirect, the
   workspace URL, downloads, and a real 404 before announcing the site.
6. Keep the previous successful deployment available for instant rollback.

The explicit `PNPM_VERSION` matters because Cloudflare's current build image
does not infer this repository's pnpm version automatically. See the official
[Cloudflare build-image reference](https://developers.cloudflare.com/pages/configuration/build-image/).

The repository's `_headers` file sets general security headers everywhere,
strict page policies for the hub and Medal Studio, and the narrower
`unsafe-eval` exception required only by the OpenCascade STEP worker. A physical
top-level `404.html` prevents Cloudflare's automatic SPA fallback from rewriting
missing asset requests to HTML.

## GitHub Pages preview setup

`.github/workflows/deploy-pages.yml` already installs frozen dependencies, runs
lint and tests, builds the static artifact, and uploads only `public/`. It runs
on manual dispatch or a push to `main`.

The repository, `main` branch, GitHub Actions Pages source, HTTPS preview, and
first successful workflow deployment are configured. Future reviewed pushes to
`main` automatically rerun all release gates and replace the preview only after
the build succeeds. A manual run remains available from the Actions tab.

The site uses relative asset and workspace URLs, includes `.nojekyll`, and its
404 home link detects a GitHub repository subpath. Do not use this route as the
commercial PrintForge host without first confirming that the intended use is
compatible with GitHub's current Pages terms.

GitHub Pages does not interpret Cloudflare's `_headers` file. The demo will not
receive those response headers unless a separate fronting service supplies
them; this is another reason Cloudflare Pages is the recommended public host.

## Later hosted services

Keep the editor static and add server compute only where it creates real value.
An economical next backend is a small Cloudflare Worker or Pages Function for:

- `/api/openai-medal/*` and `/api/cloud-image/*`, with the provider key stored as
  a server secret;
- optional authentication and signed project-sync requests;
- quote/order submission and local-maker routing.

Do not proxy ordinary geometry, previews, image cleanup, or exports through the
backend. Those already run on the customer's device. Use object storage only
for projects that users explicitly choose to sync, and a queue only for paid
printer-specific slice verification. Design the APIs as separately deployable
capabilities so every workspace can reuse them.

## Origin and data migration

IndexedDB and localStorage belong to an exact web origin. Projects created at
`127.0.0.1`, a Pages preview hostname, and the final custom domain do not
automatically follow the user between those origins. Before changing domains:

1. ask active testers to export project JSON;
2. keep the old origin available during migration;
3. import the JSON at the new canonical origin;
4. avoid changing the final hostname after launch.

Treat project JSON as the portable backup until account-based synchronization
is intentionally implemented.
