import { useEffect, useState } from 'react';
import { Button, IconButton } from './Controls';
import { Icon } from './Icon';
import './mobilenotice.css';

const MODAL_DISMISSED_KEY = 'playzanime:mobile-notice-modal-dismissed';
const STRIP_DISMISSED_KEY = 'playzanime:mobile-notice-strip-dismissed';

export function isMobileOrAndroidDevice(): { isMobile: boolean; isAndroid: boolean } {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { isMobile: false, isAndroid: false };
  }
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isMobile = isAndroid || /iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua) || window.matchMedia('(max-width: 768px)').matches;
  return { isMobile, isAndroid };
}

export function MobileNotice() {
  const [modalOpen, setModalOpen] = useState(false);
  const [stripOpen, setStripOpen] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    const { isMobile, isAndroid: android } = isMobileOrAndroidDevice();
    setIsAndroid(android);

    if (isMobile) {
      try {
        const modalDismissed = sessionStorage.getItem(MODAL_DISMISSED_KEY) === '1';
        if (!modalDismissed) {
          setModalOpen(true);
        }
        const stripDismissed = sessionStorage.getItem(STRIP_DISMISSED_KEY) === '1';
        if (!stripDismissed) {
          setStripOpen(true);
        }
      } catch {
        setModalOpen(true);
        setStripOpen(true);
      }
    }
  }, []);

  const handleDismissModal = () => {
    try {
      sessionStorage.setItem(MODAL_DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
    setModalOpen(false);
  };

  const handleDismissStrip = () => {
    try {
      sessionStorage.setItem(STRIP_DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
    setStripOpen(false);
  };

  return (
    <>
      {/* Modal notice for mobile/Android visitors on load */}
      {modalOpen && (
        <div className="mobile-notice-overlay" onClick={handleDismissModal}>
          <div className="mobile-notice-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <header className="mobile-notice-head">
              <div className="mobile-notice-title-row">
                <Icon name="alert" size={20} className="mobile-notice-icon" />
                <h2 className="mobile-notice-title">
                  {isAndroid ? 'Android Display Notice' : 'Mobile Display Notice'}
                </h2>
              </div>
              <IconButton icon="close" label="Close notice" size={17} onClick={handleDismissModal} />
            </header>

            <div className="mobile-notice-body">
              <p className="mobile-notice-lead">
                Hey! If you are on {isAndroid ? 'Android' : 'a mobile device'}, this website is <strong>best viewed on a laptop, TV, or desktop monitor</strong>.
              </p>
              <p className="mobile-notice-desc">
                We do not have Android or phone support for web viewing right now. The player, controls, and catalog layout are currently scattered and unoptimized on small touch screens.
              </p>
              <div className="mobile-notice-pill">
                <span className="mobile-notice-pill-tag">Android App Coming Soon</span>
                <p className="mobile-notice-pill-text">
                  A dedicated native Android app with hardware-accelerated streaming and offline downloads is in development.
                </p>
              </div>
            </div>

            <footer className="mobile-notice-foot">
              <Button variant="primary" onClick={handleDismissModal} style={{ width: '100%', justifyContent: 'center' }}>
                Exit and Continue
              </Button>
            </footer>
          </div>
        </div>
      )}

      {/* Persistent slim warning strip on mobile viewport */}
      {!modalOpen && stripOpen && (
        <aside className="mobile-top-strip" role="note">
          <div className="mobile-top-strip-text">
            <Icon name="alert" size={15} style={{ color: 'var(--accent, #e54d2e)', flexShrink: 0 }} />
            <span>
              <strong>{isAndroid ? 'Android' : 'Mobile'} Notice:</strong> Best viewed on laptop, TV or monitor. Android app coming soon.
            </span>
          </div>
          <IconButton icon="close" label="Dismiss banner" size={14} onClick={handleDismissStrip} />
        </aside>
      )}
    </>
  );
}
