import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { assetFileUrl, listBrandKits } from '../api/assets';
import { describeKitThumbnail, distinctKits, kitThumbnailSources } from '../lib/kitThumbnail';
import type { BrandKit } from '../types/api';

interface Props {
  /** The platform connections the stream goes to. */
  connectionIds: readonly string[];
  /** undefined = the destination's kit, else the account default; null = no kit; a kit id = that kit. */
  choice?: string | null;
  /** The host picked a thumbnail for this stream: it replaces the kit's. */
  replaced?: boolean;
  /** Where the sentence ends: before the stream is created ("will use") or once it exists ("is used"). */
  tense?: 'will' | 'is';
}

/**
 * Says which brand kit thumbnail a stream gets when it has no thumbnail of its own ("From brand kit Acme"), with a small
 * preview. Renders nothing when no destination has a kit thumbnail (or the plan has no kits). The page keeps its own
 * picker next to it: choosing an image there is the override, and this note then says it replaces the kit's.
 */
export function KitThumbnailNote({ connectionIds, choice, replaced = false, tense = 'will' }: Props) {
  const [kits, setKits] = useState<BrandKit[] | null>(null);
  useEffect(() => {
    let live = true;
    listBrandKits()
      .then((k) => live && setKits(k))
      .catch(() => live && setKits([]));
    return () => {
      live = false;
    };
  }, []);
  if (!kits) return null;
  const sources = kitThumbnailSources(connectionIds, kits, choice);
  const text = describeKitThumbnail(sources);
  if (!text) return null;
  const first = distinctKits(sources)[0];
  return (
    <div className="kit-thumb-note" data-testid="kit-thumbnail-note" data-replaced={replaced ? 'true' : 'false'}>
      {first.thumbnailAssetId && <img className="kit-thumb-note-img" data-testid="kit-thumbnail-img" src={assetFileUrl(first.thumbnailAssetId)} alt={`Thumbnail of brand kit ${first.name}`} />}
      <p className="ha-hint" style={{ margin: 0 }}>
        <strong>{text}</strong>
        {replaced
          ? '. The image you chose replaces it for this stream.'
          : tense === 'will'
            ? '. It is used because you did not choose a thumbnail for this stream; choose an image here to use another one.'
            : '. It was used because this stream has no thumbnail of its own; upload one to replace it.'}{' '}
        <Link to="/brand">Brand kits</Link>
      </p>
    </div>
  );
}
