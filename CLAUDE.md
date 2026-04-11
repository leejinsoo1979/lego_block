# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (the only thing you need for iterating on the UI/3D scene).
- `npm run build` — Type-check (`tsc`) then `vite build`. Use this to verify type correctness; there is no separate lint or test command.
- `npm run preview` — Serve the production build.

There is no test suite. "Verifying a change" means running `npm run build` for types and exercising the feature in `npm run dev` in a browser.

## Architecture

This is a Three.js Lego-builder single-page app (Korean UI). Vanilla TypeScript, no framework. Entry: `index.html` → `src/main.ts` → instantiates `Game` and wires up `buildUI`.

The codebase is small (~7 files in `src/`) and split by responsibility, not by feature. The interesting coupling is between `config.ts`, `blocks.ts`, and `game.ts` — changes to one usually require touching the others.

### The world grid (`src/config.ts`)

Three constants define the entire coordinate system. Read these before changing anything spatial:

- `PLATE_HEIGHT = 0.4` — one Lego plate in world units. **All vertical snapping is in plate increments.**
- `BRICK_PLATES = 3` — a brick is 3 plates tall (1.2 units).
- `GRID = { X: 1, Y: PLATE_HEIGHT, Z: 1 }` — 1 stud = 1 world unit on the horizontal plane.
- `BOARD_SIZE = 40` — the baseplate is 40×40 studs, centered on the origin.

Block geometry in `blocks.ts` is built from these — `createBrick` derives body height from `type` (`brick` = 3 plates, `plate`/`tile` = 1 plate) and lays out studs on integer offsets. **Origin convention: every brick/minifig group has its origin at the BOTTOM CENTER**, so placement code can write `obj.position.set(x, bottomY, z)` directly.

### Placement pipeline (`src/game.ts`)

Placement is a single chain in `Game.computePlacement()` that future edits should preserve:

1. Raycast from the pointer against `[baseplate, brickGroup]`.
2. Reject hits whose **world-space face normal** has `y < 0.5` — you can only place on top surfaces, never sides.
3. Snap the hit point: XZ via `snapXZ` (which offsets by 0.5 for odd-width footprints so studs stay aligned), Y via `snapBottomY` (floor to plate increments).
4. Reject if the snapped footprint would extend outside the baseplate.

`effectiveSize()` is the single source of truth for the current footprint — it folds in both the size selector and the rotated flag, and special-cases minifig (fixed 2×1 footprint regardless of `size`). Use it instead of reading `game.size` directly when you need the placed footprint.

There is no overlap/collision check on placement — bricks can intersect. The play-mode collider (see below) treats whatever exists as solid.

### The "ghost" preview vs the real block

`updateGhost()` reuses the same `THREE.Object3D` across frames and only **recreates** it when type/size/rotation/character changes (`needsRecreate`). For non-minifig bricks where only the color changed, it mutates the existing material in place. When extending block types, preserve this fast path or you'll allocate per-frame.

Minifig ghosts are produced by cloning the full minifig (`createMinifigGhost`) and setting all materials to `transparent: true, opacity: 0.5` — they are NOT a translucent box like brick ghosts.

### Brick storage and removal

All placed objects live in `Game.brickGroup`. Each block group is tagged with `userData.isBrick = true` (set in both `createBrick` and `createMinifigure`). The remove path raycasts hits and **walks up the parent chain looking for `userData.isBrick`** before deleting — preserve this tag on any new placeable type or removal will silently no-op.

### Build mode vs Play mode

The same `Game` instance handles both modes. The transition is in `startPlay()`/`stopPlay()`:

- **Build mode** uses `OrbitControls`. Mouse buttons are remapped: LEFT and MIDDLE rotate the camera; RIGHT is set to `null` because right-click is reserved for rotating the current block. `wasDrag` distinguishes a click from a drag (5px threshold) so dragging the camera doesn't place a brick on release.
- **Play mode** uses `PointerLockControls` for FPS look. On entry, it freezes a snapshot of every brick into `playAABBs: THREE.Box3[]` — collision is just AABB-vs-AABB against this frozen list. **Bricks placed during play mode are not in the collider** (you can't place during play anyway, but be aware if extending). On exit, the build camera state saved into `savedCam` is restored.
- `updatePlayMode` does the standard 3-axis swept move (X, then Z, then Y) with gravity, jump, and `findGroundY` for stepping up onto landed bricks. Movement constants live at the top of the function.

### Keyboard event handling quirk

`onKeyDown`/`onKeyUp` are bound to **both `window` and `document` (capture phase)** so play-mode WASD works regardless of focus. The `lastKeyEvent`/`lastKeyUpEvent` guards exist to suppress the resulting double-fire — don't remove them. Play-mode keys `preventDefault()` and `stopPropagation()` so Space doesn't scroll the page or re-trigger the focused Play button (which is also why `playBtn.blur()` runs on click).

### UI layer (`src/ui.ts`)

`buildUI(game)` is one-shot DOM wiring against the static structure in `index.html`. It works by:

1. Reading lists from `config.ts` (`BLOCK_TYPES`, `COLORS`, `SIZES`, `MINIFIG_PRESETS`) and generating buttons.
2. Assigning callbacks to `game.on*Change` fields. The Game emits state via these — there is no event bus.

To add a new selectable option (color, size, block type, minifig preset), append to the list in `config.ts` and the UI will pick it up automatically. The character panel auto-shows/hides based on whether the selected block type is `minifig` (`updateTypeVisibility`).

### Thumbnails (`src/thumbnails.ts`)

A second offscreen `WebGLRenderer` generates `data:image/png` URLs for the type and character buttons by rendering `createBrick`/`createMinifigure` into a small scene. It reuses one renderer/scene/camera across all calls. Cheap because it only runs during `buildUI`, but it does mean adding a new block type requires adding a camera-position case in `renderBlockTypeThumbnail`.

### Sound (`src/sound.ts`)

`SoundManager` synthesizes click/remove sounds entirely via Web Audio (no asset files). The `AudioContext` is created lazily on first play to satisfy autoplay policies.

## Conventions worth keeping

- **No external test/lint tooling.** Don't add `eslint`/`prettier`/`vitest` configs unless asked.
- **Korean UI strings** in `index.html` and the `label` fields in `config.ts` — preserve the language when editing.
- **TypeScript is strict** (`strict`, `noUnusedLocals`, `noUnusedParameters`). Removing a parameter needs `_` prefix or full removal — `tsc` will fail otherwise.
- **Debug hook**: `main.ts` exposes the `Game` instance at `window.__game__` for browser-console poking.

## 레고 블록 기본 규격

Reference sheet for the real-world Lego dimensions the constants in `src/config.ts` are derived from. The engine runs in stud-pitch units (1 unit = 1 stud pitch = 8.0 mm), so every mm value below divided by 8.0 gives the value used in code. Consult this when adding new block geometry, sizing studs/tubes, or deciding body heights.

**1. 스터드 중심 간격 (Pitch)**
- 8.0 mm

**2. 스터드 지름**
- 4.8 mm

**3. 스터드 높이**
- 1.8 mm

**4. 기본 브릭 높이 (1 brick)**
- 9.6 mm

**5. 플레이트 높이 (1 plate)**
- 3.2 mm

**6. 타일 높이**
- 3.2 mm
- 단, 타일은 스터드가 없음

**7. 브릭 벽 두께**
- 약 1.5 mm ~ 1.6 mm

**8. 브릭 하부 튜브 외경**
- 약 6.51 mm

**9. 브릭 하부 튜브 내경**
- 약 4.8 mm

**10. 1 × 1 브릭 외형 크기**
- 가로 8.0 mm
- 세로 8.0 mm
- 높이 9.6 mm

**11. 1 × 2 브릭 외형 크기**
- 가로 8.0 mm
- 세로 16.0 mm
- 높이 9.6 mm

**12. 2 × 2 브릭 외형 크기**
- 가로 16.0 mm
- 세로 16.0 mm
- 높이 9.6 mm

**13. 2 × 4 브릭 외형 크기**
- 가로 16.0 mm
- 세로 32.0 mm
- 높이 9.6 mm

**14. 1 × 1 플레이트 외형 크기**
- 가로 8.0 mm
- 세로 8.0 mm
- 높이 3.2 mm

**15. 1 × 2 플레이트 외형 크기**
- 가로 8.0 mm
- 세로 16.0 mm
- 높이 3.2 mm

**16. 2 × 2 플레이트 외형 크기**
- 가로 16.0 mm
- 세로 16.0 mm
- 높이 3.2 mm

**17. 2 × 4 플레이트 외형 크기**
- 가로 16.0 mm
- 세로 32.0 mm
- 높이 3.2 mm

**18. 높이 환산**
- 1 brick = 3 plates = 9.6 mm
- 1 plate = 3.2 mm
