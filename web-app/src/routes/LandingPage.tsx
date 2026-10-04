import { useState } from 'react';
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
import { PlatformBadge } from '../components/PlatformBadge';

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
    title: "Real status, not guesswork",
    body: "See each destination's actual platform-reported status -- not just \"we configured it\" -- plus a direct watch link you can copy and share.",
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
    hours: '2 stream-hours/mo',
    destinations: '1 destination',
    guests: '2 studio guests',
    highlight: false,
  },
  {
    name: 'Starter',
    price: { USD: '$19', INR: '₹999' },
    hours: '10 stream-hours/mo',
    destinations: '2 destinations',
    guests: '4 studio guests',
    highlight: false,
  },
  {
    name: 'Pro',
    price: { USD: '$39', INR: '₹1,999' },
    hours: '30 stream-hours/mo',
    destinations: '4 destinations',
    guests: '6 studio guests',
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: { USD: '$129', INR: '₹6,999' },
    hours: '100 stream-hours/mo',
    destinations: '6 destinations',
    guests: '8 studio guests',
    highlight: false,
  },
];

function detectDefaultCurrency(): Currency {
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

  return (
    <div className="landing-page">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <Link to="/" className="brand">
            <img src="/logo.png" alt="" className="brand-logo" />
            StreamBird
          </Link>
          <nav className="landing-nav-links">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <Link to="/login" className="icon-btn icon-btn--small">
            Log in
          </Link>
        </div>
      </header>

      <section className="landing-hero">
        <h1>Go live everywhere, from one browser tab.</h1>
        <p className="landing-subhead">
          StreamBird broadcasts to YouTube, Facebook, Twitch, and more -- simultaneously -- with a built-in
          multi-guest studio, mix-minus audio, and live branding overlays. No app to install, no
          managed-cloud markup.
        </p>
        <div className="landing-cta-row">
          <Link to="/login" className="go-live-cta">
            Start free
          </Link>
          <a href={authApi.googleLoginUrl()} className="button-like google-button landing-google-btn">
            Sign in with Google
          </a>
          <a href="#pricing" className="link-button">
            See pricing
          </a>
        </div>
        <p className="landing-trust-line">
          <ShieldCheck size={14} /> No credit card to start &middot; Free tier included &middot;
          Self-hosted relay, no vendor lock-in
        </p>
      </section>

      <section id="features" className="landing-section">
        <h2>Everything a live production needs, built in</h2>
        <div className="landing-feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="landing-feature-card">
              <f.icon size={22} />
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section--alt">
        <h2>How it works</h2>
        <div className="landing-steps">
          {STEPS.map((s, i) => (
            <div key={s.title} className="landing-step">
              <span className="landing-step-number">{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <h2>Platforms</h2>
        <div className="landing-platforms">
          <PlatformBadge platform="youtube" />
          <PlatformBadge platform="facebook" />
          <PlatformBadge platform="twitch" />
          <span className="badge">LinkedIn -- coming soon</span>
        </div>
      </section>

      <section id="pricing" className="landing-section landing-section--alt">
        <h2>Pricing</h2>
        <p className="landing-section-sub">
          Billing is handled outside StreamBird for now -- these are the plans, reach out to get
          set up.
        </p>
        <div className="landing-currency-toggle" role="group" aria-label="Currency">
          <button
            type="button"
            className={`link-button${currency === 'USD' ? ' landing-currency-toggle--active' : ''}`}
            onClick={() => setCurrency('USD')}
          >
            USD
          </button>
          <button
            type="button"
            className={`link-button${currency === 'INR' ? ' landing-currency-toggle--active' : ''}`}
            onClick={() => setCurrency('INR')}
          >
            INR (India pricing)
          </button>
        </div>
        <div className="landing-pricing-grid">
          {TIERS.map((t) => (
            <div key={t.name} className={`landing-price-card${t.highlight ? ' landing-price-card--highlight' : ''}`}>
              <h3>{t.name}</h3>
              <p className="landing-price">
                {t.price[currency]}
                <span>/mo</span>
              </p>
              <ul>
                <li><CheckCircle2 size={14} /> {t.hours}</li>
                <li><CheckCircle2 size={14} /> {t.destinations}</li>
                <li><CheckCircle2 size={14} /> {t.guests}</li>
                <li><CheckCircle2 size={14} /> Branding, mix-minus audio & compositing included</li>
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="landing-section">
        <h2>Frequently asked questions</h2>
        <div className="landing-faq">
          {FAQ.map((item) => (
            <div key={item.q} className="landing-faq-item">
              <h3>{item.q}</h3>
              <p>{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section--cta">
        <h2>Ready to put the right tool to work?</h2>
        <div className="landing-cta-row">
          <Link to="/login" className="go-live-cta">
            Start free
          </Link>
          <Link to="/signup-company" className="button-like">
            Create a company account
          </Link>
        </div>
      </section>

      <footer className="landing-footer">
        <span>
          <Clapperboard size={14} /> StreamBird is part of{' '}
          <a href="https://shackyapps.in" target="_blank" rel="noopener">
            ShackyApps
          </a>
        </span>
        <span>
          <a href={docsUrl()} target="_blank" rel="noopener noreferrer">Docs</a> &middot; <Link to="/privacy">Privacy Policy</Link> &middot; <Link to="/terms">Terms of Service</Link>
        </span>
        <span>
          <a href="mailto:support@shackyapps.in">support@shackyapps.in</a>
        </span>
      </footer>
    </div>
  );
}
