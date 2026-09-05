/** Physical dimensions stay proportional when a source is imported or resized. */
const PRESETS = Object.freeze({
  open: { mode: 'struts', cell: .2, diameter: .04, randomness: .85 },
  dense: { mode: 'struts', cell: .15, diameter: .055, randomness: .65 },
  shelled: { mode: 'struts', cell: .2, diameter: .04, shell: .03, randomness: .85 },
  skin: { mode: 'surface', cell: .2, diameter: .035, randomness: .9 },
  cellular: { mode: 'walls', cell: .25, diameter: .0275, randomness: .85 },
  planar: { mode: '2d', cell: .18, diameter: .035, randomness: .8 },
});
// Keep surfaceDepth scalable for older saved projects; new surface rods use inset.
const DIMENSIONAL_OPTIONS = ['cellSize', 'thickness', 'shellThickness', 'surfaceInset', 'surfaceDepth', 'bottomThickness', 'topThickness', 'resolution'];
const POSITIVE_OPTIONS = new Set(['cellSize', 'thickness', 'surfaceDepth']);

function positiveFactor(factor) {
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('Choose a positive, finite model scale.');
  return factor;
}

function finitePoint(point) {
  return (Array.isArray(point) || ArrayBuffer.isView(point)) && point.length === 3 && Array.from(point).every(Number.isFinite);
}

export function presetLatticeOptions(name, bounds, current = {}) {
  const preset = Object.hasOwn(PRESETS, name) ? PRESETS[name] : null;
  if (!preset) throw new Error(`Unknown lattice starting point: ${name}.`);
  const size = bounds?.size ?? [40, 40, 40];
  if (!finitePoint(size) || size.some(value => value < 0) || !(Math.max(...size) > 0)) throw new Error('The source needs finite, measurable dimensions.');
  const span = Math.max(...size);
  return {
    mode: preset.mode,
    cellSize: span * preset.cell,
    thickness: span * preset.diameter,
    shellThickness: span * (preset.shell ?? 0),
    surfaceInset: 0,
    bottomThickness: 0,
    topThickness: 0,
    seed: Number.isFinite(current.seed) ? current.seed : 42,
    rodProfile: ['circle', 'rectangle', 'polygon'].includes(current.rodProfile) ? current.rodProfile : 'circle',
    rodAspect: Number.isFinite(current.rodAspect) ? Math.max(.25, Math.min(4, current.rodAspect)) : 1,
    rodSides: Number.isFinite(current.rodSides) ? Math.max(3, Math.min(12, Math.round(current.rodSides))) : 6,
    rodRotation: Number.isFinite(current.rodRotation) ? ((current.rodRotation % 360) + 360) % 360 : 0,
    randomness: preset.randomness,
    stretch: [1, 1, 1],
    gradientAxis: 'none',
    gradientStrength: 0,
    quality: ['draft', 'balanced', 'fine'].includes(current.quality) ? current.quality : 'balanced',
    resolution: 0,
    keepLargest: false,
  };
}

export function scaleLatticeOptions(options, factor) {
  positiveFactor(factor);
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Lattice settings are missing.');
  const scaled = { ...options };
  if (options.stretch !== undefined) {
    if (!finitePoint(options.stretch)) throw new Error('Cell stretch must contain three finite values.');
    scaled.stretch = Array.from(options.stretch);
  }
  for (const key of DIMENSIONAL_OPTIONS) {
    if (options[key] === undefined) continue;
    const value = options[key];
    if (!Number.isFinite(value) || value < 0 || (POSITIVE_OPTIONS.has(key) && value === 0)) throw new Error(`Choose a valid ${key} before resizing the model.`);
    const next = value === 0 ? 0 : value * factor;
    if (!Number.isFinite(next) || (value > 0 && next === 0)) throw new Error(`The scaled ${key} is outside the supported numeric range.`);
    scaled[key] = next;
  }
  return scaled;
}

export function resizeSourceMesh(mesh, factor, anchor) {
  positiveFactor(factor);
  if (!(mesh?.positions instanceof Float32Array) || !mesh.positions.length || mesh.positions.length % 9) throw new Error('The source needs complete triangle geometry before resizing.');
  const sourceMin = mesh.bounds?.min, sourceMax = mesh.bounds?.max;
  if (!finitePoint(sourceMin) || !finitePoint(sourceMax) || sourceMin.some((value, axis) => value > sourceMax[axis])) throw new Error('The source needs finite bounds before resizing.');
  const pivot = anchor === undefined ? sourceMin.map((value, axis) => value + (sourceMax[axis] - value) / 2) : anchor;
  if (!finitePoint(pivot)) throw new Error('The resize anchor must contain three finite coordinates.');
  const positions = new Float32Array(mesh.positions.length);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    positions[i] = pivot[axis] + (mesh.positions[i] - pivot[axis]) * factor;
    if (!Number.isFinite(positions[i])) throw new Error('The resized source exceeds the supported coordinate range.');
    min[axis] = Math.min(min[axis], positions[i]);
    max[axis] = Math.max(max[axis], positions[i]);
  }
  const size = max.map((value, axis) => value - min[axis]);
  if (size.some((value, axis) => value === 0 && sourceMax[axis] > sourceMin[axis])) throw new Error('This scale loses source detail at the current coordinates. Choose a larger size.');
  const stats = { ...mesh.stats };
  for (const [key, exponent] of [['volumeMm3', 3], ['surfaceAreaMm2', 2]]) {
    if (stats[key] === undefined) continue;
    const value = stats[key] * factor ** exponent;
    if (!Number.isFinite(value)) throw new Error('The resized source exceeds the supported measurement range.');
    stats[key] = value;
  }
  return { ...mesh, positions, bounds: { min, max, size }, stats, warnings: [...(mesh.warnings ?? [])] };
}
