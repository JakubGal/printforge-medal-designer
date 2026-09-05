/** Dependency-free, Z-up STL viewer for the Voronoi workspace. Display changes never edit mesh data. */

const FOV = 38 * Math.PI / 180;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = value => { const length = Math.hypot(...value) || 1; return value.map(component => component / length); };

function color(hex, fallback = '#bc795b') {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(String(hex || ''));
  if (!match) return color(fallback);
  const text = match[1].length === 3 ? [...match[1]].map(value => value + value).join('') : match[1];
  return [0, 2, 4].map(offset => parseInt(text.slice(offset, offset + 2), 16) / 255);
}

function rotate(vector, axis, angle) {
  const cosine = Math.cos(angle), sine = Math.sin(angle), projection = dot(axis, vector) * (1 - cosine);
  const perpendicular = cross(axis, vector);
  return vector.map((value, index) => value * cosine + perpendicular[index] * sine + axis[index] * projection);
}

function cameraMatrices(right, up, outward, center, distance, aspect) {
  const eye = center.map((value, index) => value + outward[index] * distance);
  const view = new Float32Array([
    right[0], up[0], outward[0], 0, right[1], up[1], outward[1], 0,
    right[2], up[2], outward[2], 0, -dot(right, eye), -dot(up, eye), -dot(outward, eye), 1,
  ]);
  const near = Math.max(.0001, distance / 3000), far = Math.max(100, distance + 30);
  const f = 1 / Math.tan(FOV / 2), depth = 1 / (near - far);
  const projection = new Float32Array([
    f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (near + far) * depth, -1,
    0, 0, near * far * 2 * depth, 0,
  ]);
  return { view, projection, eye };
}

/** Build a world-coordinate perspective ray from CSS pixels and the viewer camera frame. */
export function cameraRay({ x, y, width, height, right, up, outward, center, distance, origin = [0, 0, 0], scale = 1, fov = FOV }) {
  if (![x, y, width, height, distance, scale, fov].every(Number.isFinite) || width <= 0 || height <= 0 || distance <= 0 || scale <= 0 || fov <= 0 || fov >= Math.PI) throw new Error('The picking camera has invalid dimensions.');
  if (![right, up, outward, center, origin].every(vector => vector?.length === 3 && vector.every(Number.isFinite))) throw new Error('The picking camera has invalid coordinates.');
  const horizontal = (2 * x / width - 1) * width / height * Math.tan(fov / 2);
  const vertical = (1 - 2 * y / height) * Math.tan(fov / 2);
  return {
    origin: center.map((value, axis) => origin[axis] + (value + outward[axis] * distance) / scale),
    direction: normalize(right.map((value, axis) => value * horizontal + up[axis] * vertical - outward[axis])),
  };
}

/** Closest two-sided intersection with actual STL triangles; all results retain source units. */
export function raycastMesh(mesh, ray) {
  const positions = mesh?.positions || mesh;
  if (!positions?.length || positions.length % 9) return null;
  if (!ray?.origin?.every(Number.isFinite) || ray.origin.length !== 3 || !ray.direction?.every(Number.isFinite) || ray.direction.length !== 3 || !Math.hypot(...ray.direction)) return null;
  const [ox, oy, oz] = ray.origin, [dx, dy, dz] = normalize(ray.direction);
  let closest = Infinity, triangleIndex = -1, bestU = 0, bestV = 0;
  for (let index = 0; index < positions.length; index += 9) {
    const ax = positions[index], ay = positions[index + 1], az = positions[index + 2];
    const ex = positions[index + 3] - ax, ey = positions[index + 4] - ay, ez = positions[index + 5] - az;
    const fx = positions[index + 6] - ax, fy = positions[index + 7] - ay, fz = positions[index + 8] - az;
    const px = dy * fz - dz * fy, py = dz * fx - dx * fz, pz = dx * fy - dy * fx;
    const determinant = ex * px + ey * py + ez * pz;
    // A relative tolerance keeps millimetre, metre and very small imports pickable.
    const tolerance = 1e-12 * Math.hypot(ex, ey, ez) * Math.hypot(fx, fy, fz);
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= tolerance) continue;
    const inverse = 1 / determinant, tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inverse;
    if (u < -1e-10 || u > 1 + 1e-10) continue;
    const qx = ty * ez - tz * ey, qy = tz * ex - tx * ez, qz = tx * ey - ty * ex;
    const v = (dx * qx + dy * qy + dz * qz) * inverse;
    if (v < -1e-10 || u + v > 1 + 1e-10) continue;
    const distance = (fx * qx + fy * qy + fz * qz) * inverse;
    if (distance >= 0 && distance < closest) { closest = distance; triangleIndex = index / 9; bestU = u; bestV = v; }
  }
  return triangleIndex < 0 ? null : {
    point: [ox + dx * closest, oy + dy * closest, oz + dz * closest],
    distance: closest, triangleIndex, barycentric: [1 - bestU - bestV, bestU, bestV],
  };
}

/** Uniform scale needed to make a measured source distance equal a requested distance. */
export function measurementScaleFactor(points, targetDistance) {
  const measuredDistance = points?.length === 2 && points.every(point => point?.length === 3 && point.every(Number.isFinite))
    ? Math.hypot(...points[1].map((value, axis) => value - points[0][axis])) : NaN;
  if (!Number.isFinite(measuredDistance) || measuredDistance <= 0) throw new Error('Pick two different mesh points before scaling.');
  if (!Number.isFinite(targetDistance) || targetDistance <= 0) throw new Error('Enter a positive target distance.');
  const factor = targetDistance / measuredDistance;
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('The requested scale is outside the supported numeric range.');
  return factor;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message || 'The 3D preview shader could not be compiled.');
  }
  return shader;
}

function makeProgram(gl) {
  const derivatives = Boolean(gl.getExtension('OES_standard_derivatives'));
  const vertex = compile(gl, gl.VERTEX_SHADER, `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec3 aBarycentric;
    uniform mat4 uView;
    uniform mat4 uProjection;
    uniform vec3 uOrigin;
    uniform float uScale;
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec3 vBarycentric;
    varying vec3 vViewPosition;
    void main() {
      vPosition = (aPosition - uOrigin) * uScale;
      vec4 viewPosition = uView * vec4(vPosition, 1.0);
      vViewPosition = viewPosition.xyz;
      vNormal = mat3(uView) * aNormal;
      vBarycentric = aBarycentric;
      gl_Position = uProjection * viewPosition;
    }
  `);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, `
    ${derivatives ? '#extension GL_OES_standard_derivatives : enable' : ''}
    precision mediump float;
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uMode;
    uniform vec3 uCutAxis;
    uniform float uCut;
    uniform float uClip;
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec3 vBarycentric;
    varying vec3 vViewPosition;
    void main() {
      if (uClip > 0.5 && dot(vPosition, uCutAxis) > uCut) discard;
      float opacity = uOpacity;
      if (uMode > 1.5) {
        vec3 width = ${derivatives ? 'max(fwidth(vBarycentric), vec3(0.00001)) * 1.05' : 'vec3(0.024)'};
        vec3 edge = smoothstep(vec3(0.0), width, vBarycentric);
        opacity *= 1.0 - min(min(edge.x, edge.y), edge.z);
        if (opacity < 0.015) discard;
      }
      vec3 shaded = uColor;
      if (uMode > 0.5 && uMode < 1.5) {
        vec3 normal = normalize(vNormal);
        if (!gl_FrontFacing) normal = -normal;
        vec3 viewDirection = normalize(-vViewPosition);
        vec3 key = normalize(vec3(-0.45, 0.72, 0.85));
        vec3 fill = normalize(vec3(0.8, 0.15, 0.35));
        float diffuse = max(dot(normal, key), 0.0);
        float soft = max(dot(normal, fill), 0.0);
        float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0);
        float specular = pow(max(dot(normal, normalize(key + viewDirection)), 0.0), 42.0);
        vec3 linear = pow(uColor, vec3(2.2));
        linear *= 0.32 + 0.68 * diffuse + 0.22 * soft;
        linear += vec3(0.11) * specular + vec3(0.024) * rim;
        shaded = pow(max(linear, vec3(0.0)), vec3(1.0 / 2.2));
      }
      gl_FragColor = vec4(shaded, opacity);
    }
  `);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(message || 'The 3D preview could not start.');
  }
  const attributes = Object.fromEntries(['Position', 'Normal', 'Barycentric'].map(name => [name, gl.getAttribLocation(program, `a${name}`)]));
  const uniforms = Object.fromEntries(['View', 'Projection', 'Origin', 'Scale', 'Color', 'Opacity', 'Mode', 'CutAxis', 'Cut', 'Clip'].map(name => [name, gl.getUniformLocation(program, `u${name}`)]));
  return { program, attributes, uniforms };
}

function boundsOf(mesh) {
  const supplied = mesh?.bounds;
  if (supplied?.min?.length === 3 && supplied?.max?.length === 3 && [...supplied.min, ...supplied.max].every(Number.isFinite)) {
    return { min: [...supplied.min], max: [...supplied.max], size: supplied.max.map((value, index) => value - supplied.min[index]) };
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], mesh.positions[index + axis]);
      max[axis] = Math.max(max[axis], mesh.positions[index + axis]);
    }
  }
  return { min, max, size: max.map((value, index) => value - min[index]) };
}

/** Area-weighted normals with a bounded typed-array vertex hash, independent of STL indexing. */
function makeNormals(positions, bounds, generated = false, preserveFaces = false) {
  const normals = new Float32Array(positions.length);
  const inverseExtent = 1 / Math.max(...bounds.size, 1e-30), precision = 1e6 * inverseExtent;
  // A 600k-triangle surface usually has about 300k shared vertices. The hash uses
  // at most 24 MiB, with no per-vertex arrays or strings and no unbounded growth.
  // Explicit rectangular and polygon rods have deliberate planar profile faces.
  // Averaging their shared normals would make even a twelve-sided rod look round.
  let smoothing = !preserveFaces && positions.length <= 5_400_000;
  let capacity = 1024;
  while (capacity < positions.length / 9 && capacity < 1_048_576) capacity *= 2;
  const qx = smoothing ? new Int32Array(capacity).fill(-2147483648) : null;
  const qy = smoothing ? new Int32Array(capacity) : null;
  const qz = smoothing ? new Int32Array(capacity) : null;
  const sums = smoothing ? new Float32Array(capacity * 3) : null;
  const mask = capacity - 1, maximumVertices = Math.floor(capacity * .7);
  let uniqueVertices = 0;
  const slotAt = index => {
    const x = Math.round((positions[index] - bounds.min[0]) * precision);
    const y = Math.round((positions[index + 1] - bounds.min[1]) * precision);
    const z = Math.round((positions[index + 2] - bounds.min[2]) * precision);
    let slot = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    while (qx[slot] !== -2147483648 && (qx[slot] !== x || qy[slot] !== y || qz[slot] !== z)) slot = (slot + 1) & mask;
    if (qx[slot] === -2147483648) {
      if (++uniqueVertices > maximumVertices) { smoothing = false; return -1; }
      qx[slot] = x; qy[slot] = y; qz[slot] = z;
    }
    return slot * 3;
  };
  for (let index = 0; index < positions.length; index += 9) {
    // Normalize edges before accumulating so both small and large millimetre
    // coordinates retain finite, precise weights in the Float32 hash sums.
    const ax = (positions[index + 3] - positions[index]) * inverseExtent, ay = (positions[index + 4] - positions[index + 1]) * inverseExtent, az = (positions[index + 5] - positions[index + 2]) * inverseExtent;
    const bx = (positions[index + 6] - positions[index]) * inverseExtent, by = (positions[index + 7] - positions[index + 1]) * inverseExtent, bz = (positions[index + 8] - positions[index + 2]) * inverseExtent;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const length = Math.hypot(nx, ny, nz) || 1;
    for (let vertex = 0; vertex < 9; vertex += 3) {
      const offset = index + vertex;
      if (!Number.isFinite(positions[offset]) || !Number.isFinite(positions[offset + 1]) || !Number.isFinite(positions[offset + 2])) throw new Error('The mesh contains invalid coordinates.');
      normals[offset] = nx / length; normals[offset + 1] = ny / length; normals[offset + 2] = nz / length;
      if (smoothing) {
        const slot = slotAt(offset);
        if (slot >= 0) { sums[slot] += nx; sums[slot + 1] += ny; sums[slot + 2] += nz; }
      }
    }
  }
  if (smoothing) {
    const creaseCosine = generated ? .6 : .86;
    for (let index = 0; index < positions.length; index += 3) {
      const slot = slotAt(index), length = Math.hypot(sums[slot], sums[slot + 1], sums[slot + 2]) || 1;
      const nx = sums[slot] / length, ny = sums[slot + 1] / length, nz = sums[slot + 2] / length;
      if (nx * normals[index] + ny * normals[index + 1] + nz * normals[index + 2] > creaseCosine) {
        normals[index] = nx; normals[index + 1] = ny; normals[index + 2] = nz;
      }
    }
  }
  return normals;
}

export class LatticeViewer {
  constructor(canvas, { onError, onMeasurement } = {}) {
    this.canvas = canvas;
    this.onError = onError;
    this.onMeasurement = onMeasurement;
    this.measurementMode = false;
    this.measurementPoints = [];
    this.source = null;
    this.result = null;
    this.frame = 0;
    this.destroyed = false;
    this.lost = false;
    this.listeners = [];
    this.pointers = new Map();
    this.display = { showSource: true, showResult: true, wireframe: false, cutAxis: 'none', cut: 1, color: '#bc795b', background: '#f2f3f3' };
    this.origin = [0, 0, 0];
    this.scale = 1;
    this.center = [0, 0, 0];
    this.distance = 3.8;
    this.bounds = { min: [-1, -1, -1], max: [1, 1, 1], size: [2, 2, 2] };
    this.preset('iso');
    canvas.style.touchAction = 'none';
    if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('aria-label', '3D lattice preview. Drag to orbit, shift-drag or right-drag to pan, scroll to zoom. Press F to fit.');
    this.createMeasurementOverlay();
    try {
      this.gl = canvas.getContext('webgl', { alpha: false, antialias: true, depth: true, preserveDrawingBuffer: false })
        || canvas.getContext('experimental-webgl', { alpha: false, antialias: true, depth: true });
      if (!this.gl) throw new Error('The 3D preview needs WebGL. Enable hardware acceleration or try another browser. You can still generate and export STL files.');
      this.initialize();
    } catch (error) { this.fail(error); }
    this.bindControls();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.invalidate());
      this.resizeObserver.observe(canvas);
    }
    this.listen(window, 'resize', () => this.invalidate());
    this.listen(canvas, 'webglcontextlost', event => {
      event.preventDefault(); this.lost = true;
      this.fail(new Error('The graphics context was interrupted. The preview will recover when graphics become available. Your mesh is preserved.'));
    });
    this.listen(canvas, 'webglcontextrestored', () => {
      try {
        this.lost = false;
        this.sourceGpu = null; this.resultGpu = null; this.gridGpu = null;
        this.initialize();
        this.sourceGpu = this.upload(this.source); this.resultGpu = this.upload(this.result, true);
        delete canvas.dataset.viewerError;
        canvas.title = '';
        this.onError?.(null);
        this.invalidate();
      } catch (error) { this.fail(error); }
    });
    this.invalidate();
  }

  initialize() {
    this.program = makeProgram(this.gl);
    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.depthFunc(this.gl.LEQUAL);
    this.gl.disable(this.gl.CULL_FACE);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    this.makeGrid();
  }

  fail(error) {
    const message = error?.message || String(error);
    this.canvas.dataset.viewerError = message;
    this.canvas.title = message;
    this.onError?.(message);
  }

  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.listeners.push(() => target.removeEventListener(type, handler, options));
  }

  createMeasurementOverlay() {
    const document = this.canvas.ownerDocument;
    const parent = this.canvas.parentElement;
    if (!document || !parent) return;
    if (window.getComputedStyle(parent).position === 'static') {
      this.measurementParentPosition = parent.style.position;
      parent.style.position = 'relative';
    }
    const overlay = document.createElement('div');
    overlay.className = 'lattice-measurement-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    Object.assign(overlay.style, { position: 'absolute', pointerEvents: 'none', overflow: 'hidden', zIndex: '3', inset: '0' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'hidden' });
    const halo = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    for (const item of [halo, line]) item.setAttribute('stroke-linecap', 'round');
    halo.setAttribute('stroke', '#ffffff'); halo.setAttribute('stroke-width', '5'); halo.setAttribute('opacity', '.85');
    line.setAttribute('stroke', '#d46c35'); line.setAttribute('stroke-width', '2.5');
    svg.append(halo, line);
    const markers = ['A', 'B'].map((text, index) => {
      const marker = document.createElement('span');
      marker.textContent = text;
      Object.assign(marker.style, { position: 'absolute', display: 'none', width: '25px', height: '25px', border: '2px solid #fff', borderRadius: '50%', background: index ? '#c76531' : '#246c7a', color: '#fff', font: '700 12px/21px system-ui, sans-serif', textAlign: 'center', transform: 'translate(-50%, -50%)', boxShadow: '0 2px 7px #172d3c55' });
      return marker;
    });
    const label = document.createElement('span');
    Object.assign(label.style, { position: 'absolute', display: 'none', padding: '5px 8px', background: '#ffffffed', border: '1px solid #d9e3e7', borderRadius: '6px', color: '#203b46', font: '600 12px/1.3 system-ui, sans-serif', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', transform: 'translate(-50%, 10px)', boxShadow: '0 2px 8px #172d3c16' });
    overlay.append(svg, ...markers, label);
    parent.append(overlay);
    this.measurementOverlay = { element: overlay, svg, halo, line, markers, label };
    this.updateMeasurementOverlay();
  }

  setMeasurementMode(enabled) {
    this.measurementMode = Boolean(enabled);
    if (!this.pointers.size) this.canvas.style.cursor = this.measurementMode && this.measurementPoints.length < 2 ? 'crosshair' : 'grab';
    this.canvas.setAttribute('aria-label', this.measurementMode
      ? 'Pick two points on the source mesh to measure their straight-line distance. Drag to orbit between picks; shift-drag to pan.'
      : '3D lattice preview. Drag to orbit, shift-drag or right-drag to pan, scroll to zoom. Press F to fit.');
    this.invalidate();
  }

  notifyMeasurement() {
    const points = this.measurementPoints.map(point => [...point]);
    const distance = points.length === 2 ? Math.hypot(...points[1].map((value, axis) => value - points[0][axis])) : null;
    this.onMeasurement?.({ points, distance });
    this.updateMeasurementOverlay();
  }

  clearMeasurement() {
    this.measurementPoints = [];
    if (!this.pointers.size) this.canvas.style.cursor = this.measurementMode ? 'crosshair' : 'grab';
    this.notifyMeasurement();
    this.invalidate();
  }

  setMeasurementPoints(points) {
    if (!Array.isArray(points) || points.length > 2 || !points.every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))) throw new Error('Measurement points must contain up to two finite XYZ coordinates.');
    this.measurementPoints = points.map(point => [...point]);
    if (!this.pointers.size) this.canvas.style.cursor = this.measurementMode && points.length < 2 ? 'crosshair' : 'grab';
    this.notifyMeasurement();
    this.invalidate();
  }

  pickMeasurement(clientX, clientY) {
    if (!this.measurementMode || !this.source || this.measurementPoints.length >= 2) return;
    const rectangle = this.canvas.getBoundingClientRect();
    if (!rectangle.width || !rectangle.height) return;
    const ray = cameraRay({ x: clientX - rectangle.left, y: clientY - rectangle.top, width: rectangle.width, height: rectangle.height,
      right: this.right, up: this.up, outward: this.outward, center: this.center, distance: this.distance, origin: this.origin, scale: this.scale });
    const hit = raycastMesh(this.source, ray);
    if (!hit) return;
    this.measurementPoints.push(hit.point);
    this.notifyMeasurement();
    this.invalidate();
  }

  updateMeasurementOverlay() {
    const overlay = this.measurementOverlay;
    if (!overlay) return;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    Object.assign(overlay.element.style, { left: `${this.canvas.offsetLeft}px`, top: `${this.canvas.offsetTop}px`, right: 'auto', bottom: 'auto', width: `${width}px`, height: `${height}px` });
    overlay.svg.setAttribute('viewBox', `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`);
    const eye = this.center.map((value, axis) => value + this.outward[axis] * this.distance);
    const projected = this.measurementPoints.map(point => {
      const relative = point.map((value, axis) => (value - this.origin[axis]) * this.scale - eye[axis]);
      const depth = -dot(relative, this.outward);
      if (depth <= 0 || !width || !height) return null;
      const divisor = depth * Math.tan(FOV / 2);
      return { x: width / 2 + dot(relative, this.right) / divisor * height / 2, y: height / 2 - dot(relative, this.up) / divisor * height / 2 };
    });
    overlay.markers.forEach((marker, index) => {
      const point = projected[index];
      marker.style.display = point ? 'block' : 'none';
      if (point) { marker.style.left = `${point.x}px`; marker.style.top = `${point.y}px`; }
    });
    const complete = projected.length === 2 && projected.every(Boolean);
    overlay.svg.style.display = complete ? 'block' : 'none';
    overlay.label.style.display = complete ? 'block' : 'none';
    if (complete) {
      for (const line of [overlay.halo, overlay.line]) {
        line.setAttribute('x1', projected[0].x); line.setAttribute('y1', projected[0].y);
        line.setAttribute('x2', projected[1].x); line.setAttribute('y2', projected[1].y);
      }
      const distance = Math.hypot(...this.measurementPoints[1].map((value, axis) => value - this.measurementPoints[0][axis]));
      overlay.label.textContent = `${distance.toLocaleString(undefined, { maximumSignificantDigits: 6 })} mm`;
      overlay.label.style.left = `${clamp((projected[0].x + projected[1].x) / 2, Math.min(70, width / 2), Math.max(width - 70, width / 2))}px`;
      overlay.label.style.top = `${clamp((projected[0].y + projected[1].y) / 2, 0, Math.max(0, height - 40))}px`;
    }
  }

  bindControls() {
    const canvas = this.canvas;
    this.listen(canvas, 'contextmenu', event => event.preventDefault());
    this.listen(canvas, 'pointerdown', event => {
      if (event.button > 2) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture?.(event.pointerId);
      const multiTouch = this.pointers.size > 0;
      if (multiTouch) for (const pointer of this.pointers.values()) pointer.forbidPick = true;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
        motion: 0, button: event.button, forbidPick: multiTouch || event.button !== 0 || event.shiftKey || !this.measurementMode });
      canvas.style.cursor = 'grabbing';
      event.preventDefault();
    });
    this.listen(canvas, 'pointermove', event => {
      const previous = this.pointers.get(event.pointerId);
      if (!previous) return;
      const next = { ...previous, x: event.clientX, y: event.clientY,
        motion: Math.max(previous.motion, Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY)),
        forbidPick: previous.forbidPick || event.shiftKey || this.pointers.size > 1 };
      if (this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
        if (other) {
          const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
          const newDistance = Math.hypot(next.x - other.x, next.y - other.y);
          if (oldDistance > 2 && newDistance > 2) this.distance = clamp(this.distance * oldDistance / newDistance, .025, 200);
          this.pan((next.x - previous.x) / 2, (next.y - previous.y) / 2);
        }
      } else if (this.pointers.size === 1) {
        const dx = next.x - previous.x, dy = next.y - previous.y;
        if (previous.button === 1 || previous.button === 2 || event.shiftKey) this.pan(dx, dy);
        else this.orbit(dx, dy);
      }
      this.pointers.set(event.pointerId, next);
      this.invalidate();
      event.preventDefault();
    });
    const endPointer = event => {
      const previous = this.pointers.get(event.pointerId);
      this.pointers.delete(event.pointerId);
      if (event.type === 'pointerup' && previous && !previous.forbidPick && !event.shiftKey && previous.motion <= 4
        && Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY) <= 4) this.pickMeasurement(event.clientX, event.clientY);
      if (!this.pointers.size) canvas.style.cursor = this.measurementMode && this.measurementPoints.length < 2 ? 'crosshair' : 'grab';
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) this.listen(canvas, event, endPointer);
    this.listen(canvas, 'wheel', event => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
      this.distance = clamp(this.distance * Math.exp(clamp(delta * .0012, -1, 1)), .025, 200);
      this.invalidate();
    }, { passive: false });
    this.listen(canvas, 'dblclick', () => { if (!this.measurementMode) this.fit(); });
    this.listen(canvas, 'keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'f' || key === 'home') this.fit();
      else if (key === '1') this.preset('iso');
      else if (key === '2') this.preset('top');
      else if (key === '3') this.preset('front');
      else if (key === '4') this.preset('right');
      else if (key === '+' || key === '=') { this.distance = Math.max(.025, this.distance / 1.15); this.invalidate(); }
      else if (key === '-') { this.distance = Math.min(200, this.distance * 1.15); this.invalidate(); }
      else if (key.startsWith('arrow')) {
        const dx = key === 'arrowleft' ? -18 : key === 'arrowright' ? 18 : 0;
        const dy = key === 'arrowup' ? -18 : key === 'arrowdown' ? 18 : 0;
        if (event.shiftKey) this.pan(dx, dy); else this.orbit(dx, dy);
        this.invalidate();
      } else return;
      event.preventDefault();
    });
    canvas.style.cursor = 'grab';
  }

  orbit(dx, dy) {
    // Rotate a full orthonormal camera frame; there is no polar clamp or singularity.
    const yaw = -dx * .007, pitch = -dy * .007;
    this.right = rotate(this.right, this.up, yaw);
    this.outward = rotate(this.outward, this.up, yaw);
    this.outward = normalize(rotate(this.outward, this.right, pitch));
    this.up = normalize(cross(this.outward, this.right));
    this.right = normalize(cross(this.up, this.outward));
  }

  pan(dx, dy) {
    const perPixel = 2 * this.distance * Math.tan(FOV / 2) / Math.max(1, this.canvas.clientHeight);
    this.center = this.center.map((value, index) => value - this.right[index] * dx * perPixel + this.up[index] * dy * perPixel);
  }

  upload(mesh, generated = false) {
    if (!mesh || !this.gl || this.lost || !this.program) return null;
    const positions = mesh.positions;
    if (!(positions instanceof Float32Array) || !positions.length || positions.length % 9) throw new Error('The 3D preview needs complete STL triangles as a Float32Array.');
    const preserveFaces = generated && mesh.stats?.meshingMethod === 'explicit-rods'
      && ['rectangle', 'polygon'].includes(mesh.options?.rodProfile);
    const normals = makeNormals(positions, boundsOf(mesh), generated, preserveFaces);
    const gl = this.gl;
    const position = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, position); gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    const normal = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normal); gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    return { position, normal, barycentric: null, count: positions.length / 3 };
  }

  release(geometry) {
    if (!geometry || !this.gl || this.lost) return;
    for (const key of ['position', 'normal', 'barycentric']) if (geometry[key]) this.gl.deleteBuffer(geometry[key]);
  }

  setSource(mesh) {
    try {
      const uploaded = this.upload(mesh);
      this.release(this.sourceGpu);
      this.source = mesh;
      this.sourceGpu = uploaded;
      this.updateBounds();
      this.fit();
      this.clearMeasurement();
    } catch (error) { this.fail(error); }
  }

  setResult(mesh) {
    try {
      const uploaded = this.upload(mesh, true);
      this.release(this.resultGpu);
      this.result = mesh;
      this.resultGpu = uploaded;
      if (!this.source) { this.updateBounds(); this.fit(); }
      this.invalidate();
    } catch (error) { this.fail(error); }
  }

  updateBounds() {
    const mesh = this.source || this.result;
    this.bounds = mesh ? boundsOf(mesh) : { min: [-1, -1, -1], max: [1, 1, 1], size: [2, 2, 2] };
    this.origin = this.bounds.min.map((value, index) => (value + this.bounds.max[index]) / 2);
    this.scale = 1 / Math.max(Math.hypot(...this.bounds.size) / 2, 1e-9);
    this.makeGrid();
  }

  makeGrid() {
    if (!this.gl || this.lost) return;
    this.release(this.gridGpu);
    const floor = (this.bounds.min[2] - this.origin[2]) * this.scale - .025;
    const vertices = [];
    for (let index = -12; index <= 12; index += 1) {
      const coordinate = index / 6;
      vertices.push(-2, coordinate, floor, 2, coordinate, floor, coordinate, -2, floor, coordinate, 2, floor);
    }
    const position = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, position);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices), this.gl.STATIC_DRAW);
    this.gridGpu = { position, count: vertices.length / 3 };
  }

  setDisplay(options = {}) {
    for (const key of ['showSource', 'showResult', 'wireframe']) if (key in options) this.display[key] = Boolean(options[key]);
    if (['none', 'x', 'y', 'z'].includes(options.cutAxis)) this.display.cutAxis = options.cutAxis;
    if (Number.isFinite(Number(options.cut))) this.display.cut = clamp(Number(options.cut), 0, 1);
    if (options.color) this.display.color = options.color;
    if (options.background) this.display.background = options.background;
    this.invalidate();
  }

  fit() {
    this.center = [0, 0, 0];
    const aspect = Math.max(.1, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    const halfFov = Math.atan(Math.tan(FOV / 2) * Math.min(1, aspect));
    this.distance = 1.15 / Math.sin(halfFov);
    this.invalidate();
  }

  preset(view) {
    if (view === 'top') { this.outward = [0, 0, 1]; this.up = [0, 1, 0]; }
    else if (view === 'front') { this.outward = [0, -1, 0]; this.up = [0, 0, 1]; }
    else if (view === 'right') { this.outward = [1, 0, 0]; this.up = [0, 0, 1]; }
    else { this.outward = normalize([1.25, -1.65, 1.1]); this.up = [0, 0, 1]; }
    this.right = normalize(cross(this.up, this.outward));
    this.up = normalize(cross(this.outward, this.right));
    this.invalidate();
  }

  invalidate() {
    if (this.destroyed || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }

  bindGeometry(geometry, wireframe = false) {
    const gl = this.gl, { attributes } = this.program;
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.position);
    gl.enableVertexAttribArray(attributes.Position);
    gl.vertexAttribPointer(attributes.Position, 3, gl.FLOAT, false, 0, 0);
    if (geometry.normal) {
      gl.bindBuffer(gl.ARRAY_BUFFER, geometry.normal); gl.enableVertexAttribArray(attributes.Normal);
      gl.vertexAttribPointer(attributes.Normal, 3, gl.FLOAT, false, 0, 0);
    } else { gl.disableVertexAttribArray(attributes.Normal); gl.vertexAttrib3f(attributes.Normal, 0, 0, 1); }
    if (wireframe) {
      if (!geometry.barycentric) {
        const data = new Uint8Array(geometry.count * 3);
        for (let index = 0; index < geometry.count; index += 1) data[index * 3 + index % 3] = 1;
        geometry.barycentric = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.barycentric); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, geometry.barycentric); gl.enableVertexAttribArray(attributes.Barycentric);
      gl.vertexAttribPointer(attributes.Barycentric, 3, gl.UNSIGNED_BYTE, false, 0, 0);
    } else { gl.disableVertexAttribArray(attributes.Barycentric); gl.vertexAttrib3f(attributes.Barycentric, 1, 1, 1); }
  }

  drawMesh(geometry, shade, opacity = 1, wireframe = false) {
    const gl = this.gl, u = this.program.uniforms;
    this.bindGeometry(geometry, wireframe);
    gl.uniform3fv(u.Color, shade); gl.uniform1f(u.Opacity, opacity); gl.uniform1f(u.Mode, wireframe ? 2 : 1);
    if (wireframe) {
      // Hide rear edges with an exact geometry depth pass, then draw antialiased triangle edges.
      gl.colorMask(false, false, false, false);
      gl.uniform1f(u.Mode, 1);
      gl.drawArrays(gl.TRIANGLES, 0, geometry.count);
      gl.colorMask(true, true, true, true);
      gl.uniform1f(u.Mode, 2); gl.enable(gl.BLEND);
    }
    gl.drawArrays(gl.TRIANGLES, 0, geometry.count);
  }

  render() {
    this.updateMeasurementOverlay();
    if (!this.gl || !this.program || this.destroyed || this.lost) return;
    const gl = this.gl, canvas = this.canvas;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (width < 1 || height < 1) return;
    const limit = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2.5, Math.sqrt(3_500_000 / (width * height)), limit / width, limit / height);
    const bufferWidth = Math.max(1, Math.round(width * ratio)), bufferHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) { canvas.width = bufferWidth; canvas.height = bufferHeight; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    const background = color(this.display.background, '#f2f3f3');
    gl.clearColor(...background, 1); gl.colorMask(true, true, true, true); gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program.program);
    const u = this.program.uniforms, matrices = cameraMatrices(this.right, this.up, this.outward, this.center, this.distance, width / height);
    gl.uniformMatrix4fv(u.View, false, matrices.view); gl.uniformMatrix4fv(u.Projection, false, matrices.projection);
    gl.uniform3fv(u.Origin, [0, 0, 0]); gl.uniform1f(u.Scale, 1); gl.uniform1f(u.Clip, 0);
    gl.uniform3fv(u.Color, background.map(value => value * .86)); gl.uniform1f(u.Opacity, .6); gl.uniform1f(u.Mode, 0);
    gl.enable(gl.BLEND); gl.depthMask(false);
    if (this.gridGpu) { this.bindGeometry(this.gridGpu); gl.drawArrays(gl.LINES, 0, this.gridGpu.count); }
    gl.depthMask(true); gl.disable(gl.BLEND);
    gl.uniform3fv(u.Origin, this.origin); gl.uniform1f(u.Scale, this.scale);
    const axis = ['x', 'y', 'z'].indexOf(this.display.cutAxis), direction = [0, 0, 0];
    if (axis >= 0) direction[axis] = 1;
    gl.uniform3fv(u.CutAxis, direction);
    const measuringSource = this.measurementMode && this.sourceGpu;
    gl.uniform1f(u.Clip, !measuringSource && axis >= 0 && this.display.cut < 1 ? 1 : 0);
    gl.uniform1f(u.Cut, axis >= 0 ? (this.bounds.min[axis] + this.bounds.size[axis] * this.display.cut - this.origin[axis]) * this.scale : 0);
    const resultVisible = Boolean(!measuringSource && this.resultGpu && this.display.showResult);
    if (resultVisible) this.drawMesh(this.resultGpu, color(this.display.color), 1, this.display.wireframe);
    if (this.sourceGpu && (measuringSource || this.display.showSource)) {
      if (resultVisible) {
        gl.enable(gl.BLEND); gl.depthMask(false);
        // Back faces add depth without a solid shell obscuring the inner lattice.
        gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
        this.drawMesh(this.sourceGpu, [.46, .53, .58], .055);
        gl.cullFace(gl.BACK);
        this.drawMesh(this.sourceGpu, [.46, .53, .58], .075);
        gl.disable(gl.CULL_FACE); gl.depthMask(true);
      } else this.drawMesh(this.sourceGpu, [.59, .65, .68], 1, !measuringSource && this.display.wireframe);
    }
    gl.disable(gl.BLEND);
  }

  destroy() {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resizeObserver?.disconnect();
    this.listeners.forEach(remove => remove());
    this.listeners.length = 0;
    this.pointers.clear();
    this.measurementOverlay?.element.remove();
    if (this.measurementParentPosition !== undefined && this.canvas.parentElement) this.canvas.parentElement.style.position = this.measurementParentPosition;
    this.measurementOverlay = null;
    this.measurementPoints = [];
    this.release(this.sourceGpu); this.release(this.resultGpu); this.release(this.gridGpu);
    if (this.program && !this.lost) this.gl.deleteProgram(this.program.program);
    this.source = null; this.result = null;
  }
}
