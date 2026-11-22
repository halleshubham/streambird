import { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { ApiError } from '../api/client';
import { streamThumbnailUrl, uploadStreamThumbnail } from '../api/streams';
import { Button, Card } from './ui';
import { thumbnailProblem } from './ThumbnailPicker';
import { KitThumbnailNote } from './KitThumbnailNote';
import { UploadLoader } from './UploadLoader';
import { useUpload } from '../lib/useUpload';

/** Add/replace the thumbnail of a live (or otherwise not-yet-ended, non-scheduled) stream. */
export function LiveThumbnailPanel({ streamId, connectionIds = [] }: { streamId: string; connectionIds?: readonly string[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [hasImage, setHasImage] = useState(true); // optimistic; the <img> onError flips it
  const { upload, uploading: busy, run: runUpload } = useUpload();
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  async function pick(file: File) {
    const problem = thumbnailProblem(file);
    if (problem) return setMessage({ text: problem, isError: true });
    setMessage(null);
    try {
      const result = await runUpload(file, (onProgress) => uploadStreamThumbnail(streamId, file, onProgress));
      setVersion(Date.now());
      setHasImage(true);
      const warnings = result.platformWarnings ?? [];
      setMessage(warnings.length ? { text: warnings.join(' '), isError: true } : { text: 'Thumbnail saved and sent to the platforms.', isError: false });
    } catch (err) {
      setMessage({ text: err instanceof ApiError ? err.message : 'Upload failed.', isError: true });
    }
  }

  return (
    <Card as="section" className="live-thumbnail-panel" aria-labelledby="thumb-title">
      <h2 id="thumb-title">Thumbnail</h2>
      <div className="thumbnail-picker ha-stack" style={{ gap: 16, marginTop: 12 }}>
        {hasImage ? (
          <img className="thumbnail-img ha-thumb" src={streamThumbnailUrl(streamId, version ?? 0)} alt="Stream thumbnail" onError={() => setHasImage(false)} />
        ) : (
          <div className="ha-thumb" role="img" aria-label="No thumbnail yet">
            No thumbnail yet
          </div>
        )}
        {!hasImage && <KitThumbnailNote connectionIds={connectionIds} tense="is" />}
        <div className="ha-actions">
          <Button variant="secondary" busy={busy} aria-label={hasImage ? 'Replace thumbnail' : 'Upload thumbnail'} icon={<ImagePlus size={16} aria-hidden="true" />} onClick={() => input.current?.click()}>
            {busy ? 'Uploading…' : hasImage ? 'Replace thumbnail' : 'Upload thumbnail'}
          </Button>
        </div>
        {upload && <UploadLoader fileName={upload.fileName} progress={upload.progress} />}
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
        {message && (
          <p className={message.isError ? 'ha-error' : 'ha-hint'} role={message.isError ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}
        <p className="ha-hint">
          JPG or PNG, up to 2 MB, 1280×720 (16:9) recommended. Sent to YouTube (needs a verified channel) and, best effort, to Facebook. Twitch doesn't take a thumbnail from here.
        </p>
      </div>
    </Card>
  );
}
