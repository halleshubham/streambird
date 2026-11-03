/**
 * The public pages are prerendered into the HTML (see scripts/prerender.mjs). React replaces #root's content when it
 * mounts, and "/" first waits for the session check, so main.tsx keeps a copy of the markup here and HomeRoute shows
 * it during that wait: the visitor sees the page continuously instead of page -> spinner -> page.
 */
let snapshot = '';

export function capturePrerendered(root: HTMLElement, pathname: string): void {
  snapshot = root.dataset.prerendered === pathname ? root.innerHTML : '';
}

export function prerenderedHtml(): string {
  return snapshot;
}
