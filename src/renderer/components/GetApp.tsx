import type { ReactNode } from 'react';
import { navigate } from '../lib/router';
import { Button } from './Controls';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';
import { Modal } from './Modal';
import { RELEASES_URL } from '../lib/links';
import './getapp.css';

/*
 * Downloads and offline mode need a real disk, so they live in the Windows app.
 * The Downloads page and every Download button on the web lead here.
 */

export const APP_URL = RELEASES_URL;

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'downloads', title: 'Episodes as MP4', body: 'Subtitles packed in. A download picks up where it stopped and waits out busy hosts.' },
  { icon: 'manga', title: 'Chapters as CBZ', body: 'Every page stored untouched, readable in PlayzAnime or any comic reader.' },
  { icon: 'offline', title: 'Offline mode', body: 'With no internet the app opens on your downloads. They play and read as usual.' },
  { icon: 'keyboard', title: 'Media keys and taskbar', body: 'Play, pause and next episode from your keyboard and the Windows taskbar.' },
];

export const openAppPage = () => void window.playzanime.app.openExternal(APP_URL);

function Features({ compact }: { compact?: boolean }) {
  return (
    <ul className={`getapp-features ${compact ? 'is-compact' : ''}`}>
      {FEATURES.slice(0, compact ? 3 : FEATURES.length).map((f) => (
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

/** The whole page, at /downloads. */
export function GetAppPage() {
  return (
    <div className="page getapp">
      <section className="getapp-hero">
        <div className="getapp-seal" aria-hidden="true">
          <span className="getapp-halo" />
          <Logo size={88} />
        </div>
        <div className="getapp-copy">
          <div className="getapp-eyebrow">PlayzAnime for Windows</div>
          <h1 className="getapp-title display">Downloads live in the Windows app</h1>
          <p className="getapp-sub">
            Here in the browser you stream and read. The Windows app does the same, and also saves episodes and chapters to your PC so they play with no internet at all.
          </p>
          <div className="getapp-actions">
            <Button variant="primary" size="lg" icon="downloads" onClick={openAppPage}>
              Get PlayzAnime for Windows
            </Button>
            <Button variant="ghost" size="lg" onClick={() => navigate('/')}>
              Keep watching here
            </Button>
          </div>
          <p className="getapp-fine">Free, with no ads. Windows 10 and 11.</p>
        </div>
      </section>
      <Features />
    </div>
  );
}

/** What a Download button opens on the web. */
export function GetAppDialog({ open, onClose, what }: { open: boolean; onClose: () => void; what: ReactNode }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Download with the Windows app"
      width={540}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Not now
          </Button>
          <Button
            variant="primary"
            icon="downloads"
            onClick={() => {
              openAppPage();
              onClose();
            }}
          >
            Get the Windows app
          </Button>
        </>
      }
    >
      <div className="getapp-dialog">
        <Logo size={44} />
        <p>
          Saving {what} for offline viewing needs PlayzAnime for Windows. Your browser can stream it right now; the app can keep it.
        </p>
      </div>
      <Features compact />
    </Modal>
  );
}
