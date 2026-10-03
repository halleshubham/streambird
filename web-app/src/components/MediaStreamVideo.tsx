import { useEffect, useRef } from 'react';

/**
 * Attaches a live MediaStream to a <video> -- srcObject has no JSX prop
 * equivalent. When `unmute` is set, starts muted and flips .muted off
 * right after play() resolves: the standard workaround for
 * unmuted-autoplay blocking (browsers always allow muted autoplay, and
 * unlike *starting* unmuted playback, flipping .muted off on
 * already-rolling media generally isn't re-blocked). Falls back to a
 * tap-to-enable prompt if even that's blocked.
 */
export function MediaStreamVideo({
  stream,
  unmute,
  ...props
}: { stream: MediaStream; unmute?: boolean } & React.VideoHTMLAttributes<HTMLVideoElement>) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || el.srcObject === stream) return;
    el.srcObject = stream;

    if (!unmute) {
      el.play().catch(() => {});
      return;
    }

    el.muted = true;
    el
      .play()
      .then(() => {
        el.muted = false;
      })
      .catch(() => {
        const resume = () => {
          el.muted = false;
          el.play().catch(() => {});
          document.removeEventListener('click', resume);
        };
        document.addEventListener('click', resume, { once: true });
      });
  }, [stream, unmute]);

  return <video ref={ref} autoPlay playsInline {...props} />;
}
