/**
 * Pure presentation-rendering model shared by the Medal Render Studio UI and
 * the WebGL viewer.  This module deliberately has no DOM or WebGL dependency,
 * which keeps material previews deterministic and makes the same rules usable
 * by future desktop and server renderers.
 */

export const RENDER_STUDIO_VERSION = 1;
export const DEFAULT_RENDER_SCENE = 'studio';
export const RENDER_EXPORT_RESOLUTIONS = Object.freeze([1024, 2048, 3072]);
export const MAX_RENDER_EXPORT_DIMENSION = 3072;
export const MAX_RENDER_EXPORT_PIXELS = MAX_RENDER_EXPORT_DIMENSION ** 2;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function finite(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max, fallback = min) {
  return Math.max(min, Math.min(max, finite(value, fallback)));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function normalizeHex(value, fallback = '#808080') {
  const source = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/iu.test(source)) return source.toLowerCase();
  if (/^#[0-9a-f]{3}$/iu.test(source)) {
    return `#${[...source.slice(1)].map(character => `${character}${character}`).join('')}`.toLowerCase();
  }
  return fallback;
}

function hexToRgb(value) {
  const hex = normalizeHex(value).slice(1);
  return [0, 2, 4].map(offset => round(parseInt(hex.slice(offset, offset + 2), 16) / 255, 5));
}

function channelLuminance(channel) {
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
}

function colorLuminance(value) {
  const [red, green, blue] = hexToRgb(value).map(channelLuminance);
  return round(red * .2126 + green * .7152 + blue * .0722, 4);
}

function mixHex(first, second, amount) {
  const a = hexToRgb(first), b = hexToRgb(second);
  const ratio = clamp(amount, 0, 1, 0);
  const channels = a.map((channel, index) => Math.round((channel * (1 - ratio) + b[index] * ratio) * 255));
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

export const RENDER_BACKGROUND_PRESETS = deepFreeze({
  'warm-white': {
    id: 'warm-white',
    label: 'Warm white',
    type: 'gradient',
    topColor: '#fffdf7',
    bottomColor: '#ded8cc',
    groundColor: '#d5cec0',
    transparent: false,
  },
  'studio-light': {
    id: 'studio-light',
    label: 'Soft studio',
    type: 'gradient',
    topColor: '#f1f4f1',
    bottomColor: '#c5ccc8',
    groundColor: '#c1c8c3',
    transparent: false,
  },
  graphite: {
    id: 'graphite',
    label: 'Graphite',
    type: 'gradient',
    topColor: '#252b31',
    bottomColor: '#080b0e',
    groundColor: '#101419',
    transparent: false,
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    type: 'gradient',
    topColor: '#071522',
    bottomColor: '#000204',
    groundColor: '#02060a',
    transparent: false,
  },
  transparent: {
    id: 'transparent',
    label: 'Transparent',
    type: 'transparent',
    topColor: '#000000',
    bottomColor: '#000000',
    groundColor: '#000000',
    transparent: true,
  },
});

export const RENDER_SCENE_PRESETS = deepFreeze({
  daylight: {
    id: 'daylight',
    label: 'Daylight',
    mode: 'daylight',
    background: 'warm-white',
    exposure: 1.08,
    glowStrength: 1,
    bloom: .12,
    shadowStrength: .28,
    light: { azimuth: -38, elevation: 58, intensity: 1.22, ambient: .52, softness: .72 },
  },
  studio: {
    id: 'studio',
    label: 'Soft studio',
    mode: 'studio',
    background: 'studio-light',
    exposure: 1,
    glowStrength: 1,
    bloom: .18,
    shadowStrength: .36,
    light: { azimuth: -32, elevation: 46, intensity: 1.08, ambient: .4, softness: .86 },
  },
  dark: {
    id: 'dark',
    label: 'Dark room',
    mode: 'dark',
    background: 'graphite',
    exposure: 1.05,
    glowStrength: 1.2,
    bloom: .72,
    shadowStrength: .54,
    light: { azimuth: -28, elevation: 35, intensity: .55, ambient: .13, softness: .68 },
  },
  glow: {
    id: 'glow',
    label: 'Glow preview',
    mode: 'glow',
    background: 'midnight',
    exposure: 1.04,
    glowStrength: 1.8,
    bloom: 1.1,
    shadowStrength: .2,
    light: { azimuth: -24, elevation: 28, intensity: .07, ambient: .012, softness: .78 },
  },
});

const VALID_SCENE_MODES = new Set(Object.keys(RENDER_SCENE_PRESETS));

/**
 * Resolve a named, solid-colour, gradient, or transparent background into a
 * renderer-ready value. Unknown input falls back to the soft studio backdrop.
 */
export function resolveRenderBackground(input = 'studio-light', fallbackId = 'studio-light') {
  const fallback = RENDER_BACKGROUND_PRESETS[fallbackId] || RENDER_BACKGROUND_PRESETS['studio-light'];
  let source = input;

  if (typeof source === 'string') {
    const key = source.trim().toLowerCase();
    if (RENDER_BACKGROUND_PRESETS[key]) source = RENDER_BACKGROUND_PRESETS[key];
    else if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/iu.test(key)) {
      const color = normalizeHex(key);
      source = { id: 'custom', label: 'Custom', type: 'solid', topColor: color, bottomColor: color, groundColor: color };
    } else source = fallback;
  }

  if (!source || typeof source !== 'object') source = fallback;
  const preset = RENDER_BACKGROUND_PRESETS[String(source.id || '').toLowerCase()];
  if (preset) source = { ...preset, ...source };

  const transparent = source.transparent === true || source.type === 'transparent';
  const type = transparent ? 'transparent' : source.type === 'solid' ? 'solid' : 'gradient';
  const topColor = normalizeHex(source.topColor || source.color, fallback.topColor);
  const bottomColor = type === 'solid'
    ? topColor
    : normalizeHex(source.bottomColor || source.color, fallback.bottomColor);
  const groundColor = normalizeHex(source.groundColor, bottomColor);
  const luminance = transparent ? 0 : round((colorLuminance(topColor) + colorLuminance(bottomColor)) / 2, 4);

  return {
    id: String(source.id || 'custom'),
    label: String(source.label || 'Custom'),
    type,
    topColor,
    bottomColor,
    groundColor,
    topRgb: hexToRgb(topColor),
    bottomRgb: hexToRgb(bottomColor),
    groundRgb: hexToRgb(groundColor),
    transparent,
    luminance,
  };
}

/**
 * Normalize user-controlled scene settings. Convenience scalar overrides are
 * accepted so a slider need not reconstruct the nested `light` object.
 */
export function normalizeRenderSettings(input = DEFAULT_RENDER_SCENE) {
  const settings = typeof input === 'string' ? { presetId: input } : (input && typeof input === 'object' ? input : {});
  const requestedPreset = String(settings.presetId || settings.preset || DEFAULT_RENDER_SCENE).toLowerCase();
  const presetId = RENDER_SCENE_PRESETS[requestedPreset] ? requestedPreset : DEFAULT_RENDER_SCENE;
  const preset = RENDER_SCENE_PRESETS[presetId];
  const requestedMode = String(settings.mode || preset.mode).toLowerCase();
  const mode = VALID_SCENE_MODES.has(requestedMode) ? requestedMode : preset.mode;
  const lightInput = settings.light && typeof settings.light === 'object' ? settings.light : {};
  const backgroundInput = settings.transparentBackground === true
    ? 'transparent'
    : (settings.background ?? settings.backgroundId ?? preset.background);

  return {
    version: RENDER_STUDIO_VERSION,
    presetId,
    mode,
    background: resolveRenderBackground(backgroundInput, preset.background),
    light: {
      azimuth: round(clamp(settings.lightAzimuth ?? lightInput.azimuth, -180, 180, preset.light.azimuth), 1),
      elevation: round(clamp(settings.lightElevation ?? lightInput.elevation, -10, 90, preset.light.elevation), 1),
      intensity: round(clamp(settings.lightIntensity ?? lightInput.intensity, 0, 3, preset.light.intensity)),
      ambient: round(clamp(settings.ambient ?? lightInput.ambient, 0, 1.5, preset.light.ambient)),
      softness: round(clamp(settings.lightSoftness ?? lightInput.softness, 0, 1, preset.light.softness)),
    },
    exposure: round(clamp(settings.exposure, .25, 2.5, preset.exposure)),
    glowStrength: round(clamp(settings.glowStrength, 0, 3, preset.glowStrength)),
    bloom: round(clamp(settings.bloom, 0, 2, preset.bloom)),
    shadowStrength: round(clamp(settings.shadowStrength, 0, 1, preset.shadowStrength)),
    temperatureC: round(clamp(settings.temperatureC, -20, 80, 22), 1),
  };
}

export function isDarkRenderScene(scene) {
  const mode = typeof scene === 'string'
    ? String(RENDER_SCENE_PRESETS[scene]?.mode || scene).toLowerCase()
    : String(scene?.mode || RENDER_SCENE_PRESETS[scene?.presetId]?.mode || '').toLowerCase();
  return mode === 'dark' || mode === 'glow';
}

function effectDescription(source) {
  if (typeof source === 'string') return source;
  if (!source || typeof source !== 'object') return '';
  const values = [source.effect, source.finish, source.type, source.material, source.name, source.brand];
  if (Array.isArray(source.tags)) values.push(...source.tags);
  return values.filter(Boolean).join(' ');
}

function searchableText(source) {
  return effectDescription(source)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase();
}

/** Classify inventory and custom-filament descriptions without requiring IDs. */
export function classifyFilamentEffect(filament) {
  const text = searchableText(filament);
  const flags = {
    glow: /(?:\bglow\b|afterglow|phosphorescen|fluorescen|fosforescen|nachtleucht|sviet|svit)/u.test(text),
    silk: /(?:\bsilk\b|satin|pearl|metallic|hodvab|hedvab|jedwab|leskl)/u.test(text),
    matte: /(?:\bmatte?\b|\bmatt\b|matny|matowy)/u.test(text),
    galaxy: /(?:galaxy|glitter|sparkle|stardust|star dust|brokat|trbliet)/u.test(text),
    wood: /(?:\bwood|wood-filled|bamboo|cork|drevo|drevn|holz)/u.test(text),
    carbon: /(?:carbon|carbon fiber|carbon-fibre|\bcf\b|karbon|kohlefaser)/u.test(text),
    thermo: /(?:thermo|temperature|heat[ -]?shift|colou?r[ -]?chang|teplot|termic|temperatur)/u.test(text),
  };
  const kind = ['glow', 'silk', 'matte', 'galaxy', 'wood', 'carbon', 'thermo'].find(key => flags[key]) || 'solid';
  return { kind, flags, source: text };
}

function stableSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return round((hash >>> 0) / 0xffffffff, 6);
}

/**
 * Derive compact shader parameters from a stock filament and a normalized (or
 * partial) scene. Glow emission is intentionally gated by both material type
 * and a Dark room / Glow preview scene; daylight never falsely emits light.
 */
export function deriveFilamentRenderMaterial(filament = {}, scene = DEFAULT_RENDER_SCENE) {
  const normalizedScene = normalizeRenderSettings(scene);
  const classification = classifyFilamentEffect(filament);
  const { flags } = classification;
  const color = normalizeHex(filament?.color || filament?.hex || filament?.colorHex, '#858b8d');

  let roughness = .52;
  let specular = .34;
  let metallic = .04;
  let sheen = .08;
  if (flags.silk) { roughness = .22; specular = .82; metallic = .16; sheen = .72; }
  if (flags.matte) { roughness = .86; specular = .12; metallic = .01; sheen = .02; }
  if (flags.galaxy) { roughness = .43; specular = .57; metallic = .12; sheen = .24; }
  if (flags.wood) { roughness = .74; specular = .19; metallic = 0; sheen = .03; }
  if (flags.carbon) { roughness = .61; specular = .46; metallic = .09; sheen = .1; }

  const darkScene = isDarkRenderScene(normalizedScene);
  const modeFactor = normalizedScene.mode === 'glow' ? 1 : .68;
  const emissionStrength = flags.glow && darkScene
    ? round(clamp(normalizedScene.glowStrength * modeFactor, 0, 3, 0))
    : 0;
  // Real glow pigments lose their daylight hue in darkness but remain visibly
  // coloured. Bias toward a saturated phosphor green instead of white so the
  // preview does not resemble a brightly lit ordinary filament.
  const emissionColor = flags.glow ? mixHex(color, '#39ff66', .32) : '#000000';
  const thermoShift = flags.thermo
    ? round(clamp((normalizedScene.temperatureC - 18) / 22, 0, 1, 0))
    : 0;

  return {
    kind: classification.kind,
    color,
    colorRgb: hexToRgb(color),
    roughness: round(roughness),
    specular: round(specular),
    metallic: round(metallic),
    sheen: round(sheen),
    emissionColor,
    emissionRgb: hexToRgb(emissionColor),
    emissionStrength,
    sparkle: flags.galaxy ? .68 : 0,
    sparkleSeed: flags.galaxy ? stableSeed(`${effectDescription(filament)}|${color}`) : 0,
    woodGrain: flags.wood ? .72 : 0,
    carbonWeave: flags.carbon ? .78 : 0,
    thermoShift,
    flags: { ...flags },
  };
}

export const RENDER_ASPECT_RATIOS = deepFreeze({
  '1:1': 1,
  '4:5': 4 / 5,
  '5:4': 5 / 4,
  '3:2': 3 / 2,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
});

const ASPECT_ALIASES = Object.freeze({
  square: '1:1',
  portrait: '4:5',
  landscape: '5:4',
  photo: '3:2',
  wide: '16:9',
  vertical: '9:16',
});

export function normalizeRenderResolution(value = 2048) {
  const requested = clamp(value, RENDER_EXPORT_RESOLUTIONS[0], MAX_RENDER_EXPORT_DIMENSION, 2048);
  return RENDER_EXPORT_RESOLUTIONS.reduce((closest, candidate) => (
    Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest
  ), RENDER_EXPORT_RESOLUTIONS[0]);
}

function resolveAspect(input) {
  const source = String(input || '1:1').trim().toLowerCase();
  const key = ASPECT_ALIASES[source] || source;
  if (RENDER_ASPECT_RATIOS[key]) return { id: key, ratio: RENDER_ASPECT_RATIOS[key] };
  const match = key.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/u);
  const parsed = match ? Number(match[1]) / Number(match[2]) : Number(input);
  const ratio = round(clamp(parsed, 1 / 2.4, 2.4, 1), 6);
  return { id: ratio === 1 ? '1:1' : 'custom', ratio };
}

function evenPixel(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * Normalize an image export around a safe long edge. Only the three deliberate
 * UI quality tiers are emitted and no aspect can exceed a 3072² browser budget.
 */
export function normalizeRenderExportSize(input = {}) {
  const options = typeof input === 'number' ? { resolution: input } : (input && typeof input === 'object' ? input : {});
  const suppliedWidth = finite(options.width, 0);
  const suppliedHeight = finite(options.height, 0);
  const inferredAspect = suppliedWidth > 0 && suppliedHeight > 0 ? suppliedWidth / suppliedHeight : null;
  const aspect = resolveAspect(options.aspect ?? inferredAspect ?? '1:1');
  const requestedLongEdge = options.resolution ?? (Math.max(suppliedWidth, suppliedHeight) || 2048);
  const resolution = normalizeRenderResolution(requestedLongEdge);
  let width, height;

  if (aspect.ratio >= 1) {
    width = resolution;
    height = evenPixel(resolution / aspect.ratio);
  } else {
    height = resolution;
    width = evenPixel(resolution * aspect.ratio);
  }

  const pixels = width * height;
  if (pixels > MAX_RENDER_EXPORT_PIXELS) {
    const scale = Math.sqrt(MAX_RENDER_EXPORT_PIXELS / pixels);
    width = evenPixel(width * scale);
    height = evenPixel(height * scale);
  }

  return {
    width,
    height,
    resolution: Math.max(width, height),
    qualityTier: RENDER_EXPORT_RESOLUTIONS.indexOf(resolution) + 1,
    aspect: aspect.id,
    aspectRatio: round(width / height, 6),
    pixels: width * height,
    safe: width <= MAX_RENDER_EXPORT_DIMENSION
      && height <= MAX_RENDER_EXPORT_DIMENSION
      && width * height <= MAX_RENDER_EXPORT_PIXELS,
  };
}
