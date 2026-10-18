import { useMemo, useState } from 'react';
import type { ListStatus } from '../shared/types';
import { Icon } from '../renderer/components/Icon';
import { statusLabel } from '../renderer/components/ListButton';
import { fromSnapshot, Img } from '../renderer/components/Media';
import { useLoader } from '../renderer/lib/data';
import { clock, coverOf, relativeTime, titleOf } from '../renderer/lib/format';
import { Link, navigate } from '../renderer/lib/router';
import { useApp } from '../renderer/lib/store';
import { readPathOf } from './MangaHome';
import { Chip, PosterCard, Skeleton, StatePanel } from './kit';

const api = () => window.playzanime;
const DAY = 86_400_000;

/** Schedule: this week day by day, everything airing or only your list. */
export function MSchedule() {
  const { settings, library } = useApp();
  const start = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() - ((d.getDay() + 6) % 7) * DAY; // Monday
  }, []);
  const [day, setDay] = useState(() => Math.floor((Date.now() - start) / DAY));
  const [mine, setMine] = useState(false);
  const week = useLoader(`m-week:${start}`, () => api().anilist.schedule(start / 1000, (start + 7 * DAY) / 1000));
  const ids = useMemo(() => new Set(library.map((e) => e.media.id)), [library]);
  const from = start + day * DAY;
  const items = (week.data ?? []).filter((a) => a.airingAt * 1000 >= from && a.airingAt * 1000 < from + DAY && (!mine || ids.has(a.media.id))).sort((a, b) => a.airingAt - b.airingAt);

  return (
    <div className="m-page">
      <div className="m-days">
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date(start + i * DAY);
          const today = Math.floor((Date.now() - start) / DAY) === i;
          return (
            <button key={i} type="button" className={`m-day ${i === day ? 'is-on' : ''} ${today ? 'is-today' : ''}`} onClick={() => setDay(i)}>
              <span>{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <strong className="num">{d.getDate()}</strong>
            </button>
          );
        })}
      </div>
      <div className="m-filters">
        <Chip on={!mine} onClick={() => setMine(false)}>
          Everything airing
        </Chip>
        <Chip on={mine} onClick={() => setMine(true)}>
          My list
        </Chip>
      </div>
      {week.error && !week.data ? (
        <StatePanel title="Couldn’t load the schedule" message={week.error.message} icon="alert" action="Try again" onAction={week.reload} />
      ) : !week.data ? (
        <div className="m-pad m-stack">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={72} />
          ))}
        </div>
      ) : !items.length ? (
        <StatePanel title={mine ? 'Nothing from your list today' : 'Nothing airs this day'} icon="schedule" />
      ) : (
        <div className="m-rows">
          {items.map((a) => {
            const aired = a.airingAt * 1000 <= Date.now();
            return (
              <Link key={a.id} to={aired ? `/watch/${a.media.id}/${a.episode}` : `/anime/${a.media.id}`} className={`m-row ${aired ? '' : 'is-upcoming'}`}>
                <span className="m-row-time num">{new Date(a.airingAt * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="m-row-thumb">
                  <Img src={a.media.coverImage?.medium ?? coverOf(a.media)} color={a.media.coverImage?.color} />
                </span>
                <span className="m-row-text">
                  <span className="m-row-title clamp-2">{titleOf(a.media, settings.titleLanguage)}</span>
                  <span className="m-row-sub num">
                    Episode {a.episode}
                    {a.media.episodes ? ` of ${a.media.episodes}` : ''}
                    {ids.has(a.media.id) && ' · In your list'}
                  </span>
                </span>
                <Icon name={aired ? 'play' : 'clock'} size={16} />
              </Link>
            );
          })}
        </div>
      )}
      <div className="m-end" />
    </div>
  );
}

type Tab = ListStatus | 'history';
const TABS: Tab[] = ['watching', 'planning', 'completed', 'paused', 'dropped', 'history'];

/** Library: your lists by status, and what you watched and read lately. */
export function MLibrary() {
  const { library, history, reading, removeHistory, removeReading } = useApp();
  const [tab, setTab] = useState<Tab>('watching');
  const [kind, setKind] = useState<'all' | 'ANIME' | 'MANGA'>('all');
  const entries = library.filter((e) => (tab === 'history' ? false : e.status === tab) && (kind === 'all' || e.media.type === kind));
  const activity = [
    ...(kind !== 'MANGA' ? history.map((h) => ({ key: `w${h.media.id}`, at: h.updatedAt, media: h.media, line: `Episode ${h.episode} · ${clock(Math.max(0, h.duration - h.position))} left`, to: `/watch/${h.media.id}/${h.episode}`, remove: () => removeHistory(h.media.id) })) : []),
    ...(kind !== 'ANIME' ? reading.map((r) => ({ key: `r${r.media.id}`, at: r.updatedAt, media: r.media, line: `Chapter ${r.chapterNumber ?? '—'} · page ${r.page}/${r.pages}`, to: readPathOf(r), remove: () => removeReading(r.media.id) })) : []),
  ].sort((a, b) => b.at - a.at);

  return (
    <div className="m-page">
      <div className="m-filters">
        {TABS.map((t) => (
          <Chip key={t} on={t === tab} onClick={() => setTab(t)}>
            {t === 'history' ? 'History' : statusLabel(t, kind === 'MANGA')}
          </Chip>
        ))}
      </div>
      <div className="m-filters">
        {(['all', 'ANIME', 'MANGA'] as const).map((k) => (
          <Chip key={k} on={k === kind} onClick={() => setKind(k)}>
            {k === 'all' ? 'Everything' : k === 'ANIME' ? 'Anime' : 'Manga'}
          </Chip>
        ))}
      </div>

      {tab === 'history' ? (
        activity.length === 0 ? (
          <StatePanel title="No history yet" message="What you watch and read shows up here." icon="history" />
        ) : (
          <div className="m-rows">
            {activity.map((a) => (
              <div key={a.key} className="m-row">
                <Link to={a.to} className="m-row-main">
                  <span className="m-row-thumb">
                    <Img src={a.media.cover} color={a.media.color} />
                  </span>
                  <span className="m-row-text">
                    <span className="m-row-title clamp-2">{a.media.title}</span>
                    <span className="m-row-sub num">
                      {a.line} · {relativeTime(a.at)}
                    </span>
                  </span>
                </Link>
                <button type="button" className="m-round is-bare" aria-label="Remove" onClick={() => void a.remove()}>
                  <Icon name="close" size={16} />
                </button>
              </div>
            ))}
          </div>
        )
      ) : entries.length === 0 ? (
        <StatePanel title="Nothing here yet" message="Use “Add to list” on any show or manga to save it." icon="library" action="Find something" onAction={() => navigate('/discover')} />
      ) : (
        <div className="m-grid">
          {entries.map((e) => (
            <PosterCard key={e.media.id} media={fromSnapshot(e.media)} meta={e.media.type === 'MANGA' ? 'Manga' : 'Anime'} />
          ))}
        </div>
      )}
      <div className="m-end" />
    </div>
  );
}
