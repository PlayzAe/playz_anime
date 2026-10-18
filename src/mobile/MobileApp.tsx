import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { GetAppPage } from '../renderer/components/GetApp';
import { Icon, type IconName } from '../renderer/components/Icon';
import { Toasts } from '../renderer/components/Shell';
import { Splash } from '../renderer/components/Splash';
import { UpdateNotifier } from '../renderer/components/UpdateNotifier';
import { Link, useRoute, type Route, type RouteName } from '../renderer/lib/router';
import { useApp } from '../renderer/lib/store';
import { chooseView, takeJustPicked } from '../renderer/lib/viewmode';
import { FirstRun } from '../renderer/views/FirstRun';
import { ProfileDetail, Profiles } from '../renderer/views/Profiles';
import { Reader } from '../renderer/views/Reader';
import { MHome } from './Home';
import { back, TopBar } from './kit';
import { MLibrary, MSchedule } from './Lists';
import { MMangaDetail } from './MangaDetail';
import { MMangaHome } from './MangaHome';
import { MSearch } from './Search';
import { MSeries } from './Series';
import { MSettings } from './Settings';
import { MWatch } from './Watch';
import './mobile.css';
import './screens.css';

/*
 * The phone layout, ported from the Android app: five tabs at the bottom, a top bar
 * per tab, detail pages with a floating back button, a touch player that goes sideways,
 * and no downloads (those live in the apps). The page itself scrolls, so mobile browsers
 * can tuck their address bar away.
 */

const TABS: { to: string; icon: IconName; label: string; match: RouteName[] }[] = [
  { to: '/', icon: 'tv', label: 'Anime', match: ['home', 'anime', 'watch'] },
  { to: '/manga', icon: 'manga', label: 'Manga', match: ['mangaHome', 'manga', 'read'] },
  { to: '/schedule', icon: 'schedule', label: 'Schedule', match: ['schedule'] },
  { to: '/library', icon: 'library', label: 'Library', match: ['library'] },
  { to: '/settings', icon: 'settings', label: 'Settings', match: ['settings'] },
];

const TAB_TITLES: Partial<Record<RouteName, [string, string?]>> = {
  home: ['Anime'],
  mangaHome: ['Manga', 'Manga · Manhwa · Manhua'],
  schedule: ['Schedule'],
  library: ['Library'],
  settings: ['Settings'],
};
const PLAIN_TITLES: Partial<Record<RouteName, string>> = { downloads: 'Get the app', profiles: 'Profiles', profile: 'Profile', notfound: 'Not found' };
const IMMERSIVE: RouteName[] = ['watch', 'read'];

function View({ route }: { route: Route }): ReactNode {
  const id = Number(route.params.id);
  switch (route.name) {
    case 'home':
      return <MHome />;
    case 'mangaHome':
      return <MMangaHome />;
    case 'discover':
      return <MSearch />;
    case 'schedule':
      return <MSchedule />;
    case 'library':
      return <MLibrary />;
    case 'settings':
      return <MSettings />;
    case 'downloads':
      return <GetAppPage />;
    case 'anime':
      return <MSeries id={id} />;
    case 'manga':
      return <MMangaDetail id={id} />;
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
    const t = TAB_TITLES[route.name]?.[0] ?? PLAIN_TITLES[route.name];
    if (t) document.title = `${t} · PlayzAnime`;
  }, [route.path]);
  useEffect(() => {
    const onScroll = () => scrolls.current.set(route.index, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [route.index]);

  const immersive = IMMERSIVE.includes(route.name);
  const tab = TAB_TITLES[route.name];
  const plain = PLAIN_TITLES[route.name];

  return (
    <div className={`m-app ${immersive ? 'is-immersive' : ''}`}>
      {tab && <TopBar title={tab[0]} subtitle={tab[1]} />}
      {plain && (
        <header className="m-top">
          <button type="button" className="m-round is-bare" aria-label="Back" onClick={back}>
            <Icon name="arrowLeft" size={20} />
          </button>
          <div className="m-top-titles">
            <span className="m-top-title display">{plain}</span>
          </div>
        </header>
      )}
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
