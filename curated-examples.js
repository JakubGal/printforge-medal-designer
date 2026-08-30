import { createTemplateProject, normalizeProject } from './project-model.js';

/**
 * Original, legally safe showcase medals built entirely from MedalForge's
 * editable text, shape, and path primitives. No online artwork or geometry is
 * embedded here. Element and group IDs are stable so these designs can also
 * serve as deterministic visual-regression fixtures.
 */

const FIXTURE_TIME = '2026-08-29T00:00:00.000Z';

const CURATED_EXAMPLE_DEFINITIONS = {
  'summit-trail-21k': {
    id: 'summit-trail-21k',
    template: 'curated-summit-trail-21k',
    name: 'Summit Trail 21K · 2027',
    label: 'Summit Trail 21K',
    description: 'A layered alpine race medal with an editable route, runner, mountains, and flush elevation-profile back.',
    preview: '21K',
    className: 'summit-trail',
    bodyShape: 'hexagon',
    rimStyle: 'laurel',
    attachmentStyle: 'single',
    paletteRoles: ['body · midnight', 'snow & type · natural white', 'route · signal lime', 'edge & sun · silk gold', 'mountains · graphite'],
    features: ['three front relief heights', 'original trail-runner vector', 'editable route line', 'flat two-color back'],
    acceptanceCriteria: [
      'Mountain, route, athlete, and 21K remain distinguishable at gallery-thumbnail size.',
      'Every graphic and text run is independently selectable and recolorable.',
      'Laurel edge and external ribbon bar remain connected and support-free.',
      'All reverse-side graphics are flat color inlays in the build-plate layer.',
    ],
  },
  'podium-classic': {
    id: 'podium-classic',
    template: 'curated-podium-classic',
    name: 'Podium Classic · 1st Place',
    label: 'Podium Classic',
    description: 'A restrained podium family seed with an editable rank, original trophy, dimensional wreath, and participant back.',
    preview: '01',
    className: 'podium-classic',
    bodyShape: 'circle',
    rimStyle: 'double',
    attachmentStyle: 'eyelet',
    paletteRoles: ['body · midnight', 'award · silk gold', 'type · natural white', 'secondary · graphite'],
    features: ['editable rank', 'procedural laurel leaves', 'original trophy path', 'flat personalized back'],
    acceptanceCriteria: [
      'Changing the rank text and award color creates a coordinated first, second, or third-place variant.',
      'The oversized numeral remains robust with a 0.8 mm nozzle profile.',
      'No laurel leaf is detached from the visual cluster or narrower than a normal extrusion.',
      'Reverse name and event fields are flush color inlays, never unsupported relief.',
    ],
  },
  'honey-run': {
    id: 'honey-run',
    template: 'curated-honey-run',
    name: 'Honey Run · 10K',
    label: 'Honey Run',
    description: 'A friendly geometric race medal with an original detailed bee, honeycomb field, and support-free internal ribbon slit.',
    preview: '10K',
    className: 'honey-run',
    bodyShape: 'scalloped',
    rimStyle: 'scalloped',
    attachmentStyle: 'slit',
    paletteRoles: ['body & honey · silk gold', 'bee & edge · midnight', 'wings & type · natural white', 'course accent · signal lime'],
    features: ['original layered bee', 'editable honeycomb cells', 'scalloped edge', 'flat sponsor back'],
    acceptanceCriteria: [
      'The bee reads clearly at 45 mm overall size and uses only original closed vectors.',
      'Honeycomb walls satisfy the active nozzle-width rule and contain no detached islands.',
      'Every bee, cell, label, and color region remains independently editable.',
      'The reverse honeycomb and sponsor field stay flush with the back face.',
    ],
  },
  'junior-champion': {
    id: 'junior-champion',
    template: 'curated-junior-champion',
    name: 'Junior Champion · 2027',
    label: 'Junior Champion',
    description: 'A cheerful name-ready rosette medal that remains attractive in one color and vivid in five.',
    preview: '★',
    className: 'junior-champion',
    bodyShape: 'scalloped',
    rimStyle: 'classic',
    attachmentStyle: 'eyelet',
    paletteRoles: ['body · electric blue', 'type · natural white', 'achievement · signal lime', 'energy accent · signal red', 'edge & star · silk gold'],
    features: ['large editable name field', 'layered shooting star', 'scalloped rosette edge', 'flat keepsake back'],
    acceptanceCriteria: [
      'A novice can finish the medal by editing only name, event, year, and palette.',
      'Name and champion text are legible without stretching glyphs.',
      'Star points, rays, and rosette edge pass the active nozzle-width rules.',
      'The medal preserves its hierarchy in a tested single-color fallback.',
    ],
  },
};

export const CURATED_EXAMPLE_INFO = Object.freeze(
  Object.fromEntries(Object.entries(CURATED_EXAMPLE_DEFINITIONS).map(([key, value]) => [key, Object.freeze({ ...value })])),
);

export const CURATED_EXAMPLE_KEYS = Object.freeze(Object.keys(CURATED_EXAMPLE_INFO));

function stableToken(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'item';
}

function stableId(projectKey, kind, name) {
  return `${stableToken(projectKey)}-${stableToken(kind)}-${stableToken(name)}`;
}

function textElement(projectKey, name, value, x, y, fontSize, color, options = {}) {
  return {
    id: stableId(projectKey, 'text', name),
    type: 'text',
    name,
    text: value,
    x,
    y,
    fontSize,
    fontFamily: options.fontFamily || 'Arial',
    weight: options.weight || 900,
    rotation: options.rotation || 0,
    scaleX: options.scaleX || 1,
    scaleY: options.scaleY || 1,
    lockAspect: options.lockAspect !== false,
    face: options.face === 'back' ? 'back' : 'front',
    color,
    operation: options.operation || (options.face === 'back' ? 'inlay' : 'raise'),
    zHeight: options.zHeight ?? .6,
    zDepth: options.zDepth ?? .2,
    inlayHeight: options.inlayHeight || 0,
    layerSnap: true,
    combine: options.combine === 'stack' ? 'stack' : 'replace',
    groupId: options.groupId || null,
    hidden: false,
    locked: Boolean(options.locked),
  };
}

function shapeElement(projectKey, name, shape, x, y, size, color, options = {}) {
  return {
    id: stableId(projectKey, 'shape', name),
    type: 'shape',
    name,
    shape,
    x,
    y,
    size,
    color,
    rotation: options.rotation || 0,
    scaleX: options.scaleX || 1,
    scaleY: options.scaleY || 1,
    lockAspect: options.lockAspect !== false,
    face: options.face === 'back' ? 'back' : 'front',
    operation: options.operation || (options.face === 'back' ? 'inlay' : 'raise'),
    zHeight: options.zHeight ?? .6,
    zDepth: options.zDepth ?? .2,
    inlayHeight: options.inlayHeight || 0,
    layerSnap: true,
    combine: options.combine === 'stack' ? 'stack' : 'replace',
    groupId: options.groupId || null,
    hidden: false,
    locked: Boolean(options.locked),
  };
}

function pathElement(projectKey, name, points, x, y, color, options = {}) {
  return {
    id: stableId(projectKey, 'path', name),
    type: 'path',
    name,
    points: points.map(point => [Number(point[0]) || 0, Number(point[1]) || 0]),
    x,
    y,
    scale: options.scale || 1,
    scaleX: options.scaleX || 1,
    scaleY: options.scaleY || 1,
    lockAspect: options.lockAspect !== false,
    face: options.face === 'back' ? 'back' : 'front',
    closed: options.closed !== false,
    strokeWidth: options.strokeWidth || .9,
    rotation: options.rotation || 0,
    color,
    operation: options.operation || (options.face === 'back' ? 'inlay' : 'raise'),
    zHeight: options.zHeight ?? .6,
    zDepth: options.zDepth ?? .2,
    inlayHeight: options.inlayHeight || 0,
    layerSnap: true,
    combine: options.combine === 'stack' ? 'stack' : 'replace',
    groupId: options.groupId || null,
    hidden: false,
    locked: Boolean(options.locked),
  };
}

function group(projectKey, key, name) {
  return { id: `${stableToken(projectKey)}-${stableToken(key)}`, name };
}

function circlePoints(radius, count = 48, phase = -Math.PI / 2) {
  return Array.from({ length: count }, (_, index) => {
    const angle = phase + index * Math.PI * 2 / count;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

function leafPoints(centerX, centerY, length, width, angle, count = 16) {
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const phase = index * Math.PI * 2 / count;
    const localX = Math.cos(phase) * length / 2;
    const localY = Math.sin(phase) * width / 2 * (.82 + .18 * Math.cos(phase));
    const cos = Math.cos(angle), sin = Math.sin(angle);
    points.push([centerX + localX * cos - localY * sin, centerY + localX * sin + localY * cos]);
  }
  return points;
}

function hexCellPoints(radius = 4.5) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 6 + index * Math.PI / 3;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

function rayPoints(length = 11, width = 2.2) {
  return [[0, -width / 2], [length * .75, -width / 2], [length, 0], [length * .75, width / 2], [0, width / 2]];
}

function finalizeProject(key, project, paletteRoles) {
  const normalized = normalizeProject({
    ...project,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    source: 'medalforge-curated-original-v1',
    curatedExample: {
      id: key,
      originalArtwork: true,
      deterministicIds: true,
      license: 'Project-owned original composition; no third-party artwork embedded',
    },
    paletteRoles: [...paletteRoles],
  });
  normalized.createdAt = FIXTURE_TIME;
  normalized.updatedAt = FIXTURE_TIME;
  return normalized;
}

const TRAIL_RUNNER_BODY = [
  [-2.8,-7.8],[-.7,-8.8],[1.7,-8.1],[2.9,-6.2],[2.8,-4.2],[5.4,-2.6],[9.2,-1.4],[10.1,.2],[8.7,1.8],[5.2,.3],
  [3.1,-.5],[2.2,2.2],[5.4,5.4],[9.4,8.3],[9.1,10.1],[7.1,10.8],[2.1,7.4],[-.1,5.6],[-2.8,8.3],[-7.5,10.2],
  [-9.2,8.8],[-8.4,7],[-4.3,3],[-2.8,.8],[-4.7,-.9],[-8.9,.4],[-10.2,-1.1],[-9.2,-3],[-4.7,-4.3],[-2.9,-5.7],
];

const TROPHY_CUP = [
  [-10,-8],[10,-8],[9.3,-3.5],[8,-.2],[5.7,2.8],[2.7,4.2],[2.2,8],[7.4,8],[7.4,11],[-7.4,11],[-7.4,8],[-2.2,8],[-2.7,4.2],[-5.7,2.8],[-8,-.2],[-9.3,-3.5],
];

const BEE_WING = [
  [0,0],[1.8,-3.6],[5.2,-6.5],[9.2,-7.1],[12,-5.3],[12.4,-2.1],[10.5,.7],[7.1,2.1],[3.4,1.8],
];

const BEE_BODY = [
  [0,-8.5],[3.6,-7.7],[6.2,-5.2],[7.4,-1.8],[7.1,2.5],[5.2,6.1],[2.2,8.8],[0,10.5],[-2.2,8.8],[-5.2,6.1],[-7.1,2.5],[-7.4,-1.8],[-6.2,-5.2],[-3.6,-7.7],
];

export function createSummitTrail21KExample() {
  const key = 'summit-trail-21k';
  const info = CURATED_EXAMPLE_INFO[key];
  const project = createTemplateProject('blank');
  const frontLandscape = group(key, 'front-landscape', 'Front · alpine landscape');
  const frontAthlete = group(key, 'front-athlete', 'Front · trail runner');
  const frontType = group(key, 'front-type', 'Front · editable event text');
  const backProfile = group(key, 'back-profile', 'Back · flat elevation profile');
  const backType = group(key, 'back-type', 'Back · flat editable details');
  const mountainFar = [[-25,8],[-22,1],[-18,4],[-13,-8],[-8,-1],[-1,-16],[6,-4],[12,-10],[18,0],[22,-4],[25,8],[25,12],[-25,12]];
  const mountainNear = [[-25,12],[-21,5],[-16,8],[-8,-4],[-2,4],[6,-7],[13,5],[20,-1],[25,11],[25,15],[-25,15]];
  const snowCaps = [[-18,-2],[-14,-8],[-8,-1],[-1,-16],[6,-4],[2,-6],[-1,-10],[-5,-2],[-9,1],[-13,-3]];
  const ridgeLine = Array.from({ length: 41 }, (_, index) => {
    const x = -25 + index * 1.25;
    return [x, 4 + Math.sin(index * .55) * 1.1 + Math.sin(index * .19) * 1.6];
  });
  const routeLine = [[-25,16],[-20,14],[-16,11],[-12,12],[-9,8],[-5,9],[-2,5],[2,7],[6,3],[10,5],[14,1],[19,3],[24,-1]];
  const contourTop = Array.from({ length: 46 }, (_, index) => [-26 + index * 1.15, -14 + Math.sin(index * .42) * 1.4]);
  const elevation = [[-24,8],[-20,6],[-17,7],[-14,2],[-11,4],[-8,-2],[-5,1],[-2,-7],[1,-3],[4,-10],[8,-5],[11,-7],[15,-1],[18,-2],[22,5],[25,3]];
  const tree = [[0,-5],[2,-1],[.8,-1],[3,3],[1.2,3],[4,8],[-4,8],[-1.2,3],[-3,3],[-.8,-1],[-2,-1]];
  project.name = info.name;
  project.template = info.template;
  project.profile = { nozzle: .4, layerHeight: .16, hardened: false, colorSystem: 'multicolor', meshQuality: 'ultra' };
  project.medal = {
    ...project.medal,
    shape: 'hexagon', diameter: 76, width: 74, height: 78, baseThickness: 2.88, baseColor: 0,
    minimumFloor: 1.4, defaultHeight: .6, reliefHeight: .6, rimStyle: 'laurel', rimWidth: 3.1,
    rimHeight: .64, rimColor: 3, edgeInset: .8, loopStyle: 'single', loopWidth: 38,
    loopHeight: 9, slotWidth: 31, slotHeight: 4,
  };
  project.paletteIds = ['midnight-black', 'natural-white', 'signal-lime', 'silk-gold', 'graphite-gray'];
  project.groups = [frontLandscape, frontAthlete, frontType, backProfile, backType];
  project.elements = [
    shapeElement(key, 'Rising sun', 'circle', -16, -7, 13, 3, { zHeight: .32, groupId: frontLandscape.id }),
    pathElement(key, 'Far mountain range', mountainFar, 0, 0, 4, { zHeight: .32, groupId: frontLandscape.id }),
    pathElement(key, 'Near mountain range', mountainNear, 0, 0, 0, { zHeight: .48, groupId: frontLandscape.id }),
    pathElement(key, 'Snow caps', snowCaps, 0, 0, 1, { zHeight: .64, groupId: frontLandscape.id }),
    pathElement(key, 'High contour', contourTop, 0, 0, 4, { closed: false, strokeWidth: .9, zHeight: .48, groupId: frontLandscape.id }),
    pathElement(key, 'Ridge contour', ridgeLine, 0, 0, 1, { closed: false, strokeWidth: .9, zHeight: .64, groupId: frontLandscape.id }),
    pathElement(key, 'Signal trail', routeLine, 0, 0, 2, { closed: false, strokeWidth: 1.5, zHeight: .8, groupId: frontLandscape.id }),
    ...[-24, -18, 19, 25].map((x, index) => pathElement(key, `Pine tree ${index + 1}`, tree, x, 10 + (index % 2) * 3, index % 2 ? 4 : 1, { scale: index % 2 ? .62 : .76, zHeight: .64, groupId: frontLandscape.id })),
    pathElement(key, 'Trail runner body', TRAIL_RUNNER_BODY, 8, 3, 1, { scale: .82, zHeight: .96, groupId: frontAthlete.id }),
    shapeElement(key, 'Trail runner head', 'circle', 9.9, -7.1, 4.3, 1, { zHeight: .96, groupId: frontAthlete.id }),
    pathElement(key, 'Runner bib plate', [[-2.7,-1.9],[2.7,-1.9],[2.7,1.9],[-2.7,1.9]], 8.6, -1, 3, { zHeight: 1.12, groupId: frontAthlete.id }),
    textElement(key, 'Runner bib number', '21', 8.6, -1, 3.1, 0, { zHeight: 1.28, groupId: frontAthlete.id }),
    textElement(key, 'Event title', 'SUMMIT TRAIL', 0, -19.5, 4.2, 1, { zHeight: .64, groupId: frontType.id }),
    textElement(key, 'Distance', '21K', -2, 19.8, 8.6, 3, { zHeight: .8, groupId: frontType.id }),
    textElement(key, 'Race date', '12 · 06 · 27', -1, 26.2, 3, 1, { zHeight: .64, groupId: frontType.id }),
    pathElement(key, 'Back elevation profile', elevation, 0, 0, 2, { face: 'back', closed: false, strokeWidth: 1.6, groupId: backProfile.id }),
    pathElement(key, 'Back baseline', [[-25,0],[25,0]], 0, 11, 4, { face: 'back', closed: false, strokeWidth: .8, groupId: backProfile.id }),
    ...[-24,-12,0,12,24].map((x, index) => pathElement(key, `Back elevation tick ${index + 1}`, [[0,-1.6],[0,1.6]], x, 11, 4, { face: 'back', closed: false, strokeWidth: .7, groupId: backProfile.id })),
    shapeElement(key, 'Back summit marker', 'diamond', 4, -10, 4.5, 3, { face: 'back', groupId: backProfile.id }),
    textElement(key, 'Back event name', 'SUMMIT TRAIL', 0, -20, 4.2, 1, { face: 'back', groupId: backType.id }),
    textElement(key, 'Back elevation', '1 428 m', 0, 17.5, 5.1, 3, { face: 'back', groupId: backType.id }),
    textElement(key, 'Back finisher', 'FINISHER · 21K', 0, 23.2, 3.2, 1, { face: 'back', groupId: backType.id }),
  ];
  return finalizeProject(key, project, info.paletteRoles);
}

export function createPodiumClassicExample() {
  const key = 'podium-classic';
  const info = CURATED_EXAMPLE_INFO[key];
  const project = createTemplateProject('blank');
  const frontWreath = group(key, 'front-wreath', 'Front · procedural victory wreath');
  const frontAward = group(key, 'front-award', 'Front · rank & trophy');
  const frontType = group(key, 'front-type', 'Front · editable event text');
  const backPersonal = group(key, 'back-personal', 'Back · flat participant details');
  project.name = info.name;
  project.template = info.template;
  project.profile = { nozzle: .4, layerHeight: .2, hardened: false, colorSystem: 'multicolor', meshQuality: 'ultra' };
  project.medal = {
    ...project.medal,
    shape: 'circle', diameter: 68, width: 68, height: 68, baseThickness: 2.8, baseColor: 0,
    minimumFloor: 1.4, defaultHeight: .6, reliefHeight: .6, rimStyle: 'double', rimWidth: 2.2,
    rimHeight: .6, rimColor: 1, edgeInset: .7, loopStyle: 'eyelet', holeDiameter: 6,
    attachmentInset: 3.8,
  };
  project.paletteIds = ['midnight-black', 'silk-gold', 'natural-white', 'graphite-gray'];
  project.groups = [frontWreath, frontAward, frontType, backPersonal];
  const wreathLeaves = [];
  for (const side of [-1, 1]) {
    for (let index = 0; index < 9; index += 1) {
      const angle = -1.2 + index * .17;
      const cx = side * (18.5 + Math.sin(index * .34) * 4.2);
      const cy = 17 - index * 4.2;
      const rotation = side < 0 ? angle : Math.PI - angle;
      wreathLeaves.push(pathElement(key, `${side < 0 ? 'Left' : 'Right'} laurel leaf ${index + 1}`, leafPoints(0, 0, 9.2, 4.2, rotation), cx, cy, 1, { zHeight: .6, groupId: frontWreath.id }));
    }
  }
  project.elements = [
    pathElement(key, 'Left laurel stem', [[-6,24],[-11,18],[-15,10],[-18,0],[-17,-10]], 0, 0, 3, { closed: false, strokeWidth: 1.1, zHeight: .4, groupId: frontWreath.id }),
    pathElement(key, 'Right laurel stem', [[6,24],[11,18],[15,10],[18,0],[17,-10]], 0, 0, 3, { closed: false, strokeWidth: 1.1, zHeight: .4, groupId: frontWreath.id }),
    ...wreathLeaves,
    pathElement(key, 'Original trophy cup', TROPHY_CUP, 0, 3.5, 3, { scale: .66, zHeight: .4, groupId: frontAward.id }),
    textElement(key, 'Place numeral', '1', 0, 1.5, 23, 1, { zHeight: 1, groupId: frontAward.id }),
    shapeElement(key, 'Place star', 'star', 0, 16.3, 7.5, 2, { zHeight: .8, groupId: frontAward.id }),
    textElement(key, 'Event title', 'PODIUM CLASSIC', 0, -20.8, 4.2, 2, { zHeight: .6, groupId: frontType.id }),
    textElement(key, 'Place label', 'FIRST PLACE', 0, 24.5, 3.6, 2, { zHeight: .6, groupId: frontType.id }),
    textElement(key, 'Event year', '2027', 0, 29.1, 3, 3, { zHeight: .4, groupId: frontType.id }),
    pathElement(key, 'Back name plate', [[-24,-5],[24,-5],[24,5],[-24,5]], 0, 1, 2, { face: 'back', groupId: backPersonal.id }),
    textElement(key, 'Back participant name', 'PARTICIPANT NAME', 0, 1, 4.1, 0, { face: 'back', groupId: backPersonal.id }),
    textElement(key, 'Back event title', 'PODIUM CLASSIC', 0, -16.8, 4.5, 1, { face: 'back', groupId: backPersonal.id }),
    textElement(key, 'Back event detail', 'OPEN SERIES · 2027', 0, -10.4, 3.3, 2, { face: 'back', groupId: backPersonal.id }),
    pathElement(key, 'Back separator', [[-20,0],[20,0]], 0, 11.5, 1, { face: 'back', closed: false, strokeWidth: .8, groupId: backPersonal.id }),
    textElement(key, 'Back result', 'RESULT  ·  00:00:00', 0, 17.2, 3.1, 2, { face: 'back', groupId: backPersonal.id }),
    textElement(key, 'Back keepsake', 'ONE MOMENT', 0, 23.5, 3.4, 3, { face: 'back', groupId: backPersonal.id }),
  ];
  return finalizeProject(key, project, info.paletteRoles);
}

export function createHoneyRunExample() {
  const key = 'honey-run';
  const info = CURATED_EXAMPLE_INFO[key];
  const project = createTemplateProject('blank');
  const frontCells = group(key, 'front-cells', 'Front · honeycomb field');
  const frontBee = group(key, 'front-bee', 'Front · original layered bee');
  const frontType = group(key, 'front-type', 'Front · editable race type');
  const back = group(key, 'back', 'Back · flat sponsor honeycomb');
  project.name = info.name;
  project.template = info.template;
  project.profile = { nozzle: .4, layerHeight: .16, hardened: false, colorSystem: 'multicolor', meshQuality: 'ultra' };
  project.medal = {
    ...project.medal,
    shape: 'scalloped', diameter: 72, width: 70, height: 76, baseThickness: 2.88, baseColor: 0,
    minimumFloor: 1.4, defaultHeight: .6, reliefHeight: .6, rimStyle: 'scalloped', rimWidth: 2.2,
    rimHeight: .64, rimColor: 1, edgeInset: .8, loopStyle: 'slit', slitWidth: 25,
    slitHeight: 3.4, attachmentInset: 10,
  };
  project.paletteIds = ['silk-gold', 'midnight-black', 'natural-white', 'signal-lime'];
  project.groups = [frontCells, frontBee, frontType, back];
  const cellPositions = [[-20,-9],[-12,-16],[-4,-9],[4,-16],[12,-9],[20,-16],[-20,11],[-12,18],[12,18],[20,11]];
  const cells = cellPositions.map(([x, y], index) => pathElement(key, `Honeycomb cell ${index + 1}`, hexCellPoints(index % 3 === 0 ? 5.2 : 4.4), x, y, index % 4 === 0 ? 3 : 2, { zHeight: index % 4 === 0 ? .55 : .35, groupId: frontCells.id }));
  const wingLeft = BEE_WING.map(([x, y]) => [-x, y]);
  const stripeYs = [-2.5, 1.8, 5.4];
  project.elements = [
    ...cells,
    pathElement(key, 'Bee left wing', wingLeft, -2.1, -1.5, 2, { zHeight: .48, groupId: frontBee.id }),
    pathElement(key, 'Bee right wing', BEE_WING, 2.1, -1.5, 2, { zHeight: .48, groupId: frontBee.id }),
    pathElement(key, 'Bee body', BEE_BODY, 0, 3.2, 1, { zHeight: .8, groupId: frontBee.id }),
    shapeElement(key, 'Bee head', 'circle', 0, -7.2, 10.5, 1, { zHeight: .8, groupId: frontBee.id }),
    ...stripeYs.map((y, index) => pathElement(key, `Bee gold stripe ${index + 1}`, [[-5.9,-1.8],[5.9,-1.8],[5.9,1.8],[-5.9,1.8]], 0, y + 3.2, 0, { zHeight: .96, groupId: frontBee.id })),
    shapeElement(key, 'Bee left eye', 'circle', -1.9, -8.2, 2.2, 2, { zHeight: .96, groupId: frontBee.id }),
    shapeElement(key, 'Bee right eye', 'circle', 1.9, -8.2, 2.2, 2, { zHeight: .96, groupId: frontBee.id }),
    pathElement(key, 'Bee left antenna', [[0,0],[-2.2,-2.4],[-4.5,-3.2]], -1.5, -10.4, 1, { closed: false, strokeWidth: .9, zHeight: .96, groupId: frontBee.id }),
    pathElement(key, 'Bee right antenna', [[0,0],[2.2,-2.4],[4.5,-3.2]], 1.5, -10.4, 1, { closed: false, strokeWidth: .9, zHeight: .96, groupId: frontBee.id }),
    pathElement(key, 'Bee left speed line', [[-8,0],[-2,0],[2,-.5]], -15, 5, 3, { closed: false, strokeWidth: 1, zHeight: .64, groupId: frontBee.id }),
    pathElement(key, 'Bee right speed line', [[-2,-.5],[2,0],[8,0]], 15, 8, 3, { closed: false, strokeWidth: 1, zHeight: .64, groupId: frontBee.id }),
    textElement(key, 'Event title', 'HONEY RUN', 0, -20.5, 4.8, 1, { zHeight: .8, groupId: frontType.id }),
    textElement(key, 'Distance', '10K', 0, 21.5, 8.5, 1, { zHeight: .8, groupId: frontType.id }),
    textElement(key, 'Race date', '20 · 06 · 27', 0, 26.5, 3, 2, { zHeight: .48, groupId: frontType.id }),
    ...[[-16,-7],[-8,0],[0,-7],[8,0],[16,-7]].map(([x,y], index) => pathElement(key, `Back honeycomb cell ${index + 1}`, hexCellPoints(5), x, y, index === 2 ? 3 : 1, { face: 'back', groupId: back.id })),
    textElement(key, 'Back finisher', 'FINISHER', 0, -21, 5.6, 2, { face: 'back', groupId: back.id }),
    textElement(key, 'Back event', 'HONEY RUN · 10K', 0, 13.5, 4.1, 1, { face: 'back', groupId: back.id }),
    pathElement(key, 'Back sponsor plate', [[-13,-4],[13,-4],[13,4],[-13,4]], 0, 22, 2, { face: 'back', groupId: back.id }),
    textElement(key, 'Back sponsor', 'YOUR CLUB', 0, 22, 3.4, 0, { face: 'back', groupId: back.id }),
  ];
  return finalizeProject(key, project, info.paletteRoles);
}

export function createJuniorChampionExample() {
  const key = 'junior-champion';
  const info = CURATED_EXAMPLE_INFO[key];
  const project = createTemplateProject('blank');
  const frontStar = group(key, 'front-star', 'Front · layered shooting star');
  const frontType = group(key, 'front-type', 'Front · editable name & title');
  const frontConfetti = group(key, 'front-confetti', 'Front · printable confetti');
  const back = group(key, 'back', 'Back · flat keepsake panel');
  project.name = info.name;
  project.template = info.template;
  project.profile = { nozzle: .4, layerHeight: .2, hardened: false, colorSystem: 'multicolor', meshQuality: 'ultra' };
  project.medal = {
    ...project.medal,
    shape: 'scalloped', diameter: 64, width: 64, height: 64, baseThickness: 2.6, baseColor: 0,
    minimumFloor: 1.3, defaultHeight: .6, reliefHeight: .6, rimStyle: 'classic', rimWidth: 2.4,
    rimHeight: .6, rimColor: 4, edgeInset: .7, loopStyle: 'eyelet', holeDiameter: 6,
    attachmentInset: 3.6,
  };
  project.paletteIds = ['electric-blue', 'natural-white', 'signal-lime', 'signal-red', 'silk-gold'];
  project.groups = [frontStar, frontType, frontConfetti, back];
  const rays = [
    { angle: -150, scale: .9, color: 3 }, { angle: -128, scale: .72, color: 2 },
    { angle: -105, scale: .55, color: 1 }, { angle: -82, scale: .42, color: 4 },
  ];
  const confetti = [
    [-19,-13,-18,3],[-16,9,14,2],[18,-12,24,2],[19,7,-10,3],[-17,12,38,4],[16,15,-34,1],
  ];
  project.elements = [
    ...rays.map((ray, index) => pathElement(key, `Shooting star ray ${index + 1}`, rayPoints(13 * ray.scale, 4.2), -2, 1, ray.color, { rotation: ray.angle, zHeight: .4 + index * .2, groupId: frontStar.id })),
    shapeElement(key, 'Champion star underlay', 'star', 2, 0, 25, 1, { rotation: 6, zHeight: .4, groupId: frontStar.id }),
    shapeElement(key, 'Champion star', 'star', 2, 0, 20.5, 4, { rotation: 6, zHeight: .8, groupId: frontStar.id }),
    shapeElement(key, 'Champion star center', 'circle', 2, 0, 7.5, 3, { zHeight: 1, groupId: frontStar.id }),
    textElement(key, 'Junior title', 'JUNIOR', 0, -21.5, 6, 1, { zHeight: .7, groupId: frontType.id }),
    textElement(key, 'Champion title', 'CHAMPION', 0, 16.5, 5.4, 2, { zHeight: .8, groupId: frontType.id }),
    textElement(key, 'Participant name', 'ALEX', 0, 22.5, 5.8, 1, { zHeight: .8, groupId: frontType.id }),
    textElement(key, 'Event year', '2027', 0, -15.4, 3.2, 4, { zHeight: .6, groupId: frontType.id }),
    ...confetti.map(([x,y,rotation,color], index) => pathElement(key, `Confetti ${index + 1}`, [[-2,-1.8],[2,-1.8],[2,1.8],[-2,1.8]], x, y, color, { rotation, zHeight: .6, groupId: frontConfetti.id })),
    pathElement(key, 'Back keepsake field', circlePoints(22, 64), 0, 1, 1, { face: 'back', groupId: back.id }),
    pathElement(key, 'Back inner field', circlePoints(19.5, 64), 0, 1, 0, { face: 'back', groupId: back.id }),
    shapeElement(key, 'Back star', 'star', 0, -12, 10, 4, { face: 'back', groupId: back.id }),
    textElement(key, 'Back participant name', 'ALEX', 0, 1, 7.2, 1, { face: 'back', groupId: back.id }),
    textElement(key, 'Back achievement', 'YOU DID IT!', 0, 10, 4.2, 2, { face: 'back', groupId: back.id }),
    textElement(key, 'Back event date', 'SPORT DAY · 2027', 0, 18, 3.2, 4, { face: 'back', groupId: back.id }),
  ];
  return finalizeProject(key, project, info.paletteRoles);
}

export const CURATED_EXAMPLE_BUILDERS = Object.freeze({
  'summit-trail-21k': createSummitTrail21KExample,
  'podium-classic': createPodiumClassicExample,
  'honey-run': createHoneyRunExample,
  'junior-champion': createJuniorChampionExample,
});

export function createCuratedExample(key) {
  const builder = CURATED_EXAMPLE_BUILDERS[key];
  if (!builder) throw new RangeError(`Unknown curated example: ${key}`);
  return builder();
}

export function listCuratedExamples() {
  return CURATED_EXAMPLE_KEYS.map(key => ({ ...CURATED_EXAMPLE_INFO[key], paletteRoles: [...CURATED_EXAMPLE_INFO[key].paletteRoles], features: [...CURATED_EXAMPLE_INFO[key].features], acceptanceCriteria: [...CURATED_EXAMPLE_INFO[key].acceptanceCriteria] }));
}
