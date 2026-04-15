// ----------------------------------------------------------------------
//  PWA registration — service worker + install prompt.
// ----------------------------------------------------------------------

import { isMobile } from './mobile';

export function initPWA(): void {
  registerServiceWorker();
  wireInstallPrompt();
}

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // Wait for load so SW registration doesn't compete with critical
  // asset downloads on first visit.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('[pwa] SW registration failed:', err));
  });
}

// --------------------------------------------------------------------
//  Install prompt — show a polite bottom banner on mobile after the
//  browser fires the `beforeinstallprompt` event.
// --------------------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'legoworld:pwa-install-dismissed';

function wireInstallPrompt(): void {
  let deferred: BeforeInstallPromptEvent | null = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the default mini-infobar
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    // Only surface the CTA on mobile and not if the user dismissed it
    if (!isMobile()) return;
    if (sessionStorage.getItem(DISMISSED_KEY) === '1') return;
    showInstallBanner(() => {
      deferred?.prompt();
      deferred?.userChoice.then(() => {
        deferred = null;
      });
    });
  });

  window.addEventListener('appinstalled', () => {
    hideInstallBanner();
    console.log('[pwa] app installed to home screen');
  });
}

function showInstallBanner(onInstall: () => void): void {
  if (document.getElementById('pwa-install-banner')) return;
  const el = document.createElement('div');
  el.id = 'pwa-install-banner';
  el.className = 'pwa-install-banner';
  el.innerHTML = `
    <div class="pwa-banner-body">
      <div class="pwa-banner-icon">🧱</div>
      <div class="pwa-banner-text">
        <div class="pwa-banner-title">홈 화면에 추가</div>
        <div class="pwa-banner-sub">앱처럼 빠르게 실행해요</div>
      </div>
    </div>
    <div class="pwa-banner-actions">
      <button class="pwa-banner-dismiss" type="button" aria-label="닫기">나중에</button>
      <button class="pwa-banner-install" type="button">설치</button>
    </div>
  `;
  document.body.appendChild(el);
  el.querySelector('.pwa-banner-install')?.addEventListener('click', () => {
    onInstall();
    hideInstallBanner();
  });
  el.querySelector('.pwa-banner-dismiss')?.addEventListener('click', () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    hideInstallBanner();
  });
}

function hideInstallBanner(): void {
  document.getElementById('pwa-install-banner')?.remove();
}
