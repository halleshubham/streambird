import { Link } from 'react-router-dom';
import { AuthHeading, AuthLayout } from '../components/PublicLayout';
import { buttonClass } from '../components/ui';

/** Where a person lands after deleting their account (public: they no longer have a session). */
export function AccountDeletedPage() {
  return (
    <AuthLayout>
      <div className="pub-auth-col">
      <AuthHeading
        eyebrow="Account deleted"
        title="Your account was deleted"
        lead={<p>Your StreamBird account and the data linked to it are gone, and you are signed out. We sent a short confirmation to your email.</p>}
      />
      <div className="pub-auth-card">
        <p>
          Payment records we must keep by law stay without your name or email. Anything already published on YouTube, Facebook or Twitch stays on those
          platforms. <Link to="/delete-account">What is deleted and kept</Link>.
        </p>
        <Link to="/" className={buttonClass('primary', 'md', 'ui-btn--block')}>
          Back to home
        </Link>
      </div>
      </div>
    </AuthLayout>
  );
}
