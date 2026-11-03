import { monthlyHoursLabel } from '../lib/planCopy';
import { useEffect, useState } from 'react';
import { CookieSettingsLink } from '../components/CookieSettingsLink';
import { Link } from 'react-router-dom';
import {
  Radio,
  Users,
  Mic,
  LayoutGrid,
  MonitorUp,
  Clapperboard,
  Link2,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import * as authApi from '../api/auth';
import { docsUrl } from '../docs';
import { getPublicPlans } from '../api/plans';
import { getBillingConfig } from '../api/billing';
import type { PublicPlan } from '../types/api';
import { FacebookLogo, GoogleLogo } from '../components/AuthLogos';
import { PlatformBadge } from '../components/PlatformBadge';
import { BrandLink } from '../components/PublicLayout';
import { Badge, buttonClass } from '../components/ui';
import { HeroShowcase } from '../components/HeroShowcase';

const FEATURES = [
  {
    icon: Radio,
    title: 'Multi-platform simulcast',
    body: 'Broadcast live to YouTube, Facebook, and Twitch at once -- more platforms landing as their own adapters ship -- all from one studio and one "Go live" button.',
  },
  {
    icon: Users,
    title: 'Browser-based guest studio',
    body: 'Invite guests with a single link. They join camera-ready from any browser over WebRTC -- no app to install, no plugin to approve.',
  },
  {
    icon: Mic,
    title: 'Mix-minus audio, by design',
    body: "Every guest hears everyone else on the call, never their own voice. It's not a setting to get right -- the audio graph is built so echo structurally can't happen.",
  },
  {
    icon: LayoutGrid,
    title: 'Live compositing & branding',
    body: 'Grid or spotlight layouts, switchable mid-stream, with your own logo and a scrolling news ticker composited directly into the broadcast.',
  },
  {
    icon: MonitorUp,
    title: 'Screen share & Scenes',
    body: 'Share your screen as another tile in the mix, and save named layout presets to recall instantly when the show changes shape.',
  },
  {
    icon: Link2,
    title: 'Schedule ahead, vertical or landscape',
    body: "Plan a stream ahead of time and pick 9:16 or 16:9 when you create it. Once live, see each destination's real platform-reported status, with a watch link you can copy.",
  },
];

const STEPS = [
  {
    title: 'Connect a channel',
    body: 'Link your YouTube, Facebook, or Twitch account in a couple of clicks.',
  },
  {
    title: 'Invite your guests',
    body: 'Share one link. They join from any browser, no account required.',
  },
  {
    title: 'Go live everywhere',
    body: 'Hit Go Live once -- StreamBird fans it out to every destination you picked.',
  },
];

type Currency = 'USD' | 'INR';

const TIERS: {
  name: string;
  price: Record<Currency, string>;
  hours: string;
  destinations: string;
  guests: string;
  highlight: boolean;
}[] = [
  {
    name: 'Free',
    price: { USD: '$0', INR: '₹0' },
    hours: '5 stream-hours/mo',
    destinations: '1 destination',
    guests: '2 studio guests',
    highlight: false,
  },
  {
    name: 'Lite',
    price: { USD: '$4', INR: '₹299' },
    hours: '8 stream-hours/mo',
    destinations: '1 destination',
    guests: '3 studio guests',
    highlight: false,
  },
  {
    name: 'Starter',
    price: { USD: '$19', INR: '₹999' },
    hours: '20 stream-hours/mo',
    destinations: '2 destinations',
    guests: '4 studio guests',
    highlight: false,
  },
  {
    name: 'Pro',
    price: { USD: '$39', INR: '₹1,999' },
    hours: '200 stream-hours/mo (fair use)',
    destinations: '4 destinations',
    guests: '8 studio guests',
    highlight: true,
  },
  {
    name: 'Business',
    price: { USD: '$59', INR: '₹4,999' },
    hours: '200 stream-hours/mo (fair use)',
    destinations: '8 destinations',
    guests: '10 studio guests',
    highlight: false,
  },
];

function detectDefaultCurrency(): Currency {
  // Prerender (Node): always the same markup, whatever timezone the build machine is in.
  if (typeof window === 'undefined') return 'USD';
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    const locale = navigator.language ?? '';
    if (tz.includes('Calcutta') || tz.includes('Kolkata') || locale.toLowerCase().endsWith('-in')) {
      return 'INR';
    }
  } catch {
    // Intl/navigator unavailable -- fall through to the USD default.
  }
  return 'USD';
}

/** Formats one plan row from GET /plans/public like the static TIERS cards, so admin edits show up on the page. */
type Tier = (typeof TIERS)[number] & { perDay?: boolean; key?: string; payable?: boolean };

function planToTier(p: PublicPlan): Tier {
  const money = (inr: number | null, usd: number | null) => ({
    USD: usd === null ? '—' : `$${usd}`,
    INR: inr === null ? '—' : `₹${inr.toLocaleString('en-IN')}`,
  });
  const dayPass = p.kind === 'day_pass';
  return {
    name: p.name,
    price: money(p.priceInr, p.priceUsd),
    hours: dayPass
      ? `${p.maxSessionHours ? `Up to ${p.maxSessionHours} h per stream` : 'Unlimited streams'} for ${p.validityHours === 24 ? 'one day' : `${p.validityHours} h`}`
      : monthlyHoursLabel(p),
    destinations: `${p.maxDestinations} destination${p.maxDestinations === 1 ? '' : 's'}`,
    guests: `${p.maxGuests} studio guests`,
    highlight: p.key === 'pro',
    perDay: dayPass,
    key: p.key,
    payable: (p.priceInr ?? 0) > 0,
  };
}

const FAQ = [
  {
    q: 'Do I need to install anything?',
    a: 'No. The host studio and the guest join page both run entirely in your browser over WebRTC -- no app, no plugin.',
  },
  {
    q: 'Can guests join without a StreamBird account?',
    a: "Yes. Share a single invite link and they're in -- a password on the invite is optional, your call.",
  },
  {
    q: 'What platforms are supported today?',
    a: 'YouTube, Facebook, and Twitch, with more platforms landing as their own OAuth/app-review processes clear.',
  },
  {
    q: 'How does billing work?',
    a: "Billing is handled directly with our team for now, outside StreamBird's own checkout. Reach out and we'll get you set up.",
  },
  {
    q: 'Is this built on managed cloud transcoding?',
    a: "No -- delivery runs on our own self-hosted relay, not a metered vendor pipeline. That's what lets StreamBird match StreamYard-style pricing without the vendor markup baked in.",
  },
  {
    q: 'Do you have India-specific pricing?',
    a: "Yes -- toggle to INR above. Indian pricing runs well below our USD rate (and below what India-market incumbents like StreamYard charge there), since we self-host delivery instead of paying US-denominated cloud-vendor markup.",
  },
];

export function LandingPage() {
  const [currency, setCurrency] = useState<Currency>(detectDefaultCurrency);
  // Pricing comes from the admin-managed plans; the static TIERS are the fallback if that request fails.
  const [livePlans, setLivePlans] = useState<PublicPlan[] | null>(null);
  useEffect(() => {
    getPublicPlans().then(setLivePlans).catch(() => {});
  }, []);
  // Buy buttons appear only while an admin has payments switched on.
  const [paymentsOn, setPaymentsOn] = useState(false);
  useEffect(() => {
    getBillingConfig().then((c) => setPaymentsOn(c.enabled)).catch(() => {});
  }, []);
  const tiers: Tier[] = livePlans && livePlans.length > 0 ? livePlans.map(planToTier) : TIERS;

  return (
    <div className="pub-page landing-page">
      <header className="pub-header pub-landing-nav">
        <BrandLink />
        <nav className="pub-landing-links" aria-label="Sections">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
          <a href={docsUrl()} target="_blank" rel="noopener">Guides</a>
        </nav>
        <Link to="/login" className={buttonClass('secondary', 'sm')}>
          Log in
        </Link>
      </header>

      <main>
      <section className="pub-hero" id="top">
        <div className="pub-hero-copy">
          <Badge tone="scheduled" className="pub-hero-pill">
            Live from your browser &middot; nothing to install
          </Badge>
          <h1>
            Go live once.
            <br />
            Be everywhere.
          </h1>
          <p className="pub-hero-lead">
            Stream from your browser to YouTube, Facebook and Twitch at the same time, with a built-in multi-guest studio,
            mix-minus audio and your own branding. No app to install, no managed-cloud markup.
          </p>
          <div className="pub-hero-actions">
            <Link to="/login" className={buttonClass('primary', 'lg')}>
              Go live free
            </Link>
            <a href="#how" className={buttonClass('ghost', 'lg')}>
              See how it works
            </a>
          </div>
          <div className="pub-hero-social">
            <a href={authApi.googleLoginUrl()} className={buttonClass('secondary', 'sm')} aria-label="Sign in with Google">
              <GoogleLogo /> Google
            </a>
            <a href={authApi.facebookLoginUrl()} className={buttonClass('secondary', 'sm')} aria-label="Continue with Facebook">
              <FacebookLogo /> Facebook
            </a>
          </div>
          <p className="pub-trust">
            <ShieldCheck size={14} aria-hidden="true" /> No credit card to start &middot; Free tier included &middot; Self-hosted
            relay, no vendor lock-in
          </p>
        </div>
        <div className="pub-hero-visual">
          <HeroShowcase />
        </div>
      </section>

      <section id="features" className="pub-section pub-section--white">
        <div className="pub-wrap">
          <p className="pub-eyebrow">Features</p>
          <h2>Everything a live production needs, built in</h2>
          <div className="pub-grid pub-grid--features">
            {FEATURES.map((f) => (
              <div key={f.title} className="pub-card pub-feature">
                <span className="pub-feature-icon">
                  <f.icon size={20} aria-hidden="true" />
                </span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="pub-section">
        <div className="pub-wrap">
          <p className="pub-eyebrow">How it works</p>
          <h2>Three steps. Then you are live.</h2>
          <ol className="pub-grid pub-grid--steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="pub-card pub-step">
                <span className="pub-step-number" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="pub-section-sub">
            New here? Read{' '}
            <a href={docsUrl('getting-started')} target="_blank" rel="noopener">getting started</a>, how to{' '}
            <a href={docsUrl('connect-platforms')} target="_blank" rel="noopener">connect YouTube, Facebook and Twitch</a>, or how to{' '}
            <a href={docsUrl('schedule-and-invite')} target="_blank" rel="noopener">schedule a stream and invite guests</a>.
          </p>
        </div>
      </section>

      <section className="pub-section pub-section--white pub-section--tight">
        <div className="pub-wrap pub-platforms">
          <h2>Stream to the places your audience already is</h2>
          <div className="landing-platforms">
            <PlatformBadge platform="youtube" />
            <PlatformBadge platform="facebook" />
            <PlatformBadge platform="twitch" />
            <span className="badge">LinkedIn -- coming soon</span>
          </div>
        </div>
      </section>

      <section id="pricing" className="pub-section">
        <div className="pub-wrap">
          <p className="pub-eyebrow">Pricing</p>
          <h2>Start free. Pay when you grow.</h2>
          <p className="pub-section-sub">
            {paymentsOn
              ? 'Pay online by UPI, card or netbanking. Monthly plans renew by autopay and you can cancel any time.'
              : 'Billing is handled outside StreamBird for now -- these are the plans, reach out to get set up.'}
          </p>
          <div className="pub-seg" role="group" aria-label="Currency">
            <button type="button" className={currency === 'USD' ? 'active' : ''} aria-pressed={currency === 'USD'} onClick={() => setCurrency('USD')}>
              USD
            </button>
            <button type="button" className={currency === 'INR' ? 'active' : ''} aria-pressed={currency === 'INR'} onClick={() => setCurrency('INR')}>
              INR <span>India pricing</span>
            </button>
          </div>
          <div className="pub-grid pub-grid--plans">
            {tiers.map((t) => (
              <div key={t.name} className={`pub-card pub-plan${t.highlight ? ' pub-plan--highlight' : ''}`}>
                <h3>{t.name}</h3>
                <p className="pub-price">
                  {t.price[currency]}
                  <span>{t.perDay ? '/day' : '/mo'}</span>
                </p>
                <ul>
                  <li><CheckCircle2 size={16} aria-hidden="true" /> {t.hours}</li>
                  <li><CheckCircle2 size={16} aria-hidden="true" /> {t.destinations}</li>
                  <li><CheckCircle2 size={16} aria-hidden="true" /> {t.guests}</li>
                  <li><CheckCircle2 size={16} aria-hidden="true" /> Branding, mix-minus audio & compositing included</li>
                </ul>
                {paymentsOn && t.payable && t.key && (
                  <Link to={`/billing?plan=${t.key}`} className={buttonClass(t.highlight ? 'primary' : 'secondary', 'md', 'ui-btn--block')}>
                    Buy
                  </Link>
                )}
              </div>
            ))}
          </div>
          <p className="landing-custom-pricing pub-custom">
            Need more guests, a team or enterprise set-up, or a different mix? <strong>Custom / enterprise pricing</strong> is available -- email{' '}
            <a href="mailto:support@shackyapps.in?subject=StreamBird%20customised%20pricing&body=Hi%2C%20I%27d%20like%20a%20quote%20for%20StreamBird.%0A%0AHow%20many%20hours%20a%20month%3A%20%0AGuests%20at%20once%3A%20%0ADestinations%3A%20%0AAnything%20else%3A%20">
              support@shackyapps.in
            </a>{' '}
            with roughly how you stream and we'll reply with a quote.
          </p>
        </div>
      </section>

      <section id="faq" className="pub-section pub-section--white">
        <div className="pub-wrap pub-wrap--narrow">
          <h2>Questions, answered</h2>
          <div className="pub-faq">
            {FAQ.map((item, i) => (
              <details key={item.q} open={i === 0}>
                <summary>
                  {item.q}
                  <span aria-hidden="true" className="pub-faq-mark" />
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="pub-section">
        <div className="pub-wrap">
          <div className="pub-cta">
            <h2>Ready when you are.</h2>
            <p>Set up your company in a minute and go live today.</p>
            <div className="pub-cta-actions">
              <Link to="/signup-company" className="pub-cta-primary">
                Create company
              </Link>
              <Link to="/login" className="pub-cta-secondary">
                Log in
              </Link>
            </div>
          </div>
        </div>
      </section>

      </main>

      <footer className="pub-footer">
        <div className="pub-wrap pub-footer-inner">
          <span>
            <Clapperboard size={14} aria-hidden="true" /> StreamBird is part of{' '}
            <a href="https://shackyapps.in" target="_blank" rel="noopener">
              ShackyApps
            </a>
          </span>
          <span>
            <a href={docsUrl()} target="_blank" rel="noopener noreferrer">Docs</a> &middot; <Link to="/privacy">Privacy Policy</Link> &middot; <Link to="/terms">Terms of Service</Link> &middot; <Link to="/delete-account">Delete your account</Link><CookieSettingsLink />
          </span>
          <span>
            <a href="mailto:support@shackyapps.in">support@shackyapps.in</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
