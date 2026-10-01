import { Link } from 'react-router-dom';

const CONTACT_EMAIL = 'support@shackyapps.in';

/** Public, unauthenticated route -- see PrivacyPolicyPage for why. */
export function TermsOfServicePage() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <h1>StreamBird Terms of Service</h1>
        <p className="legal-updated">Last updated: October 1, 2026</p>

        <p>
          These Terms govern your use of StreamBird, a multi-platform
          live-streaming service operated by ShackyApps ("we", "us"). By creating
          an account or using StreamBird, you agree to these Terms.
        </p>

        <h2>1. The service</h2>
        <p>
          StreamBird lets you produce a live broadcast (optionally with remote
          guests) and simultaneously publish it to the destination platforms you
          connect, such as YouTube and Twitch. You are responsible for the content
          you stream and for connecting only accounts you own or are authorized to
          use.
        </p>

        <h2>2. Your account</h2>
        <p>
          You're responsible for keeping access to your account secure and for all
          activity under it. You must provide a working email address, since it's
          how you sign in and how we reach you about your account.
        </p>

        <h2>3. Acceptable use</h2>
        <p>You agree not to use StreamBird to:</p>
        <ul>
          <li>Stream content that is illegal, infringing, or that you don't have the rights to broadcast;</li>
          <li>Violate the terms of service of any destination platform you publish to (e.g. YouTube's or Twitch's own terms and community guidelines);</li>
          <li>Attempt to disrupt, overload, or gain unauthorized access to StreamBird's systems; or</li>
          <li>Use the service to harass, defraud, or impersonate others.</li>
        </ul>
        <p>
          We may suspend or terminate accounts that violate these terms, with or
          without notice, depending on severity.
        </p>

        <h2>4. Third-party platforms</h2>
        <p>
          When you connect a destination platform (e.g. YouTube, Twitch), that
          platform's own terms of service and policies also apply to your use of
          it. StreamBird is not responsible for actions taken by a third-party
          platform against your account there (e.g. a strike, suspension, or
          content takedown on YouTube itself).
        </p>

        <h2>5. Availability</h2>
        <p>
          StreamBird is provided "as is." We aim for reliable service but do not
          guarantee uninterrupted availability, and we are not liable for stream
          interruptions, missed broadcasts, or data loss caused by factors outside
          our reasonable control, including outages of third-party platforms or
          relay infrastructure.
        </p>

        <h2>6. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, StreamBird and ShackyApps are not
          liable for any indirect, incidental, or consequential damages arising
          from your use of the service.
        </p>

        <h2>7. Termination</h2>
        <p>
          You may stop using StreamBird and request account deletion at any time
          (see our{' '}
          <Link to="/privacy">Privacy Policy</Link>
          ). We may suspend or terminate your account for violating these Terms.
        </p>

        <h2>8. Changes to these Terms</h2>
        <p>
          We may update these Terms from time to time. Material changes will be
          reflected by updating the "Last updated" date above. Continuing to use
          StreamBird after a change means you accept the updated Terms.
        </p>

        <h2>9. Contact</h2>
        <p>
          Questions about these Terms can be sent to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <p className="legal-back">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
