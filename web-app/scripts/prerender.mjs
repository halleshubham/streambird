// Build step after `vite build`: renders the public pages (src/seo/prerender-entry.tsx) to static HTML in
// dist-web/_prerender/<name>.html using the built index.html as the template. The Nest app serves those files at
// /, /privacy, /terms and /delete-account (src/seo/seo.ts). No browser is needed: Vite's SSR module loader runs the
// same React components in Node.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, '../dist-web');
const template = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
if (!template.includes('<!--seo:head-->') || !template.includes('<!--/seo:head-->') || !template.includes('<div id="root"></div>')) {
  throw new Error('index.html is missing the <!--seo:head--> marker or <div id="root"></div>');
}

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error' });
let pages;
try {
  const mod = await vite.ssrLoadModule('/src/seo/prerender-entry.tsx');
  pages = mod.prerenderAll();
} finally {
  await vite.close();
}

const dir = path.join(out, '_prerender');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
for (const p of pages) {
  const html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(p.seo.title)}</title>`)
    .replace(/<!--seo:head-->[\s\S]*<!--\/seo:head-->/, () => p.head)
    // data-prerendered lets the app keep this markup on screen while it checks the session (see main.tsx / HomeRoute).
    .replace('<div id="root"></div>', () => `<div id="root" data-prerendered="${p.path}">${p.body}</div>`);
  fs.writeFileSync(path.join(dir, `${p.name}.html`), html);
  console.log(`prerendered ${p.path} -> _prerender/${p.name}.html (${(html.length / 1024).toFixed(1)} kB)`);
}
