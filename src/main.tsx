import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';

// Mount the React app into the DOM
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
  // Signal successful mount for debugging
  try {
    // @ts-ignore
    console.log('AIR: React mounted', { reactVersion: (React as any).version });
    (window as any).__AIR_APP_MOUNTED = true;
  } catch (e) {}
} else {
  // In case the DOM isn't ready, attach on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('root');
    if (el) createRoot(el).render(<App />);
  });
}