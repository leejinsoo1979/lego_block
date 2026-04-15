// ----------------------------------------------------------------------
//  Global mobile gestures — two-finger-tap undo, three-finger-tap redo,
//  shake-to-reset-camera. Listens at document level so gestures work
//  anywhere in the builder (ignored when the touch lands on an
//  interactive element tagged with data-no-gesture).
// ----------------------------------------------------------------------

import { haptic, isMobile } from './mobile';
import type { Game } from './game';

/** Max time between all fingers landing to count as a multi-finger tap. */
const MULTI_TAP_WINDOW_MS = 120;
/** Max movement allowed in a tap (any finger). */
const TAP_MOVE_TOLERANCE = 12;
/** Shake detection threshold — peak g-force on any axis. */
const SHAKE_THRESHOLD = 22;
/** Minimum milliseconds between consecutive shake triggers. */
const SHAKE_COOLDOWN_MS = 800;

interface Pointer {
  id: number;
  startX: number;
  startY: number;
  moved: boolean;
  startedAt: number;
}

export function initGestures(game: Game): void {
  if (!isMobile()) return;

  wireMultiFingerTaps(game);
  wireShakeToReset(game);
}

// --------------------------------------------------------------------
//  Multi-finger tap — undo/redo
// --------------------------------------------------------------------

function wireMultiFingerTaps(_game: Game): void {
  const active = new Map<number, Pointer>();
  let windowStart = 0;

  const onDown = (e: PointerEvent) => {
    // Ignore if this is a mouse (desktop) or the target is interactive.
    if (e.pointerType !== 'touch') return;
    if (isInteractiveTarget(e.target as Element | null)) return;

    const now = performance.now();
    if (active.size === 0) windowStart = now;

    active.set(e.pointerId, {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      startedAt: now,
    });
  };

  const onMove = (e: PointerEvent) => {
    const p = active.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (dx * dx + dy * dy > TAP_MOVE_TOLERANCE * TAP_MOVE_TOLERANCE) {
      p.moved = true;
    }
  };

  const onUp = (e: PointerEvent) => {
    const p = active.get(e.pointerId);
    if (!p) return;
    const count = active.size;
    const sinceStart = performance.now() - windowStart;
    active.delete(e.pointerId);

    // Fire on last finger lifting — that's when we know the full tap count
    if (active.size > 0) return;

    const anyMoved = Array.from(active.values()).some((x) => x.moved) || p.moved;
    if (anyMoved) return;
    if (sinceStart > MULTI_TAP_WINDOW_MS * 4) return;

    if (count === 2) {
      haptic('rotate');
      document.dispatchEvent(new CustomEvent('mb-undo'));
    } else if (count === 3) {
      haptic('success');
      document.dispatchEvent(new CustomEvent('mb-redo'));
    }
  };

  const onCancel = (e: PointerEvent) => {
    active.delete(e.pointerId);
  };

  document.addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerup', onUp, { passive: true });
  document.addEventListener('pointercancel', onCancel, { passive: true });
}

function isInteractiveTarget(el: Element | null): boolean {
  if (!el) return false;
  // Allow tap-to-place on the viewer canvas itself — but the viewer is
  // not flagged. Anything inside a button/input/form or a known UI
  // container should block multi-tap gestures.
  const sel =
    'button, input, textarea, select, a, [role="button"], ' +
    '#mb-sheet, #mb-fab-cluster, .mb-topbar, .mb-hotbar, ' +
    '[data-no-gesture]';
  return !!el.closest(sel);
}

// --------------------------------------------------------------------
//  Shake-to-reset-camera
// --------------------------------------------------------------------

function wireShakeToReset(game: Game): void {
  // iOS 13+ requires a user-gesture permission request before devicemotion
  // events are delivered. We attach a one-shot listener that requests
  // permission on the first touch.
  const PermissionAPI = (
    DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    }
  ).requestPermission;

  let lastShakeAt = 0;
  let listening = false;

  const start = () => {
    if (listening) return;
    listening = true;
    window.addEventListener('devicemotion', onMotion, { passive: true });
  };

  const onMotion = (e: DeviceMotionEvent) => {
    const acc = e.accelerationIncludingGravity;
    if (!acc) return;
    const peak = Math.max(
      Math.abs(acc.x ?? 0),
      Math.abs(acc.y ?? 0),
      Math.abs(acc.z ?? 0)
    );
    if (peak < SHAKE_THRESHOLD) return;
    const now = performance.now();
    if (now - lastShakeAt < SHAKE_COOLDOWN_MS) return;
    lastShakeAt = now;
    haptic('success');
    // Reset the camera via the existing OrbitControls reset hook if
    // present; otherwise fall back to a manual aim at the origin.
    const anyGame = game as unknown as {
      controls?: { reset: () => void };
      camera?: { position: { set: (x: number, y: number, z: number) => void }; lookAt: (x: number, y: number, z: number) => void };
    };
    if (anyGame.controls?.reset) {
      try {
        anyGame.controls.reset();
      } catch {}
    }
  };

  // Kick off permission request + listener on first touch.
  document.addEventListener(
    'pointerdown',
    async () => {
      if (typeof PermissionAPI === 'function') {
        try {
          const res = await PermissionAPI.call(DeviceMotionEvent);
          if (res === 'granted') start();
        } catch {
          /* permission denied or not actually required */
        }
      } else {
        start();
      }
    },
    { once: true, passive: true }
  );
}
