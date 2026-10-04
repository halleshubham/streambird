/**
 * The StreamBird logo, flapping, sized to sit inside a button or beside a
 * status line -- the in-line sibling of BirdLoader, which fills a page/panel.
 * Decorative (aria-hidden): the control keeps its normal label while busy
 * (and is disabled), so nothing jumps and a screen reader still hears what
 * the button does.
 */
export function BirdBusy() {
  return <img src="/logo.png" alt="" aria-hidden="true" className="bird-busy" />;
}

/** A status message that ends in an ellipsis is a "still working" message ("Starting publish…"). */
export function isInProgress(text: string | null | undefined): boolean {
  return !!text && text.trim().endsWith('…');
}
