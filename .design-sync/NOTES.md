# design-sync notes — Vibesboard UI kit

The "design system" here is **app-internal source**, not a published package: the
shadcn/Radix primitives in `apps/web/components/ui/*.tsx`, styled entirely with
Tailwind utility classes that map to CSS-variable tokens in
`apps/web/app/globals.css`. There is no Storybook and no built `dist/`.

## Build model (read before re-syncing)

- **Shape:** `package`, synth-from-source — but with a **curated barrel entry**
  (`apps/web/.ds-entry.tsx`, gitignored) passed via `--entry`, NOT pure synth
  discovery. The barrel `export *`s the 24 chosen primitive families onto
  `window.VibesboardUI`. `componentSrcMap` pins the same 24 as the card/.d.ts
  list. The `icons.tsx` glyph set is intentionally excluded from cards (still
  bundled transitively where components use it).
- `pkg = "@vibesboard/web"` → PKG_DIR resolves via the `node_modules/@vibesboard/web`
  workspace symlink to `apps/web`. So `srcDir`/`componentSrcMap`/`cssEntry` are all
  relative to `apps/web`.
- `--node-modules` is the **repo root** `node_modules` (react/radix/cva/lucide/
  chart.js all hoist there; apps/web has no own react).
- `tsconfig = apps/web/tsconfig.json` so esbuild resolves the `@/* → ./*` alias
  (several ui files import `@/components/ui/icons`, `@/lib/hooks/...`). `cn` comes
  from the workspace package `@vibesboard/utils` (exports from TS src), not `@/lib/utils`.

## Styling — the crux

These components have **no shipped CSS**; their look is Tailwind utilities +
`globals.css` tokens, compiled at app build time. So before each converter build,
run `sh .design-sync/build-css.sh` to compile `apps/web/.ds-tw.css` (gitignored,
bounded inside apps/web so it's a legal `cssEntry`). That file = remote Google-font
`@import` + `:root` font vars + full compiled Tailwind (preflight + utilities +
tokens), scanned over `apps/web/components/**`, `apps/web/app/**`, and
`.design-sync/previews/**` via `.design-sync/tw.config.cjs`. Regenerate it after
authoring/changing previews so any new utility classes they use are present.

## Fonts

Brand fonts are **Manrope** (sans, `--font-sans`) + **Roboto Mono** (mono,
`--font-mono`) via `next/font/google` (`apps/web/lib/fonts.ts`). next/font self-hosts
them at runtime; there are no woff2 files in the repo. We resolve them with a remote
Google-Fonts `@import` prepended in `build-css.sh` (the `[FONT_REMOTE]` path) plus
`:root` fallbacks. `font-mono` (uppercase tracking) is prominent on Button/Badge, so
the mono font matters for fidelity.

## Re-sync recipe

1. `sh .design-sync/build-css.sh`
2. build/validate (or `resync.mjs`) with
   `--node-modules ./node_modules --entry ./apps/web/.ds-entry.tsx`, run from repo root.

## .d.ts extraction (why gen-dts.sh exists)

The converter's prop extractor only reads shipped `.d.ts` (+ @types/react); it never
reads `.tsx`, so without help every component emits a `{ [key:string]: unknown }` stub.
`gen-dts.sh` solves this: `tsc --emitDeclarationOnly` emits real `.d.ts` into
`apps/web/types/.ds-dts/`, and the type-only `apps/web/index.d.ts` barrel becomes the
extractor's `entry` so its call-signature fallback resolves components without a named
`<Name>Props` interface. The extractor then filters React/DOM-inherited props and keeps
each component's OWN props (e.g. Button → variant/size/asChild). The barrel re-exports
ONLY the 24 primaries (named exports), which is what holds the carded list at 24 — a
broad `export *` barrel balloons it to 83 (every CardHeader/DialogContent subpart).

## process shim

`apps/web/.ds-shim.ts` defines a minimal `globalThis.process` and is imported FIRST in
`.ds-entry.tsx`. Without it the IIFE throws `process is not defined` (next/image +
prop-types read `process.env` at module-eval) and `window.VibesboardUI` never populates.

## Overlays (Dialog/AlertDialog/Sheet/Select/DropdownMenu/Tooltip)

Authored OPEN-state previews; Radix portals DO capture in headless. Each needs
`cfg.overrides.<Name> = {cardMode:"single", viewport:"WxH"}` (a cfg.overrides change
forces a FULL package-build — scoped preview-rebuild errors `[CONFIG_STALE]`).
- AlertDialog viewport must be ≥640 wide or the footer uses the mobile `flex-col-reverse`
  (stacked) layout and the modal can clip; 700x440 centers it with side-by-side buttons.
- DropdownMenu items have no built-in icon gap — add `style={{gap:8}}` per item.
- Tooltip renders inline (no Portal wrapper) — wrap in `TooltipProvider`, use `open`.

## Component prop facts (non-obvious; from authoring)

- Badge: `variant` = default|primary|secondary|destructive|outline (default==secondary grey, primary=lime); no `size`; renders a `<div>` pill.
- Switch/checkbox-likes: use `defaultChecked` (not `checked`) to avoid a controlled-component warning in static previews.
- Progress: `value` (0–100) is REQUIRED — blank otherwise.
- Separator: vertical needs a fixed-height parent or `h-full` collapses.
- PageHeader: `title` (req), `description?`, `breadcrumbs?` (mono/uppercase), `actions?`, `children?`.
- CopyButton: prop is **`text`** (not `value`) + optional `label`. Its WebhookUrl cell is wide → `cardMode:"column"`.
- CodeBlock: `language` + `value`. DataTable: `data:T[]` + `columns:Column<T>{key,label,sortable?,render?}` (give rows an `id`); `Column` re-exported from `@vibesboard/web`.
- Tabs: needs `defaultValue` for an active tab.

## ChartWidget — deliberately on the floor card

ChartWidget (`{config: ChartConfig}`, `ChartConfig` re-exported) compiles and its chart.js
scaffold renders (container/title/legend/axes), but the canvas DATA geometry does not
paint in the headless capture environment — reproduced deterministically (byte-identical
PNGs across captures), an animation/canvas-settle issue, not a flake. The component
hard-codes its chart.js options so `animation:false` can't be set from the preview. We
floor-card it (fully importable, just no authored card). The authored attempt is preserved
at `.design-sync/ChartWidget.preview.tsx.disabled`. To author it later, the capture harness
needs a canvas-paint settle/`waitForFunction`, or the component must allow `animation:false`.

## Known render warns

- None blocking. ChartWidget shows the floor card (fallbackCard — not a failure).

## Re-sync risks / watch-list

- Gitignored build INPUTS (`apps/web/.ds-entry.tsx`, `.ds-shim.ts`, `.ds-dts.tsconfig.json`,
  `index.d.ts`, `types/.ds-dts/`, `.ds-tw.css`) are regenerated by `gen-dts.sh` +
  `build-css.sh`. A fresh clone MUST run both before the converter.
- The compiled `.ds-tw.css` tracks the repo's `tailwind.config.js` + `globals.css`; if tokens
  move there, the stylesheet drifts silently — always regenerate before a re-sync.
- Fonts load via a remote Google-Fonts `@import` (Manrope + Roboto Mono). If offline or the
  CDN changes, previews fall back to system fonts.
- Heavier bundled deps: next/image (icons.tsx), chart.js (ChartWidget), react-syntax-highlighter
  (CodeBlock), react-hot-toast (CopyButton) — watch their render results on re-sync.
- Overlay viewports/cardModes are tuned to the current content; large content changes may need
  viewport bumps.
