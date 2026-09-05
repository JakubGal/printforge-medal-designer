import test from 'node:test';
import assert from 'node:assert/strict';
import { LatticeViewer, cameraRay, raycastMesh, measurementScaleFactor } from '../lattice-viewer.js';

function approximately(actual, expected, tolerance = 1e-10) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= tolerance, `${actual} should approximate ${expected}`));
}

const camera = { width: 200, height: 100, right: [1, 0, 0], up: [0, 1, 0], outward: [0, 0, 1], center: [0, 0, 0], distance: 3 };
const triangle = z => [-2, -2, z, 2, -2, z, 0, 2, z];

test('perspective picking uses the viewport aspect ratio and source coordinate transform', () => {
  const center = cameraRay({ ...camera, x: 100, y: 50, origin: [10, -20, 5], scale: 2 });
  approximately(center.origin, [10, -20, 6.5]);
  approximately(center.direction, [0, 0, -1]);
  const right = cameraRay({ ...camera, x: 200, y: 50 });
  const top = cameraRay({ ...camera, x: 100, y: 0 });
  assert.ok(right.direction[0] > 0 && top.direction[1] > 0);
  assert.ok(Math.abs(right.direction[0] / -right.direction[2] - 2 * top.direction[1] / -top.direction[2]) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...right.direction) - 1) < 1e-12);
});

test('picking follows a rotated and panned camera without changing model coordinates', () => {
  const ray = cameraRay({ ...camera, x: 100, y: 50, right: [0, 1, 0], up: [0, 0, 1], outward: [1, 0, 0],
    center: [.5, -.25, .75], distance: 2, origin: [100, 200, 300], scale: .5 });
  approximately(ray.origin, [105, 199.5, 301.5]);
  approximately(ray.direction, [-1, 0, 0]);
  const hit = raycastMesh(new Float32Array([100, 195, 298, 100, 205, 298, 100, 200, 308]), ray);
  approximately(hit.point, [100, 199.5, 301.5]);
  assert.equal(hit.distance, 5);
});

test('ray picking selects the closest real triangle, handles either winding, and misses empty bounds', () => {
  const positions = new Float32Array([...triangle(0), ...triangle(1)]);
  const mesh = { positions, bounds: { min: [-2, -2, 0], max: [2, 2, 1] } };
  const hit = raycastMesh(mesh, { origin: [0, 0, 3], direction: [0, 0, -10] });
  assert.equal(hit.triangleIndex, 1);
  assert.equal(hit.distance, 2);
  approximately(hit.point, [0, 0, 1]);
  approximately(hit.barycentric, [.25, .25, .5]);
  const below = raycastMesh(mesh, { origin: [0, 0, -3], direction: [0, 0, 1] });
  assert.equal(below.triangleIndex, 0);
  assert.equal(raycastMesh(mesh, { origin: [1.9, 1.9, 3], direction: [0, 0, -1] }), null, 'Inside the bounding box is insufficient for a triangle hit');
  assert.equal(raycastMesh(mesh, { origin: [0, 0, 3], direction: [1, 0, 0] }), null);
  assert.equal(raycastMesh(mesh, { origin: [0, 0, 3], direction: [0, 0, 1] }), null);
  assert.equal(raycastMesh(mesh, { origin: [0, 0, 3], direction: [0, 0, 0] }), null);
});

test('tiny STL coordinates remain pickable without a fixed world-unit epsilon', () => {
  const mesh = new Float32Array([0, 0, 0, 1e-9, 0, 0, 0, 1e-9, 0]);
  const hit = raycastMesh(mesh, { origin: [.25e-9, .25e-9, 3e-9], direction: [0, 0, -1] });
  assert.ok(hit);
  approximately(hit.point, [.25e-9, .25e-9, 0], 1e-20);
  assert.ok(Math.abs(hit.distance - 3e-9) < 1e-20);
});

test('measurement scaling uses the picked distance and preserves the original points', () => {
  const points = [[.01, -.2, .03], [.61, .6, .03]];
  const original = structuredClone(points);
  assert.equal(measurementScaleFactor(points, 75), 75);
  assert.deepEqual(points, original);
  assert.ok(Math.abs(measurementScaleFactor([[0, 0, 0], [1e-9, 0, 0]], 50) - 5e10) < .001);
  assert.throws(() => measurementScaleFactor([[0, 0, 0], [0, 0, 0]], 50), /different mesh points/);
  assert.throws(() => measurementScaleFactor([[0, 0, 0]], 50), /different mesh points/);
  assert.throws(() => measurementScaleFactor(points, 0), /positive target/);
  assert.throws(() => measurementScaleFactor(points, Infinity), /positive target/);
});

function cubeMesh() {
  const points = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const positions = [];
  for (const face of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]) {
    for (const index of [face[0], face[1], face[2], face[0], face[2], face[3]]) positions.push(...points[index]);
  }
  return { positions: Float32Array.from(positions), bounds: { min: [-1, -1, -1], max: [1, 1, 1], size: [2, 2, 2] } };
}

function viewerFixture() {
  const saved = new Map(['window', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map(), uniforms = new Map(), buffers = new Map();
  let boundBuffer;
  const element = () => ({ style: {}, attributes: {}, children: [], setAttribute(key, value) { this.attributes[key] = value; },
    append(...children) { this.children.push(...children); }, remove() { this.removed = true; } });
  const parent = element(); parent.style.position = '';
  const document = { createElement: element, createElementNS: element };
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, getParameter: () => 8192, getExtension: () => ({}),
    getAttribLocation: (_, name) => ['aPosition', 'aNormal', 'aBarycentric'].indexOf(name), getUniformLocation: (_, name) => name,
    createBuffer: () => ({}), createShader: () => ({}), createProgram: () => ({}), uniform1f: (name, value) => uniforms.set(name, value),
    bindBuffer: (_, buffer) => { boundBuffer = buffer; }, bufferData: (_, data) => buffers.set(boundBuffer, new data.constructor(data)),
  }, { get: (target, name) => name in target ? target[name] : /^[A-Z_0-9]+$/.test(name) ? name : () => {} });
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({ position: 'static' }) };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const canvas = { ...element(), dataset: {}, ownerDocument: document, parentElement: parent, clientWidth: 100, clientHeight: 100,
    offsetLeft: 0, offsetTop: 0, hasAttribute: () => false, focus() {}, setPointerCapture() {}, getContext: () => gl,
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; },
    addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  const measurements = [];
  const viewer = new LatticeViewer(canvas, { onMeasurement: value => measurements.push(value) });
  const send = (type, options = {}) => listeners.get(type)?.({ type, pointerId: 1, button: 0, clientX: 50, clientY: 50, shiftKey: false, preventDefault() {}, ...options });
  return { viewer, canvas, parent, uniforms, buffers, measurements, send, cleanup() {
    viewer.destroy();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  } };
}

test('mesh clicks pick across camera views while drags, pan gestures and multi-touch do not', () => {
  const fixture = viewerFixture();
  const { viewer, send, measurements } = fixture;
  try {
    viewer.setSource(cubeMesh()); viewer.preset('top'); viewer.setMeasurementMode(true);
    send('pointerdown'); send('pointermove', { clientX: 66 }); send('pointerup', { clientX: 66 });
    assert.equal(viewer.measurementPoints.length, 0);
    send('pointerdown', { shiftKey: true }); send('pointerup', { shiftKey: true });
    send('pointerdown', { button: 2 }); send('pointerup', { button: 2 });
    send('pointerdown'); send('pointerdown', { pointerId: 2 }); send('pointerup', { pointerId: 2 }); send('pointerup');
    assert.equal(viewer.measurementPoints.length, 0);
    viewer.preset('top'); send('pointerdown'); send('pointerup');
    approximately(viewer.measurementPoints[0], [0, 0, 1]);
    assert.equal(measurements.at(-1).distance, null);
    viewer.preset('front'); send('pointerdown'); send('pointerup');
    approximately(viewer.measurementPoints[1], [0, -1, 0]);
    assert.ok(Math.abs(measurements.at(-1).distance - Math.SQRT2) < 1e-12);
    const pair = structuredClone(viewer.measurementPoints);
    viewer.preset('right'); send('pointerdown'); send('pointerup');
    assert.deepEqual(viewer.measurementPoints, pair, 'Completed measurements must not be silently replaced');
    viewer.clearMeasurement(); assert.equal(measurements.at(-1).distance, null);
    send('pointerdown'); send('pointercancel'); assert.equal(viewer.measurementPoints.length, 0);
  } finally { fixture.cleanup(); }
});

test('measurement mode forces the full shaded source and restores result display without clearing points', () => {
  const fixture = viewerFixture();
  const { viewer, uniforms } = fixture;
  try {
    viewer.setSource(cubeMesh()); viewer.setResult(cubeMesh());
    viewer.setDisplay({ showSource: false, showResult: true, wireframe: true, cutAxis: 'z', cut: .2 });
    const draws = [];
    viewer.drawMesh = (geometry, shade, opacity, wireframe) => draws.push({ geometry, opacity, wireframe });
    viewer.setMeasurementMode(true); viewer.render();
    assert.equal(draws.length, 1); assert.equal(draws[0].geometry, viewer.sourceGpu);
    assert.equal(draws[0].opacity, 1); assert.equal(draws[0].wireframe, false);
    assert.equal(uniforms.get('uClip'), 0);
    viewer.setMeasurementPoints([[0, 0, 1], [0, -1, 0]]);
    draws.length = 0; viewer.setMeasurementMode(false); viewer.render();
    assert.equal(draws.length, 1); assert.equal(draws[0].geometry, viewer.resultGpu); assert.equal(draws[0].wireframe, true);
    assert.equal(uniforms.get('uClip'), 1); assert.equal(viewer.measurementPoints.length, 2);
  } finally { fixture.cleanup(); }
});

test('measurement overlays follow the camera and resize, restore scaled points, and clean up', () => {
  const fixture = viewerFixture();
  const { viewer, canvas, parent } = fixture;
  const overlay = viewer.measurementOverlay;
  try {
    viewer.setSource(cubeMesh()); viewer.preset('top');
    const points = [[0, 0, 1], [.5, 0, 1]];
    viewer.setMeasurementPoints(points); points[0][0] = 100;
    assert.equal(viewer.measurementPoints[0][0], 0, 'Caller arrays must not mutate retained measurements');
    assert.equal(overlay.label.textContent, '0.5 mm');
    const before = overlay.markers[0].style.left;
    viewer.pan(10, 0); viewer.render(); assert.notEqual(overlay.markers[0].style.left, before);
    canvas.clientWidth = 200; viewer.render(); assert.equal(overlay.element.style.width, '200px');
    viewer.setSource(cubeMesh()); assert.equal(viewer.measurementPoints.length, 0);
    viewer.setMeasurementPoints([[0, 0, 2], [1, 0, 2]]); assert.equal(overlay.label.textContent, '1 mm');
    assert.throws(() => viewer.setMeasurementPoints([[NaN, 0, 0]]), /finite XYZ/);
  } finally { fixture.cleanup(); }
  assert.equal(overlay.element.removed, true); assert.equal(parent.style.position, '');
});

test('explicit polygon and rectangular rods preserve planar profile shading while round rods remain smooth', () => {
  const fixture = viewerFixture();
  const { viewer, buffers } = fixture;
  try {
    const positions = [];
    const point = (index, z) => [Math.cos(index * Math.PI / 6), Math.sin(index * Math.PI / 6), z];
    for (let side = 0; side < 12; side++) {
      const a = point(side, -1), b = point(side + 1, -1), c = point(side + 1, 1), d = point(side, 1);
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    const mesh = { positions: Float32Array.from(positions), bounds: { min: [-1,-1,-1], max: [1,1,1], size: [2,2,2] }, stats: { meshingMethod: 'explicit-rods' } };
    for (const rodProfile of ['polygon', 'rectangle']) {
      viewer.setResult({ ...mesh, options: { rodProfile } });
      const normals = buffers.get(viewer.resultGpu.normal);
      for (let face = 0; face < positions.length; face += 9) {
        approximately(Array.from(normals.slice(face, face + 3)), Array.from(normals.slice(face + 3, face + 6)), 1e-7);
        approximately(Array.from(normals.slice(face, face + 3)), Array.from(normals.slice(face + 6, face + 9)), 1e-7);
      }
      assert.ok(Math.abs(normals[0] - Math.cos(Math.PI / 12)) < 1e-6, 'the first normal follows the actual polygon face');
    }
    viewer.setResult({ ...mesh, options: { rodProfile: 'circle' } });
    const roundNormals = buffers.get(viewer.resultGpu.normal);
    assert.ok(Math.abs(roundNormals[0] - roundNormals[3]) > .01 || Math.abs(roundNormals[1] - roundNormals[4]) > .01,
      'round rods interpolate different vertex normals across each side face');
  } finally { fixture.cleanup(); }
});
