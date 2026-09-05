import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = process.cwd();
const destination = join(root, 'public');
const releaseTag = '20260905-release45';
const rootFiles = [
  'index.html',
  '404.html',
  '404.js',
  'workspace-hub.css',
  'workspace-hub.js',
  'workspace-registry.js',
  'localization.js',
  'localization-runtime.js',
  'og.png',
  '.nojekyll',
  '_headers',
];
const workspaceFiles = [
  'workspaces/medals/index.html',
  'workspaces/voronoi/index.html',
];
const voronoiFiles = [
  'lattice-app.js',
  'lattice.css',
  'lattice-engine.js',
  'lattice-worker.js',
  'lattice-viewer.js',
  'lattice-settings.js',
  'lattice-solid.js',
  'lattice-rods.js',
  'lattice-surface.js',
  'lattice-manifold.js',
  'lattice-validate.js',
];
const medalFiles = [
  'styles.css',
  'app.js',
  'localization.js',
  'localization-runtime.js',
  'guide-library.js',
  'runtime-config.js',
  'cloud-image-provider.js',
  'openai-medal-provider.js',
  'local-image-provider.js',
  'local-medal-provider.js',
  'project-model.js',
  'medal-preview.js',
  'shape-library.js',
  'export-engine.js',
  'geometry-engine.js',
  'geometry-worker.js',
  'storage.js',
  'image-processing.js',
  'image-worker.js',
  'viewer3d.js',
  'render-studio.js',
  'report-engine.js',
  'concept-engine.js',
  'medal-aesthetic.js',
  'curated-examples.js',
  'cad-step-export.js',
  'cad-step-geometry.js',
  'cad-step-worker.js',
  'quality-target-user.png',
  'quality-target-original.png',
];
const medalAssetDestination = join(destination, 'assets', 'medals');
const guideAssetDestination = join(medalAssetDestination, 'guides');
const guideAssetSource = join(root, 'guides');
const cadKernelDestination = join(medalAssetDestination, 'cad-kernel');
const cadKernelSource = join(root, 'node_modules', 'replicad-opencascadejs');

async function copyProjectFile(file, target = file) {
  const output = join(destination, target);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(join(root, file), output);
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await Promise.all(rootFiles.map(file => copyProjectFile(file)));
await Promise.all(workspaceFiles.map(file => copyProjectFile(file)));
await Promise.all(medalFiles.map(file => copyProjectFile(file, join('assets', 'medals', file))));
await Promise.all(voronoiFiles.map(file => copyProjectFile(file, join('assets', 'voronoi', file))));
const rodKernelDestination = join(destination, 'assets', 'voronoi', 'manifold');
await mkdir(rodKernelDestination, { recursive: true });
await Promise.all(['manifold.js','manifold.wasm','LICENSE'].map(file => copyFile(join(root,'node_modules','manifold-3d',file),join(rodKernelDestination,file))));
await cp(guideAssetSource, guideAssetDestination, { recursive: true, force: true });
const browserModules = [
  ...rootFiles.filter(file => file.endsWith('.js')).map(file => join(destination, file)),
  ...medalFiles.filter(file => file.endsWith('.js')).map(file => join(medalAssetDestination, file)),
  ...voronoiFiles.filter(file => file.endsWith('.js')).map(file => join(destination, 'assets', 'voronoi', file)),
];
await Promise.all(browserModules.map(async file => {
  const source = await readFile(file, 'utf8');
  const versioned = source
    .replace(/((?:from\s+|import\s*)['"])(\.\/[^'"]+\.js)(?:\?[^'"]*)?(['"])/g, `$1$2?v=${releaseTag}$3`)
    .replace(/(new URL\(['"])(\.\/[^'"]+\.js)(?:\?[^'"]*)?(['"]\s*,\s*import\.meta\.url\))/g, `$1$2?v=${releaseTag}$3`);
  await writeFile(file, versioned);
}));
await rm(cadKernelDestination, { recursive: true, force: true });
await mkdir(cadKernelDestination, { recursive: true });
await Promise.all([
  copyFile(join(cadKernelSource, 'dist', 'replicad_single.js'), join(cadKernelDestination, 'replicad_single.js')),
  copyFile(join(cadKernelSource, 'dist', 'replicad_single.wasm'), join(cadKernelDestination, 'replicad_single.wasm')),
  copyFile(join(cadKernelSource, 'LICENSE'), join(cadKernelDestination, 'LICENSE.txt')),
]);
console.log(`Synced the workspace hub, ${workspaceFiles.length} studios, ${medalFiles.length} medal assets, ${voronoiFiles.length} Voronoi assets, eight quick guides, and the lazy OpenCascade kernel to public/.`);
