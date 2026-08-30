self.onmessage = event => {
  const { pixels, width, height, palette, minimumComponentPixels = 2, minimumStrokePixels = 1 } = event.data;
  const source = new Uint8ClampedArray(pixels);
  const output = new Uint8ClampedArray(source.length);
  const indices = new Uint8Array(width * height);

  for (let i = 0; i < indices.length; i += 1) {
    const p = i * 4;
    if (source[p + 3] < 38) {
      indices[i] = 255;
      continue;
    }
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let slot = 0; slot < palette.length; slot += 1) {
      const color = palette[slot];
      const dr = source[p] - color[0];
      const dg = source[p + 1] - color[1];
      const db = source[p + 2] - color[2];
      const distance = dr * dr * .30 + dg * dg * .59 + db * db * .11;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = slot;
      }
    }
    indices[i] = best;
  }

  const cleaned = new Uint8Array(indices);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const current = indices[i];
      if (current === 255) continue;
      const neighbors = [indices[i - 1], indices[i + 1], indices[i - width], indices[i + width]];
      const same = neighbors.filter(value => value === current).length;
      if (same > 0) continue;
      const counts = new Map();
      for (const value of neighbors) if (value !== 255) counts.set(value, (counts.get(value) || 0) + 1);
      let replacement = current;
      let count = 0;
      for (const [value, candidateCount] of counts) {
        if (candidateCount > count) { replacement = value; count = candidateCount; }
      }
      cleaned[i] = replacement;
    }
  }

  const basis = new Uint8Array(cleaned);
  const visited = new Uint8Array(basis.length);
  const minimumArea = Math.max(1, Math.min(400, Math.floor(minimumComponentPixels)));
  const neighborsOf = index => {
    const x = index % width, y = Math.floor(index / width), result = [];
    if (x > 0) result.push(index - 1);
    if (x + 1 < width) result.push(index + 1);
    if (y > 0) result.push(index - width);
    if (y + 1 < height) result.push(index + width);
    return result;
  };
  for (let start = 0; start < basis.length; start += 1) {
    const slot = basis[start];
    if (visited[start] || slot === 255) continue;
    const component = [], queue = [start], bordering = new Map();
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor]; component.push(index);
      for (const neighbor of neighborsOf(index)) {
        const neighborSlot = basis[neighbor];
        if (neighborSlot === slot && !visited[neighbor]) { visited[neighbor] = 1; queue.push(neighbor); }
        else if (neighborSlot !== slot) bordering.set(neighborSlot, (bordering.get(neighborSlot) || 0) + 1);
      }
    }
    if (component.length >= minimumArea) continue;
    let replacement = 255, bestCount = 0;
    for (const [candidate, count] of bordering) if (count > bestCount) { replacement = candidate; bestCount = count; }
    for (const index of component) cleaned[index] = replacement;
  }

  // Reject long but sub-nozzle lines as well as tiny islands. Component area
  // alone cannot catch a one-pixel line hundreds of pixels long.
  const widthBasis = new Uint8Array(cleaned);
  const minimumSpan = Math.max(1, Math.min(16, Math.floor(minimumStrokePixels)));
  if (minimumSpan > 1) {
    const run = (x, y, dx, dy, slot) => {
      let count = 0;
      while (x >= 0 && y >= 0 && x < width && y < height && count < minimumSpan && widthBasis[y * width + x] === slot) { count += 1; x += dx; y += dy; }
      return count;
    };
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x, slot = widthBasis[index];
        if (slot === 255) continue;
        const horizontal = run(x, y, -1, 0, slot) + run(x + 1, y, 1, 0, slot);
        const vertical = run(x, y, 0, -1, slot) + run(x, y + 1, 0, 1, slot);
        if (Math.min(horizontal, vertical) >= minimumSpan) continue;
        const bordering = new Map();
        for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
          if ((!ox && !oy) || x + ox < 0 || y + oy < 0 || x + ox >= width || y + oy >= height) continue;
          const candidate = widthBasis[(y + oy) * width + x + ox];
          if (candidate !== slot) bordering.set(candidate, (bordering.get(candidate) || 0) + 1);
        }
        let replacement = 255, bestCount = 0;
        for (const [candidate, count] of bordering) if (count > bestCount) { replacement = candidate; bestCount = count; }
        cleaned[index] = replacement;
      }
    }
  }

  for (let i = 0; i < cleaned.length; i += 1) {
    const p = i * 4;
    const slot = cleaned[i];
    if (slot === 255) {
      output[p + 3] = 0;
    } else {
      output[p] = palette[slot][0];
      output[p + 1] = palette[slot][1];
      output[p + 2] = palette[slot][2];
      output[p + 3] = 255;
    }
  }

  self.postMessage({ pixels: output.buffer, indices: cleaned.buffer, width, height }, [output.buffer, cleaned.buffer]);
};
