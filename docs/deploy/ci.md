# CI (GitHub Actions)

`.github/workflows/ci.yml` is the gate for every pull request. The Cloudflare
"Workers Builds" check only builds the preview and does not gate merges.

## What runs when

| Event                                              | Jobs                                                                                          | Wall time |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------- |
| Pull request (code)                                | Checks · smoke flows + perf smoke + offline on two runners · axe on two runners, side by side | ~9 min    |
| Pull request, every file Markdown or under `docs/` | Checks only                                                                                   | ~7 min    |
| Pull request with the `full-e2e` label             | Checks · full e2e in 3 shards · accessibility · offline + perf + acceptance                   | ~13 min   |
| Push to `main`, nightly (02:23 UTC), Run workflow  | Same as `full-e2e`                                                                            | ~13 min   |

"CI result" runs last on every event and fails when any other job failed or was
cancelled (a job the event skips counts as passed). It is the one check to read.

Shared set-up for the Playwright jobs is in `.github/actions/setup-e2e`
(Node, `npm ci`, Chromium with its files cached per `package-lock.json`, qpdf).

## Two pull requests at once

- Each PR has its own concurrency group: a new commit cancels only that PR's older
  run. Runs on `main` are never cancelled; a second merge waits for the first
  merge's run.
- A PR run tests the PR merged onto `main` **as it was when the run started**. When
  another PR merges first, that green result is stale. Before squash merging,
  compare the run's base with `main`: if `main` has moved, update the branch from
  `main` (rebase, or GitHub's "Update branch"), fix any conflict, and wait for a new
  green run.
- Add `full-e2e` to a PR that changes risky shared code (engine, workers, save
  path, viewer).
- Perf flakes on `main` are logged on issue #59 and do not block PRs.
