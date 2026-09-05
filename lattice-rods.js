/** Exact polygonal rod solids. Coordinates and widths use the caller's model units. */
const TAU = Math.PI * 2;
const CIRCLE_SIDES = { draft: 12, balanced: 24, fine: 40 };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => a.map((value, axis) => value - b[axis]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = vector => { const length = Math.hypot(...vector); return vector.map(value => value / length); };
const isPoint = point => point?.length === 3 && Array.from(point).every(Number.isFinite);
const positive = (value, name) => { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be a positive finite number.`); return number; };
const addScaled = (point, vector, amount) => point.map((value, axis) => value + vector[axis] * amount);

export function normalizeRodOptions(input = {}) {
  const thickness = positive(input.thickness ?? 1.5, 'Rod width');
  const endThickness = positive(input.endThickness ?? input.widthEnd ?? thickness, 'End rod width');
  const rodAspect = positive(input.rodAspect ?? 1, 'Rectangle aspect ratio');
  const rodProfile = ['circle', 'rectangle', 'polygon'].includes(input.rodProfile) ? input.rodProfile : 'circle';
  const quality = Object.hasOwn(CIRCLE_SIDES, input.quality) ? input.quality : 'balanced';
  const rawSides = Number(input.rodSides ?? 6), rawRotation = Number(input.rodRotation ?? 0);
  if (!Number.isFinite(rawSides) || !Number.isFinite(rawRotation)) throw new Error('Profile sides and rotation must be finite numbers.');
  return { thickness, endThickness, rodProfile, rodAspect, rodSides: Math.max(3, Math.min(12, Math.round(rawSides))),
    rodRotation: (rawRotation % 360 + 360) % 360, quality,
    sides: rodProfile === 'circle' ? CIRCLE_SIDES[quality] : rodProfile === 'rectangle' ? 4 : Math.max(3, Math.min(12, Math.round(rawSides))) };
}

function rotate(vector, axis, angle) {
  const cosine = Math.cos(angle), sine = Math.sin(angle), perpendicular = cross(axis, vector), projection = dot(axis, vector) * (1 - cosine);
  return vector.map((value, dimension) => value * cosine + perpendicular[dimension] * sine + axis[dimension] * projection);
}

/** Right-handed section frame. Surface normal sets rectangle height, and x is its width. */
export function rodFrame(a, b, { normal, previousFrame } = {}) {
  if (!isPoint(a) || !isPoint(b)) throw new Error('Rod endpoints must be finite XYZ points.');
  const delta = sub(b, a), length = Math.hypot(...delta);
  if (!(length > 0)) throw new Error('A rod needs two different endpoints.');
  const tangent = delta.map(value => value / length);
  let y;
  if (normal !== undefined) {
    if (!isPoint(normal)) throw new Error('Surface normals must be finite XYZ vectors.');
    const projected = normal.map((value, axis) => value - tangent[axis] * dot(normal, tangent));
    if (Math.hypot(...projected) > Math.hypot(...normal) * 1e-10) y = unit(projected);
  }
  if (!y && previousFrame && isPoint(previousFrame.tangent) && isPoint(previousFrame.y)) {
    const oldTangent = unit(previousFrame.tangent), axis = cross(oldTangent, tangent), sine = Math.hypot(...axis), cosine = Math.max(-1, Math.min(1, dot(oldTangent, tangent)));
    let transported = [...previousFrame.y];
    if (sine > 1e-10) transported = rotate(transported, axis.map(value => value / sine), Math.atan2(sine, cosine));
    else if (cosine < 0) transported = rotate(transported, unit(previousFrame.y), Math.PI);
    const projected = transported.map((value, dimension) => value - tangent[dimension] * dot(transported, tangent));
    if (Math.hypot(...projected) > 1e-10) y = unit(projected);
  }
  if (!y) {
    const reference = Math.abs(tangent[2]) < .9 ? [0, 0, 1] : [0, 1, 0];
    y = unit(reference.map((value, axis) => value - tangent[axis] * dot(reference, tangent)));
  }
  const x = unit(cross(y, tangent));
  return { tangent, x, y: unit(cross(tangent, x)) };
}

/** A CCW section at its original endpoint, including profile rotation but no axial overlap. */
export function rodProfileRing(center, frame, input = {}, width = input.thickness ?? 1.5) {
  if (!isPoint(center) || !frame || !isPoint(frame.x) || !isPoint(frame.y)) throw new Error('A profile needs a finite point and a local frame.');
  const options = normalizeRodOptions(input), diameter = positive(width, 'Profile width');
  const angle = options.rodRotation * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
  const profile = options.rodProfile === 'rectangle'
    ? [[-.5, -.5 * options.rodAspect], [.5, -.5 * options.rodAspect], [.5, .5 * options.rodAspect], [-.5, .5 * options.rodAspect]]
    : Array.from({ length: options.sides }, (_, index) => [Math.cos(index * TAU / options.sides) / 2, Math.sin(index * TAU / options.sides) / 2]);
  return profile.map(([px, py]) => {
    const x = (px * cosine - py * sine) * diameter, y = (px * sine + py * cosine) * diameter;
    return center.map((value, axis) => value + frame.x[axis] * x + frame.y[axis] * y);
  });
}

function meshOf(points, triangles) {
  const vertProperties = new Float32Array(points.length * 3);
  points.forEach((point, index) => {
    if (!isPoint(point)) throw new Error('Rod construction produced an invalid coordinate.');
    vertProperties.set(point, index * 3);
  });
  if (!vertProperties.every(Number.isFinite)) throw new Error('Rod coordinates exceed STL precision. Resize or recenter the source.');
  return { numProp: 3, vertProperties, triVerts: Uint32Array.from(triangles) };
}

/** Closed, consistently wound prism/frustum. Straight rods have truly constant profile sections. */
export function createRodMesh(a, b, input = {}, { normal, frame: suppliedFrame, previousFrame, endOverlap } = {}) {
  const options = normalizeRodOptions(input), frame = suppliedFrame || rodFrame(a, b, { normal, previousFrame });
  if (!isPoint(a) || !isPoint(b) || !isPoint(frame.tangent) || !isPoint(frame.x) || !isPoint(frame.y)) throw new Error('A rod needs valid endpoints and a local frame.');
  const length = Math.hypot(...sub(b, a));
  if (!(length > 0)) throw new Error('A rod needs two different endpoints.');
  const defaultOverlap = Math.min(length * .1, Math.min(options.thickness, options.endThickness) * .035);
  const overlap = endOverlap === undefined ? [defaultOverlap, defaultOverlap] : Array.isArray(endOverlap) ? [...endOverlap] : [endOverlap, endOverlap];
  if (overlap.length !== 2 || !overlap.every(value => Number.isFinite(value) && value >= 0)) throw new Error('Rod end overlap must contain nonnegative finite distances.');
  const widthSlope = (options.endThickness - options.thickness) / length;
  if (widthSlope > 0) overlap[0] = Math.min(overlap[0], options.thickness * .45 / widthSlope);
  if (widthSlope < 0) overlap[1] = Math.min(overlap[1], options.endThickness * .45 / -widthSlope);
  const startRing = rodProfileRing(a, frame, options, options.thickness), endRing = rodProfileRing(b, frame, options, options.endThickness);
  const start = addScaled(a, frame.tangent, -overlap[0]), end = addScaled(b, frame.tangent, overlap[1]);
  const capStartRing = rodProfileRing(start, frame, options, options.thickness - widthSlope * overlap[0]);
  const capEndRing = rodProfileRing(end, frame, options, options.endThickness + widthSlope * overlap[1]);
  const count = startRing.length, points = [...capStartRing, ...capEndRing, start, end], indices = [];
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    indices.push(index, next, count + next, index, count + next, count + index);
    indices.push(count * 2, next, index, count * 2 + 1, count + index, count + next);
  }
  return { ...meshOf(points, indices), frame, startRing, endRing, capStartRing, capEndRing, length, overlap,
    thickness: options.thickness, endThickness: options.endThickness };
}

function convexHull(inputPoints, minimumDepth, extruded = false) {
  if (!inputPoints.length || !inputPoints.every(isPoint)) throw new Error('Junction rings must contain finite XYZ points.');
  // Hull topology must use the same coordinates that will reach Manifold.Mesh.
  // Otherwise distinct double-precision vertices can collapse in Float32 later.
  inputPoints = inputPoints.map(point => point.map(Math.fround));
  if (!inputPoints.every(isPoint)) throw new Error('Junction coordinates exceed STL precision. Resize or recenter the source.');
  const min = [0, 1, 2].map(axis => Math.min(...inputPoints.map(point => point[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...inputPoints.map(point => point[axis])));
  const span = Math.max(...max.map((value, axis) => value - min[axis]));
  if (!(span > 0)) throw new Error('Junction rings must have measurable size.');
  const unique = new Map();
  for (const point of inputPoints) {
    const key = point.map((value, axis) => Math.round((value - min[axis]) / span * 1e9)).join(',');
    if (!unique.has(key)) unique.set(key, [...point]);
  }
  const world = [...unique.values()], points = world.map(point => point.map((value, axis) => (value - min[axis]) / span));
  if (points.length < 3) throw new Error('Junction rings need at least three distinct points.');
  const first = 0;
  let second = 1, third = -1, fourth = -1, largest = -1;
  for (let index = 1; index < points.length; index++) { const value = Math.hypot(...sub(points[index], points[first])); if (value > largest) { largest = value; second = index; } }
  const edge = sub(points[second], points[first]);
  largest = -1;
  for (let index = 0; index < points.length; index++) { const value = Math.hypot(...cross(edge, sub(points[index], points[first]))); if (value > largest) { largest = value; third = index; } }
  if (!(largest > 1e-10)) throw new Error('Junction rings must not be collinear.');
  const planeNormal = unit(cross(edge, sub(points[third], points[first])));
  largest = -1;
  for (let index = 0; index < points.length; index++) { const value = Math.abs(dot(planeNormal, sub(points[index], points[first]))); if (value > largest) { largest = value; fourth = index; } }
  if (largest < 1e-9) {
    // A straight or terminal joint is a planar ring. Give it only enough axial
    // thickness to overlap its rods; do not introduce a spherical enlargement.
    if (extruded) throw new Error('This junction is too thin for Float32 coordinates. Recenter or enlarge the source model.');
    const halfDepth = Math.max(minimumDepth, span * 1e-6) / 2;
    return convexHull(world.flatMap(point => [addScaled(point, planeNormal, -halfDepth), addScaled(point, planeNormal, halfDepth)]), minimumDepth, true);
  }
  const inside = [0, 1, 2].map(axis => (points[first][axis] + points[second][axis] + points[third][axis] + points[fourth][axis]) / 4);
  const face = (a, b, c) => {
    let normal = cross(sub(points[b], points[a]), sub(points[c], points[a]));
    if (dot(normal, sub(inside, points[a])) > 0) { [b, c] = [c, b]; normal = normal.map(value => -value); }
    return { a, b, c, normal, length: Math.hypot(...normal) };
  };
  let faces = [face(first, second, third), face(first, fourth, second), face(second, fourth, third), face(third, fourth, first)];
  const initial = new Set([first, second, third, fourth]);
  for (let index = 0; index < points.length; index++) {
    if (initial.has(index)) continue;
    const visible = [], retained = [];
    for (const item of faces) (dot(item.normal, sub(points[index], points[item.a])) > item.length * 1e-9 ? visible : retained).push(item);
    if (!visible.length) continue;
    const horizon = new Map();
    for (const item of visible) for (const [a, b] of [[item.a, item.b], [item.b, item.c], [item.c, item.a]]) {
      const key = Math.min(a, b) * points.length + Math.max(a, b);
      if (horizon.has(key)) horizon.delete(key); else horizon.set(key, [a, b]);
    }
    for (const [a, b] of horizon.values()) {
      const added = face(a, b, index);
      if (added.length > 1e-14) retained.push(added);
    }
    faces = retained;
  }
  const used = new Map(), vertices = [], indices = [];
  for (const item of faces) for (const id of [item.a, item.b, item.c]) {
    if (!used.has(id)) { used.set(id, vertices.length); vertices.push(world[id]); }
    indices.push(used.get(id));
  }
  return meshOf(vertices, indices);
}

function sphereJoint(center, radius, quality) {
  const sides = CIRCLE_SIDES[quality], rows = quality === 'fine' ? 10 : quality === 'draft' ? 4 : 6;
  const points = [addScaled(center, [0, 0, 1], radius)], triangles = [];
  for (let row = 1; row < rows; row++) for (let side = 0; side < sides; side++) {
    const polar = row * Math.PI / rows, angle = side * TAU / sides;
    points.push([center[0] + radius * Math.sin(polar) * Math.cos(angle), center[1] + radius * Math.sin(polar) * Math.sin(angle), center[2] + radius * Math.cos(polar)]);
  }
  const south = points.length; points.push(addScaled(center, [0, 0, -1], radius));
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides;
    triangles.push(0, 1 + side, 1 + next);
    for (let row = 0; row < rows - 2; row++) {
      const a = 1 + row * sides + side, b = 1 + (row + 1) * sides + side, c = 1 + (row + 1) * sides + next, d = 1 + row * sides + next;
      triangles.push(a, b, c, a, c, d);
    }
    triangles.push(south, 1 + (rows - 2) * sides + next, 1 + (rows - 2) * sides + side);
  }
  return meshOf(points, triangles);
}

/** Compact junction envelope. Incident original-endpoint rings are preferable to enlarged balls. */
export function createJointMesh(point, input = {}, { rings, frame, radius } = {}) {
  if (!isPoint(point)) throw new Error('Junctions need a finite XYZ point.');
  const options = normalizeRodOptions(input);
  if (rings?.length) {
    const points = isPoint(rings[0]) ? rings : rings.flat();
    if (points.length > 4096) throw new Error('A junction has too many profile samples. Simplify its incoming branches.');
    return convexHull(points, Math.min(options.thickness, options.thickness * options.rodAspect) * .06);
  }
  if (options.rodProfile === 'circle') return sphereJoint(point, radius === undefined ? options.thickness / 2 : positive(radius, 'Joint radius'), options.quality);
  const localFrame = frame || { x: [1, 0, 0], y: [0, 1, 0], tangent: [0, 0, 1] };
  return convexHull(rodProfileRing(point, localFrame, options), Math.min(options.thickness, options.thickness * options.rodAspect) * .06);
}

/** Piecewise constant sections with transported frames; overlapping closed pieces are ready for union. */
export function createPolylineRodMeshes(inputPoints, input = {}, { normals, closed = false, widths = input.widths, buildJoints = true } = {}) {
  if (!Array.isArray(inputPoints) || inputPoints.length < 2 || !inputPoints.every(isPoint)) throw new Error('A rod path needs at least two finite XYZ points.');
  const options = normalizeRodOptions(input), points = inputPoints.map(point => [...point]);
  if (normals && (normals.length !== points.length || !normals.every(isPoint))) throw new Error('Surface normals must match the path points.');
  let pointNormals = normals?.map(normal => [...normal]);
  if (widths && (widths.length !== points.length || !Array.from(widths).every(value => Number.isFinite(value) && value > 0))) throw new Error('Rod widths must be positive and match the path points.');
  let pointWidths = widths ? Array.from(widths) : null;
  const repeatedEnd = Math.hypot(...sub(points[0], points.at(-1))) === 0;
  closed ||= repeatedEnd;
  if (closed && !repeatedEnd) {
    points.push([...points[0]]);
    if (pointNormals) pointNormals.push([...pointNormals[0]]);
    if (pointWidths) pointWidths.push(pointWidths[0]);
  }
  const lengths = points.slice(1).map((point, index) => Math.hypot(...sub(point, points[index])));
  if (lengths.some(length => !(length > 0))) throw new Error('A rod path contains consecutive duplicate points.');
  if (closed && points.length < 4) throw new Error('A closed rod path needs at least three different points.');
  if (!pointWidths) {
    const total = lengths.reduce((sum, length) => sum + length, 0);
    let travelled = 0;
    pointWidths = points.map((_, index) => { if (index) travelled += lengths[index - 1]; return options.thickness + (options.endThickness - options.thickness) * travelled / total; });
    if (closed) pointWidths[pointWidths.length - 1] = pointWidths[0];
  }
  const rods = [], frames = [];
  for (let index = 0; index < points.length - 1; index++) {
    let normal;
    if (pointNormals) {
      normal = pointNormals[index].map((value, axis) => value + pointNormals[index + 1][axis]);
      if (Math.hypot(...normal) < 1e-10) normal = pointNormals[index];
    }
    const frame = rodFrame(points[index], points[index + 1], { normal, previousFrame: frames.at(-1) });
    frames.push(frame);
    rods.push(createRodMesh(points[index], points[index + 1], { ...options, thickness: pointWidths[index], endThickness: pointWidths[index + 1] }, { frame }));
  }
  const junctions = [];
  for (let index = 0; buildJoints && index < points.length - (closed ? 1 : 0); index++) {
    const rings = [];
    if (index) rings.push(rods[index - 1].endRing); else if (closed) rings.push(rods.at(-1).endRing);
    if (index < rods.length) rings.push(rods[index].startRing);
    if (rings.length < 2) continue;
    junctions.push({ point: [...points[index]], pointIndex: index, rings, width: pointWidths[index],
      mesh: createJointMesh(points[index], { ...options, thickness: pointWidths[index], endThickness: pointWidths[index] }, { rings }) });
  }
  return { rods, joints: junctions.map(junction => junction.mesh), junctions, frames, points, widths: pointWidths, closed };
}

function prepareSweep(inputPoints, input, { normals, closed = false, widths = input.widths } = {}) {
  if (!Array.isArray(inputPoints) || inputPoints.length < 2 || !inputPoints.every(isPoint)) throw new Error('A rod path needs at least two finite XYZ points.');
  const options = normalizeRodOptions(input), points = inputPoints.map(point => [...point]);
  if (normals && (normals.length !== points.length || !normals.every(isPoint))) throw new Error('Surface normals must match the path points.');
  let pointNormals = normals?.map(normal => [...normal]);
  if (widths && (widths.length !== points.length || !Array.from(widths).every(value => Number.isFinite(value) && value > 0))) throw new Error('Rod widths must be positive and match the path points.');
  let pointWidths = widths ? Array.from(widths) : null;
  if (Math.hypot(...sub(points[0], points.at(-1))) === 0) {
    closed = true; points.pop(); pointNormals?.pop(); pointWidths?.pop();
  }
  if (points.length < (closed ? 3 : 2)) throw new Error('A rod path needs distinct points and a closed loop needs at least three.');
  const segmentCount = closed ? points.length : points.length - 1;
  const directions = [], lengths = [];
  for (let index = 0; index < segmentCount; index++) {
    const delta = sub(points[(index + 1) % points.length], points[index]), length = Math.hypot(...delta);
    if (!(length > 0)) throw new Error('A rod path contains consecutive duplicate points.');
    lengths.push(length); directions.push(delta.map(value => value / length));
  }
  const totalLength = lengths.reduce((sum, length) => sum + length, 0), distances = [0];
  for (let index = 1; index < points.length; index++) distances.push(distances[index - 1] + lengths[index - 1]);
  if (!pointWidths) pointWidths = distances.map(distance => options.thickness + (options.endThickness - options.thickness) * distance / totalLength);
  if (!closed && points.length === 2) {
    const normal = pointNormals ? pointNormals[0].map((value, axis) => value + pointNormals[1][axis]) : undefined;
    const frame = rodFrame(points[0], points[1], { normal });
    return { options, points, pointWidths, frames: [frame, frame], lengths, directions, totalLength, closed };
  }
  const frames = [];
  for (let index = 0; index < points.length; index++) {
    let tangent;
    if (!closed && index === 0) tangent = directions[0];
    else if (!closed && index === points.length - 1) tangent = directions.at(-1);
    else {
      const before = directions[(index - 1 + directions.length) % directions.length], after = directions[index % directions.length];
      tangent = before.map((value, axis) => value + after[axis]);
      if (Math.hypot(...tangent) < 1e-8) throw new Error('A swept rod path folds directly back onto itself. Simplify that centerline before generating.');
      tangent = unit(tangent);
    }
    frames.push(rodFrame([0, 0, 0], tangent, { normal: pointNormals?.[index], previousFrame: frames.at(-1) }));
  }
  if (closed && !pointNormals) {
    // Distribute parallel-transport holonomy over a spatial loop, avoiding a
    // single twisted seam in non-circular profiles at the closing section.
    const returned = rodFrame([0, 0, 0], frames[0].tangent, { previousFrame: frames.at(-1) });
    const correction = Math.atan2(dot(frames[0].tangent, cross(returned.y, frames[0].y)), dot(returned.y, frames[0].y));
    for (let index = 1; index < frames.length; index++) {
      const angle = correction * distances[index] / totalLength;
      frames[index].x = rotate(frames[index].x, frames[index].tangent, angle);
      frames[index].y = rotate(frames[index].y, frames[index].tangent, angle);
    }
  }
  return { options, points, pointWidths, frames, lengths, directions, totalLength, closed };
}

/**
 * Detect local swept-section folding before union. This is a linear-time local
 * guard, not a certificate against distant parts of a path crossing each other.
 * Supplying surface normals avoids unnecessary fallback for tall profiles whose
 * height is perpendicular to the bend. Widths and normals follow input nodes.
 */
export function pathNeedsSegmentUnion(inputPoints, input = {}, widths = input.widths, normals = input.normals) {
  let path;
  try { path = prepareSweep(inputPoints, input, { widths, normals, closed: input.closed }); }
  catch (error) { if (/folds directly back/.test(error.message)) return true; throw error; }
  if (!path.closed && path.points.length === 2) return false;
  const rings = path.frames.map((frame, index) => rodProfileRing([0, 0, 0], frame, path.options, path.pointWidths[index]));
  for (let index = 0; index < path.lengths.length; index++) {
    const next = (index + 1) % path.frames.length, direction = path.directions[index];
    const forwardReach = Math.max(...rings[index].map(point => dot(point, direction)));
    const backwardReach = -Math.min(...rings[next].map(point => dot(point, direction)));
    // On a sampled circular bend this becomes profile radius / bend radius.
    // A two-percent margin avoids numerically near-collapsed inner sections.
    if (forwardReach + backwardReach >= path.lengths[index] * .98) return true;
    const transported = rodFrame([0, 0, 0], path.frames[next].tangent, { previousFrame: path.frames[index] });
    if (dot(transported.y, path.frames[next].y) < -.95) return true;
  }
  return false;
}

/** One closed swept solid per path, sharing every internal section instead of boolean-fusing segments. */
export function createSweptRodMesh(inputPoints, input = {}, { normals, closed = false, widths = input.widths, endOverlap } = {}) {
  const path = prepareSweep(inputPoints, input, { normals, closed, widths });
  const { options, points, pointWidths, frames, lengths, totalLength } = path;
  closed = path.closed;
  if (!closed && points.length === 2) {
    const mesh = createRodMesh(points[0], points[1], { ...options, thickness: pointWidths[0], endThickness: pointWidths[1] }, { frame: frames[0], endOverlap });
    return { ...mesh, frames, points, widths: pointWidths, closed };
  }
  const sections = points.map((point, index) => rodProfileRing(point, frames[index], options, pointWidths[index]));
  const startRing = sections[0], endRing = closed ? sections[0] : sections.at(-1);
  let overlap = [0, 0], capStartRing = startRing, capEndRing = endRing;
  const meshSections = [...sections];
  if (!closed) {
    const requested = endOverlap === undefined ? [Math.min(lengths[0] * .1, pointWidths[0] * .035), Math.min(lengths.at(-1) * .1, pointWidths.at(-1) * .035)]
      : Array.isArray(endOverlap) ? [...endOverlap] : [endOverlap, endOverlap];
    if (requested.length !== 2 || !requested.every(value => Number.isFinite(value) && value >= 0)) throw new Error('Rod end overlap must contain nonnegative finite distances.');
    overlap = requested;
    const startSlope = (pointWidths[1] - pointWidths[0]) / lengths[0], endSlope = (pointWidths.at(-1) - pointWidths.at(-2)) / lengths.at(-1);
    if (startSlope > 0) overlap[0] = Math.min(overlap[0], pointWidths[0] * .45 / startSlope);
    if (endSlope < 0) overlap[1] = Math.min(overlap[1], pointWidths.at(-1) * .45 / -endSlope);
    if (overlap[0] > 0) {
      capStartRing = rodProfileRing(addScaled(points[0], frames[0].tangent, -overlap[0]), frames[0], options, pointWidths[0] - startSlope * overlap[0]);
      meshSections.unshift(capStartRing);
    }
    if (overlap[1] > 0) {
      capEndRing = rodProfileRing(addScaled(points.at(-1), frames.at(-1).tangent, overlap[1]), frames.at(-1), options, pointWidths.at(-1) + endSlope * overlap[1]);
      meshSections.push(capEndRing);
    }
  }
  const sides = options.sides, vertices = meshSections.flat(), indices = [];
  const links = closed ? meshSections.length : meshSections.length - 1;
  for (let section = 0; section < links; section++) {
    const nextSection = (section + 1) % meshSections.length;
    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides, a = section * sides + side, b = section * sides + next, c = nextSection * sides + next, d = nextSection * sides + side;
      indices.push(a, b, c, a, c, d);
    }
  }
  if (!closed) {
    const start = vertices.length, end = start + 1, last = (meshSections.length - 1) * sides;
    vertices.push(addScaled(points[0], frames[0].tangent, -overlap[0]), addScaled(points.at(-1), frames.at(-1).tangent, overlap[1]));
    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides;
      indices.push(start, next, side, end, last + side, last + next);
    }
  }
  return { ...meshOf(vertices, indices), startRing, endRing, capStartRing, capEndRing, frames, points, widths: pointWidths,
    length: totalLength, overlap, closed, thickness: pointWidths[0], endThickness: closed ? pointWidths[0] : pointWidths.at(-1) };
}
