# PrintForge

PrintForge is a local-first platform for focused, parametric 3D-product studios.
The root page is a workspace gallery with Medal Studio and Voronoi lattice.
Future studios can reuse the same browser geometry, materials, image
cleanup, pricing, validation, storage, and export foundation while exposing only
the controls that matter for their product.

**Live preview:** [Open PrintForge on GitHub Pages](https://jakubgal.github.io/printforge-medal-designer/)

MedalForge is a CAD-style workspace for users without CAD experience: orbit
above or below the medal, hover exact printable faces, place correctly oriented
artwork on either side, drag and scale objects directly on the model, and use
the selected object's Z arrow for live raise, pocket, inlay, or through-cut
feedback. Manual drawing uses a transparent sketch plane over the live 3D model
instead of switching to a separate flat editor.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the static release and custom-domain
plan, [QA_CHECKLIST.md](./QA_CHECKLIST.md) and
[QA_REPORT_2026-08-30.md](./QA_REPORT_2026-08-30.md) for verification, and
[OPEN_SOURCE_ARCHITECTURE.md](./OPEN_SOURCE_ARCHITECTURE.md) for the exact
Replicad/OpenCascade B-Rep and STEP migration plus Kiri:Moto/PrusaSlicer path.

The current user-data explanation is in [PRIVACY.md](./PRIVACY.md), and shipped
open-source runtime notices are in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

MedalForge is a local-first browser editor for designing multicolor, 3D-printable medals. It uses a manufacturing-focused 2.5D model: one support-free medal body with independently raised, engraved, inlaid, or through-cut artwork at multiple heights. This keeps the workflow approachable while still producing slicer-ready, validated solids.

## Run locally

The editor needs Node.js 22 or newer. Install the pinned packages and start the
app:

```powershell
pnpm install
pnpm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) for the PrintForge studio
gallery, then open Medal Studio. The Image shelf defaults to **On this
computer**. On its first **Create image** click, MedalForge
automatically downloads the pinned open-source image engine and Z-Image Turbo
files, verifies every file, installs them in its own app-data folder, starts the
engine in the background, and continues the original image request. There are
no commands, model paths, accounts, or API keys in the customer workflow.

The current managed installer supports 64-bit Windows, requires at least 12 GB
of system memory, and downloads about 5.6 GiB once. Interrupted downloads resume.
No AI download starts during app launch, build, or tests; it starts only after
the user clicks the image-creation button. The installed files live under
`%LOCALAPPDATA%\MedalForge\local-ai` by default.

GPT Image 2 remains an optional best-quality cloud mode. To enable it, copy
`.env.example` to `.env`, set a project-scoped `OPENAI_API_KEY`, and restart the
app. Never commit `.env`.

The same protected server key can optionally enable structured text-to-medal
planning. `GET /api/openai-medal/status` exposes safe capability metadata and
`POST /api/openai-medal/generate` turns an event brief into a normalized,
editable `MedalDesignPlan` with four directions. The browser never accepts an
API key. A ChatGPT login or subscription is not API authorization; API usage is
configured and billed separately by the site operator.

`pnpm run dev` loads `.env` when it exists and starts the same-origin app server.
For Free local mode it proxies only to the loopback helper; for cloud mode the
OpenAI key stays in the Node process and is never sent to browser code.

The generated framework scaffold is retained for future hosted services. The
current deployable release is a static site: editing, image cleanup, geometry,
pricing, validation, storage, and exports run in the browser. `pnpm run build`
validates the source and copies browser assets into `public/`; it does not
download or ship an AI model. Use
`pnpm run sync:static` when only those assets need refreshing.

## Included in this MVP

### Voronoi lattice studio

The studio includes editable project save/open with the source mesh, a JSON
geometry report, unit conversion, uniform model resizing, and density/thickness
controls with both sliders and precise millimeter inputs.

Use **Measure & set scale** to click two points on the original STL, enter their
desired straight-line distance in millimeters, and uniformly resize the whole
model about its center. Picking uses actual source triangles and supports
orbiting between points. The optional **Scale lattice settings with the model**
control preserves cell, wall, skin, cap, and custom sampling proportions. Imported
STLs inherit proportional lattice settings; saved projects retain their own
settings. Very small or large imports show a unit/scale notice because STL files
do not declare physical units.

Surface and internal 3D strut modes construct explicit rods with circular,
rectangular or regular polygon cross-sections. Rectangle aspect ratio, polygon
side count and profile rotation remain editable. Continuous swept profiles
follow curved surface paths, and compact joints are fused using the local
[Manifold Boolean kernel](https://manifoldcad.org/docs/jsapi/documents/Using_Manifold.html).
These modes do not use a voxel lattice surface. Quality changes circular profile
tessellation and curved path accuracy. The kernel and its license ship with the
static site, so uploaded meshes remain on the device.

Surface rods follow Voronoi boundaries on the actual STL surface and retain
their full cross-section, including the half outside the original surface.
**Surface inset** moves the centerlines inward. Internal rods follow actual
Voronoi cell edges and are trimmed to the original solid. Cellular walls, 2D
extrusions and optional solid shells still use sampling; automatic resolution
accounts for source dimensions, cell size and the thinnest requested features.

Open **Voronoi lattice** in the gallery, or visit
[http://127.0.0.1:4173/workspaces/voronoi/](http://127.0.0.1:4173/workspaces/voronoi/).
Import an ASCII or binary STL, or start from a built-in example, to generate a
cellular structure clipped to the model. All mesh processing runs locally in
the browser, with generation in a cancellable worker.

- True internal **3D ribs** follow Voronoi cell junctions throughout the volume;
  **3D cellular walls** follow the faces separating neighboring cells.
- **2D extruded** patterns extend through the model, while **surface rods**
  form connected curves along its exterior.
- Adjust cell size, strut or wall thickness, outer shell, random seed, and
  sampling quality; regenerate reproducible variations without re-uploading.
- Orbit, zoom, inspect the original source, and use a live cutaway to see
  internal cells. Export the generated geometry as binary STL.

STL contains no unit metadata; dimensions are interpreted in millimeters.
Cellular walls and optional shells sample an implicit material field, so quality
and model size set the smallest detail they can reproduce. Thin sampled features
may disappear; higher quality costs time and memory. Rod profiles remain
polygonal STL approximations, and very thick rods can merge adjacent cells.
Use the displayed resolution and mesh diagnostics to choose suitable settings
and inspect the exported STL in a slicer. These checks describe the mesh;
they do not certify structural strength or replace mechanical simulation.

### Medal Studio

- Circle, oval, rounded, hexagon, shield, or hand-drawn/custom medal bodies with single, double, or no ribbon slot.
- A guided clean start, one-click reset, and editable example gallery including the supplied photo-inspired medals with independent front and back object sets.
- Eight captioned, sub-30-second Quick guides recorded from the real editor, with a single lightweight player, written steps, a complete-workflow overview, and a direct return to the interactive beginner guide.
- One model-first CAD workspace with unrestricted underside orbit, exact front/back face placement, direct 3D object dragging, linked or free X/Y scale handles, a rotation handle, immediate planar-gesture commit, a live push/pull Z handle with numeric feedback and explicit OK/Cancel, exact layer inspection, and a transparent face-aligned sketch overlay for manual drawing.
- One contextual Add shelf for editable text, PNG/JPEG/SVG/DXF artwork, shapes, and drawing; printer/material settings stay in a separate global defaults drawer.
- Printable attachment presets for an external bar, double bar, internal round hole, closed slit, quick-load open slit, or no attachment, each with only its relevant dimensions.
- Per-object Raise, Engrave, Inlay, and Cut operations with layer-snapped or exact heights/depths and replace/stack overlap behavior.
- Manual Brush, Line, filled Polygon, whole-object Erase, and Measure tools in physical millimeters, with grid/axis/vertex snapping and 15° angle locking.
- A selectable WebGL print-model view built from the production mesh, with orbit, pan, zoom, camera presets, perspective/orthographic projection, filled material-colored layer cross-sections, color-part visibility, explode view, build grid, a configurable non-exported 3D ribbon preview, and mesh/material statistics.
- An exact physical-layer preview compiled from the same material/air field used for export.
- PNG, JPEG, and safe SVG import through a printable-image editor with crop, edge-connected background removal, color/silhouette/high-contrast/outline effects, selectable filament colors, a printable-cell preview, worker palette quantization, minimum-feature cleanup, and automatic reprocessing when the nozzle or filament palette changes.
- Basic 2D DXF import for LINE, LWPOLYLINE/POLYLINE, CIRCLE, and ARC entities.
- One to sixteen named design colors selected from a local filament inventory database; add or remove slots as the design needs them.
- A persistent front/back CAD tree with per-object selection, visibility and locking, plus named groups that can be transformed, duplicated, locked, or hidden as one undoable operation.
- Inventory fields for color, brand, material, effect, density, stock grams, price/kg, source URL, last-checked date, and abrasive-hardware requirements. The starter catalog includes clearly marked, locally editable examples from European and Asian suppliers; unknown stock is never presented as available stock.
- Nozzle-aware checks for 0.2, 0.4, 0.6, and 0.8 mm profiles, editable layer height, multicolor-process compatibility, material-family compatibility, loop strength, stock, and abrasive hardware.
- Live quantity pricing for 1, 10, 25, 50, and 100 pieces, upgraded to exact mesh volume and per-filament density/cost after geometry compilation.
- IndexedDB project autosave with localStorage fallback.
- Editable project JSON with a sanitized filament snapshot, design SVG, aligned per-color binary STL ZIP, and multicolor 3MF export behind exact local mesh preflight.
- Image cleanup, color separation, printable-feature repair, geometry, previews,
  and exports run on the user’s device. AI source images can be generated by the
  automatically managed local image maker or the optional cloud service.

## Text-to-medal and image generation

The Ideas shelf turns one ordinary event description into four complete,
editable front-and-back medal projects. Free mode works locally with no account,
download, API key, or inference bill. It plans the event text, subject, palette,
body, edge, attachment and deliberate relief tiers, then builds smooth vector
objects rather than pasting the request or a flattened picture onto the medal.
Every result is scored for typography, hierarchy, balance, spacing, focal art,
palette, manufacturability and detail continuity; a concept below the 9/10
release gate is withheld instead of being presented as finished.

An optional server-managed OpenAI planner can produce the same constrained
`MedalDesignPlan` and feed it into the local geometry engine. The browser never
accepts an API key. ChatGPT login/subscription is not third-party API
authentication, so hosted OpenAI mode must be enabled by the site operator with
a protected server credential. Free local mode remains the default and fallback.

The Image shelf separately defaults to Free local generation through an
automatically installed and managed `stable-diffusion.cpp` server.
It supports photorealistic medal and subject prompts, defaults to one
1024 × 1024 image, and also offers portrait (1024 × 1536), landscape
(1536 × 1024), one to four images, and low/medium/high quality. Those quality
choices map to 4/6/8 local sampling steps.

Free local mode has no API charge and consumes no hosting inference compute, but
it uses the user's own GPU or CPU, electricity, memory, disk space, and a model
download. GPT Image 2 remains an optional paid best-quality mode through the
secure same-origin cloud proxy. Neither mode loads an AI model into the browser
tab or uses browser WebGPU.

The managed engine runs below normal OS priority when the platform permits it.
Requests for multiple concepts are generated one variant at a time, preserving
the requested order while avoiding a memory-heavy native batch.

Only the prompt and selected settings are sent when the user clicks Generate.
In cloud mode the OpenAI API key remains in `.env` locally or in a protected
hosting secret after deployment. Every chosen result opens in the same local
printable-image editor as an upload: crop and background cleanup,
simplification, color separation, filament mapping, minimum-feature repair,
physical sizing, and placement as editable printable relief. See
[LOCAL_AI_API.md](./LOCAL_AI_API.md).

## Starting manufacturing rules

The provisional nominal extrusion width is `1.125 × nozzle diameter`. One line is treated as the minimum; two lines are the robust target.

| Nozzle | One-line minimum | Robust target |
| ---: | ---: | ---: |
| 0.2 mm | 0.225 mm | 0.45 mm |
| 0.4 mm | 0.45 mm | 0.90 mm |
| 0.6 mm | 0.675 mm | 1.35 mm |
| 0.8 mm | 0.90 mm | 1.80 mm |

These are engineering starting points, not production guarantees. Before taking paid orders, print calibration coupons for every supported printer, slicer profile, nozzle, material family, speed, and ribbon-loop geometry. Replace the provisional rules with measured values.

## Storage and deployment boundary

Local projects and the filament catalog are stored in IndexedDB. Uploaded
artwork stays inside the local project record and is not sent to the generation
service. AI generation sends the entered prompt and output settings only after
an explicit Generate action—to the loopback helper in Free local mode or through
the protected proxy in cloud mode. Returned images are edited locally.

The generated `public/` artifact is ready for static preview hosting. It has no
database or object-storage binding. Projects, filament stock, preferences, and
uploaded artwork remain in the visitor's browser origin. Automatic local AI
installation is available only through the local/desktop companion; a static
website cannot silently install or launch native software on a visitor's
computer. Optional managed AI also needs protected server routes and is not
part of the static artifact.

A future account, ordering, or managed-AI version should add:

1. D1 tables for filament lots, price versions, projects, users, quote snapshots, orders, and compute jobs.
2. R2 storage for source artwork and generated production packages.
3. Guest design with optional accounts; do not require sign-in to try the editor.
4. A scale-to-zero CPU queue for paid slicer verification only. Keep ordinary geometry and previews in browser workers.
5. Content-addressed caching by project, asset, engine, and production-profile hash.
6. A signed and authenticated local companion before offering Free local
   generation from a hosted website. The current loopback proxy is for the local
   MedalForge app and must not be opened to remote origins.
7. An optional protected `OPENAI_API_KEY` hosting secret for cloud generation.
   Never expose it through client JavaScript or a public environment variable.
8. Strict pixel, path, triangle, memory, CPU, request, and timeout limits for
   server jobs.

## Important limits

- This is a 2.5D medal composer, not arbitrary CAD.
- Raster photos are simplified into flat filament regions; gradients and normal dithering are intentionally excluded.
- DXF support is a declared 2D subset.
- 3MF/STL geometry is generated with an adaptive nozzle-scaled grid, regularized into closed face-connected solids, and checked for manifold edges, consistent winding, positive volume, and finite coordinates. Always inspect the final package in the target printer's slicer.
- A normal single-extruder printer cannot print arbitrary side-by-side colors without AMS/MMU/multiple extruders or an insert/assembly workflow.
- The price shown is an estimate. A production-verified quote needs a real slicer result.
- G-code is intentionally not generated because it depends on the exact printer and production setup.
- The in-app layer view shows exact design solids and material ownership, but is not a replacement for printer-specific G-code slicing, supports, speeds, temperatures, purge volumes, or motion simulation.
- Free local generation requires compatible local hardware. MedalForge installs
  and starts its pinned model automatically after the first explicit Create
  click. It has no API or hosting-compute fee but still uses the user's
  electricity, storage, GPU/CPU time, and memory. Current managed setup supports
  64-bit Windows and assumes the app server and image engine run on the same
  computer.
- Optional GPT Image generation requires a configured server-side key, network
  access, account quota, and paid API usage.
- A generated raster image from either mode is source artwork and must pass the
  normal local print cleanup and manufacturability checks.
