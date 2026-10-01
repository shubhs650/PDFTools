# PDFTools

A free, offline, private, PDF-XChange-style PDF editor PWA for engineers.

- Specification: [`ARCHITECTURE.md`](ARCHITECTURE.md) (source of truth)
- Agent rules: [`CLAUDE.md`](CLAUDE.md)
- Status: [`docs/PROGRESS.md`](docs/PROGRESS.md) · Milestone plans: [`docs/plan/`](docs/plan/)

## Development

Requires Node ≥ 22.18 (see `.nvmrc`).

```sh
npm ci
npm run dev          # Vite dev server
npm run typecheck    # tsc -b (strict)
npm run lint         # ESLint (type-aware, no hardcoded JSX strings)
npm run format       # Prettier
npm run test         # Vitest unit tests (tests/)
npm run e2e          # Playwright (e2e/), builds + previews the app
npm run perf         # Playwright performance scenarios (e2e/perf/)
npm run licenses     # Dependency license gate — fails on non-permissive licenses
npm run build        # Production build
```

If the installed Chromium doesn't match the Playwright version, set
`PW_CHROMIUM_EXECUTABLE=/path/to/chrome` for `npm run e2e`.

## Deployment

Cloudflare Pages, built from this repository (`npm run build` → `dist/`, production branch
`main`). Setup, checks and rollback: [`docs/deploy/cloudflare-pages.md`](docs/deploy/cloudflare-pages.md).
`npm run check:pages` verifies a build against the Pages limits.
