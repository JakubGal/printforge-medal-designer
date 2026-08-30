import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASIA_FILAMENT_PRESETS,
  DEFAULT_INVENTORY,
  DESIGN_LIMITS,
  RIM_STYLE_INFO,
  TEMPLATE_INFO,
  buildChecks,
  calculateQuote,
  createTemplateProject,
  elementBounds,
  elementFitsSafeArea,
  imageUsedSlots,
  inventorySnapshotForProject,
  medalAttachmentGeometry,
  medalContainsPoint,
  medalFaceArea,
  normalizeDrawnPath,
  normalizeInventory,
  normalizeProject,
  normalizeProjectBundle,
  offsetPolygon,
  pointInPolygon,
  pointSegmentDistance,
  polygonSelfIntersects,
  presetMedalOutlinePoints,
  projectBackOffset,
  projectBundleForExport,
  projectUsedSlots,
  rimAreaEstimate,
  rimContainsPoint,
  simplifyClosedRing,
  simplifyPolyline,
} from '../project-model.js';
import { buildMeshes, inspectExportBudget, meshToBinaryStl, meshesTo3mf, meshesToStlZip, projectToSvg, validateGeneratedMeshes } from '../export-engine.js';
import { buildColumnField, columnFieldToMeshes, inspectColumn, meshCellForProject, raycastColumnField, validateMesh } from '../geometry-engine.js';
import { MedalViewer3D, VIEWER_FRAGMENT_SHADER, VIEWER_VERTEX_SHADER, planarTransformBetween, viewerBufferSize, viewerGeometryBudget, viewerTriangleBuffers } from '../viewer3d.js';
import { applyImageStyle, detectLikelyTextBands, detectMedalFaceCrop, indexedRasterFootprint, inferDominantSourceColors, inferMedalSurfaceColors, maskOutsideCircularFace, matchSourceColorsToFilaments, rasterRegionFootprint, removeConnectedBackground, segmentPaletteRegions, visibleArtworkCrop } from '../image-processing.js';
import { buildTechnicalSheetModel, jpegToSinglePagePdf, projectFaceToTechnicalSvg } from '../report-engine.js';

function maskSample(result, x, y) {
  const { bounds, baseMask } = result.sliceData;
  const col = Math.floor((x - bounds.minX) / result.cell);
  const row = Math.floor((y - bounds.minY) / result.cell);
  if (col < 0 || row < 0 || col >= bounds.cols || row >= bounds.rows) return undefined;
  return baseMask[row * bounds.cols + col];
}

function unmatchedMeshEdges(mesh) {
  const counts = new Map();
  const vertexKey = (x, y, z) => `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
  for (let offset = 0; offset < mesh.triangles.length; offset += 9) {
    const vertices = [0, 3, 6].map(index => vertexKey(mesh.triangles[offset + index], mesh.triangles[offset + index + 1], mesh.triangles[offset + index + 2]));
    for (const [a, b] of [[vertices[0], vertices[1]], [vertices[1], vertices[2]], [vertices[2], vertices[0]]]) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.values()].filter(count => count !== 2).length;
}

function testCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseStoredZip(bytes) {
  const entries = new Map();
  const localOffsets = new Map();
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    const signature = view.getUint32(0, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    assert.equal(signature, 0x04034b50, `invalid local ZIP header at ${offset}`);
    assert.equal(view.getUint16(8, true), 0, 'test parser expects an uncompressed ZIP entry');
    const expectedCrc = view.getUint32(14, true);
    const compressedSize = view.getUint32(18, true);
    const uncompressedSize = view.getUint32(22, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    assert.equal(compressedSize, uncompressedSize);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    assert.ok(dataEnd <= bytes.length, 'ZIP entry stays inside the package');
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    const data = bytes.slice(dataStart, dataEnd);
    assert.equal(testCrc32(data), expectedCrc, `${name} CRC matches its local header`);
    entries.set(name, data);
    localOffsets.set(name, offset);
    offset = dataEnd;
  }
  const centralStart = offset;
  let centralCount = 0;
  while (offset + 4 <= bytes.length && new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset).getUint32(0, true) === 0x02014b50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    const nameLength = view.getUint16(28, true), extraLength = view.getUint16(30, true), commentLength = view.getUint16(32, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    assert.ok(entries.has(name), `${name} central record points to a local entry`);
    assert.equal(view.getUint32(42, true), localOffsets.get(name), `${name} central offset matches`);
    assert.equal(view.getUint32(16, true), testCrc32(entries.get(name)), `${name} central CRC matches`);
    offset += 46 + nameLength + extraLength + commentLength;
    centralCount += 1;
  }
  const end = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
  assert.equal(end.getUint32(0, true), 0x06054b50, 'ZIP has an end-of-central-directory record');
  assert.equal(end.getUint16(8, true), entries.size);
  assert.equal(end.getUint16(10, true), entries.size);
  assert.equal(centralCount, entries.size);
  assert.equal(end.getUint32(16, true), centralStart);
  assert.equal(end.getUint32(12, true), offset - centralStart);
  return entries;
}

test('default template has editable objects and can export with warnings', () => {
  const project = createTemplateProject('night');
  const checks = buildChecks(project, DEFAULT_INVENTORY);
  assert.equal(project.elements.length, 3);
  assert.equal(checks.some(check => check.level === 'block'), false);
});

test('blank start and photo-inspired examples preserve their observed front/back construction', () => {
  const blank = createTemplateProject('blank');
  assert.equal(blank.elements.length, 0);
  assert.equal(blank.paletteIds[0], 'midnight-black');
  assert.equal(blank.medal.loopStyle, 'double');
  for (const key of ['photo-night', 'photo-archive']) {
    const example = normalizeProject(createTemplateProject(key));
    assert.equal(example.template, key);
    assert.equal(example.profile.nozzle, .2);
    assert.ok(example.elements.length >= 9);
    assert.ok(example.elements.every(element => ['front', 'back'].includes(element.face)));
    assert.ok(example.elements.every(element => Number.isFinite(element.scaleX) && Number.isFinite(element.scaleY)));
    assert.ok(example.elements.some(element => element.face === 'front'));
    assert.ok(example.elements.some(element => element.face === 'back'));
    assert.ok(example.groups.length >= 2);
    assert.ok(example.elements.every(element => !element.groupId || example.groups.some(group => group.id === element.groupId)));
    assert.equal(buildChecks(example, DEFAULT_INVENTORY).some(check => check.level === 'block'), false);
  }
  const night = normalizeProject(createTemplateProject('photo-night'));
  const archive = normalizeProject(createTemplateProject('photo-archive'));
  assert.ok(night.elements.some(element => element.face === 'back' && element.name === 'Back distance' && element.text === '10'));
  assert.ok(night.elements.some(element => element.face === 'back' && element.name === 'Back blue panel'));
  assert.ok(archive.elements.some(element => element.face === 'front' && element.name === 'blue panel' && elementBounds(element).x < -10), 'photo-oriented blue panel remains on the left when the attachment is at the top');
  assert.ok(archive.elements.some(element => element.face === 'front' && element.name === 'green disc' && element.x > 0));
  assert.ok(archive.elements.filter(element => element.face === 'front' && /detailed silhouette/.test(element.name) && element.type === 'path' && element.points.length > 80).length >= 2, 'both athletes use high-detail traced anatomical vectors');
  assert.ok(archive.elements.some(element => element.face === 'front' && element.name === 'event' && element.text === 'archívna' && element.rotation === 0));
  assert.ok(archive.elements.some(element => element.face === 'back' && element.name === 'Back edition' && element.text === '– 7. ročník –' && element.y > 0));
  assert.ok(archive.elements.some(element => element.face === 'back' && element.name === 'Back date' && element.text === '18.9.2026' && element.y < 0));
  assert.ok(archive.elements.some(element => element.face === 'back' && element.name === 'Back place' && element.text === 'Ivanka pri Nitre' && element.y < 0));
  assert.ok(archive.elements.filter(element => element.face === 'back' && /Back red roof/.test(element.name)).length >= 5);
  assert.ok(archive.elements.filter(element => element.face === 'back').every(element => element.operation === 'inlay' && element.zDepth === archive.profile.layerHeight), 'reverse remains flush first-layer color');
  assert.equal(archive.medal.edgeInset, 0, 'the gray perimeter reaches the physical body edge without a black halo');
  assert.equal(archive.paletteIds[5], 'signal-red');
  assert.equal(night.paletteIds.length, 6);
  assert.equal(archive.paletteIds.length, 6);
  const tram = normalizeProject(createTemplateProject('photo-tram'));
  assert.ok(tram.elements.length >= 9);
  assert.ok(tram.elements.every(element => element.face === 'front'), 'the observed Ivanka back remains completely flat');
  assert.equal(tram.groups.length, 1);
  assert.equal(buildChecks(tram, DEFAULT_INVENTORY).some(check => check.level === 'block'), false);
});

test('Prague night showcase is a detailed, printable, editable two-sided medal', () => {
  assert.equal(TEMPLATE_INFO['showcase-night'].label, 'Prague Midnight 21K');
  const project = normalizeProject(createTemplateProject('showcase-night'));
  const front = project.elements.filter(element => element.face === 'front');
  const back = project.elements.filter(element => element.face === 'back');
  const activeHeights = new Set(project.elements.filter(element => element.operation === 'raise').map(element => element.zHeight));
  const groupIds = new Set(project.groups.map(group => group.id));

  assert.equal(project.template, 'showcase-night');
  assert.equal(project.profile.nozzle, .4);
  assert.equal(project.profile.meshQuality, 'ultra');
  assert.equal(project.medal.loopStyle, 'double');
  assert.equal(project.medal.diameter, 74);
  assert.equal(project.paletteIds.length, 5);
  assert.ok(project.elements.length >= 35);
  assert.ok(front.length >= 20);
  assert.ok(back.length >= 15);
  assert.ok(project.groups.length >= 7);
  assert.ok(project.elements.every(element => groupIds.has(element.groupId)));
  assert.deepEqual(new Set(project.elements.map(element => element.type)), new Set(['shape', 'path', 'text']));
  assert.ok(project.elements.some(element => element.name === 'Hero runner body' && element.type === 'path' && element.points.length > 100));
  assert.ok(project.elements.some(element => element.face === 'back' && element.name === 'Vltava course line'));
  assert.ok(project.elements.some(element => element.face === 'back' && element.operation === 'inlay'));
  assert.ok(activeHeights.size >= 7, 'showcase uses distinct physical relief levels');
  assert.ok(new Set(front.map(element => element.color)).size >= 5);
  assert.ok(new Set(back.map(element => element.color)).size >= 5);
  assert.equal(buildChecks(project, DEFAULT_INVENTORY).some(check => check.level === 'block'), false);
});

test('interactive safe-area checks use actual circular artwork instead of its square bounds', () => {
  const project = normalizeProject(createTemplateProject('blank'));
  const circle = {
    id: 'round-art', type: 'shape', name: 'Round artwork', shape: 'circle',
    x: 2, y: 9, size: 30, scaleX: 1, scaleY: 1, rotation: 0,
    face: 'front', operation: 'raise', zHeight: .6, color: 1,
  };
  const inset = project.medal.edgeInset + project.medal.rimWidth;
  assert.equal(elementFitsSafeArea(project, circle, inset), true);
  const bounds = elementBounds(circle);
  assert.equal(medalContainsPoint(project, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, inset), false, 'old AABB-corner validator would wrongly reject this circle');
});

test('image segment safe-area checks transform the persistent visible-pixel footprint instead of empty box corners', () => {
  const width = 10, height = 10;
  const pixels = [];
  for (let y = 0; y < height; y += 1) for (const x of [4, 5]) pixels.push(y * width + x);
  const footprint = rasterRegionFootprint(pixels, width, height, { minX: 0, minY: 0, maxX: 9, maxY: 9 });
  assert.ok(footprint.length >= 4);
  assert.ok(Math.max(...footprint.map(point => Math.abs(point[0]))) <= .101, 'empty horizontal box corners are absent');
  assert.equal(Math.max(...footprint.map(point => Math.abs(point[1]))), .5, 'occupied end cells retain their full physical extent');

  const project = normalizeProject({
    medal: { diameter: 60, width: 60, height: 60, edgeInset: 2, rimWidth: 0, loopStyle: 'none' },
    paletteIds: ['midnight-black', 'natural-white'],
    elements: [{
      id: 'sparse-image', type: 'image', rasterKind: 'segment', name: 'Sparse vertical lettering',
      x: 0, y: 0, width: 54, height: 54, pixelWidth: width, pixelHeight: height,
      detailCell: .54, minimumFeature: .54, footprint, dataUrl: 'data:image/png;base64,AA==',
      color: 1, face: 'front', rotation: 0, scaleX: 1, scaleY: 1,
      operation: 'raise', zHeight: .6,
    }],
  });
  const element = project.elements[0];
  assert.deepEqual(element.footprint, footprint, 'normalization persists the bounded footprint');
  assert.equal(elementFitsSafeArea(project, element, 2), true);
  assert.equal(elementFitsSafeArea(project, { ...element, footprint: undefined }, 2), false, 'the legacy full rectangle is correctly too large');
  assert.equal(elementFitsSafeArea(project, { ...element, rotation: 90 }, 2), true, 'rotation is applied to the footprint');
  assert.equal(elementFitsSafeArea(project, { ...element, face: 'back' }, 2), true, 'back-face reflection is applied safely');
  assert.equal(elementFitsSafeArea(project, { ...element, x: 5 }, 2), false, 'actual occupied pixels still cannot cross the protected edge');
  assert.equal(buildChecks(project, DEFAULT_INVENTORY).some(check => check.title.includes('crosses the safe area')), false);
  const withoutFootprint = structuredClone(project); delete withoutFootprint.elements[0].footprint;
  assert.equal(buildChecks(withoutFootprint, DEFAULT_INVENTORY).some(check => check.title.includes('crosses the safe area')), true);

  const indexed = new Uint8Array(width * height).fill(255);
  for (const index of pixels) indexed[index] = 1;
  assert.deepEqual(indexedRasterFootprint(indexed, width, height), rasterRegionFootprint(pixels, width, height, { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 }));
});

test('element dimensions and face survive normalization and SVG export', () => {
  const project = normalizeProject({
    medal: { diameter: 60, loopStyle: 'none' },
    paletteIds: ['midnight-black', 'natural-white'],
    elements: [{ type: 'text', text: 'BACK', name: 'Back label', x: 2, y: 3, fontSize: 6, face: 'back', scaleX: 1.5, scaleY: .75, rotation: 12, color: 1, operation: 'raise', zHeight: .6 }],
  });
  project.palette = DEFAULT_INVENTORY.filter(item => project.paletteIds.includes(item.id));
  const [element] = project.elements;
  assert.equal(element.face, 'back');
  assert.equal(element.scaleX, 1.5);
  assert.equal(element.scaleY, .75);
  assert.ok(elementBounds(element).width > elementBounds({ ...element, scaleX: 1 }).width);
  const svg = projectToSvg(project);
  assert.match(svg, /data-face="back"/);
  assert.match(svg, /data-layout="front-back"/);
  assert.match(svg, /data-artboard-face="front"/);
  assert.match(svg, /data-artboard-face="back"/);
  assert.match(svg, /translate\(2 -3\) rotate\(-12\) scale\(1\.5 0\.75\)/);
  assert.match(svg, /data-back-body-outside-view="true" transform="scale\(1 -1\)"/);
  assert.doesNotMatch(svg, /data-face="back"[^>]*scale\(1 -1\)/);
});

test('manual paths preserve world coordinates and printable stroke bounds', () => {
  const normalized = normalizeDrawnPath([[3, 4], [7, 8], [9, 4]]);
  assert.deepEqual([normalized.x, normalized.y], [6, 6]);
  assert.deepEqual(normalized.points.map(([x, y]) => [x + normalized.x, y + normalized.y]), [[3,4],[7,8],[9,4]]);
  const bounds = elementBounds({ type: 'path', x: normalized.x, y: normalized.y, scale: 1, strokeWidth: 1, closed: false, points: normalized.points });
  assert.equal(bounds.width, 7);
  assert.equal(bounds.height, 5);
});

test('manual drawing geometry helpers simplify and hit precisely', () => {
  const simplified = simplifyPolyline([[0,0],[1,.01],[2,0],[3,1]], .05);
  assert.deepEqual(simplified[0], [0,0]);
  assert.deepEqual(simplified.at(-1), [3,1]);
  assert.ok(simplified.length < 4);
  assert.equal(pointSegmentDistance([1,.2], [0,0], [2,0]), .2);
  assert.equal(pointInPolygon([1,1], [[0,0],[2,0],[2,2],[0,2]]), true);
  assert.equal(pointInPolygon([3,1], [[0,0],[2,0],[2,2],[0,2]]), false);
});

test('larger nozzle blocks details that are below one extrusion line', () => {
  const project = createTemplateProject('night');
  project.profile.nozzle = .8;
  project.profile.layerHeight = .4;
  const checks = buildChecks(project, DEFAULT_INVENTORY);
  assert.equal(checks.some(check => check.level === 'block'), true);
});

test('same-layer multicolor designs require a multicolor print system', () => {
  const project = createTemplateProject('night');
  project.profile.colorSystem = 'manual';
  const checks = buildChecks(project, DEFAULT_INVENTORY);
  assert.equal(checks.some(check => check.title.includes('multicolor system') && check.level === 'block'), true);
});

test('quantity tiers lower the per-piece estimate', () => {
  const project = createTemplateProject('night');
  const one = calculateQuote(project, DEFAULT_INVENTORY, 1);
  const hundred = calculateQuote(project, DEFAULT_INVENTORY, 100);
  assert.ok(one.unit > hundred.unit);
  assert.ok(hundred.total > one.total);
});

test('group IDs remain unique and imported memberships survive normalization', () => {
  const project = normalizeProject({
    medal: { diameter: 60 },
    paletteIds: ['midnight-black'],
    groups: [{ id: 'Team Art', name: 'First' }, { id: 'team-art', name: 'Second' }],
    elements: [
      { type: 'text', text: 'A', groupId: 'Team Art' },
      { type: 'text', text: 'B', groupId: 'team-art' },
    ],
  });
  assert.equal(new Set(project.groups.map(group => group.id)).size, 2);
  assert.equal(project.elements[0].groupId, project.groups[0].id);
  assert.equal(project.elements[1].groupId, project.groups[1].id);
});

test('zero-cost filament and case-insensitive solid effects quote honestly', () => {
  const project = normalizeProject({ medal: { diameter: 40, loopStyle: 'none', rimWidth: 0 }, paletteIds: ['free-solid'], elements: [] });
  const lowercase = normalizeInventory([{ id: 'free-solid', name: 'Test', brand: 'Local', material: 'PLA', color: '#222222', pricePerKg: 0, stockGrams: 1000, effect: 'solid', density: 1.24 }]);
  const titlecase = normalizeInventory([{ ...lowercase[0], effect: 'Solid' }]);
  const lowerQuote = calculateQuote(project, lowercase, 1);
  const titleQuote = calculateQuote(project, titlecase, 1);
  assert.equal(lowerQuote.materialPerPiece, 0);
  assert.equal(lowerQuote.total, titleQuote.total);
});

test('imported projects are clamped to the supported manufacturing range', () => {
  const project = normalizeProject({
    name: 'Imported',
    profile: { nozzle: 9, layerHeight: 4 },
    medal: { diameter: 500, baseThickness: 999 },
    paletteIds: ['midnight-black', 'electric-blue'],
    elements: [],
  });
  assert.equal(project.profile.nozzle, .4);
  assert.equal(project.medal.diameter, DESIGN_LIMITS.medalMax);
  assert.equal(project.medal.baseThickness, DESIGN_LIMITS.baseThicknessMax);
  assert.equal(normalizeProject({ medal: { baseThickness: -20 } }).medal.baseThickness, 1.2);
});

test('medal body thickness survives project export and changes material pricing', () => {
  const thin = normalizeProject({
    medal: { diameter: 60, baseThickness: 2, loopStyle: 'none', rimWidth: 0 },
    paletteIds: ['midnight-black'],
    elements: [],
  });
  const thick = normalizeProject({ ...thin, medal: { ...thin.medal, baseThickness: 4 } });
  const restored = normalizeProject(projectBundleForExport(thick, DEFAULT_INVENTORY));
  assert.equal(restored.medal.baseThickness, 4);
  assert.ok(calculateQuote(thick, DEFAULT_INVENTORY, 1).gramsPerPiece > calculateQuote(thin, DEFAULT_INVENTORY, 1).gramsPerPiece);
});

test('design palettes support sixteen explicit colors and supplier references remain honest about stock', () => {
  const catalog = normalizeInventory([...DEFAULT_INVENTORY, ...ASIA_FILAMENT_PRESETS]);
  const ids = catalog.slice(0, DESIGN_LIMITS.paletteSlots).map(filament => filament.id);
  assert.equal(ids.length, DESIGN_LIMITS.paletteSlots);
  const project = normalizeProject({ paletteIds: ids, elements: [] });
  assert.deepEqual(project.paletteIds, ids);
  assert.equal(normalizeProject({ paletteIds: [ids[0]], elements: [] }).paletteIds.length, 1);
  const supplier = catalog.find(filament => filament.id === 'sunlu-pla-black');
  assert.equal(supplier.stockKnown, false);
  assert.match(supplier.productUrl, /^https:\/\//);
  assert.ok(supplier.sourcePrice > 0);
});

test('filament snapshots are sanitized and restore missing or conflicting colors without overwriting local stock', () => {
  const local = normalizeInventory([
    { id: 'shared', name: 'Local blue', brand: 'Local', material: 'PLA', color: '#0055ff', pricePerKg: 500, stockGrams: 900, effect: 'Solid', density: 1.24 },
    DEFAULT_INVENTORY[0],
  ]);
  const bundle = {
    version: 3,
    name: 'Imported palette',
    profile: { nozzle: .4, layerHeight: .2 },
    medal: { diameter: 60, loopStyle: 'none' },
    paletteIds: ['shared', 'new-glow'],
    elements: [],
    inventorySnapshot: [
      { id: 'shared', name: 'Imported red', brand: 'Remote', material: 'PLA', color: '#ff2200', pricePerKg: -80, stockGrams: 42, effect: 'Solid', density: 1.24, unexpected: '<script>' },
      { id: 'new glow', name: 'Glow\u0000 spool', brand: 'Custom', material: 'pla', color: '#abc', pricePerKg: 700, stockGrams: 100, effect: 'Glow', density: 99 },
    ],
  };
  // IDs are normalized in both the project and its envelope.
  bundle.paletteIds[1] = 'new glow';
  const restored = normalizeProjectBundle(bundle, local);
  assert.equal(restored.missing.length, 0);
  assert.equal(restored.remapped.length, 1);
  assert.notEqual(restored.project.paletteIds[0], 'shared');
  assert.equal(restored.project.paletteIds[1], 'new-glow');
  assert.equal(restored.inventory.find(item => item.id === 'shared').stockGrams, 900, 'local stock is not overwritten');
  const importedConflict = restored.inventory.find(item => item.id === restored.project.paletteIds[0]);
  assert.equal(importedConflict.color, '#ff2200');
  assert.equal(importedConflict.pricePerKg, 0);
  const glow = restored.inventory.find(item => item.id === 'new-glow');
  assert.equal(glow.color, '#aabbcc');
  assert.equal(glow.density, 3);
  assert.equal(Object.hasOwn(glow, 'unexpected'), false);

  const exported = projectBundleForExport(restored.project, restored.inventory);
  assert.deepEqual(exported.inventorySnapshot, inventorySnapshotForProject(restored.project, restored.inventory));
  assert.equal(Object.hasOwn(normalizeProject(exported), 'inventorySnapshot'), false);
  const restoredAgain = normalizeProjectBundle(bundle, restored.inventory);
  assert.equal(restoredAgain.inventory.length, restored.inventory.length, 're-import reuses the preserved conflict record');
  assert.equal(restoredAgain.project.paletteIds[0], restored.project.paletteIds[0]);
});

test('version 1 relief and nested operations migrate without losing Z values', () => {
  const project = normalizeProject({
    version: 1,
    name: 'Migrated',
    profile: { nozzle: .4, layerHeight: .2 },
    medal: { diameter: 60, reliefHeight: .8, baseThickness: 3 },
    paletteIds: ['midnight-black', 'electric-blue'],
    elements: [{ id: 'legacy', type: 'shape', shape: 'circle', size: 8, operation: { kind: 'engrave', depthMm: .6, heightMm: 1.2 } }],
  });
  assert.equal(project.version, 7);
  assert.equal(project.elements[0].operation, 'engrave');
  assert.equal(project.elements[0].zDepth, .6);
  assert.equal(project.elements[0].zHeight, 1.2);
});

test('version 7 adds independent body material and printable rim styles without losing legacy projects', () => {
  const migrated = normalizeProject({
    version: 6,
    medal: { diameter: 68, rimColor: 1, rimWidth: 2.4 },
    paletteIds: ['midnight-black', 'silk-gold'],
    elements: [],
  });
  assert.equal(migrated.version, 7);
  assert.equal(migrated.medal.baseColor, 0);
  assert.equal(migrated.medal.rimStyle, 'classic');

  const authored = normalizeProject({
    version: 7,
    medal: { diameter: 68, baseColor: 1, rimColor: 0, rimStyle: 'wings', rimWidth: 3.2, rimHeight: .8 },
    paletteIds: ['midnight-black', 'silk-gold'],
    elements: [],
  });
  assert.equal(authored.medal.baseColor, 1);
  assert.equal(authored.medal.rimColor, 0);
  assert.equal(authored.medal.rimStyle, 'wings');
});

test('every raised-edge style has a physical mask and an area estimate', () => {
  const counts = new Map();
  for (const style of Object.keys(RIM_STYLE_INFO)) {
    const project = normalizeProject({
      version: 7,
      medal: { diameter: 72, rimStyle: style, rimWidth: 3, rimHeight: .8 },
      paletteIds: ['midnight-black', 'silk-gold'],
      elements: [],
    });
    let count = 0;
    for (let y = -36; y <= 36; y += .5) for (let x = -36; x <= 36; x += .5) if (rimContainsPoint(project, x, y)) count += 1;
    counts.set(style, count);
    assert.ok(count > 0, `${style} has printable raised-edge cells`);
    assert.ok(rimAreaEstimate(project) > 0, `${style} contributes material to the quote`);
  }
  assert.ok(new Set(counts.values()).size >= 4, 'styles are not aliases for one continuous ring');
});

test('base and raised-edge materials propagate independently into SVG output', () => {
  const project = normalizeProject({
    version: 7,
    name: 'Independent materials',
    medal: { diameter: 66, baseColor: 1, rimColor: 0, rimStyle: 'wings', rimWidth: 3.4, rimHeight: .8 },
    paletteIds: ['midnight-black', 'electric-blue'],
    elements: [],
  });
  project.palette = [DEFAULT_INVENTORY[0], DEFAULT_INVENTORY[1]];
  const svg = projectToSvg(project);
  assert.match(svg, /data-rim-style="wings"/);
  assert.match(svg, new RegExp(`fill="${DEFAULT_INVENTORY[1].color}"`, 'i'));
});

test('technical report writer emits a self-contained single-page PDF', async () => {
  const minimalJpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const blob = jpegToSinglePagePdf(minimalJpeg, 1000, 1000);
  assert.equal(blob.type, 'application/pdf');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const latin = new TextDecoder('latin1').decode(bytes);
  assert.ok(latin.startsWith('%PDF-1.4'));
  assert.match(latin, /\/DCTDecode/);
  assert.match(latin, /xref/);
  assert.match(latin, /%%EOF/);
});

test('technical report uses physical polygon extents instead of nominal construction axes', async () => {
  const project = createTemplateProject('blank');
  project.medal = { ...project.medal, shape: 'hexagon', width: 74, height: 78, diameter: 78, loopStyle: 'none' };
  const model = await buildTechnicalSheetModel({ project: normalizeProject(project), inventory: DEFAULT_INVENTORY, quantity: 25 });
  assert.ok(Math.abs(model.dimensions.faceWidth - 74 * Math.cos(Math.PI / 6)) < .001);
  assert.equal(model.dimensions.faceHeight, 78);
});

test('technical report separates exact front and readable outside-facing reverse artwork', async () => {
  const project = normalizeProject(createTemplateProject('photo-archive'));
  project.medal.attachmentColor = 3;
  project.medal.attachmentHeight = .4;
  const model = await buildTechnicalSheetModel({ project, inventory: DEFAULT_INVENTORY, quantity: 25 });
  const front = projectFaceToTechnicalSvg(model.project, 'front');
  const back = projectFaceToTechnicalSvg(model.project, 'back');
  assert.match(front, /data-technical-face="front"/);
  assert.match(front, /data-artboard-face="front"/);
  assert.doesNotMatch(front, /data-artboard-face="back"/);
  assert.match(back, /data-technical-face="back"/);
  assert.match(back, /data-orientation="ribbon-up-outside-facing-readable"/);
  assert.match(back, /REVERSE · OUTSIDE VIEW/);
  assert.doesNotMatch(back, /data-artboard-face="front"/);
  assert.match(back, /data-artboard-face="back"/);
  assert.doesNotMatch(back, /data-back-body-outside-view/);
  assert.doesNotMatch(back, /data-rim-style=/);
  assert.doesNotMatch(back, /data-attachment-face-color=/);
  assert.doesNotMatch(back, /scale\(1 -1\)/);
  assert.doesNotMatch(back, /data-artboard-face="back" transform="translate/);
  assert.ok(model.faces.front.elementCount > 0);
  assert.ok(model.faces.back.elementCount > 0);
  assert.ok(model.faces.front.colorSlots.includes(project.medal.baseColor));
  assert.ok(model.faces.front.colorSlots.includes(project.medal.rimColor));
  assert.ok(model.faces.front.colorSlots.includes(project.medal.attachmentColor));
  assert.equal(model.faces.front.attachmentCapSlot, project.medal.attachmentColor);
  assert.equal(model.faces.back.attachmentCapSlot, null);
  assert.ok(model.materials.some(row => row.slot === project.medal.attachmentColor && row.roles.includes('attachment cap')));
  assert.equal(model.quote.quantity, 25);
  assert.ok(model.quote.total > 0);
});

test('image XY height never collides with raised Z height during migration', () => {
  const project = normalizeProject({
    version: 2,
    profile: { nozzle: .4, layerHeight: .2 },
    medal: { diameter: 60, baseThickness: 2.4 },
    paletteIds: ['midnight-black', 'electric-blue'],
    elements: [{ id: 'image', type: 'image', width: 30, height: 18, sourceWidth: 1000, sourceHeight: 600, zHeight: .6, operation: 'raise', dataUrl: 'data:image/png;base64,AA==' }],
  });
  assert.equal(project.elements[0].height, 18);
  assert.equal(project.elements[0].zHeight, .6);
  const recovered = normalizeProject({ ...project, version: 2, elements: [{ ...project.elements[0], height: .6, sourceWidth: 1000, sourceHeight: 600 }] });
  assert.equal(recovered.elements[0].height, 18);
  assert.equal(recovered.elements[0].zHeight, .6);
  const recoveredFromPlausibleLegacyHeight = normalizeProject({ ...project, version: 2, elements: [{ ...project.elements[0], height: 5, sourceWidth: 1000, sourceHeight: 600 }] });
  assert.equal(recoveredFromPlausibleLegacyHeight.elements[0].height, 18);
});

test('nested operation flags migrate and newer project versions are rejected', () => {
  const project = normalizeProject({ version: 2, paletteIds: ['midnight-black', 'electric-blue'], elements: [{ type: 'shape', shape: 'circle', operation: { kind: 'raise', heightMm: .8, combine: 'stack', layerSnap: false } }] });
  assert.equal(project.elements[0].combine, 'stack');
  assert.equal(project.elements[0].layerSnap, false);
  assert.throws(() => normalizeProject({ version: 99 }), /newer MedalForge version/);
});

test('custom medal outlines remain editable, measurable, and export to SVG', () => {
  const project = normalizeProject({
    profile: { nozzle: .4, layerHeight: .2 },
    medal: { shape: 'custom', width: 60, height: 60, outline: [[0,-30],[30,0],[0,30],[-30,0]], loopStyle: 'none' },
    paletteIds: ['midnight-black', 'electric-blue'], elements: [],
  });
  project.palette = DEFAULT_INVENTORY.slice(0, 2);
  assert.equal(project.medal.shape, 'custom');
  assert.equal(medalContainsPoint(project, 0, 0), true);
  assert.equal(medalContainsPoint(project, 28, 28), false);
  assert.equal(medalFaceArea(project), 1800);
  assert.match(projectToSvg(project), /<polygon points="0,-30 30,0 0,30 -30,0"/);
  assert.equal(medalContainsPoint(project, 0, -28, 3), false);
  assert.equal(medalContainsPoint(project, 0, 0, 3), true);
  assert.equal(offsetPolygon(project.medal.outline, 2).length, 4);
});

test('basic faceted and decorative medal bodies share one printable outline definition', () => {
  for (const shape of ['hexagon', 'octagon', 'scalloped', 'star', 'gear', 'shield']) {
    const project = normalizeProject({
      version: 7,
      medal: { shape, width: 64, height: 70, diameter: 64, loopStyle: 'none' },
      paletteIds: ['midnight-black'], elements: [],
    });
    project.palette = [DEFAULT_INVENTORY[0]];
    const points = presetMedalOutlinePoints(shape, 64, 70);
    assert.ok(points.length >= 6, `${shape} has an analytic editable outline`);
    assert.equal(medalContainsPoint(project, 0, 0), true);
    assert.equal(medalContainsPoint(project, 32, 35), false);
    assert.ok(medalFaceArea(project) > 900);
    assert.match(projectToSvg(project), /<polygon points=/);
  }
});

test('closed outline cleanup preserves the whole ring and rejects touching edges', () => {
  const detailed = Array.from({ length: 1400 }, (_, index) => {
    const angle = index * Math.PI * 2 / 1400;
    return [Math.cos(angle) * 30, Math.sin(angle) * 25];
  });
  const simplified = simplifyClosedRing(detailed, .01, 512);
  assert.ok(simplified.length <= 512 && simplified.length > 100);
  assert.ok(Math.min(...simplified.map(point => point[0])) < -29);
  assert.ok(Math.max(...simplified.map(point => point[0])) > 29);
  assert.equal(polygonSelfIntersects([[0,0],[4,0],[4,4],[0,4]]), false);
  assert.equal(polygonSelfIntersects([[0,0],[4,4],[0,4],[4,0]]), true);
  assert.equal(polygonSelfIntersects([[0,0],[4,0],[2,0],[2,3]]), true);
});

test('column engine resolves independent raise, engrave, inlay, and through-cut heights', () => {
  const baseMask = Uint8Array.from([1, 1, 1, 1]);
  const operations = [
    { kind: 'raise', amount: .4, indices: [0], owners: Uint8Array.from([1]) },
    { kind: 'engrave', amount: .4, indices: [1] },
    { kind: 'inlay', amount: .4, height: 0, indices: [2], owners: Uint8Array.from([1]) },
    { kind: 'cut', indices: [3] },
  ];
  const field = buildColumnField(baseMask, 2, operations, { minimumFloor: 1 });
  assert.deepEqual(inspectColumn(field, baseMask, 0), [{ z0: 0, z1: 2, slot: 0 }, { z0: 2, z1: 2.4, slot: 1 }]);
  assert.deepEqual(inspectColumn(field, baseMask, 1), [{ z0: 0, z1: 1.6, slot: 0 }]);
  assert.deepEqual(inspectColumn(field, baseMask, 2), [{ z0: 0, z1: 1.6, slot: 0 }, { z0: 1.6, z1: 2, slot: 1 }]);
  assert.deepEqual(inspectColumn(field, baseMask, 3), []);
  assert.equal(field.maxHeight, 2.4);
  assert.equal(field.cutCells, 1);

  const meshes = columnFieldToMeshes(field, baseMask, { cols: 2, rows: 2, minX: 0, minY: 0 }, 1, [{ name: 'Base', color: '#111' }, { name: 'Accent', color: '#fff' }]);
  assert.equal(meshes.length, 2);
  assert.ok(Math.abs(meshes.filter(mesh => mesh.slot === 0).reduce((sum, mesh) => sum + mesh.volumeMm3, 0) - 5.2) < 1e-6);
  assert.ok(Math.abs(meshes.filter(mesh => mesh.slot === 1).reduce((sum, mesh) => sum + mesh.volumeMm3, 0) - .4) < 1e-6);
  assert.equal(field.regularizedBands, 1);
  for (const mesh of meshes) {
    assert.equal(mesh.triangles.length % 9, 0);
    for (let offset = 0; offset < mesh.triangles.length; offset += 9) {
      const [ax,ay,az,bx,by,bz,cx,cy,cz] = mesh.triangles.slice(offset, offset + 9);
      const ux=bx-ax, uy=by-ay, uz=bz-az, vx=cx-ax, vy=cy-ay, vz=cz-az;
      assert.ok(Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx) > 1e-8);
    }
    assert.equal(unmatchedMeshEdges(mesh), 0);
    assert.equal(validateMesh(mesh).valid, true);
  }
});

test('front and back operations share a minimum floor and support underside relief', () => {
  const mask = Uint8Array.from([1, 1, 1, 1]);
  const operations = [
    { kind: 'raise', face: 'back', amount: .6, slot: 1, indices: [0] },
    { kind: 'engrave', face: 'back', amount: .4, indices: [1] },
    { kind: 'inlay', face: 'back', amount: .4, height: .2, slot: 1, indices: [2] },
    { kind: 'engrave', amount: .8, indices: [3] },
    { kind: 'engrave', face: 'back', amount: .8, indices: [3] },
  ];
  const field = buildColumnField(mask, 2.4, operations, { baseOffset: .6, minimumFloor: 1.2 });
  assert.equal(field.baseOffset, .6);
  assert.equal(field.baseTop, 3);
  assert.deepEqual(inspectColumn(field, mask, 0), [{ z0: 0, z1: .6, slot: 1 }, { z0: .6, z1: 3, slot: 0 }]);
  assert.deepEqual(inspectColumn(field, mask, 1), [{ z0: 1, z1: 3, slot: 0 }]);
  assert.deepEqual(inspectColumn(field, mask, 2), [{ z0: .4, z1: 1, slot: 1 }, { z0: 1, z1: 3, slot: 0 }]);
  const opposed = inspectColumn(field, mask, 3);
  assert.ok(opposed.at(-1).z1 - opposed[0].z0 >= 1.2 - 1e-6);
});

test('disjoint opposing circular pockets do not trigger an AABB-only floor collision', () => {
  const project = normalizeProject({
    medal: { diameter: 60, baseThickness: 2.4, minimumFloor: 1.2, loopStyle: 'none', rimWidth: 0 },
    paletteIds: ['midnight-black', 'natural-white'],
    elements: [
      { id: 'front-pocket', type: 'shape', name: 'Front pocket', shape: 'circle', size: 10, x: -4, y: -4, face: 'front', operation: 'engrave', zDepth: .8, color: 1 },
      { id: 'back-pocket', type: 'shape', name: 'Back pocket', shape: 'circle', size: 10, x: 4, y: 4, face: 'back', operation: 'engrave', zDepth: .8, color: 1 },
    ],
  });
  assert.equal(buildChecks(project, DEFAULT_INVENTORY).some(check => check.title.includes('shared floor')), false);
});

test('disjoint rotated opposing rectangles do not trigger an AABB-only floor collision', () => {
  const project = normalizeProject({
    medal: { diameter: 60, baseThickness: 2.4, minimumFloor: 1.2, loopStyle: 'none' },
    paletteIds: ['midnight-black', 'natural-white'],
    elements: [
      { type: 'shape', name: 'Front bar', shape: 'rectangle', size: 20, scaleX: 1, scaleY: .1, x: 0, y: 0, rotation: 45, face: 'front', operation: 'engrave', zDepth: .8, color: 1 },
      { type: 'shape', name: 'Back bar', shape: 'rectangle', size: 20, scaleX: 1, scaleY: .1, x: -2, y: 2, rotation: -45, face: 'back', operation: 'engrave', zDepth: .8, color: 1 },
    ],
  });
  assert.equal(buildChecks(project, DEFAULT_INVENTORY).some(check => check.title === 'Front and back pockets leave too little shared floor'), false);
});

test('back-face artwork normalizes to flush inlays without changing its filament ownership', () => {
  const project = normalizeProject({
    medal: { diameter: 60, baseThickness: 2.4, loopStyle: 'none' },
    paletteIds: ['midnight-black', 'natural-white', 'electric-blue', 'signal-orange'],
    elements: [
      { id: 'back-raised', type: 'shape', name: 'Raised import', shape: 'circle', size: 8, face: 'back', operation: 'raise', zHeight: .8, color: 1 },
      { id: 'back-engraved', type: 'shape', name: 'Engraved import', shape: 'square', size: 7, face: 'back', operation: 'engrave', zDepth: .7, color: 2 },
      { id: 'back-cut', type: 'shape', name: 'Cut import', shape: 'star', size: 6, face: 'back', operation: 'cut', color: 3 },
      { id: 'back-proud-inlay', type: 'shape', name: 'Proud inlay import', shape: 'circle', size: 5, face: 'back', operation: 'inlay', zDepth: .5, inlayHeight: .4, color: 1 },
      { id: 'front-raised', type: 'shape', name: 'Front relief', shape: 'circle', size: 4, face: 'front', operation: 'raise', zHeight: .6, color: 2 },
    ],
  });
  const back = project.elements.filter(element => element.face === 'back');
  assert.equal(back.length, 4);
  assert.ok(back.every(element => element.operation === 'inlay'), 'raised, engraved, cut, and proud reverse imports all become color inlays');
  assert.ok(back.every(element => element.inlayHeight === 0), 'reverse inlays end exactly at the original flat underside');
  assert.ok(back.every(element => element.zDepth === project.profile.layerHeight), 'every reverse color owns exactly the build-plate layer');
  assert.ok(back.every(element => element.combine === 'replace' && element.layerSnap === true));
  assert.deepEqual(back.map(element => element.color), [1, 2, 3, 1], 'normalization keeps the authored filament slot');
  assert.equal(projectBackOffset(project), 0, 'flush reverse artwork does not lift the medal body');
  assert.equal(project.elements.find(element => element.id === 'front-raised').operation, 'raise', 'front relief remains unchanged');
});

test('flat back color still owns one complete coarse layer with a conservative minimum floor', () => {
  const project = normalizeProject({
    profile: { nozzle: .8, layerHeight: .5 },
    medal: { diameter: 40, baseThickness: 1.2, minimumFloor: 1, loopStyle: 'none' },
    paletteIds: ['midnight-black', 'natural-white'],
    elements: [{ type: 'shape', shape: 'circle', size: 8, face: 'back', operation: 'raise', zHeight: .8, color: 1 }],
  });
  const artwork = project.elements[0];
  assert.equal(artwork.zDepth, .5);
  const field = buildColumnField(Uint8Array.from([1]), project.medal.baseThickness, [
    { kind: artwork.operation, face: artwork.face, amount: artwork.zDepth, height: artwork.inlayHeight, slot: artwork.color, indices: [0] },
  ], { baseOffset: 0, minimumFloor: project.medal.minimumFloor });
  assert.deepEqual(inspectColumn(field, Uint8Array.from([1]), 0), [
    { z0: 0, z1: .5, slot: 1 },
    { z0: .5, z1: 1.2, slot: 0 },
  ]);
});

test('flush back inlays keep column and exported mesh undersides planar with owned colors', () => {
  const mask = Uint8Array.from([1, 1, 1]);
  const field = buildColumnField(mask, 2.4, [
    { kind: 'inlay', face: 'back', amount: .4, height: 0, slot: 1, indices: [0] },
    { kind: 'inlay', face: 'back', amount: .6, height: 0, slot: 2, indices: [1] },
  ], { baseOffset: 0, minimumFloor: 1.2 });

  assert.deepEqual(inspectColumn(field, mask, 0), [{ z0: 0, z1: .4, slot: 1 }, { z0: .4, z1: 2.4, slot: 0 }]);
  assert.deepEqual(inspectColumn(field, mask, 1), [{ z0: 0, z1: .6, slot: 2 }, { z0: .6, z1: 2.4, slot: 0 }]);
  assert.deepEqual(inspectColumn(field, mask, 2), [{ z0: 0, z1: 2.4, slot: 0 }]);
  assert.equal(field.baseOffset, 0);
  assert.equal(field.maxHeight, 2.4);
  for (let index = 0; index < mask.length; index += 1) {
    const column = inspectColumn(field, mask, index);
    assert.equal(column[0].z0, 0, `column ${index} reaches the same flat build-plane underside`);
    assert.equal(column.at(-1).z1, 2.4, `column ${index} keeps the original medal top plane`);
    for (let segment = 1; segment < column.length; segment += 1) assert.equal(column[segment - 1].z1, column[segment].z0, 'inlay remains fully supported without an air gap');
  }

  const palette = [{ name: 'Base', color: '#111' }, { name: 'White', color: '#fff' }, { name: 'Blue', color: '#08f' }];
  const meshes = columnFieldToMeshes(field, mask, { cols: 3, rows: 1, minX: 0, minY: 0 }, 1, palette);
  assert.deepEqual([...new Set(meshes.map(mesh => mesh.slot))].sort((a, b) => a - b), [0, 1, 2]);
  for (const mesh of meshes) {
    const zValues = mesh.triangles.filter((_, coordinate) => coordinate % 3 === 2);
    assert.ok(zValues.every(z => z >= 0 && z <= 2.4), `slot ${mesh.slot} exports inside the unchanged medal envelope`);
    assert.equal(Math.min(...zValues), 0, `slot ${mesh.slot} owns part of the common flat underside`);
    assert.ok(zValues.some(z => z === 0), `slot ${mesh.slot} exports a build-plane face`);
    assert.equal(validateMesh(mesh).valid, true);
  }
  assert.ok(Math.abs(meshes.filter(mesh => mesh.slot === 1).reduce((sum, mesh) => sum + mesh.volumeMm3, 0) - .4) < 1e-6);
  assert.ok(Math.abs(meshes.filter(mesh => mesh.slot === 2).reduce((sum, mesh) => sum + mesh.volumeMm3, 0) - .6) < 1e-6);
});

test('back replace remains connected after an earlier pocket', () => {
  const mask = Uint8Array.from([1, 1]);
  const field = buildColumnField(mask, 2.4, [
    { kind: 'engrave', face: 'back', amount: .4, indices: [0] },
    { kind: 'raise', face: 'back', amount: .6, slot: 1, indices: [0] },
  ], { baseOffset: .6, minimumFloor: 1.2 });
  const segments = inspectColumn(field, mask, 0), untouched = inspectColumn(field, mask, 1);
  assert.deepEqual(segments, [{ z0: 0, z1: 1, slot: 1 }, { z0: 1, z1: 3, slot: 0 }]);
  assert.equal(segments[0].z1, segments[1].z0);
  assert.equal(untouched[0].z0 - segments[0].z0, .6, 'replace relief keeps its requested underside height');
});

test('back inlay after relief is translated onto the build plate', () => {
  const mask = Uint8Array.from([1]);
  const field = buildColumnField(mask, 2.4, [
    { kind: 'raise', face: 'back', amount: .6, slot: 1, indices: [0] },
    { kind: 'inlay', face: 'back', amount: .4, height: .2, slot: 2, indices: [0] },
  ], { baseOffset: .6, minimumFloor: 1.2 });
  const segments = inspectColumn(field, mask, 0);
  assert.equal(segments[0].z0, 0);
  assert.equal(field.zShift, .4);
  assert.equal(segments[0].z1, segments[1].z0);
});

test('stacked back relief accumulates in authored order', () => {
  const mask = Uint8Array.from([1]);
  const field = buildColumnField(mask, 2.4, [
    { kind: 'raise', face: 'back', amount: .6, slot: 1, indices: [0] },
    { kind: 'raise', face: 'back', amount: .6, slot: 2, combine: 'stack', indices: [0] },
  ], { baseOffset: 1.2, minimumFloor: 1.2 });
  assert.deepEqual(inspectColumn(field, mask, 0), [
    { z0: 0, z1: .6, slot: 2 },
    { z0: .6, z1: 1.2, slot: 1 },
    { z0: 1.2, z1: 3.6, slot: 0 },
  ]);
  const project = normalizeProject({
    medal: { diameter: 60, baseThickness: 2.4, loopStyle: 'none' },
    paletteIds: ['midnight-black', 'natural-white', 'electric-blue'],
    elements: [
      { type: 'shape', shape: 'circle', size: 8, face: 'back', operation: 'raise', zHeight: .6, color: 1 },
      { type: 'shape', shape: 'circle', size: 6, face: 'back', operation: 'raise', zHeight: .6, color: 2, combine: 'stack' },
    ],
  });
  assert.equal(projectBackOffset(project), 0);
  assert.ok(project.elements.every(element => element.operation === 'inlay' && element.inlayHeight === 0));
});

test('disjoint back pockets do not erase another region stack budget', () => {
  const mask = Uint8Array.from([1, 1]);
  const field = buildColumnField(mask, 2.4, [
    { kind: 'raise', face: 'back', amount: .6, slot: 1, indices: [0] },
    { kind: 'engrave', face: 'back', amount: .4, indices: [1] },
    { kind: 'raise', face: 'back', amount: .6, slot: 2, combine: 'stack', indices: [0] },
  ], { baseOffset: 1.2, minimumFloor: 1.2 });
  assert.deepEqual(inspectColumn(field, mask, 0), [
    { z0: 0, z1: .6, slot: 2 },
    { z0: .6, z1: 1.2, slot: 1 },
    { z0: 1.2, z1: 3.6, slot: 0 },
  ]);
  const project = normalizeProject({
    medal: { diameter: 60, baseThickness: 2.4, loopStyle: 'none' },
    paletteIds: ['midnight-black', 'natural-white', 'electric-blue'],
    elements: [
      { type: 'shape', shape: 'circle', x: -8, size: 7, face: 'back', operation: 'raise', zHeight: .6, color: 1 },
      { type: 'shape', shape: 'circle', x: 8, size: 7, face: 'back', operation: 'engrave', zDepth: .4, color: 0 },
      { type: 'shape', shape: 'circle', x: -8, size: 5, face: 'back', operation: 'raise', zHeight: .6, color: 2, combine: 'stack' },
    ],
  });
  assert.equal(projectBackOffset(project), 0);
  assert.ok(project.elements.every(element => element.operation === 'inlay' && element.inlayHeight === 0));
});

test('plain multi-cell bodies are strictly edge-manifold', () => {
  const mask = Uint8Array.from([1, 1, 1, 1]);
  const field = buildColumnField(mask, 2, []);
  const [mesh] = columnFieldToMeshes(field, mask, { cols: 2, rows: 2, minX: 0, minY: 0 }, 1, [{ name: 'Base', color: '#111' }]);
  assert.equal(unmatchedMeshEdges(mesh), 0);
});

test('topology cleanup never refills a diagonal through-cut', () => {
  const mask = Uint8Array.from([1, 1, 1, 1]);
  const field = buildColumnField(mask, 2, [{ kind: 'cut', indices: [1, 2] }]);
  const meshes = columnFieldToMeshes(field, mask, { cols: 2, rows: 2, minX: 0, minY: 0 }, 1, [{ name: 'Base', color: '#222' }]);
  assert.equal(field.resolvedColumns[1].length, 0);
  assert.equal(field.resolvedColumns[2].length, 0);
  assert.ok(meshes.reduce((sum, mesh) => sum + mesh.volumeMm3, 0) <= 4);
  assert.ok(meshes.every(mesh => validateMesh(mesh).valid));
});

test('random topology cleanup never adds material or closes an authored cut', () => {
  let seed = 7;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let scenario = 0; scenario < 40; scenario += 1) {
    const mask = new Uint8Array(16); mask.fill(1);
    const operations = [];
    for (let operation = 0; operation < 10; operation += 1) {
      const kind = ['raise', 'engrave', 'inlay', 'cut'][Math.floor(random() * 4)];
      operations.push({
        kind,
        amount: [.2, .4, .6][Math.floor(random() * 3)],
        height: random() < .3 ? .2 : 0,
        indices: [Math.floor(random() * 16)],
        slot: Math.floor(random() * 2),
        combine: random() < .2 ? 'stack' : 'replace',
      });
    }
    const field = buildColumnField(mask, 2, operations, { minimumFloor: .8 });
    const authoredCuts = Array.from(mask, (value, index) => value && inspectColumn(field, mask, index).length === 0 ? index : -1).filter(index => index >= 0);
    let intendedVolume = 0;
    for (let index = 0; index < mask.length; index += 1) {
      for (const segment of inspectColumn(field, mask, index)) intendedVolume += segment.z1 - segment.z0;
    }
    const meshes = columnFieldToMeshes(field, mask, { cols: 4, rows: 4, minX: 0, minY: 0 }, 1, [{ name: 'A', color: '#111' }, { name: 'B', color: '#eee' }]);
    const actualVolume = meshes.reduce((sum, mesh) => sum + mesh.volumeMm3, 0);
    assert.ok(actualVolume <= intendedVolume + 1e-6, `scenario ${scenario} added material`);
    assert.equal(field.topologyCleanup.addedVolumeMm3, 0, `scenario ${scenario} refilled an air interval`);
    for (const index of authoredCuts) assert.equal(field.resolvedColumns[index].length, 0, `scenario ${scenario} closed cut ${index}`);
  }
});

test('dense non-cut operation fields remain strictly manifold', () => {
  let seed = 987654321;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const palette = [{ name: 'A', color: '#111' }, { name: 'B', color: '#888' }, { name: 'C', color: '#eee' }];
  for (let scenario = 0; scenario < 120; scenario += 1) {
    const mask = new Uint8Array(64).fill(1), operations = [];
    for (let operation = 0; operation < 30; operation += 1) {
      const x = Math.floor(random() * 8), y = Math.floor(random() * 8), width = 1 + Math.floor(random() * 4), height = 1 + Math.floor(random() * 4), indices = [];
      for (let row = y; row < Math.min(8, y + height); row += 1) for (let col = x; col < Math.min(8, x + width); col += 1) indices.push(row * 8 + col);
      operations.push({
        kind: ['raise', 'engrave', 'inlay'][Math.floor(random() * 3)], indices,
        owners: Uint8Array.from(indices, () => Math.floor(random() * 3)),
        amount: [.2, .4, .6, .8][Math.floor(random() * 4)], height: random() < .4 ? [0, .2, .4][Math.floor(random() * 3)] : 0,
        combine: random() < .3 ? 'stack' : 'replace',
      });
    }
    const field = buildColumnField(mask, 2.4, operations, { minimumFloor: .8 });
    const meshes = columnFieldToMeshes(field, mask, { cols: 8, rows: 8, minX: 0, minY: 0 }, 1, palette);
    for (const mesh of meshes) assert.equal(validateMesh(mesh).valid, true, `scenario ${scenario}, slot ${mesh.slot}, shell ${mesh.shell}`);
  }
});

test('diagonal engravings become manifold by expanding air, never closing the cut', () => {
  const mask = new Uint8Array(4).fill(1);
  const field = buildColumnField(mask, 2.4, [{ kind: 'engrave', amount: .2, indices: [1, 2] }], { minimumFloor: .8 });
  const meshes = columnFieldToMeshes(field, mask, { cols: 2, rows: 2, minX: 0, minY: 0 }, 1, [{ name: 'Base', color: '#111' }]);
  assert.ok(field.regularizedBands > 0);
  assert.ok(field.resolvedColumns[1].at(-1).z1 <= 2.2);
  assert.ok(field.resolvedColumns[2].at(-1).z1 <= 2.2);
  assert.ok(meshes.every(mesh => validateMesh(mesh).valid));
});

test('topology cleanup recomputes height and reports its exact voxel-grid impact', () => {
  const mask = new Uint8Array(9).fill(1);
  const field = buildColumnField(mask, 2, [{ kind: 'raise', amount: 1, slot: 1, indices: [1, 3, 5, 7] }]);
  const meshes = columnFieldToMeshes(field, mask, { cols: 3, rows: 3, minX: 0, minY: 0 }, 1, [{ name: 'Base' }, { name: 'Raised' }]);
  assert.equal(field.maxHeight, 2);
  assert.deepEqual(field.resolvedColumns.map(segments => segments.at(-1)?.z1), new Array(9).fill(2));
  assert.deepEqual(field.topologyCleanup, {
    mutatedBands: 4,
    mutationLimit: 8192,
    capped: false,
    passes: 1,
    estimatedAlteredVolumeMm3: 4,
    removedVolumeMm3: 4,
    reassignedVolumeMm3: 0,
    addedVolumeMm3: 0,
    affectedSlots: [1],
    maxAffectedZ: 3,
  });
  assert.ok(meshes.every(mesh => validateMesh(mesh).valid));
});

test('mesh allocation guard rejects unsafe grids before component allocation', () => {
  const mask = new Uint8Array(1_250_001);
  assert.throws(
    () => columnFieldToMeshes({ columns: [], baseSegment: [{ z0: 0, z1: 2, slot: 0 }] }, mask, { cols: mask.length, rows: 1, minX: 0, minY: 0 }, 1, [{ name: 'Base' }]),
    /cell safety budget/,
  );
});

test('exploded viewer clips layers in model space', () => {
  assert.match(VIEWER_VERTEX_SHADER, /vModelZ\s*=\s*modelPosition\.z/);
  assert.match(VIEWER_FRAGMENT_SHADER, /if\s*\(vModelZ\s*>\s*uClipZ/);
  assert.doesNotMatch(VIEWER_FRAGMENT_SHADER, /vWorld\.z\s*>\s*uClipZ/);
});

test('viewer proxy shader supports an exact live planar transform matrix', () => {
  assert.match(VIEWER_VERTEX_SHADER, /uniform\s+vec4\s+uPlanarMatrix/);
  assert.match(VIEWER_VERTEX_SHADER, /uPlanarOrigin/);
  const front = planarTransformBetween(
    { face: 'front', rotation: 90, scaleX: 1, scaleY: 1 },
    { face: 'front', rotation: 90, scaleX: 2, scaleY: 1 },
  );
  const back = planarTransformBetween(
    { face: 'back', rotation: 90, scaleX: 1, scaleY: 1 },
    { face: 'back', rotation: 90, scaleX: 2, scaleY: 1 },
  );
  for (const matrix of [front, back]) {
    assert.ok(Math.abs(matrix[0] - 1) < 1e-9);
    assert.ok(Math.abs(matrix[1]) < 1e-9);
    assert.ok(Math.abs(matrix[2]) < 1e-9);
    assert.ok(Math.abs(matrix[3] - 2) < 1e-9);
  }
});

test('viewer drawing buffer supersamples ordinary canvases and obeys its GPU pixel budget', () => {
  const ordinary = viewerBufferSize(932, 489, 1.5);
  assert.equal(ordinary.ratio, 2);
  assert.deepEqual([ordinary.width, ordinary.height], [1864, 978]);
  const bounded = viewerBufferSize(4000, 2000, 3, { pixelBudget: 4_500_000, maxDimension: 8192 });
  assert.ok(bounded.width * bounded.height <= 4_500_000 + Math.max(bounded.width, bounded.height));
  assert.ok(bounded.ratio < 1, 'an unusually large workspace scales below CSS resolution instead of exceeding the hard GPU budget');
  const dimensionBounded = viewerBufferSize(5000, 400, 2, { pixelBudget: 20_000_000, maxDimension: 4096 });
  assert.ok(dimensionBounded.width <= 4096);
});

test('viewer mesh refinement scales up only when device memory can safely hold it', () => {
  assert.deepEqual(viewerGeometryBudget(4), { maxCells: 420_000, maxTriangles: 2_000_000 });
  assert.deepEqual(viewerGeometryBudget(8), { maxCells: 600_000, maxTriangles: 2_600_000 });
  assert.deepEqual(viewerGeometryBudget(16), { maxCells: 720_000, maxTriangles: 3_200_000 });
  assert.ok(viewerGeometryBudget(16).maxCells < 1_050_000, 'viewport refinement stays below the production cell ceiling');
});

test('viewer smooths only shared vertical wall normals without moving printable vertices or softening caps', () => {
  const triangles = [
    // Two perpendicular vertical quads sharing the Z edge at x/y = 0.
    0,0,0, 0,1,0, 0,1,1, 0,0,0, 0,1,1, 0,0,1,
    0,0,0, 1,0,1, 1,0,0, 0,0,0, 0,0,1, 1,0,1,
    // A horizontal cap must stay exactly flat-shaded.
    0,0,1, 1,0,1, 0,1,1,
  ];
  const built = viewerTriangleBuffers({ triangles });
  const flat = viewerTriangleBuffers({ triangles }, { smoothSides: false });
  assert.deepEqual([...built.positions], [...flat.positions], 'display shading must not move printable geometry');
  const sharedNormals = [];
  for (let offset = 0; offset < 36; offset += 3) {
    if (Math.abs(built.positions[offset]) < 1e-7 && Math.abs(built.positions[offset + 1]) < 1e-7) {
      sharedNormals.push([built.normals[offset], built.normals[offset + 1], built.normals[offset + 2]]);
    }
  }
  assert.ok(sharedNormals.some(normal => Math.abs(normal[0]) > .2 && Math.abs(normal[1]) > .2 && Math.abs(normal[2]) < 1e-6));
  for (let offset = built.normals.length - 9; offset < built.normals.length; offset += 3) {
    assert.ok(Math.abs(built.normals[offset]) < 1e-7 && Math.abs(built.normals[offset + 1]) < 1e-7);
    assert.ok(Math.abs(built.normals[offset + 2] - 1) < 1e-7, 'horizontal caps retain exact flat normals');
  }
});

test('connected background cleanup preserves isolated matching logo details', () => {
  const width = 5, height = 5, data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    data[offset] = 255; data[offset + 1] = 255; data[offset + 2] = 255; data[offset + 3] = 255;
  }
  for (let y = 1; y <= 3; y += 1) for (let x = 1; x <= 3; x += 1) {
    const offset = (y * width + x) * 4;
    data[offset] = 0; data[offset + 1] = 0; data[offset + 2] = 0;
  }
  const center = (2 * width + 2) * 4;
  data[center] = 255; data[center + 1] = 255; data[center + 2] = 255;
  const cleaned = removeConnectedBackground({ data, width, height }, { mode: 'auto', tolerance: 30 });
  assert.equal(cleaned.data[3], 0, 'edge-connected white becomes transparent');
  assert.equal(cleaned.data[center + 3], 255, 'enclosed white detail stays opaque');
  const contrast = applyImageStyle(cleaned, { style: 'high-contrast', threshold: 128 });
  assert.equal(contrast.data[(1 * width + 1) * 4], 0);
});

test('connected background cleanup follows studio gradients without entering the medal', () => {
  const width = 15, height = 15, data = new Uint8ClampedArray(width * height * 4);
  const paint = (x, y, red, green = red, blue = red) => {
    const offset = (y * width + x) * 4;
    data[offset] = red; data[offset + 1] = green; data[offset + 2] = blue; data[offset + 3] = 255;
  };
  // This smooth warm-gray sweep spans far more than the fixed tolerance, just
  // like a generated product photo with a softbox gradient.
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const level = 245 - x * 4 - y * 2;
    paint(x, y, level, level - 3, level - 6);
  }
  // A dark medal surrounds a patch that intentionally matches the backdrop.
  // Connectivity, rather than color alone, must keep that internal detail.
  for (let y = 4; y <= 10; y += 1) for (let x = 4; x <= 10; x += 1) paint(x, y, 28, 34, 42);
  for (let y = 6; y <= 8; y += 1) for (let x = 6; x <= 8; x += 1) {
    const level = 245 - x * 4 - y * 2;
    paint(x, y, level, level - 3, level - 6);
  }

  const cleaned = removeConnectedBackground({ data, width, height }, { mode: 'auto', tolerance: 24 });
  const alpha = (x, y) => cleaned.data[(y * width + x) * 4 + 3];
  assert.equal(alpha(0, 0), 0, 'light end of the studio sweep is removed');
  assert.equal(alpha(14, 14), 0, 'dark end outside the fixed tolerance is reached adaptively');
  assert.equal(alpha(3, 7), 0, 'background beside the medal is removed');
  assert.equal(alpha(4, 7), 255, 'the abrupt dark medal edge remains opaque');
  assert.equal(alpha(7, 7), 255, 'an enclosed background-colored detail remains opaque');
});

test('medal-face detection crops away a connected ribbon and studio background', () => {
  const width = 120, height = 150, data = new Uint8ClampedArray(width * height * 4);
  const paint = (x, y, value) => {
    const offset = (y * width + x) * 4;
    data[offset] = value; data[offset + 1] = value; data[offset + 2] = value; data[offset + 3] = 255;
  };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) paint(x, y, 8);
  for (let y = 12; y <= 48; y += 1) for (let x = 40; x <= 80; x += 1) paint(x, y, 88);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (Math.hypot(x - 60, y - 93) <= 45) paint(x, y, 88);
  }
  const detected = detectMedalFaceCrop({ width, height, data }, { padding: 0 });
  assert.ok(detected && detected.confidence > .58, 'a round product face is recognized');
  assert.ok(Math.abs(detected.centerX - .5) < .03);
  assert.ok(Math.abs(detected.centerY - 93 / height) < .04);
  assert.ok(detected.crop[1] > .26, 'the connected ribbon above the disk is excluded');
  assert.ok(detected.crop[3] > .88 && detected.crop[3] < .95);
});

test('medal-face detection does not mistake a rectangular logo for a coin', () => {
  const width = 80, height = 80, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    const value = x >= 18 && x <= 61 && y >= 22 && y <= 57 ? 220 : 10;
    data[offset] = value; data[offset + 1] = value; data[offset + 2] = value; data[offset + 3] = 255;
  }
  assert.equal(detectMedalFaceCrop({ width, height, data }), null);
});

test('detected medal crop masking removes studio corners before object segmentation', () => {
  const width = 20, height = 20, data = new Uint8ClampedArray(width * height * 4).fill(90);
  for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
  const masked = maskOutsideCircularFace({ width, height, data });
  assert.equal(masked.data[3], 0, 'square studio corner becomes transparent');
  assert.equal(masked.data[((height / 2) * width + width / 2) * 4 + 3], 255, 'medal center remains untouched');
  const indices = new Uint8Array(width * height).fill(0);
  for (let index = 0; index < indices.length; index += 1) if (masked.data[index * 4 + 3] === 0) indices[index] = 255;
  const footprint = indexedRasterFootprint(indices, width, height);
  assert.ok(footprint.every(([x, y]) => Math.hypot(x, y) <= .53), 'studio corners cannot enter an image footprint');
});

test('complete-medal color inference adds a stocked gold accent to a black and white blank palette', () => {
  const width = 120, height = 120, data = new Uint8ClampedArray(width * height * 4);
  const paint = (x, y, color) => {
    const offset = (y * width + x) * 4;
    data[offset] = color[0]; data[offset + 1] = color[1]; data[offset + 2] = color[2]; data[offset + 3] = 255;
  };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    paint(x, y, Math.hypot(x - 60, y - 60) <= 56 ? [24, 27, 28] : [48, 49, 51]);
  }
  for (let y = 42; y <= 57; y += 1) for (let x = 24; x <= 95; x += 1) paint(x, y, [218, 164, 43]);
  for (let y = 70; y <= 81; y += 1) for (let x = 31; x <= 88; x += 1) paint(x, y, [244, 242, 234]);
  const colors = inferDominantSourceColors({ width, height, data }, { circular: true, maxColors: 5 });
  assert.ok(colors.some(color => color.lightness < 20), 'dark medal base remains represented');
  assert.ok(colors.some(color => color.lightness > 90), 'white lettering remains represented');
  assert.ok(colors.some(color => color.chroma > 55 && color.rgb[0] > color.rgb[1]), 'small gold artwork remains represented');
  const matched = matchSourceColorsToFilaments(colors, DEFAULT_INVENTORY, ['midnight-black', 'natural-white'], { maxTotalColors: 6 });
  assert.ok(matched.addIds.includes('silk-gold'), 'the closest stocked gold filament is added automatically');
  assert.ok(matched.addIds.length <= 4, 'automatic additions remain safely capped');
  const tightlyCapped = matchSourceColorsToFilaments(colors, DEFAULT_INVENTORY, ['midnight-black', 'natural-white'], { maxTotalColors: 3, maxAdditions: 4 });
  assert.equal(tightlyCapped.addIds.length, 1, 'the total design color cap is honored');
});

test('untouched medal surface samples keep a black face and rim despite bright artwork and a white studio background', () => {
  const width = 160, height = 160, data = new Uint8ClampedArray(width * height * 4);
  const paint = (x, y, color) => {
    const offset = (y * width + x) * 4;
    data[offset] = color[0]; data[offset + 1] = color[1]; data[offset + 2] = color[2]; data[offset + 3] = 255;
  };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const radius = Math.hypot(x - 80, y - 80) / 74;
    const texture = (x * 7 + y * 11) % 9;
    paint(x, y, radius <= 1 ? [18 + texture, 21 + texture, 23 + texture] : [242, 242, 239]);
  }
  // Large white title and gold date deliberately cover much of the center.
  for (let y = 48; y <= 69; y += 1) for (let x = 34; x <= 126; x += 1) paint(x, y, [244, 242, 234]);
  for (let y = 92; y <= 108; y += 1) for (let x = 45; x <= 115; x += 1) paint(x, y, [214, 164, 47]);
  const surface = inferMedalSurfaceColors({ width, height, data });
  assert.ok(surface.base && surface.base.lightness < 18, `base remains black, got ${surface.base?.hex}`);
  assert.ok(surface.rim && surface.rim.lightness < 18, `rim remains black, got ${surface.rim?.hex}`);
  const palette = matchSourceColorsToFilaments([surface.base, surface.rim], DEFAULT_INVENTORY, ['midnight-black', 'natural-white'], { maximumDistance: 60 });
  assert.deepEqual(new Set(palette.matches.map(match => match.id)), new Set(['midnight-black']));
});

test('materially closer unknown-stock filament wins over a distant stocked substitute', () => {
  const inventory = [
    { id: 'black', name: 'Black', color: '#202a2f', stockGrams: 1000 },
    { id: 'gray', name: 'Graphite', color: '#737a78', stockKnown: false, stockGrams: 0 },
  ];
  const match = matchSourceColorsToFilaments([{ rgb: [116, 122, 120], coverage: .1 }], inventory, ['black'], { maximumDistance: 60 });
  assert.equal(match.matches[0].id, 'gray');
  assert.equal(match.matches[0].available, false);
  assert.ok(match.addIds.includes('gray'), 'the closer color is added and stock remains a fulfillment concern');
});

test('text-line detection preserves aligned letters as one editable semantic object', () => {
  const width = 100, height = 60, indices = new Uint8Array(width * height).fill(255);
  for (const left of [10, 20, 30, 40, 50]) for (let y = 7; y <= 18; y += 1) for (let x = left; x < left + 5; x += 1) indices[y * width + x] = 0;
  for (let y = 27; y <= 53; y += 1) for (let x = 42; x <= 57; x += 1) indices[y * width + x] = 1;
  const bands = detectLikelyTextBands(indices, width, height);
  assert.equal(bands.length, 1);
  assert.equal(bands[0].componentIds.length, 5);
  assert.equal(bands[0].area, 300);
  const segmented = segmentPaletteRegions(indices, width, height);
  const text = segmented.regions.find(region => region.role === 'text');
  assert.ok(text, 'letter islands stay together instead of being scattered across generic detail buckets');
  assert.equal(text.slot, 0);
  assert.equal(text.area, 300);
  assert.equal(segmented.regions.reduce((sum, region) => sum + region.area, 0), 300 + 16 * 27);
});

test('palette segmentation deterministically identifies a border background and central subject', () => {
  const width = 9, height = 9;
  const indices = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) indices[y * width + x] = 0;
  }
  for (let y = 3; y <= 5; y += 1) for (let x = 3; x <= 5; x += 1) indices[y * width + x] = 1;
  indices[2 * width + 2] = 2;
  indices[6 * width + 6] = 2;

  const first = segmentPaletteRegions(indices, width, height);
  const second = segmentPaletteRegions(Uint8Array.from(indices), width, height);
  assert.deepEqual(second, first, 'the same printable raster produces stable parts, IDs, keys, and hit map');
  assert.deepEqual(first.regions.map(region => [region.slot, region.role, region.area]), [
    [0, 'background', 32],
    [1, 'subject', 9],
    [2, 'details', 1],
    [2, 'details', 1],
  ]);
  assert.equal(first.regions[0].borderSides, 4);
  assert.equal(first.regions[1].borderSides, 0);
  const spatialDetails = first.regions.filter(region => region.slot === 2);
  assert.equal(spatialDetails.length, 2, 'far-apart same-color details stay independently editable by default');
  assert.ok(spatialDetails.every(region => region.collection && region.mixedSlots === false));
  assert.deepEqual(spatialDetails.map(region => [region.minX, region.minY]), [[2, 2], [6, 6]]);
});

test('palette segmentation prefers a centered tall subject over a larger scenery patch', () => {
  const width = 20, height = 20;
  const indices = new Uint8Array(width * height).fill(255);
  for (let x = 0; x < width; x += 1) { indices[x] = 0; indices[(height - 1) * width + x] = 0; }
  for (let y = 1; y < height - 1; y += 1) { indices[y * width] = 0; indices[y * width + width - 1] = 0; }
  for (let y = 10; y <= 17; y += 1) for (let x = 10; x <= 18; x += 1) indices[y * width + x] = 1;
  for (let y = 2; y <= 15; y += 1) for (let x = 7; x <= 9; x += 1) indices[y * width + x] = 2;

  const result = segmentPaletteRegions(indices, width, height);
  const subject = result.regions.find(region => region.role === 'subject');
  assert.equal(subject?.slot, 2, 'the centered portrait-like runner becomes the primary selection');
  assert.ok(subject.coverage < result.regions.find(region => region.slot === 1).coverage, 'subject choice is not just the largest remaining color field');
});

test('palette segmentation uses 4-connected components for printable geometry', () => {
  const width = 8, height = 8;
  const indices = new Uint8Array(width * height).fill(255);
  for (let y = 1; y <= 3; y += 1) for (let x = 1; x <= 2; x += 1) indices[y * width + x] = 0;
  for (let y = 4; y <= 6; y += 1) for (let x = 3; x <= 4; x += 1) indices[y * width + x] = 0;

  const result = segmentPaletteRegions(indices, width, height);
  assert.equal(result.regions.length, 2, 'corner-touching shapes do not become one printable object');
  assert.deepEqual(result.regions.map(region => region.area), [6, 6]);
  assert.ok(result.regions.every(region => region.slot === 0 && region.mixedSlots === false));
});

test('palette segmentation covers visible pixels once and exposes an exact O(1) hit map', () => {
  const width = 8, height = 6;
  const indices = Uint8Array.from([
    255, 0, 0, 255, 1, 1, 1, 255,
    255, 0, 0, 255, 1, 2, 1, 255,
    255, 255, 255, 255, 1, 1, 1, 255,
    3, 3, 255, 2, 2, 255, 4, 4,
    3, 3, 255, 2, 2, 255, 4, 4,
    255, 255, 255, 255, 255, 255, 255, 255,
  ]);
  const result = segmentPaletteRegions(indices, width, height);
  const visits = new Uint8Array(indices.length);

  result.regions.forEach((region, regionIndex) => {
    assert.equal(region.mixedSlots, false, `part ${region.id} owns exactly one filament slot`);
    for (const pixel of region.pixels) {
      assert.ok(pixel >= 0 && pixel < indices.length, 'region pixel remains inside the source raster');
      visits[pixel] += 1;
      assert.equal(result.regionMap[pixel], regionIndex, 'hit map points back to the region that owns the pixel');
      assert.equal(indices[pixel], region.slot, 'a region never merges pixels from another palette slot');
    }
  });

  const expectedVisible = [...indices].filter(slot => slot !== 255).length;
  assert.equal(result.visiblePixels, expectedVisible);
  assert.equal(result.regions.reduce((sum, region) => sum + region.area, 0), expectedVisible);
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    if (indices[pixel] === 255) {
      assert.equal(visits[pixel], 0, 'transparent pixels never enter an editable part');
      assert.equal(result.regionMap[pixel], -1, 'transparent pixels are not hit targets');
    } else {
      assert.equal(visits[pixel], 1, 'every printable pixel belongs to exactly one editable part');
      assert.ok(result.regionMap[pixel] >= 0 && result.regionMap[pixel] < result.regions.length);
    }
  }
});

test('palette segmentation keeps spatial details separate until a cap requires same-slot merging', () => {
  const width = 21, height = 13;
  const indices = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) indices[y * width + x] = 0;
  }
  for (let y = 3; y <= 9; y += 1) for (let x = 8; x <= 12; x += 1) indices[y * width + x] = 1;
  const detailPixels = [];
  for (const y of [2, 4, 8, 10]) for (const x of [2, 4, 6, 14, 16, 18]) {
    const pixel = y * width + x;
    detailPixels.push(pixel);
    indices[pixel] = 2;
  }

  const uncapped = segmentPaletteRegions(indices, width, height);
  const uncappedDetails = uncapped.regions.filter(region => region.slot === 2);
  assert.ok(uncappedDetails.length > 1, 'far-apart details occupy separate spatial buckets by default');
  assert.ok(uncappedDetails.every(region => region.collection && region.mixedSlots === false));

  const result = segmentPaletteRegions(indices, width, height, { maxRegions: 3 });
  const slotDetails = result.regions.filter(region => region.slot === 2);
  const details = slotDetails[0];
  assert.equal(result.regions.length, 3, 'CAD object count reaches the requested bound when every slot still fits');
  assert.equal(slotDetails.length, 1, 'the cap merges distant islands only into a same-slot detail object');
  assert.ok(details, 'same-color islands remain available as an editable part');
  assert.equal(details.collection, true);
  assert.equal(details.mixedSlots, false);
  assert.equal(details.area, detailPixels.length);
  assert.deepEqual([...details.pixels].sort((a, b) => a - b), detailPixels);
  assert.equal(result.regions.find(region => region.role === 'background')?.slot, 0);
  assert.equal(result.regions.find(region => region.role === 'subject')?.slot, 1);
});

test('palette segmentation preserves visual boundaries inside one filament color', () => {
  const width = 6, height = 2;
  const indices = new Uint8Array(width * height).fill(0);
  const sourcePixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    const value = x < width / 2 ? 24 : 210;
    sourcePixels[offset] = value;
    sourcePixels[offset + 1] = value;
    sourcePixels[offset + 2] = value;
    sourcePixels[offset + 3] = 255;
  }

  assert.equal(segmentPaletteRegions(indices, width, height).regions.length, 1, 'palette-only connectivity treats the strip as one part');
  const result = segmentPaletteRegions(indices, width, height, { maxRegions: 4, sourcePixels, sourceColorTolerance: 20 });
  assert.equal(result.regions.length, 2, 'source contrast keeps visually distinct shapes separately selectable');
  assert.deepEqual(result.regions.map(region => region.area).sort((a, b) => a - b), [6, 6]);
  assert.equal(result.regions.reduce((sum, region) => sum + region.area, 0), width * height);
});

test('palette segmentation treats maxRegions as a soft cap when more filament slots are visible', () => {
  const indices = Uint8Array.from([0, 255, 1, 255, 2, 255, 3, 255, 4, 255, 5]);
  const result = segmentPaletteRegions(indices, indices.length, 1, { maxRegions: 3 });

  assert.equal(result.regions.length, 6, 'every used filament slot receives an object even above the requested cap');
  assert.deepEqual([...new Set(result.regions.map(region => region.slot))].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  assert.ok(result.regions.every(region => region.mixedSlots === false));
  for (const region of result.regions) {
    assert.ok(region.pixels.every(pixel => indices[pixel] === region.slot), `slot ${region.slot} keeps exclusive pixel ownership`);
  }
});

test('visible artwork crop trims empty borders with safe padding', () => {
  const width = 10, height = 10, data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 255; data[offset + 1] = 255; data[offset + 2] = 255; data[offset + 3] = 255;
  }
  for (let y = 3; y <= 6; y += 1) for (let x = 4; x <= 5; x += 1) {
    const offset = (y * width + x) * 4;
    data[offset] = 0; data[offset + 1] = 0; data[offset + 2] = 0;
  }
  assert.deepEqual(visibleArtworkCrop({ width, height, data }, { padding: 0 }), [.2, .1, .8, .9]);
});

test('transparent borders stay intact and printable outlines keep useful thickness', () => {
  const width = 9, height = 9, data = new Uint8ClampedArray(width * height * 4);
  const paint = (x, y, red = 40) => { const offset = (y * width + x) * 4; data[offset] = red; data[offset + 1] = red; data[offset + 2] = red; data[offset + 3] = 255; };
  paint(0, 4, 180);
  for (let y = 3; y <= 5; y += 1) for (let x = 3; x <= 5; x += 1) paint(x, y);
  const cleaned = removeConnectedBackground({ width, height, data }, { mode: 'auto' });
  assert.equal(cleaned.data[(4 * width) * 4 + 3], 255, 'mostly transparent borders are honored instead of color-keyed');
  const outlined = applyImageStyle(cleaned, { style: 'outline', threshold: 128, outlineRadius: 2 });
  let opaque = 0;
  for (let offset = 3; offset < outlined.data.length; offset += 4) if (outlined.data[offset]) opaque += 1;
  assert.ok(opaque >= 25, `expected a dilated printable outline, found ${opaque} pixels`);
  const zeroThreshold = applyImageStyle({ width: 1, height: 1, data: Uint8ClampedArray.from([12, 12, 12, 255]) }, { style: 'high-contrast', threshold: 0 });
  assert.equal(zeroThreshold.data[0], 255, 'a deliberate zero threshold is preserved');
});

test('column-field ray picking finds top, side, and underside faces without triangle scans', () => {
  const mask = Uint8Array.from([1]);
  buildColumnField(mask, 2, []);
  const sliceData = { bounds: { cols: 1, rows: 1, minX: 0, minY: 0 }, cell: 1, columns: [[{ z0: 0, z1: 2, slot: 0 }]] };
  const top = raycastColumnField(sliceData, { origin: [.5, .5, 5], direction: [0, 0, -1] }, { maxZ: 2 });
  const bottom = raycastColumnField(sliceData, { origin: [.5, .5, -2], direction: [0, 0, 1] }, { maxZ: 2 });
  const side = raycastColumnField(sliceData, { origin: [-2, .5, 1], direction: [1, 0, 0] }, { maxZ: 2 });
  const packedTop = raycastColumnField({
    bounds: sliceData.bounds,
    cell: 1,
    columnData: { offsets: Uint32Array.from([0, 1]), z0: Float32Array.from([0]), z1: Float32Array.from([2]), slots: Uint16Array.from([0]) },
  }, { origin: [.5, .5, 5], direction: [0, 0, -1] }, { maxZ: 2 });
  assert.equal(top.face, 'top'); assert.ok(Math.abs(top.point.z - 2) < .01);
  assert.equal(packedTop.face, 'top');
  assert.equal(bottom.face, 'bottom'); assert.ok(Math.abs(bottom.point.z) < .01);
  assert.equal(side.face, 'side'); assert.deepEqual(side.normal, [-1, 0, 0]);
});

test('viewer projects design points into CSS pixels for DOM manipulation gizmos', () => {
  const viewer = Object.create(MedalViewer3D.prototype);
  viewer.canvas = { width: 800, height: 600, getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 300 }) };
  viewer.bounds = { min: [-30, -30, 0], max: [30, 30, 4] };
  viewer.target = [0, 0, 1]; viewer.azimuth = -.78; viewer.elevation = .62; viewer.distance = 110; viewer.projection = 'perspective'; viewer.explode = 3;
  const center = viewer.worldToScreen(...viewer.target);
  assert.ok(Math.abs(center.x - 200) < 1e-4);
  assert.ok(Math.abs(center.y - 150) < 1e-4);
  const design = viewer.designToScreen(5, 4, 1, 0);
  const world = viewer.worldToScreen(5, -4, 1);
  assert.ok(Math.abs(design.clientX - world.clientX) < 1e-6);
  assert.ok(Math.abs(design.clientY - world.clientY) < 1e-6);
  const recovered = viewer.screenToDesignPlane(design.clientX, design.clientY, 1);
  assert.ok(Math.abs(recovered.x - 5) < 1e-3);
  assert.ok(Math.abs(recovered.y - 4) < 1e-3);
  const exploded = viewer.designToScreen(5, 4, 1, 2);
  const equivalent = viewer.worldToScreen(5, -4, 7);
  assert.ok(Math.abs(exploded.clientX - equivalent.clientX) < 1e-6);
  assert.ok(Math.abs(exploded.clientY - equivalent.clientY) < 1e-6);
});

test('replace and stack overlap semantics produce predictable top heights', () => {
  const mask = Uint8Array.from([1]);
  const replace = buildColumnField(mask, 2, [
    { kind: 'raise', amount: .4, slot: 1, indices: [0] },
    { kind: 'raise', amount: .8, slot: 0, indices: [0], combine: 'replace' },
  ]);
  const stack = buildColumnField(mask, 2, [
    { kind: 'raise', amount: .4, slot: 1, indices: [0] },
    { kind: 'raise', amount: .8, slot: 0, indices: [0], combine: 'stack' },
  ]);
  assert.equal(replace.maxHeight, 2.8);
  assert.equal(stack.maxHeight, 3.2);
});

test('unsupported material after a through-cut is reported instead of invented', () => {
  const mask = Uint8Array.from([1]);
  const field = buildColumnField(mask, 2, [{ kind: 'cut', indices: [0] }, { kind: 'raise', amount: .4, slot: 1, indices: [0] }]);
  assert.equal(field.ignoredUnsupported, 1);
  assert.deepEqual(inspectColumn(field, mask, 0), []);
});

test('manual color checks ignore unused slots and allow layer-only swaps', () => {
  const project = normalizeProject({
    profile: { nozzle: .4, layerHeight: .2, colorSystem: 'manual' },
    medal: { diameter: 60, baseThickness: 2.4, rimWidth: 0, loopStyle: 'none' },
    paletteIds: ['midnight-black', 'electric-blue'],
    elements: [{ type: 'shape', name: 'Top blue', shape: 'circle', size: 12, x: 0, y: 0, color: 1, operation: 'raise', zHeight: .4 }],
  });
  const checks = buildChecks(project, DEFAULT_INVENTORY);
  assert.equal(checks.some(check => check.title.includes('multicolor system')), false);
  assert.equal(checks.some(check => check.title.includes('Manual filament swaps')), true);
});

test('image color ownership follows sanitized printable masks rather than stale used-slot metadata', () => {
  const project = normalizeProject({
    profile: { nozzle: .4, layerHeight: .2, colorSystem: 'manual' },
    medal: { diameter: 60, baseThickness: 2.4, rimWidth: 0, loopStyle: 'none' },
    paletteIds: ['midnight-black', 'electric-blue', 'natural-white'],
    elements: [{
      id: 'raster', type: 'image', name: 'Raster', operation: 'raise', color: 2, zHeight: .4,
      x: 0, y: 0, width: 16, height: 12, pixelWidth: 32, pixelHeight: 24, minimumFeature: .9,
      dataUrl: 'data:image/png;base64,AA==', maskUrls: [null, 'data:image/png;base64,AA==', null], usedSlots: [2],
    }],
  });
  assert.deepEqual(project.elements[0].usedSlots, [1]);
  assert.deepEqual(imageUsedSlots(project.elements[0], project.paletteIds.length), [1]);
  assert.deepEqual(projectUsedSlots(project), [0, 1]);
  const checks = buildChecks(project, DEFAULT_INVENTORY);
  assert.equal(checks.some(check => check.title.includes('Manual filament swaps')), true);
  assert.equal(checks.some(check => check.title.includes('multicolor system')), false);

  const plain = normalizeProject({ ...project, elements: [{ ...project.elements[0], maskUrls: [], usedSlots: [1], color: 2 }] });
  assert.deepEqual(imageUsedSlots(plain.elements[0], plain.paletteIds.length), [2]);
  assert.deepEqual(projectUsedSlots(plain), [0, 2]);
});

test('adaptive mesh quality is materially finer than the old pixelated export', () => {
  const project = createTemplateProject('night');
  project.profile.meshQuality = 'fine';
  const fine = meshCellForProject(project);
  project.profile.meshQuality = 'ultra';
  const ultra = meshCellForProject(project);
  project.profile.meshQuality = 'draft';
  const draft = meshCellForProject(project);
  assert.ok(fine <= .12);
  assert.ok(ultra < fine);
  assert.ok(draft > fine);
});

test('adaptive cell rounding never exceeds the requested viewport budget', () => {
  const project = createTemplateProject('blank');
  project.profile.meshQuality = 'fine';
  project.profile.nozzle = .6;
  project.medal.width = 68;
  project.medal.height = 68;
  project.medal.loopStyle = 'single';
  project.medal.loopHeight = 6;
  const maxCells = 720_000;
  const cell = meshCellForProject(project, maxCells);
  const allocated = Math.ceil(project.medal.width / cell) * Math.ceil((project.medal.height + project.medal.loopHeight) / cell);
  assert.ok(allocated <= maxCells, `${allocated.toLocaleString()} allocated cells must stay within ${maxCells.toLocaleString()}`);
});

test('ribbon attachment styles normalize with legacy aliases and contextual dimensions', () => {
  const styles = ['single', 'double', 'eyelet', 'slit', 'open-slit', 'none'];
  for (const style of styles) assert.equal(normalizeProject({ medal: { loopStyle: style } }).medal.loopStyle, style);
  assert.equal(normalizeProject({ medal: { loopStyle: 'hole' } }).medal.loopStyle, 'eyelet');
  assert.equal(normalizeProject({ medal: { loopStyle: 'internalSlit' } }).medal.loopStyle, 'slit');
  assert.equal(normalizeProject({ medal: { loopStyle: 'openSlit' } }).medal.loopStyle, 'open-slit');
  const clamped = normalizeProject({ medal: { loopStyle: 'eyelet', holeDiameter: 999, slitWidth: 999, slitHeight: 0, attachmentInset: 999 } });
  assert.ok(clamped.medal.holeDiameter <= 30);
  assert.ok(clamped.medal.slitWidth <= 58);
  assert.ok(clamped.medal.slitHeight >= .4);
  assert.ok(clamped.medal.attachmentInset < 30);
});

test('internal ribbon attachments are true through-cuts and do not extend body bounds', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) };
  try {
    for (const style of ['eyelet', 'slit', 'open-slit']) {
      const project = normalizeProject({
        name: style, profile: { nozzle: .8, layerHeight: .4, meshQuality: 'draft' },
        medal: { diameter: 35, width: 35, height: 35, baseThickness: 2.4, rimWidth: 0, loopStyle: style, holeDiameter: 6, slitWidth: 18, slitHeight: 3.2, attachmentInset: 4 },
        paletteIds: ['midnight-black', 'electric-blue'], elements: [],
      });
      project.palette = DEFAULT_INVENTORY.slice(0, 2);
      const attachment = medalAttachmentGeometry(project);
      const result = await buildMeshes(project, () => {}, { validate: 'report' });
      assert.equal(maskSample(result, attachment.aperture.cx, attachment.aperture.cy), 0, `${style} aperture is air`);
      assert.equal(result.sliceData.bounds.minY, -17.5, `${style} stays inside the 35 mm body`);
      assert.equal(result.diagnostics.meshValidationFailed, false);
      if (attachment.channel) {
        const channelY = (attachment.channel.y0 + attachment.aperture.y0) / 2;
        assert.equal(maskSample(result, 0, channelY), 0, 'quick-load channel reaches the top edge');
      }
      const svg = projectToSvg(project);
      assert.match(svg, new RegExp(`data-attachment-style="${style}"`));
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('external ribbon bars still extend bounds while internal cuts reduce fallback material', async () => {
  const base = normalizeProject({ medal: { diameter: 35, width: 35, height: 35, rimWidth: 0, loopStyle: 'none' }, paletteIds: ['midnight-black', 'electric-blue'], elements: [] });
  const eyelet = normalizeProject({ ...base, medal: { ...base.medal, loopStyle: 'eyelet', holeDiameter: 7, attachmentInset: 4 } });
  const single = normalizeProject({ ...base, medal: { ...base.medal, loopStyle: 'single' } });
  const plainQuote = calculateQuote(base, DEFAULT_INVENTORY, 1);
  const eyeletQuote = calculateQuote(eyelet, DEFAULT_INVENTORY, 1);
  assert.ok(eyeletQuote.gramsPerPiece < plainQuote.gramsPerPiece);
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) };
  try {
    single.palette = DEFAULT_INVENTORY.slice(0, 2);
    const attachment = medalAttachmentGeometry(single);
    assert.equal(attachment.outer.height, single.medal.loopHeight);
    assert.equal(attachment.apertures.length, 1);
    assert.match(projectToSvg(single), new RegExp(`height="${attachment.outer.height}"`));
    const result = await buildMeshes(single, () => {}, { validate: 'report' });
    assert.ok(result.sliceData.bounds.minY < -single.medal.height / 2);
    const wide = normalizeProject({ ...base, medal: { ...base.medal, diameter: 30, width: 30, height: 30, loopStyle: 'single', loopWidth: 60, slotWidth: 27 } });
    wide.palette = DEFAULT_INVENTORY.slice(0, 2);
    const wideResult = await buildMeshes(wide, () => {}, { validate: 'report' });
    assert.equal(wideResult.sliceData.bounds.minX, -30);
    assert.equal(wideResult.sliceData.bounds.maxX, 30);
    assert.match(projectToSvg(wide), /viewBox="-30 /);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('interactive mesh preflight returns validation diagnostics in report mode', async () => {
  const project = normalizeProject({
    name: 'Report mode',
    profile: { nozzle: .8, layerHeight: .4, meshQuality: 'draft' },
    medal: { diameter: 35, width: 35, height: 35, rimWidth: 0, loopStyle: 'none', baseThickness: 2.4 },
    paletteIds: ['midnight-black', 'electric-blue'],
    elements: [],
  });
  project.palette = DEFAULT_INVENTORY.slice(0, 2);
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) };
  try {
    const result = await buildMeshes(project, () => {}, { validate: 'report' });
    assert.ok(result.diagnostics.validations.length > 0);
    assert.equal(result.diagnostics.meshValidationFailed, false);
    assert.equal(result.diagnostics.productionReady, true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('binary STL and multicolor packages have valid container headers', async () => {
  const project = {
    name: 'QA medal', version: 1,
    profile: { nozzle: .4, layerHeight: .2, meshQuality: 'fine' }, elements: [],
    palette: [
      { id: 'black', name: 'Black', brand: 'QA', material: 'PLA', effect: 'Solid', color: '#202020', density: 1.24, pricePerKg: 500, stockGrams: 1000 },
      { id: 'white', name: 'White', brand: 'QA', material: 'PLA', effect: 'Solid', color: '#fefefe', density: 1.24, pricePerKg: 500, stockGrams: 1000 },
    ],
  };
  const mask = Uint8Array.from([1]);
  const [mesh] = columnFieldToMeshes(buildColumnField(mask, 1, []), mask, { cols: 1, rows: 1, minX: 0, minY: 0 }, 1, project.palette);
  assert.equal(validateMesh(mesh).valid, true);
  const stl = new Uint8Array(await meshToBinaryStl(mesh).arrayBuffer());
  assert.equal(new DataView(stl.buffer).getUint32(80, true), mesh.triangles.length / 9);

  const secondMesh = { ...mesh, slot: 1, name: 'White shell', shell: 1, shellCount: 1 };
  const exportMeshes = [mesh, secondMesh];
  const threeMfBlob = await meshesTo3mf(project, exportMeshes);
  const threeMf = new Uint8Array(await threeMfBlob.arrayBuffer());
  assert.equal(new DataView(threeMf.buffer).getUint32(0, true), 0x04034b50);
  const entries = parseStoredZip(threeMf);
  assert.deepEqual([...entries.keys()], ['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model', 'Metadata/medalforge-manifest.json']);
  const decoder = new TextDecoder();
  const contentTypes = decoder.decode(entries.get('[Content_Types].xml'));
  const relationships = decoder.decode(entries.get('_rels/.rels'));
  const model = decoder.decode(entries.get('3D/3dmodel.model'));
  const manifest = JSON.parse(decoder.decode(entries.get('Metadata/medalforge-manifest.json')));
  assert.match(contentTypes, /3dmanufacturing-3dmodel\+xml/);
  assert.match(relationships, /Target="\/3D\/3dmodel\.model"/);
  assert.match(model, /displaycolor="#202020FF"/);
  assert.match(model, /displaycolor="#FEFEFEFF"/);
  assert.equal(manifest.project, 'QA medal');
  assert.equal(manifest.slots.length, 2);

  const bases = [...model.matchAll(/<base\b/g)].length;
  const objectIds = new Set();
  for (const objectMatch of model.matchAll(/<object\s+([^>]+)><mesh><vertices>([\s\S]*?)<\/vertices><triangles>([\s\S]*?)<\/triangles><\/mesh><\/object>/g)) {
    const attributes = objectMatch[1];
    const id = Number(attributes.match(/\bid="(\d+)"/)?.[1]);
    const pid = Number(attributes.match(/\bpid="(\d+)"/)?.[1]);
    const pindex = Number(attributes.match(/\bpindex="(\d+)"/)?.[1]);
    assert.ok(Number.isInteger(id) && id > 1);
    assert.equal(pid, 1);
    assert.ok(pindex >= 0 && pindex < bases);
    objectIds.add(id);
    const vertexCount = [...objectMatch[2].matchAll(/<vertex\b/g)].length;
    const triangles = [...objectMatch[3].matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"\/>/g)];
    assert.equal(triangles.length, mesh.triangles.length / 9);
    for (const triangle of triangles) {
      const indices = triangle.slice(1).map(Number);
      assert.equal(new Set(indices).size, 3);
      assert.ok(indices.every(index => index >= 0 && index < vertexCount));
    }
  }
  assert.equal(objectIds.size, exportMeshes.length);
  const buildReferences = [...model.matchAll(/<item\s+objectid="(\d+)"\/>/g)].map(match => Number(match[1]));
  assert.deepEqual(new Set(buildReferences), objectIds);

  const stlZip = new Uint8Array(await (await meshesToStlZip(project, exportMeshes)).arrayBuffer());
  assert.equal(new DataView(stlZip.buffer).getUint32(0, true), 0x04034b50);
  const stlEntries = parseStoredZip(stlZip);
  assert.ok(stlEntries.has('filament-map.json'));
  assert.equal(JSON.parse(decoder.decode(stlEntries.get('filament-map.json'))).slots.length, 2);
});

test('mesh validation report and export budget expose exact failures before packaging', () => {
  const invalid = { name: 'Open', slot: 0, shell: 1, volumeMm3: 0, triangles: [0,0,0, 1,0,0, 0,1,0] };
  const validations = validateGeneratedMeshes([invalid], .1);
  assert.equal(validations.length, 1);
  assert.equal(validations[0].valid, false);
  assert.ok(validations[0].unmatchedEdges > 0);
  const tooLarge = inspectExportBudget([invalid], '3mf', { maxTriangles: 1 });
  assert.equal(tooLarge.valid, true, 'one triangle fits a one-triangle limit');
  const over = inspectExportBudget([{ ...invalid, triangles: [...invalid.triangles, ...invalid.triangles] }], '3mf', { maxTriangles: 1 });
  assert.equal(over.valid, false);
  assert.match(over.errors.join(' '), /triangle export limit/);
  const nonFinite = inspectExportBudget([{ ...invalid, triangles: [0,0,0, 1,0,0, 0,Number.NaN,0] }]);
  assert.equal(nonFinite.valid, false);
  assert.match(nonFinite.errors.join(' '), /non-finite coordinate/);
});

test('streamed export budget separates final artifact size from temporary browser memory', () => {
  const triangle = [0,0,0, 1,0,0, 0,1,0];
  const triangles = Array.from({ length: 12_000 }, () => triangle).flat();
  const report = inspectExportBudget([{ name: 'Repeated detail', slot: 0, triangles }], '3mf', { maxTriangles: 20_000 });
  assert.equal(report.valid, true);
  assert.equal(report.streamed, true);
  assert.ok(report.estimatedBytes > report.estimatedWorkingBytes, 'large final XML no longer implies an equally large JS allocation');
});

test('large 3MF model entry is deflated incrementally without dropping triangles', async () => {
  const project = {
    name: 'Streaming QA', version: 1,
    profile: { nozzle: .4, layerHeight: .2, meshQuality: 'ultra' }, elements: [], medal: {},
    palette: [{ id: 'black', name: 'Black', brand: 'QA', material: 'PLA', effect: 'Solid', color: '#202020', density: 1.24, pricePerKg: 500, stockGrams: 1000 }],
  };
  const triangle = [0,0,0, 1,0,0, 0,1,0];
  const triangleCount = 10_000;
  const mesh = { name: 'Detailed shell', slot: 0, shell: 1, shellCount: 1, triangles: Array.from({ length: triangleCount }, () => triangle).flat() };
  const bytes = new Uint8Array(await (await meshesTo3mf(project, [mesh])).arrayBuffer());
  let offset = 0, model = null;
  const decoder = new TextDecoder();
  while (offset + 30 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    if (view.getUint32(0, true) !== 0x04034b50) break;
    const method = view.getUint16(8, true), crc = view.getUint32(14, true), compressedSize = view.getUint32(18, true), uncompressedSize = view.getUint32(22, true);
    const nameLength = view.getUint16(26, true), extraLength = view.getUint16(28, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    if (name === '3D/3dmodel.model') {
      assert.equal(method, 8, 'large model entry uses raw ZIP deflate');
      const inflated = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      assert.equal(inflated.length, uncompressedSize);
      assert.equal(testCrc32(inflated), crc);
      model = decoder.decode(inflated);
    }
    offset = dataStart + compressedSize;
  }
  assert.ok(model);
  assert.equal([...model.matchAll(/<triangle\b/g)].length, triangleCount);
});

test('mesh validator rejects an open triangle', () => {
  const invalid = validateMesh({ triangles: [0,0,0, 1,0,0, 0,1,0] });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.unmatchedEdges > 0);
});
