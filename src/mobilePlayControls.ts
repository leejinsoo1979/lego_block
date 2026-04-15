// ----------------------------------------------------------------------
//  Mobile play-mode controls — virtual joystick, swipe camera, action
//  buttons. Visible only on mobile + while game.isPlaying.
// ----------------------------------------------------------------------

import { haptic, isMobile } from './mobile';
import type { Game } from './game';
import * as THREE from 'three';

/** Radius of the joystick background circle (px). */
const STICK_RADIUS = 60;
/** Radius of the draggable thumb. */
const THUMB_RADIUS = 28;
/** Dead zone — movements below this ratio produce zero analog output. */
const DEAD_ZONE = 0.1;
/** Camera swipe sensitivity (radians per screen-pixel). */
const LOOK_SENSITIVITY_X = 0.004;
const LOOK_SENSITIVITY_Y = 0.003;

export function initMobilePlayControls(game: Game): void {
  if (!isMobile()) return;

  const host = document.createElement('div');
  host.id = 'mb-play-controls';
  host.className = 'mb-play-controls';
  host.innerHTML = `
    <!-- Joystick area — bottom-left third of screen is hot zone -->
    <div class="mb-joystick-hotzone" id="mb-joystick-zone"></div>
    <div class="mb-joystick" id="mb-joystick" aria-hidden="true">
      <div class="mb-joystick-ring"></div>
      <div class="mb-joystick-thumb" id="mb-joystick-thumb"></div>
    </div>

    <!-- Camera swipe area — right half of screen -->
    <div class="mb-look-zone" id="mb-look-zone" aria-hidden="true"></div>

    <!-- Action buttons: jump (A), sprint (B), interact (E) -->
    <div class="mb-action-cluster safe-bottom">
      <button class="mb-action-btn mb-action-jump" id="mb-jump" aria-label="점프" type="button">
        <span class="mb-action-label">점프</span>
      </button>
      <button class="mb-action-btn mb-action-sprint" id="mb-sprint" aria-label="달리기" type="button">
        <span class="mb-action-label">달리기</span>
      </button>
      <button class="mb-action-btn mb-action-interact" id="mb-interact" aria-label="상호작용" type="button">
        <span class="mb-action-letter">E</span>
      </button>
    </div>

    <!-- Exit play button — top-left -->
    <button class="mb-play-exit safe-top" id="mb-play-exit" aria-label="플레이 종료" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
      </svg>
      나가기
    </button>

    <!-- 1인칭 / 3인칭 view toggle — top-right, pill segmented control -->
    <div class="mb-view-toggle safe-top" role="radiogroup" aria-label="시점">
      <button class="mb-view-btn is-active" data-view="first" type="button" role="radio" aria-checked="true">1인칭</button>
      <button class="mb-view-btn" data-view="third" type="button" role="radio" aria-checked="false">3인칭</button>
    </div>
  `;
  document.body.appendChild(host);

  wireJoystick(game);
  wireLookZone(game);
  wireActionButtons(game);
  wireExitButton(game);
  wireViewToggle(game);
}

// --------------------------------------------------------------------
//  1인칭 / 3인칭 view toggle
// --------------------------------------------------------------------

function wireViewToggle(game: Game): void {
  const apply = (mode: 'first' | 'third') => {
    document.querySelectorAll<HTMLButtonElement>('.mb-view-btn').forEach((b) => {
      const on = b.dataset.view === mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });
  };
  document.querySelectorAll<HTMLButtonElement>('.mb-view-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const mode = (b.dataset.view || 'first') as 'first' | 'third';
      haptic('tap');
      game.setViewMode(mode);
      apply(mode);
    });
  });
  // Mirror state when changed elsewhere (e.g. the V key)
  const prev = game.onViewModeChange;
  game.onViewModeChange = (mode) => {
    prev?.(mode);
    apply(mode);
  };
  apply(game.viewMode);
}

// --------------------------------------------------------------------
//  Virtual joystick (left side)
// --------------------------------------------------------------------

function wireJoystick(game: Game): void {
  const zone = document.getElementById('mb-joystick-zone');
  const stick = document.getElementById('mb-joystick');
  const thumb = document.getElementById('mb-joystick-thumb');
  if (!zone || !stick || !thumb) return;

  let pointerId: number | null = null;
  let centerX = 0;
  let centerY = 0;

  const show = (x: number, y: number) => {
    centerX = x;
    centerY = y;
    stick.style.left = `${x - STICK_RADIUS}px`;
    stick.style.top = `${y - STICK_RADIUS}px`;
    stick.classList.add('is-active');
    thumb.style.transform = 'translate(0, 0)';
  };
  const hide = () => {
    stick.classList.remove('is-active');
    game.analogMove.x = 0;
    game.analogMove.y = 0;
  };
  const updateThumb = (dx: number, dy: number) => {
    const dist = Math.hypot(dx, dy);
    const max = STICK_RADIUS - THUMB_RADIUS;
    let tx = dx;
    let ty = dy;
    if (dist > max) {
      const s = max / dist;
      tx = dx * s;
      ty = dy * s;
    }
    thumb.style.transform = `translate(${tx}px, ${ty}px)`;
    // Normalize to -1..1 based on the STICK_RADIUS clamp
    const nx = Math.max(-1, Math.min(1, dx / max));
    const nyRaw = Math.max(-1, Math.min(1, dy / max));
    // Joystick up (screen-y negative) = forward (game y positive)
    const ny = -nyRaw;
    // Dead zone
    const magSq = nx * nx + ny * ny;
    if (magSq < DEAD_ZONE * DEAD_ZONE) {
      game.analogMove.x = 0;
      game.analogMove.y = 0;
    } else {
      game.analogMove.x = nx;
      game.analogMove.y = ny;
    }
  };

  zone.addEventListener('pointerdown', (e) => {
    if (!game.isPlaying) return;
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    show(e.clientX, e.clientY);
    haptic('tap');
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    updateThumb(e.clientX - centerX, e.clientY - centerY);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    hide();
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}

// --------------------------------------------------------------------
//  Camera look swipe (right side)
// --------------------------------------------------------------------

function wireLookZone(game: Game): void {
  const zone = document.getElementById('mb-look-zone');
  if (!zone) return;

  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;

  zone.addEventListener('pointerdown', (e) => {
    if (!game.isPlaying) return;
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    lastX = e.clientX;
    lastY = e.clientY;
  });

  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    rotateCamera(game, dx * LOOK_SENSITIVITY_X, dy * LOOK_SENSITIVITY_Y);
  });

  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}

/** Applies yaw / pitch to the game camera. Uses a YXZ Euler so tilting
 *  up/down stays level — the camera never rolls. Clamps pitch so the
 *  user can't flip upside down. */
function rotateCamera(game: Game, dYaw: number, dPitch: number): void {
  const g = game as unknown as { camera: THREE.PerspectiveCamera };
  const e = new THREE.Euler().setFromQuaternion(g.camera.quaternion, 'YXZ');
  e.y -= dYaw;
  e.x -= dPitch;
  // Clamp pitch to ±85° to prevent gimbal flip
  const maxPitch = (Math.PI / 2) * 0.94;
  e.x = Math.max(-maxPitch, Math.min(maxPitch, e.x));
  g.camera.quaternion.setFromEuler(e);
}

// --------------------------------------------------------------------
//  Action buttons — jump / sprint / interact
// --------------------------------------------------------------------

function wireActionButtons(game: Game): void {
  const jump = document.getElementById('mb-jump');
  const sprint = document.getElementById('mb-sprint');
  const interact = document.getElementById('mb-interact');

  // Jump — tap triggers a single jump; hold triggers repeated jumps
  // (mirror desktop Space key-repeat).
  if (jump) {
    let interval: number | null = null;
    const trigger = () => {
      game.mobileJumpPressed = true;
      haptic('tap');
    };
    jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      trigger();
      interval = window.setInterval(trigger, 180);
    });
    const stop = () => {
      if (interval != null) {
        clearInterval(interval);
        interval = null;
      }
    };
    jump.addEventListener('pointerup', stop);
    jump.addEventListener('pointercancel', stop);
    jump.addEventListener('pointerleave', stop);
  }

  // Sprint — hold while pressed
  if (sprint) {
    const down = (e: Event) => {
      e.preventDefault();
      game.mobileRunning = true;
      sprint.classList.add('is-held');
      haptic('tap');
    };
    const up = () => {
      game.mobileRunning = false;
      sprint.classList.remove('is-held');
    };
    sprint.addEventListener('pointerdown', down);
    sprint.addEventListener('pointerup', up);
    sprint.addEventListener('pointercancel', up);
    sprint.addEventListener('pointerleave', up);
  }

  // Interact (E key) — tap fires a synthetic keydown/keyup
  if (interact) {
    interact.addEventListener('click', (e) => {
      e.preventDefault();
      haptic('tap');
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
    });
  }
}

// --------------------------------------------------------------------
//  Exit button
// --------------------------------------------------------------------

function wireExitButton(game: Game): void {
  document.getElementById('mb-play-exit')?.addEventListener('click', () => {
    haptic('tap');
    if (game.isPlaying) game.stopPlay();
  });
}
