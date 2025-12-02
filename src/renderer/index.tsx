/**
 * Renderer process entry point
 * This file is loaded by the renderer process
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { rendererLogger } from '../shared/logger';

rendererLogger.info('FSP Study Tools initializing...');

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  const rootElement = document.getElementById('root');

  if (!rootElement) {
    rendererLogger.error('Root element not found!');
    return;
  }

  const root = createRoot(rootElement);
  root.render(<App />);

  rendererLogger.info('React app rendered successfully');
});

