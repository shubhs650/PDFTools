// PDF Oxide warm-up, main-thread side (M4-04, ADR-009 decision 2): once the
// first document's background indexing is done — the Work worker is idle and
// the first pages have long rendered — Oxide is loaded and run once, at
// background priority, so the first export does not pay its ~0.7 s first call.
// A respawned Work worker (ADR-004) starts cold, so it is warmed again.
import { recordError } from '../../app/diagnostics';
import { workClient } from '../view/host';

let warmedFor = -1;
let inFlight = false;

export function warmOxide(): void {
  const client = workClient();
  if (inFlight || warmedFor === client.respawns) return;
  inFlight = true;
  const generation = client.respawns;
  client
    .run('oxideWarm', null)
    .promise.then(
      () => {
        warmedFor = generation;
      },
      (err: unknown) => {
        // Offline before the background precache: the next export loads it on demand.
        recordError('oxide.warm', err);
      },
    )
    .finally(() => {
      inFlight = false;
    });
}
