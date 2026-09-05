/** Browser-local, deterministic, volumetric Voronoi meshing. Units are millimetres.
 * A Voronoi strut is an edge shared by three or more cells. It is deliberately
 * not a Delaunay connection between seed points. All output is clipped against
 * the uploaded solid by an even/odd inside test, including nested cavities.
 */

const QUALITY = {
  draft: { nodes: 200000, samples: 2, sites: 1600, shapeSamples: 64, minimumShapeSamples: 16, cellSamples: 6 },
  balanced: { nodes: 750000, samples: 3, sites: 2600, shapeSamples: 112, minimumShapeSamples: 40, cellSamples: 9 },
  fine: { nodes: 2200000, samples: 4, sites: 3600, shapeSamples: 160, minimumShapeSamples: 64, cellSamples: 12 },
};
const MAX_SOURCE_TRIANGLES = 350000;
const MAX_OUTPUT_TRIANGLES = 1500000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const number = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length2 = a => dot(a, a);

export function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let d = 0; d < 3; d++) {
    if (!Number.isFinite(positions[i + d])) throw new Error('The STL contains a non-finite coordinate.');
    min[d] = Math.min(min[d], positions[i + d]); max[d] = Math.max(max[d], positions[i + d]);
  }
  return { min, max, size: max.map((v, i) => v - min[i]) };
}

function triangleVolume(a, b, c, origin = [0, 0, 0]) {
  return dot(sub(a, origin), cross(sub(b, origin), sub(c, origin))) / 6;
}

export function inspectMesh(positions, { clean = false } = {}) {
  const exact=inspectMeshPass(positions,{clean});
  // Distinct Float32 coordinates are distinct STL vertices. In particular,
  // legitimate Boolean slivers must not be collapsed by a global tolerance.
  // A tolerant weld is a repair fallback for an already-open imported STL.
  if(clean && exact.stats.boundaryEdges>0 && exact.stats.nonManifoldEdges===0) {
    const tolerance=Math.hypot(...exact.bounds.size)*1e-8;
    let repaired;
    try {repaired=inspectMeshPass(positions,{clean,tolerance});}
    catch {return exact;} // An unsuccessful repair must not replace the original diagnostics.
    if(repaired.stats.boundaryEdges<exact.stats.boundaryEdges && repaired.stats.nonManifoldEdges===0 && repaired.stats.inconsistentWindingEdges<=exact.stats.inconsistentWindingEdges) {
      repaired.stats.tolerantWeldTolerance=tolerance;
      repaired.stats.repairedBoundaryEdges=exact.stats.boundaryEdges-repaired.stats.boundaryEdges;
      return repaired;
    }
  }
  return exact;
}

function inspectMeshPass(positions, { clean = false, tolerance = 0 } = {}) {
  if (!positions.length || positions.length % 9) throw new Error('The STL does not contain complete triangles.');
  const initialBounds = boundsOf(positions);
  const diagonal = Math.hypot(...initialBounds.size);
  if (!(diagonal > 0)) throw new Error('The STL has no measurable size.');
  const vertexMap = new Map(), points = [], indices = [], faces = clean ? new Set() : null;
  let degenerateTriangles = 0, duplicateTriangles = 0;
  for (let t = 0; t < positions.length; t += 9) {
    const ids = [];
    for (let c = 0; c < 9; c += 3) {
      const p = [positions[t + c], positions[t + c + 1], positions[t + c + 2]];
      const key = tolerance>0?p.map((v, d) => Math.round((v - initialBounds.min[d]) / tolerance)).join(','):p.join(',');
      let id = vertexMap.get(key);
      if (id === undefined) { id = points.length; vertexMap.set(key, id); points.push(p); }
      ids.push(id);
    }
    if (new Set(ids).size < 3 || length2(cross(sub(points[ids[1]], points[ids[0]]), sub(points[ids[2]], points[ids[0]]))) === 0) {
      degenerateTriangles++; continue;
    }
    if (faces) {
      const key = [...ids].sort((a, b) => a - b).join(',');
      if (faces.has(key)) { duplicateTriangles++; continue; }
      faces.add(key);
    }
    indices.push(...ids);
  }
  if (!indices.length) throw new Error('The STL only contains degenerate triangles.');
  const stats = meshStatistics(points, indices);
  stats.degenerateTriangles = degenerateTriangles;
  stats.duplicateTriangles = duplicateTriangles;
  const output = clean ? unpack(points, indices) : positions;
  return { positions: output, bounds: boundsOf(output), stats };
}

export function meshStatistics(points, indices) {
  const edges = new Map(), parents = new Int32Array(points.length);
  for (let i = 0; i < parents.length; i++) parents[i] = i;
  const find = n => { while (parents[n] !== n) { parents[n] = parents[parents[n]]; n = parents[n]; } return n; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parents[b] = a; };
  const origin = points[indices[0]], componentVolumes = new Map(), componentTriangles = new Map();
  let signedVolume = 0, surfaceAreaMm2 = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    join(a, b); join(a, c);
    signedVolume += triangleVolume(points[a], points[b], points[c], origin);
    surfaceAreaMm2 += Math.sqrt(length2(cross(sub(points[b], points[a]), sub(points[c], points[a])))) / 2;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = Math.min(u, v) * points.length + Math.max(u, v);
      const entry = edges.get(key);
      if (entry) { entry.count++; entry.orientation += u < v ? 1 : -1; }
      else edges.set(key, { count: 1, orientation: u < v ? 1 : -1 });
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0, inconsistentWindingEdges = 0;
  for (const e of edges.values()) {
    if (e.count === 1) boundaryEdges++;
    if (e.count > 2) nonManifoldEdges++;
    if (e.count === 2 && e.orientation !== 0) inconsistentWindingEdges++;
  }
  for (let i = 0; i < indices.length; i += 3) {
    const root = find(indices[i]);
    componentTriangles.set(root, (componentTriangles.get(root) || 0) + 1);
    componentVolumes.set(root, (componentVolumes.get(root) || 0) + triangleVolume(points[indices[i]], points[indices[i + 1]], points[indices[i + 2]], origin));
  }
  return {
    triangles: indices.length / 3, vertices: new Set(indices).size,
    volumeMm3: Math.abs(signedVolume), surfaceAreaMm2, boundaryEdges, nonManifoldEdges,
    inconsistentWindingEdges, watertight: boundaryEdges === 0 && nonManifoldEdges === 0,
    components: [...componentVolumes.values()].filter(volume => volume > 0).length || componentTriangles.size,
    surfaceComponents: componentTriangles.size,
    cavityComponents: [...componentVolumes.values()].filter(volume => volume < 0).length,
  };
}

function unpack(points, indices) {
  const output = new Float32Array(indices.length * 3);
  let j = 0;
  for (const id of indices) { const p = points[id]; output[j++] = p[0]; output[j++] = p[1]; output[j++] = p[2]; }
  return output;
}

export function parseSTL(input, { unitScale = 1 } = {}) {
  if (!(Number.isFinite(unitScale) && unitScale > 0 && unitScale <= 10000)) throw new Error('Choose a valid positive STL unit scale.');
  const buffer = input instanceof ArrayBuffer ? input : ArrayBuffer.isView(input) ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) : null;
  if (!buffer) throw new Error('Upload an ASCII or binary STL file.');
  if (buffer.byteLength > 220 * 1024 * 1024) throw new Error('This STL is too large for browser meshing. Export a mesh below 350,000 triangles.');
  let positions, format;
  const view = new DataView(buffer);
  const count = buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const binary = count > 0 && 84 + count * 50 <= buffer.byteLength;
  if (binary) {
    if (count > MAX_SOURCE_TRIANGLES) throw new Error(`The STL has ${count.toLocaleString()} triangles. Simplify it to at most ${MAX_SOURCE_TRIANGLES.toLocaleString()} for browser meshing.`);
    positions = new Float32Array(count * 9);
    for (let t = 0; t < count; t++) for (let c = 0; c < 9; c++) positions[t * 9 + c] = view.getFloat32(84 + t * 50 + 12 + c * 4, true) * unitScale;
    format = 'binary';
  } else {
    const text = new TextDecoder().decode(buffer);
    if (!/^\s*solid\b/i.test(text) || !/\bfacet\s+normal\b/i.test(text)) throw new Error('This is not a readable ASCII or binary STL file.');
    const coordinates = [], pattern = /\bvertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/gi;
    let match;
    while ((match = pattern.exec(text))) {
      coordinates.push(Number(match[1]) * unitScale, Number(match[2]) * unitScale, Number(match[3]) * unitScale);
      if (coordinates.length / 9 > MAX_SOURCE_TRIANGLES) throw new Error('Simplify this STL to at most 350,000 triangles for browser meshing.');
    }
    positions = Float32Array.from(coordinates); format = 'ascii';
  }
  const mesh = inspectMesh(positions, { clean: true });
  mesh.stats.format = format; mesh.stats.unitScale = unitScale;
  mesh.warnings = [];
  if (mesh.stats.degenerateTriangles) mesh.warnings.push(`Removed ${mesh.stats.degenerateTriangles} zero-area triangles.`);
  if (mesh.stats.duplicateTriangles) mesh.warnings.push(`Removed ${mesh.stats.duplicateTriangles} duplicate triangles.`);
  if (mesh.stats.tolerantWeldTolerance) mesh.warnings.push(`Repaired ${mesh.stats.repairedBoundaryEdges} nearly coincident open edges using a ${mesh.stats.tolerantWeldTolerance.toPrecision(3)} mm weld tolerance.`);
  if (!mesh.stats.watertight) mesh.warnings.push(`Source is not a closed manifold (${mesh.stats.boundaryEdges} open edges, ${mesh.stats.nonManifoldEdges} non-manifold edges). Repair the STL before generating an internal lattice.`);
  if (mesh.stats.inconsistentWindingEdges) mesh.warnings.push('Source triangle orientation is inconsistent. Inside/outside uses even–odd parity; the source signed volume may be inaccurate.');
  if (mesh.stats.triangles > 100000) mesh.warnings.push('This detailed STL may take longer to sample. A simplified source mesh is faster.');
  return mesh;
}

export function encodeBinarySTL(positions) {
  if (!(positions?.length > 0) || positions.length % 9) throw new Error('Generate a non-empty triangle mesh before exporting STL.');
  const count = positions.length / 9, buffer = new ArrayBuffer(84 + count * 50), view = new DataView(buffer);
  const header = new TextEncoder().encode('PrintForge | volumetric Voronoi lattice | millimetres');
  new Uint8Array(buffer, 0, header.length).set(header); view.setUint32(80, count, true);
  for (let t = 0; t < count; t++) {
    const k = t * 9, offset = 84 + t * 50;
    const a = [positions[k], positions[k + 1], positions[k + 2]], b = [positions[k + 3], positions[k + 4], positions[k + 5]], c = [positions[k + 6], positions[k + 7], positions[k + 8]];
    const normal = cross(sub(b, a), sub(c, a)), magnitude = Math.sqrt(length2(normal)) || 1;
    for (let d = 0; d < 3; d++) view.setFloat32(offset + d * 4, normal[d] / magnitude, true);
    for (let d = 0; d < 9; d++) {
      if (!Number.isFinite(positions[k + d])) throw new Error('Cannot export non-finite mesh coordinates.');
      view.setFloat32(offset + 12 + d * 4, positions[k + d], true);
    }
  }
  return buffer;
}

export function createDemoMesh(kind = 'sphere') {
  const triangles = [];
  const add = (a, b, c) => triangles.push(...a, ...b, ...c);
  if (kind === 'box' || kind === 'cube') {
    const p = [[-16,-16,-16],[16,-16,-16],[16,16,-16],[-16,16,-16],[-16,-16,16],[16,-16,16],[16,16,16],[-16,16,16]];
    for (const f of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]]) { add(p[f[0]], p[f[1]], p[f[2]]); add(p[f[0]], p[f[2]], p[f[3]]); }
  } else if (kind === 'torus') {
    const point = (i, j) => { const a = i * Math.PI * 2 / 64, b = j * Math.PI * 2 / 24; return [(14 + 6 * Math.cos(b)) * Math.cos(a), (14 + 6 * Math.cos(b)) * Math.sin(a), 6 * Math.sin(b)]; };
    for (let i = 0; i < 64; i++) for (let j = 0; j < 24; j++) { const a = point(i,j), b = point(i+1,j), c = point(i+1,j+1), d = point(i,j+1); add(a,b,c); add(a,c,d); }
  } else if (kind === 'cylinder') {
    const point = (i, z) => [18 * Math.cos(i * Math.PI / 32), 18 * Math.sin(i * Math.PI / 32), z];
    for (let i = 0; i < 64; i++) { const a = point(i,-12), b = point(i+1,-12), c = point(i+1,12), d = point(i,12); add(a,b,c); add(a,c,d); add([0,0,-12],b,a); add([0,0,12],d,c); }
  } else {
    const p = [[20,0,0],[-20,0,0],[0,20,0],[0,-20,0],[0,0,20],[0,0,-20]];
    const midpoint = (a,b) => { const m = a.map((v,d) => v+b[d]); const l = Math.hypot(...m); return m.map(v => v * 20/l); };
    const subdivide = (a,b,c,depth) => {
      if (!depth) { add(a,b,c); return; }
      const ab = midpoint(a,b), bc = midpoint(b,c), ca = midpoint(c,a);
      subdivide(a,ab,ca,depth-1); subdivide(ab,b,bc,depth-1); subdivide(ca,bc,c,depth-1); subdivide(ab,bc,ca,depth-1);
    };
    for (const f of [[0,2,4],[2,1,4],[1,3,4],[3,0,4],[2,0,5],[1,2,5],[3,1,5],[0,3,5]]) subdivide(p[f[0]],p[f[1]],p[f[2]],4);
  }
  const mesh = inspectMesh(Float32Array.from(triangles), { clean: true });
  mesh.warnings = []; mesh.stats.format = 'demo'; return mesh;
}

export function normalizeOptions(input = {}, bounds) {
  const quality = QUALITY[input.quality] ? input.quality : 'balanced';
  const span = Math.max(...(bounds?.size || [40,40,40]));
  // STL coordinates have no inherent unit. Dimensional limits and defaults
  // must scale with the source, including sub-millimetre imported geometry.
  const dimensionalFloor = span * 1e-6;
  const thickness = clamp(number(input.thickness, span * 0.0375), dimensionalFloor, span);
  return {
    mode: ['struts','walls','2d','surface'].includes(input.mode) ? input.mode : 'struts',
    quality, cellSize: clamp(number(input.cellSize, span / 5), span * 1e-4, span * 2), thickness,
    rodProfile: ['circle','rectangle','polygon'].includes(input.rodProfile) ? input.rodProfile : 'circle',
    rodAspect: clamp(number(input.rodAspect, 1), .25, 4),
    rodSides: Math.round(clamp(number(input.rodSides, 6), 3, 12)),
    rodRotation: ((number(input.rodRotation, 0) % 360) + 360) % 360,
    surfaceInset: clamp(number(input.surfaceInset, 0), 0, span),
    shellThickness: clamp(number(input.shellThickness, 0), 0, span),
    surfaceDepth: clamp(number(input.surfaceDepth, Math.max(span * 0.05, thickness * 1.5)), dimensionalFloor, span),
    bottomThickness: clamp(number(input.bottomThickness, 0), 0, span),
    topThickness: clamp(number(input.topThickness, 0), 0, span),
    seed: (number(input.seed, 42) | 0) >>> 0,
    randomness: clamp(number(input.randomness, 0.85), 0, 1),
    stretch: [0,1,2].map(d => clamp(number(input.stretch?.[d], 1), 0.25, 4)),
    gradientAxis: ['x','y','z'].includes(input.gradientAxis) ? input.gradientAxis : 'none',
    gradientStrength: clamp(number(input.gradientStrength, 0), -0.8, 0.8),
    resolution: number(input.resolution, 0) <= 0 ? 0 : clamp(number(input.resolution, 0), dimensionalFloor, span),
    keepLargest: input.keepLargest === true,
  };
}

function randomGenerator(seed) {
  let value = seed >>> 0;
  return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// Half-space clipping produces the actual convex Voronoi cells and their edges.
function initialCell(min, max) {
  const p = [[min[0],min[1],min[2]],[max[0],min[1],min[2]],[max[0],max[1],min[2]],[min[0],max[1],min[2]],[min[0],min[1],max[2]],[max[0],min[1],max[2]],[max[0],max[1],max[2]],[min[0],max[1],max[2]]];
  return [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]].map(f => ({ points: f.map(i => p[i]), neighbor: -1 }));
}

function clipCell(faces, normal, offset, neighbor, epsilon) {
  const out = [], cut = [], unique = new Map();
  for (const face of faces) {
    const polygon = [];
    for (let i = 0; i < face.points.length; i++) {
      const a = face.points[i], b = face.points[(i + 1) % face.points.length];
      const da = dot(normal,a)-offset, db = dot(normal,b)-offset;
      if (da <= epsilon) polygon.push(a);
      if ((da < -epsilon && db > epsilon) || (da > epsilon && db < -epsilon)) {
        const t = da/(da-db), p = a.map((v,d) => v+(b[d]-v)*t); polygon.push(p);
        const key = p.map(v => Math.round(v/epsilon)).join(',');
        if (!unique.has(key)) { unique.set(key,true); cut.push(p); }
      } else if (Math.abs(da) <= epsilon) {
        const key = a.map(v => Math.round(v/epsilon)).join(',');
        if (!unique.has(key)) { unique.set(key,true); cut.push(a); }
      }
    }
    const cleaned = polygon.filter((p,i) => !i || length2(sub(p,polygon[i-1])) > epsilon*epsilon);
    if (cleaned.length > 2 && length2(sub(cleaned[0],cleaned[cleaned.length-1])) <= epsilon*epsilon) cleaned.pop();
    if (cleaned.length >= 3) out.push({ points: cleaned, neighbor: face.neighbor });
  }
  if (cut.length >= 3) {
    const center = cut.reduce((sum,p) => sum.map((v,d) => v+p[d]/cut.length), [0,0,0]);
    const axis = Math.abs(normal[0]) < 0.8 ? [1,0,0] : [0,1,0];
    const u = cross(normal,axis), v = cross(normal,u);
    cut.sort((a,b) => Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));
    out.push({ points: cut, neighbor });
  }
  return out;
}

export function buildVoronoi(bounds, options, warnings = [], progress = () => {}) {
  const dimensionality = options.mode === '2d' ? 2 : 3, preset = QUALITY[options.quality];
  let effectiveCellSize = options.cellSize;
  const countFor = size => [0,1,2].map(d => d >= dimensionality ? 1 : Math.ceil(bounds.size[d]/(size*options.stretch[d]))+4);
  let counts = countFor(effectiveCellSize);
  while (counts.reduce((a,b) => a*b,1) > preset.sites) { effectiveCellSize *= 1.055; counts = countFor(effectiveCellSize); }
  if (effectiveCellSize > options.cellSize * 1.01) warnings.push(`Cell size increased from ${options.cellSize.toPrecision(3)} to ${effectiveCellSize.toPrecision(3)} mm to keep the seed count within the ${preset.sites.toLocaleString()}-site browser limit.`);
  const spacing = options.stretch.map(v => v*effectiveCellSize), rng = randomGenerator(options.seed), sites = [];
  for (let z = 0; z < counts[2]; z++) for (let y = 0; y < counts[1]; y++) for (let x = 0; x < counts[0]; x++) {
    const indices = [x,y,z];
    sites.push(indices.map((i,d) => d >= dimensionality ? (bounds.min[d]+bounds.max[d])/2 : bounds.min[d]+(i-1.5+(rng()-0.5)*0.9*options.randomness)*spacing[d]));
  }
  const min = bounds.min.map((v,d) => v-3*spacing[d]), max = bounds.max.map((v,d) => v+3*spacing[d]);
  const epsilon = Math.max(...bounds.size, ...spacing)*1e-8, cells = [], edgeMap = new Map();
  for (let s = 0; s < sites.length; s++) {
    const site = sites[s];
    const neighbors = sites.map((p,i) => ({ id: i, distance2: length2(sub(p,site)) })).filter(p => p.id !== s).sort((a,b) => a.distance2-b.distance2);
    let faces = initialCell(min,max), radius2 = Infinity;
    for (const candidate of neighbors) {
      if (candidate.distance2 > radius2 * 4 + epsilon) break;
      const other = sites[candidate.id], delta = sub(other,site), distance = Math.sqrt(candidate.distance2);
      const normal = delta.map(v => v/distance), midpoint = site.map((v,d) => (v+other[d])/2), offset = dot(normal,midpoint);
      let outside = false;
      for (const face of faces) { if (face.points.some(p => dot(normal,p)-offset > epsilon)) { outside = true; break; } }
      if (!outside) continue;
      faces = clipCell(faces,normal,offset,candidate.id,epsilon);
      radius2 = 0;
      for (const face of faces) for (const p of face.points) {
        const delta = sub(p,site); if (dimensionality === 2) delta[2] = 0;
        radius2 = Math.max(radius2,length2(delta));
      }
    }
    cells.push({ site, planes: faces.filter(f => f.neighbor >= 0).map(f => {
      const other = sites[f.neighbor], delta = sub(other,site), distance = Math.sqrt(length2(delta));
      const normal = delta.map(v => v/distance);
      return { normal, offset: dot(normal,site.map((v,d) => (v+other[d])/2)), neighbor: f.neighbor };
    }) });
    if (options.mode === 'struts') {
      const localEdges = new Map();
      for (const face of faces) if (face.neighbor >= 0) for (let i = 0; i < face.points.length; i++) {
        const a = face.points[i], b = face.points[(i+1)%face.points.length];
        if (length2(sub(a,b)) < epsilon*epsilon) continue;
        const ak = a.map(v => Math.round(v/epsilon)).join(','), bk = b.map(v => Math.round(v/epsilon)).join(',');
        const key = ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
        const entry = localEdges.get(key);
        if (entry) entry.count++; else localEdges.set(key,{ a,b,count:1 });
      }
      for (const [key,e] of localEdges) if (e.count >= 2 && !edgeMap.has(key)) {
        // Keep just edges that can contribute to the source solid.
        const radius = options.thickness * (1+Math.abs(options.gradientStrength));
        if (e.a.every((v,d) => Math.max(v,e.b[d]) >= bounds.min[d]-radius && Math.min(v,e.b[d]) <= bounds.max[d]+radius)) edgeMap.set(key,e);
      }
    }
    if (s % 24 === 0) progress(0.08 + 0.22*s/sites.length, `Constructing ${dimensionality}D Voronoi cells (${s+1}/${sites.length})`);
  }
  const edges = [...edgeMap.values()];
  return { sites,cells,edges,effectiveCellSize, siteTree: makeBVH(sites.map(p => ({ min:p,max:p,point:p }))), edgeTree: edges.length ? makeBVH(edges.map(e => ({ ...e,min:e.a.map((v,d)=>Math.min(v,e.b[d])),max:e.a.map((v,d)=>Math.max(v,e.b[d])) }))) : null };
}

// Compact balanced AABB hierarchy shared by STL triangles, seed points and rods.
function makeBVH(items, indices = null) {
  indices ||= Array.from({length:items.length},(_,i)=>i);
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  for (const i of indices) for (let d = 0; d < 3; d++) { min[d] = Math.min(min[d],items[i].min[d]); max[d] = Math.max(max[d],items[i].max[d]); }
  if (indices.length <= 8) return { min,max,indices,items };
  const spans = max.map((v,d)=>v-min[d]), axis = spans.indexOf(Math.max(...spans));
  indices.sort((a,b)=>(items[a].min[axis]+items[a].max[axis])-(items[b].min[axis]+items[b].max[axis]));
  const middle = Math.floor(indices.length/2);
  return { min,max,left:makeBVH(items,indices.slice(0,middle)),right:makeBVH(items,indices.slice(middle)) };
}

function boxDistance2(p,node) {
  let distance = 0;
  for (let d = 0; d < 3; d++) { const gap = Math.max(node.min[d]-p[d],0,p[d]-node.max[d]); distance += gap*gap; }
  return distance;
}

function nearest(tree,p,distanceToItem,limit = Infinity) {
  let best = limit, index = -1;
  const visit = node => {
    if (boxDistance2(p,node) > best) return;
    if (node.indices) { for (const i of node.indices) { const value = distanceToItem(node.items[i],p); if (value < best) { best=value; index=i; } } return; }
    const a = boxDistance2(p,node.left), b = boxDistance2(p,node.right);
    if (a < b) { if (a <= best) visit(node.left); if (b <= best) visit(node.right); }
    else { if (b <= best) visit(node.right); if (a <= best) visit(node.left); }
  };
  visit(tree); return { distance2:best,index };
}

function segmentDistance2(segment,p) {
  const ab = sub(segment.b,segment.a), ap = sub(p,segment.a), t = clamp(dot(ap,ab)/length2(ab),0,1);
  return (ap[0]-ab[0]*t)**2+(ap[1]-ab[1]*t)**2+(ap[2]-ab[2]*t)**2;
}

function triangleDistance2(triangle,p) {
  // Closest-point region tests (Ericson), including every triangle edge.
  const { a,b,c } = triangle, ab = sub(b,a), ac = sub(c,a), ap = sub(p,a);
  const d1=dot(ab,ap), d2=dot(ac,ap);
  if (d1<=0 && d2<=0) return length2(ap);
  const bp=sub(p,b), d3=dot(ab,bp), d4=dot(ac,bp);
  if (d3>=0 && d4<=d3) return length2(bp);
  const vc=d1*d4-d3*d2;
  if (vc<=0 && d1>=0 && d3<=0) { const v=d1/(d1-d3); return length2(sub(ap,ab.map(n=>n*v))); }
  const cp=sub(p,c), d5=dot(ab,cp), d6=dot(ac,cp);
  if (d6>=0 && d5<=d6) return length2(cp);
  const vb=d5*d2-d1*d6;
  if (vb<=0 && d2>=0 && d6<=0) { const w=d2/(d2-d6); return length2(sub(ap,ac.map(n=>n*w))); }
  const va=d3*d6-d5*d4;
  if (va<=0 && d4-d3>=0 && d5-d6>=0) { const w=(d4-d3)/((d4-d3)+(d5-d6)); return length2(sub(bp,sub(c,b).map(n=>n*w))); }
  const denom=1/(va+vb+vc), v=vb*denom, w=vc*denom;
  return length2(ap.map((n,d)=>n-ab[d]*v-ac[d]*w));
}

function meshBVH(positions) {
  const triangles = [];
  for (let t = 0; t < positions.length; t += 9) {
    const a = Array.from(positions.subarray(t,t+3)), b = Array.from(positions.subarray(t+3,t+6)), c = Array.from(positions.subarray(t+6,t+9));
    triangles.push({ a,b,c,min:a.map((v,d)=>Math.min(v,b[d],c[d])),max:a.map((v,d)=>Math.max(v,b[d],c[d])) });
  }
  return makeBVH(triangles);
}

function columnIntersections(tree,x,y,epsilon) {
  const intersections = [];
  const visit = node => {
    if (x < node.min[0] || x > node.max[0] || y < node.min[1] || y > node.max[1]) return;
    if (!node.indices) { visit(node.left); visit(node.right); return; }
    for (const i of node.indices) {
      const {a,b,c} = node.items[i];
      const abx=b[0]-a[0], aby=b[1]-a[1], acx=c[0]-a[0], acy=c[1]-a[1];
      const determinant=abx*acy-aby*acx;
      if (Math.abs(determinant)<epsilon*epsilon) continue;
      const px=x-a[0], py=y-a[1], u=(px*acy-py*acx)/determinant, v=(abx*py-aby*px)/determinant;
      if (u>=-1e-10 && v>=-1e-10 && u+v<=1+1e-10) intersections.push(a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]));
    }
  };
  visit(tree); intersections.sort((a,b)=>a-b);
  return intersections.filter((value,i)=>i===0 || Math.abs(value-intersections[i-1])>epsilon);
}

export function isPointInsideMesh(mesh,point) {
  const epsilon = Math.max(...mesh.bounds.size)*1e-9;
  const hits = columnIntersections(meshBVH(mesh.positions),point[0]+epsilon*1.37,point[1]+epsilon*0.73,epsilon);
  return hits.filter(z=>z<point[2]).length%2===1;
}

function extractSurface(field,nx,ny,nz,min,step,progress,sampleField) {
  const points = [], orientationPoints = [], indices = [], cache = new Map();
  const stride = nx*ny;
  const tetrahedra = [[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6],[0,5,1,6]];
  const offsets = [0,1,nx+1,nx,stride,stride+1,stride+nx+1,stride+nx];
  const coordinate = id => { const z=Math.floor(id/stride), rest=id-z*stride, y=Math.floor(rest/nx), x=rest-y*nx; return [min[0]+x*step,min[1]+y*step,min[2]+z*step]; };
  const vertex = (a,b) => {
    const key = Math.min(a,b)*field.length+Math.max(a,b);
    let id=cache.get(key); if (id!==undefined) return id;
    // Always interpolate in the same direction on a shared grid edge.
    if (a>b) [a,b]=[b,a];
    const pa=coordinate(a), pb=coordinate(b);
    let low=0,high=1,fa=field[a],fb=field[b],t=fa/(fa-fb),positiveT=fa>0?0:1;
    // Linear interpolation of min(source SDF, wall SDF, depth SDF) cuts
    // corners at their intersections. Refine against the actual continuous
    // field so the result follows the source and the true Voronoi planes.
    if(sampleField) for(let iteration=0;iteration<12;iteration++) {
      const value=sampleField(pa.map((v,d)=>v+(pb[d]-v)*t));
      if(value>=0) positiveT=t;
      if(value>=0 && value<step*0.00005) break;
      if((value>0)===(fa>0)) {low=t;fa=value;} else {high=t;fb=value;}
      const ratio=clamp(fa/(fa-fb),0.05,0.95);t=low+(high-low)*ratio;
    }
    if(sampleField) t=positiveT;
    t=clamp(t,0.0002,0.9998);
    id=points.length; points.push(pa.map((v,d)=>Math.fround(v+(pb[d]-v)*t)));
    orientationPoints.push(pa.map((v,d)=>(v+pb[d])/2));
    cache.set(key,id); return id;
  };
  const triangle = (a,b,c,direction) => {
    // The four refined crossings in a two-inside tetrahedron need not remain
    // coplanar. Derive winding from its midpoint topology, not a deformed
    // triangle's normal, or adjacent triangles can choose opposite windings.
    if (dot(cross(sub(orientationPoints[b],orientationPoints[a]),sub(orientationPoints[c],orientationPoints[a])),direction)<0) [b,c]=[c,b];
    indices.push(a,b,c);
    if (indices.length/3>MAX_OUTPUT_TRIANGLES) throw new Error('The result exceeds 1.5 million triangles. Increase voxel size or cell size, or choose a lower quality setting.');
  };
  for (let z=0;z<nz-1;z++) {
    for (let y=0;y<ny-1;y++) for (let x=0;x<nx-1;x++) {
      const origin=z*stride+y*nx+x, corners=offsets.map(n=>origin+n);
      const count=corners.reduce((n,i)=>n+(field[i]>0?1:0),0);
      if (!count || count===8) continue;
      for (const tetra of tetrahedra) {
        const inside=[],outside=[];
        for (const c of tetra) (field[corners[c]]>0?inside:outside).push(corners[c]);
        if (!inside.length || !outside.length) continue;
        const direction=sub(coordinate(outside[0]),coordinate(inside[0]));
        if (inside.length===1) triangle(vertex(inside[0],outside[0]),vertex(inside[0],outside[1]),vertex(inside[0],outside[2]),direction);
        else if (inside.length===3) triangle(vertex(outside[0],inside[0]),vertex(outside[0],inside[1]),vertex(outside[0],inside[2]),direction);
        else {
          const a=vertex(inside[0],outside[0]), b=vertex(inside[0],outside[1]), c=vertex(inside[1],outside[1]), d=vertex(inside[1],outside[0]);
          triangle(a,b,c,direction); triangle(a,c,d,direction);
        }
      }
    }
    if (z%4===0) progress(0.78+0.14*z/(nz-1),'Extracting a closed triangle surface');
  }
  return {points,indices};
}

export function keepLargestComponent(points,indices) {
  const parent=Int32Array.from({length:points.length},(_,i)=>i);
  const find=n=>{ while(parent[n]!==n) {parent[n]=parent[parent[n]];n=parent[n];} return n; };
  for(let i=0;i<indices.length;i+=3) { const root=find(indices[i]); parent[find(indices[i+1])]=root; parent[find(indices[i+2])]=root; }
  const components=new Map();
  for(let i=0;i<indices.length;i+=3) {
    const root=find(indices[i]);
    let component=components.get(root);
    if(!component) {component={root,indices:[],volume:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],owner:null};components.set(root,component);}
    component.volume+=triangleVolume(points[indices[i]],points[indices[i+1]],points[indices[i+2]],points[indices[0]]);
    for(let c=0;c<3;c++) {
      const id=indices[i+c];component.indices.push(id);
      for(let d=0;d<3;d++) {component.min[d]=Math.min(component.min[d],points[id][d]);component.max[d]=Math.max(component.max[d],points[id][d]);}
    }
  }
  if(components.size<=1) return {indices,discardedComponents:0};
  const positive=[...components.values()].filter(component=>component.volume>0).sort((a,b)=>a.volume-b.volume);
  for(const component of positive) component.materialVolume=component.volume;
  // A nested solid can live inside another solid's cavity and have its own
  // cavity. Associate each negative boundary with the nearest enclosing
  // positive boundary, not every containing outer surface. Otherwise deleting
  // the nested solid but retaining its cavity creates phantom material.
  for(const cavity of components.values()) if(cavity.volume<0) {
    const p=points[cavity.indices[0]];
    for(const candidate of positive) {
      if(p.some((v,d)=>v<candidate.min[d] || v>candidate.max[d])) continue;
      candidate.tree ||= meshBVH(unpack(points,candidate.indices));
      const epsilon=Math.max(...candidate.max.map((v,d)=>v-candidate.min[d]))*1e-9;
      const intersections=columnIntersections(candidate.tree,p[0]+epsilon*1.37,p[1]+epsilon*0.73,epsilon);
      if(intersections.filter(z=>z<p[2]).length%2) {
        cavity.owner=candidate.root;candidate.materialVolume+=cavity.volume;break;
      }
    }
  }
  let largest=null;
  for(const component of positive) if(!largest || component.materialVolume>largest.materialVolume) largest=component;
  if(!largest) throw new Error('Surface orientation did not identify a valid solid component. Regenerate with a slightly different voxel size.');
  const keep=new Set([largest.root]);
  for(const component of components.values()) if(component.owner===largest.root) keep.add(component.root);
  const output=[];
  for(let i=0;i<indices.length;i+=3) if(keep.has(find(indices[i]))) output.push(indices[i],indices[i+1],indices[i+2]);
  return {indices:output,discardedComponents:positive.length-1};
}

export function generateLattice(mesh,inputOptions = {},onProgress = () => {}, { solidRegionsOnly = false } = {}) {
  const start = typeof performance!=='undefined'?performance.now():Date.now();
  const progress = (value,message)=>onProgress(value,message);
  if (!(mesh?.positions instanceof Float32Array) || !mesh.bounds) throw new Error('Upload an STL or load an example first.');
  if (!mesh.stats?.watertight) throw new Error('A closed, manifold STL is required for reliable internal clipping. Repair open or non-manifold edges in your slicer or CAD tool and upload it again.');
  const options=normalizeOptions(inputOptions,mesh.bounds), warnings=[];
  const bounds=mesh.bounds,preset=QUALITY[options.quality];
  if (bounds.size.some(v=>v<=0)) throw new Error('The STL must enclose a three-dimensional volume.');
  const span=Math.max(...bounds.size),shortestSpan=Math.min(...bounds.size);
  const minimumThickness=options.thickness*(1-Math.abs(options.gradientStrength));
  const features=[minimumThickness];
  for(const feature of [options.shellThickness,options.bottomThickness,options.topThickness,options.mode==='surface'?options.surfaceDepth:0]) if(feature>0) features.push(feature);
  const minimumFeature=Math.min(...features);
  const automaticResolution=Math.min(minimumFeature/preset.samples,span/preset.shapeSamples,shortestSpan/(preset.samples*6),options.cellSize*Math.min(...options.stretch)/preset.cellSamples);
  const requestedResolution=options.resolution || automaticResolution;
  const assertSampled=voxelSize=>{
    if(span/voxelSize<preset.minimumShapeSamples || shortestSpan/voxelSize<3) throw new Error(`Voxel size ${voxelSize.toPrecision(3)} mm is too coarse for this ${bounds.size.map(v=>v.toPrecision(3)).join(' × ')} mm STL and would erase its shape. ${options.quality} quality requires at least ${preset.minimumShapeSamples} samples across the longest dimension. Use automatic resolution (0), a finer voxel size, or a higher quality budget. Check the source dimensions and units before generating.`);
    if(minimumFeature/voxelSize<0.65) throw new Error(`The smallest requested feature (${minimumFeature.toPrecision(3)} mm) is smaller than one voxel (${voxelSize.toPrecision(3)} mm). Increase feature thickness or choose a finer voxel size with a higher quality budget.`);
  };
  assertSampled(requestedResolution);
  let step=requestedResolution;
  const dimensions=s=>bounds.size.map(v=>Math.ceil(v/s)+5);
  let dims=dimensions(step);
  while(dims.reduce((a,b)=>a*b,1)>preset.nodes || Math.max(...dims)>360) {step*=1.025;dims=dimensions(step);}
  assertSampled(step);
  progress(0.01,'Indexing the source STL');
  const sourceTree=meshBVH(mesh.positions);
  const voronoi=solidRegionsOnly ? { sites:[], edges:[], effectiveCellSize:options.cellSize } : buildVoronoi(bounds,options,warnings,progress);
  if (!solidRegionsOnly && options.mode==='struts' && !voronoi.edges.length) throw new Error('No Voronoi cell edges cross this solid. Reduce the cell size or try another seed.');
  if(step>requestedResolution*1.01) warnings.push(`Voxel size increased from ${requestedResolution.toPrecision(3)} to ${step.toPrecision(3)} mm to fit the ${preset.nodes.toLocaleString()}-sample ${options.quality} quality budget.`);
  if(minimumThickness<step*2.2) warnings.push(`The thinnest feature (${minimumThickness.toPrecision(3)} mm) is sampled by fewer than 2.2 voxels. Increase thickness or use a smaller voxel size with higher quality; fine rods may disconnect.`);
  if(options.shellThickness>0 && options.shellThickness<step*1.5) warnings.push('The outer shell is thinner than 1.5 voxels and may contain gaps. Increase shell thickness or resolution.');
  const absoluteCoordinate=Math.max(...bounds.min.map(Math.abs),...bounds.max.map(Math.abs));
  if(absoluteCoordinate>Math.max(...bounds.size)*1000) throw new Error('The STL is very far from the coordinate origin. Recenter it near (0, 0, 0) before meshing to preserve thin-feature precision.');
  const [nx,ny,nz]=dims, gridMin=bounds.min.map(v=>v-step*2.137), field=new Float32Array(nx*ny*nz);
  const sourceCap=Math.max(step*3,options.shellThickness,options.mode==='surface'?options.surfaceDepth:0)+step;
  const fieldCap=Math.max(step*3,options.thickness*(1+Math.abs(options.gradientStrength)));
  const axis=['x','y','z'].indexOf(options.gradientAxis),epsilon=Math.max(...bounds.size)*1e-9;
  const sampleField=(p,insideHint,sourceDistanceHint)=>{
    let sourceDistance=sourceDistanceHint;
    if(sourceDistance===undefined) {
      const inside=insideHint ?? (columnIntersections(sourceTree,p[0]+epsilon*1.37,p[1]+epsilon*0.73,epsilon).filter(z=>z<p[2]).length%2===1);
      const distance=Math.sqrt(nearest(sourceTree,p,triangleDistance2,sourceCap*sourceCap).distance2);
      sourceDistance=inside?distance:-distance;
    }
    const gradient=axis>=0?1+options.gradientStrength*(2*(p[axis]-bounds.min[axis])/bounds.size[axis]-1):1;
    const radius=options.thickness*gradient/2;
    let lattice;
    if(solidRegionsOnly) lattice=-fieldCap;
    else if(options.mode==='struts') lattice=radius-Math.sqrt(nearest(voronoi.edgeTree,p,segmentDistance2,(radius+fieldCap)**2).distance2);
    else {
      const q=options.mode==='2d'?[p[0],p[1],(bounds.min[2]+bounds.max[2])/2]:p;
      const site=nearest(voronoi.siteTree,q,(item,point)=>length2(sub(item.point,point))).index;
      let faceDistance=Infinity;
      for(const plane of voronoi.cells[site].planes) faceDistance=Math.min(faceDistance,plane.offset-dot(plane.normal,q));
      lattice=radius-Math.max(0,faceDistance);
      if(options.mode==='surface') lattice=Math.min(lattice,options.surfaceDepth-sourceDistance);
    }
    if(options.shellThickness>0) lattice=Math.max(lattice,options.shellThickness-sourceDistance);
    if(options.bottomThickness>0) lattice=Math.max(lattice,bounds.min[2]+options.bottomThickness-p[2]);
    if(options.topThickness>0) lattice=Math.max(lattice,p[2]-(bounds.max[2]-options.topThickness));
    return Math.min(sourceDistance,lattice);
  };
  let sourceSamples=0,occupiedSamples=0;
  for(let y=0;y<ny;y++) {
    const py=gridMin[1]+y*step;
    for(let x=0;x<nx;x++) {
      const px=gridMin[0]+x*step;
      const hits=columnIntersections(sourceTree,px+epsilon*1.37,py+epsilon*0.73,epsilon);
      let hitIndex=0;
      for(let z=0;z<nz;z++) {
        const p=[px,py,gridMin[2]+z*step],index=(z*ny+y)*nx+x;
        while(hitIndex<hits.length && hits[hitIndex]<p[2]) hitIndex++;
        const inside=hitIndex%2===1;
        // Empty columns cannot contribute; preserve a fully negative border.
        if(p.some((v,d)=>v<bounds.min[d]-step*1.8 || v>bounds.max[d]+step*1.8)) {field[index]=-step*2;continue;}
        const distance=Math.sqrt(nearest(sourceTree,p,triangleDistance2,sourceCap*sourceCap).distance2);
        const sourceDistance=inside?distance:-distance;
        if(inside) sourceSamples++;
        if(!inside && distance>step*1.8) {field[index]=-Math.min(distance,fieldCap);continue;}
        let value=sampleField(p,inside,sourceDistance);
        // Avoid iso-surface vertices landing exactly on grid nodes, which would
        // create degenerate triangles and duplicate topology after STL rounding.
        if(Math.abs(value)<step*0.001) value=value>0?step*0.001:-step*0.001;
        field[index]=clamp(value,-fieldCap,fieldCap);if(value>0) occupiedSamples++;
      }
    }
    if(y%2===0) progress(0.30+0.48*y/ny,`Sampling the source and lattice (${Math.round(100*(y+1)/ny)}%)`);
  }
  if(!occupiedSamples) throw new Error('No lattice material was resolved. Reduce cell size, increase strut thickness, or choose a finer voxel size.');
  const extracted=extractSurface(field,nx,ny,nz,gridMin,step,progress,sampleField);
  if(!extracted.indices.length) throw new Error('No printable surface was generated. Try thicker struts or a smaller cell size.');
  progress(0.93,'Checking manifold edges and connected components');
  let indices=extracted.indices,discardedComponents=0;
  if(options.keepLargest) {const kept=keepLargestComponent(extracted.points,indices);indices=kept.indices;discardedComponents=kept.discardedComponents;}
  const stats=meshStatistics(extracted.points,indices), positions=unpack(extracted.points,indices);
  if(!stats.watertight || stats.inconsistentWindingEdges) throw new Error('Surface validation found open or inconsistent edges. Increase voxel size slightly and regenerate.');
  if(discardedComponents) warnings.push(`Kept the largest solid by material volume and removed ${discardedComponents} detached solid components, including their cavity boundaries. Disable this option to retain all pieces.`);
  if(stats.components>1) warnings.push(`The result contains ${stats.components} disconnected solid components. Enable “Keep largest” to remove detached pieces, or retain them intentionally.`);
  const sourceVolumeMm3=sourceSamples*step**3;
  Object.assign(stats,{sourceVolumeMm3,relativeDensity:clamp(stats.volumeMm3/sourceVolumeMm3,0,1),voxelSize:step,requestedVoxelSize:requestedResolution,automaticResolution:options.resolution===0,sourceSamplesAcross:bounds.size.map(v=>v/step),minimumFeature,gridNodes:field.length,gridDimensions:dims,siteCount:voronoi.sites.length,edgeCount:voronoi.edges.length,effectiveCellSize:voronoi.effectiveCellSize,discardedComponents,sourceVolumeIsEstimate:true,generationMs:(typeof performance!=='undefined'?performance.now():Date.now())-start});
  progress(1,'Lattice ready');
  return {positions,bounds:boundsOf(positions),stats,warnings,options:{...options,effectiveResolution:step,effectiveCellSize:voronoi.effectiveCellSize}};
}
