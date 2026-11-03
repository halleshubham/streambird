import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BrandLink } from './PublicLayout';

interface TocItem {
  id: string;
  text: string;
}

/**
 * Shared frame of the Privacy Policy and Terms of Service pages: header with the logo, a Privacy/Terms switch
 * (two real routes), a contents list built from the document's own headings, and the text in a reading card.
 * The legal text itself stays in each page component.
 */
export function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const { status } = useAuth();
  const { pathname, hash } = useLocation();
  const article = useRef<HTMLElement>(null);
  const [toc, setToc] = useState<TocItem[]>([]);

  useEffect(() => {
    const heads = Array.from(article.current?.querySelectorAll<HTMLElement>('h2') ?? []);
    setToc(
      heads.map((h, i) => {
        if (!h.id) h.id = `section-${i + 1}`;
        return { id: h.id, text: h.textContent ?? '' };
      }),
    );
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [pathname, hash]);

  return (
    <div className="pub-page pub-legal-page">
      <header className="pub-header">
        <BrandLink />
        <Link to="/" className="pub-header-link">
          Back to home
        </Link>
      </header>
      <main className="pub-legal-main">
        <aside className="pub-legal-side">
          <nav className="pub-switch" aria-label="Legal documents">
            <NavLink to="/privacy">Privacy</NavLink>
            <NavLink to="/terms">Terms</NavLink>
          </nav>
          {toc.length > 0 && (
            <nav className="pub-toc" aria-label="On this page">
              {toc.map((t) => (
                <a key={t.id} href={`#${t.id}`}>
                  {t.text}
                </a>
              ))}
            </nav>
          )}
        </aside>
        <article ref={article} className="pub-legal-card legal-page-inner">
          <p className="pub-eyebrow">Legal</p>
          <h1>{title}</h1>
          <p className="legal-updated">{updated}</p>
          {children}
          <p className="legal-back">
            {status === 'authenticated' ? <Link to="/dashboard">Back to dashboard</Link> : <Link to="/login">Back to sign in</Link>}
          </p>
        </article>
      </main>
    </div>
  );
}
