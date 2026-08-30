import initOpenCascade from './cad-kernel/replicad_single.js';
import { buildStepDocument } from './cad-step-geometry.js';

let kernelPromise;

function loadKernel() {
  kernelPromise ||= initOpenCascade({
    locateFile: filename => new URL(`./cad-kernel/${filename}`, import.meta.url).href,
  });
  return kernelPromise;
}

self.onmessage = async event => {
  if (event.data?.type !== 'export') return;
  try {
    self.postMessage({ type: 'progress', message: 'Loading the local OpenCascade B-Rep kernel · first export may take a moment…' });
    const oc = await loadKernel();
    const result = await buildStepDocument(oc, event.data.payload, message => self.postMessage({ type: 'progress', message }));
    self.postMessage({ type: 'result', bytes: result.bytes, stats: result.stats }, [result.bytes.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
