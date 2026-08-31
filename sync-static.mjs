import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = process.cwd();
const destination = join(root, 'public');
const releaseTag = '20260831-release24';
const rootFiles = [
  'index.html',
  '404.html',
  '404.js',
  'workspace-hub.css',
  'workspace-hub.js',
  'workspace-registry.js',
  'og.png',
  '.nojekyll',
  '_headers',
];
const workspaceFiles = [
  'workspaces/medals/index.html',
];
const medalFiles = [
  'styles.css',
  'app.js',
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
await cp(guideAssetSource, guideAssetDestination, { recursive: true, force: true });
const browserModules = [
  ...rootFiles.filter(file => file.endsWith('.js')).map(file => join(destination, file)),
  ...medalFiles.filter(file => file.endsWith('.js')).map(file => join(medalAssetDestination, file)),
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
console.log(`Synced the workspace hub, ${workspaceFiles.length} studio, ${medalFiles.length} medal assets, eight quick guides, and the lazy OpenCascade kernel to public/.`);
