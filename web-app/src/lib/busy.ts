import { useSyncExternalStore } from 'react';

/**
 * How many busy indicators (flapping birds on buttons and status lines) are on screen right now.
 * BusyOverlay watches it so any action in progress also shows a big bird in the middle of the
 * screen, instead of leaving an idle-looking page where the only sign of work is a 16px icon.
 */
let count = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function busyStart(): void {
  count += 1;
  emit();
}

export function busyEnd(): void {
  count = Math.max(0, count - 1);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBusyCount(): number {
  return useSyncExternalStore(subscribe, () => count, () => 0);
}
