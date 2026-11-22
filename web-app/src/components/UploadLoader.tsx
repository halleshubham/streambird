import { BirdBusy } from './BirdBusy';
import '../upload-loader.css';

/**
 * The branded "a file is being uploaded" indicator: the flapping StreamBird logo, "Uploading <file name>…" and a
 * progress bar (determinate with `progress` 0-100 when the upload layer reports it, a sliding bar otherwise).
 * Render it only while the upload runs (see `useUpload`); it is announced once, politely, by name only -- the
 * percentage is decorative so a screen reader is not read every tick. The bird is the small kind (no big overlay):
 * this line sits on the card or button being uploaded. Motion stops under prefers-reduced-motion (the bar is then
 * static).
 */
export function UploadLoader({ fileName, progress, className }: { fileName: string; progress?: number | null; className?: string }) {
  const known = typeof progress === 'number';
  return (
    <div className={`upload-loader${className ? ` ${className}` : ''}`} role="status" aria-live="polite" data-testid="upload-loader">
      <BirdBusy overlay={false} />
      <span className="upload-loader-text" title={fileName}>
        Uploading {fileName}…
      </span>
      {known && (
        <span className="upload-loader-pct" aria-hidden="true" data-testid="upload-loader-percent">
          {progress}%
        </span>
      )}
      <span className="upload-loader-bar" aria-hidden="true" data-indeterminate={known ? undefined : 'true'}>
        <span className="upload-loader-fill" style={known ? { width: `${progress}%` } : undefined} />
      </span>
    </div>
  );
}
