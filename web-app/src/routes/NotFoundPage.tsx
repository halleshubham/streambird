import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Not found</h1>
        <p>That page doesn't exist.</p>
        <Link to="/dashboard">Back to dashboard</Link>
      </div>
    </div>
  );
}
