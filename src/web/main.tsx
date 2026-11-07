import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { APP } from '../app-config.ts';

import { App } from './app.tsx';

document.title = APP.name;

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
