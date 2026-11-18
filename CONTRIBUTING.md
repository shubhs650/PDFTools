# Contributing to Triya PDF

Thanks for helping. Triya PDF is a free, offline, private PDF editor; the rules below keep it
that way.

## Reporting a bug

- Use **Help › Report an issue on GitHub** in the app: it fills in the version, browser and OS
  for you. Or [open an issue](https://github.com/shubhs650/PDFTools/issues/new/choose).
- Say what you did, what you expected and what happened instead.
- **Never attach confidential, company or client documents.** If a file is needed, make a small
  PDF yourself that shows the problem, or describe it.

## Before a pull request

1. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) (the specification; decisions are numbered D-xx)
   and the standing rules in [`CLAUDE.md`](CLAUDE.md). The most important ones:
   - The main thread is for the UI only; PDF work runs in the Render or Work worker.
   - No network calls besides the app's own update check and the opt-in error report.
   - Permissive licenses only (MIT, Apache-2.0, BSD, ISC; OFL-1.1 for fonts). Run
     `npm run licenses` after adding a dependency.
   - No hardcoded user-visible strings: add keys to `src/i18n/en.json`.
   - Every control is keyboard-reachable and has an accessible name.
   - Test data is public or self-made only. Don't copy code, icons or artwork from other PDF
     products.
2. A change to the design needs an ADR in `docs/adr/` first.
3. Run the checks:

   ```sh
   npm run typecheck && npm run lint && npm run format:check && npm run test && npm run licenses
   npm run e2e        # the flows your change touches, at least
   ```

4. Keep the pull request to one change, describe what and why, and reference the D-xx decision
   it follows.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
