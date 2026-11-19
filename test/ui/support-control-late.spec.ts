import { expect, test } from '@playwright/test';
import { HostChangeTracker, applySupportCommand, isStaleCommand, type ApplyEnv, type HostControls } from '../../web-app/src/studio/supportControl';
import { DEFAULT_CLOCK } from '../../web-app/src/studio/clock';
import { DEFAULT_LOWER_THIRD } from '../../web-app/src/studio/lowerThird';

// Late commands, a hung brand kit and the host's defence-in-depth checks of relayed commands (pure, no browser page).

function host() {
  const calls: unknown[][] = [];
  const noop = (name: string) => (...a: unknown[]) => void calls.push([name, ...a]);
  const controls: HostControls = {
    adsPlan: () => 'custom',
    adHasMedia: () => true,
    setLayout: noop('setLayout'),
    setAdManual: noop('setAdManual'),
    setAdEnabled: noop('setAdEnabled'),
    setAdSchedule: noop('setAdSchedule'),
    setAdsShrink: noop('setAdsShrink'),
    hasKit: () => true,
    applyKit: async () => void calls.push(['applyKit']),
    tickerText: () => '',
    setTicker: noop('setTicker'),
    canLowerThird: () => true,
    lowerThird: () => ({ ...DEFAULT_LOWER_THIRD }),
    setLowerThird: noop('setLowerThird'),
    showLowerThird: noop('showLowerThird'),
    hideLowerThird: noop('hideLowerThird'),
    clock: () => ({ ...DEFAULT_CLOCK }),
    setClock: noop('setClock'),
    setLogoPosition: noop('setLogoPosition'),
    setLogoSize: noop('setLogoSize'),
    setWallpaperDim: noop('setWallpaperDim'),
  };
  const env: ApplyEnv = { controls, tracker: new HostChangeTracker(), now: () => 1000, tickerStash: { text: '' } };
  return { calls, controls, env };
}

test.describe('late commands, hung kits, defence in depth', () => {
  test('a command older than 8 s is stale by queue age or by the server stamp; skewed clocks are not trusted', () => {
    expect(isStaleCommand(1000, 0, 100, 1500)).toBe(false);
    expect(isStaleCommand(1000, 0, 9000, 1500)).toBe(true); // waited 9 s behind another command
    expect(isStaleCommand(1000, 0, 100, 1000 + 9000)).toBe(true); // stamped 9 s ago
    expect(isStaleCommand(1000, 0, 100, 1000 + 60 * 60_000)).toBe(false); // clocks an hour apart: ignore `at`
    expect(isStaleCommand(undefined, 0, 100, 5)).toBe(false);
  });

  test('a kit that never finishes loading fails the command instead of stalling the queue', async () => {
    const h = host();
    h.controls.applyKit = () => new Promise<void>(() => undefined);
    h.env.kitTimeoutMs = 50;
    expect(await applySupportCommand({ type: 'kit.apply', payload: { kitId: 'kit-1' } }, h.env)).toEqual({ ok: false, error: 'The brand kit took too long to load' });
  });

  test('the host re-checks enums and ranges of relayed commands', async () => {
    const h = host();
    const run = (type: any, payload: any) => applySupportCommand({ type, payload }, h.env);
    expect((await run('clock.set', { format: '36h' })).ok).toBe(false);
    expect((await run('clock.set', { position: 'middle' })).ok).toBe(false);
    expect((await run('logo.set', { size: 5000 })).ok).toBe(false);
    expect((await run('wallpaper.dim', { n: 99 })).ok).toBe(false);
    expect((await run('ticker.set', { text: 'x'.repeat(201) })).ok).toBe(false);
    expect((await run('lowerThird.set', { name: 'n'.repeat(81) })).ok).toBe(false);
    expect(h.calls).toEqual([]);
  });
});
