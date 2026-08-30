export const DEFAULT_INVENTORY = [
  { id: 'midnight-black', name: 'Midnight Black', brand: 'PolyTerra', material: 'PLA', color: '#202a2f', pricePerKg: 590, stockGrams: 4500, effect: 'Matte', density: 1.24, abrasive: false },
  { id: 'electric-blue', name: 'Electric Blue', brand: 'Prusament', material: 'PLA', color: '#4d8ee8', pricePerKg: 620, stockGrams: 3100, effect: 'Solid', density: 1.24, abrasive: false },
  { id: 'natural-white', name: 'Natural White', brand: 'Spectrum', material: 'PLA', color: '#f4f2ea', pricePerKg: 560, stockGrams: 2500, effect: 'Solid', density: 1.24, abrasive: false },
  { id: 'signal-lime', name: 'Signal Lime', brand: 'Prusament', material: 'PLA', color: '#d9ef67', pricePerKg: 650, stockGrams: 1200, effect: 'Solid', density: 1.24, abrasive: false },
  { id: 'signal-red', name: 'Signal Red', brand: 'Spectrum', material: 'PLA', color: '#c83e32', pricePerKg: 590, stockGrams: 1400, effect: 'Solid', density: 1.24, abrasive: false },
  { id: 'glow-green', name: 'Afterglow Green', brand: 'Spectrum', material: 'PLA', color: '#8ed17d', pricePerKg: 980, stockGrams: 420, effect: 'Glow in dark', density: 1.27, abrasive: true },
  { id: 'galaxy-purple', name: 'Galaxy Purple', brand: 'Prusament', material: 'PLA', color: '#6c4f86', pricePerKg: 840, stockGrams: 900, effect: 'Galaxy', density: 1.25, abrasive: true },
  { id: 'thermo-red', name: 'Heatshift Red → Gold', brand: 'ColorFabb', material: 'PLA', color: '#b84b46', pricePerKg: 1150, stockGrams: 260, effect: 'Temperature changing', density: 1.24, abrasive: false },
  { id: 'silk-gold', name: 'Silk Gold', brand: 'Fiberlogy', material: 'PLA', color: '#d3a63d', pricePerKg: 890, stockGrams: 85, effect: 'Silk', density: 1.24, abrasive: false },
  { id: 'graphite-gray', name: 'Graphite Gray', brand: 'Spectrum', material: 'PLA', color: '#737a78', pricePerKg: 610, stockGrams: 1800, effect: 'Matte', density: 1.24, abrasive: false },
  { id: 'emerald-green', name: 'Emerald Green', brand: 'Spectrum', material: 'PLA', color: '#36a57b', pricePerKg: 590, stockGrams: 1600, effect: 'Solid', density: 1.24, abrasive: false },
];

export const DESIGN_LIMITS = Object.freeze({
  paletteSlots: 16,
  elements: 240,
  groups: 48,
  medalMin: 20,
  medalMax: 250,
  baseThicknessMax: 20,
  reliefHeightMax: 20,
  inlayHeightMax: 10,
  rimWidthMax: 12,
  rimHeightMax: 12,
  scaleMax: 40,
  textSizeMax: 60,
  shapeSizeMax: 200,
  imageSizeMax: 220,
  pathScaleMax: 20,
  pathStrokeMax: 8,
});

// Supplier references are starter records, never claimed as the user's stock.
// Prices are editable snapshots in CZK and intentionally carry their source date.
export const ASIA_FILAMENT_PRESETS = [
  { id: 'sunlu-pla-black', name: 'PLA Black', brand: 'SUNLU', material: 'PLA', color: '#171918', pricePerKg: 300, stockGrams: 0, stockKnown: false, effect: 'Solid', density: 1.24, abrasive: false, supplierRegion: 'Asia · EU warehouse', productUrl: 'https://store.sunlu.com/en-de/collections/sunlu-12th-anniversary-prime-deal-basic-filament-series-pla-petg-abs-1kg', sourcePrice: 11.99, sourceCurrency: 'EUR', priceUpdatedAt: '2026-08-27' },
  { id: 'sunlu-pla-white', name: 'PLA White', brand: 'SUNLU', material: 'PLA', color: '#f7f5ed', pricePerKg: 300, stockGrams: 0, stockKnown: false, effect: 'Solid', density: 1.24, abrasive: false, supplierRegion: 'Asia · EU warehouse', productUrl: 'https://store.sunlu.com/en-de/collections/sunlu-12th-anniversary-prime-deal-basic-filament-series-pla-petg-abs-1kg', sourcePrice: 11.99, sourceCurrency: 'EUR', priceUpdatedAt: '2026-08-27' },
  { id: 'sunlu-pla-red', name: 'PLA Red', brand: 'SUNLU', material: 'PLA', color: '#c63732', pricePerKg: 275, stockGrams: 0, stockKnown: false, effect: 'Solid', density: 1.24, abrasive: false, supplierRegion: 'Asia · EU warehouse', productUrl: 'https://store.sunlu.com/pl-it/collections/sunlu-basic-filaments', sourcePrice: 10.99, sourceCurrency: 'EUR', priceUpdatedAt: '2026-08-27' },
  { id: 'sunlu-pla-yellow', name: 'PLA Lemon Yellow', brand: 'SUNLU', material: 'PLA', color: '#f4d63d', pricePerKg: 300, stockGrams: 0, stockKnown: false, effect: 'Solid', density: 1.24, abrasive: false, supplierRegion: 'Asia · EU warehouse', productUrl: 'https://store.sunlu.com/pl-it/collections/sunlu-basic-filaments', sourcePrice: 11.99, sourceCurrency: 'EUR', priceUpdatedAt: '2026-08-27' },
  { id: 'bambu-pla-black', name: 'PLA Basic Black', brand: 'Bambu Lab', material: 'PLA', color: '#111313', pricePerKg: 575, stockGrams: 0, stockKnown: false, effect: 'Solid', density: 1.24, abrasive: false, supplierRegion: 'Asia · EU warehouse', productUrl: 'https://eu.store.bambulab.com/en-ro/products/pla-basic-filament', sourcePrice: 22.99, sourceCurrency: 'EUR', priceUpdatedAt: '2026-08-27' },
  { id: 'bambu-pla-cyan', name: 'PLA Basic Cyan', brand: 'Bambu Lab', material: 'PLA', color: '#17a8cc', pricePerKg: 575, stockGrams: 0, stockKnown: false, effect: 'Solid', density: 1.24, abrasive: false, supplierRegion: 'Asia · EU warehouse', productUrl: 'https://eu.store.bambulab.com/en-ro/products/pla-basic-filament', sourcePrice: 22.99, sourceCurrency: 'EUR', priceUpdatedAt: '2026-08-27' },
  { id: 'esun-pla-basic-orange', name: 'PLA Basic Orange', brand: 'eSUN', material: 'PLA', color: '#ee702d', pricePerKg: 450, stockGrams: 0, stockKnown: false, effect: 'Solid', density: 1.24, abrasive: false, supplierRegion: 'Asia · international store', productUrl: 'https://esun3dstore.com/products/pla-basic-bundle-sale', sourcePrice: 17.99, sourceCurrency: 'USD', priceUpdatedAt: '2026-08-27' },
  { id: 'esun-pla-basic-purple', name: 'PLA Basic Purple', brand: 'eSUN', material: 'PLA', color: '#734b91', pricePerKg: 450, stockGrams: 0, stockKnown: false, effect: 'Solid', density: 1.24, abrasive: false, supplierRegion: 'Asia · international store', productUrl: 'https://esun3dstore.com/products/pla-basic-bundle-sale', sourcePrice: 17.99, sourceCurrency: 'USD', priceUpdatedAt: '2026-08-27' },
];

const INVENTORY_LIMIT = 256;

function cleanLabel(value, fallback, maxLength) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (text || fallback).slice(0, maxLength);
}

function normalizeInventoryId(value, fallback = 'filament') {
  const id = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return id || fallback;
}

function normalizeHexColor(value, fallback = '#7a817e') {
  const color = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${color.slice(1).split('').map(character => character + character).join('')}`.toLowerCase();
  return fallback;
}

/** Normalize one untrusted filament record without retaining unknown fields. */
export function normalizeFilament(input, index = 0) {
  const source = input && typeof input === 'object' ? input : {};
  const fallback = DEFAULT_INVENTORY[index % DEFAULT_INVENTORY.length] || DEFAULT_INVENTORY[0];
  return {
    id: normalizeInventoryId(source.id, `filament-${index + 1}`),
    name: cleanLabel(source.name, fallback.name, 80),
    brand: cleanLabel(source.brand, 'Custom', 60),
    material: cleanLabel(source.material, fallback.material, 32).toUpperCase(),
    color: normalizeHexColor(source.color, fallback.color),
    pricePerKg: clampNumber(source.pricePerKg, 0, 1_000_000, fallback.pricePerKg),
    stockGrams: clampNumber(source.stockGrams, 0, 10_000_000, 0),
    stockKnown: source.stockKnown !== false,
    effect: cleanLabel(source.effect, 'Solid', 60),
    density: clampNumber(source.density, .5, 3, fallback.density),
    abrasive: Boolean(source.abrasive),
    supplierRegion: cleanLabel(source.supplierRegion, '', 80),
    productUrl: /^https:\/\//i.test(String(source.productUrl || '')) ? String(source.productUrl).slice(0, 500) : '',
    sourcePrice: clampNumber(source.sourcePrice, 0, 1_000_000, 0),
    sourceCurrency: cleanLabel(source.sourceCurrency, '', 8).toUpperCase(),
    priceUpdatedAt: /^\d{4}-\d{2}-\d{2}$/.test(String(source.priceUpdatedAt || '')) ? String(source.priceUpdatedAt) : '',
  };
}

/** Normalize a catalog snapshot and discard duplicate/untrusted records. */
export function normalizeInventory(input, options = {}) {
  const records = Array.isArray(input) ? input.slice(0, INVENTORY_LIMIT) : [];
  const inventory = [];
  const seen = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const filament = normalizeFilament(records[index], index);
    if (seen.has(filament.id)) continue;
    seen.add(filament.id);
    inventory.push(filament);
  }
  if (!inventory.length && options.fallbackDefaults !== false) return DEFAULT_INVENTORY.map((filament, index) => normalizeFilament(filament, index));
  return inventory;
}

export const TEMPLATE_INFO = {
  blank: { name: 'Untitled medal', label: 'Blank black medal', meta: 'Guided clean start', preview: '＋', className: 'blank' },
  'showcase-night': { name: 'Prague Midnight 21K · 2027', label: 'Prague Midnight 21K', meta: 'Sellable two-sided showcase · layered vector art', preview: '21K', className: 'showcase-night' },
  'photo-night': { name: 'Ľudánická nočná výzva 2026', label: 'Ľudánická nočná výzva', meta: 'Two photo-matched faces · 0.2 mm detail', preview: '2026', className: 'photo-night' },
  'photo-archive': { name: 'Archívna 10 2026', label: 'Archívna 10', meta: 'Two photo-matched faces · 6 colors', preview: '10', className: 'photo-archive' },
  'photo-tram': { name: 'Ivanka pri Nitre 2026', label: 'Ivanka pri Nitre', meta: 'Photo-matched front + completely flat back', preview: '18.9', className: 'photo-tram' },
  night: { name: 'Night Run 2026', label: 'Night Run', meta: '3 colors · 60 mm', preview: '10K', className: 'night' },
  finish: { name: 'Finish Line 2026', label: 'Finish Line', meta: '4 colors · 65 mm', preview: '01', className: 'finish' },
  school: { name: 'School Event', label: 'School Event', meta: '2 colors · 55 mm', preview: 'A+', className: 'school' },
};

/**
 * Raised edge treatments are manufacturing geometry, not viewport decoration.
 * Every style is sampled by the same local height-field that feeds preview,
 * price estimation, 3MF, and STL export.
 */
export const RIM_STYLE_INFO = {
  classic: { label: 'Classic ring', description: 'A clean continuous raised edge.', icon: '○', coverage: 1 },
  double: { label: 'Double ring', description: 'Two refined concentric edge bands.', icon: '◎', coverage: .7 },
  scalloped: { label: 'Scalloped', description: 'A soft repeating wave around the edge.', icon: '✿', coverage: .82 },
  faceted: { label: 'Faceted', description: 'Crisp separated facets for a technical look.', icon: '⬡', coverage: .9 },
  laurel: { label: 'Laurel', description: 'Leaf-like side arcs with an open crown.', icon: '❧', coverage: .56 },
  wings: { label: 'Victory wings', description: 'Layered side feathers framing the artwork.', icon: '⌁', coverage: .58 },
};

export const ATTACHMENT_STYLE_INFO = {
  single: { label: 'External bar', description: 'One closed ribbon opening above the medal.', fields: ['loopWidth', 'loopHeight', 'slotWidth', 'slotHeight'] },
  double: { label: 'Double bar', description: 'Two openings keep the ribbon centered.', fields: ['loopWidth', 'loopHeight', 'slotWidth', 'slotHeight'] },
  eyelet: { label: 'Round hole', description: 'A compact hole cut through the medal face.', fields: ['holeDiameter', 'attachmentInset'] },
  slit: { label: 'Internal slit', description: 'A closed horizontal opening inside the face.', fields: ['slitWidth', 'slitHeight', 'attachmentInset'] },
  'open-slit': { label: 'Quick-load slit', description: 'An edge channel accepts a pre-joined ribbon.', fields: ['slitWidth', 'slitHeight', 'attachmentInset'] },
  none: { label: 'No attachment', description: 'A plain medal body with no ribbon opening.', fields: [] },
};

const ATTACHMENT_ALIASES = {
  hole: 'eyelet', 'round-hole': 'eyelet', 'circular-hole': 'eyelet',
  'internal-slit': 'slit', internalSlit: 'slit',
  'edge-slit': 'open-slit', openSlit: 'open-slit',
};

export function medalAttachmentGeometry(project) {
  const medal = project?.medal || {};
  const style = ATTACHMENT_STYLE_INFO[medal.loopStyle] ? medal.loopStyle : 'single';
  const faceHeight = Number(medal.height || medal.diameter) || 60;
  const top = -faceHeight / 2;
  const external = style === 'single' || style === 'double';
  if (external) {
    const outerWidth = Number(medal.loopWidth) || 32, authoredHeight = Number(medal.loopHeight) || 8;
    const slotWidth = Number(medal.slotWidth) || 27, slotHeight = Number(medal.slotHeight) || 3.6;
    const outer = { kind: 'rounded-rect', cx: 0, cy: top - authoredHeight / 2 + 2, x0: -outerWidth / 2, x1: outerWidth / 2, y0: top - authoredHeight + 2, y1: top + 2, width: outerWidth, height: authoredHeight, radius: Math.min(2.4, authoredHeight / 3) };
    const slotY0 = outer.y0 + (authoredHeight - slotHeight) / 2;
    const bridge = style === 'double' ? Math.max(1.4, (Number(project?.profile?.nozzle) || .4) * 3) : 0;
    const each = style === 'double' ? Math.max(0, (slotWidth - bridge) / 2) : slotWidth;
    const apertures = style === 'double'
      ? [
          { kind: 'rounded-rect', x0: -slotWidth / 2, x1: -bridge / 2, y0: slotY0, y1: slotY0 + slotHeight, width: each, height: slotHeight, radius: Math.min(1.4, slotHeight / 2) },
          { kind: 'rounded-rect', x0: bridge / 2, x1: slotWidth / 2, y0: slotY0, y1: slotY0 + slotHeight, width: each, height: slotHeight, radius: Math.min(1.4, slotHeight / 2) },
        ]
      : [{ kind: 'rounded-rect', x0: -slotWidth / 2, x1: slotWidth / 2, y0: slotY0, y1: slotY0 + slotHeight, width: slotWidth, height: slotHeight, radius: Math.min(1.4, slotHeight / 2) }];
    return { style, external, top, outer, apertures, bridge, aperture: null, channel: null };
  }
  if (style === 'eyelet') {
    const diameter = Number(medal.holeDiameter) || 6;
    return { style, external: false, top, aperture: { kind: 'circle', cx: 0, cy: top + (Number(medal.attachmentInset) || 4) + diameter / 2, diameter }, channel: null };
  }
  if (style === 'slit' || style === 'open-slit') {
    const width = Number(medal.slitWidth) || 18, height = Number(medal.slitHeight) || 3.2;
    const y0 = top + (Number(medal.attachmentInset) || 4), y1 = y0 + height;
    return {
      style, external: false, top,
      aperture: { kind: 'rounded-rect', cx: 0, cy: (y0 + y1) / 2, x0: -width / 2, x1: width / 2, y0, y1, width, height },
      channel: style === 'open-slit' ? { x0: -height / 2, x1: height / 2, y0: top - .001, y1: (y0 + y1) / 2, width: height } : null,
    };
  }
  return { style, external: false, top, aperture: null, channel: null };
}

export function uid(prefix = 'item') {
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${token}`;
}

function text(name, value, x, y, size, color, weight = 800, options = {}) {
  return { id: uid('text'), type: 'text', name, text: value, x, y, fontSize: size, fontFamily: 'Arial', weight, rotation: options.rotation || 0, scaleX: 1, scaleY: 1, lockAspect: true, face: options.face === 'back' ? 'back' : 'front', color, operation: options.operation || 'raise', zHeight: options.zHeight ?? .6, zDepth: options.zDepth ?? .4, inlayHeight: options.inlayHeight || 0, layerSnap: true, combine: options.combine === 'stack' ? 'stack' : 'replace', groupId: options.groupId || null, hidden: false, locked: false };
}
function shape(name, kind, x, y, size, color, rotation = 0, options = {}) {
  return { id: uid('shape'), type: 'shape', name, shape: kind, x, y, size, color, rotation, scaleX: 1, scaleY: 1, lockAspect: true, face: options.face === 'back' ? 'back' : 'front', operation: options.operation || 'raise', zHeight: options.zHeight ?? .6, zDepth: options.zDepth ?? .4, inlayHeight: options.inlayHeight || 0, layerSnap: true, combine: options.combine === 'stack' ? 'stack' : 'replace', groupId: options.groupId || null, hidden: false, locked: false };
}
function path(name, points, x, y, color, options = {}) {
  return {
    id: uid('path'), type: 'path', name, points, x, y, scale: options.scale || 1,
    scaleX: 1, scaleY: 1, lockAspect: true, face: options.face === 'back' ? 'back' : 'front', closed: options.closed !== false,
    strokeWidth: options.strokeWidth || .9, rotation: options.rotation || 0, color,
    operation: options.operation || 'raise', zHeight: options.zHeight || .6, zDepth: options.zDepth || .4,
    inlayHeight: options.inlayHeight || 0, layerSnap: true, combine: options.combine === 'stack' ? 'stack' : 'replace', groupId: options.groupId || null, hidden: false, locked: false,
  };
}

function smoothClosedPath(points, iterations = 3) {
  let result = points.map(point => [...point]);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    result = result.flatMap((point, index) => {
      const next = result[(index + 1) % result.length];
      return [[point[0] * .75 + next[0] * .25, point[1] * .75 + next[1] * .25], [point[0] * .25 + next[0] * .75, point[1] * .25 + next[1] * .75]];
    });
  }
  return result;
}

// One anatomically coherent side-profile silhouette produces a much cleaner
// athlete than overlapping capsule limbs. Chaikin subdivision retains the
// authored pose while giving Ultra exports hundreds of smooth boundary points.
const DETAILED_RUNNER_BODY = smoothClosedPath([
  [-2.2,-7.4],[-.3,-7.8],[1.5,-6.8],[2.1,-4.9],[4.4,-3.5],[7.8,-1.2],[6.7,.3],[3.2,-1.4],[1.7,-1.8],[1.2,.1],
  [3,2.3],[7.5,5.1],[6.4,6.8],[4.7,6.3],[.4,3.8],[-1,2.8],[-2.9,4.1],[-6.3,6.5],[-7.4,5.1],[-6.5,3.5],
  [-3.4,.4],[-2.7,-1.2],[-4.4,-1.7],[-7,-.1],[-8,-1.7],[-6.5,-3.1],[-3.5,-3.2],[-2.6,-4.8],
], 3);

// These paths intentionally contain more source points than the simple shape
// presets. They stay individually editable while producing smooth silhouettes
// in ultra-quality mesh exports.
const PRAGUE_SKYLINE = [
  [-25,7],[-25,3],[-22.5,3],[-22.5,-.5],[-20.5,-.5],[-20.5,4],[-17.5,4],[-17.5,-2],[-15.5,-2],[-15.5,4],
  [-12.5,4],[-12.5,1],[-10.5,1],[-10.5,-4.5],[-8.8,-4.5],[-8.8,-8],[-7.3,-10.5],[-5.8,-8],[-5.8,-4.5],
  [-4,-4.5],[-4,3],[-1.5,3],[-1.5,.2],[1,.2],[1,-5.8],[3.1,-5.8],[3.1,-1.7],[6,-1.7],[6,3],[9.5,3],
  [9.5,-1],[11.5,-1],[11.5,-6.5],[13.2,-9],[14.9,-6.5],[14.9,-1],[17,-1],[17,4],[20,4],[20,1],[22.5,1],[22.5,7],
];

const CHARLES_BRIDGE_TOWERS = [
  [-13,4],[-13,-4],[-10.8,-4],[-10.8,-7],[-9.2,-9],[-7.6,-7],[-7.6,-4],[-5.5,-4],[-5.5,4],
  [5.5,4],[5.5,-4],[7.6,-4],[7.6,-7],[9.2,-9],[10.8,-7],[10.8,-4],[13,-4],[13,4],
];

const COURSE_ROUTE = [
  [-24,-10],[-21,-13],[-16,-12],[-13,-8],[-15,-4],[-20,-1],[-21,4],[-17,8],[-11,9],[-6,6],[-2,1],
  [3,-2],[8,-1],[10,4],[8,9],[11,14],[17,16],[22,13],[24,9],
];

const BRIDGE_ARCHES = [
  [-13,4],[-11.5,1.4],[-10,0],[-8.5,1.4],[-7,4],[-5.5,1.4],[-4,0],[-2.5,1.4],[0,4],
  [2.5,1.4],[4,0],[5.5,1.4],[7,4],[8.5,1.4],[10,0],[11.5,1.4],[13,4],
];

function circularPath(radius, count = 64) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

function runnerElements(name, x, y, color, options = {}) {
  const scale = Number(options.scale) || 1;
  return [
    path(`${name} body`, DETAILED_RUNNER_BODY, x, y, color, options),
    shape(`${name} head`, 'circle', x + 1.2 * scale, y - 10.1 * scale, 4.2 * scale, color, options.rotation || 0, options),
  ];
}

// These contours were traced from the supplied physical medal after rotating
// it 90° counter-clockwise so the ribbon attachment is at the top. Unlike a
// generic stick figure, the authored boundary retains the hand, bent elbows,
// ankles, shoe profiles, torso taper and airborne poses visible in the photo.
const ARCHIVE_LEFT_ATHLETE = [
  [-18.27,-17.45],[-19.6,-17.72],[-20.22,-17.45],[-20.66,-16.83],[-20.84,-15.68],[-20.49,-15.15],[-20.31,-14.08],[-21.02,-13.37],[-23.5,-12.66],[-25.36,-11.6],[-25.98,-11.51],[-26.34,-11.16],[-27.23,-10.8],[-27.67,-10.09],[-27.49,-8.05],[-27.05,-7.7],[-27.05,-7.25],[-27.23,-7.17],[-27.23,-5.39],[-26.87,-4.86],[-26.34,-4.86],[-26.69,-5.92],[-26.78,-8.85],[-26.34,-10.27],[-25.72,-10.71],[-24.03,-10.89],[-23.15,-10.27],[-22.97,-7.87],[-22.79,-7.7],[-22.79,-6.01],[-23.06,-4.86],[-23.94,-3.09],[-24.21,-.16],[-25.01,1.35],[-25.54,3.21],[-26.6,4.72],[-28.02,5.52],[-29.18,6.76],[-29.62,7.82],[-29.89,8],[-29.71,8.97],[-27.93,7.82],[-26.43,6.23],[-25.72,5.87],[-25.45,5.43],[-24.12,4.45],[-23.94,3.74],[-23.5,3.48],[-23.23,2.86],[-22.7,2.59],[-22.44,1.97],[-21.9,1.53],[-21.82,1.08],[-21.02,.64],[-18.98,.82],[-18.27,1.26],[-18.27,1.79],[-19.42,3.03],[-19.78,3.74],[-20.49,4.27],[-20.57,5.16],[-21.19,5.34],[-21.28,5.69],[-21.73,5.96],[-23.23,6.4],[-22.44,9.33],[-21.82,9.6],[-21.9,8.62],[-21.28,6.31],[-20.4,5.52],[-20.22,5.07],[-19.16,4.63],[-18.62,4.9],[-18.71,5.6],[-19.69,6.76],[-19.69,7.38],[-16.85,5.78],[-16.32,5.78],[-17.03,4.72],[-17.65,4.19],[-17.65,3.65],[-16.41,2.41],[-16.41,1.97],[-15.34,1.17],[-15.34,.73],[-17.65,-1.76],[-19.33,-2.91],[-19.07,-6.01],[-18.8,-6.19],[-18.62,-7.43],[-17.91,-7.79],[-17.12,-7.34],[-16.67,-7.34],[-15.43,-8.76],[-15.43,-9.12],[-16.14,-8.85],[-16.67,-9.21],[-17.12,-10.18],[-17.29,-11.24],[-17.65,-11.6],[-17.65,-12.13],[-18.27,-12.4],[-18.89,-13.2],[-18.53,-14.17],[-17.91,-14.61],[-17.65,-15.5],[-17.83,-16.92],
];
const ARCHIVE_RIGHT_ATHLETE = [
  [-4.43,-16.57],[-4.52,-16.21],[-5.5,-15.41],[-6.74,-15.59],[-7.18,-15.15],[-7.72,-13.73],[-8.6,-13.2],[-8.51,-12.84],[-7.89,-12.75],[-6.56,-13.02],[-6.3,-13.37],[-6.21,-14.79],[-5.68,-15.15],[-4.52,-13.99],[-4.43,-12.49],[-8.69,-10.27],[-10.11,-9.38],[-10.64,-8.76],[-10.38,-7.61],[-7.89,-5.3],[-7.18,-4.06],[-7.18,-3.62],[-7.98,-2.11],[-8.25,.73],[-9.76,4.36],[-10.64,4.81],[-13.39,4.27],[-13.57,4.63],[-14.28,4.98],[-15.7,5.16],[-15.96,5.69],[-14.54,5.96],[-13.57,6.49],[-12.68,6.67],[-12.24,6.93],[-12.24,7.2],[-11.97,7.2],[-11.97,6.93],[-11.53,6.67],[-9.49,6.85],[-8.07,5.6],[-6.74,4.01],[-6.12,2.94],[-5.68,2.5],[-5.05,2.32],[-2.48,4.27],[-1.86,5.16],[-1.77,8.35],[-.62,11.37],[-.62,13.05],[-.8,13.41],[-.62,14.47],[.53,14.56],[2.93,14.3],[3.55,14.03],[3.64,13.76],[1.6,13.05],[.71,12.34],[.35,11.64],[.27,8.18],[0,6.93],[.18,4.45],[-1.15,1.97],[-3.28,-1.05],[-3.46,-2.02],[-2.39,-5.84],[-1.77,-6.19],[-.89,-5.66],[-.44,-5.66],[.18,-6.01],[1.42,-7.25],[1.86,-8.05],[3.46,-9.21],[3.46,-9.56],[3.1,-9.91],[2.31,-9.65],[2.04,-8.76],[1.33,-7.7],[.44,-7.25],[-.09,-7.25],[-.62,-7.52],[-1.6,-10.45],[-2.75,-11.6],[-2.57,-12.49],[-1.42,-13.02],[-1.24,-13.28],[-1.06,-14.79],[-1.33,-15.68],[-2.57,-16.65],
];
const ARCHIVE_RIGHT_ATHLETE_HOLE = [[-7.63,-9.03],[-6.74,-9.03],[-6.21,-8.58],[-6.03,-6.63],[-6.3,-5.66],[-6.92,-5.3],[-7.36,-5.48],[-8.34,-6.46],[-9.05,-7.79],[-9.05,-8.32]];
const ARCHIVE_BLUE_MAIN = [[-13.04,-22.06],[-22.08,-21.71],[-25.27,-17.98],[-28.29,-12.75],[-30.33,-6.54],[-30.86,-3.26],[-31.04,.02],[-30.86,3.3],[-30.33,6.58],[-29.09,10.84],[-28.2,12.88],[-21.46,12.43],[-17.12,12.43],[-17.03,13.59],[-14.72,13.59],[-16.94,13.59],[-17.03,12.34],[-14.63,12.17],[-13.57,11.19],[-13.75,9.06],[-13.57,6.67],[-14.63,6.05],[-14.63,4.98],[-13.57,4.45],[-12.68,-21.53]];
const ARCHIVE_BLUE_BAR = [[-13.92,19.26],[-14.01,14.3],[-14.37,13.67],[-27.49,14.3],[-25.27,18.02],[-23.23,20.59],[-17.83,20.68],[-16.76,20.33],[-15.43,20.33],[-15.34,20.06],[-14.54,19.97]];

function archiveAthleteElements(name, color, underlayColor, options = {}) {
  const left = options.variant !== 'right';
  const commonOptions = { ...options, scale: .96, zHeight: options.zHeight ?? .6 };
  const elements = [path(`${name} detailed silhouette`, left ? ARCHIVE_LEFT_ATHLETE : ARCHIVE_RIGHT_ATHLETE, 0, 0, color, commonOptions)];
  if (!left) elements.push(path(`${name} arm cutout`, ARCHIVE_RIGHT_ATHLETE_HOLE, 0, 0, underlayColor, { ...commonOptions, zHeight: (options.zHeight ?? .6) + .02 }));
  return elements;
}

// Stored back-face origins use the build-plane coordinate system. Reflecting
// the origin (and rotation) once here makes the finished bottom view match the
// same ribbon-up layout an artist sees while authoring it. Local path geometry
// is reflected by the manufacturing rasterizer and therefore stays untouched.
function orientElementsForFace(elements, face) {
  if (face !== 'back') return elements;
  return elements.map(element => ({ ...element, y: -element.y, rotation: -(element.rotation || 0) }));
}

function archiveFaceElements({ face = 'front', prefix = '', blue, green, gray, groupId }) {
  const onFace = { face, groupId };
  return orientElementsForFace([
    // With the ribbon attachment at the top, the photographed blue block is
    // vertical on the left, the green roundel is on the right, and the year is
    // horizontal along the bottom edge.
    path(`${prefix}blue panel`, ARCHIVE_BLUE_MAIN, 0, 0, blue, { ...onFace, closed: true, scale: .96, zHeight: .4 }),
    path(`${prefix}blue lower bar`, ARCHIVE_BLUE_BAR, 0, 0, blue, { ...onFace, closed: true, scale: .96, zHeight: .4 }),
    shape(`${prefix}green disc`, 'circle', 7.1, -2.5, 43.5, green, 0, { ...onFace, zHeight: .4 }),
    ...archiveAthleteElements(`${prefix}left athlete`, gray, blue, { ...onFace, variant: 'left', zHeight: .6 }),
    ...archiveAthleteElements(`${prefix}right athlete`, gray, green, { ...onFace, variant: 'right', zHeight: .6 }),
    text(`${prefix}distance`, '10', 15.1, 8.3, 10.8, gray, 900, { ...onFace, zHeight: .6 }),
    text(`${prefix}event`, 'archívna', 9.2, 1.7, 3.15, gray, 800, { ...onFace, zHeight: .6 }),
    path(`${prefix}year separator left`, [[-16.5,0],[-10.5,0]], 0, 22, gray, { ...onFace, closed: false, strokeWidth: .75, zHeight: .6 }),
    text(`${prefix}year`, '2026', 0, 22, 4.1, gray, 700, { ...onFace, zHeight: .6 }),
    path(`${prefix}year separator right`, [[10.5,0],[16.5,0]], 0, 22, gray, { ...onFace, closed: false, strokeWidth: .75, zHeight: .6 }),
  ], face);
}

function tramFaceElements({ face = 'front', prefix = '', white, red, gray, groupId }) {
  const onFace = { face, groupId };
  const roofPanels = [
    [[-24,-5],[-21,-10],[-15,-9.5],[-13,-5]],
    [[-13,-5],[-11,-9.5],[-4,-9.5],[-2,-5]],
    [[-2,-5],[0,-10],[7,-10],[9,-5]],
    [[9,-5],[11,-9.5],[16,-9.2],[18,-5]],
    [[18,-5],[20,-8.5],[24,-7.8],[25,-5]],
  ];
  return orientElementsForFace([
    text(`${prefix}edition`, '– 7. ročník –', 0, -18.2, 5, white, 700, { ...onFace, zHeight: .6 }),
    ...roofPanels.map((points, index) => path(`${prefix}red roof ${index + 1}`, points, 0, 0, red, { ...onFace, closed: true, zHeight: .6 })),
    // Separate masonry bays, door/window inserts and the long plinth reproduce
    // the actual low village building rather than a generic tram carriage.
    path(`${prefix}building dark field`, [[-24,-5],[25,-5],[24,4.2],[-24,4.2]], 0, 0, 0, { ...onFace, closed: true, zHeight: .3 }),
    path(`${prefix}facade bay 1`, [[-23,-4.4],[-17,-4.4],[-17,3.4],[-23,3.4]], 0, 0, gray, { ...onFace, closed: true, zHeight: .5 }),
    path(`${prefix}facade bay 2`, [[-12.5,-4.4],[-5.2,-4.4],[-5.2,3.4],[-12.5,3.4]], 0, 0, gray, { ...onFace, closed: true, zHeight: .5 }),
    path(`${prefix}facade bay 3`, [[-.8,-4.4],[6.6,-4.4],[6.6,3.4],[-.8,3.4]], 0, 0, gray, { ...onFace, closed: true, zHeight: .5 }),
    path(`${prefix}facade bay 4`, [[11,-4.4],[17.2,-4.4],[17.2,3.4],[11,3.4]], 0, 0, gray, { ...onFace, closed: true, zHeight: .5 }),
    path(`${prefix}facade bay 5`, [[20,-4.4],[24,-4.4],[24,3.4],[20,3.4]], 0, 0, gray, { ...onFace, closed: true, zHeight: .5 }),
    path(`${prefix}left window`, [[-15,-1.8],[-12.8,-1.8],[-12.8,.7],[-15,.7]], 0, 0, gray, { ...onFace, closed: true, zHeight: .6 }),
    path(`${prefix}center door`, [[1.1,-1.5],[4.7,-1.5],[4.7,3.4],[1.1,3.4]], 0, 0, 0, { ...onFace, closed: true, zHeight: .6 }),
    path(`${prefix}right window`, [[17.6,-1.7],[19.6,-1.7],[19.6,.8],[17.6,.8]], 0, 0, gray, { ...onFace, closed: true, zHeight: .6 }),
    path(`${prefix}building plinth`, [[-24,0],[24,0]], 0, 4.6, gray, { ...onFace, closed: false, strokeWidth: 1.1, zHeight: .6 }),
    text(`${prefix}date`, '18.9.2026', 0, 11, 6.6, white, 700, { ...onFace, zHeight: .6 }),
    text(`${prefix}place`, 'Ivanka pri Nitre', 0, 19.1, 3.7, gray, 700, { ...onFace, zHeight: .5 }),
  ], face);
}

export function createTemplateProject(key = 'night') {
  const common = {
    version: 7,
    documentModel: 'parametric-feature-graph-v1',
    engineVersion: 'browser-heightfield-6',
    template: key,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    profile: { nozzle: .4, layerHeight: .2, hardened: false, colorSystem: 'multicolor', meshQuality: 'fine' },
    medal: { shape: 'circle', diameter: 60, width: 60, height: 60, cornerRadius: 8, outline: null, baseThickness: 2.4, baseColor: 0, reliefHeight: .6, defaultHeight: .6, rimStyle: 'classic', rimWidth: 1.5, rimHeight: .6, rimColor: 1, edgeInset: .7, minimumFloor: 1.2, loopStyle: 'single', loopWidth: 32, loopHeight: 8, slotWidth: 27, slotHeight: 3.6, holeDiameter: 6, slitWidth: 27, slitHeight: 3.2, attachmentInset: 4, attachmentColor: null, attachmentHeight: 0 },
    paletteIds: ['midnight-black', 'electric-blue', 'natural-white'],
    groups: [],
    elements: [],
  };
  if (key === 'blank') {
    return {
      ...common,
      name: 'Untitled medal',
      medal: { ...common.medal, loopStyle: 'double', rimStyle: 'classic', rimWidth: 1.2, rimHeight: .4, rimColor: 0 },
      paletteIds: ['midnight-black', 'natural-white'],
      elements: [],
    };
  }
  if (key === 'showcase-night') {
    const front = { face: 'front' };
    const back = { face: 'back' };
    const frontRunner = runnerElements('Hero runner', 0, 1.5, 3, { ...front, scale: 1.28, zHeight: .9, groupId: 'showcase-runner' });
    return {
      ...common,
      name: 'Prague Midnight 21K · 2027',
      template: key,
      profile: { ...common.profile, nozzle: .4, layerHeight: .1, meshQuality: 'ultra' },
      medal: {
        ...common.medal,
        diameter: 74,
        width: 74,
        height: 74,
        baseThickness: 2.8,
        minimumFloor: 1.4,
        defaultHeight: .6,
        reliefHeight: .6,
        rimWidth: 1.4,
        rimHeight: .6,
        rimColor: 3,
        rimStyle: 'double',
        loopStyle: 'double',
        loopWidth: 38,
        loopHeight: 9,
        slotWidth: 31,
        slotHeight: 4,
      },
      paletteIds: ['midnight-black', 'electric-blue', 'natural-white', 'silk-gold', 'graphite-gray'],
      groups: [
        { id: 'showcase-atmosphere', name: 'Front · moon & night sky' },
        { id: 'showcase-city', name: 'Front · Prague skyline' },
        { id: 'showcase-runner', name: 'Front · layered hero runner' },
        { id: 'showcase-front-type', name: 'Front · editable event type' },
        { id: 'showcase-back-field', name: 'Back · course field' },
        { id: 'showcase-route', name: 'Back · route & bridge' },
        { id: 'showcase-back-type', name: 'Back · editable race details' },
      ],
      elements: [
        // Front: a layered crescent, fine stars, and a recognizable Prague
        // skyline establish depth before the foreground athlete is added.
        shape('Moon disc', 'circle', -18, -10.5, 14, 2, 0, { ...front, zHeight: .3, groupId: 'showcase-atmosphere' }),
        shape('Crescent shadow', 'circle', -14.3, -13.3, 12.6, 0, 0, { ...front, zHeight: .4, groupId: 'showcase-atmosphere' }),
        shape('North star', 'star', 20.5, -15.5, 3.8, 3, 0, { ...front, zHeight: .6, groupId: 'showcase-atmosphere' }),
        shape('Small star left', 'star', 12.5, -21.5, 3.8, 2, 18, { ...front, zHeight: .5, groupId: 'showcase-atmosphere' }),
        shape('Small star right', 'star', 25.5, -8, 3.8, 2, -12, { ...front, zHeight: .5, groupId: 'showcase-atmosphere' }),
        path('Prague skyline', PRAGUE_SKYLINE, 0, 7, 4, { ...front, zHeight: .3, groupId: 'showcase-city' }),
        path('River reflection', [[-25,0],[-18,-.8],[-11,.5],[-4,-.6],[4,.5],[12,-.5],[20,.4],[25,-.2]], 0, 18.2, 1, { ...front, closed: false, strokeWidth: 1.4, zHeight: .5, groupId: 'showcase-city' }),
        ...[-19,-13,-7,7,13,19].map((x, index) => shape(`City light ${index + 1}`, 'square', x, 9 + (index % 2) * 2.2, 2.1, index % 3 === 0 ? 3 : 1, 0, { ...front, zHeight: .5, groupId: 'showcase-city' })),
        path('Speed line high', [[-14,0],[-7,-.7],[0,0]], -9, -1.5, 1, { ...front, closed: false, strokeWidth: 1.2, zHeight: .6, groupId: 'showcase-runner' }),
        path('Speed line low', [[-12,0],[-6,.5],[0,0]], -10, 4.3, 1, { ...front, closed: false, strokeWidth: 1, zHeight: .6, groupId: 'showcase-runner' }),
        ...frontRunner,
        path('Runner bib', [[-2.4,-1.8],[2.4,-1.8],[2.4,1.8],[-2.4,1.8]], .5, -1.8, 2, { ...front, zHeight: 1, groupId: 'showcase-runner' }),
        text('Bib number', '21', .5, -1.8, 2.9, 0, 900, { ...front, zHeight: 1.1, groupId: 'showcase-runner' }),
        text('City', 'PRAGUE', 0, -27, 5.2, 2, 900, { ...front, zHeight: .7, groupId: 'showcase-front-type' }),
        text('Event', 'MIDNIGHT RUN', 0, -21.4, 3.5, 1, 900, { ...front, zHeight: .6, groupId: 'showcase-front-type' }),
        text('Distance', '21K', 0, 23.2, 8.4, 3, 900, { ...front, zHeight: .8, groupId: 'showcase-front-type' }),
        text('Race date', '05 · 05 · 2027', 0, 29.1, 3.1, 2, 900, { ...front, zHeight: .6, groupId: 'showcase-front-type' }),

        // Back: the muted raised field behaves like a second printable face.
        // The route, bridge, markers, rings, and labels remain separate objects.
        shape('Back graphite field', 'circle', 0, 0, 61, 4, 0, { ...back, zHeight: .2, groupId: 'showcase-back-field' }),
        path('Back gold perimeter', circularPath(30.3), 0, 0, 3, { ...back, closed: false, strokeWidth: 1.2, zHeight: .4, groupId: 'showcase-back-field' }),
        shape('Back center medallion', 'circle', 0, 2, 35, 0, 0, { ...back, zHeight: .3, groupId: 'showcase-back-field' }),
        path('Vltava course line', COURSE_ROUTE, 0, 0, 1, { ...back, closed: false, strokeWidth: 1.7, zHeight: .5, groupId: 'showcase-route' }),
        path('Charles Bridge towers', CHARLES_BRIDGE_TOWERS, 0, -3, 2, { ...back, zHeight: .7, groupId: 'showcase-route' }),
        path('Charles Bridge deck', [[-15,0],[15,0]], 0, 1, 2, { ...back, closed: false, strokeWidth: 1.2, zHeight: .7, groupId: 'showcase-route' }),
        path('Charles Bridge arches', BRIDGE_ARCHES, 0, -3, 2, { ...back, closed: false, strokeWidth: .9, zHeight: .7, groupId: 'showcase-route' }),
        shape('Course start', 'circle', -24, -10, 4.4, 3, 0, { ...back, zHeight: .8, groupId: 'showcase-route' }),
        shape('Course start center', 'circle', -24, -10, 2.1, 0, 0, { ...back, zHeight: .9, groupId: 'showcase-route' }),
        shape('Course finish', 'diamond', 22, 13, 4.8, 3, 0, { ...back, zHeight: .8, groupId: 'showcase-route' }),
        shape('Course finish center', 'diamond', 22, 13, 2.2, 0, 0, { ...back, zHeight: .9, groupId: 'showcase-route' }),
        text('Back city', 'PRAGUE', 0, -24.5, 5.2, 2, 900, { ...back, zHeight: .7, groupId: 'showcase-back-type' }),
        text('Back event', 'MIDNIGHT HALF', 0, -18.8, 3.3, 1, 900, { ...back, zHeight: .6, groupId: 'showcase-back-type' }),
        text('Back distance', '21K', 0, 10.7, 9.2, 3, 900, { ...back, zHeight: .8, groupId: 'showcase-back-type' }),
        text('Back date', '05 · 05 · 2027', 0, 22, 3.2, 2, 900, { ...back, operation: 'inlay', zDepth: .4, inlayHeight: .2, groupId: 'showcase-back-type' }),
        text('Finisher label', 'FINISHER', 0, 28.1, 3.4, 3, 900, { ...back, zHeight: .6, groupId: 'showcase-back-type' }),
      ],
    };
  }
  if (key === 'photo-night') {
    return {
      ...common,
      name: 'Ľudánická nočná výzva 2026',
      template: key,
      profile: { ...common.profile, nozzle: .2, layerHeight: .1, meshQuality: 'ultra' },
      medal: { ...common.medal, diameter: 68, width: 68, height: 68, loopStyle: 'double', loopWidth: 36, slotWidth: 31, rimStyle: 'double', rimWidth: 1.25, rimHeight: .4, rimColor: 0 },
      paletteIds: ['midnight-black', 'natural-white', 'silk-gold', 'electric-blue', 'graphite-gray', 'emerald-green'],
      elements: [
        text('Event line 1', 'LUDANICKÁ', -7.5, -16.8, 4.4, 1, 900, { zHeight: .7, groupId: 'front-art' }),
        text('Event line 2', 'NOČNÁ', -9.5, -9.4, 6.1, 2, 900, { zHeight: .8, groupId: 'front-art' }),
        text('Event line 3', 'VÝZVA', -10, -2.2, 5.8, 1, 900, { zHeight: .7, groupId: 'front-art' }),
        ...runnerElements('Runner one', 7.5, 4.8, 4, { scale: .59, zHeight: .4, groupId: 'front-art' }),
        ...runnerElements('Runner two', 17.5, 5.8, 4, { scale: .55, zHeight: .4, groupId: 'front-art' }),
        shape('Moon', 'circle', 18.5, -15.2, 7.2, 2, 0, { zHeight: .7, groupId: 'front-art' }),
        shape('Moon dark overlay', 'circle', 16.5, -17, 6.1, 0, 0, { zHeight: .72, groupId: 'front-art' }),
        shape('Star upper', 'star', 10.8, -18.2, 3.1, 2, 0, { zHeight: .7, groupId: 'front-art' }),
        shape('Star right', 'star', 25.2, -12.6, 3.4, 2, 0, { zHeight: .7, groupId: 'front-art' }),
        shape('Star lower', 'star', 21.3, -7.7, 2.8, 2, 0, { zHeight: .7, groupId: 'front-art' }),
        path('Runner ground line', [[-20,0],[22,0]], 0, 13.6, 4, { closed: false, strokeWidth: .9, zHeight: .4, groupId: 'front-art' }),
        text('Event date', '21.–22. augusta 2026', 0, 22, 3.2, 2, 800, { zHeight: .7, groupId: 'front-art' }),
        ...archiveFaceElements({ face: 'back', prefix: 'Back ', blue: 3, green: 5, gray: 4, groupId: 'back-archive' }),
      ],
      groups: [{ id: 'front-art', name: 'Photo front · night run' }, { id: 'back-archive', name: 'Photo reverse · Archívna 10' }],
    };
  }
  if (key === 'photo-archive') {
    return {
      ...common,
      name: 'Archívna 10 2026',
      template: key,
      profile: { ...common.profile, nozzle: .2, layerHeight: .1, meshQuality: 'ultra' },
      medal: { ...common.medal, diameter: 64, width: 64, height: 64, loopStyle: 'double', loopWidth: 34, slotWidth: 29, rimStyle: 'classic', edgeInset: 0, rimWidth: 1.65, rimHeight: .4, rimColor: 3, attachmentColor: 3, attachmentHeight: .4 },
      paletteIds: ['midnight-black', 'electric-blue', 'emerald-green', 'graphite-gray', 'natural-white', 'signal-red'],
      groups: [{ id: 'archive-front', name: 'Photo front · Archívna 10' }, { id: 'archive-back', name: 'Photo reverse · Ivanka pri Nitre' }],
      elements: [
        ...archiveFaceElements({ blue: 1, green: 2, gray: 3, groupId: 'archive-front' }),
        ...tramFaceElements({ face: 'back', prefix: 'Back ', white: 4, red: 5, gray: 3, groupId: 'archive-back' }),
      ],
    };
  }
  if (key === 'photo-tram') {
    return {
      ...common,
      name: 'Ivanka pri Nitre 2026',
      template: key,
      profile: { ...common.profile, nozzle: .2, layerHeight: .1, meshQuality: 'ultra' },
      medal: { ...common.medal, diameter: 64, width: 64, height: 64, loopStyle: 'double', loopWidth: 34, slotWidth: 29, rimStyle: 'classic', rimWidth: .8, rimHeight: .4, rimColor: 0 },
      paletteIds: ['midnight-black', 'natural-white', 'signal-red', 'graphite-gray'],
      elements: tramFaceElements({ white: 1, red: 2, gray: 3, groupId: 'tram-front' }),
      groups: [{ id: 'tram-front', name: 'Photo front · village artwork' }],
    };
  }
  if (key === 'night') {
    return { ...common, name: 'Night Run 2026', elements: [text('Event title', 'NIGHT RUN', 0, -11, 6.3, 2), text('Distance', '10K', 0, 2, 13.5, 1, 900), text('Year', '2026', 0, 14, 4.8, 2, 700)] };
  }
  if (key === 'finish') {
    return { ...common, name: 'Finish Line 2026', medal: { ...common.medal, diameter: 65, rimColor: 1, rimStyle: 'laurel', rimWidth: 3.2 }, paletteIds: ['midnight-black','thermo-red','signal-lime','natural-white'], elements: [text('Finish label', 'FINISHER', 0, -13, 6.8, 3), text('Place', '01', 0, 1, 15, 1, 900), shape('Laurel left', 'hexagon', -14, 14, 8, 2, 12), shape('Laurel right', 'hexagon', 14, 14, 8, 2, -12)] };
  }
  if (key === 'school') {
    return { ...common, name: 'School Event', medal: { ...common.medal, diameter: 55, rimColor: 1, rimStyle: 'scalloped', rimWidth: 2.2 }, paletteIds: ['electric-blue','silk-gold'], elements: [text('Event title', 'SPORT DAY', 0, -10, 6, 1), text('Year', '2026', 0, 11, 7.5, 1, 900), shape('Achievement star', 'star', 0, 1, 13, 1)] };
  }
  return { ...common, name: 'Untitled medal', elements: [] };
}

export function normalizeProject(input) {
  const fallback = createTemplateProject('night');
  const project = input && typeof input === 'object' ? structuredClone(input) : fallback;
  const sourceVersion = Math.max(1, Math.floor(Number(project.version) || 1));
  if (sourceVersion > 7) throw new Error('This project was created by a newer MedalForge version. Update the app before opening it.');
  const legacyRelief = clampNumber(project.medal?.reliefHeight, .1, DESIGN_LIMITS.reliefHeightMax, .6);
  project.version = 7;
  project.documentModel = 'parametric-feature-graph-v1';
  project.engineVersion = 'browser-heightfield-6';
  project.name = String(project.name || 'Untitled medal').slice(0, 60);
  project.template ||= 'custom';
  project.profile = { ...fallback.profile, ...(project.profile || {}) };
  project.profile.nozzle = [0.2, 0.4, 0.6, 0.8].includes(Number(project.profile.nozzle)) ? Number(project.profile.nozzle) : .4;
  project.profile.layerHeight = clampNumber(project.profile.layerHeight, .05, .5, project.profile.nozzle / 2);
  project.profile.hardened = Boolean(project.profile.hardened);
  project.profile.colorSystem = ['multicolor', 'manual'].includes(project.profile.colorSystem) ? project.profile.colorSystem : 'multicolor';
  project.profile.meshQuality = ['draft', 'balanced', 'fine', 'ultra'].includes(project.profile.meshQuality) ? project.profile.meshQuality : 'fine';
  project.medal = { ...fallback.medal, ...(project.medal || {}) };
  project.medal.baseColor = Math.max(0, Math.min(Math.max(0, (project.paletteIds?.length || 1) - 1), Math.floor(Number(project.medal.baseColor) || 0)));
  project.medal.rimStyle = Object.hasOwn(RIM_STYLE_INFO, project.medal.rimStyle) ? project.medal.rimStyle : 'classic';
  project.medal.diameter = clampNumber(project.medal.diameter, DESIGN_LIMITS.medalMin, DESIGN_LIMITS.medalMax, 60);
  project.medal.shape = ['circle', 'oval', 'rounded', 'hexagon', 'octagon', 'scalloped', 'star', 'gear', 'shield', 'custom'].includes(project.medal.shape) ? project.medal.shape : 'circle';
  project.medal.width = clampNumber(project.medal.width, DESIGN_LIMITS.medalMin, DESIGN_LIMITS.medalMax, project.medal.diameter);
  project.medal.height = clampNumber(project.medal.height, DESIGN_LIMITS.medalMin, DESIGN_LIMITS.medalMax, project.medal.diameter);
  project.medal.outline = normalizePolygonRing(project.medal.outline);
  if (project.medal.outline?.length >= 3) {
    const xs = project.medal.outline.map(point => point[0]), ys = project.medal.outline.map(point => point[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const outlineWidth = maxX - minX, outlineHeight = maxY - minY;
    if (outlineWidth > 1e-4 && outlineHeight > 1e-4) {
      const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
      project.medal.outline = project.medal.outline.map(([x, y]) => [
        (x - centerX) * project.medal.width / outlineWidth,
        (y - centerY) * project.medal.height / outlineHeight,
      ]);
    } else project.medal.outline = null;
  }
  if (project.medal.shape === 'custom' && (!project.medal.outline || project.medal.outline.length < 3)) project.medal.shape = 'circle';
  project.medal.outlineSourceId = project.medal.outlineSourceId ? String(project.medal.outlineSourceId).slice(0, 120) : null;
  const restore = project.medal.outlineRestore && typeof project.medal.outlineRestore === 'object' ? project.medal.outlineRestore : null;
  project.medal.outlineRestore = restore ? {
    shape: ['circle', 'oval', 'rounded', 'hexagon', 'octagon', 'scalloped', 'star', 'gear', 'shield'].includes(restore.shape) ? restore.shape : 'circle',
    diameter: clampNumber(restore.diameter, DESIGN_LIMITS.medalMin, DESIGN_LIMITS.medalMax, 60),
    width: clampNumber(restore.width, DESIGN_LIMITS.medalMin, DESIGN_LIMITS.medalMax, 60),
    height: clampNumber(restore.height, DESIGN_LIMITS.medalMin, DESIGN_LIMITS.medalMax, 60),
    cornerRadius: clampNumber(restore.cornerRadius, 1, 60, 8),
  } : null;
  if (project.medal.shape === 'circle') project.medal.width = project.medal.height = project.medal.diameter;
  project.medal.cornerRadius = clampNumber(project.medal.cornerRadius, 1, Math.min(project.medal.width, project.medal.height) / 2, 8);
  project.medal.baseThickness = clampNumber(project.medal.baseThickness, 1.2, DESIGN_LIMITS.baseThicknessMax, 2.4);
  project.medal.defaultHeight = clampNumber(project.medal.defaultHeight ?? legacyRelief, .1, DESIGN_LIMITS.reliefHeightMax, legacyRelief);
  project.medal.reliefHeight = project.medal.defaultHeight;
  project.medal.rimHeight = clampNumber(project.medal.rimHeight ?? legacyRelief, .1, DESIGN_LIMITS.rimHeightMax, project.medal.defaultHeight);
  project.medal.minimumFloor = clampNumber(project.medal.minimumFloor, .6, Math.max(.6, project.medal.baseThickness - .2), Math.min(1.2, project.medal.baseThickness - .2));
  project.medal.rimWidth = clampNumber(project.medal.rimWidth, 0, DESIGN_LIMITS.rimWidthMax, 1.5);
  // Zero is valid: some printed medals carry the contrasting raised perimeter
  // all the way to the body edge. The former 0.3 mm minimum produced an
  // unwanted base-colour halo around those designs.
  project.medal.edgeInset = clampNumber(project.medal.edgeInset, 0, 5, .7);
  project.medal.loopWidth = clampNumber(project.medal.loopWidth, 12, 60, 32);
  project.medal.loopHeight = clampNumber(project.medal.loopHeight, 5, 18, 8);
  project.medal.slotWidth = clampNumber(project.medal.slotWidth, 6, project.medal.loopWidth - 2, 27);
  project.medal.slotHeight = clampNumber(project.medal.slotHeight, 2, project.medal.loopHeight - 2, 3.6);
  project.medal.holeDiameter = clampNumber(project.medal.holeDiameter, .4, Math.max(.4, Math.min(project.medal.width, project.medal.height) / 2), 6);
  project.medal.slitWidth = clampNumber(project.medal.slitWidth, 1, Math.max(1, project.medal.width - 2), 27);
  project.medal.slitHeight = clampNumber(project.medal.slitHeight, .4, Math.max(.4, Math.min(12, project.medal.height / 3)), 3.2);
  project.medal.attachmentInset = clampNumber(project.medal.attachmentInset, 0, Math.max(0, project.medal.height / 2 - .5), 4);
  project.medal.rimColor = Math.max(0, Math.floor(Number(project.medal.rimColor) || 0));
  project.medal.attachmentColor = project.medal.attachmentColor === null || project.medal.attachmentColor === undefined || project.medal.attachmentColor === ''
    ? null
    : Math.max(0, Math.floor(Number(project.medal.attachmentColor) || 0));
  project.medal.attachmentHeight = clampNumber(project.medal.attachmentHeight, 0, DESIGN_LIMITS.rimHeightMax, 0);
  project.medal.loopStyle = ATTACHMENT_ALIASES[project.medal.loopStyle] || project.medal.loopStyle;
  if (!Object.hasOwn(ATTACHMENT_STYLE_INFO, project.medal.loopStyle)) project.medal.loopStyle = 'single';
  project.paletteIds = Array.isArray(project.paletteIds)
    ? project.paletteIds.slice(0, DESIGN_LIMITS.paletteSlots).map((id, index) => normalizeInventoryId(id, fallback.paletteIds[index] || DEFAULT_INVENTORY[index]?.id || `filament-${index + 1}`))
    : [...fallback.paletteIds];
  while (project.paletteIds.length < 1) project.paletteIds.push(DEFAULT_INVENTORY[project.paletteIds.length].id);
  const groupIdMap = new Map();
  const usedGroupIds = new Set();
  project.groups = Array.isArray(project.groups) ? project.groups.filter(Boolean).slice(0, DESIGN_LIMITS.groups).map((group, index) => {
    const sourceId = String(group.id ?? `group-${index + 1}`);
    const baseId = normalizeInventoryId(sourceId, `group-${index + 1}`);
    let id = baseId, suffix = 2;
    while (usedGroupIds.has(id)) id = `${baseId.slice(0, 110)}-${suffix++}`;
    usedGroupIds.add(id);
    groupIdMap.set(sourceId, id);
    return { id, name: cleanLabel(group.name, `Group ${index + 1}`, 60) };
  }) : [];
  const groupIds = new Set(project.groups.map(group => group.id));
  project.elements = Array.isArray(project.elements) ? project.elements.filter(Boolean).slice(0, DESIGN_LIMITS.elements).map(element => ({ ...element, id: element.id || uid(element.type || 'item'), x: Number(element.x) || 0, y: Number(element.y) || 0, rotation: Number(element.rotation) || 0, color: Math.max(0, Math.floor(Number(element.color) || 0)) })) : [];
  for (const element of project.elements) {
    element.color = Math.min(project.paletteIds.length - 1, Math.max(0, element.color));
    element.hidden = Boolean(element.hidden);
    element.face = element.face === 'back' ? 'back' : 'front';
    element.scaleX = clampNumber(element.scaleX, .02, DESIGN_LIMITS.scaleMax, 1);
    element.scaleY = clampNumber(element.scaleY, .02, DESIGN_LIMITS.scaleMax, 1);
    element.groupId = groupIdMap.get(String(element.groupId ?? '')) || (groupIds.has(element.groupId) ? element.groupId : null);
    element.lockAspect = element.lockAspect !== false;
    const operationSource = element.operation;
    const legacyOperation = typeof operationSource === 'object' ? operationSource.kind : operationSource;
    const operationMap = { emboss: 'raise', add: 'raise', throughCut: 'cut' };
    element.operation = operationMap[legacyOperation] || (['raise', 'engrave', 'inlay', 'cut'].includes(legacyOperation) ? legacyOperation : 'raise');
    const legacyHeight = typeof operationSource === 'object' ? operationSource.heightMm : element.zHeight ?? (element.type === 'image' ? undefined : element.height);
    const legacyDepth = typeof operationSource === 'object' ? operationSource.depthMm : element.zDepth ?? element.depth;
    element.zHeight = clampNumber(legacyHeight, .05, DESIGN_LIMITS.reliefHeightMax, project.medal.defaultHeight);
    element.zDepth = clampNumber(legacyDepth, .05, project.medal.baseThickness, Math.min(.4, project.medal.baseThickness - project.medal.minimumFloor));
    delete element.depth;
    if (element.type !== 'image') delete element.height;
    element.inlayHeight = clampNumber(typeof operationSource === 'object' ? operationSource.inlayHeightMm : element.inlayHeight, 0, DESIGN_LIMITS.inlayHeightMax, 0);
    element.layerSnap = typeof operationSource === 'object' && operationSource.layerSnap !== undefined ? operationSource.layerSnap !== false : element.layerSnap !== false;
    const legacyCombine = typeof operationSource === 'object' ? operationSource.combine : element.combine;
    element.combine = legacyCombine === 'stack' ? 'stack' : 'replace';
    enforceFlatBackArtwork(element, project);
    element.locked = Boolean(element.locked);
    if (element.type === 'text') {
      element.text = String(element.text || 'TEXT').slice(0, 80);
      element.name = String(element.name || element.text || 'Text').slice(0, 40);
      element.fontSize = clampNumber(element.fontSize, 1, DESIGN_LIMITS.textSizeMax, 6);
      element.weight = [700, 800, 900].includes(Number(element.weight)) ? Number(element.weight) : 800;
      element.fontFamily = ['Arial', 'Verdana', 'Georgia'].includes(element.fontFamily) ? element.fontFamily : 'Arial';
    } else if (element.type === 'shape') {
      element.name = String(element.name || 'Shape').slice(0, 40);
      element.size = clampNumber(element.size, 1, DESIGN_LIMITS.shapeSizeMax, 11);
    } else if (element.type === 'image') {
      element.name = String(element.name || 'Imported image').slice(0, 40);
      element.width = clampNumber(element.width, 1, DESIGN_LIMITS.imageSizeMax, 30);
      if (sourceVersion <= 2 && Number(element.sourceWidth) > 0 && Number(element.sourceHeight) > 0) {
        element.height = element.width * Number(element.sourceHeight) / Number(element.sourceWidth);
      }
      element.height = clampNumber(element.height, 1, DESIGN_LIMITS.imageSizeMax, element.width);
      element.pixelWidth = clampNumber(element.pixelWidth, 1, 1024, 64);
      element.pixelHeight = clampNumber(element.pixelHeight, 1, 1024, 64);
      element.detailCell = clampNumber(element.detailCell, .01, 10, element.width / element.pixelWidth);
      element.minimumFeature = clampNumber(element.minimumFeature, element.detailCell, 10, Math.max(element.detailCell, project.profile.nozzle * 1.125));
      element.opacity = clampNumber(element.opacity, .1, 1, 1);
      element.footprint = normalizeImageFootprint(element.footprint);
      if (element.footprint.length < 3) delete element.footprint;
      const imageSettings = element.imageSettings && typeof element.imageSettings === 'object' ? element.imageSettings : {};
      element.imageSettings = {
        style: ['color', 'silhouette', 'high-contrast', 'outline'].includes(imageSettings.style) ? imageSettings.style : 'color',
        background: ['auto', 'keep', 'light', 'dark'].includes(imageSettings.background) ? imageSettings.background : 'auto',
        detail: clampNumber(imageSettings.detail, 0, 100, 60),
        threshold: clampNumber(imageSettings.threshold, 0, 255, 138),
        invert: Boolean(imageSettings.invert),
        crop: Array.isArray(imageSettings.crop) && imageSettings.crop.length === 4
          ? imageSettings.crop.map((value, index) => clampNumber(value, 0, 1, index < 2 ? 0 : 1))
          : [0, 0, 1, 1],
        activeSlots: Array.isArray(imageSettings.activeSlots)
          ? [...new Set(imageSettings.activeSlots.map(Number).filter(slot => Number.isInteger(slot) && slot >= 0 && slot < project.paletteIds.length))]
          : [],
      };
      if (element.imageSettings.crop[2] <= element.imageSettings.crop[0] + .01 || element.imageSettings.crop[3] <= element.imageSettings.crop[1] + .01) element.imageSettings.crop = [0, 0, 1, 1];
      element.dataUrl = sanitizeImageDataUrl(element.dataUrl, true);
      element.sourceDataUrl = sanitizeImageDataUrl(element.sourceDataUrl, true);
      element.maskUrls = Array.isArray(element.maskUrls) ? element.maskUrls.slice(0, project.paletteIds.length).map(source => sanitizeImageDataUrl(source, false)) : [];
      // Manufacturing ownership follows the printable masks, not stale metadata.
      // A plain raster without masks prints in its selected object color.
      const maskSlots = element.maskUrls.map((source, slot) => source ? slot : -1).filter(slot => slot >= 0);
      element.usedSlots = maskSlots.length ? maskSlots : (element.dataUrl ? [element.color] : []);
    } else if (element.type === 'path') {
      element.name = String(element.name || 'DXF path').slice(0, 40);
      element.points = Array.isArray(element.points) ? element.points.slice(0, 5000).map(point => [Number(point?.[0]) || 0, Number(point?.[1]) || 0]) : [[-5,0],[5,0]];
      element.scale = clampNumber(element.scale, .01, DESIGN_LIMITS.pathScaleMax, 1);
      element.strokeWidth = clampNumber(element.strokeWidth, .1, DESIGN_LIMITS.pathStrokeMax, .9);
      element.closed = Boolean(element.closed);
    }
  }
  project.medal.baseColor = Math.min(project.paletteIds.length - 1, project.medal.baseColor);
  project.medal.rimColor = Math.min(project.paletteIds.length - 1, project.medal.rimColor);
  if (project.medal.attachmentColor !== null) project.medal.attachmentColor = Math.min(project.paletteIds.length - 1, project.medal.attachmentColor);
  // Snapshots are import-envelope metadata, never mutable project state.
  delete project.inventorySnapshot;
  delete project.palette;
  delete project.paletteMissingIds;
  return project;
}

/**
 * Back artwork is manufactured as a material swap inside the build-plate
 * layer. It may never extend below the medal or leave an unsupported pocket.
 * Mutating one object here gives imports, templates, undo snapshots, and every
 * UI action the same print-safe invariant.
 */
export function enforceFlatBackArtwork(element, project) {
  if (!element || element.face !== 'back') return element;
  const layerHeight = clampNumber(project?.profile?.layerHeight, .05, .5, .2);
  element.operation = 'inlay';
  element.zDepth = layerHeight;
  element.inlayHeight = 0;
  element.combine = 'replace';
  element.layerSnap = true;
  return element;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizeImageFootprint(value) {
  if (!Array.isArray(value)) return [];
  const points = [], seen = new Set();
  for (const raw of value.slice(0, 512)) {
    const x = Number(raw?.[0]), y = Number(raw?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const point = [Math.max(-.5, Math.min(.5, x)), Math.max(-.5, Math.min(.5, y))];
    const key = `${point[0].toFixed(5)}:${point[1].toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key); points.push(point);
  }
  if (points.length < 3) return [];
  const twiceArea = Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0));
  return twiceArea > 1e-7 ? points : [];
}

function sanitizeImageDataUrl(value, allowSvg = false) {
  if (typeof value !== 'string' || value.length > 20_000_000) return null;
  if (/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  if (!allowSvg || !/^data:image\/svg\+xml(?:;charset=[^;,]+)?(?:;base64)?,/i.test(value)) return null;
  try {
    const comma = value.indexOf(','), header = value.slice(0, comma), payload = value.slice(comma + 1);
    const text = /;base64/i.test(header) ? globalThis.atob(payload.replace(/\s/g, '')) : decodeURIComponent(payload);
    if (/<\s*script|<\s*foreignObject|\son\w+\s*=|(?:href|src)\s*=\s*["']https?:|url\(\s*https?:/i.test(text)) return null;
    return value;
  } catch { return null; }
}

export function getPalette(project, inventory) {
  const catalog = normalizeInventory(inventory);
  return project.paletteIds.map((id, index) => catalog.find(item => item.id === id) || catalog[index % catalog.length] || normalizeFilament(DEFAULT_INVENTORY[0]));
}

/** Return the slots an image can actually contribute to generated geometry. */
export function imageUsedSlots(element, paletteLength = Number.POSITIVE_INFINITY) {
  if (!element || element.type !== 'image') return [];
  const limit = Math.max(0, Number(paletteLength) || 0);
  const maskSlots = Array.isArray(element.maskUrls)
    ? element.maskUrls.map((source, slot) => source && slot < limit ? slot : -1).filter(slot => slot >= 0)
    : [];
  if (maskSlots.length) return maskSlots;
  const color = Number(element.color);
  return element.dataUrl && Number.isInteger(color) && color >= 0 && color < limit ? [color] : [];
}

export function projectUsedSlots(project) {
  const used = new Set([Math.max(0, Number(project.medal?.baseColor) || 0)]);
  if (project.medal.rimWidth > 0 && project.medal.rimHeight > 0) used.add(project.medal.rimColor);
  if (['single', 'double'].includes(project.medal.loopStyle) && project.medal.attachmentHeight > 0 && Number.isInteger(project.medal.attachmentColor)) used.add(project.medal.attachmentColor);
  for (const element of project.elements || []) {
    if (element.hidden || !['raise', 'inlay'].includes(element.operation)) continue;
    if (element.type === 'image') for (const slot of imageUsedSlots(element, project.paletteIds.length)) used.add(slot);
    else used.add(element.color);
  }
  return [...used].filter(slot => Number.isInteger(slot) && slot >= 0 && slot < project.paletteIds.length).sort((a, b) => a - b);
}

function filamentIdentity(filament) {
  return [filament.color, filament.material, filament.effect, Number(filament.density).toFixed(4), filament.abrasive ? '1' : '0'].join('|').toLowerCase();
}

function uniqueInventoryId(preferred, used) {
  const base = normalizeInventoryId(preferred, 'imported-filament');
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}-${suffix}`.slice(0, 120);
    if (!used.has(candidate)) return candidate;
  }
  return uid('imported-filament').slice(0, 120);
}

/** Create the small, sanitized catalog snapshot stored beside an editable project. */
export function inventorySnapshotForProject(project, inventory) {
  const catalog = normalizeInventory(inventory);
  const byId = new Map(catalog.map(filament => [filament.id, filament]));
  return [...new Set(project.paletteIds || [])].map(id => byId.get(id)).filter(Boolean).map(filament => ({ ...filament }));
}

/**
 * Restore an editable project plus its referenced filament records.
 * Existing local stock wins for an identical material. Conflicting imported
 * materials receive a new ID so neither catalog entry is silently overwritten.
 */
export function normalizeProjectBundle(input, currentInventory = DEFAULT_INVENTORY) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Project JSON must contain one project object.');
  const snapshot = normalizeInventory(input.inventorySnapshot, { fallbackDefaults: false });
  const project = normalizeProject(input);
  const inventory = normalizeInventory(currentInventory);
  const currentById = new Map(inventory.map(filament => [filament.id, filament]));
  const snapshotById = new Map(snapshot.map(filament => [filament.id, filament]));
  const used = new Set(currentById.keys());
  const remapped = [];
  const added = [];
  const missing = [];

  project.paletteIds = project.paletteIds.map(id => {
    const local = currentById.get(id);
    const imported = snapshotById.get(id);
    if (!imported) {
      if (!local) missing.push(id);
      return id;
    }
    if (!local) {
      inventory.push({ ...imported });
      currentById.set(id, imported);
      used.add(id);
      added.push(id);
      return id;
    }
    if (filamentIdentity(local) === filamentIdentity(imported)) return id;
    const previousImport = inventory.find(filament => filament.id.startsWith(`${id}-imported`) && filamentIdentity(filament) === filamentIdentity(imported));
    if (previousImport) {
      remapped.push({ from: id, to: previousImport.id });
      return previousImport.id;
    }
    const replacementId = uniqueInventoryId(`${id}-imported`, used);
    const replacement = { ...imported, id: replacementId };
    inventory.push(replacement);
    currentById.set(replacementId, replacement);
    used.add(replacementId);
    added.push(replacementId);
    remapped.push({ from: id, to: replacementId });
    return replacementId;
  });

  return { project, inventory, added, remapped, missing: [...new Set(missing)] };
}

export function projectBundleForExport(project, inventory) {
  const normalized = normalizeProject(project);
  return { ...structuredClone(normalized), inventorySnapshot: inventorySnapshotForProject(normalized, inventory) };
}

export function availability(filament) {
  if (filament.stockKnown === false) return { key: 'unknown', label: 'Stock not entered' };
  if (filament.stockGrams <= 0) return { key: 'out', label: 'Unavailable' };
  if (filament.stockGrams < 120) return { key: 'low', label: 'Low stock' };
  return { key: 'available', label: 'In stock' };
}

export function elementBounds(element) {
  if (!element) return { x: 0, y: 0, width: 0, height: 0 };
  const scaleX = Math.max(.001, Number(element.scaleX) || 1), scaleY = Math.max(.001, Number(element.scaleY) || 1);
  if (element.type === 'text') return { x: element.x, y: element.y, width: Math.max(element.fontSize, (element.text || '').length * element.fontSize * .59) * scaleX, height: element.fontSize * 1.05 * scaleY };
  if (element.type === 'shape') return { x: element.x, y: element.y, width: element.size * scaleX, height: element.size * scaleY };
  if (element.type === 'image') return { x: element.x, y: element.y, width: element.width * scaleX, height: element.height * scaleY };
  if (element.type === 'path') {
    const xs = element.points.map(point => point[0] * element.scale * scaleX), ys = element.points.map(point => point[1] * element.scale * scaleY);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const padX = element.closed ? 0 : element.strokeWidth * scaleX, padY = element.closed ? 0 : element.strokeWidth * scaleY;
    const centerY = (minY + maxY) / 2 * (element.face === 'back' ? -1 : 1);
    return { x: element.x + (minX + maxX) / 2, y: element.y + centerY, width: Math.max(element.strokeWidth * scaleX, maxX - minX + padX), height: Math.max(element.strokeWidth * scaleY, maxY - minY + padY) };
  }
  return { x: element.x || 0, y: element.y || 0, width: 5, height: 5 };
}

/** Amount the original medal body is lifted so back-face relief never exports below Z=0. */
export function projectBackOffset(project) {
  let offset = 0;
  for (const element of project?.elements || []) {
    if (element.hidden || element.face !== 'back') continue;
    if (element.operation === 'raise') {
      const height = Math.max(0, Number(element.zHeight) || 0);
      offset = element.combine === 'stack' ? offset + height : Math.max(offset, height);
    } else if (element.operation === 'inlay') offset = Math.max(offset, Math.max(0, Number(element.inlayHeight) || 0));
  }
  return Math.round(offset * 1e6) / 1e6;
}

export function pointSegmentDistance(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

export function pointInPolygon(point, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const currentPoint = points[index], previousPoint = points[previous];
    const crosses = ((currentPoint[1] > point[1]) !== (previousPoint[1] > point[1])) &&
      point[0] < (previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1]) / ((previousPoint[1] - currentPoint[1]) || Number.EPSILON) + currentPoint[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

export function simplifyPolyline(points, tolerance = .1) {
  if (!Array.isArray(points) || points.length <= 2) return points ? points.map(point => [...point]) : [];
  let farthestIndex = 0, farthestDistance = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointSegmentDistance(points[index], points[0], points.at(-1));
    if (distance > farthestDistance) { farthestDistance = distance; farthestIndex = index; }
  }
  if (farthestDistance <= tolerance) return [[...points[0]], [...points.at(-1)]];
  const left = simplifyPolyline(points.slice(0, farthestIndex + 1), tolerance);
  const right = simplifyPolyline(points.slice(farthestIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

export function normalizeDrawnPath(points) {
  if (!Array.isArray(points) || !points.length) return { x: 0, y: 0, points: [] };
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2;
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  return { x, y, points: points.map(point => [point[0] - x, point[1] - y]) };
}

function pointsEqual(a, b, epsilon = 1e-6) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= epsilon;
}

function normalizePolygonRing(points, maxPoints = 512) {
  if (!Array.isArray(points)) return null;
  const cleaned = [];
  for (const point of points) {
    if (!Array.isArray(point) || !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1]))) continue;
    const next = [Math.max(-10_000, Math.min(10_000, Number(point[0]))), Math.max(-10_000, Math.min(10_000, Number(point[1])))];
    if (!cleaned.length || !pointsEqual(cleaned.at(-1), next)) cleaned.push(next);
  }
  if (cleaned.length > 1 && pointsEqual(cleaned[0], cleaned.at(-1))) cleaned.pop();
  if (cleaned.length < 3) return null;
  if (cleaned.length <= maxPoints) return cleaned;
  return Array.from({ length: maxPoints }, (_, index) => cleaned[Math.floor(index * cleaned.length / maxPoints)]);
}

export function simplifyClosedRing(points, tolerance = .1, maxPoints = 512) {
  let ring = normalizePolygonRing(points, Math.max(maxPoints * 8, maxPoints));
  if (!ring) return [];
  let changed = true;
  while (changed && ring.length > 3) {
    changed = false;
    const next = [];
    for (let index = 0; index < ring.length; index += 1) {
      const previous = ring[(index + ring.length - 1) % ring.length], current = ring[index], following = ring[(index + 1) % ring.length];
      if (ring.length - next.length > 3 && pointSegmentDistance(current, previous, following) <= tolerance) { changed = true; continue; }
      next.push(current);
    }
    if (next.length < 3 || next.length === ring.length) break;
    ring = next;
  }
  return normalizePolygonRing(ring, maxPoints) || [];
}

function roundedRectContains(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const qx = Math.abs(x) - (width / 2 - r);
  const qy = Math.abs(y) - (height / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= r;
}

export function polygonSelfIntersects(points) {
  const orientationValue = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSegment = (a, b, point) => Math.abs(orientationValue(a, b, point)) <= 1e-7
    && point[0] >= Math.min(a[0], b[0]) - 1e-7 && point[0] <= Math.max(a[0], b[0]) + 1e-7
    && point[1] >= Math.min(a[1], b[1]) - 1e-7 && point[1] <= Math.max(a[1], b[1]) + 1e-7;
  const intersects = (a, b, c, d) => {
    const abC = orientationValue(a, b, c), abD = orientationValue(a, b, d), cdA = orientationValue(c, d, a), cdB = orientationValue(c, d, b);
    if (((abC > 1e-7 && abD < -1e-7) || (abC < -1e-7 && abD > 1e-7)) && ((cdA > 1e-7 && cdB < -1e-7) || (cdA < -1e-7 && cdB > 1e-7))) return true;
    return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
  };
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    if (pointsEqual(points[first], points[firstNext])) return true;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      const a = points[first], b = points[firstNext], c = points[second], d = points[secondNext];
      if (intersects(a, b, c, d)) return true;
    }
  }
  return false;
}

export function offsetPolygon(points, inset = 0) {
  if (!Array.isArray(points) || points.length < 3 || inset <= 0) return (points || []).map(point => [...point]);
  const signedArea = points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point[0] * next[1] - next[0] * point[1]; }, 0) / 2;
  const winding = signedArea >= 0 ? 1 : -1;
  const output = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index + points.length - 1) % points.length], current = points[index], next = points[(index + 1) % points.length];
    const previousDirection = [current[0] - previous[0], current[1] - previous[1]], nextDirection = [next[0] - current[0], next[1] - current[1]];
    const previousLength = Math.hypot(...previousDirection) || 1, nextLength = Math.hypot(...nextDirection) || 1;
    const previousNormal = [-previousDirection[1] / previousLength * winding, previousDirection[0] / previousLength * winding];
    const nextNormal = [-nextDirection[1] / nextLength * winding, nextDirection[0] / nextLength * winding];
    const a = [current[0] + previousNormal[0] * inset, current[1] + previousNormal[1] * inset];
    const b = [current[0] + nextNormal[0] * inset, current[1] + nextNormal[1] * inset];
    const denominator = previousDirection[0] * nextDirection[1] - previousDirection[1] * nextDirection[0];
    let candidate;
    if (Math.abs(denominator) > 1e-8) {
      const t = ((b[0] - a[0]) * nextDirection[1] - (b[1] - a[1]) * nextDirection[0]) / denominator;
      candidate = [a[0] + previousDirection[0] * t, a[1] + previousDirection[1] * t];
    } else {
      const nx = previousNormal[0] + nextNormal[0], ny = previousNormal[1] + nextNormal[1], length = Math.hypot(nx, ny) || 1;
      candidate = [current[0] + nx / length * inset, current[1] + ny / length * inset];
    }
    if (Math.hypot(candidate[0] - current[0], candidate[1] - current[1]) > inset * 8) {
      const nx = previousNormal[0] + nextNormal[0], ny = previousNormal[1] + nextNormal[1], length = Math.hypot(nx, ny) || 1;
      candidate = [current[0] + nx / length * inset, current[1] + ny / length * inset];
    }
    output.push(candidate);
  }
  return output;
}

/**
 * Analytic polygon presets shared by the editor, manufacturing mask, and SVG
 * handoff. Width and height already include any requested inset.
 */
export function presetMedalOutlinePoints(shape, width, height) {
  const specs = {
    hexagon: { count: 6, inner: 1 },
    octagon: { count: 8, inner: 1 },
    scalloped: { count: 32, inner: .91 },
    star: { count: 10, inner: .62 },
    gear: { count: 48, inner: .86 },
  };
  if (shape === 'shield') {
    return [[-.48,-.42],[0,-.5],[.48,-.42],[.43,.12],[.25,.36],[0,.5],[-.25,.36],[-.43,.12]]
      .map(([x, y]) => [x * width, y * height]);
  }
  const spec = specs[shape];
  if (!spec) return null;
  return Array.from({ length: spec.count }, (_, index) => {
    const radius = spec.inner < 1 && index % 2 ? spec.inner : 1;
    const angle = -Math.PI / 2 + index * Math.PI * 2 / spec.count;
    return [Math.cos(angle) * width / 2 * radius, Math.sin(angle) * height / 2 * radius];
  });
}

export function medalContainsPoint(project, x, y, inset = 0) {
  const rawWidth = project.medal.width || project.medal.diameter, rawHeight = project.medal.height || project.medal.diameter;
  const width = Math.max(.1, rawWidth - inset * 2);
  const height = Math.max(.1, rawHeight - inset * 2);
  const shape = project.medal.shape || 'circle';
  if (shape === 'custom' && project.medal.outline?.length >= 3) {
    const points = project.medal.outline;
    if (!pointInPolygon([x, y], points)) return false;
    if (inset <= 0) return true;
    for (let index = 0; index < points.length; index += 1) if (pointSegmentDistance([x, y], points[index], points[(index + 1) % points.length]) < inset - 1e-6) return false;
    return true;
  }
  if (shape === 'circle' || shape === 'oval') return (x / (width / 2)) ** 2 + (y / (height / 2)) ** 2 <= 1;
  if (shape === 'rounded') return roundedRectContains(x, y, width, height, Math.max(0, project.medal.cornerRadius - inset));
  const preset = presetMedalOutlinePoints(shape, width, height);
  return pointInPolygon([x, y], preset || presetMedalOutlinePoints('shield', width, height));
}

/** True when a face-space point belongs to the selected raised edge style. */
export function rimContainsPoint(project, x, y) {
  const medal = project?.medal || {};
  const width = Math.max(0, Number(medal.rimWidth) || 0);
  const outer = Math.max(0, Number(medal.edgeInset) || 0);
  if (width <= 0 || !medalContainsPoint(project, x, y, outer)) return false;
  const band = (from, to) => medalContainsPoint(project, x, y, outer + width * from)
    && !medalContainsPoint(project, x, y, outer + width * to);
  const faceWidth = Math.max(.1, Number(medal.width || medal.diameter) || 60);
  const faceHeight = Math.max(.1, Number(medal.height || medal.diameter) || faceWidth);
  const angle = Math.atan2(y / (faceHeight / 2), x / (faceWidth / 2));
  const turn = ((angle / (Math.PI * 2)) + 1) % 1;
  const phase = count => ((turn * count) % 1 + 1) % 1;
  const style = Object.hasOwn(RIM_STYLE_INFO, medal.rimStyle) ? medal.rimStyle : 'classic';

  if (style === 'double') return band(0, .34) || band(.67, 1);
  if (style === 'scalloped') {
    const localWidth = .58 + .42 * (.5 + .5 * Math.cos(angle * 18));
    return band(0, localWidth);
  }
  if (style === 'faceted') return band(0, 1) && phase(18) > .075;
  if (style === 'laurel') {
    const sideArc = Math.abs(Math.cos(angle)) > .18 && Math.abs(Math.sin(angle)) < .96;
    const leaf = sideArc && phase(22) > .12 && phase(22) < .86 && band(0, .76 + .16 * Math.abs(Math.sin(angle * 11)));
    return leaf || band(.86, 1);
  }
  if (style === 'wings') {
    const sideStrength = Math.abs(Math.cos(angle));
    const feather = sideStrength > .35 && phase(20) > .08 && phase(20) < .84
      && band(0, Math.min(1, .34 + sideStrength * .58));
    return feather || band(.88, 1);
  }
  return band(0, 1);
}

export function medalFaceArea(project, inset = 0) {
  const rawWidth = project.medal.width || project.medal.diameter, rawHeight = project.medal.height || project.medal.diameter;
  const width = Math.max(.1, rawWidth - inset * 2);
  const height = Math.max(.1, rawHeight - inset * 2);
  const shape = project.medal.shape || 'circle';
  if (shape === 'custom' && project.medal.outline?.length >= 3) {
    const points = project.medal.outline;
    const area = Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point[0] * next[1] - next[0] * point[1]; }, 0) / 2);
    if (inset <= 0) return area;
    const perimeter = points.reduce((sum, point, index) => sum + Math.hypot(point[0] - points[(index + 1) % points.length][0], point[1] - points[(index + 1) % points.length][1]), 0);
    return Math.max(0, area - perimeter * inset + Math.PI * inset * inset);
  }
  if (shape === 'circle' || shape === 'oval') return Math.PI * width * height / 4;
  if (shape === 'rounded') {
    const r = Math.max(0, Math.min(project.medal.cornerRadius - inset, width / 2, height / 2));
    return width * height - (4 - Math.PI) * r * r;
  }
  const preset = presetMedalOutlinePoints(shape, width, height) || presetMedalOutlinePoints('shield', width, height);
  return Math.abs(preset.reduce((sum, point, index) => {
    const next = preset[(index + 1) % preset.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
}

export function rimAreaEstimate(project) {
  const medal = project?.medal || {};
  const width = Math.max(0, Number(medal.rimWidth) || 0);
  if (!width) return 0;
  const outer = Math.max(0, Number(medal.edgeInset) || 0);
  const fullBand = Math.max(0, medalFaceArea(project, outer) - medalFaceArea(project, outer + width));
  const info = RIM_STYLE_INFO[medal.rimStyle] || RIM_STYLE_INFO.classic;
  return fullBand * info.coverage;
}

export function elementFitsSafeArea(project, element, inset) {
  const bounds = elementBounds(element);
  const rotation = (element.rotation || 0) * Math.PI / 180;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const containsLocal = (dx, dy) => {
    const rotatedX = dx * cos - dy * sin, rotatedY = dx * sin + dy * cos;
    // Back paths are reflected around their local X axis by the manufacturing
    // rasterizer. Reflect the sample offset too; otherwise asymmetric artwork
    // is checked at a translated phantom position and can be falsely blocked.
    return medalContainsPoint(project, bounds.x + rotatedX, bounds.y + (element.face === 'back' ? -rotatedY : rotatedY), inset);
  };
  // A circle or ellipse is not its axis-aligned bounding box. Sampling the
  // actual circumference avoids rejecting perfectly valid round artwork near
  // a round medal edge while remaining conservative for arbitrary bodies.
  if (element.type === 'image' && Array.isArray(element.footprint) && element.footprint.length >= 3) {
    const footprint = element.footprint.map(point => [point[0] * bounds.width, point[1] * bounds.height]);
    const maximumStep = Math.max(.25, (Number(project?.profile?.nozzle) || .4) * 1.125);
    for (let index = 0; index < footprint.length; index += 1) {
      const point = footprint[index], next = footprint[(index + 1) % footprint.length];
      const steps = Math.max(1, Math.ceil(Math.hypot(next[0] - point[0], next[1] - point[1]) / maximumStep));
      for (let step = 0; step < steps; step += 1) {
        const amount = step / steps;
        if (!containsLocal(point[0] + (next[0] - point[0]) * amount, point[1] + (next[1] - point[1]) * amount)) return false;
      }
    }
    return true;
  }
  if (element.type === 'shape' && element.shape === 'circle') {
    return Array.from({ length: 32 }, (_, index) => index * Math.PI * 2 / 32)
      .every(angle => containsLocal(Math.cos(angle) * bounds.width / 2, Math.sin(angle) * bounds.height / 2));
  }
  if (element.type === 'path' && Array.isArray(element.points) && element.points.length) {
    const scaleX = Math.max(.001, Number(element.scaleX) || 1), scaleY = Math.max(.001, Number(element.scaleY) || 1);
    const sourceScale = Math.max(.001, Number(element.scale) || 1);
    const local = element.points.map(([x, y]) => [x * sourceScale * scaleX, y * sourceScale * scaleY]);
    const centerX = (Math.min(...local.map(point => point[0])) + Math.max(...local.map(point => point[0]))) / 2;
    const centerY = (Math.min(...local.map(point => point[1])) + Math.max(...local.map(point => point[1]))) / 2;
    const radius = element.closed ? 0 : Math.max(0, Number(element.strokeWidth) || 0) * Math.max(scaleX, scaleY) / 2;
    for (let index = 0; index < local.length; index += 1) {
      const point = local[index], next = local[(index + 1) % local.length];
      const segmentExists = element.closed || index < local.length - 1;
      const samples = segmentExists ? [point, [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2]] : [point];
      for (const [x, y] of samples) {
        const dx = x - centerX, dy = y - centerY;
        if (!containsLocal(dx, dy)) return false;
        if (radius && (!containsLocal(dx + radius, dy) || !containsLocal(dx - radius, dy) || !containsLocal(dx, dy + radius) || !containsLocal(dx, dy - radius))) return false;
      }
    }
    return true;
  }
  const samples = [[0,0],[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5],[0,-.5],[.5,0],[0,.5],[-.5,0]];
  return samples.every(([u, v]) => containsLocal(u * bounds.width, v * bounds.height));
}

export function snapToLayer(value, layerHeight) {
  const layer = Math.max(.01, Number(layerHeight) || .2);
  return Math.max(layer, Math.round((Number(value) || layer) / layer) * layer);
}

export function elementOperationAmount(element) {
  if (element.operation === 'raise') return Number(element.zHeight) || 0;
  if (element.operation === 'inlay') return Number(element.zDepth) || 0;
  if (element.operation === 'engrave') return Number(element.zDepth) || 0;
  return 0;
}

export function buildChecks(project, inventory) {
  const checks = [];
  const nozzle = project.profile.nozzle;
  const oneBead = nozzle * 1.125;
  const robust = oneBead * 2;
  const catalog = normalizeInventory(inventory);
  const palette = getPalette(project, catalog);
  const layerHeight = project.profile.layerHeight;

  const catalogIds = new Set(catalog.map(filament => filament.id));
  for (const id of [...new Set(project.paletteIds || [])]) {
    if (!catalogIds.has(id)) checks.push({ level: 'block', title: 'A project filament is missing', message: `The saved filament “${id}” is not in this device's catalog. Import its project snapshot or remap that palette slot before production.` });
  }

  if (project.medal.shape === 'custom') {
    if (polygonSelfIntersects(project.medal.outline || [])) checks.push({ level: 'block', title: 'Custom outline crosses itself', message: 'Edit the source path so its perimeter is one simple closed loop, then convert it again.' });
    const fillRatio = medalFaceArea(project) / Math.max(1, project.medal.width * project.medal.height);
    if (fillRatio < .24) checks.push({ level: 'warn', title: 'Custom outline has narrow or deep concave regions', message: 'Inspect the exact layers for disconnected islands and weak necks before printing.' });
    if (['single', 'double'].includes(project.medal.loopStyle)) {
      const samples = 120, step = project.medal.loopWidth / samples;
      let widestContact = 0;
      for (const depth of [.5, 1.5, 2.5]) {
        const y = -project.medal.height / 2 + depth;
        let run = 0;
        for (let sample = 0; sample <= samples; sample += 1) {
          const x = -project.medal.loopWidth / 2 + sample * step;
          if (medalContainsPoint(project, x, y)) { run += step; widestContact = Math.max(widestContact, run); }
          else run = 0;
        }
      }
      if (widestContact < robust) checks.push({ level: 'block', title: 'Ribbon loop does not join the custom body', message: 'Flatten or widen the top of the custom outline, or choose No loop, so the loop has a printable connection.' });
    }
  }

  if (project.profile.colorSystem === 'manual') {
    const usage = new Map();
    const backOffset = projectBackOffset(project);
    const baseTop = backOffset + project.medal.baseThickness;
    const addRange = (slot, z0, z1) => {
      for (let layer = 1; layer <= Math.ceil(z1 / layerHeight); layer += 1) {
        const midpoint = (layer - .5) * layerHeight;
        if (midpoint < z0 - .0001 || midpoint > z1 + .0001) continue;
        if (!usage.has(layer)) usage.set(layer, new Set());
        usage.get(layer).add(Math.max(0, Math.min(project.paletteIds.length - 1, Number(slot) || 0)));
      }
    };
    addRange(project.medal.baseColor, backOffset, baseTop);
    if (project.medal.rimWidth > 0 && project.medal.rimHeight > 0) addRange(project.medal.rimColor, baseTop, baseTop + project.medal.rimHeight);
    if (['single', 'double'].includes(project.medal.loopStyle) && project.medal.attachmentHeight > 0 && Number.isInteger(project.medal.attachmentColor)) {
      addRange(project.medal.attachmentColor, baseTop, baseTop + project.medal.attachmentHeight);
    }
    for (const element of project.elements) {
      if (element.hidden || !['raise', 'inlay'].includes(element.operation)) continue;
      const slots = element.type === 'image' ? imageUsedSlots(element, project.paletteIds.length) : [element.color];
      const isBack = element.face === 'back';
      const z0 = isBack
        ? (element.operation === 'inlay' ? backOffset - element.inlayHeight : backOffset - element.zHeight)
        : (element.operation === 'inlay' ? baseTop - element.zDepth : baseTop);
      const z1 = isBack
        ? (element.operation === 'inlay' ? backOffset + element.zDepth : backOffset)
        : (element.operation === 'inlay' ? baseTop + element.inlayHeight : baseTop + element.zHeight);
      for (const slot of slots) addRange(slot, z0, z1);
    }
    const collision = [...usage].find(([, slots]) => slots.size > 1);
    if (collision) checks.push({ level: 'block', title: 'Same-layer colors need a multicolor system', message: `Layer ${collision[0]} contains ${collision[1].size} spatial colors. Use a multicolor unit / toolchanger or move colors into separate height bands.` });
    else {
      const changes = [...usage].sort((a, b) => a[0] - b[0]).filter((entry, index, rows) => index > 0 && [...entry[1]][0] !== [...rows[index - 1][1]][0]).map(entry => entry[0]);
      if (changes.length) checks.push({ level: 'warn', title: 'Manual filament swaps required', message: `Pause before layer${changes.length === 1 ? '' : 's'} ${changes.slice(0, 6).join(', ')}${changes.length > 6 ? '…' : ''} and confirm the slicer preview.` });
    }
  }

  const baseLayers = project.medal.baseThickness / layerHeight;
  if (Math.abs(baseLayers - Math.round(baseLayers)) > .04) checks.push({ level: 'warn', title: 'Base thickness falls between layers', message: `Use ${(Math.round(baseLayers) * layerHeight).toFixed(2)} mm for a complete base layer.` });
  if (project.medal.rimWidth > 0) {
    const rimLayers = project.medal.rimHeight / layerHeight;
    if (rimLayers < .95) checks.push({ level: 'block', title: 'Rim is below one layer', message: `Raise the rim to at least ${layerHeight.toFixed(2)} mm.` });
    else if (rimLayers < 1.95) checks.push({ level: 'warn', title: 'Rim is only one layer high', message: `Two layers (${(layerHeight * 2).toFixed(2)} mm) are more durable.` });
    if (Math.abs(rimLayers - Math.round(rimLayers)) > .04) checks.push({ level: 'warn', title: 'Rim height falls between layers', message: `Snap it to ${snapToLayer(project.medal.rimHeight, layerHeight).toFixed(2)} mm.` });
    if (project.medal.rimHeight > Math.max(2, project.medal.rimWidth * 2.5)) checks.push({ level: 'warn', title: 'Rim is tall for its width', message: 'Widen the rim or lower it to reduce fragile wall risk.' });
  }

  if (project.elements.length === 0) checks.push({ level: 'warn', title: 'No artwork yet', message: 'The medal body is printable, but the face is blank.' });
  if (project.elements.some(element => !element.hidden && element.face === 'back')) {
    checks.push({
      level: 'warn',
      title: 'Back artwork uses first-layer color',
      message: 'Back artwork is embedded flush into the build-plate layer. Confirm the first-layer color regions and adhesion in the slicer preview before printing.',
    });
  }
  const recesses = project.elements.filter(element => !element.hidden && ['engrave', 'inlay'].includes(element.operation));
  const orientedBox = element => {
    const bounds = elementBounds(element), angle = (Number(element.rotation) || 0) * Math.PI / 180 * (element.face === 'back' ? -1 : 1);
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    return {
      center: [bounds.x, bounds.y],
      half: [bounds.width / 2, bounds.height / 2],
      axes: [[cosine, sine], [-sine, cosine]],
    };
  };
  const boxesOverlap = (one, two) => {
    const delta = [two.center[0] - one.center[0], two.center[1] - one.center[1]];
    for (const axis of [...one.axes, ...two.axes]) {
      const centerDistance = Math.abs(delta[0] * axis[0] + delta[1] * axis[1]);
      const radiusOne = one.half[0] * Math.abs(one.axes[0][0] * axis[0] + one.axes[0][1] * axis[1]) + one.half[1] * Math.abs(one.axes[1][0] * axis[0] + one.axes[1][1] * axis[1]);
      const radiusTwo = two.half[0] * Math.abs(two.axes[0][0] * axis[0] + two.axes[0][1] * axis[1]) + two.half[1] * Math.abs(two.axes[1][0] * axis[0] + two.axes[1][1] * axis[1]);
      if (centerDistance >= radiusOne + radiusTwo - 1e-6) return false;
    }
    return true;
  };
  for (let first = 0; first < recesses.length; first += 1) for (let second = first + 1; second < recesses.length; second += 1) {
    const a = recesses[first], b = recesses[second];
    if (a.face === b.face || a.zDepth + b.zDepth <= project.medal.baseThickness - project.medal.minimumFloor + .001) continue;
    if (a.type === 'shape' && b.type === 'shape' && a.shape === 'circle' && b.shape === 'circle') {
      const radiusA = a.size * Math.max(Number(a.scaleX) || 1, Number(a.scaleY) || 1) / 2;
      const radiusB = b.size * Math.max(Number(b.scaleX) || 1, Number(b.scaleY) || 1) / 2;
      if (Math.hypot(a.x - b.x, a.y - b.y) >= radiusA + radiusB - 1e-6) continue;
    }
    if (!boxesOverlap(orientedBox(a), orientedBox(b))) continue;
    checks.push({ level: 'block', elementId: b.id, title: 'Front and back pockets leave too little shared floor', message: `“${a.name}” and “${b.name}” overlap from opposite sides. Reduce their combined depth to ${(project.medal.baseThickness - project.medal.minimumFloor).toFixed(2)} mm or move one of them.` });
  }
  for (const element of project.elements) {
    if (element.hidden) continue;
    const planarScale = Math.min(Math.max(.001, Number(element.scaleX) || 1), Math.max(.001, Number(element.scaleY) || 1));
    let minimumFeature = Number.POSITIVE_INFINITY;
    if (element.type === 'text') minimumFeature = element.fontSize * (element.weight >= 800 ? .16 : .11) * planarScale;
    if (element.type === 'shape') minimumFeature = (element.shape === 'star' || element.shape === 'bolt' ? element.size * .12 : element.size * .22) * planarScale;
    if (element.type === 'path') minimumFeature = element.closed ? Math.min(elementBounds(element).width, elementBounds(element).height) * .15 : element.strokeWidth * planarScale;
    if (element.type === 'image') minimumFeature = (element.minimumFeature || element.detailCell || (element.width / Math.max(1, element.pixelWidth || 1))) * planarScale;
    if (element.type === 'image' && !element.dataUrl && !element.maskUrls?.some(Boolean)) checks.push({ level: 'block', elementId: element.id, title: `${element.name} has no safe local image data`, message: 'Re-upload the artwork. Remote or unsafe image sources are not loaded by local projects.' });
    if (minimumFeature < oneBead) checks.push({ level: 'block', elementId: element.id, title: `${element.name} is too fine`, message: `${minimumFeature.toFixed(2)} mm detail is below one ${oneBead.toFixed(2)} mm extrusion line.` });
    else if (minimumFeature < robust) checks.push({ level: 'warn', elementId: element.id, title: `${element.name} uses one-line detail`, message: `${minimumFeature.toFixed(2)} mm may print, but ${robust.toFixed(2)} mm is the robust target.` });
    const safeInset = project.medal.edgeInset + (project.medal.rimWidth > 0 ? project.medal.rimWidth : 0);
    if (!elementFitsSafeArea(project, element, safeInset)) checks.push({ level: 'block', elementId: element.id, title: `${element.name} crosses the safe area`, message: 'Move or scale this element inward. Export clips artwork at the protected medal edge.' });

    if (element.operation === 'raise') {
      const layers = element.zHeight / layerHeight;
      if (layers < .95) checks.push({ level: 'block', elementId: element.id, title: `${element.name} is below one layer`, message: `Raise it at least ${layerHeight.toFixed(2)} mm for this profile.` });
      else if (layers < 1.95) checks.push({ level: 'warn', elementId: element.id, title: `${element.name} is only one layer high`, message: `Two layers (${(layerHeight * 2).toFixed(2)} mm) are more durable.` });
      if (Math.abs(layers - Math.round(layers)) > .04) checks.push({ level: 'warn', elementId: element.id, title: `${element.name} height falls between layers`, message: `Snap to ${snapToLayer(element.zHeight, layerHeight).toFixed(2)} mm for a complete top layer.` });
      if (element.zHeight > Math.max(2, minimumFeature * 3)) checks.push({ level: 'warn', elementId: element.id, title: `${element.name} is tall for its width`, message: 'Tall narrow relief may be fragile. Widen it or reduce its height.' });
    } else if (element.operation === 'engrave' || element.operation === 'inlay') {
      const layers = element.zDepth / layerHeight;
      if (layers < .95) checks.push({ level: 'block', elementId: element.id, title: `${element.name} cut is below one layer`, message: `Use at least ${layerHeight.toFixed(2)} mm depth.` });
      if (Math.abs(layers - Math.round(layers)) > .04) checks.push({ level: 'warn', elementId: element.id, title: `${element.name} depth falls between layers`, message: `Snap to ${snapToLayer(element.zDepth, layerHeight).toFixed(2)} mm for predictable slicing.` });
      if (project.medal.baseThickness - element.zDepth < project.medal.minimumFloor - .001) checks.push({ level: 'block', elementId: element.id, title: `${element.name} leaves too little floor`, message: `Keep at least ${project.medal.minimumFloor.toFixed(2)} mm beneath recessed details.` });
      if (element.operation === 'inlay' && element.inlayHeight > 0 && Math.abs(element.inlayHeight / layerHeight - Math.round(element.inlayHeight / layerHeight)) > .04) checks.push({ level: 'warn', elementId: element.id, title: `${element.name} inlay top falls between layers`, message: 'Snap the inlay top height to the selected layer height.' });
    } else if (element.operation === 'cut') {
      checks.push({ level: 'warn', elementId: element.id, title: `${element.name} is a through cut`, message: 'Open Layers in the model workspace to confirm it does not create loose islands or split the medal.' });
    }
  }
  const attachment = medalAttachmentGeometry(project);
  if (attachment.external) {
    const ligament = (project.medal.loopWidth - project.medal.slotWidth) / 2;
    const verticalLigament = (project.medal.loopHeight - project.medal.slotHeight) / 2;
    if (ligament < robust) checks.push({ level: 'block', title: 'Ribbon bar walls are too thin', message: `${ligament.toFixed(2)} mm remains beside the opening; use at least ${robust.toFixed(2)} mm.` });
    else if (ligament < robust * 1.6) checks.push({ level: 'warn', title: 'Ribbon bar needs a strength test', message: 'It passes the width rule, but real ribbon loads should be validated with a printed sample.' });
    if (verticalLigament < robust) checks.push({ level: 'block', title: 'Ribbon bar top or bottom wall is too thin', message: `${verticalLigament.toFixed(2)} mm remains above and below the opening; use at least ${robust.toFixed(2)} mm.` });
    if (project.medal.slotHeight < oneBead) checks.push({ level: 'block', title: 'Ribbon opening is too small', message: `Use at least ${oneBead.toFixed(2)} mm opening height for this nozzle.` });
    if (project.medal.loopStyle === 'double') {
      const bridge = Math.max(1.4, nozzle * 3);
      const eachOpening = (project.medal.slotWidth - bridge) / 2;
      if (eachOpening < oneBead) checks.push({ level: 'block', title: 'Double ribbon openings are too narrow', message: `Each opening is only ${eachOpening.toFixed(2)} mm after the ${bridge.toFixed(2)} mm center bridge. Increase the total opening width.` });
      if (bridge < robust) checks.push({ level: 'block', title: 'Double ribbon center bridge is too thin', message: `Use at least ${robust.toFixed(2)} mm for the center bridge with this nozzle.` });
    }
  } else if (attachment.style === 'eyelet') {
    const opening = project.medal.holeDiameter;
    const sideLigament = (project.medal.width - opening) / 2;
    if (opening < oneBead) checks.push({ level: 'block', title: 'Ribbon hole may print closed', message: `Increase the hole to at least ${oneBead.toFixed(2)} mm for this nozzle.` });
    if (project.medal.attachmentInset < robust) checks.push({ level: 'block', title: 'Too little material above the ribbon hole', message: `Keep at least ${robust.toFixed(2)} mm between the hole and outer edge.` });
    if (sideLigament < robust) checks.push({ level: 'block', title: 'Ribbon hole is too wide for this body', message: 'Reduce the hole diameter or widen the medal.' });
  } else if (attachment.style === 'slit' || attachment.style === 'open-slit') {
    const sideLigament = (project.medal.width - project.medal.slitWidth) / 2;
    if (project.medal.slitHeight < oneBead) checks.push({ level: 'block', title: 'Ribbon slit may print closed', message: `Increase its height to at least ${oneBead.toFixed(2)} mm for this nozzle.` });
    if (sideLigament < robust) checks.push({ level: 'block', title: 'Ribbon slit leaves weak side walls', message: `Keep at least ${robust.toFixed(2)} mm at each side of the opening.` });
    if (attachment.style === 'slit' && project.medal.attachmentInset < robust) checks.push({ level: 'block', title: 'Too little material above the ribbon slit', message: `Keep at least ${robust.toFixed(2)} mm between the slit and outer edge, or choose Quick-load slit.` });
    if (attachment.style === 'open-slit' && sideLigament < robust * 1.6) checks.push({ level: 'warn', title: 'Quick-load slit prongs need a pull test', message: 'Print a sample and verify the open loading channel under real ribbon tension.' });
  }
  if (attachment.aperture?.kind === 'circle') {
    const radius = attachment.aperture.diameter / 2;
    const contained = Array.from({ length: 20 }, (_, index) => {
      const angle = index * Math.PI * 2 / 20;
      return medalContainsPoint(project, attachment.aperture.cx + Math.cos(angle) * radius, attachment.aperture.cy + Math.sin(angle) * radius);
    }).every(Boolean);
    if (!contained) checks.push({ level: 'block', title: 'Ribbon hole crosses the medal outline', message: 'Increase its edge inset, reduce its diameter, or choose a body with more material at the top.' });
  }
  if (attachment.aperture?.kind === 'rounded-rect') {
    const aperture = attachment.aperture;
    const points = [[aperture.x0, aperture.cy], [aperture.x1, aperture.cy], [aperture.x0 + aperture.height / 2, aperture.y1], [aperture.x1 - aperture.height / 2, aperture.y1]];
    if (attachment.style === 'slit') points.push([0, aperture.y0]);
    if (!points.every(([x, y]) => medalContainsPoint(project, x, y))) checks.push({ level: 'block', title: 'Ribbon slit crosses the medal outline', message: 'Reduce or move the opening, or choose a body with more material at the top.' });
  }
  const usedSlots = projectUsedSlots(project);
  usedSlots.forEach(slot => {
    const filament = palette[slot];
    if (!filament) return;
    const stock = availability(filament);
    if (stock.key === 'out') checks.push({ level: 'block', title: `Slot ${slot + 1} is out of stock`, message: `${filament.name} cannot be used for an order until stock is updated.` });
    else if (stock.key === 'low') checks.push({ level: 'warn', title: `Slot ${slot + 1} has low stock`, message: `${filament.name} may not cover a large quantity.` });
    else if (stock.key === 'unknown') checks.push({ level: 'warn', title: `Slot ${slot + 1} stock is not entered`, message: `Enter the available grams for ${filament.name} before relying on the quantity quote.` });
    if (filament.abrasive && !project.profile.hardened) checks.push({ level: 'warn', title: `${filament.effect} needs hardened hardware`, message: `${filament.name} is marked abrasive. Enable a hardened nozzle or choose another filament.` });
  });
  const materialFamilies = [...new Set(usedSlots.map(slot => palette[slot]?.material).filter(Boolean))];
  if (materialFamilies.length > 1) checks.push({ level: 'block', title: 'Mixed materials need a tested profile', message: `${materialFamilies.join(' + ')} may not bond reliably in one medal. Use one material family or validate the exact combination.` });
  if (!checks.some(check => check.level !== 'pass')) checks.push({ level: 'pass', title: 'Profile checks pass', message: `Visible features meet the ${robust.toFixed(2)} mm robust target for a ${nozzle.toFixed(1)} mm nozzle.` });
  return checks;
}

export function calculateQuote(project, inventory, quantity = 25, geometry = null) {
  const q = Math.max(1, Number(quantity) || 1);
  const palette = getPalette(project, inventory);
  const faceArea = medalFaceArea(project);
  const attachment = medalAttachmentGeometry(project);
  const loopArea = attachment.external ? attachment.outer.width * attachment.outer.height - attachment.apertures.reduce((sum, aperture) => sum + aperture.width * aperture.height, 0) : 0;
  let openingArea = 0;
  if (attachment.style === 'eyelet') openingArea = Math.PI * (project.medal.holeDiameter / 2) ** 2;
  if (attachment.style === 'slit' || attachment.style === 'open-slit') {
    const corner = project.medal.slitHeight / 2;
    openingArea = project.medal.slitWidth * project.medal.slitHeight - (4 - Math.PI) * corner * corner;
    if (attachment.style === 'open-slit') openingArea += project.medal.slitHeight * Math.max(0, project.medal.attachmentInset);
  }
  const baseVolume = Math.max(0, faceArea + loopArea - openingArea) * project.medal.baseThickness;
  const rimArea = rimAreaEstimate(project);
  let volumeDelta = rimArea * project.medal.rimHeight;
  for (const element of project.elements) {
    if (element.hidden) continue;
    const bounds = elementBounds(element);
    let area = bounds.width * bounds.height * .55;
    if (element.type === 'text') area = bounds.width * bounds.height * .48;
    else if (element.type === 'image') area = bounds.width * bounds.height * .46;
    else if (element.type === 'path' && !element.closed) area = Math.max(bounds.width, bounds.height) * element.strokeWidth;
    area = Math.min(area, faceArea * .45);
    if (element.operation === 'raise') volumeDelta += area * element.zHeight;
    else if (element.operation === 'engrave') volumeDelta -= area * element.zDepth;
    else if (element.operation === 'cut') volumeDelta -= area * project.medal.baseThickness;
    else if (element.operation === 'inlay') volumeDelta += area * element.inlayHeight;
  }
  const exactMeshes = Array.isArray(geometry?.meshes) && geometry.meshes.length ? geometry.meshes : null;
  const totalVolume = exactMeshes ? exactMeshes.reduce((sum, mesh) => sum + mesh.volumeMm3, 0) : Math.max(baseVolume * .35, baseVolume + volumeDelta);
  const usedSlots = exactMeshes ? [...new Set(exactMeshes.map(mesh => mesh.slot))] : projectUsedSlots(project);
  const totalGrams = exactMeshes
    ? exactMeshes.reduce((sum, mesh) => sum + mesh.volumeMm3 / 1000 * (palette[mesh.slot]?.density || 1.24), 0)
    : totalVolume / 1000 * 1.24;
  const averageKgPrice = usedSlots.reduce((sum, slot) => sum + (palette[slot]?.pricePerKg ?? palette[0]?.pricePerKg ?? 0), 0) / Math.max(1, usedSlots.length);
  const materialPerPiece = exactMeshes
    ? exactMeshes.reduce((sum, mesh) => sum + mesh.volumeMm3 / 1000 * (palette[mesh.slot]?.density || 1.24) * (palette[mesh.slot]?.pricePerKg ?? averageKgPrice) / 1000 * 1.18, 0)
    : totalGrams * averageKgPrice / 1000 * 1.18;
  const purgeGrams = Math.max(0, usedSlots.length - 1) * 1.5;
  const purgePerPiece = purgeGrams * averageKgPrice / 1000;
  const machineMinutes = totalVolume * .0062 + usedSlots.length * 4.5;
  const machinePerPiece = machineMinutes * .82;
  const specialPerPiece = usedSlots.reduce((sum, slot) => { const filament = palette[slot], effect = String(filament?.effect || '').trim().toLowerCase(); return sum + (!filament || effect === 'solid' || effect === 'matte' ? 0 : 4.5); }, 0);
  const packaging = 8;
  const variable = materialPerPiece + purgePerPiece + machinePerPiece + specialPerPiece + packaging;
  const setup = 280 + Math.max(0, usedSlots.length - 1) * 85 + (project.elements.some(element => element.type === 'image' && !element.hidden) ? 90 : 0);
  const scale = q >= 100 ? .76 : q >= 50 ? .82 : q >= 25 ? .88 : q >= 10 ? .94 : 1;
  const subtotal = setup + variable * q * scale;
  const total = Math.ceil(subtotal * 1.28 / 5) * 5;
  const unit = Math.ceil(total / q);
  return {
    quantity: q, unit, total, setup: Math.ceil(setup), materialPerPiece: Math.ceil(materialPerPiece + purgePerPiece), machinePerPiece: Math.ceil(machinePerPiece), packagingPerPiece: packaging,
    gramsPerPiece: totalGrams + purgeGrams, minutesPerPiece: machineMinutes, estimated: true, geometryBased: Boolean(exactMeshes),
  };
}

export function enrichForExport(project, inventory) {
  const normalized = normalizeProject(project);
  const catalog = normalizeInventory(inventory);
  const catalogIds = new Set(catalog.map(filament => filament.id));
  return {
    ...structuredClone(normalized),
    palette: structuredClone(getPalette(normalized, catalog)),
    paletteMissingIds: [...new Set(normalized.paletteIds.filter(id => !catalogIds.has(id)))],
  };
}

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

export function hexToRgb(hex) {
  const value = String(hex).replace('#', '');
  const full = value.length === 3 ? value.split('').map(char => char + char).join('') : value.padEnd(6, '0');
  return [parseInt(full.slice(0,2), 16), parseInt(full.slice(2,4), 16), parseInt(full.slice(4,6), 16)];
}
