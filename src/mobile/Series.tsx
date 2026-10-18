import { useRef, useState } from 'react';
import type { Media, MediaDetail, MediaSnapshot } from '../shared/types';
import { Icon } from '../renderer/components/Icon';
import { statusLabel } from '../renderer/components/ListButton';
import { Img } from '../renderer/components/Media';
import { Sheet, SheetOption } from '../renderer/components/Sheet';
import { useLoader } from '../renderer/lib/data';
import { altTitleOf, countdown, coverOf, episodesLabel, formatLabel, plainText, scoreLabel, seasonLabel, snapshot, statusLabel as mediaStatus, titleOf } from '../renderer/lib/format';
import { navigate } from '../renderer/lib/router';
import { useApp, useWatched } from '../renderer/lib/store';
import { Btn, FloatingBack, PosterCard, ProgressLine, SectionHeader, Shelf, Skeleton, StatePanel, Tag } from './kit';

const api = () => window.playzanime;
const ORDER = ['watching', 'planning', 'completed', 'paused', 'dropped'] as const;

/** Save to library, as a sheet. */
export function LibraryButton({ media }: { media: MediaSnapshot }) {
  const { statusOf, setStatus, toast } = useApp();
  const [open, setOpen] = useState(false);
  const status = statusOf(media.id);
  const manga = media.type === 'MANGA';
  const pick = (s: (typeof ORDER)[number] | null) => {
    setOpen(false);
    void setStatus(media, s);
    toast(s ? `Saved to ${statusLabel(s, manga)}` : 'Removed from library');
  };
  return (
    <>
      <Btn icon={status ? 'bookmarkFilled' : 'plus'} onClick={() => setOpen(true)}>
        {status ? statusLabel(status, manga) : 'Add to list'}
      </Btn>
      <Sheet open={open} onClose={() => setOpen(false)} title="Save to library">
        {ORDER.map((s) => (
          <SheetOption key={s} label={statusLabel(s, manga)} selected={s === status} onClick={() => pick(s)} />
        ))}
        {status && <SheetOption label="Remove from library" icon="trash" danger onClick={() => pick(null)} />}
      </Sheet>
    </>
  );
}

/** Banner, poster, title, meta: the top of a series or manga page. */
export function DetailHead({ m }: { m: MediaDetail }) {
  const { settings } = useApp();
  const score = scoreLabel(m.averageScore);
  const alt = altTitleOf(m, settings.titleLanguage);
  return (
    <header className="m-dh">
      <Img src={m.bannerImage ?? coverOf(m)} color={m.coverImage?.color} className="m-dh-banner" eager />
      <span className="m-dh-shade" />
      <FloatingBack />
      <div className="m-dh-row">
        <span className="m-dh-poster">
          <Img src={coverOf(m)} color={m.coverImage?.color} eager />
        </span>
        <div className="m-dh-titles">
          {score && <Tag icon="bolt">{score}</Tag>}
          <h1 className="m-dh-title display clamp-3">{titleOf(m, settings.titleLanguage)}</h1>
          {alt && <p className="m-dh-alt clamp-1">{alt}</p>}
        </div>
      </div>
    </header>
  );
}

export function Synopsis({ text }: { text?: string | null }) {
  const [open, setOpen] = useState(false);
  const plain = plainText(text);
  if (!plain) return null;
  return (
    <button type="button" className={`m-synopsis ${open ? 'is-open' : 'clamp-4'}`} onClick={() => setOpen(!open)}>
      {plain}
    </button>
  );
}

export function RelatedShelves({ m }: { m: MediaDetail }) {
  const related = m.relations?.edges ?? [];
  const recs = (m.recommendations?.nodes ?? []).map((n) => n.mediaRecommendation).filter((x): x is Media => Boolean(x));
  return (
    <>
      {related.length > 0 && (
        <>
          <SectionHeader title="Related" />
          <Shelf>
            {related.map((r) => (
              <PosterCard key={r.node.id} media={r.node} meta={formatLabel(r.node.format) ?? ''} />
            ))}
          </Shelf>
        </>
      )}
      {recs.length > 0 && (
        <>
          <SectionHeader title="If you like this" />
          <Shelf>
            {recs.map((r) => (
              <PosterCard key={r.id} media={r} />
            ))}
          </Shelf>
        </>
      )}
    </>
  );
}

export function MSeries({ id }: { id: number }) {
  const { settings, historyFor } = useApp();
  const media = useLoader(`media:${id}`, () => api().anilist.media(id), 15 * 60_000);
  const eps = useLoader(`eps:${id}`, () => api().episodes.list(id), 15 * 60_000);
  const { watched, setWatched } = useWatched(id);
  const [newestFirst, setNewestFirst] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const hold = useRef<number | undefined>(undefined);
  const held = useRef(false);

  if (media.error && !media.data) return <StatePanel title="Couldn’t load this show" message={media.error.message} icon="alert" action="Try again" onAction={media.reload} />;
  if (!media.data)
    return (
      <div className="m-page m-pad">
        <Skeleton height={300} />
        <Skeleton height={20} width="60%" />
        <Skeleton height={48} />
      </div>
    );

  const m = media.data;
  const snap = snapshot(m, settings.titleLanguage);
  const h = historyFor(id);
  const list = eps.data?.episodes ?? [];
  const ordered = newestFirst ? [...list].reverse() : list;
  const unreleased = m.status === 'NOT_YET_RELEASED';
  const meta = [formatLabel(m.format), seasonLabel(m), episodesLabel(m), mediaStatus(m.status), m.studios?.nodes[0]?.name].filter(Boolean).join('  ·  ');
  const picking = picked.size > 0;
  const toggle = (n: number) => setPicked((p) => (p.has(n) ? new Set([...p].filter((x) => x !== n)) : new Set(p).add(n)));

  return (
    <div className="m-page">
      <DetailHead m={m} />
      <div className="m-pad">
        <p className="m-meta">{meta}</p>
        {m.nextAiringEpisode && (
          <p className="m-airs">
            Episode {m.nextAiringEpisode.episode} airs in {countdown(m.nextAiringEpisode.timeUntilAiring)}
          </p>
        )}
        <div className="m-actions">
          {unreleased ? (
            <Btn icon="clock" className="is-grow">
              Not out yet
            </Btn>
          ) : (
            <Btn primary icon="play" className="is-grow" onClick={() => navigate(`/watch/${id}/${h?.episode ?? list[0]?.number ?? 1}`)}>
              {h ? `Resume E${h.episode}` : m.format === 'MOVIE' ? 'Play movie' : 'Play E1'}
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

      {!unreleased && (
        <>
          <SectionHeader
            title="Episodes"
            subtitle={eps.data ? `${list.length} episodes · ${eps.data.hasDub ? 'Sub & Dub' : 'Sub'}` : 'Finding a source…'}
            action={list.length > 1 ? (newestFirst ? 'Oldest first' : 'Newest first') : null}
            onAction={() => setNewestFirst(!newestFirst)}
          />
          {list.length > 0 && (
            <div className="m-pick-bar">
              {picking ? (
                <>
                  <strong>{picked.size} selected</strong>
                  <Btn
                    compact
                    icon="check"
                    onClick={() => {
                      const all = [...picked].every((n) => watched.has(n));
                      void setWatched([...picked], !all);
                      setPicked(new Set());
                    }}
                  >
                    Watched
                  </Btn>
                  <button type="button" className="m-round is-bare" aria-label="Cancel" onClick={() => setPicked(new Set())}>
                    <Icon name="close" size={16} />
                  </button>
                </>
              ) : (
                <span className="faint">Hold an episode to select several</span>
              )}
            </div>
          )}
          {eps.data?.fallback && <p className="m-note">This list follows AniList’s numbering; some episodes may not play.</p>}
          {eps.error && !eps.data ? (
            <StatePanel title="Couldn’t list episodes" message={eps.error.message} icon="alert" action="Try again" onAction={eps.reload} />
          ) : !eps.data ? (
            <div className="m-pad m-stack">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={66} />
              ))}
            </div>
          ) : (
            <div className="m-eps">
              {ordered.map((e) => {
                const seen = watched.has(e.number);
                const sel = picked.has(e.number);
                const resume = h?.episode === e.number && h.duration ? h.position / h.duration : null;
                const named = !/^episode\s*\d+$/i.test(e.title.trim());
                return (
                  <button
                    key={e.number}
                    type="button"
                    className={`m-ep ${seen ? 'is-seen' : ''} ${sel ? 'is-picked' : ''}`}
                    onPointerDown={() => {
                      held.current = false;
                      hold.current = window.setTimeout(() => {
                        held.current = true;
                        toggle(e.number);
                      }, 450);
                    }}
                    onPointerUp={() => window.clearTimeout(hold.current)}
                    onPointerLeave={() => window.clearTimeout(hold.current)}
                    onContextMenu={(ev) => ev.preventDefault()}
                    onClick={() => {
                      if (held.current) return;
                      if (picking) toggle(e.number);
                      else navigate(`/watch/${id}/${e.number}`);
                    }}
                  >
                    <span className="m-ep-thumb">
                      <Img src={e.thumbnail ?? m.bannerImage ?? coverOf(m)} color={m.coverImage?.color} />
                      {!e.thumbnail && <span className="m-ep-num display">{e.number}</span>}
                      {(seen || sel) && (
                        <span className={`m-ep-mark ${sel ? 'is-picked' : ''}`}>
                          <Icon name="check" size={20} />
                        </span>
                      )}
                      {resume !== null && (
                        <span className="m-wide-bar">
                          <ProgressLine value={resume} />
                        </span>
                      )}
                    </span>
                    <span className="m-ep-text">
                      <span className="m-ep-label">Episode {e.number}</span>
                      {named && <span className="m-ep-title clamp-2">{e.title}</span>}
                      {e.dubUrl && <Tag>DUB</Tag>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      <RelatedShelves m={m} />
      <div className="m-end" />
    </div>
  );
}
