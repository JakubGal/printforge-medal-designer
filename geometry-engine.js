const EPSILON = 1e-6;
const MAX_GRID_CELLS = 1_250_000;
const MAX_COLUMN_SEGMENTS = 4_000_000;
const MAX_ESTIMATED_WORKING_BYTES = 384 * 1024 * 1024;

function rounded(value) { return Math.round(value * 1e6) / 1e6; }

export function meshCellForProject(project, maxCellsOverride) {
  const quality = project.profile?.meshQuality || 'fine';
  const nozzle = Number(project.profile?.nozzle) || .4;
  const presets = {
    draft: { factor: .68, min: .22, max: .48, maxCells: 180_000 },
    balanced: { factor: .38, min: .13, max: .30, maxCells: 360_000 },
    fine: { factor: .22, min: .075, max: .18, maxCells: 650_000 },
    ultra: { factor: .13, min: .045, max: .10, maxCells: 1_050_000 },
  };
  const preset = presets[quality] || presets.fine;
  let cell = Math.max(preset.min, Math.min(preset.max, nozzle * preset.factor));
  const width = Number(project.medal?.width || project.medal?.diameter) || 60;
  const faceHeight = Number(project.medal?.height || project.medal?.diameter) || width;
  const totalHeight = faceHeight + (['single', 'double'].includes(project.medal?.loopStyle) ? Number(project.medal?.loopHeight) || 0 : 0);
  const maxCells = maxCellsOverride || preset.maxCells;
  const projected = width * totalHeight / (cell * cell);
  if (projected > maxCells) cell = Math.sqrt(width * totalHeight / maxCells);
  // Rounding a budget-derived cell downward can put the real ceil(cols) ×
  // ceil(rows) allocation just above its safety ceiling. Round upward by at
  // most one micron instead: the physical difference is far below any nozzle
  // resolution and the promised memory budget remains truthful.
  return Math.ceil(cell * 1000 - 1e-9) / 1000;
}

/**
 * Picks the first visible solid in the sampled medal column field. The walk is
 * bounded by the model AABB and samples at half-cell intervals, then refines
 * the air/solid transition. This is intentionally independent of triangle
 * count, so dense display meshes remain cheap to hover.
 */
export function raycastColumnField(sliceData, ray, options = {}) {
  const { bounds, cell, columns, columnData } = sliceData || {};
  const origin = ray?.origin, direction = ray?.direction;
  const packed = columnData?.offsets && columnData?.z0 && columnData?.z1 && columnData?.slots;
  if (!bounds || !Number.isFinite(cell) || cell <= 0 || (!Array.isArray(columns) && !packed) || !origin?.every(Number.isFinite) || !direction?.every(Number.isFinite)) return null;
  const segmentAt = (cellIndex, z, visibleSlots) => {
    if (packed) {
      for (let cursor = columnData.offsets[cellIndex]; cursor < columnData.offsets[cellIndex + 1]; cursor += 1) {
        const slot = columnData.slots[cursor];
        if ((!visibleSlots || visibleSlots.has(slot)) && z >= columnData.z0[cursor] - 1e-7 && z <= columnData.z1[cursor] + 1e-7) return { z0: columnData.z0[cursor], z1: columnData.z1[cursor], slot };
      }
      return null;
    }
    return (columns[cellIndex] || []).find(item => (!visibleSlots || visibleSlots.has(item.slot)) && z >= item.z0 - 1e-7 && z <= item.z1 + 1e-7) || null;
  };
  let inferredMaxZ = 0;
  if (Number.isFinite(options.maxZ)) inferredMaxZ = options.maxZ;
  else if (packed) for (let index = 0; index < columnData.z1.length; index += 1) inferredMaxZ = Math.max(inferredMaxZ, columnData.z1[index]);
  else inferredMaxZ = columns.reduce((maximum, column) => Math.max(maximum, column?.at(-1)?.z1 || 0), 0);
  const maxZ = inferredMaxZ;
  const boxMin = [bounds.minX, bounds.minY, 0];
  const boxMax = [bounds.minX + bounds.cols * cell, bounds.minY + bounds.rows * cell, Math.max(.001, Math.min(maxZ, Number(options.clipZ) || Number.POSITIVE_INFINITY))];
  let enter = 0, exit = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < boxMin[axis] || origin[axis] > boxMax[axis]) return null;
      continue;
    }
    const first = (boxMin[axis] - origin[axis]) / direction[axis];
    const second = (boxMax[axis] - origin[axis]) / direction[axis];
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (exit < enter) return null;
  }
  const visibleSlots = options.visibleSlots ? new Set(options.visibleSlots) : null;
  const at = t => {
    const x = origin[0] + direction[0] * t, y = origin[1] + direction[1] * t, z = origin[2] + direction[2] * t;
    const col = Math.floor((x - bounds.minX) / cell), row = Math.floor((y - bounds.minY) / cell);
    if (col < 0 || row < 0 || col >= bounds.cols || row >= bounds.rows || z < -1e-7 || z > boxMax[2] + 1e-7) return null;
    const cellIndex = row * bounds.cols + col;
    const segment = segmentAt(cellIndex, z, visibleSlots);
    if (segment && z > Math.min(segment.z1, boxMax[2]) + 1e-7) return null;
    return segment ? { x, y, z, col, row, cellIndex, segment } : null;
  };
  const step = Math.max(.035, cell * .45);
  let previousT = Math.max(0, enter - step), previous = at(previousT);
  for (let t = enter; t <= exit + step * .5; t += step) {
    const sampleT = Math.min(t, exit), sample = at(sampleT);
    if (sample && !previous) {
      let low = previousT, high = sampleT;
      for (let iteration = 0; iteration < 11; iteration += 1) {
        const middle = (low + high) / 2;
        if (at(middle)) high = middle; else low = middle;
      }
      const hit = at(Math.min(exit, high + 1e-7)) || sample;
      const segment = hit.segment;
      const tolerance = Math.max(cell * .7, step * 1.6);
      let normal, face;
      if (Math.abs(hit.z - segment.z1) <= tolerance && direction[2] < 0) { normal = [0, 0, 1]; face = 'top'; }
      else if (Math.abs(hit.z - segment.z0) <= tolerance && direction[2] > 0) { normal = [0, 0, -1]; face = 'bottom'; }
      else {
        const x0 = bounds.minX + hit.col * cell, x1 = x0 + cell, y0 = bounds.minY + hit.row * cell, y1 = y0 + cell;
        const edges = [[Math.abs(hit.x - x0), [-1,0,0]], [Math.abs(x1 - hit.x), [1,0,0]], [Math.abs(hit.y - y0), [0,-1,0]], [Math.abs(y1 - hit.y), [0,1,0]]];
        normal = edges.sort((a, b) => a[0] - b[0])[0][1]; face = 'side';
      }
      return { t: high, point: { x: hit.x, y: hit.y, z: hit.z }, normal, face, slot: segment.slot, cellIndex: hit.cellIndex, z0: segment.z0, z1: segment.z1, key: `${face}|${hit.cellIndex}|${segment.z0}|${segment.z1}|${segment.slot}` };
    }
    previous = sample; previousT = sampleT;
  }
  return null;
}

function copySegments(segments) {
  return segments.map(segment => ({ z0: segment.z0, z1: segment.z1, slot: segment.slot }));
}

function mergeAdjacent(segments) {
  const merged = [];
  for (const segment of segments) {
    if (segment.z1 - segment.z0 <= EPSILON) continue;
    const previous = merged.at(-1);
    if (previous && previous.slot === segment.slot && Math.abs(previous.z1 - segment.z0) <= EPSILON) previous.z1 = segment.z1;
    else merged.push({ z0: rounded(segment.z0), z1: rounded(segment.z1), slot: segment.slot });
  }
  return merged;
}

function clipColumnAt(segments, targetZ) {
  const clipped = [];
  for (const segment of segments) {
    if (segment.z0 >= targetZ - EPSILON) break;
    clipped.push({ z0: segment.z0, z1: rounded(Math.min(segment.z1, targetZ)), slot: segment.slot });
    if (segment.z1 >= targetZ - EPSILON) break;
  }
  return mergeAdjacent(clipped);
}

function clipColumnFrom(segments, targetZ) {
  const clipped = [];
  for (const segment of segments) {
    if (segment.z1 <= targetZ + EPSILON) continue;
    clipped.push({ z0: rounded(Math.max(segment.z0, targetZ)), z1: segment.z1, slot: segment.slot });
  }
  return mergeAdjacent(clipped);
}

export function buildColumnField(baseMask, baseHeight, operations, options = {}) {
  const columns = new Array(baseMask.length);
  let baseOffset = Math.max(0, Number(options.baseOffset) || 0);
  let baseTop = rounded(baseOffset + baseHeight);
  const baseSlot = Math.max(0, Math.min(255, Math.floor(Number(options.baseSlot) || 0)));
  const baseSegment = [{ z0: rounded(baseOffset), z1: baseTop, slot: baseSlot }];
  const minimumFloor = Math.max(0, Number(options.minimumFloor) || 0);
  let ignoredUnsupported = 0;
  let appliedCells = 0;

  const readColumn = index => {
    if (columns[index] !== undefined) return columns[index];
    return baseMask[index] ? baseSegment : [];
  };

  for (const operation of operations) {
    const kind = ['raise', 'engrave', 'inlay', 'cut'].includes(operation.kind) ? operation.kind : 'raise';
    const amount = Math.max(0, Number(operation.amount) || 0);
    const combine = operation.combine === 'stack' ? 'stack' : 'replace';
    const backFace = operation.face === 'back';
    const indices = operation.indices || [];
    for (let cursor = 0; cursor < indices.length; cursor += 1) {
      const index = indices[cursor];
      if (index < 0 || index >= baseMask.length || !baseMask[index]) continue;
      const current = readColumn(index);
      const slot = Math.max(0, Number(operation.owners?.[cursor] ?? operation.slot ?? 0));
      if (kind === 'cut') {
        columns[index] = [];
        appliedCells += 1;
        continue;
      }
      if (!current.length) { ignoredUnsupported += 1; continue; }
      if (backFace) {
        if (kind === 'raise') {
          const kept = combine === 'stack' ? copySegments(current) : clipColumnFrom(current, baseOffset);
          if (!kept.length) { ignoredUnsupported += 1; continue; }
          const bottom = kept[0].z0;
          const targetBottom = Math.max(0, rounded((combine === 'stack' ? bottom : baseOffset) - amount));
          kept.unshift({ z0: targetBottom, z1: rounded(bottom), slot });
          columns[index] = mergeAdjacent(kept);
        } else if (kind === 'engrave') {
          const currentTop = current.at(-1)?.z1 ?? baseTop;
          const target = Math.max(current[0]?.z0 ?? baseOffset, Math.min(baseTop - minimumFloor, currentTop - minimumFloor, baseOffset + amount));
          columns[index] = clipColumnFrom(current, target);
        } else if (kind === 'inlay') {
          const currentTop = current.at(-1)?.z1 ?? baseTop;
          // A flush back inlay is a material replacement, not an unsupported
          // pocket. Let it own the complete build-plate layer even when the
          // minimum-floor preference is larger than the remaining base core.
          const target = Math.max(current[0]?.z0 ?? baseOffset, Math.min(currentTop, baseOffset + amount));
          const raisedBottom = Math.max(0, baseOffset - Math.max(0, Number(operation.height) || 0));
          const upper = clipColumnFrom(current, target);
          upper.unshift({ z0: rounded(raisedBottom), z1: rounded(target), slot });
          columns[index] = mergeAdjacent(upper);
        }
        appliedCells += 1;
        continue;
      }
      if (kind === 'raise') {
        const next = combine === 'stack' ? copySegments(current) : clipColumnAt(current, baseTop);
        if (!next.length) { ignoredUnsupported += 1; continue; }
        const top = next.at(-1).z1;
        const targetTop = combine === 'stack' ? top + amount : baseTop + amount;
        next.push({ z0: top, z1: rounded(targetTop), slot });
        columns[index] = mergeAdjacent(next);
      } else if (kind === 'engrave') {
        const currentBottom = current[0]?.z0 ?? baseOffset;
        const target = Math.min(current.at(-1)?.z1 ?? baseTop, Math.max(baseOffset + minimumFloor, currentBottom + minimumFloor, baseTop - amount));
        columns[index] = clipColumnAt(current, target);
      } else if (kind === 'inlay') {
        const currentBottom = current[0]?.z0 ?? baseOffset;
        const target = Math.min(current.at(-1)?.z1 ?? baseTop, Math.max(baseOffset + minimumFloor, currentBottom + minimumFloor, baseTop - amount));
        const lowered = clipColumnAt(current, target);
        if (!lowered.length) { ignoredUnsupported += 1; continue; }
        const loweredTop = lowered.at(-1).z1;
        lowered.push({ z0: loweredTop, z1: rounded(baseTop + Math.max(0, Number(operation.height) || 0)), slot });
        columns[index] = mergeAdjacent(lowered);
      }
      appliedCells += 1;
    }
  }

  // A conservative authoring offset is needed before masks are rasterized,
  // especially for stacked underside relief. Later operations can overwrite
  // the feature that required part of that offset, so translate the completed
  // field down to the actual build plate instead of exporting a floating part.
  let minimumZ = Number.POSITIVE_INFINITY;
  for (let index = 0; index < columns.length; index += 1) {
    const segments = readColumn(index);
    if (segments.length) minimumZ = Math.min(minimumZ, segments[0].z0);
  }
  const zShift = Number.isFinite(minimumZ) && minimumZ > EPSILON ? rounded(minimumZ) : 0;
  if (zShift > 0) {
    for (const segment of baseSegment) { segment.z0 = rounded(segment.z0 - zShift); segment.z1 = rounded(segment.z1 - zShift); }
    for (const column of columns) if (column) for (const segment of column) { segment.z0 = rounded(segment.z0 - zShift); segment.z1 = rounded(segment.z1 - zShift); }
    baseOffset = rounded(baseOffset - zShift);
    baseTop = rounded(baseTop - zShift);
  }

  let maxHeight = baseTop;
  let cutCells = 0;
  for (let index = 0; index < columns.length; index += 1) {
    const segments = readColumn(index);
    if (baseMask[index] && !segments.length) cutCells += 1;
    if (segments.length) maxHeight = Math.max(maxHeight, segments.at(-1).z1);
  }
  return { columns, baseSegment, baseOffset: rounded(baseOffset), baseTop, zShift, maxHeight: rounded(maxHeight), cutCells, appliedCells, ignoredUnsupported };
}

function subtractCoveredInterval(z0, z1, neighborSegments, slot) {
  let ranges = [[z0, z1]];
  for (const neighbor of neighborSegments) {
    if (neighbor.slot !== slot) continue;
    const next = [];
    for (const [start, end] of ranges) {
      if (neighbor.z1 <= start + EPSILON || neighbor.z0 >= end - EPSILON) next.push([start, end]);
      else {
        if (neighbor.z0 > start + EPSILON) next.push([start, Math.min(end, neighbor.z0)]);
        if (neighbor.z1 < end - EPSILON) next.push([Math.max(start, neighbor.z1), end]);
      }
    }
    ranges = next;
    if (!ranges.length) break;
  }
  return ranges;
}

function pushTriangle(target, a, b, c) {
  target.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

function emitSegmentedGreedySurfaces(surfaceMap, meshes, bounds, cell) {
  const { cols, minX, minY } = bounds;
  // A Set entry costs many times more than the integer it stores. Surface
  // groups therefore keep compact append-only lists and share this one-byte
  // occupancy grid while each group is greedily consumed.
  const occupied = new Uint8Array(bounds.cols * bounds.rows);
  for (const [key, cells] of surfaceMap) {
    const [meshText, zText, face] = key.split('|');
    const meshIndex = Number(meshText), z = Number(zText), top = face === 'top';
    for (const index of cells) occupied[index] = 1;
    for (const first of cells) {
      if (!occupied[first]) continue;
      const row = Math.floor(first / cols), col = first % cols;
      let width = 1;
      while (col + width < cols && occupied[row * cols + col + width]) width += 1;
      let height = 1;
      outer: while (row + height < bounds.rows) {
        for (let x = 0; x < width; x += 1) if (!occupied[(row + height) * cols + col + x]) break outer;
        height += 1;
      }
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) occupied[(row + y) * cols + col + x] = 0;
      const x0 = minX + col * cell, x1 = x0 + width * cell;
      const y0 = minY + row * cell, y1 = y0 + height * cell;
      const boundary = [];
      for (let x = 0; x < width; x += 1) boundary.push([x0 + x * cell, y0, z]);
      for (let y = 0; y < height; y += 1) boundary.push([x1, y0 + y * cell, z]);
      for (let x = width; x > 0; x -= 1) boundary.push([x0 + x * cell, y1, z]);
      for (let y = height; y > 0; y -= 1) boundary.push([x0, y0 + y * cell, z]);
      const center = [(x0 + x1) / 2, (y0 + y1) / 2, z];
      for (let index = 0; index < boundary.length; index += 1) {
        const next = boundary[(index + 1) % boundary.length];
        if (top) pushTriangle(meshes[meshIndex].triangles, center, boundary[index], next);
        else pushTriangle(meshes[meshIndex].triangles, center, next, boundary[index]);
      }
    }
  }
}

function pushZipperedVertical(target, direction, fixed, start, end, z0, z1, startBreaks, endBreaks) {
  const select = levels => [z0, ...levels.filter(z => z > z0 + EPSILON && z < z1 - EPSILON), z1];
  const leftLevels = select(startBreaks), rightLevels = select(endBreaks);
  const point = (position, z) => direction === 'left' || direction === 'right' ? [fixed, position, z] : [position, fixed, z];
  const reverse = direction === 'right' || direction === 'above';
  let leftIndex = 0, rightIndex = 0;
  while (leftIndex + 1 < leftLevels.length || rightIndex + 1 < rightLevels.length) {
    const left = point(start, leftLevels[leftIndex]);
    const right = point(end, rightLevels[rightIndex]);
    const nextLeft = leftLevels[leftIndex + 1] ?? Number.POSITIVE_INFINITY;
    const nextRight = rightLevels[rightIndex + 1] ?? Number.POSITIVE_INFINITY;
    if (nextLeft <= nextRight) {
      const advanced = point(start, nextLeft);
      if (reverse) pushTriangle(target, left, right, advanced);
      else pushTriangle(target, left, advanced, right);
      leftIndex += 1;
    } else {
      const advanced = point(end, nextRight);
      if (reverse) pushTriangle(target, left, right, advanced);
      else pushTriangle(target, left, advanced, right);
      rightIndex += 1;
    }
  }
}

export function columnFieldToMeshes(field, baseMask, bounds, cell, palette) {
  const { cols, rows, minX, minY } = bounds;
  const cellCount = cols * rows;
  if (!Number.isSafeInteger(cellCount) || cols <= 0 || rows <= 0 || baseMask.length !== cellCount) {
    throw new RangeError(`Mesh grid ${cols} x ${rows} does not match its ${baseMask.length}-cell mask.`);
  }
  if (cellCount > MAX_GRID_CELLS) {
    throw new RangeError(`Mesh grid needs ${cellCount.toLocaleString()} cells, above the ${MAX_GRID_CELLS.toLocaleString()}-cell safety budget. Choose a lower mesh quality.`);
  }
  let totalSegments = 0;
  for (let index = 0; index < cellCount; index += 1) {
    const explicit = field.columns[index];
    totalSegments += explicit === undefined ? (baseMask[index] ? field.baseSegment.length : 0) : explicit.length;
    if (totalSegments > MAX_COLUMN_SEGMENTS) {
      throw new RangeError(`Mesh needs more than ${MAX_COLUMN_SEGMENTS.toLocaleString()} vertical segments. Reduce stacked operations or choose a lower mesh quality.`);
    }
  }
  // Includes conservative allowances for resolved columns, component queues,
  // cap occupancy, topology caches, and numeric surface lists. Triangle output
  // is separately bounded by production export validation.
  const estimatedWorkingBytes = cellCount * 24 + totalSegments * 72;
  if (estimatedWorkingBytes > MAX_ESTIMATED_WORKING_BYTES) {
    const estimatedMb = Math.ceil(estimatedWorkingBytes / 1024 / 1024);
    throw new RangeError(`Mesh working set is estimated at ${estimatedMb} MB, above the 384 MB safety budget. Reduce stacked operations or mesh quality.`);
  }
  const readColumn = index => {
    if (index < 0 || index >= baseMask.length) return [];
    if (field.columns[index] !== undefined) return field.columns[index];
    return baseMask[index] ? field.baseSegment : [];
  };
  const columns = new Array(cellCount);
  for (let index = 0; index < cellCount; index += 1) columns[index] = readColumn(index);
  const materialAt = (segments, z) => segments.find(segment => z > segment.z0 + EPSILON && z < segment.z1 - EPSILON)?.slot;
  const describeColumnChange = (before, after) => {
    const levels = [...new Set([...before, ...after].flatMap(segment => [rounded(segment.z0), rounded(segment.z1)]))].sort((a, b) => a - b);
    const affectedSlots = new Set();
    let alteredHeight = 0, removedHeight = 0, reassignedHeight = 0, addedHeight = 0, maxZ = 0;
    for (let index = 1; index < levels.length; index += 1) {
      const z0 = levels[index - 1], z1 = levels[index];
      if (z1 - z0 <= EPSILON) continue;
      const midpoint = (z0 + z1) / 2;
      const beforeSlot = materialAt(before, midpoint), afterSlot = materialAt(after, midpoint);
      if (beforeSlot === afterSlot) continue;
      const height = z1 - z0;
      alteredHeight += height; maxZ = Math.max(maxZ, z1);
      if (beforeSlot !== undefined) affectedSlots.add(beforeSlot);
      if (afterSlot !== undefined) affectedSlots.add(afterSlot);
      if (beforeSlot !== undefined && afterSlot === undefined) removedHeight += height;
      else if (beforeSlot === undefined && afterSlot !== undefined) addedHeight += height;
      else reassignedHeight += height;
    }
    return alteredHeight > EPSILON ? { alteredHeight, removedHeight, reassignedHeight, addedHeight, maxZ, affectedSlots } : null;
  };
  const setMaterialBand = (cellIndex, z0, z1, slot) => {
    const current = columns[cellIndex];
    const next = [];
    for (const segment of current) {
      if (segment.z1 <= z0 + EPSILON || segment.z0 >= z1 - EPSILON) next.push({ ...segment });
      else {
        if (segment.z0 < z0 - EPSILON) next.push({ z0: segment.z0, z1: rounded(z0), slot: segment.slot });
        // A material cleanup may relabel existing solid but must never fill an
        // air interval created by an authored cut or an earlier monotonic edit.
        if (slot !== undefined && slot !== null) {
          const overlapStart = Math.max(segment.z0, z0), overlapEnd = Math.min(segment.z1, z1);
          if (overlapEnd - overlapStart > EPSILON) next.push({ z0: rounded(overlapStart), z1: rounded(overlapEnd), slot });
        }
        if (segment.z1 > z1 + EPSILON) next.push({ z0: rounded(z1), z1: segment.z1, slot: segment.slot });
      }
    }
    const resolved = mergeAdjacent(next.sort((a, b) => a.z0 - b.z0));
    const change = describeColumnChange(current, resolved);
    if (!change) return null;
    columns[cellIndex] = resolved;
    return change;
  };
  let regularizedBands = 0, regularizationPassesApplied = 0;
  let alteredHeight = 0, removedHeight = 0, reassignedHeight = 0, addedHeight = 0, maxAffectedZ = 0;
  const affectedSlots = new Set();
  const mutationLimit = Math.max(8_192, Math.min(500_000, cellCount));
  let regularizationCapped = false;
  // A checkerboard around a grid edge creates a non-manifold pinch. Resolve it
  // monotonically: air always wins over solid (cuts may grow, never close), and
  // lower material slots win one sample at ambiguous color contacts. A cell's
  // rank can only decrease, so passes cannot oscillate. Every edit is reported
  // and production validation still verifies the resulting closed solids.
  const materialRank = value => value === undefined ? -1 : value;
  const regularizationPasses = palette.length + 4;
  for (let pass = 0; pass < regularizationPasses; pass += 1) {
    const pending = [], reservedBands = new Map();
    const queueCheckerboard = (entries, materials) => {
      if (regularizedBands + pending.length >= mutationLimit) { regularizationCapped = true; return false; }
      const available = position => {
        const entry = entries[position], bands = reservedBands.get(entry.cellIndex);
        return !bands?.some(([z0, z1]) => z0 === entry.z0 && z1 === entry.z1);
      };
      for (const [first, opposite, orthogonalA, orthogonalB] of [[0, 2, 1, 3], [1, 3, 0, 2]]) {
        const diagonalMaterial = materials[first];
        if (materials[opposite] !== diagonalMaterial || materials[orthogonalA] === diagonalMaterial || materials[orthogonalB] === diagonalMaterial) continue;
        const diagonal = [first, opposite].filter(available);
        const orthogonal = [orthogonalA, orthogonalB].filter(available);
        if (!diagonal.length || !orthogonal.length) continue;
        const bestOrthogonal = orthogonal.reduce((best, position) => materialRank(materials[position]) < materialRank(materials[best]) ? position : best);
        let target;
        let replacement;
        if (materialRank(diagonalMaterial) <= materialRank(materials[bestOrthogonal])) {
          target = orthogonal.reduce((worst, position) => materialRank(materials[position]) > materialRank(materials[worst]) ? position : worst);
          replacement = diagonalMaterial;
        } else {
          target = diagonal.reduce((best, position) => {
            const bestTop = columns[entries[best].cellIndex].at(-1)?.z1 ?? entries[best].z1;
            const candidateTop = columns[entries[position].cellIndex].at(-1)?.z1 ?? entries[position].z1;
            return candidateTop < bestTop ? position : best;
          });
          replacement = materials[bestOrthogonal];
        }
        const entry = { ...entries[target], slot: replacement };
        // Never alter occupancy at the build plate: this preserves authored
        // through-cuts and their connectivity for exact preflight. Surface air
        // may only expand upward from an engraving/inlay boundary.
        if (replacement === undefined && entry.z0 <= EPSILON) continue;
        if (replacement === undefined) entry.z1 = columns[entry.cellIndex].at(-1)?.z1 ?? entry.z1;
        const reserved = reservedBands.get(entries[target].cellIndex) || [];
        reserved.push([entries[target].z0, entries[target].z1]);
        reservedBands.set(entries[target].cellIndex, reserved);
        pending.push(entry);
        return true;
      }
      return false;
    };
    for (let vertexRow = 1; vertexRow < rows && !regularizationCapped; vertexRow += 1) {
      for (let vertexCol = 1; vertexCol < cols && !regularizationCapped; vertexCol += 1) {
        const incident = [
          (vertexRow - 1) * cols + vertexCol - 1,
          (vertexRow - 1) * cols + vertexCol,
          vertexRow * cols + vertexCol,
          vertexRow * cols + vertexCol - 1,
        ];
        const levels = [...new Set(incident.flatMap(index => columns[index].flatMap(segment => [rounded(segment.z0), rounded(segment.z1)])))].sort((a, b) => a - b);
        for (let band = 1; band < levels.length; band += 1) {
          const z0 = levels[band - 1], z1 = levels[band];
          if (z1 - z0 <= EPSILON) continue;
          const midpoint = (z0 + z1) / 2;
          const materials = incident.map(index => materialAt(columns[index], midpoint));
          queueCheckerboard(incident.map(cellIndex => ({ cellIndex, z0, z1 })), materials);
        }
      }
    }
    const scanHorizontalEdge = (firstCell, secondCell) => {
      if (regularizationCapped) return;
      const levels = [...new Set([...columns[firstCell], ...columns[secondCell]].flatMap(segment => [rounded(segment.z0), rounded(segment.z1)]))].sort((a, b) => a - b);
      for (let level = 1; level + 1 < levels.length; level += 1) {
        const lower0 = levels[level - 1], split = levels[level], upper1 = levels[level + 1];
        if (split - lower0 <= EPSILON || upper1 - split <= EPSILON) continue;
        const lowerMid = (lower0 + split) / 2, upperMid = (split + upper1) / 2;
        const entries = [
          { cellIndex: firstCell, z0: lower0, z1: split },
          { cellIndex: secondCell, z0: lower0, z1: split },
          { cellIndex: secondCell, z0: split, z1: upper1 },
          { cellIndex: firstCell, z0: split, z1: upper1 },
        ];
        queueCheckerboard(entries, [
          materialAt(columns[firstCell], lowerMid), materialAt(columns[secondCell], lowerMid),
          materialAt(columns[secondCell], upperMid), materialAt(columns[firstCell], upperMid),
        ]);
      }
    };
    for (let row = 0; row < rows && !regularizationCapped; row += 1) for (let col = 1; col < cols && !regularizationCapped; col += 1) scanHorizontalEdge(row * cols + col - 1, row * cols + col);
    for (let row = 1; row < rows && !regularizationCapped; row += 1) for (let col = 0; col < cols && !regularizationCapped; col += 1) scanHorizontalEdge((row - 1) * cols + col, row * cols + col);
    if (!pending.length) break;
    let applied = 0;
    for (const fill of pending) {
      const change = setMaterialBand(fill.cellIndex, fill.z0, fill.z1, fill.slot);
      if (!change) continue;
      applied += 1; regularizedBands += 1;
      alteredHeight += change.alteredHeight;
      removedHeight += change.removedHeight;
      reassignedHeight += change.reassignedHeight;
      addedHeight += change.addedHeight;
      maxAffectedZ = Math.max(maxAffectedZ, change.maxZ);
      for (const slot of change.affectedSlots) affectedSlots.add(slot);
    }
    regularizationPassesApplied = pass + 1;
    if (!applied) break;
    if (regularizationCapped) break;
  }
  const componentOffsets = new Uint32Array(cellCount + 1);
  let resolvedSegmentCount = 0;
  for (let index = 0; index < cellCount; index += 1) {
    resolvedSegmentCount += columns[index].length;
    if (resolvedSegmentCount > MAX_COLUMN_SEGMENTS) {
      throw new RangeError(`Topology cleanup produced more than ${MAX_COLUMN_SEGMENTS.toLocaleString()} vertical segments. Reduce stacked operations or mesh quality.`);
    }
    componentOffsets[index + 1] = resolvedSegmentCount;
  }
  const resolvedWorkingBytes = cellCount * 24 + resolvedSegmentCount * 72;
  if (resolvedWorkingBytes > MAX_ESTIMATED_WORKING_BYTES) {
    const estimatedMb = Math.ceil(resolvedWorkingBytes / 1024 / 1024);
    throw new RangeError(`Resolved mesh working set is estimated at ${estimatedMb} MB, above the 384 MB safety budget. Reduce stacked operations or mesh quality.`);
  }
  const componentIds = new Int32Array(resolvedSegmentCount); componentIds.fill(-1);
  const segmentCells = new Uint32Array(resolvedSegmentCount);
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    for (let flatIndex = componentOffsets[cellIndex]; flatIndex < componentOffsets[cellIndex + 1]; flatIndex += 1) segmentCells[flatIndex] = cellIndex;
  }
  const componentQueue = new Uint32Array(resolvedSegmentCount);
  const components = [];
  for (let cellIndex = 0; cellIndex < columns.length; cellIndex += 1) {
    for (let segmentIndex = 0; segmentIndex < columns[cellIndex].length; segmentIndex += 1) {
      const seedFlatIndex = componentOffsets[cellIndex] + segmentIndex;
      if (componentIds[seedFlatIndex] >= 0) continue;
      const slot = columns[cellIndex][segmentIndex].slot;
      const componentId = components.length;
      let queueHead = 0, queueTail = 0;
      componentQueue[queueTail++] = seedFlatIndex;
      componentIds[seedFlatIndex] = componentId;
      for (; queueHead < queueTail; queueHead += 1) {
        const currentFlatIndex = componentQueue[queueHead];
        const currentCell = segmentCells[currentFlatIndex], currentSegmentIndex = currentFlatIndex - componentOffsets[currentCell];
        const segment = columns[currentCell][currentSegmentIndex];
        const row = Math.floor(currentCell / cols), col = currentCell % cols;
        const visitNeighbor = neighborCell => {
          for (let neighborSegmentIndex = 0; neighborSegmentIndex < columns[neighborCell].length; neighborSegmentIndex += 1) {
            const neighbor = columns[neighborCell][neighborSegmentIndex];
            const neighborFlatIndex = componentOffsets[neighborCell] + neighborSegmentIndex;
            if (neighbor.slot !== slot || componentIds[neighborFlatIndex] >= 0) continue;
            if (Math.min(segment.z1, neighbor.z1) - Math.max(segment.z0, neighbor.z0) <= EPSILON) continue;
            componentIds[neighborFlatIndex] = componentId;
            componentQueue[queueTail++] = neighborFlatIndex;
          }
        };
        if (col > 0) visitNeighbor(currentCell - 1);
        if (col + 1 < cols) visitNeighbor(currentCell + 1);
        if (row > 0) visitNeighbor(currentCell - cols);
        if (row + 1 < rows) visitNeighbor(currentCell + cols);
      }
      components.push({ id: componentId, slot, nodeCount: queueTail });
    }
  }
  const totalsBySlot = new Map();
  for (const component of components) totalsBySlot.set(component.slot, (totalsBySlot.get(component.slot) || 0) + 1);
  const seenBySlot = new Map();
  const meshes = components.map(component => {
    const filament = palette[component.slot] || palette[0] || { name: 'Material', color: '#888888' };
    const shell = (seenBySlot.get(component.slot) || 0) + 1; seenBySlot.set(component.slot, shell);
    const suffix = totalsBySlot.get(component.slot) > 1 ? ` · shell ${shell}` : '';
    return { slot: component.slot, component: component.id, shell, shellCount: totalsBySlot.get(component.slot), regularizedBands, name: `Slot ${component.slot + 1} - ${filament.name}${suffix}`, color: filament.color, triangles: [], volumeMm3: 0 };
  });
  const surfaceMap = new Map();
  const addSurface = (meshIndex, z, face, index) => {
    const key = `${meshIndex}|${rounded(z)}|${face}`;
    if (!surfaceMap.has(key)) surfaceMap.set(key, []);
    surfaceMap.get(key).push(index);
  };
  const vertexBreakCache = new Map();
  const breaksAtVertex = (vertexCol, vertexRow) => {
    const key = vertexRow * (cols + 1) + vertexCol;
    if (vertexBreakCache.has(key)) return vertexBreakCache.get(key);
    const values = new Set();
    for (const row of [vertexRow - 1, vertexRow]) for (const col of [vertexCol - 1, vertexCol]) {
      if (row < 0 || col < 0 || row >= rows || col >= cols) continue;
      for (const segment of columns[row * cols + col]) { values.add(rounded(segment.z0)); values.add(rounded(segment.z1)); }
    }
    const levels = [...values].sort((a, b) => a - b); vertexBreakCache.set(key, levels); return levels;
  };

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const segments = columns[index];
      if (!segments.length) continue;
      const x0 = minX + col * cell, x1 = x0 + cell;
      const y0 = minY + row * cell, y1 = y0 + cell;
      const neighbors = {
        left: col > 0 ? columns[index - 1] : [],
        right: col + 1 < cols ? columns[index + 1] : [],
        above: row > 0 ? columns[index - cols] : [],
        below: row + 1 < rows ? columns[index + cols] : [],
      };
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const segment = segments[segmentIndex], meshIndex = componentIds[componentOffsets[index] + segmentIndex], mesh = meshes[meshIndex];
        if (!mesh) continue;
        mesh.volumeMm3 += cell * cell * (segment.z1 - segment.z0);
        addSurface(meshIndex, segment.z0, 'bottom', index);
        addSurface(meshIndex, segment.z1, 'top', index);
        for (const [startZ, endZ] of subtractCoveredInterval(segment.z0, segment.z1, neighbors.left, segment.slot)) pushZipperedVertical(mesh.triangles, 'left', x0, y0, y1, startZ, endZ, breaksAtVertex(col, row), breaksAtVertex(col, row + 1));
        for (const [startZ, endZ] of subtractCoveredInterval(segment.z0, segment.z1, neighbors.right, segment.slot)) pushZipperedVertical(mesh.triangles, 'right', x1, y0, y1, startZ, endZ, breaksAtVertex(col + 1, row), breaksAtVertex(col + 1, row + 1));
        for (const [startZ, endZ] of subtractCoveredInterval(segment.z0, segment.z1, neighbors.above, segment.slot)) pushZipperedVertical(mesh.triangles, 'above', y0, x0, x1, startZ, endZ, breaksAtVertex(col, row), breaksAtVertex(col + 1, row));
        for (const [startZ, endZ] of subtractCoveredInterval(segment.z0, segment.z1, neighbors.below, segment.slot)) pushZipperedVertical(mesh.triangles, 'below', y1, x0, x1, startZ, endZ, breaksAtVertex(col, row + 1), breaksAtVertex(col + 1, row + 1));
      }
    }
  }

  // Greedy rectangles are triangulated from a center to every cell-sized
  // boundary edge. This retains the exact wall vertices (no T-junctions) while
  // avoiding millions of redundant coplanar cell caps.
  emitSegmentedGreedySurfaces(surfaceMap, meshes, bounds, cell);
  let resolvedMaxHeight = 0;
  for (const segments of columns) if (segments.length) resolvedMaxHeight = Math.max(resolvedMaxHeight, segments.at(-1).z1);
  field.resolvedColumns = columns;
  field.regularizedBands = regularizedBands;
  field.maxHeight = rounded(resolvedMaxHeight);
  field.topologyCleanup = {
    mutatedBands: regularizedBands,
    mutationLimit,
    capped: regularizationCapped,
    passes: regularizationPassesApplied,
    estimatedAlteredVolumeMm3: rounded(alteredHeight * cell * cell),
    removedVolumeMm3: rounded(removedHeight * cell * cell),
    reassignedVolumeMm3: rounded(reassignedHeight * cell * cell),
    addedVolumeMm3: rounded(addedHeight * cell * cell),
    affectedSlots: [...affectedSlots].sort((a, b) => a - b),
    maxAffectedZ: rounded(maxAffectedZ),
  };
  return meshes.filter(mesh => mesh.triangles.length);
}

export function inspectColumn(field, baseMask, index) {
  if (field.columns[index] !== undefined) return copySegments(field.columns[index]);
  return baseMask[index] ? copySegments(field.baseSegment) : [];
}

export function validateMesh(mesh) {
  const vertexIds = new Map(), edgeCounts = new Map(), triangles = new Set();
  let nextVertexId = 0, degenerateTriangles = 0, duplicateTriangles = 0, nonFiniteCoordinates = 0, signedVolumeMm3 = 0;
  const vertexId = (x, y, z) => {
    const key = `${rounded(x)},${rounded(y)},${rounded(z)}`;
    if (!vertexIds.has(key)) vertexIds.set(key, nextVertexId++);
    return vertexIds.get(key);
  };
  for (let offset = 0; offset < mesh.triangles.length; offset += 9) {
    const values = mesh.triangles.slice(offset, offset + 9);
    if (values.some(value => !Number.isFinite(value))) { nonFiniteCoordinates += 1; continue; }
    const [ax,ay,az,bx,by,bz,cx,cy,cz] = values;
    const ux=bx-ax, uy=by-ay, uz=bz-az, vx=cx-ax, vy=cy-ay, vz=cz-az;
    const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    if (Math.hypot(nx, ny, nz) <= EPSILON) degenerateTriangles += 1;
    signedVolumeMm3 += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ids = [vertexId(ax,ay,az), vertexId(bx,by,bz), vertexId(cx,cy,cz)];
    const triangleKey = [...ids].sort((a,b) => a-b).join('|');
    if (triangles.has(triangleKey)) duplicateTriangles += 1; else triangles.add(triangleKey);
    for (const [a,b] of [[ids[0],ids[1]],[ids[1],ids[2]],[ids[2],ids[0]]]) {
      const low = Math.min(a,b), high = Math.max(a,b), key = `${low}|${high}`;
      const edge = edgeCounts.get(key) || { count: 0, direction: 0 };
      edge.count += 1; edge.direction += a === low ? 1 : -1; edgeCounts.set(key, edge);
    }
  }
  let unmatchedEdges = 0, misorientedEdges = 0;
  for (const edge of edgeCounts.values()) {
    if (edge.count !== 2) unmatchedEdges += 1;
    else if (edge.direction !== 0) misorientedEdges += 1;
  }
  const issues = { unmatchedEdges, misorientedEdges, degenerateTriangles, duplicateTriangles, nonFiniteCoordinates };
  return { valid: Object.values(issues).every(value => value === 0) && signedVolumeMm3 > EPSILON, ...issues, signedVolumeMm3, triangleCount: mesh.triangles.length / 9, vertexCount: vertexIds.size };
}
