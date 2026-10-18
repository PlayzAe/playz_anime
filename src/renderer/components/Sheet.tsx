import { AnimatePresence, motion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import './sheet.css';

/** A bottom sheet for touch screens: menus and pickers that fit a thumb. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={onClose}>
          <motion.div
            className="sheet"
            role="dialog"
            aria-modal="true"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="sheet-grip" aria-hidden="true" />
            {title && (
              <header className="sheet-head">
                <span className="sheet-title">{title}</span>
                <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
                  <Icon name="close" size={18} />
                </button>
              </header>
            )}
            <div className="sheet-body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    // In fullscreen only the fullscreen element is drawn, so the sheet goes inside it.
    document.fullscreenElement ?? document.body,
  );
}

/** One row of a sheet: a choice, with a tick when it is the current one. */
export function SheetOption({ label, hint, icon, selected, danger, onClick }: { label: ReactNode; hint?: ReactNode; icon?: Parameters<typeof Icon>[0]['name']; selected?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`sheet-option ${selected ? 'is-selected' : ''} ${danger ? 'is-danger' : ''}`} onClick={onClick}>
      {icon && <Icon name={icon} size={19} />}
      <span className="sheet-option-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      {selected && <Icon name="check" size={18} className="sheet-tick" />}
    </button>
  );
}
