import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Dev-only handle for poking at the store from the console.
if (import.meta.env.DEV) {
  import('./model/store').then((m) => Object.assign(window, { keito: m.useStore }));
}
