import { useMemo, type ReactNode } from 'react';
import { detectOS, isStandalone, promptInstall, useCanInstall, useDownloads, type OS } from '../lib/install';
import { RELEASES_URL } from '../lib/links';
import { navigate } from '../lib/router';
import { Button } from './Controls';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';
import { Modal } from './Modal';
import './getapp.css';

/*
 * Downloads and offline mode need a real disk, so they live in the Windows and Android apps.
 * The website always streams over the internet. The Downloads page and every Download
 * button on the web lead here, and each offers the app for the visitor's own system:
 * the APK on Android, the installer on Windows, Add to Home Screen on iPhone.
 */

export const APP_URL = RELEASES_URL;

const FEATURES: { icon: IconName; title: string; body: string; windows?: boolean }[] = [
  { icon: 'downloads', title: 'Episodes as MP4', body: 'Subtitles packed in. A download picks up where it stopped and waits out busy hosts.' },
  { icon: 'manga', title: 'Chapters as CBZ', body: 'Every page stored untouched, readable in PlayzAnime or any comic reader.' },
  { icon: 'offline', title: 'Offline mode', body: 'With no internet the app opens on your downloads. They play and read as usual.' },
  { icon: 'keyboard', title: 'Media keys and taskbar', body: 'Play, pause and next episode from your keyboard and the Windows taskbar.', windows: true },
];

export const openAppPage = () => void window.playzanime.app.openExternal(APP_URL);

const useOS = () => useMemo<OS>(() => detectOS(), []);

function Features({ compact, os }: { compact?: boolean; os: OS }) {
  const list = FEATURES.filter((f) => !f.windows || os === 'windows');
  return (
    <ul className={`getapp-features ${compact ? 'is-compact' : ''}`}>
      {list.slice(0, compact ? 3 : list.length).map((f) => (
        <li key={f.title}>
          <span className="getapp-icon">
            <Icon name={f.icon} size={compact ? 17 : 19} />
          </span>
          <span className="getapp-feature-text">
            <strong>{f.title}</strong>
            <span>{f.body}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Safari's two taps, shown wherever iPhone and iPad visitors are offered "the app". */
function HomeScreenSteps() {
  return (
    <ol className="getapp-steps">
      <li>
        Tap <Icon name="share" size={16} /> <strong>Share</strong> in Safari’s toolbar.
      </li>
      <li>
        Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
      </li>
    </ol>
  );
}

/** The whole page, at /downloads. */
export function GetAppPage() {
  const os = useOS();
  const links = useDownloads();
  const canInstall = useCanInstall() && !isStandalone();
  const open = (url: string) => void window.playzanime.app.openExternal(url);
  const stay = (
    <Button variant="ghost" size="lg" onClick={() => navigate('/')}>
      Keep watching here
    </Button>
  );
  const installBtn = canInstall && (
    <Button variant="ghost" size="lg" onClick={() => void promptInstall()}>
      Add to home screen
    </Button>
  );

  let eyebrow = 'PlayzAnime for Windows and Android';
  let title = 'Downloads live in the apps';
  let sub: ReactNode = 'Here in the browser you stream and read online. The Windows and Android apps do the same, and also save episodes and chapters so they play with no internet at all.';
  let actions: ReactNode = (
    <>
      <Button variant="primary" size="lg" icon="downloads" onClick={() => open(links.page)}>
        Get the apps
      </Button>
      {installBtn || stay}
    </>
  );
  let fine: ReactNode = 'Free, with no ads. Windows 10 and 11, Android 7 and newer. On Mac and Linux, stream here in the browser.';

  if (os === 'android') {
    eyebrow = 'PlayzAnime for Android';
    title = 'Downloads live in the app';
    sub = 'Here in the browser you stream and read online. The Android app does the same, and also saves episodes and chapters to your phone so they play with no internet at all.';
    actions = (
      <>
        <Button variant="primary" size="lg" icon="downloads" onClick={() => open(links.apk)}>
          Download the APK{links.apkVersion ? ` (v${links.apkVersion})` : ''}
        </Button>
        {installBtn || stay}
      </>
    );
    fine = 'Free, with no ads. Android 7 and newer. Android may ask you to allow installs from your browser first.';
  } else if (os === 'windows') {
    eyebrow = 'PlayzAnime for Windows';
    title = 'Downloads live in the app';
    sub = 'Here in the browser you stream and read online. The Windows app does the same, and also saves episodes and chapters to your PC so they play with no internet at all.';
    actions = (
      <>
        <Button variant="primary" size="lg" icon="downloads" onClick={() => open(links.windows)}>
          Get PlayzAnime for Windows
        </Button>
        {stay}
      </>
    );
    fine = 'Free, with no ads. Windows 10 and 11. Also on Android.';
  } else if (os === 'ios') {
    eyebrow = 'On iPhone and iPad';
    title = 'Add PlayzAnime to your Home Screen';
    sub = (
      <>
        There’s no App Store app, so downloads aren’t available on iPhone or iPad. Add the site to your Home Screen instead: it opens full screen, like an app, and streams over the internet.
        <HomeScreenSteps />
      </>
    );
    actions = stay;
    fine = 'Want downloads? They’re in the free Windows and Android apps.';
  }

  return (
    <div className="page getapp">
      <section className="getapp-hero">
        <div className="getapp-seal" aria-hidden="true">
          <span className="getapp-halo" />
          <Logo size={88} />
        </div>
        <div className="getapp-copy">
          <div className="getapp-eyebrow">{eyebrow}</div>
          <h1 className="getapp-title display">{title}</h1>
          <div className="getapp-sub">{sub}</div>
          <div className="getapp-actions">{actions}</div>
          <p className="getapp-fine">{fine}</p>
        </div>
      </section>
      <Features os={os} />
    </div>
  );
}

/** What a Download button opens on the web. */
export function GetAppDialog({ open, onClose, what }: { open: boolean; onClose: () => void; what: ReactNode }) {
  const os = useOS();
  const links = useDownloads();
  const go = (url: string) => {
    void window.playzanime.app.openExternal(url);
    onClose();
  };
  const ios = os === 'ios';
  const target = os === 'android' ? links.apk : os === 'windows' ? links.windows : links.page;
  const label = os === 'android' ? 'Download the APK' : os === 'windows' ? 'Get the Windows app' : 'Get the app';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Download with the app"
      width={540}
      footer={
        ios ? (
          <Button variant="primary" onClick={onClose}>
            OK
          </Button>
        ) : (
          <>
            <Button variant="quiet" onClick={onClose}>
              Not now
            </Button>
            <Button variant="primary" icon="downloads" onClick={() => go(target)}>
              {label}
            </Button>
          </>
        )
      }
    >
      <div className="getapp-dialog">
        <Logo size={44} />
        <p>
          {ios
            ? <>Saving {what} for offline viewing needs PlayzAnime for Windows or Android. On iPhone and iPad you can stream it here while you’re online.</>
            : <>Saving {what} for offline viewing needs PlayzAnime for {os === 'android' ? 'Android' : os === 'windows' ? 'Windows' : 'Windows or Android'}. The website streams it while you’re online; the app can keep it.</>}
        </p>
      </div>
      {!ios && <Features compact os={os} />}
    </Modal>
  );
}
