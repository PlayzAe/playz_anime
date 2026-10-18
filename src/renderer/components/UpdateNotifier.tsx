import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { device } from '../lib/device';
import { detectOS, downloadsOf, isStandalone, latestRelease, promptInstall, useCanInstall, type OS, type Release } from '../lib/install';
import { CHANGELOG_URL } from '../lib/links';
import { Button } from './Controls';
import { Icon } from './Icon';
import './update.css';

/*
 * One card, shown once, that points each visitor at the right app:
 *   Android  the APK (downloads and offline), or Add to home screen
 *   iPhone   Share, then Add to Home Screen
 *   Windows  a new Windows release (downloads and offline)
 *   others   the browser's own Install prompt, when it has one
 * In the Windows app it is the "update available" notice instead.
 * Release notes are written on GitHub, so nothing changes here when one comes out.
 */

const DISMISSED_KEY = 'playzanime:dismissed_update';

/** True when `remote` is a higher version than `current` (both like v1.2.3). */
function isNewer(remote: string, current: string): boolean {
  const r = remote.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const c = current.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    if ((r[i] ?? 0) !== (c[i] ?? 0)) return (r[i] ?? 0) > (c[i] ?? 0);
  }
  return false;
}

/** The first couple of top-level points from the notes, as plain text. */
function highlights(body: string, count = 2): string[] {
  const plain = (s: string) =>
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]+/g, '')
      .replace(/:$/, '')
      .trim();
  const lines = body.split(/\r?\n/);
  const bullets = lines.filter((l) => /^[-*•]\s+/.test(l)).map((l) => plain(l.replace(/^[-*•]\s+/, '')));
  const pick = bullets.length ? bullets : lines.filter((l) => l.trim() && !/^\s*#/.test(l)).map(plain);
  return pick.filter(Boolean).slice(0, count);
}

type Kind = 'update' | 'android' | 'ios' | 'windows' | 'install';

/** The id remembered on dismiss, so each offer shows once (once per release where there is one). */
const offerId = (kind: Kind, release: Release | null) => (release ? `${kind}:${release.tag_name}` : kind);

function seen(id: string) {
  try {
    const v = localStorage.getItem(DISMISSED_KEY);
    // Older builds stored the bare tag for the Windows card.
    return v === id || (id.startsWith('windows:') && v === id.slice('windows:'.length));
  } catch {
    return false;
  }
}

export function UpdateNotifier({ ready }: { ready: boolean }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [release, setRelease] = useState<Release | null>(null);
  const [os, setOs] = useState<OS>('other');
  const [closed, setClosed] = useState(false);
  const canInstall = useCanInstall();

  useEffect(() => {
    if (!ready || device() === 'tv') return;
    // Give the intro and the first screen a moment before saying anything.
    const timer = setTimeout(async () => {
      try {
        const info = await window.playzanime.app.info();
        const latest = await latestRelease();
        if (info.platform !== 'web') {
          if (latest?.tag_name && isNewer(latest.tag_name, info.version)) {
            setRelease(latest);
            setKind('update');
          }
          return;
        }
        const system = detectOS();
        setOs(system);
        setRelease(latest);
        if (system === 'android') setKind('android');
        else if (system === 'windows') setKind(latest ? 'windows' : null);
        else if (system === 'ios') setKind(isStandalone() ? null : 'ios');
        else setKind('install');
      } catch {
        // Offline or rate-limited: try again next visit.
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [ready]);

  const id = kind ? offerId(kind, kind === 'ios' || kind === 'install' ? null : release) : '';
  // The plain install card only exists while the browser offers its prompt.
  const visible = !!kind && !closed && !seen(id) && (kind !== 'install' || (canInstall && !isStandalone()));

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, id);
    } catch {
      /* storage unavailable */
    }
    setClosed(true);
  };

  const open = (url: string) => {
    void window.playzanime.app.openExternal(url);
    dismiss();
  };

  const install = async () => {
    if (await promptInstall()) dismiss();
  };

  const links = downloadsOf(release);
  const points = release && (kind === 'update' || kind === 'windows') ? highlights(release.body ?? '') : [];

  let eyebrow = '';
  let title: ReactNode = null;
  let body: ReactNode = null;
  let actions: ReactNode = null;

  switch (kind) {
    case 'update':
      eyebrow = 'Update available';
      title = (
        <>
          PlayzAnime <span className="update-version num">{release?.tag_name}</span> is ready to download
        </>
      );
      actions = (
        <>
          <Button variant="primary" size="sm" icon="downloads" onClick={() => open(links.windows)}>
            Download
          </Button>
          <Button variant="quiet" size="sm" onClick={() => open(CHANGELOG_URL)}>
            What’s new
          </Button>
        </>
      );
      break;
    case 'windows':
      eyebrow = 'New for Windows';
      title = (
        <>
          PlayzAnime <span className="update-version num">{release?.tag_name}</span> is out
        </>
      );
      body = <p className="update-note">Download episodes and chapters to your PC and watch with no internet.</p>;
      actions = (
        <>
          <Button variant="primary" size="sm" icon="downloads" onClick={() => open(links.windows)}>
            Get the Windows app
          </Button>
          <Button variant="quiet" size="sm" onClick={() => open(CHANGELOG_URL)}>
            What’s new
          </Button>
        </>
      );
      break;
    case 'android':
      eyebrow = 'PlayzAnime for Android';
      title = (
        <>
          Get the Android app{links.apkVersion && <span className="update-version num"> v{links.apkVersion}</span>}
        </>
      );
      body = <p className="update-note">Download episodes and chapters to your phone and watch with no internet. The website itself needs a connection.</p>;
      actions = (
        <>
          <Button variant="primary" size="sm" icon="downloads" onClick={() => open(links.apk)}>
            Download APK
          </Button>
          {canInstall && !isStandalone() ? (
            <Button variant="quiet" size="sm" onClick={() => void install()}>
              Add to home screen
            </Button>
          ) : (
            <Button variant="quiet" size="sm" onClick={dismiss}>
              Not now
            </Button>
          )}
        </>
      );
      break;
    case 'ios':
      eyebrow = /iPad/.test(navigator.userAgent) ? 'On your iPad' : 'On your iPhone';
      title = 'Add PlayzAnime to your Home Screen';
      body = (
        <ol className="update-steps">
          <li>
            Tap <Icon name="share" size={15} className="update-inline-icon" /> <strong>Share</strong> in Safari’s toolbar.
          </li>
          <li>
            Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
          </li>
        </ol>
      );
      actions = (
        <Button variant="primary" size="sm" onClick={dismiss}>
          Got it
        </Button>
      );
      break;
    case 'install':
      eyebrow = os === 'mac' ? 'On your Mac' : 'Install PlayzAnime';
      title = 'Open PlayzAnime like an app';
      body = <p className="update-note">Its own window and a shortcut on your desktop or dock. It still needs an internet connection.</p>;
      actions = (
        <>
          <Button variant="primary" size="sm" icon="downloads" onClick={() => void install()}>
            Install
          </Button>
          <Button variant="quiet" size="sm" onClick={dismiss}>
            Not now
          </Button>
        </>
      );
      break;
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          className="update-toast"
          role="status"
          aria-label={eyebrow}
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="update-head">
            <span className="update-eyebrow">{eyebrow}</span>
            <button type="button" className="update-close" onClick={dismiss} aria-label="Dismiss">
              <Icon name="close" size={15} />
            </button>
          </div>
          <p className="update-title">{title}</p>
          {body}
          {points.length > 0 && (
            <ul className="update-points">
              {points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="update-actions">{actions}</div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
