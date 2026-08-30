import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeSvgMarkup, SUPPORTED_SHAPES, traceShapePath } from '../shape-library.js';

function canvasSignature(kind) {
  const calls = [];
  const context = new Proxy({}, {
    get(_target, method) {
      return (...values) => calls.push([method, ...values.map(value => typeof value === 'number' ? Number(value.toFixed(4)) : value)]);
    },
  });
  traceShapePath(context, kind, 20);
  return JSON.stringify(calls);
}

test('all twelve offered symbols have distinct canonical canvas and SVG geometry', () => {
  assert.deepEqual(SUPPORTED_SHAPES, ['circle', 'square', 'triangle', 'diamond', 'star', 'hexagon', 'bolt', 'heart', 'mountain', 'flag', 'trophy', 'runner']);
  const canvas = SUPPORTED_SHAPES.map(canvasSignature);
  const svg = SUPPORTED_SHAPES.map(kind => shapeSvgMarkup(kind, 20));
  assert.equal(new Set(canvas).size, SUPPORTED_SHAPES.length);
  assert.equal(new Set(svg).size, SUPPORTED_SHAPES.length);
  for (const [index, markup] of svg.entries()) {
    assert.ok(markup.length > 20, `${SUPPORTED_SHAPES[index]} must contain real SVG geometry`);
    if (SUPPORTED_SHAPES[index] !== 'hexagon') assert.notEqual(markup, shapeSvgMarkup('hexagon', 20));
  }
});

test('unknown legacy shapes fall back consistently without changing supported symbols', () => {
  assert.equal(shapeSvgMarkup('unknown', 20), shapeSvgMarkup('hexagon', 20));
  assert.equal(canvasSignature('unknown'), canvasSignature('hexagon'));
});
