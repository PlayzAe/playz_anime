import { useEffect, useRef, useState } from 'react';
import type { BrowseFilters, Media, MediaSeason, MediaType, SortKey } from '../shared/types';
import { Icon } from '../renderer/components/Icon';
import { Sheet, SheetOption } from '../renderer/components/Sheet';
import { seasonName } from '../renderer/lib/format';
import { navigate, useRoute, withQuery } from '../renderer/lib/router';
import { back, Btn, Chip, GENRES, PosterCard, Skeleton, StatePanel } from './kit';

const api = () => window.playzanime;
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'SEARCH_MATCH', label: 'Best match' },
  { value: 'TRENDING_DESC', label: 'Trending' },
  { value: 'POPULARITY_DESC', label: 'Most popular' },
  { value: 'SCORE_DESC', label: 'Highest rated' },
  { value: 'START_DATE_DESC', label: 'Newest' },
];

/** Search and browse in one: a search field, filters as chips, results three across. */
export function MSearch() {
  const route = useRoute();
  const q = route.query;
  const type = (q.get('type') as MediaType) || 'ANIME';
  const genre = q.get('genre');
  const season = q.get('season') as MediaSeason | null;
  const year = q.get('year') ? Number(q.get('year')) : null;
  const country = q.get('country');
  const search = q.get('q') ?? '';
  const sort = (q.get('sort') as SortKey) || (search ? 'SEARCH_MATCH' : 'TRENDING_DESC');

  const [text, setText] = useState(search);
  const [items, setItems] = useState<Media[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [sortSheet, setSortSheet] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const set = (patch: Record<string, string | number | null>) => {
    const next: Record<string, string | number | null> = { q: search || null, type: type === 'ANIME' ? null : type, genre, season, year, country, sort: q.get('sort'), ...patch };
    setPage(1);
    navigate(withQuery('/discover', next), { replace: true });
  };

  // Typing settles for a moment before it searches.
  useEffect(() => {
    if (text === search) return;
    const t = window.setTimeout(() => set({ q: text.trim() || null }), 350);
    return () => window.clearTimeout(t);
  }, [text]);

  useEffect(() => {
    if (!search && !genre && !season && !country) input.current?.focus();
  }, []);

  const key = `${type}|${search}|${genre}|${season}|${year}|${country}|${sort}`;
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError(null);
    const filters: BrowseFilters = { type, page, perPage: 24, sort: search ? sort : sort === 'SEARCH_MATCH' ? 'TRENDING_DESC' : sort, search: search || null, genres: genre ? [genre] : undefined, season, year, country };
    api()
      .anilist.browse(filters)
      .then((r) => {
        if (!live) return;
        setItems((prev) => (page === 1 ? r.items : [...prev, ...r.items]));
        setMore(r.hasNextPage);
      })
      .catch((e: Error) => live && setError(e))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [key, page]);

  return (
    <div className="m-page m-search">
      <div className="m-search-bar">
        <button type="button" className="m-round is-bare" aria-label="Back" onClick={back}>
          <Icon name="arrowLeft" size={20} />
        </button>
        <label className="m-search-field">
          <Icon name="search" size={17} />
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={type === 'MANGA' ? 'Search manga, manhwa, manhua' : 'Search anime'} enterKeyHint="search" aria-label="Search" />
          {text && (
            <button type="button" aria-label="Clear" onClick={() => setText('')}>
              <Icon name="close" size={16} />
            </button>
          )}
        </label>
      </div>

      <div className="m-filters">
        <Chip on={type === 'ANIME'} onClick={() => set({ type: null, country: null })}>
          Anime
        </Chip>
        <Chip on={type === 'MANGA'} onClick={() => set({ type: 'MANGA', season: null, year: null })}>
          Manga
        </Chip>
        <Chip onClick={() => setSortSheet(true)}>
          {SORTS.find((s) => s.value === sort)?.label ?? 'Sort'} <Icon name="chevronDown" size={13} />
        </Chip>
        {genre && (
          <Chip on onClick={() => set({ genre: null })}>
            {genre} <Icon name="close" size={12} />
          </Chip>
        )}
        {season && (
          <Chip on onClick={() => set({ season: null, year: null })}>
            {seasonName(season)} {year} <Icon name="close" size={12} />
          </Chip>
        )}
        {country && (
          <Chip on onClick={() => set({ country: null })}>
            {country === 'KR' ? 'Manhwa' : country === 'CN' ? 'Manhua' : 'Japan'} <Icon name="close" size={12} />
          </Chip>
        )}
      </div>

      {!genre && !search && (
        <div className="m-filters is-genres">
          {GENRES.map((g) => (
            <Chip key={g} onClick={() => set({ genre: g })}>
              {g}
            </Chip>
          ))}
        </div>
      )}

      {search && <p className="m-results-for">Results for “{search}”</p>}

      {error && !items.length ? (
        <StatePanel title="Search failed" message={error.message} icon="alert" action="Try again" onAction={() => setPage(1)} />
      ) : !busy && !items.length ? (
        <StatePanel title="Nothing found" message="Try fewer words, or another spelling." icon="search" />
      ) : (
        <div className="m-grid">
          {items.map((m) => (
            <PosterCard key={m.id} media={m} />
          ))}
          {busy && Array.from({ length: 6 }, (_, i) => <Skeleton key={`s${i}`} height={200} />)}
        </div>
      )}
      {more && !busy && (
        <div className="m-pad">
          <Btn className="is-grow" onClick={() => setPage((p) => p + 1)}>
            Load more
          </Btn>
        </div>
      )}
      <div className="m-end" />

      <Sheet open={sortSheet} onClose={() => setSortSheet(false)} title="Sort by">
        {SORTS.filter((s) => search || s.value !== 'SEARCH_MATCH').map((s) => (
          <SheetOption
            key={s.value}
            label={s.label}
            selected={s.value === sort}
            onClick={() => {
              setSortSheet(false);
              set({ sort: s.value });
            }}
          />
        ))}
      </Sheet>
    </div>
  );
}
