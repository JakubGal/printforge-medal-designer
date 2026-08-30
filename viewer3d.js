function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'WebGL shader compilation failed';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'WebGL program link failed';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map(value => value / length);
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function lookAt(eye, center, up) {
  const z = normalize(subtract(eye, center));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const range = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * range, -1,
    0, 0, near * far * 2 * range, 0,
  ]);
}

function orthographic(left, right, bottom, top, near, far) {
  const lr = 1 / (left - right), bt = 1 / (bottom - top), nf = 1 / (near - far);
  return new Float32Array([
    -2 * lr, 0, 0, 0,
    0, -2 * bt, 0, 0,
    0, 0, 2 * nf, 0,
    (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1,
  ]);
}

function transformPoint(matrix, point) {
  const [x, y, z, w = 1] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w,
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w,
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w,
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * w,
  ];
}

function projectWorldPoint(world, view, projection) {
  const viewPoint = transformPoint(view, [...world, 1]);
  const clip = transformPoint(projection, viewPoint);
  if (!clip.every(Number.isFinite) || clip[3] <= 1e-7) return null;
  return { x: clip[0] / clip[3], y: clip[1] / clip[3], z: clip[2] / clip[3] };
}

function viewerElementLinear(face, rotation, scaleX, scaleY) {
  const angle = (Number(rotation) || 0) * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
  const sx = Math.max(.0001, Number(scaleX) || 1), sy = Math.max(.0001, Number(scaleY) || 1);
  const viewerY = face === 'back' ? 1 : -1;
  return [cosine * sx, -sine * sy, viewerY * sine * sx, viewerY * cosine * sy];
}

/** Exact viewer-space XY mapping between two editable element transforms. */
export function planarTransformBetween(source = {}, target = {}) {
  const [a, b, c, d] = viewerElementLinear(source.face, source.rotation, source.scaleX, source.scaleY);
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-10) return [1, 0, 0, 1];
  const inverse = [d / determinant, -b / determinant, -c / determinant, a / determinant];
  const [e, f, g, h] = viewerElementLinear(target.face, target.rotation, target.scaleX, target.scaleY);
  return [
    e * inverse[0] + f * inverse[2], e * inverse[1] + f * inverse[3],
    g * inverse[0] + h * inverse[2], g * inverse[1] + h * inverse[3],
  ];
}

function parseColor(hex) {
  const source = String(hex || '#777777').replace('#', '');
  const value = source.length === 3 ? source.split('').map(char => char + char).join('') : source.padEnd(6, '0');
  return [parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255, 1];
}

const VIEWER_MIN_PIXEL_RATIO = 2;
const VIEWER_MAX_PIXEL_RATIO = 3;
const VIEWER_DEFAULT_PIXEL_BUDGET = 4_500_000;
const VIEWER_SIDE_NORMAL_VERTEX_BUDGET = 220_000;

/**
 * Pick a sharp but bounded drawing-buffer size. A 1x/1.5x WebGL canvas makes
 * even a dense printable mesh look jagged, while blindly using a 3x DPR can
 * allocate hundreds of megabytes for color, depth, and multisample buffers on
 * a large monitor. This keeps ordinary workspaces at 2x or better and scales
 * down only when the explicit pixel budget or GPU viewport limit requires it.
 */
export function viewerBufferSize(cssWidth, cssHeight, deviceRatio = 1, options = {}) {
  const width = Math.max(1, Number(cssWidth) || 1), height = Math.max(1, Number(cssHeight) || 1);
  const nativeRatio = Math.max(1, Number(deviceRatio) || 1);
  const minimumRatio = Math.max(1, Number(options.minimumRatio) || VIEWER_MIN_PIXEL_RATIO);
  const maximumRatio = Math.max(minimumRatio, Number(options.maximumRatio) || VIEWER_MAX_PIXEL_RATIO);
  const pixelBudget = Math.max(250_000, Number(options.pixelBudget) || VIEWER_DEFAULT_PIXEL_BUDGET);
  const maxDimension = Math.max(512, Number(options.maxDimension) || 8192);
  let ratio = Math.min(maximumRatio, Math.max(minimumRatio, nativeRatio));
  ratio = Math.min(ratio, Math.sqrt(pixelBudget / (width * height)), maxDimension / width, maxDimension / height);
  // Very large embedded workspaces may need a sub-1x buffer to stay inside the
  // hard GPU budget. Normal editor sizes remain at the 2x quality floor.
  ratio = Math.max(.1, ratio);
  return {
    width: Math.max(2, Math.round(width * ratio)),
    height: Math.max(2, Math.round(height * ratio)),
    ratio,
    pixelBudget,
  };
}

/** A viewport-only geometry ceiling; production exports keep their own profile. */
export function viewerGeometryBudget(deviceMemory = 8) {
  const memory = Math.max(1, Number(deviceMemory) || 8);
  if (memory <= 4) return { maxCells: 420_000, maxTriangles: 2_000_000 };
  if (memory <= 8) return { maxCells: 600_000, maxTriangles: 2_600_000 };
  return { maxCells: 720_000, maxTriangles: 3_200_000 };
}

function vertexKey(point) {
  return `${Math.round(point[0] * 1e5)},${Math.round(point[1] * 1e5)},${Math.round(point[2] * 1e5)}`;
}

/**
 * Convert triangle soup for WebGL. Horizontal caps intentionally retain flat
 * normals so different Z levels read clearly. Only near-vertical faces share
 * area-weighted normals; that removes the alternating X/Y lighting which made
 * sampled circles, glyphs, and traced artwork appear blocky without moving a
 * single printable vertex. The map has a hard ceiling for predictable memory.
 */
export function viewerTriangleBuffers(mesh, options = {}) {
  const source = mesh.triangles;
  const positions = new Float32Array(source.length);
  const normals = new Float32Array(source.length);
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const smoothSides = options.smoothSides !== false;
  const vertexBudget = Math.max(0, Number(options.sideNormalVertexBudget) || VIEWER_SIDE_NORMAL_VERTEX_BUDGET);
  let sideNormalSums = smoothSides && vertexBudget ? new Map() : null;
  for (let offset = 0; offset < source.length; offset += 9) {
    const a = [source[offset], -source[offset + 1], source[offset + 2]];
    // Negating Y reflects the mesh, so swap B/C to preserve its outward winding.
    const b = [source[offset + 6], -source[offset + 7], source[offset + 8]];
    const c = [source[offset + 3], -source[offset + 4], source[offset + 5]];
    const crossProduct = cross(subtract(b, a), subtract(c, a));
    const normal = normalize(crossProduct);
    [a, b, c].forEach((point, vertex) => {
      const index = offset + vertex * 3;
      positions[index] = point[0]; positions[index + 1] = point[1]; positions[index + 2] = point[2];
      normals[index] = normal[0]; normals[index + 1] = normal[1]; normals[index + 2] = normal[2];
      for (let axis = 0; axis < 3; axis += 1) {
        bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
      }
    });
    if (sideNormalSums && Math.abs(normal[2]) < .18) {
      for (const point of [a, b, c]) {
        const key = vertexKey(point);
        let sum = sideNormalSums.get(key);
        if (!sum) {
          if (sideNormalSums.size >= vertexBudget) { sideNormalSums = null; break; }
          sum = [0, 0, 0]; sideNormalSums.set(key, sum);
        }
        sum[0] += crossProduct[0]; sum[1] += crossProduct[1]; sum[2] += crossProduct[2];
      }
    }
  }
  if (sideNormalSums) {
    for (let offset = 0; offset < positions.length; offset += 3) {
      if (Math.abs(normals[offset + 2]) >= .18) continue;
      const sum = sideNormalSums.get(vertexKey([positions[offset], positions[offset + 1], positions[offset + 2]]));
      if (!sum) continue;
      const smoothed = normalize(sum);
      normals[offset] = smoothed[0]; normals[offset + 1] = smoothed[1]; normals[offset + 2] = smoothed[2];
    }
  }
  return { positions, normals, bounds };
}

export const VIEWER_VERTEX_SHADER = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  uniform mat4 uView;
  uniform mat4 uProjection;
  uniform vec3 uOffset;
  uniform float uScaleZ;
  uniform float uZOffset;
  uniform vec2 uPlanarOrigin;
  uniform vec4 uPlanarMatrix;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vModelZ;
  void main() {
    vec2 relative = aPosition.xy - uPlanarOrigin;
    vec2 planar = uPlanarOrigin + vec2(
      uPlanarMatrix.x * relative.x + uPlanarMatrix.y * relative.y,
      uPlanarMatrix.z * relative.x + uPlanarMatrix.w * relative.y
    );
    vec3 modelPosition = vec3(planar, aPosition.z * uScaleZ + uZOffset);
    vec3 world = modelPosition + uOffset;
    vNormal = aNormal;
    vWorld = world;
    vModelZ = modelPosition.z;
    gl_Position = uProjection * uView * vec4(world, 1.0);
  }
`;

export const VIEWER_FRAGMENT_SHADER = `
  precision mediump float;
  uniform vec4 uColor;
  uniform vec3 uCamera;
  uniform float uUnlit;
  uniform float uClipZ;
  uniform float uOpacity;
  uniform float uHoverActive;
  uniform vec3 uHoverPoint;
  uniform vec3 uHoverNormal;
  uniform float uHoverRadius;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vModelZ;
  void main() {
    if (vModelZ > uClipZ + 0.0001) discard;
    vec3 normal = normalize(vNormal);
    vec3 light = normalize(vec3(-0.35, -0.45, 0.82));
    // CAD work routinely happens on the underside. A weaker opposite fill
    // keeps back-face colors readable after the camera snaps underneath while
    // retaining enough directional contrast to judge relief and pockets.
    float keyDiffuse = max(dot(normal, light), 0.0);
    float fillDiffuse = max(dot(normal, -light), 0.0) * 0.72;
    float diffuse = max(keyDiffuse, fillDiffuse);
    vec3 viewDirection = normalize(uCamera - vWorld);
    vec3 activeLight = keyDiffuse >= fillDiffuse ? light : -light;
    vec3 halfway = normalize(activeLight + viewDirection);
    float specular = pow(max(dot(normal, halfway), 0.0), 34.0) * 0.24;
    float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.0) * 0.12;
    vec3 lit = uColor.rgb * (0.40 + diffuse * 0.66 + rim) + vec3(specular);
    float planeDistance = abs(dot(vWorld - uHoverPoint, normalize(uHoverNormal)));
    vec3 tangent = (vWorld - uHoverPoint) - normalize(uHoverNormal) * dot(vWorld - uHoverPoint, normalize(uHoverNormal));
    float hoverMask = uHoverActive * step(planeDistance, 0.09) * (1.0 - smoothstep(uHoverRadius * 0.72, uHoverRadius, length(tangent))) * step(0.62, abs(dot(normal, normalize(uHoverNormal))));
    vec3 finalColor = mix(mix(lit, uColor.rgb, uUnlit), vec3(0.20, 0.47, 1.0), hoverMask * 0.38);
    gl_FragColor = vec4(finalColor, uColor.a * uOpacity);
  }
`;

export class MedalViewer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!this.gl) throw new Error('WebGL is unavailable on this device');
    const gl = this.gl;
    this.program = createProgram(gl, VIEWER_VERTEX_SHADER, VIEWER_FRAGMENT_SHADER);
    this.locations = {
      position: gl.getAttribLocation(this.program, 'aPosition'),
      normal: gl.getAttribLocation(this.program, 'aNormal'),
      view: gl.getUniformLocation(this.program, 'uView'),
      projection: gl.getUniformLocation(this.program, 'uProjection'),
      offset: gl.getUniformLocation(this.program, 'uOffset'),
      scaleZ: gl.getUniformLocation(this.program, 'uScaleZ'),
      zOffset: gl.getUniformLocation(this.program, 'uZOffset'),
      planarOrigin: gl.getUniformLocation(this.program, 'uPlanarOrigin'),
      planarMatrix: gl.getUniformLocation(this.program, 'uPlanarMatrix'),
      color: gl.getUniformLocation(this.program, 'uColor'),
      camera: gl.getUniformLocation(this.program, 'uCamera'),
      clipZ: gl.getUniformLocation(this.program, 'uClipZ'),
      opacity: gl.getUniformLocation(this.program, 'uOpacity'),
      hoverActive: gl.getUniformLocation(this.program, 'uHoverActive'),
      hoverPoint: gl.getUniformLocation(this.program, 'uHoverPoint'),
      hoverNormal: gl.getUniformLocation(this.program, 'uHoverNormal'),
      hoverRadius: gl.getUniformLocation(this.program, 'uHoverRadius'),
      unlit: gl.getUniformLocation(this.program, 'uUnlit'),
    };
    this.meshes = [];
    this.sectionMeshes = [];
    this.proxyMeshes = [];
    this.decorMeshes = [];
    this.proxyTransform = { x: 0, y: 0, zScale: 1, zOffset: 0, planarOriginX: 0, planarOriginY: 0, planarMatrix: [1, 0, 0, 1], opacity: .34, color: '#2e68ff' };
    this.hoverSurface = null;
    this.visibility = new Map();
    this.baseSlot = 0;
    this.bounds = { min: [-30, -30, 0], max: [30, 30, 3] };
    this.modelBounds = { min: [-30, -30, 0], max: [30, 30, 3] };
    this.target = [0, 0, 1.5];
    this.azimuth = -.78;
    this.elevation = .62;
    this.distance = 110;
    this.projection = 'perspective';
    this.explode = 0;
    this.clipZ = 1e6;
    this.showGrid = true;
    this.pointerState = new Map();
    this.dragMode = 'rotate';
    this.grid = null;
    this.frame = 0;
    const deviceMemory = Number(globalThis.navigator?.deviceMemory) || 8;
    this.pixelBudget = deviceMemory <= 4 ? 3_000_000 : deviceMemory <= 8 ? VIEWER_DEFAULT_PIXEL_BUDGET : 6_000_000;
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    this.maxViewportDimension = Math.max(2048, Math.min(Number(viewport?.[0]) || 8192, Number(viewport?.[1]) || 8192));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.bindControls();
    this.configureGl();
    this.resize();
  }

  configureGl() {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  createBuffer(data) {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }

  deleteGeometry(geometry) {
    if (!geometry) return;
    if (geometry.positionBuffer) this.gl.deleteBuffer(geometry.positionBuffer);
    if (geometry.normalBuffer) this.gl.deleteBuffer(geometry.normalBuffer);
  }

  setMeshes(meshes, options = {}) {
    const hadMeshes = this.meshes.length > 0;
    this.meshes.forEach(mesh => this.deleteGeometry(mesh));
    this.sectionMeshes.forEach(mesh => this.deleteGeometry(mesh));
    this.proxyMeshes.forEach(mesh => this.deleteGeometry(mesh));
    this.meshes = [];
    this.sectionMeshes = [];
    this.proxyMeshes = [];
    const overall = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const mesh of meshes) {
      const built = viewerTriangleBuffers(mesh);
      for (let axis = 0; axis < 3; axis += 1) {
        overall.min[axis] = Math.min(overall.min[axis], built.bounds.min[axis]);
        overall.max[axis] = Math.max(overall.max[axis], built.bounds.max[axis]);
      }
      this.meshes.push({
        slot: mesh.slot,
        name: mesh.name,
        color: parseColor(mesh.color),
        positionBuffer: this.createBuffer(built.positions),
        normalBuffer: this.createBuffer(built.normals),
        count: built.positions.length / 3,
        bounds: built.bounds,
      });
      if (!this.visibility.has(mesh.slot)) this.visibility.set(mesh.slot, true);
    }
    this.modelBounds = this.meshes.length ? overall : { min: [-30, -30, 0], max: [30, 30, 3] };
    this.bounds = { min: [...this.modelBounds.min], max: [...this.modelBounds.max] };
    for (const mesh of this.decorMeshes) for (let axis = 0; axis < 3; axis += 1) {
      this.bounds.min[axis] = Math.min(this.bounds.min[axis], mesh.bounds.min[axis]);
      this.bounds.max[axis] = Math.max(this.bounds.max[axis], mesh.bounds.max[axis]);
    }
    this.rebuildGrid();
    if (options.refit === true || (!hadMeshes && options.refit !== false)) this.fit();
    else this.render();
  }

  setSectionMeshes(meshes = []) {
    this.sectionMeshes.forEach(mesh => this.deleteGeometry(mesh));
    this.sectionMeshes = [];
    for (const mesh of meshes) {
      if (!mesh?.triangles?.length) continue;
      const built = viewerTriangleBuffers(mesh);
      this.sectionMeshes.push({
        slot: Number(mesh.slot) || 0,
        color: parseColor(mesh.color),
        positionBuffer: this.createBuffer(built.positions),
        normalBuffer: this.createBuffer(built.normals),
        count: built.positions.length / 3,
        bounds: built.bounds,
      });
    }
    this.render();
  }

  setProxyMeshes(meshes = [], options = {}) {
    this.proxyMeshes.forEach(mesh => this.deleteGeometry(mesh));
    this.proxyMeshes = [];
    for (const mesh of meshes) {
      if (!mesh?.triangles?.length) continue;
      const built = viewerTriangleBuffers(mesh);
      this.proxyMeshes.push({
        slot: Number(mesh.slot) || 0,
        color: parseColor(options.color || mesh.color || '#2e68ff'),
        positionBuffer: this.createBuffer(built.positions),
        normalBuffer: this.createBuffer(built.normals),
        count: built.positions.length / 3,
        bounds: built.bounds,
      });
    }
    this.proxyTransform = { ...this.proxyTransform, ...options };
    this.render();
  }

  setDecorMeshes(meshes = []) {
    this.decorMeshes.forEach(mesh => this.deleteGeometry(mesh));
    this.decorMeshes = [];
    for (const mesh of meshes) {
      if (!mesh?.triangles?.length) continue;
      const built = viewerTriangleBuffers(mesh);
      this.decorMeshes.push({
        color: parseColor(mesh.color || '#2458d8'),
        positionBuffer: this.createBuffer(built.positions),
        normalBuffer: this.createBuffer(built.normals),
        count: built.positions.length / 3,
        bounds: built.bounds,
        opacity: Math.max(.1, Math.min(1, Number(mesh.opacity) || .84)),
      });
    }
    this.bounds = { min: [...this.modelBounds.min], max: [...this.modelBounds.max] };
    for (const mesh of this.decorMeshes) for (let axis = 0; axis < 3; axis += 1) {
      this.bounds.min[axis] = Math.min(this.bounds.min[axis], mesh.bounds.min[axis]);
      this.bounds.max[axis] = Math.max(this.bounds.max[axis], mesh.bounds.max[axis]);
    }
    this.rebuildGrid();
    this.render();
  }

  setProxyTransform(options = {}) {
    this.proxyTransform = { ...this.proxyTransform, ...options };
    const color = options.color ? parseColor(options.color) : null;
    if (color) for (const mesh of this.proxyMeshes) mesh.color = color;
    this.render();
  }

  clearProxyMeshes() {
    this.proxyMeshes.forEach(mesh => this.deleteGeometry(mesh));
    this.proxyMeshes = [];
    this.render();
  }

  setHoverSurface(hit, radius = 7) {
    if (!hit?.point || !hit?.normal) return this.clearHoverSurface();
    this.hoverSurface = {
      point: [Number(hit.point.x) || 0, -(Number(hit.point.y) || 0), Number(hit.point.z) || 0],
      normal: [Number(hit.normal[0]) || 0, -(Number(hit.normal[1]) || 0), Number(hit.normal[2]) || 0],
      radius: Math.max(1, Number(radius) || 7),
    };
    this.render();
  }

  clearHoverSurface() {
    if (!this.hoverSurface) return;
    this.hoverSurface = null;
    this.render();
  }

  rebuildGrid() {
    this.deleteGeometry(this.grid);
    const width = this.bounds.max[0] - this.bounds.min[0];
    const depth = this.bounds.max[1] - this.bounds.min[1];
    const size = Math.max(80, Math.ceil(Math.max(width, depth) / 20) * 20 + 40);
    const step = 5;
    const positions = [];
    const normals = [];
    for (let value = -size / 2; value <= size / 2 + .001; value += step) {
      positions.push(-size / 2, value, -.04, size / 2, value, -.04, value, -size / 2, -.04, value, size / 2, -.04);
      for (let i = 0; i < 4; i += 1) normals.push(0, 0, 1);
    }
    this.grid = { positionBuffer: this.createBuffer(new Float32Array(positions)), normalBuffer: this.createBuffer(new Float32Array(normals)), count: positions.length / 3 };
  }

  get size() {
    const dimensions = this.bounds.max.map((value, axis) => value - this.bounds.min[axis]);
    return Math.max(1, Math.hypot(...dimensions));
  }

  fit(resetOrbit = false) {
    this.target = this.bounds.min.map((value, axis) => (value + this.bounds.max[axis]) / 2);
    this.distance = this.size * 1.75;
    if (resetOrbit) { this.azimuth = -.78; this.elevation = .62; }
    this.render();
  }

  cameraState() {
    return {
      target: [...this.target],
      distance: this.distance,
      azimuth: this.azimuth,
      elevation: this.elevation,
      projection: this.projection,
    };
  }

  restoreCamera(camera) {
    if (!camera) return;
    if (Array.isArray(camera.target) && camera.target.length === 3) this.target = camera.target.map(Number);
    if (Number.isFinite(camera.distance)) this.distance = camera.distance;
    if (Number.isFinite(camera.azimuth)) this.azimuth = camera.azimuth;
    if (Number.isFinite(camera.elevation)) this.elevation = camera.elevation;
    this.projection = camera.projection === 'orthographic' ? 'orthographic' : 'perspective';
    this.render();
  }

  setPreset(name) {
    if (name === 'top') { this.azimuth = -Math.PI / 2; this.elevation = Math.PI / 2 - .015; }
    else if (name === 'bottom') { this.azimuth = -Math.PI / 2; this.elevation = -Math.PI / 2 + .015; }
    else if (name === 'front') { this.azimuth = -Math.PI / 2; this.elevation = .06; }
    else if (name === 'right') { this.azimuth = 0; this.elevation = .06; }
    else { this.azimuth = -.78; this.elevation = .62; }
    this.render();
  }

  setProjection(mode) { this.projection = mode === 'orthographic' ? 'orthographic' : 'perspective'; this.render(); }
  setBaseSlot(slot = 0) { this.baseSlot = Math.max(0, Math.floor(Number(slot) || 0)); this.render(); }
  setVisibility(slot, visible) { this.visibility.set(Number(slot), Boolean(visible)); this.render(); }
  setColor(slot, color) { const meshes = this.meshes.filter(item => item.slot === Number(slot)); for (const mesh of meshes) mesh.color = parseColor(color); if (meshes.length) this.render(); }
  setExplode(value) { this.explode = Math.max(0, Number(value) || 0); this.render(); }
  setClipZ(value) { this.clipZ = Number.isFinite(Number(value)) ? Number(value) : 1e6; this.render(); }
  setGrid(visible) { this.showGrid = Boolean(visible); this.render(); }

  resetWorkspace() {
    this.visibility.clear();
    for (const mesh of this.meshes) this.visibility.set(mesh.slot, true);
    this.sectionMeshes.forEach(mesh => this.deleteGeometry(mesh));
    this.sectionMeshes = [];
    this.explode = 0;
    this.clipZ = 1e6;
    this.showGrid = true;
    this.projection = 'perspective';
    this.hoverSurface = null;
    this.azimuth = -.78;
    this.elevation = .62;
    this.render();
  }

  cameraPosition() {
    const horizontal = this.distance * Math.cos(this.elevation);
    return [
      this.target[0] + horizontal * Math.cos(this.azimuth),
      this.target[1] + horizontal * Math.sin(this.azimuth),
      this.target[2] + this.distance * Math.sin(this.elevation),
    ];
  }

  projectionMatrix() {
    const aspect = Math.max(.1, this.canvas.width / this.canvas.height);
    const near = Math.max(.03, this.size / 1000);
    const far = Math.max(100, this.distance + this.size * 12);
    if (this.projection === 'orthographic') {
      const halfHeight = Math.max(this.size * .18, this.distance * Math.tan(Math.PI / 8));
      return orthographic(-halfHeight * aspect, halfHeight * aspect, -halfHeight, halfHeight, near, far);
    }
    return perspective(Math.PI / 4, aspect, near, far);
  }

  bindAttributes(geometry) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.positionBuffer);
    gl.enableVertexAttribArray(this.locations.position);
    gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.normalBuffer);
    gl.enableVertexAttribArray(this.locations.normal);
    gl.vertexAttribPointer(this.locations.normal, 3, gl.FLOAT, false, 0, 0);
  }

  render() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.renderNow(); });
  }

  renderNow() {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.925, 0.933, 0.91, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    const eye = this.cameraPosition();
    gl.uniformMatrix4fv(this.locations.view, false, lookAt(eye, this.target, [0, 0, 1]));
    gl.uniformMatrix4fv(this.locations.projection, false, this.projectionMatrix());
    gl.uniform3fv(this.locations.camera, eye);
    gl.uniform1f(this.locations.clipZ, this.clipZ);
    gl.uniform1f(this.locations.scaleZ, 1);
    gl.uniform1f(this.locations.zOffset, 0);
    gl.uniform2f(this.locations.planarOrigin, 0, 0);
    gl.uniform4f(this.locations.planarMatrix, 1, 0, 0, 1);
    gl.uniform1f(this.locations.opacity, 1);
    const hover = this.hoverSurface;
    gl.uniform1f(this.locations.hoverActive, hover ? 1 : 0);
    gl.uniform3fv(this.locations.hoverPoint, hover?.point || [0, 0, 0]);
    gl.uniform3fv(this.locations.hoverNormal, hover?.normal || [0, 0, 1]);
    gl.uniform1f(this.locations.hoverRadius, hover?.radius || 1);
    if (this.showGrid && this.grid && eye[2] >= this.bounds.min[2] - .001) {
      this.bindAttributes(this.grid);
      gl.uniform3f(this.locations.offset, 0, 0, 0);
      gl.uniform4f(this.locations.color, .38, .43, .40, .24);
      gl.uniform1f(this.locations.unlit, 1);
      gl.disable(gl.CULL_FACE);
      gl.drawArrays(gl.LINES, 0, this.grid.count);
      gl.enable(gl.CULL_FACE);
    }
    gl.uniform1f(this.locations.unlit, 0);
    for (const mesh of this.meshes) {
      if (this.visibility.get(mesh.slot) === false) continue;
      if (this.clipZ <= mesh.bounds.min[2] + .0001) continue;
      this.bindAttributes(mesh);
      const offset = mesh.slot === this.baseSlot ? [0, 0, 0] : [0, 0, (mesh.slot - this.baseSlot || 1) * this.explode];
      gl.uniform3fv(this.locations.offset, offset);
      gl.uniform4fv(this.locations.color, mesh.color);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    gl.uniform1f(this.locations.unlit, .2);
    for (const mesh of this.sectionMeshes) {
      if (this.visibility.get(mesh.slot) === false) continue;
      this.bindAttributes(mesh);
      const offset = mesh.slot === this.baseSlot ? [0, 0, 0] : [0, 0, (mesh.slot - this.baseSlot || 1) * this.explode];
      gl.uniform3fv(this.locations.offset, offset);
      gl.uniform4fv(this.locations.color, mesh.color);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    if (this.decorMeshes.length) {
      gl.uniform1f(this.locations.clipZ, 1e6);
      gl.uniform1f(this.locations.unlit, .18);
      gl.disable(gl.CULL_FACE);
      for (const mesh of this.decorMeshes) {
        this.bindAttributes(mesh);
        gl.uniform3f(this.locations.offset, 0, 0, 0);
        gl.uniform4fv(this.locations.color, mesh.color);
        gl.uniform1f(this.locations.opacity, mesh.opacity);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      }
      gl.enable(gl.CULL_FACE);
      gl.uniform1f(this.locations.opacity, 1);
      gl.uniform1f(this.locations.clipZ, this.clipZ);
    }
    if (this.proxyMeshes.length) {
      const proxy = this.proxyTransform;
      gl.disable(gl.DEPTH_TEST);
      gl.uniform1f(this.locations.clipZ, 1e6);
      gl.uniform1f(this.locations.scaleZ, Number(proxy.zScale) || 1);
      gl.uniform1f(this.locations.zOffset, Number(proxy.zOffset) || 0);
      gl.uniform2f(this.locations.planarOrigin, Number(proxy.planarOriginX) || 0, Number(proxy.planarOriginY) || 0);
      const planar = Array.isArray(proxy.planarMatrix) && proxy.planarMatrix.length === 4 ? proxy.planarMatrix.map(Number) : [1, 0, 0, 1];
      gl.uniform4f(this.locations.planarMatrix, ...planar);
      gl.uniform1f(this.locations.opacity, Math.max(.05, Math.min(.9, Number(proxy.opacity) || .34)));
      gl.uniform1f(this.locations.unlit, .42);
      for (const mesh of this.proxyMeshes) {
        this.bindAttributes(mesh);
        const explode = mesh.slot === this.baseSlot ? 0 : (mesh.slot - this.baseSlot || 1) * this.explode;
        gl.uniform3f(this.locations.offset, Number(proxy.x) || 0, Number(proxy.y) || 0, explode);
        gl.uniform4fv(this.locations.color, mesh.color);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      }
      gl.enable(gl.DEPTH_TEST);
      gl.uniform1f(this.locations.clipZ, this.clipZ);
      gl.uniform1f(this.locations.scaleZ, 1);
      gl.uniform1f(this.locations.zOffset, 0);
      gl.uniform2f(this.locations.planarOrigin, 0, 0);
      gl.uniform4f(this.locations.planarMatrix, 1, 0, 0, 1);
      gl.uniform1f(this.locations.opacity, 1);
    }
    gl.uniform1f(this.locations.unlit, 0);
    if (typeof CustomEvent === 'function') this.canvas.dispatchEvent(new CustomEvent('medalviewerchange'));
  }

  worldToScreen(worldX, worldY, worldZ = 0) {
    const rect = this.canvas.getBoundingClientRect();
    const world = [Number(worldX), Number(worldY), Number(worldZ)];
    if (!rect.width || !rect.height || !world.every(Number.isFinite)) return null;
    const view = lookAt(this.cameraPosition(), this.target, [0, 0, 1]);
    const projected = projectWorldPoint(world, view, this.projectionMatrix());
    if (!projected) return null;
    const x = (projected.x + 1) * rect.width / 2;
    const y = (1 - projected.y) * rect.height / 2;
    return {
      x, y, clientX: rect.left + x, clientY: rect.top + y,
      depth: (projected.z + 1) / 2,
      visible: projected.x >= -1 && projected.x <= 1 && projected.y >= -1 && projected.y <= 1 && projected.z >= -1 && projected.z <= 1,
    };
  }

  designToScreen(x, y, z = 0, displaySlot = 0) {
    const slot = Number(displaySlot);
    const explodeOffset = Number.isFinite(slot) && slot !== 0 ? slot * this.explode : 0;
    return this.worldToScreen(Number(x), -Number(y), Number(z) + explodeOffset);
  }

  designAxisScreenVector(axis = 'z', origin = { x: 0, y: 0, z: 0, slot: 0 }, sampleMm = 1) {
    const directions = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    const direction = directions[axis];
    const sample = Number(sampleMm);
    const point = { x: Number(origin?.x ?? 0), y: Number(origin?.y ?? 0), z: Number(origin?.z ?? 0), slot: Number(origin?.slot ?? 0) };
    if (!direction || !Number.isFinite(sample) || sample <= 0 || ![point.x, point.y, point.z, point.slot].every(Number.isFinite)) return null;
    const start = this.designToScreen(point.x, point.y, point.z, point.slot);
    const end = this.designToScreen(point.x + direction[0] * sample, point.y + direction[1] * sample, point.z + direction[2] * sample, point.slot);
    if (!start || !end) return null;
    const dx = end.clientX - start.clientX, dy = end.clientY - start.clientY;
    return { start, end, dx, dy, sampleMm: sample, pixelsPerMm: Math.hypot(dx, dy) / sample };
  }

  screenDeltaToDesignAxis(clientDx, clientDy, axis = 'z', origin = { x: 0, y: 0, z: 0, slot: 0 }, sampleMm = 1) {
    const dx = Number(clientDx), dy = Number(clientDy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    const vector = this.designAxisScreenVector(axis, origin, sampleMm);
    if (!vector) return null;
    const lengthSquared = vector.dx ** 2 + vector.dy ** 2;
    if (lengthSquared < 1e-6) return null;
    return (dx * vector.dx + dy * vector.dy) / lengthSquared * vector.sampleMm;
  }

  screenToDesignPlane(clientX, clientY, planeZ = 0) {
    const ray = this.screenRay(clientX, clientY, { designSpace: true });
    if (!ray || Math.abs(ray.direction[2]) < .015) return null;
    const distance = (planeZ - ray.origin[2]) / ray.direction[2];
    if (distance < 0) return null;
    return { x: ray.origin[0] + ray.direction[0] * distance, y: ray.origin[1] + ray.direction[1] * distance };
  }

  screenRay(clientX, clientY, { designSpace = false } = {}) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndcX = (clientX - rect.left) / rect.width * 2 - 1;
    const ndcY = 1 - (clientY - rect.top) / rect.height * 2;
    const eye = this.cameraPosition();
    const forward = normalize(subtract(this.target, eye));
    const right = normalize(cross(forward, [0, 0, 1]));
    const up = normalize(cross(right, forward));
    const aspect = Math.max(.1, this.canvas.width / this.canvas.height);
    let origin = [...eye], direction = forward;
    if (this.projection === 'orthographic') {
      const halfHeight = Math.max(this.size * .18, this.distance * Math.tan(Math.PI / 8));
      origin = origin.map((value, axis) => value + right[axis] * ndcX * halfHeight * aspect + up[axis] * ndcY * halfHeight);
    } else {
      const spread = Math.tan(Math.PI / 8);
      direction = normalize(forward.map((value, axis) => value + right[axis] * ndcX * spread * aspect + up[axis] * ndcY * spread));
    }
    // Uploaded model geometry reflects design-space Y. Reflect the ray too when
    // it will be tested against the printable column field.
    if (designSpace) {
      origin = [origin[0], -origin[1], origin[2]];
      direction = [direction[0], -direction[1], direction[2]];
    }
    return { origin, direction };
  }

  pan(dx, dy) {
    const eye = this.cameraPosition();
    const forward = normalize(subtract(this.target, eye));
    const right = normalize(cross(forward, [0, 0, 1]));
    const up = normalize(cross(right, forward));
    const scale = this.distance * .0018;
    for (let axis = 0; axis < 3; axis += 1) this.target[axis] += right[axis] * -dx * scale + up[axis] * dy * scale;
  }

  bindControls() {
    this.canvas.addEventListener('contextmenu', event => event.preventDefault());
    this.canvas.addEventListener('pointerdown', event => {
      if (event.defaultPrevented) return;
      this.canvas.setPointerCapture(event.pointerId);
      this.pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.dragMode = event.button === 2 || event.shiftKey ? 'pan' : 'rotate';
      if (this.pointerState.size === 2) this.capturePinch();
    });
    this.canvas.addEventListener('pointermove', event => {
      if (event.defaultPrevented) return;
      if (!this.pointerState.has(event.pointerId)) return;
      if (this.pointerState.size >= 2) {
        this.pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
        this.updatePinch();
        return;
      }
      const previous = this.pointerState.get(event.pointerId);
      const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
      this.pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.dragMode === 'pan') this.pan(dx, dy);
      else {
        this.azimuth -= dx * .008;
        this.elevation = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, this.elevation + dy * .008));
      }
      this.render();
    });
    const release = event => { this.pointerState.delete(event.pointerId); if (this.pointerState.size === 1) { const point = [...this.pointerState.values()][0]; this.lastPinch = null; this.pointerState = new Map([[...this.pointerState.keys()][0], point]); } };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.distance *= Math.exp(event.deltaY * .0012);
      this.distance = Math.max(this.size * .22, Math.min(this.size * 8, this.distance));
      this.render();
    }, { passive: false });
    this.canvas.addEventListener('dblclick', () => this.fit());
  }

  capturePinch() {
    const points = [...this.pointerState.values()];
    this.lastPinch = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  }

  updatePinch() {
    const points = [...this.pointerState.values()];
    const current = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
    if (this.lastPinch?.distance > 0 && current.distance > 0) {
      this.distance *= this.lastPinch.distance / current.distance;
      this.distance = Math.max(this.size * .22, Math.min(this.size * 8, this.distance));
      this.pan(current.x - this.lastPinch.x, current.y - this.lastPinch.y);
    }
    this.lastPinch = current;
    this.render();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const { width, height } = viewerBufferSize(rect.width, rect.height, globalThis.devicePixelRatio || 1, {
      pixelBudget: this.pixelBudget,
      maxDimension: this.maxViewportDimension,
    });
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.render();
  }

  async toPngBlob() {
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    this.renderNow();
    return new Promise((resolve, reject) => this.canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Preview image could not be created')), 'image/png'));
  }

  destroy() {
    this.resizeObserver.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.meshes.forEach(mesh => this.deleteGeometry(mesh));
    this.sectionMeshes.forEach(mesh => this.deleteGeometry(mesh));
    this.proxyMeshes.forEach(mesh => this.deleteGeometry(mesh));
    this.decorMeshes.forEach(mesh => this.deleteGeometry(mesh));
    this.deleteGeometry(this.grid);
    this.gl.deleteProgram(this.program);
  }
}
