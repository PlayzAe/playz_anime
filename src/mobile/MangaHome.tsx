import { useMemo, useState } from 'react';
import type { ReadingEntry } from '../shared/types';
import { Img } from '../renderer/components/Media';
import { Sheet, SheetOption } from '../renderer/components/Sheet';
import { useLoader } from '../renderer/lib/data';
import { coverOf, mangaKind, mediaYear, relativeTime, scoreLabel, titleOf } from '../renderer/lib/format';
import { navigate, withQuery } from '../renderer/lib/router';
import { useApp } from '../renderer/lib/store';
import { HeroCarousel, type Slide } from './Hero';
import { Posters } from './Home';
import { Chip, PosterSkeletons, ProgressLine, SectionHeader, Shelf, StatePanel } from './kit';

const api = () => window.playzanime;
const GENRES = ['Action', 'Romance', 'Fantasy', 'Comedy', 'Drama', 'Slice of Life', 'Psychological', 'Horror', 'Mystery', 'Sports', 'Supernatural', 'Sci-Fi'];
export const readPathOf = (r: ReadingEntry) => withQuery(`/read/${r.media.id}/${encodeURIComponent(r.chapterId)}`, { page: r.page > 1 ? r.page : null });

/** Manga tab: hero, continue reading, trending, manhwa, genres, favourites. */
export function MMangaHome() {
  const { settings, reading } = useApp();
  const feed = useLoader('mangaHome', () => api().anilist.mangaHome());
  const lang = settings.titleLanguage;

  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    const r = reading[0];
    if (r) {
      out.push({
        key: `r-${r.media.id}`,
        kicker: `Continue reading · ${r.chapterNumber ? `Chapter ${r.chapterNumber}` : 'Oneshot'}`,
        kickerIcon: 'history',
        title: r.media.title,
        native: r.media.native,
        art: r.media.banner ?? r.media.cover,
        meta: [`Page ${r.page} of ${r.pages}`, relativeTime(r.updatedAt)],
        progress: r.pages ? r.page / r.pages : null,
        primary: { label: `Resume ch. ${r.chapterNumber ?? ''}`, icon: 'manga', run: () => navigate(readPathOf(r)) },
        secondary: { label: 'Chapters', run: () => navigate(`/manga/${r.media.id}`) },
      });
    }
    (feed.data?.trending ?? []).slice(0, r ? 4 : 5).forEach((m, i) =>
      out.push({
        key: `t-${m.id}`,
        kicker: i === 0 ? 'No. 1 trending' : `Trending ${mangaKind(m)?.toLowerCase() ?? 'manga'}`,
        title: titleOf(m, lang),
        native: m.title.native,
        art: m.bannerImage ?? coverOf(m),
        meta: [mangaKind(m), mediaYear(m) && String(mediaYear(m)), m.chapters ? `${m.chapters} chapters` : m.status === 'RELEASING' ? 'Ongoing' : null, scoreLabel(m.averageScore) && `Score ${scoreLabel(m.averageScore)}`],
        primary: { label: 'Start reading', icon: 'manga', run: () => navigate(`/manga/${m.id}`) },
        secondary: { label: 'Details', run: () => navigate(`/manga/${m.id}`) },
      }),
    );
    return out;
  }, [reading, feed.data, lang]);

  if (feed.error && !feed.data) return <StatePanel title="Couldn’t load manga" message={feed.error.message} icon="alert" action="Try again" onAction={feed.reload} />;

  return (
    <div className="m-page">
      <HeroCarousel slides={slides} />

      {reading.length > 0 && (
        <>
          <SectionHeader title="Continue reading" />
          <ContinueReading items={reading.slice(0, 12)} />
        </>
      )}

      <SectionHeader title="Trending now" subtitle="What readers are on this week" />
      {feed.loading ? <PosterSkeletons /> : <Posters list={feed.data?.trending ?? []} />}

      <SectionHeader title="Popular manhwa" subtitle="Korean webtoons and full-colour series" action="More" onAction={() => navigate(withQuery('/discover', { type: 'MANGA', country: 'KR' }))} />
      {feed.loading ? <PosterSkeletons /> : <Posters list={feed.data?.manhwa ?? []} />}

      <SectionHeader title="Browse by genre" />
      <div className="m-wrap">
        {GENRES.map((g) => (
          <Chip key={g} onClick={() => navigate(withQuery('/discover', { type: 'MANGA', genre: g, sort: 'POPULARITY_DESC' }))}>
            {g}
          </Chip>
        ))}
      </div>

      <SectionHeader title="All-time favourites" subtitle="Manga with the best AniList scores" />
      {feed.loading ? <PosterSkeletons /> : <Posters list={feed.data?.top ?? []} />}
      <div className="m-end" />
    </div>
  );
}

function ContinueReading({ items }: { items: ReadingEntry[] }) {
  const { removeReading } = useApp();
  const [menu, setMenu] = useState<ReadingEntry | null>(null);
  return (
    <>
      <Shelf>
        {items.map((r) => (
          <button
            key={r.media.id}
            type="button"
            className="m-card"
            onClick={() => navigate(readPathOf(r))}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(r);
            }}
          >
            <span className="m-card-frame">
              <Img src={r.media.cover} color={r.media.color} />
              <span className="m-card-badge">
                <span className="m-tag num">Ch. {r.chapterNumber ?? '—'}</span>
              </span>
              <span className="m-wide-bar">
                <ProgressLine value={r.pages ? r.page / r.pages : 0} />
              </span>
            </span>
            <span className="m-card-title clamp-2">{r.media.title}</span>
            <span className="m-card-meta num">
              Page {r.page}/{r.pages}
            </span>
          </button>
        ))}
      </Shelf>
      <Sheet open={menu !== null} onClose={() => setMenu(null)} title={menu?.media.title}>
        <SheetOption label="Manga details" icon="info" onClick={() => (setMenu(null), navigate(`/manga/${menu!.media.id}`))} />
        <SheetOption label="Remove from Continue reading" icon="close" danger onClick={() => (setMenu(null), void removeReading(menu!.media.id))} />
      </Sheet>
    </>
  );
}
