import { Link } from 'react-router-dom';
import { LegalLayout } from '../components/LegalLayout';

const CONTACT_EMAIL = 'support@shackyapps.in';

/**
 * Public, unauthenticated page: how to delete a StreamBird account and data, and what is deleted or kept. Google Play
 * requires a public web URL for this (plus an in-app path); /privacy links here and the Privacy Policy repeats the summary.
 * Keep it consistent with AccountDeletionService (src/account-deletion) and the Privacy Policy section 5.
 */
export function DeleteAccountInfoPage() {
  return (
    <LegalLayout title="Delete your StreamBird account and data" updated="Last updated: November 3, 2026">
      <p>
        You can delete your StreamBird account, and the data linked to it, at any time. This page explains how to do it, what is deleted, what we keep
        and for how long. StreamBird is operated by ShackyApps.
      </p>

      <h2 id="how">How to delete your account</h2>
      <ol>
        <li>
          <Link to="/login">Log in</Link> to StreamBird (in the browser, or in the StreamBird app).
        </li>
        <li>Open <strong>Account</strong>: click your email address at the top of the page, or on a phone choose <strong>More</strong>, then <strong>Account</strong>.</li>
        <li>
          Choose <strong>Delete account</strong>. You see what will be deleted, then press <strong>Send confirmation code</strong>.
        </li>
        <li>We email a 6-digit code to your address. Enter it and confirm. Your account is deleted straight away and you are signed out.</li>
      </ol>
      <p>We send the code so that nobody else can delete your account if they find your device unlocked. The code expires after 10 minutes.</p>

      <h2 id="cannot-log-in">Cannot log in?</h2>
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the address your account uses and ask us to delete it. We confirm that you control
        that address, delete the account, and reply within 30 days. Please do not include passwords or other secrets in the email.
      </p>

      <h2 id="what-is-deleted">What is deleted</h2>
      <p>It depends on your role on the account:</p>
      <ul>
        <li>
          <strong>A team member</strong> (or one of several company admins) deletes only their own sign-in: email address, mobile number and sessions.
          Streams, connections and files they created stay with the company account.
        </li>
        <li>
          <strong>The account owner</strong> (a personal account, or the only admin of a company) deletes the whole account:
          <ul>
            <li>your autopay is cancelled first (if we cannot cancel it, nothing is deleted and you can try again);</li>
            <li>a stream that is live is ended, and scheduled streams are cancelled (invited guests are told);</li>
            <li>every connected YouTube, Facebook and Twitch destination is disconnected and its stored access token or stream key deleted; for YouTube we also ask Google to revoke StreamBird&apos;s access;</li>
            <li>your brand kits and uploaded files (logos, wallpapers, pictures), presets, scheduled streams, guest invites and stream history;</li>
            <li>the sign-in, email address and mobile number of every person on the company, who are told by email.</li>
          </ul>
          If other people are on the account, you are asked to confirm explicitly that the whole company account is deleted for all of them.
        </li>
      </ul>

      <h2 id="what-we-keep">What we keep, and for how long</h2>
      <ul>
        <li>
          <strong>Payment records.</strong> Accounting and tax law requires us to keep records of payments. We keep the amount, date and payment
          reference, <em>without</em> your name or email, attached to an anonymous account record that contains no personal data.
        </li>
        <li>
          <strong>Backups.</strong> Deleted data can remain in routine backups of our database until they are overwritten, which is within 30 days. Backups
          are not used for anything else and are not restored for an account that was deleted.
        </li>
        <li>
          <strong>Content on other platforms.</strong> Videos and broadcasts that were already published on YouTube, Facebook or Twitch belong to those
          platforms and stay there. Delete them in the platform itself. You can also remove StreamBird&apos;s access in your{' '}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
            Google account permissions
          </a>{' '}
          or under &ldquo;Business Integrations&rdquo; in your Facebook settings.
        </li>
      </ul>

      <h2 id="after">After you delete</h2>
      <p>
        We email a short confirmation to your address. It says only that the account was deleted. You can sign up again with the same address later; it
        starts as a brand-new, empty account.
      </p>
      <p>
        More on how we handle personal data is in the <Link to="/privacy#delete-account">Privacy Policy</Link>.
      </p>
    </LegalLayout>
  );
}
