import { Link } from 'react-router-dom';
import { BrandLink } from '../components/PublicLayout';
import { buttonClass } from '../components/ui';

export function NotFoundPage() {
  return (
    <div className="pub-page">
      <header className="pub-header">
        <BrandLink />
      </header>
      <main className="pub-notfound">
        <div className="pub-notfound-icon" aria-hidden="true">
          <img src="/logo.png" alt="" />
        </div>
        <p className="pub-eyebrow">Error 404</p>
        <h1>This page flew away</h1>
        <p className="pub-lead">We could not find what you were looking for. The link may be old or mistyped.</p>
        <div className="pub-notfound-actions">
          <Link to="/" className={buttonClass('primary', 'lg')}>
            Back to home
          </Link>
          <Link to="/login" className={buttonClass('ghost', 'lg')}>
            Log in
          </Link>
        </div>
      </main>
    </div>
  );
}
