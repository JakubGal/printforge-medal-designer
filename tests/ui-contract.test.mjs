import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

test('the release audit contains exactly 100 sequential resolved review points', async () => {
  const audit = await read('MEDAL_STUDIO_AUDIT_100.md');
  const numbers = [...audit.matchAll(/^([1-9]\d*)\. \*\*/gm)].map(match => Number(match[1]));
  assert.deepEqual(numbers, Array.from({ length: 100 }, (_, index) => index + 1));
  assert.doesNotMatch(audit, /\b(?:TODO|OPEN BLOCKER|NOT TESTED)\b/i);
});

test('static editor IDs are unique and include the novice project controls', async () => {
  const html = await read('workspaces/medals/index.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['myMedalsButton', 'myMedalsRailButton', 'newDesignButton', 'examplesButton', 'globalSettingsButton', 'exportButton']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('the 3D workspace exposes camera and keyboard controls accessibly', async () => {
  const html = await read('workspaces/medals/index.html');
  assert.match(html, /id="modelCanvas"[^>]*tabindex="0"[^>]*Keyboard:/);
  for (const label of ['3D', 'Front side', 'Back side', 'Edge', 'Side', 'Fit view', 'Print layers', 'Render images']) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /id="a11yStatus"[^>]*aria-live="polite"/);
});

test('beginner creation controls include safe text fitting and the expanded symbol library', async () => {
  const [app, shapes] = await Promise.all([read('app.js'), read('shape-library.js')]);
  for (const phrase of ['Auto-fit long text', 'Starting position', 'Classic serif']) assert.match(app, new RegExp(phrase));
  for (const phrase of ['Finish flag', 'Trophy', 'Male runner', 'Female runner', 'Sprinter', 'Trail runner', 'Alpine ridge', 'Mountain range', 'Snow summit', 'Layered range', 'Trail to summit', 'Mountain sunrise']) assert.match(shapes, new RegExp(phrase));
  assert.match(app, /newShapeSize/);
  assert.match(app, /shapeSvgMarkup\(shape\.id, 1\)/);
  assert.match(app, /shape-library-group/);
  assert.doesNotMatch(app, /\['runner','➜'/);
  assert.match(app, /fitSelectedInsideMedal/);
  assert.match(app, /duplicateSelectedToOtherSide/);
  assert.match(app, /textInput\.blur\(\);/);
  assert.doesNotMatch(app, /renderSelectionHud\(input\.dataset/);
});

test('new-medal setup shows exact live body and ribbon geometry instead of generic icons', async () => {
  const [app, preview, styles] = await Promise.all([read('app.js'), read('medal-preview.js'), read('styles.css')]);
  assert.doesNotMatch(app, /const attachmentIcons\s*=/);
  assert.match(app, /wizardLivePreviewMarkup/);
  assert.match(app, /data-wizard-live-preview/);
  assert.match(app, /data-wizard-shape-preview/);
  assert.match(app, /wizardAttachmentChoiceMarkup/);
  assert.match(app, /fitInternalAttachmentToBody/);
  for (const key of ['wizardUi.livePreview', 'wizardUi.finishedFootprint', 'wizardUi.ribbon']) assert.match(app, new RegExp(key.replace('.', '\\.')));
  assert.doesNotMatch(app, /const titles = \['Choose a starting point'/);
  assert.doesNotMatch(app, /attachment\.label\.toLowerCase\(\)/);
  assert.doesNotMatch(app, /project\.medal\.shape\[0\]\.toUpperCase/);
  assert.match(app, /shapeCategoryUi\.raceDay/);
  assert.match(app, /stockStatusUi\.\$\{status\.key\}/);
  assert.match(preview, /medalAttachmentGeometry/);
  assert.match(preview, /presetMedalOutlinePoints/);
  assert.match(preview, /data-preview-attachment/);
  assert.match(preview, /medalOverallSizeLabel/);
  assert.match(styles, /\.medal-top-view/);
  assert.match(styles, /\.wizard-live-preview/);
});

test('the hosted image flow does not render an unavailable generator as a disabled primary action', async () => {
  const app = await read('app.js');
  assert.match(app, /hostedStatic \? '' : '<button type="button" class="action-card" id="createImagePrimary"/);
  assert.doesNotMatch(app, /id="createImagePrimary" \$\{hostedStatic \? 'disabled'/);
  assert.match(app, /const artworkActions = hostedStatic/);
  assert.doesNotMatch(app, /image-create-disclosure friendly-disclosure" open/);
});

test('checks, pricing, and export use honest outcome language', async () => {
  const [app, localization] = await Promise.all([read('app.js'), read('localization.js')]);
  const source = `${app}\n${localization}`;
  for (const phrase of ['Show item', 'Fix automatically', 'Estimate only', 'No blocking issues', 'Print it myself', 'Send to a print maker', 'Send a preview & estimate', 'Continue in CAD']) assert.match(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(app, /Production-verified server quote|Coming later/);
});

test('plain-language operations replace the old visible CAD labels', async () => {
  const [html, app] = await Promise.all([read('workspaces/medals/index.html'), read('app.js')]);
  const source = `${html}\n${app}`;
  assert.doesNotMatch(source, /CAD tree|Surface operation|Make pocket/);
  for (const label of ['Raised', 'Recessed', 'Flat color', 'Hole']) assert.match(source, new RegExp(label));
});

test('cache-busted release assets and static hosting validation stay aligned', async () => {
  const [hub, studio] = await Promise.all([read('index.html'), read('workspaces/medals/index.html')]);
  assert.match(hub, /release35/);
  assert.match(studio, /styles\.css\?v=20260901-release35/);
  assert.match(studio, /app\.js\?v=20260901-release35/);
});

test('Render Studio reuses the live medal safely and exposes complete image workflows', async () => {
  const [studio, app, viewer, renderStudio, styles, sync] = await Promise.all([
    read('workspaces/medals/index.html'),
    read('app.js'),
    read('viewer3d.js'),
    read('render-studio.js'),
    read('styles.css'),
    read('sync-static.mjs'),
  ]);
  assert.match(studio, /id="savePreview"[^>]*>Render images</);
  for (const hook of ['openRenderStudio', 'captureRenderStudioImage', 'composeImageGrid', 'renderCompareDownload', 'renderViewsDownload']) {
    assert.match(app, new RegExp(hook));
  }
  assert.match(app, /state\.viewer\.sceneState\(\)/);
  assert.match(app, /renderStudioCanvasHost[^\n]+prepend\(modelCanvas\)/);
  assert.match(app, /session\.viewer\.restoreScene\(session\.editorScene\)/);
  assert.match(app, /\$\('#dialogBody'\)\.scrollTop = 0/);
  assert.match(app, /settings\.mode === 'glow'/);
  assert.match(viewer, /uniform float uEmissionStrength/);
  assert.match(viewer, /uniform float uAlbedoStrength/);
  assert.match(viewer, /async toPngBlob\(options = \{\}\)/);
  assert.match(viewer, /cannot create the requested/);
  assert.match(renderStudio, /RENDER_EXPORT_RESOLUTIONS/);
  assert.match(renderStudio, /flags\.glow && darkScene/);
  assert.match(styles, /\.render-studio-dialog/);
  assert.match(styles, /\.render-preview-shell #modelCanvas/);
  assert.match(sync, /'render-studio\.js'/);
});

test('phone, touch, reduced-motion, and high-contrast contracts remain present', async () => {
  const [studio, styles] = await Promise.all([read('workspaces/medals/index.html'), read('styles.css')]);
  assert.match(studio, /id="myMedalsRailButton"/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /\.mobile-only-tool \{ display: flex; \}/);
  assert.match(styles, /@media \(pointer: coarse\)/);
  assert.match(styles, /min-width: 44px; min-height: 44px/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /@media \(forced-colors: active\)/);
  assert.match(studio, /class="transform-hit"[^>]*width="44" height="44"/);
  assert.match(styles, /\.project-title \{ display: none; \}/);
});

test('project safety and export cancellation keep their asynchronous guarantees', async () => {
  const [app, storage, sync] = await Promise.all([read('app.js'), read('storage.js'), read('sync-static.mjs')]);
  assert.match(storage, /tx\.oncomplete/);
  assert.match(storage, /tx\.onabort/);
  assert.match(app, /saveRevision/);
  assert.match(app, /productionMeshesForExport/);
  assert.match(app, /abortController\?\.abort\(\)/);
  assert.match(app, /productionKinds\.has\(button\.dataset\.export\) && blocked/);
  assert.match(sync, /'shape-library\.js'/);
  assert.match(sync, /'guide-library\.js'/);
  assert.match(sync, /20260901-release35/);
});

test('quick video guides use one accessible captioned player and keep the interactive guide available', async () => {
  const [studio, app, styles, headers, server] = await Promise.all([
    read('workspaces/medals/index.html'),
    read('app.js'),
    read('styles.css'),
    read('_headers'),
    read('server.mjs'),
  ]);
  assert.match(studio, /id="helpButton"[^>]*aria-label="Open quick guide videos"/);
  assert.match(studio, /<span class="help-label-full">Guides<\/span>/);
  assert.match(studio, /id="watchQuickGuide"[^>]*>▶ Watch 29-sec overview<\/button>/);
  assert.match(app, /function openGuideLibrary/);
  assert.match(app, /<video id="guideVideo" controls playsinline preload="metadata"/);
  assert.match(app, /kind="captions" srclang="en" label="English"/);
  assert.doesNotMatch(app, /<video id="guideVideo"[^>]*autoplay/);
  assert.match(app, /id="restartInteractiveGuide">Restart interactive guide/);
  assert.match(app, /id="guideStartNewMedal">Start a new medal/);
  assert.match(app, /video\.pause\(\)/);
  assert.match(app, /removeAttribute\('src'\)/);
  assert.match(styles, /\.guide-library-layout/);
  assert.match(styles, /\.guide-video-frame video[^}]*aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(headers, /media-src 'self'/);
  assert.match(server, /'\.mp4': 'video\/mp4'/);
  assert.match(server, /'\.vtt': 'text\/vtt; charset=utf-8'/);
});

test('viewer and item controls expose unambiguous native controls', async () => {
  const [studio, app] = await Promise.all([read('workspaces/medals/index.html'), read('app.js')]);
  assert.match(studio, /id="projectionToggle" data-projection="perspective"[^>]*>View: Perspective</);
  assert.match(studio, /data-empty-tool="shapes">Symbol/);
  assert.match(app, /class="layer-select" data-layer-id=/);
  assert.doesNotMatch(app, /data-layer-id[^\n]+role="button"/);
  assert.match(app, /quantityInput\.addEventListener\('blur'/);
  assert.match(app, /if \(element\) setCameraPreset\(element\.face === 'back' \? 'bottom' : 'top'\)/);
  assert.doesNotMatch(app, /if \(element && !elementFaceTowardsCamera\(element\)\) setCameraPreset/);
});
