import { parseSTL, createDemoMesh, generateLattice } from './lattice-engine.js';
import { generateRodLattice } from './lattice-solid.js';

self.onmessage = async event => {
  const { id, type, buffer, unitScale, kind, mesh, options } = event.data;
  try {
    if (type === 'import' || type === 'demo') {
      const source = type === 'import' ? parseSTL(buffer, { unitScale: unitScale ?? 1 }) : createDemoMesh(kind);
      self.postMessage({ id, type: 'source', mesh: source }, [source.positions.buffer]);
    } else if (type === 'generate') {
      const generator = ['surface','struts'].includes(options.mode) ? generateRodLattice : generateLattice;
      const result = await generator(mesh, options, (progress, message) => self.postMessage({ id, type: 'progress', progress, message }));
      self.postMessage({ id, type: 'result', result }, [result.positions.buffer]);
    } else throw new Error('Unknown lattice worker request.');
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error?.message || String(error) });
  }
};
