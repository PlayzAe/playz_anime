import type { ReactNode } from 'react';
import type { Media } from '../shared/types';
import { Icon, type IconName } from '../renderer/components/Icon';
import { Logo } from '../renderer/components/Logo';
import { Img } from '../renderer/components/Media';
import { Avatar } from '../renderer/components/Profile';
import { mediaPath, posterOf, titleOf } from '../renderer/lib/format';
import { canGoBack, goBack, Link, navigate } from '../renderer/lib/router';
import { useApp } from '../renderer/lib/store';

/*
 * The phone layout's building blocks, after the Android app's ui/kit.dart:
 * a top bar per tab, section headers, swipeable rails and poster tiles.
 */

export const back = () => (canGoBack() ? goBack() : navigate('/'));

/** Tab pages: logo and title, search, profile. Pushed pages: a back arrow instead of the logo. */
export function TopBar({ title, subtitle, pushed, overlay }: { title?: ReactNode; subtitle?: ReactNode; pushed?: boolean; overlay?: boolean }) {
  const { profile } = useApp();
  return (
    <header className={`m-top ${overlay ? 'is-overlay' : ''}`}>
      {pushed ? (
        <button type="button" className="m-icon-btn" aria-label="Back" onClick={back}>
          <Icon name="arrowLeft" size={21} />
        </button>
      ) : (
        <Link to="/" className="m-top-logo" aria-label="PlayzAnime home">
          <Logo size={30} />
        </Link>
      )}
      <div className="m-top-titles">
        {title && <span className="m-top-title display">{title}</span>}
        {subtitle && <span className="m-top-sub">{subtitle}</span>}
      </div>
      <Link to="/discover" className="m-search-pill" aria-label="Search">
        <Icon name="search" size={16} />
        <span>Search</span>
      </Link>
      <Link to="/profiles" className="m-avatar" aria-label="Profiles">
        <Avatar profile={profile} size={32} own />
      </Link>
    </header>
  );
}

export function Section({ title, subtitle, action, onAction, children, flush }: { title: ReactNode; subtitle?: ReactNode; action?: string; onAction?: () => void; children: ReactNode; flush?: boolean }) {
  return (
    <section className={`m-section ${flush ? 'is-flush' : ''}`}>
      <header className="m-section-head">
        <div className="m-section-titles">
          <h2 className="m-section-title">{title}</h2>
          {subtitle && <p className="m-section-sub">{subtitle}</p>}
        </div>
        {action && (
          <button type="button" className="m-section-action" onClick={onAction}>
            {action}
            <Icon name="chevronRight" size={15} />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

/** A row you swipe sideways. */
export function Rail({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={`m-rail ${wide ? 'is-wide' : ''}`}>{children}</div>;
}

export function Tile({ media, badge, meta }: { media: Media; badge?: ReactNode; meta?: ReactNode }) {
  const { settings } = useApp();
  const title = titleOf(media, settings.titleLanguage);
  return (
    <Link to={mediaPath(media)} className="m-tile" title={title}>
      <span className="m-tile-frame">
        <Img src={posterOf(media, settings.dataSaver)} color={media.coverImage?.color} />
        {badge && <span className="m-tile-badge num">{badge}</span>}
      </span>
      <span className="m-tile-title clamp-2">{title}</span>
      {meta && <span className="m-tile-meta num">{meta}</span>}
    </Link>
  );
}

export function TileSkeletons({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="m-tile is-skeleton" aria-hidden="true">
          <span className="m-tile-frame skeleton" />
          <span className="m-skel-line skeleton" />
        </span>
      ))}
    </>
  );
}

export function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="m-chips" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={`m-chip ${o.value === value ? 'is-on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function RoundButton({ icon, label, onClick, disabled, active }: { icon: IconName; label: string; onClick?: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" className={`m-round ${active ? 'is-on' : ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={19} />
    </button>
  );
}

export function Notice({ icon = 'info', children }: { icon?: IconName; children: ReactNode }) {
  return (
    <p className="m-notice">
      <Icon name={icon} size={16} />
      <span>{children}</span>
    </p>
  );
}
