import { defineConfig } from '@playwright/test';

const APP = `http://127.0.0.1:${process.env.UI_APP_PORT ?? 4310}`;
const CONTROL = `http://127.0.0.1:${process.env.UI_CONTROL_PORT ?? 4311}`;

/**
 * Browser smoke tests against the real app + built SPA. Prereqs: `npm run build`-less
 * (ts-node runs the server) but the web app must be built (`cd web-app && npm run build`
 * writes dist-web/) and E2E_DATABASE_URL must point at a Postgres.
 * PW_CHROMIUM overrides the browser binary (handy in sandboxes without Playwright's own download).
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: APP,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['camera', 'microphone'],
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM || undefined,
      args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'npx ts-node test/ui/fixture-server.ts',
    cwd: '../..',
    url: `${CONTROL}/ready`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
