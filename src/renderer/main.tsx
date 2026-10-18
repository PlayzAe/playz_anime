import '@fontsource-variable/archivo/standard.css';
import './styles/tokens.css';
import './styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installWebApi } from '../web/api';
import { App } from './App';
import { installDevice } from './lib/device';
import { installPwa } from './lib/install';
import { AppDataProvider } from './lib/store';
import './styles/responsive.css';

// window.playzanime must exist, and the accent be set, before anything renders.
installDevice();
installPwa();
installWebApi();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppDataProvider>
      <App />
    </AppDataProvider>
  </StrictMode>,
);
