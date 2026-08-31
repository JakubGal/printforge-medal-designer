# PrintForge release checklist

This checklist covers the complete customer path from the workspace gallery to
manufacturing files. Run it against both `http://127.0.0.1:4173/` and every
hosted preview. Use a fresh browser profile for persistence tests and the
ephemeral `?qa=` fixtures for repeatable interaction tests.

## Automated gate

- [ ] `pnpm install --frozen-lockfile` completes with pnpm 11.19.0 and Node 22+.
- [ ] `pnpm lint` completes with no errors.
- [ ] `pnpm test` completes with no failures.
- [ ] `pnpm build:static` validates the static module graph, 404 behavior,
  security boundaries, worker policy, and OpenCascade asset size.
- [ ] A missing `.js` URL returns HTTP 404 and `text/html`, never the hub with
  status 200.
- [ ] `/.git/config`, `/.env`, and `/package.json` are not served.

## Workspace gallery

- [ ] The PrintForge hub loads without console errors at `/`.
- [ ] Medal Studio is visibly marked **Ready now** and opens
  `/workspaces/medals/`.
- [ ] Skådis Organizer Studio and Custom Product Studio are clearly marked as
  planned and cannot be mistaken for working links.
- [ ] Every header, hero, card, and footer Medal Studio link opens the same
  canonical workspace route.
- [ ] The hub and Studio fit without horizontal overflow at 1600, 1440, 900,
  560, 375, and 320 CSS-pixel viewport widths; persistent and overlay panels
  behave correctly at their breakpoints.
- [ ] Chromium, Firefox, and Safari/WebKit complete WebGL, WebAssembly, worker,
  dialog, persistence, and download smoke tests on supported desktop systems.
- [ ] An old root URL such as `/?qa=final-premium-medal` redirects to the Medal
  Studio and preserves the full query string.

## Start, save, and restore

- [ ] A first visit opens the guided new-medal flow.
- [ ] Blank start guides the user through starting template, body/size, ribbon
  attachment and summary before opening the editor.
- [ ] The Medal panel then exposes thickness, base/edge materials, edge style,
  attachment details, and advanced body controls without crowding the wizard.
- [ ] Cancel closes the wizard without destroying the current project.
- [ ] New medal/reset requires an explicit choice and returns to a predictable
  clean state.
- [ ] Project name and explicit Save remain available on mobile; name edits
  autosave, Save reports success, and reload restores the
  same project and filament catalog on the same origin.
- [ ] Example gallery opens, loads both-sided examples, and restores
  focus to the button that opened it.
- [ ] Guides opens from its desktop label and mobile `?`; all eight chapters
  load into one player, show a poster, play with controls, and expose English
  captions plus written steps without autoplaying.
- [ ] Every guide is shorter than 30 seconds and demonstrates the current live
  labels and workflow rather than an obsolete or mocked interface.
- [ ] Changing chapters pauses and resets the player; closing the dialog stops
  and unloads media, then returns focus to the Guides button.
- [ ] Restart interactive guide closes the video library and reopens the current
  Medal/Add/operation/back/check/export step; Start a new medal opens the wizard.
- [ ] The quick-start card's Watch overview action opens the first guide and the
  library remains usable at 1440, 900, 560, 375, and 320 CSS pixels.
- [ ] Dialogs and drawers trap keyboard focus, close with Escape, and return
  focus to their invoker.

## 3D navigation and direct editing

- [ ] Orbit reaches the top, edge, and full underside; Shift/right-drag pans;
  wheel/pinch zooms.
- [ ] Iso, Top, Bottom, Front, Right, Fit, Perspective, top zoom +/- and Solo
  controls visibly
  change the camera.
- [ ] Hover highlights actual medal and artwork faces; top and bottom placement
  use the correctly oriented face.
- [ ] Bottom-side artwork stays flat/inlaid with the underside and never creates
  unsupported relief below the build plate.
- [ ] Clicking an object selects the matching tree row and inspector.
- [ ] Move, rotation, X/Y resize, aspect-lock, and uniform corner handles update
  the solid live; their keyboard arrows also work.
- [ ] Text can be edited after placement and updates immediately without a stale
  copy at its previous position.
- [ ] Push/pull shows its live millimetre value; Raise, Engrave, Inlay, Cut,
  Fill pocket, OK, and Cancel produce the stated result.
- [ ] Global Delete, arrows, Enter, and shortcuts do not fire while a button or
  form control has focus.
- [ ] Undo and Redo restore direct edits, panel edits, grouping, and deletion.

## Create tools

- [ ] Text places a readable live preview, then remains editable and scalable.
- [ ] Upload accepts PNG, JPEG, SVG, and the declared DXF subset; crop, cleanup,
  effects, segmentation, palette mapping, physical size, and placement work.
- [ ] Imported artwork preserves aspect ratio unless the user explicitly
  unlocks it; separated regions become independently editable objects.
- [ ] Shapes place, move, resize, recolor, group, hide, lock, duplicate, and
  delete correctly.
- [ ] Brush, line, polygon, erase, and measure work on the face-aligned sketch
  plane; Finish sketch returns to the same 3D camera context.
- [ ] Add color is available from every creation workspace and opens the same
  filament chooser with color, material, effect, stock, and price information.
- [ ] Hosted static mode labels image AI as unavailable rather than probing
  nonexistent `/api` routes; uploaded artwork and deterministic Ideas continue
  to work.
- [ ] Local/desktop mode starts its companion only after an explicit image
  request and never during app launch, build, or tests.
- [ ] Ideas converts an event description into structured editable front/back
  designs; it never pastes the raw prompt as medal text.

## Medal and material controls

- [ ] Circle, oval, rounded, hexagon, octagon, scalloped, star, gear, shield, and
  custom bodies update the model; a selected closed path can become the body and
  then be restored for editing.
- [ ] Overall thickness changes the body and valid relief/cut limits.
- [ ] The 2, 2.4, 3, and 4 mm thickness presets and manual value agree with the
  layer count and finished-thickness readout.
- [ ] Edge styles reach the body boundary cleanly, including none, rim, double,
  scalloped, faceted, laurel, and victory wings.
- [ ] Base and edge colors can be set independently and appear in preview,
  checks, quote, and export.
- [ ] External bar, double bar, round hole, closed slit, quick-load slit, and no
  attachment update dimensions and produce printable geometry.
- [ ] 22, 25, and 38 mm ribbon-fit presets add practical clearance and update the
  correct attachment fields.
- [ ] Color slots can be added and removed up to the documented limit; existing
  object assignments remain valid or are repaired predictably.
- [ ] Material/effect choices include normal, silk, glow, wood, temperature
  change, galaxy/glitter, carbon-filled, and other catalog entries with abrasive
  warnings where relevant.
- [ ] Nozzle, layer height, multicolor method, minimum feature rules, inventory,
  density, price/kg, and stock feed the manufacturability checks and quote.
- [ ] Filament chooser stock/custom tabs, search, filters, effects, and custom
  filament creation return the chosen slot to the control that opened it.

## Objects and layers

- [ ] Front/back tree counts and names match visible objects.
- [ ] Tree selection works with mouse and keyboard; hide and lock do what their
  icons state.
- [ ] Groups can be created, renamed, transformed, duplicated, hidden, locked,
  ungrouped, and deleted without orphaning elements.
- [ ] Reordering and moving objects between sides preserves their geometry and
  underside constraint.
- [ ] Layers opens 3D inspection rather than a dead tab.
- [ ] Layer scrub, explode, grid, ribbon preview/color, per-color visibility,
  and Show all update immediately.
- [ ] Open exact 2D slice shows the same physical build, slider labels are valid,
  and Back to 3D restores inspection mode.

## Checks, price, and production files

- [ ] Geometry blockers are distinguished from stock-only warnings; missing
  stock does not incorrectly disable CAD generation.
- [ ] Quantity changes recalculate material, machine, setup, margin, unit, and
  total estimates.
- [ ] PNG preview downloads the current camera view.
- [ ] Project JSON, multicolor SVG, technical PDF, 3MF, STL bundle, and exact
  B-Rep STEP download and open in appropriate independent viewers.
- [ ] Exported project JSON re-imports into a fresh project with matching medal,
  object tree, palette, front/back faces, and production settings.
- [ ] The export dialog shows progress and remains responsive during large
  geometry jobs; a memory estimate never silently lowers detail.
- [ ] Cancelling or closing export leaves the design usable.
- [ ] The technical PDF contains clear front/back/angled views, dimensions,
  material/color information, weight, quantity, unit/total price, and warnings.
- [ ] 3MF/STL are manifold and use aligned origins; STEP imports as exact solids;
  all formats match the on-screen front and back.

## Release sign-off record

For static-host behavior use
`/workspaces/medals/?qa=workflow&runtime=static`. QA fixtures avoid project,
inventory, and preference writes; use a disposable browser profile for the
separate persistence test.

Record the date, commit, browser/OS, viewport, fixture, result, console errors,
downloaded-file checks, and tester for every deployment candidate. A visual
pass is required in addition to automated tests; a passing test suite alone is
not production approval.
