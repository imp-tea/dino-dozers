# AGENTS.md

## Project Overview

- Small Vite app for an interactive canvas dirt/excavator simulation.
- Entry points:
  - `index.html` defines the toolbar, canvas, and control panel.
  - `app.js` contains the simulation, rendering, input handling, Planck physics, and SVG asset wiring.
  - `styles.css` contains all layout and responsive styling.
  - `excavator_images/` holds SVG parts imported with Vite `?raw`.
- Build output and dependencies are generated: do not edit `dist/` or `node_modules/`.

## Commands

- Install deps: `npm install`
- Start dev server: `npm run dev`
- Production build: `npm run build`
- Preview built app: `npm run preview`

There is currently no dedicated test script; use `npm run build` as the baseline verification after code changes.

## Implementation Notes

- This is a plain browser app using ES modules and `planck` for physics. Keep new code framework-free unless the project is intentionally expanded.
- `app.js` is stateful and organized around module-level constants, state objects, simulation steps, rendering helpers, vehicle/excavator helpers, and event listeners.
- Dirt grid state uses typed/array-like indexed storage with `index(x, y)` and `inBounds(x, y)` helpers. Prefer those helpers over ad hoc coordinate math.
- Physics terrain and contour caches are explicitly dirtied with flags such as `isPhysicsTerrainDirty` and `isPackedContourCacheDirty`. When changing terrain behavior, make sure the relevant dirty flags and stats cache are updated.
- Canvas sizing is managed through `canvasLayout`, `syncCanvasLayout()`, and `markCanvasLayoutDirty()`. Avoid directly coupling simulation grid size to CSS pixels.
- Imported SVG assets are used as raw strings and converted to images in `createExcavatorImages()`. Keep asset filenames stable unless all imports and metadata in `excavatorSvg` are updated together.

## Style Guidelines

- Use modern JavaScript modules, `const` by default, and existing helper functions before adding new ones.
- Keep comments sparse and useful; most of this app is easier to understand through well-named helpers and constants.
- Preserve the compact control-panel UI. If adding controls, update both `index.html` bindings and related value display logic in `app.js`.
- Keep CSS responsive behavior in the existing breakpoints (`980px`, `620px`) unless a layout change requires otherwise.
- Use ASCII text in source files unless existing content or asset requirements justify otherwise.

## Verification Checklist

- Run `npm run build`.
- For visual or input changes, also run `npm run dev` and check:
  - canvas renders and resizes correctly,
  - painting packed/loose/erase works,
  - simulation pause, step, seed, clear, and grid resize controls still work,
  - excavator reset, keyboard/gamepad/pointer arm controls remain responsive when touched.

