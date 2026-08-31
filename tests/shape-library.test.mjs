import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHAPE_CATALOG,
  SHAPE_CATEGORIES,
  shapeInfo,
  shapeMinimumFeatureRatio,
  shapeSvgMarkup,
  SUPPORTED_SHAPES,
  traceShapePath,
} from '../shape-library.js';

const EXPECTED_SHAPES = [
  'circle', 'square', 'triangle', 'diamond', 'star', 'hexagon', 'bolt', 'heart',
  'runner', 'runner-male', 'runner-female', 'runner-sprint', 'runner-trail',
  'mountain', 'mountain-alpine', 'mountain-range', 'mountain-snowcap',
  'mountain-layered', 'mountain-trail', 'mountain-sunrise', 'flag', 'trophy',
];

function canvasCalls(kind) {
  const calls = [];
  const context = new Proxy({}, {
    get(_target, method) {
      return (...values) => calls.push([method, ...values.map(value => typeof value === 'number' ? Number(value.toFixed(4)) : value)]);
    },
  });
  traceShapePath(context, kind, 20);
  return calls;
}

const canvasSignature = kind => JSON.stringify(canvasCalls(kind));

test('the expanded symbol catalog keeps stable IDs and useful beginner metadata', () => {
  assert.deepEqual(SUPPORTED_SHAPES, EXPECTED_SHAPES);
  assert.deepEqual(SHAPE_CATEGORIES, ['Essentials', 'Runners', 'Mountains', 'Race day']);
  assert.equal(SHAPE_CATALOG.length, SUPPORTED_SHAPES.length);
  assert.equal(new Set(SHAPE_CATALOG.map(shape => shape.id)).size, SHAPE_CATALOG.length);
  assert.equal(shapeInfo('runner-male').label, 'Male runner');
  assert.equal(shapeInfo('runner-female').label, 'Female runner');
  assert.equal(shapeInfo('mountain-alpine').category, 'Mountains');
  for (const shape of SHAPE_CATALOG) {
    assert.ok(shape.label.length > 2, `${shape.id} needs a friendly label`);
    assert.ok(shape.description.length > 12, `${shape.id} needs a useful tooltip`);
    assert.ok(shape.minimumFeatureRatio >= .05 && shape.minimumFeatureRatio <= .22, `${shape.id} needs a realistic printable feature ratio`);
    assert.equal(shapeMinimumFeatureRatio(shape.id), shape.minimumFeatureRatio);
  }
});

test('every visible symbol has distinct canonical Canvas and SVG geometry', () => {
  const visible = SUPPORTED_SHAPES.filter(kind => kind !== 'runner');
  const canvas = visible.map(canvasSignature);
  const svg = visible.map(kind => shapeSvgMarkup(kind, 20));
  assert.equal(new Set(canvas).size, visible.length);
  assert.equal(new Set(svg).size, visible.length);
  for (const [index, markup] of svg.entries()) {
    assert.ok(markup.length > 25, `${visible[index]} must contain real SVG geometry`);
    if (visible[index] !== 'hexagon') assert.notEqual(markup, shapeSvgMarkup('hexagon', 20));
  }
});

test('legacy runner projects receive the upgraded male runner geometry', () => {
  assert.equal(canvasSignature('runner'), canvasSignature('runner-male'));
  assert.equal(shapeSvgMarkup('runner', 24), shapeSvgMarkup('runner-male', 24));
});

test('runner silhouettes are dense, smooth vector contours rather than low-polygon blobs', () => {
  for (const kind of ['runner-male', 'runner-female', 'runner-sprint', 'runner-trail']) {
    const calls = canvasCalls(kind);
    assert.ok(calls.filter(([method]) => method === 'lineTo').length >= 220, `${kind} needs at least 220 smoothed boundary segments`);
    assert.ok(calls.some(([method]) => method === 'arc'), `${kind} needs a smooth head contour`);
    assert.ok(shapeSvgMarkup(kind, 24).length > 3000, `${kind} SVG should preserve the dense contour`);
  }
});

test('high-detail mountains use smooth curves and substantial filled regions', () => {
  for (const kind of ['mountain', 'mountain-alpine', 'mountain-range', 'mountain-snowcap', 'mountain-layered', 'mountain-trail', 'mountain-sunrise']) {
    const calls = canvasCalls(kind);
    assert.ok(calls.some(([method]) => method === 'bezierCurveTo' || method === 'quadraticCurveTo'), `${kind} needs curve geometry`);
    assert.ok(calls.filter(([method]) => method === 'closePath').length >= 1, `${kind} needs closed printable regions`);
  }
});

test('unknown legacy shapes fall back consistently without changing supported symbols', () => {
  assert.equal(shapeInfo('unknown').id, 'hexagon');
  assert.equal(shapeSvgMarkup('unknown', 20), shapeSvgMarkup('hexagon', 20));
  assert.equal(canvasSignature('unknown'), canvasSignature('hexagon'));
});
