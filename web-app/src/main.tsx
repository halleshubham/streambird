import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import { App } from './App.tsx';
import { AuthProvider } from './context/AuthProvider.tsx';
import { BusyOverlay } from './components/BusyOverlay.tsx';
import { initConsent } from './lib/consent.ts';

initConsent(); // Google Analytics loads only for a visitor who already accepted

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
