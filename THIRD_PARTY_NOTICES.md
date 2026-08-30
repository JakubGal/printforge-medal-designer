# Third-party runtime notices

The static PrintForge artifact packages the Replicad OpenCascade.js single-
threaded runtime for exact B-Rep/STEP generation:

- `replicad-opencascadejs` 1.0.0
- License: LGPL-2.1-only
- Packaged license: `public/assets/medals/cad-kernel/LICENSE.txt`
- Package source/project metadata: distributed by the
  `replicad-opencascadejs` npm package

The WebAssembly and JavaScript runtime are lazy-loaded only when exact STEP
generation needs them. Preserve the packaged license and comply with the LGPL's
source/relinking requirements when distributing the site.

Development/build dependencies are recorded in `package.json` and
`pnpm-lock.yaml`; they are not copied wholesale into the static `public/`
artifact. Before a commercial launch, generate and review a complete dependency
license inventory for the exact lockfile and attach any additional notices it
requires.

The optional local AI companion and model files are not part of the static
artifact. Their upstream licenses and links are disclosed inside the local
image-generation information dialog and must ship with any future desktop
installer.
