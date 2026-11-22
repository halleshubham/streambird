import { useCallback, useRef, useState } from 'react';

export interface UploadState {
  fileName: string;
  /** 0-100 when the upload layer reports it, else null (indeterminate). */
  progress: number | null;
}

/**
 * Tracks one in-flight upload for `<UploadLoader/>`. `run(file, task)` shows the loader, calls
 * `task(onProgress)` and ALWAYS clears it afterwards (success or failure -- the caller's own try/catch
 * keeps the error text), so the UI cannot be left stuck. `uploading` is true meanwhile (disable the controls).
 */
export function useUpload() {
  const [upload, setUpload] = useState<UploadState | null>(null);
  const live = useRef(0);

  const run = useCallback(async function run<T>(file: { name: string }, task: (onProgress: (percent: number) => void) => Promise<T>): Promise<T> {
    const id = ++live.current;
    setUpload({ fileName: file.name, progress: null });
    try {
      return await task((percent) => {
        if (live.current === id) setUpload({ fileName: file.name, progress: percent });
      });
    } finally {
      if (live.current === id) setUpload(null);
    }
  }, []);

  return { upload, uploading: upload !== null, run };
}
