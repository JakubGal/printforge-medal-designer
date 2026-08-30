import test from 'node:test';
import assert from 'node:assert/strict';
import initOpenCascade from 'replicad-opencascadejs';
import { buildStepDocument } from '../cad-step-geometry.js';
import { packStepColumns } from '../cad-step-export.js';

test('production columns round-trip as manifold B-Rep STEP without faceted geometry', { timeout: 60_000 }, async () => {
  const cols = 5, rows = 5;
  const columns = Array.from({ length: cols * rows }, (_, cell) => {
    if (cell === 12) return [];
    const row = Math.floor(cell / cols), col = cell % cols;
    const engravedCenter = row > 0 && row < 4 && col > 0 && col < 4;
    return [{ z0: 0, z1: engravedCenter ? 1.2 : 2.4, slot: 0 }];
  });
  // The accent is a separate manifold material body, not triangles disguised
  // as STEP faces.
  for (const cell of [1, 2, 3]) columns[cell].push({ z0: 2.4, z1: 3.2, slot: 1 });

  const sliceData = { bounds: { cols, rows, minX: -2.5, minY: -2.5 }, cell: 1, columns };
  const { payload } = packStepColumns(sliceData);
  assert.ok(payload.columnData.z0 instanceof Float64Array, 'STEP preserves authored Z precision');

  const oc = await initOpenCascade();
  const result = await buildStepDocument(oc, payload);
  const step = new TextDecoder().decode(result.bytes);
  assert.ok(step.startsWith('ISO-10303-21;'));
  assert.match(step, /MANIFOLD_SOLID_BREP/u);
  assert.doesNotMatch(step, /FACETED_BREP|TRIANGULATED/u);
  assert.equal(result.stats.materialCount, 2);
  assert.equal(result.stats.solidCount, 2);
  assert.ok(Math.abs(result.stats.sourceVolumeMm3 - result.stats.importedVolumeMm3) < 1e-4);
  assert.deepEqual(result.stats.importedBounds, result.stats.sourceBounds);
});
