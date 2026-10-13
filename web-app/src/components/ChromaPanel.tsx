import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { ChromaKeyer, DEFAULT_CHROMA, KEY_PRESETS, rgbToHex, type ChromaSettings } from '../studio/chromaKey';
import type { ParticipantView } from '../studio/useHostStudio';

interface Props {
  person: ParticipantView;
  onChange: (patch: Partial<ChromaSettings>) => void;
  onBackground: (file: File | null) => void;
}

const CHECKER = 12;

/** Draws the "transparent" checkerboard that signals which part of the picture is removed. */
function paintChecker(ctx: CanvasRenderingContext2D, w: number, h: number) {
  for (let y = 0; y < h; y += CHECKER) {
    for (let x = 0; x < w; x += CHECKER) {
      ctx.fillStyle = ((x / CHECKER + y / CHECKER) & 1) === 0 ? '#d4d4d8' : '#f4f4f5';
      ctx.fillRect(x, y, CHECKER, CHECKER);
    }
  }
}

/**
 * Green-screen controls for one person, under their row in the Participants panel.
 *  - Two live previews side by side: their camera as it comes in (click the screen colour to pick it) and how it
 *    will look with the screen removed, over the picture you chose or a checkerboard. You see every change at once,
 *    without scrolling up to the main picture.
 *  - The basics first (on/off, screen colour, how much to remove, a picture behind); fine-tuning is tucked away.
 */
export function ChromaPanel({ person, onChange, onBackground }: Props) {
  const c = person.chroma;
  const name = person.displayName;
  const who = person.isLocal ? 'you' : name;
  const rawRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(c);
  const bgRef = useRef(person.chromaBgCanvas);
  const [pickNote, setPickNote] = useState<string | null>(null);
  settingsRef.current = c;
  bgRef.current = person.chromaBgCanvas;

  // The raw camera preview.
  useEffect(() => {
    const el = rawRef.current;
    if (!el) return;
    if (el.srcObject !== person.stream) el.srcObject = person.stream;
    if (person.stream) el.play().catch(() => {});
  }, [person.stream]);

  // The "how it will look" preview: its own small keyer, drawn ~12 times a second while the panel is open.
  useEffect(() => {
    const keyer = new ChromaKeyer();
    const timer = setInterval(() => {
      const video = rawRef.current;
      const canvas = resultRef.current;
      if (!video || !canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const bg = bgRef.current;
      if (bg) {
        const scale = Math.max(w / bg.width, h / bg.height);
        ctx.drawImage(bg, (bg.width - w / scale) / 2, (bg.height - h / scale) / 2, w / scale, h / scale, 0, 0, w, h);
      } else {
        paintChecker(ctx, w, h);
      }
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh || !keyer.supported) return;
      const scale = Math.max(w / vw, h / vh);
      const sw = w / scale;
      const sh = h / scale;
      const out = keyer.render(video, { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh }, w, h, settingsRef.current);
      if (out) ctx.drawImage(out, 0, 0, w, h);
    }, 80);
    return () => {
      clearInterval(timer);
      keyer.dispose();
    };
  }, []);

  /** Click the screen in the camera preview: average a small patch around the click and use it as the screen colour. */
  function pickFromPreview(e: React.MouseEvent<HTMLVideoElement>) {
    const video = rawRef.current;
    if (!video || !video.videoWidth) {
      setPickNote('The camera is not showing yet.');
      return;
    }
    const rect = video.getBoundingClientRect();
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const shownW = video.videoWidth * scale;
    const shownH = video.videoHeight * scale;
    const x = (e.clientX - rect.left - (rect.width - shownW) / 2) / scale;
    const y = (e.clientY - rect.top - (rect.height - shownH) / 2) / scale;
    if (x < 0 || y < 0 || x >= video.videoWidth || y >= video.videoHeight) {
      setPickNote('Click on the picture itself, not the black edge.');
      return;
    }
    const probe = document.createElement('canvas');
    probe.width = video.videoWidth;
    probe.height = video.videoHeight;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    if (!pctx) return;
    pctx.drawImage(video, 0, 0);
    const r = 3;
    const sx = Math.max(0, Math.round(x) - r);
    const sy = Math.max(0, Math.round(y) - r);
    const data = pctx.getImageData(sx, sy, Math.min(2 * r + 1, probe.width - sx), Math.min(2 * r + 1, probe.height - sy)).data;
    let rs = 0;
    let gs = 0;
    let bs = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      rs += data[i];
      gs += data[i + 1];
      bs += data[i + 2];
    }
    onChange({ keyColor: rgbToHex(rs / n, gs / n, bs / n) });
    setPickNote('Screen colour picked.');
  }

  const slider = (id: string, label: string, key: 'similarity' | 'smoothness' | 'spill', hint: string) => (
    <div className="chroma-slider">
      <label htmlFor={id}>
        {label}: {c[key]}
      </label>
      <input id={id} type="range" min={0} max={100} step={1} value={c[key]} aria-describedby={`${id}-hint`} onChange={(e) => onChange({ [key]: Number(e.target.value) })} />
      <span id={`${id}-hint`} className="docs-hint">
        {hint}
      </span>
    </div>
  );

  const isDefault = c.keyColor === DEFAULT_CHROMA.keyColor && c.similarity === DEFAULT_CHROMA.similarity && c.smoothness === DEFAULT_CHROMA.smoothness && c.spill === DEFAULT_CHROMA.spill;

  return (
    <div className="chroma-panel" role="group" aria-label={`Green screen for ${name}`}>
      <label className="checkbox-row">
        <input type="checkbox" checked={c.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} /> Remove the background colour behind {who}
      </label>
      <p className="docs-hint">Works best with an evenly lit green (or blue) screen and nothing green worn. {person.isLocal ? 'Your' : 'Their'} wallpaper or canvas style shows through unless you add a picture below.</p>

      <div className="chroma-previews">
        <figure>
          {person.stream ? (
            <video ref={rawRef} className="chroma-preview chroma-preview--pick" muted playsInline autoPlay onClick={pickFromPreview} aria-label={`${name}'s camera. Click the screen colour to pick it.`} />
          ) : (
            <div className="chroma-preview chroma-preview--empty">Camera is off</div>
          )}
          <figcaption>Camera: click the screen colour to pick it</figcaption>
        </figure>
        <figure>
          <canvas ref={resultRef} className="chroma-preview" width={320} height={180} role="img" aria-label={`How ${name} will look with the screen removed`} />
          <figcaption>How it will look{c.enabled ? '' : ' (tick the box above to use it)'}</figcaption>
        </figure>
      </div>

      <div className="chroma-key-row">
        <span className="chroma-key-label">Screen colour</span>
        <button type="button" className={`icon-btn icon-btn--small${c.keyColor === KEY_PRESETS.green ? ' icon-btn--accent' : ''}`} onClick={() => onChange({ keyColor: KEY_PRESETS.green })}>
          Green
        </button>
        <button type="button" className={`icon-btn icon-btn--small${c.keyColor === KEY_PRESETS.blue ? ' icon-btn--accent' : ''}`} onClick={() => onChange({ keyColor: KEY_PRESETS.blue })}>
          Blue
        </button>
        <input className="chroma-color" type="color" aria-label={`Screen colour for ${name}`} value={c.keyColor} onChange={(e) => onChange({ keyColor: e.target.value })} />
        <span className="docs-hint" role="status">
          {pickNote ?? ''}
        </span>
      </div>

      {slider(`chroma-sim-${person.id}`, 'Amount removed', 'similarity', 'Raise it until the screen is gone; lower it if the person starts to fade.')}

      <details className="chroma-more">
        <summary>Fine-tune the edges</summary>
        {slider(`chroma-smooth-${person.id}`, 'Edge softness', 'smoothness', 'Higher blends the edge, which helps hair.')}
        {slider(`chroma-spill-${person.id}`, 'Remove green glow', 'spill', 'Takes the green tint off the edges of the person.')}
      </details>

      <div className="chroma-actions">
        <button type="button" className="icon-btn icon-btn--small" disabled={isDefault} onClick={() => onChange({ keyColor: DEFAULT_CHROMA.keyColor, similarity: DEFAULT_CHROMA.similarity, smoothness: DEFAULT_CHROMA.smoothness, spill: DEFAULT_CHROMA.spill })}>
          <RotateCcw size={14} /> Reset
        </button>
      </div>

      <div className="chroma-bg">
        <label htmlFor={`chroma-bg-${person.id}`}>Picture behind {who}</label>
        <div className="chroma-bg-row">
          <input id={`chroma-bg-${person.id}`} type="file" accept="image/*" onChange={(e) => onBackground(e.target.files?.[0] ?? null)} />
          {person.chromaBgName && (
            <>
              <span className="docs-hint">{person.chromaBgName}</span>
              <button type="button" className="icon-btn icon-btn--small" onClick={() => onBackground(null)}>
                Remove picture
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
