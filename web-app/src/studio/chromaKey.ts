/**
 * Green-screen ("chroma key") for one participant's video, done on the GPU in
 * the host's browser: the video frame goes through a small WebGL shader that
 * turns the key colour transparent, and the result is drawn into the studio
 * canvas like any other picture. Nothing leaves the computer.
 *
 * The maths is the usual CbCr-distance key (colour difference with the
 * brightness ignored, so a shadowed part of the screen still keys out):
 *   distance = |CbCr(pixel) - CbCr(key)|
 *   alpha    = clamp((distance - similarity) / smoothness, 0, 1) ^ 1.5
 *   spill    = pixels just inside the edge are desaturated towards grey
 * `chromaAlpha` below is the same formula in TypeScript: the reference that the
 * tests pin down, and what the shader (GLSL) must agree with.
 */

export type CutoutMode = 'color' | 'person';

export interface ChromaSettings {
  enabled: boolean;
  /** 'color': remove a green/blue screen. 'person': keep only the person, whatever the background. */
  mode: CutoutMode;
  /** '#rrggbb' of the screen to remove. */
  keyColor: string;
  /** 0-100: how far from the key colour still counts as screen (higher removes more). */
  similarity: number;
  /** 0-100: how soft the edge is (higher = softer, more see-through hair/edges). */
  smoothness: number;
  /** 0-100: how strongly green/blue fringes are neutralised on the person. */
  spill: number;
}

export const CHROMA_RANGES = { min: 0, max: 100 } as const;

export const KEY_PRESETS = {
  green: '#00b140',
  blue: '#0047bb',
} as const;

export const DEFAULT_CHROMA: ChromaSettings = {
  enabled: false,
  mode: 'color',
  keyColor: KEY_PRESETS.green,
  similarity: 50,
  smoothness: 12,
  spill: 12,
};

const clampPct = (v: number) => Math.min(CHROMA_RANGES.max, Math.max(CHROMA_RANGES.min, Number.isFinite(v) ? v : 0));

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

/** Fills in anything missing or out of range, so a stale saved value can never break the studio. */
export function normalizeChroma(raw: Partial<ChromaSettings> | null | undefined): ChromaSettings {
  const r = raw ?? {};
  return {
    enabled: r.enabled === true,
    mode: r.mode === 'person' ? 'person' : 'color',
    keyColor: isHexColor(r.keyColor) ? r.keyColor.toLowerCase() : DEFAULT_CHROMA.keyColor,
    similarity: clampPct(r.similarity ?? DEFAULT_CHROMA.similarity),
    smoothness: clampPct(r.smoothness ?? DEFAULT_CHROMA.smoothness),
    spill: clampPct(r.spill ?? DEFAULT_CHROMA.spill),
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = isHexColor(hex) ? hex : DEFAULT_CHROMA.keyColor;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Colour difference (Cb, Cr) of an 0-255 RGB colour, BT.601, brightness left out. */
export function cbcr(r: number, g: number, b: number): [number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  return [-0.169 * R - 0.331 * G + 0.5 * B, 0.5 * R - 0.419 * G - 0.081 * B];
}

/** The 0-100 sliders as the shader's distances. Smoothness and spill never reach 0 (division). */
export function chromaParams(s: ChromaSettings): { key: [number, number]; similarity: number; smoothness: number; spill: number } {
  return {
    key: cbcr(...hexToRgb(s.keyColor)),
    similarity: (clampPct(s.similarity) / 100) * 0.5,
    smoothness: Math.max(0.001, (clampPct(s.smoothness) / 100) * 0.3),
    spill: Math.max(0.001, (clampPct(s.spill) / 100) * 0.3),
  };
}

/** Opacity (0 = fully removed, 1 = kept) of one 0-255 RGB pixel. Mirrors the fragment shader. */
export function chromaAlpha(rgb: [number, number, number], s: ChromaSettings): number {
  const p = chromaParams(s);
  const [cb, cr] = cbcr(...rgb);
  const d = Math.hypot(cb - p.key[0], cr - p.key[1]);
  const base = d - p.similarity;
  return Math.pow(Math.min(1, Math.max(0, base / p.smoothness)), 1.5);
}

/** How the sliders act in 'person' mode: a confidence threshold (higher removes more) and an edge width. */
export function personParams(s: ChromaSettings): { threshold: number; softness: number } {
  return { threshold: 0.25 + (clampPct(s.similarity) / 100) * 0.5, softness: 0.02 + (clampPct(s.smoothness) / 100) * 0.6 };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Opacity (0 = removed, 1 = kept) for a pixel the model is `m` (0 to 1) sure is the person. Mirrors the shader. */
export function personAlpha(m: number, s: ChromaSettings): number {
  const p = personParams(s);
  return smoothstep(p.threshold - p.softness / 2, p.threshold + p.softness / 2, m);
}

/**
 * Blends the new mask into the previous one (as 0-255 bytes) so the edge does not flicker from frame to frame.
 * `k` is how much of the new mask is used (1 = no smoothing). Writes into `out` (reused every frame) and returns it.
 */
export function smoothMask(prev: Uint8Array | null, raw: Float32Array, out: Uint8Array | null, k = 0.6): Uint8Array {
  const target = out && out.length === raw.length ? out : new Uint8Array(raw.length);
  const usePrev = prev !== null && prev.length === raw.length;
  for (let i = 0; i < raw.length; i++) {
    const v = Math.min(255, Math.max(0, raw[i] * 255));
    target[i] = usePrev ? Math.round(prev![i] * (1 - k) + v * k) : Math.round(v);
  }
  return target;
}

/** A smoothed mask ready for the GPU. */
export interface MaskBytes {
  data: Uint8Array;
  width: number;
  height: number;
}

const VERTEX = `
attribute vec2 aPos;
uniform vec4 uCrop;
varying vec2 vUv;
void main() {
  vec2 uv = aPos * 0.5 + 0.5;
  vUv = uCrop.xy + uv * uCrop.zw;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uKey;
uniform float uSim;
uniform float uSmooth;
uniform float uSpill;
varying vec2 vUv;
vec2 cbcr(vec3 c) {
  return vec2(-0.169 * c.r - 0.331 * c.g + 0.5 * c.b, 0.5 * c.r - 0.419 * c.g - 0.081 * c.b);
}
void main() {
  vec4 c = texture2D(uTex, vUv);
  float d = distance(cbcr(c.rgb), uKey);
  float base = d - uSim;
  float a = pow(clamp(base / uSmooth, 0.0, 1.0), 1.5);
  float sp = pow(clamp(base / uSpill, 0.0, 1.0), 1.5);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 rgb = mix(vec3(luma), c.rgb, sp);
  gl_FragColor = vec4(rgb * a, a);
}`;

const PERSON_FRAGMENT = `
precision mediump float;
uniform sampler2D uTex;
uniform sampler2D uMask;
uniform float uThr;
uniform float uSoft;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uTex, vUv);
  float m = texture2D(uMask, vUv).r;
  float a = smoothstep(uThr - uSoft * 0.5, uThr + uSoft * 0.5, m);
  gl_FragColor = vec4(c.rgb * a, a);
}`;

/** The part of the source video to show: full frame, or the centred "cover" crop for a tile of this aspect ratio. */
export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * One keyer = one small offscreen WebGL canvas. `render` (green screen) and `renderPerson` (person cut-out) upload the
 * current video frame, key it, and return the canvas (premultiplied alpha) to be drawn into the studio canvas straight
 * away. Both return null when WebGL is not available, the video has no picture yet, or the GPU context was lost.
 */
export class ChromaKeyer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null;
  private colorProgram: WebGLProgram | null = null;
  private personProgram: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private maskTexture: WebGLTexture | null = null;
  private colorLoc: Record<string, WebGLUniformLocation | null> = {};
  private personLoc: Record<string, WebGLUniformLocation | null> = {};

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2;
    this.canvas.height = 2;
    this.gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false }) as WebGLRenderingContext | null;
    if (this.gl) this.init(this.gl);
    this.canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.canvas.addEventListener('webglcontextrestored', () => {
      if (this.gl) this.init(this.gl);
    });
  }

  get supported(): boolean {
    return !!this.gl && !!this.colorProgram && !!this.personProgram && !this.gl.isContextLost();
  }

  private link(gl: WebGLRenderingContext, fragment: string): WebGLProgram | null {
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    if (!vs || !fs) return null;
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.linkProgram(program);
    return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
  }

  private init(gl: WebGLRenderingContext) {
    this.colorProgram = this.link(gl, FRAGMENT);
    this.personProgram = this.link(gl, PERSON_FRAGMENT);
    if (!this.colorProgram || !this.personProgram) return;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const makeTexture = (unit: number) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    };
    this.texture = makeTexture(0);
    this.maskTexture = makeTexture(1);
    for (const name of ['uCrop', 'uTex', 'uKey', 'uSim', 'uSmooth', 'uSpill']) this.colorLoc[name] = gl.getUniformLocation(this.colorProgram, name);
    for (const name of ['uCrop', 'uTex', 'uMask', 'uThr', 'uSoft']) this.personLoc[name] = gl.getUniformLocation(this.personProgram, name);
  }

  /** Common start of a frame: size the canvas, upload the video as texture 0. Returns false if there is nothing to draw. */
  private begin(video: HTMLVideoElement, outW: number, outH: number): boolean {
    const gl = this.gl;
    if (!gl || !this.colorProgram || !this.personProgram || gl.isContextLost()) return false;
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return false;
    const w = Math.max(2, Math.round(outW));
    const h = Math.max(2, Math.round(outH));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch {
      return false; // the frame could not be read this time; try again on the next one
    }
    return true;
  }

  /** Crop in texture space; V is flipped because of UNPACK_FLIP_Y. */
  private cropUniform(loc: WebGLUniformLocation | null, video: HTMLVideoElement, crop: SourceRect) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    this.gl!.uniform4f(loc, crop.sx / vw, 1 - (crop.sy + crop.sh) / vh, crop.sw / vw, crop.sh / vh);
  }

  private draw(): HTMLCanvasElement {
    const gl = this.gl!;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }

  /** Green screen: removes the key colour. */
  render(video: HTMLVideoElement, crop: SourceRect, outW: number, outH: number, settings: ChromaSettings): HTMLCanvasElement | null {
    if (!this.begin(video, outW, outH)) return null;
    const gl = this.gl!;
    gl.useProgram(this.colorProgram);
    gl.uniform1i(this.colorLoc.uTex, 0);
    const p = chromaParams(settings);
    this.cropUniform(this.colorLoc.uCrop, video, crop);
    gl.uniform2f(this.colorLoc.uKey, p.key[0], p.key[1]);
    gl.uniform1f(this.colorLoc.uSim, p.similarity);
    gl.uniform1f(this.colorLoc.uSmooth, p.smoothness);
    gl.uniform1f(this.colorLoc.uSpill, p.spill);
    return this.draw();
  }

  /** Person cut-out: keeps what `mask` (the whole frame, 0-255 per pixel, high = person) says is the person. */
  renderPerson(video: HTMLVideoElement, crop: SourceRect, outW: number, outH: number, mask: MaskBytes, settings: ChromaSettings): HTMLCanvasElement | null {
    if (!this.begin(video, outW, outH)) return null;
    const gl = this.gl!;
    gl.useProgram(this.personProgram);
    gl.uniform1i(this.personLoc.uTex, 0);
    gl.uniform1i(this.personLoc.uMask, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, mask.width, mask.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, mask.data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    const p = personParams(settings);
    this.cropUniform(this.personLoc.uCrop, video, crop);
    gl.uniform1f(this.personLoc.uThr, p.threshold);
    gl.uniform1f(this.personLoc.uSoft, p.softness);
    return this.draw();
  }

  /** Frees the GPU context (a browser only allows a handful alive at once). */
  dispose() {
    const gl = this.gl;
    this.gl = null;
    this.colorProgram = null;
    this.personProgram = null;
    try {
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      /* already gone */
    }
  }
}
