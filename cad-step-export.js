const STEP_EXPORT_TIMEOUT_MS = 10 * 60_000;

export function packStepColumns(sliceData) {
  const bounds = sliceData?.bounds;
  const cell = Number(sliceData?.cell);
  const columns = sliceData?.columns;
  if (!bounds || !Array.isArray(columns) || columns.length !== bounds.cols * bounds.rows || !Number.isFinite(cell) || cell <= 0) {
    throw new Error('The production column field is not available for STEP export.');
  }
  const offsets = new Uint32Array(columns.length + 1);
  let count = 0;
  for (let index = 0; index < columns.length; index += 1) {
    count += columns[index]?.length || 0;
    if (count > 4_000_000) throw new Error('The STEP model exceeds the safe 4,000,000-segment browser limit.');
    offsets[index + 1] = count;
  }
  const z0 = new Float64Array(count), z1 = new Float64Array(count), slots = new Uint16Array(count);
  let cursor = 0;
  for (const column of columns) for (const segment of column || []) {
    z0[cursor] = segment.z0;
    z1[cursor] = segment.z1;
    slots[cursor] = segment.slot;
    cursor += 1;
  }
  return {
    payload: {
      bounds: { cols: bounds.cols, rows: bounds.rows, minX: bounds.minX, minY: bounds.minY },
      cell,
      columnData: { offsets, z0, z1, slots },
    },
    transfers: [offsets.buffer, z0.buffer, z1.buffer, slots.buffer],
  };
}

export function columnsToStep(sliceData, onProgress = () => {}) {
  const { payload, transfers } = packStepColumns(sliceData);
  const worker = new Worker(new URL('./cad-step-worker.js', import.meta.url), { type: 'module', name: 'medalforge-step' });
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      callback(value);
    };
    const done = finish(resolve), fail = finish(reject);
    timeout = setTimeout(() => fail(new Error('OpenCascade STEP export exceeded the 10-minute safety timeout.')), STEP_EXPORT_TIMEOUT_MS);
    worker.onerror = event => fail(new Error(event.message || 'The OpenCascade STEP worker could not start.'));
    worker.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'progress') {
        onProgress(message.message);
        return;
      }
      if (message.type === 'error') {
        fail(new Error(message.message || 'OpenCascade STEP export failed.'));
        return;
      }
      if (message.type === 'result') {
        const bytes = message.bytes instanceof Uint8Array ? message.bytes : new Uint8Array(message.bytes);
        done({ blob: new Blob([bytes], { type: 'model/step' }), stats: message.stats });
      }
    };
    worker.postMessage({ type: 'export', payload }, transfers);
  });
}
