import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMedia } from '../lib/viewport';
import { Img } from './Media';
import './hero.css';

export interface HeroSlide {
  key: string;
  kicker: ReactNode;
  title: string;
  native?: string | null;
  banner?: string | null;
  cover?: string | null;
  color?: string | null;
  meta: ReactNode[];
  description?: string | null;
  actions: ReactNode;
  progress?: number | null;
}

const SLIDE_MS = 5000;

/**
 * Full-bleed spotlight. Slides advance on a visible timer that pauses while the
 * pointer is over the hero, so nothing moves out from under someone reading it.
 */
export function Hero({ slides, showNative }: { slides: HeroSlide[]; showNative: boolean }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const touchX = useRef<number | null>(null);
  // Portrait phone screens; an unfolded foldable is closer to square and keeps the banner.
  const phone = useMedia('(max-width: 760px) and (max-aspect-ratio: 4/5)');
  const slide = slides[Math.min(index, slides.length - 1)];

  const setHoverPaused = (p: boolean) => {
    pausedRef.current = p;
    setPaused(p);
  };

  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [slides.length, index]);

  useEffect(() => {
    const onVisibility = () => {
      pausedRef.current = document.hidden;
      setPaused(document.hidden);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Main slide timer: advances every SLIDE_MS ms unless paused.
  useEffect(() => {
    if (slides.length <= 1) return;
    const id = setInterval(() => {
      if (!pausedRef.current) {
        setIndex((prev) => (prev + 1) % slides.length);
      }
    }, SLIDE_MS);
    return () => clearInterval(id);
  }, [slides.length]);

  if (!slide) return <div className="hero is-empty" />;
  const posterMode = !slide.banner;
  // Phones get the portrait cover: it matches the tall hero, where a wide banner would crop to a blur.
  const phoneCover = phone && !!slide.cover;
  const swipe = (dx: number) => {
    if (Math.abs(dx) < 40 || slides.length <= 1) return;
    setIndex((i) => (i + (dx < 0 ? 1 : slides.length - 1)) % slides.length);
  };

  return (
    <section
      className={`hero ${phoneCover ? 'is-cover' : posterMode ? 'is-poster' : ''}`}
      aria-roledescription="carousel"
      onMouseEnter={() => setHoverPaused(true)}
      onMouseLeave={() => setHoverPaused(false)}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current !== null) swipe(e.changedTouches[0].clientX - touchX.current);
        touchX.current = null;
      }}
    >
      <AnimatePresence initial={false}>
        <motion.div
          className="hero-slide"
          key={slide.key}
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '-100%' }}
          transition={{ duration: 0.75, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <div className="hero-bg">
            {phoneCover ? (
              <Img src={slide.cover} color={slide.color} className="hero-img" eager position="center 20%" />
            ) : posterMode ? (
              <>
                <Img src={slide.cover} color={slide.color} className="hero-blur" eager />
                <Img src={slide.cover} color={slide.color} className="hero-poster" eager />
              </>
            ) : (
              <Img src={slide.banner} color={slide.color} className="hero-img" eager position="center 28%" />
            )}
          </div>
          <div className="hero-shade" />
          <div className="hero-body">
            <div className="hero-kicker">{slide.kicker}</div>
            <h1 className="hero-title display">{slide.title}</h1>
            <div className="hero-meta dot-sep">{slide.meta.filter(Boolean).map((m, i) => <span key={i}>{m}</span>)}</div>
            {slide.progress != null && (
              <div className="hero-progress" aria-hidden="true">
                <span style={{ width: `${Math.round(slide.progress * 100)}%` }} />
              </div>
            )}
            {slide.description && <p className="hero-desc clamp-3">{slide.description}</p>}
            <div className="hero-actions">{slide.actions}</div>
          </div>
          {showNative && slide.native && (
            <div className="hero-native jp" aria-hidden="true">
              {slide.native}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {slides.length > 1 && (
        <div className={`hero-pager ${paused ? 'is-paused' : ''}`} role="tablist" aria-label="Spotlight">
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={s.title}
              className={i === index ? 'is-current' : ''}
              onClick={() => setIndex(i)}
            >
              <span className="num">{String(i + 1).padStart(2, '0')}</span>
              <span className="hero-pager-bar">
                {i === index && <span key={`${s.key}-bar`} style={{ animationDuration: `${SLIDE_MS}ms` }} />}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
