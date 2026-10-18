import { Segmented, Switch } from '../renderer/components/Controls';
import { chooseView, type ViewMode } from '../renderer/lib/viewmode';
import { Settings } from '../renderer/views/Settings';
import { useState } from 'react';
import { autoRotate, setAutoRotate } from './Watch';

/** Phone settings: the layout switch and phone-only options first, then everything else. */
export function MSettings() {
  const [rotate, setRotate] = useState(autoRotate);
  return (
    <div className="m-settings">
      <section className="m-card">
        <h2 className="m-card-title">View</h2>
        <p className="m-card-note">You’re using the phone layout. Picked wrong, or on a computer or TV? Switch here; the page reloads.</p>
        <Segmented<ViewMode>
          label="Layout"
          value="mobile"
          onChange={(v) => v !== 'mobile' && chooseView(v, { reload: true })}
          options={[
            { value: 'mobile', label: 'Phone view' },
            { value: 'desktop', label: 'Computer view' },
          ]}
        />
      </section>
      <section className="m-card">
        <div className="m-card-row">
          <span>
            <strong>Open episodes sideways</strong>
            <small>Fullscreen and landscape when an episode starts. Turning the phone does the same.</small>
          </span>
          <Switch
            checked={rotate}
            onChange={(v) => {
              setRotate(v);
              setAutoRotate(v);
            }}
            label="Open episodes sideways"
          />
        </div>
      </section>
      <Settings />
    </div>
  );
}
