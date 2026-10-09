import { ChevronLeft, ChevronRight, ImagePlus, Monitor, Presentation, Trash2 } from 'lucide-react';

interface Props {
  slides: { name: string; thumb: string }[];
  slideIndex: number;
  /** The current layout has a slide area (otherwise slides are loaded but not drawn). */
  layoutHasSlide: boolean;
  screenSharing: boolean;
  maxSlides: number;
  onAdd: (files: FileList | null) => void;
  onPrev: () => void;
  onNext: () => void;
  onGoto: (index: number) => void;
  onClear: () => void;
  /** Switches to a layout that has a slide area. */
  onUseSlideLayout: () => void;
}

/**
 * Everything the host needs to run slides, right under the picture: load images, flip with buttons,
 * thumbnails or keys, and plain notes on what shows when. The page used to say this in a small grey
 * line at the very bottom, so most hosts never saw how slides are controlled.
 */
export function SlideControls({ slides, slideIndex, layoutHasSlide, screenSharing, maxSlides, onAdd, onPrev, onNext, onGoto, onClear, onUseSlideLayout }: Props) {
  const has = slides.length > 0;
  return (
    <div className="panel slide-controls">
      <div className="slide-controls-head">
        <span className="slide-controls-title">
          <Presentation size={16} /> Slides
        </span>
        <div className="slide-controls-buttons">
          <button type="button" className="icon-btn icon-btn--small" disabled={slideIndex <= 0} onClick={onPrev} aria-label="Previous slide" title="Previous slide (← or Page Up)">
            <ChevronLeft size={14} /> Previous
          </button>
          <span className="slide-controls-counter" data-testid="slide-counter">
            {has ? `Slide ${slideIndex + 1} / ${slides.length}` : 'No slides'}
          </span>
          <button type="button" className="icon-btn icon-btn--small" disabled={slideIndex >= slides.length - 1} onClick={onNext} aria-label="Next slide" title="Next slide (→ or Page Down)">
            Next <ChevronRight size={14} />
          </button>
        </div>
        <div className="slide-controls-buttons slide-controls-buttons--end">
          <label className="icon-btn icon-btn--small slide-add-btn" htmlFor="slidesInput">
            <ImagePlus size={14} /> Add images
          </label>
          {has && (
            <button type="button" className="icon-btn icon-btn--small icon-btn--danger" onClick={onClear}>
              <Trash2 size={14} /> Clear
            </button>
          )}
        </div>
        <input
          id="slidesInput"
          className="visually-hidden"
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            onAdd(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {has && (
        <div className="slide-thumbs" role="listbox" aria-label="Slides">
          {slides.map((s, i) => (
            <button
              key={`${i}-${s.name}`}
              type="button"
              role="option"
              aria-selected={i === slideIndex}
              className={`slide-thumb${i === slideIndex ? ' slide-thumb--active' : ''}`}
              title={`${i + 1}. ${s.name}`}
              onClick={() => onGoto(i)}
            >
              <img src={s.thumb} alt="" />
              <span>{i + 1}</span>
            </button>
          ))}
        </div>
      )}

      <ul className="slide-help">
        <li>
          <kbd>←</kbd> <kbd>→</kbd> (or <kbd>Page Up</kbd> <kbd>Page Down</kbd>) change slide, also while live. Click a thumbnail to jump. Keys are ignored while you type in a box.
        </li>
        {!has && <li>Add images (up to {maxSlides}; export a deck or PDF as images first). Select several files at once to add them in order.</li>}
        {has && !layoutHasSlide && (
          <li className="slide-help--warn">
            The current layout has no slide area, so these are not on screen yet.{' '}
            <button type="button" className="chip-link chip-link--sm" onClick={onUseSlideLayout}>
              <Monitor size={12} /> Use a slide layout
            </button>
          </li>
        )}
        {!has && !layoutHasSlide && (
          <li>
            Slides show in the layouts under &ldquo;Podcast + slides&rdquo; and the &ldquo;Anchor + slides&rdquo; layouts.{' '}
            <button type="button" className="chip-link chip-link--sm" onClick={onUseSlideLayout}>
              <Monitor size={12} /> Use a slide layout
            </button>
          </li>
        )}
        <li>
          {screenSharing ? 'Your screen share is on the slide area right now; slides come back when you stop sharing.' : 'Sharing your screen replaces the slide while it is on, and the slide returns when you stop.'}
        </li>
      </ul>
    </div>
  );
}
