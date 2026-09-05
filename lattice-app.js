import { LatticeViewer, measurementScaleFactor } from './lattice-viewer.js?v=20260905-release45';
import { encodeBinarySTL, normalizeOptions } from './lattice-engine.js?v=20260905-release45';
import { presetLatticeOptions, scaleLatticeOptions, resizeSourceMesh } from './lattice-settings.js?v=20260905-release45';

const $ = id => document.getElementById(id);
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MODE_COPY = {
  struts: ['3D strut lattice', 'Interconnected struts follow Voronoi cell edges throughout the full 3D volume.'],
  walls: ['3D cellular walls', 'Voronoi cell faces become thin walls throughout the volume. Cells can form sealed cavities.'],
  surface: ['Surface rod lattice', 'Connected rods follow the Voronoi network across your source surface. Choose their cross-section and inspect the fused junctions.'],
  '2d': ['Extruded Voronoi', 'A planar Voronoi wall pattern extends along Z and is clipped to the complete source model.'],
};
let source = null;
let sourceName = '';
let sourceOrigin = null;
let result = null;
let dirty = true;
let worker = null;
let job = null;
let sequence = 0;
let generationSeconds = 0;
let viewer = null;
let sourceRevision = 0;
let acceptedUnits = '1';
let measurement = { points: [], distance: null };
let measuring = false;

const formatMm = value => Number(value).toLocaleString(undefined, { maximumSignificantDigits: 6 });

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function showViewerError(message) {
  if (!message) { $('viewerError').hidden = true; refreshMeasurementControls(); return; }
  $('viewerError').hidden = false;
  $('viewerError').textContent = `${message} Geometry generation and STL export remain available.`;
}
try { viewer = new LatticeViewer($('latticeCanvas'), { onError: showViewerError, onMeasurement: updateMeasurement }); }
catch (error) { showViewerError(error.message || 'The 3D preview could not start.'); }

function setProgress(progress, message) {
  const value = Math.max(0, Math.min(1, Number(progress) || 0));
  $('jobProgress').value = value;
  $('progressValue').textContent = `${Math.round(value * 100)}%`;
  $('progressMessage').textContent = message || 'Generating lattice…';
}
function refreshButtons() {
  const busy = !!job;
  const usable = result && !dirty && !busy && result.positions.length > 0;
  const valid = usable && result.stats.boundaryEdges === 0 && result.stats.nonManifoldEdges === 0
    && (result.stats.inconsistentWindingEdges || 0) === 0 && result.stats.volumeMm3 > 0;
  $('designControls').disabled = busy;
  $('generate').disabled = busy || !source;
  $('loadProject').disabled = busy;
  $('saveProject').disabled = busy || !source;
  $('exportStl').disabled = !valid;
  $('exportReport').disabled = !usable;
  $('cancel').hidden = !busy;
  $('progressPanel').hidden = !busy;
  $('generate').textContent = busy ? 'Working…' : dirty && result ? 'Update lattice' : 'Generate lattice';
  $('generationHint').textContent = busy ? 'Working locally. You can cancel at any time.' : 'STL files stay on this device.';
  refreshMeasurementControls();
}

function refreshMeasurementControls() {
  const points = measurement.points.length;
  $('measurementStart').disabled = !!job || !source || !viewer || !!$('latticeCanvas').dataset.viewerError;
  $('measurementClear').disabled = !!job || points === 0;
  $('measurementApply').disabled = !!job || points !== 2 || !(number('measurementTarget') > 0);
  $('measurementStart').textContent = measuring ? 'Finish picking' : points === 2 ? 'Pick new points' : 'Pick two points';
  $('measurementStart').setAttribute('aria-pressed', String(measuring));
}
function updateMeasurement(value) {
  measurement = { points: value?.points?.map(point => [...point]) || [], distance: value?.distance ?? null };
  $('measurementDistance').textContent = measurement.distance == null ? '—' : `${formatMm(measurement.distance)} mm`;
  $('measurementHint').textContent = measurement.points.length === 2
    ? 'Two points selected. Enter their real distance and scale the model.'
    : measurement.points.length === 1 ? 'Point A selected. Pick point B; drag to change the view.'
      : measuring ? 'Click point A on the source mesh. Dragging still orbits.' : 'No points selected.';
  refreshMeasurementControls();
}
function setMeasuring(enabled) {
  measuring = !!enabled;
  viewer?.setMeasurementMode(measuring);
  $('previewBadge').textContent = measuring ? 'Measuring source' : result ? dirty ? 'Settings changed' : 'Lattice ready' : 'Source model';
  updateMeasurement(measurement);
}
function resetMeasurement() {
  setMeasuring(false);
  viewer?.clearMeasurement();
  updateMeasurement({ points: [], distance: null });
  $('measurementTarget').value = '';
}
function settleJob(error, message) {
  const current = job;
  if (!current) return;
  clearTimeout(current.timeout);
  job = null;
  refreshButtons();
  if (error) current.reject(error);
  else current.resolve(message);
}
function resetWorker() {
  worker?.terminate();
  worker = null;
}
function runJob(payload) {
  if (job) return Promise.reject(new Error('Wait for the current operation or cancel it first.'));
  setMeasuring(false);
  if (payload.type === 'generate') $('previewBadge').textContent = 'Generating';
  return new Promise((resolve, reject) => {
    try {
      if (!worker) {
        worker = new Worker(new URL('./lattice-worker.js?v=20260905-release45', import.meta.url), { type: 'module' });
        worker.onmessage = event => {
          const message = event.data;
          if (message.id !== job?.id) return;
          if (message.type === 'progress') setProgress(message.progress, message.message);
          else if (message.type === 'error') settleJob(new Error(message.message || 'Geometry generation failed.'));
          else settleJob(null, message);
        };
        worker.onerror = event => {
          event.preventDefault();
          resetWorker();
          settleJob(new Error('The geometry worker stopped. Try a coarser quality or a smaller source STL.'));
        };
        worker.onmessageerror = () => {
          resetWorker();
          settleJob(new Error('The geometry result could not be received. Try a smaller model.'));
        };
      }
      const id = ++sequence;
      job = { id, resolve, reject, timeout: setTimeout(() => {
        resetWorker();
        settleJob(new Error('This operation exceeded three minutes. Increase cell size or choose Draft quality and try again.'));
      }, 180_000) };
      setProgress(0, payload.type === 'generate' ? 'Building Voronoi cells…' : 'Reading source geometry…');
      refreshButtons();
      worker.postMessage({ ...payload, id });
    } catch (error) {
      resetWorker();
      if (job) settleJob(error);
      else reject(error);
    }
  });
}
function cancel() {
  if (!job) return;
  resetWorker();
  const error = new Error('Operation cancelled. Your previous model is preserved.');
  error.name = 'AbortError';
  settleJob(error);
  $('previewBadge').textContent = result ? dirty ? 'Settings changed' : 'Lattice ready' : 'Source model';
}
function number(id) { return Number($(id).value); }
function getOptions() {
  return {
    mode: document.querySelector('input[name="mode"]:checked').value,
    cellSize: number('cellSize'), thickness: number('thickness'), seed: number('seed'),
    rodProfile: $('rodProfile').value, rodAspect: number('rodAspect'), rodSides: number('rodSides'), rodRotation: number('rodRotation'),
    randomness: number('randomness'), shellThickness: number('shellThickness'),
    surfaceInset: number('surfaceInset'), bottomThickness: number('bottomThickness'), topThickness: number('topThickness'),
    stretch: [number('stretchX'), number('stretchY'), number('stretchZ')],
    gradientAxis: $('gradientAxis').value, gradientStrength: number('gradientStrength'),
    quality: $('quality').value, resolution: number('resolution'), keepLargest: $('keepLargest').checked,
  };
}
function applyOptions(options) {
  const normalized = normalizeOptions(options, source?.bounds);
  for (const id of ['cellSize','thickness','rodProfile','rodAspect','rodSides','rodRotation','seed','randomness','shellThickness','surfaceInset','bottomThickness','topThickness','gradientAxis','gradientStrength','quality','resolution']) {
    if (normalized[id] !== undefined) $(id).value = normalized[id];
  }
  ['stretchX','stretchY','stretchZ'].forEach((id, i) => { $(id).value = normalized.stretch?.[i] ?? 1; });
  $('keepLargest').checked = !!normalized.keepLargest;
  document.querySelector(`input[name="mode"][value="${normalized.mode}"]`).checked = true;
  updateMode();
}
function updateMode() {
  const { mode, rodProfile, rodAspect, rodSides, rodRotation } = getOptions();
  const rods = mode === 'struts' || mode === 'surface';
  $('modeDescription').textContent = MODE_COPY[mode][1];
  $('surfaceInsetControls').hidden = mode !== 'surface';
  $('surfaceInset').disabled = mode !== 'surface';
  $('rodProfileControls').hidden = !rods;
  $('rodAspectRow').hidden = rodProfile !== 'rectangle';
  $('rodSidesRow').hidden = rodProfile !== 'polygon';
  $('rodRotationRow').hidden = rodProfile === 'circle';
  $('rodProfile').disabled = !rods;
  $('rodAspect').disabled = !rods || rodProfile !== 'rectangle';
  $('rodSides').disabled = !rods || rodProfile !== 'polygon';
  $('rodRotation').disabled = !rods || rodProfile === 'circle';
  const thicknessLabel = !rods ? 'Wall thickness ' : rodProfile === 'rectangle' ? 'Rod width ' : rodProfile === 'polygon' ? 'Rod outer diameter ' : 'Rod diameter ';
  $('thicknessLabel').firstChild.textContent = thicknessLabel;
  $('thicknessSlider').setAttribute('aria-label', `${thicknessLabel.trim()} in millimeters`);
  $('rodProfileHint').textContent = rodProfile === 'rectangle'
    ? 'Width sets one side; height is width × aspect ratio. Rotation turns the cross-section around each rod.'
    : rodProfile === 'polygon' ? 'The diameter passes through the outer corners. Set the number of sides and rotate the cross-section around each rod.'
      : 'Diameter controls the round cross-section.';
  const aspect = Number.isFinite(rodAspect) && rodAspect > 0 ? Math.max(.25, Math.min(4, rodAspect)) : 1;
  const sides = rodProfile === 'circle' ? 48 : Math.max(3, Math.min(12, Math.round(rodSides) || 6));
  const halfWidth = 28 / Math.max(1, aspect), halfHeight = halfWidth * aspect;
  const points = rodProfile === 'rectangle'
    ? [[-halfWidth,-halfHeight],[halfWidth,-halfHeight],[halfWidth,halfHeight],[-halfWidth,halfHeight]]
    : Array.from({ length: sides }, (_, index) => { const angle = index / sides * Math.PI * 2; return [31 * Math.cos(angle), 31 * Math.sin(angle)]; });
  $('rodProfileOutline').setAttribute('points', points.map(point => `${point[0] + 50},${point[1] + 50}`).join(' '));
  $('rodProfileOutline').setAttribute('transform', `rotate(${rodProfile === 'circle' ? 0 : Number.isFinite(rodRotation) ? rodRotation : 0} 50 50)`);
  const sampledSolids = number('shellThickness') > 0 || number('bottomThickness') > 0 || number('topThickness') > 0;
  $('samplingControls').hidden = rods && !sampledSolids;
  $('resolution').disabled = rods && !sampledSolids;
  $('qualityHelp').textContent = rods
    ? 'Quality controls round-profile smoothness and how closely surface rods follow curved geometry. Shells and solid regions can also require sampling.'
    : 'Higher quality captures finer cell walls and source detail. Smaller sampling sizes take longer and use more memory.';
  $('randomnessValue').textContent = `${Math.round(number('randomness') * 100)}%`;
  $('gradientValue').textContent = `${Math.round(number('gradientStrength') * 100)}%`;
  $('cellSizeSlider').value = number('cellSize');
  $('thicknessSlider').value = number('thickness');
  const preset = $('preset');
  $('previewTitle').textContent = preset.value === 'custom' ? MODE_COPY[mode][0] : preset.options[preset.selectedIndex].text;
}
function invalidate() {
  dirty = true;
  $('previewBadge').textContent = result ? 'Settings changed' : 'Source model';
  $('previewBadge').classList.toggle('stale', !!result);
  if (result) $('resultSummary').textContent = 'Previous result. Generate again to apply your current settings.';
  refreshButtons();
}
function preset(name) {
  if (name === 'custom') return;
  applyOptions(presetLatticeOptions(name, source?.bounds || { size: [40,40,40] }, getOptions()));
  $('preset').value = name;
  updateMode();
  invalidate();
  if (name === 'shelled') {
    $('cutAxis').value = 'z';
    $('cut').value = .6;
    updateDisplay();
  }
}
function updateDisplay() {
  const axis = $('cutAxis').value;
  $('cut').disabled = axis === 'none';
  $('cutValue').textContent = `${Math.round(number('cut') * 100)}%`;
  viewer?.setDisplay({ showSource: $('showSource').checked || !result, showResult: $('showResult').checked,
    wireframe: $('wireframe').checked, cutAxis: axis, cut: number('cut'), color: $('modelColor').value });
}
function resetInsights() {
  for (const id of ['densityNumber','materialSaved','resultVolume','resultTriangles','resultComponents','resultSites','resultResolution','resultTime']) $(id).textContent = '—';
  $('densityBar').style.width = '0%';
  $('resultSummary').textContent = 'Generate a lattice to inspect its geometry.';
  $('meshCheck').textContent = 'Source ready · generate to check output';
  $('meshCheck').className = 'check-state';
}
function acceptSource(mesh, name) {
  if (!(mesh?.positions instanceof Float32Array) || !mesh.positions.length || !mesh.bounds?.size?.every(Number.isFinite)) throw new Error('The source has no usable geometry.');
  source = mesh;
  sourceName = name;
  sourceRevision++;
  resetMeasurement();
  result = null;
  viewer?.setResult(null);
  viewer?.setSource(mesh);
  viewer?.fit();
  $('sourceName').textContent = name;
  $('sourceDimensions').textContent = `${mesh.bounds.size.map(formatMm).join(' × ')} mm`;
  $('sourceTriangles').textContent = `${(mesh.positions.length / 9).toLocaleString()} source triangles`;
  $('modelSize').value = Number(Math.max(...mesh.bounds.size).toPrecision(9));
  const span = Math.max(...mesh.bounds.size);
  for (const [id,low,high] of [['cellSizeSlider',.005,.6],['thicknessSlider',.001,.15]]) {
    $(id).min = span * low;
    $(id).max = span * high;
    $(id).step = span / 2000;
  }
  $('cellSize').max = span * 2;
  for (const id of ['cellSize','thickness']) $(id).min = span * .00001;
  for (const id of ['thickness','shellThickness','surfaceInset','bottomThickness','topThickness','resolution']) $(id).max = span;
  $('scaleNotice').hidden = span >= 10 && span <= 2000;
  $('scaleNotice').textContent = span < 10
    ? `This model is only ${formatMm(span)} mm across. STL files do not specify units. Check STL units or use Measure & set scale before choosing print thickness.`
    : `This model is ${formatMm(span)} mm across. Check the STL units or use Measure & set scale if that is not its intended size.`;
  resetInsights();
  renderWarnings(mesh.warnings || []);
  invalidate();
  updateDisplay();
}
function renderWarnings(warnings) {
  $('warnings').replaceChildren(...[...new Set(warnings)].map(text => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
}
function printWarnings() {
  if (!result) return [];
  const options = result.options;
  const warnings = [...(source?.warnings || []), ...(result.warnings || [])];
  const rods = options.mode === 'struts' || options.mode === 'surface';
  const profileFactor = !rods ? 1 : options.rodProfile === 'rectangle' ? Math.min(1, options.rodAspect || 1) : options.rodProfile === 'polygon' ? Math.cos(Math.PI / (options.rodSides || 6)) : 1;
  const minimum = options.thickness * profileFactor * (options.gradientAxis === 'none' ? 1 : 1 - Math.abs(options.gradientStrength));
  if (minimum < number('nozzle') * 2.25) warnings.push(`The thinnest specified feature (${formatMm(minimum)} mm) is below two nominal extrusion lines for the selected ${number('nozzle')} mm nozzle.`);
  if (options.mode === 'walls') warnings.push('Cellular walls can create enclosed voids. Plan drainage for resin or powder printing.');
  return warnings;
}
function showInsights() {
  const s = result.stats;
  const density = Number.isFinite(s.relativeDensity) ? s.relativeDensity : s.volumeMm3 / s.sourceVolumeMm3;
  const finiteDensity = Number.isFinite(density) ? density : 0;
  $('densityNumber').textContent = `${(finiteDensity * 100).toFixed(1)}%`;
  $('densityBar').style.width = `${Math.max(0, Math.min(100, finiteDensity * 100))}%`;
  $('materialSaved').textContent = `${((1 - finiteDensity) * 100).toFixed(1)}%`;
  $('resultVolume').textContent = s.volumeMm3 < 1000 ? `${formatMm(s.volumeMm3)} mm³` : `${(s.volumeMm3 / 1000).toFixed(2)} cm³`;
  $('resultTriangles').textContent = (s.triangles ?? result.positions.length / 9).toLocaleString();
  $('resultComponents').textContent = s.components?.toLocaleString() ?? '—';
  $('resultSites').textContent = s.siteCount?.toLocaleString() ?? '—';
  $('resultResolution').textContent = s.meshingMethod === 'explicit-rods'
    ? s.regionVoxelSize > 0 ? `Rods · shell ${formatMm(s.regionVoxelSize)} mm` : 'Analytic rods'
    : Number.isFinite(s.voxelSize) ? `${formatMm(s.voxelSize)} mm` : '—';
  $('resultTime').textContent = `${generationSeconds.toFixed(1)} s`;
  const closed = s.boundaryEdges === 0 && s.nonManifoldEdges === 0 && (s.inconsistentWindingEdges || 0) === 0 && s.volumeMm3 > 0;
  $('meshCheck').textContent = closed ? 'Closed mesh · manifold edge checks passed' : 'Mesh checks need attention · STL export disabled';
  $('meshCheck').className = `check-state ${closed ? 'pass' : 'warn'}`;
  $('resultSummary').textContent = result.options.mode === 'surface'
    ? 'Connected surface rods with complete cross-sections and fused junctions.'
    : `${MODE_COPY[result.options.mode][0]} clipped to your source volume.`;
  renderWarnings(printWarnings());
}
async function generate() {
  if (!source || job || !$('designForm').reportValidity()) return;
  const started = performance.now();
  const revision = sourceRevision;
  const options = getOptions();
  setMeasuring(false);
  try {
    $('previewBadge').textContent = 'Generating';
    const message = await runJob({ type: 'generate', mesh: source, options });
    if (sourceRevision !== revision) return;
    if (!message.result?.positions?.length) throw new Error('No lattice was produced. Try thicker struts or smaller cells.');
    result = message.result;
    result.options = { ...options, ...result.options };
    generationSeconds = (performance.now() - started) / 1000;
    dirty = false;
    viewer?.setResult(result);
    updateDisplay();
    showInsights();
    $('previewBadge').textContent = 'Lattice ready';
    $('previewBadge').classList.remove('stale');
    refreshButtons();
    const meshing = result.stats.meshingMethod === 'explicit-rods' ? 'analytic rods' : Number.isFinite(result.stats.voxelSize) ? `sampling ${formatMm(result.stats.voxelSize)} mm` : 'geometry checked';
    status(`Lattice generated in ${generationSeconds.toFixed(1)} s. ${result.stats.triangles?.toLocaleString() ?? (result.positions.length / 9).toLocaleString()} triangles · ${meshing}. ${$('exportStl').disabled ? 'Inspect the geometry checks.' : 'Ready to export.'}`);
  } catch (error) {
    $('previewBadge').textContent = result ? dirty ? 'Settings changed' : 'Lattice ready' : 'Source model';
    status(error.message, error.name !== 'AbortError');
    refreshButtons();
  }
}
async function loadDemo(kind) {
  if (job) return;
  try {
    const message = await runJob({ type: 'demo', kind });
    acceptSource(message.mesh, `Example ${kind}`);
    sourceOrigin = { type: 'demo', kind };
    $('sourceUnits').value = '1';
    acceptedUnits = '1';
    preset($('preset').value === 'custom' ? 'open' : $('preset').value);
    status('Example loaded. Adjust the lattice or generate with these settings.');
  } catch (error) { status(error.message, error.name !== 'AbortError'); }
}
async function importFile(file) {
  if (!file || job) return;
  try {
    if (!/\.stl$/i.test(file.name)) throw new Error('Choose an ASCII or binary .stl file.');
    if (file.size > MAX_FILE_BYTES) throw new Error('This STL exceeds the 30 MB import limit. Simplify the source mesh and try again.');
    const buffer = await file.arrayBuffer();
    const previousSpan = source ? Math.max(...source.bounds.size) : null;
    const previousOptions = getOptions();
    const selected = $('preset').value;
    const message = await runJob({ type: 'import', buffer, unitScale: number('sourceUnits') });
    const fittedOptions = selected === 'custom' && previousSpan
      ? { ...scaleLatticeOptions(previousOptions, Math.max(...message.mesh.bounds.size) / previousSpan), resolution: 0 }
      : presetLatticeOptions(selected === 'custom' ? 'open' : selected, message.mesh.bounds, previousOptions);
    acceptSource(message.mesh, file.name);
    sourceOrigin = { type: 'file', buffer, name: file.name };
    acceptedUnits = $('sourceUnits').value;
    // New sources inherit pattern proportions. Project imports retain exact settings.
    applyOptions(fittedOptions);
    status('STL loaded. Lattice settings fitted to this model. Check its physical size or measure two points to set scale.');
  } catch (error) { status(error.message, error.name !== 'AbortError'); }
  finally { $('stlFile').value = ''; }
}
async function rescaleSource(targetSize, calibration = null) {
  if (!source || job) return;
  try {
    if (!Number.isFinite(targetSize) || targetSize < .000001 || targetSize > 100000) throw new Error('Enter a model size between 0.000001 and 100,000 mm.');
    const scale = targetSize / Math.max(...source.bounds.size);
    const anchor = source.bounds.min.map((v,d) => (v + source.bounds.max[d]) / 2);
    const previousOptions = getOptions();
    const selectedPreset = $('preset').value;
    const scaledOptions = $('scaleLatticeSettings').checked ? scaleLatticeOptions(previousOptions, scale) : previousOptions;
    const scaled = resizeSourceMesh(source, scale, anchor);
    const buffer = encodeBinarySTL(scaled.positions);
    const message = await runJob({ type: 'import', buffer, unitScale: 1 });
    acceptSource(message.mesh, sourceName);
    // The resized source is now the unit baseline; subsequent unit changes remain predictable.
    sourceOrigin = { type: 'file', buffer, name: sourceName };
    $('sourceUnits').value = '1';
    acceptedUnits = '1';
    applyOptions(scaledOptions);
    $('preset').value = $('scaleLatticeSettings').checked ? selectedPreset : 'custom';
    updateMode();
    if (calibration) {
      const points = calibration.points.map(p => p.map((v,d) => anchor[d] + (v-anchor[d]) * scale));
      viewer?.setMeasurementPoints(points);
      $('measurementTarget').value = calibration.target;
      refreshMeasurementControls();
      $('measurementPanel').open = true;
      status(`Scale set: selected distance is ${formatMm(calibration.target)} mm (${formatMm(scale)}×). Generate to rebuild the lattice.`);
    } else status(`Model resized to ${formatMm(targetSize)} mm (${formatMm(scale)}×). Generate to rebuild the lattice.`);
  } catch (error) { status(error.message, error.name !== 'AbortError'); }
}
function filename(suffix) {
  const base = sourceName.replace(/\.stl$/i, '').replace(/[^a-z0-9_.-]+/gi, '-').slice(0,80) || 'model';
  return `${base}-voronoi${suffix}`;
}
function download(data, name, type) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
function saveProject() {
  if (!source || job || !$('designForm').reportValidity()) return;
  try {
    const bytes = new Uint8Array(encodeBinarySTL(source.positions));
    let binary = '';
    for (let start = 0; start < bytes.length; start += 16384) binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
    const project = { type: 'printforge-voronoi', version: 1, name: sourceName,
      units: 'mm', sourceSTL: btoa(binary), options: getOptions(), nozzle: number('nozzle'), color: $('modelColor').value };
    download(JSON.stringify(project), filename('.json'), 'application/json');
    status('Project saved with its source STL and editable lattice settings.');
  } catch (error) { status(`Could not save project: ${error.message}`, true); }
}
async function loadProjectFile(file) {
  if (!file || job) return;
  try {
    if (file.size > MAX_FILE_BYTES * 1.5) throw new Error('This project exceeds the 45 MB project limit.');
    const project = JSON.parse(await file.text());
    if (project.type !== 'printforge-voronoi' || project.version !== 1 || typeof project.sourceSTL !== 'string' || !project.options || typeof project.options !== 'object') throw new Error('Choose a Voronoi lattice project saved by this studio.');
    if (project.sourceSTL.length > MAX_FILE_BYTES * 1.4) throw new Error('The embedded source STL is too large.');
    const binary = atob(project.sourceSTL);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const message = await runJob({ type: 'import', buffer: bytes.buffer, unitScale: 1 });
    const options = normalizeOptions(project.options, message.mesh.bounds);
    acceptSource(message.mesh, typeof project.name === 'string' ? project.name.slice(0,180) : 'Imported project');
    sourceOrigin = { type: 'file', buffer: bytes.buffer, name: sourceName };
    $('sourceUnits').value = '1';
    acceptedUnits = '1';
    applyOptions(options);
    $('preset').value = 'custom';
    if (['0.2','0.4','0.6','0.8','1'].includes(String(project.nozzle))) $('nozzle').value = project.nozzle;
    if (/^#[0-9a-f]{6}$/i.test(project.color)) $('modelColor').value = project.color;
    updateMode();
    updateDisplay();
    invalidate();
    status('Project loaded. Generate to rebuild its lattice.');
  } catch (error) { status(`Could not open project: ${error.message}`, error.name !== 'AbortError'); }
  finally { $('projectFile').value = ''; }
}

$('designForm').addEventListener('submit', event => { event.preventDefault(); generate(); });
$('cancel').addEventListener('click', cancel);
$('stlFile').addEventListener('change', event => importFile(event.target.files[0]));
$('demoShape').addEventListener('change', event => loadDemo(event.target.value));
$('resizeSource').addEventListener('click', () => rescaleSource(number('modelSize')));
$('measurementStart').addEventListener('click', () => {
  if (job || !source) return;
  if (!measuring && measurement.points.length === 2) viewer?.clearMeasurement();
  setMeasuring(!measuring);
  if (measuring) {
    status('Pick two points on the original mesh. Drag to orbit; click to place each point.');
    if (window.matchMedia('(max-width: 640px)').matches) $('latticeCanvas').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
$('measurementClear').addEventListener('click', () => { resetMeasurement(); status('Measurement cleared.'); });
$('measurementTarget').addEventListener('input', refreshMeasurementControls);
$('measurementApply').addEventListener('click', () => {
  if (job || !source || !$('measurementForm').reportValidity()) return;
  try {
    const target = number('measurementTarget');
    const points = measurement.points.map(point => [...point]);
    const factor = measurementScaleFactor(points, target);
    rescaleSource(Math.max(...source.bounds.size) * factor, { points, target });
  } catch (error) { status(error.message, true); }
});
$('measurementForm').addEventListener('submit', event => { event.preventDefault(); $('measurementApply').click(); });
$('sourceUnits').addEventListener('change', async () => {
  if (!sourceOrigin || job) return;
  if (sourceOrigin.type === 'demo') { $('sourceUnits').value = '1'; status('Examples use millimeters. Use Resize to change their dimensions.'); return; }
  try {
    const previousSpan = Math.max(...source.bounds.size);
    const previousOptions = getOptions();
    const message = await runJob({ type: 'import', buffer: sourceOrigin.buffer, unitScale: number('sourceUnits') });
    const scaledOptions = $('scaleLatticeSettings').checked ? scaleLatticeOptions(previousOptions, Math.max(...message.mesh.bounds.size) / previousSpan) : previousOptions;
    acceptSource(message.mesh, sourceOrigin.name);
    acceptedUnits = $('sourceUnits').value;
    applyOptions(scaledOptions);
    status('STL units updated. Check dimensions and regenerate.');
  } catch (error) { $('sourceUnits').value = acceptedUnits; status(error.message, error.name !== 'AbortError'); }
});
for (const name of ['dragenter','dragover']) $('dropZone').addEventListener(name, event => {
  event.preventDefault();
  if (!job) $('dropZone').classList.add('drag-over');
});
for (const name of ['dragleave','drop']) $('dropZone').addEventListener(name, event => {
  event.preventDefault();
  $('dropZone').classList.remove('drag-over');
  if (name === 'drop') importFile(event.dataTransfer.files[0]);
});
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
$('preset').addEventListener('change', () => preset($('preset').value));
$('shuffleSeed').addEventListener('click', () => {
  $('seed').value = crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647;
  invalidate();
});
const geometryIds = new Set(['cellSize','thickness','rodProfile','rodAspect','rodSides','rodRotation','randomness','seed','shellThickness','surfaceInset','bottomThickness','topThickness','stretchX','stretchY','stretchZ','gradientAxis','gradientStrength','quality','resolution','keepLargest']);
$('designControls').addEventListener('input', event => {
  if (event.target.id === 'cellSizeSlider' || event.target.id === 'thicknessSlider') {
    $(event.target.id.replace('Slider', '')).value = event.target.value;
    $('preset').value = 'custom';
    updateMode();
    invalidate();
  }
  if (geometryIds.has(event.target.id) || event.target.name === 'mode') {
    $('preset').value = 'custom';
    updateMode();
    invalidate();
  }
});
$('nozzle').addEventListener('change', () => { if (result) renderWarnings(printWarnings()); });
for (const id of ['showSource','showResult','wireframe','cutAxis','cut','modelColor']) $(id).addEventListener('input', updateDisplay);
$('fitView').addEventListener('click', () => viewer?.fit());
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => viewer?.preset(button.dataset.view));
$('exportStl').addEventListener('click', () => {
  if (!result || dirty || job || $('exportStl').disabled) return;
  try {
    download(encodeBinarySTL(result.positions), filename('.stl'), 'model/stl');
    status('STL exported in millimeters. The file includes the complete lattice; preview cutaway and color are not exported.');
  } catch (error) { status(`Could not export STL: ${error.message}`, true); }
});
$('exportReport').addEventListener('click', () => {
  if (!result || dirty || job) return;
  download(JSON.stringify({ studio: 'PrintForge Voronoi lattice', version: 1, source: sourceName,
    generatedAt: new Date().toISOString(), units: 'mm', bounds: source.bounds, options: result.options,
    stats: result.stats, generationSeconds, nozzleMm: number('nozzle'), warnings: printWarnings(),
    limitations: [result.stats.meshingMethod === 'explicit-rods' ? 'Explicit rod geometry; quality controls round-profile smoothness and curved-surface accuracy.' : 'Implicit sampled geometry; inspect the effective voxel size.', 'Edge topology checks do not certify mechanical strength or detect every self-intersection.', 'STL has no embedded units; use millimeters in your slicer.'] }, null, 2), filename('-report.json'), 'application/json');
  status('Geometry report downloaded.');
});
$('saveProject').addEventListener('click', saveProject);
$('loadProject').addEventListener('click', () => $('projectFile').click());
$('projectFile').addEventListener('change', event => loadProjectFile(event.target.files[0]));
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (job) cancel(); else setMeasuring(false); return; }
  if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(event.target.tagName)) return;
  if (event.key.toLowerCase() === 'f') { event.preventDefault(); viewer?.fit(); }
});
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  resetWorker();
  viewer?.destroy();
});
updateMode();
loadDemo('sphere');
