import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Audio, Episode, ResolvedStream } from '../shared/types';
import { Button, Segmented, Switch } from '../renderer/components/Controls';
import { Icon } from '../renderer/components/Icon';
import { Img } from '../renderer/components/Media';
import { ErrorState, friendlyError, Spinner } from '../renderer/components/States';
import { useLoader } from '../renderer/lib/data';
import { coverOf, snapshot, titleOf } from '../renderer/lib/format';
import { Link, navigate, useRoute, withQuery } from '../renderer/lib/router';
import { useApp, useWatched } from '../renderer/lib/store';
import { DirectPlayer } from '../renderer/player/DirectPlayer';
import { EmbedPlayer } from '../renderer/player/EmbedPlayer';
import { back, RoundButton } from './kit';

/*
 * Watch, as in the Android app: the player on top, episode details and the list below.
 * Fullscreen turns the phone sideways (Android) or fills the screen (iPhone Safari, which
 * allows neither). It starts on its own from the tap that opened the episode.
 */

const api = () => window.playzanime;
const AUTO_ROTATE = 'playzanime:m-autorotate';
export const autoRotate = () => {
  try {
    return localStorage.getItem(AUTO_ROTATE) !== '0';
  } catch {
    return true;
  }
};
export const setAutoRotate = (on: boolean) => {
  try {
    localStorage.setItem(AUTO_ROTATE, on ? '1' : '0');
  } catch {
    /* private storage */
  }
};

type StreamState = { status: 'idle' } | { status: 'resolving'; slow: boolean } | { status: 'ready'; stream: ResolvedStream } | { status: 'error'; message: string };

const epTitle = (e: Episode) => (/^episode\s*\d+$/i.test(e.title) ? null : e.title);
const portrait = () => matchMedia('(orientation: portrait)').matches;
type Orientation = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };

export function MWatch({ id, ep }: { id: number; ep: number }) {
  const route = useRoute();
  const { settings, updateSettings, historyFor, saveHistory } = useApp();
  const media = useLoader(`media:${id}`, () => api().anilist.media(id), 15 * 60_000);
  const eps = useLoader(`eps:${id}`, () => api().episodes.list(id), 15 * 60_000);
  const { watched, setWatched } = useWatched(id);

  const episodes = eps.data?.episodes ?? [];
  const index = episodes.findIndex((e) => e.number === ep);
  const episode = index >= 0 ? episodes[index] : undefined;
  const prev = index > 0 ? episodes[index - 1] : undefined;
  const next = index >= 0 && index < episodes.length - 1 ? episodes[index + 1] : undefined;

  const [audio, setAudio] = useState<Audio>(() => (route.query.get('audio') as Audio | null) ?? historyFor(id)?.audio ?? (settings.preferDub ? 'dub' : 'sub'));
  const effectiveAudio: Audio = audio === 'dub' && episode?.dubUrl ? 'dub' : episode?.subUrl ? 'sub' : 'dub';
  const embedUrl = episode ? (effectiveAudio === 'dub' ? episode.dubUrl : episode.subUrl) : null;

  const [mode, setMode] = useState(settings.player);
  const [state, setState] = useState<StreamState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const lastPosition = useRef(0);
  const autoRetried = useRef(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const onFatal = (message: string) => {
    if (autoRetried.current) return setState({ status: 'error', message });
    autoRetried.current = true;
    setRetryAt(lastPosition.current || null);
    setAttempt((a) => a + 1);
  };

  const startAt = useMemo(() => {
    const t = Number(route.query.get('t'));
    if (t > 0) return t;
    const h = historyFor(id);
    return h && h.episode === ep && h.position > 10 && h.position < h.duration - 30 ? h.position : 0;
  }, [id, ep]);

  useEffect(() => {
    if (mode !== 'direct' || !embedUrl) return;
    let live = true;
    setState({ status: 'resolving', slow: false });
    const slow = window.setTimeout(() => live && setState((s) => (s.status === 'resolving' ? { status: 'resolving', slow: true } : s)), 12000);
    api()
      .stream.resolve(embedUrl, attempt > 0)
      .then((stream) => live && setState({ status: 'ready', stream }))
      .catch((err: Error) => live && setState({ status: 'error', message: friendlyError(err) }))
      .finally(() => window.clearTimeout(slow));
    return () => {
      live = false;
      window.clearTimeout(slow);
    };
  }, [embedUrl, mode, attempt]);

  const snap = media.data ? snapshot(media.data, settings.titleLanguage) : null;
  const onProgress = useCallback(
    (position: number, duration: number) => {
      lastPosition.current = position;
      if (!snap || !episode || duration < 30) return;
      saveHistory({ media: snap, episode: episode.number, episodeTitle: episode.title, thumbnail: episode.thumbnail ?? null, position, duration, audio: effectiveAudio, updatedAt: Date.now() });
    },
    [snap?.id, episode?.number, effectiveAudio],
  );

  const goTo = useCallback(
    (e?: Episode) => e && navigate(withQuery(`/watch/${id}/${e.number}`, { audio: effectiveAudio === 'dub' && e.dubUrl ? 'dub' : null }), { replace: true }),
    [id, effectiveAudio],
  );

  // ── Fullscreen and rotation ──
  const stageRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const enterFull = useCallback(async () => {
    const el = stageRef.current;
    try {
      if (!el?.requestFullscreen) throw new Error('no fullscreen');
      await el.requestFullscreen({ navigationUI: 'hide' });
      await (screen.orientation as Orientation).lock?.('landscape').catch(() => {});
    } catch {
      /* iPhone Safari, or no tap to allow it: the stage fills the window instead */
    }
    setFull(true);
  }, []);
  const exitFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    (screen.orientation as Orientation).unlock?.();
    setFull(false);
  }, []);
  useEffect(() => {
    const onFs = () => !document.fullscreenElement && setFull(false);
    const landscape = matchMedia('(orientation: landscape)');
    const onTurn = () => {
      if (landscape.matches) void enterFull();
      else if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    landscape.addEventListener('change', onTurn);
    // Opened from a tap ("Play", an episode): that tap still counts, so go sideways now.
    const activation = (navigator as { userActivation?: { isActive: boolean } }).userActivation;
    if (autoRotate() && portrait() && activation?.isActive) void enterFull();
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      landscape.removeEventListener('change', onTurn);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      (screen.orientation as Orientation).unlock?.();
    };
  }, [enterFull]);
  const onPlayTap = () => {
    if (!full && autoRotate() && portrait()) void enterFull();
  };

  if (media.error && !media.data) return <ErrorState title="Couldn’t load this show" error={media.error} onRetry={media.reload} />;

  const title = media.data ? titleOf(media.data, settings.titleLanguage) : '';
  const heading = episode ? (epTitle(episode) ? `E${episode.number} · ${epTitle(episode)}` : `Episode ${episode.number}`) : `Episode ${ep}`;
  const poster = episode?.thumbnail || media.data?.bannerImage || (media.data ? coverOf(media.data) : null);

  let stage;
  if (eps.error && !eps.data) stage = <ErrorState compact title="Couldn’t find episodes" error={eps.error} onRetry={eps.reload} />;
  else if (eps.data && !episode) stage = <p className="mw-msg">Episode {ep} isn’t available.</p>;
  else if (!embedUrl) stage = <Spinner size={30} label="Finding episodes" />;
  else if (mode === 'embed') stage = <EmbedPlayer url={embedUrl} startAt={startAt} onProgress={onProgress} />;
  else if (state.status === 'ready' && state.stream.embedUrl === embedUrl)
    stage = (
      <DirectPlayer
        key={`${embedUrl}#${attempt}`}
        variant="mobile"
        fullscreen={full}
        onFullscreen={() => (full ? exitFull() : void enterFull())}
        onBack={back}
        onPlayTap={onPlayTap}
        stream={state.stream}
        startAt={retryAt ?? startAt}
        title={heading}
        subtitle={title}
        artwork={media.data ? coverOf(media.data) : null}
        volume={settings.volume}
        subtitleLanguage={settings.subtitleLanguage}
        preferSubtitles={effectiveAudio === 'sub'}
        autoSkipIntro={settings.autoSkipIntro}
        autoplayNext={settings.autoplayNext}
        dataSaver={settings.dataSaver}
        hasPrev={Boolean(prev)}
        hasNext={Boolean(next)}
        nextLabel={next ? `Episode ${next.number}` : null}
        theater={false}
        onTheater={() => {}}
        onPrev={() => goTo(prev)}
        onNext={() => goTo(next)}
        onProgress={onProgress}
        onWatched={() => void setWatched([ep], true)}
        onVolume={() => {}}
        onFatal={onFatal}
      />
    );
  else if (state.status === 'error')
    stage = (
      <div className="mw-msg">
        <Icon name="alert" size={24} />
        <strong>This stream wouldn’t load</strong>
        <span>{state.message}</span>
        <div className="mw-msg-actions">
          <Button size="sm" variant="primary" icon="refresh" onClick={() => setAttempt((a) => a + 1)}>
            Retry
          </Button>
          <Button size="sm" icon="globe" onClick={() => setMode('embed')}>
            Source player
          </Button>
        </div>
      </div>
    );
  else
    stage = (
      <div className="mw-loading">
        {poster && <Img src={poster} className="mw-poster" eager />}
        <Spinner size={30} />
        <span>{state.status === 'resolving' && state.slow ? 'This host is slow today. Still trying…' : 'Finding the stream…'}</span>
      </div>
    );

  return (
    <div className={`mw ${full ? 'is-full' : ''}`}>
      <div className="mw-stage" ref={stageRef}>
        {stage}
        {mode === 'embed' && (
          <div className="mw-embed-bar">
            <RoundButton icon="arrowLeft" label="Back" onClick={() => (full ? exitFull() : back())} />
            <RoundButton icon={full ? 'fullscreenExit' : 'fullscreen'} label="Full screen" onClick={() => (full ? exitFull() : void enterFull())} />
          </div>
        )}
      </div>

      <div className="mw-body">
        <Link to={`/anime/${id}`} className="mw-series">
          {title}
          <Icon name="chevronRight" size={15} />
        </Link>
        <h1 className="mw-title display">{heading}</h1>
        <div className="mw-row">
          {eps.data?.hasDub && (
            <Segmented
              label="Audio"
              size="sm"
              value={effectiveAudio}
              onChange={(a) => {
                setAudio(a);
                void updateSettings({ preferDub: a === 'dub' });
              }}
              options={[
                { value: 'sub', label: 'Sub' },
                { value: 'dub', label: 'Dub', disabled: !episode?.dubUrl },
              ]}
            />
          )}
          <span className="mw-spacer" />
          <RoundButton icon="prev" label="Previous episode" disabled={!prev} onClick={() => goTo(prev)} />
          <RoundButton icon="next" label="Next episode" disabled={!next} onClick={() => goTo(next)} />
        </div>
        <div className="mw-row">
          <Segmented
            label="Player"
            size="sm"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setAttempt(0);
            }}
            options={[
              { value: 'direct', label: 'PlayzAnime' },
              { value: 'embed', label: 'Source player' },
            ]}
          />
          <span className="mw-spacer" />
          <label className="mw-auto">
            Autoplay
            <Switch checked={settings.autoplayNext} onChange={(v) => void updateSettings({ autoplayNext: v })} label="Autoplay next episode" />
          </label>
        </div>

        <h2 className="mw-head">
          Episodes <span className="num">{episodes.length || ''}</span>
        </h2>
        <div className="mw-list">
          {episodes.map((e) => {
            const current = e.number === ep;
            return (
              <button key={e.number} type="button" className={`mw-ep ${current ? 'is-current' : ''}`} onClick={() => !current && goTo(e)}>
                <span className="mw-thumb">
                  <Img src={e.thumbnail ?? media.data?.bannerImage ?? (media.data ? coverOf(media.data) : null)} color={media.data?.coverImage?.color} />
                  {!e.thumbnail && <span className="mw-thumb-num display">{e.number}</span>}
                  {current && (
                    <span className="mw-thumb-now">
                      <Icon name="play" size={18} />
                    </span>
                  )}
                </span>
                <span className="mw-ep-text">
                  <span className="mw-ep-num num">E{e.number}</span>
                  <span className="mw-ep-title clamp-2">{epTitle(e) ?? `Episode ${e.number}`}</span>
                </span>
                {watched.has(e.number) && !current && <Icon name="check" size={16} className="mw-check" />}
              </button>
            );
          })}
          {!eps.data && !eps.error && <Spinner size={20} label="Loading episodes" />}
        </div>
        <p className="mw-foot">
          Want this episode offline? Downloads are in the <Link to="/downloads">PlayzAnime app</Link>.
        </p>
      </div>
    </div>
  );
}
