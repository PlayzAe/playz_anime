import { useState, type ReactNode } from 'react';
import type { Media } from '../shared/types';
import { Icon, type IconName } from '../renderer/components/Icon';
import { Logo } from '../renderer/components/Logo';
import { Img } from '../renderer/components/Media';
import { Avatar } from '../renderer/components/Profile';
import { Sheet } from '../renderer/components/Sheet';
import { episodesLabel, formatLabel, isManga, mangaKind, mediaPath, posterOf, scoreLabel, titleOf } from '../renderer/lib/format';
import { detectOS, isStandalone, promptInstall, useCanInstall } from '../renderer/lib/install';
import { canGoBack, goBack, Link, navigate } from '../renderer/lib/router';
import { useApp } from '../renderer/lib/store';

/*
 * The phone layout's building blocks, ported from the Android app's ui/kit.dart:
 * TabTopBar, SectionHeader, Shelf, PosterCard, Tag, PzBtn, RoundIcon, StatePanel.
 */

export const back = () => (canGoBack() ? goBack() : navigate('/'));

export const posterMeta = (m: Media) => [isManga(m) ? mangaKind(m) : formatLabel(m.format), episodesLabel(m), m.seasonYear ? String(m.seasonYear) : null].filter(Boolean).join(' · ');

/** Small "Install" pill: Chrome and Edge show their own prompt; iPhone and others get the steps. */
export function InstallButton() {
  const canPrompt = useCanInstall();
  const [help, setHelp] = useState(false);
  if (isStandalone()) return null;
  const ios = detectOS() === 'ios';
  return (
    <>
      <button type="button" className="m-install" aria-label="Add PlayzAnime to your home screen" onClick={() => (canPrompt ? void promptInstall() : setHelp(true))}>
        <Icon name="phone" size={15} />
        <span>Install</span>
      </button>
      <Sheet open={help} onClose={() => setHelp(false)} title="Add to your home screen">
        <div className="m-install-help">
          <p>PlayzAnime opens full screen from an icon on your home screen, like an app. It still needs an internet connection.</p>
          {ios ? (
            <ol>
              <li>
                Tap <Icon name="share" size={15} /> <strong>Share</strong> in Safari’s toolbar.
              </li>
              <li>
                Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
              </li>
            </ol>
          ) : (
            <ol>
              <li>
                Open your browser’s menu (<strong>⋮</strong> at the top or bottom).
              </li>
              <li>
                Choose <strong>Add to Home screen</strong> or <strong>Install app</strong>.
              </li>
            </ol>
          )}
          <p className="faint">Want downloads? Those are in the Android and Windows apps.</p>
        </div>
      </Sheet>
    </>
  );
}

/** TabTopBar: logo and title, Install, search, profile. */
export function TopBar({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  const { profile } = useApp();
  return (
    <header className="m-top">
      <Link to="/" className="m-top-logo" aria-label="PlayzAnime home">
        <Logo size={30} />
      </Link>
      <div className="m-top-titles">
        <span className="m-top-title display">{title}</span>
        {subtitle && <span className="m-top-sub">{subtitle}</span>}
      </div>
      <InstallButton />
      <Link to="/discover" className="m-search-pill" aria-label="Search">
        <Icon name="search" size={16} />
      </Link>
      <Link to="/profiles" className="m-avatar" aria-label="Profiles">
        <Avatar profile={profile} size={32} own />
      </Link>
    </header>
  );
}

export function SectionHeader({ title, subtitle, action, onAction }: { title: ReactNode; subtitle?: ReactNode; action?: string | null; onAction?: () => void }) {
  return (
    <header className="m-sh">
      <div className="m-sh-text">
        <h2 className="m-sh-title">{title}</h2>
        {subtitle && <p className="m-sh-sub">{subtitle}</p>}
      </div>
      {action && (
        <button type="button" className="m-sh-action" onClick={onAction}>
          {action}
          <Icon name="arrowRight" size={14} />
        </button>
      )}
    </header>
  );
}

/** Horizontal shelf of fixed-width items (118 wide, 12 apart, like the app). */
export function Shelf({ children, width = 118, gap = 12 }: { children: ReactNode; width?: number; gap?: number }) {
  return (
    <div className="m-shelf" style={{ ['--w' as string]: `${width}px`, ['--gap' as string]: `${gap}px` }}>
      {children}
    </div>
  );
}

export function Tag({ children, icon }: { children: ReactNode; icon?: IconName }) {
  return (
    <span className="m-tag">
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}

/** Poster card: 2:3 cover with the score, title, one meta line. */
export function PosterCard({ media, badge, meta, to }: { media: Media; badge?: ReactNode; meta?: ReactNode; to?: string }) {
  const { settings } = useApp();
  const score = scoreLabel(media.averageScore);
  return (
    <Link to={to ?? mediaPath(media)} className="m-card">
      <span className="m-card-frame">
        <Img src={posterOf(media, settings.dataSaver)} color={media.coverImage?.color} />
        {score && (
          <span className="m-card-score">
            <Tag icon="bolt">{score}</Tag>
          </span>
        )}
        {badge && (
          <span className="m-card-badge">
            <Tag>{badge}</Tag>
          </span>
        )}
      </span>
      <span className="m-card-title clamp-2">{titleOf(media, settings.titleLanguage)}</span>
      <span className="m-card-meta clamp-1">{meta ?? posterMeta(media)}</span>
    </Link>
  );
}

export function PosterSkeletons({ count = 5 }: { count?: number }) {
  return (
    <Shelf>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="m-card" aria-hidden="true">
          <span className="m-card-frame skeleton" />
          <span className="m-skel skeleton" />
        </span>
      ))}
    </Shelf>
  );
}

/** PzBtn: primary (accent) or quiet, full or compact. */
export function Btn({ children, icon, primary, compact, onClick, disabled, className = '' }: { children: ReactNode; icon?: IconName; primary?: boolean; compact?: boolean; onClick?: () => void; disabled?: boolean; className?: string }) {
  return (
    <button type="button" className={`m-btn ${primary ? 'is-primary' : ''} ${compact ? 'is-compact' : ''} ${className}`} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} size={compact ? 15 : 17} />}
      <span>{children}</span>
    </button>
  );
}

export function RoundIcon({ icon, label, onClick, disabled, bare, className = '' }: { icon: IconName; label: string; onClick?: () => void; disabled?: boolean; bare?: boolean; className?: string }) {
  return (
    <button type="button" className={`m-round ${bare ? 'is-bare' : ''} ${className}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={19} />
    </button>
  );
}

export function ProgressLine({ value, height = 3 }: { value: number; height?: number }) {
  return (
    <span className="m-progress" style={{ height }}>
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  );
}

export function Chip({ children, on, onClick }: { children: ReactNode; on?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`m-chip ${on ? 'is-on' : ''}`} onClick={onClick} aria-pressed={on}>
      {children}
    </button>
  );
}

export function StatePanel({ title, message, icon = 'info', action, onAction }: { title: string; message?: ReactNode; icon?: IconName; action?: string; onAction?: () => void }) {
  return (
    <div className="m-state">
      <span className="m-state-icon">
        <Icon name={icon} size={24} />
      </span>
      <strong>{title}</strong>
      {message && <p>{message}</p>}
      {action && (
        <Btn compact icon="refresh" onClick={onAction}>
          {action}
        </Btn>
      )}
    </div>
  );
}

export function Skeleton({ height, width, radius = 8 }: { height: number; width?: number | string; radius?: number }) {
  return <span className="skeleton m-skeleton" style={{ height, width: width ?? '100%', borderRadius: radius }} />;
}

/** Detail pages float a round back button over their banner. */
export function FloatingBack() {
  return (
    <button type="button" className="m-float-back" aria-label="Back" onClick={back}>
      <Icon name="arrowLeft" size={20} />
    </button>
  );
}

export const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Romance', 'Sci-Fi', 'Slice of Life', 'Mystery', 'Sports', 'Supernatural', 'Horror', 'Psychological', 'Mecha', 'Thriller'];
