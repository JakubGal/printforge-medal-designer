const EPSILON = 1e-7;
const MAX_CELLS = 1_250_000;
const MAX_SEGMENTS = 4_000_000;

function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}

function stepVertex(vertex, direction, stride) {
  if (direction === 0) return vertex + 1;
  if (direction === 1) return vertex + stride;
  if (direction === 2) return vertex - 1;
  return vertex - stride;
}

function chooseDirection(flags, incoming) {
  // With solid on the left of every directed edge, preferring a left turn
  // keeps point-touching components as separate, non-self-intersecting loops.
  const order = [(incoming + 1) & 3, incoming, (incoming + 3) & 3, (incoming + 2) & 3];
  for (const direction of order) if (flags & (1 << direction)) return direction;
  return -1;
}

function signedArea(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index], second = points[(index + 1) % points.length];
    twiceArea += first[0] * second[1] - second[0] * first[1];
  }
  return twiceArea / 2;
}

function simplifyGridLoop(points) {
  if (points.length <= 4) return points;
  const simplified = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index + points.length - 1) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const firstX = current[0] - previous[0], firstY = current[1] - previous[1];
    const secondX = next[0] - current[0], secondY = next[1] - current[1];
    if (firstX * secondY !== firstY * secondX) simplified.push(current);
  }
  return simplified;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current], b = polygon[previous];
    const crosses = (a[1] > point[1]) !== (b[1] > point[1]);
    if (crosses && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function pointInsideClockwiseLoop(points) {
  const first = points[0], second = points[1];
  const dx = second[0] - first[0], dy = second[1] - first[1];
  const length = Math.max(1, Math.abs(dx) + Math.abs(dy));
  // A clockwise hole has its empty interior on the right side of each edge.
  return [(first[0] + second[0]) / 2 + dy / length * .25, (first[1] + second[1]) / 2 - dx / length * .25];
}

function extractLoops(group, occupied, edgeFlags, cols, rows) {
  const stride = cols + 1;
  let edgeCount = 0;
  for (const cell of group.cells) {
    const row = Math.floor(cell / cols), col = cell - row * cols;
    if (row === 0 || !occupied[cell - cols]) {
      edgeFlags[row * stride + col] |= 1 << 0;
      edgeCount += 1;
    }
    if (col === cols - 1 || !occupied[cell + 1]) {
      edgeFlags[row * stride + col + 1] |= 1 << 1;
      edgeCount += 1;
    }
    if (row === rows - 1 || !occupied[cell + cols]) {
      edgeFlags[(row + 1) * stride + col + 1] |= 1 << 2;
      edgeCount += 1;
    }
    if (col === 0 || !occupied[cell - 1]) {
      edgeFlags[(row + 1) * stride + col] |= 1 << 3;
      edgeCount += 1;
    }
  }

  const loops = [];
  let consumed = 0;
  for (let startVertex = 0; startVertex < edgeFlags.length; startVertex += 1) {
    while (edgeFlags[startVertex]) {
      const firstDirection = chooseDirection(edgeFlags[startVertex], 3);
      let vertex = startVertex, direction = firstDirection;
      const points = [];
      for (let guard = 0; guard <= edgeCount; guard += 1) {
        const bit = 1 << direction;
        if (!(edgeFlags[vertex] & bit)) throw new Error('B-Rep contour tracing encountered a reused boundary edge.');
        edgeFlags[vertex] &= ~bit;
        consumed += 1;
        points.push([vertex % stride, Math.floor(vertex / stride)]);
        vertex = stepVertex(vertex, direction, stride);
        if (vertex === startVertex) break;
        direction = chooseDirection(edgeFlags[vertex], direction);
        if (direction < 0) throw new Error('B-Rep contour tracing found an open boundary.');
        if (guard === edgeCount) throw new Error('B-Rep contour tracing exceeded its closed-loop safety bound.');
      }
      const simplified = simplifyGridLoop(points);
      const area = signedArea(simplified);
      if (simplified.length < 4 || Math.abs(area) <= EPSILON) throw new Error('B-Rep contour tracing produced a degenerate face.');
      loops.push({ points: simplified, area, holes: [] });
    }
  }
  if (consumed !== edgeCount) throw new Error('B-Rep contour tracing did not consume every boundary edge.');
  return loops;
}

function nestLoops(loops) {
  const outers = loops.filter(loop => loop.area > 0);
  const holes = loops.filter(loop => loop.area < 0);
  if (!outers.length) throw new Error('B-Rep contour has no exterior loop.');
  for (const hole of holes) {
    const point = pointInsideClockwiseLoop(hole.points);
    const parent = outers
      .filter(outer => pointInPolygon(point, outer.points))
      .sort((first, second) => first.area - second.area)[0];
    if (!parent) throw new Error('B-Rep contour contains an unbounded hole.');
    parent.holes.push(hole);
  }
  return outers;
}

function makeWire(oc, points, z, bounds, cell) {
  const wireMaker = new oc.BRepBuilderAPI_MakeWire();
  try {
    for (let index = 0; index < points.length; index += 1) {
      const first = points[index], second = points[(index + 1) % points.length];
      const p1 = new oc.gp_Pnt(bounds.minX + first[0] * cell, bounds.minY + first[1] * cell, z);
      const p2 = new oc.gp_Pnt(bounds.minX + second[0] * cell, bounds.minY + second[1] * cell, z);
      const edgeMaker = new oc.BRepBuilderAPI_MakeEdge(p1, p2);
      try {
        if (!edgeMaker.IsDone()) throw new Error('OpenCascade could not build a contour edge.');
        const edge = edgeMaker.Edge();
        try { wireMaker.Add(edge); } finally { edge.delete(); }
      } finally {
        edgeMaker.delete();
        p1.delete();
        p2.delete();
      }
    }
    if (!wireMaker.IsDone()) throw new Error('OpenCascade could not close a contour wire.');
    return wireMaker.Wire();
  } finally {
    wireMaker.delete();
  }
}

function extrudeContour(oc, outer, group, bounds, cell) {
  const outerWire = makeWire(oc, outer.points, group.z0, bounds, cell);
  const faceMaker = new oc.BRepBuilderAPI_MakeFace(outerWire, true);
  outerWire.delete();
  try {
    for (const hole of outer.holes) {
      const holeWire = makeWire(oc, hole.points, group.z0, bounds, cell);
      try { faceMaker.Add(holeWire); } finally { holeWire.delete(); }
    }
    if (!faceMaker.IsDone()) throw new Error('OpenCascade could not build a planar contour face.');
    const face = faceMaker.Face();
    const vector = new oc.gp_Vec(0, 0, group.z1 - group.z0);
    const prismMaker = new oc.BRepPrimAPI_MakePrism(face, vector, false, true);
    face.delete();
    vector.delete();
    try {
      const shape = prismMaker.Shape();
      const analyzer = new oc.BRepCheck_Analyzer(shape, true, false, true);
      try {
        if (!analyzer.IsValid()) {
          shape.delete();
          throw new Error('OpenCascade rejected an extruded production contour as non-manifold.');
        }
      } finally {
        analyzer.delete();
      }
      return shape;
    } finally {
      prismMaker.delete();
    }
  } finally {
    faceMaker.delete();
  }
}

function shapeVolume(oc, shape) {
  const properties = new oc.GProp_GProps();
  try {
    oc.BRepGProp.VolumeProperties(shape, properties, true, true, false);
    return properties.Mass();
  } finally {
    properties.delete();
  }
}

function shapeBounds(oc, shape) {
  const box = new oc.Bnd_Box();
  try {
    oc.BRepBndLib.AddOptimal(shape, box, false, false);
    if (box.IsVoid() || box.IsOpen()) throw new Error('OpenCascade produced empty or unbounded STEP geometry.');
    return [box.GetXMin(), box.GetYMin(), box.GetZMin(), box.GetXMax(), box.GetYMax(), box.GetZMax()];
  } finally {
    box.delete();
  }
}

function countSolids(oc, shape) {
  const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let count = 0;
  try {
    while (explorer.More()) {
      count += 1;
      explorer.Next();
    }
  } finally {
    explorer.delete();
  }
  return count;
}

function fuseSlotShapes(oc, shapes) {
  if (shapes.length === 1) return shapes[0];
  const argumentsList = new oc.NCollection_List_TopoDS_Shape();
  const toolsList = new oc.NCollection_List_TopoDS_Shape();
  const fuse = new oc.BRepAlgoAPI_Fuse();
  const progress = new oc.Message_ProgressRange();
  try {
    argumentsList.Append(shapes[0]);
    for (let index = 1; index < shapes.length; index += 1) toolsList.Append(shapes[index]);
    fuse.SetArguments(argumentsList);
    fuse.SetTools(toolsList);
    fuse.SetNonDestructive(true);
    fuse.SetCheckInverted(true);
    fuse.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueShift);
    fuse.SetToFillHistory(false);
    fuse.Build(progress);
    if (fuse.HasErrors()) throw new Error('OpenCascade could not fuse touching contour prisms into a material solid.');
    fuse.SimplifyResult(true, true, EPSILON);
    const result = fuse.Shape();
    const analyzer = new oc.BRepCheck_Analyzer(result, true, false, true);
    try {
      if (!analyzer.IsValid()) {
        result.delete();
        throw new Error('OpenCascade produced an invalid fused material solid.');
      }
    } finally {
      analyzer.delete();
    }
    return result;
  } finally {
    progress.delete();
    fuse.delete();
    argumentsList.delete();
    toolsList.delete();
    for (const shape of shapes) shape.delete();
  }
}

function buildGroups(input) {
  const { bounds, columnData } = input;
  const cellCount = bounds.cols * bounds.rows;
  const { offsets, z0, z1, slots } = columnData;
  if (!(offsets instanceof Uint32Array) || offsets.length !== cellCount + 1) throw new Error('STEP column offsets do not match the production grid.');
  const segmentCount = offsets[cellCount];
  if (segmentCount > MAX_SEGMENTS || z0.length !== segmentCount || z1.length !== segmentCount || slots.length !== segmentCount) throw new Error('STEP column segment arrays are inconsistent or exceed the safe browser limit.');
  const groups = new Map();
  let sourceVolume = 0;
  const sourceBounds = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let cell = 0; cell < cellCount; cell += 1) {
    if (offsets[cell] > offsets[cell + 1] || offsets[cell + 1] > segmentCount) throw new Error('STEP column offsets are not monotonic.');
    for (let cursor = offsets[cell]; cursor < offsets[cell + 1]; cursor += 1) {
      const bottom = assertFinite(z0[cursor], 'Segment bottom');
      const top = assertFinite(z1[cursor], 'Segment top');
      const slot = slots[cursor];
      if (top - bottom <= EPSILON) throw new Error('STEP geometry contains a zero-height material segment.');
      const key = `${bottom}|${top}|${slot}`;
      const group = groups.get(key);
      if (group) group.count += 1;
      else groups.set(key, { z0: bottom, z1: top, slot, count: 1, cursor: 0, cells: null });
      sourceVolume += (top - bottom) * input.cell * input.cell;
      const row = Math.floor(cell / bounds.cols), col = cell - row * bounds.cols;
      sourceBounds[0] = Math.min(sourceBounds[0], bounds.minX + col * input.cell);
      sourceBounds[1] = Math.min(sourceBounds[1], bounds.minY + row * input.cell);
      sourceBounds[2] = Math.min(sourceBounds[2], bottom);
      sourceBounds[3] = Math.max(sourceBounds[3], bounds.minX + (col + 1) * input.cell);
      sourceBounds[4] = Math.max(sourceBounds[4], bounds.minY + (row + 1) * input.cell);
      sourceBounds[5] = Math.max(sourceBounds[5], top);
    }
  }
  for (const group of groups.values()) group.cells = new Uint32Array(group.count);
  for (let cell = 0; cell < cellCount; cell += 1) for (let cursor = offsets[cell]; cursor < offsets[cell + 1]; cursor += 1) {
    const group = groups.get(`${z0[cursor]}|${z1[cursor]}|${slots[cursor]}`);
    group.cells[group.cursor++] = cell;
  }
  return {
    groups: [...groups.values()].sort((a, b) => a.slot - b.slot || a.z0 - b.z0 || a.z1 - b.z1),
    sourceVolume,
    sourceBounds,
    segmentCount,
  };
}

function transferSolids(oc, writer, shape) {
  const progress = new oc.Message_ProgressRange();
  const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let count = 0;
  try {
    while (explorer.More()) {
      const solid = explorer.Current();
      try {
        const status = writer.Transfer(solid, oc.STEPControl_StepModelType.STEPControl_ManifoldSolidBrep, true, progress);
        if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error(`OpenCascade STEP transfer failed (${status}).`);
      } finally {
        solid.delete();
      }
      count += 1;
      explorer.Next();
    }
  } finally {
    explorer.delete();
    progress.delete();
  }
  return count;
}

function validateReimport(oc, filename, sourceVolume, sourceBounds, tolerance) {
  const reader = new oc.STEPControl_Reader();
  const progress = new oc.Message_ProgressRange();
  try {
    const readStatus = reader.ReadFile(filename);
    if (readStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error(`OpenCascade could not reopen its STEP output (${readStatus}).`);
    const roots = reader.TransferRoots(progress);
    if (roots < 1 || reader.NbShapes() < 1) throw new Error('The generated STEP file does not contain any transferable solids.');
    const imported = reader.OneShape();
    try {
      const analyzer = new oc.BRepCheck_Analyzer(imported, true, false, true);
      try {
        if (!analyzer.IsValid()) throw new Error('The generated STEP file reopens as invalid B-Rep geometry.');
      } finally {
        analyzer.delete();
      }
      const solidCount = countSolids(oc, imported);
      if (!solidCount) throw new Error('The generated STEP file reopens without a solid body.');
      const importedVolume = shapeVolume(oc, imported);
      if (!Number.isFinite(importedVolume) || Math.abs(importedVolume - sourceVolume) > tolerance) {
        throw new Error(`STEP round-trip volume check failed (${importedVolume.toFixed(3)} vs ${sourceVolume.toFixed(3)} mm³).`);
      }
      const importedBounds = shapeBounds(oc, imported);
      if (importedBounds.some((value, index) => Math.abs(value - sourceBounds[index]) > 1e-5)) {
        throw new Error('STEP round-trip bounds do not match the full-resolution production geometry.');
      }
      return { roots, solidCount, importedVolume, importedBounds };
    } finally {
      imported.delete();
    }
  } finally {
    progress.delete();
    reader.delete();
  }
}

/** Rebuilds sampled production columns as analytic planar B-Rep prisms. No mesh triangles are consumed. */
export async function buildStepDocument(oc, input, onProgress = () => {}) {
  const bounds = input?.bounds || {};
  const cols = Number(bounds.cols), rows = Number(bounds.rows), cell = Number(input?.cell);
  const cellCount = cols * rows;
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows) || cols <= 0 || rows <= 0 || !Number.isSafeInteger(cellCount) || cellCount > MAX_CELLS) throw new Error('STEP production grid is invalid or above the safe browser limit.');
  if (!Number.isFinite(cell) || cell <= 0) throw new Error('STEP production-grid resolution is invalid.');
  assertFinite(bounds.minX, 'Grid minimum X');
  assertFinite(bounds.minY, 'Grid minimum Y');

  onProgress('Tracing full-resolution production contours…');
  const { groups, sourceVolume, sourceBounds, segmentCount } = buildGroups({ ...input, cell });
  if (!groups.length || sourceVolume <= EPSILON) throw new Error('There is no solid production geometry to write as STEP.');
  const occupied = new Uint8Array(cellCount);
  const edgeFlags = new Uint8Array((cols + 1) * (rows + 1));
  const shapesBySlot = new Map();
  let contourCount = 0;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    for (const index of group.cells) occupied[index] = 1;
    const loops = extractLoops(group, occupied, edgeFlags, cols, rows);
    const outers = nestLoops(loops);
    for (const outer of outers) {
      const shape = extrudeContour(oc, outer, group, bounds, cell);
      const shapes = shapesBySlot.get(group.slot) || [];
      shapes.push(shape);
      shapesBySlot.set(group.slot, shapes);
      contourCount += 1;
    }
    for (const index of group.cells) occupied[index] = 0;
    if ((groupIndex + 1) % 4 === 0 || groupIndex + 1 === groups.length) {
      onProgress(`Building OpenCascade B-Rep contours · ${groupIndex + 1}/${groups.length} layers…`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  onProgress('Fusing touching contours into manifold material solids…');
  const slotShapes = [];
  for (const [slot, shapes] of [...shapesBySlot].sort((a, b) => a[0] - b[0])) slotShapes.push({ slot, shape: fuseSlotShapes(oc, shapes) });
  const builtVolume = slotShapes.reduce((sum, item) => sum + shapeVolume(oc, item.shape), 0);
  const tolerance = Math.max(1e-4, sourceVolume * 1e-6);
  if (!Number.isFinite(builtVolume) || Math.abs(builtVolume - sourceVolume) > tolerance) {
    for (const item of slotShapes) item.shape.delete();
    throw new Error(`B-Rep volume check failed (${builtVolume.toFixed(3)} vs ${sourceVolume.toFixed(3)} mm³).`);
  }

  onProgress('Writing millimeter STEP manifold solids…');
  oc.Interface_Static.SetCVal('xstep.cascade.unit', 'MM');
  oc.Interface_Static.SetCVal('write.step.unit', 'MM');
  oc.Interface_Static.SetIVal('write.surfacecurve.mode', 1);
  oc.Interface_Static.SetIVal('write.precision.mode', 0);
  oc.Interface_Static.SetIVal('write.step.schema', 5);
  const writer = new oc.STEPControl_Writer();
  const filename = `/medalforge-${Date.now().toString(36)}.step`;
  let exportedSolidCount = 0;
  try {
    for (const item of slotShapes) exportedSolidCount += transferSolids(oc, writer, item.shape);
    if (!exportedSolidCount) throw new Error('OpenCascade did not find a solid body to export.');
    const writeStatus = writer.Write(filename);
    if (writeStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error(`OpenCascade STEP writer failed (${writeStatus}).`);
  } finally {
    writer.delete();
    for (const item of slotShapes) item.shape.delete();
  }

  onProgress('Reopening STEP and validating solids and volume…');
  const roundTrip = validateReimport(oc, filename, sourceVolume, sourceBounds, tolerance);
  const bytes = Uint8Array.from(oc.FS.readFile(filename));
  oc.FS.unlink(filename);
  return {
    bytes,
    stats: {
      cell,
      segmentCount,
      layerGroupCount: groups.length,
      contourCount,
      materialCount: slotShapes.length,
      solidCount: roundTrip.solidCount,
      sourceVolumeMm3: sourceVolume,
      importedVolumeMm3: roundTrip.importedVolume,
      sourceBounds,
      importedBounds: roundTrip.importedBounds,
    },
  };
}
