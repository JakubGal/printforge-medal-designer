import { buildColumnField, columnFieldToMeshes, meshCellForProject, validateMesh } from './geometry-engine.js';
import { enforceFlatBackArtwork, medalAttachmentGeometry, medalContainsPoint, normalizeFilament, offsetPolygon, presetMedalOutlinePoints, projectBackOffset, rimContainsPoint } from './project-model.js';
import { shapeSvgMarkup, traceShapePath } from './shape-library.js';

const encoder = new TextEncoder();
export const EXPORT_LIMITS = Object.freeze({
  cells: 1_050_000,
  meshes: 4_096,
  triangles: 4_000_000,
  threeMfEstimatedBytes: 360 * 1024 * 1024,
  stlZipEstimatedBytes: 260 * 1024 * 1024,
});

// Small and medium 3MF objects are indexed to keep slicer-side vertex counts
// compact. Very large objects are serialized as an exact triangle soup. That
// retains every production triangle while avoiding a second medal-sized vertex
// dictionary in the browser. ZIP deflate still makes the repeated XML compact.
const INDEXED_3MF_TRIANGLE_LIMIT = 250_000;
const SERIALIZE_CHUNK_CHARACTERS = 128 * 1024;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function escapeXml(value = '') { return String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char])); }

function exportPalette(project) {
  if (!Array.isArray(project?.palette) || !project.palette.length) throw new Error('No filament palette is attached to this export. Re-open the project and assign its colors first.');
  return project.palette.slice(0, 256).map((filament, index) => normalizeFilament(filament, index));
}

/** Cheap checks that run before allocating large ZIP/XML/STL payloads. */
export function inspectExportBudget(meshes, format = '3mf', overrides = {}) {
  const list = Array.isArray(meshes) ? meshes : [];
  const maxMeshes = Math.max(1, Number(overrides.maxMeshes) || EXPORT_LIMITS.meshes);
  const maxTriangles = Math.max(1, Number(overrides.maxTriangles) || EXPORT_LIMITS.triangles);
  let triangleCount = 0;
  const errors = [];
  if (!list.length) errors.push('There is no printable mesh geometry to export.');
  if (list.length > maxMeshes) errors.push(`The design contains ${list.length.toLocaleString()} mesh shells, above the ${maxMeshes.toLocaleString()}-shell export limit.`);
  for (let index = 0; index < list.length; index += 1) {
    const values = list[index]?.triangles;
    if (!values || !Number.isFinite(values.length) || values.length === 0 || values.length % 9 !== 0) {
      errors.push(`Mesh ${index + 1} does not contain complete triangles.`);
      continue;
    }
    triangleCount += values.length / 9;
    for (let coordinate = 0; coordinate < values.length; coordinate += 1) {
      if (Number.isFinite(values[coordinate])) continue;
      errors.push(`Mesh ${index + 1} contains a non-finite coordinate and cannot be serialized safely.`);
      break;
    }
  }
  if (triangleCount > maxTriangles) errors.push(`The design contains ${triangleCount.toLocaleString()} triangles, above the ${maxTriangles.toLocaleString()}-triangle export limit.`);
  const estimatedBytes = format === 'stl'
    ? list.reduce((sum, mesh) => sum + 84 + Math.floor((mesh?.triangles?.length || 0) / 9) * 50, 0) + 64_000
    : triangleCount * 210 + list.length * 1_024 + 64_000;
  const maxBytes = Math.max(1, Number(overrides.maxBytes) || (format === 'stl' ? EXPORT_LIMITS.stlZipEstimatedBytes : EXPORT_LIMITS.threeMfEstimatedBytes));
  const largestMeshTriangles = list.reduce((largest, mesh) => Math.max(largest, Math.floor((mesh?.triangles?.length || 0) / 9)), 0);
  // The archive is emitted in small chunks. Large 3MF objects deliberately do
  // not allocate an in-memory vertex map, while small indexed objects have a
  // conservative per-triangle dictionary allowance.
  const estimatedWorkingBytes = format === 'stl'
    ? 2 * 1024 * 1024
    : largestMeshTriangles <= INDEXED_3MF_TRIANGLE_LIMIT
      ? Math.max(2 * 1024 * 1024, largestMeshTriangles * 96)
      : 4 * 1024 * 1024;
  if (estimatedWorkingBytes > maxBytes) errors.push(`The ${format === 'stl' ? 'STL ZIP' : '3MF'} serializer needs about ${Math.ceil(estimatedWorkingBytes / 1024 / 1024).toLocaleString()} MB of temporary memory, above the safe ${Math.floor(maxBytes / 1024 / 1024).toLocaleString()} MB browser limit.`);
  return { valid: errors.length === 0, errors, meshCount: list.length, triangleCount, estimatedBytes, estimatedWorkingBytes, largestMeshTriangles, streamed: true, maxTriangles, maxBytes };
}

function assertExportBudget(meshes, format, overrides) {
  const report = inspectExportBudget(meshes, format, overrides);
  if (!report.valid) throw new Error(report.errors[0]);
  return report;
}

function assertMeshPaletteSlots(meshes, palette) {
  for (let index = 0; index < meshes.length; index += 1) {
    const slot = Number(meshes[index]?.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= palette.length) throw new Error(`Mesh ${index + 1} references filament slot ${String(meshes[index]?.slot)}, which is not present in the export palette.`);
  }
}

function shapePath(ctx, element) {
  traceShapePath(ctx, element.shape, element.size || 12);
}

function loadImage(source) {
  if (typeof Image === 'undefined' && typeof createImageBitmap === 'function') {
    if (String(source).startsWith('data:')) {
      const match = String(source).match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
      if (!match) return Promise.reject(new Error('An imported image data URL is invalid'));
      const mime = match[1] || 'application/octet-stream';
      const binary = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return createImageBitmap(new Blob([bytes], { type: mime }));
    }
    return fetch(source).then(response => {
      if (!response.ok) throw new Error('An imported image could not be decoded');
      return response.blob();
    }).then(blob => createImageBitmap(blob));
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('An imported image could not be decoded'));
    image.src = source;
  });
}

function medalFaceSize(project) {
  const width = Number(project.medal.width || project.medal.diameter) || 60;
  const height = Number(project.medal.height || project.medal.diameter) || width;
  return { width, height };
}

function polygonContains(x, y, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index], b = points[previous];
    if (((a[1] > y) !== (b[1] > y)) && x < (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) || Number.EPSILON) + a[0]) inside = !inside;
  }
  return inside;
}

function insideRoundedRect(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const qx = Math.abs(x) - (width / 2 - r), qy = Math.abs(y) - (height / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= r;
}

function insideMedalFace(project, x, y, inset = 0) {
  const { width, height } = medalFaceSize(project);
  const w = Math.max(.1, width - inset * 2), h = Math.max(.1, height - inset * 2);
  const shape = project.medal.shape || 'circle';
  if (shape === 'custom' && project.medal.outline?.length >= 3) {
    return medalContainsPoint(project, x, y, inset);
  }
  if (shape === 'circle' || shape === 'oval') return (x / (w / 2)) ** 2 + (y / (h / 2)) ** 2 <= 1;
  if (shape === 'rounded') return insideRoundedRect(x, y, w, h, Math.max(0, (project.medal.cornerRadius || 8) - inset));
  const preset = presetMedalOutlinePoints(shape, w, h);
  return polygonContains(x, y, preset || presetMedalOutlinePoints('shield', w, h));
}

function baseBounds(project, cell) {
  const { width, height } = medalFaceSize(project);
  const radius = Math.min(width, height) / 2;
  const attachment = medalAttachmentGeometry(project);
  const minX = Math.min(-width / 2, attachment.external ? attachment.outer.x0 : -width / 2);
  const maxX = Math.max(width / 2, attachment.external ? attachment.outer.x1 : width / 2);
  const minY = Math.min(-height / 2, attachment.external ? attachment.outer.y0 : -height / 2);
  const maxY = Math.max(height / 2, attachment.external ? attachment.outer.y1 : height / 2);
  return {
    radius, width, height, minX, maxX, minY, maxY,
    cols: Math.ceil((maxX - minX) / cell),
    rows: Math.ceil((maxY - minY) / cell),
  };
}

function makeBaseMask(project, bounds, cell) {
  const { minX, minY, cols, rows } = bounds;
  const mask = new Uint8Array(cols * rows);
  const attachment = medalAttachmentGeometry(project);
  const hasLoop = attachment.external;
  for (let row = 0; row < rows; row += 1) {
    const y = minY + (row + .5) * cell;
    for (let col = 0; col < cols; col += 1) {
      const x = minX + (col + .5) * cell;
      const face = insideMedalFace(project, x, y);
      let loop = false;
      let slot = false;
      if (hasLoop) {
        const outer = attachment.outer;
        loop = insideRoundedRect(x - outer.cx, y - outer.cy, outer.width, outer.height, outer.radius);
        slot = attachment.apertures.some(aperture => insideRoundedRect(x - (aperture.x0 + aperture.x1) / 2, y - (aperture.y0 + aperture.y1) / 2, aperture.width, aperture.height, aperture.radius));
      }
      if (!hasLoop && attachment.aperture) {
        if (attachment.aperture.kind === 'circle') {
          slot = Math.hypot(x - attachment.aperture.cx, y - attachment.aperture.cy) <= attachment.aperture.diameter / 2;
        } else {
          slot = insideRoundedRect(x - attachment.aperture.cx, y - attachment.aperture.cy, attachment.aperture.width, attachment.aperture.height, attachment.aperture.height / 2);
        }
        if (attachment.channel) slot ||= x >= attachment.channel.x0 && x <= attachment.channel.x1 && y >= attachment.channel.y0 && y <= attachment.channel.y1;
      }
      mask[row * cols + col] = (face || loop) && !slot ? 1 : 0;
    }
  }
  return mask;
}

async function renderOperations(project, bounds, cell, baseMask) {
  const slotCount = project.palette.length;
  const canvas = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(bounds.cols, bounds.rows)
    : document.createElement('canvas');
  canvas.width = bounds.cols; canvas.height = bounds.rows;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageCache = new Map();
  const scale = 1 / cell;
  const eligible = new Uint8Array(baseMask.length);
  const safeInset = Math.max(project.medal.edgeInset + Math.max(0, project.medal.rimWidth || 0), cell / 2);
  for (let i = 0; i < eligible.length; i += 1) {
    const row = Math.floor(i / bounds.cols), col = i % bounds.cols;
    const x = bounds.minX + (col + .5) * cell, y = bounds.minY + (row + .5) * cell;
    eligible[i] = baseMask[i] && insideMedalFace(project, x, y, safeInset) ? 1 : 0;
  }

  const rasterize = async element => {
    const owner = new Int16Array(baseMask.length); owner.fill(-1);
    const paintLayer = (slot, draw, options = {}) => {
      slot = clamp(Math.floor(Number(slot) || 0), 0, slotCount - 1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, bounds.cols, bounds.rows);
      ctx.setTransform(scale, 0, 0, scale, -bounds.minX * scale, -bounds.minY * scale);
      ctx.imageSmoothingEnabled = options.smoothing !== false;
      ctx.imageSmoothingQuality = options.smoothing === false ? 'low' : 'high';
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
      draw(ctx);
      const alpha = ctx.getImageData(0, 0, bounds.cols, bounds.rows).data;
      for (let index = 0; index < owner.length; index += 1) {
        if (eligible[index] && alpha[index * 4 + 3] >= (options.threshold || 128)) owner[index] = slot;
      }
    };

    const applyTransform = context => {
      context.translate(element.x, element.y);
      if (element.face === 'back') context.scale(1, -1);
      context.rotate((element.rotation || 0) * Math.PI / 180);
      context.scale(Number(element.scaleX) || 1, Number(element.scaleY) || 1);
    };

    if (element.type === 'image') {
      let painted = false;
      for (let slot = 0; slot < slotCount; slot += 1) {
        const source = element.maskUrls?.[slot] || (!element.maskUrls?.length && element.color === slot ? element.dataUrl : null);
        if (!source) continue;
        if (!imageCache.has(source)) imageCache.set(source, await loadImage(source));
        const image = imageCache.get(source);
        paintLayer(slot, context => {
          context.save();
          applyTransform(context);
          // Opacity is an editor preview setting, never a manufacturing mask.
          context.globalAlpha = 1;
          context.drawImage(image, -element.width / 2, -element.height / 2, element.width, element.height);
          context.restore();
        }, { smoothing: !element.maskUrls?.[slot], threshold: 128 });
        painted = true;
      }
      if (!painted && element.dataUrl) {
        if (!imageCache.has(element.dataUrl)) imageCache.set(element.dataUrl, await loadImage(element.dataUrl));
        const image = imageCache.get(element.dataUrl);
        paintLayer(element.color, context => {
          context.save(); applyTransform(context);
          context.globalAlpha = 1;
          context.drawImage(image, -element.width / 2, -element.height / 2, element.width, element.height); context.restore();
        }, { smoothing: true, threshold: 128 });
      }
    } else if (element.type === 'text') {
      paintLayer(element.color, context => {
        context.save(); applyTransform(context);
        context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = `${element.weight || 800} ${element.fontSize}px ${element.fontFamily || 'Arial'}`;
        context.fillText(element.text || '', 0, 0); context.restore();
      });
    } else if (element.type === 'shape') {
      paintLayer(element.color, context => {
        context.save(); applyTransform(context); shapePath(context, element); context.fill(); context.restore();
      });
    } else if (element.type === 'path') {
      paintLayer(element.color, context => {
        context.save(); applyTransform(context); context.beginPath();
        element.points.forEach((point, index) => index ? context.lineTo(point[0] * element.scale, point[1] * element.scale) : context.moveTo(point[0] * element.scale, point[1] * element.scale));
        if (element.closed) { context.closePath(); context.fill(); }
        else { context.lineWidth = element.strokeWidth; context.lineCap = 'round'; context.lineJoin = 'round'; context.stroke(); }
        context.restore();
      });
    }

    const indices = [], owners = [];
    for (let index = 0; index < owner.length; index += 1) {
      if (owner[index] < 0) continue;
      indices.push(index); owners.push(owner[index]);
    }
    return { indices, owners: Uint8Array.from(owners) };
  };

  const operations = [];
  if (project.medal.rimWidth > 0 && project.medal.rimHeight > 0) {
    const indices = [], owners = [];
    for (let index = 0; index < baseMask.length; index += 1) {
      const row = Math.floor(index / bounds.cols), col = index % bounds.cols;
      const x = bounds.minX + (col + .5) * cell, y = bounds.minY + (row + .5) * cell;
      if (baseMask[index] && rimContainsPoint(project, x, y)) {
        indices.push(index); owners.push(project.medal.rimColor);
      }
    }
    operations.push({ elementId: 'medal-rim', kind: 'raise', amount: project.medal.rimHeight, combine: 'replace', indices, owners: Uint8Array.from(owners) });
  }

  // Some production medals print the ribbon bar in the same face color as
  // the perimeter while keeping the reverse and the load-bearing core in the
  // base material. Model that as a real front-face material body instead of a
  // viewer-only tint so 3MF, weight, price, layer preview, and PDF all agree.
  const attachment = medalAttachmentGeometry(project);
  const attachmentHeight = Math.max(0, Number(project.medal.attachmentHeight) || 0);
  const attachmentColor = Number(project.medal.attachmentColor);
  if (attachment.external && attachmentHeight > 0 && Number.isInteger(attachmentColor)) {
    const indices = [], owners = [];
    const outer = attachment.outer;
    for (let index = 0; index < baseMask.length; index += 1) {
      if (!baseMask[index]) continue;
      const row = Math.floor(index / bounds.cols), col = index % bounds.cols;
      const x = bounds.minX + (col + .5) * cell, y = bounds.minY + (row + .5) * cell;
      if (!insideRoundedRect(x - outer.cx, y - outer.cy, outer.width, outer.height, outer.radius)) continue;
      indices.push(index); owners.push(clamp(attachmentColor, 0, slotCount - 1));
    }
    operations.push({ elementId: 'medal-attachment-face', kind: 'raise', amount: attachmentHeight, combine: 'replace', indices, owners: Uint8Array.from(owners) });
  }

  for (const element of project.elements) {
    if (element.hidden) continue;
    const raster = await rasterize(element);
    if (!raster.indices.length) continue;
    operations.push({
      elementId: element.id,
      kind: element.operation || 'raise',
      face: element.face === 'back' ? 'back' : 'front',
      amount: element.operation === 'raise' ? element.zHeight : element.zDepth,
      height: element.inlayHeight || 0,
      combine: element.combine || 'replace',
      indices: raster.indices,
      owners: raster.owners,
    });
  }
  return operations;
}

function measuredMeshBounds(meshes, fallback) {
  const measured = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (const mesh of meshes) {
    for (let offset = 0; offset < mesh.triangles.length; offset += 3) {
      const x = mesh.triangles[offset], y = mesh.triangles[offset + 1], z = mesh.triangles[offset + 2];
      measured.minX = Math.min(measured.minX, x); measured.maxX = Math.max(measured.maxX, x);
      measured.minY = Math.min(measured.minY, y); measured.maxY = Math.max(measured.maxY, y);
      measured.minZ = Math.min(measured.minZ, z); measured.maxZ = Math.max(measured.maxZ, z);
    }
  }
  return Number.isFinite(measured.minX) ? measured : { ...fallback, minZ: 0, maxZ: 0 };
}

function countFaceConnectedCells(mask, cols, rows) {
  const visited = new Uint8Array(mask.length);
  let components = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    components += 1;
    const queue = [start]; visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor], row = Math.floor(index / cols), col = index % cols;
      for (const neighbor of [col > 0 ? index - 1 : -1, col + 1 < cols ? index + 1 : -1, row > 0 ? index - cols : -1, row + 1 < rows ? index + cols : -1]) {
        if (neighbor >= 0 && mask[neighbor] && !visited[neighbor]) { visited[neighbor] = 1; queue.push(neighbor); }
      }
    }
  }
  return components;
}

export function validateGeneratedMeshes(meshes, cell = .1) {
  const validations = [];
  for (const mesh of meshes || []) {
    const validation = validateMesh(mesh);
    const volumeTolerance = Math.max(Number(cell) ** 3 * 2, Math.abs(Number(mesh.volumeMm3) || 0) * .002);
    validation.volumeMatches = Number.isFinite(validation.signedVolumeMm3) && Math.abs(validation.signedVolumeMm3 - mesh.volumeMm3) <= volumeTolerance;
    validation.valid = validation.valid && validation.volumeMatches;
    validations.push({ slot: mesh.slot, shell: mesh.shell, name: mesh.name, ...validation });
  }
  return validations;
}

function meshValidationError(validation) {
  return `Mesh validation failed for slot ${Number(validation.slot) + 1}, shell ${validation.shell || 1}: ${validation.unmatchedEdges} open edges, ${validation.misorientedEdges} winding errors, ${validation.degenerateTriangles} zero-area triangles${validation.volumeMatches ? '' : ', and a volume mismatch'}.`;
}

export async function buildMeshes(project, onProgress = () => {}, options = {}) {
  project = { ...project, elements: (project?.elements || []).map(element => enforceFlatBackArtwork({ ...element }, project)) };
  const cell = meshCellForProject(project, options.maxCells);
  const bounds = baseBounds(project, cell);
  const estimatedCellCount = bounds.cols * bounds.rows;
  const cellLimit = Math.max(100_000, Number(options.maxCells) || EXPORT_LIMITS.cells);
  if (estimatedCellCount > cellLimit) throw new Error(`This profile needs ${estimatedCellCount.toLocaleString()} sampled cells, above the ${cellLimit.toLocaleString()}-cell browser limit. Choose a lower mesh detail or reduce the medal size.`);
  if (options.production && project.paletteMissingIds?.length) throw new Error(`The filament catalog is missing ${project.paletteMissingIds.join(', ')}. Restore the project inventory snapshot or remap those palette slots before export.`);
  onProgress('Preparing the medal body…');
  const baseMask = makeBaseMask(project, bounds, cell);
  onProgress('Converting every object into a Z operation…');
  const operations = await renderOperations(project, bounds, cell, baseMask);
  onProgress('Resolving raises, engravings, inlays, and cuts…');
  const backOffset = projectBackOffset(project);
  const field = buildColumnField(baseMask, project.medal.baseThickness, operations, { minimumFloor: project.medal.minimumFloor, baseOffset: backOffset, baseSlot: project.medal.baseColor });
  const authoredBase = Uint8Array.from(baseMask, (value, index) => {
    if (!value) return 0;
    const segments = field.columns[index] === undefined ? field.baseSegment : field.columns[index];
    return segments.length ? 1 : 0;
  });
  const authoredBaseShellCount = countFaceConnectedCells(authoredBase, bounds.cols, bounds.rows);
  if (options.production && field.ignoredUnsupported > 0) {
    throw new Error(`${field.ignoredUnsupported.toLocaleString()} cells have artwork placed over an earlier through-cut. Reorder those objects or remove the unsupported overlap.`);
  }
  onProgress('Building watertight material parts…');
  const meshes = columnFieldToMeshes(field, baseMask, bounds, cell, project.palette);
  if (options.production && field.topologyCleanup?.capped) throw new Error(`Topology cleanup reached its ${field.topologyCleanup.mutationLimit.toLocaleString()}-sample safety cap. Lower mesh detail or simplify tiny diagonal contacts before production export.`);
  const triangleCount = meshes.reduce((sum, mesh) => sum + mesh.triangles.length / 9, 0);
  const triangleLimit = Math.max(100_000, Number(options.maxTriangles) || EXPORT_LIMITS.triangles);
  if (triangleCount > triangleLimit) throw new Error(`This mesh needs ${triangleCount.toLocaleString()} triangles, above the safe browser limit. Choose Fine or Balanced mesh detail, or simplify the artwork.`);
  const baseShellCount = meshes.filter(mesh => mesh.slot === project.medal.baseColor).length;
  if (options.production && authoredBaseShellCount > 1) {
    throw new Error(`A through-cut separates the medal body into ${authoredBaseShellCount} loose pieces. Move or reshape the cut until the base stays connected.`);
  }
  const shouldValidate = Boolean(options.production || options.validate);
  const validations = [];
  if (shouldValidate) {
    onProgress('Validating manifold edges, triangle winding, and volume…');
    validations.push(...validateGeneratedMeshes(meshes, cell));
    const failed = validations.filter(validation => !validation.valid);
    // Report mode powers interactive preflight. A production build is always strict.
    if (failed.length && (options.production || options.validate !== 'report')) throw new Error(meshValidationError(failed[0]));
  }
  const failedValidations = validations.filter(validation => !validation.valid);
  const productionBlockers = [];
  if (field.ignoredUnsupported > 0) productionBlockers.push({ code: 'unsupported-over-cut', message: `${field.ignoredUnsupported.toLocaleString()} cells have artwork over an earlier through-cut.` });
  if (authoredBaseShellCount > 1) productionBlockers.push({ code: 'detached-base', message: `The authored base is split into ${authoredBaseShellCount} disconnected pieces.` });
  if (field.topologyCleanup?.capped) productionBlockers.push({ code: 'topology-cap', message: `Topology cleanup reached its ${field.topologyCleanup.mutationLimit.toLocaleString()}-sample safety cap.` });
  if (project.paletteMissingIds?.length) productionBlockers.push({ code: 'missing-filament', message: `Missing filament records: ${project.paletteMissingIds.join(', ')}.` });
  if (failedValidations.length) productionBlockers.push({ code: 'mesh-validation', message: meshValidationError(failedValidations[0]) });
  const resolvedColumns = field.resolvedColumns || Array.from({ length: baseMask.length }, (_, index) => field.columns[index] ?? (baseMask[index] ? field.baseSegment : []));
  const levels = new Set([0, field.baseOffset, field.baseTop, field.maxHeight]);
  for (const column of resolvedColumns) for (const segment of column || []) { levels.add(segment.z0); levels.add(segment.z1); }
  const measuredBounds = measuredMeshBounds(meshes, bounds);
  onProgress('Production geometry is ready.');
  return {
    meshes,
    bounds: measuredBounds,
    cell,
    maxHeight: field.maxHeight,
    zLevels: [...levels].sort((a, b) => a - b),
    sliceData: { bounds, cell, baseMask, columns: resolvedColumns },
    // Interactive callers can retain the already-rasterized object footprints.
    // These masks let the viewport animate move/push-pull changes without
    // rebuilding the production mesh on every pointer event.
    previewMasks: options.previewMasks
      ? operations.filter(operation => operation.elementId !== 'medal-rim').map(operation => ({
          elementId: operation.elementId,
          indices: operation.indices,
          owners: operation.owners,
          x: Number(project.elements.find(element => element.id === operation.elementId)?.x) || 0,
          y: Number(project.elements.find(element => element.id === operation.elementId)?.y) || 0,
          rotation: Number(project.elements.find(element => element.id === operation.elementId)?.rotation) || 0,
          scaleX: Number(project.elements.find(element => element.id === operation.elementId)?.scaleX) || 1,
          scaleY: Number(project.elements.find(element => element.id === operation.elementId)?.scaleY) || 1,
          face: project.elements.find(element => element.id === operation.elementId)?.face === 'back' ? 'back' : 'front',
        }))
      : undefined,
    diagnostics: {
      operationCount: operations.length,
      backOffset: field.baseOffset,
      baseTop: field.baseTop,
      cutCells: field.cutCells,
      appliedCells: field.appliedCells,
      ignoredUnsupported: field.ignoredUnsupported,
      detachedBaseShells: Math.max(0, authoredBaseShellCount - 1),
      resolvedBaseShells: baseShellCount,
      regularizedBands: field.regularizedBands || 0,
      topologyCleanup: field.topologyCleanup || null,
      regularizedVolumeMm3: field.topologyCleanup?.estimatedAlteredVolumeMm3 || 0,
      regularizationBlocked: Boolean(field.topologyCleanup?.capped),
      estimatedCellCount,
      cellLimit,
      triangleCount,
      validations,
      meshValidationPerformed: shouldValidate,
      meshValidationFailed: failedValidations.length > 0,
      meshValidationFailureCount: failedValidations.length,
      meshValidationMessage: failedValidations.length ? meshValidationError(failedValidations[0]) : '',
      productionBlockers,
      productionReady: shouldValidate && productionBlockers.length === 0,
    },
  };
}

function triangleNormal(values, offset) {
  const ax = values[offset], ay = values[offset + 1], az = values[offset + 2];
  const ux = values[offset + 3] - ax, uy = values[offset + 4] - ay, uz = values[offset + 5] - az;
  const vx = values[offset + 6] - ax, vy = values[offset + 7] - ay, vz = values[offset + 8] - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

export function meshToBinaryStl(mesh) {
  assertExportBudget([mesh], 'stl');
  const count = mesh.triangles.length / 9;
  const buffer = new ArrayBuffer(84 + count * 50);
  const bytes = new Uint8Array(buffer);
  const header = encoder.encode(`MedalForge | ${mesh.name}`.slice(0, 80));
  bytes.set(header, 0);
  const view = new DataView(buffer);
  view.setUint32(80, count, true);
  let cursor = 84;
  for (let i = 0; i < mesh.triangles.length; i += 9) {
    const normal = triangleNormal(mesh.triangles, i);
    for (const value of normal) { view.setFloat32(cursor, value, true); cursor += 4; }
    for (let j = 0; j < 9; j += 1) { view.setFloat32(cursor, mesh.triangles[i + j], true); cursor += 4; }
    view.setUint16(cursor, 0, true); cursor += 2;
  }
  return new Blob([buffer], { type: 'model/stl' });
}

async function* binaryStlChunks(mesh) {
  const count = mesh.triangles.length / 9;
  const header = new Uint8Array(84);
  header.set(encoder.encode(`MedalForge | ${mesh.name}`.slice(0, 80)), 0);
  new DataView(header.buffer).setUint32(80, count, true);
  yield header;
  const trianglesPerChunk = 4_096;
  for (let first = 0; first < count; first += trianglesPerChunk) {
    const chunkCount = Math.min(trianglesPerChunk, count - first);
    const bytes = new Uint8Array(chunkCount * 50);
    const view = new DataView(bytes.buffer);
    let cursor = 0;
    for (let triangle = 0; triangle < chunkCount; triangle += 1) {
      const sourceOffset = (first + triangle) * 9;
      const normal = triangleNormal(mesh.triangles, sourceOffset);
      for (const value of normal) { view.setFloat32(cursor, value, true); cursor += 4; }
      for (let coordinate = 0; coordinate < 9; coordinate += 1) { view.setFloat32(cursor, mesh.triangles[sourceOffset + coordinate], true); cursor += 4; }
      view.setUint16(cursor, 0, true); cursor += 2;
    }
    yield bytes;
  }
}

export async function meshesToStlZip(project, meshes) {
  assertExportBudget(meshes, 'stl');
  const palette = exportPalette(project);
  assertMeshPaletteSlots(meshes, palette);
  const files = [];
  for (const mesh of meshes) {
    const shellSuffix = mesh.shellCount > 1 ? `-shell-${mesh.shell}` : '';
    files.push({
      name: `${String(mesh.slot + 1).padStart(2, '0')}-${safeFilename(palette[mesh.slot]?.name || mesh.name)}${shellSuffix}.stl`,
      data: () => binaryStlChunks(mesh),
      compress: mesh.triangles.length / 9 >= 2_000,
    });
  }
  files.push({
    name: 'filament-map.json',
    data: JSON.stringify({
      project: project.name,
      note: 'Import every STL together in the same coordinate frame, then assign every shell to its matching filament slot.',
      slots: meshes.map(mesh => { const filament = palette[mesh.slot]; const shellSuffix = mesh.shellCount > 1 ? `-shell-${mesh.shell}` : ''; return { slot: mesh.slot + 1, shell: mesh.shell || 1, file: `${String(mesh.slot + 1).padStart(2, '0')}-${safeFilename(filament.name)}${shellSuffix}.stl`, name: filament.name, material: filament.material, effect: filament.effect, color: filament.color }; }),
    }, null, 2),
  });
  files.push({
    name: 'README.txt',
    data: `MedalForge aligned multipart STL export\n\n1. Import every STL in this ZIP at once.\n2. Keep the original coordinates; do not auto-arrange parts separately.\n3. When your slicer asks, load the files as one multipart object.\n4. Assign each shell to the filament slot listed in filament-map.json.\n5. Inspect every layer before printing.\n`,
  });
  return buildZipBlob(files, 'application/zip');
}

function format3mfNumber(value) {
  if (!Number.isFinite(value)) throw new Error('A mesh contains a non-finite coordinate and cannot be packaged as 3MF.');
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let j = 0; j < 8; j += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
}
const CRC_TABLE = crcTable();
function updateCrc32(crc, bytes) {
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc;
}

async function* sourceChunks(source) {
  const value = typeof source === 'function' ? source() : source;
  if (value && typeof value[Symbol.asyncIterator] === 'function') {
    for await (const chunk of value) yield typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    return;
  }
  if (value && typeof value[Symbol.iterator] === 'function' && typeof value !== 'string' && !(value instanceof Uint8Array)) {
    for (const chunk of value) yield typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    return;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    const reader = value.stream().getReader();
    try {
      while (true) { const { value: chunk, done } = await reader.read(); if (done) break; yield chunk; }
    } finally { reader.releaseLock(); }
    return;
  }
  if (typeof value === 'string') yield encoder.encode(value);
  else if (value instanceof Uint8Array) yield value;
  else if (value instanceof ArrayBuffer) yield new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) yield new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else throw new TypeError('ZIP entry data must be text, binary data, a Blob, or a chunk iterator.');
}

async function prepareZipEntry(file) {
  let crc = 0xffffffff, uncompressedSize = 0;
  const canDeflate = Boolean(file.compress && typeof CompressionStream === 'function' && typeof ReadableStream === 'function');
  let compressor = null;
  if (canDeflate) {
    try { compressor = new CompressionStream('deflate-raw'); }
    catch { compressor = null; }
  }
  if (compressor) {
    const iterator = sourceChunks(file.data)[Symbol.asyncIterator]();
    const stream = new ReadableStream({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) { controller.close(); return; }
        crc = updateCrc32(crc, value);
        uncompressedSize += value.byteLength;
        controller.enqueue(value);
      },
      async cancel() { await iterator.return?.(); },
    });
    const data = await new Response(stream.pipeThrough(compressor)).blob();
    return { ...file, method: 8, crc: (crc ^ 0xffffffff) >>> 0, uncompressedSize, compressedSize: data.size, data };
  }
  const parts = [];
  for await (const chunk of sourceChunks(file.data)) {
    crc = updateCrc32(crc, chunk);
    uncompressedSize += chunk.byteLength;
    parts.push(chunk);
  }
  const data = new Blob(parts);
  return { ...file, method: 0, crc: (crc ^ 0xffffffff) >>> 0, uncompressedSize, compressedSize: data.size, data };
}

async function buildZipBlob(files, mimeType) {
  if (files.length > 65_535) throw new Error('This archive contains too many entries for a browser ZIP.');
  const prepared = [];
  for (const file of files) prepared.push(await prepareZipEntry(file));
  const locals = [], centrals = [];
  let offset = 0;
  const date = ((2026 - 1980) << 9) | (8 << 5) | 26;
  const time = (12 << 11);
  for (const file of prepared) {
    if (file.compressedSize > 0xffffffff || file.uncompressedSize > 0xffffffff) throw new Error(`${file.name} exceeds the 4 GB ZIP entry limit.`);
    const name = encoder.encode(file.name);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, file.method, true);
    lv.setUint16(10, time, true); lv.setUint16(12, date, true); lv.setUint32(14, file.crc, true); lv.setUint32(18, file.compressedSize, true); lv.setUint32(22, file.uncompressedSize, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true); local.set(name, 30);
    locals.push(local, file.data);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true); cv.setUint16(10, file.method, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, file.crc, true); cv.setUint32(20, file.compressedSize, true); cv.setUint32(24, file.uncompressedSize, true); cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true); central.set(name, 46);
    centrals.push(central);
    offset += local.length + file.compressedSize;
    if (offset > 0xffffffff) throw new Error('The completed archive exceeds the 4 GB browser ZIP limit.');
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
  return new Blob([...locals, ...centrals, end], { type: mimeType });
}

async function* model3mfChunks(project, meshes, palette, locale = 'en-US') {
  const materialXml = palette.map(filament => `<base name="${escapeXml(`${filament.name} (${filament.material})`)}" displaycolor="#${filament.color.replace('#','').toUpperCase()}FF"/>`).join('');
  yield `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="${escapeXml(locale)}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${escapeXml(project.name)}</metadata><metadata name="Designer">MedalForge</metadata><metadata name="Description">Multicolor printable medal; assign each named object to its matching filament slot.</metadata><resources><basematerials id="1">${materialXml}</basematerials>`;
  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    const mesh = meshes[meshIndex], objectId = meshIndex + 2;
    const triangleCount = mesh.triangles.length / 9;
    const indexed = triangleCount <= INDEXED_3MF_TRIANGLE_LIMIT;
    yield `<object id="${objectId}" name="${escapeXml(mesh.name)}" type="model" pid="1" pindex="${mesh.slot}"><mesh><vertices>`;
    if (indexed) {
      const vertexMap = new Map();
      let vertexCount = 0, chunk = '';
      for (let offset = 0; offset < mesh.triangles.length; offset += 3) {
        const fx = format3mfNumber(mesh.triangles[offset]), fy = format3mfNumber(mesh.triangles[offset + 1]), fz = format3mfNumber(mesh.triangles[offset + 2]);
        const key = `${fx},${fy},${fz}`;
        if (vertexMap.has(key)) continue;
        vertexMap.set(key, vertexCount++);
        chunk += `<vertex x="${fx}" y="${fy}" z="${fz}"/>`;
        if (chunk.length >= SERIALIZE_CHUNK_CHARACTERS) { yield chunk; chunk = ''; }
      }
      if (chunk) yield chunk;
      yield '</vertices><triangles>';
      chunk = '';
      for (let offset = 0; offset < mesh.triangles.length; offset += 9) {
        const indices = [];
        for (let point = 0; point < 3; point += 1) {
          const coordinate = offset + point * 3;
          const key = `${format3mfNumber(mesh.triangles[coordinate])},${format3mfNumber(mesh.triangles[coordinate + 1])},${format3mfNumber(mesh.triangles[coordinate + 2])}`;
          indices.push(vertexMap.get(key));
        }
        chunk += `<triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}"/>`;
        if (chunk.length >= SERIALIZE_CHUNK_CHARACTERS) { yield chunk; chunk = ''; }
      }
      if (chunk) yield chunk;
    } else {
      let chunk = '';
      for (let offset = 0; offset < mesh.triangles.length; offset += 3) {
        chunk += `<vertex x="${format3mfNumber(mesh.triangles[offset])}" y="${format3mfNumber(mesh.triangles[offset + 1])}" z="${format3mfNumber(mesh.triangles[offset + 2])}"/>`;
        if (chunk.length >= SERIALIZE_CHUNK_CHARACTERS) { yield chunk; chunk = ''; }
      }
      if (chunk) yield chunk;
      yield '</vertices><triangles>';
      chunk = '';
      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        const vertex = triangle * 3;
        chunk += `<triangle v1="${vertex}" v2="${vertex + 1}" v3="${vertex + 2}"/>`;
        if (chunk.length >= SERIALIZE_CHUNK_CHARACTERS) { yield chunk; chunk = ''; }
      }
      if (chunk) yield chunk;
    }
    yield '</triangles></mesh></object>';
  }
  yield `</resources><build>${meshes.map((_, index) => `<item objectid="${index + 2}"/>`).join('')}</build></model>`;
}

export async function meshesTo3mf(project, meshes, options = {}) {
  assertExportBudget(meshes, '3mf');
  const palette = exportPalette(project);
  assertMeshPaletteSlots(meshes, palette);
  const medal = project.medal || {};
  const locale = /^[a-z]{2}(?:-[A-Z]{2})?$/u.test(String(options.locale || '')) ? String(options.locale) : 'en-US';
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="json" ContentType="application/json"/></Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  const manifest = JSON.stringify({
    app: 'MedalForge', version: project.version, project: project.name,
    nozzleMm: project.profile.nozzle, layerHeightMm: project.profile.layerHeight,
    meshQuality: project.profile.meshQuality || 'fine',
    attachment: {
      style: medal.loopStyle || 'none',
      loopWidthMm: medal.loopWidth, loopHeightMm: medal.loopHeight,
      slotWidthMm: medal.slotWidth, slotHeightMm: medal.slotHeight,
      holeDiameterMm: medal.holeDiameter, slitWidthMm: medal.slitWidth,
      slitHeightMm: medal.slitHeight, insetMm: medal.attachmentInset,
    },
    operations: project.elements?.map(element => ({ id: element.id, name: element.name, face: element.face === 'back' ? 'back' : 'front', operation: element.operation || 'raise', heightMm: element.zHeight, depthMm: element.zDepth, inlayHeightMm: element.inlayHeight || 0, scaleX: element.scaleX || 1, scaleY: element.scaleY || 1 })) || [],
    slots: palette.map((filament, index) => ({ slot: index + 1, id: filament.id, name: filament.name, material: filament.material, effect: filament.effect, color: filament.color })),
  }, null, 2);
  const triangleCount = meshes.reduce((total, mesh) => total + mesh.triangles.length / 9, 0);
  return buildZipBlob([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: relationships },
    { name: '3D/3dmodel.model', data: () => model3mfChunks(project, meshes, palette, locale), compress: triangleCount >= 10_000 },
    { name: 'Metadata/medalforge-manifest.json', data: manifest },
  ], 'model/3mf');
}

function svgShape(element) {
  return shapeSvgMarkup(element.shape, element.size || 12);
}

function svgMedalOutline(project, inset = 0, attributes = '') {
  const { width: rawWidth, height: rawHeight } = medalFaceSize(project);
  const width = Math.max(.1, rawWidth - inset * 2), height = Math.max(.1, rawHeight - inset * 2);
  const shape = project.medal.shape || 'circle';
  if (shape === 'custom' && project.medal.outline?.length >= 3) {
    const points = (inset > 0 ? offsetPolygon(project.medal.outline, inset) : project.medal.outline).map(([x,y]) => `${x},${y}`).join(' ');
    return `<polygon points="${points}" ${attributes}/>`;
  }
  if (shape === 'circle' || shape === 'oval') return `<ellipse cx="0" cy="0" rx="${width/2}" ry="${height/2}" ${attributes}/>`;
  if (shape === 'rounded') return `<rect x="${-width/2}" y="${-height/2}" width="${width}" height="${height}" rx="${Math.max(0, (project.medal.cornerRadius || 8) - inset)}" ${attributes}/>`;
  const points = (presetMedalOutlinePoints(shape, width, height) || presetMedalOutlinePoints('shield', width, height))
    .map(([x,y]) => `${x},${y}`).join(' ');
  return `<polygon points="${points}" ${attributes}/>`;
}

function svgRimMarkup(project, color) {
  const medal = project.medal;
  const width = Math.max(0, Number(medal.rimWidth) || 0);
  if (!width) return '';
  const baseAttributes = `fill="none" stroke="${color}" data-rim-style="${escapeXml(medal.rimStyle || 'classic')}" data-height-mm="${medal.rimHeight}"`;
  if (medal.rimStyle === 'double') {
    return svgMedalOutline(project, medal.edgeInset + width * .17, `${baseAttributes} stroke-width="${width * .34}"`)
      + svgMedalOutline(project, medal.edgeInset + width * .835, `${baseAttributes} stroke-width="${width * .33}"`);
  }
  const perimeter = Math.PI * ((Number(medal.width) || 60) + (Number(medal.height) || 60)) / 2;
  if (medal.rimStyle === 'faceted') {
    const step = perimeter / 18;
    return svgMedalOutline(project, medal.edgeInset + width / 2, `${baseAttributes} stroke-width="${width}" stroke-linecap="butt" stroke-dasharray="${step * .89} ${step * .11}"`);
  }
  if (medal.rimStyle === 'scalloped') {
    const step = perimeter / 18;
    return svgMedalOutline(project, medal.edgeInset + width * .41, `${baseAttributes} stroke-width="${width * .82}" stroke-linecap="round" stroke-dasharray="${Math.max(.1, width * .42)} ${Math.max(.1, step - width * .42)}"`);
  }
  if (medal.rimStyle === 'laurel' || medal.rimStyle === 'wings') {
    const rx = Math.max(.1, ((Number(medal.width) || 60) - (medal.edgeInset + width * .44) * 2) / 2);
    const ry = Math.max(.1, ((Number(medal.height) || 60) - (medal.edgeInset + width * .44) * 2) / 2);
    const count = medal.rimStyle === 'wings' ? 7 : 10;
    const start = medal.rimStyle === 'wings' ? -1.02 : -.98;
    const end = medal.rimStyle === 'wings' ? 1.02 : .98;
    const leaves = [];
    for (const side of [-1, 1]) for (let index = 0; index < count; index += 1) {
      const t = index / Math.max(1, count - 1);
      const angle = side > 0 ? start + (end - start) * t : Math.PI - start - (end - start) * t;
      const x = Math.cos(angle) * rx, y = Math.sin(angle) * ry;
      const leafWidth = width * (medal.rimStyle === 'wings' ? .84 + .36 * Math.sin(t * Math.PI) : .68);
      const leafLength = width * (medal.rimStyle === 'wings' ? 2.1 : 1.44);
      leaves.push(`<ellipse cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" rx="${(leafWidth / 2).toFixed(3)}" ry="${(leafLength / 2).toFixed(3)}" transform="rotate(${(angle * 180 / Math.PI + 90).toFixed(2)} ${x.toFixed(3)} ${y.toFixed(3)})"/>`);
    }
    const rail = svgMedalOutline(project, medal.edgeInset + width * .935, `${baseAttributes} stroke-width="${width * .13}"`);
    return `${rail}<g fill="${color}" data-rim-ornament="${escapeXml(medal.rimStyle)}">${leaves.join('')}</g>`;
  }
  return svgMedalOutline(project, medal.edgeInset + width / 2, `${baseAttributes} stroke-width="${width}"`);
}

export function projectToSvg(project) {
  const { width, height: faceHeight } = medalFaceSize(project);
  const attachment = medalAttachmentGeometry(project);
  const artboardWidth = Math.max(width, attachment.external ? attachment.outer.width : width);
  const frontMinY = Math.min(-faceHeight / 2, attachment.external ? attachment.outer.y0 : -faceHeight / 2);
  const frontMaxY = Math.max(faceHeight / 2, attachment.external ? attachment.outer.y1 : faceHeight / 2);
  const minY = Math.min(frontMinY, -frontMaxY);
  const maxY = Math.max(frontMaxY, -frontMinY);
  const artboardHeight = maxY - minY;
  const labelHeight = 8;
  const gap = Math.max(8, artboardWidth * .16);
  const totalWidth = artboardWidth * 2 + gap;
  const palette = project.palette;
  const body = palette[project.medal.baseColor]?.color || palette[0]?.color || '#222222';
  const bodyParts = [svgMedalOutline(project, 0, `fill="${body}"`)];
  const attachmentCuts = [];
  if (attachment.external) {
    const outer = attachment.outer;
    bodyParts.push(`<rect x="${outer.x0}" y="${outer.y0}" width="${outer.width}" height="${outer.height}" rx="${outer.radius}" fill="${body}"/>`);
    attachmentCuts.push(...attachment.apertures.map(aperture => `<rect x="${aperture.x0}" y="${aperture.y0}" width="${aperture.width}" height="${aperture.height}" rx="${aperture.radius}" fill="white"/>`));
  } else if (attachment.aperture?.kind === 'circle') {
    attachmentCuts.push(`<circle cx="${attachment.aperture.cx}" cy="${attachment.aperture.cy}" r="${attachment.aperture.diameter / 2}" fill="white"/>`);
  } else if (attachment.aperture?.kind === 'rounded-rect') {
    attachmentCuts.push(`<rect x="${attachment.aperture.x0}" y="${attachment.aperture.y0}" width="${attachment.aperture.width}" height="${attachment.aperture.height}" rx="${attachment.aperture.height / 2}" fill="white"/>`);
    if (attachment.channel) attachmentCuts.push(`<rect x="${attachment.channel.x0}" y="${attachment.channel.y0}" width="${attachment.channel.width}" height="${attachment.channel.y1 - attachment.channel.y0}" fill="white"/>`);
  }
  if (attachmentCuts.length) bodyParts.push(`<g data-attachment-style="${attachment.style}">${attachmentCuts.join('')}</g>`);
  const frontBodyParts = [...bodyParts];
  if (project.medal.rimWidth > 0) frontBodyParts.push(svgRimMarkup(project, palette[project.medal.rimColor]?.color || body));
  const attachmentHeight = Math.max(0, Number(project.medal.attachmentHeight) || 0);
  const attachmentColor = Number(project.medal.attachmentColor);
  if (attachment.external && attachmentHeight > 0 && Number.isInteger(attachmentColor)) {
    const outer = attachment.outer;
    const faceColor = palette[attachmentColor]?.color || body;
    frontBodyParts.push(`<g data-attachment-face-color="true"><rect x="${outer.x0}" y="${outer.y0}" width="${outer.width}" height="${outer.height}" rx="${outer.radius}" fill="${faceColor}"/>${attachmentCuts.join('')}</g>`);
  }
  // The raised edge and optional colored attachment cap are front operations
  // in the physical height field. The outside reverse remains the base body,
  // matching the actual first-layer view instead of repeating front details.
  const faceParts = { front: frontBodyParts, back: [`<g data-back-body-outside-view="true" transform="scale(1 -1)">${bodyParts.join('')}</g>`] };
  for (const element of project.elements) {
    if (element.hidden) continue;
    const face = element.face === 'back' ? 'back' : 'front';
    const parts = faceParts[face];
    const color = palette[element.color]?.color || body;
    // Each reverse element is shown from outside the back face on its own
    // artboard, so text remains readable and does not need a mirror transform.
    const outsideY = face === 'back' ? -element.y : element.y;
    const outsideRotation = face === 'back' ? -(element.rotation || 0) : (element.rotation || 0);
    const transform = `translate(${element.x} ${outsideY}) rotate(${outsideRotation}) scale(${element.scaleX || 1} ${element.scaleY || 1})`;
    const operation = `data-face="${face}" data-operation="${escapeXml(element.operation || 'raise')}" data-height-mm="${element.zHeight || 0}" data-depth-mm="${element.zDepth || 0}"`;
    const visualColor = element.operation === 'engrave' ? '#111714' : element.operation === 'cut' ? '#ffffff' : color;
    if (element.type === 'text') parts.push(`<text transform="${transform}" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(element.fontFamily || 'Arial')}" font-size="${element.fontSize}" font-weight="${element.weight || 800}" fill="${visualColor}" ${operation}>${escapeXml(element.text)}</text>`);
    else if (element.type === 'shape') parts.push(`<g transform="${transform}" fill="${visualColor}" ${operation}>${svgShape(element)}</g>`);
    else if (element.type === 'image') parts.push(`<image transform="${transform}" x="${-element.width/2}" y="${-element.height/2}" width="${element.width}" height="${element.height}" href="${escapeXml(element.dataUrl)}" ${operation}/>`);
    else if (element.type === 'path') {
      const points = element.points.map(([x,y]) => `${x*element.scale},${y*element.scale}`).join(' ');
      parts.push(element.closed ? `<polygon transform="${transform}" points="${points}" fill="${visualColor}" ${operation}/>` : `<polyline transform="${transform}" points="${points}" fill="none" stroke="${visualColor}" stroke-width="${element.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" ${operation}/>`);
    }
  }
  const backOffsetX = artboardWidth + gap;
  const labelY = minY - 2.5;
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}mm" height="${artboardHeight + labelHeight}mm" viewBox="${-artboardWidth/2} ${minY - labelHeight} ${totalWidth} ${artboardHeight + labelHeight}" data-attachment-style="${attachment.style}" data-layout="front-back"><title>${escapeXml(project.name)}</title><desc>Separate front and back MedalForge design references in physical millimeters. Reverse artwork is shown as viewed from outside the back face. Production geometry is available in the 3MF export.</desc><g data-artboard-face="front"><title>Front face</title><text x="0" y="${labelY}" text-anchor="middle" font-family="Arial" font-size="3" font-weight="700" fill="#68716d">FRONT</text>${faceParts.front.join('')}</g><g data-artboard-face="back" transform="translate(${backOffsetX} 0)"><title>Back face · outside view</title><text x="0" y="${labelY}" text-anchor="middle" font-family="Arial" font-size="3" font-weight="700" fill="#68716d">BACK · OUTSIDE VIEW</text>${faceParts.back.join('')}</g></svg>`;
}

export function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function safeFilename(value) {
  return String(value || 'medal')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'medal';
}
