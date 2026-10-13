/**
 * "Find the person in the picture" for the background cut-out, in the browser: Google's MediaPipe Selfie Segmenter
 * (a 250 KB model) on the MediaPipe WebAssembly runtime. Both are served by StreamBird itself (/models/ and
 * /mediapipe/), the library is only loaded the first time someone turns the cut-out on, and no video leaves the
 * computer. The result is a per-pixel "how sure are we this is the person" mask (0 to 1, high = person).
 */

export interface PersonMask {
  /** 0 to 1 per pixel, row by row; 1 = the person. */
  data: Float32Array;
  width: number;
  height: number;
}

export interface PersonSegmenter {
  /** Segments the current frame of a video. Returns null when there is no picture yet. */
  segmentVideo(video: HTMLVideoElement): PersonMask | null;
  readonly delegate: 'GPU' | 'CPU' | 'test';
  close(): void;
}

/**
 * Test seam: a page can provide its own segmenter before the studio loads (the browser tests do, to get a mask
 * they know the shape of). Nothing in production sets it.
 */
export interface TestSegmenterHook {
  /** Rejects to simulate the model failing to load. */
  init?: () => Promise<void>;
  mask: (video: { width: number; height: number }) => PersonMask;
}
declare global {
  interface Window {
    __SB_TEST_SEGMENTER__?: TestSegmenterHook;
  }
}

/** The picture handed to the model is shrunk to this width (the model works at 256 px anyway), keeping its shape. */
export const SEGMENT_WIDTH = 256;

const MODEL_URL = '/models/selfie_segmenter.tflite';
const RUNTIME_URL = '/mediapipe';

export async function createPersonSegmenter(): Promise<PersonSegmenter> {
  const hook = typeof window !== 'undefined' ? window.__SB_TEST_SEGMENTER__ : undefined;
  if (hook) {
    await hook.init?.();
    return {
      delegate: 'test',
      segmentVideo: (video) => (video.videoWidth ? hook.mask({ width: video.videoWidth, height: video.videoHeight }) : null),
      close: () => {},
    };
  }

  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(RUNTIME_URL);
  const make = (delegate: 'GPU' | 'CPU') =>
    ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  let delegate: 'GPU' | 'CPU' = 'GPU';
  let segmenter;
  try {
    segmenter = await make('GPU');
  } catch {
    delegate = 'CPU'; // no usable GPU path here: slower, but it works
    segmenter = await make('CPU');
  }

  const probe = document.createElement('canvas');
  const pctx = probe.getContext('2d', { willReadFrequently: false })!;

  return {
    delegate,
    segmentVideo(video) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh || video.readyState < 2) return null;
      const w = SEGMENT_WIDTH;
      const h = Math.max(1, Math.round((SEGMENT_WIDTH * vh) / vw));
      if (probe.width !== w || probe.height !== h) {
        probe.width = w;
        probe.height = h;
      }
      pctx.drawImage(video, 0, 0, w, h);
      const result = segmenter.segment(probe);
      try {
        const mask = result.confidenceMasks?.[0];
        if (!mask) return null;
        // Copy: the mask's memory belongs to the model and is freed with the result.
        return { data: new Float32Array(mask.getAsFloat32Array()), width: mask.width, height: mask.height };
      } finally {
        result.close();
      }
    },
    close: () => segmenter.close(),
  };
}
