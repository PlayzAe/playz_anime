import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../renderer/components/Icon';
import { Img } from '../renderer/components/Media';
import { useApp } from '../renderer/lib/store';
import { Btn, ProgressLine } from './kit';

/*
 * HeroCarousel from the Android app: full-bleed pages you swipe, one every 7 seconds,
 * kicker, big title, meta, resume bar, two buttons, and the native title down the side.
 */

export interface Slide {
  key: string;
  kicker: string;
  kickerIcon?: IconName;
  title: string;
  native?: string | null;
  art?: string | null;
  meta: (string | number | null | undefined | false)[];
  progress?: number | null;
  primary: { label: string; icon?: IconName; run: () => void };
  secondary: { label: string; run: () => void };
}

const JP = /[぀-ヿ一-鿿]/;

export function HeroCarousel({ slides }: { slides: Slide[] }) {
  const { settings } = useApp();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const touched = useRef(0);

  useEffect(() => {
    if (slides.length < 2) return;
    const id = window.setInterval(() => {
      const el = track.current;
      if (!el || Date.now() - touched.current < 7000) return;
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % slides.length;
      el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    }, 7000);
    return () => window.clearInterval(id);
  }, [slides.length]);

  const go = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  if (!slides.length) return <div className="m-hero is-empty skeleton" />;

  return (
    <section className="m-hero" aria-roledescription="carousel">
      <div
        className="m-hero-track"
        ref={track}
        onPointerDown={() => (touched.current = Date.now())}
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
      >
        {slides.map((s, i) => {
          const jp = settings.showNativeTitles && s.native && JP.test(s.native) ? [...s.native].slice(0, 12) : null;
          return (
            <article key={s.key} className={`m-hero-page ${i === index ? 'is-active' : ''}`} aria-hidden={i !== index}>
              {s.art && <Img src={s.art} className="m-hero-art" eager={i < 2} position="center 28%" />}
              <div className="m-hero-shade" />
              {jp && (
                <div className="m-hero-native jp" aria-hidden="true">
                  {jp.map((ch, k) => (
                    <span key={k}>{ch}</span>
                  ))}
                </div>
              )}
              <div className={`m-hero-body ${jp ? 'has-native' : ''}`}>
                <div className="m-hero-kicker">
                  {s.kickerIcon && <Icon name={s.kickerIcon} size={14} />}
                  <span className="clamp-1">{s.kicker}</span>
                </div>
                <h2 className="m-hero-title display clamp-3">{s.title}</h2>
                <div className="m-hero-meta clamp-1">{s.meta.filter(Boolean).join('  ·  ')}</div>
                {s.progress != null && (
                  <span className="m-hero-progress">
                    <ProgressLine value={s.progress} />
                  </span>
                )}
                <div className="m-hero-actions">
                  <Btn primary icon={s.primary.icon ?? 'play'} onClick={s.primary.run}>
                    {s.primary.label}
                  </Btn>
                  <Btn onClick={s.secondary.run}>{s.secondary.label}</Btn>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {slides.length > 1 && (
        <div className="m-hero-pager">
          {slides.map((s, i) => (
            <button key={s.key} type="button" className={i === index ? 'is-on' : ''} aria-label={`Slide ${i + 1}`} onClick={() => go(i)}>
              <span className="num">{String(i + 1).padStart(2, '0')}</span>
              <i />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
