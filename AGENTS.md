# AGENTS.md

## Project Overview

- Small Vite app for an interactive canvas dirt simulation with a Planck-powered Wreckersaurus vehicle.
- The app is plain browser JavaScript using ES modules. Keep new code framework-free unless the project is intentionally expanded.
- Runtime source lives in `src/`. Generated output and dependencies are not source: do not edit `dist/` or `node_modules/`.

## Repo Map

- `index.html` defines the static DOM: toolbar buttons, canvas, control panel inputs, IDs/classes consumed by `src/main.js` and `src/ui/controls.js`.
- `styles.css` owns page layout, canvas/control-panel presentation, and responsive breakpoints.
- `src/main.js` is the composition root and main loop. It wires DOM, Planck world setup, grid state, dirt simulation, physics terrain, rigid influence, rendering, vehicle manager, pointer/keyboard/gamepad events, seeding, clearing, resizing, and frame stepping.

## Simulation Files

- `src/sim/cellTypes.js` defines dirt cell enum values: `EMPTY`, `LOOSE`, and `PACKED`.
- `src/sim/materials.js` defines material metadata and the default material ID.
- `src/sim/grid.js` owns grid state allocation and cell helpers. Use `createGridState()`, `createGrid()`, `index(x, y)`, `inBounds(x, y)`, `setCell()`, and `clearCell()` instead of ad hoc coordinate math.
- `src/sim/dirtSimulation.js` owns dirt behavior: loose particle movement, packing, support/stress analysis, packed cluster failure, rigid-body terrain effects, velocities, damage, and fatigue.
- `src/sim/packedContours.js` builds and caches contour polygons around packed dirt for rendering and Planck terrain collision.

## Physics Files

- `src/physics/terrain.js` turns packed contour polygons into a static Planck chain body. Mark it dirty when packed terrain changes.
- `src/physics/rigidInfluence.js` rasterizes registered Planck bodies into the dirt grid's `rigid*` arrays, including local velocity and mass/load contribution.

## Rendering Files

- `src/render/canvasLayout.js` owns high-DPI canvas sizing, cell dimensions, aspect-preserving fit, and layout dirty state.
- `src/render/dirtRenderer.js` draws dirt cells, stress/damage colors, loose particle interpolation, brush preview, and stats text.

## UI And Input Files

- `src/ui/controls.js` binds DOM controls, exposes parsed range values and checkbox/button references, and identifies editable targets for keyboard handling.
- `src/input/inputState.js` creates shared keyboard, pointer-arm, and gamepad state consumed by `src/main.js` and the active vehicle.

## Vehicle Files

- `src/vehicles/vehicleTypes.js` holds vehicle type identifiers.
- `src/vehicles/vehicleManager.js` is a thin active-vehicle facade for setting, stepping, drawing, resetting, destroying, and exposing vehicle bodies.
- `src/vehicles/wreckersaurus/config.js` owns Wreckersaurus tuning constants: scale, drive speed, motor torque, suspension, arm servo settings, jaw angles, collision group, facing constants, and fracture load multiplier.
- `src/vehicles/wreckersaurus/assets.js` imports SVG parts with Vite `?raw`, records view boxes/pivots/endpoints, hides SVG pivot markers, and converts raw SVG into `Image` assets.
- `src/vehicles/wreckersaurus/factory.js` owns Wreckersaurus construction and behavior: Planck bodies/joints, tread loop, arm IK/servo logic, jaw/head controls, tail motion, keyboard/gamepad/pointer input interpretation, flipping, drawing, and cleanup.
- `src/vehicles/wreckersaurus/assets/*.svg` are the source art parts used by `assets.js`. Keep filenames stable unless imports and metadata are updated together.

## Commands

- Install deps: `npm install`
- Start dev server: `npm run dev`
- Production build: `npm run build`
- Preview built app: `npm run preview`

There is currently no dedicated test script; use `npm run build` as the baseline verification after code changes.

## Implementation Notes

- Terrain, stats, and canvas layout all use explicit dirtying. When changing cell contents or packed terrain behavior, make sure the relevant grid helpers or dirty callbacks are used.
- Packed terrain collision flows through `packedContours` into `physics/terrain.js`; visual packed contour rendering also reads the same contour cache.
- Rigid body interaction with dirt flows from vehicle bodies through `rigidInfluence.update()` into `dirtSimulation.applyRigidTerrainEffects()`.
- Canvas sizing is managed through `createCanvasLayout()`, `sync()`, and `markDirty()`. Avoid directly coupling simulation grid size to CSS pixels.
- If adding controls, update `index.html`, `src/ui/controls.js`, and any consuming logic in `src/main.js` or simulation modules.
- If adding a vehicle, prefer implementing it behind the same active-vehicle surface used by `vehicleManager`: `step`, `draw`, `reset`, `destroy`, `getBodies`, and any optional controls needed by `main.js`.

## Style Guidelines

- Use modern JavaScript modules, `const` by default, and existing helper functions before adding new ones.
- Keep comments sparse and useful; most of this app is easier to understand through well-named helpers and constants.
- Preserve the compact control-panel UI.
- Keep CSS responsive behavior in the existing breakpoints (`980px`, `620px`) unless a layout change requires otherwise.
- Use ASCII text in source files unless existing content or asset requirements justify otherwise.

## Verification Checklist

- Run `npm run build`.
- For visual or input changes, prefer asking the user to verify changes.
