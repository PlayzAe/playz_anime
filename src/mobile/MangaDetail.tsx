import { useState } from 'react';
import { providerName, type Chapter, type MangaProviderId } from '../shared/types';
import { Icon } from '../renderer/components/Icon';
import { Sheet, SheetOption } from '../renderer/components/Sheet';
import { useLoader } from '../renderer/lib/data';
import { formatLabel, mangaKind, plainText, relativeTime, snapshot, statusLabel as mediaStatus } from '../renderer/lib/format';
import { navigate, withQuery } from '../renderer/lib/router';
import { useApp, useReadChapters } from '../renderer/lib/store';
import { Btn, SectionHeader, Skeleton, StatePanel, Tag } from './kit';
import { DetailHead, LibraryButton, RelatedShelves, Synopsis } from './Series';

const api = () => window.playzanime;
const readPath = (mediaId: number, c: Chapter, page?: number) => withQuery(`/read/${mediaId}/${encodeURIComponent(c.id)}`, { page: page && page > 1 ? page : null });
const chapterName = (c: Chapter) => (c.number ? `Chapter ${c.number}` : c.title || 'Oneshot');

export function MMangaDetail({ id }: { id: number }) {
  const { settings, readingFor } = useApp();
  const media = useLoader(`media:${id}`, () => api().anilist.media(id), 15 * 60_000);
  const [provider, setProvider] = useState<MangaProviderId | null>(null);
  const chapters = useLoader(`chapters:${id}:${provider ?? 'auto'}`, () => api().manga.chapters(id, provider), 15 * 60_000);
  const { read, setRead } = useReadChapters(id);
  const [newestFirst, setNewestFirst] = useState(true);
  const [limit, setLimit] = useState(100);
  const [sources, setSources] = useState(false);
  const [find, setFind] = useState('');

  if (media.error && !media.data) return <StatePanel title="Couldn’t load this title" message={media.error.message} icon="alert" action="Try again" onAction={media.reload} />;
  if (!media.data)
    return (
      <div className="m-page m-pad">
        <Skeleton height={300} />
        <Skeleton height={48} />
      </div>
    );

  const m = media.data;
  const snap = snapshot(m, settings.titleLanguage);
  const list = chapters.data;
  const all = list?.chapters ?? [];
  const readable = all.filter((c) => !c.externalUrl);
  const progress = readingFor(id);
  const resume = progress && readable.find((c) => c.id === progress.chapterId);
  // Sources list oldest first; the reading order is ascending.
  const ascending = [...readable].sort((a, b) => Number(a.number ?? 0) - Number(b.number ?? 0));
  const firstUnread = ascending.find((c) => !c.number || !read.has(c.number)) ?? ascending[0];
  const sorted = [...all].sort((a, b) => (Number(b.number ?? 0) - Number(a.number ?? 0)) * (newestFirst ? 1 : -1));
  // "120" finds chapter 120 (and 1200…); words search the chapter titles.
  const q = find.trim().toLowerCase();
  const ordered = q ? sorted.filter((c) => (c.number ?? '').startsWith(q) || (c.title ?? '').toLowerCase().includes(q)).sort((a, b) => (a.number === q ? -1 : b.number === q ? 1 : 0)) : sorted;
  const meta = [mangaKind(m) ?? formatLabel(m.format), m.chapters ? `${m.chapters} chapters` : null, mediaStatus(m.status), m.startDate?.year ? String(m.startDate.year) : null].filter(Boolean).join('  ·  ');

  const open = (c: Chapter) => (c.externalUrl ? void window.playzanime.app.openExternal(c.externalUrl) : navigate(readPath(id, c, c.id === progress?.chapterId ? progress.page : undefined)));

  return (
    <div className="m-page">
      <DetailHead m={m} />
      <div className="m-pad">
        <p className="m-meta">{meta}</p>
        <div className="m-actions">
          {resume ? (
            <Btn primary icon="manga" className="is-grow" onClick={() => open(resume)}>
              Resume ch. {resume.number} · p. {progress!.page}
            </Btn>
          ) : firstUnread ? (
            <Btn primary icon="manga" className="is-grow" onClick={() => open(firstUnread)}>
              {read.size ? `Read ch. ${firstUnread.number}` : 'Start reading'}
            </Btn>
          ) : (
            <Btn icon="manga" className="is-grow" disabled>
              {list ? 'No chapters yet' : 'Finding chapters…'}
            </Btn>
          )}
          <LibraryButton media={snap} />
        </div>
        {(m.genres?.length ?? 0) > 0 && (
          <div className="m-tags">
            {m.genres!.map((g) => (
              <Tag key={g}>{g}</Tag>
            ))}
          </div>
        )}
        <Synopsis text={m.description} />
      </div>

      <SectionHeader
        title="Chapters"
        subtitle={list ? `${all.length} on ${providerName(list.provider)}` : 'Checking sources…'}
        action={all.length > 1 ? (newestFirst ? 'Oldest first' : 'Newest first') : null}
        onAction={() => setNewestFirst(!newestFirst)}
      />
      {list && (
        <div className="m-pad">
          <button type="button" className="m-source" onClick={() => setSources(true)}>
            <Icon name="layers" size={17} />
            <span>
              <small>Source</small>
              <strong>{providerName(list.provider)}</strong>
            </span>
            <Icon name="chevronDown" size={16} />
          </button>
          {all.length > 20 && (
            <label className="m-search-field m-chapter-find">
              <Icon name="search" size={16} />
              <input value={find} onChange={(e) => setFind(e.target.value)} inputMode="search" placeholder="Go to chapter (number or title)" aria-label="Find a chapter" />
              {find && (
                <button type="button" aria-label="Clear" onClick={() => setFind('')}>
                  <Icon name="close" size={15} />
                </button>
              )}
            </label>
          )}
        </div>
      )}

      {chapters.error && !list ? (
        <StatePanel title="Couldn’t list chapters" message={chapters.error.message} icon="alert" action="Try again" onAction={chapters.reload} />
      ) : !list ? (
        <div className="m-pad m-stack">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={56} />
          ))}
        </div>
      ) : q && ordered.length === 0 ? (
        <StatePanel title={`No chapter matches “${find}”`} message="Search by number, like 120, or a word from the title." icon="search" />
      ) : all.length === 0 ? (
        <StatePanel title="No source has this title yet" message="Try another source, or check back later." icon="clock" action="Check again" onAction={() => void api().manga.chapters(id, provider, true).then(chapters.reload)} />
      ) : (
        <div className="m-chapters">
          {ordered.slice(0, limit).map((c) => {
            const done = Boolean(c.number && read.has(c.number));
            const current = c.id === progress?.chapterId;
            return (
              <div key={c.id} className={`m-chapter ${done ? 'is-read' : ''} ${current ? 'is-current' : ''}`}>
                <button type="button" className="m-chapter-open" onClick={() => open(c)}>
                  <span className="m-chapter-name">
                    {chapterName(c)}
                    {current && <span className="m-chapter-now">p. {progress!.page}</span>}
                    {c.externalUrl && <Icon name="globe" size={13} />}
                  </span>
                  <span className="m-chapter-sub clamp-1">
                    {[c.number && c.title ? plainText(c.title) : null, c.group, c.publishedAt ? relativeTime(c.publishedAt) : null].filter(Boolean).join(' · ')}
                  </span>
                </button>
                {c.number && (
                  <button type="button" className={`m-round is-bare ${done ? 'is-on' : ''}`} aria-label={done ? 'Mark as unread' : 'Mark as read'} onClick={() => void setRead([c.number!], !done)}>
                    <Icon name="check" size={17} />
                  </button>
                )}
              </div>
            );
          })}
          {ordered.length > limit && (
            <div className="m-pad">
              <Btn className="is-grow" onClick={() => setLimit((l) => l + 200)}>
                Show more ({ordered.length - limit} left)
              </Btn>
            </div>
          )}
        </div>
      )}

      <RelatedShelves m={m} />
      <div className="m-end" />

      <Sheet open={sources} onClose={() => setSources(false)} title="Read from">
        {(list?.providers ?? []).map((p) => (
          <SheetOption
            key={p.provider}
            label={providerName(p.provider)}
            hint={p.error ? 'Unavailable right now' : `${p.chapterCount} chapters${p.latest ? ` · latest ${p.latest}` : ''}`}
            selected={p.provider === list?.provider}
            onClick={() => {
              setSources(false);
              if (!p.error) setProvider(p.provider);
            }}
          />
        ))}
      </Sheet>
    </div>
  );
}
