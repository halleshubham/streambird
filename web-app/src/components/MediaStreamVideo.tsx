import { useEffect, useRef } from 'react';

/** Attaches a live MediaStream to a <video> -- srcObject has no JSX prop equivalent. */
export function MediaStreamVideo({ stream, ...props }: { stream: MediaStream } & React.VideoHTMLAttributes<HTMLVideoElement>) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, [stream]);

  return <video ref={ref} autoPlay playsInline {...props} />;
}
