// [FIX-20260729-TWBUILD] Tailwind is compiled into the bundle now — this import
// replaces the cdn.tailwindcss.com <script> that used to sit in index.html.
// Must stay first so utility classes are defined before any component styles.
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './services/query';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {/* [FEAT-20261027-TANSTACK] same instance the query hooks pass explicitly — for useQueryClient() */}
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <App />
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
