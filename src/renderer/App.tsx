import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { Button } from './components/Controls';
import { GetAppPage } from './components/GetApp';
import { MobileNotice } from './components/MobileNotice';
import { ProfileDrop } from './components/ProfileDrop';
import { Rail, TitleBar, Toasts } from './components/Shell';
import { Splash } from './components/Splash';
import { EmptyState } from './components/States';
import { navigate, useRoute, type Route, type RouteName } from './lib/router';
import { useApp } from './lib/store';
import { useIsPhone } from './lib/viewport';
import { Discover } from './views/Discover';
import { FirstRun } from './views/FirstRun';
import { Home } from './views/Home';
import { Library } from './views/Library';
import { MangaDetail } from './views/MangaDetail';
import { MangaHome } from './views/MangaHome';
import { ProfileDetail, Profiles } from './views/Profiles';
import { Reader } from './views/Reader';
import { Schedule } from './views/Schedule';
import { Series } from './views/Series';
import { Settings } from './views/Settings';
import { Watch } from './views/Watch';

function View({ route }: { route: Route }): ReactNode {
  const id = Number(route.params.id);
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'mangaHome':
      return <MangaHome />;
    case 'discover':
      return <Discover />;
    case 'schedule':
      return <Schedule />;
    case 'library':
      return <Library />;
    case 'downloads':
      return <GetAppPage />;
    case 'settings':
      return <Settings />;
    case 'anime':
      return <Series id={id} />;
    case 'manga':
      return <MangaDetail id={id} />;
    case 'watch':
      return <Watch id={id} ep={Number(route.params.ep)} />;
    case 'read':
      return <Reader id={id} chapterId={route.params.chapter} />;
    case 'profiles':
      return <Profiles />;
    case 'profile':
      return <ProfileDetail id={route.params.id} />;
    default:
      return (
        <div className="page">
          <EmptyState
            icon="alert"
            title="This page doesn’t exist"
            body="The link may be mistyped, or from an older version of PlayzAnime."
            action={<Button onClick={() => navigate('/')}>Go home</Button>}
          />
        </div>
      );
  }
}

const IMMERSIVE: Route['name'][] = ['read'];
const ALWAYS_SOLID: Route['name'][] = ['watch', 'discover', 'schedule', 'library', 'downloads', 'settings', 'profiles', 'profile', 'notfound'];
// Pages that manage their own query string without remounting.
const QUERY_STABLE: Route['name'][] = ['discover', 'schedule', 'library', 'read'];
// Tab titles for pages without a title of their own; detail pages name themselves.
const TITLES: Partial<Record<RouteName, string | null>> = {
  home: null,
  mangaHome: 'Manga',
  discover: 'Discover',
  schedule: 'Schedule',
  library: 'Library',
  downloads: 'Windows app',
  settings: 'Settings',
  profiles: 'Profiles',
  notfound: 'Not found',
};

// The opening plays once per browser session, not on every reload.
const SPLASH_KEY = 'playzanime:splash-seen';
function splashSeen() {
  try {
    return sessionStorage.getItem(SPLASH_KEY) === '1';
  } catch {
    return false;
  }
}

export function App() {
  const route = useRoute();
  const { online, toast } = useApp();
  const phone = useIsPhone();
  const mainRef = useRef<HTMLElement>(null);
  const scrollMemory = useRef(new Map<number, number>());
  const [scrolled, setScrolled] = useState(false);
  const [palette, setPalette] = useState(false);
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  const [splash, setSplash] = useState(() => !splashSeen());

  useEffect(() => {
    void window.playzanime.setup
      .isDone()
      .then(setSetupDone)
      .catch(() => setSetupDone(true));
  }, []);

  useEffect(() => {
    if (!splash) return;
    try {
      sessionStorage.setItem(SPLASH_KEY, '1');
    } catch {
      /* private storage: it plays again next load */
    }
  }, [splash]);

  useEffect(() => {
    if (route.name in TITLES) document.title = TITLES[route.name] ? `${TITLES[route.name]} · PlayzAnime` : 'PlayzAnime';
  }, [route.name]);

  // Say so when the connection drops or comes back; the page stays where it is.
  const firstOnline = useRef(true);
  useEffect(() => {
    if (firstOnline.current) {
      firstOnline.current = false;
      if (online) return;
    }
    toast(online ? 'Back online.' : 'You’re offline. Streaming and reading come back when you reconnect.', online ? undefined : { tone: 'error' });
  }, [online]);

  // Back/forward restores where you were; new pages start at the top.
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    if (route.via === 'replace' && QUERY_STABLE.includes(route.name)) return;
    const saved = route.via === 'pop' ? scrollMemory.current.get(route.index) : undefined;
    el.scrollTop = saved ?? 0;
    setScrolled((saved ?? 0) > 24);
    // Images above the fold may still be loading; try once more after layout settles.
    if (saved) requestAnimationFrame(() => (el.scrollTop = saved));
  }, [route]);

  // Back and forward (Alt+arrows, mouse side buttons) are the browser's own, through the router.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, [contenteditable]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onScroll = () => {
    const top = mainRef.current?.scrollTop ?? 0;
    scrollMemory.current.set(route.index, top);
    setScrolled(top > 24);
  };

  const immersive = IMMERSIVE.includes(route.name);
  const viewKey = QUERY_STABLE.includes(route.name) ? route.path : `${route.path}?${route.query.toString()}`;

  return (
    <div className={`app ${immersive ? 'is-immersive' : ''}`}>
      {!immersive && <Rail route={route} />}
      {!immersive && <TitleBar route={route} solid={scrolled || ALWAYS_SOLID.includes(route.name)} onSearch={() => setPalette(true)} />}
      <MobileNotice />
      <main className="main" ref={mainRef} onScroll={onScroll}>
        <View key={viewKey} route={route} />
      </main>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <ProfileDrop />
      {!splash && setupDone === false && <FirstRun irisToRail={!phone} onDone={() => setSetupDone(true)} />}
      {/* On wide screens the opening closes onto the rail's seal; on phones the rail is a tab bar, so it fades. */}
      {splash && <Splash irisToRail={setupDone !== false && !phone} onDone={() => setSplash(false)} />}
      <Toasts />
    </div>
  );
}
