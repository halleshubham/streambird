import { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { ApiError } from '../api/client';
import { streamThumbnailUrl, uploadStreamThumbnail } from '../api/streams';
import { BirdBusy } from './BirdBusy';
import { thumbnailProblem } from './ThumbnailPicker';

/** Add/replace the thumbnail of a live (or otherwise not-yet-ended, non-scheduled) stream. */
export function LiveThumbnailPanel({ streamId }: { streamId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [hasImage, setHasImage] = useState(true); // optimistic; the <img> onError flips it
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  async function pick(file: File) {
    const problem = thumbnailProblem(file);
    if (problem) return setMessage({ text: problem, isError: true });
    setBusy(true);
    setMessage(null);
    try {
      const result = await uploadStreamThumbnail(streamId, file);
      setVersion(Date.now());
      setHasImage(true);
      const warnings = result.platformWarnings ?? [];
      setMessage(warnings.length ? { text: warnings.join(' '), isError: true } : { text: 'Thumbnail saved and sent to the platforms.', isError: false });
    } catch (err) {
      setMessage({ text: err instanceof ApiError ? err.message : 'Upload failed.', isError: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel live-thumbnail-panel">
      <div className="section-header">
        <h2>Thumbnail</h2>
      </div>
      <div className="thumbnail-picker">
        {hasImage ? (
          <img className="thumbnail-img" src={streamThumbnailUrl(streamId, version ?? 0)} alt="Stream thumbnail" onError={() => setHasImage(false)} />
        ) : (
          <p className="empty-state">No thumbnail yet.</p>
        )}
        <div className="scheduled-actions">
          <button type="button" className="icon-btn" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <BirdBusy /> : <ImagePlus size={16} />} {hasImage ? 'Replace thumbnail' : 'Upload thumbnail'}
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void pick(file);
          }}
        />
        {message && <p className={message.isError ? 'field-hint error' : 'field-hint'}>{message.text}</p>}
        <p className="field-hint">
          JPG or PNG, up to 2 MB, 1280×720 (16:9) recommended. Sent to YouTube (needs a verified channel) and, best effort, to Facebook. Twitch doesn't take a thumbnail from here.
        </p>
      </div>
    </section>
  );
}
