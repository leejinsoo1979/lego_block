// ----------------------------------------------------------------------
//  Accessibility helpers — reduced motion, ARIA live region, focus
//  restoration, colorblind-mode toggle.
// ----------------------------------------------------------------------

/** Global live region for screen-reader announcements. Created once at
 *  boot and reused for toast / state-change messages. */
let liveRegion: HTMLElement | null = null;

export function initA11y(): void {
  createLiveRegion();
  wireReducedMotionClass();
  wireColorblindToggle();
  enhanceAria();
}

function createLiveRegion(): void {
  if (liveRegion) return;
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.className = 'sr-only';
  el.id = 'a11y-live';
  document.body.appendChild(el);
  liveRegion = el;
}

/** Announce `text` to screen readers. Visible UI toasts should also
 *  call this so users who rely on VoiceOver / TalkBack hear the same
 *  messages sighted users see. */
export function announce(text: string): void {
  if (!liveRegion) return;
  // Clearing + re-setting makes most screen readers re-announce even
  // if the same text was just spoken.
  liveRegion.textContent = '';
  requestAnimationFrame(() => {
    if (liveRegion) liveRegion.textContent = text;
  });
}

function wireReducedMotionClass(): void {
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const apply = () => {
    document.body.classList.toggle('reduced-motion', mq.matches);
  };
  apply();
  mq.addEventListener('change', apply);
}

function wireColorblindToggle(): void {
  // Persisted across sessions. Toggle via a URL flag for now:
  // ?a11y=colorblind sets it, ?a11y=off clears it.
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('a11y') === 'colorblind') {
      localStorage.setItem('legoworld:cb-mode', '1');
    } else if (params.get('a11y') === 'off') {
      localStorage.removeItem('legoworld:cb-mode');
    }
    if (localStorage.getItem('legoworld:cb-mode') === '1') {
      document.body.classList.add('cb-mode');
    }
  } catch {
    /* storage unavailable (private mode) — silent */
  }
}

/** Apply ARIA attributes + labels to interactive elements that the
 *  module-building code didn't get to. This runs late so it sees the
 *  DOM after every UI module has rendered. */
function enhanceAria(): void {
  // Re-run whenever a mutation is observed so new buttons (e.g. from
  // renderGrid) also get labeled. Throttled to avoid churn.
  let queued = false;
  const apply = () => {
    queued = false;
    // Ensure every icon-only button has an accessible name
    document
      .querySelectorAll<HTMLButtonElement>(
        'button:not([aria-label]):not([title]):not(.type-btn):not(.mb-sheet-item):not(.mb-hot-slot)'
      )
      .forEach((b) => {
        // If the button has text content, that already serves as label
        if (b.textContent?.trim()) return;
        // Nothing semantic inside — fall back to a generic label to
        // avoid "button" being read alone.
        b.setAttribute('aria-label', '버튼');
      });
  };
  apply();

  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(apply);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}
