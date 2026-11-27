/**
 * Drawing the frame: raw WebGL2, as the scene spec asks of a surface. Each
 * beam is one instance of a capped cylinder (its two ends, radius and
 * colour), lit from the viewer's side; the input mesh is faint lines and
 * the contacts are dots drawn over everything (a closing contact ringed).
 * The camera is orthographic: yaw round the up axis, pitch, scale, pan.
 */
import type { V3 } from "./mesh.ts";

export interface Cam {
  yaw: number;
  pitch: number;
  /** Pixels per centimetre. */
  scale: number;
  target: V3;
  /** Screen offset, in CSS pixels. */
  pan: [number, number];
}

/** The camera's right, up and toward-the-viewer, in the world. */
export function basis(c: Cam): { right: V3; up: V3; toward: V3 } {
  const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), se = Math.sin(c.pitch), ce = Math.cos(c.pitch);
  return { right: [cy, -sy, 0], up: [sy * se, cy * se, ce], toward: [-sy * ce, -cy * ce, se] };
}

/** Where a point is on screen, in CSS pixels, and how near the viewer. */
export function project(c: Cam, W: number, H: number, p: V3): [number, number, number] {
  const { right, up, toward } = basis(c);
  const q: V3 = [p[0] - c.target[0], p[1] - c.target[1], p[2] - c.target[2]];
  const d = (a: V3) => a[0] * q[0] + a[1] * q[1] + a[2] * q[2];
  return [W / 2 + c.pan[0] + d(right) * c.scale, H / 2 + c.pan[1] - d(up) * c.scale, d(toward)];
}

export interface Picture {
  cam: Cam;
  W: number;
  H: number;
  dpr: number;
  /** How deep the scene is, for the depth buffer. */
  reach: number;
  /** Per beam: ax ay az bx by bz r red green blue (0–1). */
  beams: Float32Array;
  beamCount: number;
  /** Per vertex, in pairs: x y z red green blue alpha. */
  lines: Float32Array;
  lineCount: number;
  /** Per dot: x y z red green blue alpha size (px; negative: a ring). */
  dots: Float32Array;
  dotCount: number;
}

const CYL_VS = `#version 300 es
in vec4 a_v; in vec3 a_a; in vec3 a_b; in float a_r; in vec3 a_c;
uniform vec3 u_right, u_up, u_toward, u_target; uniform vec2 u_scale, u_pan; uniform float u_depth;
out vec3 v_n; out vec3 v_c;
void main() {
  vec3 d = a_b - a_a; float L = length(d); vec3 dn = L > 0.0 ? d / L : vec3(0.0, 0.0, 1.0);
  vec3 h = abs(dn.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 u = normalize(cross(dn, h)); vec3 w = cross(dn, u);
  vec3 radial = a_v.x * u + a_v.y * w;
  vec3 p = mix(a_a, a_b, a_v.z) + a_r * radial;
  v_n = a_v.w == 0.0 ? radial : a_v.w * dn;
  v_c = a_c;
  vec3 q = p - u_target;
  gl_Position = vec4(dot(q, u_right) * u_scale.x + u_pan.x, dot(q, u_up) * u_scale.y + u_pan.y, -dot(q, u_toward) * u_depth, 1.0);
}`;
const CYL_FS = `#version 300 es
precision mediump float;
in vec3 v_n; in vec3 v_c; uniform vec3 u_light; out vec4 o;
void main() {
  vec3 n = normalize(v_n);
  float l = 0.45 + 0.55 * max(dot(n, u_light), 0.0);
  o = vec4(v_c * l, 1.0);
}`;
const MARK_VS = `#version 300 es
in vec3 a_p; in vec4 a_c; in float a_s;
uniform vec3 u_right, u_up, u_toward, u_target; uniform vec2 u_scale, u_pan; uniform float u_depth, u_dpr;
out vec4 v_c; out float v_ring;
void main() {
  vec3 q = a_p - u_target;
  gl_Position = vec4(dot(q, u_right) * u_scale.x + u_pan.x, dot(q, u_up) * u_scale.y + u_pan.y, -dot(q, u_toward) * u_depth, 1.0);
  gl_PointSize = abs(a_s) * u_dpr;
  v_c = a_c; v_ring = a_s < 0.0 ? 1.0 : 0.0;
}`;
const MARK_FS = `#version 300 es
precision mediump float;
in vec4 v_c; in float v_ring; uniform float u_points; out vec4 o;
void main() {
  if (u_points > 0.5) {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0 || (v_ring > 0.5 && r < 0.55)) discard;
  }
  o = vec4(v_c.rgb * v_c.a, v_c.a);
}`;

/** A capped cylinder, as (cos, sin, along, cap) per vertex, in triangles. */
function cylinder(sides = 18): Float32Array {
  const v: number[] = [];
  for (let k = 0; k < sides; k++) {
    const a0 = (2 * Math.PI * k) / sides, a1 = (2 * Math.PI * (k + 1)) / sides;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    v.push(c0, s0, 0, 0, c1, s1, 0, 0, c1, s1, 1, 0, c0, s0, 0, 0, c1, s1, 1, 0, c0, s0, 1, 0);
    v.push(0, 0, 0, -1, c1, s1, 0, -1, c0, s0, 0, -1, 0, 0, 1, 1, c0, s0, 1, 1, c1, s1, 1, 1);
  }
  return new Float32Array(v);
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "program");
  return p;
}

export interface Drawer {
  draw(p: Picture): void;
  destroy(): void;
}

/** A drawer on the canvas; null where WebGL2 is not to be had. */
export function drawer(canvas: HTMLCanvasElement): Drawer | null {
  const gl = canvas.getContext("webgl2", { antialias: true, premultipliedAlpha: true });
  if (!gl) return null;
  const cyl = program(gl, CYL_VS, CYL_FS), mark = program(gl, MARK_VS, MARK_FS);
  const shape = cylinder(), shapeCount = shape.length / 4;

  const cylVao = gl.createVertexArray()!, shapeBuf = gl.createBuffer()!, beamBuf = gl.createBuffer()!;
  gl.bindVertexArray(cylVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuf);
  gl.bufferData(gl.ARRAY_BUFFER, shape, gl.STATIC_DRAW);
  const loc = (p: WebGLProgram, n: string) => gl.getAttribLocation(p, n);
  gl.enableVertexAttribArray(loc(cyl, "a_v"));
  gl.vertexAttribPointer(loc(cyl, "a_v"), 4, gl.FLOAT, false, 16, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, beamBuf);
  for (const [name, size, off] of [["a_a", 3, 0], ["a_b", 3, 12], ["a_r", 1, 24], ["a_c", 3, 28]] as const) {
    const l = loc(cyl, name);
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, gl.FLOAT, false, 40, off);
    gl.vertexAttribDivisor(l, 1);
  }

  const markVao = (stride: number) => {
    const vao = gl.createVertexArray()!, buf = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc(mark, "a_p"));
    gl.vertexAttribPointer(loc(mark, "a_p"), 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(loc(mark, "a_c"));
    gl.vertexAttribPointer(loc(mark, "a_c"), 4, gl.FLOAT, false, stride, 12);
    const s = loc(mark, "a_s");
    if (stride > 28) (gl.enableVertexAttribArray(s), gl.vertexAttribPointer(s, 1, gl.FLOAT, false, stride, 28));
    else (gl.disableVertexAttribArray(s), gl.vertexAttrib1f(s, 1));
    return { vao, buf };
  };
  const lines = markVao(28), dots = markVao(32);
  gl.bindVertexArray(null);

  const camera = (p: WebGLProgram, pic: Picture) => {
    const { right, up, toward } = basis(pic.cam);
    const u = (n: string) => gl.getUniformLocation(p, n);
    gl.uniform3fv(u("u_right"), right);
    gl.uniform3fv(u("u_up"), up);
    gl.uniform3fv(u("u_toward"), toward);
    gl.uniform3fv(u("u_target"), pic.cam.target);
    gl.uniform2f(u("u_scale"), (2 * pic.cam.scale) / pic.W, (2 * pic.cam.scale) / pic.H);
    gl.uniform2f(u("u_pan"), (2 * pic.cam.pan[0]) / pic.W, (-2 * pic.cam.pan[1]) / pic.H);
    gl.uniform1f(u("u_depth"), 1 / Math.max(1, pic.reach * 2));
    return { right, up, toward };
  };

  return {
    draw(pic) {
      const w = Math.round(pic.W * pic.dpr), h = Math.round(pic.H * pic.dpr);
      if (canvas.width !== w || canvas.height !== h) (canvas.width = w), (canvas.height = h);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      gl.useProgram(cyl);
      const { right, up, toward } = camera(cyl, pic);
      const light = [toward[0] * 0.75 + up[0] * 0.5 - right[0] * 0.3, toward[1] * 0.75 + up[1] * 0.5 - right[1] * 0.3, toward[2] * 0.75 + up[2] * 0.5 - right[2] * 0.3];
      const ll = Math.hypot(light[0]!, light[1]!, light[2]!);
      gl.uniform3f(gl.getUniformLocation(cyl, "u_light"), light[0]! / ll, light[1]! / ll, light[2]! / ll);
      gl.bindVertexArray(cylVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, beamBuf);
      gl.bufferData(gl.ARRAY_BUFFER, pic.beams.subarray(0, pic.beamCount * 10), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, shapeCount, pic.beamCount);

      gl.useProgram(mark);
      camera(mark, pic);
      gl.uniform1f(gl.getUniformLocation(mark, "u_dpr"), pic.dpr);
      gl.uniform1f(gl.getUniformLocation(mark, "u_points"), 0);
      gl.bindVertexArray(lines.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, lines.buf);
      gl.bufferData(gl.ARRAY_BUFFER, pic.lines.subarray(0, pic.lineCount * 7), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.LINES, 0, pic.lineCount);

      gl.disable(gl.DEPTH_TEST);
      gl.uniform1f(gl.getUniformLocation(mark, "u_points"), 1);
      gl.bindVertexArray(dots.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, dots.buf);
      gl.bufferData(gl.ARRAY_BUFFER, pic.dots.subarray(0, pic.dotCount * 8), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, pic.dotCount);
      gl.bindVertexArray(null);
    },
    destroy() {
      gl.deleteProgram(cyl);
      gl.deleteProgram(mark);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
