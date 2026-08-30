import {
  ATTACHMENT_STYLE_INFO,
  RIM_STYLE_INFO,
  calculateQuote,
  enrichForExport,
  getPalette,
  medalAttachmentGeometry,
  presetMedalOutlinePoints,
  projectUsedSlots,
} from './project-model.js';
import { projectToSvg, safeFilename } from './export-engine.js';

const PAGE_WIDTH = 2480;
const PAGE_HEIGHT = 1754;
const PDF_WIDTH_PT = 841.89;
const PDF_HEIGHT_PT = 595.28;
const encoder = new TextEncoder();

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function money(value) { return `Kč ${Math.round(Number(value) || 0).toLocaleString('cs-CZ')}`; }
function mm(value, digits = 1) { return `${Number(value || 0).toFixed(digits)} mm`; }

function roundedRect(context, x, y, width, height, radius = 24) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function card(context, x, y, width, height, options = {}) {
  context.save();
  context.shadowColor = options.shadow === false ? 'transparent' : 'rgba(17, 27, 22, .08)';
  context.shadowBlur = options.shadow === false ? 0 : 22;
  context.shadowOffsetY = options.shadow === false ? 0 : 8;
  roundedRect(context, x, y, width, height, options.radius || 26);
  context.fillStyle = options.fill || '#ffffff';
  context.fill();
  context.shadowColor = 'transparent';
  if (options.stroke !== false) {
    context.strokeStyle = options.stroke || '#dce2dc';
    context.lineWidth = 2;
    context.stroke();
  }
  context.restore();
}

function text(context, value, x, y, size, options = {}) {
  context.save();
  context.fillStyle = options.color || '#17201c';
  context.font = `${options.weight || 600} ${size}px ${options.family || 'Arial, sans-serif'}`;
  context.textAlign = options.align || 'left';
  context.textBaseline = options.baseline || 'alphabetic';
  if (Number.isFinite(options.maxWidth)) context.fillText(String(value ?? ''), x, y, options.maxWidth);
  else context.fillText(String(value ?? ''), x, y);
  context.restore();
}

function uppercaseLabel(context, value, x, y, options = {}) {
  text(context, String(value || '').toUpperCase(), x, y, options.size || 20, {
    color: options.color || '#68736e',
    weight: 800,
    maxWidth: options.maxWidth,
  });
}

function wrapText(context, value, x, y, maxWidth, lineHeight, options = {}) {
  const words = String(value || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  context.save();
  context.font = `${options.weight || 500} ${options.size || 24}px Arial, sans-serif`;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  context.restore();
  const maximumLines = options.maxLines || lines.length;
  lines.slice(0, maximumLines).forEach((row, index) => {
    const shown = index === maximumLines - 1 && lines.length > maximumLines ? `${row.replace(/[.,;:]?$/, '')}…` : row;
    text(context, shown, x, y + index * lineHeight, options.size || 24, { color: options.color || '#53605a', weight: options.weight || 500, maxWidth });
  });
  return Math.min(lines.length, maximumLines) * lineHeight;
}

function fitImage(context, image, x, y, width, height, padding = 0) {
  if (!image?.width || !image?.height) return;
  const availableWidth = Math.max(1, width - padding * 2), availableHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(availableWidth / image.width, availableHeight / image.height);
  const drawWidth = image.width * scale, drawHeight = image.height * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function fitForegroundImage(context, image, x, y, width, height, padding = 0) {
  if (!image?.width || !image?.height || typeof document === 'undefined') return fitImage(context, image, x, y, width, height, padding);
  const sample = document.createElement('canvas'); sample.width = image.width; sample.height = image.height;
  const sampleContext = sample.getContext('2d', { willReadFrequently: true }); sampleContext.drawImage(image, 0, 0);
  const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
  const background = [pixels[0], pixels[1], pixels[2]];
  let minX = sample.width, minY = sample.height, maxX = -1, maxY = -1;
  for (let py = 0; py < sample.height; py += 2) for (let px = 0; px < sample.width; px += 2) {
    const offset = (py * sample.width + px) * 4;
    const difference = Math.abs(pixels[offset] - background[0]) + Math.abs(pixels[offset + 1] - background[1]) + Math.abs(pixels[offset + 2] - background[2]);
    if (pixels[offset + 3] > 80 && difference > 50) { minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); }
  }
  if (maxX < minX || maxY < minY) return fitImage(context, image, x, y, width, height, padding);
  const pad = Math.max(8, Math.round(Math.max(maxX - minX, maxY - minY) * .09));
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(sample.width - 1, maxX + pad); maxY = Math.min(sample.height - 1, maxY + pad);
  const sourceWidth = maxX - minX + 1, sourceHeight = maxY - minY + 1;
  const availableWidth = width - padding * 2, availableHeight = height - padding * 2;
  const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
  const drawWidth = sourceWidth * scale, drawHeight = sourceHeight * scale;
  context.drawImage(image, minX, minY, sourceWidth, sourceHeight, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function imageFromSource(source) {
  return new Promise((resolve, reject) => {
    if (!source) { resolve(null); return; }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A technical-sheet preview image could not be decoded.'));
    image.src = source;
  });
}

async function imageFromSvg(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try { return await imageFromSource(url); }
  finally { URL.revokeObjectURL(url); }
}

function meshMaterialRows(project, geometry, inventory) {
  const palette = getPalette(project, inventory);
  const totals = new Map();
  for (const mesh of geometry?.meshes || []) totals.set(mesh.slot, (totals.get(mesh.slot) || 0) + (Number(mesh.volumeMm3) || 0));
  const attachmentSlot = Number.isInteger(project.medal.attachmentColor) && Number(project.medal.attachmentHeight) > 0
    ? project.medal.attachmentColor
    : null;
  const used = [...new Set([
    ...(totals.size ? [...totals.keys()] : projectUsedSlots(project)),
    ...(attachmentSlot === null ? [] : [attachmentSlot]),
  ])].sort((a, b) => a - b);
  return used.map(slot => {
    const filament = palette[slot] || palette[0];
    const volumeMm3 = totals.get(slot) || 0;
    return {
      slot,
      name: filament?.name || `Color ${slot + 1}`,
      brand: filament?.brand || 'Custom',
      material: filament?.material || 'PLA',
      effect: filament?.effect || 'Solid',
      color: filament?.color || '#777777',
      volumeMm3,
      grams: volumeMm3 ? volumeMm3 / 1000 * (Number(filament?.density) || 1.24) : null,
      pricePerKg: Number(filament?.pricePerKg) || 0,
      roles: [
        slot === project.medal.baseColor ? 'body' : '',
        project.medal.rimWidth > 0 && slot === project.medal.rimColor ? 'edge' : '',
        attachmentSlot !== null && slot === attachmentSlot ? 'attachment cap' : '',
      ].filter(Boolean),
    };
  });
}

async function shortProjectHash(project) {
  const source = JSON.stringify(project);
  if (!globalThis.crypto?.subtle) {
    let value = 2166136261;
    for (let index = 0; index < source.length; index += 1) value = Math.imul(value ^ source.charCodeAt(index), 16777619);
    return Math.abs(value >>> 0).toString(16).padStart(8, '0').toUpperCase();
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(source)));
  return [...digest.slice(0, 8)].map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function physicalFaceDimensions(project) {
  const medal = project.medal;
  const fallback = {
    width: Number(medal.width || medal.diameter) || 60,
    height: Number(medal.height || medal.diameter) || 60,
  };
  let points = null;
  if (medal.shape === 'custom' && Array.isArray(medal.outline) && medal.outline.length >= 3) points = medal.outline;
  else points = presetMedalOutlinePoints(medal.shape, fallback.width, fallback.height);
  if (!points?.length) return fallback;
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function orthographicFaceLayout(project) {
  const medal = project.medal;
  const width = Number(medal.width || medal.diameter) || 60;
  const faceHeight = Number(medal.height || medal.diameter) || width;
  const attachment = medalAttachmentGeometry(project);
  const artboardWidth = Math.max(width, attachment.external ? attachment.outer.width : width);
  const frontMinY = Math.min(-faceHeight / 2, attachment.external ? attachment.outer.y0 : -faceHeight / 2);
  const frontMaxY = Math.max(faceHeight / 2, attachment.external ? attachment.outer.y1 : faceHeight / 2);
  const minY = Math.min(frontMinY, -frontMaxY);
  const maxY = Math.max(frontMaxY, -frontMinY);
  const labelHeight = 8;
  return {
    x: -artboardWidth / 2,
    y: minY - labelHeight,
    width: artboardWidth,
    height: maxY - minY + labelHeight,
  };
}

/**
 * Return one high-resolution orthographic face from the same SVG that is used
 * by the production export. Keeping this as a crop of projectToSvg avoids a
 * second, report-only interpretation of text, paths, colors, or the rim.
 */
export function projectFaceToTechnicalSvg(project, face = 'front') {
  const selectedFace = face === 'back' ? 'back' : 'front';
  // Element coordinates are authored in an upright, readable face workspace.
  // The production compiler reflects back-face geometry into the build plane,
  // but a customer drawing should keep the ribbon attachment at the top. Build
  // either face through the SVG engine's upright artboard, retaining the exact
  // authored paths, colors, transforms, and operations.
  const faceProject = {
    ...project,
    // Raised edge treatments are applied to the front surface by the solid
    // compiler. The reverse uses the same base body and ribbon attachment but
    // must not inherit a decorative front rim in its technical drawing.
    medal: selectedFace === 'back'
      ? { ...project.medal, rimWidth: 0, rimHeight: 0, attachmentHeight: 0 }
      : project.medal,
    elements: project.elements
      .filter(element => !element.hidden && (element.face === 'back' ? 'back' : 'front') === selectedFace)
      .map(element => selectedFace === 'back'
        ? { ...element, face: 'front', y: -element.y, rotation: -(element.rotation || 0) }
        : { ...element, face: 'front' }),
  };
  const dual = projectToSvg(faceProject);
  const marker = '<g data-artboard-face="front"';
  const start = dual.indexOf(marker);
  if (start < 0) throw new Error(`The ${selectedFace} technical view could not be extracted.`);
  const end = dual.indexOf('<g data-artboard-face="back"', start);
  let group = dual.slice(start, end).trim();
  if (selectedFace === 'back') {
    group = group
      .replace('data-artboard-face="front"', 'data-artboard-face="back"')
      .replace('<title>Front face</title>', '<title>Reverse face · ribbon-up outside view</title>')
      .replace('>FRONT</text>', '>REVERSE · OUTSIDE VIEW</text>')
      .replaceAll('data-face="front"', 'data-face="back"');
  }
  const layout = orthographicFaceLayout(project);
  const pixelWidth = Math.max(900, Math.ceil(layout.width * 20));
  const pixelHeight = Math.max(900, Math.ceil(layout.height * 20));
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${pixelWidth}" height="${pixelHeight}" viewBox="${layout.x} ${layout.y} ${layout.width} ${layout.height}" preserveAspectRatio="xMidYMid meet" data-technical-face="${selectedFace}" data-orientation="ribbon-up-outside-facing-readable">${group}</svg>`;
}

function faceSummary(project, face) {
  const elements = project.elements.filter(element => !element.hidden && (element.face === 'back' ? 'back' : 'front') === face);
  const textItems = [...new Set(elements.filter(element => element.type === 'text').map(element => String(element.text || '').trim()).filter(Boolean))];
  const slots = new Set([project.medal.baseColor]);
  if (project.medal.rimWidth > 0) slots.add(project.medal.rimColor);
  if (face === 'front' && Number.isInteger(project.medal.attachmentColor) && Number(project.medal.attachmentHeight) > 0) slots.add(project.medal.attachmentColor);
  elements.forEach(element => slots.add(element.color));
  return {
    elementCount: elements.length,
    textItems,
    colorSlots: [...slots].filter(Number.isInteger).sort((a, b) => a - b),
    attachmentCapSlot: face === 'front' && Number.isInteger(project.medal.attachmentColor) && Number(project.medal.attachmentHeight) > 0
      ? project.medal.attachmentColor
      : null,
    caption: textItems.slice(0, 3).join(' · ') || (elements.length ? `${elements.length} editable artwork objects` : 'Plain medal face'),
  };
}

export async function buildTechnicalSheetModel({ project, inventory, geometry = null, quantity = 25, checks = [] }) {
  const exportProject = enrichForExport(project, inventory);
  const quote = calculateQuote(project, inventory, quantity, geometry);
  const quoteTiers = [1, 10, 25, 50, 100].map(value => calculateQuote(project, inventory, value, geometry));
  const attachment = medalAttachmentGeometry(project);
  const face = physicalFaceDimensions(project);
  const bounds = geometry?.bounds;
  const width = bounds ? bounds.maxX - bounds.minX : Math.max(face.width, attachment.external ? attachment.outer.width : 0);
  const height = bounds ? bounds.maxY - bounds.minY : face.height + (attachment.external ? Math.max(0, -attachment.outer.y0 - face.height / 2) : 0);
  const depth = bounds
    ? bounds.maxZ - bounds.minZ
    : project.medal.baseThickness + Math.max(Number(project.medal.rimHeight) || 0, Number(project.medal.attachmentHeight) || 0);
  return {
    project: exportProject,
    quote,
    quoteTiers,
    quantity: Math.max(1, Number(quantity) || 1),
    attachment: ATTACHMENT_STYLE_INFO[attachment.style] || { label: attachment.style },
    dimensions: { width, height, depth, faceWidth: face.width, faceHeight: face.height },
    materials: meshMaterialRows(project, geometry, inventory),
    faces: {
      front: faceSummary(exportProject, 'front'),
      back: faceSummary(exportProject, 'back'),
    },
    checks: (checks || []).filter(check => check.level !== 'pass').slice(0, 5),
    hash: await shortProjectHash(exportProject),
    generatedAt: new Date(),
    exactGeometry: Boolean(geometry?.meshes?.length),
  };
}

function drawDimensionArrow(context, x0, y0, x1, y1, label, options = {}) {
  context.save();
  context.strokeStyle = options.color || '#3854b8';
  context.fillStyle = options.color || '#3854b8';
  context.lineWidth = 3;
  context.beginPath(); context.moveTo(x0, y0); context.lineTo(x1, y1); context.stroke();
  const angle = Math.atan2(y1 - y0, x1 - x0);
  for (const [x, y, direction] of [[x0, y0, 1], [x1, y1, -1]]) {
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(angle + .52) * 14 * direction, y + Math.sin(angle + .52) * 14 * direction);
    context.lineTo(x + Math.cos(angle - .52) * 14 * direction, y + Math.sin(angle - .52) * 14 * direction);
    context.closePath(); context.fill();
  }
  const horizontal = Math.abs(y1 - y0) < Math.abs(x1 - x0);
  text(context, label, (x0 + x1) / 2 + (horizontal ? 0 : 18), (y0 + y1) / 2 + (horizontal ? -12 : 8), 20, { color: options.color || '#3854b8', weight: 800, align: 'center' });
  context.restore();
}

function drawSideProfile(context, model, x, y, width, height) {
  const medal = model.project.medal;
  const baseColor = model.project.palette[medal.baseColor]?.color || '#252d2a';
  const rimColor = model.project.palette[medal.rimColor]?.color || baseColor;
  const centerY = y + height * .56;
  const slabWidth = width * .72;
  const basePx = clamp(medal.baseThickness / Math.max(1, model.dimensions.depth) * height * .28, 32, 94);
  const reliefPx = clamp(medal.rimHeight / Math.max(.2, model.dimensions.depth) * height * .28, 18, 70);
  const slabX = x + (width - slabWidth) / 2;
  context.save();
  roundedRect(context, slabX, centerY - basePx / 2, slabWidth, basePx, 10);
  context.fillStyle = baseColor; context.fill();
  context.fillStyle = rimColor;
  roundedRect(context, slabX, centerY - basePx / 2 - reliefPx, slabWidth * .13, reliefPx + 7, 6); context.fill();
  roundedRect(context, slabX + slabWidth * .87, centerY - basePx / 2 - reliefPx, slabWidth * .13, reliefPx + 7, 6); context.fill();
  context.strokeStyle = '#131c18'; context.lineWidth = 2; roundedRect(context, slabX, centerY - basePx / 2, slabWidth, basePx, 10); context.stroke();
  drawDimensionArrow(context, slabX, centerY + basePx / 2 + 42, slabX + slabWidth, centerY + basePx / 2 + 42, mm(model.dimensions.faceWidth));
  drawDimensionArrow(context, slabX - 36, centerY + basePx / 2, slabX - 36, centerY - basePx / 2 - reliefPx, mm(model.dimensions.depth));
  uppercaseLabel(context, 'Side profile · schematic', x + 26, y + 42);
  text(context, `${mm(medal.baseThickness)} body · ${mm(medal.rimHeight)} raised edge`, x + 26, y + height - 28, 20, { color: '#68736e' });
  context.restore();
}

function drawPaletteTable(context, model, x, y, width, height) {
  uppercaseLabel(context, 'Materials & color bodies', x + 26, y + 42);
  const rows = model.materials.slice(0, 7);
  const rowHeight = Math.min(61, (height - 70) / Math.max(1, rows.length));
  rows.forEach((row, index) => {
    const rowY = y + 62 + index * rowHeight;
    if (index) { context.strokeStyle = '#e4e8e3'; context.lineWidth = 2; context.beginPath(); context.moveTo(x + 24, rowY - 12); context.lineTo(x + width - 24, rowY - 12); context.stroke(); }
    context.fillStyle = row.color; roundedRect(context, x + 26, rowY, 34, 34, 8); context.fill();
    text(context, `${row.slot + 1} · ${row.name}`, x + 76, rowY + 16, 20, { weight: 800, maxWidth: width - 300 });
    text(context, `${row.material} · ${row.effect}${row.roles.length ? ` · ${row.roles.join(' + ')}` : ''}`, x + 76, rowY + 39, 16, { color: '#68736e', maxWidth: width - 300 });
    const amount = row.grams === null ? 'estimated use' : `${row.grams.toFixed(1)} g`;
    text(context, amount, x + width - 28, rowY + 25, 19, { align: 'right', weight: 800, color: '#3854b8' });
  });
}

export async function renderTechnicalSheetCanvas(model, options = {}) {
  if (typeof document === 'undefined') throw new Error('Technical-sheet rendering requires a browser canvas.');
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH; canvas.height = PAGE_HEIGHT;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f1f4f0'; context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  const [frontImage, backImage] = await Promise.all([
    imageFromSvg(projectFaceToTechnicalSvg(model.project, 'front')),
    imageFromSvg(projectFaceToTechnicalSvg(model.project, 'back')),
  ]);
  const viewImage = await imageFromSource(options.viewDataUrl).catch(() => null);

  context.fillStyle = '#17201c'; context.fillRect(0, 0, PAGE_WIDTH, 174);
  context.fillStyle = '#d9f36a'; roundedRect(context, 80, 47, 70, 70, 18); context.fill();
  text(context, 'M', 115, 84, 36, { align: 'center', baseline: 'middle', weight: 900, color: '#17201c' });
  uppercaseLabel(context, 'MedalForge · technical & quote sheet', 180, 68, { color: '#aab4ae', size: 20 });
  text(context, model.project.name, 180, 121, 43, { color: '#ffffff', weight: 800, maxWidth: 1420 });
  text(context, `PROJECT ${model.hash}`, PAGE_WIDTH - 80, 76, 20, { align: 'right', color: '#aab4ae', weight: 800 });
  text(context, model.generatedAt.toLocaleString('cs-CZ'), PAGE_WIDTH - 80, 116, 19, { align: 'right', color: '#ffffff', weight: 600 });

  card(context, 72, 214, 1510, 852);
  uppercaseLabel(context, 'Orthographic artwork · front and back', 106, 262);
  text(context, 'Two independent outside-facing views from the exact editable design. Reverse lettering is intentionally readable, never mirrored.', 106, 296, 20, { color: '#68736e', maxWidth: 1380 });
  context.strokeStyle = '#e0e5e0'; context.lineWidth = 2; context.beginPath(); context.moveTo(827, 330); context.lineTo(827, 1028); context.stroke();
  uppercaseLabel(context, 'Front face', 112, 346, { color: '#3854b8', size: 18 });
  text(context, model.faces.front.caption, 112, 376, 18, { color: '#53605a', weight: 700, maxWidth: 680 });
  fitImage(context, frontImage, 96, 388, 716, 640, 10);
  uppercaseLabel(context, 'Reverse · outside-facing · readable', 852, 346, { color: '#3854b8', size: 18 });
  text(context, model.faces.back.caption, 852, 376, 18, { color: '#53605a', weight: 700, maxWidth: 680 });
  fitImage(context, backImage, 836, 388, 716, 640, 10);

  card(context, 72, 1104, 740, 500);
  uppercaseLabel(context, 'Isometric product view', 104, 1150);
  if (viewImage) fitForegroundImage(context, viewImage, 92, 1170, 700, 405, 14);
  else {
    text(context, '3D view unavailable', 442, 1350, 26, { align: 'center', color: '#8b9690', weight: 700 });
    text(context, 'The orthographic and dimensional views remain authoritative.', 442, 1390, 17, { align: 'center', color: '#8b9690' });
  }
  text(context, 'Rendered locally from the same printable geometry used for export.', 104, 1575, 18, { color: '#68736e' });

  card(context, 842, 1104, 740, 500);
  drawSideProfile(context, model, 842, 1104, 740, 500);

  card(context, 1618, 214, 790, 266, { fill: '#ffffff' });
  uppercaseLabel(context, `Quote · ${model.quantity} piece${model.quantity === 1 ? '' : 's'}`, 1652, 262);
  text(context, money(model.quote.total), 1652, 342, 54, { weight: 900 });
  text(context, `${money(model.quote.unit)} per medal`, 1652, 382, 24, { color: '#3854b8', weight: 800 });
  text(context, `${model.quote.gramsPerPiece.toFixed(1)} g · ${Math.round(model.quote.minutesPerPiece)} min estimated machine time`, 1652, 430, 18, { color: '#68736e' });
  text(context, model.exactGeometry ? 'Weight from compiled material meshes' : 'Weight from dimensional estimate', 2372, 430, 16, { align: 'right', color: '#68736e', weight: 700 });

  card(context, 1618, 512, 790, 228);
  uppercaseLabel(context, 'Overall dimensions', 1652, 560);
  const metrics = [
    ['Width', mm(model.dimensions.width)], ['Height', mm(model.dimensions.height)], ['Max depth', mm(model.dimensions.depth, 2)],
    ['Face', `${mm(model.dimensions.faceWidth)} × ${mm(model.dimensions.faceHeight)}`], ['Attachment', model.attachment.label], ['Edge', `${RIM_STYLE_INFO[model.project.medal.rimStyle]?.label || model.project.medal.rimStyle} · ${mm(model.project.medal.rimWidth)}`],
  ];
  metrics.forEach(([label, value], index) => {
    const column = index % 3, row = Math.floor(index / 3);
    const metricX = 1652 + column * 244, metricY = 602 + row * 74;
    uppercaseLabel(context, label, metricX, metricY, { size: 15 });
    text(context, value, metricX, metricY + 28, 20, { weight: 800, maxWidth: 218 });
  });

  card(context, 1618, 772, 790, 252);
  uppercaseLabel(context, 'Print profile & quantity ladder', 1652, 820);
  text(context, `${model.project.profile.nozzle.toFixed(1)} mm nozzle`, 1652, 861, 21, { weight: 800 });
  text(context, `${model.project.profile.layerHeight.toFixed(2)} mm layers · ${model.project.profile.meshQuality} mesh`, 1880, 861, 21, { weight: 800 });
  text(context, `${model.project.paletteIds.length} configured colors · ${model.materials.length} used`, 1652, 900, 18, { color: '#68736e' });
  const ladderY = 942;
  model.quoteTiers.forEach((tier, index) => {
    const ladderX = 1652 + index * 143;
    text(context, `${tier.quantity}×`, ladderX, ladderY, 16, { color: '#68736e', weight: 800 });
    text(context, money(tier.unit), ladderX, ladderY + 28, 18, { weight: 900 });
  });

  card(context, 1618, 1056, 790, 360);
  drawPaletteTable(context, model, 1618, 1056, 790, 360);

  card(context, 1618, 1448, 790, 156, { fill: model.checks.length ? '#fff8e8' : '#edf7ed', stroke: false, shadow: false });
  uppercaseLabel(context, model.checks.length ? 'Manufacturing notes' : 'Manufacturing preflight', 1652, 1492, { color: model.checks.length ? '#8a6725' : '#397349' });
  const note = model.checks.length
    ? model.checks.map(check => `${check.title}: ${check.message}`).join('  •  ')
    : 'No current blockers or cautions. Final slicer preview and a tested printer profile are still required before production.';
  wrapText(context, note, 1652, 1530, 720, 25, { size: 17, maxLines: 3, color: model.checks.length ? '#725a2a' : '#397349', weight: 600 });

  context.strokeStyle = '#d7ddd7'; context.lineWidth = 2; context.beginPath(); context.moveTo(72, 1650); context.lineTo(PAGE_WIDTH - 72, 1650); context.stroke();
  text(context, 'ESTIMATE · Confirm final time, purge, support, tax, ribbon, packaging, and shipping in the production slicer and order review.', 72, 1694, 17, { color: '#68736e', weight: 700, maxWidth: 1800 });
  text(context, 'Generated locally · no design uploaded', PAGE_WIDTH - 72, 1694, 17, { align: 'right', color: '#3854b8', weight: 800 });
  return canvas;
}

function binaryStringToBytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
  return bytes;
}

function concatenate(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export function jpegToSinglePagePdf(jpegBytes, pixelWidth, pixelHeight) {
  const image = jpegBytes instanceof Uint8Array ? jpegBytes : new Uint8Array(jpegBytes || []);
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8) throw new Error('The technical-sheet page is not a valid JPEG image.');
  const content = `q\n${PDF_WIDTH_PT} 0 0 ${PDF_HEIGHT_PT} 0 0 cm\n/Sheet Do\nQ\n`;
  const objects = [
    encoder.encode('<< /Type /Catalog /Pages 2 0 R >>'),
    encoder.encode('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH_PT} ${PDF_HEIGHT_PT}] /Resources << /XObject << /Sheet 4 0 R >> >> /Contents 5 0 R >>`),
    concatenate([encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${Math.max(1, Math.floor(pixelWidth))} /Height ${Math.max(1, Math.floor(pixelHeight))} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, encoder.encode('\nendstream')]),
    encoder.encode(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`),
  ];
  const chunks = [binaryStringToBytes('%PDF-1.4\n%âãÏÓ\n')];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const wrapped = concatenate([encoder.encode(`${index + 1} 0 obj\n`), object, encoder.encode('\nendobj\n')]);
    chunks.push(wrapped); length += wrapped.length;
  });
  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(encoder.encode(xref));
  return new Blob(chunks, { type: 'application/pdf' });
}

function canvasToJpegBytes(canvas, quality = .94) {
  const dataUrl = canvas.toDataURL('image/jpeg', clamp(quality, .72, .99));
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

export async function buildTechnicalSheetPdf(options) {
  const model = await buildTechnicalSheetModel(options);
  const canvas = await renderTechnicalSheetCanvas(model, options);
  const jpeg = canvasToJpegBytes(canvas, options.jpegQuality || .94);
  return {
    blob: jpegToSinglePagePdf(jpeg, canvas.width, canvas.height),
    filename: `${safeFilename(model.project.name)}-technical-quote.pdf`,
    previewDataUrl: canvas.toDataURL('image/jpeg', .82),
    model,
  };
}
