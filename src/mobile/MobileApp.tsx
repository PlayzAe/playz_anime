import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { GetAppPage } from '../renderer/components/GetApp';
import { Icon, type IconName } from '../renderer/components/Icon';
import { Toasts } from '../renderer/components/Shell';
import { Splash } from '../renderer/components/Splash';
import { UpdateNotifier } from '../renderer/components/UpdateNotifier';
import { Link, useRoute, type Route, type RouteName } from '../renderer/lib/router';
import { useApp } from '../renderer/lib/store';
import { chooseView, takeJustPicked } from '../renderer/lib/viewmode';
import { Discover } from '../renderer/views/Discover';
import { FirstRun } from '../renderer/views/FirstRun';
import { Home } from '../renderer/views/Home';
import { Library } from '../renderer/views/Library';
import { MangaDetail } from '../renderer/views/MangaDetail';
import { MangaHome } from '../renderer/views/MangaHome';
import { ProfileDetail, Profiles } from '../renderer/views/Profiles';
import { Reader } from '../renderer/views/Reader';
import { Schedule } from '../renderer/views/Schedule';
import { Series } from '../renderer/views/Series';
import { TopBar } from './kit';
import { MSettings } from './Settings';
import { MWatch } from './Watch';
import './mobile.css';

/*
 * The phone layout, after the Android app: five tabs at the bottom, a top bar per tab,
 * a touch player that goes sideways, and no downloads (those live in the apps).
 * The page itself scrolls, so mobile browsers can tuck their address bar away.
 */

const TABS: { to: string; icon: IconName; label: string; match: RouteName[] }[] = [
  { to: '/', icon: 'tv', label: 'Anime', match: ['home', 'anime', 'watch'] },
  { to: '/manga', icon: 'manga', label: 'Manga', match: ['mangaHome', 'manga', 'read'] },
  { to: '/schedule', icon: 'schedule', label: 'Schedule', match: ['schedule'] },
  { to: '/library', icon: 'library', label: 'Library', match: ['library'] },
  { to: '/settings', icon: 'settings', label: 'Settings', match: ['settings'] },
];

const TITLES: Partial<Record<RouteName, string>> = {
  home: 'Anime',
  mangaHome: 'Manga',
  discover: 'Search',
  schedule: 'Schedule',
  library: 'Library',
  settings: 'Settings',
  downloads: 'Get the app',
  profiles: 'Profiles',
};
const PUSHED: RouteName[] = ['anime', 'manga', 'profile', 'downloads', 'profiles', 'notfound'];
const IMMERSIVE: RouteName[] = ['watch', 'read'];

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
    case 'settings':
      return <MSettings />;
    case 'downloads':
      return <GetAppPage />;
    case 'anime':
      return <Series id={id} />;
    case 'manga':
      return <MangaDetail id={id} />;
    case 'watch':
      return <MWatch id={id} ep={Number(route.params.ep)} />;
    case 'read':
      return <Reader id={id} chapterId={route.params.chapter} />;
    case 'profiles':
      return <Profiles />;
    case 'profile':
      return <ProfileDetail id={route.params.id} />;
    default:
      return <p className="m-empty">This page doesn’t exist.</p>;
  }
}

const SPLASH_KEY = 'playzanime:splash-seen';

export function MobileApp() {
  const route = useRoute();
  const { toast, online } = useApp();
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  const [splash, setSplash] = useState(() => {
    try {
      return sessionStorage.getItem(SPLASH_KEY) !== '1';
    } catch {
      return false;
    }
  });
  const scrolls = useRef(new Map<number, number>());

  useEffect(() => {
    document.documentElement.classList.add('m-root');
    void window.playzanime.setup
      .isDone()
      .then(setSetupDone)
      .catch(() => setSetupDone(true));
    try {
      sessionStorage.setItem(SPLASH_KEY, '1');
    } catch {
      /* plays again next load */
    }
    if (takeJustPicked()) {
      toast('You’re on Phone view. Picked wrong? Switch any time in Settings → View.', {
        action: { label: 'Use computer view', run: () => chooseView('desktop', { reload: true }) },
      });
    }
    return () => document.documentElement.classList.remove('m-root');
  }, []);

  const firstOnline = useRef(true);
  useEffect(() => {
    if (firstOnline.current) {
      firstOnline.current = false;
      if (online) return;
    }
    toast(online ? 'Back online.' : 'You’re offline. Come back online to keep watching and reading.', online ? undefined : { tone: 'error' });
  }, [online]);

  // Back/forward lands where you were; new pages start at the top.
  useLayoutEffect(() => {
    const saved = route.via === 'pop' ? scrolls.current.get(route.index) : undefined;
    window.scrollTo(0, saved ?? 0);
    if (route.name in TITLES) document.title = `${TITLES[route.name]} · PlayzAnime`;
  }, [route.path]);
  useEffect(() => {
    const onScroll = () => scrolls.current.set(route.index, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [route.index]);

  const immersive = IMMERSIVE.includes(route.name);
  const pushed = PUSHED.includes(route.name);

  return (
    <div className={`m-app ${immersive ? 'is-immersive' : ''}`}>
      {!immersive && <TopBar title={pushed ? TITLES[route.name] : TITLES[route.name] ?? 'PlayzAnime'} pushed={pushed} />}
      <main className="m-main">
        <View key={route.path} route={route} />
      </main>
      {!immersive && (
        <nav className="m-tabs" aria-label="Main">
          {TABS.map((t) => {
            const on = t.match.includes(route.name);
            return (
              <Link key={t.to} to={t.to} className={`m-tab ${on ? 'is-on' : ''}`} aria-current={on ? 'page' : undefined}>
                <span className="m-tab-dash" aria-hidden="true" />
                <Icon name={t.icon} size={22} />
                <span className="m-tab-label">{t.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
      {!splash && setupDone === false && <FirstRun irisToRail={false} onDone={() => setSetupDone(true)} />}
      {splash && <Splash irisToRail={false} onDone={() => setSplash(false)} />}
      <UpdateNotifier ready={!splash} />
      <Toasts />
    </div>
  );
}
