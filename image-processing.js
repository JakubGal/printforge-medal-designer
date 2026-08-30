function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function cloneRaster(imageData) {
  return {
    width: Math.max(1, Math.floor(Number(imageData?.width) || 1)),
    height: Math.max(1, Math.floor(Number(imageData?.height) || 1)),
    data: new Uint8ClampedArray(imageData?.data || 4),
  };
}

function luminance(red, green, blue) {
  return red * .2126 + green * .7152 + blue * .0722;
}

function rgbToLab(red, green, blue) {
  const linear = value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  };
  const r = linear(red), g = linear(green), b = linear(blue);
  const x = (r * .4124564 + g * .3575761 + b * .1804375) / .95047;
  const y = r * .2126729 + g * .7151522 + b * .072175;
  const z = (r * .0193339 + g * .119192 + b * .9503041) / 1.08883;
  const pivot = value => value > .008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = pivot(x), fy = pivot(y), fz = pivot(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labDistanceSquared(left, right) {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2 + (left[2] - right[2]) ** 2;
}

function rgbHex(red, green, blue) {
  return `#${[red, green, blue].map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
}

function hexRgb(value) {
  const text = String(value || '').replace('#', '');
  const full = text.length === 3 ? text.split('').map(character => character + character).join('') : text.padEnd(6, '0');
  return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0];
}

function convexHull(points) {
  const sorted = [...new Map(points.map(point => [`${point[0]}:${point[1]}`, point])).values()]
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  if (sorted.length <= 2) return sorted;
  const cross = (origin, left, right) => (left[0] - origin[0]) * (right[1] - origin[1]) - (left[1] - origin[1]) * (right[0] - origin[0]);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

function rasterFootprintFromRows(rows, sourceWidth, sourceHeight, requestedBounds = null) {
  if (!rows.size) return [];
  const occupiedMinX = Math.min(...[...rows.values()].map(row => row.minX));
  const occupiedMaxX = Math.max(...[...rows.values()].map(row => row.maxX));
  const occupiedMinY = Math.min(...rows.keys()), occupiedMaxY = Math.max(...rows.keys());
  const bounds = requestedBounds && typeof requestedBounds === 'object' ? requestedBounds : {};
  const minXValue = Number(bounds.minX), minYValue = Number(bounds.minY);
  const minX = Math.max(0, Math.min(sourceWidth - 1, Math.floor(Number.isFinite(minXValue) ? minXValue : occupiedMinX)));
  const minY = Math.max(0, Math.min(sourceHeight - 1, Math.floor(Number.isFinite(minYValue) ? minYValue : occupiedMinY)));
  const maxX = Math.max(minX, Math.min(sourceWidth - 1, Math.floor(Number.isFinite(Number(bounds.maxX)) ? Number(bounds.maxX) : occupiedMaxX)));
  const maxY = Math.max(minY, Math.min(sourceHeight - 1, Math.floor(Number.isFinite(Number(bounds.maxY)) ? Number(bounds.maxY) : occupiedMaxY)));
  const points = [];
  for (const [y, row] of rows) {
    points.push([row.minX, y], [row.minX, y + 1], [row.maxX + 1, y], [row.maxX + 1, y + 1]);
  }
  const hull = convexHull(points);
  const boxWidth = maxX - minX + 1, boxHeight = maxY - minY + 1;
  // Falling back to the full box for pathologically noisy silhouettes is
  // conservative. Normal text, icons, moons, and runners produce tens rather
  // than hundreds of convex boundary points.
  const safeHull = hull.length >= 3 && hull.length <= 512 ? hull : [[minX, minY], [maxX + 1, minY], [maxX + 1, maxY + 1], [minX, maxY + 1]];
  return safeHull.map(([x, y]) => [
    Math.round(((x - minX) / boxWidth - .5) * 1e5) / 1e5,
    Math.round(((y - minY) / boxHeight - .5) * 1e5) / 1e5,
  ]);
}

/** Compact, conservative normalized footprint for one segmented raster part. */
export function rasterRegionFootprint(pixelIndices, requestedWidth, requestedHeight, bounds = null) {
  const width = Math.max(1, Math.floor(Number(requestedWidth) || 1));
  const height = Math.max(1, Math.floor(Number(requestedHeight) || 1));
  const rows = new Map();
  for (const rawIndex of pixelIndices || []) {
    const index = Math.floor(Number(rawIndex));
    if (!Number.isInteger(index) || index < 0 || index >= width * height) continue;
    const x = index % width, y = Math.floor(index / width);
    const row = rows.get(y) || { minX: x, maxX: x };
    row.minX = Math.min(row.minX, x); row.maxX = Math.max(row.maxX, x); rows.set(y, row);
  }
  return rasterFootprintFromRows(rows, width, height, bounds);
}

/** Normalized visible-pixel footprint for a palette-indexed raster. */
export function indexedRasterFootprint(indexData, requestedWidth, requestedHeight, transparentIndex = 255) {
  const width = Math.max(1, Math.floor(Number(requestedWidth) || 1));
  const height = Math.max(1, Math.floor(Number(requestedHeight) || 1));
  const indices = indexData instanceof Uint8Array ? indexData : new Uint8Array(indexData || 0);
  if (indices.length !== width * height) return [];
  const rows = new Map();
  for (let index = 0; index < indices.length; index += 1) {
    if (indices[index] === transparentIndex) continue;
    const x = index % width, y = Math.floor(index / width);
    const row = rows.get(y) || { minX: x, maxX: x };
    row.minX = Math.min(row.minX, x); row.maxX = Math.max(row.maxX, x); rows.set(y, row);
  }
  return rasterFootprintFromRows(rows, width, height, { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 });
}

/** Remove square-crop corners outside a detected circular medal face. */
export function maskOutsideCircularFace(imageData, options = {}) {
  const raster = cloneRaster(imageData), { data, width, height } = raster;
  const radius = Math.max(.4, Math.min(.5, Number(options.radius) || .492));
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const dx = (x + .5) / width - .5, dy = (y + .5) / height - .5;
    if (dx * dx + dy * dy <= radius * radius) continue;
    data[(y * width + x) * 4 + 3] = 0;
  }
  return raster;
}

/**
 * Infer a compact perceptual palette from the actual circular medal face.
 * A weighted Lab k-means keeps small but important accent colors (gold text,
 * red roofs, white lettering) from being swallowed by a dominant black base.
 */
export function inferDominantSourceColors(imageData, options = {}) {
  const raster = cloneRaster(imageData), { data, width, height } = raster;
  const crop = Array.isArray(options.crop) && options.crop.length === 4 ? options.crop : [0, 0, 1, 1];
  const left = Math.max(0, Math.min(width - 1, Math.floor(crop[0] * width)));
  const top = Math.max(0, Math.min(height - 1, Math.floor(crop[1] * height)));
  const right = Math.max(left + 1, Math.min(width, Math.ceil(crop[2] * width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.ceil(crop[3] * height)));
  const cropWidth = right - left, cropHeight = bottom - top;
  const stride = Math.max(1, Math.floor(Math.sqrt(cropWidth * cropHeight / 120_000)));
  const buckets = new Map(); let sampled = 0;
  for (let y = top; y < bottom; y += stride) for (let x = left; x < right; x += stride) {
    if (options.circular !== false) {
      const dx = (x + .5 - (left + right) / 2) / Math.max(1, cropWidth / 2);
      const dy = (y + .5 - (top + bottom) / 2) / Math.max(1, cropHeight / 2);
      if (dx * dx + dy * dy > .98 ** 2) continue;
    }
    const offset = (y * width + x) * 4;
    if (data[offset + 3] < 32) continue;
    const red = data[offset], green = data[offset + 1], blue = data[offset + 2];
    const key = `${red >> 4}:${green >> 4}:${blue >> 4}`;
    const bucket = buckets.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1; bucket.red += red; bucket.green += green; bucket.blue += blue;
    buckets.set(key, bucket); sampled += 1;
  }
  if (!sampled || !buckets.size) return [];
  const points = [...buckets.values()].map(bucket => {
    const rgb = [bucket.red / bucket.count, bucket.green / bucket.count, bucket.blue / bucket.count];
    return { ...bucket, rgb, lab: rgbToLab(...rgb) };
  }).sort((leftPoint, rightPoint) => rightPoint.count - leftPoint.count);
  const requested = Math.max(2, Math.min(8, Math.floor(Number(options.maxColors) || 5), points.length));
  const centers = [{ lab: [...points[0].lab] }];
  while (centers.length < requested) {
    const candidate = points.reduce((best, point) => {
      const distance = Math.min(...centers.map(center => labDistanceSquared(point.lab, center.lab)));
      const score = distance * Math.sqrt(point.count / sampled);
      return !best || score > best.score ? { point, score } : best;
    }, null);
    if (!candidate || candidate.score < 4) break;
    centers.push({ lab: [...candidate.point.lab] });
  }
  let assignments = [];
  for (let iteration = 0; iteration < 9; iteration += 1) {
    assignments = centers.map(() => []);
    for (const point of points) {
      let nearest = 0, distance = Number.POSITIVE_INFINITY;
      centers.forEach((center, index) => {
        const candidate = labDistanceSquared(point.lab, center.lab);
        if (candidate < distance) { distance = candidate; nearest = index; }
      });
      assignments[nearest].push(point);
    }
    centers.forEach((center, index) => {
      const group = assignments[index], weight = group.reduce((sum, point) => sum + point.count, 0);
      if (!weight) return;
      center.lab = [0, 1, 2].map(channel => group.reduce((sum, point) => sum + point.lab[channel] * point.count, 0) / weight);
    });
  }
  return assignments.map(group => {
    const count = group.reduce((sum, point) => sum + point.count, 0);
    const rgb = [0, 1, 2].map(channel => group.reduce((sum, point) => sum + point.rgb[channel] * point.count, 0) / Math.max(1, count));
    const lab = rgbToLab(...rgb);
    return { rgb: rgb.map(Math.round), hex: rgbHex(...rgb), lab, coverage: count / sampled, lightness: lab[0], chroma: Math.hypot(lab[1], lab[2]) };
  }).filter(color => color.coverage >= (Number(options.minimumCoverage) || .006))
    .sort((leftColor, rightColor) => rightColor.coverage * (1 + rightColor.chroma / 90) - leftColor.coverage * (1 + leftColor.chroma / 90));
}

function robustDominantSampleColor(samples) {
  if (!samples.length) return null;
  const buckets = new Map();
  for (const rgb of samples) {
    const lab = rgbToLab(...rgb);
    // Coarse perceptual buckets absorb matte-filament texture, layer lines,
    // highlights, and studio noise without merging genuinely different inks.
    const key = `${Math.round(lab[0] / 9)}:${Math.round(lab[1] / 12)}:${Math.round(lab[2] / 12)}`;
    const bucket = buckets.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1; bucket.red += rgb[0]; bucket.green += rgb[1]; bucket.blue += rgb[2];
    buckets.set(key, bucket);
  }
  const dominant = [...buckets.values()].sort((left, right) => right.count - left.count)[0];
  if (!dominant) return null;
  let rgb = [dominant.red / dominant.count, dominant.green / dominant.count, dominant.blue / dominant.count];
  let lab = rgbToLab(...rgb);
  // Refine around the mode so nearby shaded pixels contribute while bright
  // letters and saturated icons remain excluded.
  const neighbors = samples.filter(sample => labDistanceSquared(rgbToLab(...sample), lab) <= 18 ** 2);
  if (neighbors.length) {
    rgb = [0, 1, 2].map(channel => neighbors.reduce((sum, sample) => sum + sample[channel], 0) / neighbors.length);
    lab = rgbToLab(...rgb);
  }
  return {
    rgb: rgb.map(Math.round), hex: rgbHex(...rgb), lab,
    coverage: dominant.count / samples.length,
    lightness: lab[0], chroma: Math.hypot(lab[1], lab[2]),
  };
}

/**
 * Read body and rim colors from the untouched medal photograph. Cleanup is
 * intentionally not involved: connected-background removal often erases a
 * black medal face because that face touches the detected circular boundary.
 */
export function inferMedalSurfaceColors(imageData, options = {}) {
  const raster = cloneRaster(imageData), { data, width, height } = raster;
  const crop = Array.isArray(options.crop) && options.crop.length === 4 ? options.crop : [0, 0, 1, 1];
  const left = Math.max(0, Math.min(width - 1, Math.floor(crop[0] * width)));
  const top = Math.max(0, Math.min(height - 1, Math.floor(crop[1] * height)));
  const right = Math.max(left + 1, Math.min(width, Math.ceil(crop[2] * width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.ceil(crop[3] * height)));
  const cropWidth = right - left, cropHeight = bottom - top;
  const centerX = (left + right) / 2, centerY = (top + bottom) / 2;
  const stride = Math.max(1, Math.floor(Math.sqrt(cropWidth * cropHeight / 100_000)));
  const interior = [], annulus = [];
  for (let y = top; y < bottom; y += stride) for (let x = left; x < right; x += stride) {
    const dx = (x + .5 - centerX) / Math.max(1, cropWidth / 2);
    const dy = (y + .5 - centerY) / Math.max(1, cropHeight / 2);
    const radius = Math.hypot(dx, dy);
    const offset = (y * width + x) * 4;
    if (data[offset + 3] < 32) continue;
    const rgb = [data[offset], data[offset + 1], data[offset + 2]];
    if (radius <= .76 && radius >= .08) interior.push(rgb);
    if (radius >= .84 && radius <= .965) annulus.push(rgb);
  }
  const base = robustDominantSampleColor(interior);
  const rim = robustDominantSampleColor(annulus) || base;
  return { base, rim, sampleCounts: { interior: interior.length, annulus: annulus.length } };
}

/** Match inferred source colors to real local filament records. */
export function matchSourceColorsToFilaments(sourceColors, inventory, existingIds = [], options = {}) {
  const records = Array.isArray(inventory) ? inventory.filter(item => item && typeof item.id === 'string' && /^#[0-9a-f]{6}$/i.test(String(item.color || ''))) : [];
  const candidates = records;
  const existing = new Set(Array.isArray(existingIds) ? existingIds : []);
  const requestedTotal = Number(options.maxTotalColors), requestedAdditions = Number(options.maxAdditions);
  const maximumTotal = Math.max(existing.size, Math.min(8, Math.floor(Number.isFinite(requestedTotal) ? requestedTotal : 6)));
  const maximumAdditions = Math.max(0, Math.min(5, Math.floor(Number.isFinite(requestedAdditions) ? requestedAdditions : 4)));
  const requestedDistance = Number(options.maximumDistance), requestedPenalty = Number(options.unavailablePenalty);
  const threshold = Number.isFinite(requestedDistance) ? requestedDistance : 38;
  const unavailablePenalty = Math.max(0, Number.isFinite(requestedPenalty) ? requestedPenalty : 4);
  const matches = [], additions = [];
  for (const source of Array.isArray(sourceColors) ? sourceColors : []) {
    const sourceLab = Array.isArray(source.lab) ? source.lab : rgbToLab(...(source.rgb || hexRgb(source.hex)));
    let best = null;
    for (const filament of candidates) {
      const distance = Math.sqrt(labDistanceSquared(sourceLab, rgbToLab(...hexRgb(filament.color))));
      const available = filament.stockKnown !== false && Number(filament.stockGrams) > 0;
      const score = distance + (available ? 0 : unavailablePenalty);
      if (!best || score < best.score) best = { id: filament.id, name: filament.name, color: filament.color, sourceHex: source.hex || rgbHex(...source.rgb), distance, score, available, coverage: source.coverage || 0 };
    }
    if (!best || best.score > threshold) continue;
    matches.push(best);
    if (existing.has(best.id) || additions.includes(best.id) || additions.length >= maximumAdditions || existing.size + additions.length >= maximumTotal) continue;
    additions.push(best.id);
  }
  return { matches, addIds: additions };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function borderBackgroundModel(data, width, height) {
  const buckets = new Map();
  const samples = [];
  const add = (x, y) => {
    const offset = (y * width + x) * 4;
    if (data[offset + 3] < 16) return;
    const color = [data[offset], data[offset + 1], data[offset + 2]];
    const key = `${color[0] >> 4}-${color[1] >> 4}-${color[2] >> 4}`;
    const bucket = buckets.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += color[0];
    bucket.green += color[1];
    bucket.blue += color[2];
    buckets.set(key, bucket);
    samples.push(color);
  };
  for (let x = 0; x < width; x += 1) { add(x, 0); if (height > 1) add(x, height - 1); }
  for (let y = 1; y < height - 1; y += 1) { add(0, y); if (width > 1) add(width - 1, y); }
  if (!samples.length) return null;
  const dominant = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  const robustCenter = [0, 1, 2].map(channel => median(samples.map(color => color[channel])));
  const centerDistances = samples.map(color => Math.hypot(
    color[0] - robustCenter[0], color[1] - robustCenter[1], color[2] - robustCenter[2],
  )).sort((a, b) => a - b);
  const centerMedian = centerDistances[Math.floor(centerDistances.length * .5)] || 0;
  const centerP85 = centerDistances[Math.min(centerDistances.length - 1, Math.floor(centerDistances.length * .85))] || 0;
  // A studio sweep can span many quantized buckets even though it is one smooth
  // background. Prefer its robust center when most border samples still form a
  // coherent color family. Otherwise retain the original dominant-cluster
  // safeguard for photos whose border contains unrelated objects.
  const coherentGradient = centerMedian <= 48 && centerP85 <= 112;
  if (!coherentGradient && (!dominant || dominant.count / samples.length < .13)) return null;
  const target = coherentGradient
    ? robustCenter
    : [dominant.red / dominant.count, dominant.green / dominant.count, dominant.blue / dominant.count];
  const distances = samples.map(color => Math.hypot(
    color[0] - target[0], color[1] - target[1], color[2] - target[2],
  )).sort((a, b) => a - b);
  return {
    target,
    spread: distances[Math.min(distances.length - 1, Math.floor(distances.length * .7))] || 0,
  };
}

function detectMedalCircleByEdges(imageData, options = {}) {
  const { data, width, height } = cloneRaster(imageData);
  const minimumSide = Math.min(width, height);
  if (minimumSide < 32) return null;
  const colorDistance = (ax, ay, bx, by) => {
    const left = (Math.max(0, Math.min(height - 1, Math.round(ay))) * width + Math.max(0, Math.min(width - 1, Math.round(ax)))) * 4;
    const right = (Math.max(0, Math.min(height - 1, Math.round(by))) * width + Math.max(0, Math.min(width - 1, Math.round(bx)))) * 4;
    const red = data[left] - data[right], green = data[left + 1] - data[right + 1], blue = data[left + 2] - data[right + 2];
    return Math.sqrt(red * red * .3 + green * green * .59 + blue * blue * .11) / 255;
  };
  const scoreCircle = (centerX, centerY, radius, angleCount = 44) => {
    const edges = [], offsets = [];
    const radialOffsets = [-.075, -.05, -.025, 0, .025, .05, .075];
    const delta = Math.max(1, radius * .012);
    for (let angleIndex = 0; angleIndex < angleCount; angleIndex += 1) {
      const angle = angleIndex / angleCount * Math.PI * 2, cosine = Math.cos(angle), sine = Math.sin(angle);
      let bestEdge = 0, bestOffset = 0;
      for (const offset of radialOffsets) {
        const ring = radius * (1 + offset);
        const edge = colorDistance(centerX + cosine * (ring - delta), centerY + sine * (ring - delta), centerX + cosine * (ring + delta), centerY + sine * (ring + delta));
        if (edge > bestEdge) { bestEdge = edge; bestOffset = offset; }
      }
      edges.push(bestEdge); offsets.push(bestOffset);
    }
    edges.sort((a, b) => a - b);
    const q25 = edges[Math.floor(edges.length * .25)] || 0;
    const medianEdge = edges[Math.floor(edges.length * .5)] || 0;
    const coverage = edges.filter(edge => edge >= .055).length / edges.length;
    const meanOffset = offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
    const offsetSpread = Math.sqrt(offsets.reduce((sum, value) => sum + (value - meanOffset) ** 2, 0) / offsets.length);
    return q25 * .72 + medianEdge * .42 + coverage * .11 - offsetSpread * .48;
  };
  const centerStep = Math.max(7, minimumSide / 30), radiusStep = Math.max(6, minimumSide / 42);
  let best = null;
  const inspect = (centerX, centerY, radius, angleCount) => {
    if (centerX - radius < 0 || centerX + radius >= width || centerY - radius < 0 || centerY + radius >= height) return;
    const score = scoreCircle(centerX, centerY, radius, angleCount);
    if (!best || score > best.score) best = { centerX, centerY, radius, score };
  };
  for (let radius = minimumSide * .23; radius <= minimumSide * .47; radius += radiusStep) {
    for (let centerY = radius; centerY <= height - radius; centerY += centerStep) {
      for (let centerX = radius; centerX <= width - radius; centerX += centerStep) inspect(centerX, centerY, radius, 36);
    }
  }
  if (!best) return null;
  const seed = best, fine = Math.max(2, centerStep / 5), fineRadius = Math.max(2, radiusStep / 5);
  for (let radius = seed.radius - radiusStep; radius <= seed.radius + radiusStep; radius += fineRadius) {
    for (let centerY = seed.centerY - centerStep; centerY <= seed.centerY + centerStep; centerY += fine) {
      for (let centerX = seed.centerX - centerStep; centerX <= seed.centerX + centerStep; centerX += fine) inspect(centerX, centerY, radius, 64);
    }
  }
  const minimumScore = Number(options.edgeMinimumScore) || .115;
  if (!best || best.score < minimumScore) return null;
  const confidence = Math.max(.58, Math.min(.94, .58 + (best.score - minimumScore) * 1.8));
  const padding = clamp(options.padding ?? .015, 0, .08) * best.radius;
  return {
    crop: [
      Math.max(0, best.centerX - best.radius - padding) / width,
      Math.max(0, best.centerY - best.radius - padding) / height,
      Math.min(width, best.centerX + best.radius + padding) / width,
      Math.min(height, best.centerY + best.radius + padding) / height,
    ],
    centerX: best.centerX / width,
    centerY: best.centerY / height,
    radius: best.radius / minimumSide,
    confidence,
    method: 'circular-edge',
  };
}

/**
 * Remove only pixels connected to the outer border. This avoids punching holes
 * through same-colored details in the middle of logos and photographs.
 */
export function removeConnectedBackground(imageData, options = {}) {
  const output = cloneRaster(imageData);
  const { data, width, height } = output;
  const mode = ['keep', 'auto', 'light', 'dark'].includes(options.mode) ? options.mode : 'auto';
  if (mode === 'keep') return output;
  if (mode === 'auto') {
    let transparent = 0, border = 0;
    const count = (x, y) => { border += 1; if (data[(y * width + x) * 4 + 3] < 16) transparent += 1; };
    for (let x = 0; x < width; x += 1) { count(x, 0); if (height > 1) count(x, height - 1); }
    for (let y = 1; y < height - 1; y += 1) { count(0, y); if (width > 1) count(width - 1, y); }
    if (border && transparent / border >= .55) return output;
  }
  const background = mode === 'light'
    ? { target: [255, 255, 255], spread: 0 }
    : mode === 'dark'
      ? { target: [0, 0, 0], spread: 0 }
      : borderBackgroundModel(data, width, height);
  if (!background) return output;
  const { target } = background;
  const tolerance = clamp(options.tolerance ?? 38, 4, 140);
  // Auto mode may walk across a smooth studio gradient, but every step must be
  // locally similar and remain inside a bounded radius around the robust border
  // color. This removes soft backdrops without letting the flood fill drift
  // through shadows into a dark medal or logo.
  const adaptiveStep = clamp(options.adaptiveStep ?? tolerance * .72, 12, 34);
  const adaptiveReach = clamp(Math.max(tolerance * 3.2, background.spread * 1.8), tolerance, 196);
  const colorDistance = (index, color) => {
    const offset = index * 4;
    return Math.hypot(data[offset] - color[0], data[offset + 1] - color[1], data[offset + 2] - color[2]);
  };
  const matches = (index, parent = -1) => {
    const offset = index * 4;
    if (data[offset + 3] < 16) return true;
    const distance = colorDistance(index, target);
    if (mode === 'light' && luminance(data[offset], data[offset + 1], data[offset + 2]) < 150) return false;
    if (mode === 'dark' && luminance(data[offset], data[offset + 1], data[offset + 2]) > 110) return false;
    if (distance <= tolerance) return true;
    if (mode !== 'auto' || parent < 0 || distance > adaptiveReach || data[parent * 4 + 3] < 16) return false;
    const parentOffset = parent * 4;
    return Math.hypot(
      data[offset] - data[parentOffset],
      data[offset + 1] - data[parentOffset + 1],
      data[offset + 2] - data[parentOffset + 2],
    ) <= adaptiveStep;
  };
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  const enqueue = (index, parent = -1) => {
    if (index < 0 || index >= visited.length || visited[index] || !matches(index, parent)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y += 1) { enqueue(y * width); enqueue(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width, y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1, index);
    if (x + 1 < width) enqueue(index + 1, index);
    if (y > 0) enqueue(index - width, index);
    if (y + 1 < height) enqueue(index + width, index);
  }
  for (let index = 0; index < visited.length; index += 1) if (visited[index]) data[index * 4 + 3] = 0;
  return output;
}

/**
 * Return a normalized crop around visible artwork after the same conservative
 * edge-connected background removal used by the import studio. This makes
 * logos and generated icons arrive at a useful physical size without
 * destructively rewriting their source image.
 */
export function visibleArtworkCrop(imageData, options = {}) {
  const raster = options.background === 'keep'
    ? cloneRaster(imageData)
    : removeConnectedBackground(imageData, { mode: options.background || 'auto', tolerance: options.tolerance ?? 38 });
  const { data, width, height } = raster;
  let minX = width, minY = height, maxX = -1, maxY = -1, visible = 0;
  const alphaFloor = clamp(options.alphaFloor ?? 16, 1, 254);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < alphaFloor) continue;
      visible += 1;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  if (!visible || visible < width * height * .0005) return [0, 0, 1, 1];
  const contentWidth = maxX - minX + 1, contentHeight = maxY - minY + 1;
  const padding = clamp(options.padding ?? .06, 0, .25);
  const padX = Math.max(2, Math.round(contentWidth * padding));
  const padY = Math.max(2, Math.round(contentHeight * padding));
  minX = Math.max(0, minX - padX); minY = Math.max(0, minY - padY);
  maxX = Math.min(width - 1, maxX + padX); maxY = Math.min(height - 1, maxY + padY);
  const crop = [minX / width, minY / height, (maxX + 1) / width, (maxY + 1) / height];
  const retained = (crop[2] - crop[0]) * (crop[3] - crop[1]);
  return retained > .97 ? [0, 0, 1, 1] : crop;
}

/**
 * Find the circular product face inside a photograph or generated medal mockup.
 *
 * This intentionally uses the alpha silhouette produced by the conservative
 * border flood-fill rather than a heavyweight CV dependency.  A medal ribbon
 * or hanger may be connected above the disk; fitting the broad row spans lets
 * us ignore that narrower protrusion and return just the editable face.
 */
export function detectMedalFaceCrop(imageData, options = {}) {
  const raster = removeConnectedBackground(imageData, {
    mode: options.background || 'auto',
    tolerance: options.tolerance ?? 34,
  });
  const { data, width, height } = raster;
  if (width < 32 || height < 32) return null;
  const edgeFallback = () => detectMedalCircleByEdges(imageData, options);
  const rows = [];
  let visible = 0;
  for (let y = 0; y < height; y += 1) {
    let minX = width, maxX = -1, count = 0;
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < 16) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); count += 1; visible += 1;
    }
    rows.push({ y, minX, maxX, count, span: maxX >= minX ? maxX - minX + 1 : 0 });
  }
  const visibleRatio = visible / (width * height);
  if (visibleRatio < .08 || visibleRatio > .91) return edgeFallback();
  const maxSpan = Math.max(...rows.map(row => row.span));
  const minimumDiameter = Math.min(width, height) * (Number(options.minimumDiameterRatio) || .42);
  if (maxSpan < minimumDiameter) return edgeFallback();
  const broad = rows.filter(row => row.span >= maxSpan * .72 && row.count >= row.span * .42);
  if (broad.length < Math.max(5, Math.round(maxSpan * .12))) return edgeFallback();
  const centers = broad.map(row => (row.minX + row.maxX) / 2).sort((a, b) => a - b);
  const centerX = centers[Math.floor(centers.length / 2)];
  const widest = rows.filter(row => row.span >= maxSpan * .96);
  const centerY = widest.reduce((sum, row) => sum + row.y, 0) / Math.max(1, widest.length);
  const radius = maxSpan / 2;
  if (centerX - radius < -radius * .08 || centerX + radius > width + radius * .08
    || centerY - radius < -radius * .08 || centerY + radius > height + radius * .08) return edgeFallback();

  // Compare the observed silhouette width to a circle. Narrow connected
  // hangers above the disk contribute little error, while logos and rectangular
  // product photos fail this test decisively.
  let agreement = 0, samples = 0;
  const sampleStep = Math.max(1, Math.round(radius / 40));
  for (let y = Math.max(0, Math.round(centerY - radius)); y <= Math.min(height - 1, Math.round(centerY + radius)); y += sampleStep) {
    const relativeY = (y - centerY) / radius;
    const predicted = radius * 2 * Math.sqrt(Math.max(0, 1 - relativeY * relativeY));
    if (predicted < radius * .18) continue;
    const observed = rows[y].span;
    agreement += Math.max(0, 1 - Math.abs(observed - predicted) / Math.max(radius * .32, predicted));
    samples += 1;
  }
  const circularity = agreement / Math.max(1, samples);
  const aspectPenalty = Math.min(1, maxSpan / Math.max(1, broad.at(-1).y - broad[0].y + maxSpan * .3));
  const confidence = Math.max(0, Math.min(1, circularity * .82 + aspectPenalty * .18));
  const minimumConfidence = Number(options.minimumConfidence) || .76;
  if (confidence < minimumConfidence) {
    // A coherent but non-circular foreground (commonly a rectangular logo)
    // must not be rescued by the edge search just because its corners happen
    // to lie near one radius. Reserve that fallback for fragmented dark studio
    // renders where the foreground silhouette itself was unusable.
    if (confidence >= .52) return null;
    return edgeFallback();
  }
  const padding = clamp(options.padding ?? .015, 0, .08) * radius;
  const left = Math.max(0, centerX - radius - padding), top = Math.max(0, centerY - radius - padding);
  const right = Math.min(width, centerX + radius + padding), bottom = Math.min(height, centerY + radius + padding);
  return {
    crop: [left / width, top / height, right / width, bottom / height],
    centerX: centerX / width,
    centerY: centerY / height,
    radius: radius / Math.min(width, height),
    confidence,
    method: 'foreground-silhouette',
  };
}

function paletteComponents(indexData, width, height) {
  const indices = indexData instanceof Uint8Array ? indexData : new Uint8Array(indexData || 0);
  const visited = new Uint8Array(indices.length), components = [];
  for (let start = 0; start < indices.length; start += 1) {
    const slot = indices[start];
    if (slot === 255 || visited[start]) continue;
    const queue = [start], pixels = [];
    let minX = width, minY = height, maxX = -1, maxY = -1, sumX = 0, sumY = 0;
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor], x = index % width, y = Math.floor(index / width);
      pixels.push(index); sumX += x; sumY += y;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
        if ((!ox && !oy) || x + ox < 0 || y + oy < 0 || x + ox >= width || y + oy >= height) continue;
        const neighbor = (y + oy) * width + x + ox;
        if (visited[neighbor] || indices[neighbor] !== slot) continue;
        visited[neighbor] = 1; queue.push(neighbor);
      }
    }
    components.push({ id: components.length, slot, pixels, area: pixels.length, minX, minY, maxX, maxY, sumX, sumY });
  }
  return components;
}

/**
 * Locate rows of disconnected letter-like islands. This is geometry detection,
 * not cloud OCR: it works offline and deliberately returns editable text-line
 * suggestions without pretending it can reliably read stylised lettering.
 */
export function detectLikelyTextBands(indexData, requestedWidth, requestedHeight, options = {}) {
  const width = Math.max(1, Math.floor(Number(requestedWidth) || 1));
  const height = Math.max(1, Math.floor(Number(requestedHeight) || 1));
  const indices = indexData instanceof Uint8Array ? indexData : new Uint8Array(indexData || 0);
  if (indices.length !== width * height) throw new Error('Text detection dimensions do not match the pixel data.');
  const components = Array.isArray(options.components) ? options.components : paletteComponents(indices, width, height);
  const candidates = components.filter(component => {
    const boxWidth = component.maxX - component.minX + 1, boxHeight = component.maxY - component.minY + 1;
    const density = component.area / Math.max(1, boxWidth * boxHeight);
    const touchesEdge = component.minX === 0 || component.maxX === width - 1 || component.minY === 0 || component.maxY === height - 1;
    return !touchesEdge && boxHeight >= Math.max(2, height * .018) && boxHeight <= height * .21
      && boxWidth <= width * .48 && component.area >= 2
      && density >= .06 && (boxWidth / boxHeight <= 8 || density < .66);
  });
  const lines = [];
  for (const component of candidates.sort((left, right) => left.slot - right.slot || left.minY - right.minY || left.minX - right.minX)) {
    const boxHeight = component.maxY - component.minY + 1;
    const centerY = (component.minY + component.maxY) / 2;
    let line = lines.find(item => item.slot === component.slot
      && Math.abs(item.centerY - centerY) <= Math.max(3, Math.max(item.height, boxHeight) * .58));
    if (!line) {
      line = { slot: component.slot, components: [], centerY, height: boxHeight };
      lines.push(line);
    }
    line.components.push(component);
    const totalArea = line.components.reduce((sum, item) => sum + item.area, 0);
    line.centerY = line.components.reduce((sum, item) => sum + (item.minY + item.maxY) / 2 * item.area, 0) / totalArea;
    line.height = Math.max(...line.components.map(item => item.maxY - item.minY + 1));
  }
  const bands = [];
  for (const line of lines) {
    const sorted = [...line.components].sort((left, right) => left.minX - right.minX);
    const groups = [];
    for (const component of sorted) {
      const previous = groups.at(-1);
      const gap = previous ? component.minX - previous.maxX - 1 : 0;
      if (!previous || gap > Math.max(width * .09, line.height * 3.2)) groups.push({ components: [component], maxX: component.maxX });
      else { previous.components.push(component); previous.maxX = Math.max(previous.maxX, component.maxX); }
    }
    for (const group of groups) {
      const minX = Math.min(...group.components.map(item => item.minX)), minY = Math.min(...group.components.map(item => item.minY));
      const maxX = Math.max(...group.components.map(item => item.maxX)), maxY = Math.max(...group.components.map(item => item.maxY));
      const boxWidth = maxX - minX + 1, boxHeight = maxY - minY + 1;
      const area = group.components.reduce((sum, item) => sum + item.area, 0);
      const density = area / Math.max(1, boxWidth * boxHeight);
      const componentCount = group.components.length;
      const plausibleLetters = componentCount >= 3 && boxWidth >= width * .14 && boxHeight <= height * .22 && density <= .72;
      const connectedWord = componentCount <= 2 && boxWidth >= width * .18 && boxWidth / boxHeight >= 2.2 && density >= .08 && density <= .62;
      if (!plausibleLetters && !connectedWord) continue;
      const componentIds = group.components.map(item => item.id);
      bands.push({
        slot: line.slot,
        componentIds,
        pixels: group.components.flatMap(item => item.pixels),
        area,
        minX, minY, maxX, maxY,
        centerX: group.components.reduce((sum, item) => sum + item.sumX, 0) / area,
        centerY: group.components.reduce((sum, item) => sum + item.sumY, 0) / area,
        confidence: Math.max(.5, Math.min(.96, .52 + Math.min(8, componentCount) * .045 + Math.min(.16, boxWidth / width) * .8 - Math.max(0, density - .55))),
      });
    }
  }
  return bands.sort((left, right) => left.minY - right.minY || left.minX - right.minX);
}

/** Apply deterministic, local-only artwork effects before palette quantization. */
export function applyImageStyle(imageData, options = {}) {
  const source = cloneRaster(imageData);
  const style = ['color', 'silhouette', 'high-contrast', 'outline'].includes(options.style) ? options.style : 'color';
  if (style === 'color') return source;
  const { data, width, height } = source;
  const threshold = clamp(options.threshold ?? 138, 0, 255);
  const invert = Boolean(options.invert);
  if (style === 'silhouette') {
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset + 3] < 16) continue;
      const value = invert ? 255 : 0;
      data[offset] = value; data[offset + 1] = value; data[offset + 2] = value;
    }
    return source;
  }
  if (style === 'high-contrast') {
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset + 3] < 16) continue;
      const isLight = luminance(data[offset], data[offset + 1], data[offset + 2]) >= threshold;
      const value = (invert ? !isLight : isLight) ? 255 : 0;
      data[offset] = value; data[offset + 1] = value; data[offset + 2] = value;
    }
    return source;
  }
  const original = new Uint8ClampedArray(data);
  const edges = new Uint8Array(width * height);
  const contrast = 24 + Math.abs(threshold - 128) * .12;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x, offset = index * 4;
      if (original[offset + 3] < 16) continue;
      const center = luminance(original[offset], original[offset + 1], original[offset + 2]);
      const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      edges[index] = neighbors.some(([nx, ny]) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true;
        const neighborOffset = (ny * width + nx) * 4;
        if (original[neighborOffset + 3] < 16) return true;
        return Math.abs(center - luminance(original[neighborOffset], original[neighborOffset + 1], original[neighborOffset + 2])) >= contrast;
      }) ? 1 : 0;
    }
  }
  const radius = Math.max(0, Math.min(12, Math.round(Number(options.outlineRadius) || 1)));
  const dilated = new Uint8Array(edges);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!edges[y * width + x]) continue;
    for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) dilated[ny * width + nx] = 1;
    }
  }
  const value = invert ? 255 : 0;
  for (let index = 0; index < edges.length; index += 1) {
    const offset = index * 4;
    if (!dilated[index]) { data[offset + 3] = 0; continue; }
    data[offset] = value; data[offset + 1] = value; data[offset + 2] = value; data[offset + 3] = 255;
  }
  return source;
}

/**
 * Split a palette-indexed printable raster into a small set of useful editing
 * regions. Large connected shapes stay independent while tiny same-color
 * islands (letters, stars, texture) are collected into one editable detail
 * object instead of creating hundreds of CAD-tree rows.
 *
 * Index 255 is transparent. The returned pixel lists cover every visible
 * source pixel exactly once and regionMap makes hit-testing the preview O(1).
 */
export function segmentPaletteRegions(indexData, requestedWidth, requestedHeight, options = {}) {
  const width = Math.max(1, Math.floor(Number(requestedWidth) || 1));
  const height = Math.max(1, Math.floor(Number(requestedHeight) || 1));
  const expected = width * height;
  const indices = indexData instanceof Uint8Array ? indexData : new Uint8Array(indexData || 0);
  if (indices.length !== expected) throw new Error('Palette region dimensions do not match the pixel data.');
  const sourcePixels = options.sourcePixels instanceof Uint8ClampedArray && options.sourcePixels.length === expected * 4
    ? options.sourcePixels
    : null;
  const sourceColorTolerance = sourcePixels ? clamp(options.sourceColorTolerance ?? 34, 8, 120) : 0;
  const sourceColorToleranceSquared = sourceColorTolerance ** 2;
  const neighborColorToleranceSquared = (sourceColorTolerance * .72) ** 2;
  const sourceColorDistanceSquared = (left, right) => {
    const leftOffset = left * 4, rightOffset = right * 4;
    const red = sourcePixels[leftOffset] - sourcePixels[rightOffset];
    const green = sourcePixels[leftOffset + 1] - sourcePixels[rightOffset + 1];
    const blue = sourcePixels[leftOffset + 2] - sourcePixels[rightOffset + 2];
    return red * red * .30 + green * green * .59 + blue * blue * .11;
  };
  const maximumRegions = Math.max(2, Math.min(24, Math.floor(Number(options.maxRegions) || 14)));
  const visited = new Uint8Array(expected);
  const components = [];
  let visiblePixels = 0;

  for (let start = 0; start < expected; start += 1) {
    const slot = indices[start];
    if (slot === 255) continue;
    visiblePixels += 1;
    if (visited[start]) continue;
    const queue = [start], pixels = [];
    let minX = width, minY = height, maxX = -1, maxY = -1, sumX = 0, sumY = 0, borderMask = 0;
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor], x = index % width, y = Math.floor(index / width);
      pixels.push(index); sumX += x; sumY += y;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (x === 0) borderMask |= 1;
      if (x === width - 1) borderMask |= 2;
      if (y === 0) borderMask |= 4;
      if (y === height - 1) borderMask |= 8;
      for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
        if ((!ox && !oy) || (!options.diagonal && Math.abs(ox) + Math.abs(oy) !== 1) || x + ox < 0 || y + oy < 0 || x + ox >= width || y + oy >= height) continue;
        const neighbor = (y + oy) * width + x + ox;
        if (visited[neighbor] || indices[neighbor] !== slot) continue;
        // Palette reduction can map a navy runner and a navy sky to the same
        // filament. Preserve source-image boundaries so they remain selectable
        // as separate CAD objects, while still allowing gentle gradients inside
        // either object.
        if (sourcePixels && (sourceColorDistanceSquared(index, neighbor) > neighborColorToleranceSquared
          || sourceColorDistanceSquared(start, neighbor) > sourceColorToleranceSquared)) continue;
        visited[neighbor] = 1; queue.push(neighbor);
      }
    }
    components.push({ slot, pixels, area: pixels.length, minX, minY, maxX, maxY, sumX, sumY, borderMask, collection: false });
  }
  if (!visiblePixels) return { regions: [], regionMap: new Int16Array(expected).fill(-1), visiblePixels: 0 };

  components.sort((left, right) => right.area - left.area || left.slot - right.slot || left.minY - right.minY || left.minX - right.minX);
  components.forEach((component, id) => { component.id = id; });
  const textBands = options.detectText === false ? [] : detectLikelyTextBands(indices, width, height, { components });
  const textComponentIds = new Set(textBands.flatMap(band => band.componentIds));
  const visualComponents = components.filter(component => !textComponentIds.has(component.id));
  const slots = [...new Set(components.map(component => component.slot))];
  // Never sacrifice a filament color just to hit the spatial-part target.
  const effectiveMaximum = Math.min(24, Math.max(maximumRegions, slots.length, textBands.length + 2));
  const featureFloor = Math.max(6, Math.floor(visiblePixels * (Number(options.featureFraction) || .012)));
  let featured = visualComponents.filter(component => component.area >= featureFloor);
  // A sparse logo can have no component above a percentage threshold. Its
  // largest shape should still be directly selectable.
  if (!featured.length && visualComponents.length) featured = [visualComponents[0]];
  const reserveForDetails = Math.min(slots.length, Math.max(0, effectiveMaximum - textBands.length - 1));
  featured = featured.slice(0, Math.max(1, effectiveMaximum - textBands.length - reserveForDetails));
  const featuredSet = new Set(featured);
  const detailBuckets = new Map();
  for (const component of visualComponents) {
    if (featuredSet.has(component)) continue;
    // Spatial buckets keep a word, constellation, or texture locally editable
    // instead of giving one sparse detail object a full-canvas transform box.
    const tileX = Math.min(2, Math.floor(component.sumX / component.area / width * 3));
    const tileY = Math.min(2, Math.floor(component.sumY / component.area / height * 3));
    const bucketKey = `${component.slot}:${tileX}:${tileY}`;
    let bucket = detailBuckets.get(bucketKey);
    if (!bucket) {
      bucket = { slot: component.slot, pixels: [], area: 0, minX: width, minY: height, maxX: -1, maxY: -1, sumX: 0, sumY: 0, borderMask: 0, collection: true };
      detailBuckets.set(bucketKey, bucket);
    }
    bucket.pixels.push(...component.pixels); bucket.area += component.area;
    bucket.minX = Math.min(bucket.minX, component.minX); bucket.minY = Math.min(bucket.minY, component.minY);
    bucket.maxX = Math.max(bucket.maxX, component.maxX); bucket.maxY = Math.max(bucket.maxY, component.maxY);
    bucket.sumX += component.sumX; bucket.sumY += component.sumY; bucket.borderMask |= component.borderMask;
  }
  const textRegions = textBands.map((band, index) => ({
    ...band,
    sumX: band.centerX * band.area,
    sumY: band.centerY * band.area,
    borderMask: 0,
    collection: true,
    semantic: true,
    role: 'text',
    textLine: index + 1,
  }));
  let regions = [...textRegions, ...featured, ...detailBuckets.values()].filter(region => region.area > 0);
  if (regions.length > effectiveMaximum) {
    const byArea = [...regions].sort((left, right) => right.area - left.area || left.slot - right.slot || left.minY - right.minY || left.minX - right.minX);
    const kept = byArea.filter(region => region.semantic), keptSet = new Set(kept);
    // Reserve the largest object for every used filament slot first.
    for (const slot of slots) {
      const candidate = byArea.find(region => region.slot === slot && !keptSet.has(region));
      if (candidate && kept.length < effectiveMaximum) { kept.push(candidate); keptSet.add(candidate); }
    }
    for (const candidate of byArea) {
      if (kept.length >= effectiveMaximum) break;
      if (!keptSet.has(candidate)) { kept.push(candidate); keptSet.add(candidate); }
    }
    const centerDistance = (left, right) => {
      const leftX = left.sumX / left.area, leftY = left.sumY / left.area;
      const rightX = right.sumX / right.area, rightY = right.sumY / right.area;
      return (leftX - rightX) ** 2 + (leftY - rightY) ** 2;
    };
    for (const region of byArea) {
      if (keptSet.has(region)) continue;
      const candidates = kept.filter(candidate => candidate.slot === region.slot && !candidate.semantic);
      if (!candidates.length) continue;
      const target = candidates.sort((left, right) => centerDistance(left, region) - centerDistance(right, region) || left.minY - right.minY || left.minX - right.minX)[0];
      target.pixels.push(...region.pixels); target.area += region.area;
      target.minX = Math.min(target.minX, region.minX); target.minY = Math.min(target.minY, region.minY);
      target.maxX = Math.max(target.maxX, region.maxX); target.maxY = Math.max(target.maxY, region.maxY);
      target.sumX += region.sumX; target.sumY += region.sumY; target.borderMask |= region.borderMask; target.collection = true;
    }
    regions = kept;
  }
  regions.sort((left, right) => right.area - left.area || left.slot - right.slot || left.minY - right.minY || left.minX - right.minX);

  const bitCount = value => [1, 2, 4, 8].reduce((count, bit) => count + (value & bit ? 1 : 0), 0);
  const regionMetrics = region => {
    const boxWidth = region.maxX - region.minX + 1, boxHeight = region.maxY - region.minY + 1;
    const centerX = region.sumX / region.area, centerY = region.sumY / region.area;
    return {
      boxWidth, boxHeight, centerX, centerY,
      widthRatio: boxWidth / width, heightRatio: boxHeight / height,
      centerDistance: Math.hypot(centerX / Math.max(1, width - 1) - .5, centerY / Math.max(1, height - 1) - .5),
      coverage: region.area / visiblePixels,
      borderSides: bitCount(region.borderMask),
    };
  };
  const metrics = regions.map(regionMetrics);
  let backgroundIndex = -1, backgroundScore = 0;
  metrics.forEach((item, index) => {
    const score = (item.borderSides >= 2 ? 2 : item.borderSides ? .6 : 0) + item.coverage * 3 + item.widthRatio * item.heightRatio;
    if ((item.borderSides >= 2 || item.coverage >= .42) && score > backgroundScore) { backgroundIndex = index; backgroundScore = score; }
  });
  let subjectIndex = -1, subjectScore = -1;
  metrics.forEach((item, index) => {
    if (index === backgroundIndex || regions[index].role === 'text') return;
    // The primary object in medal art is commonly a centered person, animal,
    // logo, or trophy. Prefer that useful portrait-like shape over a larger
    // road/sky color field; raw area alone used to label a lower background
    // patch as the “Main subject”. Broad logos still score through centrality,
    // height, and a capped coverage bonus.
    const centrality = Math.max(0, 1 - item.centerDistance * 1.8);
    const verticality = Math.min(1.5, item.heightRatio / Math.max(.08, item.widthRatio));
    const score = centrality * 1.5
      + Math.min(.9, item.heightRatio) * 1.3
      + verticality * .35
      + Math.min(.18, item.coverage) * 2
      + (item.borderSides ? -.55 : .18)
      - Math.max(0, item.coverage - .32) * 3;
    if (score > subjectScore) { subjectIndex = index; subjectScore = score; }
  });

  const regionMap = new Int16Array(expected); regionMap.fill(-1);
  regions = regions.map((region, index) => {
    const item = metrics[index];
    let role = 'detail';
    if (region.role === 'text') role = 'text';
    else if (index === backgroundIndex) role = 'background';
    else if (index === subjectIndex) role = 'subject';
    else if (item.widthRatio >= .55 && item.heightRatio <= .46 && item.centerY / height >= .52) role = 'horizon';
    else if (region.collection) role = 'details';
    const normalized = [item.centerX / width, item.centerY / height, item.boxWidth / width, item.boxHeight / height].map(value => Math.round(value * 24));
    const key = `${region.slot}:${role}:${normalized.join(':')}`;
    for (const pixel of region.pixels) regionMap[pixel] = index;
    return {
      id: `part-${index + 1}`,
      key,
      slot: region.slot,
      pixels: region.pixels,
      area: region.area,
      minX: region.minX,
      minY: region.minY,
      maxX: region.maxX,
      maxY: region.maxY,
      centerX: item.centerX,
      centerY: item.centerY,
      coverage: item.coverage,
      borderSides: item.borderSides,
      collection: Boolean(region.collection),
      mixedSlots: false,
      role,
      textConfidence: role === 'text' ? region.confidence : undefined,
      textLine: role === 'text' ? region.textLine : undefined,
    };
  });
  return { regions, regionMap, visiblePixels };
}
