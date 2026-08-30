# MedalForge parametric CAD and slicer architecture

## Decision

The editable source of truth must be a versioned `MedalDocument` feature graph,
not STL, 3MF, or STEP. Each medal body, ribbon opening, text, image contour,
sketch, transform, pocket, inlay, and extrusion remains a named parametric
feature. A CAD worker rebuilds an exact B-Rep from that graph. STEP, display
meshes, 3MF/STL, and G-code are derived artifacts.

```text
MedalDocument JSON (features, parameters, transforms, source assets)
        |
        v
Replicad + OpenCascade worker ----> exact B-Rep ----> STEP
        |
        +----> coarse/fine display mesh ----> interactive 3D editor
        |
        +----> print mesh / 3MF ----> Kiri:Moto or helper ----> real G-code preview
```

STEP preserves exact topology and geometry but not MedalForge's editable feature
history. The JSON document therefore remains the project file; STEP is an exact
interchange/export. This follows OpenCascade's separation of B-Rep modeling from
application persistence and undo. See the [OCCT overview](https://dev.opencascade.org/doc/overview/html/index.html)
and [STEP translator guide](https://dev.opencascade.org/doc/occt-7.9.0/overview/html/occt_user_guides__step.html).

## Chosen open-source components

1. **Exact browser CAD: [Replicad](https://github.com/sgenoud/replicad) +
   OpenCascade WASM.** Replicad is MIT and provides a practical TypeScript API
   for sketches, text, extrusions, booleans, fillets, chamfers, tessellation,
   and [STEP export](https://replicad.xyz/docs/api/functions/exportSTEP/).
   Its documentation explicitly recommends running the kernel in a
   [Web Worker](https://replicad.xyz/docs/use-as-a-library/). The OCCT WASM is
   about 22–23 MB raw, so it must be lazy-loaded only when the editor first needs
   exact CAD. Keep it behind a `CadKernelAdapter` so it can be upgraded without
   changing the document schema.

2. **Optional mesh/relief lane: [Manifold](https://github.com/elalish/manifold),
   Apache-2.0.** It is a small, robust WASM mesh kernel for imported STL and
   dense photographic height fields. It is not B-Rep and must not be advertised
   as analytic STEP. AI logos and silhouettes should instead be vectorized into
   closed curves and extruded by OCCT.

3. **Browser slicer: [Kiri:Moto](https://github.com/GridSpace/grid-apps), MIT.**
   It already slices locally and exposes G-code/layer/toolpath workflows through
   its [engine API](https://grid.space/kiri/engine.html) and
   [frame API](https://grid.space/kiri/frame.html). Self-host and pin it; lazy
   load it only in Print Preview and release its worker afterward. Slicing is
   CPU/memory intensive, so the ordinary CAD editor must remain independent.

4. **Optional production slicer helper: [PrusaSlicer CLI](https://github.com/prusa3d/PrusaSlicer/wiki/Command-Line-Interface),
   AGPL-3.0.** PrusaSlicer has no official browser API. A later signed loopback
   helper can run a pinned `prusa-slicer-console.exe --export-gcode` with fixed
   arguments, a per-session token, private temporary directories, file limits,
   and timeouts. Render the returned G-code itself so the on-screen paths are
   exactly the file offered for download.

5. **Experimental only: official CuraEngine WASM.** Upstream Emscripten support
   and `@ultimaker/curaenginejs` are real, but the current package is alpha,
   single-threaded, CLI/virtual-filesystem oriented, and AGPL. Re-evaluate after
   it has a stable package and profile API; do not make it the first slicer.

6. **Default free local image generation:
   [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp), MIT.**
   A separately installed native `sd-server` and model perform inference on the
   user's GPU or CPU; [Z-Image Turbo](https://github.com/leejet/stable-diffusion.cpp/blob/master/docs/z_image.md)
   is the recommended photorealistic starting point. The browser calls
   MedalForge's same-origin `/api/local-ai/*` routes, and the local app server
   proxies only to `http://127.0.0.1:1234` (or another explicitly configured
   loopback port). The UI defaults to one 1024 × 1024 image, supports portrait
   and landscape outputs plus batches of one to four, and maps low, medium, and
   high quality to 4, 8, and 12 sampling steps. This mode has no API or hosting
   inference fee, but uses the user's hardware, electricity, memory, disk, and
   separately downloaded model. It is supported by the current local app; a
   hosted site will need a signed, authenticated, user-approved local companion.

7. **Optional cloud source-image generation: [GPT Image 2](https://platform.openai.com/docs/guides/image-generation).**
   The browser calls only MedalForge's same-origin server route. That proxy reads
   `OPENAI_API_KEY` from `.env` locally or a protected hosting secret, validates
   the request, and calls OpenAI; the key never enters browser code. Users can
   request one to four PNGs at 1024 × 1024, 1024 × 1536, or 1536 × 1024 and low,
   medium, or high quality. This paid path remains available when strongest
   photorealistic quality is preferred.

8. **Local printable-image conversion: [VTracer](https://github.com/visioncortex/vtracer),
   MIT, planned for smooth curve output.** A chosen generated PNG follows the
   same local workflow as an upload: crop and background cleanup, palette
   reduction, minimum-width repair, filament assignment, physical sizing, and
   relief placement. Convert logo and line-art regions to closed Bézier paths
   before OCCT extrusion. Photographic bas-relief stays in the separate mesh
   lane described below.

Neither supported generator loads a model into the browser tab or uses browser
WebGPU. The former Janus/Transformers.js implementation and bundled runtime have
been removed from the project; its roughly 2.25 GiB model cache is no longer a
supported customer workflow. `stable-diffusion.cpp` is supported but remains a
separate user installation; MedalForge does not bundle native executables or
model weights.

## Feature graph

Every node has a stable ID, type, parameters, operation, material, workplane,
dependencies, and revision. A minimal schema is:

```text
MedalDocument
  profile: nozzle, layer height, printer/color system
  materials: filament references and design-color assignments
  features[]
    MedalBase: outline sketch + thickness
    RibbonAttachment: type + standardized clearance parameters
    SketchText / SketchPath / SketchImageContours
    Extrude: raise | pocket | through-cut | inlay, signed depth
    Transform: workplane-local XY, angle, scale
    Fillet / Chamfer (later)
  groups[]
  preview: camera and non-exported ribbon visualization
```

Front and back are explicit workplanes with their own readable orientation.
Text remains text until the CAD worker converts its font outline; changing a
string therefore edits one parameter rather than replacing a mesh. During drag,
the display object moves immediately and only the settled feature graph rebuilds.
Push/pull keeps OK/Cancel because it changes manufacturing intent; ordinary
move, scale, and rotate commit on pointer-up as one undo step.

## Two honest image pipelines

- Logos, silhouettes, AI line art: background cleanup -> palette reduction ->
  VTracer Bézier paths -> geometric minimum-width repair -> OCCT wires/faces ->
  exact extrusion. This is STEP-ready.
- Photographs and grayscale bas-relief: sampled height field -> Manifold mesh ->
  3MF/STL. It may coexist with B-Rep features, but the relief itself is a mesh.
  A faceted STEP conversion would only disguise the mesh and bloat the file.

## Implementation phases

1. Freeze `MedalDocument v1`, add migrations, schema validation, deterministic
   hashing, and golden fixtures for blank, Ivanka, and Archívna medals.
2. Add a lazy `cad-worker` with Replicad/OCCT. Implement base outlines, ribbon
   cuts, text/path sketches, front/back extrudes, pockets, inlays, and transforms.
3. Return transferable coarse meshes while dragging and fine meshes at rest.
   Preserve stable feature/picking IDs separately from fused production solids.
4. Export STEP and re-import it in the worker; verify valid solids, volume, and
   bounds. Keep aligned 3MF parts for colors.
5. Keep Free local requests behind the same-origin, loopback-only proxy. Validate
   input and native responses, bound the queue and timeouts, and test offline,
   malformed, cancellation, and unsafe-poll-address cases. Design a separately
   signed and authenticated companion before enabling this mode on a hosted site.
6. Keep GPT Image requests behind the separate same-origin cloud proxy. Enforce
   request, concurrency, response, and timeout limits and map provider errors to
   stable non-secret responses.
7. Add VTracer WASM and switch image/logo geometry from raster cells to curves.
8. Self-host Kiri:Moto and connect the exact exported print mesh to its slicer.
   Cache by document + tessellation + slicer version + printer profile hash.
9. Add the optional PrusaSlicer helper only after the browser flow is stable.

## Verification gates

- Re-import every STEP and compare solid count, validity, bounds, and volume.
- The toolpath viewer must render the same G-code that is downloadable.
- Each gesture creates one undo record; cancelled push/pull restores the exact
  pre-gesture graph.
- Compare top-down renders of Archívna and Ivanka fixtures to the supplied photos
  using silhouette/edge distance plus manual screenshot review.
- Test 0.2, 0.4, 0.6, and 0.8 mm nozzle constraints at both curve repair and
  slicer preflight.

License note: Replicad, Manifold, Kiri:Moto, VTracer, and
stable-diffusion.cpp are permissive, but locally installed model weights can
have separate terms. OCCT WASM carries LGPL-2.1 plus the Open CASCADE exception;
PrusaSlicer and CuraEngine are AGPL. GPT Image is a hosted commercial service
rather than an open-source component, so its current API terms and data-handling
requirements must be reviewed separately. Packaging/distribution obligations
require legal review even when an AGPL slicer is kept as a separate process.
