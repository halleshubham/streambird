import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import { App } from './App.tsx';
import { AuthProvider } from './context/AuthProvider.tsx';
import { BusyOverlay } from './components/BusyOverlay.tsx';
import { initConsent } from './lib/consent.ts';

void initConsent(); // loads Google Analytics, or waits for consent, as the server's COOKIE_CONSENT_BANNER says

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <BusyOverlay />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
