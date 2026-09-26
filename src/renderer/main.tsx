import '@fontsource-variable/archivo/standard.css';
import './styles/tokens.css';
import './styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installWebApi } from '../web/api';
import { App } from './App';
import { AppDataProvider } from './lib/store';

// window.playzanime must exist, and the accent be set, before anything renders.
installWebApi();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppDataProvider>
      <App />
    </AppDataProvider>
  </StrictMode>,
);
