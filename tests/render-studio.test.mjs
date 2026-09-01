import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RENDER_SCENE,
  MAX_RENDER_EXPORT_DIMENSION,
  MAX_RENDER_EXPORT_PIXELS,
  RENDER_BACKGROUND_PRESETS,
  RENDER_EXPORT_RESOLUTIONS,
  RENDER_SCENE_PRESETS,
  classifyFilamentEffect,
  deriveFilamentRenderMaterial,
  isDarkRenderScene,
  normalizeRenderExportSize,
  normalizeRenderResolution,
  normalizeRenderSettings,
  resolveRenderBackground,
} from '../render-studio.js';

test('four deterministic render presets cover normal light, dark-room, and glow workflows', () => {
  assert.equal(DEFAULT_RENDER_SCENE, 'studio');
  assert.deepEqual(Object.keys(RENDER_SCENE_PRESETS), ['daylight', 'studio', 'dark', 'glow']);
  assert.equal(Object.isFrozen(RENDER_SCENE_PRESETS), true);
  assert.equal(Object.isFrozen(RENDER_SCENE_PRESETS.studio.light), true);
  assert.deepEqual(normalizeRenderSettings('daylight'), normalizeRenderSettings({ preset: 'daylight' }));
  assert.equal(isDarkRenderScene('daylight'), false);
  assert.equal(isDarkRenderScene('studio'), false);
  assert.equal(isDarkRenderScene('dark'), true);
  assert.equal(isDarkRenderScene({ mode: 'glow' }), true);
});

test('scene sliders normalize invalid input and clamp browser-safe rendering values', () => {
  const scene = normalizeRenderSettings({
    presetId: 'dark',
    lightAzimuth: 999,
    lightElevation: -999,
    lightIntensity: 42,
    ambient: -2,
    lightSoftness: .34567,
    exposure: 9,
    glowStrength: -1,
    bloom: 99,
    shadowStrength: 2,
    temperatureC: 500,
  });
  assert.deepEqual(scene.light, { azimuth: 180, elevation: -10, intensity: 3, ambient: 0, softness: .346 });
  assert.equal(scene.exposure, 2.5);
  assert.equal(scene.glowStrength, 0);
  assert.equal(scene.bloom, 2);
  assert.equal(scene.shadowStrength, 1);
  assert.equal(scene.temperatureC, 80);
  assert.equal(scene.background.id, 'graphite');
  assert.equal(scene.mode, 'dark');
  assert.equal(normalizeRenderSettings({ preset: 'not-real' }).presetId, 'studio');
});

test('backgrounds resolve named presets, custom solids, gradients, and transparency', () => {
  const named = resolveRenderBackground('midnight');
  assert.equal(named.id, 'midnight');
  assert.equal(named.type, 'gradient');
  assert.equal(named.transparent, false);
  assert.equal(named.topRgb.length, 3);
  assert.ok(named.luminance < .01);

  const solid = resolveRenderBackground('#AbC');
  assert.deepEqual({ type: solid.type, top: solid.topColor, bottom: solid.bottomColor }, {
    type: 'solid', top: '#aabbcc', bottom: '#aabbcc',
  });
  const custom = resolveRenderBackground({ type: 'gradient', topColor: '#ffffff', bottomColor: '#000000' });
  assert.equal(custom.topColor, '#ffffff');
  assert.equal(custom.bottomColor, '#000000');
  assert.equal(custom.luminance, .5);
  assert.equal(resolveRenderBackground('transparent').transparent, true);
  assert.deepEqual(resolveRenderBackground('not-a-background').topRgb, resolveRenderBackground('studio-light').topRgb);
  assert.equal(Object.isFrozen(RENDER_BACKGROUND_PRESETS), true);
});

test('filament recognition supports glow, finish, particle, fibre, and thermal effects', () => {
  assert.equal(classifyFilamentEffect({ effect: 'Glow in dark' }).flags.glow, true);
  assert.equal(classifyFilamentEffect({ effect: 'Fluorescent green' }).flags.glow, true);
  assert.equal(classifyFilamentEffect({ effect: 'Phosphorescent' }).flags.glow, true);
  assert.equal(classifyFilamentEffect({ effect: 'Silk' }).flags.silk, true);
  assert.equal(classifyFilamentEffect({ effect: 'Matte' }).flags.matte, true);
  assert.equal(classifyFilamentEffect({ effect: 'Galaxy / glitter' }).flags.galaxy, true);
  assert.equal(classifyFilamentEffect({ effect: 'Wood-filled' }).flags.wood, true);
  assert.equal(classifyFilamentEffect({ effect: 'Carbon fiber-filled' }).flags.carbon, true);
  assert.equal(classifyFilamentEffect({ effect: 'Temperature changing' }).flags.thermo, true);
  assert.equal(classifyFilamentEffect({ effect: 'Solid' }).kind, 'solid');
});

test('only glow-capable filament emits and only in an explicit dark or glow scene', () => {
  const filament = { id: 'glow-green', color: '#8ed17d', effect: 'Glow in dark' };
  const daylight = deriveFilamentRenderMaterial(filament, 'daylight');
  const studio = deriveFilamentRenderMaterial(filament, 'studio');
  const dark = deriveFilamentRenderMaterial(filament, 'dark');
  const glow = deriveFilamentRenderMaterial(filament, 'glow');
  assert.equal(daylight.emissionStrength, 0);
  assert.equal(studio.emissionStrength, 0);
  assert.equal(dark.emissionStrength, .816);
  assert.equal(glow.emissionStrength, 1.8);
  assert.ok(glow.emissionStrength > dark.emissionStrength);
  assert.equal(deriveFilamentRenderMaterial({ effect: 'Solid' }, 'glow').emissionStrength, 0);
  assert.equal(deriveFilamentRenderMaterial(filament, { preset: 'glow', glowStrength: .5 }).emissionStrength, .5);
});

test('special finishes expose stable shader parameters without changing across calls', () => {
  const silk = deriveFilamentRenderMaterial({ effect: 'Silk', color: '#d3a63d' }, 'studio');
  const matte = deriveFilamentRenderMaterial({ effect: 'Matte', color: '#202a2f' }, 'studio');
  assert.ok(silk.specular > matte.specular);
  assert.ok(silk.roughness < matte.roughness);

  const galaxyInput = { id: 'galaxy-purple', name: 'Galaxy Purple', color: '#6c4f86', effect: 'Galaxy' };
  const galaxy = deriveFilamentRenderMaterial(galaxyInput, 'studio');
  assert.equal(galaxy.sparkle, .68);
  assert.equal(galaxy.flags.galaxy, true);
  assert.deepEqual(galaxy, deriveFilamentRenderMaterial(structuredClone(galaxyInput), 'studio'));

  const wood = deriveFilamentRenderMaterial({ effect: 'Wood-filled' });
  const carbon = deriveFilamentRenderMaterial({ effect: 'Carbon fiber-filled' });
  const thermoCold = deriveFilamentRenderMaterial({ effect: 'Temperature changing' }, { temperatureC: 18 });
  const thermoHot = deriveFilamentRenderMaterial({ effect: 'Temperature changing' }, { temperatureC: 40 });
  assert.equal(wood.flags.wood, true);
  assert.equal(wood.woodGrain, .72);
  assert.equal(carbon.flags.carbon, true);
  assert.equal(carbon.carbonWeave, .78);
  assert.equal(thermoCold.flags.thermo, true);
  assert.equal(thermoCold.thermoShift, 0);
  assert.equal(thermoHot.thermoShift, 1);
});

test('export dimensions use only deliberate quality tiers and preserve common aspects', () => {
  assert.deepEqual(RENDER_EXPORT_RESOLUTIONS, [1024, 2048, 3072]);
  assert.equal(normalizeRenderResolution(1200), 1024);
  assert.equal(normalizeRenderResolution(1900), 2048);
  assert.equal(normalizeRenderResolution(99_999), 3072);
  assert.deepEqual(normalizeRenderExportSize({ resolution: 2048, aspect: 'square' }), {
    width: 2048, height: 2048, resolution: 2048, qualityTier: 2,
    aspect: '1:1', aspectRatio: 1, pixels: 4_194_304, safe: true,
  });
  assert.deepEqual(normalizeRenderExportSize({ resolution: 2048, aspect: 'portrait' }), {
    width: 1638, height: 2048, resolution: 2048, qualityTier: 2,
    aspect: '4:5', aspectRatio: .799805, pixels: 3_354_624, safe: true,
  });
  const wide = normalizeRenderExportSize({ resolution: 3072, aspect: '16:9' });
  assert.deepEqual({ width: wide.width, height: wide.height, aspect: wide.aspect }, { width: 3072, height: 1728, aspect: '16:9' });
});

test('arbitrary and oversized image requests retain aspect while respecting hard caps', () => {
  const oversized = normalizeRenderExportSize({ width: 12_000, height: 5_000 });
  assert.equal(oversized.resolution, MAX_RENDER_EXPORT_DIMENSION);
  assert.equal(oversized.width, 3072);
  assert.equal(oversized.height, 1280);
  assert.equal(oversized.aspect, 'custom');
  assert.equal(oversized.safe, true);
  assert.ok(oversized.pixels <= MAX_RENDER_EXPORT_PIXELS);

  const extreme = normalizeRenderExportSize({ resolution: 3072, aspect: '100:1' });
  assert.equal(extreme.width, 3072);
  assert.ok(extreme.height >= 1280);
  assert.equal(extreme.safe, true);
});
