#!/usr/bin/env node
/*
 * Regenerates web-app/public/streambird-ad-lower-third.png: the StreamBird ad that every Free stream shows in the
 * lower third (15 s every 180 s, see web-app/src/studio/ads.ts). 1280x240, transparent margin around a violet card,
 * so it sits cleanly over any picture. It is an HTML page rendered by Playwright's Chromium, so the look is
 * reproducible: edit the HTML below, then run
 *
 *   PW_CHROMIUM=/path/to/chromium node scripts/make-free-ad.js      # PW_CHROMIUM only if Playwright's own browser is missing
 *
 * and commit the PNG. Keep it 1280x240 (the lower-third area at 1280x720 is exactly that shape).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const logo = fs.readFileSync(path.join(root, 'web-app/public/logo.png')).toString('base64');
const out = path.join(root, 'web-app/public/streambird-ad-lower-third.png');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1280px; height: 240px; background: transparent; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  .card { position: absolute; left: 16px; top: 16px; right: 16px; bottom: 16px; border-radius: 32px; overflow: hidden;
    background: linear-gradient(100deg, #4c1d95 0%, #7c3aed 55%, #a855f7 100%); display: flex; align-items: center; gap: 36px; padding: 0 44px 0 28px;
    box-shadow: 0 6px 24px rgba(30, 10, 70, 0.45); }
  .card::after { content: ''; position: absolute; right: -80px; top: -120px; width: 380px; height: 380px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); }
  .bird { flex: none; width: 150px; height: 150px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 12px rgba(0, 0, 0, 0.25); }
  .bird img { width: 124px; height: 124px; object-fit: contain; }
  .text { position: relative; z-index: 1; color: #fff; min-width: 0; }
  .line1 { font-size: 54px; font-weight: 800; letter-spacing: -1px; line-height: 1.05; white-space: nowrap; text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); }
  .line1 b { color: #fde68a; font-weight: 800; }
  .line2 { margin-top: 10px; font-size: 28px; font-weight: 600; color: #ede9fe; white-space: nowrap; }
</style></head><body>
  <div class="card">
    <div class="bird"><img src="data:image/png;base64,${logo}" alt=""></div>
    <div class="text">
      <div class="line1">Go live free at <b>streambird.app</b></div>
      <div class="line2">Stream to YouTube, Facebook &amp; Twitch from your browser</div>
    </div>
  </div>
</body></html>`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 240 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: 1280, height: 240 } });
  await browser.close();
  console.log(`wrote ${path.relative(root, out)} (${fs.statSync(out).size} bytes)`);
})();
