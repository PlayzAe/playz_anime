import { useMemo, useRef, useState } from 'react';
import type { HistoryEntry, Media } from '../shared/types';
import { Img } from '../renderer/components/Media';
import { Sheet, SheetOption } from '../renderer/components/Sheet';
import { useLoader } from '../renderer/lib/data';
import { clock, coverOf, episodesLabel, formatLabel, mediaYear, posterOf, relativeTime, scoreLabel, seasonName, titleOf } from '../renderer/lib/format';
import { Link, navigate, withQuery } from '../renderer/lib/router';
import { useApp } from '../renderer/lib/store';
import { HeroCarousel, type Slide } from './Hero';
import { Chip, GENRES, PosterCard, PosterSkeletons, ProgressLine, SectionHeader, Shelf, StatePanel } from './kit';

const api = () => window.playzanime;

/** Anime tab: hero, continue watching, aired recently, top 10, this season, genres, favourites. */
export function MHome() {
  const { settings, history } = useApp();
  const feed = useLoader('home', () => api().anilist.home());
  const hour = Math.floor(Date.now() / 3_600_000);
  const aired = useLoader(`aired:${hour}`, () => {
    const now = Math.floor(Date.now() / 1000);
    return api().anilist.schedule(now - 36 * 3600, now);
  });
  const lang = settings.titleLanguage;

  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    const h = history[0];
    if (h) {
      out.push({
        key: `c-${h.media.id}`,
        kicker: `Continue watching · Episode ${h.episode}`,
        kickerIcon: 'history',
        title: h.media.title,
        native: h.media.native,
        art: h.media.banner ?? h.thumbnail ?? h.media.cover,
        meta: [`${clock(Math.max(0, h.duration - h.position))} left`, h.audio.toUpperCase()],
        progress: h.duration ? h.position / h.duration : null,
        primary: { label: `Resume E${h.episode}`, run: () => navigate(`/watch/${h.media.id}/${h.episode}`) },
        secondary: { label: 'Episodes', run: () => navigate(`/anime/${h.media.id}`) },
      });
    }
    (feed.data?.trending ?? []).slice(0, h ? 4 : 5).forEach((m, i) =>
      out.push({
        key: `t-${m.id}`,
        kicker: `No. ${i + 1} trending this week`,
        title: titleOf(m, lang),
        native: m.title.native,
        art: m.bannerImage ?? coverOf(m),
        meta: [formatLabel(m.format), mediaYear(m) && String(mediaYear(m)), episodesLabel(m), scoreLabel(m.averageScore) && `Score ${scoreLabel(m.averageScore)}`],
        primary: { label: m.format === 'MOVIE' ? 'Play movie' : 'Play E1', run: () => navigate(`/watch/${m.id}/1`) },
        secondary: { label: 'Details', run: () => navigate(`/anime/${m.id}`) },
      }),
    );
    return out;
  }, [history, feed.data, lang]);

  if (feed.error && !feed.data) return <StatePanel title="Couldn’t load the anime catalogue" message={feed.error.message} icon="alert" action="Try again" onAction={feed.reload} />;

  const season = feed.data?.seasonLabel;
  const airedItems = (aired.data ?? []).filter((a) => (a.media.popularity ?? 0) > 8000).sort((a, b) => b.airingAt - a.airingAt);

  return (
    <div className="m-page">
      <HeroCarousel slides={slides} />

      {history.length > 0 && (
        <>
          <SectionHeader title="Continue watching" />
          <ContinueShelf items={history.slice(0, 12)} />
        </>
      )}

      {airedItems.length > 0 && (
        <>
          <SectionHeader title="Aired recently" subtitle="New episodes from the last day and a half" action="Schedule" onAction={() => navigate('/schedule')} />
          <Shelf>
            {airedItems.map((a) => (
              <PosterCard
                key={a.id}
                media={a.media}
                badge={`E${a.episode}`}
                meta={relativeTime(a.airingAt * 1000)}
                // New to the show? Its page, so it starts from episode 1, not the latest.
                to={history.some((h) => h.media.id === a.media.id) ? `/watch/${a.media.id}/${a.episode}` : `/anime/${a.media.id}`}
              />
            ))}
          </Shelf>
        </>
      )}

      <SectionHeader title="Top 10 this week" subtitle="Ranked by AniList activity over the last few days" />
      {feed.loading ? (
        <PosterSkeletons />
      ) : (
        <Shelf width={150} gap={4}>
          {(feed.data?.trending ?? []).slice(0, 10).map((m, i) => (
            <Ranked key={m.id} media={m} rank={i + 1} />
          ))}
        </Shelf>
      )}

      <SectionHeader
        title={season ? `${seasonName(season.season)} ${season.year}` : 'This season'}
        subtitle="The most popular shows airing this season"
        action={season ? 'All of it' : null}
        onAction={() => season && navigate(withQuery('/discover', { season: season.season, year: season.year, sort: 'POPULARITY_DESC' }))}
      />
      {feed.loading ? <PosterSkeletons /> : <Posters list={feed.data?.season ?? []} />}

      <SectionHeader title="Browse by genre" />
      <div className="m-wrap">
        {GENRES.map((g) => (
          <Chip key={g} onClick={() => navigate(withQuery('/discover', { genre: g, sort: 'POPULARITY_DESC' }))}>
            {g}
          </Chip>
        ))}
      </div>

      <SectionHeader title="All-time favourites" subtitle="Highest rated on AniList, with enough viewers to count" />
      {feed.loading ? <PosterSkeletons /> : <Posters list={feed.data?.top ?? []} />}
      <div className="m-end" />
    </div>
  );
}

export function Posters({ list }: { list: Media[] }) {
  return (
    <Shelf>
      {list.map((m) => (
        <PosterCard key={m.id} media={m} />
      ))}
    </Shelf>
  );
}

function Ranked({ media, rank }: { media: Media; rank: number }) {
  const { settings } = useApp();
  return (
    <Link to={`/anime/${media.id}`} className="m-ranked">
      <span className="m-ranked-num display" aria-hidden="true">
        {rank}
      </span>
      <span className="m-ranked-card">
        <span className="m-card-frame">
          <Img src={posterOf(media, settings.dataSaver)} color={media.coverImage?.color} />
        </span>
        <span className="m-card-title clamp-1">{titleOf(media, settings.titleLanguage)}</span>
      </span>
    </Link>
  );
}

/** 16:9 cards; hold one for details or to remove it. */
function ContinueShelf({ items }: { items: HistoryEntry[] }) {
  const { removeHistory } = useApp();
  const [menu, setMenu] = useState<HistoryEntry | null>(null);
  const hold = useRef<number | undefined>(undefined);
  const held = useRef(false);
  return (
    <>
      <Shelf width={236}>
        {items.map((h) => (
          <Link
            key={h.media.id}
            to={`/watch/${h.media.id}/${h.episode}`}
            className="m-wide"
            onPointerDown={() => {
              held.current = false;
              hold.current = window.setTimeout(() => {
                held.current = true;
                setMenu(h);
              }, 500);
            }}
            onPointerUp={() => window.clearTimeout(hold.current)}
            onPointerLeave={() => window.clearTimeout(hold.current)}
            onClick={(e) => held.current && e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="m-wide-frame">
              <Img src={h.thumbnail || h.media.banner || h.media.cover} color={h.media.color} />
              <span className="m-wide-ep num">E{h.episode}</span>
              <span className="m-wide-bar">
                <ProgressLine value={h.duration ? h.position / h.duration : 0} />
              </span>
            </span>
            <span className="m-card-title clamp-1">{h.media.title}</span>
            <span className="m-card-meta num">
              {clock(Math.max(0, h.duration - h.position))} left · {relativeTime(h.updatedAt)}
            </span>
          </Link>
        ))}
      </Shelf>
      <Sheet open={menu !== null} onClose={() => setMenu(null)} title={menu?.media.title}>
        <SheetOption label="Series details" icon="info" onClick={() => (setMenu(null), navigate(`/anime/${menu!.media.id}`))} />
        <SheetOption label="Remove from Continue watching" icon="close" danger onClick={() => (setMenu(null), void removeHistory(menu!.media.id))} />
      </Sheet>
    </>
  );
}
