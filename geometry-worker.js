import { buildMeshes } from './export-engine.js';

function packColumns(columns) {
  const offsets = new Uint32Array(columns.length + 1);
  let count = 0;
  for (let index = 0; index < columns.length; index += 1) {
    count += columns[index]?.length || 0;
    offsets[index + 1] = count;
  }
  const z0 = new Float32Array(count), z1 = new Float32Array(count), slots = new Uint16Array(count);
  let cursor = 0;
  for (const column of columns) for (const segment of column || []) {
    z0[cursor] = segment.z0; z1[cursor] = segment.z1; slots[cursor] = segment.slot; cursor += 1;
  }
  return { offsets, z0, z1, slots };
}

function addTransfer(transfers, value) {
  if (value?.buffer instanceof ArrayBuffer && !transfers.includes(value.buffer)) transfers.push(value.buffer);
}

self.onmessage = async event => {
  const { id, project, options } = event.data;
  try {
    const result = await buildMeshes(project, message => self.postMessage({ id, type: 'progress', message }), options);
    const transfers = [];
    result.meshes = result.meshes.map(mesh => {
      const triangles = mesh.triangles instanceof Float32Array ? mesh.triangles : Float32Array.from(mesh.triangles);
      addTransfer(transfers, triangles);
      return { ...mesh, triangles };
    });
    if (result.sliceData?.columns) {
      result.sliceData.columnData = packColumns(result.sliceData.columns);
      delete result.sliceData.columns;
      addTransfer(transfers, result.sliceData.baseMask);
      addTransfer(transfers, result.sliceData.columnData.offsets);
      addTransfer(transfers, result.sliceData.columnData.z0);
      addTransfer(transfers, result.sliceData.columnData.z1);
      addTransfer(transfers, result.sliceData.columnData.slots);
    }
    if (result.previewMasks) result.previewMasks = result.previewMasks.map(mask => {
      const indices = mask.indices instanceof Uint32Array ? mask.indices : Uint32Array.from(mask.indices);
      addTransfer(transfers, indices); addTransfer(transfers, mask.owners);
      return { ...mask, indices };
    });
    self.postMessage({ id, type: 'result', result }, transfers);
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error?.message || String(error), stack: error?.stack || '' });
  }
};
