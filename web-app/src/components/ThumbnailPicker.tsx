import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { THUMBNAIL_MAX_BYTES, THUMBNAIL_TYPES } from '../api/streams';

/** Why a chosen file can't be used, or null if it's fine -- mirrors the server's checks so the host finds out before submitting. */
export function thumbnailProblem(file: File): string | null {
  if (!THUMBNAIL_TYPES.includes(file.type)) return 'Choose a JPG or PNG image.';
  if (file.size > THUMBNAIL_MAX_BYTES) return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB -- the limit is 2 MB.`;
  return null;
}

/**
 * File picker with a preview for the stream thumbnail. Controlled by the
 * parent (it uploads the file after the stream exists); validation is
 * client-side for fast feedback, the server re-checks the actual bytes.
 */
export function ThumbnailPicker({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="thumbnail-picker">
      {preview ? (
        <div className="thumbnail-preview">
          <img src={preview} alt="Thumbnail preview" />
          <button type="button" className="icon-btn icon-btn--small" onClick={() => { onChange(null); setProblem(null); if (input.current) input.current.value = ''; }}>
            <X size={14} /> Remove
          </button>
        </div>
      ) : (
        <button type="button" className="icon-btn" onClick={() => input.current?.click()}>
          <ImagePlus size={16} /> Choose an image
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          const issue = picked ? thumbnailProblem(picked) : null;
          setProblem(issue);
          onChange(picked && !issue ? picked : null);
          if (issue && input.current) input.current.value = '';
        }}
      />
      {problem && <p className="field-hint error">{problem}</p>}
    </div>
  );
}
