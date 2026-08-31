const CATEGORY_ORDER = Object.freeze(['Essentials', 'Runners', 'Mountains', 'Race day']);

const RAW_CATALOG = [
  ['circle', 'Circle', 'Essentials', 'A clean round building block.', .22, .79],
  ['square', 'Square', 'Essentials', 'A softly rounded square.', .22, .92],
  ['triangle', 'Triangle', 'Essentials', 'A balanced triangular marker.', .22, .50],
  ['diamond', 'Diamond', 'Essentials', 'A crisp four-point diamond.', .22, .50],
  ['star', 'Star', 'Essentials', 'A bold five-point award star.', .12, .34],
  ['hexagon', 'Hexagon', 'Essentials', 'A regular printable hexagon.', .22, .65],
  ['bolt', 'Lightning bolt', 'Essentials', 'A strong angular energy symbol.', .12, .40],
  ['heart', 'Heart', 'Essentials', 'A smooth, friendly heart.', .16, .62],
  ['runner', 'Runner', 'Runners', 'A high-detail all-purpose running silhouette.', .055, .29],
  ['runner-male', 'Male runner', 'Runners', 'An athletic male runner in a long-stride pose.', .055, .30],
  ['runner-female', 'Female runner', 'Runners', 'A ponytailed female runner with a natural race stride.', .05, .28],
  ['runner-sprint', 'Sprinter', 'Runners', 'A forward-driving sprint silhouette.', .055, .30],
  ['runner-trail', 'Trail runner', 'Runners', 'An uphill trail runner with a compact hydration-pack contour.', .055, .32],
  ['mountain', 'Classic mountain', 'Mountains', 'A smoother replacement for the original mountain symbol.', .15, .53],
  ['mountain-alpine', 'Alpine ridge', 'Mountains', 'A dramatic asymmetric high-alpine skyline.', .15, .47],
  ['mountain-range', 'Mountain range', 'Mountains', 'Five varied peaks for panoramic race artwork.', .14, .52],
  ['mountain-snowcap', 'Snow summit', 'Mountains', 'A summit and substantial snow cap with a bold printable seam.', .12, .49],
  ['mountain-layered', 'Layered range', 'Mountains', 'Three bold landscape bands for dimensional color layouts.', .12, .43],
  ['mountain-trail', 'Trail to summit', 'Mountains', 'A mountain divided by a wide printable switchback route.', .10, .44],
  ['mountain-sunrise', 'Mountain sunrise', 'Mountains', 'A rising sun framed by a smooth mountain ridge.', .14, .48],
  ['flag', 'Finish flag', 'Race day', 'A simple finish-line flag.', .12, .37],
  ['trophy', 'Trophy', 'Race day', 'A classic winner trophy.', .12, .42],
];

export const SHAPE_CATEGORIES = CATEGORY_ORDER;
export const SHAPE_CATALOG = Object.freeze(RAW_CATALOG.map(([id, label, category, description, minimumFeatureRatio, fillRatio]) => Object.freeze({
  id, label, category, description, minimumFeatureRatio, fillRatio,
})));
export const SUPPORTED_SHAPES = Object.freeze(SHAPE_CATALOG.map(shape => shape.id));

const SHAPE_INFO = new Map(SHAPE_CATALOG.map(shape => [shape.id, shape]));

export function shapeInfo(requestedKind) {
  return SHAPE_INFO.get(requestedKind) || SHAPE_INFO.get('hexagon');
}

export function shapeMinimumFeatureRatio(requestedKind) {
  return shapeInfo(requestedKind).minimumFeatureRatio;
}

function smoothClosedPath(points, iterations = 3) {
  let result = points.map(point => [...point]);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    result = result.flatMap((point, index) => {
      const next = result[(index + 1) % result.length];
      return [
        [point[0] * .75 + next[0] * .25, point[1] * .75 + next[1] * .25],
        [point[0] * .25 + next[0] * .75, point[1] * .25 + next[1] * .75],
      ];
    });
  }
  return result;
}

const polygon = points => ({ type: 'polygon', points });
const smoothPolygon = (points, iterations = 3) => polygon(smoothClosedPath(points, iterations));
const circle = (cx, cy, radius) => ({ type: 'circle', cx, cy, radius });
const rect = (x, y, width, height, radius = 0) => ({ type: radius ? 'roundRect' : 'rect', x, y, width, height, radius });
const path = commands => ({ type: 'path', commands });

const starPoints = Array.from({ length: 10 }, (_, index) => {
  const radius = index % 2 ? .22 : .5;
  const angle = -Math.PI / 2 + index * Math.PI / 5;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
});
const hexagonPoints = Array.from({ length: 6 }, (_, index) => {
  const angle = -Math.PI / 2 + index * Math.PI / 3;
  return [Math.cos(angle) * .5, Math.sin(angle) * .5];
});

// Each athlete is one coherent outer silhouette. Three Chaikin passes turn the
// authored pose into 224–296 smooth, resolution-independent boundary points.
const maleRunnerBody = smoothPolygon([
  [-.1222,-.2703],[-.0167,-.2919],[.0833,-.2378],[.1167,-.1351],[.2444,-.0595],[.4333,.0649],[.3722,.1459],[.1778,.0541],[.0944,.0324],[.0667,.1351],
  [.1667,.2541],[.4167,.4054],[.3556,.4973],[.2611,.4703],[.0222,.3351],[-.0556,.2811],[-.1611,.3514],[-.35,.4811],[-.4111,.4054],[-.3611,.3189],
  [-.1889,.1514],[-.15,.0649],[-.2444,.0378],[-.3889,.1243],[-.4444,.0378],[-.3611,-.0378],[-.1944,-.0432],[-.1444,-.1297],
]);

const femaleRunnerBody = smoothPolygon([
  [-.11,-.265],[-.015,-.287],[.068,-.235],[.102,-.132],[.225,-.054],[.405,.07],[.35,.143],[.165,.039],[.083,.027],[.058,.13],
  [.15,.245],[.39,.406],[.33,.493],[.24,.461],[.013,.326],[-.06,.274],[-.158,.356],[-.34,.486],[-.407,.411],[-.35,.322],
  [-.17,.142],[-.132,.061],[-.232,.034],[-.39,.13],[-.448,.034],[-.35,-.045],[-.18,-.05],[-.12,-.135],
]);

const sprintRunnerBody = smoothPolygon([
  [.02,-.30],[.10,-.30],[.17,-.25],[.22,-.17],[.34,-.14],[.47,-.12],[.49,-.04],[.43,.01],[.32,-.02],[.19,-.06],
  [.12,-.03],[.08,.08],[.20,.16],[.37,.16],[.46,.21],[.47,.29],[.41,.34],[.29,.32],[.11,.24],[-.01,.20],
  [-.10,.29],[-.19,.45],[-.30,.49],[-.38,.44],[-.34,.36],[-.20,.18],[-.15,.08],[-.26,.06],[-.39,.13],[-.48,.10],
  [-.49,.02],[-.41,-.05],[-.26,-.10],[-.14,-.18],[-.04,-.27],
]);

const trailRunnerBody = smoothPolygon([
  [-.06,-.30],[.03,-.30],[.10,-.24],[.13,-.18],[.22,-.17],[.32,-.22],[.41,-.16],[.39,-.09],[.29,-.09],[.18,-.12],
  [.10,-.08],[.12,.05],[.22,.14],[.34,.11],[.45,.15],[.49,.22],[.45,.29],[.35,.29],[.27,.22],[.10,.22],
  [-.01,.25],[-.12,.36],[-.25,.48],[-.35,.49],[-.41,.43],[-.34,.35],[-.20,.18],[-.11,.08],[-.21,.01],[-.36,.08],
  [-.46,.04],[-.47,-.04],[-.36,-.13],[-.22,-.15],[-.16,-.21],[-.17,-.28],[-.12,-.33],
]);

const heartPath = path([
  ['M', 0, .45], ['C', -.65, 0, -.48, -.48, -.20, -.48], ['C', 0, -.48, 0, -.25, 0, -.14],
  ['C', 0, -.25, 0, -.48, .20, -.48], ['C', .48, -.48, .65, 0, 0, .45], ['Z'],
]);

const classicMountain = path([
  ['M', -.56, .43], ['C', -.49, .30, -.39, .15, -.30, -.04],
  ['L', -.16, -.43], ['Q', -.14, -.50, -.09, -.43], ['L', .04, -.16],
  ['L', .13, -.27], ['L', .20, -.16], ['L', .31, -.43], ['Q', .34, -.49, .38, -.41],
  ['C', .44, -.22, .51, .10, .56, .43], ['Q', 0, .51, -.56, .43], ['Z'],
]);

const alpineMountain = path([
  ['M', -.57, .44], ['C', -.49, .28, -.42, .14, -.35, .03], ['L', -.26, -.12], ['L', -.20, -.07],
  ['L', -.105, -.43], ['Q', -.08, -.52, -.025, -.43], ['L', .095, -.17], ['L', .17, -.27], ['L', .245, -.10],
  ['L', .345, -.40], ['Q', .37, -.48, .415, -.38], ['C', .47, -.18, .52, .10, .57, .44],
  ['C', .28, .49, -.27, .50, -.57, .44], ['Z'],
]);

const mountainRange = path([
  ['M', -.58, .44], ['C', -.54, .31, -.50, .16, -.44, .03], ['L', -.355, -.18], ['Q', -.33, -.24, -.295, -.17],
  ['L', -.215, -.01], ['L', -.11, -.32], ['Q', -.085, -.40, -.04, -.31], ['L', .045, -.12],
  ['L', .145, -.48], ['Q', .17, -.55, .21, -.46], ['L', .30, -.20], ['L', .365, -.31],
  ['Q', .39, -.36, .42, -.29], ['C', .49, -.09, .54, .18, .58, .44], ['C', .30, .50, -.31, .50, -.58, .44], ['Z'],
]);

const snowLower = path([
  ['M', -.56, .45], ['C', -.47, .20, -.37, -.02, -.25, -.20], ['L', -.14, -.11], ['L', -.035, -.21],
  ['L', .07, -.10], ['L', .18, -.22], ['L', .29, -.12], ['C', .41, .08, .51, .27, .56, .45],
  ['C', .26, .50, -.28, .50, -.56, .45], ['Z'],
]);
const snowCap = path([
  ['M', -.25, -.26], ['L', -.06, -.49], ['Q', 0, -.56, .06, -.48], ['L', .29, -.18],
  ['L', .18, -.27], ['L', .07, -.16], ['L', -.035, -.27], ['L', -.14, -.17], ['Z'],
]);

const layeredBack = path([
  ['M', -.56, -.16], ['L', -.03, -.50], ['Q', 0, -.52, .03, -.50], ['L', .56, -.16],
  ['L', .45, -.03], ['L', .03, -.29], ['Q', 0, -.31, -.03, -.29], ['L', -.45, -.03], ['Z'],
]);
const layeredMiddle = path([
  ['M', -.56, .08], ['L', -.03, -.24], ['Q', 0, -.26, .03, -.24], ['L', .56, .08],
  ['L', .45, .21], ['L', .03, -.03], ['Q', 0, -.05, -.03, -.03], ['L', -.45, .21], ['Z'],
]);
const layeredFront = path([
  ['M', -.56, .32], ['L', -.03, .02], ['Q', 0, 0, .03, .02], ['L', .56, .32],
  ['L', .45, .46], ['L', .03, .23], ['Q', 0, .21, -.03, .23], ['L', -.45, .46], ['Z'],
]);

// Two substantial filled halves leave an S-shaped, nozzle-safe route between
// them without relying on fragile strokes or fill-rule holes.
const trailMountainLeft = path([
  ['M', -.57, .45], ['C', -.46, .18, -.34, -.06, -.20, -.28], ['L', -.05, -.50],
  ['C', -.005, -.42, -.04, -.34, -.11, -.27], ['C', -.20, -.17, -.11, -.08, -.04, -.015],
  ['C', .03, .06, -.05, .13, -.13, .20], ['C', -.20, .27, -.10, .35, -.025, .45],
  ['C', -.20, .49, -.40, .49, -.57, .45], ['Z'],
]);
const trailMountainRight = path([
  ['M', .055, -.47], ['C', .14, -.32, .25, -.14, .36, .02], ['C', .47, .18, .54, .32, .57, .45],
  ['C', .41, .49, .21, .49, .055, .45], ['C', -.02, .35, -.12, .26, -.05, .18],
  ['C', .04, .09, .13, .02, .05, -.07], ['C', -.02, -.15, .02, -.26, .10, -.34], ['Z'],
]);

const sunriseRidge = path([
  ['M', -.58, .44], ['C', -.50, .30, -.42, .18, -.33, .08], ['Q', -.28, .02, -.22, .09],
  ['L', -.10, .23], ['C', .00, .10, .09, -.05, .18, -.19], ['Q', .22, -.25, .27, -.18],
  ['C', .39, -.03, .50, .19, .58, .44], ['C', .29, .50, -.29, .50, -.58, .44], ['Z'],
]);

const trophyBowl = path([['M', -.27, -.48], ['L', .27, -.48], ['L', .21, -.03], ['Q', 0, .18, -.21, -.03], ['Z']]);
const trophyLeftHandle = path([
  ['M', -.25, -.37], ['C', -.55, -.35, -.48, .02, -.20, .06], ['L', -.16, -.05],
  ['C', -.33, -.08, -.36, -.25, -.23, -.25], ['Z'],
]);
const trophyRightHandle = path([
  ['M', .25, -.37], ['C', .55, -.35, .48, .02, .20, .06], ['L', .16, -.05],
  ['C', .33, -.08, .36, -.25, .23, -.25], ['Z'],
]);

const GEOMETRY = Object.freeze({
  circle: [circle(0, 0, .5)],
  square: [rect(-.5, -.5, 1, 1, .08)],
  triangle: [polygon([[0, -.52], [.52, .44], [-.52, .44]])],
  diamond: [polygon([[0, -.5], [.5, 0], [0, .5], [-.5, 0]])],
  star: [polygon(starPoints)],
  hexagon: [polygon(hexagonPoints)],
  bolt: [polygon([[-.10, -.55], [.50, -.55], [.15, -.08], [.48, -.08], [-.35, .58], [-.08, .08], [-.45, .08]])],
  heart: [heartPath],
  runner: [circle(.055, -.375, .11), maleRunnerBody],
  'runner-male': [circle(.055, -.375, .11), maleRunnerBody],
  'runner-female': [circle(.035, -.38, .11), smoothPolygon([[-.035,-.445],[-.16,-.455],[-.27,-.38],[-.18,-.33],[-.05,-.35]], 2), femaleRunnerBody],
  'runner-sprint': [circle(.15, -.38, .105), sprintRunnerBody],
  'runner-trail': [circle(0, -.39, .11), smoothPolygon([[-.06,-.47],[.06,-.49],[.22,-.43],[.08,-.40],[-.07,-.42]], 2), trailRunnerBody],
  mountain: [classicMountain],
  'mountain-alpine': [alpineMountain],
  'mountain-range': [mountainRange],
  'mountain-snowcap': [snowLower, snowCap],
  'mountain-layered': [layeredBack, layeredMiddle, layeredFront],
  'mountain-trail': [trailMountainLeft, trailMountainRight],
  'mountain-sunrise': [circle(.25, -.31, .15), sunriseRidge],
  flag: [rect(-.42, -.50, .09, 1), polygon([[-.33, -.44], [.45, -.31], [.19, -.03], [-.33, -.13]])],
  trophy: [trophyBowl, rect(-.06, .08, .12, .26), rect(-.28, .31, .56, .15, .04), trophyLeftHandle, trophyRightHandle],
});

function geometryFor(requestedKind) {
  return GEOMETRY[SHAPE_INFO.has(requestedKind) ? requestedKind : 'hexagon'];
}

function tracePolygon(context, points, size) {
  points.forEach(([x, y], index) => index ? context.lineTo(x * size, y * size) : context.moveTo(x * size, y * size));
  context.closePath();
}

function traceCommands(context, commands, size) {
  for (const command of commands) {
    const [kind, ...values] = command;
    if (kind === 'M') context.moveTo(values[0] * size, values[1] * size);
    else if (kind === 'L') context.lineTo(values[0] * size, values[1] * size);
    else if (kind === 'Q') context.quadraticCurveTo(...values.map(value => value * size));
    else if (kind === 'C') context.bezierCurveTo(...values.map(value => value * size));
    else if (kind === 'Z') context.closePath();
  }
}

function traceComponent(context, component, size) {
  if (component.type === 'polygon') tracePolygon(context, component.points, size);
  else if (component.type === 'circle') {
    context.moveTo((component.cx + component.radius) * size, component.cy * size);
    context.arc(component.cx * size, component.cy * size, component.radius * size, 0, Math.PI * 2);
    context.closePath();
  } else if (component.type === 'rect') {
    context.rect(component.x * size, component.y * size, component.width * size, component.height * size);
  } else if (component.type === 'roundRect') {
    context.roundRect(component.x * size, component.y * size, component.width * size, component.height * size, component.radius * size);
  } else if (component.type === 'path') traceCommands(context, component.commands, size);
}

/** Canonical editor and manufacturing path for every symbol offered by the UI. */
export function traceShapePath(context, requestedKind, requestedSize) {
  const size = Math.max(.01, Number(requestedSize) || 12);
  context.beginPath();
  for (const component of geometryFor(requestedKind)) traceComponent(context, component, size);
}

const number = value => Number(value.toFixed(4));
const pointList = (points, size) => points.map(([x, y]) => `${number(x * size)},${number(y * size)}`).join(' ');

function commandMarkup(commands, size) {
  return commands.map(([kind, ...values]) => kind === 'Z' ? 'Z' : `${kind} ${values.map(value => number(value * size)).join(' ')}`).join(' ');
}

function componentMarkup(component, size) {
  if (component.type === 'polygon') return `<polygon points="${pointList(component.points, size)}"/>`;
  if (component.type === 'circle') return `<circle cx="${number(component.cx * size)}" cy="${number(component.cy * size)}" r="${number(component.radius * size)}"/>`;
  if (component.type === 'rect') return `<rect x="${number(component.x * size)}" y="${number(component.y * size)}" width="${number(component.width * size)}" height="${number(component.height * size)}"/>`;
  if (component.type === 'roundRect') return `<rect x="${number(component.x * size)}" y="${number(component.y * size)}" width="${number(component.width * size)}" height="${number(component.height * size)}" rx="${number(component.radius * size)}"/>`;
  return `<path d="${commandMarkup(component.commands, size)}"/>`;
}

/** Canonical SVG counterpart used by previews and downloadable design files. */
export function shapeSvgMarkup(requestedKind, requestedSize) {
  const size = Math.max(.01, Number(requestedSize) || 12);
  return `<g>${geometryFor(requestedKind).map(component => componentMarkup(component, size)).join('')}</g>`;
}
