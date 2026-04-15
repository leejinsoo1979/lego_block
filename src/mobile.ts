// ----------------------------------------------------------------------
//  Mobile detection & environment utilities.
//
//  Centralizes all the "is this a phone / tablet / touch device?" logic
//  plus helpers for safe-area insets, haptic feedback, and viewport
//  state. Consumed by every mobile-specific UI module so we have one
//  source of truth and tests flip consistently.
// ----------------------------------------------------------------------

export type DeviceType = 'phone' | 'tablet' | 'desktop';

/** Rough classification based on pointer coarseness + viewport width.
 *  We prefer interactivity heuristics (pointer: coarse) over user-agent
 *  sniffing because new devices and hybrid form factors misreport UA. */
export function detectDevice(): DeviceType {
  const hasTouch =
    (typeof matchMedia === 'function' &&
      matchMedia('(pointer: coarse)').matches) ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);

  if (!hasTouch) return 'desktop';

  // Phone vs tablet: use the shorter screen edge. Anything under 768px
  // short-edge is a phone; iPads and larger are tablets.
  const shortEdge = Math.min(window.innerWidth, window.innerHeight);
  return shortEdge < 768 ? 'phone' : 'tablet';
}

export function isMobile(): boolean {
  const d = detectDevice();
  return d === 'phone' || d === 'tablet';
}

export function isPhone(): boolean {
  return detectDevice() === 'phone';
}

export function isTablet(): boolean {
  return detectDevice() === 'tablet';
}

/** Applies mobile-state body classes so CSS can branch. Also reacts to
 *  orientation and resize events — a phone rotated to landscape may
 *  cross the tablet threshold and vice versa. */
export function wireMobileBodyClasses(): void {
  const apply = () => {
    const d = detectDevice();
    document.body.classList.toggle('is-mobile', d !== 'desktop');
    document.body.classList.toggle('is-phone', d === 'phone');
    document.body.classList.toggle('is-tablet', d === 'tablet');
    document.body.classList.toggle('is-desktop', d === 'desktop');

    // Orientation (useful for landscape/portrait-specific layouts)
    const portrait = window.innerHeight >= window.innerWidth;
    document.body.classList.toggle('is-portrait', portrait);
    document.body.classList.toggle('is-landscape', !portrait);
  };
  apply();
  // Re-apply on orientation change / resize. debounce with rAF to avoid
  // thrashing during rotation animations.
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      apply();
    });
  };
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
}

// ----------------------------------------------------------------------
//  Haptic feedback
// ----------------------------------------------------------------------

/** Semantic haptic patterns. Android + some PWAs support
 *  `navigator.vibrate` with ms durations; we no-op gracefully when the
 *  API is missing (iOS Safari doesn't expose Vibration API). */
export type HapticKind =
  | 'tap'       // Button press — 8ms
  | 'place'    // Block placed successfully — short double
  | 'remove'   // Block removed — medium single
  | 'snap'     // Stud snapped into place — two very short pulses
  | 'rotate'   // Block rotated — quick tick
  | 'error'    // Invalid action — long single buzz
  | 'success'; // Saved / loaded — ascending double

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap:     8,
  place:   [8, 24, 12],
  remove:  18,
  snap:    [4, 8, 4],
  rotate:  6,
  error:   60,
  success: [10, 30, 18],
};

/** Fire a haptic pulse. Silently no-ops on unsupported platforms. */
export function haptic(kind: HapticKind): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* some browsers throw when called without a user-gesture context */
  }
}

// ----------------------------------------------------------------------
//  Safe area insets — for layout code that needs the value in JS.
//  CSS should prefer `env(safe-area-inset-*)` directly.
// ----------------------------------------------------------------------

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function getSafeAreaInsets(): SafeAreaInsets {
  const s = getComputedStyle(document.documentElement);
  const read = (v: string) => parseInt(s.getPropertyValue(v) || '0', 10) || 0;
  return {
    top: read('--sai-top'),
    right: read('--sai-right'),
    bottom: read('--sai-bottom'),
    left: read('--sai-left'),
  };
}

/** Publishes the current safe-area insets as CSS variables on :root.
 *  iOS Safari gives us `env(safe-area-inset-*)` directly, but JS can't
 *  read env() — this indirection lets both CSS and JS stay in sync. */
export function wireSafeAreaVariables(): void {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;inset:0;' +
    'padding-top:env(safe-area-inset-top);' +
    'padding-right:env(safe-area-inset-right);' +
    'padding-bottom:env(safe-area-inset-bottom);' +
    'padding-left:env(safe-area-inset-left);';
  document.body.appendChild(el);
  const read = () => {
    const s = getComputedStyle(el);
    document.documentElement.style.setProperty('--sai-top', s.paddingTop);
    document.documentElement.style.setProperty('--sai-right', s.paddingRight);
    document.documentElement.style.setProperty('--sai-bottom', s.paddingBottom);
    document.documentElement.style.setProperty('--sai-left', s.paddingLeft);
  };
  read();
  window.addEventListener('resize', read, { passive: true });
  window.addEventListener('orientationchange', read, { passive: true });
}

// ----------------------------------------------------------------------
//  Viewport height fix — iOS Safari's 100vh includes the URL bar, which
//  pushes content out of view. We publish --vh as a fallback that uses
//  innerHeight and updates on resize.
// ----------------------------------------------------------------------

export function wireViewportHeight(): void {
  const update = () => {
    document.documentElement.style.setProperty(
      '--vh',
      `${window.innerHeight * 0.01}px`
    );
  };
  update();
  window.addEventListener('resize', update, { passive: true });
  window.addEventListener('orientationchange', update, { passive: true });
}

// ----------------------------------------------------------------------
//  Boot — call once at app start. Wires everything.
// ----------------------------------------------------------------------

export function initMobile(): void {
  wireMobileBodyClasses();
  wireSafeAreaVariables();
  wireViewportHeight();
}
