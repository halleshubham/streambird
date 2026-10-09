import { useEffect } from 'react';
import { busyStart, busyEnd } from '../lib/busy';

/**
 * The StreamBird logo, flapping, sized to sit inside a button or beside a
 * status line -- the in-line sibling of BirdLoader, which fills a page/panel.
 * Decorative (aria-hidden): the control keeps its normal label while busy
 * (and is disabled), so nothing jumps and a screen reader still hears what
 * the button does. While one is mounted the app also shows a large bird in
 * the middle of the screen (see BusyOverlay), so the user can't miss that
 * something is happening.
 */
export function BirdBusy({ overlay = true }: { overlay?: boolean }) {
  // overlay={false} is for a status that can last indefinitely and is not an action the user waits on
  // (a guest alone in a room: "waiting for others to connect…"), which must not cover the page.
  useEffect(() => {
    if (!overlay) return;
    busyStart();
    return busyEnd;
  }, [overlay]);
  return <img src="/logo.png" alt="" aria-hidden="true" className="bird-busy" />;
}

/** A status message that ends in an ellipsis is a "still working" message ("Starting publish…"). */
export function isInProgress(text: string | null | undefined): boolean {
  return !!text && text.trim().endsWith('…');
}
