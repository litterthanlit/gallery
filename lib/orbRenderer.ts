/**
 * Draws the orb's pieces as smoothly bent surfaces with WebGL 2, matching
 * the CSS 3D scene they sit behind: same camera (`perspective` from the
 * viewport centre), same pixels, same transforms (see `transform3d.ts`).
 */

/** Grid cells across each piece; plenty for the curve to read as smooth. */
const GRID = 16;
/** View depth mapped onto the depth buffer, in CSS pixels either side of the screen. */
const DEPTH_RANGE = 4000;
const PLACEHOLDER = [235 / 255, 230 / 255, 223 / 255] as const;

export type OrbPiece = {
  /** The tile's own image; its texture is shared by every piece with the same source. */
  image: HTMLImageElement;
  /** Tile-local CSS pixels (centred) to view space: the whole CSS transform chain. */
  matrix: Float32Array;
  /** Laid-out size in tile-local pixels. */
  width: number;
  height: number;
  /** Curvature (1 / radius) across and down the piece, in tile-local pixels. */
  curveX: number;
  curveY: number;
  opacity: number;
};

export type OrbScene = {
  /** CSS size of the canvas, which covers the perspective box. */
  width: number;
  height: number;
  perspective: number;
  pieces: OrbPiece[];
};

export type OrbRenderer = {
  /** False once the context is lost (until restored); draw then does nothing. */
  readonly ready: boolean;
  /** Draw a frame. Returns true while some piece still waits on its image. */
  draw(scene: OrbScene): boolean;
  dispose(): void;
};

const VERTEX = `#version 300 es
in vec2 a_grid;
uniform mat4 u_matrix;
uniform vec2 u_size;
uniform vec2 u_curve;
uniform vec2 u_canvas;
uniform float u_perspective;
out vec2 v_uv;

// Along and behind the tangent after an arc of length s, curvature k.
float along(float s, float k) { return abs(k) > 1e-7 ? sin(s * k) / k : s; }
float below(float s, float k) { return abs(k) > 1e-7 ? (cos(s * k) - 1.0) / k : 0.0; }

void main() {
  vec2 p = a_grid * u_size;
  float back = below(p.y, u_curve.y);
  float turn = p.x * u_curve.x;
  vec3 bent = vec3(
    along(p.x, u_curve.x) + back * sin(turn),
    along(p.y, u_curve.y),
    below(p.x, u_curve.x) + back * cos(turn));
  vec4 view = u_matrix * vec4(bent, 1.0);
  // CSS perspective: screen offset = view.xy * P / (P - z).
  float w = (u_perspective - view.z) / u_perspective;
  gl_Position = vec4(
    view.x * 2.0 / u_canvas.x,
    -view.y * 2.0 / u_canvas.y,
    -view.z / ${DEPTH_RANGE.toFixed(1)} * w,
    w);
  v_uv = a_grid + 0.5;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_image;
uniform bool u_loaded;
uniform vec3 u_placeholder;
uniform float u_opacity;
out vec4 color;

void main() {
  vec4 texel = u_loaded ? texture(u_image, v_uv) : vec4(u_placeholder, 1.0);
  color = texel * u_opacity;
}`;

type Gpu = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  indexCount: number;
  uniforms: Record<string, WebGLUniformLocation | null>;
  /** Anisotropic filtering keeps pieces at steep angles near the rim crisp. */
  anisotropy: { pname: number; level: number } | null;
  textures: Map<string, WebGLTexture>;
};

/** Returns null where WebGL 2 isn't available; the gallery then shows flat images. */
export function createOrbRenderer(canvas: HTMLCanvasElement): OrbRenderer | null {
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) return null;

  let gpu: Gpu | null = setUp(gl);
  if (!gpu) return null;

  const onLost = (event: Event) => {
    event.preventDefault();
    gpu = null;
  };
  const onRestored = () => {
    gpu = setUp(gl);
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  return {
    get ready() {
      return gpu !== null;
    },
    draw(scene) {
      return gpu ? drawScene(gpu, canvas, scene) : false;
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (!gpu) return;
      for (const texture of gpu.textures.values()) gl.deleteTexture(texture);
      gl.deleteProgram(gpu.program);
      gl.deleteVertexArray(gpu.vao);
      gpu = null;
    },
  };
}

function setUp(gl: WebGL2RenderingContext): Gpu | null {
  const program = link(gl, VERTEX, FRAGMENT);
  const vao = gl.createVertexArray();
  if (!program || !vao) return null;

  const vertices: number[] = [];
  for (let row = 0; row <= GRID; row += 1) {
    for (let col = 0; col <= GRID; col += 1) vertices.push(col / GRID - 0.5, row / GRID - 0.5);
  }
  const indices: number[] = [];
  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < GRID; col += 1) {
      const a = row * (GRID + 1) + col;
      const b = a + GRID + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_grid");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  const uniforms = Object.fromEntries(
    ["u_matrix", "u_size", "u_curve", "u_canvas", "u_perspective", "u_image", "u_loaded", "u_placeholder", "u_opacity"].map(
      (name) => [name, gl.getUniformLocation(program, name)],
    ),
  );
  const anisotropic = gl.getExtension("EXT_texture_filter_anisotropic");
  const anisotropy = anisotropic
    ? {
        pname: anisotropic.TEXTURE_MAX_ANISOTROPY_EXT,
        level: Math.min(8, gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number),
      }
    : null;

  return { gl, program, vao, indexCount: indices.length, uniforms, anisotropy, textures: new Map() };
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram | null {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      return null;
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

/** The texture for an image once it has loaded, uploaded on first use. */
function textureFor(gpu: Gpu, image: HTMLImageElement): WebGLTexture | null {
  const source = image.currentSrc || image.src;
  const cached = gpu.textures.get(source);
  if (cached) return cached;
  if (!image.complete || image.naturalWidth === 0) return null;

  const { gl } = gpu;
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (gpu.anisotropy) gl.texParameterf(gl.TEXTURE_2D, gpu.anisotropy.pname, gpu.anisotropy.level);
  gpu.textures.set(source, texture);
  return texture;
}

function drawScene(gpu: Gpu, canvas: HTMLCanvasElement, scene: OrbScene): boolean {
  const { gl, uniforms } = gpu;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(scene.width * dpr);
  const height = Math.round(scene.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clearDepth(1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  gl.useProgram(gpu.program);
  gl.bindVertexArray(gpu.vao);
  gl.uniform2f(uniforms.u_canvas!, scene.width, scene.height);
  gl.uniform1f(uniforms.u_perspective!, scene.perspective);
  gl.uniform3f(uniforms.u_placeholder!, ...PLACEHOLDER);
  gl.uniform1i(uniforms.u_image!, 0);
  gl.activeTexture(gl.TEXTURE0);

  // Back to front, so the faint far side blends under the front.
  const pieces = scene.pieces
    .filter((piece) => piece.opacity > 0.001)
    .sort((a, b) => a.matrix[14]! - b.matrix[14]!);
  let waiting = false;
  for (const piece of pieces) {
    const texture = textureFor(gpu, piece.image);
    if (!texture) waiting ||= !piece.image.complete;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniforms.u_loaded!, texture ? 1 : 0);
    gl.uniformMatrix4fv(uniforms.u_matrix!, false, piece.matrix);
    gl.uniform2f(uniforms.u_size!, piece.width, piece.height);
    gl.uniform2f(uniforms.u_curve!, piece.curveX, piece.curveY);
    gl.uniform1f(uniforms.u_opacity!, piece.opacity);
    gl.drawElements(gl.TRIANGLES, gpu.indexCount, gl.UNSIGNED_SHORT, 0);
  }
  gl.bindVertexArray(null);
  return waiting;
}
