// The Boolean kernel is loaded in the geometry worker, only for rod modes.
let pending;
export function loadManifold() {
  pending ||= (async () => {
    const inNode = typeof process !== 'undefined' && !!process.versions?.node;
    const moduleURL = inNode ? 'manifold-3d' : new URL('./manifold/manifold.js', import.meta.url).href;
    const { default: createModule } = await import(moduleURL);
    const kernel = await createModule();
    kernel.setup();
    return kernel;
  })().catch(error => { pending = null; throw new Error(`The rod geometry kernel could not load: ${error.message}`); });
  return pending;
}
