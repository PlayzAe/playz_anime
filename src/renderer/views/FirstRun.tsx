import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import type { Profile } from '../../shared/types';
import { Button } from '../components/Controls';
import { Logo } from '../components/Logo';
import { blankProfile, ProfileFields } from '../components/Profile';
import { Aurora } from '../components/Splash';
import { useApp } from '../lib/store';
import './firstrun.css';

/*
 * The first visit, right after the opening Splash. The web has no folders or
 * Windows folder protection to set up, so this is only the profile: a name, a
 * picture and favourites, skippable. It's saved in this browser.
 */

const api = () => window.playzanime;
const EASE = [0.2, 0.8, 0.2, 1] as const;

/** `irisToRail`: close onto the sidebar seal (wide screens); on phones, where the rail is a bottom bar, fade instead. */
export function FirstRun({ onDone, irisToRail = true }: { onDone: () => void; irisToRail?: boolean }) {
  const { profile, saveProfile, toast } = useApp();
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const [draft, setDraft] = useState<Profile>(() => profile ?? blankProfile());

  const finish = async (withProfile: boolean) => {
    if (withProfile) {
      if (!draft.name.trim()) {
        toast('Add a name first, or skip for now.');
        return;
      }
      await saveProfile({ ...draft, name: draft.name.trim() });
    }
    await api().setup.complete();
    setLeaving(true);
    window.setTimeout(onDone, reduced ? 200 : 900);
  };

  return (
    <motion.div
      className="firstrun"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to PlayzAnime"
      initial={false}
      animate={!leaving ? { clipPath: 'circle(150% at 34px 32px)', opacity: 1 } : irisToRail ? { clipPath: 'circle(0px at 34px 32px)' } : { opacity: 0 }}
      transition={{ duration: leaving ? 0.85 : 0, ease: [0.7, 0, 0.84, 0] }}
    >
      <Aurora />

      <div className="fr-brand">
        <span className="fr-brand-seal">
          <Logo size={30} />
        </span>
        <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35, duration: 0.5 }}>
          PlayzAnime
        </motion.span>
      </div>

      <motion.div
        className="fr-stage fr-card fr-profile"
        initial={{ opacity: 0, y: 28, filter: 'blur(12px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.7, ease: EASE }}
      >
        <Words text={profile ? 'Still you?' : 'Make it yours'} className="fr-title display" />
        <motion.p className="fr-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
          A name, a picture and your favourites. It stays in this browser; share it with friends as a file whenever you like.
        </motion.p>
        <ProfileFields value={draft} onChange={setDraft} />
        <div className="fr-actions">
          <Button variant="primary" size="lg" className="fr-cta" onClick={() => void finish(true)}>
            Save and start watching
          </Button>
          <Button variant="ghost" size="lg" onClick={() => void finish(false)}>
            Skip for now
          </Button>
        </div>
        <p className="fr-fine">You can change this later from Profiles.</p>
      </motion.div>
    </motion.div>
  );
}

function Words({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  return (
    <h1 className={className} aria-label={text}>
      {text.split(' ').map((w, i) => (
        <motion.span
          key={`${w}-${i}`}
          className="fr-word"
          aria-hidden="true"
          initial={{ opacity: 0, y: '0.55em', filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ delay: delay + i * 0.08, duration: 0.6, ease: EASE }}
        >
          {w}
        </motion.span>
      ))}
    </h1>
  );
}
