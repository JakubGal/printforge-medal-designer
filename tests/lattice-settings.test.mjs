import test from 'node:test';
import assert from 'node:assert/strict';
import { presetLatticeOptions, scaleLatticeOptions, resizeSourceMesh } from '../lattice-settings.js';

const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= Math.max(tolerance, Math.abs(expected) * tolerance), `${actual} should equal ${expected}`);
const source = () => ({
  positions: new Float32Array([9, 18, 27, 11, 18, 27, 9, 22, 33]),
  bounds: { min: [9, 18, 27], max: [11, 22, 33], size: [2, 4, 6] },
  stats: { triangles: 1, volumeMm3: 12, surfaceAreaMm2: 22, watertight: false },
  warnings: ['Example source warning.'],
});

test('every preset keeps identical geometric proportions for the tiny hand and a 200 mm source', () => {
  const tinySpan = 1.5869860649108887;
  const tiny = { size: [tinySpan, 1.371302843093872, .8257735967636108] };
  const large = { size: tiny.size.map(value => value * 200 / tinySpan) };
  for (const name of ['open', 'dense', 'shelled', 'skin', 'cellular', 'planar']) {
    const a = presetLatticeOptions(name, tiny, { seed: 0, quality: 'fine' });
    const b = presetLatticeOptions(name, large, { seed: 0, quality: 'fine' });
    for (const key of ['cellSize', 'thickness', 'shellThickness', 'surfaceInset']) close(a[key] / tinySpan, b[key] / 200);
    assert.equal(a.seed, 0, 'zero is a reproducible seed');
    assert.equal(a.quality, 'fine');
    assert.equal(a.resolution, 0);
    assert.equal(a.keepLargest, false);
  }
  const open = presetLatticeOptions('open', tiny);
  close(open.thickness, tinySpan * .04);
  close(open.thickness / open.cellSize, .2);
  assert.ok(open.thickness < .2, 'small-source presets must not acquire the old absolute .2 mm floor');
  assert.throws(() => presetLatticeOptions('missing', tiny), /Unknown lattice/);
});

test('custom scaling changes every physical dimension and preserves dimensionless settings without mutation', () => {
  const options = { mode: 'surface', cellSize: 8, thickness: 1.6, shellThickness: .8, surfaceInset: .35, surfaceDepth: 2.4, bottomThickness: .4, topThickness: 0, resolution: .3, stretch: [1, 2, .5], seed: 0, quality: 'fine', randomness: .72, gradientAxis: 'z', gradientStrength: -.2, keepLargest: true, rodProfile: 'rectangle', rodAspect: .4, rodSides: 7, rodRotation: 37 };
  const original = structuredClone(options);
  const scaled = scaleLatticeOptions(options, 2.5);
  for (const key of ['cellSize', 'thickness', 'shellThickness', 'surfaceInset', 'surfaceDepth', 'bottomThickness', 'topThickness', 'resolution']) close(scaled[key], options[key] * 2.5);
  for (const key of ['mode', 'seed', 'quality', 'randomness', 'gradientAxis', 'gradientStrength', 'keepLargest', 'rodProfile', 'rodAspect', 'rodSides', 'rodRotation']) assert.equal(scaled[key], options[key]);
  assert.deepEqual(scaled.stretch, options.stretch);
  assert.notEqual(scaled.stretch, options.stretch);
  scaled.stretch[0] = 3;
  assert.deepEqual(options, original);
  assert.equal(scaleLatticeOptions({ ...options, resolution: 0 }, 100).resolution, 0, 'automatic sampling remains automatic');
});

test('switching starting points preserves every selected rod profile and its dimensionless parameters', () => {
  for (const rodProfile of ['circle', 'rectangle', 'polygon']) {
    const current = { rodProfile, rodAspect: .375, rodSides: 9, rodRotation: 117.5, seed: 0 };
    for (const name of ['open', 'dense', 'shelled', 'skin', 'cellular', 'planar']) {
      const selected = presetLatticeOptions(name, { size: [40, 30, 20] }, current);
      for (const key of ['rodProfile', 'rodAspect', 'rodSides', 'rodRotation']) assert.equal(selected[key], current[key], `${name} should preserve ${key}`);
      assert.equal(selected.surfaceInset, 0, 'new surface rods begin centered on the source surface');
      const resized = scaleLatticeOptions(selected, .03967465);
      for (const key of ['rodProfile', 'rodAspect', 'rodSides', 'rodRotation']) assert.equal(resized[key], current[key], `resizing should preserve ${key}`);
      assert.equal(resized.surfaceInset, 0, 'zero inset remains exactly zero');
    }
  }
});

test('old settings acquire safe profile defaults and invalid profile values are normalized for presets', () => {
  const defaults = presetLatticeOptions('open', { size: [40, 30, 20] });
  assert.equal(defaults.rodProfile, 'circle');
  assert.equal(defaults.rodAspect, 1);
  assert.equal(defaults.rodSides, 6);
  assert.equal(defaults.rodRotation, 0);
  const normalized = presetLatticeOptions('skin', { size: [40, 30, 20] }, { rodProfile: 'invalid', rodAspect: -1, rodSides: 99, rodRotation: -90 });
  assert.equal(normalized.rodProfile, 'circle');
  assert.equal(normalized.rodAspect, .25);
  assert.equal(normalized.rodSides, 12);
  assert.equal(normalized.rodRotation, 270);
  assert.throws(() => scaleLatticeOptions({ surfaceInset: -1 }, 2), /valid surfaceInset/);
});

test('resizing preserves the original center and independently clones geometry, bounds, statistics and warnings', () => {
  const mesh = source(), original = structuredClone(mesh);
  const scaled = resizeSourceMesh(mesh, 2);
  assert.deepEqual(scaled.bounds, { min: [8, 16, 24], max: [12, 24, 36], size: [4, 8, 12] });
  assert.deepEqual(scaled.bounds.min.map((value, axis) => (value + scaled.bounds.max[axis]) / 2), [10, 20, 30]);
  assert.equal(scaled.stats.volumeMm3, 96);
  assert.equal(scaled.stats.surfaceAreaMm2, 88);
  assert.equal(scaled.stats.triangles, 1);
  assert.notEqual(scaled.positions, mesh.positions);
  assert.notEqual(scaled.stats, mesh.stats);
  assert.notEqual(scaled.warnings, mesh.warnings);
  scaled.positions[0] = 999;
  scaled.warnings.push('Additional warning.');
  assert.deepEqual(mesh, original);
});

test('an explicit anchor stays fixed and actual Float32 output determines bounds', () => {
  const mesh = source();
  const scaled = resizeSourceMesh(mesh, .5, [9, 18, 27]);
  assert.deepEqual(Array.from(scaled.positions.slice(0, 3)), [9, 18, 27]);
  assert.deepEqual(scaled.bounds, { min: [9, 18, 27], max: [10, 20, 30], size: [1, 2, 3] });
});

test('invalid factors, physical dimensions and coordinate overflow fail before a resized model is returned', () => {
  for (const factor of [0, -1, Infinity, NaN, '2']) {
    assert.throws(() => scaleLatticeOptions({ cellSize: 1 }, factor), /positive, finite/);
    assert.throws(() => resizeSourceMesh(source(), factor), /positive, finite/);
  }
  for (const options of [{ thickness: -1 }, { thickness: 0 }, { resolution: -1 }, { shellThickness: NaN }, { cellSize: Infinity }]) assert.throws(() => scaleLatticeOptions(options, 2), /valid/);
  assert.throws(() => resizeSourceMesh(source(), 1e40), /coordinate range/);
  assert.throws(() => resizeSourceMesh(source(), 1, [0, NaN, 0]), /anchor/);
  assert.throws(() => presetLatticeOptions('open', { size: [0, 0, 0] }), /measurable/);
});
