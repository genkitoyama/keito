import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { boot } from './model/store';
import './styles.css';
import './ui/tips';

// In the desktop app, boards are kept through its own store; in a browser, the one found (see connect).
if ('__TAURI_INTERNALS__' in window) void import('./platform/tauri').then((m) => m.startDesktop());
else void boot();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Dev-only handle for poking at the store from the console.
if (import.meta.env.DEV) {
  import('./model/store').then((m) => Object.assign(window, { keito: m.useStore }));
}
