/**
 * Records the composited studio stream (the canvas picture + the mixed audio)
 * on the host's own computer. Nothing is uploaded: when the browser supports
 * the File System Access API the host picks a file and chunks are written to
 * disk as they arrive (a crash keeps what was written); otherwise chunks are
 * kept in memory and downloaded when the host stops.
 */

/** Best container the browser can record: MP4 (plays everywhere) when it can, else WebM. */
const CANDIDATES: { mime: string; ext: 'mp4' | 'webm' }[] = [
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];

export function pickRecordingType(isSupported: (mime: string) => boolean): { mime: string; ext: 'mp4' | 'webm' } | null {
  return CANDIDATES.find((c) => isSupported(c.mime)) ?? null;
}

export const recordingSupported = (): boolean =>
  typeof MediaRecorder !== 'undefined' && pickRecordingType((m) => MediaRecorder.isTypeSupported(m)) !== null;

const pad = (n: number) => String(n).padStart(2, '0');

/** "My show!" at 2026-10-12 09:05 -> "streambird-my-show-2026-10-12-0905.mp4". */
export function recordingFileName(title: string | null | undefined, at: Date, ext: string): string {
  const slug = (title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `streambird-${slug ? `${slug}-` : ''}${stamp}.${ext}`;
}

/** 83 -> "01:23", 3725 -> "1:02:05". */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

interface FileHandleLike {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}
type SavePicker = (opts: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileHandleLike>;

export interface StartedRecording {
  /** Stops, finishes the file (or starts the download) and resolves with its name. */
  stop(): Promise<{ fileName: string; savedToDisk: boolean }>;
}

export interface StartOptions {
  stream: MediaStream;
  videoBitsPerSecond: number;
  fileName: (ext: string) => string;
  /** Called if the recorder dies on its own (disk write failed, tracks ended...). */
  onError: (message: string) => void;
}

/** Must be called from a click handler: the file picker needs the user gesture. Throws 'cancelled' if the host dismisses the picker. */
export async function startRecording(opts: StartOptions): Promise<StartedRecording> {
  const type = pickRecordingType((m) => MediaRecorder.isTypeSupported(m));
  if (!type) throw new Error('This browser cannot record video. Try Chrome, Edge or Safari 17+.');
  const fileName = opts.fileName(type.ext);

  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  let writable: Awaited<ReturnType<FileHandleLike['createWritable']>> | null = null;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: fileName,
        types: [{ description: type.ext === 'mp4' ? 'MP4 video' : 'WebM video', accept: { [type.ext === 'mp4' ? 'video/mp4' : 'video/webm']: [`.${type.ext}`] } }],
      });
      writable = await handle.createWritable();
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') throw new Error('cancelled');
      writable = null; // blocked or unsupported here: fall back to a download
    }
  }

  const recorder = new MediaRecorder(opts.stream, { mimeType: type.mime, videoBitsPerSecond: opts.videoBitsPerSecond });
  const memory: Blob[] = [];
  let writing: Promise<void> = Promise.resolve();
  let failed = false;
  recorder.ondataavailable = (e) => {
    if (!e.data || e.data.size === 0) return;
    if (writable) {
      const w = writable;
      writing = writing.then(() => w.write(e.data)).catch((err) => {
        if (failed) return;
        failed = true;
        opts.onError(`Recording stopped: could not write to disk (${(err as Error).message}).`);
        try { recorder.stop(); } catch { /* already stopped */ }
      });
    } else {
      memory.push(e.data);
    }
  };
  recorder.onerror = () => {
    failed = true;
    opts.onError('Recording stopped unexpectedly.');
  };
  recorder.start(2000); // a chunk every 2 s keeps memory low and a crash loses little

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  return {
    async stop() {
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      await writing;
      if (writable) {
        await writable.close().catch(() => {});
        return { fileName, savedToDisk: true };
      }
      const url = URL.createObjectURL(new Blob(memory, { type: type.mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return { fileName, savedToDisk: false };
    },
  };
}
