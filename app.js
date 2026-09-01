import { loadRecord, saveRecord } from './storage.js';
import { SHAPE_CATALOG, SHAPE_CATEGORIES, shapeInfo, shapeSvgMarkup, traceShapePath } from './shape-library.js';
import {
  ASIA_FILAMENT_PRESETS,
  ATTACHMENT_STYLE_INFO,
  DESIGN_LIMITS,
  DEFAULT_INVENTORY,
  RIM_STYLE_INFO,
  TEMPLATE_INFO,
  availability,
  buildChecks,
  calculateQuote,
  createTemplateProject,
  elementBounds,
  elementFitsSafeArea,
  enforceFlatBackArtwork,
  enrichForExport,
  escapeHtml,
  getPalette,
  hexToRgb,
  imageUsedSlots,
  medalContainsPoint,
  medalAttachmentGeometry,
  normalizeFilament,
  normalizeInventory,
  normalizeProject,
  normalizeProjectBundle,
  normalizeDrawnPath,
  offsetPolygon,
  polygonSelfIntersects,
  pointInPolygon,
  pointSegmentDistance,
  presetMedalOutlinePoints,
  projectUsedSlots,
  projectBackOffset,
  projectBundleForExport,
  simplifyClosedRing,
  simplifyPolyline,
  snapToLayer,
  uid,
} from './project-model.js';
import {
  buildMeshes,
  downloadBlob,
  meshesTo3mf,
  meshesToStlZip,
  projectToSvg,
  safeFilename,
} from './export-engine.js';
import { columnsToStep } from './cad-step-export.js';
import { MedalViewer3D, planarTransformBetween, viewerGeometryBudget } from './viewer3d.js';
import { buildColumnField, columnFieldToMeshes, meshCellForProject, raycastColumnField } from './geometry-engine.js';
import { applyImageStyle, detectMedalFaceCrop, indexedRasterFootprint, inferDominantSourceColors, inferMedalSurfaceColors, maskOutsideCircularFace, matchSourceColorsToFilaments, rasterRegionFootprint, removeConnectedBackground, segmentPaletteRegions, visibleArtworkCrop } from './image-processing.js';
import { CloudImageProvider } from './cloud-image-provider.js';
import { LocalImageProvider } from './local-image-provider.js';
import { buildTechnicalSheetPdf } from './report-engine.js';
import { generateMedalConcepts, parseMedalBrief } from './concept-engine.js';
import { LocalMedalPlanProvider } from './local-medal-provider.js';
import { OpenAiMedalProvider } from './openai-medal-provider.js';
import { CURATED_EXAMPLE_INFO, createCuratedExample } from './curated-examples.js';
import { RUNTIME_CONFIG, unavailableHostedCapability } from './runtime-config.js';
import { attachmentOpeningLabel, medalOverallSizeLabel, medalSizeLabel, medalTopViewSvg } from './medal-preview.js';
import { GUIDE_LIBRARY, guideAssetUrl, guideDurationLabel } from './guide-library.js';
import {
  classifyFilamentEffect,
  deriveFilamentRenderMaterial,
  normalizeRenderExportSize,
  normalizeRenderSettings,
} from './render-studio.js';
import {
  LANGUAGE_CHANGE_EVENT,
  formatLocalizedNumber,
  getCurrentLocale,
  getCurrentLocaleTag,
  initializeLocalization,
  localizeSubtree,
  translateUi,
  translateUiKey,
} from './localization-runtime.js?v=20260901-release36';

const QA_FIXTURE_ALIASES = Object.freeze({
  'final-premium-medal': 'showcase-night',
  'runner-ranking-final': 'showcase-night',
  'flat-back-final': 'photo-archive',
  'compact-final': 'photo-night',
  'export-smoke': 'blank',
  workflow: 'showcase-night',
});
const qaFixtureName = new URLSearchParams(window.location.search).get('qa')?.trim() || '';
const qaTemplate = QA_FIXTURE_ALIASES[qaFixtureName] || (CURATED_EXAMPLE_INFO[qaFixtureName] ? qaFixtureName : '');

const GALLERY_TEMPLATE_INFO = Object.freeze({
  ...TEMPLATE_INFO,
  ...Object.fromEntries(Object.entries(CURATED_EXAMPLE_INFO).map(([key, info]) => [key, {
    name: info.name,
    label: info.label,
    meta: info.description,
    preview: info.preview,
    className: info.className,
  }])),
});

const PREMIUM_GALLERY_KEYS = Object.freeze([
  'alpine-current-25k',
  'showcase-night',
  'aurora-polar-10k',
  'heritage-marathon-42',
  'podium-classic',
]);

// Earlier builds stored a multi-gigabyte browser model under this origin. The
// browser inference path is gone; quietly release that obsolete cache so it
// cannot keep consuming customer disk space after an upgrade.
if (globalThis.caches?.delete) void globalThis.caches.delete('transformers-cache').catch(() => {});

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const canvas = $('#medalCanvas');
const ctx = canvas.getContext('2d');
const modelCanvas = $('#modelCanvas');
const dialog = $('#appDialog');
initializeLocalization({ context: 'studio' });
const imageCache = new Map();
const sliceCanvas = document.createElement('canvas');
const MAX_ARTWORK_BYTES = 24 * 1024 * 1024;
const CLOUD_ARTWORK_STYLES = new Set(['photo-medal', 'photo-subject', 'illustration', 'graphic', 'silhouette']);
const CLOUD_ARTWORK_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536']);
const CLOUD_ARTWORK_QUALITIES = new Set(['high', 'medium', 'low']);
const IMAGE_GENERATOR_MODES = new Set(['local', 'cloud']);
const MEDAL_GENERATOR_MODES = new Set(['local', 'openai']);

function storedCloudChoice(key, allowed, fallback) {
  if (qaTemplate) return fallback;
  const value = localStorage.getItem(key);
  return allowed.has(value) ? value : fallback;
}

function setLocalPreference(key, value) {
  if (!qaTemplate) localStorage.setItem(key, value);
}

function removeLocalPreference(key) {
  if (!qaTemplate) localStorage.removeItem(key);
}

const state = {
  project: null,
  inventory: [],
  panel: 'create',
  createTool: 'text',
  view: '3d',
  inspectionOpen: false,
  pendingInsert: null,
  placementEcho: null,
  transformDrag: null,
  gizmoDrag: null,
  modelDrag: null,
  hoveredId: null,
  proxyCache: null,
  proxyOwner: null,
  proxyRenderedKey: null,
  sketchCamera: null,
  pocketFillMode: false,
  zoom: 1,
  selectedId: null,
  quantity: 25,
  checks: [],
  quote: null,
  history: [],
  future: [],
  drag: null,
  alignmentGuides: null,
  saveTimer: null,
  savePromise: null,
  saveRevision: 0,
  saveDirty: false,
  lastSavedSnapshot: null,
  lastRecoveryAt: 0,
  projectLibrary: [],
  exportJob: null,
  exportPreflightId: null,
  libraryRequestId: null,
  toastTimer: null,
  inspectorEditStart: null,
  inlineTextEditStart: null,
  viewer: null,
  viewerRevision: 1,
  viewerBuiltRevision: -1,
  viewerBuildToken: 0,
  viewerTimer: null,
  viewerMeshes: [],
  viewerStats: null,
  viewerResult: null,
  geometryRevision: -1,
  geometryPromise: null,
  geometryWorker: null,
  sliceBitmap: null,
  sliceLayer: null,
  sectionCache: null,
  imageReprocessToken: 0,
  imageReprocessBusy: false,
  imageLoadToken: 0,
  imageWorker: null,
  imageEditor: null,
  dialogCleanup: null,
  wizard: null,
  galleryReturnFocus: null,
  settingsReturnFocus: null,
  dialogReturnFocus: null,
  renderStudio: null,
  qaMode: Boolean(qaTemplate),
  qaOnboardingSteps: new Set(),
  liveEdit: null,
  conceptCandidates: [],
  conceptBrief: '',
  conceptGeneratorMode: storedCloudChoice('medalforge-medal-generator', MEDAL_GENERATOR_MODES, 'local'),
  conceptGenerationBusy: false,
  conceptGenerationError: null,
  conceptGenerationProgress: '',
  conceptGenerationMeta: null,
  conceptProviderStatus: null,
  conceptProviderProbeBusy: false,
  conceptAbortController: null,
  imageGeneratorMode: storedCloudChoice('medalforge-image-generator', IMAGE_GENERATOR_MODES, 'local'),
  localArtworkBrief: '',
  localArtworkStyle: storedCloudChoice('medalforge-ai-style', CLOUD_ARTWORK_STYLES, 'photo-medal'),
  localArtworkSize: storedCloudChoice('medalforge-ai-size', CLOUD_ARTWORK_SIZES, '1024x1024'),
  localArtworkQuality: storedCloudChoice('medalforge-ai-quality', CLOUD_ARTWORK_QUALITIES, 'high'),
  localArtworkCount: qaTemplate ? 1 : Math.max(1, Math.min(4, Number(localStorage.getItem('medalforge-ai-count')) || 1)),
  localAiBusy: false,
  localAiStatus: null,
  localAiPhase: 'idle',
  localAiProgress: null,
  localAiCapability: null,
  localAiProbeBusy: false,
  localAiProbePromise: null,
  localAiProbeToken: 0,
  localAiError: null,
  cloudImageGenerator: null,
  localImageGenerator: null,
  cloudImageAbortController: null,
  ribbonPreviewVisible: qaTemplate ? false : localStorage.getItem('medalforge-ribbon-visible') === '1',
  ribbonPreviewColor: qaTemplate ? '#2458d8' : localStorage.getItem('medalforge-ribbon-color') || '#2458d8',
  onboardingDismissed: qaTemplate ? true : localStorage.getItem('medalforge-onboarding-dismissed') === '1',
  canvasEmptyDismissedProjectId: qaTemplate ? '' : localStorage.getItem('medalforge-empty-card-dismissed-project') || '',
  drawing: {
    mode: 'select', face: 'front', strokeWidth: .9, color: 1, operation: 'raise', height: .6, depth: .4, snap: true, grid: .5,
    active: false, pointerId: null, points: [], hover: null, before: null,
    erasedIds: new Set(), measurement: null,
  },
};

function toast(message, options = {}) {
  const element = $('#toast');
  element.textContent = translateUi(message);
  element.classList.toggle('error', Boolean(options.error));
  element.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { element.classList.remove('show'); element.classList.remove('error'); }, options.error ? 8000 : 2400);
}

function announce(message) {
  const output = $('#a11yStatus');
  if (!output) return;
  output.textContent = '';
  requestAnimationFrame(() => { output.textContent = translateUi(message); });
}

function snapshot() { return JSON.stringify(state.project); }

function fixtureProject() {
  if (!qaTemplate) return null;
  return CURATED_EXAMPLE_INFO[qaTemplate] ? createCuratedExample(qaTemplate) : createTemplateProject(qaTemplate);
}

async function saveUserRecord(store, key, value) {
  if (state.qaMode) return null;
  return saveRecord(store, key, value);
}

function cancelGeometryWorker() {
  const job = state.geometryWorker;
  if (!job) return;
  state.geometryWorker = null;
  job.worker.terminate();
  const error = new Error('Superseded by a newer design revision');
  error.name = 'AbortError';
  job.reject(error);
}

function invalidateImageReprocessing() {
  state.imageReprocessToken += 1;
  state.imageReprocessBusy = false;
  if (!state.imageWorker) return;
  const job = state.imageWorker;
  state.imageWorker = null;
  job.worker.terminate();
  const error = new Error('Image conversion cancelled');
  error.name = 'AbortError';
  job.reject(error);
}

function markSavePending() {
  const label = $('#saveState');
  if (state.qaMode) {
    clearTimeout(state.saveTimer);
    label.textContent = 'QA fixture · temporary';
    label.classList.remove('saving');
    return;
  }
  state.saveRevision += 1;
  state.saveDirty = true;
  label.textContent = 'Saving…';
  label.classList.add('saving');
  label.classList.remove('error');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(persistProject, 550);
}

function markDirty() {
  state.viewerRevision += 1;
  cancelGeometryWorker();
  state.sliceBitmap = null;
  state.sectionCache = null;
  if (state.view === '3d') {
    clearTimeout(state.viewerTimer);
    state.viewerTimer = setTimeout(() => ensure3DModel(), 260);
  } else if (state.view === 'toolpath') {
    clearTimeout(state.viewerTimer);
    state.viewerTimer = setTimeout(() => ensureSliceGeometry(), 260);
  }
  markSavePending();
}

async function persistProject() {
  if (!state.project) return false;
  if (state.qaMode) {
    const label = $('#saveState');
    label.textContent = 'QA fixture · temporary';
    label.classList.remove('saving');
    return true;
  }
  if (state.liveEdit) {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(persistProject, 550);
    return false;
  }
  if (state.savePromise) {
    await state.savePromise;
    if (!state.saveDirty) return true;
  }
  state.project.id = String(state.project.id || uid('project')).slice(0, 120);
  state.project.createdAt ||= new Date().toISOString();
  state.project.updatedAt = new Date().toISOString();
  const label = $('#saveState');
  const revision = state.saveRevision;
  const operation = (async () => {
    const currentSnapshot = snapshot();
    const projectRecord = JSON.parse(currentSnapshot);
    const now = Date.now();
    if (state.lastSavedSnapshot && state.lastSavedSnapshot !== currentSnapshot && now - state.lastRecoveryAt > 60_000) {
      await saveUserRecord('projects', `recovery-${state.project.id}`, JSON.parse(state.lastSavedSnapshot));
      state.lastRecoveryAt = now;
    }
    await saveUserRecord('projects', 'active', projectRecord);
    await saveUserRecord('projects', projectRecord.id, projectRecord);
    const meta = { id: projectRecord.id, name: projectRecord.name, createdAt: projectRecord.createdAt, updatedAt: projectRecord.updatedAt, elements: projectRecord.elements.length, colors: projectRecord.paletteIds.length };
    const library = Array.isArray(state.projectLibrary) ? state.projectLibrary : [];
    state.projectLibrary = [meta, ...library.filter(item => item?.id !== meta.id)].slice(0, 24);
    await saveUserRecord('settings', 'project-library', state.projectLibrary);
    return currentSnapshot;
  })();
  state.savePromise = operation;
  try {
    const savedSnapshot = await operation;
    const stillCurrent = revision === state.saveRevision && snapshot() === savedSnapshot;
    if (stillCurrent) {
      state.lastSavedSnapshot = savedSnapshot;
      state.saveDirty = false;
      label.textContent = 'Saved on this device';
      label.classList.remove('saving', 'error');
      label.title = 'Open your saved medals';
    } else {
      state.saveDirty = true;
      label.textContent = 'Saving latest changes…';
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(persistProject, 0);
    }
    return true;
  } catch (error) {
    state.saveDirty = true;
    label.textContent = 'Save failed · backup';
    label.classList.remove('saving');
    label.classList.add('error');
    label.title = 'Storage is full or unavailable. Click to download an emergency backup.';
    console.error('Could not save project', error);
    if (window.matchMedia?.('(max-width: 900px)')?.matches) toast('Autosave failed · open My medals to download a backup', { error: true });
    return false;
  } finally {
    if (state.savePromise === operation) state.savePromise = null;
  }
}

function renderLiveEditBar() {
  const bar = $('#liveEditBar');
  if (!bar) return;
  const live = state.liveEdit;
  bar.hidden = !live;
  $('#canvasWrap')?.classList.toggle('live-editing', Boolean(live));
  if (live) $('#liveEditLabel').textContent = live.label || 'Previewing change';
}

function finalizeLiveEdit({ render = true, silent = false } = {}) {
  const live = state.liveEdit;
  if (!live) return false;
  state.liveEdit = null;
  state.project = normalizeProject(state.project);
  clearElementProxy('pending');
  const changed = live.before !== snapshot();
  const changedElement = state.project.elements.find(item => item.id === live.elementId);
  const refreshImageMasks = changed && ['transform', '2d-transform'].includes(live.kind) && changedElement?.type === 'image' && changedElement.sourceDataUrl;
  if (changed) {
    pushHistory(live.before);
    markDirty();
  }
  renderLiveEditBar();
  if (render) renderAll({ panel: state.panel === 'layers' });
  if (refreshImageMasks) reprocessImportedImages('image scale change', live.elementId);
  if (!silent) toast(changed ? 'Change applied' : 'Nothing changed');
  return changed;
}

function cancelLiveEdit({ silent = false } = {}) {
  const live = state.liveEdit;
  if (!live) return false;
  state.project = normalizeProject(JSON.parse(live.before));
  state.liveEdit = null;
  clearElementProxy('pending');
  renderLiveEditBar();
  renderAll({ panel: true });
  if (!silent) toast('Change cancelled');
  return true;
}

function stageLiveEdit(kind, before, elementId, label) {
  if (!before || before === snapshot()) return false;
  if (state.liveEdit) return false;
  state.project = normalizeProject(state.project);
  state.liveEdit = { kind, before, elementId, label };
  const element = state.project.elements.find(item => item.id === elementId);
  if (element) showElementProxy(element, 'pending', .48);
  renderLiveEditBar();
  renderInspector();
  renderSelectionHud();
  renderPushPullGizmo();
  renderTransformGizmo();
  return true;
}

function commitPlanarEdit(kind, before, elementId, label) {
  if (!before) return false;
  state.project = normalizeProject(state.project);
  const changed = before !== snapshot();
  const element = state.project.elements.find(item => item.id === elementId);
  if (!changed) {
    clearElementProxy('drag');
    renderAll({ panel: state.panel === 'layers' });
    return false;
  }
  pushHistory(before);
  state.project.template = 'custom';
  if (element) showElementProxy(element, 'rebuild', .76);
  markDirty();
  // Planar gestures are complete on pointer-up. Rebuild immediately so the
  // compiled printable body replaces the lightweight drag proxy without an
  // extra OK click; push/pull remains the deliberate confirmable operation.
  if (state.view === '3d') {
    clearTimeout(state.viewerTimer);
    state.viewerTimer = setTimeout(() => ensure3DModel(), 16);
  }
  renderAll({ panel: state.panel === 'layers' });
  const stageHint = $('#stageHint');
  if (stageHint && element) stageHint.textContent = `${element.name} updated · drag the center or corner handles to continue`;
  if (['transform', '2d-transform'].includes(kind) && element?.type === 'image' && element.sourceDataUrl) {
    reprocessImportedImages('image scale change', elementId);
  }
  toast(label || 'Object updated');
  return true;
}

function pushHistory(before) {
  if (!before || before === snapshot()) return;
  state.history.push(before);
  if (state.history.length > 30) state.history.shift();
  let storedCharacters = state.history.reduce((total, entry) => total + entry.length, 0);
  while (state.history.length > 1 && storedCharacters > 16_000_000) storedCharacters -= state.history.shift().length;
  state.future.length = 0;
}

function commit(mutator, options = {}) {
  if (state.liveEdit) {
    toast('Press OK or Cancel before making another change');
    return false;
  }
  const before = snapshot();
  mutator(state.project);
  state.project = normalizeProject(state.project);
  if (before === snapshot()) { renderAll(options); return false; }
  pushHistory(before);
  markDirty();
  renderAll(options);
  return true;
}

function mergeRequiredDefaultFilaments(inventory, paletteIds = []) {
  const catalog = normalizeInventory(inventory);
  const known = new Set(catalog.map(filament => filament.id));
  const defaults = new Map(DEFAULT_INVENTORY.map((filament, index) => [filament.id, normalizeFilament(filament, index)]));
  let added = false;
  for (const id of paletteIds) {
    if (known.has(id) || !defaults.has(id)) continue;
    catalog.push({ ...defaults.get(id), stockGrams: 0, stockKnown: false });
    known.add(id);
    added = true;
  }
  return { inventory: normalizeInventory(catalog), added };
}

function resetViewerWorkspace() {
  state.inspectionOpen = false;
  state.sliceLayer = null;
  state.sketchCamera = null;
  state.zoom = 1;
  state.viewerMeshes = [];
  state.viewerResult = null;
  state.viewerStats = null;
  state.hoveredId = null;
  $('#zoomLabel').textContent = '3D';
  $('#explodeSlider').value = '0';
  $('#explodeLabel').textContent = '0.0 mm';
  $('#layerSlider').value = '1';
  $('#layerLabel').textContent = 'All';
  $('#toggleInspectLayers').classList.remove('active');
  $('#toggleInspectLayers').setAttribute('aria-expanded', 'false');
  $('#slicerDock').hidden = true;
  updateProjectionToggle('perspective');
  $('#viewerGrid').checked = true;
  $('#viewerRibbon').checked = state.ribbonPreviewVisible;
  $('#viewerRibbonColor').value = state.ribbonPreviewColor;
  $('#surfaceProbe').hidden = true;
  $$('[data-camera]').forEach(button => button.classList.toggle('active', button.dataset.camera === 'iso'));
  state.viewer?.resetWorkspace();
}

function updateProjectionToggle(projection = 'perspective') {
  const button = $('#projectionToggle');
  if (!button) return;
  const normalized = projection === 'orthographic' ? 'orthographic' : 'perspective';
  button.dataset.projection = normalized;
  button.textContent = translateUiKey(normalized === 'orthographic' ? 'camera.orthographic' : 'camera.perspective');
  button.title = translateUiKey(normalized === 'orthographic' ? 'camera.switchPerspective' : 'camera.switchOrthographic');
  button.setAttribute('aria-label', button.title);
}

function renderLocalizedWorkspaceChrome() {
  $('#medalCanvas')?.setAttribute('aria-label', translateUiKey('accessibility.sketchCanvasDetailed'));
  const shortcuts = $('#stageShortcuts');
  if (shortcuts) shortcuts.innerHTML = `<kbd>Del</kbd> ${escapeHtml(translateUiKey('accessibility.shortcutDelete'))} · <kbd>[ ]</kbd> ${escapeHtml(translateUiKey('accessibility.shortcutHeight'))} · <kbd>Ctrl Z</kbd> ${escapeHtml(translateUiKey('accessibility.shortcutUndo'))} · ${escapeHtml(translateUiKey('accessibility.shortcutMove'))}`;
}

function setCameraPreset(preset, { speak = false, workspace = true } = {}) {
  const normalized = ['iso', 'top', 'bottom', 'front', 'right'].includes(preset) ? preset : 'iso';
  $$('[data-camera]').forEach(button => button.classList.toggle('active', button.dataset.camera === normalized));
  state.viewer?.setPreset(normalized);
  if (normalized === 'top' || normalized === 'bottom') {
    state.drawing.face = normalized === 'bottom' ? 'back' : 'front';
    if (workspace) {
      $('#workspaceModeLabel').textContent = state.drawing.face === 'back' ? 'Back side · flat colors' : 'Front side · raised or recessed';
      $('#workspaceModeHelp').textContent = state.drawing.face === 'back' ? 'New artwork is embedded flush into the first print layer' : 'Click artwork to edit · drag the blue height handle to raise or recess';
    }
  } else if (workspace) {
    $('#workspaceModeLabel').textContent = '3D medal';
    $('#workspaceModeHelp').textContent = 'Drag empty space to rotate · click artwork to edit it';
  }
  if (speak) announce(({ top: 'Front side', bottom: 'Back side', iso: '3D view', front: 'Edge view', right: 'Side view' })[normalized]);
}

function replaceProject(project) {
  const before = snapshot();
  invalidateImageReprocessing();
  state.liveEdit = null;
  renderLiveEditBar();
  cancelPlacement();
  cancelDrawing(false);
  clearElementProxy();
  state.gizmoDrag = null;
  state.modelDrag = null;
  state.transformDrag = null;
  state.project = normalizeProject(project);
  state.project.id = String(state.project.id || uid('project')).slice(0, 120);
  state.project.createdAt ||= new Date().toISOString();
  state.lastSavedSnapshot = null;
  const catalog = mergeRequiredDefaultFilaments(state.inventory, state.project.paletteIds);
  state.inventory = catalog.inventory;
  if (catalog.added) saveUserRecord('inventory', 'catalog', state.inventory).catch(error => console.error('Could not extend the local filament catalog', error));
  resetViewerWorkspace();
  state.drawing.face = 'front';
  state.drawing.operation = 'raise';
  state.drawing.measurement = null;
  state.pocketFillMode = false;
  syncDrawingDefaults(true);
  pushHistory(before);
  state.selectedId = null;
  state.panel = 'create';
  state.createTool = 'text';
  state.drawing.mode = 'select';
  resetOnboardingProgress();
  setView('3d');
  markDirty();
  renderAll({ panel: true });
}

function undo() {
  if (state.liveEdit) { cancelLiveEdit(); return; }
  if (!state.history.length) return;
  invalidateImageReprocessing();
  state.future.push(snapshot());
  state.project = normalizeProject(JSON.parse(state.history.pop()));
  syncDrawingDefaults(false);
  if (!state.project.elements.some(element => element.id === state.selectedId)) state.selectedId = state.project.elements.at(-1)?.id || null;
  markDirty();
  renderAll({ panel: true });
  toast('Undid last change');
}

function redo() {
  if (state.liveEdit) { cancelLiveEdit(); return; }
  if (!state.future.length) return;
  invalidateImageReprocessing();
  state.history.push(snapshot());
  state.project = normalizeProject(JSON.parse(state.future.pop()));
  syncDrawingDefaults(false);
  if (!state.project.elements.some(element => element.id === state.selectedId)) state.selectedId = state.project.elements.at(-1)?.id || null;
  markDirty();
  renderAll({ panel: true });
  toast('Redid last change');
}

function selectedElement() { return state.project.elements.find(element => element.id === state.selectedId) || null; }

function medalBottomZ(project = state.project) {
  if (project === state.project && state.geometryRevision === state.viewerRevision && Number.isFinite(state.viewerResult?.diagnostics?.backOffset)) return state.viewerResult.diagnostics.backOffset;
  return projectBackOffset(project);
}
function medalTopZ(project = state.project) { return medalBottomZ(project) + project.medal.baseThickness; }

function prismTrianglesFromQuad(quad, z0, z1) {
  const triangles = [];
  const point = (index, z) => [quad[index][0], quad[index][1], z];
  const triangle = (a, b, c) => triangles.push(...a, ...b, ...c);
  triangle(point(0, z1), point(1, z1), point(2, z1)); triangle(point(0, z1), point(2, z1), point(3, z1));
  triangle(point(0, z0), point(2, z0), point(1, z0)); triangle(point(0, z0), point(3, z0), point(2, z0));
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    triangle(point(index, z0), point(next, z0), point(next, z1));
    triangle(point(index, z0), point(next, z1), point(index, z1));
  }
  return triangles;
}

function ribbonStrip(start, end, width, z0, z1, color, opacity = .84) {
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy) || 1;
  const px = -dy / length * width / 2, py = dx / length * width / 2;
  const quad = [[start.x + px, start.y + py], [end.x + px, end.y + py], [end.x - px, end.y - py], [start.x - px, start.y - py]];
  return { name: 'Ribbon preview', color, opacity, triangles: prismTrianglesFromQuad(quad, z0, z1) };
}

function buildRibbonPreviewMeshes(options = {}) {
  const visible = options.visible ?? state.ribbonPreviewVisible;
  if (!state.project || !visible || state.project.medal.loopStyle === 'none') return [];
  const geometry = medalAttachmentGeometry(state.project);
  const color = options.color || state.ribbonPreviewColor;
  const bottom = medalBottomZ(), top = medalTopZ();
  const opening = geometry.aperture || geometry.apertures?.[0];
  const anchorY = geometry.apertures?.length
    ? geometry.apertures.reduce((sum, item) => sum + (item.y0 + item.y1) / 2, 0) / geometry.apertures.length
    : opening?.cy ?? ((opening?.y0 || geometry.top) + (opening?.y1 || geometry.top)) / 2;
  const openingWidth = geometry.apertures?.length
    ? Math.max(...geometry.apertures.map(item => item.x1)) - Math.min(...geometry.apertures.map(item => item.x0))
    : opening?.diameter || opening?.width || state.project.medal.slitWidth || 18;
  const width = Math.max(7, Math.min(38, openingWidth - 1));
  const lengthScale = Math.max(.35, Math.min(1.4, Number(options.lengthScale) || 1));
  const farY = geometry.top - Math.max(18, Math.max(42, state.project.medal.height * .78) * lengthScale);
  const thickness = .42;
  if (geometry.external) {
    return [
      ribbonStrip({ x: 0, y: anchorY + 1.2 }, { x: 0, y: farY }, width, top + .28, top + .28 + thickness, color, .88),
      ribbonStrip({ x: 0, y: anchorY - 1.2 }, { x: 0, y: farY }, width, bottom - .28 - thickness, bottom - .28, color, .66),
    ];
  }
  const branchWidth = Math.max(5, Math.min(15, width * .48));
  const spread = Math.max(branchWidth * .62, Math.min(width * .42, 9));
  const anchorSpread = geometry.style === 'eyelet' ? Math.max(1.2, openingWidth * .2) : Math.max(2.5, width * .28);
  return [
    ribbonStrip({ x: -anchorSpread, y: anchorY }, { x: -spread, y: farY }, branchWidth, top + .28, top + .28 + thickness, color, .88),
    ribbonStrip({ x: anchorSpread, y: anchorY }, { x: spread, y: farY }, branchWidth, top + .3, top + .3 + thickness, color, .88),
  ];
}

function updateRibbonPreview() {
  state.viewer?.setDecorMeshes(buildRibbonPreviewMeshes());
}

const OPERATION_INFO = {
  raise: { label: 'Raised', short: 'Raised', icon: '＋', help: 'Adds material above the medal face.' },
  engrave: { label: 'Recessed', short: 'Recessed', icon: '↓', help: 'Presses the design into the medal while keeping a solid floor.' },
  inlay: { label: 'Flat color', short: 'Flat color', icon: '◆', help: 'Places another filament color flush inside the medal face.' },
  cut: { label: 'Hole', short: 'Hole', icon: '○', help: 'Removes material through the full medal.' },
};

function operationDefaults(element = {}) {
  return {
    face: element.face === 'back' || (!element.face && state.drawing.face === 'back') ? 'back' : 'front',
    scaleX: Number(element.scaleX) || 1,
    scaleY: Number(element.scaleY) || 1,
    lockAspect: element.lockAspect !== false,
    operation: element.operation || state.drawing.operation || 'raise',
    zHeight: element.zHeight ?? state.drawing.height ?? state.project.medal.defaultHeight,
    zDepth: element.zDepth ?? state.drawing.depth ?? Math.min(.4, state.project.medal.baseThickness - state.project.medal.minimumFloor),
    inlayHeight: element.inlayHeight || 0,
    layerSnap: element.layerSnap !== false,
    combine: element.combine === 'stack' ? 'stack' : 'replace',
    locked: Boolean(element.locked),
  };
}

function syncDrawingDefaults(reset = false) {
  if (!state.project) return;
  const layer = state.project.profile.layerHeight;
  const availableDepth = Math.max(.05, state.project.medal.baseThickness - state.project.medal.minimumFloor);
  state.drawing.color = Math.max(0, Math.min(state.project.paletteIds.length - 1, state.drawing.color));
  state.drawing.height = snapToLayer(reset ? state.project.medal.defaultHeight : state.drawing.height, layer);
  const requestedDepth = reset ? Math.min(.4, availableDepth) : state.drawing.depth;
  state.drawing.depth = Math.max(.05, Math.min(availableDepth, snapToLayer(requestedDepth, layer)));
  if (reset) state.drawing.strokeWidth = Math.max(.4, state.project.profile.nozzle * 2.25);
}

function operationValue(element) {
  if (element.operation === 'raise') return element.zHeight;
  if (element.operation === 'inlay' || element.operation === 'engrave') return element.zDepth;
  return state.project.medal.baseThickness;
}

function localizedPluralMessage(keyBase, count, variables = {}) {
  const numeric = Math.max(0, Number(count) || 0);
  const category = new Intl.PluralRules(getCurrentLocaleTag()).select(numeric);
  const suffix = category === 'one' ? 'One' : category === 'few' ? 'Few' : 'Many';
  return translateUiKey(`${keyBase}${suffix}`, { ...variables, count: formatLocalizedNumber(numeric) });
}

function localizedCount(base, count) {
  return localizedPluralMessage(`dynamicUi.${base}`, count);
}

function localizedFixed(value, digits = 2) {
  return formatLocalizedNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function localizedElementType(type) {
  const key = { text: 'objectText', image: 'objectImage', shape: 'objectShape', path: 'objectPath' }[type];
  return key ? translateUiKey(`dynamicUi.${key}`) : String(type || '');
}

function localizedOperationLabel(operation) {
  const key = { raise: 'raised', engrave: 'recessed', inlay: 'flat', cut: 'throughHole' }[operation] || 'raised';
  return translateUiKey(`text.${key}`);
}

function localizedAvailability(filament) {
  const status = availability(filament);
  return { ...status, label: translateUiKey(`stockStatusUi.${status.key}`) };
}

function localizedMedalShapeName(shape) {
  const key = {
    circle: 'circle', oval: 'oval', rounded: 'rounded', hexagon: 'hexagon', octagon: 'octagon',
    scalloped: 'scalloped', star: 'star', gear: 'gear', shield: 'shield', custom: 'custom',
  }[shape] || 'circle';
  return translateUiKey(`galleryData.shapes.${key}`);
}

function localizedAttachmentName(style) {
  const key = {
    single: 'singleLabel', double: 'doubleLabel', eyelet: 'eyeletLabel', slit: 'slitLabel',
    'open-slit': 'openSlitLabel', none: 'noneLabel',
  }[style] || 'noneLabel';
  return translateUiKey(`galleryData.attachment.${key}`);
}

function localizedPreviewOptions() {
  return {
    formatNumber: value => formatLocalizedNumber(value, { maximumFractionDigits: 1 }),
    formatMessage: (key, variables) => translateUiKey(`wizardUi.${key}`, variables),
  };
}

function localizedMedalSize(project) { return medalSizeLabel(project, localizedPreviewOptions()); }
function localizedMedalOverallSize(project) { return medalOverallSizeLabel(project, localizedPreviewOptions()); }
function localizedAttachmentOpening(project) { return attachmentOpeningLabel(project, localizedPreviewOptions()); }

function layerCountLabel(value, layerHeight = state.project.profile.layerHeight) {
  const ratio = Math.max(0, Number(value) || 0) / Math.max(.01, Number(layerHeight) || .2);
  const nearest = Math.round(ratio);
  if (Math.abs(ratio - nearest) <= .02) return localizedCount('layer', nearest);
  const readable = Number(ratio.toFixed(2));
  const category = new Intl.PluralRules(getCurrentLocaleTag()).select(readable);
  const suffix = category === 'one' ? 'One' : category === 'few' ? 'Few' : 'Many';
  return translateUiKey(`dynamicUi.approxLayer${suffix}`, { count: formatLocalizedNumber(readable, { maximumFractionDigits: 2 }) });
}

function snapProjectLayerHeights(project) {
  const layer = project.profile.layerHeight;
  const availableDepth = Math.max(.05, project.medal.baseThickness - project.medal.minimumFloor);
  project.medal.defaultHeight = Math.min(DESIGN_LIMITS.reliefHeightMax, snapToLayer(project.medal.defaultHeight, layer));
  project.medal.reliefHeight = project.medal.defaultHeight;
  project.medal.rimHeight = Math.min(DESIGN_LIMITS.rimHeightMax, snapToLayer(project.medal.rimHeight, layer));
  for (const element of project.elements) {
    if (element.layerSnap === false || element.operation === 'cut') continue;
    if (element.operation === 'raise') element.zHeight = Math.min(DESIGN_LIMITS.reliefHeightMax, snapToLayer(element.zHeight, layer));
    else element.zDepth = availableDepth < layer ? availableDepth : Math.min(availableDepth, snapToLayer(element.zDepth, layer));
    if (element.operation === 'inlay' && element.inlayHeight > 0) element.inlayHeight = Math.min(DESIGN_LIMITS.inlayHeightMax, snapToLayer(element.inlayHeight, layer));
  }
}

function operationDescription(element) {
  if (element.face === 'back') return `${translateUiKey('common.backSide')} · ${translateUiKey('text.flat')} · ${localizedFixed(element.zDepth)} mm · ${layerCountLabel(element.zDepth)}`;
  const face = translateUiKey(element.face === 'back' ? 'common.backSide' : 'common.front');
  const operation = localizedOperationLabel(element.operation);
  if (element.operation === 'cut') return `${face} · ${operation} · ${translateUiKey('dynamicUi.full')} ${localizedFixed(state.project.medal.baseThickness)} mm`;
  const value = operationValue(element);
  return `${face} · ${operation} · ${localizedFixed(value)} mm · ${layerCountLabel(value)}`;
}

function panelHeading(eyebrow, title) {
  return `<div class="panel-heading"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1></div><button class="icon-button panel-collapse" aria-label="Close panel">‹</button></div>`;
}

function inlineAddColorButtonHtml(context, options = {}) {
  const atLimit = state.project.paletteIds.length >= DESIGN_LIMITS.paletteSlots;
  const disabled = Boolean(options.disabled) || atLimit;
  const compact = Boolean(options.compact);
  const label = atLimit ? `${DESIGN_LIMITS.paletteSlots} colors maximum` : (options.label || 'Add filament color');
  return `<button type="button" class="add-color-button ${compact ? 'compact' : ''}" data-add-design-color="${escapeHtml(context)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" ${disabled ? 'disabled' : ''}><b aria-hidden="true">＋</b>${compact ? '' : `<span>${escapeHtml(atLimit ? 'Color limit' : (options.label || 'Add color'))}</span>`}</button>`;
}

const FILAMENT_EFFECT_CHOICES = Object.freeze([
  { value: 'Solid', label: 'Solid', icon: '●', hint: 'Clean, consistent everyday color.', abrasive: false },
  { value: 'Matte', label: 'Matte', icon: '◐', hint: 'Soft low-gloss finish that hides layer reflections.', abrasive: false },
  { value: 'Silk', label: 'Silk', icon: '✦', hint: 'Glossy metallic-looking finish.', abrasive: false },
  { value: 'Glow in dark', label: 'Glow', icon: '☾', hint: 'Stores light and glows in darkness. A hardened nozzle is recommended.', abrasive: true },
  { value: 'Wood-filled', label: 'Wood-filled', icon: '▥', hint: 'Natural fiber appearance. A 0.6 mm nozzle is recommended.', abrasive: true },
  { value: 'Carbon fiber-filled', label: 'Carbon fiber', icon: '▦', hint: 'Stiff textured composite. Requires a hardened nozzle.', abrasive: true },
  { value: 'Galaxy', label: 'Galaxy / glitter', icon: '✺', hint: 'Sparkle particles. A hardened nozzle is recommended.', abrasive: true },
  { value: 'Temperature changing', label: 'Temperature changing', icon: '◒', hint: 'Changes visible color as its temperature changes.', abrasive: false },
  { value: 'UV color changing', label: 'UV color changing', icon: '☀', hint: 'Changes color when exposed to ultraviolet light.', abrasive: false },
  { value: 'Fluorescent', label: 'Fluorescent', icon: '◉', hint: 'Highly vivid color that reacts strongly under UV light.', abrasive: false },
  { value: 'Transparent / translucent', label: 'Translucent', icon: '◌', hint: 'Lets some light pass through thin regions.', abrasive: false },
  { value: 'Dual / tri-color', label: 'Dual / tri-color', icon: '◑', hint: 'Shows different colors from different viewing directions.', abrasive: false },
  { value: 'Metal-filled', label: 'Metal-filled', icon: '◆', hint: 'Contains metal powder. Use a hardened 0.6 mm nozzle.', abrasive: true },
  { value: 'Marble / stone', label: 'Marble / stone', icon: '▧', hint: 'Speckled mineral appearance. A hardened nozzle is recommended.', abrasive: true },
  { value: 'Custom', label: 'Other effect', icon: '＋', hint: 'Enter any special filament effect.', abrasive: false },
]);

let filamentChooserReturnFocus = null;

function filamentEffectChoice(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return FILAMENT_EFFECT_CHOICES.find(choice => choice.value.toLowerCase() === normalized)
    || FILAMENT_EFFECT_CHOICES.find(choice => choice.value === 'Custom');
}

function captureColorContext(context) {
  const imageSession = state.imageEditor;
  const selected = selectedElement();
  const textDraft = context === 'create' && $('#newTextValue') ? {
    value: $('#newTextValue').value,
    size: $('#newTextSize')?.value,
    weight: $('#newTextWeight')?.value,
    font: $('#newTextFont')?.value,
    position: $('#newTextPosition')?.value,
    autoFit: $('#newTextAutoFit')?.checked,
  } : null;
  const segmentId = context === 'element' && selected?.type === 'image' && selected.rasterKind === 'segment' ? selected.id : null;
  const inspectorImageId = context === 'inspector-image' && selected?.type === 'image' ? selected.id : null;
  return { imageSession, selectedId: state.selectedId, textDraft, segmentId, inspectorImageId };
}

function applyColorContext(project, context, slot, captured) {
  if (['create', 'draw', 'upload'].includes(context)) state.drawing.color = slot;
  if (context.startsWith('medal:')) {
    const field = context.slice('medal:'.length);
    if (field === 'baseColor' || field === 'rimColor') project.medal[field] = slot;
  }
  if (context === 'element' && !captured.segmentId) {
    const target = project.elements.find(element => element.id === captured.selectedId);
    if (target && !target.locked && target.type !== 'image') target.color = slot;
  }
  if (context === 'inspector-image') {
    const target = project.elements.find(element => element.id === captured.selectedId);
    if (target?.type === 'image') {
      const active = Array.isArray(target.imageSettings?.activeSlots) ? target.imageSettings.activeSlots : [];
      const style = target.imageSettings?.style;
      const activeSlots = style === 'silhouette'
        ? [slot]
        : style === 'high-contrast'
          ? [...new Set([...active, slot])].slice(-2)
          : active.length ? [...new Set([...active, slot])].sort((a, b) => a - b) : [];
      target.imageSettings = { ...target.imageSettings, activeSlots };
    }
  }
  if (context === 'image-palette' && captured.imageSession) {
    const active = Array.isArray(captured.imageSession.settings.activeSlots) ? captured.imageSession.settings.activeSlots : [];
    if (captured.imageSession.settings.style === 'silhouette') captured.imageSession.settings.activeSlots = [slot];
    else if (captured.imageSession.settings.style === 'high-contrast') captured.imageSession.settings.activeSlots = [...new Set([...active, slot])].slice(-2);
    else if (active.length) captured.imageSession.settings.activeSlots = [...new Set([...active, slot])].sort((a, b) => a - b);
  }
  if (context === 'image-part' && captured.imageSession) {
    const preference = captured.imageSession.partPreferences?.get(captured.imageSession.selectedPartKey);
    if (preference) preference.color = slot;
  }
}

function finalizeColorContext(context, slot, captured) {
  if (captured.segmentId) void recolorSegmentImage(captured.segmentId, slot);
  const imageSession = captured.imageSession;
  if (context === 'image-palette' && imageSession && state.imageEditor === imageSession) {
    renderImageEditorPalette(imageSession);
    scheduleImageEditorPreview(0);
  } else if (context === 'image-part' && imageSession && state.imageEditor === imageSession) {
    renderImagePartsPanel(imageSession);
    if (imageSession.latest) drawImageEditorPreview(imageSession.latest, imageSession, imageSession.previewToken);
  }
  if (captured.inspectorImageId) void reprocessImportedImages('selected image color addition', captured.inspectorImageId);
  if (captured.textDraft && $('#newTextValue')) {
    $('#newTextValue').value = captured.textDraft.value;
    if ($('#newTextSize')) $('#newTextSize').value = captured.textDraft.size;
    if ($('#newTextWeight')) $('#newTextWeight').value = captured.textDraft.weight;
    if ($('#newTextFont')) $('#newTextFont').value = captured.textDraft.font || 'Arial';
    if ($('#newTextPosition')) $('#newTextPosition').value = captured.textDraft.position || 'center';
    if ($('#newTextAutoFit')) $('#newTextAutoFit').checked = captured.textDraft.autoFit !== false;
  }
}

function chooseFilamentForContext(context, filamentId) {
  if (state.liveEdit) { toast('Press OK or Cancel before changing filament colors'); return false; }
  const filament = state.inventory.find(item => item.id === filamentId);
  if (!filament) { toast('That filament is no longer in the local catalog'); return false; }
  const existingSlot = state.project.paletteIds.indexOf(filament.id);
  if (existingSlot < 0 && state.project.paletteIds.length >= DESIGN_LIMITS.paletteSlots) {
    toast(`This medal can use up to ${DESIGN_LIMITS.paletteSlots} colors`);
    return false;
  }
  const captured = captureColorContext(context);
  let slot = existingSlot;
  const changed = commit(project => {
    if (slot < 0) {
      project.paletteIds.push(filament.id);
      slot = project.paletteIds.length - 1;
    }
    applyColorContext(project, context, slot, captured);
    if (existingSlot < 0 || context.startsWith('medal:') || ['element', 'inspector-image'].includes(context)) project.template = 'custom';
  }, { panel: true });
  if (slot < 0 || (existingSlot < 0 && !changed)) return false;
  syncDrawingDefaults(false);
  finalizeColorContext(context, slot, captured);
  if (!captured.segmentId) toast(`${filament.name} ${existingSlot < 0 ? 'added and selected' : 'selected'}`);
  return true;
}

function ensureFilamentChooserDialog() {
  let chooser = $('#filamentChooserDialog');
  if (chooser) return chooser;
  chooser = document.createElement('dialog');
  chooser.id = 'filamentChooserDialog';
  chooser.className = 'filament-chooser-dialog';
  chooser.setAttribute('aria-labelledby', 'filamentChooserTitle');
  chooser.addEventListener('cancel', event => { event.preventDefault(); closeFilamentChooser(); });
  chooser.addEventListener('click', event => { if (event.target === chooser) closeFilamentChooser(); });
  chooser.addEventListener('keydown', event => event.stopPropagation());
  document.body.append(chooser);
  return chooser;
}

function closeFilamentChooser(restoreFocus = true) {
  const chooser = $('#filamentChooserDialog');
  if (chooser?.open) chooser.close();
  const returnFocus = filamentChooserReturnFocus;
  filamentChooserReturnFocus = null;
  if (restoreFocus && returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus());
}

function filamentStockCard(filament, selectedId) {
  const status = localizedAvailability(filament);
  const usedSlot = state.project.paletteIds.indexOf(filament.id);
  const disabled = status.key === 'out' && usedSlot < 0;
  const searchable = `${filament.name} ${filament.brand} ${filament.material} ${filament.effect}`.toLowerCase();
  const effect = filamentEffectChoice(filament.effect);
  const stockLabel = usedSlot >= 0
    ? translateUiKey('stockStatusUi.colorInMedal', { count: formatLocalizedNumber(usedSlot + 1) })
    : status.label;
  return `<label class="filament-choice-card ${filament.id === selectedId ? 'selected' : ''} ${disabled ? 'disabled' : ''}" data-stock-card data-searchable="${escapeHtml(searchable)}" data-material="${escapeHtml(filament.material)}"><input type="radio" name="stockFilament" value="${escapeHtml(filament.id)}" ${filament.id === selectedId ? 'checked' : ''} ${disabled ? 'disabled' : ''}><i class="filament-choice-swatch" style="background:${filament.color}"></i><span><strong data-i18n-ignore>${escapeHtml(filament.name)}</strong><small data-i18n-ignore>${escapeHtml(filament.material)} · ${escapeHtml(filament.effect)}</small><em><b>${effect.icon}</b>${escapeHtml(stockLabel)} · Kč ${formatLocalizedNumber(filament.pricePerKg)}/kg</em></span></label>`;
}

function openFilamentChooser(context, anchor) {
  if (state.project.paletteIds.length >= DESIGN_LIMITS.paletteSlots) {
    toast(`This medal can use up to ${DESIGN_LIMITS.paletteSlots} colors`);
    return;
  }
  const chooser = ensureFilamentChooserDialog();
  const selectable = state.inventory.filter(filament => availability(filament).key !== 'out' || state.project.paletteIds.includes(filament.id));
  const unusedSelectable = selectable.filter(filament => !state.project.paletteIds.includes(filament.id));
  const selectedId = unusedSelectable[0]?.id || selectable[0]?.id || '';
  const materials = [...new Set(state.inventory.map(filament => filament.material))].sort();
  const supportedMaterials = ['PLA', 'PETG', 'ASA', 'ABS', 'TPU'];
  const bodyMaterial = getPalette(state.project, state.inventory)[state.project.medal.baseColor]?.material;
  const defaultMaterial = supportedMaterials.includes(bodyMaterial) ? bodyMaterial : 'PLA';
  const defaultTab = selectable.length ? 'stock' : 'custom';
  filamentChooserReturnFocus = anchor || document.activeElement;
  chooser.innerHTML = `<div class="filament-chooser-shell">
    <header class="filament-chooser-head"><div><span class="eyebrow">Add a design color</span><h2 id="filamentChooserTitle">Choose the actual filament</h2><p>Color, material, finish, stock and price stay attached to this 3MF part.</p></div><button type="button" class="icon-button" data-close-filament-chooser aria-label="Close filament chooser">×</button></header>
    <div class="filament-chooser-tabs" role="tablist" aria-label="Filament source"><button type="button" role="tab" data-filament-tab="stock" class="${defaultTab === 'stock' ? 'active' : ''}" aria-selected="${defaultTab === 'stock'}">My filament stock</button><button type="button" role="tab" data-filament-tab="custom" class="${defaultTab === 'custom' ? 'active' : ''}" aria-selected="${defaultTab === 'custom'}">Create custom</button></div>
    <section class="filament-chooser-panel" data-filament-panel="stock" ${defaultTab === 'stock' ? '' : 'hidden'}>
      <div class="filament-stock-filters"><label><span>Find filament</span><input class="text-input" id="filamentStockSearch" type="search" placeholder="Color, brand or effect"></label><label><span>Material</span><select class="select-input" id="filamentStockMaterial"><option value="">All materials</option>${materials.map(material => `<option value="${escapeHtml(material)}">${escapeHtml(material)}</option>`).join('')}</select></label></div>
      <div class="filament-choice-list" id="filamentChoiceList">${state.inventory.length ? state.inventory.map(filament => filamentStockCard(filament, selectedId)).join('') : '<div class="filament-choice-empty"><strong>No local filaments yet</strong><span>Create one here; it will also be saved to this device.</span></div>'}</div>
      <p class="filament-chooser-note">Unavailable filaments stay visible for reference. A color already used by this medal selects its existing slot instead of creating a duplicate.</p>
    </section>
    <section class="filament-chooser-panel" data-filament-panel="custom" ${defaultTab === 'custom' ? '' : 'hidden'}>
      <div class="custom-filament-core"><label class="custom-filament-color"><span>Color</span><input id="customFilamentColor" type="color" value="#4d8ee8"><output id="customFilamentHex">#4D8EE8</output></label><label><span>Name</span><input class="text-input" id="customFilamentName" maxlength="80" value="Custom ${defaultMaterial}"></label><label><span>Base material</span><select class="select-input" id="customFilamentMaterial">${supportedMaterials.map(material => `<option value="${material}" ${material === defaultMaterial ? 'selected' : ''}>${material}</option>`).join('')}</select></label></div>
      <fieldset class="filament-effect-picker"><legend>Finish or special effect</legend><div>${FILAMENT_EFFECT_CHOICES.map((effect, index) => `<label class="${index === 0 ? 'selected' : ''}"><input type="radio" name="customFilamentEffect" value="${escapeHtml(effect.value)}" ${index === 0 ? 'checked' : ''}><b>${effect.icon}</b><span>${escapeHtml(effect.label)}</span></label>`).join('')}</div></fieldset>
      <label class="custom-effect-field" id="customEffectField" hidden><span>Describe the effect</span><input class="text-input" id="customFilamentEffectText" maxlength="60" placeholder="Example: UV color changing"></label>
      <div class="filament-effect-hint" id="filamentEffectHint"><b>●</b><span>Clean, consistent everyday color.</span></div>
      <details class="custom-filament-details"><summary>Stock and pricing <span>optional</span></summary><div><label><span>Brand</span><input class="text-input" id="customFilamentBrand" maxlength="60" value="Custom"></label><label><span>Stock on hand</span><div class="unit-input"><input id="customFilamentStock" type="number" min="0" step="1" placeholder="Not entered"><em>g</em></div></label><label><span>Price</span><div class="unit-input"><input id="customFilamentPrice" type="number" min="0" step="1" value="650"><em>Kč/kg</em></div></label></div></details>
      <label class="check-row filament-abrasive-row"><input id="customFilamentAbrasive" type="checkbox"><span><strong>Abrasive particles</strong><small>Warn when a hardened nozzle is not selected.</small></span></label>
    </section>
    <footer class="filament-chooser-actions"><button type="button" class="button secondary" data-close-filament-chooser>Cancel</button><button type="button" class="button primary" id="confirmFilamentChoice">Add and use filament</button></footer>
  </div>`;

  const refreshFilamentConfirm = tab => {
    const confirm = $('#confirmFilamentChoice');
    if (!confirm) return;
    confirm.textContent = tab === 'stock' ? 'Use selected filament' : 'Create and use filament';
    confirm.disabled = tab === 'stock' && !chooser.querySelector('input[name="stockFilament"]:checked');
  };
  const activateTab = tab => {
    chooser.querySelectorAll('[data-filament-tab]').forEach(button => { const active = button.dataset.filamentTab === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
    chooser.querySelectorAll('[data-filament-panel]').forEach(panel => { panel.hidden = panel.dataset.filamentPanel !== tab; });
    refreshFilamentConfirm(tab);
  };
  chooser.querySelectorAll('[data-close-filament-chooser]').forEach(button => button.addEventListener('click', () => closeFilamentChooser()));
  chooser.querySelectorAll('[data-filament-tab]').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.filamentTab)));
  chooser.querySelectorAll('input[name="stockFilament"]').forEach(input => input.addEventListener('change', () => {
    chooser.querySelectorAll('[data-stock-card]').forEach(card => card.classList.toggle('selected', card.contains(input)));
    refreshFilamentConfirm('stock');
  }));
  const filterStock = () => {
    const query = ($('#filamentStockSearch')?.value || '').trim().toLowerCase();
    const material = $('#filamentStockMaterial')?.value || '';
    chooser.querySelectorAll('[data-stock-card]').forEach(card => { card.hidden = Boolean((query && !card.dataset.searchable.includes(query)) || (material && card.dataset.material !== material)); });
    const selected = chooser.querySelector('input[name="stockFilament"]:checked');
    if (selected?.closest('[data-stock-card]')?.hidden) {
      selected.checked = false;
      const replacement = [...chooser.querySelectorAll('[data-stock-card]:not([hidden]) input[name="stockFilament"]:not(:disabled)')][0];
      if (replacement) { replacement.checked = true; replacement.dispatchEvent(new Event('change')); }
      else chooser.querySelectorAll('[data-stock-card]').forEach(card => card.classList.remove('selected'));
    }
    refreshFilamentConfirm('stock');
  };
  $('#filamentStockSearch')?.addEventListener('input', filterStock);
  $('#filamentStockMaterial')?.addEventListener('change', filterStock);
  const customName = $('#customFilamentName');
  customName?.addEventListener('input', () => { customName.dataset.userEdited = 'true'; });
  const updateCustomName = () => {
    if (!customName || customName.dataset.userEdited === 'true') return;
    const material = $('#customFilamentMaterial')?.value || 'PLA';
    const selectedEffect = chooser.querySelector('input[name="customFilamentEffect"]:checked')?.value || 'Solid';
    const label = filamentEffectChoice(selectedEffect).label.replace(' / glitter', '');
    customName.value = `${label === 'Solid' ? 'Custom' : label} ${material}`;
  };
  $('#customFilamentColor')?.addEventListener('input', event => { $('#customFilamentHex').textContent = event.target.value.toUpperCase(); });
  $('#customFilamentMaterial')?.addEventListener('change', updateCustomName);
  chooser.querySelectorAll('input[name="customFilamentEffect"]').forEach(input => input.addEventListener('change', () => {
    chooser.querySelectorAll('.filament-effect-picker label').forEach(label => label.classList.toggle('selected', label.contains(input)));
    const choice = filamentEffectChoice(input.value);
    $('#customEffectField').hidden = choice.value !== 'Custom';
    $('#filamentEffectHint').innerHTML = `<b>${choice.icon}</b><span>${escapeHtml(choice.hint)}</span>`;
    $('#customFilamentAbrasive').checked = choice.abrasive;
    updateCustomName();
    if (choice.value === 'Custom') $('#customFilamentEffectText')?.focus();
  }));
  $('#confirmFilamentChoice')?.addEventListener('click', async () => {
    const activeTab = chooser.querySelector('[data-filament-tab].active')?.dataset.filamentTab || 'stock';
    let filamentId = '';
    let created = null;
    if (activeTab === 'stock') {
      filamentId = chooser.querySelector('input[name="stockFilament"]:checked')?.value || '';
      if (!filamentId) { toast('Choose a filament, or create a custom one'); return; }
    } else {
      if (state.inventory.length >= 256) { toast('The local filament catalog is full. Remove an unused record before creating another.'); return; }
      const selectedEffect = chooser.querySelector('input[name="customFilamentEffect"]:checked')?.value || 'Solid';
      const customEffect = $('#customFilamentEffectText')?.value.trim();
      const effect = selectedEffect === 'Custom' ? customEffect : selectedEffect;
      if (!effect) { $('#customFilamentEffectText')?.focus(); toast('Describe the special filament effect'); return; }
      const stockValue = $('#customFilamentStock')?.value.trim() || '';
      const material = $('#customFilamentMaterial')?.value || 'PLA';
      created = normalizeFilamentRecord({
        id: uid('filament'),
        name: $('#customFilamentName')?.value.trim() || `Custom ${material}`,
        brand: $('#customFilamentBrand')?.value.trim() || 'Custom',
        material,
        color: $('#customFilamentColor')?.value || '#4d8ee8',
        effect,
        abrasive: Boolean($('#customFilamentAbrasive')?.checked),
        density: MATERIAL_DENSITY[material] || 1.24,
        pricePerKg: Number($('#customFilamentPrice')?.value) || 0,
        stockGrams: stockValue ? Number(stockValue) : 0,
        stockKnown: Boolean(stockValue),
        supplierRegion: '', productUrl: '', sourcePrice: 0, sourceCurrency: '', priceUpdatedAt: '',
      }, state.inventory.length);
      state.inventory = normalizeInventory([...state.inventory, created]);
      if (!state.inventory.some(item => item.id === created.id)) { toast('Could not add another filament to the local catalog'); return; }
      filamentId = created.id;
    }
    closeFilamentChooser(false);
    const chosen = chooseFilamentForContext(context, filamentId);
    if (created) {
      await saveUserRecord('inventory', 'catalog', state.inventory);
      if (!chosen) toast(`${created.name} saved to local filament stock`);
    }
  });
  refreshFilamentConfirm(defaultTab);
  if (chooser.open) chooser.close();
  chooser.showModal();
  requestAnimationFrame(() => chooser.querySelector(defaultTab === 'stock' ? 'input[name="stockFilament"]:checked' : '#customFilamentColor')?.focus());
}

function bindInlineAddColorButtons(root) {
  if (!root) return;
  root.querySelectorAll('[data-add-design-color]').forEach(button => {
    if (button.dataset.addColorBound === 'true') return;
    button.dataset.addColorBound = 'true';
    button.addEventListener('click', () => openFilamentChooser(button.dataset.addDesignColor, button));
  });
}

function createColorPickerHtml() {
  return `<div class="create-color-row"><span>Color</span><div class="element-colors">${getPalette(state.project, state.inventory).map((filament, index) => `<button type="button" class="color-button ${state.drawing.color === index ? 'active' : ''}" data-new-color="${index}" style="background:${filament.color}" title="Color ${index + 1}: ${escapeHtml(filament.name)}" aria-label="Color ${index + 1}: ${escapeHtml(filament.name)}">${state.drawing.color === index ? '<span>✓</span>' : ''}</button>`).join('')}${inlineAddColorButtonHtml('create')}</div></div>`;
}

function textPanel(embedded = false) {
  return `${embedded ? '' : panelHeading('Add content', 'New text')}
    <div class="tool-form">
      <label><span>Text</span><input class="text-input" id="newTextValue" value="YOUR EVENT" maxlength="80" /></label>
      <div class="dimension-grid">
        <label>Size<input id="newTextSize" type="number" min="1" max="${DESIGN_LIMITS.textSizeMax}" step="0.1" value="6" /></label>
        <label>Weight<select id="newTextWeight"><option value="700">Bold</option><option value="800" selected>Extra bold</option><option value="900">Heavy</option></select></label>
        <label>Style<select id="newTextFont"><option value="Arial">Clean</option><option value="Verdana">Wide</option><option value="Georgia">Classic serif</option></select></label>
        <label>Starting position<select id="newTextPosition"><option value="center">Center</option><option value="top">Near the top</option><option value="bottom">Near the bottom</option></select></label>
      </div>
      <label class="check-row compact-check"><input id="newTextAutoFit" type="checkbox" checked><span><strong>Auto-fit long text</strong><small>Keeps wording inside the printable edge.</small></span></label>
      ${createColorPickerHtml()}
      <button class="primary-wide" id="addTextButton">Next: position text in 3D</button>
      <small class="field-help">Move the real text preview over either side and click to place it. Back text reads correctly and is automatically embedded flat in the first print layer.</small>
    </div>`;
}

function uploadPanel(embedded = false) {
  const colors = getPalette(state.project, state.inventory);
  const capability = state.localAiCapability;
  const ready = capability?.available === true;
  const localMode = state.imageGeneratorMode === 'local';
  const hostedStatic = RUNTIME_CONFIG.staticHosting;
  const setup = localMode ? capability?.setup : null;
  const setupBusy = Boolean(setup?.busy || (state.localAiBusy && state.localAiPhase === 'setup'));
  const badgeClass = ready ? 'cached' : capability ? (setup?.supported || !localMode ? 'supported' : 'unsupported') : 'unchecked';
  const badgeText = hostedStatic ? 'Local edition only' : state.localAiProbeBusy ? 'Checking…' : ready ? 'Ready' : setupBusy ? 'Setting up…' : capability ? (localMode ? (setup?.installed ? 'Ready to start' : setup?.supported ? 'One-click setup' : 'Unavailable') : 'Not included') : 'Checking…';
  const actionLabel = state.localAiBusy
    ? state.localAiPhase === 'setup' ? 'Setting up automatically…' : state.localAiPhase === 'checking' ? 'Checking…' : 'Creating image…'
    : hostedStatic
      ? 'Use the local/desktop edition to create images'
    : localMode && capability && !ready && setup?.supported
      ? `${setup.installed ? 'Start' : 'Set up'} & create image`
      : 'Create image';
  const initialStatus = hostedStatic
    ? 'This hosted-static edition cannot install or start software on a customer computer. Image import and the deterministic text-to-medal designer remain fully local in the browser.'
    : localMode
    ? setup?.message || 'First use is automatic. The image maker runs outside the browser so the page stays responsive.'
    : ready
      ? 'Online images are enabled for this app. Customers never enter an API key.'
      : 'Online generation may be enabled by the site owner. The free local option is always the default.';
  return `${embedded ? '' : panelHeading('Bring your artwork', 'Images & logos')}
    <div class="image-primary-actions ${hostedStatic ? 'single-action' : ''}"><button type="button" class="action-card" id="uploadPrimary"><span class="action-icon">↑</span><span><strong>Use my image</strong><small>PNG, JPEG, SVG, or DXF</small></span></button>${hostedStatic ? '' : '<button type="button" class="action-card" id="createImagePrimary"><span class="action-icon">✦</span><span><strong>Create an image</strong><small>Describe it in everyday words</small></span></button>'}</div>
    ${hostedStatic ? '' : `<details class="image-create-disclosure friendly-disclosure"><summary>Create an image from a description</summary><div><div class="local-image-generator cloud-image-generator">
      <label class="generator-provider"><span>Where should the image be created?</span><select id="imageGeneratorMode" class="select-input" aria-label="Image generator" ${state.localAiBusy || hostedStatic ? 'disabled' : ''}><option value="local" ${localMode ? 'selected' : ''}>On this computer · local/desktop edition</option><option value="cloud" ${localMode ? '' : 'selected'}>Online · site-owner service</option></select></label>
      <div class="local-ai-title"><span class="eyebrow">${localMode ? 'Private · uses this computer' : 'Fast · provided by this app'}</span><span class="local-ai-badge ${badgeClass}" id="localAiBadge">${escapeHtml(badgeText)}</span></div>
      <strong>Create an image</strong>
      <p class="generator-intro">Describe what you want. We’ll create an image, then help you turn it into printable color layers.</p>
      <label><span>What should be on the medal?</span><textarea class="text-input" id="localArtworkBrief" rows="4" data-i18n-ignore placeholder="${escapeHtml(translateUi('Example: a premium night-running medal with a dynamic runner, Prague skyline and a crescent moon'))}">${escapeHtml(state.localArtworkBrief || '')}</textarea></label>
      <details class="generator-options"><summary>Image options</summary><div class="cloud-generator-grid">
        <label><span>Look</span><select id="localArtworkStyle" class="select-input" aria-label="Generated image look"><option value="photo-medal" ${state.localArtworkStyle === 'photo-medal' ? 'selected' : ''}>Photorealistic medal concept</option><option value="photo-subject" ${state.localArtworkStyle === 'photo-subject' ? 'selected' : ''}>Photorealistic subject</option><option value="illustration" ${state.localArtworkStyle === 'illustration' ? 'selected' : ''}>Detailed illustration</option><option value="graphic" ${state.localArtworkStyle === 'graphic' ? 'selected' : ''}>Clean printable graphic</option><option value="silhouette" ${state.localArtworkStyle === 'silhouette' ? 'selected' : ''}>Bold silhouette</option></select></label>
        <label><span>Resolution</span><select id="localArtworkSize" class="select-input" aria-label="Generated image resolution"><option value="1024x1024" ${state.localArtworkSize === '1024x1024' ? 'selected' : ''}>1024 × 1024 · square</option><option value="1536x1024" ${state.localArtworkSize === '1536x1024' ? 'selected' : ''}>1536 × 1024 · landscape</option><option value="1024x1536" ${state.localArtworkSize === '1024x1536' ? 'selected' : ''}>1024 × 1536 · portrait</option></select></label>
        <label><span>Quality</span><select id="localArtworkQuality" class="select-input" aria-label="Generated image quality"><option value="high" ${state.localArtworkQuality === 'high' ? 'selected' : ''}>High · final concept</option><option value="medium" ${state.localArtworkQuality === 'medium' ? 'selected' : ''}>Standard · balanced</option><option value="low" ${state.localArtworkQuality === 'low' ? 'selected' : ''}>Draft · faster</option></select></label>
        <label><span>Number of images</span><select id="localArtworkCount" class="select-input" aria-label="Number of generated images"><option value="1" ${state.localArtworkCount === 1 ? 'selected' : ''}>1 image · recommended</option><option value="2" ${state.localArtworkCount === 2 ? 'selected' : ''}>2 images</option><option value="3" ${state.localArtworkCount === 3 ? 'selected' : ''}>3 images</option><option value="4" ${state.localArtworkCount === 4 ? 'selected' : ''}>4 images</option></select></label>
      </div></details>
      <button type="button" class="primary-wide generate-image-button" id="generateLocalArtwork" ${hostedStatic || state.localAiBusy || (!localMode && capability && !ready) ? 'disabled' : ''}>${escapeHtml(actionLabel)}</button>
      <div class="local-ai-progress" id="localAiProgressWrap" ${state.localAiBusy ? '' : 'hidden'} role="status" aria-live="polite"><progress id="localAiProgress" max="1" aria-label="Image creation progress"></progress><span id="localAiProgressText">${state.localAiProgress?.message ? escapeHtml(state.localAiProgress.message) : 'Preparing…'}</span><button type="button" id="cancelLocalAi">Cancel</button></div>
      <small class="field-help ${state.localAiError ? 'generator-error' : ''}" id="localAiStatus" ${state.localAiError ? 'role="alert"' : 'role="status"'} aria-live="polite">${escapeHtml(state.localAiStatus || initialStatus)}</small>
      <div class="local-ai-foot"><span>${hostedStatic ? 'Static hosting · no hidden API calls or customer keys' : localMode ? `Automatic first-time setup${setup?.downloadSize ? ` · ${escapeHtml(setup.downloadSize)} download` : ''} · no commands` : 'No customer keys · availability is managed for the whole app'}</span><button type="button" id="localAiInfo">${hostedStatic ? 'Why this is unavailable' : localMode ? 'Privacy & licenses' : 'About online images'}</button></div>
    </div></div></details>`}
    <div class="upload-or"><span>or drag a file below</span></div>
    <div class="automatic-medal-import"><span>◎</span><div><strong>Build a complete medal from one picture</strong><small>For a round medal concept, the app automatically removes the ribbon and studio background, applies face/rim colors, finds likely text lines, and separates the graphics into editable objects.</small></div></div>
    <button class="upload-drop" id="uploadDrop">
      <b>↑</b><strong>Drop a file here, or choose one</strong><span>PNG, JPEG, SVG, or basic 2D DXF · up to 24 MB</span>
    </button>
    <div class="upload-note"><strong>Preview and clean every image before it touches the medal.</strong><br/>Crop it, remove only edge-connected background, choose a silhouette/outline/color effect, and limit its filament colors—all on this computer.</div>
    <div class="image-color-card"><div class="image-color-head"><strong>Colors used for new images</strong><span class="image-color-head-actions">${inlineAddColorButtonHtml('upload')}<button type="button" id="uploadColorsButton">Manage</button></span></div><div class="image-color-list">${colors.map((filament, index) => `<span class="image-color-chip" data-i18n-ignore><i style="background:${filament.color}"></i>${index + 1}. ${escapeHtml(filament.name)}</span>`).join('')}</div></div>
    `;
}

function shapesPanel(embedded = false) {
  const visibleShapes = SHAPE_CATALOG.filter(shape => shape.id !== 'runner');
  const groups = SHAPE_CATEGORIES.map(category => {
    const shapes = visibleShapes.filter(shape => shape.category === category);
    if (!shapes.length) return '';
    const categoryLabel = category === 'Race day' ? translateUiKey('shapeCategoryUi.raceDay') : translateUi(category);
    return `<section class="shape-library-group" aria-labelledby="shape-category-${category.toLowerCase().replace(/\s+/g, '-')}"><div class="shape-library-heading"><strong id="shape-category-${category.toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(categoryLabel)}</strong><span>${category === 'Runners' ? 'Smooth athlete silhouettes' : category === 'Mountains' ? 'Detailed landscape symbols' : category === 'Essentials' ? 'Simple building blocks' : 'Event accents'}</span></div><div class="shape-grid">${shapes.map(shape => `<button type="button" class="shape-button" data-add-shape="${shape.id}" aria-label="Add ${escapeHtml(shape.label)}" title="${escapeHtml(shape.description)}"><svg viewBox="-0.62 -0.62 1.24 1.24" aria-hidden="true" focusable="false"><g fill="currentColor">${shapeSvgMarkup(shape.id, 1)}</g></svg><span>${escapeHtml(shape.label)}</span></button>`).join('')}</div></section>`;
  }).join('');
  return `${embedded ? '' : panelHeading('Print-safe symbols', 'Add a symbol')}<label class="shape-size-control"><span>Starting size</span><div class="unit-input"><input id="newShapeSize" type="number" min="2" max="${DESIGN_LIMITS.shapeSizeMax}" step="0.5" value="12"><em>mm</em></div></label><div class="shape-library">${groups}</div>${createColorPickerHtml()}<div class="create-surface-note"><strong>Choose a symbol, then click either side of the 3D medal.</strong><br/>The symbol stays vector-smooth and editable with the square corner handles. Detailed runners work best at 24 mm or larger.</div>`;
}

function drawPanel(embedded = false) {
  const modes = [
    ['select', '↖', 'Select', 'V'], ['brush', '〰', 'Brush', 'B'], ['line', '╱', 'Line', 'L'],
    ['polygon', '⬠', 'Polygon', 'P'], ['erase', '⌫', 'Delete objects', 'E'], ['measure', '↔', 'Measure', 'M'],
  ];
  const drawing = state.drawing;
  const drawColors = `${getPalette(state.project, state.inventory).map((filament, index) => `<button class="color-button ${drawing.color === index ? 'active' : ''}" data-draw-color="${index}" style="background:${filament.color}" aria-label="Draw with color ${index + 1}: ${escapeHtml(filament.name)}">${drawing.color === index ? '<span>✓</span>' : ''}</button>`).join('')}${inlineAddColorButtonHtml('draw')}`;
  const help = drawing.mode === 'polygon'
    ? 'Click each corner. Press Enter or Finish to create the filled region. Backspace removes the last point; Escape cancels.'
    : drawing.mode === 'brush'
      ? 'Drag directly on the medal. The stroke is simplified into printable millimeter geometry when released.'
      : drawing.mode === 'erase'
        ? 'Drag across objects to remove whole elements. One drag becomes one undo step.'
        : drawing.mode === 'measure'
          ? 'Drag between two points to measure distance and angle without changing the model.'
          : 'Draw in physical millimeters. Snapping keeps geometry aligned to the center, grid, and nearby vertices.';
  return `${embedded ? '' : panelHeading('Create by hand', 'Manual drawing')}
    <label class="field-label">Sketch on</label><div class="segmented draw-face-picker"><button type="button" data-draw-face="front" class="${drawing.face !== 'back' ? 'active' : ''}">Front face</button><button type="button" data-draw-face="back" class="${drawing.face === 'back' ? 'active' : ''}">Back · flat</button></div>
    <div class="draw-mode-grid">${modes.map(([mode, icon, label, shortcut]) => `<button class="draw-mode ${drawing.mode === mode ? 'active' : ''}" data-draw-mode="${mode}" title="${label} (${shortcut})"><b>${icon}</b><span>${label}</span></button>`).join('')}</div>
    <div class="draw-options">
      <label><span><b>Stroke / minimum width</b><output id="drawWidthLabel">${drawing.strokeWidth.toFixed(2)} mm</output></span><input id="drawWidth" type="range" min="0.2" max="6" step="0.05" value="${drawing.strokeWidth}" /></label>
      <div><label class="field-label">Color</label><div class="draw-color-row">${drawColors}</div></div>
      <label class="check-row"><input type="checkbox" id="drawSnap" ${drawing.snap ? 'checked' : ''}/><span><strong>Smart snapping</strong><small>${drawing.grid.toFixed(1)} mm grid, center axes, and path vertices · hold Alt to bypass</small></span></label>
    </div>
    <div class="draw-help">${help}</div>
    ${drawing.mode === 'polygon' && drawing.points.length ? `<div class="draw-draft-actions"><button id="cancelDrawing">Cancel (${drawing.points.length})</button><button id="finishDrawing">Finish polygon</button></div>` : ''}`;
}

function printableArtworkPrompt(brief) {
  const subject = String(brief || 'community running event')
    .replace(/\b\d{1,2}\s*[.\/-]\s*\d{1,2}\s*[.\/-]\s*20\d{2}\b/g, ' ')
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/\b(?:make|create|design|generate)(?:\s+me|\s+us)?\s+(?:an?\s+)?(?:3d[- ]printable\s+)?medal(?:\s+design)?(?:\s+for)?\b/gi, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 180) || 'dynamic community runner';
  const nozzle = state.project.profile.nozzle;
  const oneBead = nozzle * 1.125, robust = oneBead * 2;
  const artworkSize = Math.round(Math.min(state.project.medal.width, state.project.medal.height) * .72);
  return `Draw exactly one isolated flat vector icon. The subject is: ${subject}. Show the subject itself as the only artwork, centered and fully visible on a pure white square canvas. Use an orthographic front view, a strong connected silhouette, smooth high-resolution Bézier-like contours, large contiguous areas, crisp closed boundaries, and balanced negative space. It will be fabricated about ${artworkSize} mm wide with a ${nozzle.toFixed(1)} mm tool: all strokes, gaps, bridges, necks, and isolated features must read as robust shapes at least ${robust.toFixed(2)} mm wide, never below ${oneBead.toFixed(2)} mm. Use at most ${Math.min(4, state.project.paletteIds.length)} completely flat solid-color regions with no shading. Do not draw a surrounding circle, ring, frame, coin, badge, product mockup, border, ribbon, or display stand. Do not draw letters, fake lettering, words, numbers, dates, captions, signatures, watermarks, gradients, antialias haze, shadows, textures, perspective, photographic detail, tiny islands, or hairlines. Leave generous empty white space around the isolated icon.`;
}

function cloudArtworkPrompt(brief, style = 'photo-medal') {
  const subject = String(brief || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  const shared = 'Create one polished, original image with a clear focal point, excellent composition, accurate anatomy and clean edges. Do not add watermarks, signatures, gibberish, or unrequested writing. Keep every important subject fully inside the frame.';
  const direction = {
    'photo-medal': `Create a premium photorealistic product-design concept for a multicolor 3D-printed medal inspired by: ${subject}. Show one complete medal, mostly front-facing with slight depth, realistic matte filament and crisp layered relief, on a simple neutral studio background. Use bold separable color regions so the concept can later be converted into printable layers. Leave typography areas blank unless the description explicitly requests exact text.`,
    'photo-subject': `Create a highly detailed photorealistic source image inspired by: ${subject}. Isolate the main subject against a simple contrasting background with clean separation, studio-quality light and minimal visual clutter so it can be converted into medal artwork.`,
    illustration: `Create a refined, detailed editorial illustration inspired by: ${subject}. Use confident shapes, controlled shading, a limited harmonious palette and a clean uncluttered background. Make the subject easy to isolate and simplify into layered medal artwork.`,
    graphic: `Create clean, production-ready graphic artwork inspired by: ${subject}. Use a front-facing composition, smooth precise contours, large contiguous flat-color regions and strong negative space. Avoid gradients, shadows, texture, tiny islands and hairlines. Do not show a medal, frame, ribbon or product mockup.`,
    silhouette: `Create one bold, elegant connected silhouette inspired by: ${subject}. Center it on a plain white background with smooth high-resolution contours, strong readable anatomy, very few interior cutouts and no tiny detached details. Do not show a medal, frame, ribbon or product mockup.`,
  }[style] || '';
  return `${direction} ${shared}`.trim();
}

function conceptText(name, value, x, y, fontSize, color, options = {}) {
  return { id: uid('text'), type: 'text', name, text: value, x, y, fontSize, fontFamily: 'Arial', weight: options.weight || 900, rotation: options.rotation || 0, color, hidden: false, face: options.face === 'back' ? 'back' : 'front', groupId: options.groupId || null, scaleX: 1, scaleY: 1, lockAspect: true, operation: options.operation || 'raise', zHeight: options.zHeight || .6, zDepth: options.zDepth || .4, inlayHeight: options.inlayHeight || 0, layerSnap: true, combine: 'replace', locked: false };
}

function parseConceptBrief(brief) {
  const cleaned = String(brief || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const dateMatch = cleaned.match(/\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-]\s*(?:(?:point|dot)\s*)?|\s*(?:point|dot)\s+)(20\d{2})\b/i);
  const year = dateMatch?.[3] || cleaned.match(/\b20\d{2}\b/)?.[0] || String(new Date().getFullYear());
  const date = dateMatch ? `${Number(dateMatch[1])}. ${Number(dateMatch[2])}. ${dateMatch[3]}` : year;
  const distanceMatch = cleaned.match(/\b(?:\d+(?:[.,]\d+)?\s*(?:km|kilomet(?:er|re)s?)|5k|10k|half(?:\s+marathon)?|marathon)\b/i);
  const distance = distanceMatch?.[0]?.toUpperCase().replace(/\s+/g, '') || 'FINISHER';
  const quoted = cleaned.match(/[“"']([^”"']{3,60})[”"']/)?.[1]?.trim();
  let candidate = quoted || cleaned
    .replace(dateMatch?.[0] || '', ' ')
    .replace(distanceMatch?.[0] || '', ' ')
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/\b(?:make|create|design|generate|build)\s+(?:me\s+)?(?:a\s+)?(?:printable\s+)?medal\b/gi, ' ')
    .replace(/\b(?:this|it)\s+(?:will\s+)?be\s+(?:held\s+)?(?:on|at|in)\b/gi, ' ')
    .replace(/\b(?:for|please|point|event|competition|race)\b/gi, ' ')
    .replace(/\bmy\s+(?:run|race|event)\b/gi, ' ')
    .replace(/\b\d{1,2}\b/g, ' ')
    .replace(/[^\p{L}\p{N}&+ -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!candidate || /^(?:run|race|medal)$/i.test(candidate)) candidate = /run|race|marathon|5k|10k/i.test(cleaned) ? 'RUN EVENT' : 'YOUR EVENT';
  const title = candidate.toUpperCase().slice(0, 28);
  const visualSubject = /cycl|bike|bicycle/i.test(cleaned) ? 'dynamic cyclist' : /swim/i.test(cleaned) ? 'dynamic swimmer' : /trail|mountain|hike/i.test(cleaned) ? 'trail runner with a mountain contour' : /eagle|orol/i.test(cleaned) ? 'bold eagle symbol' : 'dynamic anatomically coherent runner';
  return { raw: cleaned, title, year, date, distance, visualSubject };
}

function createLocalConcepts(brief) {
  try {
    const { concepts } = generateMedalConcepts(brief, {
      locale: getCurrentLocale(),
      manufacturing: {
        nozzle: state.project.profile.nozzle,
        layerHeight: state.project.profile.layerHeight,
        baseThickness: state.project.medal.baseThickness,
        reliefHeight: state.project.medal.defaultHeight,
      },
    });
    return concepts.map(concept => ({
      ...concept.project,
      conceptMeta: {
        id: concept.id,
        label: concept.label,
        description: concept.description,
        qualityScore: concept.quality.score,
        qualityGrade: concept.quality.grade,
      },
    }));
  } catch (error) {
    // An aesthetic rejection must never fall through to an unchecked compact
    // layout: below-nine concepts are withheld, not relabelled as finished.
    if (error?.qualityResult) {
      console.warn('Concept withheld by the 9/10 aesthetic release gate.', error);
      return [];
    }
    console.warn('Structured concept generation fell back to the compact offline layouts.', error);
  }
  const parsed = parseConceptBrief(brief);
  const { title, year, date, distance } = parsed;
  const titleSize = Math.max(3.2, Math.min(7, 42 / Math.max(6, title.length) * 2.2));
  const paletteIds = [...state.project.paletteIds];
  const base = createTemplateProject('blank');
  const pathElement = (name, points, x, y, color, options = {}) => ({ id: uid('path'), type: 'path', name, points, x, y, scale: options.scale || 1, closed: options.closed !== false, strokeWidth: options.strokeWidth || 1, rotation: options.rotation || 0, color, hidden: false, face: options.face === 'back' ? 'back' : 'front', groupId: options.groupId || (options.face === 'back' ? 'concept-back' : 'concept-front'), scaleX: 1, scaleY: 1, lockAspect: true, operation: options.operation || 'raise', zHeight: options.zHeight || .6, zDepth: options.zDepth || .4, inlayHeight: 0, layerSnap: true, combine: 'replace', locked: false });
  const circlePoints = (cx, cy, radius, count = 36) => Array.from({ length: count }, (_, index) => { const angle = index / count * Math.PI * 2; return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]; });
  const smoothClosed = (points, iterations = 3) => {
    let result = points.map(point => [...point]);
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      result = result.flatMap((point, index) => {
        const next = result[(index + 1) % result.length];
        return [[point[0] * .75 + next[0] * .25, point[1] * .75 + next[1] * .25], [point[0] * .25 + next[0] * .75, point[1] * .25 + next[1] * .75]];
      });
    }
    return result;
  };
  const runnerBody = smoothClosed([[-2.4,-3.3],[-1.2,-5.1],[.7,-5.8],[2.4,-5.2],[3.2,-3.5],[5.1,-2.5],[7.4,-.5],[6.2,.8],[3.8,-.8],[2.6,-1.1],[2.1,.7],[3.7,2.3],[7.6,4.9],[7.1,6.3],[5.5,6.2],[1.6,4.1],[.1,2.9],[-1.9,4.1],[-5.5,6.1],[-6.8,5.1],[-6.4,3.8],[-2.6,.8],[-1.5,-.5],[-3.3,-1.2],[-6,-.1],[-7,-1.4],[-5.8,-2.6]]);
  const detailedRunner = (face = 'front', scale = 1.45, color = 1, y = -2) => [
    pathElement(face === 'back' ? 'Back runner body' : 'Runner body', runnerBody, 0, y, color, { scale, face, operation: face === 'back' ? 'engrave' : 'raise', zDepth: .4 }),
    pathElement(face === 'back' ? 'Back runner head' : 'Runner head', circlePoints(2.4, -8.7, 2.05), 0, y, color, { scale, face, operation: face === 'back' ? 'engrave' : 'raise', zDepth: .4 }),
    pathElement(face === 'back' ? 'Back motion line' : 'Motion line', [[-8.5,-4.4],[-5.8,-4.7],[-3.8,-4.4]], 0, y, color, { scale, face, closed: false, strokeWidth: .85, operation: face === 'back' ? 'engrave' : 'raise', zDepth: .4 }),
  ];
  const make = (suffix, elements, medal = {}) => {
    const project = normalizeProject({
      ...base,
      name: `${title || 'RUN EVENT'} · ${suffix}`,
      template: 'custom',
      medal: { ...base.medal, ...medal },
      profile: { ...state.project.profile },
      paletteIds,
      groups: [{ id: 'concept-front', name: 'Front concept' }, { id: 'concept-back', name: 'Back concept' }],
      elements,
    });
    const inset = project.medal.edgeInset + project.medal.rimWidth;
    for (const element of project.elements) {
      if (elementFitsSafeArea(project, element, inset)) continue;
      const startX = Number(element.scaleX) || 1, startY = Number(element.scaleY) || 1;
      for (let factor = .96; factor >= .2; factor -= .02) {
        element.scaleX = startX * factor; element.scaleY = startY * factor;
        if (elementFitsSafeArea(project, element, inset)) break;
      }
    }
    return normalizeProject(project);
  };
  const color1 = Math.min(1, paletteIds.length - 1), color2 = Math.min(2, paletteIds.length - 1);
  return [
    make('Bold type', [
      conceptText('Event', title, 0, -11, titleSize, color1, { groupId: 'concept-front' }),
      conceptText('Distance', distance, 0, 2, distance === 'FINISHER' ? 7 : 14, color2, { groupId: 'concept-front' }),
      conceptText('Date', date, 0, 15, date === year ? 7.5 : 5.5, color1, { groupId: 'concept-front' }),
      conceptText('Back event', title.slice(0, 20), 0, -5, Math.max(3.5, titleSize), color1, { face: 'back', groupId: 'concept-back', operation: 'inlay', zDepth: .4 }),
      conceptText('Back year', year, 0, 8, 9, color2, { face: 'back', groupId: 'concept-back', operation: 'inlay', zDepth: .4 }),
    ]),
    make('Motion', [
      conceptText('Event', title, 0, -17, titleSize, color1, { groupId: 'concept-front' }),
      ...detailedRunner('front', 1.35, color1, -1),
      conceptText('Distance', distance, 0, 15, distance === 'FINISHER' ? 6 : 9, color2, { groupId: 'concept-front' }),
      ...detailedRunner('back', 1.15, color1, -2),
      conceptText('Back year', year, 0, 13, 8, color2, { face: 'back', groupId: 'concept-back', operation: 'inlay', zDepth: .4 }),
    ], { loopStyle: 'slit', slitWidth: 27, slitHeight: 3.2, attachmentInset: 4 }),
    make('Split field', [
      pathElement('Upper field', [[-20,-20],[20,-20],[20,-3],[-20,-3]], 0, 0, color1, { zHeight: .4 }),
      pathElement('Diagonal accent', [[-18,-1],[18,8],[18,13],[-18,4]], 0, 0, color2, { zHeight: .6 }),
      conceptText('Event', title, 0, -11, titleSize, 0, { groupId: 'concept-front' }),
      conceptText('Distance', distance, 0, 15, distance === 'FINISHER' ? 6 : 9, color1, { groupId: 'concept-front' }),
      conceptText('Back identity', `${distance} · ${year}`, 0, 0, 6.3, color1, { face: 'back', groupId: 'concept-back', operation: 'inlay', zDepth: .4 }),
    ], { shape: 'rounded', width: 62, height: 62, diameter: 62, cornerRadius: 13 }),
  ];
}

let localMedalPlanProviderInstance = null;
let openAiMedalProviderInstance = null;

function localMedalPlanProvider() {
  localMedalPlanProviderInstance ||= new LocalMedalPlanProvider();
  return localMedalPlanProviderInstance;
}

function openAiMedalPlanProvider() {
  openAiMedalProviderInstance ||= new OpenAiMedalProvider();
  return openAiMedalProviderInstance;
}

function conceptPreviewUrl(project) {
  try {
    const svg = projectToSvg(enrichForExport(project, state.inventory));
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch (error) {
    console.warn('Could not build concept preview.', error);
    return '';
  }
}

function conceptsFromPlan(plan, generation = {}) {
  const { concepts } = generateMedalConcepts(plan, { locale: getCurrentLocale() });
  return concepts
    .slice()
    .sort((first, second) => second.quality.score - first.quality.score)
    .map((concept, rank) => ({
      ...concept.project,
      conceptMeta: {
        id: concept.id,
        label: concept.label,
        description: concept.description,
        qualityScore: concept.quality.score,
        qualityGrade: concept.quality.grade,
        quality: concept.quality,
        polishIterations: concept.polishIterations,
        generation,
        rank: rank + 1,
      },
    }));
}

async function probeConceptProviders({ quiet = false } = {}) {
  if (state.conceptProviderProbeBusy) return;
  state.conceptProviderProbeBusy = true;
  if (!quiet && state.panel === 'create' && state.createTool === 'ideas') renderToolPanel();
  if (!RUNTIME_CONFIG.sameOriginApi) {
    state.conceptProviderStatus = {
      local: { available: true, structured: true, modelConfigured: false, provider: 'deterministic-browser', fallbackAlwaysAvailable: true },
      openai: unavailableHostedCapability('Managed OpenAI medal planning'),
    };
    state.conceptGeneratorMode = 'local';
    state.conceptProviderProbeBusy = false;
    if (state.panel === 'create' && state.createTool === 'ideas') renderToolPanel();
    return;
  }
  const [localResult, openAiResult] = await Promise.allSettled([
    localMedalPlanProvider().checkStatus(),
    openAiMedalPlanProvider().checkStatus(),
  ]);
  state.conceptProviderStatus = {
    local: localResult.status === 'fulfilled'
      ? localResult.value
      : { available: true, structured: true, modelConfigured: false, provider: 'deterministic-local', fallbackAlwaysAvailable: true },
    openai: openAiResult.status === 'fulfilled'
      ? openAiResult.value
      : { available: false, configured: false, message: 'Managed OpenAI is not configured on this local app.' },
  };
  if (state.conceptGeneratorMode === 'openai' && !state.conceptProviderStatus.openai.available) {
    state.conceptGeneratorMode = 'local';
    setLocalPreference('medalforge-medal-generator', 'local');
  }
  state.conceptProviderProbeBusy = false;
  if (state.panel === 'create' && state.createTool === 'ideas') renderToolPanel();
}

async function generateConceptCandidates() {
  const brief = $('#conceptBrief')?.value.trim() || '';
  state.conceptBrief = brief;
  if (brief.length < 3) { toast('Describe the event in a few words first'); return; }
  if (state.conceptGenerationBusy) return;
  state.conceptGenerationBusy = true;
  state.conceptGenerationError = null;
  state.conceptGenerationMeta = null;
  state.conceptGenerationProgress = 'Planning editable typography, artwork, colors and printable relief…';
  state.conceptCandidates = [];
  state.conceptAbortController = new AbortController();
  renderToolPanel();
  const manufacturing = {
    nozzle: state.project.profile.nozzle,
    layerHeight: state.project.profile.layerHeight,
    baseThickness: state.project.medal.baseThickness,
    reliefHeight: state.project.medal.defaultHeight,
  };
  try {
    const useOpenAi = state.conceptGeneratorMode === 'openai' && state.conceptProviderStatus?.openai?.available;
    const result = useOpenAi
      ? await openAiMedalPlanProvider().generate({ brief, locale: getCurrentLocale(), ...manufacturing, signal: state.conceptAbortController.signal })
      : !RUNTIME_CONFIG.sameOriginApi
        ? { plan: parseMedalBrief(brief, { locale: getCurrentLocale(), manufacturing }), metadata: { provider: 'deterministic-browser', enhanced: false, offline: true } }
      : await localMedalPlanProvider().generate({
        brief,
        locale: getCurrentLocale(),
        manufacturing,
        preferModel: true,
        signal: state.conceptAbortController.signal,
        onProgress: update => {
          state.conceptGenerationProgress = update.message || state.conceptGenerationProgress;
          const status = $('#conceptGenerationStatus');
          if (status) status.textContent = state.conceptGenerationProgress;
        },
      });
    state.conceptGenerationMeta = result.metadata;
    state.conceptCandidates = result.plan
      ? conceptsFromPlan(result.plan, result.metadata)
      : createLocalConcepts(brief);
    state.conceptGenerationProgress = `${state.conceptCandidates.length} editable concepts cleared the 9/10 release gate.`;
    toast(`${state.conceptCandidates.length} polished editable medals are ready`);
  } catch (error) {
    if (error?.name === 'AbortError') state.conceptGenerationError = 'Medal creation was cancelled.';
    else if (error?.qualityResult) state.conceptGenerationError = `The draft scored ${error.qualityResult.score.toFixed(1)}/10. It was withheld instead of presenting a weak medal.`;
    else state.conceptGenerationError = error?.hint || error?.message || 'The medal planner could not finish this design.';
    state.conceptGenerationProgress = '';
    console.error('Text-to-medal generation failed.', error);
    toast(state.conceptGenerationError);
  } finally {
    state.conceptGenerationBusy = false;
    state.conceptAbortController = null;
    renderToolPanel();
  }
}

function ideasPanel(embedded = false) {
  const hostedStatic = RUNTIME_CONFIG.staticHosting;
  const parsed = parseConceptBrief(state.conceptBrief || 'running event');
  const planPreview = parseMedalBrief(state.conceptBrief || 'running event', {
    locale: getCurrentLocale(),
    manufacturing: {
      nozzle: state.project.profile.nozzle,
      layerHeight: state.project.profile.layerHeight,
      baseThickness: state.project.medal.baseThickness,
      reliefHeight: state.project.medal.defaultHeight,
    },
  });
  const previewDate = /^\d{2}-\d{2}\.\d{2}\.20\d{2}$/.test(planPreview.event.subtitle)
    ? planPreview.event.subtitle
    : planPreview.event.date
      ? planPreview.event.date.split('-').reverse().join('.')
      : String(planPreview.event.year);
  const previewDistance = planPreview.event.distance || (planPreview.event.edition ? `${planPreview.event.edition}TH` : 'FINISHER');
  const cards = state.conceptCandidates.map((project, index) => {
    const score = Number(project.conceptMeta?.qualityScore);
    const badge = Number.isFinite(score) ? `<em class="concept-score">${score.toFixed(1)}/10 · release ready</em>` : '';
    const preview = conceptPreviewUrl(project);
    const quality = project.conceptMeta?.quality;
    const weakest = quality?.categories
      ? Object.entries(quality.categories).sort(([, first], [, second]) => first.score - second.score)[0]
      : null;
    const weakestLabel = weakest ? `${weakest[0].replace(/([A-Z])/g, ' $1')} ${Number(weakest[1].score).toFixed(1)}` : '';
    return `<button type="button" class="concept-card" data-use-concept="${index}">${preview ? `<img src="${escapeHtml(preview)}" alt="Front and back preview of ${escapeHtml(project.conceptMeta?.label || project.name)}" />` : `<span>${index + 1}</span>`}<span class="concept-rank">#${index + 1}</span><strong><span data-i18n-ignore>${escapeHtml(project.conceptMeta?.label || project.name.split(' · ').at(-1))}</span>${badge}</strong><small><span data-i18n-ignore>${escapeHtml(project.conceptMeta?.description || `${project.elements.length} editable objects`)}</span><br>${project.elements.length} editable vector objects · flat printable back${weakestLabel ? ` · lowest check: ${escapeHtml(weakestLabel)}` : ''}</small></button>`;
  }).join('');
  const openAi = state.conceptProviderStatus?.openai;
  const openAiReady = Boolean(openAi?.available && openAi?.configured);
  const status = state.conceptGenerationError
    ? `<div class="concept-generation-status error"><strong>Draft withheld</strong><span>${escapeHtml(state.conceptGenerationError)}</span></div>`
    : state.conceptGenerationBusy || state.conceptGenerationProgress
      ? `<div class="concept-generation-status ${state.conceptGenerationBusy ? 'busy' : 'ready'}"><strong>${state.conceptGenerationBusy ? 'Designing and scoring…' : 'Quality gate passed'}</strong><span id="conceptGenerationStatus">${escapeHtml(state.conceptGenerationProgress)}</span></div>`
      : '';
  const bestAction = state.conceptCandidates.length ? `<button type="button" class="primary-wide concept-best" id="useBestConcept">Use highest-scoring medal · ${Number(state.conceptCandidates[0].conceptMeta?.qualityScore).toFixed(1)}/10</button>` : '';
  const artworkActions = hostedStatic
    ? '<span>Copy a print-aware prompt for your preferred image tool, then import the result under Image.</span><button type="button" id="copyArtworkPrompt">Copy artwork prompt</button>'
    : '<span>Create only the visual subject, then convert it into separate printable color areas.</span><button type="button" id="ideasToImage">Create image…</button><button type="button" id="copyArtworkPrompt">Copy artwork prompt</button><button type="button" id="localAiInfo">How image creation works</button>';
  return `${embedded ? '' : panelHeading('Describe it', 'Create a complete medal')}<div class="tool-form"><div class="concept-provider"><span>Runs free on this device</span>${openAiReady ? `<div class="concept-provider-options"><button type="button" data-concept-mode="local" class="${state.conceptGeneratorMode === 'local' ? 'active' : ''}" aria-pressed="${state.conceptGeneratorMode === 'local'}"><b>Free on this device</b><small>Private · always available</small></button><button type="button" data-concept-mode="openai" class="${state.conceptGeneratorMode === 'openai' ? 'active' : ''}" aria-pressed="${state.conceptGeneratorMode === 'openai'}"><b>Creative online service</b><small>Enabled by the site owner</small></button></div>` : ''}<small class="field-help">Describe the event in ordinary words. The app turns the idea into editable text, symbols, colors, edges, and a printable back.</small></div><label><span>What is the medal for?</span><textarea class="text-input concept-brief" id="conceptBrief" rows="5" data-i18n-ignore ${state.conceptGenerationBusy ? 'disabled' : ''} placeholder="${escapeHtml(translateUi('Example: Premium Prague night run, 10 km, 12 June 2027, elegant runners, moon and skyline'))}">${escapeHtml(state.conceptBrief || '')}</textarea></label><button class="primary-wide" id="generateConcepts" ${state.conceptGenerationBusy ? 'disabled' : ''}>${state.conceptGenerationBusy ? 'Creating editable medal…' : 'Create 4 editable medal ideas'}</button>${state.conceptGenerationBusy ? '<button type="button" class="quiet-wide" id="cancelConceptGeneration">Cancel</button>' : ''}<small class="field-help">Your description is interpreted; it is never pasted as one long sentence on the medal.</small><div class="quality-gate"><strong><span>✓</span> Quality checked</strong><small>Wording · balance · spacing · focal art · palette · printability · smooth detail</small></div>${status}<details class="friendly-disclosure"><summary>See what the app understood</summary><div class="idea-parse-preview"><span>Editable text</span><strong data-i18n-ignore>${escapeHtml(planPreview.event.title)} · ${escapeHtml(previewDistance)} · ${escapeHtml(previewDate)}</strong><span>Artwork subject</span><strong data-i18n-ignore>${escapeHtml(parsed.visualSubject)}</strong></div></details>${bestAction}<div class="concept-results">${cards}</div><div class="ai-local-note"><strong>Want custom illustrated artwork?</strong>${artworkActions}</div></div>`;
}

function createPanel() {
  const tools = [
    ['text', 'T', 'Text'], ['upload', '↑', 'Image'], ['shapes', '●', 'Shape'], ['draw', '✎', 'Draw'], ['ideas', '✦', 'Ideas'],
  ];
  const body = state.createTool === 'upload' ? uploadPanel(true) : state.createTool === 'shapes' ? shapesPanel(true) : state.createTool === 'draw' ? drawPanel(true) : state.createTool === 'ideas' ? ideasPanel(true) : textPanel(true);
  return `${panelHeading('One creation shelf', 'Add to medal')}
    <div class="create-tool-tabs" role="tablist" aria-label="Add content type">${tools.map(([key, icon, label]) => `<button type="button" role="tab" aria-selected="${state.createTool === key}" class="${state.createTool === key ? 'active' : ''}" data-create-tool="${key}"><span>${icon}</span>${label}</button>`).join('')}</div>
    ${body}
    <div class="create-surface-note"><strong>Printer defaults stay out of the way.</strong><br/>Use Settings only when the nozzle, layer height, or available filaments change.</div>`;
}

function medalThicknessMetrics() {
  const body = Number(state.project.medal.baseThickness) || 0;
  const layerHeight = Math.max(.01, Number(state.project.profile.layerHeight) || .2);
  const result = currentGeometryResult();
  const exactDepth = result?.bounds && Number.isFinite(result.bounds.maxZ) && Number.isFinite(result.bounds.minZ)
    ? result.bounds.maxZ - result.bounds.minZ
    : null;
  return {
    body,
    bodyLayers: body / layerHeight,
    layerHeight,
    finished: exactDepth ?? approximateMaxHeight(),
    exact: exactDepth !== null,
  };
}

function bodyLayerCountLabel(metrics) {
  const wholeLayers = Math.round(metrics.bodyLayers);
  const count = Math.abs(metrics.bodyLayers - wholeLayers) < .04 ? wholeLayers : Math.round(metrics.bodyLayers * 10) / 10;
  return localizedPluralMessage('medalSettingsUi.bodyLayer', count);
}

function updateMedalThicknessSummary() {
  if (!state.project) return;
  const metrics = medalThicknessMetrics();
  const layers = $('#medalBodyLayerCount');
  const finished = $('#medalFinishedThickness');
  if (layers) layers.textContent = bodyLayerCountLabel(metrics);
  if (finished) finished.textContent = translateUiKey(metrics.exact ? 'medalSettingsUi.measuredFromModel' : 'medalSettingsUi.estimatedThickness', { height: localizedFixed(metrics.finished) });
  $$('#toolPanelContent [data-medal-thickness]').forEach(button => {
    const active = Math.abs(Number(button.dataset.medalThickness) - metrics.body) < .001;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function exactMedalPreview(project, options = {}) {
  const palette = getPalette(project, state.inventory);
  const medal = project.medal;
  const body = palette[Math.max(0, Math.min(palette.length - 1, Number(medal.baseColor) || 0))];
  const rim = palette[Math.max(0, Math.min(palette.length - 1, Number(medal.rimColor) || 0))];
  const attachmentIndex = medal.attachmentColor === null || medal.attachmentColor === undefined ? Number(medal.baseColor) || 0 : Number(medal.attachmentColor) || 0;
  const attachment = palette[Math.max(0, Math.min(palette.length - 1, attachmentIndex))];
  const attachmentName = localizedAttachmentName(medal.loopStyle);
  const shapeName = localizedMedalShapeName(medal.shape);
  return medalTopViewSvg(project, {
    ...localizedPreviewOptions(),
    bodyColor: body?.color,
    rimColor: rim?.color,
    attachmentColor: attachment?.color,
    ...options,
    label: options.label || translateUiKey('wizardUi.exactTopView', { shape: shapeName, attachment: attachmentName }),
  });
}

function fitInternalAttachmentToBody(project) {
  if (!['eyelet', 'slit', 'open-slit'].includes(project.medal.loopStyle)) return project;
  const containsOpening = () => {
    const geometry = medalAttachmentGeometry(project);
    if (geometry.aperture?.kind === 'circle') {
      const radius = geometry.aperture.diameter / 2;
      return Array.from({ length: 24 }, (_, index) => {
        const angle = index * Math.PI * 2 / 24;
        return medalContainsPoint(project, geometry.aperture.cx + Math.cos(angle) * radius, geometry.aperture.cy + Math.sin(angle) * radius);
      }).every(Boolean);
    }
    const aperture = geometry.aperture;
    if (!aperture) return true;
    return [[aperture.x0, aperture.cy], [aperture.x1, aperture.cy], [aperture.x0 + aperture.height / 2, aperture.y1], [aperture.x1 - aperture.height / 2, aperture.y1], ...(geometry.style === 'slit' ? [[0, aperture.y0]] : [])]
      .every(([x, y]) => medalContainsPoint(project, x, y));
  };
  const maximum = Math.max(0, Number(project.medal.height || project.medal.diameter) / 2 - .5);
  for (let inset = Number(project.medal.attachmentInset) || 0; inset <= maximum; inset += .25) {
    project.medal.attachmentInset = Math.round(inset * 100) / 100;
    if (containsOpening()) return project;
  }
  return project;
}

function attachmentPreviewProject(project, style) {
  const candidate = structuredClone(project);
  candidate.medal = { ...candidate.medal, loopStyle: style };
  return normalizeProject(fitInternalAttachmentToBody(normalizeProject(candidate)));
}

function attachmentChoiceMarkup(project, style, info, attributes = '') {
  const candidate = attachmentPreviewProject(project, style);
  return `<button type="button" ${attributes} class="attachment-card ${project.medal.loopStyle === style ? 'active' : ''}" data-attachment-style="${style}"><span class="attachment-geometry-icon">${exactMedalPreview(candidate, { compact: true, showDimensions: false, label: `${info.label} on ${candidate.medal.shape} medal` })}</span><strong>${escapeHtml(info.label)}</strong><small>${escapeHtml(info.description)}</small></button>`;
}

function medalPanel() {
  const medal = state.project.medal;
  const thickness = medalThicknessMetrics();
  const palette = getPalette(state.project, state.inventory);
  const outlineSource = selectedElement();
  const savedOutlineSource = state.project.elements.find(element => element.id === medal.outlineSourceId);
  const canUseOutline = outlineSource?.type === 'path' && outlineSource.closed && outlineSource.points.length >= 3;
  const outlines = [
    ['circle','●','Circle'],['oval','⬭','Oval'],['rounded','▣','Rounded'],['hexagon','⬢','Hexagon'],
    ['octagon','⯃','Octagon'],['scalloped','✿','Scalloped'],['star','★','Star'],['gear','⚙','Gear'],['shield','♢','Shield'],
  ];
  if (medal.outline?.length >= 3) outlines.push(['custom','✦','Custom']);
  const ribbonPresets = medal.loopStyle === 'none' || medal.loopStyle === 'eyelet' ? '' : `<div class="ribbon-presets"><span>${escapeHtml(translateUiKey('medalSettingsUi.ribbonFit'))}</span><button type="button" data-ribbon-preset="22">22 mm</button><button type="button" data-ribbon-preset="25" class="recommended">${escapeHtml(translateUiKey('medalSettingsUi.standardRibbon', { width: '25' }))}</button><button type="button" data-ribbon-preset="38">${escapeHtml(translateUiKey('medalSettingsUi.wideRibbon', { width: '38' }))}</button></div><small class="field-help">${escapeHtml(translateUiKey('medalSettingsUi.presetClearance'))}</small>`;
  const attachmentFields = ['single', 'double'].includes(medal.loopStyle)
    ? `<div class="dimension-grid"><label>Bar width<input data-medal-field="loopWidth" type="number" min="12" max="60" step="0.5" value="${medal.loopWidth}" /></label><label>Bar height<input data-medal-field="loopHeight" type="number" min="5" max="18" step="0.5" value="${medal.loopHeight}" /></label><label>Opening width<input data-medal-field="slotWidth" type="number" min="6" max="55" step="0.5" value="${medal.slotWidth}" /></label><label>Opening height<input data-medal-field="slotHeight" type="number" min="2" max="16" step="0.2" value="${medal.slotHeight}" /></label></div>`
    : medal.loopStyle === 'eyelet'
      ? `<div class="dimension-grid"><label>Hole diameter<input data-medal-field="holeDiameter" type="number" min="0.4" max="24" step="0.2" value="${medal.holeDiameter}" /></label><label>Edge to hole<input data-medal-field="attachmentInset" type="number" min="0" max="24" step="0.2" value="${medal.attachmentInset}" /></label></div>`
      : ['slit', 'open-slit'].includes(medal.loopStyle)
        ? `<div class="dimension-grid"><label>Ribbon width<input data-medal-field="slitWidth" type="number" min="1" max="50" step="0.5" value="${medal.slitWidth}" /></label><label>Opening height<input data-medal-field="slitHeight" type="number" min="0.4" max="12" step="0.2" value="${medal.slitHeight}" /></label><label>Edge to opening<input data-medal-field="attachmentInset" type="number" min="0" max="24" step="0.2" value="${medal.attachmentInset}" /></label></div>`
        : '<p class="panel-intro">The exported body will have no ribbon opening.</p>';
  const materialRole = (field, label, description) => {
    const selected = palette[Math.max(0, Math.min(palette.length - 1, Number(medal[field]) || 0))] || palette[0];
    return `<section class="material-role-card"><div class="material-role-copy"><span>${escapeHtml(label)}</span><strong><i style="background:${selected?.color || '#777'}"></i><span data-i18n-ignore>${escapeHtml(selected?.name || 'Material')}</span></strong><small>${escapeHtml(description)}</small></div><div class="material-role-swatches" role="radiogroup" aria-label="${escapeHtml(label)} color">${palette.map((filament, index) => `<button type="button" role="radio" aria-checked="${Number(medal[field]) === index}" class="${Number(medal[field]) === index ? 'active' : ''}" data-medal-color-field="${field}" data-medal-color-slot="${index}" title="${escapeHtml(filament.name)} · ${escapeHtml(filament.effect)}" aria-label="Color ${index + 1}: ${escapeHtml(filament.name)}"><i style="background:${filament.color}"></i><span>${index + 1}</span></button>`).join('')}${inlineAddColorButtonHtml(`medal:${field}`, { compact: true })}</div></section>`;
  };
  const edgeStyles = `<button type="button" class="rim-style-card ${medal.rimWidth <= 0 ? 'active' : ''}" data-rim-style="none"><b>—</b><span>None</span><small>Flat edge</small></button>${Object.entries(RIM_STYLE_INFO).map(([key, info]) => `<button type="button" class="rim-style-card ${medal.rimWidth > 0 && medal.rimStyle === key ? 'active' : ''}" data-rim-style="${key}"><b>${info.icon}</b><span>${escapeHtml(info.label)}</span><small>${escapeHtml(info.description)}</small></button>`).join('')}`;
  return `${panelHeading('Medal basics', 'Body, edge & ribbon')}
    <label class="field-label">Outline</label>
    <div class="outline-picker">${outlines.map(([shape, icon, label]) => `<button data-medal-shape="${shape}" class="${medal.shape === shape ? 'active' : ''}"><b>${icon}</b><span>${label}</span></button>`).join('')}</div>
    <details class="friendly-disclosure"><summary>Use my own medal outline</summary><div class="custom-outline-card"><span><strong>Custom drawn or DXF outline</strong><small>Draw a closed shape or import an outline, select it, then turn it into the medal body.</small></span><span class="custom-outline-actions"><button id="useSelectedOutline" ${canUseOutline ? '' : 'disabled'}>${canUseOutline ? `Use “${escapeHtml(outlineSource.name)}”` : 'Select a closed outline'}</button>${savedOutlineSource ? '<button id="restoreOutlineSource">Edit source outline</button>' : ''}</span></div></details>
    <div class="dimension-grid medal-planar-dimensions">
      ${medal.shape === 'circle' ? `<label>Diameter (mm)<input data-medal-field="diameter" type="number" min="${DESIGN_LIMITS.medalMin}" max="${DESIGN_LIMITS.medalMax}" step="1" value="${medal.diameter}" /></label>` : `<label>Width (mm)<input data-medal-field="width" type="number" min="${DESIGN_LIMITS.medalMin}" max="${DESIGN_LIMITS.medalMax}" step="1" value="${medal.width}" /></label><label>Height (mm)<input data-medal-field="height" type="number" min="${DESIGN_LIMITS.medalMin}" max="${DESIGN_LIMITS.medalMax}" step="1" value="${medal.height}" /></label>`}
      ${medal.shape === 'rounded' ? `<label>Corner radius<input data-medal-field="cornerRadius" type="number" min="1" max="${Math.min(medal.width, medal.height) / 2}" step="1" value="${medal.cornerRadius}" /></label>` : ''}
    </div>
    <section class="medal-thickness-card" aria-labelledby="medalThicknessLabel">
      <div class="medal-thickness-head">
        <span><strong id="medalThicknessLabel">Medal thickness</strong><small>Main printable body</small></span>
        <label class="unit-input" aria-label="Medal thickness in millimeters"><input id="medalThicknessInput" data-medal-thickness-input type="number" inputmode="decimal" min="1.2" max="${DESIGN_LIMITS.baseThicknessMax}" step="0.2" value="${medal.baseThickness}" /><em>mm</em></label>
      </div>
      <div class="medal-thickness-presets" aria-label="Common medal thicknesses">
        ${[2, 2.4, 3, 4].map(value => `<button type="button" data-medal-thickness="${value}" class="${Math.abs(medal.baseThickness - value) < .001 ? 'active' : ''}" aria-pressed="${Math.abs(medal.baseThickness - value) < .001}">${formatLocalizedNumber(value, { maximumFractionDigits: 1 })} mm</button>`).join('')}
      </div>
      <div class="medal-thickness-meta"><span><b id="medalBodyLayerCount">${bodyLayerCountLabel(thickness)}</b><small>${escapeHtml(translateUiKey('medalSettingsUi.atLayerHeight', { height: localizedFixed(thickness.layerHeight) }))}</small></span><span><b id="medalFinishedThickness">${escapeHtml(translateUiKey(thickness.exact ? 'medalSettingsUi.measuredFromModel' : 'medalSettingsUi.estimatedThickness', { height: localizedFixed(thickness.finished) }))}</b><small>${escapeHtml(translateUiKey('medalSettingsUi.maximumWithRaisedDetails'))}</small></span></div>
      <small>The body can be 1.2–${DESIGN_LIMITS.baseThicknessMax} mm thick. Raised artwork and the edge sit above it, so the finished maximum may be slightly thicker.</small>
    </section>
    <label class="field-label">Body & raised edge colors</label>
    <div class="medal-material-roles">${materialRole('baseColor', 'Medal body', translateUiKey('medalSettingsUi.bodyDescription'))}${materialRole('rimColor', 'Raised edge', translateUiKey('medalSettingsUi.edgeDescription'))}</div>
    <label class="field-label">Raised edge style</label>
    <div class="rim-style-picker">${edgeStyles}</div>
    <details class="friendly-disclosure"><summary>Fine-tune edge size</summary><div class="dimension-grid edge-dimensions"><label>Edge width<input data-medal-field="rimWidth" type="number" min="0" max="${DESIGN_LIMITS.rimWidthMax}" step="0.1" value="${medal.rimWidth}" /></label><label>Edge height<input data-medal-field="rimHeight" type="number" min="0.1" max="${DESIGN_LIMITS.rimHeightMax}" step="${state.project.profile.layerHeight}" value="${medal.rimHeight}" /></label></div></details>
    <small class="field-help">The border is real multicolor geometry in the 3D preview, quote, 3MF, STL, and technical sheet.</small>
    <label class="field-label">Ribbon attachment</label>
    <div class="attachment-picker">${Object.entries(ATTACHMENT_STYLE_INFO).map(([key, info]) => attachmentChoiceMarkup(state.project, key, info)).join('')}</div>
    <div class="attachment-fields">${ribbonPresets}<details class="friendly-disclosure"><summary>Fine-tune ribbon opening</summary><div>${attachmentFields}</div></details></div>
    <details class="advanced-disclosure"><summary>Advanced construction settings</summary><div class="dimension-grid"><label>New-item height<input data-medal-field="defaultHeight" type="number" min="0.1" max="${DESIGN_LIMITS.reliefHeightMax}" step="${state.project.profile.layerHeight}" value="${medal.defaultHeight}" /></label><label>Minimum solid floor<input data-medal-field="minimumFloor" type="number" min="0.6" max="${Math.max(.6, medal.baseThickness - .2)}" step="0.1" value="${medal.minimumFloor}" /></label><label>Edge inset<input data-medal-field="edgeInset" type="number" min="0" max="5" step="0.1" value="${medal.edgeInset}" /></label></div></details>
    <div class="upload-note"><strong>${escapeHtml(translateUiKey('medalSettingsUi.throughCut'))}</strong><br/>${escapeHtml(translateUiKey('medalSettingsUi.exactGeometryHelp'))}</div>`;
}

function layerPanel() {
  const palette = getPalette(state.project, state.inventory);
  const rows = [...state.project.elements].reverse().map(element => {
    const icon = element.type === 'text' ? 'T' : element.type === 'image' ? '▧' : element.type === 'path' ? '⌁' : '●';
    const info = OPERATION_INFO[element.operation] || OPERATION_INFO.raise;
    const operationBadge = element.face === 'back' ? `◆ ${escapeHtml(translateUiKey('text.flat'))}` : `${info.icon} ${escapeHtml(localizedOperationLabel(element.operation))}`;
    const faceLabel = translateUiKey(element.face === 'back' ? 'common.backSide' : 'common.front');
    const colorLabel = element.type === 'image'
      ? localizedCount('color', imageUsedSlots(element, palette.length).length)
      : `<span data-i18n-ignore>${escapeHtml(palette[element.color]?.name || `Color ${(element.color ?? 0) + 1}`)}</span>`;
    return `<div class="layer-row ${element.id === state.selectedId ? 'selected' : ''} ${element.hidden ? 'is-hidden' : ''}">
      <button type="button" class="layer-select" data-layer-id="${escapeHtml(element.id)}" aria-label="Select ${escapeHtml(element.name)}"><span class="layer-thumb">${icon}</span><span class="layer-copy"><strong data-i18n-ignore>${escapeHtml(element.name)}</strong><small><i class="operation-badge ${element.operation}">${operationBadge}</i> · ${escapeHtml(faceLabel)}${element.operation === 'cut' ? '' : ` · ${localizedFixed(operationValue(element))} mm`}${element.operation === 'cut' || element.operation === 'engrave' ? '' : ` · ${colorLabel}`}</small></span></button>
      <span class="layer-actions">
        <button data-layer-move="up" data-layer-action-id="${escapeHtml(element.id)}" title="Place in front of overlapping items" aria-label="Move ${escapeHtml(element.name)} forward">↑</button>
        <button data-layer-move="down" data-layer-action-id="${escapeHtml(element.id)}" title="Place behind overlapping items" aria-label="Move ${escapeHtml(element.name)} backward">↓</button>
        <button data-toggle-lock="${escapeHtml(element.id)}" title="${element.locked ? 'Unlock' : 'Lock'}" aria-label="${element.locked ? 'Unlock' : 'Lock'} ${escapeHtml(element.name)}" aria-pressed="${element.locked}">${element.locked ? '▣' : '▢'}</button>
        <button data-toggle-layer="${escapeHtml(element.id)}" aria-label="${element.hidden ? 'Show' : 'Hide'} ${escapeHtml(element.name)}" aria-pressed="${!element.hidden}">${element.hidden ? '○' : '●'}</button>
      </span>
    </div>`;
  }).join('');
  return `${panelHeading('Front & back', 'Design items')}<p class="panel-intro">Choose any item to edit its wording, size, color, height, or side. Items higher in this list appear in front when designs overlap. Back items always print as flat first-layer colors.</p><div class="layer-list">${rows || '<div class="selection-empty"><b>No design items yet</b><span>Add text, a symbol, an image, or draw directly.</span></div>'}</div>`;
}

function renderToolPanel() {
  const root = $('#toolPanelContent');
  root.innerHTML = state.panel === 'medal' ? medalPanel() : state.panel === 'layers' ? layerPanel() : createPanel();
  bindToolPanel();
}

function queuePlacement(element, label = element.name, options = {}) {
  const assemblyCount = Array.isArray(options.assembly?.parts) ? options.assembly.parts.length : 1;
  if (state.project.elements.length + assemblyCount > DESIGN_LIMITS.elements) { toast(`This design has room for ${Math.max(0, DESIGN_LIMITS.elements - state.project.elements.length)} more objects, but this artwork contains ${assemblyCount}. Remove a few parts first.`); return; }
  if (options.assembly && state.project.groups.length >= DESIGN_LIMITS.groups) { toast(`This design reached the safe ${DESIGN_LIMITS.groups}-group browser budget`); return; }
  cancelDrawing(false);
  element.face = element.face === 'back' ? 'back' : 'front';
  element.scaleX = Number(element.scaleX) || 1;
  element.scaleY = Number(element.scaleY) || 1;
  element.lockAspect = element.lockAspect !== false;
  const intendedSurface = {
    operation: element.operation,
    zHeight: element.zHeight,
    zDepth: element.zDepth,
    inlayHeight: element.inlayHeight,
    layerSnap: element.layerSnap,
    combine: element.combine,
  };
  enforceFlatBackArtwork(element, state.project);
  const fit = autoFitElementToFace(element);
  // Mobile creation tools are drawers over the model. Placement must expose
  // the actual 3D canvas before asking the user to click its face.
  $('.side-panel')?.classList.remove('mobile-open');
  $('.inspector')?.classList.remove('mobile-open');
  state.placementEcho = null;
  state.pendingInsert = { element, label, hit: null, valid: false, autoFitFactor: fit.factor, assembly: options.assembly || null, intendedSurface };
  state.drawing.mode = 'select';
  setView('3d');
  $('#canvasWrap')?.classList.add('placing');
  $('#placementGhostLabel').innerHTML = `<span data-i18n-ignore>${escapeHtml(element.name || `Place ${label}`)}</span>`;
  const bounds = elementBounds(element);
  $('#placementGhostSize').textContent = `${bounds.width.toFixed(1)} × ${bounds.height.toFixed(1)} mm`;
  $('#placementGhostFace').textContent = 'Front: normal relief · Back: flat first-layer color';
  $('#placementGhost').hidden = false;
  renderPlacementGhost(element);
  const ghost = $('#placementGhost'), preview = $('#placementGhostCanvas');
  ghost.style.left = '50%'; ghost.style.top = '50%';
  preview.style.transform = 'none';
  const initialWidth = Math.max(48, Math.min(180, bounds.width * 4));
  preview.style.width = `${initialWidth}px`;
  preview.style.height = `${Math.max(28, initialWidth * bounds.height / Math.max(.1, bounds.width))}px`;
  requestAnimationFrame(() => positionPlacementGhost(element, element.face === 'back' ? medalBottomZ() : medalTopZ()));
  $('#stageHint').textContent = translateUiKey('stage.placeEitherFace', { name: label });
  toast(fit.fitted ? `${label} auto-fitted to the printable face · click to place` : `Click the medal to place ${label}`);
}

function renderPlacementGhost(element) {
  const preview = $('#placementGhostCanvas');
  if (!preview || !element) return;
  const bounds = elementBounds(element);
  const aspect = Math.max(.02, Math.min(DESIGN_LIMITS.scaleMax, bounds.width / Math.max(.1, bounds.height)));
  preview.width = aspect >= 1 ? 320 : Math.max(48, Math.round(320 * aspect));
  preview.height = aspect >= 1 ? Math.max(48, Math.round(320 / aspect)) : 320;
  const context = preview.getContext('2d');
  const width = preview.width, height = preview.height;
  context.clearRect(0, 0, width, height);
  const scale = Math.min((width - 18) / Math.max(.1, bounds.width), (height - 18) / Math.max(.1, bounds.height));
  const palette = getPalette(state.project, state.inventory);
  let localCenterX = 0, localCenterY = 0;
  if (element.type === 'path' && element.points?.length) {
    const xs = element.points.map(point => point[0] * element.scale), ys = element.points.map(point => point[1] * element.scale);
    localCenterX = (Math.min(...xs) + Math.max(...xs)) / 2;
    localCenterY = (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  context.save();
  context.translate(width / 2, height / 2);
  context.scale(scale * (Number(element.scaleX) || 1), scale * (Number(element.scaleY) || 1));
  context.translate(-localCenterX, -localCenterY);
  context.fillStyle = ['engrave', 'cut'].includes(element.operation) ? '#e89529' : (palette[element.color]?.color || '#315ff4');
  context.strokeStyle = context.fillStyle;
  context.lineCap = 'round'; context.lineJoin = 'round';
  if (element.type === 'text') {
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = `${element.weight || 800} ${element.fontSize}px ${element.fontFamily || 'Arial'}`; context.fillText(element.text || 'TEXT', 0, 0);
  } else if (element.type === 'shape') {
    drawShapePath(context, element.shape, element.size); context.fill();
  } else if (element.type === 'path') {
    context.beginPath(); element.points.forEach((point, index) => index ? context.lineTo(point[0] * element.scale, point[1] * element.scale) : context.moveTo(point[0] * element.scale, point[1] * element.scale));
    if (element.closed) { context.closePath(); context.fill(); } else { context.lineWidth = element.strokeWidth; context.stroke(); }
  } else if (element.type === 'image') {
    const image = ensureImage(element.dataUrl);
    if (image?.complete && image.naturalWidth) context.drawImage(image, -element.width / 2, -element.height / 2, element.width, element.height);
    else {
      context.globalAlpha = .25; context.fillRect(-element.width / 2, -element.height / 2, element.width, element.height); context.globalAlpha = 1;
      context.fillStyle = '#315ff4'; context.font = '800 3px Arial'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('IMAGE', 0, 0);
    }
  }
  context.restore();
  if (['engrave', 'cut'].includes(element.operation)) {
    context.save(); context.strokeStyle = '#e89529'; context.lineWidth = 2; context.setLineDash([6, 4]); context.strokeRect(3, 3, width - 6, height - 6); context.restore();
  }
}

function positionPlacementGhost(element, z) {
  if (!state.viewer || !element) return false;
  const frame = elementFramePoints(element), slot = Math.max(0, Number(element.color) || 0);
  const points = frame.corners.map(point => state.viewer.designToScreen(point.x, point.y, z, slot));
  const center = state.viewer.designToScreen(frame.center.x, frame.center.y, z, slot);
  if (!center?.visible || points.some(point => !point?.visible)) return false;
  const horizontal = { x: points[1].x - points[0].x, y: points[1].y - points[0].y };
  const vertical = { x: points[3].x - points[0].x, y: points[3].y - points[0].y };
  const width = Math.max(1, Math.hypot(horizontal.x, horizontal.y));
  const height = Math.max(1, Math.hypot(vertical.x, vertical.y));
  const ghost = $('#placementGhost'), preview = $('#placementGhostCanvas');
  ghost.style.left = `${center.x}px`; ghost.style.top = `${center.y}px`;
  preview.style.width = `${width}px`; preview.style.height = `${height}px`;
  preview.style.transformOrigin = '50% 50%';
  preview.style.transform = `matrix(${horizontal.x / width},${horizontal.y / width},${vertical.x / height},${vertical.y / height},0,0)`;
  return true;
}

function updatePlacementPreview(event) {
  const pending = state.pendingInsert;
  if (!pending || !state.viewer) return null;
  const hit = pickElementIn3D(event.clientX, event.clientY);
  const horizontalHit = hit?.surface && Math.abs(hit.surface.normal?.[2] || 0) > .7 ? hit : null;
  const bottomZ = medalBottomZ(), topZ = medalTopZ();
  const cameraZ = state.viewer.cameraPosition?.()?.[2] ?? topZ + 1;
  const fallbackFace = cameraZ < (bottomZ + topZ) / 2 ? 'back' : 'front';
  const fallbackZ = fallbackFace === 'back' ? bottomZ : topZ;
  const fallbackPoint = state.viewer.screenToDesignPlane(event.clientX, event.clientY, fallbackZ);
  const fallbackInside = fallbackPoint && medalContainsPoint(state.project, fallbackPoint.x, fallbackPoint.y, 0);
  const point = horizontalHit?.point || (fallbackInside ? { ...fallbackPoint, z: fallbackZ } : null);
  const surface = horizontalHit?.surface || (point ? { face: fallbackFace === 'back' ? 'bottom' : 'top', normal: [0, 0, fallbackFace === 'back' ? -1 : 1] } : null);
  if (point) {
    pending.element.x = point.x;
    pending.element.y = point.y;
    const nextFace = surface.face === 'bottom' || surface.normal[2] < 0 ? 'back' : 'front';
    Object.assign(pending.element, pending.intendedSurface, { face: nextFace });
    enforceFlatBackArtwork(pending.element, state.project);
    constrainElement(pending.element);
  }
  pending.hit = point ? { point: { ...point }, surface } : null;
  pending.valid = Boolean(point && elementPlacementFits(pending.element));
  const wrapRect = $('#canvasWrap').getBoundingClientRect();
  const ghost = $('#placementGhost');
  ghost.hidden = false;
  ghost.classList.toggle('invalid', !pending.valid);
  const bounds = elementBounds(pending.element);
  const z = point?.z ?? (pending.element.face === 'back' ? medalBottomZ() : medalTopZ());
  const preview = $('#placementGhostCanvas');
  renderPlacementGhost(pending.element);
  if (!point || !positionPlacementGhost(pending.element, z)) {
    ghost.style.left = `${event.clientX - wrapRect.left}px`; ghost.style.top = `${event.clientY - wrapRect.top}px`;
    preview.style.transform = 'none';
    const fallbackWidth = Math.max(34, Math.min(230, bounds.width * 4));
    preview.style.width = `${fallbackWidth}px`; preview.style.height = `${Math.max(24, fallbackWidth * bounds.height / Math.max(.1, bounds.width))}px`;
  }
  $('#placementGhostLabel').innerHTML = `<span data-i18n-ignore>${escapeHtml(pending.element.name)}</span>`;
  $('#placementGhostSize').textContent = `${bounds.width.toFixed(1)} × ${bounds.height.toFixed(1)} mm`;
  $('#placementGhostFace').textContent = !point ? 'Choose the front or back medal face' : pending.element.face === 'back' ? 'Back face · readable from back · flush first-layer color' : 'Front face · normal relief available';
  $('#stageHint').textContent = pending.valid
    ? translateUiKey(pending.element.face === 'back' ? 'stage.placeBack' : 'stage.placeFront', { width: localizedFixed(bounds.width, 1), height: localizedFixed(bounds.height, 1) })
    : translateUiKey('stage.insideFace');
  return pending.hit;
}

function cancelPlacement(message = '', options = {}) {
  state.pendingInsert = null;
  if (!options.keepGhost) { state.placementEcho = null; $('#placementGhost').hidden = true; }
  $('#canvasWrap')?.classList.remove('placing');
  if (message) toast(message);
}

function setLocalAiMessage(message, options = {}) {
  state.localAiStatus = message;
  state.localAiError = Boolean(options.error);
  const output = $('#localAiStatus');
  if (output) {
    output.textContent = message;
    output.classList.toggle('generator-error', state.localAiError);
    output.setAttribute('role', state.localAiError ? 'alert' : 'status');
  }
}

function cloudImageGenerator() {
  if (!state.cloudImageGenerator) state.cloudImageGenerator = new CloudImageProvider();
  return state.cloudImageGenerator;
}

function localImageGenerator() {
  if (!state.localImageGenerator) state.localImageGenerator = new LocalImageProvider();
  return state.localImageGenerator;
}

function activeImageGenerator(mode = state.imageGeneratorMode) {
  return mode === 'local' ? localImageGenerator() : cloudImageGenerator();
}

function updateBrowserAiUi() {
  const capability = state.localAiCapability;
  const ready = capability?.available === true;
  const localMode = state.imageGeneratorMode === 'local';
  const setup = localMode ? capability?.setup : null;
  const setupBusy = Boolean(setup?.busy || (state.localAiBusy && state.localAiPhase === 'setup'));
  const badge = $('#localAiBadge');
  if (badge) {
    badge.className = `local-ai-badge ${ready ? 'cached' : capability ? (setup?.supported || !localMode ? 'supported' : 'unsupported') : 'unchecked'}`;
    badge.textContent = state.localAiProbeBusy && !state.localAiBusy
      ? 'Checking…'
      : ready
        ? 'Ready'
        : setupBusy
          ? 'Setting up…'
          : capability
            ? localMode
              ? setup?.installed ? 'Ready to start' : setup?.supported ? 'One-click setup' : 'Unavailable'
              : 'Not included'
            : 'Checking…';
  }
  const button = $('#generateLocalArtwork');
  if (button) {
    button.disabled = state.localAiBusy || (!localMode && Boolean(capability) && !ready);
    button.textContent = state.localAiBusy
      ? state.localAiPhase === 'setup' ? 'Setting up automatically…' : state.localAiPhase === 'checking' ? 'Checking…' : 'Creating image…'
      : localMode && capability && !ready && setup?.supported
        ? `${setup.installed ? 'Start' : 'Set up'} & create image`
        : `Create ${state.localArtworkCount === 1 ? 'image' : `${state.localArtworkCount} images`}`;
  }
  const providerSelect = $('#imageGeneratorMode');
  if (providerSelect) providerSelect.disabled = state.localAiBusy;
  const progressWrap = $('#localAiProgressWrap');
  if (progressWrap) progressWrap.hidden = !state.localAiBusy;
  const progress = $('#localAiProgress');
  const progressText = $('#localAiProgressText');
  if (progress) {
    const value = Number(state.localAiProgress?.progress);
    if (Number.isFinite(value)) progress.value = Math.max(0, Math.min(1, value));
    else progress.removeAttribute('value');
    if (progressText) progressText.textContent = state.localAiProgress?.message || 'Preparing…';
  }
  const sizeSelect = $('#localArtworkSize');
  const countSelect = $('#localArtworkCount');
  if (localMode && ready) {
    const sizes = Array.isArray(capability.sizes) && capability.sizes.length ? capability.sizes : ['1024x1024'];
    const allowedSizes = new Set(sizes);
    for (const option of sizeSelect?.options || []) option.disabled = !allowedSizes.has(option.value);
    if (!allowedSizes.has(state.localArtworkSize)) {
      state.localArtworkSize = allowedSizes.has(capability.defaults?.size) ? capability.defaults.size : sizes[0];
      if (sizeSelect) sizeSelect.value = state.localArtworkSize;
      setLocalPreference('medalforge-ai-size', state.localArtworkSize);
    }
    const maxCount = Math.max(1, Math.min(4, Number(capability.maxCount) || 1));
    for (const option of countSelect?.options || []) option.disabled = Number(option.value) > maxCount;
    if (state.localArtworkCount > maxCount) {
      state.localArtworkCount = maxCount;
      if (countSelect) countSelect.value = String(maxCount);
      setLocalPreference('medalforge-ai-count', String(maxCount));
      if (button && !state.localAiBusy) button.textContent = maxCount === 1 ? 'Create image' : `Create ${maxCount} images`;
    }
  } else {
    for (const option of sizeSelect?.options || []) option.disabled = false;
    for (const option of countSelect?.options || []) option.disabled = false;
  }
}

async function checkLocalAiAvailability({ quiet = false, mode = state.imageGeneratorMode } = {}) {
  const existing = state.localAiProbePromise;
  if (existing?.mode === mode) return existing.promise;
  const token = ++state.localAiProbeToken;
  const localMode = mode === 'local';
  if (!RUNTIME_CONFIG.sameOriginApi) {
    const capability = unavailableHostedCapability(localMode ? 'Local image generation' : 'Online image generation');
    state.localAiCapability = capability;
    state.localAiProbeBusy = false;
    state.localAiProbePromise = null;
    setLocalAiMessage(capability.message);
    updateBrowserAiUi();
    if (!quiet) toast(capability.message);
    return false;
  }
  const provider = activeImageGenerator(mode);
  state.localAiProbeBusy = true;
  if (!state.localAiBusy) state.localAiPhase = 'checking';
  if (mode === state.imageGeneratorMode) {
    setLocalAiMessage(localMode ? 'Checking the image maker on this computer…' : 'Checking online image availability…');
    updateBrowserAiUi();
  }
  const promise = (async () => {
    try {
      const capability = await provider.checkStatus();
      if (token !== state.localAiProbeToken || mode !== state.imageGeneratorMode) return capability.available;
      state.localAiCapability = capability;
      const message = capability.available
        ? localMode
          ? `${capability.setup?.model || 'Local image maker'} is ready on this computer.`
          : 'Online image creation is ready. Customers never enter an API key.'
        : localMode
          ? capability.setup?.message || 'The free image maker can be set up automatically from the Create button.'
          : 'Online generation isn’t enabled in this local build. Choose On this computer or import an image.';
      setLocalAiMessage(message);
      if (!quiet) toast(capability.available ? (localMode ? 'Local image creation is ready' : 'Online image creation is ready') : message);
      return capability.available;
    } catch {
      if (token !== state.localAiProbeToken || mode !== state.imageGeneratorMode) return false;
      const message = localMode
        ? 'The local image maker could not be checked. Click Create to try again.'
        : 'Online generation isn’t available in this build. Choose On this computer or import an image.';
      state.localAiCapability = { available: false, message, setup: null };
      setLocalAiMessage(message, { error: true });
      if (!quiet) toast(message);
      return false;
    } finally {
      if (token === state.localAiProbeToken) {
        state.localAiProbeBusy = false;
        state.localAiProbePromise = null;
        if (!state.localAiBusy) state.localAiPhase = 'idle';
        updateBrowserAiUi();
      }
    }
  })();
  state.localAiProbePromise = { mode, promise };
  return promise;
}

function generatedImageFile(image, index) {
  const source = image?.blob || image;
  if (source instanceof File) return source;
  if (source instanceof Blob || source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    const mime = source instanceof Blob && ['image/png', 'image/jpeg', 'image/webp'].includes(source.type) ? source.type : 'image/png';
    const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
    return new File([source], `ai-image-${index + 1}.${extension}`, { type: mime });
  }
  const binary = atob(image?.b64_json || '');
  const bytes = new Uint8Array(binary.length);
  for (let offset = 0; offset < binary.length; offset += 1) bytes[offset] = binary.charCodeAt(offset);
  const mime = ['image/png', 'image/jpeg', 'image/webp'].includes(image?.mime_type) ? image.mime_type : 'image/png';
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
  return new File([bytes], `ai-image-${index + 1}.${extension}`, { type: mime });
}

function showGeneratedArtworkChoices(images, compiled) {
  const files = images.map(generatedImageFile);
  const urls = files.map(file => URL.createObjectURL(file));
  const details = [compiled?.size, compiled?.quality ? `${compiled.quality} quality` : ''].filter(Boolean).join(' · ');
  openDialog('AI images', 'Choose an image to make printable', `<p class="dialog-lede">Choose a source image. It will open in the printable-image editor where you can crop it, remove the background, simplify details, separate colors and select filament layers before placing it on the medal.</p><div class="generated-artwork-grid">${urls.map((url, index) => `<button type="button" data-generated-artwork="${index}"><img src="${url}" alt="Generated image option ${index + 1}"/><span>Edit image ${index + 1}</span></button>`).join('')}</div><details class="prompt-audit"><summary>Generation details${details ? ` · ${escapeHtml(details)}` : ''}</summary><p>${escapeHtml(compiled?.prompt || '')}</p></details><div class="dialog-actions"><button type="button" class="button secondary" data-close-dialog>Keep designing</button></div>`);
  state.dialogCleanup = () => urls.forEach(url => URL.revokeObjectURL(url));
  $('[data-close-dialog]')?.addEventListener('click', closeDialog);
  $$('[data-generated-artwork]').forEach(button => button.addEventListener('click', () => {
    const file = files[Number(button.dataset.generatedArtwork)];
    closeDialog();
    if (file) void handleAssetFile(file);
  }));
}

function showImageGeneratorSetup() {
  const localMode = state.imageGeneratorMode === 'local';
  const setup = state.localAiCapability?.setup;
  const content = RUNTIME_CONFIG.staticHosting
    ? `<p class="dialog-lede">This is the zero-cost hosted-static edition. A website is not allowed to silently download, install, or launch an AI program on a visitor’s computer, and this deployment has no paid image API.</p><div class="simple-info-grid"><span>Works here</span><strong>Upload, image cleanup, color separation, text-to-medal, 3D editing and exports</strong><span>Needs local edition</span><strong>One-click open-source image generation</strong><span>Needs managed backend</span><strong>Online high-quality image generation</strong></div><p>The deployment guide keeps both upgrade paths separate so the static editor never pretends that a missing service is available.</p>`
    : localMode
    ? `<p class="dialog-lede">Click <strong>Create image</strong>. On first use, MedalForge downloads and checks the open-source image maker, starts it quietly, and then creates the image—no commands, accounts, or API keys.</p><div class="simple-info-grid"><span>Download</span><strong>${escapeHtml(setup?.downloadSize || 'about 6 GB')} · once</strong><span>Runs</span><strong>On this computer, outside the browser tab</strong><span>Privacy</span><strong>Your prompt and generated image stay on this computer</strong><span>Model</span><strong>${escapeHtml(setup?.model || 'Z-Image Turbo')}</strong></div><p>Interrupted downloads resume automatically. One image is created at a time to protect memory and keep the browser responsive.</p><details><summary>Open-source licenses</summary><p><a href="https://github.com/leejet/stable-diffusion.cpp/blob/master/LICENSE" target="_blank" rel="noopener noreferrer">stable-diffusion.cpp · MIT</a><br/><a href="https://huggingface.co/leejet/Z-Image-Turbo-GGUF" target="_blank" rel="noopener noreferrer">Z-Image Turbo · Apache 2.0</a><br/><a href="https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF" target="_blank" rel="noopener noreferrer">Qwen3 · Apache 2.0</a></p></details>`
    : `<p class="dialog-lede">Online images are configured once by the MedalForge site owner. Customers simply click Create; they are never asked for an API key.</p><p>A normal ChatGPT sign-in cannot be used as API access for a separate website, so MedalForge does not show a misleading “Sign in with ChatGPT” button. When online images are enabled, the app owner provides the service and can include it in a paid MedalForge plan.</p><p>This local build does not include online generation. Choose <strong>On this computer</strong> for generation with no per-image API fee, or import an existing image.</p>`;
  openDialog('Image generation', RUNTIME_CONFIG.staticHosting ? 'Hosted-static capabilities' : localMode ? 'Automatic local image maker' : 'Online images', `${content}<div class="dialog-actions"><button type="button" class="button primary" data-close-dialog>Done</button></div>`);
  $('[data-close-dialog]')?.addEventListener('click', closeDialog);
}

async function generateLocalArtwork() {
  const brief = $('#localArtworkBrief')?.value.trim() || '';
  if (brief.length < 3) { toast('Describe the image first'); $('#localArtworkBrief')?.focus(); return; }
  if (state.localAiBusy) return;
  const mode = state.imageGeneratorMode;
  state.localArtworkBrief = brief;
  state.localArtworkStyle = $('#localArtworkStyle')?.value || state.localArtworkStyle || 'photo-medal';
  state.localArtworkSize = $('#localArtworkSize')?.value || state.localArtworkSize || '1024x1024';
  state.localArtworkQuality = $('#localArtworkQuality')?.value || state.localArtworkQuality || 'high';
  state.localArtworkCount = Math.max(1, Math.min(4, Number($('#localArtworkCount')?.value) || 1));
  setLocalPreference('medalforge-ai-style', state.localArtworkStyle);
  setLocalPreference('medalforge-ai-size', state.localArtworkSize);
  setLocalPreference('medalforge-ai-quality', state.localArtworkQuality);
  setLocalPreference('medalforge-ai-count', String(state.localArtworkCount));
  state.localAiBusy = true;
  state.localAiError = null;
  state.localAiPhase = 'checking';
  state.localAiProgress = { message: mode === 'local' ? 'Checking this computer…' : 'Checking online image availability…' };
  state.cloudImageAbortController = new AbortController();
  updateBrowserAiUi();
  const generatedPrompt = cloudArtworkPrompt(brief, state.localArtworkStyle);
  try {
    const onProgress = progress => {
      state.localAiProgress = progress;
      state.localAiPhase = progress.phase || state.localAiPhase;
      if (progress.message) setLocalAiMessage(progress.message);
      updateBrowserAiUi();
    };
    let available = await checkLocalAiAvailability({ quiet: true, mode });
    if (!available && mode === 'local') {
      const setup = state.localAiCapability?.setup;
      if (!setup?.supported) {
        throw new Error(setup?.message || 'Automatic local image setup is not supported on this computer yet.');
      }
      state.localAiPhase = 'setup';
      state.localAiProgress = { phase: 'setup', progress: setup.progress, message: setup.message || 'Preparing the local image maker…' };
      setLocalAiMessage(setup.installed ? 'Starting the local image maker…' : `Setting up the local image maker automatically${setup.downloadSize ? ` · ${setup.downloadSize}` : ''}…`);
      updateBrowserAiUi();
      await localImageGenerator().ensureSetup({
        signal: state.cloudImageAbortController.signal,
        onProgress,
      });
      state.localAiCapability = null;
      available = await checkLocalAiAvailability({ quiet: true, mode });
    }
    if (!available) {
      throw new Error(mode === 'cloud'
        ? 'Online generation isn’t enabled in this local build. Choose On this computer or import an image.'
        : 'The local image maker did not become ready. Click Create to try again.');
    }
    state.localAiPhase = 'generate';
    state.localAiProgress = { phase: 'generate', progress: 0, message: `Creating ${state.localArtworkCount === 1 ? 'one image' : `${state.localArtworkCount} images`}…` };
    setLocalAiMessage(mode === 'local'
      ? `Creating on this computer at ${state.localArtworkSize}…`
      : `Creating online at ${state.localArtworkSize}…`);
    updateBrowserAiUi();
    const result = await activeImageGenerator(mode).generate({
      prompt: generatedPrompt,
      size: state.localArtworkSize,
      quality: state.localArtworkQuality,
      count: state.localArtworkCount,
      signal: state.cloudImageAbortController.signal,
      onProgress,
    });
    if (!result.images?.length) throw new Error('The image service completed without returning an image.');
    setLocalAiMessage(`Ready · ${result.images.length} high-resolution image${result.images.length === 1 ? '' : 's'} generated`);
    showGeneratedArtworkChoices(result.images, { prompt: generatedPrompt, size: result.metadata?.size || state.localArtworkSize, quality: result.metadata?.quality || state.localArtworkQuality });
  } catch (error) {
    const cancelled = error?.name === 'AbortError' || ['CLOUD_IMAGE_CANCELLED', 'LOCAL_IMAGE_CANCELLED', 'LOCAL_AI_SETUP_CANCELLED'].includes(error?.code);
    const message = cancelled ? (state.localAiPhase === 'setup' ? 'Setup paused. Click Create to resume.' : 'Image creation cancelled.') : error.message || 'Image creation failed. Click Create to try again.';
    setLocalAiMessage(message, { error: !cancelled });
    if (!cancelled) toast(message);
  } finally {
    state.cloudImageAbortController = null;
    state.localAiBusy = false;
    state.localAiPhase = 'idle';
    state.localAiProgress = null;
    updateBrowserAiUi();
  }
}

function cancelLocalArtworkGeneration() {
  if (!state.localAiBusy) return;
  if (state.localAiPhase === 'setup') void localImageGenerator().cancelSetup();
  state.cloudImageAbortController?.abort();
  setLocalAiMessage(state.localAiPhase === 'setup' ? 'Pausing setup…' : 'Cancelling image creation…');
}

function bindToolPanel() {
  bindInlineAddColorButtons($('#toolPanelContent'));
  $('.panel-collapse')?.addEventListener('click', () => $('.side-panel').classList.remove('mobile-open'));
  $('#imageGeneratorMode')?.addEventListener('change', event => {
    state.localAiProbeToken += 1;
    state.localAiProbePromise = null;
    state.localAiProbeBusy = false;
    state.imageGeneratorMode = event.target.value === 'cloud' ? 'cloud' : 'local';
    setLocalPreference('medalforge-image-generator', state.imageGeneratorMode);
    state.localAiCapability = null;
    state.localAiStatus = null;
    state.localAiError = null;
    state.localAiProgress = null;
    renderToolPanel();
  });
  $('#localArtworkBrief')?.addEventListener('input', event => { state.localArtworkBrief = event.target.value; });
  $('#localArtworkStyle')?.addEventListener('change', event => {
    state.localArtworkStyle = event.target.value;
    setLocalPreference('medalforge-ai-style', state.localArtworkStyle);
  });
  $('#localArtworkSize')?.addEventListener('change', event => {
    state.localArtworkSize = event.target.value;
    setLocalPreference('medalforge-ai-size', state.localArtworkSize);
  });
  $('#localArtworkQuality')?.addEventListener('change', event => {
    state.localArtworkQuality = event.target.value;
    setLocalPreference('medalforge-ai-quality', state.localArtworkQuality);
  });
  $('#localArtworkCount')?.addEventListener('change', event => {
    state.localArtworkCount = Math.max(1, Math.min(4, Number(event.target.value) || 1));
    setLocalPreference('medalforge-ai-count', String(state.localArtworkCount));
    updateBrowserAiUi();
  });
  $('#generateLocalArtwork')?.addEventListener('click', () => { void generateLocalArtwork(); });
  $('#cancelLocalAi')?.addEventListener('click', cancelLocalArtworkGeneration);
  if (state.createTool === 'upload' && !state.localAiCapability && !state.localAiProbeBusy) {
    requestAnimationFrame(() => { void checkLocalAiAvailability({ quiet: true }); });
  }
  $$('[data-create-tool]').forEach(button => button.addEventListener('click', () => {
    cancelPlacement();
    state.createTool = button.dataset.createTool;
    if (state.createTool === 'draw') enterSketchMode();
    else if (state.view !== '3d') finishSketchMode();
    renderToolPanel();
  }));
  $$('[data-new-operation]').forEach(button => button.addEventListener('click', () => {
    state.drawing.operation = button.dataset.newOperation;
    markOnboardingStep('operation');
    renderToolPanel();
  }));
  $$('[data-new-color]').forEach(button => button.addEventListener('click', () => {
    state.drawing.color = Number(button.dataset.newColor);
    $$('[data-new-color]').forEach(item => { const active = Number(item.dataset.newColor) === state.drawing.color; item.classList.toggle('active', active); item.innerHTML = active ? '<span>✓</span>' : ''; });
  }));
  if (state.createTool === 'ideas' && !state.conceptProviderStatus && !state.conceptProviderProbeBusy) {
    requestAnimationFrame(() => { void probeConceptProviders({ quiet: true }); });
  }
  $$('[data-concept-mode]').forEach(button => button.addEventListener('click', () => {
    if (button.disabled) return;
    state.conceptGeneratorMode = button.dataset.conceptMode === 'openai' ? 'openai' : 'local';
    setLocalPreference('medalforge-medal-generator', state.conceptGeneratorMode);
    state.conceptGenerationError = null;
    renderToolPanel();
  }));
  $('#conceptBrief')?.addEventListener('input', event => { state.conceptBrief = event.target.value; });
  $('#generateConcepts')?.addEventListener('click', () => { void generateConceptCandidates(); });
  $('#cancelConceptGeneration')?.addEventListener('click', () => state.conceptAbortController?.abort('cancelled by user'));
  $('#useBestConcept')?.addEventListener('click', () => {
    const candidate = state.conceptCandidates[0];
    if (!candidate) return;
    replaceProject(structuredClone(candidate));
    markLoadedDesignProgress();
    toast(`Highest-scoring concept loaded · ${Number(candidate.conceptMeta?.qualityScore).toFixed(1)}/10`);
  });
  $$('[data-use-concept]').forEach(button => button.addEventListener('click', () => {
    const candidate = state.conceptCandidates[Number(button.dataset.useConcept)];
    if (!candidate) return;
    replaceProject(structuredClone(candidate));
    markLoadedDesignProgress();
    toast('Concept loaded · every front and back design item is editable');
  }));
  $('#ideasToImage')?.addEventListener('click', () => {
    state.conceptBrief = $('#conceptBrief')?.value.trim() || state.conceptBrief || 'running event';
    const parsed = parseConceptBrief(state.conceptBrief);
    state.localArtworkBrief = parsed.visualSubject;
    state.createTool = 'upload';
    renderToolPanel();
    requestAnimationFrame(() => { $('#localArtworkBrief')?.focus(); $('#localArtworkBrief')?.select(); });
    toast('Only the visual subject was moved to Image · dates and wording stay editable text');
  });
  $('#copyArtworkPrompt')?.addEventListener('click', async () => {
    state.conceptBrief = $('#conceptBrief')?.value.trim() || state.conceptBrief || 'running event';
    const prompt = printableArtworkPrompt(state.conceptBrief);
    try { await navigator.clipboard.writeText(prompt); toast('Print-constrained artwork prompt copied'); }
    catch { openDialog('Printable artwork prompt', 'Copy this image prompt', `<textarea class="text-input" rows="9" data-i18n-ignore readonly>${escapeHtml(prompt)}</textarea><div class="dialog-actions"><button class="button primary" data-close-dialog>Done</button></div>`); $('[data-close-dialog]')?.addEventListener('click', closeDialog); }
  });
  $('#localAiInfo')?.addEventListener('click', () => {
    showImageGeneratorSetup();
  });
  $('[data-new-operation-value]')?.addEventListener('change', event => {
    const value = snapToLayer(Number(event.target.value), state.project.profile.layerHeight);
    if (state.drawing.operation === 'raise') state.drawing.height = value;
    else state.drawing.depth = Math.min(value, state.project.medal.baseThickness - state.project.medal.minimumFloor);
    renderToolPanel();
  });
  $('#addTextButton')?.addEventListener('click', () => {
    const value = $('#newTextValue').value.trim() || 'YOUR EVENT';
    let fontSize = Number($('#newTextSize').value) || 6;
    if ($('#newTextAutoFit')?.checked) {
      const safeWidth = Math.max(8, state.project.medal.width - 2 * (state.project.medal.edgeInset + state.project.medal.rimWidth + 2));
      fontSize = Math.min(fontSize, safeWidth / Math.max(1, value.length * .59));
    }
    const position = $('#newTextPosition')?.value || 'center';
    const y = position === 'top' ? -state.project.medal.height * .22 : position === 'bottom' ? state.project.medal.height * .22 : 0;
    const element = { id: uid('text'), type: 'text', name: value.slice(0, 24), text: value, x: 0, y, fontSize: Math.max(1, fontSize), fontFamily: $('#newTextFont')?.value || 'Arial', weight: Number($('#newTextWeight').value) || 800, rotation: 0, color: Math.min(state.drawing.color, state.project.paletteIds.length - 1), hidden: false, ...operationDefaults() };
    queuePlacement(element, 'text');
  });
  $$('[data-add-shape]').forEach(button => button.addEventListener('click', () => {
    const kind = button.dataset.addShape;
    const element = { id: uid('shape'), type: 'shape', name: shapeInfo(kind).label, shape: kind, x: 0, y: 0, size: Math.max(2, Math.min(DESIGN_LIMITS.shapeSizeMax, Number($('#newShapeSize')?.value) || 12)), rotation: 0, color: Math.min(state.drawing.color, state.project.paletteIds.length - 1), hidden: false, ...operationDefaults() };
    queuePlacement(element, element.name.toLowerCase());
  }));
  $$('[data-attachment-style]').forEach(button => button.addEventListener('click', () => commit(project => {
    project.medal.loopStyle = button.dataset.attachmentStyle;
    fitInternalAttachmentToBody(project);
    project.template = 'custom';
  }, { panel: true })));
  $$('[data-rim-style]').forEach(button => button.addEventListener('click', () => commit(project => {
    const style = button.dataset.rimStyle;
    if (style === 'none') project.medal.rimWidth = 0;
    else {
      project.medal.rimStyle = Object.hasOwn(RIM_STYLE_INFO, style) ? style : 'classic';
      if (project.medal.rimWidth <= 0) project.medal.rimWidth = project.medal.rimStyle === 'laurel' || project.medal.rimStyle === 'wings' ? 3.2 : 1.5;
    }
    project.template = 'custom';
  }, { panel: true })));
  $$('[data-medal-color-field]').forEach(button => button.addEventListener('click', () => commit(project => {
    const field = button.dataset.medalColorField;
    const slot = Math.max(0, Math.min(project.paletteIds.length - 1, Number(button.dataset.medalColorSlot) || 0));
    if (field === 'baseColor' || field === 'rimColor') project.medal[field] = slot;
    project.template = 'custom';
  }, { panel: true })));
  $$('[data-ribbon-preset]').forEach(button => button.addEventListener('click', () => {
    const ribbon = Number(button.dataset.ribbonPreset);
    commit(project => {
      if (['single', 'double'].includes(project.medal.loopStyle)) {
        project.medal.slotWidth = ribbon + 2;
        project.medal.loopWidth = ribbon + 7;
        project.medal.slotHeight = Math.max(3.2, project.medal.slotHeight);
      } else if (['slit', 'open-slit'].includes(project.medal.loopStyle)) {
        project.medal.slitWidth = ribbon + 2;
        project.medal.slitHeight = Math.max(3.2, project.medal.slitHeight);
      }
      project.template = 'custom';
    }, { panel: true });
    toast(`${ribbon} mm ribbon clearance applied`);
  }));
  $$('[data-medal-thickness]').forEach(button => button.addEventListener('click', () => {
    const value = Number(button.dataset.medalThickness);
    commit(project => {
      project.medal.baseThickness = value;
      project.template = 'custom';
    }, { panel: true });
    syncDrawingDefaults(false);
    markOnboardingStep('medal');
  }));
  const thicknessInput = $('#medalThicknessInput');
  if (thicknessInput) {
    let editBefore = null;
    const preview = rawValue => {
      const value = Number(rawValue);
      if (!Number.isFinite(value) || value < 1.2 || value > DESIGN_LIMITS.baseThicknessMax || Math.abs(value - state.project.medal.baseThickness) < .0001) return false;
      editBefore ||= snapshot();
      state.project.medal.baseThickness = value;
      state.project.template = 'custom';
      state.project = normalizeProject(state.project);
      syncDrawingDefaults(false);
      markDirty();
      refreshComputed(true);
      updateMedalThicknessSummary();
      markOnboardingStep('medal');
      return true;
    };
    thicknessInput.addEventListener('focus', () => { editBefore ||= snapshot(); });
    thicknessInput.addEventListener('input', () => preview(thicknessInput.value));
    thicknessInput.addEventListener('change', () => {
      editBefore ||= snapshot();
      const parsed = Number(thicknessInput.value);
      const bounded = Math.max(1.2, Math.min(DESIGN_LIMITS.baseThicknessMax, Number.isFinite(parsed) ? parsed : state.project.medal.baseThickness));
      preview(bounded);
      thicknessInput.value = String(state.project.medal.baseThickness);
      if (editBefore !== snapshot()) pushHistory(editBefore);
      editBefore = null;
      renderAll({ panel: true });
    });
  }
  $$('[data-medal-field]').forEach(input => input.addEventListener('change', () => {
    const field = input.dataset.medalField;
    const value = input.tagName === 'SELECT' && !['rimColor'].includes(field) ? input.value : Number(input.value);
    commit(project => {
      if (project.medal.shape === 'custom' && project.medal.outline?.length >= 3 && ['width', 'height'].includes(field)) {
        const previous = Math.max(.1, Number(project.medal[field]) || Number(value) || 1);
        const factor = Number(value) / previous;
        project.medal.outline = project.medal.outline.map(([x, y]) => field === 'width' ? [x * factor, y] : [x, y * factor]);
      }
      project.medal[field] = value;
      if (field === 'diameter') project.medal.width = project.medal.height = value;
      project.template = 'custom';
    }, { panel: true });
    markOnboardingStep('medal');
    if (field === 'defaultHeight') state.drawing.height = snapToLayer(Number(value), state.project.profile.layerHeight);
    if (['baseThickness', 'minimumFloor', 'defaultHeight'].includes(field)) { syncDrawingDefaults(false); renderToolPanel(); }
  }));
  $('#useSelectedOutline')?.addEventListener('click', () => {
    const source = selectedElement();
    if (!source || source.type !== 'path' || !source.closed || source.points.length < 3) return;
    let vertices = simplifyClosedRing(transformedPathVertices(source).map(point => [point.x, point.y]), .12, 512);
    if (polygonSelfIntersects(vertices)) { toast('That outline crosses or touches itself. Edit the path before using it as the medal body.'); return; }
    const xs = vertices.map(point => point[0]), ys = vertices.map(point => point[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const rawWidth = maxX - minX, rawHeight = maxY - minY, shortest = Math.min(rawWidth, rawHeight), longest = Math.max(rawWidth, rawHeight);
    if (vertices.length < 3 || shortest < .5 || longest / shortest > 3.2) { toast('Choose a closed outline with a medal-like aspect ratio'); return; }
    const scale = Math.max(60 / longest, 30 / shortest);
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    const outline = vertices.map(([x, y]) => [(x - centerX) * scale, (y - centerY) * scale]);
    const width = rawWidth * scale, height = rawHeight * scale;
    const sourceId = source.id;
    commit(project => {
      if (project.medal.shape !== 'custom') project.medal.outlineRestore = {
        shape: project.medal.shape,
        diameter: project.medal.diameter,
        width: project.medal.width,
        height: project.medal.height,
        cornerRadius: project.medal.cornerRadius,
      };
      project.medal.shape = 'custom'; project.medal.outline = outline; project.medal.width = width; project.medal.height = height; project.medal.diameter = Math.min(width, height); project.medal.outlineSourceId = sourceId;
      const sourceElement = project.elements.find(element => element.id === sourceId);
      if (sourceElement) { sourceElement.hidden = true; sourceElement.locked = true; }
      project.template = 'custom';
    }, { panel: true });
    state.selectedId = null;
    markOnboardingStep('medal');
    renderAll({ panel: true });
    toast('Closed path converted into the printable medal outline');
  });
  $('#restoreOutlineSource')?.addEventListener('click', () => {
    const sourceId = state.project.medal.outlineSourceId;
    commit(project => {
      const source = project.elements.find(element => element.id === sourceId);
      if (source) { source.hidden = false; source.locked = false; }
      const restore = project.medal.outlineRestore;
      if (restore) Object.assign(project.medal, restore);
      else {
        project.medal.shape = 'circle';
        project.medal.diameter = Math.min(project.medal.width, project.medal.height);
        project.medal.width = project.medal.height = project.medal.diameter;
      }
      project.medal.outline = null; project.medal.outlineSourceId = null; project.medal.outlineRestore = null;
      project.template = 'custom';
    }, { panel: true });
    state.selectedId = sourceId;
    renderAll({ panel: true });
    toast('Outline source restored — edit it, then convert it again');
  });
  $$('[data-medal-shape]').forEach(button => button.addEventListener('click', () => {
    commit(project => {
      project.medal.shape = button.dataset.medalShape;
      if (project.medal.shape === 'circle') {
        project.medal.diameter = Math.min(project.medal.width, project.medal.height);
        project.medal.width = project.medal.height = project.medal.diameter;
      }
      fitInternalAttachmentToBody(project);
      project.template = 'custom';
    }, { panel: true });
    markOnboardingStep('medal');
  }));
  $$('[data-layer-id]').forEach(row => {
    const select = () => {
      if (state.liveEdit) { toast('Press OK or Cancel before selecting another object'); return; }
      state.selectedId = row.dataset.layerId;
      const element = selectedElement();
      if (element) setCameraPreset(element.face === 'back' ? 'bottom' : 'top');
      renderInspector(); drawMedal(); renderToolPanel();
    };
    row.addEventListener('click', select);
  });
  $$('[data-toggle-layer]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const id = button.dataset.toggleLayer;
    commit(project => { const element = project.elements.find(item => item.id === id); if (element) element.hidden = !element.hidden; }, { panel: true });
  }));
  $$('[data-toggle-lock]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const id = button.dataset.toggleLock;
    commit(project => { const element = project.elements.find(item => item.id === id); if (element) element.locked = !element.locked; }, { panel: true });
  }));
  $$('[data-layer-move]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const id = button.dataset.layerActionId;
    const selected = state.project.elements.find(item => item.id === id);
    if (selected?.locked) { toast(`${selected.name} is locked`); return; }
    commit(project => {
      const index = project.elements.findIndex(item => item.id === id);
      const target = button.dataset.layerMove === 'up' ? index + 1 : index - 1;
      if (index < 0 || target < 0 || target >= project.elements.length) return;
      [project.elements[index], project.elements[target]] = [project.elements[target], project.elements[index]];
    }, { panel: true });
  }));
  const drop = $('#uploadDrop');
  if (drop) {
    drop.addEventListener('click', () => $('#assetInput').click());
    drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('drag'); if (event.dataTransfer.files[0]) handleAssetFile(event.dataTransfer.files[0]); });
  }
  $('#uploadPrimary')?.addEventListener('click', () => $('#assetInput').click());
  $('#createImagePrimary')?.addEventListener('click', () => {
    const disclosure = $('.image-create-disclosure'); if (!disclosure) return; disclosure.open = true; disclosure.scrollIntoView({ block: 'start', behavior: 'smooth' }); requestAnimationFrame(() => $('#localArtworkBrief')?.focus());
  });
  $('#importProjectButton')?.addEventListener('click', () => $('#projectInput').click());
  $('#uploadColorsButton')?.addEventListener('click', openGlobalSettings);
  $$('[data-draw-face]').forEach(button => button.addEventListener('click', () => {
    cancelDrawing(false);
    state.drawing.face = button.dataset.drawFace === 'back' ? 'back' : 'front';
    const selected = selectedElement();
    if (selected && selected.face !== state.drawing.face) state.selectedId = null;
    if (state.view === '2d') {
      setCameraPreset(state.drawing.face === 'back' ? 'bottom' : 'top', { workspace: false });
      $('#workspaceModeHelp').textContent = state.drawing.face === 'back' ? 'Back face auto-aligned · new artwork becomes flat first-layer color' : 'Front face auto-aligned · finish to restore your camera';
      $('#sketchModeBar small').textContent = state.drawing.face === 'back' ? 'Back face · drawing is readable from this side and embedded flush' : 'Front face · drawing is oriented from this viewing side';
    }
    renderToolPanel(); renderAll();
  }));
  $$('[data-draw-mode]').forEach(button => button.addEventListener('click', () => setDrawMode(button.dataset.drawMode)));
  $('#drawWidth')?.addEventListener('input', event => {
    state.drawing.strokeWidth = Number(event.target.value);
    $('#drawWidthLabel').textContent = `${state.drawing.strokeWidth.toFixed(2)} mm`;
    drawMedal();
  });
  $$('[data-draw-color]').forEach(button => button.addEventListener('click', () => {
    state.drawing.color = Number(button.dataset.drawColor);
    renderToolPanel();
    drawMedal();
  }));
  $('#drawSnap')?.addEventListener('change', event => { state.drawing.snap = event.target.checked; drawMedal(); });
  $('#finishDrawing')?.addEventListener('click', finishPolygon);
  $('#cancelDrawing')?.addEventListener('click', () => cancelDrawing(true));
}

function renderPalette() {
  const options = state.inventory.map(filament => {
    const status = localizedAvailability(filament);
    return `<option value="${escapeHtml(filament.id)}" ${status.key === 'out' ? 'disabled' : ''} data-i18n-ignore>${escapeHtml(filament.name)}${status.key !== 'available' ? ` — ${escapeHtml(status.label)}` : ''}</option>`;
  }).join('');
  $('#palette').innerHTML = state.project.paletteIds.map((id, index) => {
    const filament = state.inventory.find(item => item.id === id);
    if (!filament) return `<div class="palette-row out"><span class="slot-number">${index + 1}</span><span class="swatch" style="background:#d9dde0"></span><select class="palette-select" data-palette-slot="${index}" aria-label="Replace missing design color ${index + 1}"><option value="${escapeHtml(id)}" selected disabled>Missing: ${escapeHtml(id)}</option>${options}</select><span class="palette-meta">Choose a stocked replacement</span></div>`;
    const status = localizedAvailability(filament);
    return `<div class="palette-row ${status.key === 'available' ? '' : status.key}"><span class="slot-number">${index + 1}</span><span class="swatch" style="background:${filament.color}"></span><select class="palette-select" data-palette-slot="${index}" aria-label="Design color ${index + 1}">${options.replace(`value="${escapeHtml(filament.id)}"`, `value="${escapeHtml(filament.id)}" selected`)}</select><button class="palette-info" type="button" data-filament-info="${escapeHtml(filament.id)}" title="Price, stock, and supplier">i</button><span class="palette-meta"><span data-i18n-ignore>${escapeHtml(filament.material)} · ${escapeHtml(filament.effect)}</span> · Kč ${formatLocalizedNumber(filament.pricePerKg)}/kg · ${escapeHtml(status.label)}</span></div>`;
  }).join('');
  $$('[data-palette-slot]').forEach(select => select.addEventListener('change', () => {
    const slot = Number(select.dataset.paletteSlot);
    const id = select.value;
    if (state.project.paletteIds.some((current, index) => current === id && index !== slot)) {
      toast('That filament is already assigned to another slot');
      renderPalette();
      return;
    }
    commit(project => { project.paletteIds[slot] = id; project.template = 'custom'; });
    reprocessImportedImages('palette change');
  }));
  $$('[data-filament-info]').forEach(button => button.addEventListener('click', () => showFilamentInfo(button.dataset.filamentInfo)));
}

function showFilamentInfo(id) {
  const filament = state.inventory.find(item => item.id === id); if (!filament) return;
  const status = localizedAvailability(filament);
  const source = filament.productUrl
    ? `<a class="source-link" href="${escapeHtml(filament.productUrl)}" target="_blank" rel="noopener noreferrer">Open supplier reference ↗</a><small>Reference price ${filament.sourcePrice ? `${filament.sourcePrice} ${escapeHtml(filament.sourceCurrency)}` : 'not entered'}${filament.priceUpdatedAt ? ` · checked ${escapeHtml(filament.priceUpdatedAt)}` : ''}. Your Kč/kg and stock remain editable local values.</small>`
    : '<small>No supplier reference saved. Add one later to the local filament catalog.</small>';
  openDialog('Filament details', `${filament.brand} · ${filament.name}`, `<div class="filament-detail"><span class="filament-detail-swatch" style="background:${filament.color}"></span><dl><div><dt>Local price</dt><dd>Kč ${formatLocalizedNumber(filament.pricePerKg)} / kg</dd></div><div><dt>Stock</dt><dd>${escapeHtml(status.label)}${filament.stockKnown === false ? '' : ` · ${formatLocalizedNumber(filament.stockGrams)} g`}</dd></div><div><dt>Material</dt><dd>${escapeHtml(filament.material)} · ${escapeHtml(filament.effect)}</dd></div><div><dt>Supplier</dt><dd>${escapeHtml(filament.supplierRegion || 'Local catalog')}</dd></div></dl></div><div class="supplier-reference">${source}</div><div class="dialog-actions"><button class="button secondary" id="openStockFromInfo">Edit stock & price</button><button class="button primary" data-close-dialog>Done</button></div>`);
  $('[data-close-dialog]')?.addEventListener('click', closeDialog);
  $('#openStockFromInfo')?.addEventListener('click', showInventoryDialog);
}

function colorButtons(active, disabled = false) {
  return `${getPalette(state.project, state.inventory).map((filament, index) => `<button class="color-button ${active === index ? 'active' : ''}" data-element-color="${index}" style="background:${filament.color}" aria-label="Color ${index + 1}: ${escapeHtml(filament.name)}" ${disabled ? 'disabled' : ''}>${active === index ? `<span>✓</span>` : ''}</button>`).join('')}${inlineAddColorButtonHtml('element', { disabled })}`;
}

function surfaceControlsHtml(element, compact = false) {
  if (element.face === 'back') return `<section class="surface-controls ${compact ? 'compact' : ''}">
    ${compact ? '' : '<div class="surface-heading"><span><small>Back surface</small><strong>Back · flat first-layer color</strong></span><i title="The underside remains on the build plate.">✓</i></div>'}
    <div class="operation-note"><b>✓ Flat on build plate</b><span>The selected filament replaces the medal material here for ${element.zDepth.toFixed(2)} mm (${layerCountLabel(element.zDepth)}). The outside back surface stays perfectly flat.</span></div>
  </section>`;
  const field = element.operation === 'raise' ? 'zHeight' : 'zDepth';
  const value = operationValue(element);
  const layer = state.project.profile.layerHeight;
  const layers = element.operation === 'cut' ? layerCountLabel(state.project.medal.baseThickness, layer) : layerCountLabel(value, layer);
  const maxDepth = Math.max(.05, state.project.medal.baseThickness - state.project.medal.minimumFloor);
  const minimumAmount = field === 'zHeight' ? layer : Math.min(layer, maxDepth);
  const maximumAmount = field === 'zHeight' ? DESIGN_LIMITS.reliefHeightMax : maxDepth;
  const disabled = element.locked || state.liveEdit ? 'disabled' : '';
  const amountLabel = element.operation === 'raise' ? 'Height' : `Depth · leaves ${(state.project.medal.baseThickness - value).toFixed(2)} mm floor`;
  return `<section class="surface-controls ${compact ? 'compact' : ''}">
    ${compact ? '' : `<div class="surface-heading"><span><small>How this item prints</small><strong>${escapeHtml(operationDescription(element))}</strong></span><i title="${escapeHtml((OPERATION_INFO[element.operation] || OPERATION_INFO.raise).help)}">?</i></div>`}
    <div class="operation-segmented">${Object.entries(OPERATION_INFO).map(([key, info]) => {
      const impossibleRecess = ['engrave', 'inlay'].includes(key) && maxDepth + .001 < layer;
      const operationDisabled = element.locked || Boolean(state.liveEdit) || impossibleRecess;
      const title = impossibleRecess ? `Increase the gap between base thickness and minimum floor to at least one ${layer.toFixed(2)} mm layer.` : info.help;
      return `<button type="button" class="${element.operation === key ? 'active' : ''}" data-surface-operation="${key}" title="${escapeHtml(title)}" ${operationDisabled ? 'disabled' : ''}><b>${info.icon}</b>${info.label}</button>`;
    }).join('')}</div>
    ${element.operation === 'cut' ? `<div class="operation-note"><b>Full through cut</b><span>Removes ${state.project.medal.baseThickness.toFixed(2)} mm · ${layers}</span></div>` : `<div class="surface-amount-row"><button data-surface-step="-1" aria-label="Decrease by one layer" ${disabled}>−</button><label><span>${amountLabel}</span><div class="unit-input"><input data-surface-field="${field}" type="number" min="${minimumAmount}" max="${maximumAmount}" step="${layer}" value="${value.toFixed(2)}" ${disabled}/><em>mm</em></div></label><button data-surface-step="1" aria-label="Increase by one layer" ${disabled}>＋</button><output>${layers}</output></div>`}
    ${!compact && element.operation === 'inlay' ? `<div class="inlay-top-row"><span>Top above face</span><button data-inlay-top="0" class="${element.inlayHeight === 0 ? 'active' : ''}" ${disabled}>Flush</button><button data-inlay-top-step="-1" aria-label="Lower inlay top one layer" ${disabled}>−</button><div class="unit-input"><input data-inlay-top-field type="number" min="0" max="${DESIGN_LIMITS.inlayHeightMax}" step="${layer}" value="${element.inlayHeight.toFixed(2)}" ${disabled}/><em>mm</em></div><button data-inlay-top-step="1" aria-label="Raise inlay top one layer" ${disabled}>＋</button></div>` : ''}
    ${!compact && element.operation !== 'cut' ? `<div class="surface-options"><label class="check-row"><input data-surface-snap type="checkbox" ${element.layerSnap ? 'checked' : ''} ${disabled}/><span><strong>Snap to whole layers</strong><small>${layer.toFixed(2)} mm per layer</small></span></label>${element.operation === 'raise' ? `<label><span>Overlap</span><select class="select-input" data-surface-combine ${disabled}><option value="replace" ${element.combine !== 'stack' ? 'selected' : ''}>Set absolute height</option><option value="stack" ${element.combine === 'stack' ? 'selected' : ''}>Stack on geometry below</option></select></label>` : ''}</div>` : ''}
  </section>`;
}

function bindSurfaceControls(root) {
  if (!root) return;
  root.querySelectorAll('[data-surface-operation]').forEach(button => button.addEventListener('click', () => {
    commit(project => {
      const element = project.elements.find(item => item.id === state.selectedId);
      if (!element || element.locked) return;
      element.operation = button.dataset.surfaceOperation;
      project.template = 'custom';
    }, { panel: state.panel === 'layers' });
    markOnboardingStep('operation');
  }));
  root.querySelectorAll('[data-surface-step]').forEach(button => button.addEventListener('click', () => commit(project => {
    const element = project.elements.find(item => item.id === state.selectedId);
    if (!element || element.locked || element.operation === 'cut') return;
    const field = element.operation === 'raise' ? 'zHeight' : 'zDepth';
    const limit = field === 'zHeight' ? DESIGN_LIMITS.reliefHeightMax : Math.max(.05, project.medal.baseThickness - project.medal.minimumFloor);
    const minimum = field === 'zHeight' ? project.profile.layerHeight : Math.min(project.profile.layerHeight, limit);
    element[field] = Math.max(minimum, Math.min(limit, snapToLayer(element[field] + Number(button.dataset.surfaceStep) * project.profile.layerHeight, project.profile.layerHeight)));
  }, { panel: state.panel === 'layers' })));
  root.querySelectorAll('[data-surface-field]').forEach(input => input.addEventListener('change', () => commit(project => {
    const element = project.elements.find(item => item.id === state.selectedId);
    if (!element || element.locked) return;
    const field = input.dataset.surfaceField;
    let value = Number(input.value);
    if (element.layerSnap) value = snapToLayer(value, project.profile.layerHeight);
    const limit = field === 'zHeight' ? DESIGN_LIMITS.reliefHeightMax : Math.max(.05, project.medal.baseThickness - project.medal.minimumFloor);
    const minimum = field === 'zHeight' ? project.profile.layerHeight : Math.min(project.profile.layerHeight, limit);
    element[field] = Math.max(minimum, Math.min(limit, value));
  }, { panel: state.panel === 'layers' })));
  root.querySelectorAll('[data-surface-snap]').forEach(input => input.addEventListener('change', () => commit(project => {
    const element = project.elements.find(item => item.id === state.selectedId);
    if (!element || element.locked) return;
    element.layerSnap = input.checked;
    if (input.checked) {
      const availableDepth = Math.max(.05, project.medal.baseThickness - project.medal.minimumFloor);
      if (element.operation === 'raise') element.zHeight = Math.min(DESIGN_LIMITS.reliefHeightMax, snapToLayer(element.zHeight, project.profile.layerHeight));
      else if (element.operation !== 'cut') element.zDepth = availableDepth < project.profile.layerHeight ? availableDepth : Math.min(availableDepth, snapToLayer(element.zDepth, project.profile.layerHeight));
      if (element.operation === 'inlay' && element.inlayHeight > 0) element.inlayHeight = Math.min(DESIGN_LIMITS.inlayHeightMax, snapToLayer(element.inlayHeight, project.profile.layerHeight));
    }
  })));
  root.querySelectorAll('[data-surface-combine]').forEach(select => select.addEventListener('change', () => commit(project => {
    const element = project.elements.find(item => item.id === state.selectedId); if (element && !element.locked) element.combine = select.value;
  })));
  root.querySelectorAll('[data-inlay-top]').forEach(button => button.addEventListener('click', () => commit(project => {
    const element = project.elements.find(item => item.id === state.selectedId); if (element && !element.locked) element.inlayHeight = Number(button.dataset.inlayTop);
  })));
  root.querySelectorAll('[data-inlay-top-step]').forEach(button => button.addEventListener('click', () => commit(project => {
    const element = project.elements.find(item => item.id === state.selectedId);
    if (!element || element.locked) return;
    const next = element.inlayHeight + Number(button.dataset.inlayTopStep) * project.profile.layerHeight;
    element.inlayHeight = next <= .001 ? 0 : Math.max(0, Math.min(DESIGN_LIMITS.inlayHeightMax, snapToLayer(next, project.profile.layerHeight)));
  })));
  root.querySelectorAll('[data-inlay-top-field]').forEach(input => input.addEventListener('change', () => commit(project => {
    const element = project.elements.find(item => item.id === state.selectedId);
    if (!element || element.locked) return;
    const raw = Math.max(0, Math.min(DESIGN_LIMITS.inlayHeightMax, Number(input.value) || 0));
    element.inlayHeight = raw === 0 ? 0 : (element.layerSnap ? snapToLayer(raw, project.profile.layerHeight) : raw);
  })));
}

function selectionSurfaceZ(element) {
  const bottom = medalBottomZ(), top = medalTopZ();
  const back = element.face === 'back';
  const fallback = () => {
    if (back) {
      if (element.operation === 'raise') return Math.max(0, bottom - element.zHeight);
      if (element.operation === 'inlay') return Math.max(0, bottom - Math.max(0, element.inlayHeight || 0));
      if (element.operation === 'engrave') return bottom + element.zDepth;
      return bottom + .02;
    }
    if (element.operation === 'raise') return top + element.zHeight;
    if (element.operation === 'inlay') return top + Math.max(0, element.inlayHeight || 0);
    if (element.operation === 'engrave') return top - element.zDepth;
    return top - .02;
  };
  const sample = elementFramePoints(element).center;
  let surface = back ? bottom : top, supported = true;
  for (const candidate of state.project.elements) {
    if (candidate.hidden || candidate.face !== element.face || !pointHitsElement(candidate, sample)) continue;
    if (candidate.operation === 'cut') supported = false;
    else if (candidate.operation === 'raise') {
      if (!supported) continue;
      const height = Math.max(0, Number(candidate.zHeight) || 0);
      if (back) surface = candidate.combine === 'stack' ? Math.max(0, surface - height) : Math.max(0, bottom - height);
      else surface = candidate.combine === 'stack' ? surface + height : top + height;
    } else if (candidate.operation === 'engrave') {
      supported = true; surface = back ? bottom + candidate.zDepth : top - candidate.zDepth;
    } else if (candidate.operation === 'inlay') {
      supported = true; surface = back ? Math.max(0, bottom - Math.max(0, candidate.inlayHeight || 0)) : top + Math.max(0, candidate.inlayHeight || 0);
    }
    if (candidate.id === element.id) return supported ? surface : fallback();
  }
  return fallback();
}

function signedSurfaceAmount(element) {
  if (element.operation === 'raise') return Number(element.zHeight) || state.project.profile.layerHeight;
  if (element.operation === 'cut') return -state.project.medal.baseThickness;
  return -(Number(element.zDepth) || state.project.profile.layerHeight);
}

function applySignedSurfaceAmount(element, signed, fillPocket = state.pocketFillMode, snap = true) {
  const layer = state.project.profile.layerHeight;
  const maxDepth = Math.max(.05, state.project.medal.baseThickness - state.project.medal.minimumFloor);
  const snapped = snap ? snapToLayer(Math.max(layer, Math.abs(signed)), layer) : Math.max(.05, Math.round(Math.abs(signed) * 100) / 100);
  if (signed >= -layer * .35) {
    element.operation = 'raise';
    element.zHeight = Math.min(DESIGN_LIMITS.reliefHeightMax, snapped);
  } else if (Math.abs(signed) > maxDepth + layer * .65) {
    element.operation = 'cut';
  } else {
    element.operation = fillPocket ? 'inlay' : 'engrave';
    element.zDepth = Math.min(maxDepth, snapped);
    if (element.operation === 'inlay') element.inlayHeight = Math.max(0, element.inlayHeight || 0);
  }
  element.layerSnap = snap;
}

function gizmoDescription(element) {
  const layer = state.project.profile.layerHeight;
  if (element.operation === 'cut') return `−${localizedFixed(state.project.medal.baseThickness)} mm · ${translateUiKey('dynamicUi.cutThrough')}`;
  if (element.operation === 'raise') return `+${localizedFixed(element.zHeight)} mm · ${layerCountLabel(element.zHeight, layer)} · ${translateUiKey(element.layerSnap ? 'dynamicUi.snap' : 'dynamicUi.free')}`;
  const floor = Math.max(0, state.project.medal.baseThickness - element.zDepth);
  return `−${localizedFixed(element.zDepth)} mm · ${translateUiKey('dynamicUi.floor')} ${localizedFixed(floor)} mm${element.operation === 'inlay' ? ` · ${translateUiKey('dynamicUi.filled')}` : ''} · ${translateUiKey(element.layerSnap ? 'dynamicUi.snap' : 'dynamicUi.free')}`;
}

function proxyAppearance(element, opacity = .38) {
  const base = state.project.medal.baseThickness, bottom = medalBottomZ(), top = medalTopZ();
  const palette = getPalette(state.project, state.inventory);
  if (element.face === 'back') {
    if (element.operation === 'raise') return { zOffset: Math.max(0, selectionSurfaceZ(element)), zScale: Math.max(.01, element.zHeight), color: palette[element.color]?.color || '#2e68ff', opacity };
    if (element.operation === 'cut') return { zOffset: bottom, zScale: base, color: '#e04444', opacity: Math.max(opacity, .42) };
    const depth = Math.max(.01, element.zDepth), protrusion = element.operation === 'inlay' ? Math.max(0, element.inlayHeight || 0) : 0;
    return { zOffset: Math.max(0, bottom - protrusion), zScale: depth + protrusion, color: element.operation === 'inlay' ? (palette[element.color]?.color || '#28a678') : '#e9a23b', opacity };
  }
  if (element.operation === 'raise') return { zOffset: selectionSurfaceZ(element) - element.zHeight, zScale: Math.max(.01, element.zHeight), color: palette[element.color]?.color || '#2e68ff', opacity };
  if (element.operation === 'cut') return { zOffset: bottom, zScale: base, color: '#e04444', opacity: Math.max(opacity, .42) };
  const depth = Math.max(.01, element.zDepth);
  return {
    zOffset: Math.max(bottom, top - depth),
    zScale: depth + (element.operation === 'inlay' ? Math.max(0, element.inlayHeight || 0) : 0),
    color: element.operation === 'inlay' ? (palette[element.color]?.color || '#28a678') : '#e9a23b',
    opacity,
  };
}

function buildElementProxy(element) {
  const result = currentGeometryResult();
  const source = result?.previewMasks?.find(mask => mask.elementId === element.id);
  const sourceBounds = result?.sliceData?.bounds;
  const cell = result?.cell;
  if (!source?.indices?.length || !sourceBounds || !Number.isFinite(cell)) return null;
  const cacheKey = `${state.geometryRevision}|${element.id}`;
  if (state.proxyCache?.key === cacheKey) return state.proxyCache;
  let minCol = sourceBounds.cols, minRow = sourceBounds.rows, maxCol = -1, maxRow = -1;
  for (const index of source.indices) {
    const row = Math.floor(index / sourceBounds.cols), col = index % sourceBounds.cols;
    minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
    minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
  }
  if (maxCol < minCol || maxRow < minRow) return null;
  minCol = Math.max(0, minCol - 1); minRow = Math.max(0, minRow - 1);
  maxCol = Math.min(sourceBounds.cols - 1, maxCol + 1); maxRow = Math.min(sourceBounds.rows - 1, maxRow + 1);
  const bounds = {
    cols: maxCol - minCol + 1,
    rows: maxRow - minRow + 1,
    minX: sourceBounds.minX + minCol * cell,
    minY: sourceBounds.minY + minRow * cell,
  };
  const mask = new Uint8Array(bounds.cols * bounds.rows);
  for (const index of source.indices) {
    const row = Math.floor(index / sourceBounds.cols), col = index % sourceBounds.cols;
    if (col >= minCol && col <= maxCol && row >= minRow && row <= maxRow) mask[(row - minRow) * bounds.cols + col - minCol] = 1;
  }
  const field = buildColumnField(mask, 1, []);
  const meshes = columnFieldToMeshes(field, mask, bounds, cell, [{ color: '#2e68ff' }]);
  state.proxyCache = {
    key: cacheKey, meshes, sourceX: source.x, sourceY: source.y,
    sourceRotation: Number(source.rotation) || 0,
    sourceScaleX: Number(source.scaleX) || 1,
    sourceScaleY: Number(source.scaleY) || 1,
    sourceFace: source.face === 'back' ? 'back' : 'front',
  };
  return state.proxyCache;
}

function showElementProxy(element, owner = 'hover', opacity = owner === 'drag' ? .42 : .2) {
  if (!state.viewer || !element) return false;
  const proxy = buildElementProxy(element);
  if (!proxy) return false;
  const appearance = proxyAppearance(element, opacity);
  const planarMatrix = planarTransformBetween(
    { face: proxy.sourceFace, rotation: proxy.sourceRotation, scaleX: proxy.sourceScaleX, scaleY: proxy.sourceScaleY },
    { face: element.face, rotation: element.rotation, scaleX: element.scaleX, scaleY: element.scaleY },
  );
  const transform = {
    ...appearance,
    x: element.x - proxy.sourceX,
    y: -(element.y - proxy.sourceY),
    planarOriginX: proxy.sourceX,
    planarOriginY: -proxy.sourceY,
    planarMatrix,
  };
  if (state.proxyOwner !== owner || state.proxyRenderedKey !== proxy.key || !state.viewer.proxyMeshes.length) state.viewer.setProxyMeshes(proxy.meshes, transform);
  else state.viewer.setProxyTransform(transform);
  state.proxyOwner = owner;
  state.proxyRenderedKey = proxy.key;
  return true;
}

function clearElementProxy(owner = null) {
  if (!state.viewer || (owner && state.proxyOwner !== owner)) return;
  state.proxyOwner = null;
  state.proxyRenderedKey = null;
  state.viewer.clearProxyMeshes();
}

function elementFaceTowardsCamera(element) {
  const camera = state.viewer?.cameraPosition();
  if (!camera) return true;
  const middle = (medalBottomZ() + medalTopZ()) / 2;
  return element.face === 'back' ? camera[2] <= middle + .02 : camera[2] >= middle - .02;
}

function renderPushPullGizmo() {
  const root = $('#pushPullGizmo');
  const element = selectedElement();
  if (!root || state.view !== '3d' || state.inspectionOpen || !state.viewer || !element || element.face === 'back' || element.hidden || element.locked || state.pendingInsert || state.liveEdit || !elementFaceTowardsCamera(element)) {
    if (root) root.hidden = true;
    return;
  }
  const projected = state.viewer.designToScreen(element.x, element.y, selectionSurfaceZ(element), Math.max(0, Number(element.color) || 0));
  let axis = state.viewer.designAxisScreenVector('z', { x: element.x, y: element.y, z: selectionSurfaceZ(element), slot: Math.max(0, Number(element.color) || 0) }, 1);
  if (axis && element.face === 'back') axis = { ...axis, dx: -axis.dx, dy: -axis.dy };
  if (!projected?.visible) { root.hidden = true; return; }
  if (!axis || Math.hypot(axis.dx, axis.dy) < .5) axis = { dx: 0, dy: -1 };
  root.hidden = false;
  root.style.left = `${projected.x}px`;
  root.style.top = `${projected.y}px`;
  root.style.setProperty('--gizmo-angle', `${Math.atan2(axis.dx, -axis.dy) * 180 / Math.PI}deg`);
  root.classList.toggle('pocket', ['engrave', 'inlay'].includes(element.operation));
  root.classList.toggle('cut', element.operation === 'cut');
  $('#pushPullLabel').textContent = gizmoDescription(element);
  const fill = $('#gizmoPocketFill');
  fill.textContent = element.operation === 'inlay' ? 'Make recessed' : element.operation === 'engrave' ? 'Fill with color' : 'Make recessed';
  $('#gizmoCutThrough').textContent = element.operation === 'cut' ? 'Return to raised' : 'Make a hole';
}

function elementFramePoints(element) {
  const intrinsic = elementBounds({ ...element, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, face: 'front' });
  let centerX = 0, centerY = 0;
  if (element.type === 'path' && element.points?.length) {
    const xs = element.points.map(point => point[0] * element.scale), ys = element.points.map(point => point[1] * element.scale);
    centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  const sx = Number(element.scaleX) || 1, sy = Number(element.scaleY) || 1;
  const width = intrinsic.width * sx, height = intrinsic.height * sy;
  centerX *= sx; centerY *= sy;
  const angle = (element.rotation || 0) * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle), faceSign = element.face === 'back' ? -1 : 1;
  const world = (x, y) => {
    const rotatedX = x * cosine - y * sine, rotatedY = x * sine + y * cosine;
    return { x: element.x + rotatedX, y: element.y + rotatedY * faceSign };
  };
  return {
    width, height,
    center: world(centerX, centerY),
    corners: [world(centerX - width / 2, centerY - height / 2), world(centerX + width / 2, centerY - height / 2), world(centerX + width / 2, centerY + height / 2), world(centerX - width / 2, centerY + height / 2)],
  };
}

function renderTransformGizmo() {
  const root = $('#transformGizmo'), label = $('#transformSizeLabel');
  const element = selectedElement();
  if (!root || !label || state.view !== '3d' || state.inspectionOpen || !state.viewer || !element || element.hidden || element.locked || state.pendingInsert || state.liveEdit || !elementFaceTowardsCamera(element)) {
    if (root) root.toggleAttribute('hidden', true); if (label) label.hidden = true; return;
  }
  const frame = elementFramePoints(element), z = selectionSurfaceZ(element), slot = Math.max(0, Number(element.color) || 0);
  const points = frame.corners.map(point => state.viewer.designToScreen(point.x, point.y, z, slot));
  const center = state.viewer.designToScreen(frame.center.x, frame.center.y, z, slot);
  if (!center?.visible || points.some(point => !point)) { root.toggleAttribute('hidden', true); label.hidden = true; return; }
  const wrap = $('#canvasWrap').getBoundingClientRect();
  root.setAttribute('viewBox', `0 0 ${Math.max(1, wrap.width)} ${Math.max(1, wrap.height)}`);
  root.setAttribute('preserveAspectRatio', 'none');
  $('#transformOutline').setAttribute('points', points.map(point => `${point.x},${point.y}`).join(' '));
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const top = midpoint(points[0], points[1]), right = midpoint(points[1], points[2]), bottom = midpoint(points[2], points[3]), left = midpoint(points[3], points[0]);
  const outwardLength = Math.hypot(top.x - center.x, top.y - center.y) || 1;
  const rotate = { x: top.x + (top.x - center.x) / outwardLength * 29, y: top.y + (top.y - center.y) / outwardLength * 29 };
  const positionRect = (selector, point) => { const node = $(selector); node.setAttribute('x', point.x - Number(node.getAttribute('width')) / 2); node.setAttribute('y', point.y - Number(node.getAttribute('height')) / 2); };
  positionRect('#transformLeftHandle', left); positionRect('#transformWidthHandle', right);
  positionRect('#transformTopHandle', top); positionRect('#transformHeightHandle', bottom);
  positionRect('#transformTopLeftHandle', points[0]); positionRect('#transformTopRightHandle', points[1]);
  positionRect('#transformCornerHandle', points[2]); positionRect('#transformBottomLeftHandle', points[3]);
  positionRect('#transformLeftHit', left); positionRect('#transformWidthHit', right);
  positionRect('#transformTopHit', top); positionRect('#transformHeightHit', bottom);
  positionRect('#transformTopLeftHit', points[0]); positionRect('#transformTopRightHit', points[1]);
  positionRect('#transformCornerHit', points[2]); positionRect('#transformBottomLeftHit', points[3]);
  $('#transformMoveHandle').setAttribute('cx', center.x); $('#transformMoveHandle').setAttribute('cy', center.y);
  $('#transformRotateHandle').setAttribute('cx', rotate.x); $('#transformRotateHandle').setAttribute('cy', rotate.y);
  $('#transformMoveHit').setAttribute('cx', center.x); $('#transformMoveHit').setAttribute('cy', center.y);
  $('#transformRotateHit').setAttribute('cx', rotate.x); $('#transformRotateHit').setAttribute('cy', rotate.y);
  $('#transformRotateStem').setAttribute('x1', top.x); $('#transformRotateStem').setAttribute('y1', top.y); $('#transformRotateStem').setAttribute('x2', rotate.x); $('#transformRotateStem').setAttribute('y2', rotate.y);
  root.toggleAttribute('hidden', false);
  label.hidden = false; label.style.left = `${points[2].x}px`; label.style.top = `${points[2].y}px`;
  label.textContent = `${localizedFixed(frame.width, 1)} × ${localizedFixed(frame.height, 1)} mm · ${translateUiKey(element.lockAspect !== false ? 'dynamicUi.linked' : 'dynamicUi.free')}`;
}

function pointInElementTransformSpace(element, point) {
  const dx = point.x - element.x, dy = (point.y - element.y) * (element.face === 'back' ? -1 : 1);
  const angle = -(element.rotation || 0) * Math.PI / 180;
  return { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
}

function pointFromElementTransformSpace(element, point) {
  const angle = (element.rotation || 0) * Math.PI / 180;
  const rotatedX = point.x * Math.cos(angle) - point.y * Math.sin(angle);
  const rotatedY = point.x * Math.sin(angle) + point.y * Math.cos(angle);
  return { x: element.x + rotatedX, y: element.y + rotatedY * (element.face === 'back' ? -1 : 1) };
}

function elementFrameInLocalSpace(element) {
  return elementFramePoints({ ...element, x: 0, y: 0, rotation: 0, face: 'front' });
}

function bindTransformGizmo() {
  const root = $('#transformGizmo');
  root.querySelectorAll('[data-transform-handle]').forEach(handle => {
    handle.addEventListener('pointerdown', event => {
      const element = selectedElement(); if (!element || element.locked || !state.viewer) return;
      if (state.liveEdit) { toast('Press OK or Cancel before starting another edit'); return; }
      event.preventDefault(); event.stopPropagation();
      const kind = handle.dataset.transformHandle, planeZ = selectionSurfaceZ(element), startPoint = state.viewer.screenToDesignPlane(event.clientX, event.clientY, planeZ);
      if (!startPoint) return;
      const local = pointInElementTransformSpace(element, startPoint), localFrame = elementFrameInLocalSpace(element);
      const centerLocal = localFrame.center;
      const [directionX, directionY] = String(handle.dataset.transformDirection || '0,0').split(',').map(Number);
      const anchorLocal = { x: centerLocal.x - directionX * localFrame.width / 2, y: centerLocal.y - directionY * localFrame.height / 2 };
      state.transformDrag = {
        pointerId: event.pointerId, id: element.id, kind, planeZ, before: snapshot(), original: structuredClone(element),
        startPoint,
        centerLocal, directionX, directionY, anchorLocal, anchorWorld: pointFromElementTransformSpace(element, anchorLocal),
        frameWidth: localFrame.width, frameHeight: localFrame.height,
        startDistance: Math.max(.01, Math.hypot(directionX ? localFrame.width : 0, directionY ? localFrame.height : 0)),
        startPlaneAngle: Math.atan2(local.y - centerLocal.y, local.x - centerLocal.x),
        lastValid: elementPlacementFits(element) ? structuredClone(element) : null,
      };
      showElementProxy(element, 'drag', .43); handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      const drag = state.transformDrag; if (!drag || drag.pointerId !== event.pointerId) return;
      const element = state.project.elements.find(item => item.id === drag.id); if (!element) return;
      event.preventDefault(); event.stopPropagation();
      if (drag.kind === 'move') {
        const point = state.viewer.screenToDesignPlane(event.clientX, event.clientY, drag.planeZ); if (!point) return;
        element.x = drag.original.x + point.x - drag.startPoint.x;
        element.y = drag.original.y + point.y - drag.startPoint.y;
      } else if (drag.kind === 'rotate') {
        const point = state.viewer.screenToDesignPlane(event.clientX, event.clientY, drag.planeZ); if (!point) return;
        const local = pointInElementTransformSpace(drag.original, point);
        const angle = Math.atan2(local.y - drag.centerLocal.y, local.x - drag.centerLocal.x);
        const delta = Math.atan2(Math.sin(angle - drag.startPlaneAngle), Math.cos(angle - drag.startPlaneAngle));
        const raw = drag.original.rotation + delta * 180 / Math.PI;
        element.rotation = event.shiftKey ? Math.round(raw / 15) * 15 : Math.round(raw * 10) / 10;
      } else {
        const point = state.viewer.screenToDesignPlane(event.clientX, event.clientY, drag.planeZ); if (!point) return;
        const local = pointInElementTransformSpace(drag.original, point);
        const extentX = drag.directionX ? Math.max(.01, Math.abs(local.x - drag.anchorLocal.x)) : drag.frameWidth;
        const extentY = drag.directionY ? Math.max(.01, Math.abs(local.y - drag.anchorLocal.y)) : drag.frameHeight;
        const ratioX = extentX / Math.max(.01, drag.frameWidth);
        const ratioY = extentY / Math.max(.01, drag.frameHeight);
        const uniformRatio = Math.hypot(drag.directionX ? extentX : 0, drag.directionY ? extentY : 0) / drag.startDistance;
        scaleElementFrom(element, drag.original, ratioX, ratioY, drag.kind, uniformRatio);
        const nextFrame = elementFrameInLocalSpace(element);
        const nextAnchorLocal = { x: nextFrame.center.x - drag.directionX * nextFrame.width / 2, y: nextFrame.center.y - drag.directionY * nextFrame.height / 2 };
        const anchorAtOrigin = pointFromElementTransformSpace({ ...element, x: 0, y: 0 }, nextAnchorLocal);
        element.x = drag.anchorWorld.x - anchorAtOrigin.x;
        element.y = drag.anchorWorld.y - anchorAtOrigin.y;
      }
      if (elementPlacementFits(element)) drag.lastValid = structuredClone(element);
      else if (drag.lastValid) {
        Object.keys(element).forEach(key => delete element[key]);
        Object.assign(element, structuredClone(drag.lastValid));
      } else {
        constrainElement(element);
      }
      showElementProxy(element, 'drag', .43); renderTransformGizmo(); renderPushPullGizmo();
      const bounds = elementBounds(element);
      $('#stageHint').textContent = drag.kind === 'move' ? `X ${element.x.toFixed(2)} · Y ${element.y.toFixed(2)} mm · release to apply` : drag.kind === 'rotate' ? `Rotation ${element.rotation.toFixed(1)}° · hold Shift for 15°` : `${bounds.width.toFixed(1)} × ${bounds.height.toFixed(1)} mm · ${element.lockAspect !== false ? 'ratio locked' : 'free X/Y'} · live preview`;
    });
    const finish = event => {
      const drag = state.transformDrag; if (!drag || drag.pointerId !== event.pointerId) return;
      state.transformDrag = null;
      const element = state.project.elements.find(item => item.id === drag.id);
      const label = drag.kind === 'move' ? `Moved ${element?.name || 'object'} · X ${element?.x?.toFixed?.(2) || 0} · Y ${element?.y?.toFixed?.(2) || 0} mm` : drag.kind === 'rotate' ? `Rotation ${element?.rotation?.toFixed?.(1) || 0}° applied` : `Scaled to ${element ? `${elementBounds(element).width.toFixed(1)} × ${elementBounds(element).height.toFixed(1)} mm` : ''}`;
      commitPlanarEdit('transform', drag.before, drag.id, label);
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', event => {
      const drag = state.transformDrag; if (!drag || drag.pointerId !== event.pointerId) return;
      state.project = normalizeProject(JSON.parse(drag.before)); state.transformDrag = null; clearElementProxy('drag'); renderAll({ panel: true });
    });
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const kind = handle.dataset.transformHandle;
      const selected = selectedElement();
      if (!selected || selected.locked || state.liveEdit) return;
      event.preventDefault();
      event.stopPropagation();
      const precise = event.shiftKey ? 1 : .2;
      const scaleStep = event.shiftKey ? .1 : .02;
      const increase = ['ArrowRight', 'ArrowUp'].includes(event.key);
      commit(project => {
        const element = project.elements.find(item => item.id === state.selectedId);
        if (!element || element.locked) return;
        if (kind === 'move') {
          if (event.key === 'ArrowLeft') element.x -= precise;
          if (event.key === 'ArrowRight') element.x += precise;
          if (event.key === 'ArrowUp') element.y -= precise;
          if (event.key === 'ArrowDown') element.y += precise;
        } else if (kind === 'rotate') {
          const direction = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1;
          element.rotation = Math.round(((Number(element.rotation) || 0) + direction * (event.shiftKey ? 15 : 1)) * 10) / 10;
        } else {
          const multiplier = Math.max(.02, 1 + (increase ? scaleStep : -scaleStep));
          const changeX = kind === 'resize-x' || kind === 'resize-xy' || element.lockAspect !== false;
          const changeY = kind === 'resize-y' || kind === 'resize-xy' || element.lockAspect !== false;
          if (changeX) element.scaleX = Math.max(.02, Math.min(DESIGN_LIMITS.scaleMax, (Number(element.scaleX) || 1) * multiplier));
          if (changeY) element.scaleY = Math.max(.02, Math.min(DESIGN_LIMITS.scaleMax, (Number(element.scaleY) || 1) * multiplier));
        }
        constrainElement(element);
        project.template = 'custom';
      }, { panel: state.panel === 'layers' });
      const current = selectedElement();
      if (current) $('#stageHint').textContent = kind === 'move'
        ? `X ${current.x.toFixed(2)} · Y ${current.y.toFixed(2)} mm`
        : kind === 'rotate'
          ? `Rotation ${current.rotation.toFixed(1)}°`
          : `Size ${elementBounds(current).width.toFixed(1)} × ${elementBounds(current).height.toFixed(1)} mm`;
      handle.focus();
    });
  });
}

function bindPushPullGizmo() {
  const handle = $('#pushPullHandle');
  handle.addEventListener('pointerdown', event => {
    const element = selectedElement();
    if (!element || element.face === 'back' || element.locked || !state.viewer) return;
    if (state.liveEdit) { toast('Press OK or Cancel before starting another edit'); return; }
    event.preventDefault(); event.stopPropagation();
    let axis = state.viewer.designAxisScreenVector('z', { x: element.x, y: element.y, z: selectionSurfaceZ(element), slot: Math.max(0, Number(element.color) || 0) }, 1);
    if (axis && element.face === 'back') axis = { ...axis, dx: -axis.dx, dy: -axis.dy };
    if (!axis || Math.hypot(axis.dx, axis.dy) < .5) axis = { dx: 0, dy: -1 };
    const length = Math.hypot(axis.dx, axis.dy);
    state.gizmoDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, axisX: axis.dx / length, axisY: axis.dy / length, faceSign: element.face === 'back' ? -1 : 1, initial: signedSurfaceAmount(element), before: snapshot(), id: element.id };
    $('#pushPullGizmo').classList.add('dragging');
    showElementProxy(element, 'drag', .44);
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    const drag = state.gizmoDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const element = state.project.elements.find(item => item.id === drag.id);
    if (!element) return;
    const clientDx = event.clientX - drag.startX, clientDy = event.clientY - drag.startY;
    const pixels = clientDx * drag.axisX + clientDy * drag.axisY;
    const origin = { x: element.x, y: element.y, z: selectionSurfaceZ(element), slot: Math.max(0, Number(element.color) || 0) };
    const zVector = state.viewer.designAxisScreenVector('z', origin, 1);
    const measuredRaw = zVector?.pixelsPerMm >= 1.5 ? state.viewer.screenDeltaToDesignAxis(clientDx, clientDy, 'z', origin, 1) : null;
    const measured = Number.isFinite(measuredRaw) ? measuredRaw * drag.faceSign : null;
    const signed = drag.initial + (Number.isFinite(measured) && Math.abs(measured) < 30 ? measured : pixels / 18 * state.project.profile.layerHeight);
    applySignedSurfaceAmount(element, signed, state.pocketFillMode || element.operation === 'inlay', !event.altKey);
    showElementProxy(element, 'drag', .44);
    renderPushPullGizmo();
    $('#stageHint').textContent = `${gizmoDescription(element)} · ${event.altKey ? 'free 0.01 mm' : `${state.project.profile.layerHeight.toFixed(2)} mm layer snap`} · live preview`;
  });
  const finish = event => {
    const drag = state.gizmoDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.gizmoDrag = null;
    $('#pushPullGizmo').classList.remove('dragging');
    clearElementProxy('drag');
    const element = state.project.elements.find(item => item.id === drag.id);
    if (stageLiveEdit('push-pull', drag.before, drag.id, element ? gizmoDescription(element) : 'Height change')) markOnboardingStep('operation');
    else renderAll({ panel: state.panel === 'layers' });
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', event => {
    const drag = state.gizmoDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.project = normalizeProject(JSON.parse(drag.before));
    state.gizmoDrag = null;
    $('#pushPullGizmo').classList.remove('dragging');
    clearElementProxy('drag');
    renderAll({ panel: true });
  });
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const selected = selectedElement();
    if (!selected || selected.face === 'back' || selected.locked || state.liveEdit) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1;
    const step = event.altKey ? .01 : state.project.profile.layerHeight;
    commit(project => {
      const element = project.elements.find(item => item.id === state.selectedId);
      if (!element || element.face === 'back' || element.locked) return;
      applySignedSurfaceAmount(element, signedSurfaceAmount(element) + direction * step, state.pocketFillMode || element.operation === 'inlay', !event.altKey);
      project.template = 'custom';
    }, { panel: state.panel === 'layers' });
    const current = selectedElement();
    if (current) $('#stageHint').textContent = `${gizmoDescription(current)} · keyboard adjusted by ${step.toFixed(2)} mm`;
    handle.focus();
  });
  handle.addEventListener('click', () => {
    const element = selectedElement();
    if (element) $('#stageHint').textContent = `Drag vertically, or use arrow keys, to change ${element.name} by exact print layers`;
  });
  $('#gizmoPocketFill').addEventListener('click', () => commit(project => {
    const element = project.elements.find(item => item.id === state.selectedId);
    if (!element || element.locked) return;
    if (element.operation === 'inlay') { element.operation = 'engrave'; state.pocketFillMode = false; }
    else { element.operation = element.operation === 'engrave' ? 'inlay' : 'engrave'; state.pocketFillMode = element.operation === 'inlay'; }
  }));
  $('#gizmoCutThrough').addEventListener('click', () => commit(project => {
    const element = project.elements.find(item => item.id === state.selectedId);
    if (!element || element.locked) return;
    if (element.operation === 'cut') { element.operation = 'raise'; element.zHeight = project.profile.layerHeight * 3; }
    else element.operation = 'cut';
  }));
}

function renderSelectionHud() {
  const root = $('#selectionHud');
  const element = selectedElement();
  const slicerDock = $('#slicerDock');
  if (!element || element.hidden || state.view === 'toolpath' || state.drawing.mode !== 'select') { root.hidden = true; root.innerHTML = ''; slicerDock?.classList.remove('selection-active'); renderPushPullGizmo(); renderTransformGizmo(); return; }
  const activeInlineEditor = document.activeElement?.matches?.('[data-inline-text-editor]') ? document.activeElement : null;
  if (activeInlineEditor && root.contains(activeInlineEditor) && activeInlineEditor.dataset.inlineElement === element.id) {
    renderPushPullGizmo();
    renderTransformGizmo();
    return;
  }
  root.hidden = false;
  slicerDock?.classList.toggle('selection-active', state.view === '3d');
  const directTextEditor = element.type === 'text' && !element.locked
    ? `<label class="selection-inline-text"><span>Edit selected text</span><input type="text" data-inline-text-editor data-inline-element="${escapeHtml(element.id)}" value="${escapeHtml(element.text || '')}" maxlength="80" aria-label="Edit selected medal text"/><small>Enter applies · Esc restores</small></label>`
    : '';
  const editButtons = element.locked
    ? '<i>Locked</i>'
    : element.face === 'back'
      ? '<button type="button" data-move-on-face>Show edit handles</button><i>✓ Flat back color</i>'
      : '<button type="button" data-move-on-face>Show edit handles</button><button type="button" data-quick-operation="raise">Raised</button><button type="button" data-quick-operation="engrave">Recessed</button><button type="button" data-quick-operation="inlay">Flat color</button><button type="button" data-quick-operation="cut">Hole</button>';
  root.innerHTML = `${directTextEditor}<div class="selection-hud-title"><span class="selection-hud-copy"><small>${escapeHtml(translateUiKey('dynamicUi.selected'))} · ${escapeHtml(localizedElementType(element.type))}</small><strong data-i18n-ignore>${escapeHtml(element.name)}</strong><em>${escapeHtml(operationDescription(element))}</em></span><span class="selection-hud-buttons">${editButtons}<button type="button" data-open-inspector>Details</button></span></div>`;
  const textInput = root.querySelector('[data-inline-text-editor]');
  if (textInput) {
    const elementId = element.id;
    const finish = ({ cancelled = false } = {}) => {
      const before = state.inlineTextEditStart;
      if (!before) return;
      state.inlineTextEditStart = null;
      textInput.blur();
      if (cancelled) {
        state.project = normalizeProject(JSON.parse(before));
        markDirty();
        renderAll({ panel: true });
        toast('Text edit cancelled');
        return;
      }
      state.project = normalizeProject(state.project);
      if (before !== snapshot()) pushHistory(before);
      renderAll({ panel: state.panel === 'layers' });
      toast('Text updated');
    };
    textInput.addEventListener('focus', () => { if (!state.inlineTextEditStart) state.inlineTextEditStart = snapshot(); });
    textInput.addEventListener('input', () => {
      if (!state.inlineTextEditStart) state.inlineTextEditStart = snapshot();
      const target = state.project.elements.find(item => item.id === elementId);
      if (!target || target.locked) return;
      target.text = textInput.value;
      target.name = textInput.value.trim().slice(0, 24) || 'Text';
      state.project.template = 'custom';
      root.querySelector('.selection-hud-copy strong').textContent = target.name;
      $('#undoButton').disabled = false;
      $('#redoButton').disabled = true;
      markDirty();
      refreshComputed(false);
      renderSelectionHud();
    });
    textInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); finish(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish({ cancelled: true }); }
    });
    textInput.addEventListener('blur', () => finish());
  }
  root.querySelector('[data-move-on-face]')?.addEventListener('click', () => {
    setInspectionOpen(false);
    setView('3d');
    setCameraPreset(element.face === 'back' ? 'bottom' : 'top');
    state.viewer?.fit();
    renderTransformGizmo();
    renderPushPullGizmo();
    $('#stageHint').textContent = translateUiKey('stage.moveElement', {
      name: element.name,
      scaleMode: translateUiKey(element.lockAspect === false ? 'stage.scaleFree' : 'stage.scaleLocked'),
    });
    requestAnimationFrame(() => $('#transformMoveHandle')?.focus());
  });
  root.querySelectorAll('[data-quick-operation]').forEach(button => button.addEventListener('click', () => commit(project => {
    const selected = project.elements.find(item => item.id === state.selectedId);
    if (!selected || selected.locked) return;
    selected.operation = button.dataset.quickOperation;
    if (selected.operation === 'raise') selected.zHeight = Math.max(project.profile.layerHeight, selected.zHeight || project.medal.defaultHeight);
    else if (selected.operation !== 'cut') selected.zDepth = Math.min(project.medal.baseThickness - project.medal.minimumFloor, Math.max(project.profile.layerHeight, selected.zDepth || project.profile.layerHeight * 2));
    state.pocketFillMode = selected.operation === 'inlay';
  })));
  root.querySelector('[data-open-inspector]')?.addEventListener('click', () => {
    $('.side-panel')?.classList.remove('mobile-open');
    $('.inspector')?.classList.add('mobile-open');
  });
  renderPushPullGizmo();
  renderTransformGizmo();
}

function objectTreeRow(element) {
  const icon = element.type === 'text' ? 'T' : element.type === 'image' ? '▧' : element.type === 'path' ? '⌁' : '●';
  const info = OPERATION_INFO[element.operation] || OPERATION_INFO.raise;
  const amount = element.operation === 'cut' ? translateUiKey('dynamicUi.through') : `${localizedFixed(operationValue(element))} mm`;
  const operation = element.face === 'back' ? `◆ ${escapeHtml(translateUiKey('text.flat'))}` : `${info.icon} ${escapeHtml(localizedOperationLabel(element.operation))}`;
  return `<div class="object-tree-row ${element.id === state.selectedId ? 'selected' : ''} ${element.hidden ? 'hidden-object' : ''}">
    <button class="object-tree-select" type="button" data-object-tree-id="${escapeHtml(element.id)}" aria-label="Edit ${escapeHtml(element.name)}" aria-pressed="${element.id === state.selectedId}"><span class="object-tree-icon">${icon}</span><span class="object-tree-copy"><strong data-i18n-ignore>${escapeHtml(element.name)}</strong><small>${operation} · ${amount}</small></span></button>
    <span class="object-tree-actions"><button type="button" data-tree-lock="${escapeHtml(element.id)}" title="${element.locked ? 'Unlock' : 'Lock'}" aria-label="${element.locked ? 'Unlock' : 'Lock'} ${escapeHtml(element.name)}" aria-pressed="${element.locked}">${element.locked ? '▣' : '▢'}</button><button type="button" data-tree-hide="${escapeHtml(element.id)}" title="${element.hidden ? 'Show' : 'Hide'}" aria-label="${element.hidden ? 'Show' : 'Hide'} ${escapeHtml(element.name)}">${element.hidden ? '○' : '●'}</button></span>
  </div>`;
}

function projectGroupMembers(groupId, face = null, project = state.project) {
  return project.elements.filter(element => element.groupId === groupId && (!face || element.face === face));
}

function groupWorldBounds(elements) {
  const points = elements.flatMap(element => elementFramePoints(element).corners);
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY };
}

function transformGroupElements(elements, pivot, { moveX, moveY, scale, rotation }) {
  const angle = rotation * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
  for (const element of elements) {
    const localX = element.x - pivot.x, localY = element.y - pivot.y;
    element.x = pivot.x + (localX * cosine - localY * sine) * scale + moveX;
    element.y = pivot.y + (localX * sine + localY * cosine) * scale + moveY;
    element.scaleX = (Number(element.scaleX) || 1) * scale;
    element.scaleY = (Number(element.scaleY) || 1) * scale;
    element.rotation = ((Number(element.rotation) || 0) + rotation + 180) % 360;
    if (element.rotation < 0) element.rotation += 360;
    element.rotation -= 180;
  }
}

function openGroupTransformDialog(groupId, face) {
  if (state.liveEdit) { toast('Press OK or Cancel first'); return; }
  const group = state.project.groups.find(item => item.id === groupId);
  const members = projectGroupMembers(groupId, face);
  if (!group || !members.length) { toast('This group has no objects on this face'); return; }
  const bounds = groupWorldBounds(members), lockedCount = members.filter(element => element.locked).length;
  openDialog('Arrange group', `${group.name} · ${face === 'back' ? 'back' : 'front'} side · ${members.length} items`, `<div class="group-transform-summary"><strong>${bounds.width.toFixed(1)} × ${bounds.height.toFixed(1)} mm</strong><span>Moves from the center of the group</span></div>${lockedCount ? `<div class="operation-note"><b>${lockedCount} locked item${lockedCount === 1 ? '' : 's'}</b><span>Unlock the group in Design items before changing it.</span></div>` : ''}<div class="property-grid"><label><span>Move left / right</span><div class="unit-input"><input id="groupMoveX" type="number" value="0" step="0.1"><em>mm</em></div></label><label><span>Move up / down</span><div class="unit-input"><input id="groupMoveY" type="number" value="0" step="0.1"><em>mm</em></div></label><label><span>Overall size</span><div class="unit-input"><input id="groupScale" type="number" value="100" min="1" max="4000" step="1"><em>%</em></div></label><label><span>Rotate</span><div class="unit-input"><input id="groupRotation" type="number" value="0" min="-360" max="360" step="1"><em>°</em></div></label></div><p class="field-help">The group moves as one undoable change. Every item keeps its editable text, color, and surface style.</p><div class="dialog-actions"><button class="button secondary" data-close-dialog>Cancel</button><button class="button primary" id="applyGroupTransform" ${lockedCount ? 'disabled' : ''}>Apply to group</button></div>`);
  $('[data-close-dialog]')?.addEventListener('click', closeDialog);
  $('#applyGroupTransform')?.addEventListener('click', () => {
    const moveX = Number($('#groupMoveX').value), moveY = Number($('#groupMoveY').value);
    const scale = Number($('#groupScale').value) / 100, rotation = Number($('#groupRotation').value);
    if (![moveX, moveY, scale, rotation].every(Number.isFinite) || scale <= 0) { toast('Enter valid group transform values'); return; }
    const staged = members.map(element => structuredClone(element));
    transformGroupElements(staged, bounds, { moveX, moveY, scale, rotation });
    const scalesValid = staged.every(element => element.scaleX >= .02 && element.scaleX <= DESIGN_LIMITS.scaleMax && element.scaleY >= .02 && element.scaleY <= DESIGN_LIMITS.scaleMax);
    if (!scalesValid) { toast(`Group scale must keep every object between 0.02× and ${DESIGN_LIMITS.scaleMax}×`); return; }
    if (!staged.every(elementPlacementFits)) { toast('The transformed group would leave the printable face'); return; }
    const stagedById = new Map(staged.map(element => [element.id, element]));
    const changed = commit(project => {
      project.elements = project.elements.map(element => stagedById.has(element.id) ? stagedById.get(element.id) : element);
      project.template = 'custom';
    }, { panel: true });
    if (changed) { closeDialog(); toast(`${group.name} transformed as one group`); }
  });
  requestAnimationFrame(() => { $('#groupMoveX')?.focus(); $('#groupMoveX')?.select(); });
}

function duplicateObjectGroup(groupId, face) {
  if (state.liveEdit) { toast('Press OK or Cancel first'); return; }
  const group = state.project.groups.find(item => item.id === groupId);
  const members = projectGroupMembers(groupId, face);
  if (!group || !members.length) { toast('This group has no objects to duplicate'); return; }
  if (state.project.groups.length >= DESIGN_LIMITS.groups) { toast(`This design reached the safe ${DESIGN_LIMITS.groups}-group browser budget`); return; }
  if (state.project.elements.length + members.length > DESIGN_LIMITS.elements) { toast(`Duplicating this group would exceed the safe ${DESIGN_LIMITS.elements}-object browser budget`); return; }
  const newGroupId = uid('group').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 120);
  const copies = members.map(original => ({ ...structuredClone(original), id: uid(original.type), name: `${original.name} copy`, groupId: newGroupId, x: original.x + 2, y: original.y + 2, locked: false, hidden: false }));
  if (!copies.every(elementPlacementFits)) copies.forEach((copy, index) => { copy.x = members[index].x; copy.y = members[index].y; });
  state.selectedId = copies.at(-1).id;
  commit(project => {
    project.groups.push({ id: newGroupId, name: `${group.name} copy` });
    project.elements.push(...copies);
    project.template = 'custom';
  }, { panel: true });
  toast(`${group.name} duplicated as an editable group`);
}

function renderObjectTree() {
  const root = $('#objectTree');
  if (!root || !state.project) return;
  const renderFace = face => {
    const elements = state.project.elements.filter(element => element.face === face);
    const grouped = new Set();
    const groups = state.project.groups.map(group => {
      const members = elements.filter(element => element.groupId === group.id);
      if (!members.length) return face === 'front' ? `<details class="object-group"><summary><span>▾ <span data-i18n-ignore>${escapeHtml(group.name)}</span></span><small>${escapeHtml(localizedCount('item', 0))}</small></summary><div class="object-group-items"><button type="button" data-rename-group="${escapeHtml(group.id)}">Rename empty group</button><div class="object-tree-empty">Empty group</div></div></details>` : '';
      members.forEach(element => grouped.add(element.id));
      const allLocked = members.every(element => element.locked), allHidden = members.every(element => element.hidden);
      const groupData = `data-group-id="${escapeHtml(group.id)}" data-group-face="${face}"`;
      return `<details class="object-group" open><summary><span>▾ <span data-i18n-ignore>${escapeHtml(group.name)}</span></span><small>${escapeHtml(localizedCount('item', members.length))}</small></summary><div class="object-group-items"><div class="object-group-toolbar"><button type="button" data-rename-group="${escapeHtml(group.id)}" title="Rename group">Rename</button><button type="button" data-group-transform ${groupData} title="Move, resize, or rotate the group">Arrange</button><button type="button" data-group-duplicate ${groupData} title="Duplicate group">Copy</button><button type="button" data-group-lock ${groupData} title="${allLocked ? 'Unlock all' : 'Lock all'}">${allLocked ? 'Unlock' : 'Lock'}</button><button type="button" data-group-hide ${groupData} title="${allHidden ? 'Show all' : 'Hide all'}">${allHidden ? 'Show' : 'Hide'}</button></div>${[...members].reverse().map(objectTreeRow).join('')}</div></details>`;
    }).join('');
    const ungrouped = [...elements].reverse().filter(element => !grouped.has(element.id));
    const faceLabel = face === 'back' ? translateUiKey('dynamicUi.backAlwaysFlat') : translateUiKey('items.frontGroup');
    return `<details class="object-face" open data-tree-face="${face}"><summary><span>${face === 'back' ? '↺' : '◎'} ${escapeHtml(faceLabel)}</span><small>${escapeHtml(localizedCount('item', elements.length))}</small></summary><div class="object-face-body">${groups}${ungrouped.map(objectTreeRow).join('') || (!groups ? '<div class="object-tree-empty">No design items on this side</div>' : '')}</div></details>`;
  };
  root.className = 'object-tree';
  root.innerHTML = `${renderFace('front')}${renderFace('back')}`;
  root.querySelectorAll('[data-object-tree-id]').forEach(row => {
    const select = () => {
      if (state.liveEdit) { toast('Press OK or Cancel before selecting another object'); return; }
      state.selectedId = row.dataset.objectTreeId;
      const element = selectedElement();
      // Tree selection is deliberately face-first: novices should never select a
      // front item while still looking at the back (or vice versa).
      if (element) setCameraPreset(element.face === 'back' ? 'bottom' : 'top');
      renderInspector(); drawMedal();
    };
    row.addEventListener('click', select);
  });
  root.querySelectorAll('[data-tree-hide]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    if (state.liveEdit) { toast('Press OK or Cancel first'); return; }
    commit(project => { const element = project.elements.find(item => item.id === button.dataset.treeHide); if (element) element.hidden = !element.hidden; });
  }));
  root.querySelectorAll('[data-tree-lock]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    if (state.liveEdit) { toast('Press OK or Cancel first'); return; }
    commit(project => { const element = project.elements.find(item => item.id === button.dataset.treeLock); if (element) element.locked = !element.locked; });
  }));
  root.querySelectorAll('[data-rename-group]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    const group = state.project.groups.find(item => item.id === button.dataset.renameGroup); if (!group) return;
    openGroupDialog(group);
  }));
  root.querySelectorAll('[data-group-transform]').forEach(button => button.addEventListener('click', () => openGroupTransformDialog(button.dataset.groupId, button.dataset.groupFace)));
  root.querySelectorAll('[data-group-duplicate]').forEach(button => button.addEventListener('click', () => duplicateObjectGroup(button.dataset.groupId, button.dataset.groupFace)));
  root.querySelectorAll('[data-group-lock]').forEach(button => button.addEventListener('click', () => {
    const members = projectGroupMembers(button.dataset.groupId, button.dataset.groupFace);
    const shouldLock = members.some(element => !element.locked);
    commit(project => { projectGroupMembers(button.dataset.groupId, button.dataset.groupFace, project).forEach(element => { element.locked = shouldLock; }); }, { panel: true });
    toast(shouldLock ? 'Group locked' : 'Group unlocked');
  }));
  root.querySelectorAll('[data-group-hide]').forEach(button => button.addEventListener('click', () => {
    const members = projectGroupMembers(button.dataset.groupId, button.dataset.groupFace);
    const shouldHide = members.some(element => !element.hidden);
    commit(project => { projectGroupMembers(button.dataset.groupId, button.dataset.groupFace, project).forEach(element => { element.hidden = shouldHide; }); }, { panel: true });
    toast(shouldHide ? 'Group hidden' : 'Group shown');
  }));
}

function openGroupDialog(group = null) {
  if (state.liveEdit) { toast('Press OK or Cancel first'); return; }
  if (!group && state.project.groups.length >= DESIGN_LIMITS.groups) { toast(`This design reached the safe ${DESIGN_LIMITS.groups}-group browser budget`); return; }
  openDialog(group ? 'Rename group' : 'New design group', group ? 'Keep related artwork together' : 'Move and resize related items together', `<label class="field-label" for="groupNameInput">Group name</label><input class="text-input" id="groupNameInput" maxlength="60" value="${escapeHtml(group?.name || 'New group')}" autofocus><div class="dialog-actions">${group ? '<button class="button secondary" id="deleteGroup">Remove group</button>' : ''}<button class="button secondary" data-close-dialog>Cancel</button><button class="button primary" id="saveGroup">${group ? 'Rename' : 'Create group'}</button></div>`);
  $('[data-close-dialog]')?.addEventListener('click', closeDialog);
  $('#saveGroup')?.addEventListener('click', () => {
    const name = $('#groupNameInput').value.trim().slice(0, 60) || 'Group';
    const createdId = group?.id || uid('group').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 120);
    commit(project => {
      if (group) { const target = project.groups.find(item => item.id === group.id); if (target) target.name = name; }
      else {
        project.groups.push({ id: createdId, name });
        const selected = project.elements.find(item => item.id === state.selectedId);
        if (selected && !selected.locked) selected.groupId = createdId;
      }
    });
    closeDialog();
  });
  $('#deleteGroup')?.addEventListener('click', () => {
    commit(project => { project.groups = project.groups.filter(item => item.id !== group.id); project.elements.forEach(element => { if (element.groupId === group.id) element.groupId = null; }); });
    closeDialog(); toast('Group removed; its objects remain in place');
  });
  requestAnimationFrame(() => { $('#groupNameInput')?.focus(); $('#groupNameInput')?.select(); });
}

function renderInspector() {
  renderObjectTree();
  const root = $('#selectionInspector');
  const element = selectedElement();
  if (!element) {
    $('.inspector')?.classList.remove('mobile-open');
    root.innerHTML = `<div class="inspector-header"><div><span class="eyebrow">Selection</span><h2>Nothing selected</h2></div></div><div class="selection-empty"><b>Select an object</b><span>Click artwork on the medal or choose it from Objects.</span></div>`;
    renderSelectionHud();
    return;
  }
  let specific = '';
  const editingLocked = element.locked || Boolean(state.liveEdit);
  const disabled = editingLocked ? 'disabled' : '';
  if (element.type === 'text') {
    specific = `<label class="field-label">Wording · edit directly</label><input class="text-input" data-element-field="text" value="${escapeHtml(element.text)}" maxlength="80" ${disabled}/><div class="control-grid"><label><span>Size</span><div class="unit-input"><input data-element-field="fontSize" data-number type="number" min="1" max="${DESIGN_LIMITS.textSizeMax}" step="0.1" value="${element.fontSize}" ${disabled}/><em>mm</em></div></label><label><span>Weight</span><select class="select-input" data-element-field="weight" data-number ${disabled}><option value="700" ${element.weight === 700 ? 'selected' : ''}>Bold</option><option value="800" ${element.weight === 800 ? 'selected' : ''}>Extra bold</option><option value="900" ${element.weight === 900 ? 'selected' : ''}>Heavy</option></select></label><label><span>Style</span><select class="select-input" data-element-field="fontFamily" ${disabled}><option value="Arial" ${element.fontFamily === 'Arial' ? 'selected' : ''}>Clean</option><option value="Verdana" ${element.fontFamily === 'Verdana' ? 'selected' : ''}>Wide</option><option value="Georgia" ${element.fontFamily === 'Georgia' ? 'selected' : ''}>Classic serif</option></select></label></div>`;
  } else if (element.type === 'shape') {
    specific = `<div class="control-grid"><label><span>Size</span><div class="unit-input"><input data-element-field="size" data-number type="number" min="1" max="${DESIGN_LIMITS.shapeSizeMax}" step="0.1" value="${element.size}" ${disabled}/><em>mm</em></div></label><label><span>Shape</span><input class="text-input" value="${escapeHtml(shapeInfo(element.shape).label)}" disabled/></label></div>`;
  } else if (element.type === 'image') {
    const palette = getPalette(state.project, state.inventory);
    const used = (element.usedSlots?.length ? element.usedSlots : element.maskUrls?.map((url, slot) => url ? slot : -1).filter(slot => slot >= 0) || []).filter(slot => palette[slot]);
    const segmentColor = element.rasterKind === 'segment' && used.length === 1 && !['engrave', 'cut'].includes(element.operation) ? `<label class="field-label">Filament color</label><div class="element-colors segment-colors">${colorButtons(element.color, editingLocked)}</div><p class="check-summary">This detected image part is independent. Changing its color does not affect the other parts in its group.</p>` : '';
    specific = `<div class="control-grid"><label><span>Printable sample</span><div class="unit-input"><input value="${(element.detailCell * Math.min(element.scaleX || 1, element.scaleY || 1)).toFixed(2)}" disabled/><em>mm</em></div></label><label><span>Source ratio</span><div class="unit-input"><input value="${element.sourceWidth || element.pixelWidth} × ${element.sourceHeight || element.pixelHeight}" disabled/><em>px</em></div></label></div>${segmentColor}<button class="full-button" type="button" data-reset-image-ratio>Reset to source aspect ratio</button><div class="image-color-card"><div class="image-color-head"><strong>${used.length} image color${used.length === 1 ? '' : 's'} in use</strong><span class="image-color-head-actions">${inlineAddColorButtonHtml('inspector-image', { disabled: editingLocked })}<button type="button" data-manage-image-colors>Manage</button></span></div><div class="image-color-list">${used.map(slot => `<span class="image-color-chip"><i style="background:${palette[slot].color}"></i>${escapeHtml(palette[slot].name)}</span>`).join('') || '<span class="check-summary">No printable color regions found.</span>'}</div><button class="full-button" type="button" data-edit-image>Edit image cleanup…</button><button class="full-button" type="button" data-remap-image>Quick remap to current colors</button></div><p class="check-summary">Aspect ratio is locked by default. Free X/Y scaling is intentionally allowed only when you turn the ratio lock off.</p>`;
  } else if (element.type === 'path') {
    specific = `<div class="control-grid"><label><span>Source scale</span><div class="unit-input"><input data-element-field="scale" data-number type="number" min="0.05" max="${DESIGN_LIMITS.pathScaleMax}" step="0.05" value="${element.scale}" ${disabled}/><em>×</em></div></label><label><span>Stroke</span><div class="unit-input"><input data-element-field="strokeWidth" data-number type="number" min="0.2" max="${DESIGN_LIMITS.pathStrokeMax}" step="0.05" value="${element.strokeWidth}" ${element.closed || editingLocked ? 'disabled' : ''}/><em>mm</em></div></label></div>`;
  }
  const showColor = !['engrave', 'cut'].includes(element.operation);
  const bounds = elementBounds(element);
  const transformControls = `<div class="transform-size-card"><div class="transform-size-head"><strong>Size on medal</strong><button type="button" class="aspect-toggle ${element.lockAspect !== false ? 'active' : ''}" data-aspect-toggle ${disabled}>${element.lockAspect !== false ? '🔗 Ratio locked' : '⛓ Free width / height'}</button></div><div class="control-grid"><label><span>Width</span><div class="unit-input"><input data-element-dimension="width" type="number" min="0.5" max="${DESIGN_LIMITS.imageSizeMax}" step="0.1" value="${bounds.width.toFixed(1)}" ${disabled}/><em>mm</em></div></label><label><span>Height</span><div class="unit-input"><input data-element-dimension="height" type="number" min="0.5" max="${DESIGN_LIMITS.imageSizeMax}" step="0.1" value="${bounds.height.toFixed(1)}" ${disabled}/><em>mm</em></div></label></div><div class="scale-presets"><button type="button" data-scale-preset="0.8" ${disabled}>80%</button><button type="button" data-scale-preset="1" ${disabled}>Reset</button><button type="button" data-scale-preset="1.2" ${disabled}>120%</button></div><label class="field-label">Placed on</label><div class="segmented"><button type="button" data-element-face="front" class="${element.face !== 'back' ? 'active' : ''}" ${disabled}>Front</button><button type="button" data-element-face="back" class="${element.face === 'back' ? 'active' : ''}" ${disabled}>Back · flat</button></div>${element.face === 'back' ? '<p class="check-summary">✓ Added color is embedded into the back surface, so the medal stays flat on the build plate.</p>' : ''}<label class="field-label">Design group</label><select class="select-input" data-element-group ${disabled}><option value="">No group</option>${state.project.groups.map(group => `<option data-i18n-ignore value="${escapeHtml(group.id)}" ${element.groupId === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}</select></div>`;
  root.innerHTML = `<div class="inspector-header"><div><span class="eyebrow">${escapeHtml(translateUiKey('dynamicUi.selection'))} · ${escapeHtml(localizedElementType(element.type))}</span><h2 data-i18n-ignore>${escapeHtml(element.name)}</h2></div><span class="inspector-head-actions"><button class="icon-button" id="duplicateElement" title="Duplicate" aria-label="Duplicate ${escapeHtml(element.name)}" ${disabled}>＋</button><button class="icon-button inspector-mobile-close" id="closeInspector" aria-label="Close details">×</button></span></div>${surfaceControlsHtml(element)}${state.liveEdit ? '<div class="operation-note"><b>Live edit pending</b><span>Use OK or Cancel on the model before changing object properties.</span></div>' : ''}<div class="inspector-subsection"><span class="eyebrow">Object details</span>${specific}${transformControls}<div class="control-grid"><label><span>X position</span><div class="unit-input"><input data-element-field="x" data-number type="number" step="0.1" value="${element.x.toFixed(1)}" ${disabled}/><em>mm</em></div></label><label><span>Y position</span><div class="unit-input"><input data-element-field="y" data-number type="number" step="0.1" value="${element.y.toFixed(1)}" ${disabled}/><em>mm</em></div></label><label><span>Rotation</span><div class="unit-input"><input data-element-field="rotation" data-number type="number" min="-180" max="180" step="1" value="${element.rotation || 0}" ${disabled}/><em>°</em></div></label></div>${showColor && element.type !== 'image' ? `<label class="field-label">Color</label><div class="element-colors">${colorButtons(element.color, editingLocked)}</div>` : !showColor ? `<div class="operation-note"><b>No added color</b><span>${element.operation === 'cut' ? 'This object removes material.' : 'The exposed base material forms the engraving.'}</span></div>` : ''}<div class="inline-actions inspector-object-actions"><button id="fitElement" ${disabled}>Fit inside medal</button><button id="centerElement" ${disabled}>Center</button><button id="duplicateOtherSide" ${disabled}>Copy to ${element.face === 'back' ? 'front' : 'back'}</button><button id="lockElement" ${state.liveEdit ? 'disabled' : ''}>${element.locked ? 'Unlock' : 'Lock'}</button><button class="delete" id="deleteElement" ${disabled}>Delete</button></div></div>`;
  bindInspector();
  renderSelectionHud();
}

function applyElementField(element, field, input) {
  let value = input.hasAttribute('data-number') ? Number(input.value) : input.value;
  if (!Number.isFinite(value) && input.hasAttribute('data-number')) return;
  if (field === 'width' && element.type === 'image') {
    const previousWidth = Math.max(.01, element.width);
    const ratio = element.height / element.width;
    element.width = Math.max(3, value);
    element.height = element.width * ratio;
    element.detailCell = element.width / element.pixelWidth;
    element.minimumFeature = Math.max(element.detailCell, (element.minimumFeature || element.detailCell) * element.width / previousWidth);
  } else element[field] = value;
  if (field === 'text') element.name = value.slice(0, 24) || 'Text';
  state.project.template = 'custom';
}

function applyElementDimension(element, dimension, value) {
  const bounds = elementBounds(element);
  const current = dimension === 'width' ? bounds.width : bounds.height;
  if (!Number.isFinite(value) || value <= 0 || current <= .001) return;
  const ratio = value / current;
  if (element.lockAspect !== false) {
    element.scaleX = Math.max(.02, Math.min(DESIGN_LIMITS.scaleMax, (Number(element.scaleX) || 1) * ratio));
    element.scaleY = Math.max(.02, Math.min(DESIGN_LIMITS.scaleMax, (Number(element.scaleY) || 1) * ratio));
  } else if (dimension === 'width') element.scaleX = Math.max(.02, Math.min(DESIGN_LIMITS.scaleMax, (Number(element.scaleX) || 1) * ratio));
  else element.scaleY = Math.max(.02, Math.min(DESIGN_LIMITS.scaleMax, (Number(element.scaleY) || 1) * ratio));
  state.project.template = 'custom';
}

async function recolorSegmentImage(elementId, colorSlot) {
  const element = state.project.elements.find(item => item.id === elementId);
  const palette = getPalette(state.project, state.inventory);
  if (!element || element.type !== 'image' || element.rasterKind !== 'segment' || !palette[colorSlot]) return;
  const source = element.maskUrls?.find(Boolean) || element.dataUrl;
  if (!source) return;
  try {
    const image = await decodeImage(source);
    const repaint = document.createElement('canvas'); repaint.width = image.naturalWidth; repaint.height = image.naturalHeight;
    const repaintContext = repaint.getContext('2d', { willReadFrequently: true }); repaintContext.drawImage(image, 0, 0);
    const pixels = repaintContext.getImageData(0, 0, repaint.width, repaint.height), rgb = hexToRgb(palette[colorSlot].color);
    for (let offset = 0; offset < pixels.data.length; offset += 4) if (pixels.data[offset + 3] >= 16) {
      pixels.data[offset] = rgb[0]; pixels.data[offset + 1] = rgb[1]; pixels.data[offset + 2] = rgb[2];
    }
    repaintContext.putImageData(pixels, 0, 0);
    const dataUrl = repaint.toDataURL('image/png');
    const changed = commit(project => {
      const target = project.elements.find(item => item.id === elementId);
      if (!target || target.locked || target.type !== 'image') return;
      target.color = colorSlot; target.dataUrl = dataUrl; target.sourceDataUrl = dataUrl;
      target.maskUrls = Array(project.paletteIds.length).fill(null); target.maskUrls[colorSlot] = dataUrl;
      target.usedSlots = [colorSlot]; target.imageSettings = { ...target.imageSettings, activeSlots: [colorSlot] };
    }, { panel: state.panel === 'layers' });
    if (changed) toast(`${element.name} changed to ${palette[colorSlot].name}`);
  } catch (error) { toast(`Could not recolor this image part: ${error.message}`); }
}

function bindInspector() {
  const root = $('#selectionInspector');
  bindInlineAddColorButtons(root);
  bindSurfaceControls(root);
  root.querySelectorAll('[data-element-field]').forEach(input => {
    const finishFieldEdit = () => {
      if (!state.inspectorEditStart) return;
      const reprocessImage = input.dataset.elementField === 'width' && selectedElement()?.type === 'image' && selectedElement()?.sourceDataUrl;
      const selectedId = state.selectedId;
      state.project = normalizeProject(state.project);
      pushHistory(state.inspectorEditStart);
      state.inspectorEditStart = null;
      renderAll({ panel: state.panel === 'layers' });
      if (reprocessImage) reprocessImportedImages('image size change', selectedId);
    };
    input.addEventListener('focus', () => { state.inspectorEditStart = snapshot(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && input.dataset.elementField === 'text') { event.preventDefault(); input.blur(); }
      if (event.key === 'Escape' && state.inspectorEditStart) {
        event.preventDefault();
        state.project = normalizeProject(JSON.parse(state.inspectorEditStart));
        state.inspectorEditStart = null;
        renderAll({ panel: true });
        toast('Text edit cancelled');
      }
    });
    input.addEventListener('input', () => {
      const element = selectedElement();
      if (!element || element.locked) return;
      applyElementField(element, input.dataset.elementField, input);
      // Keep the project-level Undo command available while this focus session
      // is still an uncommitted transaction. Clicking Undo first blurs the
      // field (which records the single baseline snapshot) and then undoes it.
      $('#undoButton').disabled = false;
      $('#redoButton').disabled = true;
      markDirty();
      refreshComputed(false);
    });
    input.addEventListener('change', finishFieldEdit);
    input.addEventListener('blur', finishFieldEdit);
  });
  root.querySelectorAll('[data-element-dimension]').forEach(input => {
    const finishDimensionEdit = () => {
      if (!state.inspectorEditStart) return;
      const selected = selectedElement();
      const reprocessImage = selected?.type === 'image' && selected.sourceDataUrl;
      const selectedId = selected?.id;
      state.project = normalizeProject(state.project); pushHistory(state.inspectorEditStart); state.inspectorEditStart = null;
      clearElementProxy('drag'); renderAll({ panel: state.panel === 'layers' });
      if (reprocessImage) reprocessImportedImages('image size change', selectedId);
    };
    input.addEventListener('focus', () => { state.inspectorEditStart = snapshot(); });
    input.addEventListener('input', () => {
      const element = selectedElement(); if (!element || element.locked) return;
      applyElementDimension(element, input.dataset.elementDimension, Number(input.value));
      $('#undoButton').disabled = false;
      $('#redoButton').disabled = true;
      showElementProxy(element, 'drag', .4); renderTransformGizmo(); markDirty(); refreshComputed(false);
    });
    input.addEventListener('change', finishDimensionEdit);
    input.addEventListener('blur', finishDimensionEdit);
  });
  root.querySelector('[data-aspect-toggle]')?.addEventListener('click', () => commit(project => {
    const element = project.elements.find(item => item.id === state.selectedId);
    if (!element || element.locked) return;
    element.lockAspect = !element.lockAspect;
    if (element.lockAspect && element.type === 'image') {
      const crop = Array.isArray(element.imageSettings?.crop) ? element.imageSettings.crop : [0, 0, 1, 1];
      const sourceWidth = Number(element.sourceWidth || element.pixelWidth) * Math.max(.01, crop[2] - crop[0]);
      const sourceHeight = Number(element.sourceHeight || element.pixelHeight) * Math.max(.01, crop[3] - crop[1]);
      if (sourceWidth > 0 && sourceHeight > 0) element.scaleY = Math.max(.02, Math.min(DESIGN_LIMITS.scaleMax, elementBounds(element).width * sourceHeight / sourceWidth / Math.max(.001, element.height)));
    }
  }));
  root.querySelectorAll('[data-scale-preset]').forEach(button => button.addEventListener('click', () => {
    const selected = selectedElement(), selectedId = selected?.id;
    const refreshImage = selected?.type === 'image' && selected.sourceDataUrl;
    const changed = commit(project => {
      const element = project.elements.find(item => item.id === state.selectedId); if (!element || element.locked) return;
      const value = Number(button.dataset.scalePreset); element.scaleX = value; element.scaleY = value;
    });
    if (changed && refreshImage) reprocessImportedImages('image scale preset', selectedId);
  }));
  root.querySelectorAll('[data-element-face]').forEach(button => button.addEventListener('click', () => {
    const face = button.dataset.elementFace;
    commit(project => { const element = project.elements.find(item => item.id === state.selectedId); if (element && !element.locked) element.face = face; });
    setCameraPreset(face === 'back' ? 'bottom' : 'top');
    toast(face === 'back'
      ? `${selectedElement()?.name || 'Object'} moved to the back · embedded flush in the first layer`
      : `${selectedElement()?.name || 'Object'} moved to the front face`);
  }));
  root.querySelector('[data-element-group]')?.addEventListener('change', event => commit(project => {
    const element = project.elements.find(item => item.id === state.selectedId);
    if (element && !element.locked) element.groupId = event.target.value || null;
  }));
  root.querySelectorAll('[data-element-color]').forEach(button => button.addEventListener('click', () => {
    const element = selectedElement(), colorSlot = Number(button.dataset.elementColor);
    if (!element || element.locked) return;
    if (element.type === 'image' && element.rasterKind === 'segment') { void recolorSegmentImage(element.id, colorSlot); return; }
    commit(project => { const target = project.elements.find(item => item.id === state.selectedId); if (target && target.type !== 'image') target.color = colorSlot; });
  }));
  $('#deleteElement')?.addEventListener('click', deleteSelected);
  $('#fitElement')?.addEventListener('click', fitSelectedInsideMedal);
  $('#centerElement')?.addEventListener('click', () => commit(project => { const element = project.elements.find(item => item.id === state.selectedId); if (element && !element.locked) { element.x = 0; element.y = 0; } }, { panel: state.panel === 'layers' }));
  $('#lockElement')?.addEventListener('click', () => commit(project => { const element = project.elements.find(item => item.id === state.selectedId); if (element) element.locked = !element.locked; }, { panel: state.panel === 'layers' }));
  $('#duplicateElement')?.addEventListener('click', duplicateSelected);
  $('#duplicateOtherSide')?.addEventListener('click', duplicateSelectedToOtherSide);
  root.querySelector('[data-manage-image-colors]')?.addEventListener('click', openGlobalSettings);
  root.querySelector('[data-remap-image]')?.addEventListener('click', () => reprocessImportedImages('image color remap', state.selectedId));
  root.querySelector('[data-edit-image]')?.addEventListener('click', () => openImageEditor(selectedElement()));
  root.querySelector('[data-reset-image-ratio]')?.addEventListener('click', () => commit(project => {
    const element = project.elements.find(item => item.id === state.selectedId);
    if (!element || element.type !== 'image' || element.locked) return;
    const crop = Array.isArray(element.imageSettings?.crop) ? element.imageSettings.crop : [0, 0, 1, 1];
    const sourceWidth = Number(element.sourceWidth || element.pixelWidth) * Math.max(.01, crop[2] - crop[0]);
    const sourceHeight = Number(element.sourceHeight || element.pixelHeight) * Math.max(.01, crop[3] - crop[1]);
    if (!(sourceWidth > 0 && sourceHeight > 0)) return;
    const currentBounds = elementBounds(element);
    const targetHeight = currentBounds.width * sourceHeight / sourceWidth;
    const intrinsicHeight = Math.max(.001, element.height);
    element.scaleY = Math.max(.02, Math.min(DESIGN_LIMITS.scaleMax, targetHeight / intrinsicHeight));
    element.lockAspect = true;
  }));
  $('#closeInspector')?.addEventListener('click', () => $('.inspector')?.classList.remove('mobile-open'));
}

function deleteSelected() {
  if (!state.selectedId) return;
  const selected = selectedElement();
  if (selected?.locked) { toast(`${selected.name} is locked`); return; }
  const removed = selected?.name || 'Element';
  commit(project => { project.elements = project.elements.filter(element => element.id !== state.selectedId); }, { panel: true });
  state.selectedId = state.project.elements.at(-1)?.id || null;
  renderAll({ panel: true });
  toast(`${removed} deleted`);
}

function duplicateSelected() {
  const original = selectedElement();
  if (!original) return;
  if (original.locked) { toast(`${original.name} is locked`); return; }
  const duplicate = structuredClone(original);
  duplicate.id = uid(original.type);
  duplicate.name = `${original.name} copy`;
  duplicate.x += 2;
  duplicate.y += 2;
  state.selectedId = duplicate.id;
  commit(project => project.elements.push(duplicate), { panel: state.panel === 'layers' });
  toast('Element duplicated');
}

function fitSelectedInsideMedal() {
  const element = selectedElement();
  if (!element || element.locked) return;
  let result = null;
  commit(project => {
    const target = project.elements.find(item => item.id === state.selectedId);
    if (!target) return;
    result = autoFitElementToFace(target);
    constrainElement(target);
  }, { panel: state.panel === 'layers' });
  toast(result?.fitted ? `${element.name} fitted safely inside the medal` : `${element.name} is already safely inside the medal`);
}

function duplicateSelectedToOtherSide() {
  const original = selectedElement();
  if (!original || original.locked) return;
  const duplicate = structuredClone(original);
  duplicate.id = uid(original.type);
  duplicate.face = original.face === 'back' ? 'front' : 'back';
  duplicate.name = `${original.name} · ${duplicate.face}`;
  duplicate.x = -original.x;
  enforceFlatBackArtwork(duplicate, state.project);
  state.selectedId = duplicate.id;
  commit(project => project.elements.push(duplicate), { panel: state.panel === 'layers' });
  setCameraPreset(duplicate.face === 'back' ? 'bottom' : 'top');
  toast(`${original.name} copied to the ${duplicate.face}`);
}

function checkStatus(checks) {
  if (checks.some(check => check.level === 'block')) return 'block';
  if (checks.some(check => check.level === 'warn')) return 'warn';
  return 'pass';
}

function exactManualColorChecks(result) {
  if (state.project.profile.colorSystem !== 'manual' || (!result?.sliceData?.columns && !result?.sliceData?.columnData)) return [];
  const layerHeight = state.project.profile.layerHeight;
  const layerCount = Math.max(1, Math.ceil(result.maxHeight / layerHeight));
  const usage = new Map();
  for (let columnIndex = 0; columnIndex < sliceColumnCount(result.sliceData); columnIndex += 1) {
    forEachSliceBand(result.sliceData, columnIndex, (z0, z1, slot) => {
      const first = Math.max(1, Math.floor(z0 / layerHeight) + 1);
      const last = Math.min(layerCount, Math.ceil(z1 / layerHeight));
      for (let layer = first; layer <= last; layer += 1) {
        const midpoint = (layer - .5) * layerHeight;
        if (midpoint >= z0 - 1e-6 && midpoint < z1 - 1e-6) {
          if (!usage.has(layer)) usage.set(layer, new Set());
          usage.get(layer).add(slot);
        }
      }
    });
  }
  const collision = [...usage.entries()].find(([, slots]) => slots.size > 1);
  if (collision) return [{ level: 'block', title: 'This layer needs more than one color at once', message: `Print layer ${collision[0]} contains ${collision[1].size} filament colors in different areas. Choose a multicolor printer system or redesign the colors as separate height bands.` }];
  const changes = [];
  let previous = null;
  for (const layer of [...usage.keys()].sort((a, b) => a - b)) {
    const slots = usage.get(layer);
    const current = slots.size === 1 ? [...slots][0] : null;
    if (current !== null && previous !== null && current !== previous) changes.push(layer);
    if (current !== null) previous = current;
  }
  return changes.length ? [{ level: 'warn', title: 'Manual filament swaps required', message: `The exact mesh changes filament before layer${changes.length === 1 ? '' : 's'} ${changes.slice(0, 8).join(', ')}${changes.length > 8 ? '…' : ''}. Add pauses at those physical layers and confirm them in your slicer.` }] : [];
}

function exactStockChecks(result) {
  if (!result?.meshes?.length) return [];
  const palette = getPalette(state.project, state.inventory);
  const volumeBySlot = new Map();
  for (const mesh of result.meshes) volumeBySlot.set(mesh.slot, (volumeBySlot.get(mesh.slot) || 0) + mesh.volumeMm3);
  const purgeShare = Math.max(0, volumeBySlot.size - 1) * 1.5 / Math.max(1, volumeBySlot.size);
  const checks = [];
  for (const [slot, volumeMm3] of volumeBySlot) {
    const filament = palette[slot];
    if (!filament) continue;
    if (filament.stockKnown === false) continue;
    const pieceGrams = volumeMm3 / 1000 * (filament.density || 1.24) + purgeShare;
    const required = pieceGrams * state.quantity * 1.08;
    const stock = Math.max(0, Number(filament.stockGrams) || 0);
    if (required > stock + .01) checks.push({ level: 'block', title: `Not enough ${filament.name} for ${state.quantity} medals`, message: `The exact mesh needs about ${required.toFixed(0)} g including purge and an 8% production reserve; local stock is ${stock.toFixed(0)} g.` });
    else if (required > stock * .8) checks.push({ level: 'warn', title: `${filament.name} stock is close to the order requirement`, message: `About ${required.toFixed(0)} g is reserved for ${state.quantity} medals from ${stock.toFixed(0)} g in stock.` });
  }
  return checks;
}

function renderChecks() {
  state.checks = buildChecks(state.project, state.inventory);
  const missingPaletteIds=state.project.paletteIds.filter(id=>!state.inventory.some(filament=>filament.id===id));
  if(missingPaletteIds.length)state.checks=state.checks.filter(check=>check.level!=='pass').concat({level:'block',title:'Filament palette is incomplete',message:`Replace the missing catalog ID${missingPaletteIds.length===1?'':'s'}: ${missingPaletteIds.join(', ')}.`});
  if (state.geometryRevision === state.viewerRevision && state.viewerResult?.diagnostics) {
    const diagnostics = state.viewerResult.diagnostics;
    const geometryChecks = [];
    state.checks = state.checks.filter(check => !['Same-layer colors need a multicolor system', 'Manual filament swaps required'].includes(check.title) && !/^Slot \d+ (is out of stock|has low stock)$/.test(check.title));
    if (diagnostics.ignoredUnsupported > 0) geometryChecks.push({ level: 'block', title: 'Artwork would print in the air', message: `Some artwork has no medal material beneath it. Move that artwork away from the hole or change its item order.` });
    if (diagnostics.detachedBaseShells > 0) geometryChecks.push({ level: 'block', title: 'Through-cut creates a loose piece', message: `The medal body is split into ${diagnostics.detachedBaseShells + 1} disconnected shells. Reshape the cut until the body remains one piece.` });
    if (diagnostics.regularizedBands > 0) {
      const volume = Number(diagnostics.regularizedVolumeMm3 || diagnostics.alteredVolumeMm3 || 0);
      const volumeNote = volume > 0 ? `, changing about ${volume.toFixed(2)} mm³` : '';
      geometryChecks.push({ level: diagnostics.regularizationBlocked ? 'block' : 'warn', title: diagnostics.regularizationBlocked ? 'Tiny touching details cannot be repaired safely' : 'Tiny touching details were made printable', message: `${diagnostics.regularizedBands} very small diagonal contact${diagnostics.regularizedBands === 1 ? ' was' : 's were'} adjusted by ${state.viewerResult.cell.toFixed(3)} mm${volumeNote}. Review those details in Print layers.` });
    }
    const failedValidations = (diagnostics.validations || []).filter(validation => !validation.valid);
    if (diagnostics.meshValidationFailed || failedValidations.length) geometryChecks.push({ level: 'block', title: 'The final 3D body is not closed', message: diagnostics.meshValidationMessage || `${failedValidations.length} color part${failedValidations.length === 1 ? '' : 's'} could not be made into a fully closed printable body. Simplify the affected artwork before export.` });
    geometryChecks.push(...exactManualColorChecks(state.viewerResult), ...exactStockChecks(state.viewerResult));
    if (geometryChecks.length) state.checks = state.checks.filter(check => check.level !== 'pass').concat(geometryChecks);
  }
  const status = checkStatus(state.checks);
  const blockers = state.checks.filter(check => check.level === 'block').length;
  const geometryBlockers = state.checks.filter(checkBlocksGeometryExport).length;
  const stockBlockers = blockers - geometryBlockers;
  const warnings = state.checks.filter(check => check.level === 'warn').length;
  const title = status === 'block' ? `${blockers} issue${blockers === 1 ? '' : 's'} to fix` : status === 'warn' ? `${warnings} improvement${warnings === 1 ? '' : 's'}` : 'Editor checks passed';
  $('#checkTitle').textContent = title;
  $('#checkSummary').textContent = status === 'block'
    ? geometryBlockers
      ? 'Printable geometry needs attention before print-file export.'
      : `${stockBlockers} stock issue${stockBlockers === 1 ? '' : 's'} affect this order; CAD downloads remain available.`
    : status === 'warn' ? 'Review these cautions before opening the file in your slicer.' : 'The editor found no current issues. Always verify the downloaded file in your slicer.';
  $('#checkOrb').className = `status-orb ${status}`;
  $('#footerOrb').className = `status-orb ${status}`;
  $('#footerStatus').textContent = status === 'block'
    ? localizedCount('issue', blockers)
    : status === 'warn'
      ? `${localizedCount('caution', warnings)} · ${localizedFixed(state.project.profile.nozzle, 1)} mm`
      : translateUi('Checks passed · verify in slicer');
  $('#issues').innerHTML = state.checks.slice(0, 3).map(check => `<button class="issue ${check.level}" data-issue-element="${escapeHtml(check.elementId || '')}" style="border:0;text-align:left;width:100%"><span>${check.level === 'block' ? '×' : check.level === 'warn' ? '!' : '✓'}</span><span><strong>${escapeHtml(check.title)}</strong>${escapeHtml(check.message)}</span></button>`).join('');
  $$('[data-issue-element]').forEach(issue => issue.addEventListener('click', () => {
    if (issue.dataset.issueElement) { state.selectedId = issue.dataset.issueElement; renderInspector(); drawMedal(); }
    showChecksDialog();
  }));
}

function renderPrice() {
  state.quote = calculateQuote(state.project, state.inventory, state.quantity, currentGeometryResult());
  $('#unitPrice').textContent = `Kč ${formatLocalizedNumber(state.quote.unit)}`;
  $('#totalPrice').textContent = `Kč ${formatLocalizedNumber(state.quote.total)}`;
}

function markOnboardingStep(step) {
  state.qaOnboardingSteps.add(step);
  renderOnboarding();
}

function resetOnboardingProgress() {
  state.qaOnboardingSteps.clear();
}

function restartOnboarding() {
  resetOnboardingProgress();
  removeLocalPreference('medalforge-onboarding-dismissed');
  state.onboardingDismissed = false;
}

function markLoadedDesignProgress(project = state.project) {
  state.qaOnboardingSteps.add('medal');
  if (project.elements.some(element => !element.hidden)) state.qaOnboardingSteps.add('operation');
  renderOnboarding();
}

function renderOnboarding() {
  const root = $('#quickStart');
  if (!root) return;
  if (state.onboardingDismissed || state.view !== '3d') { root.hidden = true; return; }
  const hasArtwork = state.project.elements.some(element => !element.hidden);
  const choseMedal = state.qaOnboardingSteps.has('medal');
  const hasOperation = state.qaOnboardingSteps.has('operation');
  const hasBack = state.project.elements.some(element => !element.hidden && element.face === 'back') || state.qaOnboardingSteps.has('skipBack');
  const inspected = state.qaOnboardingSteps.has('inspect');
  const exported = state.qaOnboardingSteps.has('export');
  const steps = [
    [choseMedal, 'Choose the body and ribbon attachment', 'Medal'],
    [hasArtwork, 'Add text, a symbol, image, or drawing', hasArtwork ? 'Done' : 'Add'],
    [hasOperation, 'Choose raised, recessed, flat color, or hole', hasOperation ? 'Done' : 'Select'],
    [hasBack, 'Add an optional flat-color design to the back', hasBack ? 'Done' : 'Back'],
    [inspected, 'Review the physical print layers and design checks', inspected ? 'Done' : 'Check'],
    [exported, 'Save a copy or download the recommended print file', exported ? 'Done' : 'Finish'],
  ];
  const nextIndex = steps.findIndex(step => !step[0]);
  const visible = nextIndex < 0 ? [[true, 'Your medal is ready for a final slicer check', 'Done']] : [steps[nextIndex]];
  root.querySelector(':scope > strong').textContent = nextIndex < 0 ? 'Your medal is ready' : `Next step ${nextIndex + 1} of ${steps.length}`;
  $('#quickStartSteps').innerHTML = visible.map(([done, label, action]) => `<li class="${done ? 'done' : ''}"><i>${done ? '✓' : nextIndex + 1}</i><span>${escapeHtml(label)}</span>${done ? '<button data-onboarding-action="5">Export</button>' : `<span class="quick-start-actions"><button data-onboarding-action="${nextIndex}">${nextIndex === 2 ? 'Choose surface' : action}</button>${nextIndex === 3 ? '<button data-onboarding-skip-back>Skip</button>' : ''}</span>`}</li>`).join('');
  $('[data-onboarding-skip-back]')?.addEventListener('click', () => { markOnboardingStep('skipBack'); toast('Back design skipped for this medal'); });
  root.hidden = false;
}

function activateOnboardingAction(index) {
  if (index === 0) { state.panel = 'medal'; renderAll({ panel: true }); if(window.innerWidth<=900)$('.side-panel')?.classList.add('mobile-open'); }
  else if (index === 1) { state.panel = 'create'; state.createTool = 'text'; renderAll({ panel: true }); if(window.innerWidth<=900)$('.side-panel')?.classList.add('mobile-open'); }
  else if (index === 2) { state.drawing.mode = 'select'; state.selectedId ||= state.project.elements.at(-1)?.id || null; renderAll(); }
  else if (index === 3) {
    state.drawing.face = 'back'; state.panel = 'create'; state.createTool = 'text'; setCameraPreset('bottom'); renderAll({ panel: true }); if(window.innerWidth<=900)$('.side-panel')?.classList.add('mobile-open');
    toast('Back-side artwork is automatically embedded flush into the first print layer');
  }
  else if (index === 4) {
    if (!state.inspectionOpen) $('#toggleInspectLayers')?.click();
    else { setView('3d'); setInspectionOpen(true, { focus: true }); }
  }
  else if (index === 5) showExportDialog();
}

function renderAll(options = {}) {
  const { panel = false, inspector = true } = options;
  $$('.tool').forEach(button => button.classList.toggle('active', button.dataset.panel === state.panel));
  if (document.activeElement !== $('#projectNameInput')) $('#projectNameInput').value = state.project.name;
  $('#diameterLabel').textContent = state.project.medal.shape === 'circle' ? `Ø ${state.project.medal.diameter} mm` : `${state.project.medal.width} × ${state.project.medal.height} mm`;
  $('#safeDetail').textContent = `≥ ${(state.project.profile.nozzle * 2.25).toFixed(2)} mm`;
  $$('[data-nozzle]').forEach(button => {
    const active = Number(button.dataset.nozzle) === state.project.profile.nozzle;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
  $('#hardenedNozzle').checked = Boolean(state.project.profile.hardened);
  if (document.activeElement !== $('#layerHeightInput')) $('#layerHeightInput').value = state.project.profile.layerHeight;
  $('#colorSystem').value = state.project.profile.colorSystem;
  $('#meshQuality').value = state.project.profile.meshQuality;
  const colorCountInput = $('#designColorCount');
  if (colorCountInput && document.activeElement !== colorCountInput) colorCountInput.value = state.project.paletteIds.length;
  if ($('#removeDesignColor')) $('#removeDesignColor').disabled = state.project.paletteIds.length <= 1;
  if ($('#addDesignColor')) $('#addDesignColor').disabled = state.project.paletteIds.length >= DESIGN_LIMITS.paletteSlots;
  $('#settingsSummary').textContent = `${localizedFixed(state.project.profile.nozzle, 1)} mm · ${localizedCount('color', state.project.paletteIds.length)}`;
  $('#printerDefaultsSummary').textContent = `${state.project.profile.nozzle.toFixed(1)} mm nozzle · ${state.project.profile.layerHeight.toFixed(2)} mm layers`;
  renderPalette();
  if (panel) renderToolPanel();
  if (inspector) renderInspector();
  refreshComputed(true);
  renderOnboarding();
  $('#undoButton').disabled = !state.history.length;
  $('#redoButton').disabled = !state.future.length;
  renderPushPullGizmo();
  renderTransformGizmo();
}

function refreshComputed(draw = true) {
  renderChecks();
  renderPrice();
  if (draw) drawMedal(); else drawMedal();
}

function viewMetrics() {
  if (state.view === '2d' && state.viewer && !modelCanvas.hidden) {
    const rect = canvas.getBoundingClientRect();
    const planeZ = state.drawing.face === 'back' ? medalBottomZ() : medalTopZ();
    const origin = state.viewer.designToScreen(0, 0, planeZ);
    const xUnit = state.viewer.designToScreen(1, 0, planeZ);
    const yUnit = state.viewer.designToScreen(0, 1, planeZ);
    if (origin && xUnit && yUnit && rect.width && rect.height) {
      const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
      const xScale = Math.hypot((xUnit.x - origin.x) * scaleX, (xUnit.y - origin.y) * scaleY);
      const yScale = Math.hypot((yUnit.x - origin.x) * scaleX, (yUnit.y - origin.y) * scaleY);
      const yDirection = Math.sign((yUnit.y - origin.y) * scaleY) || 1;
      return { cx: origin.x * scaleX, cy: origin.y * scaleY, pxPerMm: (xScale + yScale) / 2, ySign: yDirection };
    }
  }
  const loop = ['single', 'double'].includes(state.project.medal.loopStyle) ? state.project.medal.loopHeight : 0;
  const width = state.project.medal.width || state.project.medal.diameter;
  const height = state.project.medal.height || state.project.medal.diameter;
  const pxPerMm = Math.min((canvas.width - 180) / width, (canvas.height - 150) / (height + loop)) * state.zoom;
  return { cx: canvas.width / 2, cy: canvas.height / 2 + loop * pxPerMm * .18, pxPerMm, ySign: 1 };
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  const width = Math.max(320, Math.round(rect.width * pixelRatio));
  const height = Math.max(320, Math.round(rect.height * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  drawMedal();
}

function roundedRectPath(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function traceMedalFacePath(context, medal, scale, inset = 0) {
  const width = Math.max(.1, (medal.width || medal.diameter) - inset * 2) * scale;
  const height = Math.max(.1, (medal.height || medal.diameter) - inset * 2) * scale;
  const shape = medal.shape || 'circle';
  context.beginPath();
  if (shape === 'custom' && medal.outline?.length >= 3) {
    const points = inset > 0 ? offsetPolygon(medal.outline, inset) : medal.outline;
    points.forEach(([x, y], index) => {
      if (index) context.lineTo(x * scale, y * scale); else context.moveTo(x * scale, y * scale);
    });
    context.closePath();
  }
  else if (shape === 'circle' || shape === 'oval') context.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
  else if (shape === 'rounded') context.roundRect(-width / 2, -height / 2, width, height, Math.max(0, (medal.cornerRadius - inset) * scale));
  else {
    const points = presetMedalOutlinePoints(shape, width / scale, height / scale)
      || presetMedalOutlinePoints('shield', width / scale, height / scale);
    points.forEach(([x, y], index) => index ? context.lineTo(x * scale, y * scale) : context.moveTo(x * scale, y * scale));
    context.closePath();
  }
}

function drawBody(context, metrics, color, offsetY = 0) {
  const medal = state.project.medal;
  const scale = metrics.pxPerMm;
  context.save();
  context.translate(metrics.cx, metrics.cy + offsetY);
  context.fillStyle = color;
  traceMedalFacePath(context, medal, scale); context.fill();
  const attachment = medalAttachmentGeometry(state.project);
  if (attachment.external) {
    const outer = attachment.outer;
    roundedRectPath(context, outer.x0 * scale, outer.y0 * scale, outer.width * scale, outer.height * scale, outer.radius * scale); context.fill();
    context.globalCompositeOperation = 'destination-out';
    for (const aperture of attachment.apertures) {
      roundedRectPath(context, aperture.x0 * scale, aperture.y0 * scale, aperture.width * scale, aperture.height * scale, aperture.radius * scale); context.fill();
    }
    context.globalCompositeOperation = 'source-over';
  } else if (attachment.aperture) {
    context.globalCompositeOperation = 'destination-out';
    if (attachment.aperture.kind === 'circle') {
      context.beginPath(); context.arc(attachment.aperture.cx * scale, attachment.aperture.cy * scale, attachment.aperture.diameter / 2 * scale, 0, Math.PI * 2); context.fill();
    } else {
      roundedRectPath(context, attachment.aperture.x0 * scale, attachment.aperture.y0 * scale, attachment.aperture.width * scale, attachment.aperture.height * scale, attachment.aperture.height / 2 * scale); context.fill();
    }
    if (attachment.channel) context.fillRect(attachment.channel.x0 * scale, attachment.channel.y0 * scale, attachment.channel.width * scale, (attachment.channel.y1 - attachment.channel.y0) * scale);
    context.globalCompositeOperation = 'source-over';
  }
  context.restore();
}

function punchAttachmentPreview(context, metrics) {
  const attachment = medalAttachmentGeometry(state.project);
  if (!attachment.aperture || attachment.external) return;
  const scale = metrics.pxPerMm;
  context.save(); context.translate(metrics.cx, metrics.cy); context.globalCompositeOperation = 'destination-out'; context.fillStyle = '#000';
  if (attachment.aperture.kind === 'circle') {
    context.beginPath(); context.arc(attachment.aperture.cx * scale, attachment.aperture.cy * scale, attachment.aperture.diameter / 2 * scale, 0, Math.PI * 2); context.fill();
  } else {
    roundedRectPath(context, attachment.aperture.x0 * scale, attachment.aperture.y0 * scale, attachment.aperture.width * scale, attachment.aperture.height * scale, attachment.aperture.height / 2 * scale); context.fill();
  }
  if (attachment.channel) context.fillRect(attachment.channel.x0 * scale, attachment.channel.y0 * scale, attachment.channel.width * scale, (attachment.channel.y1 - attachment.channel.y0) * scale);
  context.restore();
}

function drawShapePath(context, kind, sizePx) {
  traceShapePath(context, kind, sizePx);
}

function ensureImage(source) {
  if (!source) return null;
  if (imageCache.has(source)) return imageCache.get(source);
  const image = new Image();
  image.onload = drawMedal;
  image.src = source;
  imageCache.set(source, image);
  return image;
}

function drawElement(context, element, metrics, palette) {
  const scale = metrics.pxPerMm;
  const ySign = metrics.ySign || 1;
  context.save();
  context.translate(metrics.cx + element.x * scale, metrics.cy + element.y * scale * ySign);
  context.scale(1, ySign);
  if (element.face === 'back') context.scale(1, -1);
  context.rotate((element.rotation || 0) * Math.PI / 180);
  context.scale(Number(element.scaleX) || 1, Number(element.scaleY) || 1);
  const operation = element.operation || 'raise';
  context.fillStyle = operation === 'engrave' ? 'rgba(5,10,8,.34)' : palette[element.color]?.color || palette[0].color;
  if (operation === 'cut') { context.globalCompositeOperation = 'destination-out'; context.fillStyle = '#000'; }
  if (operation === 'raise' && state.view === '2d') {
    const lift = Math.max(1, Math.min(8, (element.zHeight || .2) / state.project.profile.layerHeight));
    context.shadowColor = 'rgba(0,0,0,.34)'; context.shadowBlur = Math.min(7, 1.5 + lift * .45); context.shadowOffsetY = Math.min(5, 1 + lift * .4);
  } else if (operation === 'engrave') {
    context.shadowColor = 'rgba(255,255,255,.38)'; context.shadowBlur = 1; context.shadowOffsetY = 1.5;
  }
  if (element.type === 'text') {
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = `${element.weight || 800} ${element.fontSize * scale}px ${element.fontFamily || 'Arial'}`; context.fillText(element.text || '', 0, 0);
  } else if (element.type === 'shape') {
    drawShapePath(context, element.shape, element.size * scale); context.fill();
  } else if (element.type === 'image') {
    const image = ensureImage(element.dataUrl);
    if (image?.complete) { context.globalAlpha = operation === 'engrave' ? .42 : element.opacity ?? 1; context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.drawImage(image, -element.width/2*scale, -element.height/2*scale, element.width*scale, element.height*scale); }
  } else if (element.type === 'path') {
    context.beginPath(); element.points.forEach((point,index) => index ? context.lineTo(point[0]*element.scale*scale,point[1]*element.scale*scale) : context.moveTo(point[0]*element.scale*scale,point[1]*element.scale*scale));
    if (element.closed) { context.closePath(); context.fill(); } else { context.lineWidth = element.strokeWidth*scale; context.strokeStyle = context.fillStyle; context.lineCap='round'; context.lineJoin='round'; context.stroke(); }
  }
  context.restore();
}

function elementLocalFrame(element) {
  const bounds = elementBounds(element);
  let centerX = 0, centerY = 0;
  if (element.type === 'path' && element.points.length) {
    const xs = element.points.map(point => point[0] * element.scale * (Number(element.scaleX) || 1));
    const ys = element.points.map(point => point[1] * element.scale * (Number(element.scaleY) || 1));
    centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  return { ...bounds, centerX, centerY };
}

function drawSelection(context, metrics) {
  const element = selectedElement();
  if (!element || element.hidden || state.view !== '2d') return;
  const frame = elementLocalFrame(element);
  const scale = metrics.pxPerMm;
  const ySign = metrics.ySign || 1;
  const uiScale = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
  context.save();
  context.translate(metrics.cx + element.x*scale, metrics.cy + element.y*scale*ySign);
  context.scale(1, ySign);
  if (element.face === 'back') context.scale(1, -1);
  context.rotate((element.rotation || 0)*Math.PI/180);
  const x0 = (frame.centerX-frame.width/2)*scale-5*uiScale, y0 = (frame.centerY-frame.height/2)*scale-5*uiScale;
  const x1 = (frame.centerX+frame.width/2)*scale+5*uiScale, y1 = (frame.centerY+frame.height/2)*scale+5*uiScale;
  context.strokeStyle = element.locked ? '#9b8050' : '#315ff4'; context.lineWidth = 1.5*uiScale; context.setLineDash([5*uiScale,4*uiScale]);
  context.strokeRect(x0,y0,x1-x0,y1-y0);
  context.setLineDash([]);
  if (!element.locked) {
    context.beginPath(); context.moveTo((x0+x1)/2,y0); context.lineTo((x0+x1)/2,y0-18*uiScale); context.stroke();
    for (const [x,y,fill] of [[(x0+x1)/2,y0-18*uiScale,'#fff'],[x1,y1,'#315ff4']]) {
      context.beginPath(); context.arc(x,y,6*uiScale,0,Math.PI*2); context.fillStyle=fill; context.fill(); context.strokeStyle='#315ff4'; context.lineWidth=2*uiScale; context.stroke();
    }
  }
  context.restore();
}

function selectionHandleAt(point, metrics) {
  const element = selectedElement();
  if (!element || element.hidden || element.locked || state.view !== '2d') return null;
  const frame = elementLocalFrame(element);
  const angle = -(element.rotation || 0) * Math.PI / 180;
  const dx = point.x - element.x, dy = (point.y - element.y) * (element.face === 'back' ? -1 : 1);
  const local = { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
  const cssToInternal = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
  const pad = 5 / metrics.pxPerMm, rotateOffset = 18 / metrics.pxPerMm, tolerance = 11 * cssToInternal / metrics.pxPerMm;
  const resize = { x: frame.centerX + frame.width / 2 + pad, y: frame.centerY + frame.height / 2 + pad };
  const rotate = { x: frame.centerX, y: frame.centerY - frame.height / 2 - pad - rotateOffset };
  if (Math.hypot(local.x - rotate.x, local.y - rotate.y) <= tolerance) return 'rotate';
  if (Math.hypot(local.x - resize.x, local.y - resize.y) <= tolerance) return 'resize';
  return null;
}

function scaleElementFrom(element, original, ratioX, ratioY = ratioX, mode = 'resize-xy', uniformRatio = null) {
  let x = Math.max(.001, Number(ratioX) || 1);
  let y = Math.max(.001, Number(ratioY) || 1);
  if (original.lockAspect !== false) {
    const uniform = mode === 'resize-y' ? y : mode === 'resize-x' ? x : Math.max(.001, Number(uniformRatio) || Math.sqrt(Math.max(.000001, x * y)));
    x = uniform; y = uniform;
  } else {
    if (mode === 'resize-x') y = 1;
    if (mode === 'resize-y') x = 1;
  }
  element.scaleX = Math.max(.02, Math.min(DESIGN_LIMITS.scaleMax, (Number(original.scaleX) || 1) * x));
  element.scaleY = Math.max(.02, Math.min(DESIGN_LIMITS.scaleMax, (Number(original.scaleY) || 1) * y));
}

function clampArtworkPoint(point, strokeWidth = state.drawing.strokeWidth) {
  const inset = state.project.medal.edgeInset + state.project.medal.rimWidth + strokeWidth / 2 + .5;
  if (medalContainsPoint(state.project, point.x, point.y, inset)) return { ...point };
  const medal = state.project.medal;
  let anchor = medalContainsPoint(state.project, 0, 0, inset) ? { x: 0, y: 0 } : null;
  if (!anchor) {
    const step = Math.max(.5, state.project.profile.nozzle);
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let y = -medal.height / 2; y <= medal.height / 2; y += step) for (let x = -medal.width / 2; x <= medal.width / 2; x += step) {
      if (!medalContainsPoint(state.project, x, y, inset)) continue;
      const distance = (x - point.x) ** 2 + (y - point.y) ** 2;
      if (distance < bestDistance) { bestDistance = distance; anchor = { x, y }; }
    }
  }
  if (!anchor) return { x: 0, y: 0 };
  let last = anchor;
  for (let sample = 1; sample <= 64; sample += 1) {
    const ratio = sample / 64;
    const candidate = { x: anchor.x + (point.x - anchor.x) * ratio, y: anchor.y + (point.y - anchor.y) * ratio };
    if (medalContainsPoint(state.project, candidate.x, candidate.y, inset)) { last = candidate; continue; }
    let low = (sample - 1) / 64, high = ratio;
    for (let iteration = 0; iteration < 18; iteration += 1) {
      const mid = (low + high) / 2;
      const x = anchor.x + (point.x - anchor.x) * mid, y = anchor.y + (point.y - anchor.y) * mid;
      if (medalContainsPoint(state.project, x, y, inset)) { low = mid; last = { x, y }; } else high = mid;
    }
    break;
  }
  return last;
}

function transformedPathVertices(element) {
  if (element.type !== 'path') return [];
  const angle = (element.rotation || 0) * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return element.points.map(([x, y]) => {
    const sx = x * element.scale * (Number(element.scaleX) || 1);
    const sy = y * element.scale * (Number(element.scaleY) || 1);
    const rotatedX = sx * cosine - sy * sine, rotatedY = sx * sine + sy * cosine;
    return { x: element.x + rotatedX, y: element.y + rotatedY * (element.face === 'back' ? -1 : 1) };
  });
}

function snapCanvasPoint(point, event = {}, anchor = null, allowOutside = false) {
  let snapped = { ...point };
  if (anchor && event.shiftKey) {
    const dx = snapped.x - anchor.x, dy = snapped.y - anchor.y;
    const length = Math.hypot(dx, dy);
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * Math.PI / 12;
    snapped = { x: anchor.x + Math.cos(angle) * length, y: anchor.y + Math.sin(angle) * length };
  }
  if (state.drawing.snap && !event.altKey) {
    const metrics = viewMetrics();
    const cssScale = metrics.pxPerMm / Math.max(1, canvas.width / canvas.getBoundingClientRect().width);
    const threshold = Math.max(.2, 7 / Math.max(.1, cssScale));
    const grid = state.drawing.grid;
    snapped.x = Math.round(snapped.x / grid) * grid;
    snapped.y = Math.round(snapped.y / grid) * grid;
    if (Math.abs(snapped.x) <= threshold) snapped.x = 0;
    if (Math.abs(snapped.y) <= threshold) snapped.y = 0;
    const candidates = state.project.elements.filter(element => state.view !== '2d' || element.face === state.drawing.face).flatMap(transformedPathVertices);
    if (anchor) candidates.unshift(anchor);
    let nearest = null, nearestDistance = threshold;
    for (const candidate of candidates) {
      const distance = Math.hypot(snapped.x - candidate.x, snapped.y - candidate.y);
      if (distance < nearestDistance) { nearest = candidate; nearestDistance = distance; }
    }
    if (nearest) snapped = { ...nearest };
  }
  return allowOutside ? snapped : clampArtworkPoint(snapped);
}

function snapElementPosition(element, event, metrics) {
  state.alignmentGuides = null;
  if (!state.drawing.snap || event.altKey) return;
  const cssScale = metrics.pxPerMm / Math.max(1, canvas.width / canvas.getBoundingClientRect().width);
  const threshold = Math.max(.15, 7 / Math.max(.1, cssScale));
  const grid = state.drawing.grid;
  element.x = Math.round(element.x / grid) * grid;
  element.y = Math.round(element.y / grid) * grid;
  const others = state.project.elements.filter(item => item.id !== element.id && !item.hidden && (state.view !== '2d' || item.face === element.face));
  const xCandidates = [0, ...others.map(item => item.x)], yCandidates = [0, ...others.map(item => item.y)];
  const nearest = (value, candidates) => candidates.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best, Number.POSITIVE_INFINITY);
  const snapX = nearest(element.x, xCandidates), snapY = nearest(element.y, yCandidates);
  const guides = {};
  if (Number.isFinite(snapX) && Math.abs(snapX - element.x) <= threshold) { element.x = snapX; guides.x = snapX; }
  if (Number.isFinite(snapY) && Math.abs(snapY - element.y) <= threshold) { element.y = snapY; guides.y = snapY; }
  state.alignmentGuides = Object.keys(guides).length ? guides : null;
}

function drawAlignmentGuides(context, metrics) {
  if (!state.alignmentGuides || state.view !== '2d') return;
  const medal = state.project.medal, width = medal.width * metrics.pxPerMm, height = medal.height * metrics.pxPerMm;
  context.save(); context.translate(metrics.cx, metrics.cy); context.strokeStyle = '#e14c86'; context.lineWidth = Math.max(1, canvas.width / Math.max(1, canvas.getBoundingClientRect().width)); context.setLineDash([5, 4]);
  if (state.alignmentGuides.x !== undefined) { const x = state.alignmentGuides.x * metrics.pxPerMm; context.beginPath(); context.moveTo(x, -height / 2 - 18); context.lineTo(x, height / 2 + 18); context.stroke(); }
  if (state.alignmentGuides.y !== undefined) { const y = state.alignmentGuides.y * metrics.pxPerMm * (metrics.ySign || 1); context.beginPath(); context.moveTo(-width / 2 - 18, y); context.lineTo(width / 2 + 18, y); context.stroke(); }
  context.restore();
}

function drawWorldPath(context, points, metrics, options = {}) {
  if (!points.length) return;
  context.save();
  context.translate(metrics.cx, metrics.cy);
  context.beginPath();
  const ySign = metrics.ySign || 1;
  points.forEach((point, index) => index ? context.lineTo(point.x * metrics.pxPerMm, point.y * metrics.pxPerMm * ySign) : context.moveTo(point.x * metrics.pxPerMm, point.y * metrics.pxPerMm * ySign));
  if (options.closed) context.closePath();
  context.strokeStyle = options.color || '#315ff4';
  context.fillStyle = options.fill || 'rgba(49,95,244,.14)';
  context.lineWidth = Math.max(2, (options.width || state.drawing.strokeWidth) * metrics.pxPerMm);
  context.lineCap = 'round'; context.lineJoin = 'round';
  if (options.closed) context.fill();
  context.stroke();
  context.restore();
}

function drawDrawingOverlay(context, metrics) {
  if (state.view !== '2d') return;
  const drawing = state.drawing;
  const palette = getPalette(state.project, state.inventory);
  const color = palette[drawing.color]?.color || '#315ff4';
  const points = drawing.points.map(point => ({ x: point.x, y: point.y }));
  if (drawing.mode === 'brush' && drawing.active) drawWorldPath(context, points, metrics, { color, width: drawing.strokeWidth });
  if (drawing.mode === 'line' && drawing.active && drawing.hover) drawWorldPath(context, [points[0], drawing.hover], metrics, { color, width: drawing.strokeWidth });
  if (drawing.mode === 'polygon' && points.length) {
    const draft = drawing.hover ? [...points, drawing.hover] : points;
    drawWorldPath(context, draft, metrics, { color, width: Math.max(.25, drawing.strokeWidth * .35), closed: false });
    context.save(); context.translate(metrics.cx, metrics.cy);
    for (const point of points) { context.beginPath(); context.arc(point.x * metrics.pxPerMm, point.y * metrics.pxPerMm * (metrics.ySign || 1), 4, 0, Math.PI * 2); context.fillStyle = '#fff'; context.fill(); context.strokeStyle = color; context.lineWidth = 2; context.stroke(); }
    context.restore();
  }
  if (drawing.mode === 'erase' && drawing.erasedIds.size) {
    context.save(); context.globalAlpha = .58;
    for (const id of drawing.erasedIds) { const element = state.project.elements.find(item => item.id === id); if (!element) continue; const previous = element.color; const warningPalette = getPalette(state.project, state.inventory).map(item => ({ ...item, color: '#d34e4e' })); drawElement(context, { ...element, color: previous }, metrics, warningPalette); }
    context.restore();
  }
  const measurement = drawing.measurement || (drawing.mode === 'measure' && drawing.active && drawing.points[0] && drawing.hover ? { start: drawing.points[0], end: drawing.hover } : null);
  if (measurement) {
    drawWorldPath(context, [measurement.start, measurement.end], metrics, { color: '#1b211f', width: .18 });
    const dx = measurement.end.x - measurement.start.x, dy = measurement.end.y - measurement.start.y;
    const length = Math.hypot(dx, dy), angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const mid = { x: (measurement.start.x + measurement.end.x) / 2, y: (measurement.start.y + measurement.end.y) / 2 };
    context.save(); context.font = `700 ${Math.max(11, metrics.pxPerMm * 1.35)}px Segoe UI`; context.textAlign = 'center'; context.textBaseline = 'bottom';
    const label = `${length.toFixed(2)} mm · ${angle.toFixed(1)}°`; const tx = metrics.cx + mid.x * metrics.pxPerMm, ty = metrics.cy + mid.y * metrics.pxPerMm * (metrics.ySign || 1) - 6;
    const width = context.measureText(label).width + 12; context.fillStyle = 'rgba(255,255,255,.94)'; context.fillRect(tx - width / 2, ty - 18, width, 20); context.fillStyle = '#1b211f'; context.fillText(label, tx, ty); context.restore();
  }
}

function approximateMaxHeight() {
  const top = medalTopZ();
  let max = top + (state.project.medal.rimWidth > 0 ? state.project.medal.rimHeight : 0);
  let stacked = top;
  for (const element of state.project.elements) {
    if (element.hidden) continue;
    if (element.operation === 'raise') {
      if (element.face === 'back') continue;
      if (element.combine === 'stack') { stacked += element.zHeight; max = Math.max(max, stacked); }
      else if (element.face !== 'back') max = Math.max(max, top + element.zHeight);
    }
    if (element.operation === 'inlay' && element.face !== 'back') max = Math.max(max, top + element.inlayHeight);
  }
  return max;
}

function currentGeometryResult() {
  return state.geometryRevision === state.viewerRevision ? state.viewerResult : null;
}

function sliceColumnCount(sliceData) {
  return sliceData?.columns?.length ?? Math.max(0, (sliceData?.columnData?.offsets?.length || 1) - 1);
}

function forEachSliceBand(sliceData, index, callback) {
  if (sliceData?.columns) {
    for (const segment of sliceData.columns[index] || []) callback(segment.z0, segment.z1, segment.slot);
    return;
  }
  const packed = sliceData?.columnData;
  if (!packed?.offsets) return;
  for (let cursor = packed.offsets[index]; cursor < packed.offsets[index + 1]; cursor += 1) callback(packed.z0[cursor], packed.z1[cursor], packed.slots[cursor]);
}

function sliceSlotAt(sliceData, index, z, includeBottom = true) {
  let slot = -1;
  forEachSliceBand(sliceData, index, (z0, z1, candidate) => {
    if (slot < 0 && z >= z0 - (includeBottom ? 1e-7 : -1e-7) && z < z1 - 1e-7) slot = candidate;
  });
  return slot;
}

function renderLayerPreviewControls() {
  const slider = $('#sliceLayerSlider');
  if (!slider || !state.project) return;
  const result = currentGeometryResult();
  if (!result?.sliceData) {
    slider.disabled = true;
    $('#sliceLayerTitle').textContent = 'Compiling geometry…';
    $('#sliceLayerLabel').textContent = 'Please wait';
    $('#sliceStatus').textContent = 'Using the same local heightfield as 3D and export.';
    $('#sliceExactBadge').textContent = 'Building';
    return;
  }
  slider.disabled = false;
  $('#sliceExactBadge').textContent = 'Physical layer';
  const maxHeight = result.maxHeight;
  const maxLayers = Math.max(1, Math.ceil(maxHeight / state.project.profile.layerHeight));
  if (state.sliceLayer === null) state.sliceLayer = maxLayers;
  state.sliceLayer = Math.max(1, Math.min(maxLayers, state.sliceLayer));
  slider.max = String(maxLayers); slider.value = String(state.sliceLayer);
  const z = (state.sliceLayer - .5) * state.project.profile.layerHeight;
  $('#sliceLayerLabel').textContent = `${state.sliceLayer} / ${maxLayers} · Z ${z.toFixed(2)} mm`;
  const bottom = medalBottomZ(), top = medalTopZ();
  $('#sliceLayerTitle').textContent = z < bottom ? 'Back relief' : z <= top ? (z > top - .001 ? 'Base top' : 'Inside base') : 'Front relief';
  $('#sliceStatus').textContent = `${result.cell.toFixed(3)} mm preview detail · shows empty space, medal body and each filament`;
}

function buildExactSliceBitmap(result, layer) {
  const key = `${state.geometryRevision}|${layer}|${state.project.paletteIds.join('|')}`;
  if (state.sliceBitmap?.key === key) return state.sliceBitmap.canvas;
  const { bounds } = result.sliceData;
  if (sliceCanvas.width !== bounds.cols || sliceCanvas.height !== bounds.rows) {
    sliceCanvas.width = bounds.cols;
    sliceCanvas.height = bounds.rows;
  }
  const sliceContext = sliceCanvas.getContext('2d');
  const image = sliceContext.createImageData(bounds.cols, bounds.rows);
  const z = (layer - .5) * state.project.profile.layerHeight;
  const palette = getPalette(state.project, state.inventory).map(filament => hexToRgb(filament.color));
  for (let index = 0; index < sliceColumnCount(result.sliceData); index += 1) {
    const slot = sliceSlotAt(result.sliceData, index, z, false);
    if (slot < 0) continue;
    const color = palette[slot] || palette[0] || [70, 78, 74];
    const offset = index * 4;
    image.data[offset] = color[0]; image.data[offset + 1] = color[1]; image.data[offset + 2] = color[2]; image.data[offset + 3] = 255;
  }
  sliceContext.putImageData(image, 0, 0);
  state.sliceBitmap = { key, canvas: sliceCanvas };
  return sliceCanvas;
}

function drawExactSlice(context, metrics, result) {
  const { bounds, cell } = result.sliceData;
  const bitmap = buildExactSliceBitmap(result, state.sliceLayer || 1);
  context.save();
  context.translate(metrics.cx, metrics.cy);
  context.imageSmoothingEnabled = false;
  context.shadowColor = 'rgba(22,30,27,.18)'; context.shadowBlur = 18; context.shadowOffsetY = 8;
  context.drawImage(bitmap, bounds.minX * metrics.pxPerMm, bounds.minY * metrics.pxPerMm, bounds.cols * cell * metrics.pxPerMm, bounds.rows * cell * metrics.pxPerMm);
  context.shadowColor = 'transparent';
  context.restore();
}

function drawRimStylePreview(context, metrics, palette) {
  const medal = state.project.medal;
  const width = Math.max(0, Number(medal.rimWidth) || 0);
  if (!width) return;
  const px = metrics.pxPerMm;
  const color = palette[medal.rimColor]?.color || palette[medal.baseColor]?.color || palette[0]?.color || '#333';
  const style = medal.rimStyle || 'classic';
  const circumferencePx = Math.PI * (3 * ((medal.width + medal.height) * px / 2) - Math.sqrt(Math.max(1, (3 * medal.width + medal.height) * (medal.width + 3 * medal.height))) * px / 2);
  const strokeBand = (from, amount, options = {}) => {
    context.save();
    traceMedalFacePath(context, medal, px, medal.edgeInset + width * (from + amount / 2));
    context.strokeStyle = color;
    context.lineWidth = Math.max(1, width * amount * px);
    context.lineCap = options.cap || 'round';
    context.lineJoin = 'round';
    if (options.dashes) context.setLineDash(options.dashes);
    context.stroke();
    context.restore();
  };
  context.save();
  context.translate(metrics.cx, metrics.cy);
  if (style === 'double') {
    strokeBand(0, .34);
    strokeBand(.67, .33);
  } else if (style === 'scalloped') {
    const step = Math.max(width * px * 1.35, circumferencePx / 18);
    strokeBand(0, .82, { dashes: [Math.max(1, width * px * .42), Math.max(1, step - width * px * .42)] });
  } else if (style === 'faceted') {
    const step = Math.max(width * px * 1.4, circumferencePx / 18);
    strokeBand(0, 1, { cap: 'butt', dashes: [step * .89, step * .11] });
  } else if (style === 'laurel' || style === 'wings') {
    strokeBand(.87, .13);
    const halfW = Math.max(.1, (medal.width - (medal.edgeInset + width * .44) * 2) * px / 2);
    const halfH = Math.max(.1, (medal.height - (medal.edgeInset + width * .44) * 2) * px / 2);
    const featherCount = style === 'wings' ? 7 : 10;
    const start = style === 'wings' ? -1.02 : -.98;
    const end = style === 'wings' ? 1.02 : .98;
    context.fillStyle = color;
    for (const side of [-1, 1]) for (let index = 0; index < featherCount; index += 1) {
      const t = index / Math.max(1, featherCount - 1);
      const angle = side > 0 ? start + (end - start) * t : Math.PI - start - (end - start) * t;
      const x = Math.cos(angle) * halfW, y = Math.sin(angle) * halfH;
      context.save(); context.translate(x, y); context.rotate(angle + Math.PI / 2);
      const rx = width * px * (style === 'wings' ? .42 + .18 * Math.sin(t * Math.PI) : .34);
      const ry = width * px * (style === 'wings' ? 1.05 : .72);
      context.beginPath(); context.ellipse(0, 0, Math.max(1, rx), Math.max(1.2, ry), 0, 0, Math.PI * 2); context.fill(); context.restore();
    }
  } else strokeBand(0, 1);
  context.restore();
}

function updateCanvasEmptyVisibility(hasArtwork) {
  const prompt = $('#canvasEmpty');
  if (!prompt) return;
  const dismissed = Boolean(state.project?.id && state.canvasEmptyDismissedProjectId === state.project.id);
  prompt.hidden = Boolean(hasArtwork || dismissed);
}

function dismissCanvasEmpty() {
  if (!state.project?.id) return;
  state.canvasEmptyDismissedProjectId = state.project.id;
  try { setLocalPreference('medalforge-empty-card-dismissed-project', state.project.id); } catch {}
  $('#canvasEmpty').hidden = true;
  modelCanvas?.focus({ preventScroll: true });
}

function drawMedal() {
  if (!state.project) return;
  const metrics = viewMetrics();
  const palette = getPalette(state.project, state.inventory);
  const medal = state.project.medal;
  const halfWidth = medal.width / 2 * metrics.pxPerMm;
  const halfHeight = medal.height / 2 * metrics.pxPerMm;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.save();
  if (state.view === '2d' && state.viewer && !modelCanvas.hidden) {
    ctx.save();
    ctx.translate(metrics.cx, metrics.cy);
    ctx.scale(1, metrics.ySign || 1);
    traceMedalFacePath(ctx, medal, metrics.pxPerMm, medal.edgeInset + medal.rimWidth);
    ctx.fillStyle = 'rgba(46,104,255,.025)'; ctx.fill();
    ctx.setLineDash([7, 6]); ctx.strokeStyle = 'rgba(46,104,255,.5)'; ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    ctx.save(); ctx.globalAlpha = .42;
    for (const element of state.project.elements) if (!element.hidden && element.face === state.drawing.face) drawElement(ctx, element, metrics, palette);
    ctx.restore();
    drawAlignmentGuides(ctx, metrics);
    drawSelection(ctx, metrics);
    drawDrawingOverlay(ctx, metrics);
    ctx.restore();
    updateCanvasEmptyVisibility(state.project.elements.some(element => !element.hidden && element.face === state.drawing.face));
    const side = translateUiKey(state.drawing.face === 'back' ? 'stage.drawSideBack' : 'stage.drawSideFront');
    const drawHints = { select: translateUiKey('stage.drawSelectFace'), brush: translateUiKey('stage.drawOnFace', { side }), line: translateUiKey('stage.drawLine'), polygon: translateUiKey('stage.drawPolygon'), erase: translateUiKey('stage.drawErase'), measure: translateUiKey('stage.drawMeasure') };
    $('#stageHint').textContent = translateUiKey('stage.drawingHint', { hint: drawHints[state.drawing.mode], view: translateUiKey(state.drawing.face === 'back' ? 'stage.viewedBack' : 'stage.viewedFront'), finish: translateUiKey('stage.finishSketchOrbit') });
    return;
  }
  const exactResult = state.view === 'toolpath' ? currentGeometryResult() : null;
  if (exactResult?.sliceData) {
    drawExactSlice(ctx, metrics, exactResult);
    ctx.save(); ctx.globalCompositeOperation='source-atop'; ctx.translate(metrics.cx,metrics.cy); ctx.globalAlpha=.24; ctx.strokeStyle='#fff'; ctx.lineWidth=Math.max(1,state.project.profile.nozzle*metrics.pxPerMm*.38); const spacing=state.project.profile.nozzle*1.125*metrics.pxPerMm; for(let y=-halfHeight;y<halfHeight;y+=spacing){ctx.beginPath();ctx.moveTo(-halfWidth,y);ctx.lineTo(halfWidth,y);ctx.stroke();} ctx.restore();
    ctx.restore();
    $('#canvasEmpty').hidden = true;
    $('#stageHint').textContent = `Exact layer ${state.sliceLayer || 1} · ${(state.project.profile.nozzle*1.125).toFixed(2)} mm nominal extrusion width`;
    return;
  }
  if (state.view === '3d') {
    for (let offset=22;offset>=3;offset-=2) drawBody(ctx,metrics,'#111714',offset);
  }
  const sliceZ = null;
  const baseVisible = sliceZ === null || sliceZ <= medal.baseThickness + .0001;
  ctx.shadowColor='rgba(22,30,27,.25)'; ctx.shadowBlur=32; ctx.shadowOffsetY=15;
  if (baseVisible) drawBody(ctx,metrics,palette[medal.baseColor]?.color || palette[0].color,0);
  ctx.shadowColor='transparent';
  const rimVisible = sliceZ === null || (sliceZ > medal.baseThickness && sliceZ <= medal.baseThickness + medal.rimHeight + .0001);
  if (rimVisible || (sliceZ !== null && baseVisible)) {
    drawRimStylePreview(ctx, metrics, palette);
    ctx.save(); ctx.translate(metrics.cx,metrics.cy);
    if (sliceZ === null) {
      traceMedalFacePath(ctx, medal, metrics.pxPerMm, medal.edgeInset + medal.rimWidth + 1); ctx.strokeStyle='rgba(255,255,255,.25)'; ctx.lineWidth=1.2; ctx.stroke();
      traceMedalFacePath(ctx, medal, metrics.pxPerMm, medal.edgeInset + medal.rimWidth + 1.6); ctx.setLineDash([5,6]); ctx.strokeStyle='rgba(255,255,255,.35)'; ctx.lineWidth=1; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }
  punchAttachmentPreview(ctx, metrics);
  for (const element of state.project.elements) {
    if (element.hidden) continue;
    if (sliceZ === null) { drawElement(ctx,element,metrics,palette); continue; }
    if (element.operation === 'cut') drawElement(ctx, element, metrics, palette);
    else if (element.operation === 'engrave' && sliceZ > medal.baseThickness - element.zDepth) drawElement(ctx, { ...element, operation: 'cut' }, metrics, palette);
    else if (element.operation === 'inlay' && sliceZ > medal.baseThickness - element.zDepth && sliceZ <= medal.baseThickness + element.inlayHeight + .0001) drawElement(ctx, { ...element, operation: 'inlay' }, metrics, palette);
    else if (element.operation === 'raise' && sliceZ > medal.baseThickness && sliceZ <= medal.baseThickness + element.zHeight + .0001) drawElement(ctx, { ...element, operation: 'inlay' }, metrics, palette);
  }
  drawAlignmentGuides(ctx, metrics);
  drawSelection(ctx,metrics);
  drawDrawingOverlay(ctx, metrics);
  ctx.restore();
  updateCanvasEmptyVisibility(state.project.elements.some(element => !element.hidden));
  const drawHints = { select: translateUiKey('workspace.selectDrag'), brush: translateUiKey('stage.drawStroke'), line: translateUiKey('stage.drawSnappedLine'), polygon: translateUiKey('stage.drawPolygon'), erase: translateUiKey('stage.drawErase'), measure: translateUiKey('stage.drawMeasure') };
  const selected = selectedElement();
  $('#stageHint').textContent = state.view === '2d' ? drawHints[state.drawing.mode] : state.view === '3d' ? (state.pendingInsert ? translateUiKey('stage.pendingPlacement', { name: state.pendingInsert.label }) : selected ? translateUiKey(selected.face === 'back' ? 'stage.selectedBack' : 'stage.selectedFront', { name: selected.name }) : translateUiKey('stage.orbit')) : translateUi('Building exact printable layers on this device…');
}

function canvasPoint(event, metrics = viewMetrics()) {
  const rect = canvas.getBoundingClientRect();
  const px = (event.clientX-rect.left)/rect.width*canvas.width;
  const py = (event.clientY-rect.top)/rect.height*canvas.height;
  return { x:(px-metrics.cx)/metrics.pxPerMm, y:(py-metrics.cy)/metrics.pxPerMm * (metrics.ySign || 1) };
}

function pointHitsElement(element, point) {
  const angle = -(element.rotation || 0) * Math.PI / 180;
  const dx = point.x - element.x, dy = (point.y - element.y) * (element.face === 'back' ? -1 : 1);
  const x = dx * Math.cos(angle) - dy * Math.sin(angle), y = dx * Math.sin(angle) + dy * Math.cos(angle);
  const scaleX = Math.max(.001, Number(element.scaleX) || 1), scaleY = Math.max(.001, Number(element.scaleY) || 1);
  const localX = x / scaleX, localY = y / scaleY;
  if (element.type === 'path') {
    const local = [localX, localY];
    const points = element.points.map(([px, py]) => [px * element.scale, py * element.scale]);
    if (element.closed && pointInPolygon(local, points)) return true;
    const tolerance = (element.closed ? .35 : element.strokeWidth / 2) + .8 / Math.min(scaleX, scaleY);
    for (let segment = 1; segment < points.length; segment += 1) if (pointSegmentDistance(local, points[segment - 1], points[segment]) <= tolerance) return true;
    return Boolean(element.closed && points.length > 2 && pointSegmentDistance(local, points.at(-1), points[0]) <= tolerance);
  }
  if (element.type === 'shape') {
    const radius = Math.max(.01, Number(element.size) || 1) / 2;
    if (element.shape === 'circle') return (localX / radius) ** 2 + (localY / radius) ** 2 <= 1.12;
    if (element.shape === 'diamond') return Math.abs(localX) + Math.abs(localY) <= radius + 1 / Math.min(scaleX, scaleY);
    if (element.shape === 'hexagon') {
      const nx = Math.abs(localX) / radius, ny = Math.abs(localY) / radius;
      return nx <= 1.05 && ny <= .92 && nx * .5 + ny <= 1.08;
    }
  }
  const bounds = elementBounds({ ...element, x: 0, y: 0, scaleX: 1, scaleY: 1, face: 'front' });
  return Math.abs(localX) <= bounds.width / 2 + 1 / scaleX && Math.abs(localY) <= bounds.height / 2 + 1 / scaleY;
}

function pointHitsElementArtwork(element, point) {
  if (element?.type !== 'image' || element.rasterKind !== 'segment') return pointHitsElement(element, point);
  const result = currentGeometryResult(), bounds = result?.sliceData?.bounds, cell = result?.cell;
  const mask = result?.previewMasks?.find(item => item.elementId === element.id);
  const unchanged = mask && Math.abs(mask.x - element.x) < 1e-5 && Math.abs(mask.y - element.y) < 1e-5 && Math.abs(mask.rotation - (Number(element.rotation) || 0)) < 1e-5 && Math.abs(mask.scaleX - (Number(element.scaleX) || 1)) < 1e-5 && Math.abs(mask.scaleY - (Number(element.scaleY) || 1)) < 1e-5 && mask.face === element.face;
  if (!unchanged || !bounds || !Number.isFinite(cell) || !mask.indices?.length) return pointHitsElement(element, point);
  const col = Math.floor((point.x - bounds.minX) / cell), row = Math.floor((point.y - bounds.minY) / cell);
  if (col < 0 || row < 0 || col >= bounds.cols || row >= bounds.rows) return false;
  const target = row * bounds.cols + col;
  let low = 0, high = mask.indices.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1, value = mask.indices[middle];
    if (value === target) return true;
    if (value < target) low = middle + 1; else high = middle - 1;
  }
  return false;
}

function hitElement(point) {
  const visible = state.project.elements.filter(element => !element.hidden && (state.view !== '2d' || element.face === state.drawing.face));
  for (let index = visible.length - 1; index >= 0; index -= 1) if (pointHitsElementArtwork(visible[index], point)) return visible[index];
  return null;
}

function pickElementIn3D(clientX, clientY) {
  if (!state.viewer) return null;
  const result = currentGeometryResult();
  const ray = state.viewer.screenRay(clientX, clientY, { designSpace: true });
  const surface = result?.sliceData && ray ? raycastColumnField(result.sliceData, ray, { maxZ: result.maxHeight, clipZ: state.viewer.clipZ }) : null;
  const visible = state.project.elements.filter(element => !element.hidden);
  // A through-cut has no top triangle to raycast. Pick its editable sketch on
  // the corresponding design plane so holes remain as selectable as solids.
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const candidate = visible[index];
    if (candidate.operation !== 'cut' || !elementFaceTowardsCamera(candidate)) continue;
    const z = selectionSurfaceZ(candidate);
    const point = state.viewer.screenToDesignPlane(clientX, clientY, z);
    if (point && pointHitsElementArtwork(candidate, point)) return { element: candidate, point: { ...point, z }, z, surface };
  }
  if (surface) {
    let element = null;
    if (Math.abs(surface.normal[2]) > .7) {
      for (let index = visible.length - 1; index >= 0; index -= 1) {
        const candidate = visible[index];
        const hitBack = surface.normal[2] < 0;
        if ((candidate.face === 'back') !== hitBack) continue;
        if (!pointHitsElementArtwork(candidate, surface.point)) continue;
        const expected = selectionSurfaceZ(candidate);
        const recessed = candidate.operation === 'engrave' || candidate.operation === 'inlay';
        if (recessed || Math.abs(surface.point.z - expected) <= Math.max(result.cell * 2.2, .16)) { element = candidate; break; }
      }
    }
    return { element, point: surface.point, z: surface.point.z, surface };
  }
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const element = visible[index];
    const z = Math.max(.001, selectionSurfaceZ(element));
    const point = state.viewer.screenToDesignPlane(clientX, clientY, z);
    if (point && pointHitsElementArtwork(element, point)) return { element, point, z };
  }
  const facePoint = state.viewer.screenToDesignPlane(clientX, clientY, medalTopZ());
  return facePoint && medalContainsPoint(state.project, facePoint.x, facePoint.y, 0) ? { element: null, point: facePoint, z: medalTopZ() } : null;
}

function surfaceProbeText(hit) {
  if (!hit?.element) {
    if (hit?.surface?.face === 'bottom' || hit?.surface?.normal?.[2] < -.7) return `Bottom face <small>${hit.point.z.toFixed(2)} mm from the build plate</small>`;
    if (hit?.surface?.face === 'side') return `Medal side <small>${hit.point.z.toFixed(2)} mm high · color ${hit.surface.slot + 1}</small>`;
    return `Medal face <small>${(hit?.point?.z ?? medalTopZ()).toFixed(2)} mm from the build plate</small>`;
  }
  const element = hit.element;
  if (element.face === 'back') return `${escapeHtml(element.name)} · flat back color <small>${element.zDepth.toFixed(2)} mm color depth</small>`;
  if (element.operation === 'cut') return `${escapeHtml(element.name)} · through cut <small>${medalBottomZ().toFixed(2)}–${medalTopZ().toFixed(2)} mm</small>`;
  const side = element.face === 'back' ? 'back' : 'front';
  return `${escapeHtml(element.name)} · ${side} ${element.operation === 'inlay' ? 'flat color' : element.operation === 'engrave' ? 'recessed surface' : 'raised surface'} <small>${selectionSurfaceZ(element).toFixed(2)} mm from the build plate</small>`;
}

function updateSurfaceProbe(event, hit, moving = false) {
  const probe = $('#surfaceProbe');
  if (!probe) return;
  if (!hit) { probe.hidden = true; return; }
  const rect = $('#canvasWrap').getBoundingClientRect();
  probe.hidden = false;
  probe.classList.toggle('move', moving);
  probe.style.left = `${Math.max(0, Math.min(rect.width - 210, event.clientX - rect.left))}px`;
  probe.style.top = `${Math.max(0, Math.min(rect.height - 45, event.clientY - rect.top))}px`;
  probe.innerHTML = moving && hit.element
    ? `Move ${escapeHtml(hit.element.name)} <small>X ${hit.element.x.toFixed(2)} · Y ${hit.element.y.toFixed(2)} mm</small>`
    : surfaceProbeText(hit);
}

function elementPlacementFits(element) {
  const inset = state.project.medal.edgeInset + state.project.medal.rimWidth;
  return elementFitsSafeArea(state.project, element, inset);
}

function autoFitElementToFace(element) {
  const original = structuredClone(element);
  element.x = 0;
  element.y = 0;
  if (elementPlacementFits(element)) return { fitted: false, factor: 1 };
  const baseScaleX = Math.max(.02, Number(element.scaleX) || 1);
  const baseScaleY = Math.max(.02, Number(element.scaleY) || 1);
  let low = .02;
  let high = 1;
  let best = 0;
  for (let iteration = 0; iteration < 22; iteration += 1) {
    const factor = (low + high) / 2;
    element.scaleX = baseScaleX * factor;
    element.scaleY = baseScaleY * factor;
    if (elementPlacementFits(element)) { best = factor; low = factor; }
    else high = factor;
  }
  if (best <= 0) {
    Object.keys(element).forEach(key => delete element[key]);
    Object.assign(element, original);
    return { fitted: false, factor: 0 };
  }
  // Leave a small interaction margin so a centered object does not become
  // invalid from rounding or the first sub-millimetre pointer movement.
  const factor = Math.max(.02, best * .97);
  element.scaleX = baseScaleX * factor;
  element.scaleY = baseScaleY * factor;
  return { fitted: true, factor };
}

function constrainElement(element, fallback = null) {
  if (elementPlacementFits(element)) return true;
  if (fallback && elementPlacementFits(fallback)) {
    Object.keys(element).forEach(key => delete element[key]);
    Object.assign(element, structuredClone(fallback));
    return false;
  }
  const safe = clampArtworkPoint({ x: element.x, y: element.y }, 0);
  element.x = safe.x; element.y = safe.y;
  if (!elementPlacementFits(element)) {
    const medal = state.project.medal, step = Math.max(.5, state.project.profile.nozzle);
    let best = null, distance = Number.POSITIVE_INFINITY;
    for (let y = -medal.height / 2; y <= medal.height / 2; y += step) for (let x = -medal.width / 2; x <= medal.width / 2; x += step) {
      if (!elementPlacementFits({ ...element, x, y })) continue;
      const next = (x - element.x) ** 2 + (y - element.y) ** 2;
      if (next < distance) { distance = next; best = { x, y }; }
    }
    if (best) { element.x = best.x; element.y = best.y; }
  }
  return elementPlacementFits(element);
}

function cancelDrawing(refreshPanel = false) {
  const drawing = state.drawing;
  drawing.active = false; drawing.pointerId = null; drawing.points = []; drawing.hover = null; drawing.before = null; drawing.erasedIds = new Set();
  if (refreshPanel && state.panel === 'create' && state.createTool === 'draw') renderToolPanel();
  drawMedal();
}

function setDrawMode(mode) {
  if (!['select','brush','line','polygon','erase','measure'].includes(mode)) return;
  cancelDrawing(false);
  state.drawing.mode = mode;
  if (mode !== 'measure') state.drawing.measurement = null;
  setView('2d');
  state.panel = 'create';
  state.createTool = 'draw';
  renderToolPanel();
  renderAll();
}

function addPathElement(worldPoints, closed, name) {
  if (state.project.elements.length >= DESIGN_LIMITS.elements) { toast(`This design reached the safe ${DESIGN_LIMITS.elements}-object browser budget`); return false; }
  if ((!closed && worldPoints.length < 2) || (closed && worldPoints.length < 3)) return false;
  const normalized = normalizeDrawnPath(worldPoints.map(point => [point.x, point.y]));
  const element = { id: uid('path'), type: 'path', name, points: normalized.points, x: normalized.x, y: normalized.y, scale: 1, closed, strokeWidth: state.drawing.strokeWidth, rotation: 0, color: Math.min(state.drawing.color, state.project.paletteIds.length - 1), hidden: false, ...operationDefaults() };
  state.selectedId = element.id;
  commit(project => { project.elements.push(element); project.template = 'custom'; }, { panel: state.panel === 'layers' });
  return true;
}

function finishPolygon() {
  const points = state.drawing.points;
  if (points.length < 3) { toast('Add at least three polygon corners'); return; }
  const area = Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point.x * next.y - next.x * point.y; }, 0) / 2);
  if (area < .08) { toast('Polygon corners must enclose an area'); return; }
  if (addPathElement(points, true, 'Hand-drawn polygon')) toast('Printable polygon added');
  cancelDrawing(true);
}

function bindCanvas() {
  canvas.addEventListener('pointerdown', event => {
    if (state.view !== '2d' || event.button !== 0 || state.drawing.active) return;
    if (state.liveEdit) { toast('Press OK or Cancel before starting another edit'); return; }
    const drawing = state.drawing; const metrics = viewMetrics(); let point = canvasPoint(event, metrics);
    if (drawing.mode === 'polygon') {
      point = snapCanvasPoint(point, event, drawing.points.at(-1));
      if (drawing.points.length >= 3 && Math.hypot(point.x - drawing.points[0].x, point.y - drawing.points[0].y) < .8) { finishPolygon(); return; }
      drawing.points.push(point); drawing.hover = point; renderToolPanel(); drawMedal(); return;
    }
    if (drawing.mode === 'select') {
      const handle = selectionHandleAt(point, metrics);
      const active = selectedElement();
      if (handle && active) {
        const local = pointInElementTransformSpace(active, point);
        const startAngle = Math.atan2(local.y, local.x);
        state.drag = { id: active.id, kind: handle, start: point, startAngle, startDistance: Math.max(.01, Math.hypot(point.x - active.x, point.y - active.y)), original: structuredClone(active), lastValid: structuredClone(active), before: snapshot(), metrics, pointerId: event.pointerId };
        canvas.classList.add('dragging'); canvas.setPointerCapture(event.pointerId); return;
      }
      const hit = hitElement(point); state.selectedId = hit?.id || null; renderInspector(); drawMedal(); if (!hit) return;
      if (hit.locked) { toast(`${hit.name} is locked`); return; }
      state.drag = { id: hit.id, kind: 'move', start: point, originalX: hit.x, originalY: hit.y, lastValid: structuredClone(hit), before: snapshot(), metrics, pointerId: event.pointerId }; canvas.classList.add('dragging'); canvas.setPointerCapture(event.pointerId); return;
    }
    drawing.active = true; drawing.pointerId = event.pointerId; drawing.before = snapshot(); drawing.erasedIds = new Set(); drawing.measurement = drawing.mode === 'measure' ? null : drawing.measurement; drawing.metrics = metrics;
    if (drawing.mode === 'measure') point = snapCanvasPoint(point, event, null, true);
    else if (drawing.mode !== 'brush' && drawing.mode !== 'erase') point = snapCanvasPoint(point, event);
    else if (drawing.mode === 'brush') point = clampArtworkPoint(point);
    drawing.points = [point]; drawing.hover = point;
    if (drawing.mode === 'erase') { const hit = hitElement(point); if (hit && !hit.locked) drawing.erasedIds.add(hit.id); }
    canvas.setPointerCapture(event.pointerId); drawMedal();
  });
  canvas.addEventListener('pointermove', event => {
    const drawing = state.drawing;
    if (drawing.mode === 'polygon' && !drawing.active && drawing.points.length) { drawing.hover = snapCanvasPoint(canvasPoint(event), event, drawing.points.at(-1)); drawMedal(); return; }
    if (state.drag && state.drag.pointerId === event.pointerId) {
      const point = canvasPoint(event, state.drag.metrics); const element = state.project.elements.find(item => item.id === state.drag.id); if (!element) return;
      if (state.drag.kind === 'move') {
        element.x = state.drag.originalX + point.x - state.drag.start.x; element.y = state.drag.originalY + point.y - state.drag.start.y;
        snapElementPosition(element, event, state.drag.metrics);
      } else if (state.drag.kind === 'rotate') {
        const local = pointInElementTransformSpace(state.drag.original, point);
        const angle = Math.atan2(local.y, local.x);
        const delta = Math.atan2(Math.sin(angle - state.drag.startAngle), Math.cos(angle - state.drag.startAngle)) * 180 / Math.PI;
        const raw = state.drag.original.rotation + delta;
        element.rotation = event.shiftKey ? Math.round(raw / 15) * 15 : Math.round(raw * 10) / 10;
      } else if (state.drag.kind === 'resize') {
        const distance = Math.max(.01, Math.hypot(point.x - element.x, point.y - element.y));
        scaleElementFrom(element, state.drag.original, distance / state.drag.startDistance);
      }
      if (elementPlacementFits(element)) state.drag.lastValid = structuredClone(element);
      else constrainElement(element, state.drag.lastValid);
      drawMedal(); return;
    }
    if (!drawing.active || drawing.pointerId !== event.pointerId) return;
    const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
    for (const sample of samples) {
      let point = canvasPoint(sample, drawing.metrics);
      if (drawing.mode === 'brush') {
        point = clampArtworkPoint(point); const last = drawing.points.at(-1); const spacing = Math.max(.08, Math.min(drawing.strokeWidth * .15, .25)); if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= spacing) drawing.points.push(point);
      } else if (drawing.mode === 'erase') { const hit = hitElement(point); if (hit && !hit.locked) drawing.erasedIds.add(hit.id); }
      else point = snapCanvasPoint(point, sample, drawing.points[0], drawing.mode === 'measure');
      drawing.hover = point;
    }
    drawMedal();
  });
  canvas.addEventListener('pointerup', event => {
    if (state.drag && state.drag.pointerId === event.pointerId) {
      const drag = state.drag, before=drag.before, changed=before!==snapshot();state.drag=null;state.alignmentGuides=null;canvas.classList.remove('dragging');
      if(changed){const element=state.project.elements.find(item=>item.id===drag.id);commitPlanarEdit('2d-transform',before,drag.id,element?`${drag.kind === 'move' ? 'Moved' : drag.kind === 'rotate' ? 'Rotated' : 'Scaled'} ${element.name}`:'Object transformed');}else drawMedal();
      return;
    }
    const drawing = state.drawing; if (!drawing.active || drawing.pointerId !== event.pointerId) return;
    const mode = drawing.mode, points = [...drawing.points], end = drawing.hover;
    drawing.active = false; drawing.pointerId = null;
    if (mode === 'brush') {
      const simplified = simplifyPolyline(points.map(point => [point.x, point.y]), Math.max(.05, Math.min(drawing.strokeWidth * .08, .2))).map(([x,y]) => ({x,y}));
      if (simplified.length >= 2 && Math.hypot(simplified[0].x - simplified.at(-1).x, simplified[0].y - simplified.at(-1).y) >= .15 && addPathElement(simplified, false, 'Hand-drawn stroke')) toast('Printable brush stroke added');
      else toast('Drag farther to create a stroke');
    } else if (mode === 'line' && end && Math.hypot(points[0].x - end.x, points[0].y - end.y) >= .15) { if (addPathElement([points[0], end], false, 'Hand-drawn line')) toast('Printable line added'); }
    else if (mode === 'erase' && drawing.erasedIds.size) { const ids = new Set(drawing.erasedIds); commit(project => { project.elements = project.elements.filter(element => !ids.has(element.id)); }, { panel: true }); state.selectedId = null; toast(`${ids.size} element${ids.size === 1 ? '' : 's'} erased`); }
    else if (mode === 'measure' && end) drawing.measurement = { start: points[0], end };
    drawing.points = []; drawing.hover = null; drawing.erasedIds = new Set(); drawMedal();
  });
  canvas.addEventListener('pointercancel', event => {
    if (state.drag?.pointerId === event.pointerId) { state.project = normalizeProject(JSON.parse(state.drag.before)); state.drag = null; state.alignmentGuides = null; canvas.classList.remove('dragging'); renderAll({ panel: true }); }
    if (state.drawing.pointerId === event.pointerId) cancelDrawing(state.panel === 'create' && state.createTool === 'draw');
  });
}

const MODAL_FOCUS_SELECTOR = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function focusableModalElements(root) {
  return root ? [...root.querySelectorAll(MODAL_FOCUS_SELECTOR)].filter(element => !element.hidden && element.getClientRects().length > 0) : [];
}

function trapModalFocus(event, root) {
  if (event.key !== 'Tab' || !root || root.hidden) return false;
  const focusable = focusableModalElements(root);
  if (!focusable.length) { event.preventDefault(); root.focus?.(); return true; }
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus(); return true; }
  if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); return true; }
  return false;
}

function setCustomModalBackgroundInert(activeModal) {
  const shell = $('.app-shell');
  if (!shell) return;
  [...shell.children].forEach(child => { child.inert = Boolean(activeModal && child !== activeModal); });
}

function openDialog(eyebrow,title,html, context = '') {
  if (state.dialogCleanup) {
    const cleanup = state.dialogCleanup;
    state.dialogCleanup = null;
    cleanup();
  }
  if (!dialog.open) state.dialogReturnFocus = document.activeElement;
  dialog.dataset.context = context;
  $('#dialogEyebrow').textContent=eyebrow; $('#dialogTitle').textContent=title; $('#dialogBody').innerHTML=html;
  // The shared modal is reused by setup, export, guides, and Render Studio.
  // Reset retained scroll offsets so every newly opened workflow begins at its
  // title instead of appearing clipped at the position of the previous one.
  $('#dialogBody').scrollTop = 0;
  dialog.scrollTop = 0;
  localizeSubtree(dialog);
  if(!dialog.open)dialog.showModal();
  requestAnimationFrame(() => dialog.querySelector('[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])')?.focus());
}
function closeDialog(){
  if (state.exportJob) {
    state.exportJob.cancelled = true;
    state.exportJob.abortController?.abort();
    state.exportJob.worker?.terminate();
  }
  if (state.dialogCleanup) {
    const cleanup = state.dialogCleanup;
    state.dialogCleanup = null;
    cleanup();
  }
  if(dialog.open)dialog.close();
  delete dialog.dataset.context;
  if (state.dialogReturnFocus?.isConnected) state.dialogReturnFocus.focus();
  state.dialogReturnFocus = null;
}

function renderStudioText(key, variables = {}) {
  return translateUiKey(`renderStudio.${key}`, variables);
}

function renderStudioLightDirection(settings) {
  const azimuth = Number(settings.light.azimuth) * Math.PI / 180;
  const elevation = Number(settings.light.elevation) * Math.PI / 180;
  const horizontal = Math.cos(elevation);
  return [horizontal * Math.cos(azimuth), horizontal * Math.sin(azimuth), Math.sin(elevation)];
}

function viewerMaterialFromFilament(filament, settings) {
  const material = deriveFilamentRenderMaterial(filament, settings);
  const albedo = settings.mode === 'glow'
    ? (material.flags.glow ? .42 : .1)
    : settings.mode === 'dark'
      ? (material.flags.glow ? .82 : .58)
      : 1;
  return {
    emissionColor: material.emissionColor,
    emission: material.emissionStrength * .62,
    specular: material.specular,
    shininess: 12 + (1 - material.roughness) * 82,
    sparkle: material.sparkle,
    pattern: Math.max(material.woodGrain, material.carbonWeave, material.thermoShift),
    surfaceEffect: material.woodGrain ? 2 : material.carbonWeave ? 3 : material.thermoShift ? 4 : 0,
    albedo,
  };
}

function applyViewerRenderAppearance(viewer, settings, palette) {
  const normalized = normalizeRenderSettings(settings);
  const light = normalized.light;
  viewer.setRenderScene({
    background: '#000000',
    transparent: true,
    lightDirection: renderStudioLightDirection(normalized),
    ambient: light.ambient,
    key: light.intensity * .62,
    fill: light.intensity * (.12 + light.softness * .28),
    rim: .04 + light.intensity * (.06 + light.softness * .08),
    exposure: normalized.exposure,
  });
  viewer.setMaterials(palette.map((filament, slot) => [slot, viewerMaterialFromFilament(filament, normalized)]));
  return normalized;
}

function renderBackgroundCss(background) {
  if (background.transparent) return '';
  return `radial-gradient(circle at 44% 31%, ${background.topColor} 0%, ${background.topColor} 18%, ${background.bottomColor} 100%)`;
}

function renderStudioPresetMarkup(id, title, description, disabled = false) {
  return `<label class="render-preset-card ${disabled ? 'disabled' : ''}" data-preset="${id}"><input type="radio" name="renderPreset" value="${id}" ${id === 'studio' ? 'checked' : ''} ${disabled ? `disabled aria-describedby="renderGlowUnavailable"` : ''}><i aria-hidden="true"></i><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></label>`;
}

function renderStudioMarkup(palette, hasGlow) {
  const materials = palette.map(filament => {
    const effect = filament.effect || filament.material || renderStudioText('solid');
    return `<div class="render-material-line"><i style="background:${escapeHtml(filament.color)}"></i><strong data-i18n-ignore>${escapeHtml(filament.name)}</strong><em data-i18n-ignore>${escapeHtml(effect)}</em></div>`;
  }).join('');
  const glowMessage = hasGlow ? renderStudioText('glowReady') : renderStudioText('glowUnavailable');
  return `<div class="render-studio-intro"><p class="dialog-lede" id="renderStudioDescription">${escapeHtml(renderStudioText('intro'))}</p><span class="render-studio-local">${escapeHtml(renderStudioText('localOnly'))}</span></div>
    <div class="render-studio" id="renderStudio">
      <section class="render-studio-stage" aria-label="${escapeHtml(renderStudioText('previewRegion'))}">
        <div class="render-preview-shell" id="renderStudioCanvasHost" data-background="studio-light" data-ground-shadow="true">
          <div class="render-preview-topline"><span class="render-scene-badge"><b id="renderSceneName">${escapeHtml(renderStudioText('studio'))}</b><small id="renderSceneMode">${escapeHtml(renderStudioText('accurateColors'))}</small></span><span class="render-resolution-badge" id="renderResolutionBadge">2048 × 2048 PNG</span></div>
          <div class="render-glow-note" id="renderGlowNote" hidden>${escapeHtml(renderStudioText('glowSimulation'))}</div>
          <div class="render-camera-bar" role="group" aria-label="${escapeHtml(renderStudioText('cameraViews'))}">
            <button type="button" class="active" data-render-camera="iso">${escapeHtml(renderStudioText('camera3d'))}</button>
            <button type="button" data-render-camera="top">${escapeHtml(renderStudioText('cameraFront'))}</button>
            <button type="button" data-render-camera="bottom">${escapeHtml(renderStudioText('cameraBack'))}</button>
            <button type="button" data-render-camera="front">${escapeHtml(renderStudioText('cameraEdge'))}</button>
            <button type="button" data-render-camera="right">${escapeHtml(renderStudioText('cameraSide'))}</button>
          </div>
        </div>
        <div class="render-studio-helpbar"><span><strong>${escapeHtml(renderStudioText('dragToRotate'))}</strong> · ${escapeHtml(renderStudioText('zoomHelp'))}</span><button type="button" id="renderFit">${escapeHtml(renderStudioText('fitMedal'))}</button></div>
      </section>
      <aside class="render-studio-controls" aria-label="${escapeHtml(renderStudioText('controls'))}">
        <div class="render-controls-scroll">
          <fieldset class="render-control-group" id="renderPresetGroup"><legend>${escapeHtml(renderStudioText('chooseLook'))}<small>${escapeHtml(renderStudioText('chooseLookHelp'))}</small></legend>
            <div class="render-preset-grid">
              ${renderStudioPresetMarkup('daylight', renderStudioText('daylight'), renderStudioText('daylightHelp'))}
              ${renderStudioPresetMarkup('studio', renderStudioText('studio'), renderStudioText('studioHelp'))}
              ${renderStudioPresetMarkup('dark', renderStudioText('dark'), renderStudioText('darkHelp'))}
              ${renderStudioPresetMarkup('glow', renderStudioText('glow'), renderStudioText('glowHelp'), !hasGlow)}
            </div>
            <p class="render-export-status" id="renderGlowUnavailable">${escapeHtml(glowMessage)}</p>
            <div class="render-material-summary">${materials}</div>
          </fieldset>
          <fieldset class="render-control-group"><legend>${escapeHtml(renderStudioText('background'))}</legend><div class="render-background-grid">
            ${[
              ['warm-white', 'warm', renderStudioText('warm')], ['studio-light', 'neutral', renderStudioText('neutral')],
              ['graphite', 'charcoal', renderStudioText('graphite')], ['midnight', 'midnight', renderStudioText('midnight')],
              ['transparent', 'transparent', renderStudioText('transparent')],
            ].map(([value, visual, label]) => `<label class="render-background-choice" data-background-choice="${visual}"><input type="radio" name="renderBackground" value="${value}" ${value === 'studio-light' ? 'checked' : ''}><i aria-hidden="true"></i><span>${escapeHtml(label)}</span></label>`).join('')}
          </div><label class="render-slider"><span>${escapeHtml(renderStudioText('customBackground'))}</span><output id="renderBackgroundHex">#dfe5e1</output><input id="renderBackgroundColor" type="color" value="#dfe5e1"></label></fieldset>
          <fieldset class="render-control-group"><legend>${escapeHtml(renderStudioText('sceneDetails'))}</legend>
            <label class="render-toggle"><input id="renderRibbon" type="checkbox" ${state.project.medal.loopStyle === 'none' ? 'disabled' : 'checked'}><span>${escapeHtml(renderStudioText('showRibbon'))}<small>${escapeHtml(renderStudioText('ribbonHelp'))}</small></span></label>
            <label class="render-slider"><span>${escapeHtml(renderStudioText('ribbonColor'))}</span><output id="renderRibbonHex">${escapeHtml(state.ribbonPreviewColor)}</output><input id="renderRibbonColor" type="color" value="${escapeHtml(state.ribbonPreviewColor)}" ${state.project.medal.loopStyle === 'none' ? 'disabled' : ''}></label>
            <label class="render-toggle"><input id="renderGroundShadow" type="checkbox" checked><span>${escapeHtml(renderStudioText('groundShadow'))}<small>${escapeHtml(renderStudioText('groundShadowHelp'))}</small></span></label>
          </fieldset>
          <details class="render-fine-tune"><summary>${escapeHtml(renderStudioText('fineTune'))}</summary>
            <label class="render-slider"><span>${escapeHtml(renderStudioText('brightness'))}</span><output id="renderBrightnessValue">100%</output><input id="renderBrightness" type="range" min="50" max="170" step="1" value="100"></label>
            <label class="render-slider"><span>${escapeHtml(renderStudioText('lightDirection'))}</span><output id="renderLightAngleValue">−32°</output><input id="renderLightAngle" type="range" min="-180" max="180" step="1" value="-32"></label>
            <label class="render-slider"><span>${escapeHtml(renderStudioText('glowStrength'))}</span><output id="renderGlowStrengthValue">100%</output><input id="renderGlowStrength" type="range" min="0" max="250" step="5" value="100" ${hasGlow ? '' : 'disabled'}></label>
          </details>
          <fieldset class="render-control-group"><legend>${escapeHtml(renderStudioText('imageSize'))}<small>${escapeHtml(renderStudioText('imageSizeHelp'))}</small></legend><div class="render-output-grid">
            <label>${escapeHtml(renderStudioText('resolution'))}<select id="renderResolution"><option value="1024">1024 px · ${escapeHtml(renderStudioText('quick'))}</option><option value="2048" selected>2048 px · ${escapeHtml(renderStudioText('recommended'))}</option><option value="3072">3072 px · ${escapeHtml(renderStudioText('large'))}</option></select></label>
            <label>${escapeHtml(renderStudioText('format'))}<select id="renderAspect"><option value="1:1">${escapeHtml(renderStudioText('square'))} · 1:1</option><option value="5:4">${escapeHtml(renderStudioText('landscape'))} · 5:4</option><option value="4:5">${escapeHtml(renderStudioText('portrait'))} · 4:5</option><option value="16:9">${escapeHtml(renderStudioText('wide'))} · 16:9</option></select></label>
          </div></fieldset>
          <div class="render-comparison" id="renderComparison" hidden></div>
        </div>
        <div class="render-actions"><button class="button primary" type="button" id="renderDownload">${escapeHtml(renderStudioText('downloadPng'))}</button><div class="render-actions-secondary"><button type="button" id="renderCompareDownload">${escapeHtml(renderStudioText('lightDarkImage'))}</button><button type="button" id="renderViewsDownload">${escapeHtml(renderStudioText('fourViewSheet'))}</button></div><output class="render-export-status" id="renderExportStatus" role="status">${escapeHtml(renderStudioText('ready'))}</output></div>
      </aside>
    </div>`;
}

function updateRenderStudioPresentation(session) {
  if (!session || session.closed) return;
  session.settings = applyViewerRenderAppearance(session.viewer, session.settings, session.palette);
  const shell = $('#renderStudioCanvasHost');
  const background = session.settings.background;
  const visualBackground = {
    'warm-white': 'warm', 'studio-light': 'neutral', graphite: 'charcoal', midnight: 'midnight', transparent: 'transparent',
  }[background.id] || 'custom';
  shell.dataset.background = visualBackground;
  shell.dataset.groundShadow = String(session.groundShadow && !background.transparent);
  shell.style.background = visualBackground === 'custom' ? renderBackgroundCss(background) : '';
  shell.style.setProperty('--render-shadow-opacity', String(session.settings.shadowStrength));
  const nameKey = { daylight: 'daylight', studio: 'studio', dark: 'dark', glow: 'glow' }[session.settings.presetId] || 'studio';
  $('#renderSceneName').textContent = renderStudioText(nameKey);
  $('#renderSceneMode').textContent = renderStudioText(session.settings.mode === 'glow' ? 'simulatedGlow' : session.settings.mode === 'dark' ? 'lowLight' : 'accurateColors');
  $('#renderGlowNote').hidden = !session.hasGlow || !['dark', 'glow'].includes(session.settings.mode);
  const size = normalizeRenderExportSize({ resolution: Number($('#renderResolution')?.value) || 2048, aspect: $('#renderAspect')?.value || '1:1' });
  $('#renderResolutionBadge').textContent = `${size.width} × ${size.height} PNG`;
  const backgroundKey = { 'warm-white': 'warm', 'studio-light': 'neutral', graphite: 'graphite', midnight: 'midnight', transparent: 'transparent' }[background.id];
  const backgroundLabel = backgroundKey ? renderStudioText(backgroundKey) : background.topColor.toUpperCase();
  $('#renderStudioDescription').textContent = renderStudioText('currentDescription', { look: renderStudioText(nameKey), background: backgroundLabel });
  session.viewer.setDecorMeshes(buildRibbonPreviewMeshes({ visible: session.ribbonVisible, color: session.ribbonColor, lengthScale: .58 }));
  session.viewer.render();
}

function fitRenderStudioCamera(session) {
  session.viewer.fit();
  // The editor uses deliberately generous CAD framing. Product renders should
  // make the medal the subject while still retaining the optional ribbon.
  session.viewer.distance = session.viewer.size * 1.08;
  session.viewer.render();
}

function setRenderStudioCamera(session, preset) {
  session.viewer.setPreset(preset);
  if (preset === 'iso') {
    session.viewer.azimuth = -.78;
    session.viewer.elevation = .90;
  }
  fitRenderStudioCamera(session);
}

function syncRenderStudioControls(session) {
  if (!session || session.closed) return;
  $$('input[name="renderPreset"]').forEach(input => { input.checked = input.value === session.settings.presetId; });
  $$('input[name="renderBackground"]').forEach(input => { input.checked = input.value === session.settings.background.id; });
  $('#renderBrightness').value = String(Math.round(session.settings.exposure * 100));
  $('#renderBrightnessValue').textContent = `${Math.round(session.settings.exposure * 100)}%`;
  $('#renderLightAngle').value = String(session.settings.light.azimuth);
  $('#renderLightAngleValue').textContent = `${session.settings.light.azimuth > 0 ? '+' : ''}${Math.round(session.settings.light.azimuth)}°`;
  $('#renderGlowStrength').value = String(Math.round(session.settings.glowStrength * 100));
  $('#renderGlowStrengthValue').textContent = `${Math.round(session.settings.glowStrength * 100)}%`;
  updateRenderStudioPresentation(session);
}

function renderCanvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(renderStudioText('imageFailed'))), 'image/png'));
}

async function imageFromBlob(blob) {
  if (globalThis.createImageBitmap) return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error(renderStudioText('imageFailed'))); image.src = url; });
    return image;
  } finally { URL.revokeObjectURL(url); }
}

async function composeRenderImage(modelBlob, settings, size, { groundShadow = true } = {}) {
  const output = document.createElement('canvas');
  output.width = size.width; output.height = size.height;
  const context = output.getContext('2d');
  if (!settings.background.transparent) {
    const gradient = context.createLinearGradient(0, 0, 0, size.height);
    gradient.addColorStop(0, settings.background.topColor);
    gradient.addColorStop(1, settings.background.bottomColor);
    context.fillStyle = gradient; context.fillRect(0, 0, size.width, size.height);
    if (groundShadow) {
      context.save();
      context.filter = `blur(${Math.max(8, Math.round(size.width * .018))}px)`;
      context.globalAlpha = settings.shadowStrength * .5;
      context.fillStyle = '#07100c';
      context.beginPath(); context.ellipse(size.width * .5, size.height * .76, size.width * .23, size.height * .035, 0, 0, Math.PI * 2); context.fill();
      context.restore();
    }
  }
  const image = await imageFromBlob(modelBlob);
  if (settings.mode === 'glow' && settings.bloom > 0 && !settings.background.transparent) {
    // A pair of local additive blurs approximates the halo that charged glow
    // pigment creates in a dark room. Because non-glow slots are deliberately
    // dimmed in this scene, the effect remains tied to emissive filament.
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.globalAlpha = Math.min(.62, settings.bloom * .34);
    context.filter = `blur(${Math.max(7, Math.round(size.width * .009 * settings.bloom))}px)`;
    context.drawImage(image, 0, 0, size.width, size.height);
    context.globalAlpha *= .55;
    context.filter = `blur(${Math.max(16, Math.round(size.width * .019 * settings.bloom))}px)`;
    context.drawImage(image, 0, 0, size.width, size.height);
    context.restore();
  }
  context.drawImage(image, 0, 0, size.width, size.height);
  image.close?.();
  return renderCanvasBlob(output);
}

async function captureRenderStudioImage(session, settings = session.settings, size = null) {
  const normalized = applyViewerRenderAppearance(session.viewer, settings, session.palette);
  const outputSize = size || normalizeRenderExportSize({ resolution: Number($('#renderResolution')?.value) || 2048, aspect: $('#renderAspect')?.value || '1:1' });
  const modelBlob = await session.viewer.toPngBlob({ width: outputSize.width, height: outputSize.height });
  return composeRenderImage(modelBlob, normalized, outputSize, { groundShadow: session.groundShadow });
}

async function composeImageGrid(entries, columns = 2, rows = 2, cellSize = 1024) {
  const output = document.createElement('canvas');
  output.width = columns * cellSize; output.height = rows * cellSize;
  const context = output.getContext('2d');
  context.fillStyle = '#f2f4f0'; context.fillRect(0, 0, output.width, output.height);
  for (let index = 0; index < entries.length; index += 1) {
    const x = index % columns * cellSize, y = Math.floor(index / columns) * cellSize;
    const image = await imageFromBlob(entries[index].blob);
    context.drawImage(image, x, y, cellSize, cellSize); image.close?.();
    context.fillStyle = 'rgba(15,22,19,.78)'; context.fillRect(x + 18, y + cellSize - 66, Math.min(cellSize - 36, 260), 42);
    context.fillStyle = '#ffffff'; context.font = '700 24px Arial'; context.textBaseline = 'middle'; context.fillText(entries[index].label, x + 34, y + cellSize - 45);
  }
  return renderCanvasBlob(output);
}

function setRenderExportBusy(session, busy, message, error = false) {
  if (session.closed) return;
  ['renderDownload', 'renderCompareDownload', 'renderViewsDownload'].forEach(id => { const button = $(`#${id}`); if (button) button.disabled = busy; });
  const status = $('#renderExportStatus');
  status.textContent = message; status.classList.toggle('error', error);
}

async function runRenderStudioExport(session, task) {
  if (!session || session.busy) return;
  session.busy = true;
  setRenderExportBusy(session, true, renderStudioText('rendering'));
  try {
    await task();
    if (!session.closed) setRenderExportBusy(session, false, renderStudioText('downloadReady'));
  } catch (error) {
    console.error(error);
    if (!session.closed) setRenderExportBusy(session, false, renderStudioText('renderFailed', { message: error.message }), true);
  } finally {
    session.busy = false;
    if (session.closed) {
      session.viewer.restoreScene(session.editorScene);
      updateRibbonPreview();
      updateLayerPreview();
    } else updateRenderStudioPresentation(session);
  }
}

function bindRenderStudio(session) {
  $$('input[name="renderPreset"]').forEach(input => input.addEventListener('change', event => {
    session.settings = normalizeRenderSettings(event.target.value);
    syncRenderStudioControls(session);
  }));
  $$('input[name="renderBackground"]').forEach(input => input.addEventListener('change', event => {
    session.settings = normalizeRenderSettings({ ...session.settings, background: event.target.value });
    updateRenderStudioPresentation(session);
  }));
  $('#renderBackgroundColor').addEventListener('input', event => {
    $('#renderBackgroundHex').textContent = event.target.value.toUpperCase();
    session.settings = normalizeRenderSettings({ ...session.settings, background: event.target.value });
    updateRenderStudioPresentation(session);
  });
  $('#renderBrightness').addEventListener('input', event => {
    session.settings = normalizeRenderSettings({ ...session.settings, exposure: Number(event.target.value) / 100 });
    $('#renderBrightnessValue').textContent = `${event.target.value}%`; updateRenderStudioPresentation(session);
  });
  $('#renderLightAngle').addEventListener('input', event => {
    session.settings = normalizeRenderSettings({ ...session.settings, lightAzimuth: Number(event.target.value) });
    $('#renderLightAngleValue').textContent = `${Number(event.target.value) > 0 ? '+' : ''}${event.target.value}°`; updateRenderStudioPresentation(session);
  });
  $('#renderGlowStrength').addEventListener('input', event => {
    session.settings = normalizeRenderSettings({ ...session.settings, glowStrength: Number(event.target.value) / 100 });
    $('#renderGlowStrengthValue').textContent = `${event.target.value}%`; updateRenderStudioPresentation(session);
  });
  $('#renderGroundShadow').addEventListener('change', event => { session.groundShadow = event.target.checked; updateRenderStudioPresentation(session); });
  $('#renderRibbon').addEventListener('change', event => { session.ribbonVisible = event.target.checked; updateRenderStudioPresentation(session); fitRenderStudioCamera(session); });
  $('#renderRibbonColor').addEventListener('input', event => { session.ribbonColor = event.target.value; $('#renderRibbonHex').textContent = event.target.value.toUpperCase(); updateRenderStudioPresentation(session); });
  $('#renderResolution').addEventListener('change', () => updateRenderStudioPresentation(session));
  $('#renderAspect').addEventListener('change', () => { updateRenderStudioPresentation(session); requestAnimationFrame(() => session.viewer.resize()); });
  $$('[data-render-camera]').forEach(button => button.addEventListener('click', () => {
    setRenderStudioCamera(session, button.dataset.renderCamera);
    $$('[data-render-camera]').forEach(item => item.classList.toggle('active', item === button));
  }));
  $('#renderFit').addEventListener('click', () => fitRenderStudioCamera(session));
  $('#renderDownload').addEventListener('click', () => runRenderStudioExport(session, async () => {
    const blob = await captureRenderStudioImage(session);
    downloadBlob(blob, `${safeFilename(state.project.name)}-${session.settings.presetId}-render.png`);
  }));
  $('#renderCompareDownload').addEventListener('click', () => runRenderStudioExport(session, async () => {
    const size = normalizeRenderExportSize({ resolution: 1024, aspect: '1:1' });
    const daylight = normalizeRenderSettings('daylight');
    const night = normalizeRenderSettings(session.hasGlow ? 'glow' : 'dark');
    const entries = [
      { label: renderStudioText('daylight'), blob: await captureRenderStudioImage(session, daylight, size) },
      { label: renderStudioText(session.hasGlow ? 'glow' : 'dark'), blob: await captureRenderStudioImage(session, night, size) },
    ];
    const comparison = await composeImageGrid(entries, 2, 1, 1024);
    session.comparisonUrls.forEach(url => URL.revokeObjectURL(url)); session.comparisonUrls = [];
    const comparisonElement = $('#renderComparison');
    comparisonElement.hidden = false;
    comparisonElement.innerHTML = entries.map(entry => { const url = URL.createObjectURL(entry.blob); session.comparisonUrls.push(url); return `<figure><img src="${url}" alt="${escapeHtml(entry.label)}"><figcaption>${escapeHtml(entry.label)}</figcaption></figure>`; }).join('');
    downloadBlob(comparison, `${safeFilename(state.project.name)}-light-dark.png`);
  }));
  $('#renderViewsDownload').addEventListener('click', () => runRenderStudioExport(session, async () => {
    const camera = session.viewer.cameraState();
    const size = normalizeRenderExportSize({ resolution: 1024, aspect: '1:1' });
    const views = [['iso', renderStudioText('camera3d')], ['top', renderStudioText('cameraFront')], ['bottom', renderStudioText('cameraBack')], ['front', renderStudioText('cameraEdge')]];
    const entries = [];
    try {
      for (const [preset, label] of views) {
        setRenderStudioCamera(session, preset);
        entries.push({ label, blob: await captureRenderStudioImage(session, session.settings, size) });
      }
    } finally { session.viewer.restoreCamera(camera); }
    downloadBlob(await composeImageGrid(entries), `${safeFilename(state.project.name)}-four-views.png`);
  }));
}

async function openRenderStudio() {
  if (!state.project) return;
  if (state.view !== '3d') setView('3d');
  cancelPlacement();
  setInspectionOpen(false, { mark: false });
  const trigger = $('#savePreview');
  trigger.disabled = true;
  try {
    await ensure3DModel();
    if (!state.viewer || !state.viewerResult?.meshes?.length) throw new Error(renderStudioText('modelNotReady'));
    const palette = getPalette(state.project, state.inventory);
    const hasGlow = palette.some(filament => classifyFilamentEffect(filament).flags.glow);
    openDialog('MedalForge', renderStudioText('title'), renderStudioMarkup(palette, hasGlow), 'render-studio');
    dialog.classList.add('render-studio-dialog');
    const originalParent = modelCanvas.parentNode;
    const originalNextSibling = modelCanvas.nextSibling;
    const editorScene = state.viewer.sceneState();
    const session = {
      viewer: state.viewer, palette, hasGlow, editorScene, originalParent, originalNextSibling,
      settings: normalizeRenderSettings('studio'), groundShadow: true,
      ribbonVisible: state.project.medal.loopStyle !== 'none', ribbonColor: state.ribbonPreviewColor,
      comparisonUrls: [], busy: false, closed: false,
    };
    state.renderStudio = session;
    $('#renderStudioCanvasHost').prepend(modelCanvas);
    modelCanvas.hidden = false;
    session.viewer.setGrid(false); session.viewer.setExplode(0); session.viewer.setClipZ(1e6);
    session.viewer.setSectionMeshes([]); session.viewer.clearProxyMeshes(); session.viewer.clearHoverSurface();
    bindRenderStudio(session);
    syncRenderStudioControls(session);
    setRenderStudioCamera(session, 'iso');
    state.dialogCleanup = () => {
      session.closed = true;
      session.comparisonUrls.forEach(url => URL.revokeObjectURL(url));
      if (session.originalNextSibling?.parentNode === session.originalParent) session.originalParent.insertBefore(modelCanvas, session.originalNextSibling);
      else session.originalParent.append(modelCanvas);
      modelCanvas.style.removeProperty('background');
      session.viewer.restoreScene(session.editorScene);
      updateRibbonPreview();
      requestAnimationFrame(() => session.viewer.resize());
      dialog.classList.remove('render-studio-dialog');
      if (state.renderStudio === session) state.renderStudio = null;
    };
  } catch (error) {
    toast(renderStudioText('renderFailed', { message: error.message }), { error: true });
  } finally { trigger.disabled = false; }
}

function guideTranscriptMarkup(guide) {
  return `<ol>${guide.transcript.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ol>`;
}

function guidePlayerMarkup(guide) {
  return `<div class="guide-video-frame">
    <video id="guideVideo" controls playsinline preload="metadata" poster="${escapeHtml(guideAssetUrl(guide.poster))}" aria-labelledby="guideCurrentTitle" aria-describedby="guideOutcome guideMediaStatus">
      <source id="guideVideoSource" src="${escapeHtml(guideAssetUrl(guide.video))}" type="video/mp4">
      <track id="guideVideoCaptions" src="${escapeHtml(guideAssetUrl(guide.captions))}" kind="captions" srclang="en" label="English">
      Your browser cannot play this guide. Use the written transcript below or restart the interactive guide.
    </video>
  </div>`;
}

function activateGuideChapter(guideId, { announce = true } = {}) {
  const guide = GUIDE_LIBRARY.find(item => item.id === guideId) || GUIDE_LIBRARY[0];
  const video = $('#guideVideo');
  const source = $('#guideVideoSource');
  const captions = $('#guideVideoCaptions');
  if (!video || !source || !captions) return;

  video.pause();
  video.poster = guideAssetUrl(guide.poster);
  source.src = guideAssetUrl(guide.video);
  captions.src = guideAssetUrl(guide.captions);
  $('#guideCurrentTitle').textContent = guide.title;
  $('#guideOutcome').textContent = guide.outcome;
  $('#guideDuration').textContent = guideDurationLabel(guide.durationSeconds);
  $('#guideDuration').dateTime = `PT${guide.durationSeconds}S`;
  $('#guideTranscript').innerHTML = guideTranscriptMarkup(guide);
  const status = $('#guideMediaStatus');
  if (status) status.textContent = announce ? `${guide.title} selected. Press play when you are ready.` : 'Press play when you are ready.';
  $$('[data-guide-chapter]').forEach(button => {
    const active = button.dataset.guideChapter === guide.id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
  });
  video.load();
}

function openGuideLibrary(initialGuideId = 'overview') {
  const initialGuide = GUIDE_LIBRARY.find(guide => guide.id === initialGuideId) || GUIDE_LIBRARY[0];
  const chapters = GUIDE_LIBRARY.map((guide, index) => `<button type="button" class="guide-chapter ${guide.id === initialGuide.id ? 'active' : ''}" data-guide-chapter="${escapeHtml(guide.id)}" aria-current="${guide.id === initialGuide.id ? 'true' : 'false'}" tabindex="${guide.id === initialGuide.id ? '0' : '-1'}">
    <span class="guide-chapter-number">${String(index + 1).padStart(2, '0')}</span>
    <span><strong>${escapeHtml(guide.title)}</strong><small>${escapeHtml(guide.outcome)}</small></span>
    <time datetime="PT${guide.durationSeconds}S">${guideDurationLabel(guide.durationSeconds)}</time>
  </button>`).join('');

  openDialog('Learn MedalForge', 'Quick guides', `<section class="guide-library" aria-label="Short MedalForge video guides">
    <p class="dialog-lede guide-library-lede">Eight focused guides show the real editor, real buttons, and a complete printable-medal workflow. Every video is under 30 seconds and has English captions.</p>
    <div class="guide-library-layout">
      <nav class="guide-chapters" aria-label="Choose a guide chapter">${chapters}</nav>
      <section class="guide-player" aria-labelledby="guideCurrentTitle">
        ${guidePlayerMarkup(initialGuide)}
        <div class="guide-player-copy" aria-live="polite">
          <div class="guide-player-kicker"><span>Now showing</span><time id="guideDuration" datetime="PT${initialGuide.durationSeconds}S">${guideDurationLabel(initialGuide.durationSeconds)}</time></div>
          <h3 id="guideCurrentTitle">${escapeHtml(initialGuide.title)}</h3>
          <p id="guideOutcome">${escapeHtml(initialGuide.outcome)}</p>
          <p class="guide-media-status" id="guideMediaStatus" role="status">Press play when you are ready.</p>
          <details class="guide-transcript"><summary>Read the steps</summary><div id="guideTranscript">${guideTranscriptMarkup(initialGuide)}</div></details>
        </div>
      </section>
    </div>
    <div class="dialog-actions guide-library-actions">
      <button class="button secondary" type="button" id="restartInteractiveGuide">Restart interactive guide</button>
      <button class="button primary" type="button" id="guideStartNewMedal">Start a new medal</button>
    </div>
  </section>`);
  dialog.classList.add('guide-library-dialog');

  const video = $('#guideVideo');
  const status = $('#guideMediaStatus');
  const handleReady = () => {
    if (!status || !Number.isFinite(video.duration)) return;
    status.textContent = video.duration < 30
      ? `Ready · ${guideDurationLabel(Math.round(video.duration))}`
      : 'This guide is unavailable because it exceeds the 30-second guide limit.';
  };
  const handleError = () => {
    if (status) status.textContent = 'The video could not load. You can still read the steps or restart the interactive guide.';
  };
  video.addEventListener('loadedmetadata', handleReady);
  video.addEventListener('error', handleError);

  const chapterButtons = $$('[data-guide-chapter]');
  chapterButtons.forEach(button => button.addEventListener('click', () => activateGuideChapter(button.dataset.guideChapter)));
  $('.guide-chapters')?.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = Math.max(0, chapterButtons.findIndex(button => button.getAttribute('aria-current') === 'true'));
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? chapterButtons.length - 1
        : (currentIndex + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + chapterButtons.length) % chapterButtons.length;
    chapterButtons[nextIndex].click();
    chapterButtons[nextIndex].focus();
  });
  $('#restartInteractiveGuide')?.addEventListener('click', () => {
    closeDialog();
    restartOnboarding();
    setView('3d');
    renderOnboarding();
    $('#quickStart')?.querySelector('[data-onboarding-action]')?.focus();
  });
  $('#guideStartNewMedal')?.addEventListener('click', () => { closeDialog(); openNewDesignWizard(); });

  state.dialogCleanup = () => {
    video.removeEventListener('loadedmetadata', handleReady);
    video.removeEventListener('error', handleError);
    video.pause();
    video.removeAttribute('poster');
    $('#guideVideoSource')?.removeAttribute('src');
    $('#guideVideoCaptions')?.removeAttribute('src');
    video.load();
    dialog.classList.remove('guide-library-dialog');
  };
}

function templatePreviewMarkup(key, info = GALLERY_TEMPLATE_INFO[key]) {
  return `<span class="template-preview ${escapeHtml(info.className || key)}" aria-hidden="true">${escapeHtml(info.preview || '＋')}</span>`;
}

function projectForGalleryKey(key) {
  return CURATED_EXAMPLE_INFO[key] ? createCuratedExample(key) : createTemplateProject(key);
}

function galleryProjectFacts(project) {
  const medal = project.medal;
  const size = medal.shape === 'circle' ? `Ø ${medal.diameter} mm` : `${medal.width} × ${medal.height} mm`;
  const rim = RIM_STYLE_INFO[medal.rimStyle]?.label || 'Clean edge';
  return [`${projectUsedSlots(project).length} colors`, size, rim, 'Front + back'];
}

function galleryCardMarkup(key) {
  const info = GALLERY_TEMPLATE_INFO[key];
  const project = projectForGalleryKey(key);
  const selected = state.project.template === key || state.project.template === CURATED_EXAMPLE_INFO[key]?.template;
  return `<button type="button" class="template-card premium-template-card ${selected ? 'selected' : ''}" data-gallery-template="${escapeHtml(key)}" aria-pressed="${selected}">
    <canvas class="template-render" width="360" height="290" data-gallery-preview="${escapeHtml(key)}" aria-hidden="true"></canvas>
    <span class="template-card-copy"><span class="gallery-card-kicker">Polished editable example</span><strong>${escapeHtml(info.label)}</strong><small>${escapeHtml(info.meta)}</small><span class="gallery-card-facts">${galleryProjectFacts(project).map(fact => `<i>${escapeHtml(fact)}</i>`).join('')}</span></span>
    <span class="template-use">Open design</span>
  </button>`;
}

function drawGalleryAttachment(context, metrics, project, palette) {
  const attachment = medalAttachmentGeometry(project);
  if (!attachment.external || project.medal.attachmentColor === null || project.medal.attachmentColor === undefined) return;
  const px = metrics.pxPerMm;
  const color = palette[project.medal.attachmentColor]?.color;
  if (!color) return;
  context.save();
  context.translate(metrics.cx, metrics.cy);
  context.fillStyle = color;
  roundedRectPath(context, attachment.outer.x0 * px, attachment.outer.y0 * px, attachment.outer.width * px, attachment.outer.height * px, attachment.outer.radius * px);
  context.fill();
  context.globalCompositeOperation = 'destination-out';
  for (const aperture of attachment.apertures) {
    roundedRectPath(context, aperture.x0 * px, aperture.y0 * px, aperture.width * px, aperture.height * px, aperture.radius * px);
    context.fill();
  }
  context.restore();
}

function renderGalleryProject(canvasElement, project) {
  const context = canvasElement.getContext('2d');
  const medal = project.medal;
  const externalHeight = ['single', 'double'].includes(medal.loopStyle) ? medal.loopHeight : 0;
  const pxPerMm = Math.min((canvasElement.width - 58) / medal.width, (canvasElement.height - 54) / (medal.height + externalHeight));
  const metrics = { cx: canvasElement.width / 2, cy: canvasElement.height / 2 + externalHeight * pxPerMm * .2, pxPerMm, ySign: 1 };
  const previousProject = state.project;
  const previousView = state.view;
  state.project = project;
  state.view = '3d';
  try {
    const palette = getPalette(project, state.inventory);
    const background = context.createLinearGradient(0, 0, 0, canvasElement.height);
    background.addColorStop(0, '#f8f8f4');
    background.addColorStop(1, '#e3e6df');
    context.fillStyle = background;
    context.fillRect(0, 0, canvasElement.width, canvasElement.height);
    context.save();
    context.shadowColor = 'rgba(18, 24, 21, .26)';
    context.shadowBlur = 18;
    context.shadowOffsetY = 10;
    for (let offset = 14; offset >= 3; offset -= 2) drawBody(context, metrics, '#121816', offset);
    drawBody(context, metrics, palette[medal.baseColor]?.color || palette[0]?.color || '#202a2f');
    context.restore();
    drawGalleryAttachment(context, metrics, project, palette);
    drawRimStylePreview(context, metrics, palette);
    punchAttachmentPreview(context, metrics);
    context.shadowColor = 'rgba(0, 0, 0, .28)';
    context.shadowBlur = 3.5;
    context.shadowOffsetY = 2.4;
    for (const element of project.elements) if (!element.hidden && element.face === 'front') drawElement(context, element, metrics, palette);
    context.shadowColor = 'transparent';
    context.save();
    context.translate(metrics.cx, metrics.cy);
    traceMedalFacePath(context, medal, pxPerMm, medal.edgeInset + medal.rimWidth + .8);
    context.strokeStyle = 'rgba(255,255,255,.2)';
    context.lineWidth = Math.max(1, pxPerMm * .18);
    context.stroke();
    context.restore();
  } finally {
    state.project = previousProject;
    state.view = previousView;
  }
}

function renderGalleryPreviews() {
  document.querySelectorAll('[data-gallery-preview]').forEach(canvasElement => {
    const key = canvasElement.dataset.galleryPreview;
    if (GALLERY_TEMPLATE_INFO[key]) renderGalleryProject(canvasElement, projectForGalleryKey(key));
  });
}

function closeTemplateGallery() {
  const gallery = $('#templateGallery');
  if (!gallery) return;
  const wasOpen = !gallery.hidden;
  gallery.hidden = true;
  setCustomModalBackgroundInert(null);
  $('#examplesButton')?.setAttribute('aria-expanded', 'false');
  $('#examplesRailButton')?.setAttribute('aria-expanded', 'false');
  if (wasOpen && state.galleryReturnFocus?.isConnected) state.galleryReturnFocus.focus();
  state.galleryReturnFocus = null;
}

function openTemplateGallery() {
  closeGlobalSettings();
  const gallery = $('#templateGallery');
  const list = $('#templateGalleryList');
  state.galleryReturnFocus = document.activeElement;
  list.innerHTML = `<section class="gallery-section" aria-labelledby="premiumGalleryHeading"><div class="gallery-section-heading"><div><span>Curated collection</span><h3 id="premiumGalleryHeading">Five polished, print-aware starting points</h3></div><b>${PREMIUM_GALLERY_KEYS.length} editable designs</b></div>${PREMIUM_GALLERY_KEYS.map(galleryCardMarkup).join('')}</section>
    <section class="gallery-start-section" aria-labelledby="blankGalleryHeading"><div><span>Prefer your own direction?</span><h3 id="blankGalleryHeading">Start from a clean medal</h3><p>The guided setup asks for the body, ribbon attachment, and event details.</p></div><button type="button" class="gallery-blank-action" data-gallery-template="blank">Start blank <span aria-hidden="true">→</span></button></section>`;
  const useTemplate = key => {
    const info = GALLERY_TEMPLATE_INFO[key];
    if (!info) return;
    if (key === 'blank') { closeTemplateGallery(); openNewDesignWizard(); return; }
    replaceProject(CURATED_EXAMPLE_INFO[key] ? createCuratedExample(key) : createTemplateProject(key));
    markLoadedDesignProgress();
    closeTemplateGallery();
    toast(`${info.label} loaded · every object is editable · Undo restores your previous medal`);
  };
  list.querySelectorAll('[data-gallery-template]').forEach(card => {
    card.addEventListener('click', () => useTemplate(card.dataset.galleryTemplate));
  });
  gallery.hidden = false;
  setCustomModalBackgroundInert(gallery);
  $('#examplesButton')?.setAttribute('aria-expanded', 'true');
  $('#examplesRailButton')?.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => { renderGalleryPreviews(); $('#closeTemplateGallery')?.focus(); });
}

function wizardProject(wizard = state.wizard) {
  const project = CURATED_EXAMPLE_INFO[wizard.template] ? createCuratedExample(wizard.template) : createTemplateProject(wizard.template);
  if (wizard.template !== 'blank') return normalizeProject(project);
  const size = Math.max(DESIGN_LIMITS.medalMin, Math.min(DESIGN_LIMITS.medalMax, Number(wizard.size) || 60));
  project.medal.shape = wizard.shape;
  project.medal.diameter = size;
  project.medal.width = size;
  project.medal.height = size;
  project.medal.loopStyle = wizard.attachment;
  Object.assign(project.medal, wizard.attachmentSettings);
  const eventName = String(wizard.eventName || '').trim().slice(0, 60) || 'My event';
  const distance = String(wizard.distance || '').trim().slice(0, 24);
  const date = String(wizard.eventDate || '').trim().slice(0, 30);
  project.name = eventName;
  const color = Math.min(1, project.paletteIds.length - 1);
  const safeWidth = Math.max(12, size - 12);
  const titleSize = Math.max(3, Math.min(7, safeWidth / Math.max(1, eventName.length * .59)));
  project.elements = [
    conceptText('Event title', eventName.toUpperCase(), 0, -size * .2, titleSize, color, { zHeight: .6 }),
    ...(distance ? [conceptText('Distance', distance.toUpperCase(), 0, 0, Math.max(5, Math.min(10, safeWidth / Math.max(1, distance.length * .59))), color, { zHeight: .6 })] : []),
    ...(date ? [conceptText('Event date', date, 0, size * .2, Math.max(3, Math.min(5.5, safeWidth / Math.max(1, date.length * .59))), color, { zHeight: .6 })] : []),
  ];
  return normalizeProject(fitInternalAttachmentToBody(normalizeProject(project)));
}

function wizardPreviewProject(wizard, overrides = {}) {
  return wizardProject({
    ...wizard,
    ...overrides,
    attachmentSettings: { ...wizard.attachmentSettings, ...(overrides.attachmentSettings || {}) },
  });
}

function wizardLivePreviewMarkup(project) {
  const shape = localizedMedalShapeName(project.medal.shape);
  const attachment = localizedAttachmentName(project.medal.loopStyle);
  const previewLabel = translateUiKey('wizardUi.exactTopView', { shape, attachment });
  return `<figure class="wizard-live-preview"><div class="wizard-live-preview-canvas">${exactMedalPreview(project, { showDimensions: true, label: previewLabel })}</div><figcaption><span class="wizard-preview-kicker">${escapeHtml(translateUiKey('wizardUi.livePreview'))}</span><strong>${escapeHtml(translateUiKey('wizardUi.medalWith', { shape, attachment }))}</strong><div class="wizard-preview-facts"><span><b>${escapeHtml(translateUiKey('wizardUi.body'))}</b>${escapeHtml(localizedMedalSize(project))}</span><span><b>${escapeHtml(translateUiKey('wizardUi.finishedFootprint'))}</b>${escapeHtml(localizedMedalOverallSize(project))}</span><span><b>${escapeHtml(translateUiKey('wizardUi.ribbon'))}</b>${escapeHtml(localizedAttachmentOpening(project))}</span></div></figcaption></figure>`;
}

function wizardShapeChoiceMarkup(wizard, shape, label) {
  const project = wizardPreviewProject(wizard, { shape });
  const shapeName = localizedMedalShapeName(shape);
  const attachmentName = localizedAttachmentName(project.medal.loopStyle);
  const previewLabel = translateUiKey('wizardUi.exactTopView', { shape: shapeName, attachment: attachmentName });
  return `<button type="button" role="radio" aria-checked="${wizard.shape === shape}" class="wizard-choice wizard-shape-choice ${wizard.shape === shape ? 'active' : ''}" data-wizard-shape="${shape}"><span class="wizard-choice-geometry" data-wizard-shape-preview="${shape}">${exactMedalPreview(project, { compact: true, showDimensions: false, label: previewLabel })}</span><span>${escapeHtml(shapeName || label)}</span><small><em data-wizard-shape-size="${shape}">${escapeHtml(localizedMedalSize(project))}</em> ${escapeHtml(translateUiKey('wizardUi.printableBody'))}</small></button>`;
}

function wizardAttachmentChoiceMarkup(wizard, style, info) {
  const project = wizardPreviewProject(wizard, { attachment: style });
  const shapeName = localizedMedalShapeName(project.medal.shape);
  const attachmentName = localizedAttachmentName(style);
  const previewLabel = translateUiKey('wizardUi.attachmentOnMedal', { attachment: attachmentName, shape: shapeName });
  return `<button type="button" role="radio" aria-checked="${wizard.attachment === style}" class="attachment-card wizard-attachment-choice ${wizard.attachment === style ? 'active' : ''}" data-wizard-attachment="${style}"><span class="attachment-geometry-icon">${exactMedalPreview(project, { compact: true, showDimensions: false, label: previewLabel })}</span><strong>${escapeHtml(attachmentName)}</strong><small>${escapeHtml(info.description)}</small><em>${escapeHtml(localizedAttachmentOpening(project))}</em></button>`;
}

function refreshWizardGeometryPreviews({ shapes = false } = {}) {
  const wizard = state.wizard;
  if (!wizard) return;
  const project = wizardProject(wizard);
  $$('[data-wizard-live-preview]').forEach(host => { host.innerHTML = wizardLivePreviewMarkup(project); });
  if (!shapes) return;
  $$('[data-wizard-shape-preview]').forEach(host => {
    const shape = host.dataset.wizardShapePreview;
    const candidate = wizardPreviewProject(wizard, { shape });
    host.innerHTML = exactMedalPreview(candidate, { compact: true, showDimensions: false, label: `${shape} medal with ${ATTACHMENT_STYLE_INFO[candidate.medal.loopStyle].label}` });
    const size = host.closest('[data-wizard-shape]')?.querySelector('[data-wizard-shape-size]');
    if (size) size.textContent = localizedMedalSize(candidate);
  });
}

function wizardAttachmentFields(wizard) {
  if (['single', 'double'].includes(wizard.attachment)) {
    const loopWidth = Math.max(14, Math.min(60, Number(wizard.attachmentSettings.loopWidth) || 32));
    const loopHeight = Math.max(6, Math.min(16, Number(wizard.attachmentSettings.loopHeight) || 8));
    const slotMax = Math.max(6, loopWidth - 2), heightMax = Math.max(2, loopHeight - 2);
    return `<div class="wizard-parameter-row wizard-parameter-grid"><label>Bar width <span><input data-wizard-attachment-field="loopWidth" type="number" min="14" max="60" step=".5" value="${loopWidth}"> mm</span></label><label>Bar height <span><input data-wizard-attachment-field="loopHeight" type="number" min="6" max="16" step=".2" value="${loopHeight}"> mm</span></label><label>Opening width <span><input data-wizard-attachment-field="slotWidth" type="number" min="6" max="${slotMax}" step=".5" value="${Math.min(slotMax, wizard.attachmentSettings.slotWidth)}"> mm</span></label><label>Opening height <span><input data-wizard-attachment-field="slotHeight" type="number" min="2" max="${heightMax}" step=".2" value="${Math.min(heightMax, wizard.attachmentSettings.slotHeight)}"> mm</span></label></div>`;
  }
  if (wizard.attachment === 'eyelet') return `<div class="wizard-parameter-row"><label>Hole diameter <span><input data-wizard-attachment-field="holeDiameter" type="number" min="2" max="20" step=".5" value="${wizard.attachmentSettings.holeDiameter}"> mm</span></label><label>Top inset <span><input data-wizard-attachment-field="attachmentInset" type="number" min="1" max="16" step=".5" value="${wizard.attachmentSettings.attachmentInset}"> mm</span></label></div>`;
  if (['slit', 'open-slit'].includes(wizard.attachment)) {
    const maximumWidth = Math.max(6, Math.min(55, Number(wizard.size) - 2));
    return `<div class="wizard-parameter-row"><label>Slit width <span><input data-wizard-attachment-field="slitWidth" type="number" min="6" max="${maximumWidth}" step=".5" value="${Math.min(maximumWidth, wizard.attachmentSettings.slitWidth)}"> mm</span></label><label>Slit height <span><input data-wizard-attachment-field="slitHeight" type="number" min="1" max="10" step=".2" value="${wizard.attachmentSettings.slitHeight}"> mm</span></label></div>`;
  }
  return '<p class="dialog-lede">No opening will be added. You can change this later under Medal.</p>';
}

function renderNewDesignWizard() {
  const wizard = state.wizard;
  if (!wizard || !dialog.open) return;
  const titles = [
    translateUiKey('wizardUi.titleStart'), translateUiKey('wizardUi.titleBody'), translateUiKey('wizardUi.titleRibbon'),
    translateUiKey(wizard.template === 'blank' ? 'wizardUi.titleEvent' : 'wizardUi.titlePersonalize'), translateUiKey('wizardUi.titleReady'),
  ];
  $('#dialogEyebrow').textContent = `New medal · step ${wizard.step + 1} of 5`;
  $('#dialogTitle').textContent = titles[wizard.step];
  const progress = `<div class="wizard-progress" aria-label="Step ${wizard.step + 1} of 5">${[0,1,2,3,4].map(step => `<i class="${step <= wizard.step ? 'done' : ''}"></i>`).join('')}</div>`;
  let content = '';
  if (wizard.step === 0) {
    const entries = ['blank', 'alpine-current-25k', 'showcase-night', 'podium-classic'];
    content = `<p class="dialog-lede">Start clean, or personalize one of the same polished, printable medals shown in the gallery.</p><div class="wizard-choice-grid" role="radiogroup" aria-label="Starting medal">${entries.map(key => { const info = GALLERY_TEMPLATE_INFO[key]; return `<button type="button" role="radio" aria-checked="${wizard.template === key}" class="wizard-choice ${wizard.template === key ? 'active' : ''}" data-wizard-template="${key}">${templatePreviewMarkup(key, info)}<span>${escapeHtml(info.label)}</span><small><span>${escapeHtml(info.meta)}</span> · ${escapeHtml(translateUiKey('wizardUi.everyItemEditable'))}</small></button>`; }).join('')}</div>`;
  } else if (wizard.step === 1) {
    if (wizard.template !== 'blank') {
      const project = wizardProject(wizard), info = GALLERY_TEMPLATE_INFO[wizard.template];
      content = `<div class="wizard-fixed-example">${templatePreviewMarkup(wizard.template, info)}<div><strong>The example keeps its tested ${project.medal.diameter} mm ${escapeHtml(project.medal.shape)} body</strong><p class="dialog-lede">This prevents its artwork from crossing the printable edge. Once opened, you can still change the body under Medal and the live checks will guide you.</p></div></div>`;
    } else {
      const shapes = [['circle','Circle'],['rounded','Rounded square'],['hexagon','Hexagon'],['scalloped','Scalloped'],['shield','Shield']];
      const project = wizardProject(wizard);
      content = `<div class="wizard-setup-layout"><section class="wizard-setup-controls"><p class="dialog-lede">Pick the medal body. Every thumbnail already includes your chosen ribbon attachment, and the large diagram shows its real finished dimensions.</p><div class="wizard-choice-grid" role="radiogroup" aria-label="Medal body shape">${shapes.map(([key, label]) => wizardShapeChoiceMarkup(wizard, key, label)).join('')}</div><label class="wizard-size"><span>Medal body size <output id="wizardSizeLabel">${wizard.size} mm</output></span><input id="wizardSize" type="range" min="${DESIGN_LIMITS.medalMin}" max="${DESIGN_LIMITS.medalMax}" step="1" value="${wizard.size}"><small>The preview separately shows the exact body and finished size with the attachment.</small></label></section><aside data-wizard-live-preview aria-live="polite">${wizardLivePreviewMarkup(project)}</aside></div>`;
    }
  } else if (wizard.step === 2) {
    if (wizard.template !== 'blank') {
      const project = wizardProject(wizard), attachment = ATTACHMENT_STYLE_INFO[project.medal.loopStyle];
      content = `<div class="wizard-fixed-example"><span class="wizard-fixed-geometry">${exactMedalPreview(project, { compact: true, showDimensions: false })}</span><div><strong>${escapeHtml(attachment.label)} is fitted to this example</strong><p class="dialog-lede">This is the real top-view outline, including every opening. It stays fully editable in the Medal tool after opening.</p></div></div>`;
    } else {
      const project = wizardProject(wizard);
      content = `<div class="wizard-setup-layout wizard-attachment-layout"><section class="wizard-setup-controls"><p class="dialog-lede">Pick how the ribbon is fitted. These are exact top views on your selected ${escapeHtml(localizedMedalShapeName(project.medal.shape))} body—not generic symbols.</p><div class="attachment-picker wizard-attachments" role="radiogroup" aria-label="Ribbon attachment">${Object.entries(ATTACHMENT_STYLE_INFO).map(([key, info]) => wizardAttachmentChoiceMarkup(wizard, key, info)).join('')}</div>${['single','double','slit','open-slit'].includes(wizard.attachment) ? `<div class="ribbon-presets"><span>${escapeHtml(translateUiKey('medalSettingsUi.ribbonWidth'))}</span><button type="button" data-wizard-ribbon="22">22 mm</button><button type="button" data-wizard-ribbon="25" class="recommended">${escapeHtml(translateUiKey('medalSettingsUi.standardRibbon', { width: '25' }))}</button><button type="button" data-wizard-ribbon="38">${escapeHtml(translateUiKey('medalSettingsUi.wideRibbon', { width: '38' }))}</button></div>` : ''}<details class="friendly-disclosure"><summary>Fine-tune the opening</summary><div id="wizardAttachmentFields">${wizardAttachmentFields(wizard)}</div></details></section><aside data-wizard-live-preview aria-live="polite">${wizardLivePreviewMarkup(project)}</aside></div>`;
    }
  } else if (wizard.step === 3) {
    content = wizard.template === 'blank'
      ? `<p class="dialog-lede">We will add this as crisp, editable text. You can move, resize, recolor, or delete every line in 3D.</p><div class="tool-form"><label><span>Event name</span><input class="text-input" id="wizardEventName" maxlength="60" value="${escapeHtml(wizard.eventName)}" placeholder="City Night Run"></label><div class="dimension-grid"><label><span>Distance or award</span><input class="text-input" id="wizardDistance" maxlength="24" value="${escapeHtml(wizard.distance)}" placeholder="10 KM"></label><label><span>Date</span><input class="text-input" id="wizardEventDate" maxlength="30" value="${escapeHtml(wizard.eventDate)}" placeholder="18. 9. 2027"></label></div></div>`
      : `<div class="wizard-fixed-example"><b class="wizard-attachment-icon">✦</b><div><strong>This polished example already includes editable wording</strong><p class="dialog-lede">Open it, click any word directly on the medal, and type your own event name, distance, or date.</p></div></div>`;
  } else {
    const project = wizardProject(wizard);
    const shapeName = localizedMedalShapeName(project.medal.shape), attachmentName = localizedAttachmentName(project.medal.loopStyle);
    const itemCount = wizard.template === 'blank'
      ? localizedPluralMessage('wizardUi.starterTextItem', project.elements.length)
      : localizedPluralMessage('wizardUi.exampleObject', project.elements.length);
    content = `<div class="wizard-summary"><div class="wizard-summary-geometry">${exactMedalPreview(project, { showDimensions: true })}</div><div><h3 data-i18n-ignore>${escapeHtml(project.name)}</h3><p class="dialog-lede">This is the same exact body and ribbon outline that opens in the rotatable 3D workspace. Add an object, move over the front or back face, and click only when its real preview is in the right place.</p><ul><li>${escapeHtml(translateUiKey('wizardUi.shapeBody', { size: localizedMedalSize(project), shape: shapeName }))}</li><li>${escapeHtml(localizedMedalOverallSize(project))}</li><li>${escapeHtml(attachmentName)} · ${escapeHtml(localizedAttachmentOpening(project))}</li><li>${escapeHtml(localizedPluralMessage('wizardUi.localFilamentColor', project.paletteIds.length))}</li><li>${escapeHtml(itemCount)}</li></ul></div></div>`;
  }
  const back = wizard.step > 0 ? '<button class="button secondary" type="button" id="wizardBack">Back</button>' : '<button class="button secondary" type="button" id="wizardCancel">Cancel</button>';
  const next = wizard.step < 4 ? '<button class="button primary" type="button" id="wizardNext">Continue</button>' : '<button class="button primary" type="button" id="wizardFinish">Open in 3D</button>';
  $('#dialogBody').innerHTML = `${progress}${content}<div class="dialog-actions">${back}${next}</div>`;
  $$('[data-wizard-template]').forEach(button => button.addEventListener('click', () => { wizard.template = button.dataset.wizardTemplate; $$('[data-wizard-template]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-checked', String(active)); }); }));
  $$('[data-wizard-shape]').forEach(button => button.addEventListener('click', () => { wizard.shape = button.dataset.wizardShape; $$('[data-wizard-shape]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-checked', String(active)); }); refreshWizardGeometryPreviews(); }));
  $('#wizardSize')?.addEventListener('input', event => { wizard.size = Number(event.target.value); $('#wizardSizeLabel').textContent = `${wizard.size} mm`; refreshWizardGeometryPreviews({ shapes: true }); });
  $$('[data-wizard-attachment]').forEach(button => button.addEventListener('click', () => { wizard.attachment = button.dataset.wizardAttachment; renderNewDesignWizard(); }));
  $$('[data-wizard-ribbon]').forEach(button => button.addEventListener('click', () => {
    const width = Number(button.dataset.wizardRibbon);
    if (['single','double'].includes(wizard.attachment)) { wizard.attachmentSettings.slotWidth = width + 2; wizard.attachmentSettings.loopWidth = width + 7; wizard.attachmentSettings.slotHeight = Math.max(3.2, wizard.attachmentSettings.slotHeight); }
    else { wizard.attachmentSettings.slitWidth = width + 2; wizard.attachmentSettings.slitHeight = Math.max(3.2, wizard.attachmentSettings.slitHeight); }
    renderNewDesignWizard();
  }));
  $('#wizardEventName')?.addEventListener('input', event => { wizard.eventName = event.target.value; });
  $('#wizardDistance')?.addEventListener('input', event => { wizard.distance = event.target.value; });
  $('#wizardEventDate')?.addEventListener('input', event => { wizard.eventDate = event.target.value; });
  $$('[data-wizard-attachment-field]').forEach(input => input.addEventListener('input', () => {
    const requested = Number(input.value);
    if (!Number.isFinite(requested)) return;
    wizard.attachmentSettings[input.dataset.wizardAttachmentField] = requested;
    refreshWizardGeometryPreviews();
  }));
  $$('[data-wizard-attachment-field]').forEach(input => input.addEventListener('change', () => {
    const minimum = Number(input.min), maximum = Number(input.max), requested = Number(input.value);
    const value = Math.max(Number.isFinite(minimum) ? minimum : requested, Math.min(Number.isFinite(maximum) ? maximum : requested, requested));
    input.value = String(value);
    wizard.attachmentSettings[input.dataset.wizardAttachmentField] = value;
    if (input.dataset.wizardAttachmentField === 'loopWidth') {
      wizard.attachmentSettings.slotWidth = Math.min(wizard.attachmentSettings.slotWidth, value - 2);
      const dependent = $('[data-wizard-attachment-field="slotWidth"]');
      if (dependent) { dependent.max = String(value - 2); dependent.value = String(wizard.attachmentSettings.slotWidth); }
    }
    if (input.dataset.wizardAttachmentField === 'loopHeight') {
      wizard.attachmentSettings.slotHeight = Math.min(wizard.attachmentSettings.slotHeight, value - 2);
      const dependent = $('[data-wizard-attachment-field="slotHeight"]');
      if (dependent) { dependent.max = String(value - 2); dependent.value = String(wizard.attachmentSettings.slotHeight); }
    }
    refreshWizardGeometryPreviews();
  }));
  $('#wizardCancel')?.addEventListener('click', closeDialog);
  $('#wizardBack')?.addEventListener('click', () => { wizard.step -= 1; renderNewDesignWizard(); });
  $('#wizardNext')?.addEventListener('click', () => { wizard.step += 1; renderNewDesignWizard(); });
  $('#wizardFinish')?.addEventListener('click', () => {
    const project = wizardProject(wizard);
    closeDialog();
    replaceProject(project);
    if (wizard.template === 'blank') markOnboardingStep('medal');
    else markLoadedDesignProgress();
    toast(wizard.template === 'blank' ? 'New medal ready · rotate it, then add artwork to either face' : 'Polished example ready · click any item to personalize it');
  });
}

function openNewDesignWizard() {
  closeTemplateGallery();
  closeGlobalSettings();
  const base = createTemplateProject('blank');
  state.wizard = {
    step: 0,
    template: 'blank',
    shape: 'circle',
    size: 60,
    eventName: 'MY EVENT',
    distance: '10 KM',
    eventDate: String(new Date().getFullYear()),
    attachment: 'double',
    attachmentSettings: {
      slotWidth: base.medal.slotWidth,
      slotHeight: base.medal.slotHeight,
      loopWidth: base.medal.loopWidth,
      loopHeight: base.medal.loopHeight,
      holeDiameter: base.medal.holeDiameter,
      slitWidth: base.medal.slitWidth,
      slitHeight: base.medal.slitHeight,
      attachmentInset: base.medal.attachmentInset,
    },
  };
  openDialog('New medal · step 1 of 5', 'Choose a starting point', '<div class="export-progress">Opening guided setup…</div>');
  const wizard = state.wizard;
  state.dialogCleanup = () => { if (state.wizard === wizard) state.wizard = null; };
  renderNewDesignWizard();
}

function downloadEmergencyBackup(project = state.project) {
  const bundle = projectBundleForExport(project, state.inventory);
  downloadBlob(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }), `${safeFilename(project.name)}-backup.medalforge.json`);
  toast('Emergency backup downloaded · keep this file somewhere safe');
}

async function saveProjectCopy() {
  if (state.liveEdit) { toast('Apply or restore the current height change first'); return false; }
  const copy = structuredClone(state.project);
  copy.id = uid('project');
  copy.name = `${state.project.name.replace(/\s+copy(?: \d+)?$/i, '')} copy`.slice(0, 60);
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = copy.createdAt;
  replaceProject(copy);
  markLoadedDesignProgress();
  const saved = await persistProject();
  if (saved) { markOnboardingStep('export'); toast(`Saved “${state.project.name}” as a separate medal`); }
  else {
    downloadEmergencyBackup();
    toast('This browser could not save the copy; a backup file was downloaded instead', { error: true });
  }
  return saved;
}

async function showProjectLibrary() {
  if (state.liveEdit) { toast('Apply or restore the current height change before opening My medals'); return; }
  const requestId = uid('library');
  state.libraryRequestId = requestId;
  openDialog('My medals', 'Loading saved medals', '<div class="export-progress"><span class="spinner"></span> Saving the current medal and opening your local library…</div>', 'project-library-loading');
  if (state.saveDirty && !await persistProject()) {
    downloadEmergencyBackup();
    toast('The current medal could not be saved here, so a backup was downloaded. It is still open and unchanged.', { error: true });
    closeDialog();
    return;
  }
  if (!dialog.open || state.libraryRequestId !== requestId || dialog.dataset.context !== 'project-library-loading') return;
  const library = Array.isArray(state.projectLibrary) ? state.projectLibrary : [];
  const entries = library.length ? library : [{ id: state.project.id, name: state.project.name, createdAt: state.project.createdAt, updatedAt: state.project.updatedAt, elements: state.project.elements.length, colors: state.project.paletteIds.length }];
  const cards = entries.map(item => {
    const current = item.id === state.project.id;
    const date = item.updatedAt ? new Date(item.updatedAt).toLocaleString(getCurrentLocaleTag(), { dateStyle: 'medium', timeStyle: 'short' }) : 'Saved on this device';
    const elementCount = Number(item.elements) || 0, colorCount = Number(item.colors) || 1;
    return `<article class="project-library-card ${current ? 'current' : ''}"><span class="project-library-thumb" data-i18n-ignore>${escapeHtml(String(item.name || 'M').trim().slice(0, 2).toUpperCase())}</span><span class="project-library-copy"><strong data-i18n-ignore>${escapeHtml(item.name || 'Untitled medal')}</strong><small>${elementCount} item${elementCount === 1 ? '' : 's'} · ${colorCount} color${colorCount === 1 ? '' : 's'} · ${escapeHtml(date)}</small></span><span class="project-library-actions">${current ? '<b>Open</b>' : `<button type="button" data-open-project="${escapeHtml(item.id)}">Open</button>`}<button type="button" data-copy-project="${escapeHtml(item.id)}">Copy</button></span></article>`;
  }).join('');
  const recovery = await loadRecord('projects', `recovery-${state.project.id}`, null);
  if (!dialog.open || state.libraryRequestId !== requestId || dialog.dataset.context !== 'project-library-loading') return;
  openDialog('My medals', 'Saved on this device', `<p class="dialog-lede">MedalForge autosaves the medal you are editing. Use copies when you want to explore a new direction without changing the original.</p><div class="project-library-list">${cards}</div><div class="dialog-actions split-actions"><button class="button secondary" type="button" id="libraryNewMedal">New medal</button><button class="button secondary" type="button" id="libraryOpenFile">Open project file</button>${recovery ? '<button class="button secondary" type="button" id="restoreRecovery">Restore previous version</button>' : ''}<button class="button secondary" type="button" id="downloadCurrentBackup">Download backup</button><button class="button primary" type="button" data-close-dialog>Done</button></div>`, 'project-library');
  $('[data-close-dialog]')?.addEventListener('click', closeDialog);
  $('#downloadCurrentBackup')?.addEventListener('click', () => downloadEmergencyBackup());
  $('#libraryOpenFile')?.addEventListener('click', () => $('#projectInput').click());
  $('#libraryNewMedal')?.addEventListener('click', () => { closeDialog(); openNewDesignWizard(); });
  $('#restoreRecovery')?.addEventListener('click', () => {
    if (!recovery) return;
    closeDialog(); replaceProject(recovery); markLoadedDesignProgress(); toast('Previous autosaved version restored · Undo returns to the newer medal');
  });
  $$('[data-open-project]').forEach(button => button.addEventListener('click', async () => {
    const project = await loadRecord('projects', button.dataset.openProject, null);
    if (!project) { toast('That saved medal could not be found on this device', { error: true }); return; }
    closeDialog(); replaceProject(project); markLoadedDesignProgress(); state.history.length = 0; state.future.length = 0; state.lastSavedSnapshot = snapshot(); toast(`Opened “${state.project.name}”`);
  }));
  $$('[data-copy-project]').forEach(button => button.addEventListener('click', async () => {
    const source = button.dataset.copyProject === state.project.id ? state.project : await loadRecord('projects', button.dataset.copyProject, null);
    if (!source) { toast('That saved medal could not be found on this device', { error: true }); return; }
    const copy = structuredClone(source); copy.id = uid('project'); copy.name = `${copy.name} copy`.slice(0, 60); copy.createdAt = new Date().toISOString(); copy.updatedAt = copy.createdAt;
    closeDialog(); replaceProject(copy); markLoadedDesignProgress();
    const saved = await persistProject();
    if (saved) { markOnboardingStep('export'); toast(`Created “${state.project.name}”`); }
    else { downloadEmergencyBackup(); toast('The copy could not be saved here; a backup file was downloaded instead', { error: true }); }
  }));
}

function showProfileInfo() {
  const rows=[.2,.4,.6,.8].map(nozzle=>`<tr><td>${nozzle.toFixed(1)} mm</td><td>${(nozzle*1.125).toFixed(3)} mm</td><td>${(nozzle*2.25).toFixed(2)} mm</td></tr>`).join('');
  openDialog('Production profile','How nozzle-aware checks work',`<p class="dialog-lede">MedalForge checks physical millimeter estimates, not screen pixels. The current starting profile uses a nominal extrusion width of 1.125× the nozzle and treats two lines as the robust customer-facing target.</p><table class="profile-table"><thead><tr><th>Nozzle</th><th>One-line minimum</th><th>Robust target</th></tr></thead><tbody>${rows}</tbody></table><p class="dialog-lede" style="margin-top:16px">These are provisional rules. Before commercial production, print calibration coupons for every printer, slicer, material family, speed, and ribbon-loop design, then replace the defaults with measured profiles.</p><div class="dialog-actions"><button class="button primary" data-close-dialog>Understood</button></div>`);
  $('[data-close-dialog]').addEventListener('click',closeDialog);
}

function showChecksDialog() {
  markOnboardingStep('inspect');
  const cards=state.checks.map((check, index) => {
    const checkedElement = check.elementId ? state.project.elements.find(element => element.id === check.elementId) : null;
    const canFit = checkedElement && !checkedElement.locked && check.title.includes('crosses the safe area');
    const action = check.elementId ? `<span class="check-card-actions"><button type="button" data-locate-check="${index}">Show item</button>${canFit ? `<button type="button" data-fit-check="${index}">Fix automatically</button>` : ''}</span>` : '';
    return `<div class="check-card"><span class="status-orb ${check.level}"></span><div><b>${escapeHtml(check.title)}</b><p>${escapeHtml(check.message)}</p>${action}</div><small>${check.level==='block'?'Fix':check.level==='warn'?'Review':'Pass'}</small></div>`;
  }).join('');
  openDialog('Design checks','Ready for your slicer?',`<p class="dialog-lede">These checks use your medal, artwork, nozzle, layer height and chosen filaments. Fix red items here, review orange advice, then always open the downloaded file in your slicer before printing.</p><div class="checks-full">${cards}</div><div class="dialog-actions"><button class="button primary" data-close-dialog>Back to editor</button></div>`);
  $('[data-close-dialog]').addEventListener('click',closeDialog);
  $$('[data-locate-check]').forEach(button => button.addEventListener('click', () => {
    const check = state.checks[Number(button.dataset.locateCheck)];
    if (!check?.elementId) return;
    state.selectedId = check.elementId;
    closeDialog();
    const element = selectedElement();
    if (element) {
      setView('3d');
      const preset = element.face === 'back' ? 'bottom' : 'top';
      state.drawing.face = element.face === 'back' ? 'back' : 'front';
      setCameraPreset(preset);
    }
    renderAll({ panel: state.panel === 'layers' });
    $('.inspector')?.classList.add('mobile-open');
    announce(`${selectedElement()?.name || 'Item'} selected`);
  }));
  $$('[data-fit-check]').forEach(button => button.addEventListener('click', () => {
    const check = state.checks[Number(button.dataset.fitCheck)];
    if (!check?.elementId) return;
    state.selectedId = check.elementId;
    fitSelectedInsideMedal();
    showChecksDialog();
  }));
}

function showPriceDialog() {
  const quantities=[...new Set([1,10,25,50,100,state.quantity])].sort((a,b)=>a-b);
  const rows=quantities.map(q=>{const quote=calculateQuote(state.project,state.inventory,q,currentGeometryResult());return `<tr class="${q===state.quantity?'selected':''}"><td>${q}</td><td>Kč ${formatLocalizedNumber(quote.unit)}</td><td>Kč ${formatLocalizedNumber(quote.total)}</td></tr>`;}).join('');
  const q=state.quote;
  openDialog('Price estimate','Price by quantity',`<p class="dialog-lede">${q.geometryBased ? 'This estimate uses the built 3D volume and the density and price of every chosen filament.' : 'This quick estimate uses the medal size and artwork while the detailed 3D volume finishes building.'} It includes material, machine time and setup; confirm the final price after slicing and a test print.</p><table class="price-table"><thead><tr><th>Quantity</th><th>Per medal</th><th>Estimated total</th></tr></thead><tbody>${rows}</tbody></table><div class="breakdown"><div><small>Material / medal</small><strong>Kč ${q.materialPerPiece}</strong></div><div><small>Machine / medal</small><strong>Kč ${q.machinePerPiece}</strong></div><div><small>One-time setup</small><strong>Kč ${q.setup}</strong></div><div><small>Weight / medal</small><strong>${q.gramsPerPiece.toFixed(1)} g</strong></div></div><p class="check-summary">Estimate only · electricity, failed prints, packaging, tax and shipping depend on your production setup.</p><div class="dialog-actions"><button class="button primary" data-close-dialog>Done</button></div>`); $('[data-close-dialog]').addEventListener('click',closeDialog);
}

const MATERIAL_DENSITY = { PLA: 1.24, PETG: 1.27, ASA: 1.07, ABS: 1.04, TPU: 1.21 };

function normalizeFilamentRecord(value, index = 0) {
  const normalized = normalizeFilament(value, index);
  if (!Number.isFinite(Number(value?.density))) normalized.density = MATERIAL_DENSITY[normalized.material] || normalized.density;
  return normalized;
}

function inventoryRow(filament) {
  const materials = [...new Set(['PLA', 'PETG', 'ASA', 'ABS', 'TPU', filament.material])];
  return `<tr data-filament-row="${escapeHtml(filament.id)}"><td><input data-field="color" type="color" value="${escapeHtml(filament.color)}"/></td><td><input data-field="name" value="${escapeHtml(filament.name)}"/></td><td><input data-field="brand" value="${escapeHtml(filament.brand || 'Custom')}"/></td><td><select data-field="material">${materials.map(material => `<option ${filament.material === material ? 'selected' : ''}>${escapeHtml(material)}</option>`).join('')}</select></td><td><input data-field="effect" value="${escapeHtml(filament.effect)}"/></td><td><input data-field="density" type="number" min="0.5" max="3" step="0.01" value="${filament.density}"/></td><td><input data-field="pricePerKg" type="number" min="0" value="${filament.pricePerKg}"/></td><td><input data-field="stockGrams" type="number" min="0" placeholder="Unknown" value="${filament.stockKnown === false ? '' : filament.stockGrams}"/></td><td><input data-field="supplierRegion" value="${escapeHtml(filament.supplierRegion || '')}" placeholder="Prague / EU / Asia"/></td><td><input data-field="productUrl" type="url" value="${escapeHtml(filament.productUrl || '')}" placeholder="https://…"/></td><td><input data-field="sourcePrice" type="number" min="0" step="0.01" value="${filament.sourcePrice || ''}" placeholder="Reference"/></td><td><input data-field="sourceCurrency" value="${escapeHtml(filament.sourceCurrency || '')}" maxlength="8" placeholder="EUR"/></td><td><input data-field="priceUpdatedAt" type="date" value="${escapeHtml(filament.priceUpdatedAt || '')}"/></td><td style="text-align:center"><input data-field="abrasive" type="checkbox" ${filament.abrasive?'checked':''}/></td><td><button data-remove-filament="${escapeHtml(filament.id)}" aria-label="Remove ${escapeHtml(filament.name)}">×</button></td></tr>`;
}

function showInventoryDialog() {
  const working=structuredClone(state.inventory);
  let search = '';
  const captureRows=()=>$$('[data-filament-row]').forEach(row=>{const item=working.find(f=>f.id===row.dataset.filamentRow);if(!item)return;row.querySelectorAll('[data-field]').forEach(input=>{const field=input.dataset.field;if(field==='stockGrams'){item.stockKnown=input.value.trim()!=='';item.stockGrams=item.stockKnown?Number(input.value):0;}else item[field]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;});});
  const render=()=>{
    openDialog('My filament stock','Colors, effects & prices',`<p class="dialog-lede">Saved only on this device. Start with color, material, effect, price and stock; the fields farther right are optional supplier notes for advanced quoting.</p><label class="inventory-search"><span>Find a filament</span><input id="inventorySearch" type="search" value="${escapeHtml(search)}" placeholder="Search color, brand, material or effect"></label><div class="inventory-wrap"><table class="inventory-table"><thead><tr><th>Color</th><th>Name</th><th>Brand</th><th>Material</th><th>Effect</th><th>g/cm³</th><th>Local Kč/kg</th><th>Stock g</th><th>Supplier / region</th><th>Product URL</th><th>Ref. price</th><th>Currency</th><th>Checked</th><th>Abrasive</th><th></th></tr></thead><tbody>${working.map(inventoryRow).join('')}</tbody></table></div><div class="dialog-actions split-actions"><button class="button secondary" id="addFilament">Add filament</button><button class="button secondary" id="addAsiaCatalog">Add Asian starter catalog</button><button class="button primary" id="saveInventory">Save stock</button></div>`);
    const filterRows = () => {
      const query = search.trim().toLowerCase();
      captureRows();
      $$('[data-filament-row]').forEach(row => {
        const filament = working.find(item => item.id === row.dataset.filamentRow);
        const haystack = filament ? [filament.name, filament.brand, filament.material, filament.effect, filament.supplierRegion].join(' ').toLowerCase() : '';
        row.hidden = Boolean(query) && !haystack.includes(query);
      });
    };
    $('#inventorySearch')?.addEventListener('input', event => { search = event.target.value; filterRows(); });
    filterRows();
    $$('[data-remove-filament]').forEach(button=>button.addEventListener('click',()=>{captureRows();if(working.length<=2){toast('Keep at least two catalog colors');return;}if(state.project.paletteIds.includes(button.dataset.removeFilament)){toast('Reassign this filament slot before removing it from the catalog');return;}const index=working.findIndex(item=>item.id===button.dataset.removeFilament);if(index>=0)working.splice(index,1);render();}));
    $$('[data-field="material"]').forEach(select=>select.addEventListener('change',()=>{const density=select.closest('tr').querySelector('[data-field="density"]');if(density&&MATERIAL_DENSITY[select.value])density.value=String(MATERIAL_DENSITY[select.value]);}));
    $('#addFilament').addEventListener('click',()=>{captureRows();working.push({id:uid('filament'),name:'New filament',brand:'Custom',material:'PLA',color:'#7a817e',pricePerKg:650,stockGrams:1000,stockKnown:true,effect:'Solid',density:1.24,abrasive:false,supplierRegion:'',productUrl:'',sourcePrice:0,sourceCurrency:'',priceUpdatedAt:''});render();});
    $('#addAsiaCatalog').addEventListener('click',()=>{
      captureRows();
      const known = new Set(working.map(item => item.id));
      const additions = ASIA_FILAMENT_PRESETS.filter(item => !known.has(item.id)).map(item => structuredClone(item));
      if (!additions.length) { toast('Asian starter records are already in this catalog'); return; }
      working.push(...additions); render(); toast(`Added ${additions.length} editable supplier reference records`);
    });
    $('#saveInventory').addEventListener('click',async()=>{
      captureRows();
      const normalized=normalizeInventory(working.map(normalizeFilamentRecord));const availableIds=new Set(normalized.map(item=>item.id));
      const missing=state.project.paletteIds.filter(id=>!availableIds.has(id));if(missing.length){toast('A filament used by this design is missing. Reassign its palette slot first.');return;}
      state.inventory=normalized;await saveUserRecord('inventory','catalog',state.inventory);markDirty();closeDialog();renderAll({panel:true});toast(state.qaMode ? 'QA catalog updated for this tab only' : 'Filament catalog saved');
      reprocessImportedImages('filament catalog change');
    });
  }; render();
}

function checkBlocksGeometryExport(check) {
  if (check?.level !== 'block') return false;
  // Inventory quantity affects fulfillment and pricing, not whether the user's
  // already-designed geometry can be downloaded and printed elsewhere.
  if (/^Slot \d+ is out of stock$/.test(check.title || '')) return false;
  if (/^Not enough .+ for \d+ medals$/.test(check.title || '')) return false;
  return true;
}

function renderExportDialog({ preflighting = false, error = '' } = {}) {
  const geometryBlockers = state.checks.filter(checkBlocksGeometryExport);
  const stockBlockers = state.checks.filter(check => check.level === 'block' && !checkBlocksGeometryExport(check));
  const warnings = state.checks.filter(check => check.level === 'warn').length;
  const blocked=preflighting||Boolean(error)||geometryBlockers.length > 0;
  const blockerList = geometryBlockers.slice(0, 4).map(check => `<li><strong>${escapeHtml(check.title)}</strong><span>${escapeHtml(check.message)}</span></li>`).join('');
  const statusHtml=preflighting
    ? `<div class="export-progress" id="exportProgress"><span class="spinner"></span> ${escapeHtml(translateUiKey('export.refreshingChecks'))}</div>`
    : error
      ? `<div class="export-progress error" id="exportProgress">${escapeHtml(translateUiKey('export.finalCheckFailed', { message: error }))}</div>`
      : blocked
        ? `<div class="export-progress error export-blocker-summary" id="exportProgress"><strong>${escapeHtml(localizedPluralMessage('export.blockers', geometryBlockers.length))}</strong><ul>${blockerList}</ul>${geometryBlockers.length > 4 ? `<small>${escapeHtml(translateUiKey('export.moreBlockers', { count: formatLocalizedNumber(geometryBlockers.length - 4) }))}</small>` : ''}<button class="button secondary" type="button" id="reviewExportBlockers">${escapeHtml(translateUiKey('export.reviewPrintability'))}</button><small>${escapeHtml(translateUiKey('export.backupAvailable'))}</small></div>`
        : `<div class="export-progress" id="exportProgress">${escapeHtml(stockBlockers.length ? translateUiKey('export.stockLow') : warnings ? localizedPluralMessage('export.warnings', warnings) : translateUiKey('export.checksPassed'))} ${escapeHtml(translateUiKey('export.finalValidation'))}</div>`;
  openDialog('Check & export','What would you like to do?',`<p class="dialog-lede">Everything is created on this device. For normal multicolor printing, choose the first option and open the downloaded 3MF in your slicer for the final printer check.</p><div class="export-grid"><button class="export-card recommended" data-export="3mf" ${blocked?'disabled':''}><b>Print it myself · 3MF <span>→</span></b><p>One aligned multicolor file with named filament pieces and a color manifest.</p><small>Recommended for PrusaSlicer, OrcaSlicer and Bambu Studio</small></button><button class="export-card" data-export="stl" ${blocked?'disabled':''}><b>Send to a print maker · STL ZIP <span>→</span></b><p>Separate aligned color files for makers who request STL.</p></button><button class="export-card report-export" data-export="pdf" ${blocked?'disabled':''}><b>Send a preview & estimate · PDF <span>→</span></b><p>Front, back, 3D and side views with dimensions, weight, colors and quantity estimate.</p><small>Easy to email for approval</small></button><button class="export-card" data-export="step" ${blocked?'disabled':''}><b>Continue in CAD · STEP <span>→</span></b><p>Validated B-Rep solids rebuilt from the production geometry. Vector objects stay smoother than raster artwork.</p><small>Advanced CAD exchange</small></button></div><details class="friendly-disclosure"><summary>Advanced design files</summary><div class="export-grid"><button class="export-card" data-export="svg"><b>2D design SVG <span>→</span></b><p>Editable two-side design reference in physical millimeters.</p></button><button class="export-card" data-export="json"><b>Editable MedalForge backup <span>→</span></b><p>Reopens every editable word, item, color and manufacturing setting.</p></button></div></details>${statusHtml}<div class="server-option"><div><strong>Private local processing</strong><span>No design or production file is uploaded. The editor reports known design issues; your slicer remains the final authority.</span></div><b>On this device</b></div>`, 'export');
  $$('[data-export]').forEach(button=>button.addEventListener('click',()=>runExport(button.dataset.export)));
  $('#reviewExportBlockers')?.addEventListener('click', showChecksDialog);
}

async function showExportDialog() {
  if (state.liveEdit) { toast('Press OK or Cancel before export'); return; }
  if (state.imageReprocessBusy) { toast('Wait for the printable image update to finish before export'); return; }
  const requestId = uid('export-preflight');
  state.exportPreflightId = requestId;
  renderExportDialog({ preflighting: true });
  try {
    await ensureGeometryResult(message=>{const progress=$('#exportProgress');if(progress)progress.textContent=message;});
    if(!dialog.open || state.exportPreflightId !== requestId || dialog.dataset.context !== 'export')return;
    renderChecks();renderPrice();renderExportDialog();
  } catch(error) {
    if(dialog.open && state.exportPreflightId === requestId && dialog.dataset.context === 'export')renderExportDialog({ error: error.message });
    if(error?.name !== 'AbortError')console.error(error);
  }
}

function productionMeshesForExport(project, job, onProgress) {
  const options = { production: true, validate: true, maxTriangles: 4_000_000 };
  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') return buildMeshes(project, onProgress, options);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./geometry-worker.js', import.meta.url), { type: 'module', name: 'medalforge-production-export' });
    job.worker = worker;
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      job.abortController.signal.removeEventListener('abort', abort);
      if (job.worker === worker) job.worker = null;
      worker.terminate();
      callback(value);
    };
    const done = finish(resolve), fail = finish(reject);
    const abort = () => { const error = new Error('Export cancelled'); error.name = 'AbortError'; fail(error); };
    job.abortController.signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => {
      if (event.data?.id !== job.id) return;
      if (event.data.type === 'progress') { if (!job.cancelled) onProgress(event.data.message); return; }
      if (event.data.type === 'result') done(event.data.result);
      else if (event.data.type === 'error') fail(new Error(event.data.message || 'Geometry export failed'));
    };
    worker.onerror = event => fail(new Error(event.message || 'Geometry export worker failed'));
    worker.postMessage({ id: job.id, project, options });
    if (job.abortController.signal.aborted) abort();
  });
}

async function runExport(kind) {
  if (state.liveEdit) { toast('Press OK or Cancel before export'); return; }
  if (state.imageReprocessBusy) { toast('Wait for the printable image update to finish before export'); return; }
  if (state.exportJob) { toast('An export is already running'); return; }
  const productionKinds = new Set(['3mf', 'stl', 'pdf', 'step']);
  if (productionKinds.has(kind) && state.checks.some(checkBlocksGeometryExport)) {
    toast('Fix the red printability issues before downloading a production file', { error: true });
    return;
  }
  const job = { id: uid('export'), cancelled: false, kind, abortController: new AbortController(), worker: null };
  state.exportJob = job;
  const project=enrichForExport(state.project,state.inventory); const base=safeFilename(project.name); const progress=$('#exportProgress');
  $$('[data-export]').forEach(button => { button.disabled = true; });
  const ensureActive = () => { if (job.cancelled || state.exportJob !== job) { const error = new Error('Export cancelled'); error.name = 'AbortError'; throw error; } };
  const complete = message => { markOnboardingStep('export'); if(progress)progress.textContent=translateUi(message); };
  const update=message=>{if(!job.cancelled && progress && progress.isConnected && dialog.open){progress.classList.remove('error');progress.innerHTML=`<span>${escapeHtml(translateUi(message))}</span><button type="button" class="button secondary" id="cancelExportJob">Stop after current step</button>`;localizeSubtree(progress);$('#cancelExportJob')?.addEventListener('click',()=>{job.cancelled=true;job.abortController.abort();progress.textContent=translateUi(job.worker ? 'Stopping the geometry job…' : 'Stopping after the current export step…');});}};
  try {
    if(kind==='json') { const payload=projectBundleForExport(state.project,state.inventory);ensureActive();downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`${base}.medalforge.json`);complete('Editable backup downloaded.');return; }
    if(kind==='svg') { ensureActive();downloadBlob(new Blob([projectToSvg(project)],{type:'image/svg+xml'}),`${base}.svg`);complete('SVG design reference downloaded.');return; }
    update('Building the final print-file geometry…');
    await document.fonts?.ready;
    const geometry=await productionMeshesForExport(project,job,update);
    ensureActive();
    if(kind==='pdf') {
      update('Rendering front, back, isometric, and technical views…');
      let viewDataUrl = null;
      if (state.viewer && !modelCanvas.hidden) {
        const camera = state.viewer.cameraState(); const gridVisible = state.viewer.showGrid;
        try {
          state.viewer.setDecorMeshes([]);
          state.viewer.setGrid(false); state.viewer.setProjection('perspective'); state.viewer.setPreset('iso'); state.viewer.fit(); state.viewer.renderNow();
          viewDataUrl = modelCanvas.toDataURL('image/png');
        } finally {
          state.viewer.restoreCamera(camera); state.viewer.setGrid(gridVisible); updateRibbonPreview(); state.viewer.renderNow();
        }
      }
      const report = await buildTechnicalSheetPdf({ project: state.project, inventory: state.inventory, geometry, quantity: state.quantity, checks: state.checks, viewDataUrl, locale: getCurrentLocale(), localeTag: getCurrentLocaleTag(), translate: translateUi });
      ensureActive();
      downloadBlob(report.blob, report.filename);
      complete(`PDF downloaded · ${formatLocalizedNumber(report.model.quote.gramsPerPiece, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} g · Kč ${formatLocalizedNumber(report.model.quote.total)} total estimate.`);
      return;
    }
    const {meshes}=geometry;
    if(kind==='step'){
      update('Rebuilding production contours as validated B-Rep solids…');
      const result=await columnsToStep(geometry.sliceData,update,{signal:job.abortController.signal});
      ensureActive();
      downloadBlob(result.blob,`${base}.step`);
      complete(`STEP downloaded · ${result.stats.solidCount} validated solid ${result.stats.solidCount===1?'body':'bodies'} · ${(result.stats.sourceVolumeMm3/1000).toFixed(2)} cm³.`);
    }
    if(kind==='3mf'){update('Streaming and compressing color parts into 3MF…');await new Promise(resolve=>setTimeout(resolve,10));const blob=await meshesTo3mf(project,meshes,{locale:getCurrentLocaleTag()});ensureActive();downloadBlob(blob,`${base}.3mf`);complete(`3MF downloaded with ${meshes.length} aligned filament piece${meshes.length===1?'':'s'}.`);}
    if(kind==='stl'){update('Packaging aligned binary STLs…');const blob=await meshesToStlZip(project,meshes);ensureActive();downloadBlob(blob,`${base}-stl-parts.zip`);complete(`STL ZIP downloaded with ${meshes.length} printable part${meshes.length===1?'':'s'}.`);}
  } catch(error) {
    if(progress && dialog.open){progress.classList.toggle('error', error.name !== 'AbortError');progress.textContent=translateUi(error.name === 'AbortError' ? 'Export cancelled. No download was started.' : `Export failed: ${error.message}`);}
    if(error.name !== 'AbortError')console.error(error);
  } finally {
    job.abortController.abort();
    job.worker?.terminate();
    if(state.exportJob===job)state.exportJob=null;
    if(dialog.open) {
      const blocked = state.checks.some(checkBlocksGeometryExport);
      $$('[data-export]').forEach(button => { button.disabled = productionKinds.has(button.dataset.export) && blocked; });
    }
  }
}

function fileToDataUrl(file) { return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);}); }
function decodeImage(source) { return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('This image could not be decoded'));image.src=source;}); }

function suggestedArtworkCrop(image, background = 'auto') {
  const maximumSide = 768;
  const scale = Math.min(1, maximumSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = width; cropCanvas.height = height;
  const cropContext = cropCanvas.getContext('2d', { willReadFrequently: true });
  cropContext.drawImage(image, 0, 0, width, height);
  return visibleArtworkCrop(cropContext.getImageData(0, 0, width, height), { background, padding: .06 });
}

function suggestedMedalFaceCrop(image) {
  const maximumSide = 768;
  const scale = Math.min(1, maximumSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  return detectMedalFaceCrop(context.getImageData(0, 0, width, height), { background: 'auto', padding: .018 });
}

function inferredMedalFilamentPalette(image, medalFaceDetection) {
  if (!medalFaceDetection?.crop) return { sourceColors: [], surfaceColors: null, matches: [], addIds: [] };
  const maximumSide = 768;
  const scale = Math.min(1, maximumSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const sourceImage = context.getImageData(0, 0, width, height);
  const sourceColors = inferDominantSourceColors(sourceImage, {
    crop: medalFaceDetection.crop,
    circular: true,
    maxColors: 6,
    minimumCoverage: .006,
  });
  const surfaceColors = inferMedalSurfaceColors(sourceImage, { crop: medalFaceDetection.crop });
  const colorsToMatch = [...sourceColors, surfaceColors.base, surfaceColors.rim].filter(Boolean);
  return { sourceColors, surfaceColors, ...matchSourceColorsToFilaments(colorsToMatch, state.inventory, state.project.paletteIds, { maxTotalColors: 6, maxAdditions: 4, maximumDistance: 38 }) };
}

function compactEditableImageSource(source, image) {
  if (!source || !image || (source.length <= 1_400_000 && Math.max(image.naturalWidth, image.naturalHeight) <= 1800)) return source;
  let maximumSide = 1800, output = source;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const scale = Math.min(1, maximumSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    output = canvas.toDataURL('image/webp', Math.max(.68, .88 - attempt * .08));
    if (output.length <= 1_400_000) break;
    maximumSide = Math.round(maximumSide * .72);
  }
  return output;
}

async function safeImageSource(file) {
  if(file.type==='image/svg+xml'||file.name.toLowerCase().endsWith('.svg')){
    const text=await file.text();
    if(/<\s*script|<\s*foreignObject|\son\w+\s*=|(?:href|src)\s*=\s*["']https?:|url\(\s*https?:/i.test(text))throw new Error('SVG contains scripts or external resources. Export a plain geometry-only SVG.');
    return fileToDataUrl(new Blob([text],{type:'image/svg+xml'}));
  }
  return fileToDataUrl(file);
}

function workerQuantize(imageData,palette,minimumComponentPixels=2,minimumStrokePixels=1) {
  return new Promise((resolve,reject)=>{
    if (state.imageWorker) {
      state.imageWorker.worker.terminate();
      const aborted = new Error('Superseded by a newer image conversion'); aborted.name = 'AbortError';
      state.imageWorker.reject(aborted); state.imageWorker = null;
    }
    const worker=new Worker(new URL('./image-worker.js',import.meta.url),{type:'module'});
    const job={worker,reject}; state.imageWorker=job;
    const finish=callback=>value=>{if(state.imageWorker===job)state.imageWorker=null;worker.terminate();callback(value);};
    worker.onmessage=event=>finish(resolve)(event.data); worker.onerror=event=>finish(reject)(new Error(event.message||'Image worker failed'));
    worker.postMessage({pixels:imageData.data.buffer,width:imageData.width,height:imageData.height,palette,minimumComponentPixels,minimumStrokePixels},[imageData.data.buffer]);
  });
}

function rgbaToDataUrl(bytes,width,height){const output=document.createElement('canvas');output.width=width;output.height=height;output.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes),width,height),0,0);return output.toDataURL('image/png');}

function normalizedImageSettings(settings = {}) {
  const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const crop = Array.isArray(settings.crop) && settings.crop.length === 4
    ? settings.crop.map((value, index) => Math.max(0, Math.min(1, finiteOr(value, index < 2 ? 0 : 1))))
    : [0, 0, 1, 1];
  const safeCrop = crop[2] > crop[0] + .02 && crop[3] > crop[1] + .02
    ? crop
    : [0, 0, 1, 1];
  return {
    style: ['color', 'silhouette', 'high-contrast', 'outline'].includes(settings.style) ? settings.style : 'color',
    background: ['auto', 'keep', 'light', 'dark'].includes(settings.background) ? settings.background : 'auto',
    detail: Math.max(0, Math.min(100, finiteOr(settings.detail, 60))),
    threshold: Math.max(0, Math.min(255, finiteOr(settings.threshold, 138))),
    invert: Boolean(settings.invert),
    crop: safeCrop,
    activeSlots: Array.isArray(settings.activeSlots) ? [...new Set(settings.activeSlots.map(Number).filter(Number.isInteger))] : [],
  };
}

function fitLockedImageSize(aspect, requested, anchor = 'width') {
  const ratio = Number(aspect);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const minimumWidth = 3, maximumWidth = DESIGN_LIMITS.imageSizeMax, minimumHeight = 2, maximumHeight = DESIGN_LIMITS.imageSizeMax;
  const allowedWidthMinimum = Math.max(minimumWidth, minimumHeight * ratio);
  const allowedWidthMaximum = Math.min(maximumWidth, maximumHeight * ratio);
  if (allowedWidthMinimum > allowedWidthMaximum + 1e-6) return null;
  const preferredWidth = anchor === 'height' ? Number(requested) * ratio : Number(requested);
  const width = Math.max(allowedWidthMinimum, Math.min(allowedWidthMaximum, Number.isFinite(preferredWidth) ? preferredWidth : allowedWidthMinimum));
  return { width, height: width / ratio };
}

function croppedImageAspect(session, crop = session.settings.crop) {
  return session.image.naturalWidth * (crop[2] - crop[0]) / Math.max(1, session.image.naturalHeight * (crop[3] - crop[1]));
}

async function quantizeImageSource(source, physicalWidth, physicalHeight, progress = () => {}, decodedImage = null, requestedSettings = {}, options = {}) {
  const image = decodedImage || await decodeImage(source);
  if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('Image dimensions are too large. Resize it below 40 megapixels first.');
  const settings = normalizedImageSettings(requestedSettings);
  const aspect = physicalWidth / physicalHeight;
  const bead = state.project.profile.nozzle * 1.125;
  const samplingCell = Math.max(.05, state.project.profile.nozzle * (.5 - settings.detail * .0038));
  const longestPhysical = Math.max(physicalWidth, physicalHeight);
  // The editor uses the same manufacturing-quality raster that will be placed.
  // Upscaling a tiny preview was a major source of the old blocky appearance
  // and also made click selection land on different regions after applying.
  const longestPixels = Math.max(32, Math.min(1024, Math.round(longestPhysical / samplingCell)));
  const pixelWidth = Math.max(8, Math.round(aspect >= 1 ? longestPixels : longestPixels * aspect));
  const pixelHeight = Math.max(8, Math.round(aspect >= 1 ? longestPixels / aspect : longestPixels));
  progress(`Reducing ${image.naturalWidth}×${image.naturalHeight} pixels to ${pixelWidth}×${pixelHeight} printable cells…`);
  const work = document.createElement('canvas'); work.width = pixelWidth; work.height = pixelHeight;
  const workContext = work.getContext('2d', { willReadFrequently: true });
  const [x0, y0, x1, y1] = settings.crop;
  const sourceX = Math.round(x0 * image.naturalWidth), sourceY = Math.round(y0 * image.naturalHeight);
  const sourceWidth = Math.max(1, Math.round((x1 - x0) * image.naturalWidth)), sourceHeight = Math.max(1, Math.round((y1 - y0) * image.naturalHeight));
  workContext.imageSmoothingEnabled = true;
  workContext.imageSmoothingQuality = 'high';
  workContext.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, pixelWidth, pixelHeight);
  const palette = getPalette(state.project, state.inventory);
  const requestedSlots = settings.activeSlots.filter(slot => slot >= 0 && slot < palette.length);
  const activeSlots = requestedSlots.length ? requestedSlots : palette.map((_, slot) => slot);
  const activePalette = activeSlots.map(slot => palette[slot]);
  let raster = removeConnectedBackground(workContext.getImageData(0, 0, pixelWidth, pixelHeight), {
    mode: settings.background,
    tolerance: 38,
  });
  if (options.circularFace) raster = maskOutsideCircularFace(raster);
  const physicalCell = Math.max(physicalWidth / pixelWidth, physicalHeight / pixelHeight);
  const minimumComponentPixels = Math.max(2, Math.round(Math.PI * (bead / 2) ** 2 / (physicalCell * physicalCell)));
  // Keep a small safety margin above one nominal extrusion line. Artwork can
  // still be scaled down slightly while it is auto-fitted to a circular face;
  // rounding to the nearest cell used to turn a valid 0.45 mm stroke into a
  // 0.43 mm preflight blocker after that final fit.
  const minimumStrokePixels = Math.max(1, Math.ceil(bead * 1.08 / physicalCell));
  raster = applyImageStyle(raster, { style: settings.style, threshold: settings.threshold, invert: settings.invert, outlineRadius: Math.max(1, Math.ceil(minimumStrokePixels / 2)) });
  // workerQuantize transfers (and therefore detaches) the raster buffer. Keep a
  // compact copy only while the image-object editor is open so segmentation can
  // distinguish source-color boundaries that share one final filament color.
  const segmentationSource = options.segment && settings.style === 'color' ? new Uint8ClampedArray(raster.data) : null;
  const result = await workerQuantize(raster, activePalette.map(item => hexToRgb(item.color)), minimumComponentPixels, minimumStrokePixels);
  const indices = new Uint8Array(result.indices);
  const maskUrls = Array(palette.length).fill(null);
  const usedSlots = [];
  for (let localSlot = 0; localSlot < activePalette.length; localSlot += 1) {
    const slot = activeSlots[localSlot], color = hexToRgb(palette[slot].color), mask = new Uint8ClampedArray(pixelWidth * pixelHeight * 4);
    let usedPixels = 0;
    for (let index = 0; index < indices.length; index += 1) {
      if (indices[index] !== localSlot) continue;
      usedPixels += 1;
      const offset = index * 4; mask[offset] = color[0]; mask[offset + 1] = color[1]; mask[offset + 2] = color[2]; mask[offset + 3] = 255;
    }
    maskUrls[slot] = usedPixels ? rgbaToDataUrl(mask, pixelWidth, pixelHeight) : null;
    if (usedPixels) usedSlots.push(slot);
  }
  const printable = {
    dataUrl: rgbaToDataUrl(result.pixels, pixelWidth, pixelHeight), maskUrls, usedSlots,
    pixelWidth, pixelHeight, detailCell: physicalCell,
    minimumFeature: minimumStrokePixels * physicalCell,
    footprint: indexedRasterFootprint(indices, pixelWidth, pixelHeight),
    imageSettings: settings,
  };
  if (!options.segment) return printable;
  const segmented = segmentPaletteRegions(indices, pixelWidth, pixelHeight, {
    maxRegions: Math.max(4, Math.min(14, DESIGN_LIMITS.elements - state.project.elements.length)),
    sourcePixels: segmentationSource,
    sourceColorTolerance: 34,
  });
  const regions = segmented.regions.map(region => ({ ...region, localSlot: region.slot, slot: activeSlots[region.slot] ?? activeSlots[0] ?? 0 }));
  return { ...printable, editorSegmentation: { indices, activeSlots, regions, regionMap: segmented.regionMap } };
}

function printableImageFields(processed) {
  return {
    dataUrl: processed.dataUrl,
    maskUrls: processed.maskUrls,
    usedSlots: processed.usedSlots,
    pixelWidth: processed.pixelWidth,
    pixelHeight: processed.pixelHeight,
    detailCell: processed.detailCell,
    minimumFeature: processed.minimumFeature,
    footprint: processed.footprint,
    imageSettings: processed.imageSettings,
  };
}

function classifyMedalFaceRegions(segmentation, width, height) {
  if (!segmentation?.regions?.length) return;
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  const radius = Math.max(1, Math.min(width, height) / 2);
  // Cleanup can leave a sparse remainder of a textured face or annulus. It is
  // still easy to recognize geometrically because it spans almost the entire
  // detected disk. Treat it as medal construction, not as a giant artwork
  // object that forces all useful lettering to shrink with its square bounds.
  for (const region of segmentation.regions) {
    const boxWidth = (region.maxX - region.minX + 1) / width;
    const boxHeight = (region.maxY - region.minY + 1) / height;
    if (region.role === 'text' || boxWidth < .86 || boxHeight < .86) continue;
    let annulusPixels = 0, interiorPixels = 0;
    for (const pixel of region.pixels) {
      const x = pixel % width, y = Math.floor(pixel / width);
      const distance = Math.hypot(x - cx, y - cy) / radius;
      if (distance >= .78 && distance <= 1.04) annulusPixels += 1;
      if (distance <= .66) interiorPixels += 1;
    }
    const annulusShare = annulusPixels / Math.max(1, region.area);
    const interiorShare = interiorPixels / Math.max(1, region.area);
    region.role = annulusShare >= .48 && interiorShare < .24 ? 'rim' : 'background';
    region.medalSurfaceResidue = true;
  }
  let best = null, bestScore = .54;
  for (const region of segmentation.regions) {
    if (region.role === 'text' || region.role === 'background' || region.role === 'rim' || region.area < segmentation.visiblePixels * .008) continue;
    let ringPixels = 0, centerPixels = 0;
    for (const pixel of region.pixels) {
      const x = pixel % width, y = Math.floor(pixel / width);
      const distance = Math.hypot(x - cx, y - cy) / radius;
      if (distance >= .78 && distance <= 1.05) ringPixels += 1;
      if (distance <= .55) centerPixels += 1;
    }
    const ringShare = ringPixels / region.area, centerShare = centerPixels / region.area;
    const span = Math.min((region.maxX - region.minX + 1) / width, (region.maxY - region.minY + 1) / height);
    const score = ringShare * .75 + Math.min(1, span) * .35 - centerShare * .5;
    if (span >= .64 && score > bestScore) { best = region; bestScore = score; }
  }
  if (best) best.role = 'rim';
}

function inferredMedalFaceColors(session, processed) {
  const regions = syncImagePartPreferences(session, processed);
  const base = regions.find(region => region.role === 'background') || [...regions].sort((left, right) => right.area - left.area)[0];
  const rim = regions.find(region => region.role === 'rim');
  const palette = getPalette(state.project, state.inventory);
  const sourceSlot = sourceColor => {
    if (!sourceColor || !palette.length) return null;
    const matched = matchSourceColorsToFilaments([sourceColor], palette, [], { maximumDistance: 200, maxTotalColors: 1, maxAdditions: 0 }).matches[0];
    const slot = matched ? palette.findIndex(item => item.id === matched.id) : -1;
    return slot >= 0 ? slot : null;
  };
  const sourceBase = sourceSlot(session.medalSurfaceColors?.base);
  const sourceRim = sourceSlot(session.medalSurfaceColors?.rim);
  return {
    baseColor: sourceBase ?? session.partPreferences.get(base?.editorKey)?.color ?? base?.slot ?? state.project.medal.baseColor,
    rimColor: sourceRim ?? sourceBase ?? session.partPreferences.get(rim?.editorKey)?.color ?? rim?.slot ?? session.partPreferences.get(base?.editorKey)?.color ?? state.project.medal.rimColor,
  };
}

async function reprocessImportedImages(reason = 'profile change', onlyId = null) {
  const sources = state.project.elements.filter(element => element.type === 'image' && element.sourceDataUrl && (!onlyId || element.id === onlyId)).map(element => ({ id: element.id, source: element.sourceDataUrl, width: element.width * (Number(element.scaleX) || 1), height: element.height * (Number(element.scaleY) || 1), settings: element.imageSettings }));
  if (!sources.length) return;
  const token = ++state.imageReprocessToken;
  state.imageReprocessBusy = true;
  toast(`Updating ${sources.length} image${sources.length === 1 ? '' : 's'} for the ${reason}…`);
  try {
    const replacements = [];
    for (const source of sources) {
      const processed = await quantizeImageSource(source.source, source.width, source.height, () => {}, null, source.settings);
      if (token !== state.imageReprocessToken) return;
      replacements.push({ id: source.id, width: source.width, height: source.height, processed });
    }
    if (token !== state.imageReprocessToken) return;
    for (const replacement of replacements) {
      const element = state.project.elements.find(item => item.id === replacement.id);
      if (element) Object.assign(element, printableImageFields(replacement.processed), { width: replacement.width, height: replacement.height, scaleX: 1, scaleY: 1 });
    }
    state.project = normalizeProject(state.project);
    markDirty();
    renderAll({ panel: state.panel === 'layers' });
    toast('Imported artwork remapped to the current printable palette');
  } catch (error) {
    if (token !== state.imageReprocessToken) return;
    toast(`Image remap failed: ${error.message}`);
    console.error(error);
  } finally {
    if (token === state.imageReprocessToken) state.imageReprocessBusy = false;
  }
}

function prepareEditorSegmentation(processed) {
  const segmentation = processed?.editorSegmentation;
  if (!segmentation || segmentation.prepared) return segmentation;
  segmentation.prepared = true;
  const width = processed.pixelWidth, height = processed.pixelHeight;
  if (processed.editorMedalFace) classifyMedalFaceRegions(segmentation, width, height);
  const background = segmentation.regions.find(region => region.role === 'background');
  const candidates = segmentation.regions.filter(region => {
    if (region === background || region.role === 'rim' || region.role === 'text' || region.coverage < .003) return false;
    const boxWidth = (region.maxX - region.minX + 1) / width, boxHeight = (region.maxY - region.minY + 1) / height;
    const centerX = (region.minX + region.maxX + 1) / 2 / width, centerY = (region.minY + region.maxY + 1) / 2 / height;
    const crossesRunnerLine = region.minX / width <= .54 && (region.maxX + 1) / width >= .46;
    return (crossesRunnerLine || (centerX >= .38 && centerX <= .62)) && centerY >= .25 && centerY <= .86 && boxWidth < .58 && !(boxWidth > .48 && boxHeight < .18);
  });
  if (candidates.length < 2) return segmentation;
  const minX = Math.min(...candidates.map(region => region.minX)), minY = Math.min(...candidates.map(region => region.minY));
  const maxX = Math.max(...candidates.map(region => region.maxX)), maxY = Math.max(...candidates.map(region => region.maxY));
  const area = candidates.reduce((sum, region) => sum + region.area, 0);
  const subjectHeight = (maxY - minY + 1) / height;
  const subjectCoverage = area / Math.max(1, segmentation.visiblePixels || segmentation.regions.reduce((sum, region) => sum + region.area, 0));
  if (subjectHeight < .28 || subjectCoverage > .42) return segmentation;
  const dominant = [...candidates].sort((left, right) => right.area - left.area)[0];
  const subject = {
    id: 'part-main-subject', key: `semantic-subject:${Math.round(minX / width * 24)}:${Math.round(minY / height * 24)}:${Math.round(maxX / width * 24)}:${Math.round(maxY / height * 24)}`,
    slot: dominant.slot, localSlot: dominant.localSlot, pixels: candidates.flatMap(region => region.pixels), area,
    minX, minY, maxX, maxY,
    centerX: candidates.reduce((sum, region) => sum + region.centerX * region.area, 0) / area,
    centerY: candidates.reduce((sum, region) => sum + region.centerY * region.area, 0) / area,
    coverage: subjectCoverage, borderSides: 0, collection: true,
    mixedSlots: new Set(candidates.map(region => region.slot)).size > 1, role: 'subject', semantic: true,
  };
  const candidateSet = new Set(candidates);
  const remaining = segmentation.regions.filter(region => !candidateSet.has(region)).map(region => region.role === 'subject' ? { ...region, role: region.collection ? 'details' : 'detail' } : region);
  segmentation.regions = [subject, ...remaining].sort((left, right) => {
    const rank = region => region.role === 'background' ? 0 : region.role === 'subject' ? 1 : 2;
    return rank(left) - rank(right) || right.area - left.area;
  });
  segmentation.regionMap = new Int16Array(width * height); segmentation.regionMap.fill(-1);
  segmentation.regions.forEach((region, regionIndex) => { region.id = `part-${regionIndex + 1}`; for (const pixel of region.pixels) segmentation.regionMap[pixel] = regionIndex; });
  return segmentation;
}

function syncImagePartPreferences(session, processed) {
  const segmentation = prepareEditorSegmentation(processed);
  if (!segmentation) return [];
  if (!(session.partPreferences instanceof Map)) session.partPreferences = new Map();
  const palette = getPalette(state.project, state.inventory);
  const keyCounts = new Map(), roleCounts = new Map();
  const roleLabel = { subject: 'Main subject', background: 'Medal face color', rim: 'Outer rim color', text: 'Possible text line', horizon: 'Skyline / ground', details: 'Fine details', detail: 'Detail' };
  for (const region of segmentation.regions) {
    const duplicate = keyCounts.get(region.key) || 0;
    keyCounts.set(region.key, duplicate + 1);
    region.editorKey = `${region.key}:${duplicate}`;
    if (session.partPreferences.has(region.editorKey)) continue;
    const ordinal = (roleCounts.get(region.role) || 0) + 1;
    roleCounts.set(region.role, ordinal);
    const base = roleLabel[region.role] || 'Part';
    const name = ordinal > 1 || region.role === 'detail' ? `${base} ${ordinal}` : base;
    const suggestedHeight = region.role === 'background'
      ? state.project.profile.layerHeight
      : region.role === 'horizon'
        ? Math.max(.4, state.project.profile.layerHeight)
        : region.role === 'subject'
          ? Math.max(.8, state.project.medal.defaultHeight)
          : Math.max(.4, state.project.medal.defaultHeight);
    session.partPreferences.set(region.editorKey, {
      enabled: !(session.medalFaceDetection && ['background', 'rim'].includes(region.role)),
      name,
      color: Math.max(0, Math.min(palette.length - 1, Number(region.slot) || 0)),
      operation: 'raise',
      amount: Math.min(DESIGN_LIMITS.reliefHeightMax, snapToLayer(suggestedHeight, state.project.profile.layerHeight)),
      replaceWithText: false,
      text: '',
    });
  }
  const valid = new Set(segmentation.regions.map(region => region.editorKey));
  for (const key of session.partPreferences.keys()) if (!valid.has(key)) session.partPreferences.delete(key);
  if (!valid.has(session.selectedPartKey)) session.selectedPartKey = segmentation.regions.find(region => region.role === 'subject')?.editorKey || segmentation.regions[0]?.editorKey || null;
  return segmentation.regions;
}

function enabledImagePartCount(session, processed = session.latest) {
  return syncImagePartPreferences(session, processed).filter(region => session.partPreferences.get(region.editorKey)?.enabled).length;
}

function refreshImageEditorApplyButton(session) {
  const button = $('#applyImageEditor');
  if (!button || !session || session.applying) return;
  if (session.targetId) button.textContent = 'Update artwork';
  else if (session.placementMode === 'parts') {
    const count = enabledImagePartCount(session);
    button.textContent = count ? `Place ${count} editable object${count === 1 ? '' : 's'} together` : 'Choose at least one object';
    button.disabled = !count || !session.latest?.usedSlots?.length;
  } else {
    button.textContent = 'Place whole image';
    button.disabled = !session.latest?.usedSlots?.length;
  }
}

function renderImagePartsPanel(session) {
  const root = $('#imagePartsPanel');
  if (!root) return;
  if (session.placementMode !== 'parts') {
    root.innerHTML = '<div class="image-parts-empty"><strong>One simple object</strong><span>The complete image will move, scale, recolor, and change height as one piece.</span></div>';
    refreshImageEditorApplyButton(session);
    return;
  }
  const regions = syncImagePartPreferences(session, session.latest);
  if (!regions.length) {
    root.innerHTML = '<div class="image-parts-empty"><strong>Finding printable objects…</strong><span>Runner, background, skyline, and other connected regions will appear here.</span></div>';
    refreshImageEditorApplyButton(session);
    return;
  }
  const palette = getPalette(state.project, state.inventory);
  const selectedRegion = regions.find(region => region.editorKey === session.selectedPartKey) || regions[0];
  const selected = session.partPreferences.get(selectedRegion.editorKey);
  const rows = regions.map(region => {
    const preference = session.partPreferences.get(region.editorKey);
    const color = palette[preference.color] || palette[0];
    const boxWidth = (region.maxX - region.minX + 1) / session.latest.pixelWidth * session.width;
    const boxHeight = (region.maxY - region.minY + 1) / session.latest.pixelHeight * session.height;
    return `<div class="image-part-row ${region.editorKey === session.selectedPartKey ? 'selected' : ''} ${preference.enabled ? '' : 'excluded'}" data-part-row="${escapeHtml(region.editorKey)}"><label class="image-part-keep" title="Include this object"><input type="checkbox" data-part-enabled="${escapeHtml(region.editorKey)}" ${preference.enabled ? 'checked' : ''}></label><button type="button" data-part-select="${escapeHtml(region.editorKey)}"><i style="background:${color.color}"></i><span><strong data-i18n-ignore>${escapeHtml(preference.name)}</strong><small>${boxWidth.toFixed(1)} × ${boxHeight.toFixed(1)} mm · ${Math.round(region.coverage * 100)}%</small></span></button></div>`;
  }).join('');
  const availableDepth = Math.max(.05, state.project.medal.baseThickness - state.project.medal.minimumFloor);
  const amountMaximum = selected.operation === 'raise' ? DESIGN_LIMITS.reliefHeightMax : availableDepth;
  const textReplacement = selectedRegion.role === 'text' ? `<div class="image-text-replacement"><div><strong>Likely lettering detected</strong><small>${session.textDetectionStatus || 'Type the wording you see to rebuild it as crisp, editable text.'}</small></div><label><span>Editable wording</span><input class="text-input" id="imagePartText" maxlength="80" value="${escapeHtml(selected.text || '')}" placeholder="Type this line exactly"></label><label class="check-row compact-check"><input type="checkbox" id="imagePartAsText" ${selected.replaceWithText ? 'checked' : ''} ${selected.text?.trim() ? '' : 'disabled'}><span><strong>Replace pixels with real text</strong><small>Sharper export, editable font and wording after placement.</small></span></label></div>` : '';
  const detectedMedalHint = session.medalFaceDetection ? '<small>Face and rim colors are applied to the medal itself, so they are unchecked by default.</small>' : '<small>Each checked part becomes its own editable design item.</small>';
  root.innerHTML = `<div class="image-parts-head"><span><strong>Click the picture or a part</strong>${detectedMedalHint}</span><button type="button" id="includeAllImageParts">Keep all</button></div><div class="image-parts-list">${rows}</div><div class="image-part-inspector"><div class="image-part-inspector-head"><strong>Selected object</strong><button type="button" id="onlyThisImagePart">Use only this</button></div><label><span>Name</span><input class="text-input" id="imagePartName" maxlength="40" value="${escapeHtml(selected.name)}"></label>${textReplacement}<div class="property-grid"><label><span>Filament color</span><div class="select-with-add-color"><select class="select-input" id="imagePartColor">${palette.map((item, slot) => `<option value="${slot}" ${slot === selected.color ? 'selected' : ''}>${slot + 1} · ${escapeHtml(item.name)}</option>`).join('')}</select>${inlineAddColorButtonHtml('image-part', { compact: true })}</div></label><label><span>Surface</span><select class="select-input" id="imagePartOperation"><option value="raise" ${selected.operation === 'raise' ? 'selected' : ''}>Raised</option><option value="inlay" ${selected.operation === 'inlay' ? 'selected' : ''}>Flat color</option><option value="engrave" ${selected.operation === 'engrave' ? 'selected' : ''}>Recessed</option><option value="cut" ${selected.operation === 'cut' ? 'selected' : ''}>Through hole</option></select></label></div><label class="image-part-amount ${selected.operation === 'cut' ? 'disabled' : ''}"><span>${selected.operation === 'raise' ? 'Height' : 'Depth'} <small>${layerCountLabel(selected.amount)}</small></span><div class="unit-input"><input id="imagePartAmount" type="number" min="${state.project.profile.layerHeight}" max="${amountMaximum}" step="${state.project.profile.layerHeight}" value="${selected.amount.toFixed(2)}" ${selected.operation === 'cut' ? 'disabled' : ''}><em>mm</em></div></label><p class="field-help">After placement, click this object in 3D to move, scale, recolor, or drag its blue height handle.</p></div>`;
  bindInlineAddColorButtons(root);
  root.querySelectorAll('[data-part-select]').forEach(button => button.addEventListener('click', () => {
    session.selectedPartKey = button.dataset.partSelect; renderImagePartsPanel(session); drawImageEditorPreview(session.latest, session, session.previewToken);
  }));
  root.querySelectorAll('[data-part-enabled]').forEach(input => input.addEventListener('change', () => {
    const preference = session.partPreferences.get(input.dataset.partEnabled); if (preference) preference.enabled = input.checked;
    renderImagePartsPanel(session); drawImageEditorPreview(session.latest, session, session.previewToken);
  }));
  root.querySelectorAll('[data-part-row]').forEach(row => {
    row.addEventListener('pointerenter', () => { session.hoverPartKey = row.dataset.partRow; drawImageEditorPreview(session.latest, session, session.previewToken); });
    row.addEventListener('pointerleave', () => { session.hoverPartKey = null; drawImageEditorPreview(session.latest, session, session.previewToken); });
  });
  $('#includeAllImageParts')?.addEventListener('click', () => {
    session.partPreferences.forEach(preference => { preference.enabled = true; }); renderImagePartsPanel(session); drawImageEditorPreview(session.latest, session, session.previewToken);
  });
  $('#onlyThisImagePart')?.addEventListener('click', () => {
    session.partPreferences.forEach((preference, key) => { preference.enabled = key === session.selectedPartKey; }); renderImagePartsPanel(session); drawImageEditorPreview(session.latest, session, session.previewToken);
  });
  $('#imagePartName')?.addEventListener('input', event => { selected.name = event.target.value.slice(0, 40) || 'Image part'; });
  $('#imagePartText')?.addEventListener('input', event => {
    selected.text = event.target.value.slice(0, 80);
    selected.replaceWithText = Boolean(selected.text.trim());
    const checkbox = $('#imagePartAsText'); if (checkbox) { checkbox.disabled = !selected.text.trim(); checkbox.checked = selected.replaceWithText; }
  });
  $('#imagePartAsText')?.addEventListener('change', event => { selected.replaceWithText = event.target.checked && Boolean(selected.text.trim()); });
  $('#imagePartColor')?.addEventListener('change', event => { selected.color = Number(event.target.value); renderImagePartsPanel(session); drawImageEditorPreview(session.latest, session, session.previewToken); });
  $('#imagePartOperation')?.addEventListener('change', event => { selected.operation = event.target.value; renderImagePartsPanel(session); });
  $('#imagePartAmount')?.addEventListener('input', event => {
    const value = Number(event.target.value);
    if (Number.isFinite(value)) selected.amount = Math.max(state.project.profile.layerHeight, Math.min(amountMaximum, value));
  });
  $('#imagePartAmount')?.addEventListener('change', event => {
    selected.amount = Math.max(state.project.profile.layerHeight, Math.min(amountMaximum, snapToLayer(Number(event.target.value), state.project.profile.layerHeight)));
    renderImagePartsPanel(session);
  });
  refreshImageEditorApplyButton(session);
}

function buildSegmentedImageAssembly(session, processed) {
  const regions = syncImagePartPreferences(session, processed);
  const palette = getPalette(state.project, state.inventory);
  const groupId = uid('image-group').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 120);
  const groupName = `${session.name || 'Imported image'} · editable parts`.slice(0, 60);
  const parts = [];
  let preferredId = null;
  for (const region of regions) {
    const preference = session.partPreferences.get(region.editorKey);
    if (!preference?.enabled) continue;
    const minimumBoxWidth = Math.max(1, Math.ceil(processed.pixelWidth / Math.max(1, session.width)));
    const minimumBoxHeight = Math.max(1, Math.ceil(processed.pixelHeight / Math.max(1, session.height)));
    let minX = region.minX, minY = region.minY, maxX = region.maxX, maxY = region.maxY;
    const expandAxis = (minimum, maximum, target, limit) => {
      let low = minimum, high = maximum;
      while (high - low + 1 < target && (low > 0 || high < limit - 1)) { if (low > 0) low -= 1; if (high - low + 1 < target && high < limit - 1) high += 1; }
      return [low, high];
    };
    [minX, maxX] = expandAxis(minX, maxX, minimumBoxWidth, processed.pixelWidth);
    [minY, maxY] = expandAxis(minY, maxY, minimumBoxHeight, processed.pixelHeight);
    const pixelWidth = maxX - minX + 1, pixelHeight = maxY - minY + 1;
    const bytes = new Uint8ClampedArray(pixelWidth * pixelHeight * 4);
    const colorSlot = Math.max(0, Math.min(palette.length - 1, preference.color));
    const rgb = hexToRgb(palette[colorSlot]?.color || '#315ff4');
    for (const sourceIndex of region.pixels) {
      const sourceX = sourceIndex % processed.pixelWidth, sourceY = Math.floor(sourceIndex / processed.pixelWidth);
      const targetOffset = ((sourceY - minY) * pixelWidth + sourceX - minX) * 4;
      bytes[targetOffset] = rgb[0]; bytes[targetOffset + 1] = rgb[1]; bytes[targetOffset + 2] = rgb[2]; bytes[targetOffset + 3] = 255;
    }
    const dataUrl = rgbaToDataUrl(bytes, pixelWidth, pixelHeight);
    const width = pixelWidth / processed.pixelWidth * session.width;
    const height = pixelHeight / processed.pixelHeight * session.height;
    const offsetX = ((minX + maxX + 1) / 2 / processed.pixelWidth - .5) * session.width;
    const offsetY = ((minY + maxY + 1) / 2 / processed.pixelHeight - .5) * session.height;
    const maskUrls = Array(palette.length).fill(null); maskUrls[colorSlot] = dataUrl;
    const footprint = rasterRegionFootprint(region.pixels, processed.pixelWidth, processed.pixelHeight, { minX, minY, maxX, maxY });
    const availableDepth = Math.max(.05, state.project.medal.baseThickness - state.project.medal.minimumFloor);
    const amount = preference.operation === 'raise' ? Math.min(DESIGN_LIMITS.reliefHeightMax, preference.amount) : Math.min(availableDepth, preference.amount);
    let element = {
      id: uid('image-part'), type: 'image', rasterKind: 'segment', regionRole: region.role,
      name: preference.name || 'Image part', x: 0, y: 0, width, height, rotation: 0,
      color: colorSlot, opacity: 1, sourceDataUrl: dataUrl, sourceWidth: pixelWidth, sourceHeight: pixelHeight,
      dataUrl, maskUrls, usedSlots: [colorSlot], pixelWidth, pixelHeight,
      detailCell: processed.detailCell, minimumFeature: processed.minimumFeature, footprint,
      imageSettings: { ...processed.imageSettings, style: 'silhouette', background: 'keep', crop: [0, 0, 1, 1], activeSlots: [colorSlot] },
      hidden: false, face: 'front', groupId, scaleX: 1, scaleY: 1, lockAspect: true,
      operation: preference.operation, zHeight: preference.operation === 'raise' ? amount : state.project.medal.defaultHeight,
      zDepth: ['engrave', 'inlay'].includes(preference.operation) ? amount : Math.min(.4, availableDepth),
      inlayHeight: 0, layerSnap: true, combine: 'replace', locked: false,
    };
    if (region.role === 'text' && preference.replaceWithText && preference.text.trim()) {
      element = {
        id: uid('image-text'), type: 'text', regionRole: 'text',
        name: preference.text.trim().slice(0, 24), text: preference.text.trim(), x: 0, y: 0,
        fontSize: Math.max(1, Math.min(DESIGN_LIMITS.textSizeMax, height * .88)),
        fontFamily: 'Arial', weight: 900, rotation: 0, color: colorSlot, hidden: false,
        face: 'front', groupId, scaleX: 1, scaleY: 1, lockAspect: true,
        operation: preference.operation, zHeight: preference.operation === 'raise' ? amount : state.project.medal.defaultHeight,
        zDepth: ['engrave', 'inlay'].includes(preference.operation) ? amount : Math.min(.4, availableDepth),
        inlayHeight: 0, layerSnap: true, combine: 'replace', locked: false,
      };
    }
    if (!preferredId || region.role === 'subject') preferredId = element.id;
    parts.push({ element, offsetX, offsetY });
  }
  if (!parts.length) throw new Error('Choose at least one image object.');
  const preview = {
    id: uid('image-preview'), type: 'image', name: groupName, x: 0, y: 0,
    width: session.width, height: session.height, rotation: 0, color: 0, opacity: 1,
    dataUrl: processed.dataUrl, hidden: false, ...operationDefaults(), scaleX: 1, scaleY: 1, lockAspect: true,
  };
  return { preview, assembly: { parts, group: { id: groupId, name: groupName }, preferredId } };
}

function segmentedAssemblyFitFactor(assembly) {
  const fitsAt = factor => assembly.parts.every(part => elementPlacementFits({
    ...part.element,
    x: part.offsetX * factor,
    y: part.offsetY * factor,
    face: 'front',
    scaleX: (Number(part.element.scaleX) || 1) * factor,
    scaleY: (Number(part.element.scaleY) || 1) * factor,
  }));
  if (fitsAt(1)) return 1;
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 22; iteration += 1) {
    const factor = (low + high) / 2;
    if (fitsAt(factor)) low = factor;
    else high = factor;
  }
  return Math.max(0, low);
}

function excludeAutomaticMedalSurfaceParts(session, processed) {
  for (const region of syncImagePartPreferences(session, processed)) {
    if (!['background', 'rim'].includes(region.role) && !region.medalSurfaceResidue) continue;
    const preference = session.partPreferences.get(region.editorKey);
    if (preference) preference.enabled = false;
  }
}

async function requantizeAutomaticAssemblyAtFinalSize(session, initialProcessed, progress = () => {}) {
  let processed = initialProcessed;
  const oneBead = state.project.profile.nozzle * 1.125;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    processed.editorMedalFace = session.medalFaceDetection || null;
    excludeAutomaticMedalSurfaceParts(session, processed);
    const { assembly } = buildSegmentedImageAssembly(session, processed);
    const fitFactor = segmentedAssemblyFitFactor(assembly);
    const finalFeature = processed.minimumFeature * fitFactor;
    if (fitFactor >= .995 && finalFeature >= oneBead) return processed;
    if (!(fitFactor > .01)) throw new Error('The detected artwork cannot fit inside this medal face. Reduce the edge width or use a larger medal.');

    // Do not scale the already-rasterized printable cells. That turns a valid
    // one-line feature into a sub-nozzle feature. Instead, establish the safe
    // physical span first, then quantize the source again at that final size so
    // morphology is rebuilt using real nozzle-width cells.
    const physicalFactor = Math.min(.985, Math.max(.2, fitFactor * .985));
    session.width = Math.max(3, session.width * physicalFactor);
    session.height = Math.max(2, session.height * physicalFactor);
    progress(`Fitting artwork to ${session.width.toFixed(1)} × ${session.height.toFixed(1)} mm, then rebuilding printable detail…`);
    processed = await quantizeImageSource(session.source, session.width, session.height, progress, session.image, session.settings, { segment: true, circularFace: Boolean(session.medalFaceDetection) });
    session.latest = processed;
  }
  processed.editorMedalFace = session.medalFaceDetection || null;
  excludeAutomaticMedalSurfaceParts(session, processed);
  const { assembly } = buildSegmentedImageAssembly(session, processed);
  const fitFactor = segmentedAssemblyFitFactor(assembly);
  if (processed.minimumFeature * fitFactor < oneBead - .001) throw new Error('The source contains details that cannot fit as one printable extrusion line on this medal.');
  return processed;
}

function placeSegmentedAssemblyCentered(session, processed) {
  excludeAutomaticMedalSurfaceParts(session, processed);
  const { assembly } = buildSegmentedImageAssembly(session, processed);
  if (state.project.elements.length + assembly.parts.length > DESIGN_LIMITS.elements) throw new Error(`This medal has room for only ${Math.max(0, DESIGN_LIMITS.elements - state.project.elements.length)} more objects.`);
  if (state.project.groups.length >= DESIGN_LIMITS.groups) throw new Error(`This medal already has the safe maximum of ${DESIGN_LIMITS.groups} groups.`);
  const finalScale = segmentedAssemblyFitFactor(assembly);
  const oneBead = state.project.profile.nozzle * 1.125;
  if (processed.minimumFeature * finalScale < oneBead - .001) throw new Error('Automatic placement would make details thinner than one extrusion line. Rebuild the image at a smaller physical span.');
  const colors = inferredMedalFaceColors(session, processed);
  const placed = assembly.parts.map(part => ({
    ...part.element,
    x: part.offsetX * finalScale,
    y: part.offsetY * finalScale,
    face: 'front',
    scaleX: (Number(part.element.scaleX) || 1) * finalScale,
    scaleY: (Number(part.element.scaleY) || 1) * finalScale,
    groupId: assembly.group.id,
  }));
  state.selectedId = assembly.preferredId || placed[0]?.id || null;
  commit(project => {
    project.medal.baseColor = Math.max(0, Math.min(project.paletteIds.length - 1, Number(colors.baseColor) || 0));
    project.medal.rimColor = Math.max(0, Math.min(project.paletteIds.length - 1, Number(colors.rimColor) || 0));
    project.groups.push({ ...assembly.group, name: `${session.name || 'Imported design'} · automatic front`.slice(0, 60) });
    project.elements.push(...placed);
    project.template = 'custom';
  });
  closeDialog();
  renderAll({ panel: state.panel === 'layers' });
  toast(`Complete front built · ${placed.length} editable object${placed.length === 1 ? '' : 's'} · ${session.width.toFixed(1)} mm artwork · print-safe detail preserved`);
}

async function detectBrowserTextSuggestions(session, processed) {
  if (session.textDetectionStarted) return;
  session.textDetectionStarted = true;
  const regions = syncImagePartPreferences(session, processed).filter(region => region.role === 'text');
  if (!regions.length) return;
  if (typeof globalThis.TextDetector !== 'function') {
    session.textDetectionStatus = `${regions.length} text-like line${regions.length === 1 ? '' : 's'} found locally · type each line to rebuild it as editable text.`;
    renderImagePartsPanel(session);
    return;
  }
  session.textDetectionStatus = 'Reading likely text locally…';
  renderImagePartsPanel(session);
  try {
    const [x0, y0, x1, y1] = session.settings.crop;
    const sourceWidth = Math.max(1, Math.round((x1 - x0) * session.image.naturalWidth));
    const sourceHeight = Math.max(1, Math.round((y1 - y0) * session.image.naturalHeight));
    const scale = Math.min(1, 1024 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(sourceWidth * scale)); canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d');
    context.drawImage(session.image, x0 * session.image.naturalWidth, y0 * session.image.naturalHeight, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    const detections = await new globalThis.TextDetector().detect(canvas);
    let accepted = 0;
    for (const detection of detections || []) {
      const value = String(detection.rawValue || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const box = detection.boundingBox;
      if (!value || !box) continue;
      const centerX = (box.x + box.width / 2) / canvas.width;
      const centerY = (box.y + box.height / 2) / canvas.height;
      const region = regions.find(item => centerX >= item.minX / processed.pixelWidth - .03 && centerX <= (item.maxX + 1) / processed.pixelWidth + .03
        && centerY >= item.minY / processed.pixelHeight - .04 && centerY <= (item.maxY + 1) / processed.pixelHeight + .04);
      if (!region) continue;
      const preference = session.partPreferences.get(region.editorKey);
      if (!preference || preference.text) continue;
      preference.text = value; preference.replaceWithText = true; preference.name = `Text · ${value}`.slice(0, 40); accepted += 1;
    }
    session.textDetectionStatus = accepted
      ? `${accepted} line${accepted === 1 ? '' : 's'} read on this device · check spelling before building.`
      : `${regions.length} text-like line${regions.length === 1 ? '' : 's'} found · type wording to rebuild it as editable text.`;
  } catch {
    session.textDetectionStatus = `${regions.length} text-like line${regions.length === 1 ? '' : 's'} found · type wording to rebuild it as editable text.`;
  }
  if (state.imageEditor === session) renderImagePartsPanel(session);
}

function imageEditorPaletteHtml(session) {
  const palette = getPalette(state.project, state.inventory);
  return `${palette.map((item, slot) => `<button type="button" data-image-slot="${slot}" class="${!session.settings.activeSlots.length || session.settings.activeSlots.includes(slot) ? '' : 'off'}" style="background:${item.color}" title="${escapeHtml(item.name)}" aria-label="Toggle ${escapeHtml(item.name)}"></button>`).join('')}${inlineAddColorButtonHtml('image-palette')}`;
}

function bindImageEditorPalette(session) {
  const root = $('.editor-palette');
  if (!root || state.imageEditor !== session) return;
  root.querySelectorAll('[data-image-slot]').forEach(button => button.addEventListener('click', () => {
    const allSlots = getPalette(state.project, state.inventory).map((_, slot) => slot);
    const slot = Number(button.dataset.imageSlot);
    if (session.settings.style === 'silhouette') {
      session.settings.activeSlots = [slot];
      root.querySelectorAll('[data-image-slot]').forEach(item => item.classList.toggle('off', Number(item.dataset.imageSlot) !== slot));
      scheduleImageEditorPreview(0);
      return;
    }
    const enabled = session.settings.activeSlots.length ? [...session.settings.activeSlots] : allSlots;
    const index = enabled.indexOf(slot);
    if (index >= 0) {
      if (session.settings.style === 'high-contrast' && enabled.length <= 2) { toast('High contrast always uses exactly two filament colors'); return; }
      if (enabled.length === 1) { toast('Keep at least one filament color enabled'); return; }
      enabled.splice(index, 1);
    } else {
      if (session.settings.style === 'high-contrast' && enabled.length >= 2) enabled.shift();
      enabled.push(slot);
    }
    session.settings.activeSlots = enabled.sort((a, b) => a - b);
    root.querySelectorAll('[data-image-slot]').forEach(item => item.classList.toggle('off', !enabled.includes(Number(item.dataset.imageSlot))));
    scheduleImageEditorPreview(0);
  }));
  bindInlineAddColorButtons(root);
}

function renderImageEditorPalette(session) {
  const root = $('.editor-palette');
  if (!root || state.imageEditor !== session) return;
  root.innerHTML = imageEditorPaletteHtml(session);
  bindImageEditorPalette(session);
}

function imageEditorMarkup(session) {
  const settings = session.settings;
  const needsToneControls = ['high-contrast', 'outline'].includes(settings.style);
  const crop = [settings.crop[0], settings.crop[1], 1 - settings.crop[2], 1 - settings.crop[3]].map(value => Math.round(value * 100));
  const effectButton = (value, label) => `<button type="button" data-image-style="${value}" class="${settings.style === value ? 'active' : ''}">${label}</button>`;
  const inferredColorNames = session.inferredFilaments.map(item => item.name).filter(Boolean);
  const detectedFace = session.medalFaceDetection ? `<div class="medal-face-detected"><span>✓</span><div><strong>Circular medal face detected</strong><small>The ribbon and studio background were cropped away. Face and rim colors will become medal settings; artwork and lettering become separate objects.</small>${inferredColorNames.length ? `<small class="inferred-medal-colors">Matched stocked colors · ${escapeHtml(inferredColorNames.join(' · '))}</small>` : ''}</div></div>` : '';
  return `<div class="image-editor">
    <section class="image-preview-card"><canvas id="imageEditorPreview" width="720" height="480" aria-label="Click a printable object to select it"></canvas><div class="image-preview-meta"><span id="imageEditorMeta">Preparing preview…</span><span class="image-preview-actions"><button type="button" id="imagePreviewMode">Show print cells</button><span id="imageEditorBusy" class="editor-busy">Local preview</span></span></div></section>
    <section class="image-editor-controls">
      ${detectedFace}
      ${session.targetId ? '' : `<div class="image-editor-group image-place-mode"><strong>How should this image work on the medal?</strong><div class="image-place-choices"><button type="button" data-image-placement="parts" class="${session.placementMode === 'parts' ? 'active' : ''}"><b>Separate editable objects</b><small>Recommended · click the runner, background, or details and edit each one.</small></button><button type="button" data-image-placement="whole" class="${session.placementMode === 'whole' ? 'active' : ''}"><b>Use whole image</b><small>One object with one shared size and height.</small></button></div></div>`}
      <div class="image-editor-group image-parts-panel" id="imagePartsPanel"><div class="image-parts-empty"><strong>Finding printable objects…</strong><span>Everything happens on this computer.</span></div></div>
      <details class="image-editor-group image-adjustments"><summary>Adjust image cleanup and colors</summary><div class="image-adjustment-stack"><strong>Visual style</strong><div class="effect-grid">${effectButton('color','Printable colors')}${effectButton('silhouette','Silhouette')}${effectButton('high-contrast','High contrast')}${effectButton('outline','Outline')}</div><strong>Background</strong><select class="select-input" id="imageBackground"><option value="auto" ${settings.background === 'auto' ? 'selected' : ''}>Remove connected border automatically</option><option value="keep" ${settings.background === 'keep' ? 'selected' : ''}>Keep background</option><option value="light" ${settings.background === 'light' ? 'selected' : ''}>Remove light border</option><option value="dark" ${settings.background === 'dark' ? 'selected' : ''}>Remove dark border</option></select><label class="editor-range"><span>Printable detail <output id="imageDetailLabel">${Math.round(settings.detail)}%</output></span><input id="imageDetail" type="range" min="0" max="100" value="${settings.detail}" /></label><div id="imageToneControls" ${needsToneControls ? '' : 'hidden'}><label class="editor-range"><span>Contrast threshold <output id="imageThresholdLabel">${Math.round(settings.threshold)}</output></span><input id="imageThreshold" type="range" min="0" max="255" value="${settings.threshold}" /></label><label class="check-row compact-check"><input id="imageInvert" type="checkbox" ${settings.invert ? 'checked' : ''}/><span><strong>Invert light and dark</strong><small>Useful for white artwork on a dark photo.</small></span></label></div><strong>Filament colors to use</strong><div class="editor-palette">${imageEditorPaletteHtml(session)}</div></div></details>
      <div class="image-editor-group"><strong>Size of the complete artwork</strong><div class="property-grid"><label><span>Width</span><div class="unit-input"><input id="imageEditorWidth" type="number" min="3" max="${DESIGN_LIMITS.imageSizeMax}" step=".1" value="${session.width.toFixed(1)}"><em>mm</em></div></label><label><span>Height</span><div class="unit-input"><input id="imageEditorHeight" type="number" min="2" max="${DESIGN_LIMITS.imageSizeMax}" step=".1" value="${session.height.toFixed(1)}"><em>mm</em></div></label></div><button type="button" class="aspect-toggle ${session.lockAspect ? 'active' : ''}" id="imageEditorAspect">${session.lockAspect ? '🔗 Ratio locked' : '⛓ Free width & height'}</button><small class="field-help">Individual objects can be scaled independently after placement.</small></div>
      <details class="image-editor-group"><summary>Crop image</summary><div class="crop-grid"><label>Left<input data-image-crop="0" type="number" min="0" max="90" value="${crop[0]}"><em>%</em></label><label>Top<input data-image-crop="1" type="number" min="0" max="90" value="${crop[1]}"><em>%</em></label><label>Right<input data-image-crop="2" type="number" min="0" max="90" value="${crop[2]}"><em>%</em></label><label>Bottom<input data-image-crop="3" type="number" min="0" max="90" value="${crop[3]}"><em>%</em></label></div><div class="dialog-actions compact"><button type="button" class="button secondary" id="resetImageCrop">Show full image</button><button type="button" class="button primary" id="fitImageArtwork">Fit to artwork</button></div></details>
    </section>
  </div><div class="dialog-actions image-editor-footer"><button class="button secondary" type="button" data-cancel-image>Cancel</button><button class="button ${session.medalFaceDetection && !session.targetId ? 'secondary' : 'primary'}" type="button" id="applyImageEditor">${session.targetId ? 'Update artwork' : 'Preparing objects…'}</button>${session.medalFaceDetection && !session.targetId ? '<button class="button primary build-complete-medal" type="button" id="buildCompleteMedal">Build complete medal automatically</button>' : ''}</div>`;
}

function drawImageEditorPreview(processed, session, token) {
  const preview = $('#imageEditorPreview');
  if (!preview || !processed?.dataUrl) return;
  const sourcePromise = session.showPrintCells ? decodeImage(processed.dataUrl) : Promise.resolve(session.image);
  sourcePromise.then(image => {
    if (state.imageEditor !== session || token !== session.previewToken || !preview.isConnected) return;
    const aspect = processed.pixelWidth / Math.max(1, processed.pixelHeight);
    const logicalWidth = Math.round(aspect >= 1 ? 720 : Math.max(300, 520 * aspect));
    const logicalHeight = Math.round(aspect >= 1 ? Math.max(300, 720 / aspect) : 520);
    const fittedWidth = logicalHeight > 520 ? Math.round(logicalWidth * 520 / logicalHeight) : logicalWidth;
    const fittedHeight = Math.min(520, logicalHeight);
    const density = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
    preview.width = Math.max(1, Math.round(fittedWidth * density));
    preview.height = Math.max(1, Math.round(fittedHeight * density));
    preview.style.width = `${fittedWidth}px`;
    preview.style.height = `${fittedHeight}px`;
    const previewContext = preview.getContext('2d');
    previewContext.clearRect(0, 0, preview.width, preview.height);
    previewContext.imageSmoothingEnabled = !session.showPrintCells;
    previewContext.imageSmoothingQuality = 'high';
    if (session.showPrintCells) previewContext.drawImage(image, 0, 0, preview.width, preview.height);
    else {
      const [x0, y0, x1, y1] = session.settings.crop;
      previewContext.drawImage(image, x0 * image.naturalWidth, y0 * image.naturalHeight, (x1 - x0) * image.naturalWidth, (y1 - y0) * image.naturalHeight, 0, 0, preview.width, preview.height);
    }
    if (session.placementMode !== 'parts' || !processed.editorSegmentation) return;
    const regions = syncImagePartPreferences(session, processed);
    const segmentation = processed.editorSegmentation;
    const overlay = document.createElement('canvas'); overlay.width = processed.pixelWidth; overlay.height = processed.pixelHeight;
    const overlayContext = overlay.getContext('2d');
    const overlayData = overlayContext.createImageData(overlay.width, overlay.height);
    for (let index = 0; index < segmentation.regionMap.length; index += 1) {
      const regionIndex = segmentation.regionMap[index], offset = index * 4;
      if (regionIndex < 0) {
        overlayData.data[offset] = 248; overlayData.data[offset + 1] = 250; overlayData.data[offset + 2] = 249; overlayData.data[offset + 3] = 118;
        continue;
      }
      const region = regions[regionIndex], preference = session.partPreferences.get(region.editorKey);
      if (!preference?.enabled) {
        overlayData.data[offset] = 18; overlayData.data[offset + 1] = 24; overlayData.data[offset + 2] = 22; overlayData.data[offset + 3] = 148;
      } else if (region.editorKey === session.selectedPartKey || region.editorKey === session.hoverPartKey) {
        const hover = region.editorKey === session.hoverPartKey;
        overlayData.data[offset] = hover ? 251 : 49; overlayData.data[offset + 1] = hover ? 153 : 95; overlayData.data[offset + 2] = hover ? 43 : 244; overlayData.data[offset + 3] = hover ? 90 : 68;
      }
    }
    overlayContext.putImageData(overlayData, 0, 0);
    previewContext.imageSmoothingEnabled = true;
    previewContext.drawImage(overlay, 0, 0, preview.width, preview.height);
    const highlighted = regions.find(region => region.editorKey === (session.hoverPartKey || session.selectedPartKey));
    if (highlighted) {
      const scaleX = preview.width / processed.pixelWidth, scaleY = preview.height / processed.pixelHeight;
      previewContext.save(); previewContext.strokeStyle = session.hoverPartKey ? '#fb992b' : '#315ff4'; previewContext.lineWidth = 3 * density; previewContext.setLineDash([8 * density, 5 * density]);
      previewContext.strokeRect(highlighted.minX * scaleX, highlighted.minY * scaleY, (highlighted.maxX - highlighted.minX + 1) * scaleX, (highlighted.maxY - highlighted.minY + 1) * scaleY); previewContext.restore();
    }
  }).catch(() => {});
}

async function updateImageEditorPreview() {
  const session = state.imageEditor;
  if (!session || session.applying) return;
  const token = ++session.previewToken;
  const busy = $('#imageEditorBusy'), apply = $('#applyImageEditor');
  if (busy) busy.textContent = 'Updating locally…';
  if (apply) apply.disabled = true;
  try {
    const processed = await quantizeImageSource(session.source, session.width, session.height, message => { if (token === session.previewToken && $('#imageEditorMeta')) $('#imageEditorMeta').textContent = message; }, session.image, session.settings, { preview: true, segment: true, circularFace: Boolean(session.medalFaceDetection) });
    if (state.imageEditor !== session || token !== session.previewToken) return;
    processed.editorMedalFace = session.medalFaceDetection || null;
    session.latest = processed;
    syncImagePartPreferences(session, processed);
    drawImageEditorPreview(processed, session, token);
    renderImagePartsPanel(session);
    const used = processed.usedSlots.length;
    if ($('#imageEditorMeta')) $('#imageEditorMeta').textContent = `${processed.pixelWidth} × ${processed.pixelHeight} printable cells · ${processed.detailCell.toFixed(2)} mm/cell · ${used} color${used === 1 ? '' : 's'}`;
    if (busy) busy.textContent = used ? 'Preview ready' : 'No printable artwork remains — change cleanup or crop';
    if (apply) apply.disabled = used === 0;
    refreshImageEditorApplyButton(session);
    void detectBrowserTextSuggestions(session, processed);
  } catch (error) {
    if (state.imageEditor !== session || token !== session.previewToken || error?.name === 'AbortError') return;
    if (busy) busy.textContent = `Could not preview: ${error.message}`;
    if (apply) apply.disabled = false;
  }
}

function scheduleImageEditorPreview(delay = 140) {
  const session = state.imageEditor;
  if (!session || session.applying) return;
  clearTimeout(session.previewTimer);
  session.latest = null;
  const apply = $('#applyImageEditor'); if (apply) apply.disabled = true;
  session.previewTimer = setTimeout(updateImageEditorPreview, delay);
}

function bindImageEditor() {
  const session = state.imageEditor;
  if (!session) return;
  bindInlineAddColorButtons($('.image-editor-controls'));
  $$('[data-image-placement]').forEach(button => button.addEventListener('click', () => {
    session.placementMode = button.dataset.imagePlacement === 'whole' ? 'whole' : 'parts';
    $$('[data-image-placement]').forEach(item => item.classList.toggle('active', item === button));
    renderImagePartsPanel(session);
    if (session.latest) drawImageEditorPreview(session.latest, session, session.previewToken);
  }));
  $('#imagePreviewMode')?.addEventListener('click', event => {
    session.showPrintCells = !session.showPrintCells;
    event.currentTarget.textContent = session.showPrintCells ? 'Show smooth artwork' : 'Show print cells';
    if (session.latest) drawImageEditorPreview(session.latest, session, session.previewToken);
  });
  const previewCanvas = $('#imageEditorPreview');
  const previewRegionAt = event => {
    const processed = session.latest, segmentation = processed?.editorSegmentation;
    if (!segmentation || session.placementMode !== 'parts') return null;
    const rect = previewCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(processed.pixelWidth - 1, Math.floor((event.clientX - rect.left) / Math.max(1, rect.width) * processed.pixelWidth)));
    const y = Math.max(0, Math.min(processed.pixelHeight - 1, Math.floor((event.clientY - rect.top) / Math.max(1, rect.height) * processed.pixelHeight)));
    const regionIndex = segmentation.regionMap[y * processed.pixelWidth + x];
    return regionIndex >= 0 ? segmentation.regions[regionIndex] : null;
  };
  previewCanvas?.addEventListener('pointermove', event => {
    const region = previewRegionAt(event), next = region?.editorKey || null;
    if (next === session.hoverPartKey) return;
    session.hoverPartKey = next;
    previewCanvas.classList.toggle('has-part', Boolean(next));
    if (session.latest) drawImageEditorPreview(session.latest, session, session.previewToken);
  });
  previewCanvas?.addEventListener('pointerleave', () => {
    session.hoverPartKey = null; previewCanvas.classList.remove('has-part');
    if (session.latest) drawImageEditorPreview(session.latest, session, session.previewToken);
  });
  previewCanvas?.addEventListener('click', event => {
    const region = previewRegionAt(event); if (!region) return;
    session.selectedPartKey = region.editorKey; renderImagePartsPanel(session); drawImageEditorPreview(session.latest, session, session.previewToken);
  });
  $$('[data-image-style]').forEach(button => button.addEventListener('click', () => {
    const slotCount = getPalette(state.project, state.inventory).length;
    if (button.dataset.imageStyle === 'high-contrast' && slotCount < 2) { toast('High contrast needs two filament colors. Add a second color first.'); return; }
    session.settings.style = button.dataset.imageStyle;
    if (session.settings.style === 'silhouette') session.settings.activeSlots = [Math.min(slotCount - 1, Math.max(0, state.drawing.color))];
    else if (session.settings.style === 'high-contrast' && session.settings.activeSlots.length !== 2) session.settings.activeSlots = [0, Math.min(1, slotCount - 1)].filter((slot, index, values) => values.indexOf(slot) === index);
    $$('[data-image-slot]').forEach(item => item.classList.toggle('off', session.settings.activeSlots.length > 0 && !session.settings.activeSlots.includes(Number(item.dataset.imageSlot))));
    $$('[data-image-style]').forEach(item => item.classList.toggle('active', item === button));
    $('#imageToneControls').hidden = !['high-contrast', 'outline'].includes(session.settings.style);
    scheduleImageEditorPreview(0);
  }));
  $('#imageBackground').addEventListener('change', event => { session.settings.background = event.target.value; scheduleImageEditorPreview(); });
  $('#imageDetail').addEventListener('input', event => { session.settings.detail = Number(event.target.value); $('#imageDetailLabel').textContent = `${event.target.value}%`; scheduleImageEditorPreview(); });
  $('#imageThreshold')?.addEventListener('input', event => { session.settings.threshold = Number(event.target.value); $('#imageThresholdLabel').textContent = event.target.value; scheduleImageEditorPreview(); });
  $('#imageInvert')?.addEventListener('change', event => { session.settings.invert = event.target.checked; scheduleImageEditorPreview(0); });
  bindImageEditorPalette(session);
  const widthInput = $('#imageEditorWidth'), heightInput = $('#imageEditorHeight');
  const changeSize = (source, widthChanged) => {
    const minimum = widthChanged ? 3 : 2;
    const next = Math.max(minimum, Math.min(DESIGN_LIMITS.imageSizeMax, Number(source.value) || minimum));
    if (session.lockAspect) {
      const fitted = fitLockedImageSize(croppedImageAspect(session), next, widthChanged ? 'width' : 'height');
      if (!fitted) { toast('This crop is too narrow to keep its ratio inside the supported size range. Unlock the ratio first.'); source.value = (widthChanged ? session.width : session.height).toFixed(1); return; }
      session.width = fitted.width; session.height = fitted.height;
      widthInput.value = session.width.toFixed(1); heightInput.value = session.height.toFixed(1);
    } else if (widthChanged) {
      session.width = next; source.value = next.toFixed(1);
    } else {
      session.height = next; source.value = next.toFixed(1);
    }
    scheduleImageEditorPreview();
  };
  widthInput.addEventListener('change', () => changeSize(widthInput, true));
  heightInput.addEventListener('change', () => changeSize(heightInput, false));
  $('#imageEditorAspect').addEventListener('click', event => {
    session.lockAspect = !session.lockAspect;
    if (session.lockAspect) {
      const fitted = fitLockedImageSize(croppedImageAspect(session), session.width, 'width');
      if (fitted) { session.width = fitted.width; session.height = fitted.height; widthInput.value = session.width.toFixed(1); heightInput.value = session.height.toFixed(1); }
      scheduleImageEditorPreview(0);
    }
    event.currentTarget.classList.toggle('active', session.lockAspect);
    event.currentTarget.textContent = session.lockAspect ? '🔗 Ratio locked' : '⛓ Free width & height';
  });
  const updateCrop = () => {
    const trim = $$('[data-image-crop]').map(input => Math.max(0, Math.min(.9, (Number(input.value) || 0) / 100)));
    if (trim[0] + trim[2] > .9 || trim[1] + trim[3] > .9) { toast('Crop must leave at least 10% of the picture'); return; }
    const crop = [trim[0], trim[1], 1 - trim[2], 1 - trim[3]];
    if (session.lockAspect) {
      const fitted = fitLockedImageSize(croppedImageAspect(session, crop), session.width, 'width');
      if (!fitted) {
        toast('This crop is too narrow to preserve its ratio. Unlock the ratio before using it.');
        const current = [session.settings.crop[0], session.settings.crop[1], 1 - session.settings.crop[2], 1 - session.settings.crop[3]];
        $$('[data-image-crop]').forEach((input, index) => { input.value = String(Math.round(current[index] * 100)); });
        return;
      }
      session.width = fitted.width; session.height = fitted.height;
      widthInput.value = session.width.toFixed(1); heightInput.value = session.height.toFixed(1);
    }
    session.settings.crop = crop;
    scheduleImageEditorPreview();
  };
  $$('[data-image-crop]').forEach(input => input.addEventListener('change', updateCrop));
  $('#resetImageCrop').addEventListener('click', () => {
    session.settings.crop = [0, 0, 1, 1];
    $$('[data-image-crop]').forEach(input => { input.value = 0; });
    if (session.lockAspect) {
      const fitted = fitLockedImageSize(session.image.naturalWidth / session.image.naturalHeight, session.width, 'width');
      if (fitted) { session.width = fitted.width; session.height = fitted.height; widthInput.value = session.width.toFixed(1); heightInput.value = session.height.toFixed(1); }
    }
    scheduleImageEditorPreview(0);
  });
  $('#fitImageArtwork').addEventListener('click', () => {
    const crop = suggestedArtworkCrop(session.image, session.settings.background);
    if (session.lockAspect) {
      const fitted = fitLockedImageSize(croppedImageAspect(session, crop), session.width, 'width');
      if (fitted) {
        session.width = fitted.width; session.height = fitted.height;
        widthInput.value = session.width.toFixed(1); heightInput.value = session.height.toFixed(1);
      }
    }
    session.settings.crop = crop;
    const trim = [crop[0], crop[1], 1 - crop[2], 1 - crop[3]];
    $$('[data-image-crop]').forEach((input, index) => { input.value = String(Math.round(trim[index] * 100)); });
    scheduleImageEditorPreview(0);
    toast(crop.every((value, index) => Math.abs(value - [0, 0, 1, 1][index]) < .001) ? 'Artwork already fills the image' : 'Crop fitted around visible artwork');
  });
  $('[data-cancel-image]').addEventListener('click', closeDialog);
  $('#buildCompleteMedal')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    session.applying = true;
    clearTimeout(session.previewTimer); session.previewToken += 1;
    button.disabled = true; button.textContent = 'Building centered editable medal…';
    try {
      let processed = session.latest || await quantizeImageSource(session.source, session.width, session.height, message => { const busy = $('#imageEditorBusy'); if (busy) busy.textContent = message; }, session.image, session.settings, { segment: true, circularFace: Boolean(session.medalFaceDetection) });
      if (state.imageEditor !== session) return;
      processed.editorMedalFace = session.medalFaceDetection || null;
      if (!processed.usedSlots.length) throw new Error('No printable artwork remains. Adjust cleanup or crop first.');
      processed = await requantizeAutomaticAssemblyAtFinalSize(session, processed, message => { const busy = $('#imageEditorBusy'); if (busy) busy.textContent = message; });
      if (state.imageEditor !== session) return;
      placeSegmentedAssemblyCentered(session, processed);
    } catch (error) {
      session.applying = false;
      if (state.imageEditor === session) { button.disabled = false; button.textContent = 'Build complete medal automatically'; }
      if (error?.name !== 'AbortError') toast(`Automatic medal build failed: ${error.message}`);
    }
  });
  $('#applyImageEditor').addEventListener('click', async event => {
    const button = event.currentTarget;
    session.applying = true;
    clearTimeout(session.previewTimer);
    session.previewToken += 1;
    button.disabled = true;
    button.textContent = 'Building printable artwork…';
    try {
      const processed = session.latest || await quantizeImageSource(session.source, session.width, session.height, message => { const busy = $('#imageEditorBusy'); if (busy) busy.textContent = message; }, session.image, session.settings, { segment: session.placementMode === 'parts', circularFace: Boolean(session.medalFaceDetection) });
      if (state.imageEditor !== session) return;
      processed.editorMedalFace = session.medalFaceDetection || null;
      if (!processed.usedSlots.length) throw new Error('No printable artwork remains. Keep the background or adjust the crop/effect.');
      if (session.targetId) {
        commit(project => {
          const element = project.elements.find(item => item.id === session.targetId);
          if (!element) return;
          Object.assign(element, printableImageFields(processed), { width: session.width, height: session.height, scaleX: 1, scaleY: 1, lockAspect: session.lockAspect, sourceDataUrl: session.source, sourceWidth: session.image.naturalWidth, sourceHeight: session.image.naturalHeight });
          project.template = 'custom';
        }, { panel: true });
        closeDialog();
        toast('Image cleanup and printable colors updated');
      } else if (session.placementMode === 'parts') {
        const { preview, assembly } = buildSegmentedImageAssembly(session, processed);
        closeDialog();
        queuePlacement(preview, `${assembly.parts.length} editable image objects`, { assembly });
        toast(`${assembly.parts.length} objects ready · move the complete design over either medal face and click once`);
      } else {
        const element = { id: uid('image'), type: 'image', name: session.name, x: 0, y: 0, width: session.width, height: session.height, rotation: 0, color: processed.usedSlots[0] || 0, opacity: 1, sourceDataUrl: session.source, sourceWidth: session.image.naturalWidth, sourceHeight: session.image.naturalHeight, hidden: false, ...operationDefaults(), ...printableImageFields(processed), scaleX: 1, scaleY: 1, lockAspect: session.lockAspect };
        closeDialog();
        queuePlacement(element, 'image');
        toast(`Printable image ready · move it over either medal face and click to place`);
      }
    } catch (error) {
      session.applying = false;
      if (state.imageEditor === session) { button.disabled = false; refreshImageEditorApplyButton(session); }
      if (error?.name !== 'AbortError') toast(`Image conversion failed: ${error.message}`);
    }
  });
}

async function openImageEditor(elementOrSession) {
  invalidateImageReprocessing();
  const existing = elementOrSession?.type === 'image' ? elementOrSession : null;
  let source = existing?.sourceDataUrl || elementOrSession?.source;
  if (!source) { toast('This artwork has no editable source image'); return; }
  let image;
  try {
    image = elementOrSession?.image || await decodeImage(source);
    const compacted = compactEditableImageSource(source, image);
    if (compacted !== source) { source = compacted; image = await decodeImage(source); }
  } catch (error) {
    toast(`This editable image could not be opened: ${error.message}`);
    return false;
  }
  const settings = normalizedImageSettings(existing?.imageSettings || elementOrSession?.settings);
  const slotCount = getPalette(state.project, state.inventory).length;
  if (settings.style === 'high-contrast' && slotCount < 2) settings.style = 'silhouette';
  if (settings.style === 'silhouette' && settings.activeSlots.length !== 1) settings.activeSlots = [Math.min(slotCount - 1, Math.max(0, state.drawing.color))];
  if (settings.style === 'high-contrast' && settings.activeSlots.length !== 2) settings.activeSlots = [0, Math.min(1, slotCount - 1)].filter((slot, index, values) => values.indexOf(slot) === index);
  const session = {
    source,
    image,
    name: existing?.name || elementOrSession?.name || 'Imported image',
    width: Math.max(3, Math.min(DESIGN_LIMITS.imageSizeMax, Number(existing ? existing.width * (Number(existing.scaleX) || 1) : elementOrSession?.width) || 30)),
    height: Math.max(2, Math.min(DESIGN_LIMITS.imageSizeMax, Number(existing ? existing.height * (Number(existing.scaleY) || 1) : elementOrSession?.height) || 30)),
    lockAspect: existing?.lockAspect !== false,
    settings,
    targetId: existing?.id || null,
    placementMode: existing ? 'whole' : 'parts',
    partPreferences: new Map(),
    selectedPartKey: null,
    hoverPartKey: null,
    showPrintCells: false,
    latest: null,
    previewToken: 0,
    previewTimer: null,
    applying: false,
    medalFaceDetection: existing ? null : elementOrSession?.medalFaceDetection || null,
    medalSurfaceColors: existing ? null : elementOrSession?.medalSurfaceColors || null,
    textDetectionStarted: false,
    textDetectionStatus: '',
    inferredFilaments: Array.isArray(elementOrSession?.inferredFilaments) ? elementOrSession.inferredFilaments : [],
  };
  if (session.lockAspect) {
    const fitted = fitLockedImageSize(croppedImageAspect(session), session.width, 'width');
    if (fitted) { session.width = fitted.width; session.height = fitted.height; }
    else session.lockAspect = false;
  }
  state.imageEditor = session;
  openDialog(existing ? 'Edit printable image' : session.medalFaceDetection ? 'Build a medal from this design' : 'Turn image into medal objects', existing ? 'Edit printable image' : session.medalFaceDetection ? 'The circular face was found automatically' : 'Click the runner, background, or any detected part', imageEditorMarkup(session));
  state.imageEditor = session;
  state.dialogCleanup = () => {
    session.previewToken += 1;
    clearTimeout(session.previewTimer);
    if (state.imageEditor === session) state.imageEditor = null;
    if (state.imageWorker) {
      const job = state.imageWorker;
      state.imageWorker = null;
      job.worker.terminate();
      const error = new Error('Image editor closed'); error.name = 'AbortError'; job.reject(error);
    }
  };
  bindImageEditor();
  scheduleImageEditorPreview(0);
  return true;
}

async function addRasterAsset(file) {
  const loadToken = ++state.imageLoadToken;
  openDialog('Local image conversion','Opening artwork editor','<p class="dialog-lede" id="imageProgress">Decoding the image on this device…</p><div class="export-progress">The original file never leaves this computer. You will preview and clean it before placing anything on the medal.</div>');
  state.dialogCleanup = () => { if (state.imageLoadToken === loadToken) state.imageLoadToken += 1; };
  try {
    const source = await safeImageSource(file);
    if (state.imageLoadToken !== loadToken) { const error = new Error('Image load cancelled'); error.name = 'AbortError'; throw error; }
    const image = await decodeImage(source);
    if (state.imageLoadToken !== loadToken) { const error = new Error('Image load cancelled'); error.name = 'AbortError'; throw error; }
    if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('Image dimensions are too large. Resize it below 40 megapixels first.');
    const medalFaceDetection = suggestedMedalFaceCrop(image);
    const paletteInference = medalFaceDetection ? inferredMedalFilamentPalette(image, medalFaceDetection) : { matches: [], addIds: [] };
    if (paletteInference.addIds.length) {
      commit(project => {
        const used = new Set(project.paletteIds);
        for (const id of paletteInference.addIds) {
          if (project.paletteIds.length >= DESIGN_LIMITS.paletteSlots || used.has(id)) continue;
          project.paletteIds.push(id); used.add(id);
        }
        project.template = 'custom';
      }, { panel: true });
      syncDrawingDefaults(false);
    }
    const medalSpan = Math.min(state.project.medal.width, state.project.medal.height);
    const safeFaceSpan = Math.max(8, medalSpan - 2 * Math.max(1.2, state.project.medal.edgeInset + state.project.medal.rimWidth * .35));
    const maxPhysical = Math.min(DESIGN_LIMITS.imageSizeMax, medalFaceDetection ? safeFaceSpan : medalSpan * .7);
    const settings = normalizedImageSettings({ crop: medalFaceDetection?.crop || suggestedArtworkCrop(image, 'auto') });
    const aspect = image.naturalWidth * (settings.crop[2] - settings.crop[0]) / Math.max(1, image.naturalHeight * (settings.crop[3] - settings.crop[1]));
    const width = aspect >= 1 ? maxPhysical : maxPhysical * aspect;
    const height = aspect >= 1 ? maxPhysical / aspect : maxPhysical;
    state.dialogCleanup = null;
    closeDialog();
    const inferredFilaments = [...new Map(paletteInference.matches.map(match => [match.id, match])).values()];
    await openImageEditor({ source, image, name: file.name.replace(/\.[^.]+$/, '').slice(0, 28) || 'Imported image', width, height, settings, medalFaceDetection, medalSurfaceColors: paletteInference.surfaceColors, inferredFilaments });
    if (paletteInference.addIds.length) toast(`Added ${paletteInference.addIds.map(id => state.inventory.find(item => item.id === id)?.name || id).join(' and ')} from the source image`);
  } catch (error) {
    if (state.imageLoadToken !== loadToken && error?.name !== 'AbortError') { const aborted = new Error('Image load cancelled'); aborted.name = 'AbortError'; throw aborted; }
    throw error;
  }
}

function dxfValue(entries,code,fallback=0){const entry=entries.find(item=>item.code===code);return entry?Number(entry.value):fallback;}
function parseDxf(text) {
  const lines=text.replace(/\r/g,'').split('\n'); const entities=[]; let current=null;
  for(let i=0;i<lines.length-1;i+=2){const code=Number(lines[i].trim());const value=(lines[i+1]||'').trim();if(code===0){if(current)entities.push(current);current={type:value.toUpperCase(),entries:[]};}else if(current)current.entries.push({code,value});}if(current)entities.push(current);
  const paths=[];
  for(let entityIndex=0;entityIndex<entities.length;entityIndex+=1){
    const entity=entities[entityIndex];
    if(entity.type==='LINE'){paths.push({points:[[dxfValue(entity.entries,10),-dxfValue(entity.entries,20)],[dxfValue(entity.entries,11),-dxfValue(entity.entries,21)]],closed:false});}
    if(entity.type==='LWPOLYLINE'){const points=[];let pending=null;for(const entry of entity.entries){if(entry.code===10){pending=[Number(entry.value),0];points.push(pending);}if(entry.code===20&&pending)pending[1]=-Number(entry.value);}if(points.length>1)paths.push({points,closed:(dxfValue(entity.entries,70)&1)===1});}
    if(entity.type==='POLYLINE'){const points=[];let cursor=entityIndex+1;while(cursor<entities.length&&entities[cursor].type!=='SEQEND'){if(entities[cursor].type==='VERTEX')points.push([dxfValue(entities[cursor].entries,10),-dxfValue(entities[cursor].entries,20)]);cursor+=1;}if(points.length>1)paths.push({points,closed:(dxfValue(entity.entries,70)&1)===1});entityIndex=cursor;}
    if(entity.type==='CIRCLE'||entity.type==='ARC'){const cx=dxfValue(entity.entries,10),cy=-dxfValue(entity.entries,20),r=dxfValue(entity.entries,40);const start=entity.type==='ARC'?-dxfValue(entity.entries,50,0)*Math.PI/180:0;const end=entity.type==='ARC'?-dxfValue(entity.entries,51,360)*Math.PI/180:Math.PI*2;const count=entity.type==='ARC'?24:48;const points=Array.from({length:count+1},(_,i)=>{const angle=start+(end-start)*i/count;return[cx+Math.cos(angle)*r,cy+Math.sin(angle)*r];});paths.push({points,closed:entity.type==='CIRCLE'});}
  }
  if(!paths.length)throw new Error('No supported LINE, LWPOLYLINE, CIRCLE, or ARC entities were found.');
  const all=paths.flatMap(path=>path.points);const minX=Math.min(...all.map(p=>p[0])),maxX=Math.max(...all.map(p=>p[0])),minY=Math.min(...all.map(p=>p[1])),maxY=Math.max(...all.map(p=>p[1]));const cx=(minX+maxX)/2,cy=(minY+maxY)/2;const span=Math.max(maxX-minX,maxY-minY)||1;const scale=Math.min(DESIGN_LIMITS.imageSizeMax,Math.min(state.project.medal.width,state.project.medal.height)*.7)/span;
  return paths.map((path,index)=>({id:uid('path'),type:'path',name:`DXF path ${index+1}`,points:path.points.map(([x,y])=>[x-cx,y-cy]),x:0,y:0,scale,closed:path.closed,strokeWidth:Math.max(state.project.profile.nozzle*2.25,.8),rotation:0,color:Math.min(1,state.project.paletteIds.length-1),hidden:false,...operationDefaults()}));
}

async function handleAssetFile(file) {
  try {
    if(file.size>MAX_ARTWORK_BYTES)throw new Error('File is larger than the 24 MB artwork limit.');
    if(file.name.toLowerCase().endsWith('.dxf')){const elements=parseDxf(await file.text());state.selectedId=elements[0].id;commit(project=>{project.elements.push(...elements);project.template='custom';});renderAll();toast(`${elements.length} DXF path${elements.length===1?'':'s'} imported`);}
    else await addRasterAsset(file);
  } catch(error){if(error?.name!=='AbortError'){closeDialog();toast(error.message);console.error(error);}}
  $('#assetInput').value='';
}

async function handleProjectFile(file) {
  try {
    if(file.size>64*1024*1024)throw new Error('Project file is larger than 64 MB.');
    const parsed=JSON.parse(await file.text());
    const restored=normalizeProjectBundle(parsed,state.inventory);
    if(restored.missing.length)throw new Error(`The project references ${restored.missing.length} filament${restored.missing.length===1?'':'s'} missing from both this device and its saved snapshot.`);
    state.inventory=restored.inventory;
    if(restored.added.length||restored.remapped.length)await saveUserRecord('inventory','catalog',state.inventory);
    replaceProject(restored.project); markLoadedDesignProgress(); closeDialog();
    const note=restored.remapped.length?` · preserved ${restored.remapped.length} conflicting local color${restored.remapped.length===1?'':'s'} under new project IDs`:restored.added.length?` · restored ${restored.added.length} filament${restored.added.length===1?'':'s'} to local stock`:'';
    toast(`Project opened${note}`);
  } catch(error){toast(`Could not open project: ${error.message}`);}
  $('#projectInput').value='';
}

function changeColorCount(count, options = {}) {
  const previousCount = state.project.paletteIds.length;
  let addedSlot = null;
  count = Math.max(1, Math.min(DESIGN_LIMITS.paletteSlots, Math.round(Number(count) || 1)));
  if (count > state.project.paletteIds.length) {
    const availableUnique = state.inventory.filter(filament => availability(filament).key !== 'out').length;
    if (availableUnique < count) {
      const known = new Set(state.inventory.map(filament => filament.id));
      const additions = ASIA_FILAMENT_PRESETS.filter(filament => !known.has(filament.id));
      if (additions.length) {
        state.inventory = normalizeInventory([...state.inventory, ...additions]);
        saveUserRecord('inventory', 'catalog', state.inventory).catch(error => console.error('Could not save starter filament catalog', error));
        toast('Added editable SUNLU, Bambu Lab, and eSUN starter records; enter your real stock before quoting');
      }
    }
  }
  const changed = commit(project=>{
    const startLength = project.paletteIds.length;
    if(count<project.paletteIds.length){project.paletteIds=project.paletteIds.slice(0,count);project.elements.forEach(element=>{if(element.color>=count)element.color=count-1;if(element.type==='image'&&element.maskUrls)element.maskUrls=element.maskUrls.slice(0,count);});}
    else {const used=new Set(project.paletteIds);for(const filament of state.inventory){if(project.paletteIds.length>=count)break;if(!used.has(filament.id)&&availability(filament).key!=='out'){project.paletteIds.push(filament.id);used.add(filament.id);}}}
    if (project.paletteIds.length > startLength) {
      addedSlot = project.paletteIds.length - 1;
      options.onAdded?.(project, addedSlot);
    }
    project.medal.baseColor=Math.min(project.medal.baseColor,count-1);project.medal.rimColor=Math.min(project.medal.rimColor,count-1);project.template='custom';
  },{panel:true});
  syncDrawingDefaults(false);
  if (changed) renderToolPanel();
  if (changed && count < previousCount) reprocessImportedImages('color count reduction');
  return addedSlot;
}

async function ensureGeometryResult(onProgress = () => {}) {
  const revision = state.viewerRevision;
  if (state.geometryRevision === revision && state.viewerResult) return state.viewerResult;
  if (state.geometryPromise?.revision === revision) return state.geometryPromise.promise;
  const project = enrichForExport(state.project, state.inventory);
  const promise = (async () => {
    await document.fonts?.ready;
    await new Promise(resolve => requestAnimationFrame(resolve));
    // Keep the interactive model under a predictable memory ceiling even when
    // the project requests Ultra export geometry. Production exports still use
    // the full profile, while the viewport stays smooth and cannot freeze the
    // customer's browser on object-rich medals.
    // Interactive rebuilds adapt to available device memory: low-memory
    // systems retain the previous safe ceiling while ordinary desktops use a
    // visibly finer grid. Production 3MF/STL and the PDF still use the full
    // selected quality preset with an entirely independent budget.
    const viewportBudget = viewerGeometryBudget(globalThis.navigator?.deviceMemory);
    const options = { validate: false, previewMasks: true, ...viewportBudget };
    let result;
    if (typeof Worker === 'function' && typeof OffscreenCanvas === 'function') {
      try { result = await buildMeshesInWorker(project, revision, onProgress, options); }
      catch (error) {
        if (error?.name === 'AbortError') throw error;
        console.warn('Geometry worker unavailable; using the compatibility path.', error);
        onProgress('Using compatibility geometry path…');
        result = await buildMeshes(project, onProgress, options);
      }
    } else result = await buildMeshes(project, onProgress, options);
    if (revision === state.viewerRevision) {
      state.viewerResult = result;
      state.geometryRevision = revision;
      state.sliceBitmap = null;
    }
    return result;
  })();
  state.geometryPromise = { revision, promise };
  try { return await promise; }
  finally { if (state.geometryPromise?.revision === revision) state.geometryPromise = null; }
}

function buildMeshesInWorker(project, revision, onProgress, options) {
  cancelGeometryWorker();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./geometry-worker.js', import.meta.url), { type: 'module' });
    const job = { worker, revision, reject };
    state.geometryWorker = job;
    const finish = callback => value => {
      if (state.geometryWorker === job) state.geometryWorker = null;
      worker.terminate();
      callback(value);
    };
    const resolveJob = finish(resolve), rejectJob = finish(reject);
    worker.onmessage = event => {
      if (event.data?.id !== revision) return;
      if (event.data.type === 'progress') { onProgress(event.data.message); return; }
      if (event.data.type === 'result') resolveJob(event.data.result);
      else if (event.data.type === 'error') rejectJob(new Error(event.data.message || 'Geometry worker failed'));
    };
    worker.onerror = event => rejectJob(new Error(event.message || 'Geometry worker failed'));
    worker.postMessage({ id: revision, project, options });
  });
}

async function ensureSliceGeometry() {
  if (!state.project || state.view !== 'toolpath') return;
  renderLayerPreviewControls();
  drawMedal();
  try {
    const revision = state.viewerRevision;
    await ensureGeometryResult(message => { if (state.view === 'toolpath') $('#sliceStatus').textContent = message; });
    if (state.view !== 'toolpath' || revision !== state.viewerRevision) return;
    state.sliceLayer = null;
    renderLayerPreviewControls();
    drawMedal();
    renderChecks();
    renderPrice();
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (state.view !== 'toolpath') return;
    $('#sliceLayerTitle').textContent = 'Layer build failed';
    $('#sliceStatus').textContent = error.message;
    $('#sliceExactBadge').textContent = 'Error';
    console.error(error);
  }
}

function setInspectionOpen(open, { focus = false, mark = true } = {}) {
  state.inspectionOpen = Boolean(open);
  const button = $('#toggleInspectLayers');
  button?.classList.toggle('active', state.inspectionOpen);
  button?.setAttribute('aria-expanded', String(state.inspectionOpen));
  if ($('#slicerDock')) $('#slicerDock').hidden = state.view !== '3d' || !state.inspectionOpen;
  if (state.inspectionOpen && mark) markOnboardingStep('inspect');
  renderPushPullGizmo();
  renderTransformGizmo();
  if (focus && state.inspectionOpen) requestAnimationFrame(() => $('#layerSlider')?.focus());
}

function openExactLayerSlice() {
  setInspectionOpen(true, { mark: true });
  setView('toolpath');
  requestAnimationFrame(() => $('#sliceLayerSlider')?.focus());
}

function setView(mode) {
  if (!['2d', '3d', 'toolpath'].includes(mode)) return;
  if (mode !== '2d' && (state.drawing.active || state.drawing.points.length)) cancelDrawing(state.panel === 'create' && state.createTool === 'draw');
  const previousView = state.view;
  state.view = mode;
  const isModel = mode === '3d';
  const isSketch = mode === '2d';
  const hasViewer = isModel || isSketch;
  canvas.hidden = isModel;
  canvas.classList.toggle('sketch-overlay', isSketch);
  modelCanvas.hidden = !hasViewer;
  $('#viewerToolbar').hidden = !hasViewer;
  $('#slicerDock').hidden = !isModel || !state.inspectionOpen;
  $('#layerDock').hidden = mode !== 'toolpath';
  $('#sketchModeBar').hidden = !isSketch;
  $('#selectionHud').hidden = mode === 'toolpath' || !selectedElement();
  $('.canvas-grid').hidden = hasViewer;
  $('.size-chip').hidden = hasViewer;
  $('.compute-chip').hidden = false;
  $('.stage-actions').classList.toggle('model-active', hasViewer);
  $('#zoomLabel').textContent = hasViewer ? '3D' : `${Math.round(state.zoom * 100)}%`;
  if (isModel) {
    if (previousView === '2d' && state.sketchCamera && state.viewer) {
      state.viewer.restoreCamera(state.sketchCamera);
      updateProjectionToggle(state.sketchCamera.projection);
    }
    state.sketchCamera = null;
    $('#canvasEmpty').hidden = true;
    $('#workspaceModeLabel').textContent = 'Model workspace';
    $('#workspaceModeHelp').textContent = 'Click artwork to edit · drag the blue height handle to raise or recess';
    $('#stageHint').textContent = state.pendingInsert ? translateUiKey('stage.placeFace', { name: state.pendingInsert.label }) : translateUiKey('stage.orbitAlt');
    requestAnimationFrame(() => { state.viewer?.resize(); ensure3DModel(); });
  } else {
    if (mode === 'toolpath') {
      if (previousView !== 'toolpath') state.sliceLayer = null;
      renderLayerPreviewControls();
      ensureSliceGeometry();
    }
    else {
      if (previousView !== '2d' && state.viewer) state.sketchCamera = state.viewer.cameraState();
      setCameraPreset(state.drawing.face === 'back' ? 'bottom' : 'top', { workspace: false });
      state.viewer?.setProjection('orthographic');
      updateProjectionToggle('orthographic');
      $('#workspaceModeLabel').textContent = 'Sketching inside the 3D model';
      $('#workspaceModeHelp').textContent = translateUiKey(state.drawing.face === 'back' ? 'stage.backAutoAligned' : 'stage.frontAutoAligned');
      $('#sketchModeBar small').textContent = translateUiKey(state.drawing.face === 'back' ? 'stage.backDrawingOrientation' : 'stage.frontDrawingOrientation');
      renderSelectionHud();
      requestAnimationFrame(() => { state.viewer?.resize(); state.viewer?.render(); resizeCanvas(); });
    }
    drawMedal();
  }
  renderPushPullGizmo();
  renderOnboarding();
}

function enterSketchMode() {
  cancelPlacement();
  state.panel = 'create';
  state.createTool = 'draw';
  if (state.drawing.mode === 'select') state.drawing.mode = 'brush';
  setView('2d');
}

function finishSketchMode() {
  if (state.drawing.mode === 'polygon' && state.drawing.points.length >= 3) finishPolygon();
  else if (state.drawing.active || state.drawing.points.length) cancelDrawing(true);
  state.drawing.mode = 'select';
  setView('3d');
}

function renderViewerParts(meshes) {
  const palette = getPalette(state.project, state.inventory);
  const grouped = new Map();
  for (const mesh of meshes) {
    if (!grouped.has(mesh.slot)) grouped.set(mesh.slot, { slot: mesh.slot, volumeMm3: 0, shells: 0 });
    const group = grouped.get(mesh.slot); group.volumeMm3 += mesh.volumeMm3; group.shells += 1;
  }
  $('#viewerParts').innerHTML = [...grouped.values()].map(group => {
    const filament = palette[group.slot] || palette[0];
    const grams = group.volumeMm3 / 1000 * (filament.density || 1.24);
    return `<div class="viewer-part" data-viewer-part="${group.slot}"><input type="checkbox" data-part-visible="${group.slot}" checked aria-label="${escapeHtml(translateUiKey('accessibility.showSlot', { number: formatLocalizedNumber(group.slot + 1) }))}"/><i class="part-swatch" style="background:${filament.color}"></i><span><strong>${formatLocalizedNumber(group.slot + 1)} · ${escapeHtml(filament.name)}</strong><small>${localizedFixed(group.volumeMm3, 0)} mm³ · ${localizedFixed(grams, 1)} g · ${escapeHtml(localizedCount('shell', group.shells))}</small></span><button data-part-solo="${group.slot}" title="${escapeHtml(translateUiKey('accessibility.showOnlyColor'))}">Solo</button></div>`;
  }).join('');
  $$('[data-part-visible]').forEach(input => input.addEventListener('change', () => state.viewer?.setVisibility(Number(input.dataset.partVisible), input.checked)));
  $$('[data-part-solo]').forEach(button => button.addEventListener('click', () => {
    const slot = Number(button.dataset.partSolo);
    $$('[data-part-visible]').forEach(input => { input.checked = Number(input.dataset.partVisible) === slot; state.viewer?.setVisibility(Number(input.dataset.partVisible), input.checked); });
  }));
}

function buildSectionCapMeshes(result, height) {
  const { bounds, cell } = result.sliceData || {};
  if (!bounds || (!result.sliceData?.columns && !result.sliceData?.columnData) || !Number.isFinite(height)) return [];
  const total = bounds.cols * bounds.rows;
  const owners = new Int16Array(total); owners.fill(-1);
  const sampleZ = Math.max(0, height - Math.min(.0001, state.project.profile.layerHeight * .01));
  for (let index = 0; index < total; index += 1) {
    const slot = sliceSlotAt(result.sliceData, index, sampleZ, true);
    if (slot >= 0) owners[index] = slot;
  }
  const visited = new Uint8Array(total);
  const trianglesBySlot = new Map();
  const z = height + .0002;
  let rectangles = 0;
  for (let row = 0; row < bounds.rows; row += 1) for (let col = 0; col < bounds.cols; col += 1) {
    const index = row * bounds.cols + col, slot = owners[index];
    if (slot < 0 || visited[index]) continue;
    let width = 1;
    while (col + width < bounds.cols) { const next = index + width; if (visited[next] || owners[next] !== slot) break; width += 1; }
    let heightCells = 1, extend = true;
    while (row + heightCells < bounds.rows && extend) {
      const nextRow = (row + heightCells) * bounds.cols + col;
      for (let x = 0; x < width; x += 1) if (visited[nextRow + x] || owners[nextRow + x] !== slot) { extend = false; break; }
      if (extend) heightCells += 1;
    }
    for (let y = 0; y < heightCells; y += 1) visited[(row + y) * bounds.cols + col] = 1;
    for (let y = 0; y < heightCells; y += 1) for (let x = 1; x < width; x += 1) visited[(row + y) * bounds.cols + col + x] = 1;
    const x0 = bounds.minX + col * cell, x1 = x0 + width * cell;
    const y0 = bounds.minY + row * cell, y1 = y0 + heightCells * cell;
    if (!trianglesBySlot.has(slot)) trianglesBySlot.set(slot, []);
    trianglesBySlot.get(slot).push(x0,y0,z,x1,y0,z,x1,y1,z, x0,y0,z,x1,y1,z,x0,y1,z);
    rectangles += 1;
    if (rectangles > 120_000) return [];
  }
  const palette = getPalette(state.project, state.inventory);
  return [...trianglesBySlot].map(([slot, triangles]) => ({ slot, color: palette[slot]?.color || '#7a817e', triangles }));
}

function updateLayerPreview() {
  if (!state.viewer || !state.project) return;
  const slider = $('#layerSlider');
  const layer = Number(slider.value); const max = Number(slider.max); const height = layer * state.project.profile.layerHeight;
  state.viewer.setClipZ(layer >= max ? 1e6 : height + .0005);
  const result = currentGeometryResult();
  if (layer >= max || !result?.sliceData) {
    state.viewer.setSectionMeshes([]); state.sectionCache = null;
  } else {
    const key = `${state.geometryRevision}|${layer}|${state.project.paletteIds.join('|')}`;
    if (state.sectionCache?.key !== key) state.sectionCache = { key, meshes: buildSectionCapMeshes(result, height) };
    state.viewer.setSectionMeshes(state.sectionCache.meshes);
  }
  $('#layerLabel').textContent = layer >= max
    ? translateUiKey('dynamicUi.allCount', { count: localizedCount('layer', max) })
    : translateUiKey('status.layerOf', { current: formatLocalizedNumber(layer), total: formatLocalizedNumber(max), height: localizedFixed(height) });
}

function renderModelStats(meshes, bounds, cell = meshCellForProject(state.project), maxHeight = bounds.maxZ) {
  const palette = getPalette(state.project, state.inventory);
  const triangles = meshes.reduce((sum, mesh) => sum + mesh.triangles.length / 9, 0);
  const volume = meshes.reduce((sum, mesh) => sum + mesh.volumeMm3, 0);
  const grams = meshes.reduce((sum, mesh) => sum + mesh.volumeMm3 / 1000 * (palette[mesh.slot]?.density || 1.24), 0);
  const width = bounds.maxX - bounds.minX, depth = bounds.maxY - bounds.minY;
  const height = Number(maxHeight || bounds.maxZ || approximateMaxHeight());
  const layers = Math.ceil(height / state.project.profile.layerHeight);
  $('#modelStats').innerHTML = [
    ['Size', `${localizedFixed(width, 1)} × ${localizedFixed(depth, 1)} × ${localizedFixed(height, 1)} mm`],
    ['Mesh', localizedCount('triangle', Math.round(triangles))],
    ['Surface sample', `${localizedFixed(cell, 3)} mm`],
    ['Model volume', `${localizedFixed(volume / 1000, 1)} cm³`],
    ['Model mass', `${localizedFixed(grams, 1)} g`],
  ].map(([label, value]) => `<div class="model-stat"><small>${label}</small><strong>${value}</strong></div>`).join('');
  const colorParts = new Set(meshes.map(mesh => mesh.slot)).size;
  $('#modelPartCount').textContent = `${localizedCount('color', colorParts)} · ${localizedCount('shell', meshes.length)} · ${localizedCount('layer', layers)}`;
  const slider = $('#layerSlider'); slider.max = String(layers); slider.value = String(layers); updateLayerPreview();
  state.viewerStats = { triangles, volume, grams, width, depth, height, layers };
}

async function ensure3DModel() {
  if (!state.project || state.view !== '3d') return;
  if (!state.viewer) {
    try { state.viewer = new MedalViewer3D(modelCanvas); }
    catch (error) { $('#modelLoading').hidden = false; $('#modelLoadingText').textContent = error.message; return; }
  }
  state.viewer.resize();
  if (state.viewerBuiltRevision === state.viewerRevision) { state.viewer.render(); return; }
  const revision = state.viewerRevision; const token = ++state.viewerBuildToken;
  const loading = $('#modelLoading');
  const initialBuild = state.viewerMeshes.length === 0;
  loading.hidden = !initialBuild;
  $('#modelLoadingText').textContent = 'Preparing browser geometry…';
  $('.compute-chip strong').textContent = initialBuild ? 'Computed on this device' : 'Refining printable model…';
  try {
    const result = await ensureGeometryResult(message => { if (token === state.viewerBuildToken) $('#modelLoadingText').textContent = message; });
    if (token !== state.viewerBuildToken || state.view !== '3d' || revision !== state.viewerRevision) return;
    const refit = state.viewerMeshes.length === 0;
    state.viewerMeshes = result.meshes;
    state.viewerResult = result;
    state.viewer.setBaseSlot(state.project.medal.baseColor);
    state.viewer.setMeshes(result.meshes, { refit });
    state.proxyCache = null;
    state.proxyOwner = null;
    state.proxyRenderedKey = null;
    getPalette(state.project, state.inventory).forEach((filament, slot) => state.viewer.setColor(slot, filament.color));
    updateRibbonPreview();
    if (refit && state.ribbonPreviewVisible) state.viewer.fit();
    state.viewerBuiltRevision = revision;
    if (state.placementEcho && revision >= state.placementEcho.revision) {
      state.placementEcho = null;
      $('#placementGhost').hidden = true;
    }
    renderViewerParts(result.meshes);
    renderModelStats(result.meshes, result.bounds, result.cell, result.maxHeight);
    updateMedalThicknessSummary();
    renderSelectionHud();
    renderTransformGizmo();
    renderChecks();
    renderPrice();
    renderOnboarding();
    loading.hidden = true;
    $('.compute-chip strong').textContent = 'Computed on this device';
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (token !== state.viewerBuildToken) return;
    $('#modelLoadingText').textContent = `Preview failed: ${error.message}`;
    $('.compute-chip strong').textContent = 'Preview needs attention';
    console.error(error);
  }
}

function bindViewerControls() {
  let clickStart = null;
  let hoverFrame = 0;
  let pendingHoverEvent = null;
  const applyCameraPreset = (preset, speak = false) => {
    state.hoveredId = null;
    $('#surfaceProbe').hidden = true;
    clearElementProxy('hover');
    state.viewer?.clearHoverSurface();
    if (state.view === '2d' && preset !== 'top') finishSketchMode();
    setCameraPreset(preset, { speak });
  };
  const scheduleHover = event => {
    if (event.buttons || state.modelDrag || state.gizmoDrag || state.pendingInsert || state.view !== '3d') return;
    pendingHoverEvent = { clientX: event.clientX, clientY: event.clientY };
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      const latest = pendingHoverEvent;
      if (!latest || state.modelDrag || state.gizmoDrag || state.view !== '3d') return;
      const hit = pickElementIn3D(latest.clientX, latest.clientY);
      updateSurfaceProbe(latest, hit);
      if (hit?.surface) state.viewer.setHoverSurface(hit.surface, hit.element ? 5 : 8);
      else state.viewer.clearHoverSurface();
      const nextId = hit?.element?.id || null;
      if (nextId !== state.hoveredId) {
        state.hoveredId = nextId;
        if (hit?.element) showElementProxy(hit.element, 'hover', .18);
        else clearElementProxy('hover');
      }
    });
  };
  modelCanvas.addEventListener('pointerdown', event => {
    if (state.view !== '3d') return;
    clickStart = null;
    $('#surfaceProbe').hidden = true;
    state.hoveredId = null;
    state.viewer?.clearHoverSurface();
    if (state.proxyOwner === 'hover') clearElementProxy('hover');
    if (state.liveEdit) { clickStart = null; return; }
    if (event.button === 0 && !event.shiftKey) {
      const hit = state.pendingInsert ? null : pickElementIn3D(event.clientX, event.clientY);
      clickStart = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, placing: Boolean(state.pendingInsert), hitId: hit?.element?.id || null };
      if (hit?.element && !event.altKey) {
        state.selectedId = hit.element.id;
        renderInspector();
        renderSelectionHud();
        if (!hit.element.locked) {
          const planeZ = selectionSurfaceZ(hit.element);
          const startPoint = state.viewer.screenToDesignPlane(event.clientX, event.clientY, planeZ);
          if (startPoint) {
            event.preventDefault(); event.stopImmediatePropagation();
            modelCanvas.setPointerCapture(event.pointerId);
            state.modelDrag = {
              pointerId: event.pointerId,
              id: hit.element.id,
              planeZ,
              startPoint,
              originalX: hit.element.x,
              originalY: hit.element.y,
              lastValid: elementPlacementFits(hit.element) ? structuredClone(hit.element) : null,
              before: snapshot(),
              moved: false,
            };
            $('#canvasWrap').classList.add('moving-object');
            state.viewer.clearHoverSurface();
            showElementProxy(hit.element, 'drag', .4);
            updateSurfaceProbe(event, { element: hit.element }, true);
            return;
          }
        }
      }
    }
    if (!state.pendingInsert && (!clickStart?.hitId || event.altKey || event.button !== 0 || event.shiftKey)) {
      $$('[data-camera]').forEach(item => item.classList.toggle('active', item.dataset.camera === 'iso'));
      $('#workspaceModeLabel').textContent = '3D medal';
      $('#workspaceModeHelp').textContent = 'Drag empty space to rotate · click artwork to edit it';
    }
    if (state.pendingInsert && event.button === 0) {
      event.preventDefault(); event.stopImmediatePropagation(); modelCanvas.setPointerCapture(event.pointerId);
    }
  });
  modelCanvas.addEventListener('pointermove', event => {
    const drag = state.modelDrag;
    if (drag?.pointerId === event.pointerId) {
      event.preventDefault(); event.stopImmediatePropagation();
      const element = state.project.elements.find(item => item.id === drag.id);
      const point = state.viewer.screenToDesignPlane(event.clientX, event.clientY, drag.planeZ);
      if (!element || !point) return;
      if (Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y) > 3) { drag.moved = true; clickStart.moved = true; }
      element.x = drag.originalX + point.x - drag.startPoint.x;
      element.y = drag.originalY + point.y - drag.startPoint.y;
      if (elementPlacementFits(element)) drag.lastValid = structuredClone(element);
      else if (drag.lastValid) Object.assign(element, structuredClone(drag.lastValid));
      else constrainElement(element);
      showElementProxy(element, 'drag', .4);
      renderPushPullGizmo();
      updateSurfaceProbe(event, { element }, true);
      $('#stageHint').textContent = `Moving ${element.name} · X ${element.x.toFixed(2)} · Y ${element.y.toFixed(2)} mm · live preview`;
      return;
    }
    if (state.pendingInsert) {
      event.preventDefault(); event.stopImmediatePropagation();
      updatePlacementPreview(event);
    }
    if (clickStart?.id === event.pointerId && Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y) > 5) clickStart.moved = true;
    scheduleHover(event);
  });
  modelCanvas.addEventListener('pointerup', event => {
    const drag = state.modelDrag;
    if (drag?.pointerId === event.pointerId) {
      event.preventDefault(); event.stopImmediatePropagation();
      const element = state.project.elements.find(item => item.id === drag.id);
      state.modelDrag = null;
      clickStart = null;
      $('#canvasWrap').classList.remove('moving-object');
      $('#surfaceProbe').hidden = true;
      if (element && drag.moved) {
        commitPlanarEdit('move', drag.before, drag.id, `Moved ${element.name} · X ${element.x.toFixed(2)} · Y ${element.y.toFixed(2)} mm`);
      } else if (element) {
        showElementProxy(element, 'hover', .18);
        renderInspector(); renderSelectionHud();
        if (element.type === 'text' && !element.locked) requestAnimationFrame(() => {
          const input = $('#selectionHud [data-inline-text-editor]');
          input?.focus(); input?.select();
          $('#stageHint').textContent = `Edit “${element.text}” directly, then press Enter · drag the center handle to move`;
        });
      }
      return;
    }
    if (!clickStart || clickStart.id !== event.pointerId) return;
    const wasClick = !clickStart.moved;
    const wasPlacing = clickStart.placing;
    clickStart = null;
    if (!wasClick || state.view !== '3d' || !state.viewer) return;
    if (wasPlacing && state.pendingInsert) {
      event.preventDefault(); event.stopImmediatePropagation();
      updatePlacementPreview(event);
      if (!state.pendingInsert.valid || !state.pendingInsert.hit) { toast('Place the complete preview inside a flat medal face.'); return; }
      const pending = state.pendingInsert;
      const assembly = pending.assembly;
      let placedElements = [pending.element];
      if (assembly?.parts?.length) {
        const scaleX = Math.max(.001, Number(pending.element.scaleX) || 1);
        const scaleY = Math.max(.001, Number(pending.element.scaleY) || 1);
        const backSign = pending.element.face === 'back' ? -1 : 1;
        placedElements = assembly.parts.map(part => ({
          ...part.element,
          x: pending.element.x + part.offsetX * scaleX,
          y: pending.element.y + part.offsetY * scaleY * backSign,
          face: pending.element.face,
          scaleX: (Number(part.element.scaleX) || 1) * scaleX,
          scaleY: (Number(part.element.scaleY) || 1) * scaleY,
          groupId: assembly.group.id,
        }));
      }
      if (pending.element.face === 'back') placedElements.forEach(element => enforceFlatBackArtwork(element, state.project));
      state.selectedId = assembly?.preferredId || placedElements[0].id;
      commit(project => {
        if (assembly) project.groups.push({ ...assembly.group });
        project.elements.push(...placedElements);
        project.template = 'custom';
      });
      state.placementEcho = { element: structuredClone(pending.element), revision: state.viewerRevision };
      cancelPlacement('', { keepGhost: true });
      markOnboardingStep('add');
      renderAll({ panel: state.panel === 'layers' });
      toast(pending.element.face === 'back'
        ? `${assembly ? `${placedElements.length} editable parts` : pending.element.name} placed on the back · embedded flush in the first layer`
        : `${assembly ? `${placedElements.length} editable parts` : pending.element.name} placed on the front · drag a part to move it or use its blue height handle`);
      return;
    }
    const point = state.viewer.screenToDesignPlane(event.clientX, event.clientY, medalTopZ() + .001);
    if (!point) return;
    const surfaceHit = pickElementIn3D(event.clientX, event.clientY);
    const hit = surfaceHit?.element || hitElement(point);
    state.selectedId = hit?.id || null;
    renderInspector();
    renderSelectionHud();
    if (hit) $('#stageHint').textContent = translateUiKey(hit.face === 'back' ? 'stage.selectedBack' : 'stage.selectedFront', { name: hit.name });
    else if (surfaceHit?.surface?.face === 'bottom') $('#stageHint').textContent = translateUiKey('stage.backSurface');
    else if (surfaceHit?.surface?.face === 'side') $('#stageHint').textContent = translateUiKey('stage.edgeSurface');
  });
  modelCanvas.addEventListener('pointercancel', event => {
    if (state.modelDrag?.pointerId === event.pointerId) {
      state.project = normalizeProject(JSON.parse(state.modelDrag.before));
      state.modelDrag = null;
      $('#canvasWrap').classList.remove('moving-object');
      clearElementProxy('drag');
      renderAll({ panel: true });
    }
    clickStart = null;
    $('#surfaceProbe').hidden = true;
  });
  modelCanvas.addEventListener('dblclick', event => {
    if (state.liveEdit || state.pendingInsert || state.view !== '3d') return;
    const picked = pickElementIn3D(event.clientX, event.clientY);
    const planePoint = state.viewer?.screenToDesignPlane(event.clientX, event.clientY, medalTopZ());
    const hit = picked?.element || (planePoint ? hitElement(planePoint) : null);
    if (!hit || hit.type !== 'text') return;
    event.preventDefault(); event.stopImmediatePropagation();
    state.selectedId = hit.id;
    renderInspector(); renderSelectionHud();
    const input = $('#selectionHud [data-inline-text-editor]');
    input?.focus(); input?.select();
    $('#stageHint').textContent = translateUiKey('stage.editingText', { text: hit.text });
  });
  modelCanvas.addEventListener('pointerleave', () => {
    if (state.modelDrag || state.gizmoDrag) return;
    state.hoveredId = null;
    $('#surfaceProbe').hidden = true;
    clearElementProxy('hover');
    state.viewer?.clearHoverSurface();
  });
  modelCanvas.addEventListener('medalviewerchange', () => {
    renderPushPullGizmo();
    renderTransformGizmo();
    if (state.view === '2d') drawMedal();
  });
  $$('[data-camera]').forEach(button => button.addEventListener('click', () => applyCameraPreset(button.dataset.camera, true)));
  modelCanvas.addEventListener('keydown', event => {
    if (!state.viewer || state.view !== '3d') return;
    const key = event.key.toLowerCase();
    if (['0', '1', '2', 'f', '+', '=', '-', '_', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
      event.preventDefault();
      event.stopPropagation();
    } else return;
    if (key === '0') applyCameraPreset('iso', true);
    else if (key === '1') applyCameraPreset('top', true);
    else if (key === '2') applyCameraPreset('bottom', true);
    else if (key === 'f') { state.viewer.fit(); announce('Medal fitted in view'); }
    else if (key === '+' || key === '=') state.viewer.zoom(.9);
    else if (key === '-' || key === '_') state.viewer.zoom(1.1);
    else {
      const dx = key === 'arrowleft' ? -18 : key === 'arrowright' ? 18 : 0;
      const dy = key === 'arrowup' ? -18 : key === 'arrowdown' ? 18 : 0;
      if (event.shiftKey) { state.viewer.pan(dx, dy); state.viewer.renderNow(); }
      else {
        state.viewer.orbit(dx, dy);
        $$('[data-camera]').forEach(item => item.classList.toggle('active', item.dataset.camera === 'iso'));
        $('#workspaceModeLabel').textContent = '3D medal';
        $('#workspaceModeHelp').textContent = 'Drag empty space to rotate · click artwork to edit it';
      }
    }
  });
  $('#fitModel').addEventListener('click', () => state.viewer?.fit());
  $('#toggleInspectLayers').addEventListener('click', () => {
    setInspectionOpen(!state.inspectionOpen, { focus: state.inspectionOpen === false });
  });
  $('#open2dSlice').addEventListener('click', openExactLayerSlice);
  $('#close2dSlice').addEventListener('click', () => { setView('3d'); setInspectionOpen(true, { focus: true, mark: false }); });
  $('#projectionToggle').addEventListener('click', event => {
    const next = event.currentTarget.dataset.projection === 'orthographic' ? 'perspective' : 'orthographic';
    updateProjectionToggle(next);
    state.viewer?.setProjection(next);
  });
  $('#layerSlider').addEventListener('input', updateLayerPreview);
  $('#explodeSlider').addEventListener('input', event => { const value = Number(event.target.value); $('#explodeLabel').textContent = `${value.toFixed(1)} mm`; state.viewer?.setExplode(value); });
  $('#viewerGrid').addEventListener('change', event => state.viewer?.setGrid(event.target.checked));
  $('#viewerRibbon').checked = state.ribbonPreviewVisible;
  $('#viewerRibbonColor').value = state.ribbonPreviewColor;
  $('#viewerRibbon').addEventListener('change', event => {
    state.ribbonPreviewVisible = event.target.checked;
    setLocalPreference('medalforge-ribbon-visible', state.ribbonPreviewVisible ? '1' : '0');
    updateRibbonPreview();
    if (state.ribbonPreviewVisible) state.viewer?.fit();
    toast(state.ribbonPreviewVisible ? 'Ribbon preview shown · visualization only' : 'Ribbon preview hidden');
  });
  $('#viewerRibbonColor').addEventListener('input', event => {
    state.ribbonPreviewColor = event.target.value;
    setLocalPreference('medalforge-ribbon-color', state.ribbonPreviewColor);
    updateRibbonPreview();
  });
  $('#showAllParts').addEventListener('click', () => { $$('[data-part-visible]').forEach(input => { input.checked = true; state.viewer?.setVisibility(Number(input.dataset.partVisible), true); }); });
  $('#savePreview').addEventListener('click', openRenderStudio);
}

function openGlobalSettings() {
  closeTemplateGallery();
  state.settingsReturnFocus = document.activeElement;
  $('#globalSettingsDrawer').hidden = false;
  setCustomModalBackgroundInert($('#globalSettingsDrawer'));
  $('#globalSettingsButton').setAttribute('aria-expanded', 'true');
  $('#globalSettingsRailButton').setAttribute('aria-expanded', 'true');
  renderAll({ panel: false, inspector: false });
  requestAnimationFrame(() => $('#closeGlobalSettings')?.focus());
}

function closeGlobalSettings() {
  const drawer = $('#globalSettingsDrawer');
  const wasOpen = !drawer.hidden;
  drawer.hidden = true;
  setCustomModalBackgroundInert(null);
  $('#globalSettingsButton').setAttribute('aria-expanded', 'false');
  $('#globalSettingsRailButton').setAttribute('aria-expanded', 'false');
  if (wasOpen && state.settingsReturnFocus?.isConnected) state.settingsReturnFocus.focus();
  state.settingsReturnFocus = null;
}

function bindStaticEvents() {
  $$('.tool[data-panel]').forEach(button => button.addEventListener('click', () => {
    const sidePanel = $('.side-panel');
    const same = state.panel === button.dataset.panel;
    const wasOpen = sidePanel?.classList.contains('mobile-open') === true;
    const compactWorkspace = window.matchMedia?.('(max-width: 900px)')?.matches ?? window.innerWidth <= 900;
    cancelPlacement();
    state.hoveredId = null;
    $('#surfaceProbe').hidden = true;
    clearElementProxy('hover');
    state.viewer?.clearHoverSurface();
    state.panel = button.dataset.panel;
    if (state.panel === 'create' && state.createTool === 'draw') enterSketchMode();
    else {
      cancelDrawing(false);
      state.drawing.mode = 'select';
      setView('3d');
    }
    $$('.tool[data-panel]').forEach(item => item.classList.toggle('active', item === button));
    renderToolPanel();
    if (compactWorkspace && sidePanel) {
      const shouldOpen = !(same && wasOpen);
      sidePanel.classList[shouldOpen ? 'add' : 'remove']('mobile-open');
    }
  }));
  $('#dismissCanvasEmpty')?.addEventListener('click', dismissCanvasEmpty);
  $('#newDesignButton').addEventListener('click', openNewDesignWizard);
  $('#newDesignRailButton').addEventListener('click', openNewDesignWizard);
  $('#examplesButton').addEventListener('click', openTemplateGallery);
  $('#examplesRailButton').addEventListener('click', openTemplateGallery);
  $('#closeTemplateGallery').addEventListener('click', closeTemplateGallery);
  $('[data-close-gallery]').addEventListener('click', closeTemplateGallery);
  $('#globalSettingsButton').addEventListener('click', openGlobalSettings);
  $('#globalSettingsRailButton').addEventListener('click', openGlobalSettings);
  $('#closeGlobalSettings').addEventListener('click', closeGlobalSettings);
  $('[data-close-settings]').addEventListener('click', closeGlobalSettings);
  $('#finishSketchMode').addEventListener('click', finishSketchMode);
  $$('[data-nozzle]').forEach(button=>button.addEventListener('click',()=>{const nozzle=Number(button.dataset.nozzle);const layers={'.2':.1,'.4':.2,'.6':.3,'.8':.4};commit(project=>{project.profile.nozzle=nozzle;project.profile.layerHeight=layers[nozzle.toFixed(1)]||nozzle/2;snapProjectLayerHeights(project);project.template='custom';},{panel:true});syncDrawingDefaults(false);renderToolPanel();reprocessImportedImages('nozzle change');}));
  $('#removeDesignColor')?.addEventListener('click', () => changeColorCount(state.project.paletteIds.length - 1));
  $('#addDesignColor')?.addEventListener('click', event => openFilamentChooser('settings', event.currentTarget));
  $('#designColorCount')?.addEventListener('change', event => {
    const requested = Math.round(Number(event.target.value) || state.project.paletteIds.length);
    if (requested > state.project.paletteIds.length) {
      event.target.value = state.project.paletteIds.length;
      openFilamentChooser('settings', event.target);
      return;
    }
    changeColorCount(requested);
  });
  $('#addObjectGroup')?.addEventListener('click', () => openGroupDialog());
  $('#acceptLiveEdit')?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); finalizeLiveEdit(); });
  $('#cancelLiveEdit')?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); cancelLiveEdit(); });
  $('#hardenedNozzle').addEventListener('change',event=>commit(project=>{project.profile.hardened=event.target.checked;project.template='custom';}));
  $('#layerHeightInput').addEventListener('change',event=>{commit(project=>{project.profile.layerHeight=Number(event.target.value);snapProjectLayerHeights(project);project.template='custom';});syncDrawingDefaults(false);renderToolPanel();toast('Layer-snapped heights updated to the new profile');});
  $('#colorSystem').addEventListener('change',event=>commit(project=>{project.profile.colorSystem=event.target.value;project.template='custom';}));
  $('#meshQuality').addEventListener('change',event=>commit(project=>{project.profile.meshQuality=event.target.value;project.template='custom';}));
  $('#sliceLayerSlider').addEventListener('input', event => { state.sliceLayer = Number(event.target.value); renderLayerPreviewControls(); drawMedal(); });
  $('#dismissQuickStart').addEventListener('click', () => { state.onboardingDismissed = true; setLocalPreference('medalforge-onboarding-dismissed', '1'); $('#quickStart').hidden = true; });
  $('#quickStartSteps').addEventListener('click', event => {
    const button = event.target.closest('[data-onboarding-action]');
    if (!button) return;
    event.preventDefault();
    activateOnboardingAction(Number(button.dataset.onboardingAction));
  });
  $('#helpButton')?.addEventListener('click', () => openGuideLibrary());
  $('#watchQuickGuide')?.addEventListener('click', () => openGuideLibrary('overview'));
  const quantityInput = $('#quantity');
  const updateQuantity = (normalize = false) => {
    const requested = Number(quantityInput.value);
    if (Number.isFinite(requested)) state.quantity = Math.max(1, Math.min(10000, Math.round(requested)));
    if (normalize || !Number.isFinite(requested) || requested < 1 || requested > 10000 || requested !== Math.round(requested)) quantityInput.value = String(state.quantity);
    renderChecks(); renderPrice();
  };
  quantityInput.addEventListener('input', () => updateQuantity(false));
  quantityInput.addEventListener('change', () => updateQuantity(true));
  quantityInput.addEventListener('blur', () => updateQuantity(true));
  const changeWorkspaceZoom = direction => {
    if (state.view !== 'toolpath' && state.viewer) {
      state.viewer.zoom(direction > 0 ? .9 : 1.1);
      $('#zoomLabel').textContent = '3D';
    } else {
      state.zoom = Math.max(.65, Math.min(1.35, state.zoom + direction * .1));
      $('#zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
      drawMedal();
    }
  };
  $('#zoomIn').addEventListener('click', () => changeWorkspaceZoom(1));
  $('#zoomOut').addEventListener('click', () => changeWorkspaceZoom(-1));
  $('#undoButton').addEventListener('click',undo);$('#redoButton').addEventListener('click',redo);
  $('#saveButton').addEventListener('click', async () => {
    if (state.imageReprocessBusy) { toast('Wait for the image update to finish before saving a copy'); return; }
    if (state.qaMode) { toast('This quality-check example is temporary'); return; }
    await saveProjectCopy();
  });
  $('#myMedalsButton')?.addEventListener('click', showProjectLibrary);
  $('#myMedalsRailButton')?.addEventListener('click', showProjectLibrary);
  $('#saveState')?.addEventListener('click', () => $('#saveState').classList.contains('error') ? downloadEmergencyBackup() : showProjectLibrary());
  $$('[data-empty-tool]').forEach(button => button.addEventListener('click', () => {
    state.panel = 'create'; state.createTool = button.dataset.emptyTool; renderAll({ panel: true });
    if (window.innerWidth <= 900) $('.side-panel')?.classList.add('mobile-open');
  }));
  $('#exportButton').addEventListener('click',showExportDialog);$('#editStockButton').addEventListener('click',showInventoryDialog);$('#profileInfoButton').addEventListener('click',showProfileInfo);$('#reviewButton').addEventListener('click',showChecksDialog);$('#openChecksButton').addEventListener('click',showChecksDialog);$('#reviewOrder').addEventListener('click',showPriceDialog);
  $('#dialogClose').addEventListener('click',closeDialog);dialog.addEventListener('click',event=>{if(event.target===dialog)closeDialog();});
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  $('#assetInput').addEventListener('change',event=>{if(event.target.files[0])handleAssetFile(event.target.files[0]);});$('#projectInput').addEventListener('change',event=>{if(event.target.files[0])handleProjectFile(event.target.files[0]);});
  $('#projectNameInput').addEventListener('focus',()=>{state.inspectorEditStart=snapshot();});$('#projectNameInput').addEventListener('input',event=>{state.project.name=event.target.value;state.project.template='custom';$('#undoButton').disabled=false;$('#redoButton').disabled=true;markSavePending();});$('#projectNameInput').addEventListener('change',()=>{state.project=normalizeProject(state.project);pushHistory(state.inspectorEditStart);state.inspectorEditStart=null;renderAll({panel:true});});
  window.addEventListener('resize',()=>{resizeCanvas();state.viewer?.resize();renderPushPullGizmo();renderTransformGizmo();});
  window.addEventListener(LANGUAGE_CHANGE_EVENT, () => {
    renderLocalizedWorkspaceChrome();
    renderAll({ panel: true });
    if (state.viewerResult?.meshes?.length && state.viewerResult?.bounds) {
      renderModelStats(state.viewerResult.meshes, state.viewerResult.bounds, state.viewerResult.cell, state.viewerResult.maxHeight);
    }
    if (dialog.open) localizeSubtree(dialog);
    localizeSubtree(document.body);
  });
  window.addEventListener('pagehide', () => { clearTimeout(state.saveTimer); if (state.saveDirty) void persistProject(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && state.saveDirty) { clearTimeout(state.saveTimer); void persistProject(); } });
  window.addEventListener('beforeunload', event => { state.cloudImageAbortController?.abort(); if (state.saveDirty) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('keydown',event=>{
    const activeEditor = document.activeElement;
    const editing=['INPUT','TEXTAREA','SELECT'].includes(activeEditor?.tagName)||activeEditor?.isContentEditable;
    const interactive = activeEditor?.closest?.('button, a[href], input, textarea, select, summary, [role="button"], [contenteditable]');
    const projectEditor = activeEditor?.matches?.('#selectionInspector [data-element-field], #selectionInspector [data-element-dimension], #projectNameInput');
    if (event.key === 'Tab' && !$('#templateGallery').hidden && trapModalFocus(event, $('#templateGallery'))) return;
    if (event.key === 'Tab' && !$('#globalSettingsDrawer').hidden && trapModalFocus(event, $('#globalSettingsDrawer'))) return;
    if(event.key==='Escape'&&dialog.open){closeDialog();return;}
    if(event.key==='Escape'&&!$('#canvasEmpty').hidden){event.preventDefault();dismissCanvasEmpty();return;}
    if(event.key==='Escape'&&!$('#templateGallery').hidden){closeTemplateGallery();return;}
    if(event.key==='Escape'&&!$('#globalSettingsDrawer').hidden){closeGlobalSettings();return;}
    if (event.key === 'Escape' && state.liveEdit) { event.preventDefault(); cancelLiveEdit(); return; }
    if(projectEditor&&(event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){
      event.preventDefault();
      activeEditor.blur();
      if(event.key.toLowerCase()==='y'||event.shiftKey)redo();else undo();
      return;
    }
    if(editing || interactive)return;
    if(event.key==='Escape'&&state.pendingInsert){cancelPlacement('Placement cancelled');renderAll({panel:false});return;}
    if (state.view === '2d' && state.drawing.mode === 'polygon' && state.drawing.points.length) {
      if (event.key === 'Enter') { event.preventDefault(); finishPolygon(); return; }
      if (event.key === 'Backspace') { event.preventDefault(); state.drawing.points.pop(); state.drawing.hover = state.drawing.points.at(-1) || null; renderToolPanel(); drawMedal(); return; }
      if (event.key === 'Escape') { event.preventDefault(); cancelDrawing(true); return; }
    }
    if (event.key === 'Escape' && (state.drawing.active || state.drawing.measurement)) { event.preventDefault(); state.drawing.measurement = null; cancelDrawing(true); return; }
    if (event.key === 'Escape' && state.view === '2d') { event.preventDefault(); finishSketchMode(); return; }
    if (state.view === '2d' && !event.ctrlKey && !event.metaKey && !event.altKey) { const mode = { v:'select', b:'brush', l:'line', p:'polygon', e:'erase', m:'measure' }[event.key.toLowerCase()]; if (mode) { event.preventDefault(); setDrawMode(mode); return; } }
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)redo();else undo();return;}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();return;}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'&&state.selectedId){event.preventDefault();duplicateSelected();return;}
    if((event.key==='F2'||event.key==='Enter')&&selectedElement()?.type==='text'){event.preventDefault();const input=$('#selectionHud [data-inline-text-editor]')||$('#selectionInspector [data-element-field="text"]');input?.focus();input?.select();return;}
    if((event.key==='Delete'||event.key==='Backspace')&&state.selectedId){event.preventDefault();deleteSelected();return;}
    if((event.key==='['||event.key===']')&&state.selectedId){event.preventDefault();commit(project=>{const element=project.elements.find(item=>item.id===state.selectedId);if(!element||element.locked||element.operation==='cut')return;const field=element.operation==='raise'?'zHeight':'zDepth';const delta=event.key===']'?project.profile.layerHeight:-project.profile.layerHeight;const limit=field==='zHeight'?DESIGN_LIMITS.reliefHeightMax:Math.max(.05,project.medal.baseThickness-project.medal.minimumFloor);const minimum=field==='zHeight'?project.profile.layerHeight:Math.min(project.profile.layerHeight,limit);element[field]=Math.max(minimum,Math.min(limit,snapToLayer(element[field]+delta,project.profile.layerHeight)));},{panel:state.panel==='layers'});return;}
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&state.selectedId){event.preventDefault();const amount=event.shiftKey?1:.2;commit(project=>{const element=project.elements.find(item=>item.id===state.selectedId);if(!element||element.locked)return;if(event.key==='ArrowLeft')element.x-=amount;if(event.key==='ArrowRight')element.x+=amount;if(event.key==='ArrowUp')element.y-=amount;if(event.key==='ArrowDown')element.y+=amount;constrainElement(element);},{panel:state.panel==='layers'});}
  });
  bindCanvas();
  bindViewerControls();
  bindPushPullGizmo();
  bindTransformGizmo();
}

async function initialize() {
  renderLocalizedWorkspaceChrome();
  const storedInventory = state.qaMode ? null : await loadRecord('inventory','catalog',null);
  state.inventory = state.qaMode
    ? normalizeInventory(DEFAULT_INVENTORY)
    : Array.isArray(storedInventory)&&storedInventory.length>=2?normalizeInventory(storedInventory):normalizeInventory(DEFAULT_INVENTORY);
  const storedProject = state.qaMode ? null : await loadRecord('projects','active',null);
  const storedLibrary = state.qaMode ? [] : await loadRecord('settings', 'project-library', []);
  state.projectLibrary = Array.isArray(storedLibrary) ? storedLibrary.filter(item => item && typeof item === 'object') : [];
  if (!state.qaMode && storedProject && Number(storedProject.version || 1) < 7) await saveUserRecord('projects', `migration-backup-${Date.now()}`, storedProject);
  state.project = normalizeProject(state.qaMode ? fixtureProject() : storedProject || createTemplateProject('blank'));
  state.project.id = String(state.project.id || uid('project')).slice(0, 120);
  state.project.createdAt ||= new Date().toISOString();
  const catalog = mergeRequiredDefaultFilaments(state.inventory, state.project.paletteIds);
  state.inventory = catalog.inventory;
  if(!state.qaMode && (!storedInventory || catalog.added))await saveUserRecord('inventory','catalog',state.inventory);
  if (state.qaMode) {
    state.quantity = 1;
    state.onboardingDismissed = true;
    state.ribbonPreviewVisible = false;
    state.ribbonPreviewColor = '#2458d8';
    document.documentElement.dataset.qaFixture = qaTemplate;
    document.documentElement.dataset.qaMode = 'ephemeral';
  } else if (!storedProject) restartOnboarding();
  state.selectedId=state.project.elements[0]?.id||null;
  state.drawing.color=Math.min(1,state.project.paletteIds.length-1);
  syncDrawingDefaults(true);
  bindStaticEvents();
  renderToolPanel();
  renderAll({panel:false});
  if (!state.qaMode && storedProject) markLoadedDesignProgress();
  setView('3d');
  requestAnimationFrame(() => { resizeCanvas(); state.viewer?.resize(); });
  await persistProject();
  state.lastSavedSnapshot = snapshot();
  if (!state.qaMode && !storedProject) {
    requestAnimationFrame(openNewDesignWizard);
  }
}

initialize().catch(error=>{console.error(error);document.body.innerHTML=`<main style="padding:40px;font-family:Segoe UI,sans-serif"><h1>MedalForge could not start</h1><p>${escapeHtml(error.message)}</p></main>`;});
