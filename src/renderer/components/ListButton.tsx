import { useState } from 'react';
import type { ListStatus, MediaSnapshot } from '../../shared/types';
import { useApp } from '../lib/store';
import { storedView } from '../lib/viewmode';
import { Menu } from './Controls';
import { Icon } from './Icon';
import { Sheet, SheetOption } from './Sheet';

export function statusLabel(status: ListStatus, manga: boolean): string {
  switch (status) {
    case 'watching':
      return manga ? 'Reading' : 'Watching';
    case 'planning':
      return manga ? 'Plan to read' : 'Plan to watch';
    case 'completed':
      return 'Completed';
    case 'paused':
      return 'Paused';
    case 'dropped':
      return 'Dropped';
  }
}

const ORDER: ListStatus[] = ['watching', 'planning', 'completed', 'paused', 'dropped'];

// Phones get a bottom sheet: a dropdown anchored to the button runs off a narrow screen.
const sheetMode = () => storedView() === 'mobile' || matchMedia('(max-width: 760px)').matches;

export function ListButton({ media, size = 'lg', variant = 'ghost', className = '' }: { media: MediaSnapshot; size?: 'md' | 'lg'; variant?: 'ghost' | 'solid'; className?: string }) {
  const { statusOf, setStatus, toast } = useApp();
  const [sheet, setSheet] = useState(false);
  const status = statusOf(media.id);
  const manga = media.type === 'MANGA';

  const choose = async (next: ListStatus | null) => {
    setSheet(false);
    await setStatus(media, next);
    toast(next ? `${media.title} is in ${statusLabel(next, manga)}` : `Removed ${media.title} from your library`, {
      action: next ? undefined : { label: 'Undo', run: () => void setStatus(media, status) },
    });
  };

  const face = (
    <>
      <Icon name={status ? 'bookmarkFilled' : 'bookmark'} size={17} />
      <span className="list-btn-label">{status ? statusLabel(status, manga) : 'Add to library'}</span>
      <Icon name="chevronDown" size={14} />
    </>
  );
  const cls = `btn btn-${variant} btn-${size} list-btn ${status ? 'is-set' : ''} ${className}`;

  if (sheetMode()) {
    return (
      <>
        <button type="button" className={cls} aria-haspopup="dialog" onClick={() => setSheet(true)}>
          {face}
        </button>
        <Sheet open={sheet} onClose={() => setSheet(false)} title={media.title}>
          <div className="sheet-section">{manga ? 'Save to your manga library' : 'Save to your library'}</div>
          {ORDER.map((s) => (
            <SheetOption key={s} label={statusLabel(s, manga)} icon={s === status ? 'bookmarkFilled' : 'bookmark'} selected={s === status} onClick={() => void choose(s)} />
          ))}
          {status && <SheetOption label="Remove from library" icon="trash" danger onClick={() => void choose(null)} />}
        </Sheet>
      </>
    );
  }

  return (
    <Menu
      width={210}
      heading="Library"
      items={[
        ...ORDER.map((s) => ({ key: s, label: statusLabel(s, manga), checked: s === status, onSelect: () => void choose(s) })),
        ...(status ? (['divider', { key: 'remove', label: 'Remove from library', icon: 'trash' as const, danger: true, onSelect: () => void choose(null) }] as const) : []),
      ]}
      trigger={({ open, toggle, id }) => (
        <button type="button" className={cls} aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={toggle}>
          {face}
        </button>
      )}
    />
  );
}
