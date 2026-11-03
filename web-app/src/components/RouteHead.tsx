import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { headTags, seoForPath } from '../seo/routes';

/**
 * Keeps <title>, the description, canonical, robots and the social-card tags in step with the current route
 * (the first load already has them: prerendered pages ship them in the HTML). Anything not listed in
 * seo/routes.ts is noindex. Mounted once in App.
 */
export function RouteHead() {
  const { pathname } = useLocation();
  useEffect(() => {
    const seo = seoForPath(pathname);
    document.title = seo.title;
    for (const t of headTags(seo, window.location.origin, pathname)) {
      const sel = t.tag === 'link' ? `link[rel="${t.attrs.rel}"]` : t.attrs.name ? `meta[name="${t.attrs.name}"]` : `meta[property="${t.attrs.property}"]`;
      let el = document.head.querySelector<HTMLElement>(sel);
      if (!el) {
        el = document.createElement(t.tag);
        document.head.appendChild(el);
      }
      for (const [k, v] of Object.entries(t.attrs)) el.setAttribute(k, v);
    }
    // A noindex page must not keep the previous page's canonical.
    if (!seo.index) document.head.querySelector('link[rel="canonical"]')?.remove();
  }, [pathname]);
  return null;
}
