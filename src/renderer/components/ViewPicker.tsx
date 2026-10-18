import { useState } from 'react';
import { suggestedView, type ViewMode } from '../lib/viewmode';
import { Icon } from './Icon';
import { Logo } from './Logo';
import './viewpicker.css';

/** First visit: phone layout or computer layout. Shown before either app loads. */
export function ViewPicker({ onPick }: { onPick: (view: ViewMode) => void }) {
  const [pick, setPick] = useState<ViewMode>(suggestedView);
  const options: { value: ViewMode; icon: 'phone' | 'monitor'; title: string; body: string }[] = [
    { value: 'mobile', icon: 'phone', title: 'Phone or tablet', body: 'Big buttons, a tab bar at the bottom and a touch player that turns sideways.' },
    { value: 'desktop', icon: 'monitor', title: 'Computer or TV', body: 'The full layout with a side rail, keyboard shortcuts and a remote-friendly player.' },
  ];
  return (
    <div className="vp" role="dialog" aria-modal="true" aria-labelledby="vp-title">
      <div className="vp-card">
        <Logo size={52} />
        <h1 id="vp-title" className="vp-title display">
          What are you watching on?
        </h1>
        <p className="vp-sub">PlayzAnime has a layout for each. You can switch any time in Settings → View.</p>
        <div className="vp-options" role="radiogroup" aria-label="Layout">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={pick === o.value}
              className={`vp-option ${pick === o.value ? 'is-picked' : ''}`}
              onClick={() => setPick(o.value)}
            >
              <span className="vp-icon">
                <Icon name={o.icon} size={22} />
              </span>
              <span className="vp-text">
                <strong>{o.title}</strong>
                <span>{o.body}</span>
              </span>
              <span className="vp-dot" aria-hidden="true" />
            </button>
          ))}
        </div>
        <button type="button" className="vp-go" onClick={() => onPick(pick)}>
          Continue
          <Icon name="arrowRight" size={18} />
        </button>
      </div>
    </div>
  );
}
