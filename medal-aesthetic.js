import {
  DEFAULT_INVENTORY,
  buildChecks,
  elementBounds,
  elementFitsSafeArea,
  getPalette,
  medalFaceArea,
  normalizeProject,
  snapToLayer,
} from './project-model.js';

/**
 * A release gate for generated medal concepts.  The score is deliberately
 * based on measurable properties of the editable CAD document, rather than a
 * screenshot or a subjective "looks good" flag.  This keeps local generation
 * deterministic and makes the same quality contract usable by a future AI
 * provider.
 */
export const MEDAL_AESTHETIC_THRESHOLD = 9;

export const MEDAL_AESTHETIC_CATEGORIES = Object.freeze({
  typography: { label: 'Typography', weight: .15 },
  hierarchy: { label: 'Visual hierarchy', weight: .14 },
  balance: { label: 'Balance', weight: .12 },
  spacing: { label: 'Spacing', weight: .15 },
  focalArt: { label: 'Focal artwork', weight: .14 },
  palette: { label: 'Palette', weight: .10 },
  manufacturability: { label: 'Manufacturability', weight: .12 },
  detailContinuity: { label: 'Detail continuity', weight: .08 },
});

const EPSILON = 1e-6;

function clamp(value, min = 0, max = 10) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function visibleElements(project, face = null) {
  return (project?.elements || []).filter(element => !element.hidden && (!face || element.face === face));
}

function rotatedBounds(element) {
  const bounds = elementBounds(element);
  const angle = (Number(element.rotation) || 0) * Math.PI / 180;
  const cosine = Math.abs(Math.cos(angle)), sine = Math.abs(Math.sin(angle));
  return {
    ...bounds,
    width: bounds.width * cosine + bounds.height * sine,
    height: bounds.width * sine + bounds.height * cosine,
  };
}

function boundsArea(element) {
  const bounds = rotatedBounds(element);
  if (element.type === 'text') return bounds.width * bounds.height * .58;
  if (element.type === 'shape') return bounds.width * bounds.height * (element.shape === 'circle' ? Math.PI / 4 : .62);
  if (element.type === 'path') {
    if (element.closed) return bounds.width * bounds.height * .58;
    const points = element.points || [];
    const sourceScale = Math.max(.001, Number(element.scale) || 1);
    const scaleX = Math.max(.001, Number(element.scaleX) || 1), scaleY = Math.max(.001, Number(element.scaleY) || 1);
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      length += Math.hypot((points[index][0] - points[index - 1][0]) * sourceScale * scaleX, (points[index][1] - points[index - 1][1]) * sourceScale * scaleY);
    }
    return Math.max(bounds.width * bounds.height * .04, length * Math.max(.1, Number(element.strokeWidth) || 0));
  }
  if (element.type === 'image') {
    const coverage = Array.isArray(element.footprint) && element.footprint.length >= 3 ? .62 : .78;
    return bounds.width * bounds.height * coverage;
  }
  return bounds.width * bounds.height * .5;
}

function overlapArea(first, second) {
  const a = rotatedBounds(first), b = rotatedBounds(second);
  return Math.max(0, Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2))
    * Math.max(0, Math.min(a.y + a.height / 2, b.y + b.height / 2) - Math.max(a.y - a.height / 2, b.y - b.height / 2));
}

function hexRgb(value) {
  const hex = String(value || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return [128, 128, 128];
  return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

function relativeLuminance(value) {
  const channels = hexRgb(value).map(channel => {
    const linear = channel / 255;
    return linear <= .03928 ? linear / 12.92 : ((linear + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

function contrastRatio(first, second) {
  const a = relativeLuminance(first), b = relativeLuminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

function category(score, strengths, issues, metrics = {}) {
  return {
    score: round(clamp(score), 1),
    strengths: strengths.filter(Boolean),
    issues: issues.filter(Boolean),
    metrics,
  };
}

function typographyScore(project) {
  const all = visibleElements(project).filter(element => element.type === 'text');
  const front = all.filter(element => element.face === 'front');
  const back = all.filter(element => element.face === 'back');
  const nozzle = project.profile.nozzle;
  const bodyWidth = Number(project.medal.width || project.medal.diameter) || 60;
  const issues = [], strengths = [];
  let score = 10;
  if (front.length < 2) { score -= 3; issues.push('The front needs a headline and at least one supporting information line.'); }
  else strengths.push(`${front.length} editable front text objects create a usable information system.`);
  if (front.length > 5) { score -= Math.min(2, (front.length - 5) * .5); issues.push('Too many front text lines compete for attention.'); }
  if (back.length && back.length < 2) { score -= .6; issues.push('The back has too little typographic structure.'); }
  const undersized = all.filter(element => element.fontSize * Math.min(element.scaleX || 1, element.scaleY || 1) < Math.max(2.8, nozzle * 4.8));
  if (undersized.length) { score -= Math.min(2.5, undersized.length * .45); issues.push(`${undersized.length} text object${undersized.length === 1 ? ' is' : 's are'} too small for crisp medal lettering.`); }
  const overflowing = all.filter(element => rotatedBounds(element).width > bodyWidth * .8 || !elementFitsSafeArea(project, element, Math.max(.4, project.medal.rimWidth * .35)));
  if (overflowing.length) { score -= Math.min(3, overflowing.length * .75); issues.push(`${overflowing.length} text object${overflowing.length === 1 ? ' exceeds' : 's exceed'} the safe type area.`); }
  const weak = all.filter(element => (Number(element.weight) || 400) < 600);
  if (weak.length) { score -= Math.min(1.5, weak.length * .35); issues.push('Some lettering uses strokes that are too light for dependable extrusion.'); }
  const sizes = [...new Set(front.map(element => round(element.fontSize * (element.scaleY || 1), 1)))].sort((a, b) => a - b);
  if (front.length >= 2 && sizes.length < 2) { score -= 1.2; issues.push('Headline and supporting text have no visible size hierarchy.'); }
  else if (sizes.length >= 2) strengths.push('Headline and supporting copy use distinct sizes.');
  return category(score, strengths, issues, { frontLines: front.length, backLines: back.length, typeSizesMm: sizes });
}

function hierarchyScore(project) {
  const front = visibleElements(project, 'front');
  const text = front.filter(element => element.type === 'text');
  const artwork = front.filter(element => element.type !== 'text' && !/(?:panel|field|cutout|shadow|band)/i.test(element.name || ''));
  const faceArea = Math.max(1, medalFaceArea(project, project.medal.rimWidth || 0));
  const focal = artwork.slice().sort((a, b) => boundsArea(b) - boundsArea(a))[0];
  const focalRatio = focal ? boundsArea(focal) / faceArea : 0;
  const frontHeights = [...new Set(front.filter(element => ['raise', 'inlay'].includes(element.operation)).map(element => round(element.operation === 'inlay' ? element.zDepth : element.zHeight, 3)))];
  let score = 10;
  const issues = [], strengths = [];
  if (!text.length || !artwork.length) { score -= 3.5; issues.push('A premium medal needs both an identity and a focal graphic.'); }
  if (!text.some(element => /(?:title|event|distance|place|city)/i.test(`${element.name} ${element.text}`))) { score -= 1.2; issues.push('No clear primary identity is marked in the editable object structure.'); }
  else strengths.push('The editable structure identifies primary event information.');
  if (focalRatio < .025) { score -= 2.2; issues.push('The focal graphic is too small to read at medal scale.'); }
  else if (focalRatio > .42) { score -= 1.5; issues.push('The focal graphic overwhelms the information hierarchy.'); }
  else strengths.push('The focal artwork occupies a clear but controlled share of the face.');
  if (text.length >= 2) {
    const sizes = text.map(element => element.fontSize * (element.scaleY || 1));
    const ratio = Math.max(...sizes) / Math.max(EPSILON, Math.min(...sizes));
    if (ratio < 1.22) { score -= 1; issues.push('Primary and secondary copy read at nearly the same level.'); }
    if (ratio > 4.2) { score -= .7; issues.push('The type-size jump is too abrupt.'); }
  }
  if (frontHeights.length > 3) { score -= Math.min(2.5, (frontHeights.length - 3) * .8); issues.push('Relief uses too many unrelated height levels.'); }
  else if (frontHeights.length >= 2) strengths.push(`${frontHeights.length} deliberate relief tiers reinforce the visual hierarchy.`);
  return category(score, strengths, issues, { focalAreaRatio: round(focalRatio, 3), reliefTiers: frontHeights });
}

function balanceScore(project) {
  const front = visibleElements(project, 'front');
  const bodyWidth = Number(project.medal.width || project.medal.diameter) || 60;
  const bodyHeight = Number(project.medal.height || project.medal.diameter) || 60;
  const weighted = front.map(element => ({ element, weight: Math.min(boundsArea(element), bodyWidth * bodyHeight * .12) }));
  const weight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const centerX = weighted.reduce((sum, item) => sum + item.element.x * item.weight, 0) / Math.max(EPSILON, weight);
  const centerY = weighted.reduce((sum, item) => sum + item.element.y * item.weight, 0) / Math.max(EPSILON, weight);
  const normalizedOffset = Math.hypot(centerX / (bodyWidth / 2), centerY / (bodyHeight / 2));
  const quadrants = new Set(front.map(element => `${element.x < 0 ? 'l' : 'r'}${element.y < 0 ? 't' : 'b'}`));
  let score = 10;
  const issues = [], strengths = [];
  if (!front.length) { score = 1; issues.push('The face is blank.'); }
  else {
    if (normalizedOffset > .3) { score -= 3; issues.push('The composition is visibly off balance.'); }
    else if (normalizedOffset > .2) { score -= 1.7; issues.push('The composition needs a stronger counterweight.'); }
    else if (normalizedOffset > .14) { score -= .7; issues.push('The visual center is slightly displaced.'); }
    else strengths.push('The visual center stays inside the controlled central zone.');
    if (quadrants.size < 3 && front.length >= 4) { score -= 1.4; issues.push('Artwork is concentrated in too few areas of the face.'); }
    else if (quadrants.size >= 3) strengths.push('Visual mass is distributed across the face.');
  }
  return category(score, strengths, issues, { centerOffset: round(normalizedOffset, 3), occupiedQuadrants: quadrants.size });
}

function spacingScore(project) {
  const front = visibleElements(project, 'front');
  const safeInset = Math.max(.5, (Number(project.medal.rimWidth) || 0) + project.profile.nozzle * 1.25);
  const outside = front.filter(element => !elementFitsSafeArea(project, element, safeInset));
  const texts = front.filter(element => element.type === 'text');
  let textOverlap = 0;
  for (let first = 0; first < texts.length; first += 1) for (let second = first + 1; second < texts.length; second += 1) {
    const overlap = overlapArea(texts[first], texts[second]);
    const smaller = Math.max(EPSILON, Math.min(boundsArea(texts[first]), boundsArea(texts[second])));
    if (overlap / smaller > .08) textOverlap += 1;
  }
  const faceArea = Math.max(1, medalFaceArea(project, safeInset));
  const coverage = front.reduce((sum, element) => sum + Math.min(boundsArea(element), faceArea * .2), 0) / faceArea;
  let score = 10;
  const issues = [], strengths = [];
  if (outside.length) { score -= Math.min(5, outside.length * .8); issues.push(`${outside.length} object${outside.length === 1 ? ' crosses' : 's cross'} the artwork safe area.`); }
  else if (front.length) strengths.push('All front objects retain a printable quiet zone inside the rim.');
  if (textOverlap) { score -= Math.min(3, textOverlap * 1.1); issues.push(`${textOverlap} text collision${textOverlap === 1 ? '' : 's'} reduce legibility.`); }
  else if (texts.length >= 2) strengths.push('Text lines remain independently readable.');
  if (coverage < .13) { score -= 2.2; issues.push('The face feels under-designed.'); }
  else if (coverage > .78) { score -= 2.2; issues.push('The face is overcrowded.'); }
  else if (coverage > .68) { score -= .8; issues.push('The composition has little breathing room.'); }
  if (front.length > 42) { score -= Math.min(2, (front.length - 42) * .08); issues.push('Excessive object fragmentation makes the design noisy and hard to edit.'); }
  return category(score, strengths, issues, { outsideSafeArea: outside.length, textCollisions: textOverlap, estimatedCoverage: round(coverage, 3) });
}

function focalArtScore(project) {
  const front = visibleElements(project, 'front');
  const art = front.filter(element => element.type !== 'text' && !/(?:panel|field|cutout|shadow|band|divider|rule)/i.test(element.name || ''));
  const paths = art.filter(element => element.type === 'path');
  const detailedPaths = paths.filter(element => (element.points || []).length >= 12);
  const images = art.filter(element => element.type === 'image');
  const namedSubject = art.filter(element => /(?:runner|cyclist|mountain|city|skyline|route|star|moon|achievement|subject|logo|art)/i.test(element.name || ''));
  const faceArea = Math.max(1, medalFaceArea(project, project.medal.rimWidth || 0));
  const focalRatio = art.length ? Math.max(...art.map(boundsArea)) / faceArea : 0;
  let score = 10;
  const issues = [], strengths = [];
  if (art.length < 3) { score -= 3.2; issues.push('The face lacks a composed focal-art system.'); }
  else strengths.push(`${art.length} separate editable art objects form the focal composition.`);
  if (!detailedPaths.length && !images.length) { score -= 2.4; issues.push('The artwork has no high-detail vector silhouette or detailed source object.'); }
  else strengths.push(detailedPaths.length ? 'A high-detail vector path anchors the illustration.' : 'The focal source retains detailed printable sampling.');
  if (!namedSubject.length) { score -= 1.1; issues.push('The object tree does not identify a recognizable subject.'); }
  if (focalRatio < .02 || focalRatio > .45) { score -= 1.4; issues.push('The largest art object is not at an effective medal scale.'); }
  const verySimpleClosed = paths.filter(element => element.closed && (element.points || []).length < 6 && !/(?:panel|band)/i.test(element.name || ''));
  if (verySimpleClosed.length > 2) { score -= 1.4; issues.push('The focal art relies on too many low-polygon shapes.'); }
  return category(score, strengths, issues, { artworkObjects: art.length, detailedVectorPaths: detailedPaths.length, focalAreaRatio: round(focalRatio, 3) });
}

function paletteScore(project, inventory) {
  const palette = getPalette(project, inventory);
  const visible = visibleElements(project);
  const usedSlots = new Set([project.medal.baseColor, project.medal.rimColor, ...visible.flatMap(element => element.type === 'image' && Array.isArray(element.usedSlots) ? element.usedSlots : [element.color])]);
  const colors = [...usedSlots].map(slot => palette[slot]).filter(Boolean);
  const base = palette[project.medal.baseColor] || colors[0];
  const ratios = colors.filter(color => color !== base).map(color => contrastRatio(base?.color, color?.color));
  const bestContrast = ratios.length ? Math.max(...ratios) : 1;
  const distinctPairs = [];
  for (let a = 0; a < colors.length; a += 1) for (let b = a + 1; b < colors.length; b += 1) distinctPairs.push(contrastRatio(colors[a].color, colors[b].color));
  let score = 10;
  const issues = [], strengths = [];
  if (colors.length < 3) { score -= 2.8; issues.push('The design lacks a base, primary, and accent color relationship.'); }
  else if (colors.length > 6) { score -= Math.min(2.5, (colors.length - 6) * .7); issues.push('Too many filament colors weaken cohesion and complicate production.'); }
  else strengths.push(`${colors.length} used filament colors form a controlled production palette.`);
  if (bestContrast < 3) { score -= 2.5; issues.push('No artwork color has enough contrast against the medal body.'); }
  else if (bestContrast < 4.5) { score -= .8; issues.push('Primary contrast is usable but not presentation-grade.'); }
  else strengths.push('Primary artwork has strong contrast against the base.');
  const indistinct = distinctPairs.filter(ratio => ratio < 1.18).length;
  if (indistinct > 1) { score -= Math.min(1.5, indistinct * .3); issues.push('Several filament colors are visually redundant.'); }
  return category(score, strengths, issues, { usedColors: colors.length, bestBaseContrast: round(bestContrast, 2) });
}

function manufacturabilityScore(project, inventory) {
  const checks = buildChecks(project, inventory);
  const blocks = checks.filter(check => check.level === 'block');
  const warnings = checks.filter(check => check.level === 'warn' && check.title !== 'Back artwork uses first-layer color');
  const oneLineWarnings = warnings.filter(check => /uses one-line detail/i.test(check.title));
  const otherWarnings = warnings.filter(check => !oneLineWarnings.includes(check));
  const layer = project.profile.layerHeight;
  const nozzle = project.profile.nozzle;
  const visible = visibleElements(project);
  const offLayer = visible.filter(element => {
    const amount = element.operation === 'raise' ? element.zHeight : element.zDepth;
    return Math.abs(amount / layer - Math.round(amount / layer)) > .04;
  });
  const thinPaths = visible.filter(element => element.type === 'path' && !element.closed && element.strokeWidth * Math.min(element.scaleX || 1, element.scaleY || 1) < nozzle * 1.125 - EPSILON);
  const back = visible.filter(element => element.face === 'back');
  const unsafeBack = back.filter(element => element.operation !== 'inlay' || Math.abs(element.zDepth - layer) > .001 || element.inlayHeight > EPSILON);
  let score = 10 - blocks.length * 4 - Math.min(3.5, oneLineWarnings.length * .4) - Math.min(1.2, otherWarnings.length * .18) - Math.min(1.4, offLayer.length * .25) - Math.min(1.6, thinPaths.length * .4) - Math.min(2, unsafeBack.length * .7);
  const issues = [], strengths = [];
  if (blocks.length) issues.push(`${blocks.length} production blocker${blocks.length === 1 ? '' : 's'} must be fixed.`);
  else strengths.push('No blocking production check was found.');
  if (offLayer.length) issues.push(`${offLayer.length} relief amount${offLayer.length === 1 ? ' is' : 's are'} not aligned to physical layers.`);
  else strengths.push('All relief depths align to the selected layer height.');
  if (oneLineWarnings.length) issues.push(`${oneLineWarnings.length} detail${oneLineWarnings.length === 1 ? ' uses' : 's use'} only one extrusion line instead of the robust two-line target.`);
  else strengths.push('Visible details meet the robust two-line target for this nozzle.');
  if (thinPaths.length) issues.push(`${thinPaths.length} line${thinPaths.length === 1 ? ' is' : 's are'} below one printable extrusion bead.`);
  if (unsafeBack.length) issues.push('Back-face objects are not all flush first-layer inlays.');
  else if (back.length) strengths.push('The reverse remains a flat, first-layer multicolor design.');
  return category(score, strengths, issues, { blockers: blocks.length, warnings: warnings.length, oneLineWarnings: oneLineWarnings.length, offLayerHeights: offLayer.length, subNozzleLines: thinPaths.length, unsafeBackObjects: unsafeBack.length });
}

function detailContinuityScore(project) {
  const front = visibleElements(project, 'front');
  const images = front.filter(element => element.type === 'image');
  const artwork = front.filter(element => element.type !== 'text');
  const vectors = artwork.filter(element => ['shape', 'path'].includes(element.type));
  const vectorShare = vectors.length / Math.max(1, artwork.length);
  const nozzle = project.profile.nozzle;
  const pixelated = images.filter(element => Number(element.detailCell) * Math.min(element.scaleX || 1, element.scaleY || 1) > nozzle * 1.3);
  const arbitraryHeights = [...new Set(front.filter(element => element.operation === 'raise').map(element => round(element.zHeight, 3)))];
  const detailed = front.filter(element => element.type === 'path' && (element.points || []).length >= 12).length;
  let score = 10;
  const issues = [], strengths = [];
  if (vectorShare < .65) { score -= 2.5; issues.push('Too much of the focal artwork depends on raster cells instead of smooth editable vectors.'); }
  else strengths.push(`${Math.round(vectorShare * 100)}% of face objects use resolution-independent geometry.`);
  if (pixelated.length) { score -= Math.min(4, pixelated.length * 1.5); issues.push(`${pixelated.length} image object${pixelated.length === 1 ? ' has' : 's have'} visibly coarse physical sampling.`); }
  if (arbitraryHeights.length > 3) { score -= Math.min(2.6, (arbitraryHeights.length - 3) * .65); issues.push('Unrelated relief levels create a noisy, accidental surface.'); }
  else if (arbitraryHeights.length) strengths.push('Relief is organized into a small number of continuous height tiers.');
  if (!detailed && !images.length) { score -= 1.2; issues.push('No detailed vector contour carries the focal silhouette.'); }
  return category(score, strengths, issues, { vectorShare: round(vectorShare, 3), coarseRasterObjects: pixelated.length, reliefTiers: arbitraryHeights.length, detailedPaths: detailed });
}

/**
 * Return a deterministic 0–10 report.  A design passes only if the weighted
 * score and every critical category meet the release contract.
 */
export function scoreMedalAesthetics(input, options = {}) {
  const project = normalizeProject(input);
  const inventory = options.inventory || DEFAULT_INVENTORY;
  const threshold = clamp(options.threshold ?? MEDAL_AESTHETIC_THRESHOLD, 0, 10);
  const categories = {
    typography: typographyScore(project),
    hierarchy: hierarchyScore(project),
    balance: balanceScore(project),
    spacing: spacingScore(project),
    focalArt: focalArtScore(project),
    palette: paletteScore(project, inventory),
    manufacturability: manufacturabilityScore(project, inventory),
    detailContinuity: detailContinuityScore(project),
  };
  const score = round(Object.entries(categories).reduce((sum, [key, result]) => sum + result.score * MEDAL_AESTHETIC_CATEGORIES[key].weight, 0), 2);
  const criticalMinimum = Math.max(7.5, threshold - 1.5);
  const failedCategories = Object.entries(categories)
    .filter(([key, result]) => result.score < (['spacing', 'manufacturability', 'detailContinuity'].includes(key) ? criticalMinimum : 6.5))
    .map(([key]) => key);
  return {
    schema: 'MedalAestheticScore',
    version: 1,
    score,
    threshold,
    passed: score >= threshold && failedCategories.length === 0,
    grade: score >= 9.5 ? 'presentation-ready' : score >= 9 ? 'production-polished' : score >= 7.5 ? 'promising' : score >= 5 ? 'needs redesign' : 'reject',
    categories,
    failedCategories,
  };
}

function scalePlanar(element, factor) {
  if (element.type === 'text') element.fontSize *= factor;
  else if (element.type === 'shape') element.size *= factor;
  else if (element.type === 'image') { element.width *= factor; element.height *= factor; }
  else if (element.type === 'path') { element.scale *= factor; element.strokeWidth *= factor; }
}

function fitElementToSafeArea(project, element, inset) {
  if (elementFitsSafeArea(project, element, inset)) return false;
  let changed = false;
  // Moving an edge-biased object toward the origin preserves its authored
  // silhouette and printable stroke width before any scaling is considered.
  for (let attempt = 0; attempt < 28 && !elementFitsSafeArea(project, element, inset); attempt += 1) {
    element.x *= .9;
    element.y *= .9;
    changed = true;
  }
  for (let attempt = 0; attempt < 18 && !elementFitsSafeArea(project, element, inset); attempt += 1) {
    scalePlanar(element, .96);
    changed = true;
  }
  return changed;
}

function semanticReliefTier(element, layer) {
  if (/(?:panel|field|band|shadow|cutout|far mountain)/i.test(element.name || '')) return layer * 2;
  if (element.type === 'text' && /(?:title|event|distance|place|city|number)/i.test(`${element.name} ${element.text}`)) return layer * 4;
  if (/(?:runner|cyclist|achievement|moon disc|mountain ridge|summit|beacon)/i.test(element.name || '')) return layer * 4;
  return layer * 3;
}

function normalizeRelief(project) {
  const layer = project.profile.layerHeight;
  let changed = false;
  for (const element of project.elements) {
    if (element.hidden) continue;
    if (element.face === 'back') {
      if (element.operation !== 'inlay' || Math.abs(element.zDepth - layer) > EPSILON || element.inlayHeight !== 0 || element.combine !== 'replace') changed = true;
      element.operation = 'inlay';
      element.zDepth = layer;
      element.zHeight = layer;
      element.inlayHeight = 0;
      element.combine = 'replace';
      element.layerSnap = true;
      continue;
    }
    if (element.operation !== 'raise') continue;
    const target = semanticReliefTier(element, layer);
    if (Math.abs(element.zHeight - target) > EPSILON) changed = true;
    element.zHeight = target;
    element.layerSnap = true;
  }
  project.medal.rimHeight = Math.max(layer * 2, snapToLayer(project.medal.rimHeight, layer));
  project.medal.defaultHeight = layer * 3;
  project.medal.reliefHeight = layer * 3;
  return changed;
}

function reinforceMinimumFeatures(project) {
  // Leave a tiny numerical margin so normalization and decimal round-trips do
  // not turn an exact two-line target back into a one-line warning.
  const robust = project.profile.nozzle * 2.25 * 1.02;
  const minimumText = Math.max(2.8, robust / .16);
  let changed = false;
  for (const element of project.elements) {
    if (element.hidden) continue;
    if (element.type === 'path' && !element.closed && element.strokeWidth * Math.min(element.scaleX || 1, element.scaleY || 1) < robust) {
      element.strokeWidth = robust / Math.min(element.scaleX || 1, element.scaleY || 1);
      changed = true;
    } else if (element.type === 'shape') {
      const scale = Math.min(element.scaleX || 1, element.scaleY || 1);
      const featureRatio = element.shape === 'star' || element.shape === 'bolt' ? .12 : .22;
      const requiredSize = robust / featureRatio / scale;
      if (element.size < requiredSize) {
        element.size = requiredSize;
        changed = true;
      }
    } else if (element.type === 'path' && element.closed) {
      const bounds = elementBounds(element);
      const feature = Math.min(bounds.width, bounds.height) * .15;
      if (feature < robust) {
        element.scale *= robust / Math.max(.001, feature);
        changed = true;
      }
    } else if (element.type === 'text') {
      const scale = Math.min(element.scaleX || 1, element.scaleY || 1);
      const featureRatio = (Number(element.weight) || 400) >= 800 ? .16 : .11;
      if (element.fontSize * scale * featureRatio < robust) {
        element.weight = Math.max(800, Number(element.weight) || 400);
        element.fontSize = minimumText / scale;
        changed = true;
      }
    }
  }
  return changed;
}

function separateTextRows(project) {
  let changed = false;
  const minimumGap = project.profile.nozzle * 1.5;
  for (const face of ['front', 'back']) {
    const rows = visibleElements(project, face).filter(element => element.type === 'text').sort((a, b) => a.y - b.y);
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rotatedBounds(rows[index - 1]), current = rotatedBounds(rows[index]);
      const overlapX = Math.min(previous.x + previous.width / 2, current.x + current.width / 2) - Math.max(previous.x - previous.width / 2, current.x - current.width / 2);
      const requiredY = previous.y + previous.height / 2 + current.height / 2 + minimumGap;
      if (overlapX > 0 && current.y < requiredY) {
        const adjustment = Math.min(requiredY - current.y, project.profile.nozzle * 3);
        rows[index].y += adjustment;
        changed = true;
      }
    }
  }
  return changed;
}

function centerFaceComposition(project, face) {
  const elements = visibleElements(project, face);
  if (!elements.length) return false;
  const width = Number(project.medal.width || project.medal.diameter) || 60;
  const height = Number(project.medal.height || project.medal.diameter) || 60;
  const weighted = elements.map(element => ({ element, weight: Math.min(boundsArea(element), width * height * .12) }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  const x = weighted.reduce((sum, item) => sum + item.element.x * item.weight, 0) / Math.max(EPSILON, total);
  const y = weighted.reduce((sum, item) => sum + item.element.y * item.weight, 0) / Math.max(EPSILON, total);
  const shiftX = clamp(-x * .45, -width * .025, width * .025);
  const shiftY = clamp(-y * .45, -height * .025, height * .025);
  if (Math.hypot(shiftX, shiftY) < .05) return false;
  for (const element of elements) { element.x += shiftX; element.y += shiftY; }
  return true;
}

function polishingPass(input, iteration) {
  const project = structuredClone(input);
  const changes = [];
  if (reinforceMinimumFeatures(project)) changes.push('reinforced fragile one-line details');
  if (normalizeRelief(project)) changes.push('organized relief into semantic height tiers');
  if (separateTextRows(project)) changes.push('separated colliding text rows');
  if (centerFaceComposition(project, 'front')) changes.push('balanced the front composition');
  if (centerFaceComposition(project, 'back')) changes.push('balanced the back composition');
  const inset = Math.max(
    .5,
    (Number(project.medal.edgeInset) || 0) + (Number(project.medal.rimWidth) || 0),
    (Number(project.medal.rimWidth) || 0) + project.profile.nozzle * 1.25,
  );
  let fitted = 0;
  for (const element of project.elements) if (!element.hidden && fitElementToSafeArea(project, element, inset)) fitted += 1;
  if (fitted) changes.push(`fitted ${fitted} object${fitted === 1 ? '' : 's'} into the safe area`);
  const normalized = normalizeProject(project);
  normalized.designPlan ||= {};
  normalized.designPlan.polishPass = iteration;
  return { project: normalized, changes };
}

/**
 * Apply bounded deterministic layout corrections, rescoring after every pass.
 * It never fabricates missing artwork: an intrinsically weak/blank design is
 * rejected instead of receiving a dishonest 9/10 badge.
 */
export function polishMedalDesign(input, options = {}) {
  const threshold = clamp(options.threshold ?? MEDAL_AESTHETIC_THRESHOLD, 0, 10);
  const maxIterations = Math.max(0, Math.min(8, Math.floor(options.maxIterations ?? 4)));
  const inventory = options.inventory || DEFAULT_INVENTORY;
  let project = normalizeProject(input);
  let assessment = scoreMedalAesthetics(project, { threshold, inventory });
  const history = [{ iteration: 0, score: assessment.score, changes: [] }];
  // Always perform one deterministic cleanup pass. A high weighted score must
  // not let dozens of merely one-line details bypass the physical polish step.
  for (let iteration = 1; iteration <= maxIterations && (iteration === 1 || !assessment.passed); iteration += 1) {
    const pass = polishingPass(project, iteration);
    const nextAssessment = scoreMedalAesthetics(pass.project, { threshold, inventory });
    history.push({ iteration, score: nextAssessment.score, changes: pass.changes });
    project = pass.project;
    assessment = nextAssessment;
    if (!pass.changes.length) break;
  }
  project.designPlan ||= {};
  project.designPlan.aesthetic = {
    schema: assessment.schema,
    version: assessment.version,
    score: assessment.score,
    threshold: assessment.threshold,
    passed: assessment.passed,
    grade: assessment.grade,
    categoryScores: Object.fromEntries(Object.entries(assessment.categories).map(([key, value]) => [key, value.score])),
  };
  return { project, assessment, accepted: assessment.passed, iterations: history.length - 1, history };
}

/** Require the 9/10 release gate and provide useful category diagnostics. */
export function requirePolishedMedal(input, options = {}) {
  const result = polishMedalDesign(input, options);
  if (!result.accepted) {
    const weakest = Object.entries(result.assessment.categories).sort((a, b) => a[1].score - b[1].score).slice(0, 3);
    const detail = weakest.map(([key, value]) => `${MEDAL_AESTHETIC_CATEGORIES[key].label} ${value.score}/10`).join(', ');
    const error = new RangeError(`Generated medal rejected at ${result.assessment.score}/10 (required ${result.assessment.threshold}/10): ${detail}.`);
    error.qualityResult = result;
    throw error;
  }
  return result;
}
