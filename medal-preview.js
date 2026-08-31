import { medalAttachmentGeometry, presetMedalOutlinePoints } from './project-model.js';

const number = value => {
  const rounded = Math.round((Number(value) || 0) * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

const measure = value => {
  const rounded = Math.round((Number(value) || 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const xml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const safeColor = (value, fallback) => /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? String(value) : fallback;

function roundedRect(rect, attributes = '') {
  const radius = Math.max(0, Number(rect.radius) || Math.min(Number(rect.height) || 0, Number(rect.width) || 0) / 2);
  return `<rect x="${number(rect.x0)}" y="${number(rect.y0)}" width="${number(rect.width ?? rect.x1 - rect.x0)}" height="${number(rect.height ?? rect.y1 - rect.y0)}" rx="${number(radius)}" ${attributes}/>`;
}

function faceMarkup(medal) {
  const width = Number(medal.width || medal.diameter) || 60;
  const height = Number(medal.height || medal.diameter) || width;
  const common = 'class="medal-preview-body" data-preview-body="true" vector-effect="non-scaling-stroke"';
  if (medal.shape === 'circle' || medal.shape === 'oval') {
    return `<ellipse cx="0" cy="0" rx="${number(width / 2)}" ry="${number(height / 2)}" ${common}/>`;
  }
  if (medal.shape === 'rounded') {
    const radius = Math.max(0, Math.min(Number(medal.cornerRadius) || 8, width / 2, height / 2));
    return `<rect x="${number(-width / 2)}" y="${number(-height / 2)}" width="${number(width)}" height="${number(height)}" rx="${number(radius)}" ${common}/>`;
  }
  const points = medal.shape === 'custom' && medal.outline?.length >= 3
    ? medal.outline
    : presetMedalOutlinePoints(medal.shape, width, height) || presetMedalOutlinePoints('shield', width, height);
  return `<polygon points="${points.map(([x, y]) => `${number(x)},${number(y)}`).join(' ')}" ${common}/>`;
}

function faceBounds(medal) {
  const width = Number(medal.width || medal.diameter) || 60;
  const height = Number(medal.height || medal.diameter) || width;
  if (['circle', 'oval', 'rounded'].includes(medal.shape)) return { minX: -width / 2, maxX: width / 2, minY: -height / 2, maxY: height / 2 };
  const points = medal.shape === 'custom' && medal.outline?.length >= 3
    ? medal.outline
    : presetMedalOutlinePoints(medal.shape, width, height) || presetMedalOutlinePoints('shield', width, height);
  return {
    minX: Math.min(...points.map(point => point[0])), maxX: Math.max(...points.map(point => point[0])),
    minY: Math.min(...points.map(point => point[1])), maxY: Math.max(...points.map(point => point[1])),
  };
}

function apertureMarkup(aperture, index = 0) {
  const attributes = `class="medal-preview-opening" data-preview-aperture="${index}" vector-effect="non-scaling-stroke"`;
  if (aperture?.kind === 'circle') {
    return `<circle cx="${number(aperture.cx)}" cy="${number(aperture.cy)}" r="${number(aperture.diameter / 2)}" ${attributes}/>`;
  }
  return aperture ? roundedRect(aperture, attributes) : '';
}

function attachmentMarkup(geometry) {
  const pieces = [];
  if (geometry.outer) pieces.push(roundedRect(geometry.outer, 'class="medal-preview-attachment" data-preview-attachment-outer="true" vector-effect="non-scaling-stroke"'));
  if (geometry.channel) {
    pieces.push(`<rect x="${number(geometry.channel.x0)}" y="${number(geometry.channel.y0)}" width="${number(geometry.channel.width)}" height="${number(geometry.channel.y1 - geometry.channel.y0)}" class="medal-preview-opening" data-preview-channel="true" vector-effect="non-scaling-stroke"/>`);
  }
  if (geometry.apertures?.length) pieces.push(...geometry.apertures.map(apertureMarkup));
  else if (geometry.aperture) pieces.push(apertureMarkup(geometry.aperture));
  return pieces.join('');
}

function dimensionMarkup(medal, width, height, bodyBottom, bodyRight) {
  if (medal.shape === 'circle') {
    const y = bodyBottom + 6;
    return `<g class="medal-preview-dimensions" aria-hidden="true"><path d="M ${number(-width / 2)} ${number(bodyBottom + 1)} V ${number(y + 1)} M ${number(width / 2)} ${number(bodyBottom + 1)} V ${number(y + 1)} M ${number(-width / 2)} ${number(y)} H ${number(width / 2)}"/><path d="M ${number(-width / 2)} ${number(y)} l 2 -1.2 v 2.4 z M ${number(width / 2)} ${number(y)} l -2 -1.2 v 2.4 z"/><text x="0" y="${number(y + 4)}" text-anchor="middle">Ø ${measure(width)} mm</text></g>`;
  }
  const y = bodyBottom + 6;
  const x = bodyRight + 7;
  return `<g class="medal-preview-dimensions" aria-hidden="true"><path d="M ${number(-width / 2)} ${number(bodyBottom + 1)} V ${number(y + 1)} M ${number(width / 2)} ${number(bodyBottom + 1)} V ${number(y + 1)} M ${number(-width / 2)} ${number(y)} H ${number(width / 2)}"/><path d="M ${number(-width / 2)} ${number(y)} l 2 -1.2 v 2.4 z M ${number(width / 2)} ${number(y)} l -2 -1.2 v 2.4 z"/><text x="0" y="${number(y + 4)}" text-anchor="middle">${measure(width)} mm</text><path d="M ${number(bodyRight + 1)} ${number(-height / 2)} H ${number(x + 1)} M ${number(bodyRight + 1)} ${number(height / 2)} H ${number(x + 1)} M ${number(x)} ${number(-height / 2)} V ${number(height / 2)}"/><path d="M ${number(x)} ${number(-height / 2)} l -1.2 2 h 2.4 z M ${number(x)} ${number(height / 2)} l -1.2 -2 h 2.4 z"/><text x="${number(x + 4)}" y="0" text-anchor="middle" transform="rotate(90 ${number(x + 4)} 0)">${measure(height)} mm</text></g>`;
}

export function medalSizeLabel(project) {
  const medal = project?.medal || {};
  const bounds = faceBounds(medal);
  const width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY;
  return medal.shape === 'circle' ? `Ø ${measure(width)} mm` : `${measure(width)} × ${measure(height)} mm`;
}

export function medalOverallSizeLabel(project) {
  const medal = project?.medal || {};
  const attachment = medalAttachmentGeometry(project);
  const bounds = faceBounds(medal);
  const minX = Math.min(bounds.minX, attachment.outer?.x0 ?? bounds.minX);
  const maxX = Math.max(bounds.maxX, attachment.outer?.x1 ?? bounds.maxX);
  const minY = Math.min(bounds.minY, attachment.outer?.y0 ?? bounds.minY);
  const maxY = Math.max(bounds.maxY, attachment.outer?.y1 ?? bounds.maxY);
  return `${measure(maxX - minX)} × ${measure(maxY - minY)} mm overall`;
}

export function attachmentOpeningLabel(project) {
  const medal = project?.medal || {};
  if (medal.loopStyle === 'single' || medal.loopStyle === 'double') return `${measure(medal.slotWidth)} × ${measure(medal.slotHeight)} mm ribbon opening`;
  if (medal.loopStyle === 'eyelet') return `Ø ${measure(medal.holeDiameter)} mm ribbon hole`;
  if (medal.loopStyle === 'slit' || medal.loopStyle === 'open-slit') return `${measure(medal.slitWidth)} × ${measure(medal.slitHeight)} mm ribbon opening`;
  return 'No ribbon opening';
}

/**
 * Exact top-view silhouette shared by setup, attachment choices and summaries.
 * It consumes the same attachment geometry and outline points as manufacturing.
 */
export function medalTopViewSvg(project, options = {}) {
  const medal = project?.medal || {};
  const face = faceBounds(medal);
  const width = face.maxX - face.minX;
  const height = face.maxY - face.minY;
  const attachment = medalAttachmentGeometry(project);
  const compact = Boolean(options.compact);
  const showDimensions = options.showDimensions !== false && !compact;
  const bodyLeft = face.minX, bodyRight = face.maxX, bodyTop = face.minY, bodyBottom = face.maxY;
  const attachmentLeft = attachment.outer?.x0 ?? bodyLeft;
  const attachmentRight = attachment.outer?.x1 ?? bodyRight;
  const attachmentTop = attachment.outer?.y0 ?? bodyTop;
  const pad = compact ? 3 : 4;
  const minX = Math.min(bodyLeft, attachmentLeft) - pad;
  const maxX = Math.max(bodyRight, attachmentRight) + (showDimensions && medal.shape !== 'circle' ? 15 : pad);
  const minY = Math.min(bodyTop, attachmentTop) - pad;
  const maxY = bodyBottom + (showDimensions ? 13 : pad);
  const className = ['medal-top-view', compact ? 'is-compact' : '', options.className || ''].filter(Boolean).join(' ');
  const label = options.label || `${medalSizeLabel(project)} ${medal.shape || 'circle'} medal, ${medalOverallSizeLabel(project)}, with ${attachment.style} ribbon attachment`;
  const style = `--preview-body:${safeColor(options.bodyColor, '#20292d')};--preview-rim:${safeColor(options.rimColor, '#66716e')};--preview-attachment:${safeColor(options.attachmentColor, options.bodyColor || '#20292d')}`;
  const externalBeforeBody = attachment.outer ? roundedRect(attachment.outer, 'class="medal-preview-attachment" data-preview-attachment-outer="true" vector-effect="non-scaling-stroke"') : '';
  const openings = attachmentMarkup({ ...attachment, outer: null });
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${xml(className)}" viewBox="${number(minX)} ${number(minY)} ${number(maxX - minX)} ${number(maxY - minY)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${xml(label)}" data-preview-shape="${xml(medal.shape || 'circle')}" data-preview-attachment="${xml(attachment.style)}" style="${xml(style)}"><title>${xml(label)}</title>${externalBeforeBody}${faceMarkup(medal)}${openings}${showDimensions ? dimensionMarkup(medal, width, height, bodyBottom, bodyRight) : ''}</svg>`;
}
