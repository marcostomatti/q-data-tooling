import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { APP } from '../app-config.ts';

import { App } from './app.tsx';
import { applyStoredTheme } from './theme.ts';

document.title = APP.name;
applyStoredTheme();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
