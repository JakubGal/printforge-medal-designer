import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRodOptions, rodFrame, rodProfileRing, createRodMesh, createJointMesh, createPolylineRodMeshes, createSweptRodMesh, pathNeedsSegmentUnion } from '../lattice-rods.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => a.map((value, axis) => value - b[axis]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} must approximate ${expected}`);

function inspectSolid(mesh) {
  assert.equal(mesh.numProp, 3);
  assert.ok(mesh.vertProperties instanceof Float32Array);
  assert.ok(mesh.triVerts instanceof Uint32Array);
  const positions = mesh.vertProperties, indices = mesh.triVerts, edges = new Map();
  assert.ok(positions.length > 0 && positions.length % 3 === 0 && positions.every(Number.isFinite));
  assert.ok(indices.length > 0 && indices.length % 3 === 0);
  const origin = Array.from(positions.subarray(0, 3));
  const point = index => Array.from(positions.subarray(index * 3, index * 3 + 3));
  let volume = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const ids = Array.from(indices.subarray(offset, offset + 3));
    assert.equal(new Set(ids).size, 3, 'Triangles need three distinct indices');
    ids.forEach(index => assert.ok(index < positions.length / 3));
    const [a, b, c] = ids.map(point);
    assert.ok(Math.hypot(...cross(sub(b, a), sub(c, a))) > 0, 'No zero-area exported triangles');
    volume += dot(sub(a, origin), cross(sub(b, origin), sub(c, origin))) / 6;
    for (const [a, b] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
      const key = `${Math.min(a, b)},${Math.max(a, b)}`, entry = edges.get(key) || { count: 0, winding: 0 };
      entry.count++; entry.winding += a < b ? 1 : -1; edges.set(key, entry);
    }
  }
  for (const edge of edges.values()) { assert.equal(edge.count, 2, 'Every edge must have two incident triangles'); assert.equal(edge.winding, 0, 'Shared edges require opposite winding'); }
  assert.ok(volume > 0, 'Closed solids must have outward winding and positive volume');
  return { volume, vertices: positions.length / 3, triangles: indices.length / 3 };
}

test('circle quality selects genuine cylindrical section tessellation independent of a voxel grid', () => {
  for (const [quality, count] of [['draft', 12], ['balanced', 24], ['fine', 40]]) {
    const mesh = createRodMesh([0, 0, 0], [0, 0, 10], { rodProfile: 'circle', thickness: 2, quality }, { endOverlap: 0 });
    const stats = inspectSolid(mesh);
    assert.equal(mesh.startRing.length, count); assert.equal(stats.vertices, count * 2 + 2);
    const exactArea = count * Math.sin(2 * Math.PI / count) / 2;
    near(stats.volume, exactArea * 10, 1e-5);
    for (let side = 0; side < count; side++) for (const t of [0, .2, .7, 1]) {
      const point = mesh.capStartRing[side].map((value, axis) => value + (mesh.capEndRing[side][axis] - value) * t);
      near(Math.hypot(point[0], point[1]), 1, 1e-12);
      near(point[2], 10 * t, 1e-12);
    }
  }
});

test('rectangle width, aspect and rotation remain exact along arbitrary oriented rods', () => {
  const a = [12, -7, 3], b = [17, -4, 11], options = { rodProfile: 'rectangle', thickness: 2, rodAspect: .4, rodRotation: 31 };
  const mesh = createRodMesh(a, b, options, { normal: [0, 0, 1], endOverlap: 0 }), stats = inspectSolid(mesh);
  const angle = options.rodRotation * Math.PI / 180;
  near(stats.volume, 2 * .8 * Math.hypot(...sub(b, a)), 2e-5);
  for (const [ring, center] of [[mesh.startRing, a], [mesh.endRing, b]]) for (const point of ring) {
    const relative = sub(point, center), x = dot(relative, mesh.frame.x), y = dot(relative, mesh.frame.y);
    near(Math.abs(x * Math.cos(angle) + y * Math.sin(angle)), 1);
    near(Math.abs(-x * Math.sin(angle) + y * Math.cos(angle)), .4);
    near(dot(relative, mesh.frame.tangent), 0);
  }
});

test('polygon rods use the requested regular section and circumdiameter', () => {
  for (const rodSides of [3, 5, 8, 12]) {
    const mesh = createRodMesh([0, 0, 0], [0, 0, 4], { rodProfile: 'polygon', thickness: 3, rodSides, rodRotation: 13 }, { endOverlap: 0 });
    const stats = inspectSolid(mesh);
    assert.equal(mesh.startRing.length, rodSides);
    for (const point of mesh.startRing) near(Math.hypot(point[0], point[1]), 1.5, 1e-12);
    near(stats.volume, rodSides / 2 * 1.5 ** 2 * Math.sin(2 * Math.PI / rodSides) * 4, 1e-5);
  }
});

test('tapered profiles meet endpoint widths even when caps extend for a valid solid union', () => {
  const exact = createRodMesh([0, 0, 0], [0, 0, 8], { rodProfile: 'rectangle', thickness: 2, widthEnd: 4, rodAspect: .5 }, { endOverlap: 0 });
  near(inspectSolid(exact).volume, 8 / 3 * (2 + 8 + Math.sqrt(16)), 1e-5);
  const mesh = createRodMesh([0, 0, 0], [0, 0, 8], { rodProfile: 'circle', thickness: 2, endThickness: 4 });
  inspectSolid(mesh);
  assert.ok(mesh.capStartRing[0][2] < 0 && mesh.capEndRing[0][2] > 8);
  for (const [z, radius] of [[0, 1], [8, 2]]) {
    const a = mesh.capStartRing[0], b = mesh.capEndRing[0], t = (z - a[2]) / (b[2] - a[2]);
    const point = a.map((value, axis) => value + (b[axis] - value) * t);
    near(Math.hypot(point[0], point[1]), radius, 1e-12);
  }
  const steep = createRodMesh([0, 0, 0], [0, 0, .01], { thickness: .001, endThickness: 5 });
  inspectSolid(steep); assert.ok(steep.overlap.every(value => value >= 0));
});

test('surface-normal and transported frames are orthonormal, stable and handle reversed directions', () => {
  const first = rodFrame([0, 0, 0], [1, 0, 0], { normal: [0, 0, 1] });
  near(dot(first.y, [0, 0, 1]), 1);
  const frames = [first];
  for (const direction of [[1, .01, 0], [1, .1, .02], [-1, -.1, -.02]]) frames.push(rodFrame([0, 0, 0], direction, { previousFrame: frames.at(-1) }));
  for (const frame of frames) {
    for (const axis of [frame.x, frame.y, frame.tangent]) near(Math.hypot(...axis), 1, 1e-12);
    near(dot(frame.x, frame.y), 0, 1e-12); near(dot(cross(frame.x, frame.y), frame.tangent), 1, 1e-12);
  }
  assert.ok(dot(frames[0].y, frames[2].y) > .99);
  const parallelNormal = rodFrame([0, 0, 0], [0, 0, 1], { normal: [0, 0, 1] });
  assert.ok(parallelNormal.x.every(Number.isFinite));
});

test('junction hulls connect incoming profiles without extending beyond their section envelope', () => {
  const center = [10, 20, 30];
  for (const rodProfile of ['circle', 'rectangle', 'polygon']) {
    const options = { rodProfile, thickness: 2, rodAspect: .6, rodSides: 5, rodRotation: 19 };
    const rings = [[1, 0, 1], [-1, 1, 0], [0, -1, 1]].map(direction => createRodMesh(center, center.map((value, axis) => value + direction[axis] * 4), options).startRing);
    const mesh = createJointMesh(center, options, { rings }); inspectSolid(mesh);
    const maximumRadius = rodProfile === 'rectangle' ? Math.hypot(1, .6) : 1;
    for (let index = 0; index < mesh.vertProperties.length; index += 3) {
      const point = Array.from(mesh.vertProperties.subarray(index, index + 3));
      assert.ok(Math.hypot(...sub(point, center)) <= maximumRadius + 2e-6, 'No oversized node balls or miter spikes');
    }
    inspectSolid(createJointMesh(center, options));
  }
});

test('coplanar rectangle junctions receive only compact axial overlap', () => {
  const options = { rodProfile: 'rectangle', thickness: 2, rodAspect: .5 };
  const ring = rodProfileRing([0, 0, 0], rodFrame([0, 0, 0], [0, 0, 1]), options);
  const mesh = createJointMesh([0, 0, 0], options, { rings: [ring, ring] }); inspectSolid(mesh);
  const coordinates = Array.from(mesh.vertProperties);
  const depth = Math.max(...coordinates.filter((_, index) => index % 3 === 2)) - Math.min(...coordinates.filter((_, index) => index % 3 === 2));
  assert.ok(depth > 0 && depth <= .061);
});

test('surface paths preserve segment order, closed loops and per-point density grading', () => {
  const points = [[0, 0, 0], [4, 0, 0], [4, 3, 0]], normals = points.map(() => [0, 0, 1]), widths = [1, 1.5, 2];
  const result = createPolylineRodMeshes(points, { rodProfile: 'rectangle', thickness: 1, rodAspect: .6 }, { normals, widths });
  assert.equal(result.rods.length, 2); assert.equal(result.joints.length, 1);
  result.rods.concat(result.joints).forEach(inspectSolid);
  result.rods.forEach((rod, index) => { assert.equal(rod.thickness, widths[index]); assert.equal(rod.endThickness, widths[index + 1]); near(dot(rod.frame.y, [0, 0, 1]), 1); });
  const loop = createPolylineRodMeshes([...points, [0, 3, 0], points[0]], { rodProfile: 'polygon', rodSides: 5, thickness: .8 });
  assert.equal(loop.closed, true); assert.equal(loop.rods.length, 4); assert.equal(loop.joints.length, 4);
  loop.rods.concat(loop.joints).forEach(inspectSolid);
  const skip = createPolylineRodMeshes(points, { thickness: 1 }, { buildJoints: false });
  assert.equal(skip.rods.length, 2); assert.deepEqual(skip.joints, []); assert.deepEqual(skip.junctions, []);
  assert.deepEqual(points, [[0, 0, 0], [4, 0, 0], [4, 3, 0]]);
});

test('tiny model units remain valid and invalid geometry is rejected before union', () => {
  inspectSolid(createRodMesh([0, 0, 0], [1e-7, 2e-7, 3e-7], { thickness: 2e-9, rodProfile: 'rectangle', rodAspect: .5 }));
  assert.equal(normalizeRodOptions({ rodSides: 20 }).rodSides, 12);
  assert.equal(normalizeRodOptions({ rodRotation: -30 }).rodRotation, 330);
  assert.throws(() => createRodMesh([0, 0, 0], [0, 0, 0]), /different endpoints/);
  assert.throws(() => createRodMesh([0, 0, 0], [1, 0, 0], { thickness: 0 }), /positive/);
  assert.throws(() => createRodMesh([NaN, 0, 0], [1, 0, 0]), /finite XYZ/);
  assert.throws(() => createRodMesh([0, 0, 0], [1, 0, 0], {}, { endOverlap: -1 }), /nonnegative/);
  assert.throws(() => createPolylineRodMeshes([[0, 0, 0], [0, 0, 0]]), /duplicate/);
  assert.throws(() => createPolylineRodMeshes([[0, 0, 0], [1, 0, 0]], {}, { widths: [1] }), /match/);
});

test('swept rods share internal rings and contain no internal caps or boolean seams', () => {
  for (const rodProfile of ['circle', 'rectangle', 'polygon']) {
    const options = { rodProfile, thickness: 2, rodAspect: .5, rodSides: 7 }, points = [[0, 0, 0], [0, 0, 4], [0, 0, 10]];
    const mesh = createSweptRodMesh(points, options, { endOverlap: 0 });
    const stats = inspectSolid(mesh), sides = normalizeRodOptions(options).sides;
    assert.equal(stats.vertices, points.length * sides + 2);
    assert.equal(stats.triangles, (points.length - 1) * sides * 2 + sides * 2);
    for (let section = 0; section < points.length; section++) {
      const originalRing = rodProfileRing(points[section], mesh.frames[section], options);
      originalRing.flat().forEach((value, index) => near(mesh.vertProperties[section * sides * 3 + index], value));
    }
  }
});

test('a curved surface sweep transports true profile rings and supports per-node taper', () => {
  const points = Array.from({ length: 17 }, (_, index) => { const angle = index * Math.PI / 32; return [8 * Math.cos(angle), 8 * Math.sin(angle), .15 * index]; });
  const normals = points.map(point => [point[0], point[1], 0]), widths = points.map((_, index) => .8 + index * .025);
  for (const rodProfile of ['circle', 'rectangle', 'polygon']) {
    const mesh = createSweptRodMesh(points, { rodProfile, thickness: .8, rodAspect: .6, rodSides: 5 }, { normals, widths, endOverlap: 0 });
    inspectSolid(mesh);
    assert.deepEqual(mesh.widths, widths);
    mesh.frames.forEach(frame => near(dot(cross(frame.x, frame.y), frame.tangent), 1, 1e-10));
    const sides = normalizeRodOptions({ rodProfile, rodSides: 5 }).sides;
    for (let section = 0; section < points.length; section++) for (let side = 0; side < sides; side++) {
      const offset = (section * sides + side) * 3, point = Array.from(mesh.vertProperties.subarray(offset, offset + 3));
      near(dot(sub(point, points[section]), mesh.frames[section].tangent), 0, 2e-6);
      if (rodProfile !== 'rectangle') near(Math.hypot(...sub(point, points[section])), widths[section] / 2, 2e-6);
    }
  }
});

test('closed swept loops wrap shared topology without endpoint caps', () => {
  const points = Array.from({ length: 24 }, (_, index) => { const angle = index * Math.PI / 12; return [6 * Math.cos(angle), 6 * Math.sin(angle), Math.sin(angle * 2)]; });
  points.push(points[0]);
  for (const rodProfile of ['circle', 'rectangle', 'polygon']) {
    const options = { rodProfile, thickness: .7, rodAspect: .8, rodSides: 5 }, mesh = createSweptRodMesh(points, options);
    const stats = inspectSolid(mesh), sides = normalizeRodOptions(options).sides;
    assert.equal(mesh.closed, true);
    assert.equal(stats.vertices, 24 * sides);
    assert.equal(stats.triangles, 24 * sides * 2);
    assert.deepEqual(mesh.startRing, mesh.endRing);
  }
});

test('two-point sweeps retain exact prism behavior and invalid foldback paths are rejected', () => {
  const points = [[2, 3, 4], [5, 7, 11]], options = { rodProfile: 'polygon', rodSides: 6, thickness: 1.2, endThickness: .8 };
  const prism = createRodMesh(points[0], points[1], options), sweep = createSweptRodMesh(points, options);
  assert.deepEqual(sweep.vertProperties, prism.vertProperties); assert.deepEqual(sweep.triVerts, prism.triVerts);
  inspectSolid(sweep);
  assert.throws(() => createSweptRodMesh([[0, 0, 0], [1, 0, 0], [.5, 0, 0]]), /folds directly back/);
  assert.throws(() => createSweptRodMesh(points, options, { widths: [1] }), /match/);
});

// Independent geometric check: indexed edge-manifold topology alone cannot
// detect a swept tube folding through itself when its radius exceeds a bend.
function meshHasNonAdjacentCrossings(mesh) {
  const positions = mesh.vertProperties, indices = mesh.triVerts, triangles = [];
  for (let offset = 0; offset < indices.length; offset += 3) {
    const ids = Array.from(indices.subarray(offset, offset + 3));
    const points = ids.map(index => Array.from(positions.subarray(index * 3, index * 3 + 3)));
    triangles.push({ ids, points, min: [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]))), max: [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]))) });
  }
  const intersects = (p, q, a, b, c) => {
    const direction = sub(q, p), edge = sub(b, a), otherEdge = sub(c, a), perpendicular = cross(direction, otherEdge), determinant = dot(edge, perpendicular);
    if (Math.abs(determinant) <= 1e-12 * Math.hypot(...direction) * Math.hypot(...edge) * Math.hypot(...otherEdge)) return false;
    const relative = sub(p, a), u = dot(relative, perpendicular) / determinant;
    if (u < -1e-8 || u > 1 + 1e-8) return false;
    const normal = cross(relative, edge), v = dot(direction, normal) / determinant;
    if (v < -1e-8 || u + v > 1 + 1e-8) return false;
    const t = dot(otherEdge, normal) / determinant;
    return t > 1e-7 && t < 1 - 1e-7;
  };
  for (let first = 0; first < triangles.length; first++) for (let second = first + 1; second < triangles.length; second++) {
    const a = triangles[first], b = triangles[second];
    if (a.ids.some(id => b.ids.includes(id)) || a.min.some((value, axis) => value > b.max[axis] || a.max[axis] < b.min[axis])) continue;
    for (const [source, target] of [[a, b], [b, a]]) for (let edge = 0; edge < 3; edge++) {
      if (intersects(source.points[edge], source.points[(edge + 1) % 3], ...target.points)) return true;
    }
  }
  return false;
}

test('local sweep fallback catches actual folded loops while retaining safe circle and oriented rectangle sweeps', () => {
  const points = Array.from({ length: 12 }, (_, index) => [Math.cos(index * Math.PI / 6), Math.sin(index * Math.PI / 6), 0]);
  points.push(points[0]);
  const radial = points.map(point => [...point]), vertical = points.map(() => [0, 0, 1]);
  for (const [options, normals, unsafe] of [
    [{ rodProfile: 'circle', quality: 'draft', thickness: .4 }, radial, false],
    [{ rodProfile: 'circle', quality: 'draft', thickness: 3 }, radial, true],
    [{ rodProfile: 'rectangle', thickness: .8, rodAspect: 4 }, radial, true],
    [{ rodProfile: 'rectangle', thickness: .8, rodAspect: 4 }, vertical, false],
  ]) {
    const mesh = createSweptRodMesh(points, options, { normals, endOverlap: 0 });
    assert.equal(meshHasNonAdjacentCrossings(mesh), unsafe, 'Fixtures must demonstrate geometric intersections independently');
    assert.equal(pathNeedsSegmentUnion(points, options, undefined, normals), unsafe);
  }
});

test('a long right-angle corner remains swept, while widths, scale and near-reversed frames affect the guard correctly', () => {
  const corner = [[0, 0, 0], [10, 0, 0], [10, 10, 0]], normals = corner.map(() => [0, 0, 1]);
  const options = { rodProfile: 'rectangle', thickness: 1.6, rodAspect: 4 };
  assert.equal(meshHasNonAdjacentCrossings(createSweptRodMesh(corner, options, { normals, endOverlap: 0 })), false);
  assert.equal(pathNeedsSegmentUnion(corner, options, undefined, normals), false);
  const loop = Array.from({ length: 12 }, (_, index) => [Math.cos(index * Math.PI / 6), Math.sin(index * Math.PI / 6), 0]); loop.push(loop[0]);
  for (const scale of [1, 1e-6]) {
    const scaled = loop.map(point => point.map(value => value * scale));
    assert.equal(pathNeedsSegmentUnion(scaled, { thickness: .1 * scale, quality: 'draft' }, loop.map(() => 3 * scale), loop), true);
  }
  assert.equal(pathNeedsSegmentUnion([[0, 0, 0], [0, 0, 3], [0, 0, 6]], { thickness: .3 }, undefined, [[0, 1, 0], [0, 1, 0], [0, -1, 0]]), true);
  assert.equal(pathNeedsSegmentUnion([[0, 0, 0], [1, 0, 0], [.5, 0, 0]], { thickness: .3 }), true);
  assert.equal(pathNeedsSegmentUnion([[0, 0, 0], [0, 0, .1]], { thickness: 20 }), false, 'A two-point prism cannot have an internal sweep fold');
});
