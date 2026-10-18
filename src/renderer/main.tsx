import '@fontsource-variable/archivo/standard.css';
import './styles/tokens.css';
import './styles/base.css';
import { lazy, StrictMode, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { installWebApi } from '../web/api';
import { App } from './App';
import { ViewPicker } from './components/ViewPicker';
import { installDevice } from './lib/device';
import { installPwa } from './lib/install';
import { AppDataProvider } from './lib/store';
import { chooseView, storedView, type ViewMode } from './lib/viewmode';
import './styles/responsive.css';

// The phone layout is its own app (src/mobile); computers never download it.
const MobileApp = lazy(() => import('../mobile/MobileApp').then((m) => ({ default: m.MobileApp })));

// window.playzanime must exist, and the accent be set, before anything renders.
installDevice();
installPwa();
installWebApi();

function Root() {
  const [view, setView] = useState<ViewMode | null>(storedView);
  if (!view) {
    return (
      <ViewPicker
        onPick={(v) => {
          chooseView(v, { first: true });
          setView(v);
        }}
      />
    );
  }
  return view === 'mobile' ? (
    <Suspense fallback={null}>
      <MobileApp />
    </Suspense>
  ) : (
    <App />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppDataProvider>
      <Root />
    </AppDataProvider>
  </StrictMode>,
);
