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
  for (const label of ['3D', 'Front side', 'Back side', 'Edge', 'Side', 'Fit view', 'Print layers', 'Snapshot']) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /id="a11yStatus"[^>]*aria-live="polite"/);
});

test('beginner creation controls include safe text fitting and the expanded symbol library', async () => {
  const app = await read('app.js');
  for (const phrase of ['Auto-fit long text', 'Starting position', 'Classic serif', 'Finish flag', 'Trophy', 'Runner']) assert.match(app, new RegExp(phrase));
  assert.match(app, /newShapeSize/);
  assert.match(app, /fitSelectedInsideMedal/);
  assert.match(app, /duplicateSelectedToOtherSide/);
  assert.match(app, /textInput\.blur\(\);/);
  assert.doesNotMatch(app, /renderSelectionHud\(input\.dataset/);
});

test('the hosted image flow does not render an unavailable generator as a disabled primary action', async () => {
  const app = await read('app.js');
  assert.match(app, /hostedStatic \? '' : '<button type="button" class="action-card" id="createImagePrimary"/);
  assert.doesNotMatch(app, /id="createImagePrimary" \$\{hostedStatic \? 'disabled'/);
  assert.match(app, /const artworkActions = hostedStatic/);
  assert.doesNotMatch(app, /image-create-disclosure friendly-disclosure" open/);
});

test('checks, pricing, and export use honest outcome language', async () => {
  const app = await read('app.js');
  for (const phrase of ['Show item', 'Fix automatically', 'Estimate only', 'No blocking issues', 'Print it myself', 'Send to a print maker', 'Send a preview & estimate', 'Continue in CAD']) assert.match(app, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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
  assert.match(hub, /release20/);
  assert.match(studio, /styles\.css\?v=20260831-release20/);
  assert.match(studio, /app\.js\?v=20260831-release20/);
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
  assert.match(sync, /20260831-release20/);
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
