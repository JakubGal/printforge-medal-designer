import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoMesh, encodeBinarySTL, parseSTL, isPointInsideMesh } from '../lattice-engine.js';
import { generateRodLattice } from '../lattice-solid.js';

const cube = createDemoMesh('cube');
const regular = { mode: 'struts', quality: 'draft', cellSize: 8, thickness: 1.6, randomness: 0, seed: 42, resolution: 1 };
const reverseWinding = positions => {
  const reversed = Float32Array.from(positions);
  for (let i = 0; i < reversed.length; i += 9) for (let axis = 0; axis < 3; axis++) {
    [reversed[i + 3 + axis], reversed[i + 6 + axis]] = [reversed[i + 6 + axis], reversed[i + 3 + axis]];
  }
  return reversed;
};
const cubeBoundary = (size, inward = false) => {
  const positions = Float32Array.from(cube.positions, value => value * size / 32);
  return inward ? reverseWinding(positions) : positions;
};
const sourceFromBoundaries = (...boundaries) => {
  const positions = new Float32Array(boundaries.reduce((length, boundary) => length + boundary.length, 0));
  let offset = 0;
  for (const boundary of boundaries) { positions.set(boundary, offset); offset += boundary.length; }
  return parseSTL(encodeBinarySTL(positions));
};

function assertExportClosed(result) {
  assert.equal(result.stats.meshingMethod, 'explicit-rods');
  assert.equal(result.stats.watertight, true);
  assert.equal(result.stats.boundaryEdges, 0);
  assert.equal(result.stats.nonManifoldEdges, 0);
  assert.equal(result.stats.inconsistentWindingEdges, 0);
  assert.ok(result.stats.volumeMm3 > 0);
  const exported = parseSTL(encodeBinarySTL(result.positions));
  assert.equal(exported.stats.watertight, true, 'the actual STL must remain closed after export');
  assert.equal(exported.stats.inconsistentWindingEdges, 0);
  assert.equal(exported.stats.degenerateTriangles, 0);
  assert.equal(exported.stats.duplicateTriangles, 0);
}

test('explicit rods fuse with a sampled outer shell and top/bottom caps without filling the cells', async () => {
  const result = await generateRodLattice(cube, { ...regular, shellThickness: 2, bottomThickness: 2, topThickness: 2 });
  assertExportClosed(result);
  assert.equal(result.stats.components, 1);
  assert.ok(result.stats.regionVoxelSize > 0, 'hybrid geometry reports the shell sampling size');
  assert.equal(result.stats.voxelSize, result.stats.regionVoxelSize);
  assert.ok(result.warnings.some(warning => /shell.*sampled/i.test(warning)));
  assert.equal(isPointInsideMesh(result, [4,4,15]), true, 'top cap is solid between rods');
  assert.equal(isPointInsideMesh(result, [4,4,-15]), true, 'bottom cap is solid between rods');
  assert.equal(isPointInsideMesh(result, [15,4,4]), true, 'outer shell closes the side between rods');
  assert.equal(isPointInsideMesh(result, [4,4,4]), false, 'an internal cell stays open');
});

test('a hollow source keeps its internal void through explicit rods, shell union and keep-largest', async () => {
  const hollow = sourceFromBoundaries(cubeBoundary(32), cubeBoundary(16, true));
  const result = await generateRodLattice(hollow, { ...regular, shellThickness: 2, keepLargest: true });
  assertExportClosed(result);
  assert.equal(result.stats.components, 1);
  assert.ok(result.stats.cavityComponents >= 1, 'the retained solid must include its cavity boundary');
  assert.equal(isPointInsideMesh(result, [0,0,0]), false);
  assert.equal(isPointInsideMesh(result, [4,4,4]), false);
  assert.equal(isPointInsideMesh(result, [15,4,4]), true);
  assert.equal(isPointInsideMesh(result, [0,0,10]), true);
});

test('keep-largest removes a nested hollow island together with its own cavity boundary', async () => {
  // Outer material surrounds a 24 mm cavity. A separate 10 mm hollow cube
  // floats inside it, with its own 6 mm cavity. Only the outer solid survives.
  const nested = sourceFromBoundaries(cubeBoundary(32), cubeBoundary(24, true), cubeBoundary(10), cubeBoundary(6, true));
  const options = { ...regular, cellSize: 16, shellThickness: 3 };
  const all = await generateRodLattice(nested, options);
  const kept = await generateRodLattice(nested, { ...options, keepLargest: true });
  assertExportClosed(all);
  assertExportClosed(kept);
  assert.equal(all.stats.components, 2);
  assert.equal(kept.stats.components, 1);
  assert.ok(kept.stats.discardedComponents >= 1);
  assert.equal(isPointInsideMesh(all, [4,0,0]), true, 'the nested island exists before filtering');
  assert.equal(isPointInsideMesh(kept, [4,0,0]), false, 'the detached island is removed');
  assert.equal(isPointInsideMesh(all, [0,0,0]), false);
  assert.equal(isPointInsideMesh(kept, [0,0,0]), false, 'a retained orphan cavity must never create phantom material');
  assert.equal(isPointInsideMesh(kept, [14,0,0]), true, 'the outer solid survives');
  assert.equal(kept.stats.surfaceComponents, 2, 'only the outer boundary and its own cavity remain');
  assert.ok(kept.stats.volumeMm3 < all.stats.volumeMm3);
});

test('positive surface inset moves inward identically for outward and globally reversed source winding', async () => {
  const inwardSource = sourceFromBoundaries(reverseWinding(cube.positions));
  assert.equal(inwardSource.stats.watertight, true);
  assert.equal(inwardSource.stats.inconsistentWindingEdges, 0, 'global reversal is consistent winding');
  const options = { ...regular, mode: 'surface', surfaceInset: 2 };
  const outward = await generateRodLattice(cube, options);
  const reversed = await generateRodLattice(inwardSource, options);
  assertExportClosed(outward);
  assertExportClosed(reversed);
  for (const result of [outward, reversed]) {
    assert.equal(isPointInsideMesh(result, [8,4,14]), true, 'the rod moves 2 mm below the top face');
    assert.equal(isPointInsideMesh(result, [8,4,16]), false, 'the rod no longer crosses the original surface');
    assert.equal(isPointInsideMesh(result, [8,4,18]), false, 'positive inset must not move the network outward');
    assert.ok(result.bounds.max[2] < 16);
  }
  assert.ok(Math.abs(outward.stats.volumeMm3 / reversed.stats.volumeMm3 - 1) < 1e-6);
  for (const side of ['min', 'max']) for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(outward.bounds[side][axis] - reversed.bounds[side][axis]) < 1e-5);
  }
});
