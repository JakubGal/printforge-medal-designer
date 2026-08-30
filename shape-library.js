export const SUPPORTED_SHAPES = Object.freeze([
  'circle', 'square', 'triangle', 'diamond', 'star', 'hexagon',
  'bolt', 'heart', 'mountain', 'flag', 'trophy', 'runner',
]);

function polygonPoints(kind) {
  if (kind === 'triangle') return [[0, -.52], [.52, .44], [-.52, .44]];
  if (kind === 'diamond') return [[0, -.5], [.5, 0], [0, .5], [-.5, 0]];
  if (kind === 'bolt') return [[-.1, -.55], [.5, -.55], [.15, -.08], [.48, -.08], [-.35, .58], [-.08, .08], [-.45, .08]];
  if (kind === 'mountain') return [[-.55, .42], [-.18, -.48], [.02, -.08], [.25, -.5], [.56, .42]];
  if (kind === 'star' || kind === 'hexagon') {
    const count = kind === 'star' ? 10 : 6;
    return Array.from({ length: count }, (_, index) => {
      const radius = kind === 'star' && index % 2 ? .22 : .5;
      const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    });
  }
  return null;
}

function tracePolygon(context, points, size) {
  points.forEach(([x, y], index) => index
    ? context.lineTo(x * size, y * size)
    : context.moveTo(x * size, y * size));
  context.closePath();
}

/** Canonical editor and manufacturing path for every symbol offered by the UI. */
export function traceShapePath(context, requestedKind, requestedSize) {
  const kind = SUPPORTED_SHAPES.includes(requestedKind) ? requestedKind : 'hexagon';
  const size = Math.max(.01, Number(requestedSize) || 12);
  context.beginPath();
  const polygon = polygonPoints(kind);
  if (polygon) {
    tracePolygon(context, polygon, size);
  } else if (kind === 'circle') {
    context.arc(0, 0, size / 2, 0, Math.PI * 2);
  } else if (kind === 'square') {
    context.roundRect(-size / 2, -size / 2, size, size, Math.max(size * .04, size * .08));
  } else if (kind === 'heart') {
    context.moveTo(0, size * .45);
    context.bezierCurveTo(-size * .65, 0, -size * .48, -size * .48, -size * .2, -size * .48);
    context.bezierCurveTo(0, -size * .48, 0, -size * .25, 0, -size * .14);
    context.bezierCurveTo(0, -size * .25, 0, -size * .48, size * .2, -size * .48);
    context.bezierCurveTo(size * .48, -size * .48, size * .65, 0, 0, size * .45);
    context.closePath();
  } else if (kind === 'flag') {
    context.rect(-size * .42, -size * .5, size * .09, size);
    tracePolygon(context, [[-.33, -.44], [.45, -.31], [.19, -.03], [-.33, -.13]], size);
  } else if (kind === 'trophy') {
    context.moveTo(-size * .27, -size * .48);
    context.lineTo(size * .27, -size * .48);
    context.lineTo(size * .21, -size * .03);
    context.quadraticCurveTo(0, size * .18, -size * .21, -size * .03);
    context.closePath();
    context.rect(-size * .06, size * .08, size * .12, size * .26);
    context.roundRect(-size * .28, size * .31, size * .56, size * .15, size * .04);
    context.moveTo(-size * .25, -size * .37);
    context.bezierCurveTo(-size * .55, -size * .35, -size * .48, size * .02, -size * .2, size * .06);
    context.lineTo(-size * .16, -size * .05);
    context.bezierCurveTo(-size * .33, -size * .08, -size * .36, -size * .25, -size * .23, -size * .25);
    context.closePath();
    context.moveTo(size * .25, -size * .37);
    context.bezierCurveTo(size * .55, -size * .35, size * .48, size * .02, size * .2, size * .06);
    context.lineTo(size * .16, -size * .05);
    context.bezierCurveTo(size * .33, -size * .08, size * .36, -size * .25, size * .23, -size * .25);
    context.closePath();
  } else if (kind === 'runner') {
    context.moveTo(size * .13, -size * .34);
    context.arc(size * .03, -size * .34, size * .1, 0, Math.PI * 2);
    tracePolygon(context, [[-.02, -.19], [.16, -.08], [.42, -.02], [.37, .08], [.12, .03], [.02, .17], [.32, .39], [.23, .5], [-.12, .25], [-.35, .49], [-.47, .39], [-.17, .05], [-.06, -.08], [-.28, .02], [-.36, -.08]], size);
  }
}

const number = value => Number(value.toFixed(4));
const pointList = (points, size) => points.map(([x, y]) => `${number(x * size)},${number(y * size)}`).join(' ');

/** Canonical SVG counterpart used by the downloadable two-side design file. */
export function shapeSvgMarkup(requestedKind, requestedSize) {
  const kind = SUPPORTED_SHAPES.includes(requestedKind) ? requestedKind : 'hexagon';
  const size = Math.max(.01, Number(requestedSize) || 12);
  const polygon = polygonPoints(kind);
  if (polygon) return `<polygon points="${pointList(polygon, size)}"/>`;
  if (kind === 'circle') return `<circle cx="0" cy="0" r="${number(size / 2)}"/>`;
  if (kind === 'square') return `<rect x="${number(-size / 2)}" y="${number(-size / 2)}" width="${number(size)}" height="${number(size)}" rx="${number(size * .08)}"/>`;
  if (kind === 'heart') return `<path d="M 0 ${number(size * .45)} C ${number(-size * .65)} 0 ${number(-size * .48)} ${number(-size * .48)} ${number(-size * .2)} ${number(-size * .48)} C 0 ${number(-size * .48)} 0 ${number(-size * .25)} 0 ${number(-size * .14)} C 0 ${number(-size * .25)} 0 ${number(-size * .48)} ${number(size * .2)} ${number(-size * .48)} C ${number(size * .48)} ${number(-size * .48)} ${number(size * .65)} 0 0 ${number(size * .45)} Z"/>`;
  if (kind === 'flag') return `<g><rect x="${number(-size * .42)}" y="${number(-size * .5)}" width="${number(size * .09)}" height="${number(size)}"/><polygon points="${pointList([[-.33, -.44], [.45, -.31], [.19, -.03], [-.33, -.13]], size)}"/></g>`;
  if (kind === 'trophy') return `<g><path d="M ${number(-size * .27)} ${number(-size * .48)} H ${number(size * .27)} L ${number(size * .21)} ${number(-size * .03)} Q 0 ${number(size * .18)} ${number(-size * .21)} ${number(-size * .03)} Z"/><rect x="${number(-size * .06)}" y="${number(size * .08)}" width="${number(size * .12)}" height="${number(size * .26)}"/><rect x="${number(-size * .28)}" y="${number(size * .31)}" width="${number(size * .56)}" height="${number(size * .15)}" rx="${number(size * .04)}"/><path d="M ${number(-size * .25)} ${number(-size * .37)} C ${number(-size * .55)} ${number(-size * .35)} ${number(-size * .48)} ${number(size * .02)} ${number(-size * .2)} ${number(size * .06)} L ${number(-size * .16)} ${number(-size * .05)} C ${number(-size * .33)} ${number(-size * .08)} ${number(-size * .36)} ${number(-size * .25)} ${number(-size * .23)} ${number(-size * .25)} Z M ${number(size * .25)} ${number(-size * .37)} C ${number(size * .55)} ${number(-size * .35)} ${number(size * .48)} ${number(size * .02)} ${number(size * .2)} ${number(size * .06)} L ${number(size * .16)} ${number(-size * .05)} C ${number(size * .33)} ${number(-size * .08)} ${number(size * .36)} ${number(-size * .25)} ${number(size * .23)} ${number(-size * .25)} Z"/></g>`;
  return `<g><circle cx="${number(size * .03)}" cy="${number(-size * .34)}" r="${number(size * .1)}"/><polygon points="${pointList([[-.02, -.19], [.16, -.08], [.42, -.02], [.37, .08], [.12, .03], [.02, .17], [.32, .39], [.23, .5], [-.12, .25], [-.35, .49], [-.47, .39], [-.17, .05], [-.06, -.08], [-.28, .02], [-.36, -.08]], size)}"/></g>`;
}
