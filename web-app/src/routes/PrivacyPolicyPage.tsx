import { Link } from 'react-router-dom';

const CONTACT_EMAIL = 'support@shackyapps.in';

/**
 * Public, unauthenticated route (see App.tsx) -- required to be reachable
 * without logging in both by Google Cloud's OAuth consent screen
 * verification (Privacy Policy URL field) and by Facebook's app review
 * (Data Deletion / Privacy Policy URL field). Content lives here as a
 * normal page rather than a static file so it renders through the same
 * SPA shell/theme as everything else.
 */
export function PrivacyPolicyPage() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <h1>StreamBird Privacy Policy</h1>
        <p className="legal-updated">Last updated: October 1, 2026</p>

        <p>
          StreamBird ("StreamBird", "we", "us") is a multi-platform live-streaming
          service operated by ShackyApps. This policy explains what information we
          collect, how we use it, and how to reach us with questions or requests.
        </p>

        <h2>1. Information we collect</h2>
        <ul>
          <li>
            <strong>Account information:</strong> your email address, and a display
            name if you provide one. We use email-based magic-code sign-in and,
            optionally, "Sign in with Google" -- in both cases, your email address
            is the identity on your account.
          </li>
          <li>
            <strong>Connected platform credentials:</strong> when you connect a
            destination (e.g. YouTube, Twitch), we store the OAuth access/refresh
            tokens or stream key needed to publish your broadcast there. These are
            encrypted at rest (AES-256-GCM) and are only ever decrypted server-side,
            in memory, to make the specific API calls your account's actions
            require.
          </li>
          <li>
            <strong>Stream metadata:</strong> titles, descriptions, scheduled times,
            and delivery status for streams you create.
          </li>
          <li>
            <strong>Camera and microphone media:</strong> when you or your invited
            guests use the live studio, audio/video is relayed in real time to
            composite and broadcast your stream. We do not record or retain this
            media ourselves once a stream ends, beyond whatever recording, if any,
            the destination platform you're broadcasting to keeps on its own side.
          </li>
          <li>
            <strong>Basic technical logs</strong> (IP address, timestamps, error
            traces) for operating and securing the service.
          </li>
        </ul>

        <h2>2. How we use this information</h2>
        <p>
          We use the information above strictly to operate StreamBird: authenticate
          you, publish your broadcast to the destinations you've chosen, show you
          your own stream history and status, and keep the service secure and
          reliable. We do not sell your information, and we do not use it for
          advertising.
        </p>

        <h2>3. Google user data ("Limited Use")</h2>
        <p>
          If you connect a Google Account to StreamBird (for sign-in, or to publish
          to YouTube), StreamBird's use and transfer of information received from
          Google APIs adheres to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. We request only the scopes
          needed for the feature you're using (basic profile/email for sign-in; the
          YouTube scope only if you explicitly connect a YouTube destination), we
          never use this data for advertising, and we never allow humans to read
          this data except as needed for security, legal compliance, or with your
          explicit consent to investigate a support request you raised.
        </p>

        <h2>4. Sharing</h2>
        <p>
          We share stream media and metadata with the destination platforms you
          explicitly choose to publish to (e.g. YouTube, Twitch) -- that is the
          entire function of the service. We do not otherwise share your
          information with third parties, except where required by law.
        </p>

        <h2>5. Data retention and deletion</h2>
        <p>
          We retain your account and stream history for as long as your account is
          active. You may request deletion of your account and associated data at
          any time by emailing{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>; we will delete
          your account record, connected-platform credentials, and stream history
          within 30 days, except where we're required to retain limited records for
          legal or security purposes.
        </p>

        <h2>6. Security</h2>
        <p>
          Connected-platform credentials are encrypted at rest. Access to
          production systems is restricted to the operators of StreamBird. No
          method of transmission or storage is 100% secure, but we take reasonable
          measures to protect your information.
        </p>

        <h2>7. Children's privacy</h2>
        <p>StreamBird is not directed at children under 13, and we do not knowingly collect information from them.</p>

        <h2>8. Changes to this policy</h2>
        <p>
          We may update this policy from time to time. Material changes will be
          reflected by updating the "Last updated" date above.
        </p>

        <h2>9. Contact</h2>
        <p>
          Questions, requests, or concerns about this policy can be sent to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <p className="legal-back">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
