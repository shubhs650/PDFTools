# Performance tests

Playwright scenarios for the §12 acceptance targets, run with `npm run perf`.

- Import `test` from `../support/fixtures.ts`. In the `perf` project the shared guard fails a test
  on any main-thread long task > 100 ms (`PerformanceObserver('longtask')`) recorded after
  `guard.startMeasuring()`. Call it once the app has booted: cold boot is exempt (ADR-001 B4).
- The perf project runs one test at a time (`--workers=1`), so a test never measures another
  test's browser competing for the CPU. Functional e2e tests (parallel) don't assert long tasks;
  each scenario that must stay free of them has a test here.
- Heavy-file numbers are measured and reported, not gated (ADR-002).
- Inputs are self-made and generated at test time (`pdfs` fixture, `e2e/fixtures/generate.ts`).
