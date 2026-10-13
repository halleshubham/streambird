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

export interface ChromaSettings {
  enabled: boolean;
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

/** The part of the source video to show: full frame, or the centred "cover" crop for a tile of this aspect ratio. */
export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * One keyer = one small offscreen WebGL canvas. `render` uploads the current video frame, keys it, and returns the
 * canvas (premultiplied alpha) to be drawn into the studio canvas straight away. Returns null when WebGL is not
 * available, the video has no picture yet, or the GPU context was lost.
 */
export class ChromaKeyer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};

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
    return !!this.gl && !!this.program && !this.gl.isContextLost();
  }

  private init(gl: WebGLRenderingContext) {
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) {
      this.program = null;
      return;
    }
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      this.program = null;
      return;
    }
    this.program = program;
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const name of ['uCrop', 'uTex', 'uKey', 'uSim', 'uSmooth', 'uSpill']) this.loc[name] = gl.getUniformLocation(program, name);
    gl.uniform1i(this.loc.uTex, 0);
  }

  render(video: HTMLVideoElement, crop: SourceRect, outW: number, outH: number, settings: ChromaSettings): HTMLCanvasElement | null {
    const gl = this.gl;
    if (!gl || !this.program || gl.isContextLost()) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return null;
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
      return null; // the frame could not be read this time; try again on the next one
    }
    const p = chromaParams(settings);
    // Crop in texture space; V is flipped because of UNPACK_FLIP_Y.
    gl.uniform4f(this.loc.uCrop, crop.sx / vw, 1 - (crop.sy + crop.sh) / vh, crop.sw / vw, crop.sh / vh);
    gl.uniform2f(this.loc.uKey, p.key[0], p.key[1]);
    gl.uniform1f(this.loc.uSim, p.similarity);
    gl.uniform1f(this.loc.uSmooth, p.smoothness);
    gl.uniform1f(this.loc.uSpill, p.spill);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }

  /** Frees the GPU context (a browser only allows a handful alive at once). */
  dispose() {
    const gl = this.gl;
    this.gl = null;
    this.program = null;
    try {
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      /* already gone */
    }
  }
}
