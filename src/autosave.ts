// ----------------------------------------------------------------------
//  Auto-save — periodically snapshots the current scene to localStorage
//  so a refresh, crash, or accidental tab close doesn't lose work.
//  Works for guests too (no Supabase round-trip).
//
//  On boot, if a snapshot exists from a previous session, the user is
//  asked whether to restore it.
// ----------------------------------------------------------------------

import { serializeMap, deserializeMap } from './mapStorage';
import type { MapData } from './supabase';
import type { Game } from './game';

const KEY = 'legoworld:autosave';
const META_KEY = 'legoworld:autosave-meta';
const INTERVAL_MS = 30_000;
const MIN_BLOCKS_TO_SAVE = 1;

let intervalId: number | null = null;
let lastSavedHash = '';

interface AutosaveMeta {
  savedAt: number;          // epoch ms
  blockCount: number;
}

export function initAutosave(game: Game): void {
  // Offer to restore a previous session FIRST (before the user starts
  // building, otherwise we'd overwrite their fresh blocks).
  maybeOfferRestore(game);

  // Snapshot every 30s if the scene actually changed since last save.
  if (intervalId != null) clearInterval(intervalId);
  intervalId = window.setInterval(() => {
    snapshot(game);
  }, INTERVAL_MS);

  // Snapshot on tab hide/close so unsaved work survives a quick close.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) snapshot(game);
  });
  window.addEventListener('beforeunload', () => snapshot(game));
}

function snapshot(game: Game): void {
  try {
    const g = game as unknown as { brickGroup: { children: unknown[] } };
    if (g.brickGroup.children.length < MIN_BLOCKS_TO_SAVE) return;
    const data = serializeMap(game);
    // Hash by JSON stringify length — fast, good enough to skip
    // identical writes. (Avoids burning storage on idle.)
    const json = JSON.stringify(data);
    const hash = `${json.length}:${data.blocks.length}`;
    if (hash === lastSavedHash) return;
    localStorage.setItem(KEY, json);
    const meta: AutosaveMeta = {
      savedAt: Date.now(),
      blockCount: data.blocks.length,
    };
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    lastSavedHash = hash;
  } catch (err) {
    // Quota exceeded or storage disabled — fail silently
    console.warn('[autosave] snapshot failed:', err);
  }
}

function maybeOfferRestore(game: Game): void {
  try {
    const raw = localStorage.getItem(KEY);
    const metaRaw = localStorage.getItem(META_KEY);
    if (!raw || !metaRaw) return;
    const meta: AutosaveMeta = JSON.parse(metaRaw);
    if (!meta.blockCount) return;
    const minutesAgo = Math.round((Date.now() - meta.savedAt) / 60_000);
    const ageLabel =
      minutesAgo < 1 ? '방금' : minutesAgo < 60 ? `${minutesAgo}분 전` : `${Math.floor(minutesAgo / 60)}시간 전`;

    // Defer the prompt slightly so the rest of the UI mounts first.
    setTimeout(() => {
      showRestoreBanner(meta, ageLabel, () => {
        try {
          const data: MapData = JSON.parse(raw);
          deserializeMap(game, data);
        } catch (err) {
          console.error('[autosave] restore failed:', err);
          alert('복구에 실패했습니다.');
          clearAutosave();
        }
      });
    }, 600);
  } catch {
    /* corrupt — clear so we don't keep prompting */
    clearAutosave();
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(META_KEY);
    lastSavedHash = '';
  } catch {}
}

// --------------------------------------------------------------------
//  Restore banner UI
// --------------------------------------------------------------------

function showRestoreBanner(
  meta: AutosaveMeta,
  ageLabel: string,
  onRestore: () => void
): void {
  if (document.getElementById('autosave-banner')) return;
  const el = document.createElement('div');
  el.id = 'autosave-banner';
  el.className = 'autosave-banner';
  el.innerHTML = `
    <div class="autosave-banner-body">
      <div class="autosave-banner-icon">💾</div>
      <div class="autosave-banner-text">
        <div class="autosave-banner-title">이전 작업 복구</div>
        <div class="autosave-banner-sub">${ageLabel} · ${meta.blockCount}개 블록</div>
      </div>
    </div>
    <div class="autosave-banner-actions">
      <button class="autosave-banner-dismiss" type="button">새로 시작</button>
      <button class="autosave-banner-restore" type="button">복구</button>
    </div>
  `;
  document.body.appendChild(el);
  el.querySelector('.autosave-banner-restore')?.addEventListener('click', () => {
    onRestore();
    el.remove();
  });
  el.querySelector('.autosave-banner-dismiss')?.addEventListener('click', () => {
    clearAutosave();
    el.remove();
  });
  // Auto-dismiss after 30s if user ignores it
  setTimeout(() => el.remove(), 30_000);
}
